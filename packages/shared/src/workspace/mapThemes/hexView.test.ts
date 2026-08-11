import { describe, expect, it } from "vitest";
import type { Coordinate, ReportRegion, ReportUnit, StructureInfo } from "@atlantis/core-client";
import type { HexKnowledge, HexNode } from "../../hexMapModel";
import { COLUMN_PITCH, ROW_PITCH } from "../mapViewport";
import { buildHexViews, MONSTER_FACTION_ID, ROAD_VECTORS, type HexViewOptions } from "./hexView";

function at(x: number, y: number, z = 1): Coordinate {
  return { x, y, z };
}

function structure(kind: string, name = kind): StructureInfo {
  return { structureId: `${kind}-1`, name, kind, description: null, needs: null };
}

function unit(overrides: Partial<ReportUnit> = {}): ReportUnit {
  return {
    unitId: "900",
    name: "Walker",
    regionId: "1:7,53",
    factionId: "17",
    factionName: "Foo",
    own: true,
    onGuard: false,
    flags: [],
    items: [],
    skills: [],
    men: 1,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null,
    ...overrides
  };
}

function region(overrides: Partial<ReportRegion> = {}): ReportRegion {
  return {
    regionId: "1:7,53",
    coordinate: at(7, 53),
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

function hex(overrides: Partial<HexNode> & { knowledge: HexKnowledge }): HexNode {
  return {
    regionId: "1:7,53",
    coordinate: at(7, 53),
    terrain: "mountain",
    province: "Inhead",
    label: "mountain (7,53) in Inhead",
    lastSeenTurn: 71,
    ageInTurns: 0,
    settlementName: null,
    region: null,
    ownUnitCount: 0,
    foreignUnitCount: 0,
    ...overrides
  };
}

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: true,
  showUnits: true,
  showStructures: true
};

/** The single view a one-hex model produces, which is what most of these assert against. */
function viewOf(node: HexNode, options: Partial<HexViewOptions> = {}) {
  return buildHexViews([node], { ...ALL_ON, ...options })[0];
}

describe("what a hex shows, prepared for whichever theme draws it", () => {
  it("carries the hex's identity and its place in the world, so a theme needs no geometry", () => {
    const view = viewOf(hex({ knowledge: "current", regionId: "1:7,53" }));

    expect(view.key).toBe("1:7,53");
    expect(view.at.x).toBeCloseTo(7 * COLUMN_PITCH);
    expect(view.at.y).toBeCloseTo(53 * ROW_PITCH);
  });

  it("offers the biome texture only while textures are asked for", () => {
    expect(viewOf(hex({ knowledge: "current" })).texture).toEqual({
      url: "/biomes/mountain_512.png",
      patternId: "biome-texture-mountain"
    });
    expect(viewOf(hex({ knowledge: "current" }), { showTextures: false }).texture).toBeNull();
  });

  it("leaves a terrain with no texture solid even with textures on", () => {
    expect(viewOf(hex({ knowledge: "current", terrain: "nexus" })).texture).toBeNull();
  });

  it("resolves age into how far the hex has faded, so a theme never computes it", () => {
    const stale = viewOf(hex({ knowledge: "stale", ageInTurns: 7 }));

    expect(stale.fogOpacity).toBeCloseTo(0.44);
    expect(stale.hatched).toBe(true);
    expect(stale.ageInTurns).toBe(7);
  });

  it("draws a hex from this turn's report clean", () => {
    const current = viewOf(hex({ knowledge: "current" }));

    expect(current.fogOpacity).toBe(0);
    expect(current.hatched).toBe(false);
  });
});

describe("the layer chips, applied once so no theme can forget one", () => {
  const busy = hex({
    knowledge: "current",
    ownUnitCount: 3,
    foreignUnitCount: 2,
    settlementName: "Inholm",
    region: region({
      settlement: { name: "Inholm", size: "city" },
      structures: [structure("road n"), structure("Mine"), structure("Galley")],
      units: [unit(), unit({ own: false, factionId: "95" })]
    })
  });

  it("empties the unit vocabulary when the units chip is off", () => {
    const view = viewOf(busy, { showUnits: false });

    expect(view.units).toEqual({ own: 0, foreign: 0, monster: 0 });
    expect(view.guard).toBeNull();
  });

  it("empties the structure vocabulary when the structures chip is off", () => {
    const view = viewOf(busy, { showStructures: false });

    expect(view.roads).toEqual([]);
    expect(view.buildings).toBe(0);
    expect(view.ships).toBe(0);
    expect(view.shafts).toBe(0);
    expect(view.lairs).toBe(0);
  });

  it("keeps the settlement, which is the land itself rather than a layer", () => {
    // Neither chip speaks about towns: a settlement is not a unit and not a structure.
    expect(viewOf(busy, { showUnits: false, showStructures: false }).settlement).toEqual({
      name: "Inholm",
      tier: "city"
    });
  });

  it("drops the fade and the hatch when the staleness chip is off", () => {
    const view = viewOf(hex({ knowledge: "stale", ageInTurns: 7 }), { showStaleness: false });

    expect(view.fogOpacity).toBe(0);
    expect(view.hatched).toBe(false);
  });

  it("keeps a named hex faded whatever the staleness chip says", () => {
    // Staleness is about age, and a hex named by a neighbour's exits has none.
    const view = viewOf(hex({ knowledge: "named" }), { showStaleness: false });

    expect(view.fogOpacity).toBeGreaterThan(0.5);
    expect(view.hatched).toBe(false);
  });
});

describe("roads", () => {
  it("reads one spoke per road structure, in the direction it runs", () => {
    const view = viewOf(
      hex({
        knowledge: "current",
        region: region({ structures: [structure("road n"), structure("road se")] })
      })
    );

    expect(view.roads).toEqual(["n", "se"]);
  });

  it("reads a road whatever case the report wrote it in", () => {
    const view = viewOf(
      hex({ knowledge: "current", region: region({ structures: [structure("Road SW")] }) })
    );

    expect(view.roads).toEqual(["sw"]);
  });

  it("ignores a road direction the lattice has no bearing for", () => {
    const view = viewOf(
      hex({ knowledge: "current", region: region({ structures: [structure("road up")] }) })
    );

    expect(view.roads).toEqual([]);
  });

  it("points each bearing at the midpoint of its own edge", () => {
    // Flat-top hexes put the six edge midpoints on exactly these bearings, which are also the six
    // directions an Atlantis road can run.
    expect(ROAD_VECTORS.n).toEqual({ x: 0, y: -1 });
    expect(ROAD_VECTORS.se.x).toBeCloseTo(0.866);
    expect(ROAD_VECTORS.se.y).toBeCloseTo(0.5);
    expect(Object.keys(ROAD_VECTORS)).toHaveLength(6);
  });
});

describe("structures, split by what they mean rather than counted together", () => {
  const withStructures = (kinds: string[]) =>
    viewOf(
      hex({ knowledge: "current", region: region({ structures: kinds.map((k) => structure(k)) }) })
    );

  it("counts buildings, leaving out what is drawn as something else", () => {
    // A road is a spoke, a ship is a hull, a shaft is a passage and a lair is a hazard; none of
    // them is a roof, so none of them may be counted as one.
    const view = withStructures(["road n", "Galley", "Shaft", "Lair", "Mine", "Tower"]);

    expect(view.buildings).toBe(2);
    expect(view.ships).toBe(1);
    expect(view.shafts).toBe(1);
    expect(view.lairs).toBe(1);
  });

  it("knows a hull by the classic names and by the words ship and boat", () => {
    expect(withStructures(["Galleon"]).ships).toBe(1);
    expect(withStructures(["Longship"]).ships).toBe(1);
    expect(withStructures(["Longboat"]).ships).toBe(1);
    expect(withStructures(["Balloon"]).ships).toBe(1);
  });

  it("knows the unenterable monster habitats by name", () => {
    // These never wander but can attack whatever stands in the hex - a standing danger, not a work.
    expect(withStructures(["Cave"]).lairs).toBe(1);
    expect(withStructures(["Ruin"]).lairs).toBe(1);
    expect(withStructures(["Lair"]).lairs).toBe(1);
  });

  it("counts an unvisited hex as holding nothing, rather than guessing", () => {
    const view = viewOf(hex({ knowledge: "named" }));

    expect(view.roads).toEqual([]);
    expect(view.buildings).toBe(0);
  });
});

describe("settlements", () => {
  const settled = (size: string) =>
    viewOf(
      hex({
        knowledge: "current",
        settlementName: "Inholm",
        region: region({ settlement: { name: "Inholm", size } })
      })
    ).settlement;

  it("reads the tier the report states, because the tiers differ hugely", () => {
    expect(settled("village")?.tier).toBe("village");
    expect(settled("town")?.tier).toBe("town");
    expect(settled("city")?.tier).toBe("city");
  });

  it("reads a tier whatever case the report wrote it in", () => {
    expect(settled("City")?.tier).toBe("city");
  });

  it("names a settlement whose tier is unknown rather than inventing one", () => {
    // A hex named by a neighbour's exits carries the town's name and nothing else about it.
    const view = viewOf(hex({ knowledge: "named", settlementName: "Eda" }));

    expect(view.settlement).toEqual({ name: "Eda", tier: null });
  });

  it("leaves an unsettled hex without a settlement at all", () => {
    expect(viewOf(hex({ knowledge: "current" })).settlement).toBeNull();
  });
});

describe("units", () => {
  it("counts own and foreign exactly as the map has always counted them", () => {
    const view = viewOf(hex({ knowledge: "current", ownUnitCount: 3, foreignUnitCount: 2 }));

    expect(view.units.own).toBe(3);
    expect(view.units.foreign).toBe(2);
  });

  it("picks the monster faction out of the foreign units without removing them from it", () => {
    // Foreign stays the whole foreign tally, so a theme that does not draw monsters separately
    // still shows everybody standing in the hex.
    const view = viewOf(
      hex({
        knowledge: "current",
        ownUnitCount: 0,
        foreignUnitCount: 2,
        region: region({
          units: [
            unit({ own: false, factionId: MONSTER_FACTION_ID }),
            unit({ own: false, factionId: "95" })
          ]
        })
      })
    );

    expect(view.units.foreign).toBe(2);
    expect(view.units.monster).toBe(1);
  });
});

describe("guard", () => {
  const guarded = (units: ReportUnit[]) =>
    viewOf(
      hex({
        knowledge: "current",
        ownUnitCount: units.filter((u) => u.own).length,
        foreignUnitCount: units.filter((u) => !u.own).length,
        region: region({ units })
      })
    ).guard;

  it("says nothing when nobody stands on guard", () => {
    expect(guarded([unit(), unit({ own: false, factionId: "95" })])).toBeNull();
  });

  it("reports a foreign guard, which is who holds the hex", () => {
    expect(guarded([unit(), unit({ own: false, factionId: "95", onGuard: true })])).toBe("foreign");
  });

  it("reports your own guard ahead of anyone else's", () => {
    // "Am I on guard here" is the question the player asks of their own map first.
    expect(
      guarded([unit({ onGuard: true }), unit({ own: false, factionId: "95", onGuard: true })])
    ).toBe("own");
  });
});

describe("marks whose data the reports do not yet give", () => {
  it("says plainly that there was no battle and no gate, rather than leaving a theme guessing", () => {
    // Reserved fields: the layouts keep a slot for each, and these turn true when the parser
    // learns to read them.
    const view = viewOf(hex({ knowledge: "current" }));

    expect(view.battle).toBe(false);
    expect(view.gate).toBe(false);
  });
});

describe("preparing a whole layer", () => {
  it("keeps the hexes in the order they were given, one view each", () => {
    const views = buildHexViews(
      [
        hex({ knowledge: "current", regionId: "a", coordinate: at(1, 1) }),
        hex({ knowledge: "current", regionId: "b", coordinate: at(2, 2) })
      ],
      ALL_ON
    );

    expect(views.map((view) => view.key)).toEqual(["a", "b"]);
  });
});
