"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  FPS,
  MANUAL_PAN_MS,
  PAD,
  basePxPerSecFor,
  clampLevel,
  clampScroll,
  lastFrame,
  maxLevelFor,
  maxScrollFor,
  nextZoomLevel,
  pxPerSecAt,
  previousZoomLevel,
  snapTime,
  timeToX,
  zoomedViewport,
  type TimelineViewport,
} from "@/lib/timeline";
import {
  remapPlayhead,
  sequenceDuration,
  sourceToTimeline,
  timelineToSource,
  type EditorClip,
} from "@/lib/editor";

/** If the browser never reports a completed seek, resume from the media. */
const SEEK_WATCHDOG_MS = 4_000;

/** How close to the right edge the playhead may get before the view follows. */
const EDGE_PX = 30;

/** Where a followed playhead lands: a fifth of the way in. */
const FOLLOW_RATIO = 0.2;

/** How fast a Ctrl/Cmd + wheel turn moves the continuous zoom level. */
const WHEEL_ZOOM_SPEED = 0.01;

export interface TimelineController {
  /** The interactive timeline viewport; the hook measures this element. */
  laneRef: RefObject<HTMLDivElement | null>;
  time: number;
  duration: number;
  playing: boolean;
  /** `null` until the media has a duration and the lane has been measured. */
  basePxPerSec: number | null;
  viewportWidth: number;
  level: number;
  scrollX: number;
  maxLevel: number;
  seekTo: (time: number) => void;
  step: (frames: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  zoomTo: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFrame: () => void;
  resetZoom: () => void;
  panBy: (deltaX: number) => void;
  /** Call when the user starts panning or scrubbing, so playback stops chasing. */
  markManual: () => void;
}

/**
 * The timeline's only mutable state: playback plus the viewport.
 *
 * One source of truth at a time. While playing, the `<video>` element is read
 * through `requestAnimationFrame` (never `timeupdate`, which fires too rarely),
 * and the playhead follows it. While scrubbing or stepping, the playhead state
 * is authoritative and the media is told to seek; the read-back is suppressed
 * until `seeked` so HLS latency cannot snap the playhead backwards. Seeks are
 * coalesced to one in flight, with the latest target kept as pending.
 *
 * `basePxPerSec` is computed once when the first non-zero sequence length is
 * known and the lane has been measured, and again only on an explicit reset.
 * Resizing changes the viewport width and the scroll clamp, not the scale, and
 * a later edit changes the sequence length without rescaling what is on screen.
 */
export function useTimeline(
  videoRef: RefObject<HTMLVideoElement | null>,
  clips: readonly EditorClip[],
): TimelineController {
  const laneRef = useRef<HTMLDivElement | null>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [basePxPerSec, setBasePxPerSec] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewport, setViewportState] = useState<TimelineViewport>({
    level: 0,
    scrollX: 0,
  });

  /*
   * The timeline's own length comes from the clips, never from the media: an
   * edit can leave most of the source on the cutting-room floor. The media
   * duration only matters once, when the first clip is scaled into the viewport.
   */
  const duration = sequenceDuration(clips);

  // Mirrors for the callbacks that must not be re-created per render.
  const viewportRef = useRef(viewport);
  const timeRef = useRef(0);
  const durationRef = useRef(duration);
  const clipsRef = useRef(clips);
  const prevClipsRef = useRef(clips);
  const baseRef = useRef(0);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualUntilRef = useRef(0);

  durationRef.current = duration;
  clipsRef.current = clips;

  const setViewport = useCallback((next: TimelineViewport) => {
    viewportRef.current = next;
    setViewportState(next);
  }, []);

  const markManual = useCallback(() => {
    manualUntilRef.current = performance.now() + MANUAL_PAN_MS;
  }, []);

  /**
   * The one-time scale: called with the first non-zero sequence duration and
   * from the first resize, whichever knows both numbers first. It never runs
   * twice until a reset, so edits do not rescale the timeline.
   */
  const applyBase = useCallback(
    (nextDuration: number) => {
      if (baseRef.current > 0 || nextDuration <= 0) return;

      const width = laneRef.current?.clientWidth ?? 0;
      if (width <= 0) return;

      const base = basePxPerSecFor(width, nextDuration);
      if (!(base > 0)) return;

      baseRef.current = base;
      setBasePxPerSec(base);
      setViewport({ level: 0, scrollX: 0 });
    },
    [setViewport],
  );

  /* ---------------------------------------------------------------- media */

  const requestSeekRef = useRef<(time: number) => void>(() => undefined);

  const clearSeekTimer = useCallback(() => {
    if (seekTimerRef.current === null) return;
    clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
  }, []);

  const requestSeek = useCallback(
    (next: number) => {
      const video = videoRef.current;
      if (!video) return;

      if (seekingRef.current) {
        pendingSeekRef.current = next;
        return;
      }

      seekingRef.current = true;
      pendingSeekRef.current = null;

      try {
        video.currentTime = next;
      } catch {
        seekingRef.current = false;
        return;
      }

      clearSeekTimer();
      seekTimerRef.current = setTimeout(() => {
        /* A seek that never completes must not freeze playback forever. */
        seekingRef.current = false;
        seekTimerRef.current = null;
      }, SEEK_WATCHDOG_MS);
    },
    [clearSeekTimer, videoRef],
  );

  useEffect(() => {
    requestSeekRef.current = requestSeek;
  }, [requestSeek]);

  useEffect(() => {
    applyBase(duration);
  }, [applyBase, duration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    const onEnded = () => {
      setPlaying(false);
      const end = lastFrame(durationRef.current);
      timeRef.current = end;
      setTime(end);
    };

    const onSeeked = () => {
      seekingRef.current = false;
      clearSeekTimer();

      const pending = pendingSeekRef.current;
      pendingSeekRef.current = null;

      if (
        pending !== null &&
        Math.abs(video.currentTime - pending) >= 1 / (FPS * 2)
      ) {
        requestSeekRef.current(pending);
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [clearSeekTimer, videoRef]);

  useEffect(() => clearSeekTimer, [clearSeekTimer]);

  const seekTo = useCallback(
    (raw: number) => {
      const next = snapTime(raw, durationRef.current);
      timeRef.current = next;
      setTime(next);

      const video = videoRef.current;
      const source = timelineToSource(clipsRef.current, next);
      if (!video || source === null) return;
      if (Math.abs(video.currentTime - source) < 1 / (FPS * 2)) return;

      requestSeek(source);
    },
    [requestSeek, videoRef],
  );

  const step = useCallback(
    (frames: number) => {
      /* A step is a scrub: the playhead state owns the time, so playback must
       * not keep moving it on the next animation frame. */
      videoRef.current?.pause();
      seekTo(timeRef.current + frames / FPS);
    },
    [seekTo, videoRef],
  );

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video || durationRef.current <= 0 || clipsRef.current.length === 0) {
      return;
    }

    if (timeRef.current >= durationRef.current - 1 / (FPS * 2)) {
      seekTo(0);
    } else {
      /* Starting mid-sequence must not resume the source where it was before
       * an edit: map the playhead first, then let playback run. */
      const source = timelineToSource(clipsRef.current, timeRef.current);
      if (
        source !== null &&
        Math.abs(video.currentTime - source) >= 1 / (FPS * 2)
      ) {
        requestSeek(source);
      }
    }

    void video.play().catch(() => undefined);
  }, [requestSeek, seekTo, videoRef]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, [videoRef]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) play();
    else pause();
  }, [pause, play, videoRef]);

  /* ------------------------------------------------------------- viewport */

  const zoomTo = useCallback(
    (nextLevel: number) => {
      const base = baseRef.current;
      const width = laneRef.current?.clientWidth ?? 0;
      const total = durationRef.current;
      if (!(base > 0) || width <= 0 || total <= 0) return;

      const current = viewportRef.current;
      const next = zoomedViewport({
        time: timeRef.current,
        viewport: {
          level: current.level,
          scrollX: clampScroll(
            current.scrollX,
            maxScrollFor(total, current.level, base, width),
          ),
        },
        basePxPerSec: base,
        duration: total,
        viewportWidth: width,
        nextLevel,
      });

      setViewport(next);
    },
    [setViewport],
  );

  const zoomIn = useCallback(() => {
    const base = baseRef.current;
    if (!(base > 0)) return;
    zoomTo(nextZoomLevel(viewportRef.current.level, maxLevelFor(base)));
  }, [zoomTo]);

  const zoomOut = useCallback(() => {
    const base = baseRef.current;
    if (!(base > 0)) return;
    zoomTo(previousZoomLevel(viewportRef.current.level, maxLevelFor(base)));
  }, [zoomTo]);

  const zoomToFrame = useCallback(() => {
    const base = baseRef.current;
    if (!(base > 0)) return;
    zoomTo(maxLevelFor(base));
  }, [zoomTo]);

  const panBy = useCallback(
    (deltaX: number) => {
      if (!Number.isFinite(deltaX) || deltaX === 0) return;

      const base = baseRef.current;
      const width = laneRef.current?.clientWidth ?? 0;
      if (!(base > 0) || width <= 0) return;

      const current = viewportRef.current;
      const maxScroll = maxScrollFor(
        durationRef.current,
        current.level,
        base,
        width,
      );
      const next = clampScroll(current.scrollX + deltaX, maxScroll);
      if (next === current.scrollX) return;

      setViewport({ level: current.level, scrollX: next });
    },
    [setViewport],
  );

  const resetZoom = useCallback(() => {
    const width = laneRef.current?.clientWidth ?? 0;
    const total = durationRef.current;

    if (width > 0 && total > 0) {
      const base = basePxPerSecFor(width, total);
      if (base > 0) {
        baseRef.current = base;
        setBasePxPerSec(base);
      }
    }

    setViewport({ level: 0, scrollX: 0 });
  }, [setViewport]);

  /**
   * Follow the playhead only when it leaves the viewport, and only while it is
   * the video driving it. A manual pan or drag suspends this briefly.
   */
  const followPlayhead = useCallback(
    (currentTime: number) => {
      const lane = laneRef.current;
      const base = baseRef.current;
      if (!lane || !(base > 0)) return;
      if (performance.now() < manualUntilRef.current) return;

      const width = lane.clientWidth;
      if (width <= 0) return;

      const current = viewportRef.current;
      const x = timeToX(currentTime, current, base);
      if (x >= 0 && x <= width - EDGE_PX) return;

      const maxScroll = maxScrollFor(
        durationRef.current,
        current.level,
        base,
        width,
      );
      const target = clampScroll(
        PAD + currentTime * pxPerSecAt(current.level, base) - width * FOLLOW_RATIO,
        maxScroll,
      );
      if (target === current.scrollX) return;

      setViewport({ level: current.level, scrollX: target });
    },
    [setViewport],
  );

  /* ------------------------------------------------------------- effects */

  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;

    const observer = new ResizeObserver(() => {
      const width = lane.clientWidth;
      setViewportWidth(width);
      applyBase(durationRef.current);
    });

    observer.observe(lane);
    return () => observer.disconnect();
  }, [applyBase]);

  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        zoomTo(viewportRef.current.level - event.deltaY * WHEEL_ZOOM_SPEED);
        return;
      }

      markManual();
      panBy(event.deltaX || event.deltaY);
    };

    lane.addEventListener("wheel", onWheel, { passive: false });
    return () => lane.removeEventListener("wheel", onWheel);
  }, [markManual, panBy, zoomTo]);

  useEffect(() => {
    if (!playing) return;

    let frame = requestAnimationFrame(function tick() {
      const video = videoRef.current;

      if (video && !seekingRef.current) {
        /*
         * The element's clock is source time. The timeline is the edit: map the
         * source back through the surviving clips, and when it lands in a
         * region an edit removed, jump the element to the next clip instead of
         * showing (or silently playing) what was cut out.
         */
        const mapped = sourceToTimeline(clipsRef.current, video.currentTime);

        if (mapped.ended || video.ended) {
          video.pause();
          const end = lastFrame(durationRef.current);
          if (end !== timeRef.current) {
            timeRef.current = end;
            setTime(end);
            followPlayhead(end);
          }
        } else {
          if (mapped.seek !== null) {
            requestSeekRef.current(mapped.seek);
          }

          const next = snapTime(mapped.time, durationRef.current);
          if (next !== timeRef.current) {
            timeRef.current = next;
            setTime(next);
            followPlayhead(next);
          }
        }
      }

      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [followPlayhead, playing, videoRef]);

  /*
   * Keep the *frame* under the playhead across an edit, not its old timeline
   * coordinate. Removing the head of a clip moves that frame to the clip's new
   * start; deleting the clip under the playhead lands on the next surviving
   * clip; deleting the tail leaves the frame at the cut. The source mapping is
   * what makes those cases fall out without an action-specific rule.
   */
  useEffect(() => {
    const video = videoRef.current;
    const previous = prevClipsRef.current;
    prevClipsRef.current = clips;

    if (clips.length === 0) {
      video?.pause();
      timeRef.current = 0;
      setTime(0);
      return;
    }

    const oldTime = timeRef.current;
    const remapped = remapPlayhead(previous, clips, oldTime);
    const next = snapTime(
      Math.min(remapped.time, durationRef.current),
      durationRef.current,
    );

    if (next !== timeRef.current) {
      timeRef.current = next;
      setTime(next);
    }

    const target = remapped.seek ?? timelineToSource(clips, next);
    if (
      video &&
      target !== null &&
      Math.abs(video.currentTime - target) >= 1 / (FPS * 2)
    ) {
      requestSeek(target);
    }
  }, [clips, requestSeek, videoRef]);

  const maxLevel = basePxPerSec === null ? 0 : maxLevelFor(basePxPerSec);
  const level = clampLevel(viewport.level, maxLevel);
  const maxScroll = maxScrollFor(duration, level, basePxPerSec ?? 0, viewportWidth);
  const scrollX = clampScroll(viewport.scrollX, maxScroll);

  return {
    laneRef,
    time,
    duration,
    playing,
    basePxPerSec,
    viewportWidth,
    level,
    scrollX,
    maxLevel,
    seekTo,
    step,
    play,
    pause,
    toggle,
    zoomTo,
    zoomIn,
    zoomOut,
    zoomToFrame,
    resetZoom,
    panBy,
    markManual,
  };
}
