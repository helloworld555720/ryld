/**
 * Clip thumbnails — pure, client-safe, unit-tested.
 *
 * A processed project's `source.thumbnails` is a WebVTT storyboard: one cue per
 * frame, each pointing at an image (often a sprite sheet) with an optional
 * `#xywh=` crop. This module turns that file into cues and decides which cue a
 * clip tile shows.
 *
 * The pattern is anchored to **source time**, not to a clip's position on the
 * timeline. A tile grid is laid over the source at `tileWidth / pxPerSecond`
 * seconds per tile, so splitting a clip in two leaves both halves showing the
 * same frames at the same source offsets, and reordering moves a clip together
 * with its frames. Only zooming changes the sampling interval, because the grid
 * is measured in screen pixels.
 */

import type { EditorClip } from "@/lib/editor";

/** One storyboard cue: when to show it and where its pixels live. */
export interface StoryboardCue {
  /** Cue start, in source seconds. */
  start: number;
  /** Cue end, in source seconds. */
  end: number;
  /** Absolute image URL, without the `#xywh` fragment. */
  url: string;
  /** Crop rectangle inside a sprite sheet, in image pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** False when the cue points at a whole image rather than a sprite crop. */
  hasCrop: boolean;
}

/** One crop from a storyboard, positioned inside its clip. */
export interface ThumbnailTile {
  /** Stable index in the source-time grid; unique within one clip. */
  key: number;
  /** Left edge in pixels, relative to the clip's own left edge. */
  left: number;
  /** The source time this tile represents. */
  sourceTime: number;
}

/** A tile is about one video frame's width at the default rail height. */
export const THUMBNAIL_TILE_WIDTH = 96;

/**
 * Upper bound on tiles for one clip. A viewport renders roughly
 * `viewportWidth / THUMBNAIL_TILE_WIDTH` tiles, so this only catches a caller
 * passing a pathologically small tile width.
 */
const MAX_TILES_PER_CLIP = 512;

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * `hh:mm:ss.ttt`, `mm:ss.ttt` or `ss.ttt`. Returns `null` for anything else.
 * Storyboards always carry milliseconds, but the tolerant form costs nothing
 * and keeps a hand-written fixture readable.
 */
function parseVttTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) return null;

  const [first, second, third] = parts.map(Number);
  const seconds =
    parts.length === 3 ? first * 3600 + second * 60 + third : first * 60 + second;

  return Number.isFinite(seconds) ? seconds : null;
}

/** Only a URL-shaped payload is a storyboard image, never caption text. */
function looksLikeImage(value: string): boolean {
  const url = value.split("#")[0];
  return (
    /^https?:\/\//i.test(url) ||
    /^data:image\//i.test(url) ||
    url.startsWith("/") ||
    url.startsWith("./") ||
    url.startsWith("../") ||
    /\.(?:jpe?g|png|webp|avif|gif)$/i.test(url)
  );
}

/**
 * Parses a WebVTT storyboard into cues sorted by start time.
 *
 * `baseUrl` resolves relative sprite references (most storyboards in this app
 * use a relative key, so passing the VTT's own URL is the normal case). A cue
 * whose payload is missing or not image-shaped is dropped rather than guessed
 * at, which keeps a captions track from being rendered as thumbnails.
 */
export function parseStoryboardVtt(
  text: string,
  baseUrl?: string,
): StoryboardCue[] {
  if (typeof text !== "string" || text.trim() === "") return [];

  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  const cues: StoryboardCue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const timing = /^(\S+)\s*-->\s*(\S+)/.exec(lines[index].trim());
    if (!timing) continue;

    const start = parseVttTime(timing[1]);
    const end = parseVttTime(timing[2]);
    if (start === null || end === null || end <= start) continue;

    let payload = "";
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (candidate === "") break;
      if (candidate.includes("-->")) break;
      payload = candidate;
      index = next;
      break;
    }

    if (!looksLikeImage(payload)) continue;

    const [address, fragment = ""] = payload.split("#", 2);
    let url = address;
    if (baseUrl) {
      try {
        url = new URL(address, baseUrl).href;
      } catch {
        url = address;
      }
    }

    const crop = /^xywh=(\d+),(\d+),(\d+),(\d+)$/i.exec(fragment);
    cues.push({
      start,
      end,
      url,
      x: crop ? Number(crop[1]) : 0,
      y: crop ? Number(crop[2]) : 0,
      width: crop ? Number(crop[3]) : 0,
      height: crop ? Number(crop[4]) : 0,
      hasCrop: crop !== null && Number(crop[3]) > 0 && Number(crop[4]) > 0,
    });
  }

  return cues.sort((left, right) => left.start - right.start);
}

/**
 * The cue covering a source time.
 *
 * Before the first cue or after the last one the nearest edge cue is returned,
 * so a clip that starts half a cue early still shows a frame instead of a hole.
 * Inside the storyboard the lookup is the first cue whose half-open interval
 * contains the time.
 */
export function storyboardCueAt(
  cues: readonly StoryboardCue[],
  time: number,
): StoryboardCue | null {
  if (cues.length === 0 || !Number.isFinite(time)) return null;

  let low = 0;
  let high = cues.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (found < 0) return cues[0];

  const cue = cues[found];
  if (time < cue.end) return cue;

  return cues[found + 1] ?? cue;
}

export interface ThumbnailTileInput {
  clip: Pick<EditorClip, "duration" | "sourceOffset">;
  /** Pixels per source second at the current zoom. */
  pxPerSecond: number;
  /** The clip's left edge in lane pixels, after scrolling. */
  clipLeftPx: number;
  /** The measured timeline width, so off-screen tiles are not rendered. */
  viewportWidth: number;
  tileWidth?: number;
}

/**
 * The tiles visible for one clip, ordered left to right.
 *
 * The grid is anchored at source time zero, so the same source second always
 * falls in the same tile regardless of how the timeline was cut or reordered.
 * `left` is relative to the clip, and the first/last tile may extend past either
 * edge: the clip's `overflow-hidden` crops them, which is what makes a split at
 * an arbitrary time continuous on both sides.
 */
export function thumbnailTiles(input: ThumbnailTileInput): ThumbnailTile[] {
  const { clip, pxPerSecond, clipLeftPx, viewportWidth } = input;
  const tileWidth =
    input.tileWidth !== undefined && isPositive(input.tileWidth)
      ? input.tileWidth
      : THUMBNAIL_TILE_WIDTH;

  if (
    !isPositive(pxPerSecond) ||
    !isPositive(clip.duration) ||
    !isPositive(viewportWidth)
  ) {
    return [];
  }

  const step = tileWidth / pxPerSecond;
  if (!isPositive(step)) return [];

  const clipWidth = clip.duration * pxPerSecond;
  const visibleStart = Math.max(0, -clipLeftPx);
  const visibleEnd = Math.min(clipWidth, viewportWidth - clipLeftPx);
  if (visibleEnd <= visibleStart) return [];

  const visibleSourceStart = clip.sourceOffset + visibleStart / pxPerSecond;
  const visibleSourceEnd = clip.sourceOffset + visibleEnd / pxPerSecond;
  const sourceEnd = clip.sourceOffset + clip.duration;

  const firstIndex = Math.floor(visibleSourceStart / step) - 1;
  const lastIndex = Math.floor(visibleSourceEnd / step) + 1;

  const tiles: ThumbnailTile[] = [];

  for (
    let index = firstIndex;
    index <= lastIndex && tiles.length < MAX_TILES_PER_CLIP;
    index += 1
  ) {
    const left = (index * step - clip.sourceOffset) * pxPerSecond;
    if (left + tileWidth <= visibleStart || left >= visibleEnd) continue;

    const sampled = Math.min(
      sourceEnd,
      Math.max(clip.sourceOffset, (index + 0.5) * step),
    );

    tiles.push({ key: index, left, sourceTime: sampled });
  }

  return tiles;
}
