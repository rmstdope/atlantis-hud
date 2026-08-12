import { describe, expect, it } from "vitest";
import type { HexNode } from "../hexMapModel";
import {
  boundsOfKnown,
  hexesInRect,
  rectFromCorners,
  rectPixels,
  rectContains
} from "./mapMarquee";
import { COLUMN_PITCH, ROW_PITCH } from "./mapViewport";

function hex(x: number, y: number, knowledge: HexNode["knowledge"] = "current"): HexNode {
  return {
    regionId: `1:${x},${y}`,
    coordinate: { x, y, z: 1 },
    terrain: "plain",
    province: "Nowhere",
    label: `plain (${x},${y}) in Nowhere`,
    knowledge,
    lastSeenTurn: 71,
    ageInTurns: 0,
    settlementName: null,
    region: null,
    ownUnitCount: 0,
    foreignUnitCount: 0
  };
}

describe("the export rectangle", () => {
  it("reads a drag from either corner as the same rectangle", () => {
    const dragged = rectFromCorners({ x: 8, y: 54, z: 1 }, { x: 4, y: 50, z: 1 });

    expect(dragged).toEqual({ fromX: 4, fromY: 50, toX: 8, toY: 54 });
    expect(rectFromCorners({ x: 4, y: 50, z: 1 }, { x: 8, y: 54, z: 1 })).toEqual(dragged);
  });

  it("holds a single hex when the drag never left it", () => {
    expect(rectFromCorners({ x: 6, y: 52, z: 1 }, { x: 6, y: 52, z: 1 })).toEqual({
      fromX: 6,
      fromY: 52,
      toX: 6,
      toY: 52
    });
  });

  it("includes its own edges", () => {
    const rect = { fromX: 4, fromY: 50, toX: 8, toY: 54 };

    expect(rectContains(rect, { x: 4, y: 50, z: 1 })).toBe(true);
    expect(rectContains(rect, { x: 8, y: 54, z: 1 })).toBe(true);
    expect(rectContains(rect, { x: 3, y: 50, z: 1 })).toBe(false);
    expect(rectContains(rect, { x: 4, y: 56, z: 1 })).toBe(false);
  });

  /**
   * The corner fields are typed by hand, so a rectangle can be back to front for as long as it
   * takes to fill in the other corner. The core reads such a rectangle in either order; if this
   * did not, the dialog would call it empty and disable the button on an export that would work.
   */
  it("holds the same hexes when its corners are the wrong way round", () => {
    const backwards = { fromX: 8, fromY: 54, toX: 4, toY: 50 };

    expect(rectContains(backwards, { x: 6, y: 52, z: 1 })).toBe(true);
    expect(rectContains(backwards, { x: 20, y: 60, z: 1 })).toBe(false);
    expect(hexesInRect([hex(4, 50), hex(20, 60)], backwards, 1)).toBe(1);
  });

  /**
   * The count is what the dialog shows before the player commits, so it has to mean the same thing
   * the file will: hexes known only by name from a neighbour's exits are drawn on the map but get
   * no region block, and counting them would promise more than the export delivers.
   */
  it("counts only the hexes an export would write", () => {
    const hexes = [hex(4, 50), hex(6, 52, "stale"), hex(8, 54, "named"), hex(20, 60)];

    expect(hexesInRect(hexes, { fromX: 4, fromY: 50, toX: 8, toY: 54 }, 1)).toBe(2);
  });

  it("counts only the level being exported", () => {
    const below: HexNode = { ...hex(6, 52), coordinate: { x: 6, y: 52, z: 2 } };

    expect(hexesInRect([hex(4, 50), below], { fromX: 4, fromY: 50, toX: 8, toY: 54 }, 1)).toBe(1);
  });

  it("frames everything known on the level when nothing has been dragged", () => {
    const below: HexNode = { ...hex(30, 30), coordinate: { x: 30, y: 30, z: 2 } };
    const hexes = [hex(4, 50), hex(8, 54, "stale"), hex(9, 55, "named"), below];

    expect(boundsOfKnown(hexes, 1)).toEqual({ fromX: 4, fromY: 50, toX: 8, toY: 54 });
  });

  it("frames nothing when the level holds nothing visited", () => {
    expect(boundsOfKnown([hex(4, 50, "named")], 1)).toBeNull();
  });

  /**
   * The band is drawn inside the same group the hexes are, so it is in world units and needs no
   * view transform of its own. It reaches half a hex past the corner hexes, which is what makes
   * the hexes it covers look covered.
   */
  it("covers the corner hexes it names", () => {
    const band = rectPixels({ fromX: 4, fromY: 50, toX: 8, toY: 54 });

    expect(band.x).toBeLessThan(4 * COLUMN_PITCH);
    expect(band.y).toBeLessThan(50 * ROW_PITCH);
    expect(band.x + band.width).toBeGreaterThan(8 * COLUMN_PITCH);
    expect(band.y + band.height).toBeGreaterThan(54 * ROW_PITCH);
  });

  /**
   * A band drawn past the centres of the neighbouring rows would show hexes as selected that the
   * export leaves out - the one thing this module exists to get right. A flat-top hex is half a
   * radius wide and half a row pitch tall, and the two are not the same number.
   */
  it("stops short of the hexes just outside it", () => {
    const band = rectPixels({ fromX: 4, fromY: 50, toX: 8, toY: 54 });

    // The next hexes north and south sit two row pitches away, not one: the lattice only holds
    // positions where x + y is even. The band reaches the corner hexes' own edges and no further.
    expect(band.y).toBeGreaterThan(48 * ROW_PITCH);
    expect(band.y + band.height).toBeLessThan(56 * ROW_PITCH);
    expect(band.x).toBeGreaterThan(3 * COLUMN_PITCH);
    expect(band.x + band.width).toBeLessThan(9 * COLUMN_PITCH);
  });

  it("draws the same band for a rectangle typed back to front", () => {
    expect(rectPixels({ fromX: 8, fromY: 54, toX: 4, toY: 50 })).toEqual(
      rectPixels({ fromX: 4, fromY: 50, toX: 8, toY: 54 })
    );
  });
});
