"use client";

import { VideoPlayer, usePlayer } from "@videojs/react/video";
import {
  ArrowLeft,
  FolderOpen,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { EditorPreview } from "@/components/editor/editor-preview";
import { EditorTimeline } from "@/components/editor/editor-timeline";
import { Button } from "@/components/ui/button";
import {
  createInitialTracks,
  deleteClipById,
  deleteLeftAt,
  deleteRightAt,
  moveClip,
  setClipGain,
  splitClip,
  updateVideoClips,
  videoHidden,
  videoMuted,
  withMediaDuration,
  type ClipEditAction,
  type EditorTrack,
} from "@/lib/editor";
import type { ProjectMedia } from "@/lib/media";

export interface VideoEditorProps {
  projectId: string;
  title: string;
  media: ProjectMedia;
}

/**
 * Placeholder panel shell for the two regions that come later. Kept deliberately
 * empty: the point is the layout, not an inventory of imagined features.
 */
function PlaceholderPanel({
  id,
  heading,
  icon: Icon,
  description,
  side,
}: {
  id: string;
  heading: string;
  icon: LucideIcon;
  description: string;
  side: "left" | "right";
}) {
  return (
    <section
      aria-labelledby={id}
      className={
        side === "left"
          ? "flex min-h-0 flex-col border-r"
          : "flex min-h-0 flex-col border-l"
      }
    >
      <header className="flex h-9 shrink-0 items-center border-b px-3">
        <h2 id={id} className="text-xs font-medium">
          {heading}
        </h2>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon
          className="text-muted-foreground/40 size-6"
          aria-hidden="true"
        />
        <p className="text-muted-foreground max-w-[13rem] text-xs">
          {description}
        </p>
      </div>
    </section>
  );
}

/**
 * Editor page chrome and state.
 *
 * `VideoPlayer` renders no DOM: it is only the store that the preview and the
 * timeline share. That is what keeps the playhead and playback in lockstep —
 * both read `currentTime` from here and both call `seek()` on it.
 *
 * The timeline model is the single source of truth for what the editor holds;
 * mute and visibility are track fields, so a future audio track inherits the
 * same controls without a second state path.
 */
export function VideoEditor({ projectId, title, media }: VideoEditorProps) {
  return (
    <VideoPlayer title={title} poster={media.poster ?? null}>
      <EditorBody projectId={projectId} title={title} media={media} />
    </VideoPlayer>
  );
}

/**
 * The right half of a split needs an id that is unique at interaction time.
 * This never runs during render, so it cannot cause a hydration mismatch.
 */
function newClipId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function EditorBody({ projectId, title, media }: VideoEditorProps) {
  const duration = usePlayer((state) => state.duration);

  /*
   * The `<video>` element the preview renders is also what the timeline drives.
   * One element, one clock: the preview does not own playback state and the
   * timeline does not own a second copy of the media.
   */
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [tracks, setTracks] = useState<EditorTrack[]>(createInitialTracks);

  /*
   * The clip starts with no duration because metadata is the first thing that
   * knows how long the video is. Deriving it during render (rather than writing
   * it back in an effect) keeps state and display consistent without a
   * cascading update, and a trim or split still wins: only zero-length clips
   * are filled in.
   */
  const timelineTracks = useMemo(
    () => withMediaDuration(tracks, duration),
    [tracks, duration],
  );

  const muted = videoMuted(timelineTracks);
  const hidden = videoHidden(timelineTracks);

  const changeTrack = (
    trackId: string,
    patch: Partial<Pick<EditorTrack, "muted" | "hidden" | "gainDb">>,
  ) => {
    setTracks((current) =>
      current.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    );
  };

  /*
   * Edits run against the filled model, so the first split always has a real
   * duration to cut. `withMediaDuration` is idempotent afterwards. The model
   * functions return new arrays and re-flow the survivors themselves; this
   * handler only chooses the operation.
   */
  const editClips = (action: ClipEditAction, at: number) => {
    const rightId = action === "split" ? newClipId() : null;

    setTracks((current) => {
      const filled = withMediaDuration(current, duration);

      switch (action) {
        case "split":
          return updateVideoClips(filled, (next) =>
            splitClip(next, at, () => rightId ?? newClipId()),
          );
        case "delete-left":
          return updateVideoClips(filled, (next) => deleteLeftAt(next, at));
        case "delete-right":
          return updateVideoClips(filled, (next) => deleteRightAt(next, at));
        default:
          return filled;
      }
    });
  };

  const deleteClip = (clipId: string) => {
    setTracks((current) =>
      updateVideoClips(
        withMediaDuration(current, duration),
        (next) => deleteClipById(next, clipId),
      ),
    );
  };

  const changeClipGain = (clipId: string, gainDb: number) => {
    setTracks((current) =>
      setClipGain(withMediaDuration(current, duration), clipId, gainDb),
    );
  };

  const reorderClip = (clipId: string, slot: number) => {
    setTracks((current) =>
      updateVideoClips(
        withMediaDuration(current, duration),
        (next) => moveClip(next, clipId, slot),
      ),
    );
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="bg-card/60 flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`/projects/${projectId}`} aria-label="Back to project">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>

        <div className="min-w-0">
          <p className="text-muted-foreground text-[10px] font-medium tracking-[0.14em] uppercase">
            Editor
          </p>
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </div>

        <p className="text-muted-foreground ml-auto hidden text-xs md:block">
          Visual editing preview — nothing is rendered or exported
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(14rem,36%)]">
        <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)_18rem]">
          <PlaceholderPanel
            id="assets-heading"
            heading="Assets"
            icon={FolderOpen}
            description="Your media library will live here. There is nothing to import yet."
            side="left"
          />

          <EditorPreview
            media={media}
            videoRef={videoRef}
            muted={muted}
            hidden={hidden}
          />

          <PlaceholderPanel
            id="inspector-heading"
            heading="Inspector"
            icon={SlidersHorizontal}
            description="Clip properties, effects and transitions will live here."
            side="right"
          />
        </div>

        <EditorTimeline
          tracks={timelineTracks}
          onTrackChange={changeTrack}
          onClipGainChange={changeClipGain}
          onClipEdit={editClips}
          onDeleteClip={deleteClip}
          onMoveClip={reorderClip}
          clipLabel={title}
          media={media}
          videoRef={videoRef}
        />
      </div>
    </div>
  );
}
