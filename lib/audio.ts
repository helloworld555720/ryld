/**
 * Loudness maths for the timeline's volume lines.
 *
 * Loudness is stored in decibels because that is how people reason about it
 * (and how editors label it); the linear gain a media element or Web Audio
 * node wants is derived at the edge. 0 dB leaves the audio alone.
 */

export const GAIN_MIN_DB = -60;
export const GAIN_MAX_DB = 20;

/** Dragging this close to 0 dB snaps to it, so "unchanged" is easy to hit. */
const SNAP_DB = 1;

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
 * `1` the top. The scale is linear in dB, so 0 dB sits three quarters up.
 */
export function fractionFromGain(db: number): number {
  return (clampGainDb(db) - GAIN_MIN_DB) / (GAIN_MAX_DB - GAIN_MIN_DB);
}

/** The inverse of `fractionFromGain`, snapped to 0 dB when it is close. */
export function gainFromFraction(fraction: number): number {
  const clamped = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
  const db = GAIN_MIN_DB + clamped * (GAIN_MAX_DB - GAIN_MIN_DB);
  return Math.abs(db) < SNAP_DB ? 0 : db;
}

/** Display text such as `+3.5 dB`, `0.0 dB` or `-12.0 dB`. */
export function formatGainDb(db: number): string {
  const clamped = clampGainDb(db);
  const rounded = Math.round(clamped * 10) / 10;
  if (rounded === 0) return "0.0 dB";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
}
