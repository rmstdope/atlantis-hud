import { describe, expect, it } from "vitest";
import {
  msUntilNextWaterStep,
  WATER_REDRAWS_PER_SECOND,
  WATER_SECONDS_PER_WIDTH,
  waterDriftStep,
  waterDriftTransform
} from "./waterDrift";

const STEP_MS = 1000 / WATER_REDRAWS_PER_SECOND;
const STEPS_PER_WIDTH = WATER_SECONDS_PER_WIDTH * WATER_REDRAWS_PER_SECOND;

describe("waterDrift", () => {
  it("redraws eight times a second, at the agreed speed", () => {
    expect(WATER_REDRAWS_PER_SECOND).toBe(8);
    expect(WATER_SECONDS_PER_WIDTH).toBe(18);
    expect(waterDriftStep(0)).toBe(0);
    expect(waterDriftStep(STEP_MS - 1)).toBe(0);
    expect(waterDriftStep(STEP_MS)).toBe(1);
    expect(waterDriftStep(1000)).toBe(8);
  });

  it("moves one width in eighteen seconds", () => {
    expect(waterDriftTransform(0, 1)).toBe("translate(0 0)");
    expect(waterDriftTransform(STEPS_PER_WIDTH / 2, 1)).toBe("translate(0.5 0)");
  });

  it("wraps a one-width loop after one width", () => {
    expect(waterDriftTransform(STEPS_PER_WIDTH, 1)).toBe("translate(0 0)");
    expect(waterDriftTransform(STEPS_PER_WIDTH + 1, 1)).toBe(waterDriftTransform(1, 1));
  });

  it("carries a two-width loop twice as far at the same speed", () => {
    expect(waterDriftTransform(1, 2)).toBe(waterDriftTransform(1, 1));
    expect(waterDriftTransform(STEPS_PER_WIDTH, 2)).toBe("translate(1 0)");
    expect(waterDriftTransform(STEPS_PER_WIDTH * 2, 2)).toBe("translate(0 0)");
  });

  it("waits until the next redraw, and never for no time at all", () => {
    expect(msUntilNextWaterStep(0)).toBe(STEP_MS);
    expect(msUntilNextWaterStep(STEP_MS - 1)).toBe(1);
    expect(msUntilNextWaterStep(STEP_MS)).toBe(STEP_MS);
  });
});
