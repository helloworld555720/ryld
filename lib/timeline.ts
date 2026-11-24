/**
 * Timeline viewport math — pure, client-safe, unit-tested.
 *
 * Three things are deliberately kept apart:
 *
 * - **Data** (`lib/editor.ts`): tracks and clips in seconds. No pixels.
 * - **Viewport** (`TimelineViewport`): `{ level, scrollX }`, plus the measured
 *   viewport width and a `basePxPerSec` computed once from the video's duration.
 * - **Conversion** (this module): everything else derives from those.
 *
 * `level` is a float where 0 means "the clip fills a third of the viewport" and
 * every +1 doubles the scale. The top stop is not a doubling but a fixed
 * `FRAME_PX` per frame, because at frame zoom the useful unit is the frame.
 *
 * The zoom rule is the one that matters: the playhead keeps its screen x while
 * the content scales around it, and the resulting scroll is clamped afterwards.
 * The clamp is what makes the edge cases right without special handling —
 * playhead at 0 stays put, playhead at the end is pushed back from the right
 * edge leaving the end margin, and content shorter than the viewport grows from
 * the left edge because there is nothing to scroll.
 */

export type TimelineViewport = {
  level: number;
  scrollX: number;
};

/** HLS does not expose the frame rate, so one constant stands in for it. */
export const FPS = 30;

/** Empty space before time 0, in pixels. */
export const PAD = 48;

/** Fraction of the viewport left empty after the content's end. */
export const END_MARGIN = 0.26;

/** Pixels per frame at the frame-level stop. */
export const FRAME_PX = 200;

/** A ruler label needs this much room, so labels never collide. */
export const RULER_LABEL_SPACING = 90;

/** The clip grid draws frame boundaries once a frame is at least this wide. */
export const FRAME_GRID_MIN_PX = 8;

/** The one-frame band next to the playhead appears from this frame width up. */
export const FRAME_BAND_MIN_PX = 40;

/** How far a wheel or drag keeps auto-scroll suspended, in milliseconds. */
export const MANUAL_PAN_MS = 1200;

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The scale at level 0: the clip fills one third of the viewport.
 *
 * Computed once when the duration becomes known (and again only on an explicit
 * reset). Recomputing it on every resize would silently rescale the timeline.
 */
export function basePxPerSecFor(
  viewportWidth: number,
  duration: number,
): number {
  if (!isPositive(viewportWidth) || !isPositive(duration)) return 0;
  return viewportWidth / 3 / duration;
}

/** Pixels per second at a zoom level. Each +1 doubles the scale. */
export function pxPerSecAt(level: number, basePxPerSec: number): number {
  if (!isPositive(basePxPerSec)) return 0;
  return basePxPerSec * 2 ** level;
}

/** Pixels per frame at a zoom level. */
export function pxPerFrameAt(level: number, basePxPerSec: number): number {
  return pxPerSecAt(level, basePxPerSec) / FPS;
}

/**
 * The frame-level stop. Always at least 1 so there is one doubling available
 * even for a clip short enough that level 0 is already near frame scale.
 */
export function maxLevelFor(basePxPerSec: number): number {
  if (!isPositive(basePxPerSec)) return 0;
  return Math.max(1, Math.log2((FRAME_PX * FPS) / basePxPerSec));
}

export function clampLevel(level: number, maxLevel: number): number {
  const upper = isPositive(maxLevel) ? maxLevel : 0;
  if (!Number.isFinite(level)) return 0;
  return Math.min(upper, Math.max(0, level));
}

/** The next whole level above `level`, as the + button steps it. */
export function nextZoomLevel(level: number, maxLevel: number): number {
  return clampLevel(Math.floor(level + 1e-6) + 1, maxLevel);
}

/** The previous whole level below `level`, as the − button steps it. */
export function previousZoomLevel(level: number, maxLevel: number): number {
  return clampLevel(Math.ceil(level - 1e-6) - 1, maxLevel);
}

/** Screen x for a time: `PAD + t * pxPerSec - scrollX`. */
export function timeToX(
  time: number,
  viewport: TimelineViewport,
  basePxPerSec: number,
): number {
  return (
    PAD + time * pxPerSecAt(viewport.level, basePxPerSec) - viewport.scrollX
  );
}

/** Inverse of `timeToX`. */
export function xToTime(
  x: number,
  viewport: TimelineViewport,
  basePxPerSec: number,
): number {
  const pxPerSecond = pxPerSecAt(viewport.level, basePxPerSec);
  if (!isPositive(pxPerSecond)) return 0;
  return (x - PAD + viewport.scrollX) / pxPerSecond;
}

/** How far the timeline may scroll: never negative, never past the margin. */
export function maxScrollFor(
  duration: number,
  level: number,
  basePxPerSec: number,
  viewportWidth: number,
): number {
  const pxPerSecond = pxPerSecAt(level, basePxPerSec);
  if (!isPositive(pxPerSecond) || !isPositive(viewportWidth)) return 0;
  return Math.max(
    0,
    duration * pxPerSecond + PAD + END_MARGIN * viewportWidth - viewportWidth,
  );
}

export function clampScroll(scrollX: number, maxScroll: number): number {
  const upper = isPositive(maxScroll) ? maxScroll : 0;
  if (!Number.isFinite(scrollX)) return 0;
  return Math.min(upper, Math.max(0, scrollX));
}

export interface ZoomInput {
  /** Playhead time, which keeps its screen x. */
  time: number;
  viewport: TimelineViewport;
  basePxPerSec: number;
  duration: number;
  viewportWidth: number;
  nextLevel: number;
}

/**
 * Zoom anchored on the playhead, then clamped.
 *
 * `playheadX` is read *before* the level changes, and the scroll that would keep
 * it there is clamped to the new scale's range. Nothing else is special-cased:
 * that single clamp handles the start, the end margin and content that fits.
 */
export function zoomedViewport(input: ZoomInput): TimelineViewport {
  const { time, viewport, basePxPerSec, duration, viewportWidth } = input;
  if (!isPositive(basePxPerSec)) return viewport;

  const level = clampLevel(input.nextLevel, maxLevelFor(basePxPerSec));
  const playheadX = timeToX(time, viewport, basePxPerSec);
  const pxPerSecond = pxPerSecAt(level, basePxPerSec);
  const wanted = PAD + time * pxPerSecond - playheadX;
  const maxScroll = maxScrollFor(duration, level, basePxPerSec, viewportWidth);

  return { level, scrollX: clampScroll(wanted, maxScroll) };
}

/**
 * Time snapped to the frame grid and kept inside `[0, duration]`.
 *
 * The playhead line sits on the left edge of the current frame, so a snapped
 * time is the only time the UI ever shows or seeks.
 */
export function snapTime(
  time: number,
  duration: number,
  fps: number = FPS,
): number {
  if (!Number.isFinite(time) || !isPositive(duration)) return 0;
  const safeFps = isPositive(fps) ? fps : FPS;
  return Math.min(duration, Math.max(0, Math.round(time * safeFps) / safeFps));
}

/** The last frame that starts at or before the end: where playback stops. */
export function lastFrame(duration: number, fps: number = FPS): number {
  if (!isPositive(duration)) return 0;
  const safeFps = isPositive(fps) ? fps : FPS;
  return Math.min(duration, Math.floor(duration * safeFps) / safeFps);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** `HH:MM:SS:FF` for a time in seconds. Negative and NaN render as zero. */
export function formatTimecode(seconds: number, fps: number = FPS): string {
  const safeFps = isPositive(fps) ? Math.round(fps) : FPS;
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  const totalFrames = Math.round(safeSeconds * safeFps);
  const frames = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}:${pad2(frames)}`;
}

/**
 * Ruler labels: `mm:ss` on a whole second, otherwise the frame within that
 * second (`15f`), which is what makes frame-scale labels readable.
 */
export function formatRulerLabel(seconds: number, fps: number = FPS): string {
  const safeFps = isPositive(fps) ? Math.round(fps) : FPS;
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  const totalFrames = Math.round(safeSeconds * safeFps);
  const frame = totalFrames % safeFps;
  if (frame !== 0) return `${frame}f`;

  const totalSeconds = Math.floor(totalFrames / safeFps);
  const minutes = Math.floor(totalSeconds / 60);
  return `${pad2(minutes)}:${pad2(totalSeconds % 60)}`;
}

/** Frame intervals first, then seconds. */
const FRAME_STEPS = [1, 2, 5, 10, 15] as const;
const FRAME_SUBDIVISIONS: Record<number, number> = {
  1: 1,
  2: 2,
  5: 5,
  10: 5,
  15: 3,
};
const SECOND_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600,
] as const;

export interface RulerStep {
  /** Label interval, in seconds. */
  step: number;
  /** Minor ticks drawn between two labels. */
  subdivisions: number;
}

/**
 * The first "nice" interval whose labels are at least `RULER_LABEL_SPACING`
 * apart at this scale. Chosen from pixels, never from the zoom level, so the
 * ruler adapts to the actual scale rather than to how it got there.
 */
export function rulerStep(pxPerSecond: number): RulerStep {
  if (isPositive(pxPerSecond)) {
    for (const frames of FRAME_STEPS) {
      const step = frames / FPS;
      if (step * pxPerSecond >= RULER_LABEL_SPACING) {
        return { step, subdivisions: FRAME_SUBDIVISIONS[frames] };
      }
    }

    for (const seconds of SECOND_STEPS) {
      if (seconds * pxPerSecond >= RULER_LABEL_SPACING) {
        return { step: seconds, subdivisions: 5 };
      }
    }
  }

  return { step: SECOND_STEPS[SECOND_STEPS.length - 1], subdivisions: 5 };
}

export interface TimelineTick {
  time: number;
  x: number;
}

export interface RulerTicks {
  labels: Array<TimelineTick & { label: string }>;
  minors: TimelineTick[];
}

/**
 * Only the ticks the viewport can see, so frame zoom never renders the whole
 * clip's worth of lines. The label spacing guarantee bounds the count.
 */
export function visibleTicks(input: {
  viewport: TimelineViewport;
  basePxPerSec: number;
  viewportWidth: number;
}): RulerTicks {
  const { viewport, basePxPerSec, viewportWidth } = input;
  const pxPerSecond = pxPerSecAt(viewport.level, basePxPerSec);

  if (!isPositive(pxPerSecond) || !isPositive(viewportWidth)) {
    return { labels: [], minors: [] };
  }

  const { step, subdivisions } = rulerStep(pxPerSecond);
  const minorStep = step / subdivisions;

  const firstTime = (viewport.scrollX - PAD) / pxPerSecond;
  const lastTime = (viewport.scrollX - PAD + viewportWidth) / pxPerSecond;
  const firstIndex = Math.max(0, Math.ceil(firstTime / minorStep));
  const lastIndex = Math.floor(lastTime / minorStep);

  const labels: RulerTicks["labels"] = [];
  const minors: TimelineTick[] = [];
  const limit = 4000;

  for (
    let index = firstIndex;
    index <= lastIndex && labels.length + minors.length < limit;
    index += 1
  ) {
    const time = index * minorStep;
    const x = timeToX(time, viewport, basePxPerSec);

    if (index % subdivisions === 0) {
      labels.push({ time, x, label: formatRulerLabel(time) });
    } else {
      minors.push({ time, x });
    }
  }

  return { labels, minors };
}
