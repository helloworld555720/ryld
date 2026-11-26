import { describe, expect, it } from "vitest";

import {
  clipAtTime,
  clipIndexAt,
  clipOffsetAt,
  createInitialTracks,
  deleteClipAt,
  deleteClipById,
  deleteLeftAt,
  deleteRightAt,
  moveClip,
  reflowClips,
  remapPlayhead,
  sequenceDuration,
  splitClip,
  stepPlayback,
  timelineDuration,
  timelineToSource,
  updateVideoClips,
  videoClips,
  videoHidden,
  videoMuted,
  withMediaDuration,
  type EditorClip,
  type EditorTrack,
} from "@/lib/editor";

describe("createInitialTracks", () => {
  it("starts with one video track holding one full-length clip", () => {
    const tracks = createInitialTracks();

    expect(tracks).toHaveLength(1);
    const [track] = tracks;
    expect(track.type).toBe("video");
    expect(track.muted).toBe(false);
    expect(track.hidden).toBe(false);
    expect(track.clips).toHaveLength(1);

    const [clip] = track.clips;
    expect(clip.trackId).toBe(track.id);
    expect(clip.start).toBe(0);
    expect(clip.duration).toBe(0);
    expect(clip.sourceOffset).toBe(0);
  });

  it("uses stable ids so server and client markup agree", () => {
    expect(createInitialTracks()).toEqual(createInitialTracks());
  });
});

describe("withMediaDuration", () => {
  it("fills the placeholder clip once metadata reports a duration", () => {
    const filled = withMediaDuration(createInitialTracks(), 263);
    const [clip] = filled[0].clips;

    expect(clip.duration).toBe(263);
    expect(timelineDuration(filled)).toBe(263);
  });

  it("leaves the model untouched for an unusable duration", () => {
    const tracks = createInitialTracks();

    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(withMediaDuration(tracks, value)).toBe(tracks);
    }
  });

  it("never resets a clip that already has a duration", () => {
    const tracks = withMediaDuration(createInitialTracks(), 10);
    expect(withMediaDuration(tracks, 20)).toBe(tracks);
  });

  it("does not touch audio tracks", () => {
    const audio: EditorTrack = {
      id: "track-audio-1",
      type: "audio",
      muted: false,
      hidden: false,
      clips: [
        {
          id: "clip-audio-1-1",
          trackId: "track-audio-1",
          start: 0,
          duration: 0,
          sourceOffset: 0,
        },
      ],
    };

    const tracks = withMediaDuration([audio], 12);
    expect(tracks[0].clips[0].duration).toBe(0);
  });
});

describe("track state", () => {
  it("reads mute and visibility from the video tracks", () => {
    const tracks = createInitialTracks();
    expect(videoMuted(tracks)).toBe(false);
    expect(videoHidden(tracks)).toBe(false);

    tracks[0].muted = true;
    tracks[0].hidden = true;
    expect(videoMuted(tracks)).toBe(true);
    expect(videoHidden(tracks)).toBe(true);
  });

  it("ignores audio tracks and stays false with no video track", () => {
    const audio: EditorTrack = {
      id: "track-audio-1",
      type: "audio",
      muted: true,
      hidden: true,
      clips: [],
    };

    expect(videoMuted([audio])).toBe(false);
    expect(videoHidden([audio])).toBe(false);
  });

  it("is only silent/hidden when every video track is", () => {
    const first = createInitialTracks()[0];
    const second: EditorTrack = { ...first, id: "track-video-2" };
    first.muted = true;
    first.hidden = true;

    expect(videoMuted([first, second])).toBe(false);
    expect(videoHidden([first, second])).toBe(false);
  });
});

describe("timelineDuration", () => {
  it("is the end of the last clip across tracks", () => {
    const tracks: EditorTrack[] = [
      {
        id: "a",
        type: "video",
        muted: false,
        hidden: false,
        clips: [
          { id: "c1", trackId: "a", start: 0, duration: 4, sourceOffset: 0 },
          { id: "c2", trackId: "a", start: 10, duration: 2, sourceOffset: 4 },
        ],
      },
      {
        id: "b",
        type: "audio",
        muted: false,
        hidden: false,
        clips: [
          { id: "c3", trackId: "b", start: 1, duration: 5, sourceOffset: 0 },
        ],
      },
    ];

    expect(timelineDuration(tracks)).toBe(12);
  });

  it("is zero without clips", () => {
    expect(timelineDuration([])).toBe(0);
  });
});

/* ------------------------------------------------------------ clip editing */

function clip(
  id: string,
  start: number,
  duration: number,
  sourceOffset: number,
): EditorClip {
  return { id, trackId: "track-video-1", start, duration, sourceOffset };
}

/** Two adjacent clips whose source ranges are also adjacent. */
function twoClips(): EditorClip[] {
  return [clip("a", 0, 10, 0), clip("b", 10, 4, 10)];
}

function expectNoGaps(clips: readonly EditorClip[]): void {
  let cursor = 0;
  for (const current of clips) {
    expect(current.start).toBeCloseTo(cursor, 9);
    expect(current.duration).toBeGreaterThan(0);
    cursor += current.duration;
  }
  expect(sequenceDuration(clips)).toBeCloseTo(cursor, 9);
}

describe("clipAtTime", () => {
  it("belongs to the clip on the right at a boundary", () => {
    const clips = twoClips();

    expect(clipIndexAt(clips, 0)).toBe(0);
    expect(clipAtTime(clips, 10)?.id).toBe("b");
    expect(clipAtTime(clips, 14)?.id).toBe("b");
    expect(clipAtTime([], 3)).toBeNull();
  });

  it("reports the offset inside the clip", () => {
    const clips = twoClips();

    expect(clipOffsetAt(clips, 4)).toBe(4);
    expect(clipOffsetAt(clips, 10)).toBe(0);
    expect(clipOffsetAt(clips, 14)).toBe(4);
    expect(clipOffsetAt([], 4)).toBeNull();
  });
});

describe("reflowClips", () => {
  it("packs from zero and drops empty clips without touching the source", () => {
    const next = reflowClips([
      clip("a", 3, 4, 8),
      clip("empty", 9, 0, 0),
      clip("b", 20, 2, 12),
    ]);

    expect(next).toEqual([
      clip("a", 0, 4, 8),
      clip("b", 4, 2, 12),
    ]);
    expectNoGaps(next);
  });
});

describe("splitClip", () => {
  it("splits the clip under the playhead and keeps both source ranges adjacent", () => {
    const next = splitClip(twoClips(), 4, () => "a2");

    expect(next).toEqual([
      clip("a", 0, 4, 0),
      clip("a2", 4, 6, 4),
      clip("b", 10, 4, 10),
    ]);
    expectNoGaps(next);
  });

  it("is a no-op on a boundary or outside the sequence", () => {
    const clips = twoClips();

    expect(splitClip(clips, 0, () => "x")).toBe(clips);
    expect(splitClip(clips, 10, () => "x")).toBe(clips);
    expect(splitClip(clips, 14, () => "x")).toBe(clips);
    expect(splitClip(clips, 99, () => "x")).toBe(clips);
  });

  it("calls the id factory once, only for a real split", () => {
    let calls = 0;
    const makeId = () => {
      calls += 1;
      return `new-${calls}`;
    };

    splitClip(twoClips(), 4, makeId);
    splitClip(twoClips(), 0, makeId);

    expect(calls).toBe(1);
  });
});

describe("deleteClipAt", () => {
  it("removes the clip under the playhead and ripples the rest left", () => {
    const next = deleteClipAt(twoClips(), 4);

    expect(next).toEqual([clip("b", 0, 4, 10)]);
    expectNoGaps(next);
  });

  it("refuses to remove the only clip, so the track never empties", () => {
    const clips = [clip("a", 0, 10, 0)];
    expect(deleteClipAt(clips, 5)).toBe(clips);
    expect(deleteClipAt([], 5)).toEqual([]);
  });
});

describe("deleteClipById", () => {
  it("removes the selected clip and closes the gap", () => {
    const next = deleteClipById(twoClips(), "a");

    expect(next).toEqual([clip("b", 0, 4, 10)]);
    expectNoGaps(next);
  });

  it("refuses to remove the only clip, so the track never empties", () => {
    const clips = [clip("a", 0, 10, 0)];
    expect(deleteClipById(clips, "a")).toBe(clips);
  });

  it("is a no-op for an unknown id or an empty list", () => {
    const clips = twoClips();
    expect(deleteClipById(clips, "missing")).toBe(clips);
    expect(deleteClipById([], "a")).toEqual([]);
  });
});

describe("moveClip", () => {
  const threeClips = [
    clip("a", 0, 4, 0),
    clip("b", 4, 2, 4),
    clip("c", 6, 3, 6),
  ];

  it("moves a clip forward and re-flows the new order", () => {
    expect(moveClip(threeClips, "a", 2)).toEqual([
      clip("b", 0, 2, 4),
      clip("c", 2, 3, 6),
      clip("a", 5, 4, 0),
    ]);
  });

  it("moves a clip backward and re-flows the new order", () => {
    expect(moveClip(threeClips, "c", 0)).toEqual([
      clip("c", 0, 3, 6),
      clip("a", 3, 4, 0),
      clip("b", 7, 2, 4),
    ]);
  });

  it("keeps the same array for a no-op, an unknown id, or a clamped slot", () => {
    expect(moveClip(threeClips, "b", 1)).toBe(threeClips);
    expect(moveClip(threeClips, "missing", 2)).toBe(threeClips);
    expect(moveClip(threeClips, "a", -10)).toBe(threeClips);
    expect(moveClip(threeClips, "c", 99)).toBe(threeClips);
  });

  it("never leaves a gap in any order", () => {
    for (const id of ["a", "b", "c"]) {
      for (let slot = 0; slot < threeClips.length; slot += 1) {
        expectNoGaps(moveClip(threeClips, id, slot));
      }
    }
  });
});

describe("deleteLeftAt", () => {
  it("trims the clip's start, advances its source offset, and ripples", () => {
    const next = deleteLeftAt(twoClips(), 4);

    expect(next).toEqual([
      clip("a", 0, 6, 4),
      clip("b", 6, 4, 10),
    ]);
    expectNoGaps(next);
  });

  it("is a no-op at a clip's start", () => {
    const clips = twoClips();
    expect(deleteLeftAt(clips, 0)).toBe(clips);
    expect(deleteLeftAt(clips, 10)).toBe(clips);
  });

  it("removes the clip when the playhead is at its end", () => {
    expect(deleteLeftAt(twoClips(), 14)).toEqual([clip("a", 0, 10, 0)]);

    const only = [clip("a", 0, 10, 0)];
    expect(deleteLeftAt(only, 10)).toBe(only);
  });
});

describe("deleteRightAt", () => {
  it("trims the clip's end and ripples the rest left", () => {
    const next = deleteRightAt(twoClips(), 4);

    expect(next).toEqual([
      clip("a", 0, 4, 0),
      clip("b", 4, 4, 10),
    ]);
    expectNoGaps(next);
  });

  it("is a no-op at a clip's end", () => {
    const clips = twoClips();
    expect(deleteRightAt(clips, 14)).toBe(clips);
  });

  it("removes the clip when the playhead is at its start", () => {
    expect(deleteRightAt(twoClips(), 10)).toEqual([clip("a", 0, 10, 0)]);

    const only = [clip("a", 0, 10, 0)];
    expect(deleteRightAt(only, 0)).toBe(only);
  });
});

describe("updateVideoClips", () => {
  it("replaces only the first video track and keeps audio untouched", () => {
    const audio: EditorTrack = {
      id: "track-audio-1",
      type: "audio",
      muted: false,
      hidden: false,
      clips: [clip("audio", 0, 3, 0)],
    };
    const tracks = [...createInitialTracks(), audio];
    const filled = withMediaDuration(tracks, 10);
    const next = updateVideoClips(filled, (clips) => deleteClipAt(clips, 0));

    expect(videoClips(next)).toEqual([]);
    expect(next[1]).toBe(filled[1]);
  });

  it("returns the same array when the update is a no-op", () => {
    const tracks = withMediaDuration(createInitialTracks(), 10);
    expect(updateVideoClips(tracks, (clips) => clips as EditorClip[])).toBe(
      tracks,
    );
  });
});

describe("timelineToSource", () => {
  const clips = [clip("a", 0, 4, 0), clip("b", 4, 4, 10)];

  it("maps a timeline time into the clip that owns it", () => {
    expect(timelineToSource(clips, 0)).toBe(0);
    expect(timelineToSource(clips, 2)).toBe(2);
    expect(timelineToSource(clips, 4)).toBe(10);
    expect(timelineToSource(clips, 6)).toBe(12);
  });

  it("clamps to the sequence and returns null without clips", () => {
    expect(timelineToSource(clips, -3)).toBe(0);
    expect(timelineToSource(clips, 99)).toBe(14);
    expect(timelineToSource([], 4)).toBeNull();
  });
});

describe("stepPlayback", () => {
  const FRAME = 1 / 30;
  /* a shows source 0-4, b shows source 10-14: the cut between them skips 4-10. */
  const clips = [clip("a", 0, 4, 0), clip("b", 4, 4, 10)];

  it("maps a source time inside the current clip", () => {
    expect(stepPlayback(clips, 0, 2, FRAME)).toEqual({
      index: 0,
      time: 2,
      seek: null,
      ended: false,
    });
    expect(stepPlayback(clips, 1, 12, FRAME)).toEqual({
      index: 1,
      time: 6,
      seek: null,
      ended: false,
    });
  });

  it("jumps a cut that skips source on the clip's last frame, before it plays", () => {
    expect(stepPlayback(clips, 0, 4 - FRAME, FRAME)).toEqual({
      index: 1,
      time: 4,
      seek: 10,
      ended: false,
    });
  });

  it("flows through a split without ever seeking", () => {
    const split = splitClip([clip("a", 0, 8, 0)], 4, () => "a2");

    expect(stepPlayback(split, 0, 4 - FRAME, FRAME)).toMatchObject({
      index: 0,
      seek: null,
      ended: false,
    });
    expect(stepPlayback(split, 0, 4, FRAME)).toEqual({
      index: 1,
      time: 4,
      seek: null,
      ended: false,
    });
  });

  it("ends on the last frame of the last clip", () => {
    expect(stepPlayback(clips, 1, 14 - FRAME, FRAME)).toMatchObject({
      index: 1,
      seek: null,
      ended: true,
    });
    expect(stepPlayback(clips, 1, 13, FRAME).ended).toBe(false);
  });

  it("plays reordered clips in timeline order, not source order", () => {
    /* b (source 10-14) now plays first, then a (source 0-4). */
    const reordered = moveClip(clips, "b", 0);

    expect(stepPlayback(reordered, 0, 12, FRAME)).toEqual({
      index: 0,
      time: 2,
      seek: null,
      ended: false,
    });
    expect(stepPlayback(reordered, 0, 14 - FRAME, FRAME)).toEqual({
      index: 1,
      time: 4,
      seek: 0,
      ended: false,
    });
    expect(stepPlayback(reordered, 1, 2, FRAME)).toEqual({
      index: 1,
      time: 6,
      seek: null,
      ended: false,
    });
    expect(stepPlayback(reordered, 1, 4 - FRAME, FRAME).ended).toBe(true);
  });

  it("re-syncs to the clip that holds the media after a scrub or an edit", () => {
    expect(stepPlayback(clips, 0, 12, FRAME)).toEqual({
      index: 1,
      time: 6,
      seek: null,
      ended: false,
    });
  });

  it("moves on when the media is in source that an edit removed", () => {
    expect(stepPlayback(clips, 0, 6, FRAME)).toEqual({
      index: 1,
      time: 4,
      seek: 10,
      ended: false,
    });
    expect(stepPlayback(clips, 1, 6, FRAME)).toEqual({
      index: 1,
      time: 4,
      seek: 10,
      ended: false,
    });
    expect(stepPlayback(clips, 1, 20, FRAME).ended).toBe(true);
  });

  it("starts an empty sequence at zero and treats it as ended", () => {
    expect(stepPlayback([], 0, 3, FRAME)).toEqual({
      index: 0,
      time: 0,
      seek: null,
      ended: true,
    });
  });
});

describe("remapPlayhead", () => {
  const clips = twoClips();

  it("keeps the same frame across a split", () => {
    const split = splitClip(clips, 4, () => "a2");
    expect(remapPlayhead(clips, split, 4)).toEqual({ time: 4, seek: null });
  });

  it("moves to the trimmed clip's new start after delete left", () => {
    const next = deleteLeftAt(clips, 4);
    expect(remapPlayhead(clips, next, 4)).toEqual({ time: 0, seek: null });
  });

  it("lands on the next clip after delete right", () => {
    const next = deleteRightAt(clips, 4);
    expect(remapPlayhead(clips, next, 4)).toEqual({ time: 4, seek: 10 });
  });

  it("lands on the next clip after deleting the clip under the playhead", () => {
    const next = deleteClipAt(clips, 4);
    expect(remapPlayhead(clips, next, 4)).toEqual({ time: 0, seek: 10 });
  });

  it("pulls the playhead left when earlier material is removed", () => {
    const next = deleteClipAt(clips, 0);
    expect(remapPlayhead(clips, next, 12)).toEqual({ time: 2, seek: null });
  });

  it("clamps to the new end when the last clip is removed", () => {
    const next = deleteClipAt(clips, 12);
    expect(remapPlayhead(clips, next, 12)).toEqual({ time: 10, seek: null });
  });

  it("is zero when every clip is gone", () => {
    expect(remapPlayhead(clips, [], 4)).toEqual({ time: 0, seek: null });
  });

  it("keeps the frame when clips are reordered", () => {
    const original = [clip("a", 0, 4, 0), clip("b", 4, 4, 10)];
    const reordered = moveClip(original, "b", 0);

    expect(remapPlayhead(original, reordered, 5)).toEqual({ time: 1, seek: null });
  });

  it("lands at the end, not the start, when nothing followed the deleted clip", () => {
    const reordered = moveClip(
      [clip("a", 0, 4, 0), clip("b", 4, 4, 10)],
      "b",
      0,
    );
    const next = deleteClipAt(reordered, 5);

    expect(remapPlayhead(reordered, next, 5)).toEqual({ time: 4, seek: null });
  });
});
