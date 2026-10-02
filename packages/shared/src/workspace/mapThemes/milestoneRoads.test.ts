import { describe, expect, it } from "vitest";
import { HEX_RADIUS } from "../mapViewport";
import type { HexView, RoadDirection } from "./hexView";
import { roadNetwork } from "./milestoneRoads";

const STEP = Math.sqrt(3) * HEX_RADIUS;

function hex(at: { x: number; y: number }, roads: RoadDirection[], unfinishedRoads: RoadDirection[] = []): HexView {
  return { key: `${at.x},${at.y}`, at, roads, unfinishedRoads } as unknown as HexView;
}

describe("the milestone road network", () => {
  it("marks an edge as connected only when the hex beyond has the road back", () => {
    const network = roadNetwork([
      hex({ x: 0, y: 0 }, ["n", "s"]),
      hex({ x: 0, y: -STEP }, ["s"])
    ]);
    const north = network.milestones.find((stone) => stone.y < 0)!;
    const south = network.milestones.find((stone) => stone.y > 0)!;
    expect(north.connected).toBe(true);
    expect(south.connected).toBe(false);
  });

  it("puts one milestone on a shared edge, not one per hex", () => {
    const network = roadNetwork([hex({ x: 0, y: 0 }, ["n"]), hex({ x: 0, y: -STEP }, ["s"])]);
    expect(network.milestones).toHaveLength(1);
  });

  it("curves a hex with two roads, half by half, and keeps a junction's spokes", () => {
    const network = roadNetwork([hex({ x: 0, y: 0 }, ["n", "se"]), hex({ x: 500, y: 0 }, ["n", "s", "sw"])]);
    expect(network.pieces.filter((piece) => piece.d.includes("Q"))).toHaveLength(2);
    expect(network.pieces.filter((piece) => piece.d.includes("L"))).toHaveLength(3);
    expect(network.junctions).toEqual([{ x: 500, y: 0 }]);
  });

  it("dots only the road that still needs building", () => {
    const network = roadNetwork([hex({ x: 0, y: 0 }, ["n", "s"], ["s"])]);
    expect(network.pieces.map((piece) => piece.unfinished)).toEqual([false, true]);
  });
});
