/**
 * Clip waveform — pure, client-safe, unit-tested.
 *
 * A processed project ships a `levels.json` beside its playlist: one peak value
 * per `interval` seconds of the source, `0..100`, where `0` is the `floor` (in
 * dB) and `100` is full scale. This module validates that file and turns the
 * part of it a clip shows into bars.
 *
 * Like the thumbnails, the bar grid is anchored to **source time**, not to a
 * clip's place on the timeline. Splitting a clip leaves both halves drawing the
 * same bars at the same source offsets, and reordering moves a clip together
 * with its waveform. Only zooming changes the sampling, because a bar is a fixed
 * number of screen pixels wide.
 */

import { z } from "zod";

import type { EditorClip } from "@/lib/editor";

/** The shape `levels.json` is documented to have. Extra keys are ignored. */
export const audioLevelsSchema = z.object({
  /** Seconds of source covered by one peak value. */
  interval: z.number().positive(),
  /** One value per interval, `0..100`. */
  peak: z.array(z.number()),
  duration: z.number().nonnegative().optional(),
  /** The dB value that `0` stands for. */
  floor: z.number().negative().optional(),
});

export type AudioLevels = z.infer<typeof audioLevelsSchema>;

/** One bar, positioned inside its clip. */
export interface WaveformBar {
  /** Stable index in the source-time grid; unique within one clip. */
  key: number;
  /** Left edge in pixels, relative to the clip's own left edge. */
  left: number;
  /** Bar height as a fraction of the full waveform height, `0..1`. */
  level: number;
}

/** A bar and the gap after it, in screen pixels. */
export const WAVEFORM_BAR_WIDTH = 2;
export const WAVEFORM_BAR_GAP = 1;

/** Quietest bar, as a fraction, so silence still reads as a line. */
export const WAVEFORM_MIN_LEVEL = 0.04;

/**
 * Upper bound on bars for one clip. A viewport holds roughly
 * `viewportWidth / (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP)` of them, so this
 * only catches a caller passing a pathologically small bar pitch.
 */
const MAX_BARS_PER_CLIP = 4096;

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Parses an untrusted `levels.json` body.
 *
 * Returns `null` for anything that is not the documented shape, so a broken
 * file means "no waveform" rather than a crash. An empty `peak` array is not
 * usable either, because there would be nothing to draw.
 */
export function parseAudioLevels(value: unknown): AudioLevels | null {
  const result = audioLevelsSchema.safeParse(value);
  if (!result.success || result.data.peak.length === 0) return null;
  return result.data;
}

/** A peak value as a `0..1` fraction, clamped. Non-numbers read as silence. */
function peakFraction(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value)) / 100;
}

/**
 * The loudest peak over a source time range, as a `0..1` fraction.
 *
 * Every interval the range touches counts, so a bar never hides a transient
 * that falls inside it. A range past the end of the file reads as silence.
 */
export function peakBetween(
  levels: Pick<AudioLevels, "interval" | "peak">,
  from: number,
  to: number,
): number {
  if (!isPositive(levels.interval)) return 0;

  const first = Math.max(0, Math.floor(from / levels.interval));
  const last = Math.min(
    levels.peak.length,
    Math.max(first + 1, Math.ceil(to / levels.interval)),
  );

  let loudest = 0;
  for (let index = first; index < last; index += 1) {
    const fraction = peakFraction(levels.peak[index]);
    if (fraction > loudest) loudest = fraction;
  }

  return loudest;
}

export interface WaveformBarsInput {
  levels: Pick<AudioLevels, "interval" | "peak">;
  clip: Pick<EditorClip, "duration" | "sourceOffset">;
  /** Pixels per source second at the current zoom. */
  pxPerSecond: number;
  /** The clip's left edge in lane pixels, after scrolling. */
  clipLeftPx: number;
  /** The measured timeline width, so off-screen bars are not computed. */
  viewportWidth: number;
  barWidth?: number;
  barGap?: number;
}

/**
 * The bars visible for one clip, ordered left to right.
 *
 * `left` is relative to the clip, and the first and last bar may extend past
 * either edge: the clip's `overflow-hidden` crops them, which is what keeps a
 * split at an arbitrary time continuous on both sides.
 */
export function waveformBars(input: WaveformBarsInput): WaveformBar[] {
  const { levels, clip, pxPerSecond, clipLeftPx, viewportWidth } = input;
  const barWidth =
    input.barWidth !== undefined && isPositive(input.barWidth)
      ? input.barWidth
      : WAVEFORM_BAR_WIDTH;
  const barGap =
    input.barGap !== undefined &&
    Number.isFinite(input.barGap) &&
    input.barGap >= 0
      ? input.barGap
      : WAVEFORM_BAR_GAP;

  if (
    !isPositive(pxPerSecond) ||
    !isPositive(clip.duration) ||
    !isPositive(viewportWidth) ||
    levels.peak.length === 0
  ) {
    return [];
  }

  const pitch = barWidth + barGap;
  const step = pitch / pxPerSecond;
  if (!isPositive(step)) return [];

  const clipWidth = clip.duration * pxPerSecond;
  const visibleStart = Math.max(0, -clipLeftPx);
  const visibleEnd = Math.min(clipWidth, viewportWidth - clipLeftPx);
  if (visibleEnd <= visibleStart) return [];

  const sourceStart = clip.sourceOffset;
  const sourceEnd = clip.sourceOffset + clip.duration;

  const firstIndex = Math.floor(
    (sourceStart + visibleStart / pxPerSecond) / step,
  );
  const lastIndex = Math.floor((sourceStart + visibleEnd / pxPerSecond) / step);

  const bars: WaveformBar[] = [];

  for (
    let index = firstIndex;
    index <= lastIndex && bars.length < MAX_BARS_PER_CLIP;
    index += 1
  ) {
    const left = (index * step - sourceStart) * pxPerSecond;
    if (left + barWidth <= visibleStart || left >= visibleEnd) continue;

    /* Clamp to the clip's own range so a trimmed clip never shows the peak of
     * footage that was cut away just past its edge. */
    const from = Math.max(sourceStart, index * step);
    const to = Math.min(sourceEnd, (index + 1) * step);
    if (to <= from) continue;

    bars.push({
      key: index,
      left,
      level: Math.max(WAVEFORM_MIN_LEVEL, peakBetween(levels, from, to)),
    });
  }

  return bars;
}

/**
 * One SVG path for a list of bars, mirrored around the vertical centre.
 *
 * A single `<path>` keeps the DOM flat however many bars are visible. Heights
 * are rounded to half pixels so the bars stay crisp without a per-bar node.
 */
export function waveformPath(
  bars: readonly WaveformBar[],
  height: number,
  barWidth: number = WAVEFORM_BAR_WIDTH,
): string {
  if (!isPositive(height) || !isPositive(barWidth)) return "";

  const centre = height / 2;
  const segments: string[] = [];

  for (const bar of bars) {
    const half = Math.max(0.5, Math.round(bar.level * centre * 2) / 2);
    const x = Math.round(bar.left * 100) / 100;
    segments.push(`M${x} ${centre - half}h${barWidth}v${half * 2}h-${barWidth}z`);
  }

  return segments.join("");
}
