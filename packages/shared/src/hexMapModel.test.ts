import type { Coordinate, KnownMap, KnownMapHex, MapLevel, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  abbreviateDirection,
  buildHexMapModel,
  hexCorners,
  hexNodeOf,
  hexToPixel,
  isValidCoordinate,
  levelClause,
  levelNameOf,
  parseRegionId,
  regionIdOf,
  sortUnitsForDisplay,
  unitsForHex,
  type HexNode
} from "./hexMapModel";

const at = (x: number, y: number, z = 1): Coordinate => ({ x, y, z });

const unit = (unitId: string, own: boolean, name = unitId): ReportUnit => aReportUnit({ unitId, own, name });

const region = (coordinate: Coordinate, overrides: Partial<ReportRegion> = {}): ReportRegion =>
  aReportRegion({ coordinate, ...overrides });

/** One resolved hex, as the core hands it over. */
function knownHex(overrides: Partial<KnownMapHex> = {}): KnownMapHex {
  return {
    coordinate: at(7, 53),
    terrain: "mountain",
    province: "Inhead",
    knowledge: "current",
    lastSeenTurn: 71,
    region: null,
    settlement: null,
    ...overrides
  };
}

function knownMap(
  hexes: KnownMapHex[],
  currentTurn: number | null = 71,
  levels: MapLevel[] = []
): KnownMap {
  return { hexes, currentTurn, levels };
}

describe("hex geometry", () => {
  it("places north and south as direct neighbours, which is what flat-top means", () => {
    const centre = hexToPixel(at(10, 20), 16);
    const north = hexToPixel(at(10, 18), 16);
    const south = hexToPixel(at(10, 22), 16);

    expect(north.x).toBe(centre.x);
    expect(south.x).toBe(centre.x);
    expect(centre.y - north.y).toBeCloseTo(south.y - centre.y);
    expect(centre.y - north.y).toBeGreaterThan(0);
  });

  it("places the diagonals one column across and half a row down", () => {
    const centre = hexToPixel(at(10, 20), 16);
    const northeast = hexToPixel(at(11, 19), 16);

    expect(northeast.x).toBeGreaterThan(centre.x);
    expect(centre.y - northeast.y).toBeCloseTo((centre.y - hexToPixel(at(10, 18), 16).y) / 2);
  });

  it("traces a hexagon with a vertex due east, not due north", () => {
    const corners = hexCorners(10);

    expect(corners).toHaveLength(6);
    expect(corners[0]).toEqual({ x: 10, y: 0 });
    // A pointy-top hexagon would have a corner at (0, -10); a flat-top one does not.
    expect(corners.some((corner) => Math.abs(corner.x) < 0.001)).toBe(false);
  });

  it("rejects coordinates the lattice has no room for", () => {
    expect(isValidCoordinate(at(7, 53))).toBe(true);
    expect(isValidCoordinate(at(7, 52))).toBe(false);
  });
});

/**
 * A hex is addressed as `z:x,y` everywhere - in the core's findings, in the planner's requests, and
 * as the map's own selection. Unexplored ground has no region behind it, so the id is all there is,
 * and reading one back has to give the coordinate it names.
 */
describe("addressing a hex", () => {
  it("writes and reads the id the game uses", () => {
    expect(regionIdOf(at(7, 53))).toBe("1:7,53");
    expect(regionIdOf(at(-3, 5, 2))).toBe("2:-3,5");

    for (const coordinate of [at(7, 53), at(-3, 5, 2), at(0, 0), at(112, -68)]) {
      expect(parseRegionId(regionIdOf(coordinate))).toEqual(coordinate);
    }
  });

  it("refuses anything that is not one", () => {
    for (const text of ["", "7,53", "1:7", "surface:7,53", "1:7,x", "1:7,53,2"]) {
      expect(parseRegionId(text), `${text} should not read as a hex`).toBeNull();
    }
  });

  /**
   * A garbled id has to read as no hex rather than as a hex that cannot exist. Anything else puts a
   * selection ring on a position off the lattice, or a heading naming a level nobody plays on, and
   * the panel looks as though it knows something.
   */
  it("refuses a hex the game could not hold", () => {
    // The nexus is level 0, so a level of zero is a hex, not a refusal.
    expect(parseRegionId("0:7,53")).toEqual({ z: 0, x: 7, y: 53 });
    expect(parseRegionId("-1:7,53")).toBeNull();
    // Only positions where x + y is even exist.
    expect(parseRegionId("1:7,52")).toBeNull();
    expect(parseRegionId("1:-3,0")).toBeNull();
  });
});

/**
 * `buildHexMapModel` and `hexNodeOf` are a synchronous, rule-free conversion of the core's resolved
 * `KnownMap` into what the map draws. Every precedence rule - which hex is current, stale or named,
 * whose naming won, whose units count - is `known_map::resolve_known_map`'s, pinned in
 * `crates/core/tests/known_map.rs`; nothing here re-derives them.
 */
describe("converting the known map", () => {
  it("a resolved hex becomes a node the map can draw", () => {
    const hex = knownHex({
      knowledge: "current",
      lastSeenTurn: 71,
      settlement: { name: "Inholm", size: "city" },
      region: region(at(7, 53), {
        units: [unit("1", true, "Alpha"), unit("2", false, "Elder")]
      })
    });

    const node = hexNodeOf(hex, 71);

    expect(node.regionId).toBe("1:7,53");
    expect(node.label).toBe("mountain (7,53) in Inhead");
    expect(node.ageInTurns).toBe(0);
    expect(node.settlementName).toBe("Inholm");
    expect(node.ownUnitCount).toBe(1);
    expect(node.foreignUnitCount).toBe(1);
  });

  it("a stale hex is aged against the current turn", () => {
    const hex = knownHex({ knowledge: "stale", lastSeenTurn: 68, region: region(at(7, 53)) });

    const node = hexNodeOf(hex, 71);

    expect(node.ageInTurns).toBe(3);
  });

  it("a named hex has no age, no region and no units, but keeps its settlement name", () => {
    const hex = knownHex({
      knowledge: "named",
      lastSeenTurn: 64,
      region: null,
      settlement: { name: "Foo", size: "village" }
    });

    const node = hexNodeOf(hex, 71);

    expect(node.ageInTurns).toBeNull();
    expect(node.region).toBeNull();
    expect(node.ownUnitCount).toBe(0);
    expect(node.foreignUnitCount).toBe(0);
    expect(node.settlementName).toBe("Foo");
  });

  it("age is unknown when the report has no turn number", () => {
    const hex = knownHex({ knowledge: "current", lastSeenTurn: null });

    const node = hexNodeOf(hex, null);

    expect(node.ageInTurns).toBeNull();
  });

  it("levels are copied verbatim from the known map, the core's order kept", () => {
    const levels: MapLevel[] = [
      { z: 1, name: "surface" },
      { z: 2, name: "underworld" }
    ];
    const model = buildHexMapModel(
      knownMap(
        [knownHex({ coordinate: at(7, 53, 2) }), knownHex({ coordinate: at(7, 53, 1) })],
        71,
        levels
      )
    );

    expect(model.levels).toEqual(levels);
  });

  it("the core's order is kept", () => {
    const inOrder = [
      knownHex({ coordinate: at(5, 3) }),
      knownHex({ coordinate: at(5, 7) }),
      knownHex({ coordinate: at(4, 6) })
    ];

    const model = buildHexMapModel(knownMap(inOrder));
    expect(model.hexes.map((hex) => hex.coordinate)).toEqual(inOrder.map((hex) => hex.coordinate));

    const reversed = [...inOrder].reverse();
    const reversedModel = buildHexMapModel(knownMap(reversed));
    expect(reversedModel.hexes.map((hex) => hex.coordinate)).toEqual(
      reversed.map((hex) => hex.coordinate)
    );
  });

  it("currentTurn is carried through from the known map", () => {
    const model = buildHexMapModel(knownMap([knownHex()], 42));
    expect(model.currentTurn).toBe(42);
  });
});

describe("levels", () => {
  const levels: MapLevel[] = [
    { z: 0, name: "nexus" },
    { z: 1, name: "surface" }
  ];

  it("names a level the map holds, and nothing for one it does not", () => {
    expect(levelNameOf(levels, 0)).toBe("nexus");
    expect(levelNameOf(levels, 2)).toBeNull();
  });

  it("the region panel's clause names the level, or is silent on the surface", () => {
    expect(levelClause(levels, 1)).toBe("");
    expect(levelClause(levels, 0)).toBe(", in the nexus");
    expect(levelClause([{ z: 2, name: "underworld" }], 2)).toBe(", in the underworld");
    expect(levelClause([{ z: 5, name: "level 5" }], 5)).toBe(", on level 5");
    expect(levelClause([], 2)).toBe("");
  });
});

describe("unit ordering", () => {
  function hexWith(units: ReportUnit[]): HexNode {
    return hexNodeOf(knownHex({ region: region(at(7, 53), { units }) }), 71);
  }

  it("puts your own units first, so one of ninety-two is not buried", () => {
    const hex = hexWith([unit("a", false, "Alpha"), unit("b", true, "Zulu"), unit("c", false, "Beta")]);

    expect(unitsForHex(hex).map((entry) => entry.name)).toEqual(["Zulu", "Alpha", "Beta"]);
  });

  it("returns nothing for a hex with no detail", () => {
    expect(unitsForHex(null)).toEqual([]);
  });

  it("sorts directly too, own units first then by name", () => {
    const sorted = sortUnitsForDisplay([
      unit("a", false, "Alpha"),
      unit("b", true, "Zulu"),
      unit("c", false, "Beta")
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual(["Zulu", "Alpha", "Beta"]);
  });
});

/**
 * The region panel's exits list uses the compass shorthand every Atlantis player writes MOVE
 * orders in, not the report's long names - "SE" is both shorter and the word the game speaks.
 */
describe("abbreviateDirection", () => {
  it("shortens the six compass directions", () => {
    expect(abbreviateDirection("North")).toBe("N");
    expect(abbreviateDirection("Northeast")).toBe("NE");
    expect(abbreviateDirection("Southeast")).toBe("SE");
    expect(abbreviateDirection("South")).toBe("S");
    expect(abbreviateDirection("Southwest")).toBe("SW");
    expect(abbreviateDirection("Northwest")).toBe("NW");
  });

  it("shortens regardless of the report's casing", () => {
    expect(abbreviateDirection("southeast")).toBe("SE");
  });

  it("passes through a direction it does not know rather than guessing", () => {
    expect(abbreviateDirection("Portal")).toBe("Portal");
  });
});
