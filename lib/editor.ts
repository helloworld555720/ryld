/**
 * The editor's timeline model.
 *
 * Everything here is **time**, never pixels: a clip knows where it starts and how
 * long it runs on the timeline (`start`, `duration`) and which part of its source
 * it shows (`sourceOffset`). Pixel, zoom and scroll live in `lib/timeline.ts`,
 * layered on top as pure functions, so a future drag or auto-track feature
 * changes the model without touching how the timeline is drawn.
 *
 * The model carries the pieces the cut/split feature uses: tracks have a `type`
 * (`video` | `audio`) even though only video tracks exist today, and a clip
 * belongs to a track by `trackId`, so moving a clip to a new track is a data
 * change, not a new shape.
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

/** The four clip operations the timeline toolbar exposes. */
export type ClipEditAction =
  | "split"
  | "delete-left"
  | "delete-right"
  | "delete-clip";

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
 * Only a zero-length clip is touched, so a trim or split is never reset by a
 * late metadata event. Returns the same array when nothing changed, which
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

/*
 * Clip editing.
 *
 * The editor has one video track today, so these helpers operate on its clip
 * list directly. Clips are kept in timeline order, contiguous from 0, and the
 * source offsets are the only thing a cut changes. That is what makes playback
 * seam-free: the timeline has no gaps, and the player is seeked only where the
 * source itself jumps.
 *
 * Every operation returns a new array and re-flows the survivors, so a caller
 * can never leave a gap behind. Boundary comparisons use a tiny epsilon because
 * the playhead is frame-snapped but the arithmetic is floating point.
 */

const CLIP_EPSILON = 1e-6;

/** The first video track. The editor only creates one today. */
export function videoTrack(
  tracks: readonly EditorTrack[],
): EditorTrack | null {
  return tracks.find((track) => track.type === "video") ?? null;
}

/** The first video track's clips, in timeline order. */
export function videoClips(tracks: readonly EditorTrack[]): EditorClip[] {
  return videoTrack(tracks)?.clips ?? [];
}

/**
 * Replaces the first video track's clips and leaves every other track alone.
 * Returns the original array when the update changed nothing, so a no-op edit
 * cannot schedule a render.
 */
export function updateVideoClips(
  tracks: readonly EditorTrack[],
  update: (clips: readonly EditorClip[]) => EditorClip[],
): EditorTrack[] {
  let seen = false;
  let changed = false;

  const next = tracks.map((track) => {
    if (seen || track.type !== "video") return track;
    seen = true;

    const clips = update(track.clips);
    if (clips === track.clips) return track;

    changed = true;
    return { ...track, clips };
  });

  return changed ? next : (tracks as EditorTrack[]);
}

/** End of the last clip, in seconds. */
export function sequenceDuration(clips: readonly EditorClip[]): number {
  let end = 0;
  for (const clip of clips) {
    end = Math.max(end, clip.start + clip.duration);
  }
  return end;
}

/**
 * Index of the clip under a time. Half-open, so an internal boundary belongs to
 * the clip on its right; the sequence end belongs to the last clip.
 */
export function clipIndexAt(
  clips: readonly EditorClip[],
  time: number,
): number {
  if (clips.length === 0) return -1;

  const target = Number.isFinite(time) ? Math.max(0, time) : 0;
  for (let index = 0; index < clips.length; index += 1) {
    const end = clips[index].start + clips[index].duration;
    if (target < end - CLIP_EPSILON) return index;
  }

  return clips.length - 1;
}

export function clipAtTime(
  clips: readonly EditorClip[],
  time: number,
): EditorClip | null {
  const index = clipIndexAt(clips, time);
  return index < 0 ? null : clips[index];
}

/** How far into the clip under `time` the playhead is, or `null` without one. */
export function clipOffsetAt(
  clips: readonly EditorClip[],
  time: number,
): number | null {
  const clip = clipAtTime(clips, time);
  if (!clip) return null;

  return Math.min(Math.max(time - clip.start, 0), clip.duration);
}

/**
 * Packs clips from 0 in their current order, dropping empty ones. The source
 * offsets are untouched: a ripple moves clips on the timeline, never inside
 * their source.
 */
export function reflowClips(clips: readonly EditorClip[]): EditorClip[] {
  const next: EditorClip[] = [];
  let cursor = 0;

  for (const clip of clips) {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) continue;
    next.push({ ...clip, start: cursor });
    cursor += clip.duration;
  }

  return next;
}

/** A fresh id for the right half of a split. */
export type ClipIdFactory = () => string;

/**
 * Splits the clip under `time` into two contiguous halves. The left half keeps
 * the original id; the right half gets a new one and starts inside the same
 * source. A split at either boundary is a no-op.
 */
export function splitClip(
  clips: readonly EditorClip[],
  time: number,
  makeId: ClipIdFactory,
): EditorClip[] {
  const index = clipIndexAt(clips, time);
  if (index < 0) return clips as EditorClip[];

  const clip = clips[index];
  const offset = time - clip.start;
  if (
    !Number.isFinite(offset) ||
    offset <= CLIP_EPSILON ||
    offset >= clip.duration - CLIP_EPSILON
  ) {
    return clips as EditorClip[];
  }

  const left: EditorClip = { ...clip, duration: offset };
  const right: EditorClip = {
    ...clip,
    id: makeId(),
    start: clip.start + offset,
    duration: clip.duration - offset,
    sourceOffset: clip.sourceOffset + offset,
  };

  return reflowClips([
    ...clips.slice(0, index),
    left,
    right,
    ...clips.slice(index + 1),
  ]);
}

/** Removes the clip under `time` and closes the gap it leaves. */
export function deleteClipAt(
  clips: readonly EditorClip[],
  time: number,
): EditorClip[] {
  const index = clipIndexAt(clips, time);
  if (index < 0) return clips as EditorClip[];

  return reflowClips(clips.filter((_, current) => current !== index));
}

/**
 * Trims the clip under `time` from its start to `time` and ripples the rest
 * left. At the clip's end this removes the clip entirely.
 */
export function deleteLeftAt(
  clips: readonly EditorClip[],
  time: number,
): EditorClip[] {
  const index = clipIndexAt(clips, time);
  if (index < 0) return clips as EditorClip[];

  const clip = clips[index];
  const offset = Math.min(Math.max(time - clip.start, 0), clip.duration);

  if (offset <= CLIP_EPSILON) return clips as EditorClip[];
  if (offset >= clip.duration - CLIP_EPSILON) {
    return deleteClipAt(clips, time);
  }

  const next = clips.map((current, currentIndex) =>
    currentIndex === index
      ? {
          ...current,
          sourceOffset: current.sourceOffset + offset,
          duration: current.duration - offset,
        }
      : current,
  );

  return reflowClips(next);
}

/**
 * Trims the clip under `time` from `time` to its end and ripples the rest
 * left. At the clip's start this removes the clip entirely.
 */
export function deleteRightAt(
  clips: readonly EditorClip[],
  time: number,
): EditorClip[] {
  const index = clipIndexAt(clips, time);
  if (index < 0) return clips as EditorClip[];

  const clip = clips[index];
  const offset = Math.min(Math.max(time - clip.start, 0), clip.duration);

  if (offset >= clip.duration - CLIP_EPSILON) return clips as EditorClip[];
  if (offset <= CLIP_EPSILON) {
    return deleteClipAt(clips, time);
  }

  const next = clips.map((current, currentIndex) =>
    currentIndex === index ? { ...current, duration: offset } : current,
  );

  return reflowClips(next);
}

/** Timeline time → source time in the project's HLS. `null` without clips. */
export function timelineToSource(
  clips: readonly EditorClip[],
  time: number,
): number | null {
  if (clips.length === 0) return null;

  const end = sequenceDuration(clips);
  const target = Number.isFinite(time)
    ? Math.min(Math.max(0, time), end)
    : 0;

  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (
      target < clip.start + clip.duration - CLIP_EPSILON ||
      index === clips.length - 1
    ) {
      const offset = Math.min(
        Math.max(target - clip.start, 0),
        clip.duration,
      );
      return clip.sourceOffset + offset;
    }
  }

  return null;
}

export interface SourceTimelineResult {
  /** Where the timeline playhead belongs. */
  time: number;
  /** A source time to seek to when the media is in a removed region. */
  seek: number | null;
  /** True once the source has passed the last clip's source range. */
  ended: boolean;
}

/**
 * Source time → timeline time, used while the media is playing.
 *
 * A source time inside a clip maps directly. A source time in a removed region
 * returns the next clip and the source offset to jump to, which is the cut.
 * Past the last clip's source range the sequence is over, even if the media
 * itself has more content.
 */
export function sourceToTimeline(
  clips: readonly EditorClip[],
  sourceTime: number,
): SourceTimelineResult {
  if (clips.length === 0) {
    return { time: 0, seek: null, ended: true };
  }

  if (!Number.isFinite(sourceTime)) {
    return { time: 0, seek: clips[0].sourceOffset, ended: false };
  }

  for (const clip of clips) {
    const start = clip.sourceOffset;
    const end = start + clip.duration;
    if (sourceTime >= start - CLIP_EPSILON && sourceTime < end - CLIP_EPSILON) {
      return {
        time: clip.start + Math.max(0, sourceTime - start),
        seek: null,
        ended: false,
      };
    }
  }

  const following = clips.find((clip) => clip.sourceOffset > sourceTime);
  if (following) {
    return { time: following.start, seek: following.sourceOffset, ended: false };
  }

  return { time: sequenceDuration(clips), seek: null, ended: true };
}

export interface PlayheadRemap {
  /** Where the playhead belongs in the edited sequence. */
  time: number;
  /** A source time to seek to when the old frame did not survive. */
  seek: number | null;
}

/**
 * Maps a playhead from one clip list to the next, keeping the **frame**, not the
 * old timeline coordinate. Removing the head of a clip moves that frame to the
 * clip's new start; deleting the clip under the playhead lands on the next
 * surviving clip; deleting the tail leaves the playhead at the cut; deleting
 * earlier material pulls the playhead left with the ripple. Returns `seek` only
 * when the old source frame was removed.
 */
export function remapPlayhead(
  previous: readonly EditorClip[],
  next: readonly EditorClip[],
  time: number,
): PlayheadRemap {
  const end = sequenceDuration(next);
  const oldSource = timelineToSource(previous, time);

  if (oldSource === null) {
    return {
      time: Math.min(Math.max(time, 0), end),
      seek: null,
    };
  }

  const mapped = sourceToTimeline(next, oldSource);
  if (mapped.ended) return { time: end, seek: null };

  return { time: mapped.time, seek: mapped.seek };
}
