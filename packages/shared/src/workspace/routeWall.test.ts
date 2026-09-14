import { describe, expect, it } from "vitest";
import type { Direction } from "@atlantis/core-client";

import { HEX_RADIUS, worldOf } from "./mapViewport";
import { WALL_TIP_HALF_LENGTH, WALL_TIP_REACH, wallTip } from "./routeWall";

/** Copied from `Direction::offset` in crates/core/src/movement/graph.rs, so the side table is pinned to the core. */
const OFFSET: Record<Direction, [number, number]> = {
  north: [0, -2],
  northeast: [1, -1],
  southeast: [1, 1],
  south: [0, 2],
  southwest: [-1, 1],
  northwest: [-1, -1]
};

const DIRECTIONS = Object.keys(OFFSET) as Direction[];
const coordinate = { x: 9, y: 3, z: 2 };

function towardTip(direction: Direction) {
  const { tail } = wallTip({ coordinate, direction });
  const centre = worldOf(coordinate);
  return { x: tail.x - centre.x, y: tail.y - centre.y };
}

describe("the tip of a route that ran into a wall", () => {
  it("points each tip at the side its neighbour lies across", () => {
    for (const direction of DIRECTIONS) {
      const d = towardTip(direction);
      const centre = worldOf(coordinate);
      const neighbour = worldOf({
        x: coordinate.x + OFFSET[direction][0],
        y: coordinate.y + OFFSET[direction][1],
        z: coordinate.z
      });
      const n = { x: neighbour.x - centre.x, y: neighbour.y - centre.y };

      expect(d.x * n.x + d.y * n.y, direction).toBeGreaterThan(0);
      expect(d.x * n.y - d.y * n.x, direction).toBeCloseTo(0, 6);
    }
  });

  it("stops the tip short of the side", () => {
    for (const direction of DIRECTIONS) {
      const d = towardTip(direction);
      const length = Math.hypot(d.x, d.y);

      expect(length, direction).toBeCloseTo(WALL_TIP_REACH, 6);
      expect(length, direction).toBeLessThan((HEX_RADIUS * Math.sqrt(3)) / 2);
    }
  });

  it("lays the bar across the tip", () => {
    for (const direction of DIRECTIONS) {
      const { tail, bar } = wallTip({ coordinate, direction });
      const match = bar.match(/^M (-?[\d.]+),(-?[\d.]+) L (-?[\d.]+),(-?[\d.]+)$/);
      expect(match, bar).not.toBeNull();
      const [x1, y1, x2, y2] = match!.slice(1).map(Number);
      const d = towardTip(direction);

      expect(Math.abs((x1 + x2) / 2 - tail.x)).toBeLessThan(0.01);
      expect(Math.abs((y1 + y2) / 2 - tail.y)).toBeLessThan(0.01);
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(2 * WALL_TIP_HALF_LENGTH, 2);
      expect((x2 - x1) * d.x + (y2 - y1) * d.y).toBeCloseTo(0, 2);
    }
  });
});
