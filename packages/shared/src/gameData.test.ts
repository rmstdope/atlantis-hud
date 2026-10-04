import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildingEntryId,
  GAME_DATA_CATEGORIES,
  GAME_DATA_CATEGORY_LABELS,
  itemEntryId,
  parseGameData,
  roamingTerrainsOf,
  skillEntryId,
  structureEntryId,
  terrainEntryId
} from "./gameData";
import type { GameDataIndex } from "./gameData";

/** A tiny ruleset covering every branch the index has to build. */
const RULESET = JSON.stringify({
  skills: {
    MINI: {
      tag: "MINI",
      name: "mining",
      cost: 10,
      maxLevel: 5,
      cast: null,
      produces: [{ tag: "MITH", level: 3, revealsRegion: true }],
      requires: [],
      magic: false,
      levels: [{ level: 1, description: "Digs things up." }]
    },
    SAIL: {
      tag: "SAIL",
      name: "sailing",
      cost: null,
      maxLevel: 3,
      cast: null,
      produces: [],
      requires: [{ tag: "MINI", level: 1 }],
      magic: true
    }
  },
  items: {
    MITH: { tag: "MITH", name: "mithril", kind: "equipment", weight: 10, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false }, moves: 0, description: "A trade resource." },
    LONG: { tag: "LONG", name: "Longship", kind: "ship", weight: 0, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false }, moves: 4, cargoCapacity: 150, sailingSkill: 4 },
    LEAD: { tag: "LEAD", name: "leader", kind: "man", weight: 10, capacity: { walk: 5, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: true, ride: false, fly: false, swim: false }, moves: 2 },
    HORS: { tag: "HORS", name: "horse", kind: "mount", weight: 50, capacity: { walk: 0, ride: 70, fly: 0, swim: 0 }, selfMobile: { walk: true, ride: true, fly: false, swim: false }, moves: 4 },
    DRAG: { tag: "DRAG", name: "dragon", kind: "monster", weight: 100, capacity: { walk: 0, ride: 0, fly: 1000, swim: 0 }, selfMobile: { walk: true, ride: false, fly: true, swim: false }, moves: 6, combat: { skill: 5, attacksPerRound: 2, hitsToKill: 100, damagePerAttack: 10 } }
  },
  terrainResources: { mountain: ["IRON", "MITH"], Swamp: ["WOOD", "FLOA"] },
  buildings: {
    TOWER: { description: "A tower.", size: 10, cost: 10, materials: ["stone"], mages: 0 },
    "MAGICAL CASTLE": { description: "A magical castle.", size: 250, cost: 600, materials: ["mithril"], mages: 3 }
  }
});

describe("parseGameData", () => {
  it("sorts every category alphabetically and puts each item under its own kind", () => {
    const index = parseGameData(RULESET);
    if (index === null) {
      throw new Error("expected the fixture to parse");
    }
    const byCategory = (category: string) =>
      index.entries.filter((entry) => entry.category === category).map((entry) => entry.name);

    expect(byCategory("skill")).toEqual(["mining", "sailing"]);
    expect(byCategory("man")).toEqual(["leader"]);
    expect(byCategory("mount")).toEqual(["horse"]);
    expect(byCategory("ship")).toEqual(["Longship"]);
    expect(byCategory("monster")).toEqual(["dragon"]);
    expect(byCategory("equipment")).toEqual(["mithril"]);
    expect(byCategory("building")).toEqual(["Magical Castle", "Tower"]);

    expect(index.byId.get("ship:LONG")).toEqual({
      id: "ship:LONG",
      category: "ship",
      name: "Longship",
      tag: "LONG"
    });
    expect(index.byId.get("building:TOWER")?.tag).toBeNull();
  });
});

describe("parseGameData, given something that is not a ruleset", () => {
  it("returns null for text that is not a ruleset", () => {
    expect(parseGameData("")).toBeNull();
    expect(parseGameData("not json")).toBeNull();
    expect(parseGameData("{}")).toBeNull();
    expect(parseGameData(JSON.stringify({ items: {}, buildings: {} }))).toBeNull();
  });
});

describe("the lookups", () => {
  const index = parseGameData(RULESET);
  if (index === null) {
    throw new Error("expected the fixture to parse");
  }

  it("finds a building by its report kind, whatever its case", () => {
    expect(buildingEntryId("Tower")).toBe("building:TOWER");
    expect(index.byId.get(buildingEntryId("magical castle"))?.name).toBe("Magical Castle");
    expect(skillEntryId("mini")).toBe("skill:MINI");
    expect(itemEntryId(index, "long")).toBe("ship:LONG");
    expect(itemEntryId(index, "NOPE")).toBeNull();
  });

  it("reports an absent entry rather than throwing", () => {
    const absent = index.detailOf(buildingEntryId("Road N"));
    expect(absent).toEqual({
      kind: "absent",
      entry: { id: "building:ROAD N", category: "building", name: "Road N", tag: null }
    });
    expect(index.detailOf("nonsense")).toBeNull();
  });

  it("details a building, a ship and a monster from what was scraped", () => {
    expect(index.detailOf("building:TOWER")).toMatchObject({
      kind: "building",
      size: 10,
      cost: 10,
      materials: ["stone"],
      mages: 0,
      description: "A tower."
    });
    expect(index.detailOf("ship:LONG")).toMatchObject({
      kind: "item",
      cargoCapacity: 150,
      sailingSkill: 4,
      moves: 4
    });
    expect(index.detailOf("monster:DRAG")).toMatchObject({
      kind: "item",
      combat: { skill: 5, attacksPerRound: 2, hitsToKill: 100, damagePerAttack: 10 }
    });
  });

  it("says which skill produces an item, and at what level", () => {
    expect(index.detailOf("equipment:MITH")).toMatchObject({
      kind: "item",
      producedBy: [{ id: "skill:MINI", name: "mining", level: 3 }]
    });
    expect(index.detailOf("skill:MINI")).toMatchObject({
      produces: [{ id: "equipment:MITH", name: "mithril", level: 3 }],
      requires: [],
      cost: 10,
      levels: [{ level: 1, description: "Digs things up." }]
    });
    expect(index.detailOf("skill:SAIL")).toMatchObject({
      cost: null,
      magic: true,
      requires: [{ id: "skill:MINI", name: "mining", level: 1 }]
    });
  });
});

describe("the ruleset this application ships", () => {
  it("parses, and describes more than two hundred things", () => {
    const text = readFileSync(
      new URL("../../../config/public/ruleset.json", import.meta.url),
      "utf8"
    );
    const index = parseGameData(text);
    expect(index).not.toBeNull();
    expect(index?.entries.length ?? 0).toBeGreaterThan(200);
  });
});

describe("the entry a structure kind names (ah-t5fk)", () => {
  const shipped = (): GameDataIndex => {
    const text = readFileSync(
      new URL("../../../config/public/ruleset.json", import.meta.url),
      "utf8"
    );
    const index = parseGameData(text);
    if (index === null) {
      throw new Error("expected the shipped ruleset to parse");
    }
    return index;
  };

  it("resolves a vessel name to its ship entry, not a building", () => {
    // `Ship [623] : Galley`, fixture neworigins-3.0.0-g5-f21-t39.rep.
    expect(structureEntryId(shipped(), "Galley")).toBe("ship:GLLY");
  });

  it("resolves the plural a report writes to the singular the catalogue holds", () => {
    // `Frozen Tomb [194] : Galley, 40 Galleons, 11 Galleys, 10 Balloons`, turn-71 fixture.
    const index = shipped();
    expect(structureEntryId(index, "Galleons")).toBe("ship:GALL");
    expect(structureEntryId(index, "Galleys")).toBe("ship:GLLY");
    expect(structureEntryId(index, "Balloons")).toBe("ship:BALL");
  });

  it("tries the name as written before stripping anything from it", () => {
    // `Odds and Ends` is a structure NAME rather than a kind, but the rule is the one that
    // matters: a word ending in `s` must be found as written before a plural is assumed.
    const index = parseGameData(
      JSON.stringify({
        skills: {},
        items: {
          GLLY: { tag: "GLLY", name: "Galleys", kind: "ship" },
          GALL: { tag: "GALL", name: "Galley", kind: "ship" }
        },
        buildings: {}
      })
    );
    expect(structureEntryId(index!, "Galleys")).toBe("ship:GLLY");
  });

  it("resolves an ordinary building exactly as it does today", () => {
    const index = shipped();
    expect(structureEntryId(index, "Fort")).toBe("building:FORT");
    expect(structureEntryId(index, "Mine")).toBe("building:MINE");
    expect(structureEntryId(index, "Stockade")).toBe("building:STOCKADE");
  });

  it("still answers with a building id for a kind the catalogue never took", () => {
    // ah-5jkt.2: the dialog opens and says the entry is absent - that is the point of landing there.
    expect(structureEntryId(shipped(), "Wobbly Shed")).toBe("building:WOBBLY SHED");
  });
});

describe("the hidden resources a ruleset names (ah-rx0r.2)", () => {
  const parsed = (text: string): GameDataIndex => {
    const index = parseGameData(text);
    if (index === null) {
      throw new Error("expected the fixture to parse");
    }
    return index;
  };

  it("carries which skill reveals a resource, and what each terrain may hold", () => {
    const index = parsed(RULESET);

    expect(index.revealedBy.get("MITH")).toEqual({
      skillTag: "MINI",
      skillName: "mining",
      level: 3
    });
    expect(index.revealedBy.has("IRON")).toBe(false);
    expect(index.terrainResources.get("mountain")).toEqual(["IRON", "MITH"]);
    expect(index.terrainResources.get("swamp")).toEqual(["WOOD", "FLOA"]);
  });

  it("carries neither from a ruleset that predates them", () => {
    const index = parsed(
      JSON.stringify({
        skills: { MINI: { tag: "MINI", name: "mining", produces: [{ tag: "MITH", level: 3 }] } },
        items: {
          MITH: {
            tag: "MITH",
            name: "mithril",
            kind: "equipment",
            weight: 10,
            moves: 0,
            capacity: { walk: 0, ride: 0, fly: 0, swim: 0 },
            selfMobile: { walk: false, ride: false, fly: false, swim: false }
          }
        }
      })
    );

    expect(index.revealedBy.size).toBe(0);
    expect(index.terrainResources.size).toBe(0);
  });

  it("reads the nine reveals and every terrain out of the shipped ruleset", () => {
    const index = parsed(
      readFileSync(new URL("../../../config/public/ruleset.json", import.meta.url), "utf8")
    );

    const reveals = [...index.revealedBy.entries()]
      .map(([tag, skill]) => `${skill.skillTag} ${skill.level} ${tag}`)
      .sort();
    expect(reveals).toEqual([
      "FISH 3 TURT",
      "HERB 3 MUSH",
      "HORS 5 WING",
      "HUNT 3 FLOA",
      "LUMB 3 IRWD",
      "LUMB 5 YEW",
      "MINI 3 MITH",
      "MINI 5 ADMT",
      "QUAR 3 ROOT"
    ]);
    expect(index.terrainResources.get("mountain")).toEqual([
      "IRON",
      "STON",
      "MITH",
      "ROOT",
      "ADMT"
    ]);
    expect(index.terrainResources.get("swamp")).toEqual(["WOOD", "FLOA", "HERB", "MUSH"]);
  });
});

/* --- terrains (ah-yu3j.1) --- */

const NO_CAPACITY = { walk: 0, ride: 0, fly: 0, swim: 0 };
const NO_MOBILITY = { walk: false, ride: false, fly: false, swim: false };

/** A world with a resource table, two roaming monsters and New Origins' movement block. */
const TERRAIN_RULESET = JSON.stringify({
  skills: {},
  items: {
    IRON: { tag: "IRON", name: "iron", kind: "equipment", weight: 1, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 0 },
    MITH: { tag: "MITH", name: "mithril", kind: "equipment", weight: 1, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 0 },
    FISH: { tag: "FISH", name: "fish", kind: "equipment", weight: 1, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 0 },
    SWOR: { tag: "SWOR", name: "sword", kind: "equipment", weight: 1, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 0 },
    GRIZ: { tag: "GRIZ", name: "grizzly bear", kind: "monster", weight: 50, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 2, description: "This is a monster. The monster can spawn in the wilderness of mountains. Monster prefers to roam the mountain terrain. Monster is unfriendly." },
    ROC: { tag: "ROC", name: "roc", kind: "monster", weight: 50, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 2, description: "This is a monster. Monster prefers to roam the mountain terrain." },
    WORM: { tag: "WORM", name: "giant worm", kind: "monster", weight: 50, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, moves: 2, description: "This is a monster. Monster prefers to roam the tunnels, grotto, Chasm terrains. Monster is unfriendly." }
  },
  terrainResources: { mountain: ["IRON", "MITH"], ocean: ["FISH"], desert: ["IRON"] },
  terrainResourceChances: { mountain: { IRON: 100, MITH: 35 }, ocean: { FISH: 100 }, desert: { IRON: 100 } },
  movement: {
    terrainCosts: { normal: 1, premiums: { mountain: 2, tunnels: 2 }, premiumFor: ["ride", "walk"] },
    road: { divisor: 2, minimumCost: 1 },
    ocean: { requiresShipUnlessFlying: true, flyingMustEndOnLand: true, terrain: "ocean", alsoWater: [] }
  }
});

function terrainIndex(text = TERRAIN_RULESET): GameDataIndex {
  const index = parseGameData(text);
  if (index === null) {
    throw new Error("expected the fixture to parse");
  }
  return index;
}

describe("terrains", () => {
  it("is the last category, labelled Terrains", () => {
    expect(GAME_DATA_CATEGORIES[GAME_DATA_CATEGORIES.length - 1]).toBe("terrain");
    expect(GAME_DATA_CATEGORY_LABELS.terrain).toBe("Terrains");
  });

  it("lists every terrain the resource table or a roaming monster names, lower case and sorted", () => {
    const names = terrainIndex()
      .entries.filter((entry) => entry.category === "terrain")
      .map((entry) => entry.name);

    expect(names).toEqual(["chasm", "desert", "grotto", "mountain", "ocean", "tunnels"]);
  });

  it("gives a terrain no tag and an id built from its word", () => {
    expect(terrainIndex().byId.get(terrainEntryId("Mountain"))).toEqual({
      id: "terrain:mountain",
      category: "terrain",
      name: "mountain",
      tag: null
    });
  });

  it("details a mountain: costs by mode, road, what is found and how often, who roams it", () => {
    expect(terrainIndex().detailOf("terrain:mountain")).toEqual({
      kind: "terrain",
      entry: { id: "terrain:mountain", category: "terrain", name: "mountain", tag: null },
      movement: { kind: "cost", walk: 2, ride: 2, fly: 1 },
      road: 1,
      foundHere: [
        { id: "equipment:IRON", name: "iron", chance: 100 },
        { id: "equipment:MITH", name: "mithril", chance: 35 }
      ],
      roamingMonsters: [
        { id: "monster:GRIZ", name: "grizzly bear" },
        { id: "monster:ROC", name: "roc" }
      ]
    });
  });

  it("details the ocean as water, with no road", () => {
    expect(terrainIndex().detailOf("terrain:ocean")).toMatchObject({
      kind: "terrain",
      movement: { kind: "water" },
      road: null,
      foundHere: [{ id: "equipment:FISH", name: "fish", chance: 100 }],
      roamingMonsters: []
    });
  });

  it("treats a world's further water terrains as water too", () => {
    const parsed = JSON.parse(TERRAIN_RULESET);
    parsed.movement.ocean.alsoWater = ["desert"];
    expect(terrainIndex(JSON.stringify(parsed)).detailOf("terrain:desert")).toMatchObject({
      movement: { kind: "water" },
      road: null
    });
  });

  it("says nothing about what a terrain the resource table does not cover holds", () => {
    expect(terrainIndex().detailOf("terrain:tunnels")).toMatchObject({
      movement: { kind: "cost", walk: 2, ride: 2, fly: 1 },
      road: 1,
      foundHere: null,
      roamingMonsters: [{ id: "monster:WORM", name: "giant worm" }]
    });
  });

  it("costs an ordinary terrain the normal cost, and a road never below the minimum", () => {
    expect(terrainIndex().detailOf("terrain:desert")).toMatchObject({
      movement: { kind: "cost", walk: 1, ride: 1, fly: 1 },
      road: 1
    });
  });

  it("says nothing of movement or frequency for a ruleset that carries neither", () => {
    const parsed = JSON.parse(TERRAIN_RULESET);
    delete parsed.movement;
    delete parsed.terrainResourceChances;
    expect(terrainIndex(JSON.stringify(parsed)).detailOf("terrain:mountain")).toMatchObject({
      movement: null,
      road: null,
      foundHere: [
        { id: "equipment:IRON", name: "iron", chance: null },
        { id: "equipment:MITH", name: "mithril", chance: null }
      ]
    });
  });

  it("reports a terrain it does not hold as absent", () => {
    expect(terrainIndex().detailOf("terrain:nexus")).toEqual({
      kind: "absent",
      entry: { id: "terrain:nexus", category: "terrain", name: "nexus", tag: null }
    });
  });
});

describe("roamingTerrainsOf", () => {
  it("reads one terrain, several, and none", () => {
    expect(roamingTerrainsOf("Monster prefers to roam the mountain terrain. Monster is shy.")).toEqual([
      "mountain"
    ]);
    expect(roamingTerrainsOf("Monster prefers to roam the tunnels, grotto, chasm terrains.")).toEqual([
      "tunnels",
      "grotto",
      "chasm"
    ]);
    expect(roamingTerrainsOf("A trade resource.")).toEqual([]);
    expect(roamingTerrainsOf(null)).toEqual([]);
  });
});

describe("terrain back-links on items", () => {
  it("lists where an item is found, most often first and then by terrain", () => {
    const detail = terrainIndex().detailOf("equipment:IRON");
    expect(detail).toMatchObject({
      kind: "item",
      foundIn: [
        { id: "terrain:desert", name: "desert", chance: 100 },
        { id: "terrain:mountain", name: "mountain", chance: 100 }
      ]
    });
    expect(terrainIndex().detailOf("equipment:MITH")).toMatchObject({
      foundIn: [{ id: "terrain:mountain", name: "mountain", chance: 35 }]
    });
  });

  it("leaves an item found nowhere with no terrains", () => {
    expect(terrainIndex().detailOf("equipment:SWOR")).toMatchObject({ foundIn: [], roams: [] });
  });

  it("links a monster to every terrain it prefers to roam", () => {
    expect(terrainIndex().detailOf("monster:GRIZ")).toMatchObject({
      roams: [{ id: "terrain:mountain", name: "mountain" }]
    });
    expect(terrainIndex().detailOf("monster:WORM")).toMatchObject({
      roams: [
        { id: "terrain:tunnels", name: "tunnels" },
        { id: "terrain:grotto", name: "grotto" },
        { id: "terrain:chasm", name: "chasm" }
      ]
    });
  });
});

describe("the shipped New Origins terrains", () => {
  it("lists fourteen, the underground ones included", () => {
    const index = terrainIndex(
      readFileSync(new URL("../../../config/public/ruleset.json", import.meta.url), "utf8")
    );
    expect(
      index.entries.filter((entry) => entry.category === "terrain").map((entry) => entry.name)
    ).toEqual([
      "cavern",
      "chasm",
      "desert",
      "forest",
      "grotto",
      "jungle",
      "mountain",
      "ocean",
      "plain",
      "swamp",
      "tundra",
      "tunnels",
      "underforest",
      "volcano"
    ]);
    expect(index.detailOf("terrain:mountain")).toMatchObject({
      movement: { kind: "cost", walk: 2, ride: 2, fly: 1 },
      road: 1
    });
  });
});
