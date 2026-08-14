import { describe, expect, it } from "vitest";
import type { Coordinate } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { regionDecorations } from "./regionDecorations";

function at(x: number, y: number, z = 1): Coordinate {
  return { x, y, z };
}

function hex(overrides: Partial<HexNode> & { coordinate: Coordinate; province: string }): HexNode {
  return {
    regionId: `${overrides.coordinate.z}:${overrides.coordinate.x},${overrides.coordinate.y}`,
    terrain: "plain",
    label: "",
    knowledge: "current",
    lastSeenTurn: 1,
    ageInTurns: 0,
    settlementName: null,
    region: null,
    ownUnitCount: 0,
    foreignUnitCount: 0,
    ...overrides
  };
}

describe("grouping hexes into pieces", () => {
  it("groups the hexes of one province into a single piece, and a province discovered in two places into two pieces", () => {
    const hexes = [
      hex({ coordinate: at(7, 53), province: "Inhead" }),
      hex({ coordinate: at(8, 54), province: "Inhead" }),
      // Far away - same province, no shared neighbour, so a second piece.
      hex({ coordinate: at(20, 40), province: "Inhead" }),
      hex({ coordinate: at(7, 51), province: "Somewhere Else" })
    ];

    const pieces = regionDecorations(hexes, 1);
    const inheadPieces = pieces.filter((piece) => piece.province === "Inhead");

    expect(inheadPieces).toHaveLength(2);
    expect(inheadPieces.map((piece) => piece.hexCount).sort()).toEqual([1, 2]);
    expect(pieces.filter((piece) => piece.province === "Somewhere Else")).toHaveLength(1);
  });

  it("skips hexes with no province, never grouping them into a piece named \"\"", () => {
    const hexes = [
      hex({ coordinate: at(7, 53), province: "" }),
      hex({ coordinate: at(8, 54), province: "" })
    ];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces).toHaveLength(0);
  });

  it("excludes hexes on another level, so an underground province never merges with the surface one above it", () => {
    const hexes = [
      hex({ coordinate: at(7, 53, 1), province: "Inhead" }),
      hex({ coordinate: at(7, 53, 2), province: "Inhead Below" })
    ];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces).toHaveLength(1);
    expect(pieces[0].province).toBe("Inhead");
  });

  it("groups a hex known only by name the same as a visited one", () => {
    const hexes = [
      hex({ coordinate: at(7, 53), province: "Inhead", knowledge: "current" }),
      hex({ coordinate: at(8, 54), province: "Inhead", knowledge: "named" })
    ];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces).toHaveLength(1);
    expect(pieces[0].hexCount).toBe(2);
  });
});

describe("the boundary path", () => {
  it("outlines a lone hex as six edges", () => {
    const hexes = [hex({ coordinate: at(7, 53), province: "Inhead" })];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces[0].outline.match(/M/g)).toHaveLength(6);
  });

  it("outlines two adjacent hexes of one province with ten edges, not twelve", () => {
    const hexes = [
      hex({ coordinate: at(7, 53), province: "Inhead" }),
      hex({ coordinate: at(8, 54), province: "Inhead" })
    ];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces[0].outline.match(/M/g)).toHaveLength(10);
  });

  it("draws no segment through the midpoint of the edge shared between two adjacent hexes", () => {
    const hexes = [
      hex({ coordinate: at(7, 53), province: "Inhead" }),
      hex({ coordinate: at(8, 54), province: "Inhead" })
    ];

    const pieces = regionDecorations(hexes, 1);

    // The shared edge, in world units, is the one whose corner pair points toward the neighbour
    // at (8,54) from (7,53) - offset (1,1), corner index 0 (0 -> 1). Its midpoint should not be
    // an endpoint of any drawn segment.
    const midpoint = "M22.5,7.79";
    expect(pieces[0].outline).not.toContain(midpoint);
  });
});

describe("label placement", () => {
  it("places the label at the centroid of a compact piece", () => {
    const hexes = [
      hex({ coordinate: at(7, 53), province: "Inhead" }),
      hex({ coordinate: at(8, 54), province: "Inhead" }),
      hex({ coordinate: at(6, 54), province: "Inhead" })
    ];

    const pieces = regionDecorations(hexes, 1);

    const expectedX = (7 + 8 + 6) / 3;
    expect(pieces[0].label.x).toBeCloseTo(expectedX * 27, 1); // COLUMN_PITCH = 18*1.5
  });

  it("anchors a concave piece's label to the hex nearest its off-piece centroid", () => {
    // A checkmark: two diagonal arms meeting at (2,2), whose average centre lands in the notch
    // between the arms rather than inside any hex of the piece.
    const hexes = [
      hex({ coordinate: at(0, 0), province: "Bendwood" }),
      hex({ coordinate: at(1, 1), province: "Bendwood" }),
      hex({ coordinate: at(2, 2), province: "Bendwood" }),
      hex({ coordinate: at(3, 1), province: "Bendwood" }),
      hex({ coordinate: at(4, 0), province: "Bendwood" })
    ];

    const pieces = regionDecorations(hexes, 1);
    const piece = pieces[0];

    // The centre hex of the checkmark, (2,2), is the one nearest the notch the raw centroid
    // falls into.
    expect(piece.label.x).toBeCloseTo(2 * 27, 1);
    expect(piece.label.y).toBeCloseTo(2 * 15.588457, 1);
  });
});

describe("fitting the label to the piece", () => {
  it("keeps a short name at full size on a roomy piece", () => {
    const hexes = Array.from({ length: 9 }, (_, i) =>
      hex({ coordinate: at(i * 2, 0), province: "Oz" })
    );

    const pieces = regionDecorations(hexes, 1);

    expect(pieces[0].label.fontSize).toBeCloseTo(11, 5);
    expect(pieces[0].label.letterSpacing).toBeCloseTo(3.4, 5);
  });

  it("scales a long name down on a three-hex piece", () => {
    const hexes = [
      hex({ coordinate: at(0, 0), province: "Long Province" }),
      hex({ coordinate: at(1, 1), province: "Long Province" }),
      hex({ coordinate: at(2, 2), province: "Long Province" })
    ];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces[0].label.fontSize).toBeLessThan(11);
    expect(pieces[0].label.fontSize).toBeGreaterThan(11 * 0.42);
  });

  it("never scales below the floor, and still emits the name", () => {
    const hexes = [
      hex({
        coordinate: at(0, 0),
        province: "An Extraordinarily Long Provincial Name That Cannot Possibly Fit"
      })
    ];

    const pieces = regionDecorations(hexes, 1);

    expect(pieces[0].label.fontSize).toBeCloseTo(11 * 0.42, 5);
    expect(pieces[0].label.text).toBe(
      "An Extraordinarily Long Provincial Name That Cannot Possibly Fit"
    );
  });
});

describe("growing as more is discovered", () => {
  it("outlines the larger area once a piece gains an adjacent hex, and merges two pieces that grow together", () => {
    const before = regionDecorations(
      [
        hex({ coordinate: at(7, 53), province: "Inhead" }),
        hex({ coordinate: at(20, 40), province: "Inhead" })
      ],
      1
    );
    expect(before.filter((p) => p.province === "Inhead")).toHaveLength(2);

    const after = regionDecorations(
      [
        hex({ coordinate: at(7, 53), province: "Inhead" }),
        hex({ coordinate: at(8, 54), province: "Inhead" }),
        hex({ coordinate: at(20, 40), province: "Inhead" })
      ],
      1
    );
    const afterInhead = after.filter((p) => p.province === "Inhead");
    expect(afterInhead).toHaveLength(2);
    expect(afterInhead.map((p) => p.hexCount).sort()).toEqual([1, 2]);
  });
});
