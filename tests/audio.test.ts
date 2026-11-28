import { describe, expect, it } from "vitest";

import {
  GAIN_MAX_DB,
  GAIN_MIN_DB,
  clampGainDb,
  dbToLinear,
  formatGainDb,
  GAIN_LINE_PADDING,
  fractionFromGain,
  gainFromFraction,
  gainLineOffset,
} from "@/lib/audio";

describe("clampGainDb", () => {
  it("keeps values inside -60..+20 dB", () => {
    expect(clampGainDb(-100)).toBe(GAIN_MIN_DB);
    expect(clampGainDb(55)).toBe(GAIN_MAX_DB);
    expect(clampGainDb(-3)).toBe(-3);
  });

  it("treats non-finite input as 0 dB", () => {
    expect(clampGainDb(Number.NaN)).toBe(0);
    expect(clampGainDb(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("dbToLinear", () => {
  it("is unity at 0 dB", () => {
    expect(dbToLinear(0)).toBe(1);
  });

  it("halves the amplitude about every 6 dB down and doubles it up", () => {
    expect(dbToLinear(-6.0206)).toBeCloseTo(0.5, 4);
    expect(dbToLinear(6.0206)).toBeCloseTo(2, 4);
  });

  it("reaches 10x at +20 dB and silence at -60 dB", () => {
    expect(dbToLinear(20)).toBeCloseTo(10, 9);
    expect(dbToLinear(-60)).toBe(0);
    expect(dbToLinear(-500)).toBe(0);
  });
});

describe("fractionFromGain / gainFromFraction", () => {
  it("maps the range onto 0..1, with 0 dB a quarter of the way up", () => {
    expect(fractionFromGain(GAIN_MIN_DB)).toBe(0);
    expect(fractionFromGain(GAIN_MAX_DB)).toBe(1);
    expect(fractionFromGain(0)).toBeCloseTo(0.25, 9);
  });

  it("rises strictly with loudness, so a drag never jumps or doubles back", () => {
    let previous = -1;
    for (let db = GAIN_MIN_DB; db <= GAIN_MAX_DB; db += 0.5) {
      const fraction = fractionFromGain(db);
      expect(fraction).toBeGreaterThan(previous);
      previous = fraction;
    }
  });

  it("gives the first dB of a cut more room than the deep end", () => {
    const shallow = fractionFromGain(0) - fractionFromGain(-6);
    const deep = fractionFromGain(-48) - fractionFromGain(-54);

    expect(shallow).toBeGreaterThan(deep * 3);
  });

  it("round-trips away from the 0 dB snap", () => {
    for (const db of [-60, -40, -12, -3, 3, 6, 20]) {
      expect(gainFromFraction(fractionFromGain(db))).toBeCloseTo(db, 6);
    }
  });

  it("snaps to exactly 0 dB when close, and clamps out-of-range input", () => {
    expect(gainFromFraction(0.25)).toBe(0);
    expect(gainFromFraction(0.25 + 0.01)).toBe(0);
    expect(gainFromFraction(-1)).toBe(GAIN_MIN_DB);
    expect(gainFromFraction(2)).toBe(GAIN_MAX_DB);
  });
});

describe("gainLineOffset", () => {
  it("keeps the line inside the strip at both ends", () => {
    expect(gainLineOffset(GAIN_MIN_DB, 32)).toBe(GAIN_LINE_PADDING);
    expect(gainLineOffset(GAIN_MAX_DB, 32)).toBe(32 - GAIN_LINE_PADDING);
  });

  it("puts 0 dB low in the strip", () => {
    expect(gainLineOffset(0, 32)).toBeCloseTo(3 + 0.25 * 26, 9);
  });
});

describe("formatGainDb", () => {
  it("shows one decimal and an explicit plus for boosts", () => {
    expect(formatGainDb(0)).toBe("0.0 dB");
    expect(formatGainDb(3.04)).toBe("+3.0 dB");
    expect(formatGainDb(-12.26)).toBe("-12.3 dB");
    expect(formatGainDb(-0.04)).toBe("0.0 dB");
  });
});
