import type { Coordinate, Direction, MapWall } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { corners } from "./mapHexView";
import { HEX_RADIUS, worldOf } from "./mapViewport";
import { wallMarks, wallNote } from "./wallMarks";

const CAVERN: Coordinate = { x: 9, y: 3, z: 2 };

const NEIGHBOUR: Record<Direction, [number, number]> = {
  north: [0, -2],
  northeast: [1, -1],
  southeast: [1, 1],
  south: [0, 2],
  southwest: [-1, 1],
  northwest: [-1, -1]
};

function wall(direction: Direction, from: Coordinate = CAVERN, extraProof?: Coordinate): MapWall {
  const [dx, dy] = NEIGHBOUR[direction];
  const to = { x: from.x + dx, y: from.y + dy, z: from.z };
  const provenBy = [{ coordinate: from, terrain: "cavern" }];
  if (extraProof) {
    provenBy.push({ coordinate: extraProof, terrain: "cavern" });
  }
  return { from, direction, to, provenBy };
}

function numbers(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function points(attribute: string): { x: number; y: number }[] {
  return attribute.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
}

describe("where a wall is drawn", () => {
  it("draws a north wall along the hex's top side", () => {
    const [mark] = wallMarks([wall("north")], 2);
    const [x1, y1, x2, y2] = numbers(mark.bar);
    const centre = worldOf(CAVERN);
    const c = corners(HEX_RADIUS);

    expect(x1).toBeCloseTo(centre.x + c[4].x, 1);
    expect(y1).toBeCloseTo(centre.y + c[4].y, 1);
    expect(x2).toBeCloseTo(centre.x + c[5].x, 1);
    expect(y2).toBeCloseTo(centre.y + c[5].y, 1);
  });

  it("puts every direction on the side its neighbour lies across", () => {
    for (const direction of Object.keys(NEIGHBOUR) as Direction[]) {
      const w = wall(direction);
      const [mark] = wallMarks([w], 2);
      const [x1, y1, x2, y2] = numbers(mark.bar);
      const from = worldOf(w.from);
      const to = worldOf(w.to);
      const mid = { x: (x1 + x2) / 2 - from.x, y: (y1 + y2) / 2 - from.y };
      const toward = { x: to.x - from.x, y: to.y - from.y };
      const length = Math.hypot(mid.x, mid.y) * Math.hypot(toward.x, toward.y);

      expect(mid.x * toward.x + mid.y * toward.y, direction).toBeGreaterThan(0);
      expect(Math.abs(mid.x * toward.y - mid.y * toward.x) / length, direction).toBeLessThan(0.01);
    }
  });

  it("draws only the walls on the level being viewed", () => {
    const surface = wall("north", { x: 9, y: 3, z: 1 });
    const underground = wall("north");

    expect(wallMarks([surface, underground], 2).map((mark) => mark.key)).toEqual(["9,3,2:north"]);
  });

  it("crosses the bar with five ticks", () => {
    const [mark] = wallMarks([wall("north")], 2);

    expect(mark.ticks.match(/M/g)).toHaveLength(5);
  });

  it("keys a wall by where it is proven and which way", () => {
    expect(wallMarks([wall("north")], 2)[0].key).toBe("9,3,2:north");
  });
});

describe("what pointing at a wall says", () => {
  it("words the note exactly as agreed", () => {
    expect(wallNote({ coordinate: CAVERN, terrain: "cavern" }, "north")).toBe(
      "No way through: cavern (9,3,2) has no exit to the north."
    );
  });

  it("names the one proving hex on both sides", () => {
    const [mark] = wallMarks([wall("north")], 2);
    const expected = "No way through: cavern (9,3,2) has no exit to the north.";

    expect(mark.sides.map((side) => side.note)).toEqual([expected, expected]);
  });

  it("names the hex on the pointer's side when both prove it", () => {
    const [mark] = wallMarks([wall("north", CAVERN, { x: 9, y: 1, z: 2 })], 2);

    expect(mark.sides[1].note).toBe("No way through: cavern (9,1,2) has no exit to the south.");
    expect(mark.sides[1].hex).toEqual({ x: 9, y: 1, z: 2 });
  });

  it("puts each hit strip inside its own hex", () => {
    const w = wall("northeast");
    const [mark] = wallMarks([w], 2);
    const own = [worldOf(w.from), worldOf(w.to)];

    mark.sides.forEach((side, index) => {
      const corners = points(side.hit);
      const centre = {
        x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length,
        y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length
      };
      const mine = Math.hypot(centre.x - own[index].x, centre.y - own[index].y);
      const other = Math.hypot(centre.x - own[1 - index].x, centre.y - own[1 - index].y);

      expect(mine).toBeLessThan(other);
    });
  });
});
