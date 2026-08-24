import { describe, expect, it } from "vitest";
import type { Coordinate, ReportRegion, ReportUnit, StructureInfo } from "@atlantis/core-client";
import { aReportRegion, aReportUnit, aStructure } from "@atlantis/core-client";
import type { HexKnowledge, HexNode } from "../../hexMapModel";
import { COLUMN_PITCH, ROW_PITCH } from "../mapViewport";
import {
  allBadges,
  BADGES,
  buildHexViews,
  dampFog,
  MONSTER_FACTION_ID,
  ROAD_VECTORS,
  type BadgeName,
  type HexView,
  type HexViewOptions
} from "./hexView";

function at(x: number, y: number, z = 1): Coordinate {
  return { x, y, z };
}

function structure(kind: string, name = kind): StructureInfo {
  return aStructure(kind, { name });
}

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({ unitId: "900", name: "Walker", factionId: "17", factionName: "Foo", ...overrides });

const region = (overrides: Partial<ReportRegion> = {}): ReportRegion => aReportRegion({ coordinate: at(7, 53), ...overrides });

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
  badges: allBadges(true)
};

/** The single view a one-hex model produces, which is what most of these assert against. */
function viewOf(
  node: HexNode,
  options: Partial<Omit<HexViewOptions, "badges">> & {
    badges?: Partial<Record<BadgeName, boolean>>;
  } = {}
) {
  const { badges, ...rest } = options;
  return buildHexViews([node], { ...ALL_ON, ...rest, badges: allBadges(true, badges) })[0];
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

  it("scales the fade by the theme's damping, named and stale alike", () => {
    const stale = viewOf(hex({ knowledge: "stale", ageInTurns: 8 }), { fogDamping: 0.5 });
    const named = viewOf(hex({ knowledge: "named" }), { fogDamping: 0.5 });

    expect(stale.fogOpacity).toBeCloseTo(0.23);
    expect(named.fogOpacity).toBeCloseTo(0.2);

    const staleUndamped = viewOf(hex({ knowledge: "stale", ageInTurns: 8 }));
    const namedUndamped = viewOf(hex({ knowledge: "named" }));

    expect(staleUndamped.fogOpacity).toBeCloseTo(0.46);
    expect(namedUndamped.fogOpacity).toBeCloseTo(0.4);

    const current = viewOf(hex({ knowledge: "current" }), { fogDamping: 0.5 });
    expect(current.fogOpacity).toBe(0);
  });

  it("dampFog rounds to three decimals", () => {
    expect(dampFog(0.62, 0.62)).toBe(0.384);
  });
});

/** Everything the badges speak about: what a case names is what that badge took away. */
type Vocabulary = Pick<
  HexView,
  "settlement" | "units" | "guard" | "roads" | "buildings" | "ships" | "shafts" | "lairs"
>;

describe("the badge toggles, applied once so no theme can forget one", () => {
  /** A hex holding one of everything, so a badge turned off can be seen to take only its own. */
  const busy = hex({
    knowledge: "current",
    ownUnitCount: 3,
    foreignUnitCount: 2,
    settlementName: "Inholm",
    region: region({
      settlement: { name: "Inholm", size: "city" },
      structures: [
        structure("road n"),
        structure("Mine"),
        structure("Galley"),
        structure("Shaft"),
        structure("Lair")
      ],
      units: [
        unit({ onGuard: true }),
        unit({ own: false, factionId: MONSTER_FACTION_ID }),
        unit({ own: false, factionId: "95" })
      ]
    })
  });

  /** What the busy hex looks like with every badge on: the baseline each case departs from. */
  const whole: Vocabulary = {
    settlement: { name: "Inholm", tier: "city" },
    units: { own: 3, foreign: 2, monster: 1 },
    guard: "own",
    roads: ["n"],
    buildings: 1,
    ships: 1,
    shafts: 1,
    lairs: 1
  };

  /** Everything the badges speak about, so a case can say what it left standing. */
  function vocabularyOf(view: ReturnType<typeof viewOf>): Vocabulary {
    return {
      settlement: view.settlement,
      units: view.units,
      guard: view.guard,
      roads: view.roads,
      buildings: view.buildings,
      ships: view.ships,
      shafts: view.shafts,
      lairs: view.lairs
    };
  }

  it("takes only its own mark away, badge by badge", () => {
    // The whole point of the finer toggles: turning off buildings used to take the ships, the
    // shafts, the lairs and the roads with it.
    const cases: Array<[BadgeName, Partial<typeof whole>]> = [
      ["settlements", { settlement: null }],
      ["ownUnits", { units: { own: 0, foreign: 2, monster: 1 } }],
      ["guard", { guard: null }],
      ["roads", { roads: [] }],
      ["buildings", { buildings: 0 }],
      ["ships", { ships: 0 }],
      ["shafts", { shafts: 0 }],
      ["lairs", { lairs: 0 }],
      // A monster hidden must leave the foreign tally too. Every theme draws the ordinary foreign
      // group as `foreign - monster`, so merely zeroing `monster` would redraw the monster as
      // somebody's soldier and put the Foreign units counter up by one - the mark still on the
      // map, under another name, and a badge nobody touched changing its number.
      ["monsters", { units: { own: 3, foreign: 1, monster: 0 } }]
    ];

    for (const [badge, missing] of cases) {
      expect(vocabularyOf(viewOf(busy, { badges: { [badge]: false } })), badge).toEqual({
        ...whole,
        ...missing
      });
    }
  });

  it("never leaves a monster standing in a tally that no longer counts it", () => {
    // The two unit badges and the monster badge have to agree about one hex: whatever is hidden
    // must be gone from `foreign` as well, or a theme draws it as an ordinary foreign unit.
    const hidden = viewOf(busy, { badges: { monsters: false } });

    expect(hidden.units.foreign - hidden.units.monster).toBe(1);
  });

  it("takes the monsters with the foreign units, because they are counted among them", () => {
    // `foreign` is the whole foreign tally and `monster` says how many of those are monsters, so
    // a monster left standing in a hex whose foreign tally reads zero would be a contradiction.
    const view = viewOf(busy, { badges: { foreignUnits: false } });

    expect(view.units).toEqual({ own: 3, foreign: 0, monster: 0 });
  });

  it("leaves the hex bare when every badge is off", () => {
    const bare = buildHexViews([busy], { ...ALL_ON, badges: allBadges(false) })[0];

    expect(vocabularyOf(bare)).toEqual({
      settlement: null,
      units: { own: 0, foreign: 0, monster: 0 },
      guard: null,
      roads: [],
      buildings: 0,
      ships: 0,
      shafts: 0,
      lairs: 0
    });
    // Still a hex: the badges are what stands on the land, not the land itself.
    expect(bare.terrain).toBe("mountain");
    expect(bare.texture).not.toBeNull();
  });

  it("offers a badge for every mark a theme can draw, and none for one it cannot", () => {
    // `battle` is a reserved field that is always false, and a control that does nothing is worse
    // than no control. `gate` left that company in ah-lcyn: the parser reads a Gateway now, so the
    // mark can be drawn and switched off. `regions` is the one badge here a theme never draws -
    // MapCanvas reads it directly, the way it already reads every other badge, to decorate the
    // map with province outlines rather than a per-hex mark.
    expect(BADGES.map(({ name }) => name)).toEqual([
      "settlements",
      "ownUnits",
      "foreignUnits",
      "monsters",
      "guard",
      "ships",
      "buildings",
      "shafts",
      "lairs",
      "gate",
      "roads",
      "regions",
      "notes"
    ]);
    expect(BADGES.every(({ label }) => label.length > 0)).toBe(true);
  });

  it("drops the fade and the hatch when the staleness chip is off", () => {
    const view = viewOf(hex({ knowledge: "stale", ageInTurns: 7 }), { showStaleness: false });

    expect(view.fogOpacity).toBe(0);
    expect(view.hatched).toBe(false);
  });

  it("keeps a named hex faded whatever the staleness chip says", () => {
    // Staleness is about age, and a hex named by a neighbour's exits has none.
    const view = viewOf(hex({ knowledge: "named" }), { showStaleness: false });
    const withStaleness = viewOf(hex({ knowledge: "named" }), { showStaleness: true });

    // Faded, and by the same amount either way. The figure itself is no longer "more than half":
    // the fade is light enough to read the terrain through, and the unsurveyed rim each theme
    // draws is what says the ground was never surveyed.
    expect(view.fogOpacity).toBeGreaterThan(0.25);
    expect(view.fogOpacity).toBe(withStaleness.fogOpacity);
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

  it("knows a habitat the report qualified, which is how every real one arrives", () => {
    // The parser only splits a description out of `kind` on a semicolon, and a lair's line never
    // carries one - so the whole clause lands in `kind` verbatim, exactly as written here. Every
    // string is taken from tests/fixtures/reports/*.rep; before ah-o0d3 all three drew as
    // buildings and no theme had ever drawn a lair mark from a real report.
    expect(withStructures(["Lair, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Ruin, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Crypt, closed to player units"]).lairs).toBe(1);
  });

  it("knows a hull the report qualified with the vessels it holds", () => {
    // Also from the fixtures: a galley reports the stack it leads, and the tail defeated the exact
    // match the same way the lair's qualifier did. The count is of vessels, not of structures.
    expect(withStructures(["Galley, 2 Galleys, 3 Galleons"]).ships).toBe(5);
    expect(withStructures(["Galley, 40 Galleons, 11 Galleys, 10 Balloons"]).ships).toBe(61);
  });

  it("draws every fleet in the fixtures as a hull, not as a roof", () => {
    // A fleet is what Atlantis writes when a stack of vessels has no single lead type to name it
    // by, so it means exactly what `Galley, 2 Galleys` means. Six of these seven drew as buildings
    // before ah-3pr9; the seventh passed only because `Airships` contains "ship".
    for (const kind of [
      "Fleet, 8 Corsairs",
      "Fleet, 2 Galleons",
      "Fleet, 3 Corsairs",
      "Fleet, 2 Balloons",
      "Fleet, 2 Corsairs",
      "Fleet, 4 Galleons, 1 Balloon",
      "Fleet, 6 Airships"
    ]) {
      expect(withStructures([kind]).buildings).toBe(0);
    }
  });

  it("draws a fleet as a hull because it carries vessels, not because of a word in its name", () => {
    // The one case the old `isShip(structure.kind) || isShip(kind)` double guard existed for, now
    // answered from a field. `Flotilla` is in no ship set and contains neither "ship" nor "boat",
    // so nothing but `vessels` can make this a hull (ah-3pr9, ah-nmts).
    const flotilla = aStructure("Flotilla, 6 Corsairs");

    expect(flotilla.baseKind).toBe("Flotilla");
    expect(
      viewOf(hex({ knowledge: "current", region: region({ structures: [flotilla] }) })).ships
    ).toBe(6);
  });

  it("counts the vessels a fleet holds rather than the one structure naming them", () => {
    // The lead word is a label, not a vessel: the report writes `Cloudship, 14 Cloudships, 4
    // Airships` for eighteen vessels, and reading the label as a nineteenth is the obvious mistake
    // the report itself disproves - it says 14 cloudships, not 15.
    expect(withStructures(["Cloudship, 14 Cloudships, 4 Airships"]).ships).toBe(18);
    expect(withStructures(["Fleet, 8 Corsairs"]).ships).toBe(8);
    expect(withStructures(["Fleet, 4 Galleons, 1 Balloon"]).ships).toBe(5);
  });

  it("counts a lone hull as one vessel, and never counts a hull as none", () => {
    // A kind with no inventory is a fleet of exactly one, and a tail nothing can be read out of
    // must still leave the ship on the badge - under-counting beats losing it.
    expect(withStructures(["Galley"]).ships).toBe(1);
    expect(withStructures(["Cloudship, several Airships"]).ships).toBe(1);
  });

  it("adds up two fleets moored in the same hex", () => {
    expect(withStructures(["Fleet, 8 Corsairs", "Fleet, 2 Balloons"]).ships).toBe(10);
  });

  it("leaves a road and a half-built keep alone", () => {
    // The parser already strips ", needs N" and the trailing stop, so a road arrives bare and its
    // direction is read from the raw kind, unchanged by ah-o0d3.
    expect(withStructures(["Road N"]).roads).toEqual(["n"]);
    expect(withStructures(["Stockade"]).buildings).toBe(1);
    expect(withStructures(["Stockade, needs 20"]).buildings).toBe(1);
  });

  it("still knows a fleet whose tail is the only thing naming a ship", () => {
    // `Fleet, 6 Airships` (turn 71) is a ship ONLY because `isShip` scans the whole raw string and
    // finds "ship" in "Airships" - `fleet` is in neither SHIP_KINDS nor the substring test. So the
    // raw kind must keep reaching `isShip` even once the qualified kind is cleaned for the set
    // lookups; drop `isShip(structure.kind)` and this hull becomes a roof (ah-o0d3).
    expect(withStructures(["Fleet, 6 Airships"]).ships).toBe(6);
  });

  it("knows every habitat the report qualified, not merely the three whose word is listed", () => {
    // All seven of these draw as buildings if the bare word is all that is consulted: `Ice Cave`
    // and `Demon Pit` because the qualifier defeats the exact match even though `cave` and `pit`
    // are listed, and the rest because their word was never listed at all. Every string is taken
    // verbatim from tests/fixtures/reports/*.rep.
    expect(withStructures(["Ice Cave, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Demon Pit, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Whirlpool, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Bog, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Empowered Altar, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Giant's Castle, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Magician's Tower, closed to player units"]).lairs).toBe(1);
  });

  it("reads the report's own marker, so a habitat nobody has seen cannot fall through", () => {
    // The rule is the marker, not a longer list of names: this kind appears in no fixture and in
    // no set, and is a lair because the report says it is closed to player units.
    expect(withStructures(["Sunken Palace, closed to player units"]).lairs).toBe(1);
    expect(withStructures(["Sunken Palace, closed to player units"]).buildings).toBe(0);
  });

  it("draws a Gateway as the gate every theme reserved a slot for", () => {
    // 28 of these in the fixtures, the most common qualified kind there is, every one of them an
    // anonymous building until ah-lcyn.
    const view = withStructures(["Gateway, contains an inner location"]);

    expect(view.gate).toBe(true);
    expect(view.buildings).toBe(0);
    expect(view.shafts).toBe(0);
  });

  it("leaves the gate unlit for a hex holding no gateway", () => {
    expect(withStructures(["Stockade"]).gate).toBe(false);
  });

  it("keeps a shaft a shaft, which its shared marker cannot do", () => {
    // `contains an inner location` is carried by a Shaft as well as by a Gateway - it means "leads
    // to an inner location" and cannot tell them apart, so this split keys on the kind word.
    // Straight from neworigins-3.0.0-g7-f95-t55.rep, the one committed report with a Shaft in it.
    const view = withStructures(["Shaft, contains an inner location"]);

    expect(view.shafts).toBe(1);
    expect(view.gate).toBe(false);
  });

  it("takes the gate away with its badge, and nothing else with it", () => {
    const view = viewOf(
      hex({
        knowledge: "current",
        region: region({
          structures: [
            structure("Gateway, contains an inner location"),
            structure("Shaft, contains an inner location")
          ]
        })
      }),
      { badges: { gate: false } }
    );

    expect(view.gate).toBe(false);
    expect(view.shafts).toBe(1);
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
