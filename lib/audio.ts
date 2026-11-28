/**
 * Loudness maths for the timeline's volume lines.
 *
 * Loudness is stored in decibels because that is how people reason about it
 * (and how editors label it); the linear gain a media element or Web Audio
 * node wants is derived at the edge. 0 dB leaves the audio alone.
 */

export const GAIN_MIN_DB = -60;
export const GAIN_MAX_DB = 20;

/**
 * Dragging this close to 0 dB snaps to it. Kept under half a pixel of travel on
 * purpose: a wider snap makes the line, and the waveform that follows it, hop
 * as it crosses 0 dB. Double-click (or `0`) resets exactly.
 */
const SNAP_DB = 0.5;

/** Breathing room at both ends of a loudness line's travel, in pixels. */
export const GAIN_LINE_PADDING = 3;

/**
 * Where 0 dB sits on the control, as a fraction of its travel from the bottom.
 * Unchanged audio rests low, the way a volume line does in a video editor, which
 * leaves most of the height for boosting and the rest for turning down.
 */
const UNITY_FRACTION = 0.25;

/**
 * How the quieter half is spread over its small share of the height. Below 1,
 * the first few dB of a cut cover the most distance and the deep end is
 * compressed, so turning a clip down a little is as easy as turning it up.
 */
const CUT_CURVE = 0.5;

export function clampGainDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(Math.max(db, GAIN_MIN_DB), GAIN_MAX_DB);
}

/** dB → linear gain. The bottom of the range is silence, not just very quiet. */
export function dbToLinear(db: number): number {
  const clamped = clampGainDb(db);
  if (clamped <= GAIN_MIN_DB) return 0;
  return 10 ** (clamped / 20);
}

/**
 * Where a level sits on a vertical control: `0` is the bottom of the range and
 * `1` the top. Boosts are linear in dB above the 0 dB mark; cuts follow a curve
 * below it. Every step of the way is strictly increasing, so a drag never
 * jumps.
 */
export function fractionFromGain(db: number): number {
  const level = clampGainDb(db);

  if (level >= 0) {
    return UNITY_FRACTION + (1 - UNITY_FRACTION) * (level / GAIN_MAX_DB);
  }

  return UNITY_FRACTION * (1 - (level / GAIN_MIN_DB) ** CUT_CURVE);
}

/** The inverse of `fractionFromGain`, snapped to 0 dB when it is close. */
export function gainFromFraction(fraction: number): number {
  const clamped = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);

  const db =
    clamped >= UNITY_FRACTION
      ? ((clamped - UNITY_FRACTION) / (1 - UNITY_FRACTION)) * GAIN_MAX_DB
      : GAIN_MIN_DB * (1 - clamped / UNITY_FRACTION) ** (1 / CUT_CURVE);

  return Math.abs(db) < SNAP_DB ? 0 : db;
}

/**
 * How far above the bottom of a strip `height` pixels tall the loudness line
 * sits. The waveform uses the same number as the height it never drops below,
 * so the line and the bars cannot disagree.
 */
export function gainLineOffset(db: number, height: number): number {
  const travel = Math.max(height - GAIN_LINE_PADDING * 2, 0);
  return GAIN_LINE_PADDING + fractionFromGain(db) * travel;
}

/** Display text such as `+3.5 dB`, `0.0 dB` or `-12.0 dB`. */
export function formatGainDb(db: number): string {
  const clamped = clampGainDb(db);
  const rounded = Math.round(clamped * 10) / 10;
  if (rounded === 0) return "0.0 dB";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
}
