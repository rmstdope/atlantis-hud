import type { Coordinate, ParsedReport, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  abbreviateDirection,
  buildHexMapModel,
  hexCorners,
  hexToPixel,
  isValidCoordinate,
  parseRegionId,
  regionIdOf,
  unitsForHex,
  type StoredRegion
} from "./hexMapModel";

const at = (x: number, y: number, z = 1): Coordinate => ({ x, y, z });

function unit(unitId: string, own: boolean, name = unitId): ReportUnit {
  return {
    unitId,
    name,
    regionId: "1:7,53",
    factionId: own ? "95" : "32",
    factionName: own ? "Borg TNG" : "Elder Tree Forests",
    own,
    onGuard: false,
    flags: [],
    items: [],
    skills: [],
    men: 1,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null
  };
}

function region(
  coordinate: Coordinate,
  overrides: Partial<ReportRegion> = {}
): ReportRegion {
  return {
    regionId: `${coordinate.z}:${coordinate.x},${coordinate.y}`,
    coordinate,
    terrain: "mountain",
    province: "Inhead",
    settlement: null,
    population: null,
    race: null,
    taxBase: null,
    wages: null,
    maxWages: null,
    entertainment: null,
    products: [],
    wanted: [],
    forSale: [],
    exits: [],
    structures: [],
    units: [],
    ...overrides
  };
}

function report(regions: ReportRegion[], turnNumber: number | null = 71): ParsedReport {
  return {
    header: {
      factionId: "95",
      factionName: "Borg TNG",
      factionTypes: [],
      month: "December",
      year: 6,
      turnNumber,
      engineVersion: null,
      ruleset: null,
      rulesetVersion: null,
      unclaimedSilver: null,
      errors: [],
      events: []
    },
    regions,
    ordersTemplate: null
  };
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
    // Levels are counted from the surface, which is one.
    expect(parseRegionId("0:7,53")).toBeNull();
    expect(parseRegionId("-1:7,53")).toBeNull();
    // Only positions where x + y is even exist.
    expect(parseRegionId("1:7,52")).toBeNull();
    expect(parseRegionId("1:-3,0")).toBeNull();
  });
});

describe("map knowledge", () => {
  it("marks regions in this report as current", () => {
    const model = buildHexMapModel(report([region(at(7, 53))]));

    expect(model.hexes).toHaveLength(1);
    expect(model.hexes[0].knowledge).toBe("current");
    expect(model.hexes[0].ageInTurns).toBe(0);
  });

  it("marks a neighbour named only by an exit as known by name", () => {
    const model = buildHexMapModel(
      report([
        region(at(7, 53), {
          exits: [
            {
              direction: "North",
              terrain: "ocean",
              coordinate: at(7, 51),
              province: "Atlantis Ocean",
              settlement: null
            }
          ]
        })
      ])
    );

    const neighbour = model.hexes.find((hex) => hex.regionId === "1:7,51");
    expect(neighbour?.knowledge).toBe("named");
    expect(neighbour?.terrain).toBe("ocean");
    // Known by name carries no detail, which is exactly what distinguishes it from visited.
    expect(neighbour?.region).toBeNull();
  });

  it("marks a region held over from an earlier turn as stale, and ages it", () => {
    const stored: StoredRegion = {
      regionId: "1:26,52",
      coordinate: at(26, 52),
      terrain: "ocean",
      province: "Atlantis Ocean",
      label: "ocean (26,52) in Atlantis Ocean",
      lastSeenTurn: 64,
      region: null
    };

    const model = buildHexMapModel(report([region(at(7, 53))]), [stored]);
    const old = model.hexes.find((hex) => hex.regionId === "1:26,52");

    expect(old?.knowledge).toBe("stale");
    expect(old?.lastSeenTurn).toBe(64);
    expect(old?.ageInTurns).toBe(7);
  });

  it("lets this turn's report override an older sighting of the same hex", () => {
    const stored: StoredRegion = {
      regionId: "1:7,53",
      coordinate: at(7, 53),
      terrain: "mountain",
      province: "Inhead",
      label: "stale label",
      lastSeenTurn: 60,
      region: null
    };

    const model = buildHexMapModel(report([region(at(7, 53))]), [stored]);

    expect(model.hexes).toHaveLength(1);
    expect(model.hexes[0].knowledge).toBe("current");
    expect(model.hexes[0].lastSeenTurn).toBe(71);
  });

  it("lets a stored sighting override a hex merely named by an exit", () => {
    // Having been there beats having only heard of it.
    const stored: StoredRegion = {
      regionId: "1:7,51",
      coordinate: at(7, 51),
      terrain: "mountain",
      province: "Inhead",
      label: "mountain (7,51) in Inhead",
      lastSeenTurn: 65,
      region: null
    };

    const model = buildHexMapModel(
      report([
        region(at(7, 53), {
          exits: [
            {
              direction: "North",
              terrain: "mountain",
              coordinate: at(7, 51),
              province: "Inhead",
              settlement: null
            }
          ]
        })
      ]),
      [stored]
    );

    expect(model.hexes.find((hex) => hex.regionId === "1:7,51")?.knowledge).toBe("stale");
  });

  it("leaves age unknown when the report has no turn number", () => {
    const stored: StoredRegion = {
      regionId: "1:26,52",
      coordinate: at(26, 52),
      terrain: "ocean",
      province: "Atlantis Ocean",
      label: "ocean",
      lastSeenTurn: 64,
      region: null
    };

    const model = buildHexMapModel(report([], null), [stored]);
    expect(model.hexes[0].ageInTurns).toBeNull();
  });

  it("reports every level the world spans", () => {
    const model = buildHexMapModel(
      report([region(at(7, 53)), region(at(7, 53, 2), { terrain: "cavern" })])
    );
    expect(model.levels).toEqual([1, 2]);
  });
});

describe("opening selection", () => {
  it("opens on a hex the player has units in", () => {
    const model = buildHexMapModel(
      report([
        region(at(7, 53), { units: [unit("1", false)] }),
        region(at(9, 53), { units: [unit("2", true)] })
      ])
    );

    expect(model.initialSelectedRegionId).toBe("1:9,53");
  });

  it("falls back to any visited hex when the player has none", () => {
    const model = buildHexMapModel(report([region(at(7, 53), { units: [unit("1", false)] })]));
    expect(model.initialSelectedRegionId).toBe("1:7,53");
  });

  it("selects nothing when the world is empty", () => {
    expect(buildHexMapModel(report([])).initialSelectedRegionId).toBeNull();
  });
});

describe("unit ordering", () => {
  it("puts your own units first, so one of ninety-two is not buried", () => {
    const hex = buildHexMapModel(
      report([
        region(at(7, 53), {
          units: [unit("a", false, "Alpha"), unit("b", true, "Zulu"), unit("c", false, "Beta")]
        })
      ])
    ).hexes[0];

    expect(unitsForHex(hex).map((entry) => entry.name)).toEqual(["Zulu", "Alpha", "Beta"]);
  });

  it("returns nothing for a hex with no detail", () => {
    expect(unitsForHex(null)).toEqual([]);
  });
});

/**
 * A hex the player stands in that an ally also stood in this turn.
 *
 * Merging (issue #53) writes the combined hex into storage, but the current report wins any hex it
 * describes, so without an additive rule the merged detail would be stored and never drawn.
 */
describe("a hex an ally also saw this turn", () => {
  const stored = (units: ReportUnit[], lastSeenTurn: number): StoredRegion => ({
    regionId: "1:7,53",
    coordinate: at(7, 53),
    terrain: "mountain",
    province: "Inhead",
    label: "mountain (7,53) in Inhead",
    lastSeenTurn,
    region: region(at(7, 53), { units })
  });

  const mine = region(at(7, 53), { units: [unit("13432", true, "Drone")] });

  it("gains the units the ally saw there", () => {
    const hex = buildHexMapModel(report([mine]), [
      stored([unit("13432", false, "Drone"), unit("2001", false, "Swamp Watch")], 71)
    ]).hexes[0];

    expect(unitsForHex(hex).map((entry) => entry.name)).toEqual(["Drone", "Swamp Watch"]);
    expect(hex.foreignUnitCount).toBe(1);
  });

  it("loses none of its own, and keeps its own account of them", () => {
    const hex = buildHexMapModel(report([mine]), [
      stored([unit("13432", false, "Drone as the ally saw it"), unit("2001", false)], 71)
    ]).hexes[0];

    const drone = unitsForHex(hex)[0];
    expect(drone.name).toBe("Drone");
    expect(drone.own).toBe(true);
    expect(hex.ownUnitCount).toBe(1);
  });

  /**
   * The merge marks everything it contributes as somebody else's before storing it. Trusting that
   * blindly would be one release away from a bug, so the rule restates it rather than assuming it.
   */
  it("does not hand the player command of the ally's units", () => {
    const hex = buildHexMapModel(report([mine]), [stored([unit("2001", true, "Swamp Watch")], 71)])
      .hexes[0];

    expect(unitsForHex(hex).find((entry) => entry.unitId === "2001")?.own).toBe(false);
    expect(hex.ownUnitCount).toBe(1);
  });

  it("is still the current report's hex, not a stale one", () => {
    const hex = buildHexMapModel(report([mine]), [stored([unit("2001", false)], 71)]).hexes[0];

    expect(hex.knowledge).toBe("current");
    expect(hex.ageInTurns).toBe(0);
  });

  /** An earlier turn describes the hex before whatever has happened in it since. */
  it("does not let an earlier turn's memory of the hex intrude", () => {
    const hex = buildHexMapModel(report([mine]), [
      stored([unit("2001", false, "Swamp Watch")], 63)
    ]).hexes[0];

    expect(unitsForHex(hex).map((entry) => entry.name)).toEqual(["Drone"]);
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
