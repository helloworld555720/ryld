/**
 * The editor's timeline model.
 *
 * Everything here is **time**, never pixels: a clip knows where it starts and how
 * long it runs on the timeline (`start`, `duration`) and which part of its source
 * it shows (`sourceOffset`). Pixel/zoom conversion is a pure function layered on
 * top, so a future split/drag/auto-track feature changes the model without
 * touching how the timeline is drawn.
 *
 * The model already carries the pieces the cut/split feature will need: tracks
 * have a `type` (`video` | `audio`) even though only video tracks exist today,
 * and a clip belongs to a track by `trackId`, so moving a clip to a new track is
 * a data change, not a new shape.
 *
 * Client-safe: no server imports and no env reads.
 */

export type EditorTrackType = "video" | "audio";

export interface EditorClip {
  id: string;
  trackId: string;
  /** Timeline position where the clip begins, in seconds. */
  start: number;
  /** How long the clip occupies the timeline, in seconds. */
  duration: number;
  /** Where playback starts inside the source media, in seconds. */
  sourceOffset: number;
}

export interface EditorTrack {
  id: string;
  type: EditorTrackType;
  muted: boolean;
  hidden: boolean;
  clips: EditorClip[];
}

/** Timeline zoom bounds, in pixels per second. */
export const EDITOR_ZOOM = {
  min: 12,
  max: 240,
  step: 4,
  initial: 56,
} as const;

/**
 * Fixed ids: the timeline is created during render (server and client), and a
 * `crypto.randomUUID()` here would produce a hydration mismatch. Later features
 * that add tracks or clips can generate their own ids at interaction time.
 */
const VIDEO_TRACK_ID = "track-video-1";
const VIDEO_CLIP_ID = "clip-video-1-1";

/**
 * The state a freshly opened editor starts in: one video track with one clip at
 * the beginning. The duration is unknown until the media reports metadata, so it
 * starts at zero and `withMediaDuration()` fills it in.
 */
export function createInitialTracks(): EditorTrack[] {
  return [
    {
      id: VIDEO_TRACK_ID,
      type: "video",
      muted: false,
      hidden: false,
      clips: [
        {
          id: VIDEO_CLIP_ID,
          trackId: VIDEO_TRACK_ID,
          start: 0,
          duration: 0,
          sourceOffset: 0,
        },
      ],
    },
  ];
}

/**
 * Fills the placeholder duration once the media reports it.
 *
 * Only a zero-length clip is touched, so a future trim or split is never reset by
 * a late metadata event. Returns the same array when nothing changed, which
 * keeps a `setState` in an effect from looping.
 */
export function withMediaDuration(
  tracks: EditorTrack[],
  duration: number,
): EditorTrack[] {
  if (!Number.isFinite(duration) || duration <= 0) return tracks;

  let changed = false;

  const next = tracks.map((track) => {
    const clips = track.clips.map((clip) => {
      if (track.type !== "video" || clip.duration !== 0) return clip;
      changed = true;
      return { ...clip, duration };
    });

    return { ...track, clips };
  });

  return changed ? next : tracks;
}

/** End of the last clip on any track, in seconds. Zero when there are none. */
export function timelineDuration(tracks: readonly EditorTrack[]): number {
  let end = 0;

  for (const track of tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }

  return end;
}

/** The preview is silent only when every video track is muted. */
export function videoMuted(tracks: readonly EditorTrack[]): boolean {
  const videoTracks = tracks.filter((track) => track.type === "video");
  return videoTracks.length > 0 && videoTracks.every((track) => track.muted);
}

/** The preview shows no picture only when every video track is hidden. */
export function videoHidden(tracks: readonly EditorTrack[]): boolean {
  const videoTracks = tracks.filter((track) => track.type === "video");
  return videoTracks.length > 0 && videoTracks.every((track) => track.hidden);
}

/** Seconds → horizontal pixels at the given zoom. */
export function timeToPixels(seconds: number, pxPerSecond: number): number {
  return seconds * pxPerSecond;
}

/** Horizontal pixels → seconds at the given zoom. */
export function pixelsToTime(pixels: number, pxPerSecond: number): number {
  if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return 0;
  return pixels / pxPerSecond;
}

/** Keep a time inside the timeline: never negative, never past the end. */
export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (duration > 0 && time > duration) return duration;
  return time;
}

/**
 * The reference UI displays frames, and the media pipeline does not tell us the
 * real frame rate, so 60 is the assumed rate: `00:00:02:59` is 2.98 seconds.
 */
export const TIMECODE_FPS = 60;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** `HH:MM:SS:FF` for a time in seconds. Negative and NaN render as zero. */
export function formatTimecode(
  seconds: number,
  fps: number = TIMECODE_FPS,
): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : TIMECODE_FPS;
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  const totalFrames = Math.round(safeSeconds * safeFps);
  const frames = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
}

/** `mm:ss` (or `h:mm:ss` past an hour) for ruler labels. */
export function formatRulerLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${pad(minutes)}:${pad(secs)}`;
}

/** Candidate ruler intervals, in seconds. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800] as const;

/**
 * The smallest interval whose label keeps reasonable spacing at this zoom, so
 * the ruler gains or loses labels as the user zooms instead of overlapping.
 */
export function tickStep(pxPerSecond: number): number {
  for (const step of TICK_STEPS) {
    if (step * pxPerSecond >= 72) return step;
  }

  return TICK_STEPS[TICK_STEPS.length - 1];
}
