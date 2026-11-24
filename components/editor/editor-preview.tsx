"use client";

import { Container } from "@videojs/react";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { usePlayer } from "@videojs/react/video";
import { EyeOff, Maximize, Minimize, Pause, Play } from "lucide-react";
import { useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FPS, formatTimecode } from "@/lib/timeline";
import type { ProjectMedia } from "@/lib/media";
import { cn } from "@/lib/utils";

type PreviewZoom = "25" | "50" | "69" | "100" | "fit";

const PREVIEW_ZOOMS: ReadonlyArray<{ value: PreviewZoom; label: string }> = [
  { value: "25", label: "25%" },
  { value: "50", label: "50%" },
  { value: "69", label: "69%" },
  { value: "100", label: "100%" },
  { value: "fit", label: "Fit" },
];

export interface EditorPreviewProps {
  media: ProjectMedia;
  /** The element the timeline reads and seeks, shared through this ref. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The video track's mute: applied to the media element itself. */
  muted: boolean;
  /** Set by the timeline's hide toggle: audio keeps playing, the picture does not. */
  hidden: boolean;
}

/**
 * The preview half of the editor.
 *
 * It shares one Video.js store with the timeline (the provider wraps the whole
 * editor), so `currentTime` here is the same value the playhead draws and
 * `seek()` from either side moves the other. There is no separate playback
 * state to drift out of sync.
 *
 * Mute is a `muted` prop on the media element rather than a store action: the
 * store throws `NO_TARGET` if an action runs before the media is attached, and
 * the track's mute has to be applied on the very first render. React sets the
 * DOM property, the element's `volumechange` reaches the store, and there is
 * only one source of truth in either direction.
 *
 * The zoom select lives in the panel header rather than the control bar because
 * Radix portals its menu to `document.body`; inside a fullscreen container that
 * portal would render outside the fullscreen surface and be invisible. The
 * in-player controls stay to play/pause, the timecode and fullscreen.
 */
export function EditorPreview({
  media,
  videoRef,
  muted,
  hidden,
}: EditorPreviewProps) {
  const store = usePlayer();
  const paused = usePlayer((state) => state.paused);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const isFullscreen = usePlayer((state) => state.isFullscreen);

  const [zoom, setZoom] = useState<PreviewZoom>("fit");

  const togglePlayback = () => {
    if (!paused) {
      store.pause();
      return;
    }

    /* Playing from the final frame would end immediately, so start over. */
    const atEnd = duration > 0 && currentTime >= duration - 1 / (FPS * 2);
    if (atEnd) {
      void store
        .seek(0)
        .then(() => store.play())
        .catch(() => undefined);
      return;
    }

    void store.play().catch(() => undefined);
  };

  const toggleFullscreen = () => {
    const action = isFullscreen
      ? store.exitFullscreen()
      : store.requestFullscreen();
    void action.catch(() => undefined);
  };

  return (
    <section
      aria-labelledby="preview-heading"
      className="flex min-h-0 min-w-0 flex-col"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <h2 id="preview-heading" className="text-xs font-medium">
          Preview
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Zoom
          </span>
          <Select
            value={zoom}
            onValueChange={(value) => setZoom(value as PreviewZoom)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Preview zoom"
              className="w-[4.75rem]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREVIEW_ZOOMS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Container
        aria-label="Video preview"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col bg-black",
          "[&:fullscreen]:h-dvh [&:fullscreen]:w-screen",
        )}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
          {hidden ? (
            <div className="text-muted-foreground absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black text-xs">
              <EyeOff className="size-5" aria-hidden="true" />
              Video hidden
            </div>
          ) : null}

          <div
            className="relative max-h-full"
            style={{
              width: zoom === "fit" ? "100%" : `${zoom}%`,
              aspectRatio: "16 / 9",
            }}
          >
            <HlsJsVideo
              ref={videoRef}
              src={media.playlist}
              poster={media.poster}
              muted={muted}
              playsInline
              crossOrigin="anonymous"
              preload="metadata"
              controls={false}
              className="h-full w-full bg-black object-contain"
            />
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center gap-2 border-t border-white/10 bg-black px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={togglePlayback}
            aria-label={paused ? "Play" : "Pause"}
            className="text-foreground hover:bg-white/10"
          >
            {paused ? (
              <Play className="fill-current" aria-hidden="true" />
            ) : (
              <Pause className="fill-current" aria-hidden="true" />
            )}
          </Button>

          <p className="text-foreground/80 font-mono text-xs tabular-nums">
            {formatTimecode(currentTime)}{" "}
            <span className="text-foreground/40">/</span>{" "}
            {formatTimecode(duration)}
          </p>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="text-foreground hover:bg-white/10 ml-auto"
          >
            {isFullscreen ? (
              <Minimize aria-hidden="true" />
            ) : (
              <Maximize aria-hidden="true" />
            )}
          </Button>
        </div>
      </Container>
    </section>
  );
}
