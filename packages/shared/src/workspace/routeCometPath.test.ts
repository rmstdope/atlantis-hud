import { describe, expect, it } from "vitest";
import {
  clampMovementAnimationSpeed,
  COMET_RUN_OUT,
  cometHead,
  cometPath,
  DEFAULT_MOVEMENT_ANIMATION_SPEED,
  MOVEMENT_ANIMATION_SPEED_MAX,
  MOVEMENT_ANIMATION_SPEED_MIN,
  pointAlong
} from "./routeCometPath";
import { HEX_RADIUS } from "./mapViewport";

describe("the comet's path", () => {
  it("joins this month's line and the later one without repeating their shared point", () => {
    const path = cometPath("0,0 3,4", "3,4 3,10");
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 10 }
    ]);
    expect(path.length).toBe(11);
    expect(path.monthEnd).toBe(5);
  });

  it("is all later journey when nothing is reached this month", () => {
    const path = cometPath("", "0,0 0,8");
    expect(path.length).toBe(8);
    expect(path.monthEnd).toBe(0);
  });

  it("finds a point part-way along a segment, and clamps to the ends", () => {
    const path = cometPath("0,0 10,0", "10,0 10,10");
    expect(pointAlong(path, 15)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(path, -3)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(path, 99)).toEqual({ x: 10, y: 10 });
  });
});

describe("the comet's timing", () => {
  const hex = Math.sqrt(3) * HEX_RADIUS;

  it("covers the given number of hexes each second", () => {
    const path = cometPath(`0,0 ${hex * 10},0`, "");
    expect(cometHead(path, 1, 4)).toBeCloseTo(hex * 4);
  });

  it("starts again once the head has run past the end", () => {
    const path = cometPath(`0,0 ${hex * 2},0`, "");
    const lap = (hex * 2 + COMET_RUN_OUT) / hex;
    expect(cometHead(path, lap / 4 + 0.25 / 4, 4)).toBeCloseTo(0.25 * hex);
  });
});

describe("the speed setting", () => {
  it("keeps to the slider's range and steps", () => {
    expect(clampMovementAnimationSpeed(1)).toBe(MOVEMENT_ANIMATION_SPEED_MIN);
    expect(clampMovementAnimationSpeed(50)).toBe(MOVEMENT_ANIMATION_SPEED_MAX);
    expect(clampMovementAnimationSpeed(5.1)).toBe(5);
    expect(clampMovementAnimationSpeed("fast")).toBe(DEFAULT_MOVEMENT_ANIMATION_SPEED);
  });
});
