"use client";

import {
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  Music,
  Pause,
  PanelLeft,
  PanelRight,
  Play,
  RotateCcw,
  SquareSplitHorizontal,
  StepBack,
  StepForward,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import { GainLine } from "@/components/editor/gain-line";
import { usePreviewGain } from "@/components/editor/use-preview-gain";
import { useTimeline } from "@/components/editor/use-timeline";
import {
  ClipThumbnails,
  useStoryboard,
} from "@/components/editor/clip-thumbnails";
import {
  ClipWaveform,
  useAudioLevels,
} from "@/components/editor/clip-waveform";
import { TimelineScrollbar } from "@/components/editor/timeline-scrollbar";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  canDeleteClip as sequenceCanDeleteClip,
  clipAtTime,
  clipGainDb,
  clipOffsetAt,
  previewGainDb,
  trackGainDb,
  videoClips,
  type ClipEditAction,
  type EditorTrack,
} from "@/lib/editor";
import type { ProjectMedia } from "@/lib/media";
import {
  FRAME_BAND_MIN_PX,
  FRAME_GRID_MIN_PX,
  formatTimecode,
  pxPerFrameAt,
  pxPerSecAt,
  timeToX,
  visibleTicks,
  xToTime,
  type TimelineViewport,
} from "@/lib/timeline";
import { cn } from "@/lib/utils";

/** Ruler height, and the matching gutter in the track header column. */
const RULER_HEIGHT = 32;

/** One track row, and the matching track header height. */
const TRACK_HEIGHT = 96;

/** The clip inset: `top-2 bottom-2` inside its track row. */
const CLIP_HEIGHT = TRACK_HEIGHT - 16;

/** The waveform strip along the bottom of a video clip. */
const WAVEFORM_HEIGHT = 32;

/** Breathing room between the frames and the waveform strip, in pixels. It
 * wears the strip's own background so the two read as one grey band. */
const WAVEFORM_GAP = 10;

/** What is left of the clip's inner box (inside its 1px border) for frames. */
const THUMBNAIL_HEIGHT = CLIP_HEIGHT - 2 - WAVEFORM_HEIGHT - WAVEFORM_GAP;

/** Lane-edge distance and step for auto-panning while a clip is dragged. */
const DRAG_SCROLL_EDGE = 40;
const DRAG_SCROLL_STEP = 18;

export interface EditorTimelineProps {
  tracks: EditorTrack[];
  onTrackChange: (
    trackId: string,
    patch: Partial<Pick<EditorTrack, "muted" | "hidden" | "gainDb">>,
  ) => void;
  /** Sets one clip's loudness in dB. Every clip keeps its own level. */
  onClipGainChange: (clipId: string, gainDb: number) => void;
  /** Applies a playhead-anchored clip edit at the given timeline time. */
  onClipEdit: (action: ClipEditAction, time: number) => void;
  /** Removes one clip by id, selected or under the playhead. */
  onDeleteClip: (clipId: string) => void;
  /** Moves one clip to a slot in the remaining order. */
  onMoveClip: (clipId: string, slot: number) => void;
  clipLabel: string;
  /** The project's media: the poster and storyboard feed the clip thumbnails. */
  media: ProjectMedia;
  /** The one `<video>` element both the preview and the timeline drive. */
  videoRef: RefObject<HTMLVideoElement | null>;
}

function TrackHeader({
  track,
  onChange,
  onSelect,
  selected,
  clipCount,
}: {
  track: EditorTrack;
  onChange: EditorTimelineProps["onTrackChange"];
  onSelect: (trackId: string) => void;
  selected: boolean;
  clipCount: number;
}) {
  const isVideo = track.type === "video";
  const TypeIcon = isVideo ? Film : Music;

  return (
    <div
      style={{ height: TRACK_HEIGHT }}
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-b px-2",
        selected && "bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(track.id)}
        aria-pressed={selected}
        aria-label={`Select ${isVideo ? "video" : "audio"} track`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "text-foreground",
        )}
      >
        <span className="bg-muted grid size-6 shrink-0 place-items-center rounded">
          <TypeIcon className="size-3.5" aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {isVideo ? "Video" : "Audio"}
          </span>
          <span className="text-muted-foreground block text-[10px]">
            {clipCount} {clipCount === 1 ? "clip" : "clips"}
          </span>
        </span>
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={track.muted ? "Unmute track" : "Mute track"}
        aria-pressed={track.muted}
        onClick={() => onChange(track.id, { muted: !track.muted })}
        className={cn(track.muted && "text-muted-foreground")}
      >
        {track.muted ? (
          <VolumeX aria-hidden="true" />
        ) : (
          <Volume2 aria-hidden="true" />
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={track.hidden ? "Show track" : "Hide track"}
        aria-pressed={track.hidden}
        onClick={() => onChange(track.id, { hidden: !track.hidden })}
        className={cn(track.hidden && "text-muted-foreground")}
      >
        {track.hidden ? (
          <EyeOff aria-hidden="true" />
        ) : (
          <Eye aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

/**
 * The single editing surface.
 *
 * Pixels are never stored. The timeline keeps `{ level, scrollX }` and draws
 * everything through the pure functions in `lib/timeline.ts`, so the model in
 * `lib/editor.ts` stays in seconds and the ruler, clips and playhead cannot
 * disagree about where a time is.
 *
 * One source of truth for the playhead at a time: while the video plays,
 * `requestAnimationFrame` reads the element's `currentTime`; while the user
 * drags or steps, the state here is authoritative and the element is told to
 * seek. See `useTimeline`.
 */
export function EditorTimeline({
  tracks,
  onTrackChange,
  onClipGainChange,
  onClipEdit,
  onDeleteClip,
  onMoveClip,
  clipLabel,
  media,
  videoRef,
}: EditorTimelineProps) {
  const clips = useMemo(() => videoClips(tracks), [tracks]);
  const timeline = useTimeline(videoRef, clips);
  const storyboard = useStoryboard(media.thumbnails);
  const audioLevels = useAudioLevels(media.levels);
  const {
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
    toggle,
    pause,
    zoomTo,
    zoomIn,
    zoomOut,
    zoomToFrame,
    resetZoom,
    panBy,
    scrollTo,
    maxScroll,
    markManual,
  } = timeline;

  /* The preview's loudness follows the clip under the playhead. */
  usePreviewGain(videoRef, previewGainDb(tracks, time));

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    clipId: string;
    /** Pointer x in lane coordinates; the clip follows this minus its grab. */
    x: number;
    /** Distance from the clip's left edge to where the pointer went down. */
    grabOffset: number;
    /** Slot in the remaining order the clip would land in. */
    slot: number;
  } | null>(null);

  const dragRef = useRef<{
    clipId: string;
    pointerId: number;
    startX: number;
    grabOffset: number;
    active: boolean;
  } | null>(null);

  /* A clip can disappear under a selection: delete-left can remove the
   * selected id and a track update can replace the list. The id is kept (it is
   * inert once no clip matches) and every consumer derives the live clip from
   * `clips`, so a ghost id can never act as a selection. */

  const selectedClip =
    selectedClipId === null
      ? null
      : (clips.find((clip) => clip.id === selectedClipId) ?? null);

  const currentClip = clipAtTime(clips, time);
  const offset = clipOffsetAt(clips, time);
  const atClipStart = offset === null || offset <= 1e-6;
  const atClipEnd =
    currentClip === null ||
    offset === null ||
    offset >= currentClip.duration - 1e-6;
  const canSplit = currentClip !== null && !atClipStart && !atClipEnd;
  /* A single clip may be trimmed from an interior point, but deleting its
   * whole body would empty the track; the toolbar disables that case. */
  const canDeleteLeft =
    currentClip !== null &&
    !atClipStart &&
    (clips.length > 1 || !atClipEnd);
  const canDeleteRight =
    currentClip !== null &&
    !atClipEnd &&
    (clips.length > 1 || !atClipStart);
  const deleteTarget = selectedClip ?? currentClip;
  const canDeleteTarget =
    deleteTarget !== null && sequenceCanDeleteClip(clips);

  const selectClip = (clipId: string, trackId: string) => {
    setSelectedClipId(clipId);
    setSelectedTrackId(trackId);
  };

  const selectTrack = (trackId: string) => {
    setSelectedTrackId(trackId);
    setSelectedClipId(null);
  };

  const deleteSelectedClip = (clipId: string) => {
    if (!sequenceCanDeleteClip(clips)) return;

    setSelectedClipId((current) => (current === clipId ? null : current));
    onDeleteClip(clipId);
  };

  const laneXAt = (clientX: number): number => {
    const lane = laneRef.current;
    if (!lane) return 0;
    return clientX - lane.getBoundingClientRect().left;
  };

  /**
   * The slot a dragged clip would occupy after it is removed, computed from the
   * dragged clip's projected **centre** rather than the pointer: a short clip
   * dragged by its edge should not snap earlier than one dragged by its middle.
   * Counting the remaining clips' midpoints matches `moveClip`'s "slot in the
   * remaining order", and it is what the live preview below uses too.
   */
  const slotForDrag = (clipId: string, leftPx: number): number => {
    const dragged = clips.find((clip) => clip.id === clipId);
    if (!dragged || basePxPerSec === null) return 0;

    const centre = xToTime(
      leftPx + (dragged.duration * pxPerSecond) / 2,
      { level, scrollX },
      basePxPerSec,
    );

    let slot = 0;
    let end = 0;
    for (const clip of clips) {
      if (clip.id === clipId) continue;
      if (centre > end + clip.duration / 2) slot += 1;
      end += clip.duration;
    }
    return slot;
  };

  const handleClipPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    clipId: string,
    trackId: string,
  ) => {
    if (event.button !== 0) return;

    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    selectClip(clipId, trackId);

    const pressed = clips.find((clip) => clip.id === clipId);

    dragRef.current = {
      clipId,
      pointerId: event.pointerId,
      startX: event.clientX,
      grabOffset:
        pressed && basePxPerSec !== null
          ? laneXAt(event.clientX) -
            timeToX(pressed.start, viewport, basePxPerSec)
          : 0,
      active: false,
    };
  };

  const handleClipPointerMove = (
    event: PointerEvent<HTMLDivElement>,
    clipId: string,
  ) => {
    const current = dragRef.current;
    if (!current || current.clipId !== clipId) return;

    const dx = event.clientX - current.startX;
    if (!current.active) {
      if (Math.abs(dx) < 4) return;
      current.active = true;
      /* Reordering while the preview keeps playing makes the target move under
       * the pointer. Stop the clock, but leave the playhead where it was. */
      pause();
      markManual();
    }

    event.stopPropagation();

    const lane = laneRef.current;
    if (!lane) return;

    const rect = lane.getBoundingClientRect();
    const x = event.clientX - rect.left;

    /* Pan when the pointer nears either edge. The lane has no native scroll —
     * `scrollX` is the only one — so a long sequence would otherwise be
     * impossible to reorder in one drag. */
    if (event.clientX < rect.left + DRAG_SCROLL_EDGE) {
      panBy(-DRAG_SCROLL_STEP);
    } else if (event.clientX > rect.right - DRAG_SCROLL_EDGE) {
      panBy(DRAG_SCROLL_STEP);
    }

    setDrag({
      clipId,
      x,
      grabOffset: current.grabOffset,
      slot: slotForDrag(clipId, Math.max(0, x - current.grabOffset)),
    });
  };

  const handleClipPointerUp = (
    event: PointerEvent<HTMLDivElement>,
    clipId: string,
  ) => {
    const current = dragRef.current;
    if (!current || current.clipId !== clipId) return;

    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;

    if (current.active) {
      const x = laneXAt(event.clientX);
      onMoveClip(
        clipId,
        slotForDrag(clipId, Math.max(0, x - current.grabOffset)),
      );
    }

    setDrag(null);
  };

  const handleClipPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDrag(null);
  };

  const handleClipKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    clipId: string,
    trackId: string,
  ) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      deleteSelectedClip(clipId);
      return;
    }

    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();

      const index = clips.findIndex((clip) => clip.id === clipId);
      if (index < 0) return;
      onMoveClip(clipId, index + (event.key === "ArrowLeft" ? -1 : 1));
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      step(direction * (event.shiftKey ? 10 : 1));
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      selectClip(clipId, trackId);
    }
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const viewport: TimelineViewport = { level, scrollX };
  const pxPerSecond = basePxPerSec === null ? 0 : pxPerSecAt(level, basePxPerSec);
  const pxPerFrame = basePxPerSec === null ? 0 : pxPerFrameAt(level, basePxPerSec);
  const playheadX =
    basePxPerSec === null ? 0 : timeToX(time, viewport, basePxPerSec);
  const endX = basePxPerSec === null ? 0 : timeToX(duration, viewport, basePxPerSec);

  /* The ruler is a canvas: at frame level a clip is 30 labels per second, so a
   * DOM per tick would be a layout problem, not a style choice. Only visible
   * ticks are drawn. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || basePxPerSec === null || viewportWidth <= 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewportWidth * dpr));
    canvas.height = Math.round(RULER_HEIGHT * dpr);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewportWidth, RULER_HEIGHT);

    const styles = getComputedStyle(canvas);
    const lineColor =
      styles.getPropertyValue("--border").trim() || "rgba(255,255,255,0.12)";
    const textColor =
      styles.getPropertyValue("--muted-foreground").trim() ||
      "rgba(255,255,255,0.6)";

    context.lineWidth = 1;
    context.strokeStyle = lineColor;
    context.fillStyle = textColor;
    context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textBaseline = "top";

    context.beginPath();
    context.moveTo(0, RULER_HEIGHT - 0.5);
    context.lineTo(viewportWidth, RULER_HEIGHT - 0.5);
    context.stroke();

    const { labels, minors } = visibleTicks({
      viewport: { level, scrollX },
      basePxPerSec,
      viewportWidth,
    });

    for (const minor of minors) {
      const x = Math.round(minor.x) + 0.5;
      context.beginPath();
      context.moveTo(x, RULER_HEIGHT - 6);
      context.lineTo(x, RULER_HEIGHT);
      context.stroke();
    }

    for (const label of labels) {
      const x = Math.round(label.x) + 0.5;
      context.beginPath();
      context.moveTo(x, 12);
      context.lineTo(x, RULER_HEIGHT);
      context.stroke();
      context.fillText(label.label, x + 4, 4);
    }
  }, [basePxPerSec, level, scrollX, viewportWidth]);

  const seekFromClientX = (clientX: number) => {
    const lane = laneRef.current;
    if (!lane || basePxPerSec === null) return;

    const rect = lane.getBoundingClientRect();
    seekTo(xToTime(clientX - rect.left, viewport, basePxPerSec));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    markManual();

    /* Dragging is a scrub, not a play: the playhead owns the target time while
     * the pointer is down, so playback must not keep advancing it. */
    timeline.pause();
    seekFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekFromClientX(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;

    if (
      (key === "Delete" || key === "Backspace") &&
      deleteTarget !== null &&
      canDeleteTarget
    ) {
      event.preventDefault();
      deleteSelectedClip(deleteTarget.id);
      return;
    }

    if (
      event.altKey &&
      selectedClip !== null &&
      (key === "ArrowLeft" || key === "ArrowRight")
    ) {
      event.preventDefault();
      const index = clips.findIndex((clip) => clip.id === selectedClip.id);
      if (index >= 0) {
        onMoveClip(selectedClip.id, index + (key === "ArrowLeft" ? -1 : 1));
      }
      return;
    }

    if (key === "ArrowLeft") {
      event.preventDefault();
      step(event.shiftKey ? -10 : -1);
    } else if (key === "ArrowRight") {
      event.preventDefault();
      step(event.shiftKey ? 10 : 1);
    } else if (key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (key === "End") {
      event.preventDefault();
      seekTo(duration);
    } else if (key === " ") {
      event.preventDefault();
      toggle();
    } else if (key === "+" || key === "=") {
      event.preventDefault();
      zoomIn();
    } else if (key === "-" || key === "_") {
      event.preventDefault();
      zoomOut();
    }
  };

  const frameGrid =
    pxPerFrame >= FRAME_GRID_MIN_PX
      ? `repeating-linear-gradient(90deg, transparent 0, transparent ${
          pxPerFrame - 1
        }px, var(--border) ${pxPerFrame - 1}px, var(--border) ${pxPerFrame}px)`
      : undefined;

  const frameBand = pxPerFrame >= FRAME_BAND_MIN_PX;
  const endShadeX = Math.max(0, endX);

  /*
   * While a clip is dragged, the other clips slide into the order they would
   * take on drop. The preview is computed in sequence seconds, not pixels, so it
   * stays correct at any zoom and while the lane auto-pans under the pointer.
   */
  const dragPreview = (() => {
    if (!drag) return null;
    const dragged = clips.find((clip) => clip.id === drag.clipId);
    if (!dragged) return null;

    const others = clips.filter((clip) => clip.id !== drag.clipId);
    const order = [
      ...others.slice(0, drag.slot),
      dragged,
      ...others.slice(drag.slot),
    ];

    const starts = new Map<string, number>();
    let acc = 0;
    for (const clip of order) {
      starts.set(clip.id, acc);
      acc += clip.duration;
    }
    return starts;
  })();

  /*
   * `min-w-0` on the section is load-bearing. It is a grid item in the editor's
   * single grid column, and at high zoom the clip is tens of thousands of
   * pixels wide. Without it the column sizes to the content, the inspector is
   * pushed off-screen, and the preview's `object-contain` picture is centred
   * outside the window (black picture, audio only). The lane clips instead.
   */
  return (
    <section
      aria-labelledby="timeline-heading"
      className="flex min-h-0 min-w-0 flex-col border-t bg-card/40"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2
          id="timeline-heading"
          className="flex items-center gap-1.5 text-xs font-medium"
        >
          <Clapperboard className="size-3.5" aria-hidden="true" />
          Timeline
        </h2>

        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous frame"
            onClick={() => step(-1)}
          >
            <StepBack aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={playing ? "Pause" : "Play"}
            aria-pressed={playing}
            onClick={toggle}
          >
            {playing ? (
              <Pause className="fill-current" aria-hidden="true" />
            ) : (
              <Play className="fill-current" aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next frame"
            onClick={() => step(1)}
          >
            <StepForward aria-hidden="true" />
          </Button>
        </div>

        <span className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />

        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label="Clip editing"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Split at playhead"
            title="Split at playhead"
            disabled={!canSplit}
            onClick={() => onClipEdit("split", time)}
          >
            <SquareSplitHorizontal aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Delete left of playhead"
            title="Delete left of playhead"
            disabled={!canDeleteLeft}
            onClick={() => onClipEdit("delete-left", time)}
          >
            <PanelLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Delete right of playhead"
            title="Delete right of playhead"
            disabled={!canDeleteRight}
            onClick={() => onClipEdit("delete-right", time)}
          >
            <PanelRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Delete clip"
            title="Delete the selected clip, or the clip under the playhead"
            disabled={!canDeleteTarget}
            onClick={() => {
              if (deleteTarget) deleteSelectedClip(deleteTarget.id);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground hidden text-[10px] tracking-wider uppercase xl:inline">
            Zoom
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out timeline"
            disabled={basePxPerSec === null}
            onClick={zoomOut}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <Slider
            aria-label="Timeline zoom"
            value={[level]}
            min={0}
            max={Math.max(maxLevel, 1)}
            step={0.01}
            disabled={basePxPerSec === null}
            onValueChange={(value) => zoomTo(value[0] ?? level)}
            className="w-24 sm:w-32"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in timeline"
            disabled={basePxPerSec === null}
            onClick={zoomIn}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={basePxPerSec === null}
            onClick={zoomToFrame}
          >
            Frame
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Reset zoom so the clip fills one third"
            disabled={basePxPerSec === null}
            onClick={resetZoom}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
        <div className="row-span-2 flex w-44 shrink-0 flex-col border-r">
          <div
            className="shrink-0 border-b"
            style={{ height: RULER_HEIGHT }}
            aria-hidden="true"
          />
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onChange={onTrackChange}
              onSelect={selectTrack}
              selected={selectedTrackId === track.id}
              clipCount={track.clips.length}
            />
          ))}
        </div>

        <div
          ref={laneRef}
          id="timeline-lane"
          className="relative min-w-0 touch-none overflow-hidden select-none"
        >
          {/* The scrub surface is the ruler strip only. The playhead moves
           * when the ruler is pressed or dragged, never from the tracks or
           * the clips, so reordering a clip cannot disturb it. */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.min(Math.round(time), Math.round(duration))}
            aria-valuetext={formatTimecode(time)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
            style={{ height: RULER_HEIGHT }}
            className="absolute inset-x-0 top-0 z-0 cursor-normal outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute top-0 left-0 h-8 w-full"
            aria-hidden="true"
          />

          {basePxPerSec !== null && duration > 0 ? (
            <div
              className="pointer-events-none absolute bottom-0"
              style={{
                top: RULER_HEIGHT,
                left: endShadeX,
                width: Math.max(0, viewportWidth - endShadeX),
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent 0 6px, var(--border) 6px 7px)",
                opacity: 0.35,
              }}
              aria-hidden="true"
            />
          ) : null}

          {tracks.map((track, index) => (
            <div
              key={track.id}
              className={cn(
                "pointer-events-none absolute inset-x-0 border-b",
                selectedTrackId === track.id ? "bg-white/[0.035]" : "bg-white/[0.015]",
              )}
              style={{
                top: RULER_HEIGHT + index * TRACK_HEIGHT,
                height: TRACK_HEIGHT,
              }}
            >
              {basePxPerSec !== null
                ? track.clips.map((clip, clipIndex) => {
                    const isDragging = drag?.clipId === clip.id;
                    const isSelected = selectedClipId === clip.id;
                    const previewStart = dragPreview?.get(clip.id) ?? clip.start;
                    const left = isDragging
                      ? Math.max(0, drag.x - drag.grabOffset)
                      : timeToX(previewStart, viewport, basePxPerSec);

                    return (
                      <div
                        key={clip.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`${clipLabel}, clip ${clipIndex + 1}, ${formatTimecode(clip.duration)}`}
                        title="Drag to reorder. Delete removes this clip."
                        onPointerDown={(event) =>
                          handleClipPointerDown(event, clip.id, track.id)
                        }
                        onPointerMove={(event) =>
                          handleClipPointerMove(event, clip.id)
                        }
                        onPointerUp={(event) =>
                          handleClipPointerUp(event, clip.id)
                        }
                        onPointerCancel={handleClipPointerCancel}
                        onKeyDown={(event) =>
                          handleClipKeyDown(event, clip.id, track.id)
                        }
                        className={cn(
                          "pointer-events-auto absolute top-2 bottom-2 touch-none cursor-normal overflow-hidden rounded-md border bg-primary/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isSelected
                            ? "border-primary ring-1 ring-primary"
                            : "border-primary/40",
                          isDragging &&
                            "z-30 cursor-normal border-primary opacity-90 shadow-lg shadow-black/40",
                          drag && !isDragging && "transition-[left] duration-100",
                        )}
                        style={{
                          left,
                          width: Math.max(clip.duration * pxPerSecond, 2),
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20" />

                        {/* Frames on top, the clip's own audio underneath. The
                         * strip is only for video tracks: it is that clip's
                         * soundtrack, not a separate audio clip. */}
                        <div
                          className="absolute inset-x-0 top-0 overflow-hidden"
                          style={{
                            height:
                              track.type === "video"
                                ? THUMBNAIL_HEIGHT
                                : undefined,
                            bottom: track.type === "video" ? undefined : 0,
                          }}
                        >
                          {track.type === "video" ? (
                            <ClipThumbnails
                              clip={clip}
                              pxPerSecond={pxPerSecond}
                              clipLeftPx={left}
                              viewportWidth={viewportWidth}
                              storyboard={storyboard}
                              poster={media.poster}
                              height={THUMBNAIL_HEIGHT}
                            />
                          ) : null}
                          {frameGrid ? (
                            <div
                              className="absolute inset-0"
                              style={{ backgroundImage: frameGrid }}
                              aria-hidden="true"
                            />
                          ) : null}

                          <div className="relative flex h-full min-w-0 items-start gap-1.5 px-2 pt-1.5">
                            <span className="inline-flex min-w-0 items-center gap-1 rounded-sm bg-black/55 px-1 py-0.5">
                              <Film
                                className="text-primary size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="truncate text-[11px] font-medium">
                                {clipLabel}
                              </span>
                            </span>
                            <span className="text-muted-foreground ml-auto shrink-0 rounded-sm bg-black/55 px-1 py-0.5 font-mono text-[10px]">
                              {formatTimecode(clip.duration)}
                            </span>
                          </div>
                        </div>

                        {track.type === "video" ? (
                          <div
                            className="absolute inset-x-0 bg-black/35"
                            style={{
                              bottom: WAVEFORM_HEIGHT,
                              height: WAVEFORM_GAP,
                            }}
                            aria-hidden="true"
                          />
                        ) : null}

                        {track.type === "video" ? (
                          <div
                            className="absolute inset-x-0 bottom-0 bg-black/35"
                            style={{ height: WAVEFORM_HEIGHT }}
                          >
                            <ClipWaveform
                              clip={clip}
                              levels={audioLevels}
                              pxPerSecond={pxPerSecond}
                              clipLeftPx={left}
                              viewportWidth={viewportWidth}
                              height={WAVEFORM_HEIGHT}
                              muted={track.muted}
                              gainDb={clipGainDb(clip)}
                            />
                            <GainLine
                              gainDb={clipGainDb(clip)}
                              onChange={(db) => onClipGainChange(clip.id, db)}
                              label="Clip loudness"
                              muted={track.muted}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                : null}

              {/* A track with no clips has no waveform to put the line on, so
               * the line spans the row and sets the whole track's loudness. */}
              {track.clips.length === 0 ? (
                <div className="pointer-events-none absolute inset-x-0 top-2 bottom-2">
                  <GainLine
                    gainDb={trackGainDb(track)}
                    onChange={(db) => onTrackChange(track.id, { gainDb: db })}
                    label="Track loudness"
                    muted={track.muted}
                    alwaysShowReadout
                  />
                </div>
              ) : null}
            </div>
          ))}

          {basePxPerSec !== null && frameBand ? (
            <div
              className="pointer-events-none absolute z-10 bg-white/10"
              style={{
                left: playheadX,
                width: pxPerFrame,
                top: RULER_HEIGHT,
                bottom: 0,
              }}
              aria-hidden="true"
            />
          ) : null}

          {basePxPerSec !== null ? (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-3 -translate-x-1/2"
              style={{ left: playheadX }}
              aria-hidden="true"
            >
              {/* One anchor, one transform: the line and the head share the
               * exact same centre, so subpixel rounding cannot make them drift
               * apart while the playhead moves during playback. */}
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white" />
              <div className="absolute top-0 left-0 h-3 w-3 rounded-b-sm bg-white" />
            </div>
          ) : null}
        </div>

        <TimelineScrollbar
          scrollX={scrollX}
          maxScroll={maxScroll}
          viewportWidth={viewportWidth}
          onScroll={scrollTo}
          onManual={markManual}
        />
      </div>
    </section>
  );
}
