"use client";

import { usePlayer } from "@videojs/react/video";
import {
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  Music,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  EDITOR_ZOOM,
  clampTime,
  formatRulerLabel,
  formatTimecode,
  pixelsToTime,
  tickStep,
  timeToPixels,
  timelineDuration,
  type EditorTrack,
} from "@/lib/editor";
import { cn } from "@/lib/utils";

/** A little runway past the last clip, so the timeline does not end at a wall. */
const TAIL_PX = 240;

export interface EditorTimelineProps {
  tracks: EditorTrack[];
  onTrackChange: (
    trackId: string,
    patch: Partial<Pick<EditorTrack, "muted" | "hidden">>,
  ) => void;
  clipLabel: string;
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
 * Time is the only thing stored: clips are positioned with
 * `timeToPixels(start, pxPerSecond)`, so zooming changes the ruler and clip
 * widths without touching the model. The playhead is derived from the player's
 * `currentTime` (with a local override while scrubbing), which is why playing
 * moves it and dragging it seeks the preview — there is no second clock.
 */
export function EditorTimeline({
  tracks,
  onTrackChange,
  clipLabel,
}: EditorTimelineProps) {
  const store = usePlayer();
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);

  const [pxPerSecond, setPxPerSecond] = useState<number>(EDITOR_ZOOM.initial);
  const [scrub, setScrub] = useState<number | null>(null);

  const laneRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const mediaDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const timelineEnd = Math.max(mediaDuration, timelineDuration(tracks));
  const playhead = scrub ?? currentTime;

  const step = tickStep(pxPerSecond);
  const tickCount = Math.min(Math.ceil(timelineEnd / step) + 1, 2000);
  const ticks = Array.from({ length: tickCount }, (_, index) => index * step);
  const contentWidth = timeToPixels(timelineEnd, pxPerSecond) + TAIL_PX;

  const seekToClientX = (clientX: number) => {
    const lane = laneRef.current;
    if (!lane) return;

    const rect = lane.getBoundingClientRect();
    const time = clampTime(
      pixelsToTime(clientX - rect.left, pxPerSecond),
      timelineEnd,
    );

    scrubRef.current = time;
    setScrub(time);
    void store.seek(time).catch(() => undefined);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    seekToClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(event.clientX);
  };

  const finishScrub = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;

    const time = scrubRef.current;
    scrubRef.current = null;

    if (time === null) {
      setScrub(null);
      return;
    }

    // Wait for the seek the store ends on before giving the line back, so the
    // playhead does not jump backwards for a frame on release.
    void store
      .seek(time)
      .catch(() => undefined)
      .finally(() => setScrub(null));
  };

  const handlePlayheadKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const nudge = event.shiftKey ? 5 : 1;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void store
        .seek(clampTime(playhead - nudge, timelineEnd))
        .catch(() => undefined);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      void store
        .seek(clampTime(playhead + nudge, timelineEnd))
        .catch(() => undefined);
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const time = event.key === "Home" ? 0 : timelineEnd;
      void store.seek(time).catch(() => undefined);
    }
  };

  const changeZoom = (next: number) => {
    setPxPerSecond(
      Math.min(EDITOR_ZOOM.max, Math.max(EDITOR_ZOOM.min, next)),
    );
  };

  /*
   * `min-w-0` on the section below is load-bearing. The section is a grid item
   * in the editor's single-column grid, and the lane inside it is as wide as
   * the clip at the current zoom (a 4-minute clip is ~15 000px). Without it the
   * grid sizes that column to the lane's min-content, stretching the editor far
   * past the viewport: the inspector is pushed off-screen and the preview
   * becomes so wide that `object-contain` centres the picture outside the
   * window (black picture, audio only). The lane scrolls on its own.
   */
  return (
    <section
      aria-labelledby="timeline-heading"
      className="flex min-h-0 min-w-0 flex-col border-t bg-card/40"
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        <h2
          id="timeline-heading"
          className="flex items-center gap-1.5 text-xs font-medium"
        >
          <Clapperboard className="size-3.5" aria-hidden="true" />
          Timeline
        </h2>
        <p className="text-muted-foreground text-[11px]">
          {tracks.length} {tracks.length === 1 ? "track" : "tracks"} ·{" "}
          {formatTimecode(timelineEnd)}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Zoom
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out timeline"
            onClick={() => changeZoom(pxPerSecond - EDITOR_ZOOM.step)}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <Slider
            aria-label="Timeline zoom"
            value={[pxPerSecond]}
            min={EDITOR_ZOOM.min}
            max={EDITOR_ZOOM.max}
            step={EDITOR_ZOOM.step}
            onValueChange={(value) => changeZoom(value[0] ?? pxPerSecond)}
            className="w-28"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in timeline"
            onClick={() => changeZoom(pxPerSecond + EDITOR_ZOOM.step)}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col border-r">
          <div className="h-8 shrink-0 border-b" aria-hidden="true" />
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onChange={onTrackChange}
              clipCount={track.clips.length}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div
            ref={laneRef}
            className="relative min-w-full touch-none select-none"
            style={{ width: contentWidth }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishScrub}
            onPointerCancel={finishScrub}
          >
            <div
              className="relative h-8 border-b"
              aria-hidden="true"
            >
              {ticks.map((tick) => (
                <div
                  key={tick}
                  className="absolute inset-y-0"
                  style={{ left: timeToPixels(tick, pxPerSecond) }}
                >
                  <span className="bg-border absolute top-0 left-0 h-2 w-px" />
                  <span className="text-muted-foreground absolute top-2.5 left-1 font-mono text-[10px] whitespace-nowrap">
                    {formatRulerLabel(tick)}
                  </span>
                </div>
              ))}
            </div>

            {tracks.map((track) => (
              <div
                key={track.id}
                className="relative h-16 border-b bg-white/[0.015]"
              >
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className="pointer-events-none absolute top-2 bottom-2 overflow-hidden rounded-md border border-primary/40 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20"
                    style={{
                      left: timeToPixels(clip.start, pxPerSecond),
                      width: Math.max(
                        timeToPixels(clip.duration, pxPerSecond),
                        2,
                      ),
                    }}
                  >
                    <div className="flex h-full items-center gap-1.5 px-2">
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
                ))}
              </div>
            ))}

            <div
              className="pointer-events-none absolute inset-y-0 z-20"
              style={{ left: timeToPixels(playhead, pxPerSecond) }}
            >
              <div className="bg-primary h-full w-px" />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={Math.round(timelineEnd)}
                aria-valuenow={Math.round(playhead)}
                aria-valuetext={formatTimecode(playhead)}
                onKeyDown={handlePlayheadKeys}
                className="bg-primary focus-visible:ring-ring pointer-events-auto absolute top-0 -left-1.5 h-4 w-3 rounded-b-sm focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
