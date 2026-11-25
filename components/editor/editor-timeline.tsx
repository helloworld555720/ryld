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
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import { useTimeline } from "@/components/editor/use-timeline";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  clipAtTime,
  clipOffsetAt,
  videoClips,
  type ClipEditAction,
  type EditorTrack,
} from "@/lib/editor";
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
const TRACK_HEIGHT = 64;

export interface EditorTimelineProps {
  tracks: EditorTrack[];
  onTrackChange: (
    trackId: string,
    patch: Partial<Pick<EditorTrack, "muted" | "hidden">>,
  ) => void;
  /** Applies a clip edit at the given timeline time. */
  onClipEdit: (action: ClipEditAction, time: number) => void;
  clipLabel: string;
  /** The one `<video>` element both the preview and the timeline drive. */
  videoRef: RefObject<HTMLVideoElement | null>;
}

function TrackHeader({
  track,
  onChange,
  clipCount,
}: {
  track: EditorTrack;
  onChange: EditorTimelineProps["onTrackChange"];
  clipCount: number;
}) {
  const isVideo = track.type === "video";
  const TypeIcon = isVideo ? Film : Music;

  return (
    <div className="flex h-16 shrink-0 items-center gap-1.5 border-b px-2">
      <span className="bg-muted grid size-6 shrink-0 place-items-center rounded">
        <TypeIcon className="size-3.5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {isVideo ? "Video" : "Audio"}
        </p>
        <p className="text-muted-foreground text-[10px]">
          {clipCount} {clipCount === 1 ? "clip" : "clips"}
        </p>
      </div>

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
  onClipEdit,
  clipLabel,
  videoRef,
}: EditorTimelineProps) {
  const clips = useMemo(() => videoClips(tracks), [tracks]);
  const timeline = useTimeline(videoRef, clips);
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
    zoomTo,
    zoomIn,
    zoomOut,
    zoomToFrame,
    resetZoom,
    markManual,
  } = timeline;

  const currentClip = clipAtTime(clips, time);
  const offset = clipOffsetAt(clips, time);
  const atClipStart = offset === null || offset <= 1e-6;
  const atClipEnd =
    currentClip === null ||
    offset === null ||
    offset >= currentClip.duration - 1e-6;
  const canSplit = currentClip !== null && !atClipStart && !atClipEnd;
  const canDeleteLeft = currentClip !== null && !atClipStart;
  const canDeleteRight = currentClip !== null && !atClipEnd;
  const canDeleteClip = currentClip !== null;

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

        <p className="text-muted-foreground font-mono text-[11px] tabular-nums">
          {formatTimecode(time)}{" "}
          <span className="opacity-60">/ {formatTimecode(duration)}</span>
        </p>

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
            title="Delete clip"
            disabled={!canDeleteClip}
            onClick={() => onClipEdit("delete-clip", time)}
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

      <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col border-r">
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
              clipCount={track.clips.length}
            />
          ))}
        </div>

        <div
          ref={laneRef}
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
          className="relative min-w-0 flex-1 cursor-crosshair touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
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
              className="absolute inset-x-0 border-b bg-white/[0.015]"
              style={{
                top: RULER_HEIGHT + index * TRACK_HEIGHT,
                height: TRACK_HEIGHT,
              }}
            >
              {basePxPerSec !== null
                ? track.clips.map((clip) => (
                    <div
                      key={clip.id}
                      className="pointer-events-none absolute top-2 bottom-2 overflow-hidden rounded-md border border-primary/40 bg-primary/10"
                      style={{
                        left: timeToX(clip.start, viewport, basePxPerSec),
                        width: Math.max(clip.duration * pxPerSecond, 2),
                      }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20" />
                      {frameGrid ? (
                        <div
                          className="absolute inset-0"
                          style={{ backgroundImage: frameGrid }}
                          aria-hidden="true"
                        />
                      ) : null}

                      <div className="relative flex h-full items-center gap-1.5 px-2">
                        <Film
                          className="text-primary size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate text-[11px] font-medium">
                          {clipLabel}
                        </span>
                        <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[10px]">
                          {formatTimecode(clip.duration)}
                        </span>
                      </div>
                    </div>
                  ))
                : null}
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
      </div>
    </section>
  );
}
