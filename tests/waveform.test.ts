import { describe, expect, it } from "vitest";

import {
  WAVEFORM_MIN_LEVEL,
  parseAudioLevels,
  peakBetween,
  waveformBars,
  waveformPath,
  waveformShape,
} from "@/lib/waveform";
import { fractionFromGain } from "@/lib/audio";

/* One value per second: 0, 10, 20 ... 100, then 0 again. */
const levels = {
  interval: 1,
  peak: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 0],
};

describe("parseAudioLevels", () => {
  it("accepts the documented shape", () => {
    expect(
      parseAudioLevels({ interval: 0.5, peak: [1, 2], duration: 1, floor: -60 }),
    ).toEqual({ interval: 0.5, peak: [1, 2], duration: 1, floor: -60 });
  });

  it("makes duration and floor optional and ignores other keys", () => {
    expect(parseAudioLevels({ interval: 1, peak: [5], extra: true })).toEqual({
      interval: 1,
      peak: [5],
    });
  });

  it("rejects anything else", () => {
    expect(parseAudioLevels(null)).toBeNull();
    expect(parseAudioLevels("levels")).toBeNull();
    expect(parseAudioLevels({ peak: [1] })).toBeNull();
    expect(parseAudioLevels({ interval: 0, peak: [1] })).toBeNull();
    expect(parseAudioLevels({ interval: -1, peak: [1] })).toBeNull();
    expect(parseAudioLevels({ interval: 1, peak: ["1"] })).toBeNull();
    expect(parseAudioLevels({ interval: 1, peak: [1], floor: 5 })).toBeNull();
  });

  it("rejects a file with nothing to draw", () => {
    expect(parseAudioLevels({ interval: 1, peak: [] })).toBeNull();
  });
});

describe("peakBetween", () => {
  it("returns the loudest interval a range touches, as a fraction", () => {
    expect(peakBetween(levels, 2, 5)).toBeCloseTo(0.4);
    expect(peakBetween(levels, 9.5, 10.5)).toBe(1);
  });

  it("reads the single interval under a zero-length range", () => {
    expect(peakBetween(levels, 3, 3)).toBeCloseTo(0.3);
  });

  it("reads past the end of the file as silence", () => {
    expect(peakBetween(levels, 50, 60)).toBe(0);
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(peakBetween({ interval: 1, peak: [250, -5] }, 0, 2)).toBe(1);
    expect(peakBetween({ interval: 1, peak: [Number.NaN] }, 0, 1)).toBe(0);
  });

  it("treats a negative start as the start of the file", () => {
    expect(peakBetween(levels, -4, 1)).toBe(0);
  });
});

describe("waveformBars", () => {
  const clip = { duration: 10, sourceOffset: 0 };
  const base = {
    levels,
    clip,
    pxPerSecond: 30,
    clipLeftPx: 0,
    viewportWidth: 1000,
  };

  it("covers the clip left to right", () => {
    const bars = waveformBars(base);

    expect(bars.length).toBeGreaterThan(90);
    expect(bars[0].left).toBeLessThanOrEqual(0.001);
    for (let index = 1; index < bars.length; index += 1) {
      expect(bars[index].left).toBeGreaterThan(bars[index - 1].left);
    }
    expect(bars.at(-1)!.left).toBeLessThan(clip.duration * 30);
  });

  it("follows the loudness of the source under each bar", () => {
    const bars = waveformBars(base);
    const quiet = bars.find((bar) => bar.left > 0 && bar.left < 28)!;
    const loud = bars.find((bar) => bar.left > 290 && bar.left < 299)!;

    expect(quiet.level).toBeLessThan(0.2);
    expect(loud.level).toBeGreaterThan(0.8);
  });

  it("keeps silence visible", () => {
    const silent = waveformBars({
      ...base,
      levels: { interval: 1, peak: [0, 0, 0] },
    });

    expect(silent.length).toBeGreaterThan(0);
    expect(silent.every((bar) => bar.level === WAVEFORM_MIN_LEVEL)).toBe(true);
  });

  it("only returns bars inside the viewport", () => {
    const bars = waveformBars({
      ...base,
      clip: { duration: 600, sourceOffset: 0 },
      levels: { interval: 1, peak: new Array<number>(600).fill(50) },
      clipLeftPx: -9000,
      viewportWidth: 600,
    });

    expect(bars.length).toBeLessThanOrEqual(Math.ceil(600 / 3) + 2);
    expect(bars.every((bar) => bar.left + 2 > 9000)).toBe(true);
    expect(bars.every((bar) => bar.left < 9600)).toBe(true);
  });

  it("returns nothing for a clip that is off screen", () => {
    expect(waveformBars({ ...base, clipLeftPx: 2000 })).toEqual([]);
    expect(waveformBars({ ...base, clipLeftPx: -4000 })).toEqual([]);
  });

  it("stays anchored to source time when a clip is split", () => {
    const whole = waveformBars(base);
    /* Split at 4s: the right half starts at source 4 and sits at lane x 120. */
    const right = waveformBars({
      ...base,
      clip: { duration: 6, sourceOffset: 4 },
      clipLeftPx: 4 * 30,
    });

    for (const bar of right.filter((candidate) => candidate.left > 0)) {
      const same = whole.find((candidate) => candidate.key === bar.key)!;
      expect(same).toBeDefined();
      expect(same.level).toBeCloseTo(bar.level);
      expect(same.left - 4 * 30).toBeCloseTo(bar.left);
    }
  });

  it("does not show the peak of footage that was trimmed away", () => {
    /* The clip shows only the first second; the loud part is source 10..11. */
    const bars = waveformBars({
      ...base,
      clip: { duration: 1, sourceOffset: 0 },
      levels: { interval: 1, peak: [0, ...new Array<number>(9).fill(0), 100] },
    });

    expect(bars.every((bar) => bar.level === WAVEFORM_MIN_LEVEL)).toBe(true);
  });

  it("returns nothing for unusable input", () => {
    expect(waveformBars({ ...base, pxPerSecond: 0 })).toEqual([]);
    expect(waveformBars({ ...base, viewportWidth: 0 })).toEqual([]);
    expect(waveformBars({ ...base, clip: { duration: 0, sourceOffset: 0 } })).toEqual([]);
    expect(waveformBars({ ...base, levels: { interval: 1, peak: [] } })).toEqual([]);
  });
});

describe("waveformPath", () => {
  it("draws one rectangle per bar, rising from the bottom edge, in a single path", () => {
    const path = waveformPath(
      [
        { key: 0, left: 0, level: 1 },
        { key: 1, left: 3, level: 0.5 },
      ],
      20,
    );

    /* Every rectangle ends on y = 20, the bottom; only its top moves. */
    expect(path).toBe("M0 0h2v20h-2zM3 10h2v10h-2z");
  });

  it("keeps the quietest bar at least one pixel tall and never past the strip", () => {
    expect(waveformPath([{ key: 0, left: 0, level: 0 }], 20)).toBe(
      "M0 19h2v1h-2z",
    );
    expect(waveformPath([{ key: 0, left: 0, level: 5 }], 20)).toBe(
      "M0 0h2v20h-2z",
    );
  });

  it("is empty without bars or without a height", () => {
    expect(waveformPath([], 20)).toBe("");
    expect(waveformPath([{ key: 0, left: 0, level: 1 }], 0)).toBe("");
  });
});

describe("waveformShape", () => {
  const HEIGHT = 32;

  /** Where the top of a bar of `level` ends up, in pixels above the bottom. */
  function top(db: number, level: number) {
    const { band, peakScale } = waveformShape(db, HEIGHT);
    return band + level * HEIGHT * peakScale;
  }

  it("lies flat along the bottom when the line is fully down", () => {
    const { band, peakScale } = waveformShape(-60, HEIGHT);

    expect(band).toBe(3);
    expect(peakScale).toBe(0);
    expect(top(-60, 1)).toBe(3);
  });

  it("fills the strip when the line is fully up", () => {
    const { band } = waveformShape(20, HEIGHT);

    expect(band).toBe(HEIGHT - 3);
    expect(top(20, 1)).toBeLessThanOrEqual(HEIGHT);
    expect(top(20, 1)).toBeGreaterThan(HEIGHT - 1);
  });

  it("never draws a bar below the line", () => {
    for (let db = -60; db <= 20; db += 1) {
      const { band } = waveformShape(db, HEIGHT);
      expect(top(db, 0)).toBeGreaterThanOrEqual(band);
      expect(top(db, 0.5)).toBeGreaterThanOrEqual(band);
    }
  });

  it("only grows as the line rises, for quiet and loud bars alike", () => {
    for (const level of [0, 0.2, 0.6, 1]) {
      let previous = -1;
      for (let db = -60; db <= 20; db += 0.25) {
        const height = top(db, level);
        expect(height).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = height;
      }
    }
  });

  it("changes in small steps for small movements of the line", () => {
    /* One percent of the line's travel is about a quarter of a pixel here, so
     * no bar may move more than a pixel for it: no big jumps. */
    /* The line's level at a fraction of its travel, without the 0 dB snap. */
    const dbAt = (fraction: number) => {
      let low = -60;
      let high = 20;
      for (let i = 0; i < 60; i += 1) {
        const mid = (low + high) / 2;
        if (fractionFromGain(mid) < fraction) low = mid;
        else high = mid;
      }
      return (low + high) / 2;
    };

    for (const level of [0.2, 0.6, 1]) {
      let previous = top(-60, level);
      for (let step = 1; step <= 100; step += 1) {
        const db = dbAt(step / 100);
        const height = top(db, level);
        expect(Math.abs(height - previous)).toBeLessThan(1);
        previous = height;
      }
    }
  });

  it("draws nothing for a strip with no height", () => {
    expect(waveformShape(0, 0)).toEqual({ band: 0, peakScale: 0 });
  });
});
