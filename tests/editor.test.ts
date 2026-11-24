import { describe, expect, it } from "vitest";

import {
  EDITOR_ZOOM,
  clampTime,
  createInitialTracks,
  formatRulerLabel,
  formatTimecode,
  pixelsToTime,
  tickStep,
  timelineDuration,
  timeToPixels,
  videoHidden,
  videoMuted,
  withMediaDuration,
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
        clips: [{ id: "c3", trackId: "b", start: 1, duration: 5, sourceOffset: 0 }],
      },
    ];

    expect(timelineDuration(tracks)).toBe(12);
  });

  it("is zero without clips", () => {
    expect(timelineDuration([])).toBe(0);
  });
});

describe("pixels and time", () => {
  it("converts both ways at the current zoom", () => {
    expect(timeToPixels(3, 50)).toBe(150);
    expect(pixelsToTime(150, 50)).toBe(3);
    expect(pixelsToTime(timeToPixels(12.5, 24), 24)).toBeCloseTo(12.5);
  });

  it("treats a non-positive zoom as zero time instead of dividing by zero", () => {
    expect(pixelsToTime(100, 0)).toBe(0);
    expect(pixelsToTime(100, -10)).toBe(0);
  });

  it("clamps to the timeline", () => {
    expect(clampTime(-3, 10)).toBe(0);
    expect(clampTime(4, 10)).toBe(4);
    expect(clampTime(11, 10)).toBe(10);
    expect(clampTime(Number.NaN, 10)).toBe(0);
    expect(clampTime(4, 0)).toBe(4);
  });
});

describe("formatTimecode", () => {
  it("matches the reference display at 60 fps", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
    expect(formatTimecode(2.983)).toBe("00:00:02:59");
    expect(formatTimecode(263)).toBe("00:04:23:00");
    expect(formatTimecode(3661)).toBe("01:01:01:00");
  });

  it("renders junk as zero instead of NaN", () => {
    expect(formatTimecode(-4)).toBe("00:00:00:00");
    expect(formatTimecode(Number.NaN)).toBe("00:00:00:00");
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("00:00:00:00");
  });

  it("honours a different frame rate", () => {
    expect(formatTimecode(2.5, 30)).toBe("00:00:02:15");
  });
});

describe("formatRulerLabel", () => {
  it("uses mm:ss below an hour and h:mm:ss above it", () => {
    expect(formatRulerLabel(0)).toBe("00:00");
    expect(formatRulerLabel(65)).toBe("01:05");
    expect(formatRulerLabel(3661)).toBe("1:01:01");
  });
});

describe("tickStep", () => {
  it("keeps labels apart at every zoom the slider allows", () => {
    for (const pxPerSecond of [
      EDITOR_ZOOM.min,
      EDITOR_ZOOM.initial,
      EDITOR_ZOOM.max,
    ]) {
      expect(tickStep(pxPerSecond) * pxPerSecond).toBeGreaterThanOrEqual(72);
    }
  });

  it("uses finer steps as the timeline zooms in", () => {
    expect(tickStep(EDITOR_ZOOM.min)).toBeGreaterThan(tickStep(EDITOR_ZOOM.max));
  });
});
