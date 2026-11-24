import { describe, expect, it } from "vitest";

import {
  clampLevel,
  clampScroll,
  basePxPerSecFor,
  formatRulerLabel,
  formatTimecode,
  lastFrame,
  maxLevelFor,
  maxScrollFor,
  nextZoomLevel,
  previousZoomLevel,
  pxPerFrameAt,
  pxPerSecAt,
  rulerStep,
  snapTime,
  timeToX,
  visibleTicks,
  xToTime,
  zoomedViewport,
  END_MARGIN,
  FRAME_PX,
  FPS,
  PAD,
  type TimelineViewport,
} from "@/lib/timeline";

const WIDTH = 1200;
const DURATION = 240;
const BASE = basePxPerSecFor(WIDTH, DURATION);

function viewport(level: number, scrollX: number): TimelineViewport {
  return { level, scrollX };
}

function zoom(
  time: number,
  current: TimelineViewport,
  level: number,
): TimelineViewport {
  return zoomedViewport({
    time,
    viewport: current,
    basePxPerSec: BASE,
    duration: DURATION,
    viewportWidth: WIDTH,
    nextLevel: level,
  });
}

describe("base scale", () => {
  it("makes the clip fill one third of the viewport at level 0", () => {
    expect(DURATION * pxPerSecAt(0, BASE)).toBeCloseTo(WIDTH / 3);
  });

  it("rejects a viewport or duration it cannot divide by", () => {
    expect(basePxPerSecFor(0, DURATION)).toBe(0);
    expect(basePxPerSecFor(WIDTH, 0)).toBe(0);
    expect(basePxPerSecFor(WIDTH, Number.NaN)).toBe(0);
  });

  it("doubles the scale at each whole level", () => {
    expect(pxPerSecAt(1, BASE) / pxPerSecAt(0, BASE)).toBeCloseTo(2);
    expect(pxPerSecAt(2, BASE) / pxPerSecAt(1, BASE)).toBeCloseTo(2);
  });
});

describe("zoom range", () => {
  it("puts the top stop at one frame of 200px", () => {
    const max = maxLevelFor(BASE);

    expect(max).toBeGreaterThanOrEqual(1);
    expect(pxPerFrameAt(max, BASE)).toBeCloseTo(FRAME_PX, 6);
  });

  it("clamps levels and steps to whole levels", () => {
    const max = maxLevelFor(BASE);

    expect(clampLevel(-1, max)).toBe(0);
    expect(clampLevel(max + 1, max)).toBe(max);
    expect(nextZoomLevel(0.4, max)).toBe(1);
    expect(nextZoomLevel(1, max)).toBe(2);
    expect(previousZoomLevel(2, max)).toBe(1);
    expect(previousZoomLevel(1.2, max)).toBe(1);
    expect(previousZoomLevel(0, max)).toBe(0);
    expect(nextZoomLevel(max, max)).toBe(max);
  });
});

describe("scroll bounds", () => {
  it("cannot scroll while the content still fits", () => {
    expect(maxScrollFor(60, 0, BASE, WIDTH)).toBe(0);
    expect(maxScrollFor(DURATION, 1, BASE, WIDTH)).toBe(0);
  });

  it("leaves the end margin once the content overflows", () => {
    expect(maxScrollFor(DURATION, 3, BASE, WIDTH)).toBeCloseTo(
      DURATION * pxPerSecAt(3, BASE) + PAD + END_MARGIN * WIDTH - WIDTH,
    );
  });

  it("clamps a scroll offset into range", () => {
    expect(clampScroll(-20, 100)).toBe(0);
    expect(clampScroll(40, 100)).toBe(40);
    expect(clampScroll(400, 100)).toBe(100);
    expect(clampScroll(Number.NaN, 100)).toBe(0);
  });
});

describe("time and pixels", () => {
  it("round-trips a time through the current viewport", () => {
    const current = viewport(2, 137);
    const x = timeToX(37.5, current, BASE);

    expect(timeToX(0, current, BASE)).toBeCloseTo(PAD - 137);
    expect(x).toBeCloseTo(PAD + 37.5 * pxPerSecAt(2, BASE) - 137);
    expect(xToTime(x, current, BASE)).toBeCloseTo(37.5);
  });

  it("returns zero time rather than dividing by a zero scale", () => {
    expect(xToTime(300, viewport(0, 0), 0)).toBe(0);
  });
});

describe("zoomedViewport", () => {
  it("keeps a playhead at zero on the pad through every zoom step", () => {
    const current = viewport(0, 0);
    const x = timeToX(0, current, BASE);

    for (let level = 1; level <= 5; level += 1) {
      expect(timeToX(0, zoom(0, current, level), BASE)).toBeCloseTo(x);
    }
  });

  it("holds the playhead still once the content can scroll", () => {
    const current = viewport(0, 0);
    const x = timeToX(10, current, BASE);
    const zoomed = zoom(10, current, 2);

    expect(maxScrollFor(DURATION, 2, BASE, WIDTH)).toBeGreaterThan(0);
    expect(timeToX(10, zoomed, BASE)).toBeCloseTo(x);
  });

  it("lets the playhead drift right while the content still fits", () => {
    const current = viewport(0, 0);
    const x = timeToX(10, current, BASE);
    const zoomed = zoom(10, current, 1);

    expect(maxScrollFor(DURATION, 1, BASE, WIDTH)).toBe(0);
    expect(zoomed.scrollX).toBe(0);
    expect(timeToX(10, zoomed, BASE)).toBeGreaterThan(x);
  });

  it("brings the end in from the right edge, leaving the margin", () => {
    const zoomed = zoom(DURATION, viewport(0, 0), 3);

    expect(timeToX(DURATION, zoomed, BASE)).toBeCloseTo(
      WIDTH * (1 - END_MARGIN),
    );
    expect(zoomed.scrollX).toBeCloseTo(
      maxScrollFor(DURATION, 3, BASE, WIDTH),
    );
  });

  it("stops at level zero instead of going negative", () => {
    const max = maxLevelFor(BASE);
    const zoomed = zoom(40, viewport(0, 0), previousZoomLevel(0, max));

    expect(zoomed.level).toBe(0);
    expect(zoomed.scrollX).toBe(0);
  });

  it("clamps a requested level above the frame stop", () => {
    const zoomed = zoom(40, viewport(0, 0), maxLevelFor(BASE) + 10);
    expect(zoomed.level).toBeCloseTo(maxLevelFor(BASE));
  });
});

describe("frame snapping", () => {
  it("rounds a time to the nearest frame", () => {
    expect(snapTime(1.01, 10)).toBeCloseTo(1);
    expect(snapTime(1.02, 10)).toBeCloseTo(31 / 30);
    expect(snapTime(2.5, 10)).toBeCloseTo(2.5);
  });

  it("never leaves the timeline", () => {
    expect(snapTime(-3, 10)).toBe(0);
    expect(snapTime(11, 10)).toBe(10);
    expect(snapTime(Number.NaN, 10)).toBe(0);
  });

  it("finds the last frame that starts before the end", () => {
    expect(lastFrame(20.37)).toBeCloseTo(611 / 30);
    expect(lastFrame(0)).toBe(0);
  });
});

describe("timecode", () => {
  it("renders HH:MM:SS:FF at the assumed 30 fps", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
    expect(formatTimecode(2.983)).toBe("00:00:02:29");
    expect(formatTimecode(263)).toBe("00:04:23:00");
    expect(formatTimecode(3661)).toBe("01:01:01:00");
    expect(formatTimecode(2.5, 30)).toBe("00:00:02:15");
  });

  it("renders junk as zero instead of NaN", () => {
    expect(formatTimecode(-4)).toBe("00:00:00:00");
    expect(formatTimecode(Number.NaN)).toBe("00:00:00:00");
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("00:00:00:00");
  });
});

describe("ruler", () => {
  it("labels whole seconds in mm:ss and part-seconds in frames", () => {
    expect(formatRulerLabel(0)).toBe("00:00");
    expect(formatRulerLabel(65)).toBe("01:05");
    expect(formatRulerLabel(1.5)).toBe("15f");
    expect(formatRulerLabel(2.983)).toBe("29f");
    expect(formatRulerLabel(3661)).toBe("61:01");
  });

  it("picks the first interval whose labels are at least 90px apart", () => {
    const max = maxLevelFor(BASE);
    const frameScale = rulerStep(pxPerSecAt(max, BASE));
    expect(frameScale).toEqual({ step: 1 / FPS, subdivisions: 1 });

    const halfSecondScale = rulerStep(200);
    expect(halfSecondScale).toEqual({ step: 0.5, subdivisions: 3 });

    const minuteScale = rulerStep(pxPerSecAt(0, BASE));
    expect(minuteScale.step * pxPerSecAt(0, BASE)).toBeGreaterThanOrEqual(90);
    expect(minuteScale.step).toBe(60);
  });

  it("falls back to the coarsest interval for a dead scale", () => {
    expect(rulerStep(0)).toEqual({ step: 3600, subdivisions: 5 });
  });

  it("draws only the ticks the viewport can see", () => {
    const ticks = visibleTicks({
      viewport: viewport(0, 0),
      basePxPerSec: BASE,
      viewportWidth: WIDTH,
    });

    expect(ticks.labels.length).toBeGreaterThan(0);
    for (const label of ticks.labels) {
      expect(label.x).toBeGreaterThanOrEqual(-1);
      expect(label.x).toBeLessThanOrEqual(WIDTH + 1);
    }
  });

  it("stays small enough to draw at frame zoom", () => {
    const max = maxLevelFor(BASE);
    const pxPerSecond = pxPerSecAt(max, BASE);
    const ticks = visibleTicks({
      viewport: viewport(max, DURATION * pxPerSecond - WIDTH / 2),
      basePxPerSec: BASE,
      viewportWidth: WIDTH,
    });

    expect(ticks.labels.length).toBeLessThan(80);
    expect(pxPerFrameAt(max, BASE)).toBeCloseTo(FRAME_PX, 6);
  });
});

describe("acceptance checks", () => {
  it("shows one-frame labels about 200px apart at the frame stop", () => {
    const max = maxLevelFor(BASE);
    const pxPerSecond = pxPerSecAt(max, BASE);
    const { step } = rulerStep(pxPerSecond);

    expect(step * pxPerSecond).toBeCloseTo(FRAME_PX, 4);
  });

  it("gives each doubling the same slider distance", () => {
    /* The slider is linear in `level`, so equal level deltas are equal
     * distances and every doubling costs the same number of slider pixels. */
    for (let level = 0; level < 4; level += 1) {
      const ratio = pxPerSecAt(level + 1, BASE) / pxPerSecAt(level, BASE);
      expect(ratio).toBeCloseTo(2);
    }
  });
});
