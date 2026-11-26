"use client";

import { useEffect, useState } from "react";

import type { EditorClip } from "@/lib/editor";
import {
  THUMBNAIL_TILE_WIDTH,
  parseStoryboardVtt,
  storyboardCueAt,
  thumbnailTiles,
  type StoryboardCue,
} from "@/lib/thumbnails";

interface StoryboardState {
  /** The URL the cues belong to, so a new project never shows old frames. */
  url: string | undefined;
  cues: StoryboardCue[];
}

/**
 * Loads and parses a project's WebVTT storyboard once.
 *
 * The fetch is best-effort: a media host without CORS headers, a missing file
 * or a slow response leaves the cues empty, and the clips simply fall back to
 * the poster. Nothing about the editor depends on it succeeding.
 */
export function useStoryboard(
  url: string | undefined,
): readonly StoryboardCue[] {
  const [state, setState] = useState<StoryboardState>({
    url: undefined,
    cues: [],
  });

  useEffect(() => {
    if (!url) return;

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "omit",
          cache: "force-cache",
        });
        if (!response.ok) return;

        const text = await response.text();
        if (!active) return;

        setState({ url, cues: parseStoryboardVtt(text, url) });
      } catch {
        /* Best-effort: the poster remains the fallback. */
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [url]);

  return state.url === url ? state.cues : [];
}

function SpriteFrame({
  cue,
  width,
  height,
}: {
  cue: StoryboardCue;
  width: number;
  height: number;
}) {
  /* `background-size: auto` keeps the sprite at natural pixels, so the
   * `#xywh` crop is exact; the element is then scaled to cover the tile. The
   * transform is centred so a mismatched aspect crops instead of stretching. */
  const scale = Math.max(width / cue.width, height / cue.height);

  return (
    <span
      className="absolute top-1/2 left-1/2"
      style={{
        width: cue.width,
        height: cue.height,
        backgroundImage: `url("${cue.url}")`,
        backgroundPosition: `-${cue.x}px -${cue.y}px`,
        backgroundRepeat: "no-repeat",
        backgroundSize: "auto",
        transform: `translate(-50%, -50%) scale(${scale})`,
      }}
    />
  );
}

export interface ClipThumbnailsProps {
  clip: EditorClip;
  pxPerSecond: number;
  /** The clip's left edge in lane pixels, after scrolling. */
  clipLeftPx: number;
  viewportWidth: number;
  storyboard: readonly StoryboardCue[];
  poster?: string;
  /** Pixels from the clip's top to its bottom, used to cover sprite crops. */
  height: number;
}

/**
 * Repeated filmstrip for one clip.
 *
 * Only tiles that intersect the viewport are rendered, so a four-minute clip at
 * frame zoom does not create thousands of DOM nodes. A tile shows the storyboard
 * cue for its source time, or the poster when the storyboard is unavailable.
 */
export function ClipThumbnails({
  clip,
  pxPerSecond,
  clipLeftPx,
  viewportWidth,
  storyboard,
  poster,
  height,
}: ClipThumbnailsProps) {
  const tiles = thumbnailTiles({
    clip,
    pxPerSecond,
    clipLeftPx,
    viewportWidth,
  });

  if (tiles.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {tiles.map((tile) => {
        const cue =
          storyboard.length > 0
            ? storyboardCueAt(storyboard, tile.sourceTime)
            : null;

        return (
          <div
            key={tile.key}
            className="absolute top-0 bottom-0 overflow-hidden"
            style={{ left: tile.left, width: THUMBNAIL_TILE_WIDTH }}
          >
            {cue ? (
              cue.hasCrop ? (
                <SpriteFrame
                  cue={cue}
                  width={THUMBNAIL_TILE_WIDTH}
                  height={height}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cue.url}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 size-full object-cover"
                />
              )
            ) : poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={poster}
                alt=""
                draggable={false}
                className="absolute inset-0 size-full object-cover"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
