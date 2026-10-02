import { describe, expect, it } from "vitest";
import { curvedHalves, curveThrough } from "./routeCurve";
import { parsePoints } from "./routeCometPath";

describe("the curved movement line", () => {
  it("passes through every hex centre, in order", () => {
    const centres = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
      { x: 30, y: 5 }
    ];
    const curve = curveThrough(centres);
    for (const centre of centres) {
      expect(curve.some((point) => Math.hypot(point.x - centre.x, point.y - centre.y) < 1e-9)).toBe(true);
    }
    expect(curve[0]).toEqual(centres[0]);
    expect(curve[curve.length - 1]).toEqual(centres[3]);
  });

  it("leaves a two-point line straight", () => {
    expect(curvedHalves("0,0 10,0", "")).toEqual({ solid: "0,0 10,0", dotted: "" });
  });

  it("cuts the two halves apart exactly at the end of the month", () => {
    const halves = curvedHalves("0,0 10,5 20,0", "20,0 30,5 40,0");
    const solid = parsePoints(halves.solid);
    const dotted = parsePoints(halves.dotted);
    expect(solid[0]).toEqual({ x: 0, y: 0 });
    expect(solid[solid.length - 1]).toEqual({ x: 20, y: 0 });
    expect(dotted[0]).toEqual({ x: 20, y: 0 });
    expect(dotted[dotted.length - 1]).toEqual({ x: 40, y: 0 });
  });

  it("curves an all-later journey without inventing a solid half", () => {
    const halves = curvedHalves("", "0,0 10,5 20,0");
    expect(halves.solid).toBe("");
    expect(parsePoints(halves.dotted).length).toBeGreaterThan(3);
  });
});
