import { describe, expect, it } from "vitest";
import {
  armyCountLabel,
  buildPaletteEntries,
  filterPalette,
  hexNotePaletteRows,
  mageNotePaletteRows,
  mageSheetPaletteAction,
  noteSnippet,
  paletteKeyReduce,
  settleHighlight,
  settlementPaletteRows,
  type PaletteEntry
} from "./commandPalette";
import type { HexNode } from "./hexMapModel";
import { structurePaletteLabel } from "./structureLabel";

const noop = () => {};

/** A bare entry list, for the rules that are about the shape of a result rather than the palette. */
function of(...rows: Array<[PaletteEntry["kind"], string]>): PaletteEntry[] {
  return rows.map(([kind, label], at) => ({ id: `${kind}-${at}`, kind, label, run: noop }));
}

function entries(
  gameData?: Parameters<typeof buildPaletteEntries>[0]["gameData"],
  armies: Parameters<typeof buildPaletteEntries>[0]["armies"] = []
): PaletteEntry[] {
  return buildPaletteEntries({
    armies,
    ownUnits: [
      { unitId: "18642", name: "Seven of Eight", run: noop },
      { unitId: "13401", name: "Drones", run: noop }
    ],
    foreignUnits: [],
    staleUnits: [
      { regionId: "1:7,53", unitId: "18642", name: "Seven of Eight", lastSeenTurn: 70, run: noop }
    ],
    settlements: [],
    factions: [
      { factionId: "95", name: "Borg TNG", own: true, merged: false, attitude: null, run: noop },
      { factionId: "10", name: "Thane's Ring", own: false, merged: false, attitude: "Ally", run: noop }
    ],
    regions: [
      { regionId: "1:7,53", label: "mountain (7,53)", run: noop },
      { regionId: "1:20,40", label: "ocean (20,40) in Atlantis Ocean", run: noop }
    ],
    structures: [
      { structureId: "12", label: "Arcane Mine [12] · cavern (3,41)", run: noop },
      { structureId: "4", label: "Building [4] · Mine · plain (9,22)", run: noop }
    ],
    actions: [
      { id: "settings", label: "Open settings", binding: "⌘,", run: noop },
      { id: "theme", label: "Toggle theme", run: noop }
    ],
    orderCommands: ["MOVE", "STUDY"],
    gameData: gameData ?? [
      { id: "skill:MINI", category: "skill", name: "mining", tag: "MINI" },
      { id: "ship:LONG", category: "ship", name: "Longship", tag: "LONG" },
      { id: "building:MINE", category: "building", name: "Mine", tag: null }
    ],
    openGameData: noop
  });
}

describe("buildPaletteEntries", () => {
  it("lists units, regions, actions, order help and game data, in that reading order", () => {
    const kinds = entries().map((entry) => entry.kind);
    expect(kinds).toEqual([
      "unit",
      "unit",
      "unit",
      "faction",
      "faction",
      "region",
      "region",
      "structure",
      "structure",
      "action",
      "action",
      "order-help",
      "order-help",
      "skill",
      "ship",
      "building"
    ]);
  });

  it("offers a terrain from the game data under its own kind, named without a tag (ah-yu3j.1)", () => {
    const [terrain] = entries([
      { id: "terrain:mountain", category: "terrain", name: "mountain", tag: null }
    ]).filter((entry) => entry.id.startsWith("data-"));
    expect(terrain).toMatchObject({ kind: "terrain", label: "mountain" });
  });

  it("offers a structure in the world", () => {
    const structure = entries().find((entry) => entry.kind === "structure");
    expect(structure?.label).toContain("Arcane Mine [12]");
  });

  it("tells a structure and a building type apart when both match \"mine\"", () => {
    const found = filterPalette(entries(), "mine");
    const kinds = new Set(found.map((entry) => entry.kind));
    expect(kinds.has("structure")).toBe(true);
    expect(kinds.has("building")).toBe(true);
  });

  it("puts structures after regions and before actions", () => {
    const kinds = entries().map((entry) => entry.kind);
    expect(kinds.lastIndexOf("region")).toBeLessThan(kinds.indexOf("structure"));
    expect(kinds.lastIndexOf("structure")).toBeLessThan(kinds.indexOf("action"));
  });

  it("finds a structure by its id", () => {
    const found = filterPalette(entries(), "12");
    expect(found.some((entry) => entry.label.includes("Arcane Mine [12]"))).toBe(true);
  });

  it("labels a unit with its name and number, so either can be searched", () => {
    const unit = entries().find((entry) => entry.kind === "unit");
    expect(unit?.label).toContain("Seven of Eight");
    expect(unit?.label).toContain("18642");
  });

  it("offers a stale unit with its own id, historical marker, and selection callback", () => {
    let selected = false;
    const stale = buildPaletteEntries({
      armies: [],
      ownUnits: [{ unitId: "18642", name: "Seven of Eight", run: noop }],
      foreignUnits: [],
      staleUnits: [
        {
          regionId: "1:7,53",
          unitId: "18642",
          name: "Historical Seven",
          lastSeenTurn: 70,
          run: () => {
            selected = true;
          }
        }
      ],
      settlements: [],
      factions: [],
      regions: [],
      structures: [],
      actions: [],
      orderCommands: [],
      gameData: [],
      openGameData: noop
    });

    const historical = filterPalette(stale, "Historical Seven (18642)")[0];
    expect(historical).toMatchObject({
      id: "stale-unit-1:7,53-18642",
      kind: "unit",
      label: "Historical Seven (18642)",
      lastSeenTurn: 70
    });
    expect(historical.id).not.toBe(stale[0].id);
    historical.run();
    expect(selected).toBe(true);
  });

  describe("other factions' units seen this turn (ah-mlls.1)", () => {
    const thanes = { label: "Thane's Ring (10)", concealed: false };
    const hidden = { label: "Faction not shown", concealed: true };

    function withForeign(onRun: (unitId: string) => void = noop): PaletteEntry[] {
      return buildPaletteEntries({
        armies: [],
        ownUnits: [{ unitId: "518", name: "Wardrobe Guard", run: noop }],
        foreignUnits: [
          {
            regionId: "1:18,52",
            unitId: "2207",
            name: "Wardens of the Vale",
            faction: thanes,
            run: () => onRun("2207")
          },
          {
            regionId: "1:18,52",
            unitId: "3110",
            name: "Ward Scouts",
            faction: hidden,
            run: () => onRun("3110")
          }
        ],
        staleUnits: [
          { regionId: "1:9,9", unitId: "2207", name: "Wardens of the Vale", lastSeenTurn: 42, run: noop }
        ],
        settlements: [],
        factions: [],
        regions: [{ regionId: "1:18,52", label: "plain (18,52) in Vale", run: noop }],
        structures: [],
        actions: [],
        orderCommands: [],
        gameData: [],
        openGameData: noop
      });
    }

    it("offers another faction's unit as a unit, with its faction beside the label", () => {
      const chosen: string[] = [];
      const row = withForeign((unitId) => chosen.push(unitId)).find(
        (entry) => entry.id === "foreign-unit-1:18,52-2207"
      );
      expect(row).toMatchObject({
        kind: "unit",
        label: "Wardens of the Vale (2207)",
        faction: thanes
      });
      expect(row?.lastSeenTurn).toBeUndefined();
      row?.run();
      expect(chosen).toEqual(["2207"]);
    });

    it("carries an undisclosed owner as concealed", () => {
      const row = withForeign().find((entry) => entry.label === "Ward Scouts (3110)");
      expect(row?.faction).toEqual(hidden);
    });

    it("lists own units, then this turn's other factions' units, then remembered ones", () => {
      expect(
        filterPalette(withForeign(), "")
          .filter((entry) => entry.kind === "unit")
          .map((entry) => entry.id)
      ).toEqual([
        "unit-518",
        "foreign-unit-1:18,52-2207",
        "foreign-unit-1:18,52-3110",
        "stale-unit-1:9,9-2207"
      ]);
    });

    it("breaks a tie between equally good matches in the same order", () => {
      // "ward" is a prefix of all four unit labels.
      expect(filterPalette(withForeign(), "ward").map((entry) => entry.id)).toEqual([
        "unit-518",
        "foreign-unit-1:18,52-2207",
        "foreign-unit-1:18,52-3110",
        "stale-unit-1:9,9-2207"
      ]);
    });

    it("finds a foreign unit by its number", () => {
      expect(filterPalette(withForeign(), "3110")[0]?.label).toBe("Ward Scouts (3110)");
    });

    it("does not find a unit by its faction's name", () => {
      expect(filterPalette(withForeign(), "thane").map((entry) => entry.id)).toEqual([]);
    });

    it("keeps a unit seen now apart from the same unit remembered elsewhere", () => {
      const rows = withForeign().filter((entry) => entry.label === "Wardens of the Vale (2207)");
      expect(rows.map((entry) => [entry.faction?.label, entry.lastSeenTurn])).toEqual([
        ["Thane's Ring (10)", undefined],
        [undefined, 42]
      ]);
    });

    it("gives an own unit no faction", () => {
      expect(withForeign()[0]?.faction).toBeUndefined();
    });
  });

  it("carries an action's key binding for the popup to show", () => {
    const action = entries().find((entry) => entry.label === "Open settings");
    expect(action?.binding).toBe("⌘,");
  });
});

describe("factions in the palette (ah-mlls.3)", () => {
  it("puts the factions after the units and ahead of the hexes", () => {
    const kinds = entries().map((entry) => entry.kind);
    expect(kinds.lastIndexOf("unit")).toBeLessThan(kinds.indexOf("faction"));
    expect(kinds.lastIndexOf("faction")).toBeLessThan(kinds.indexOf("region"));
  });

  it("labels a faction with its name and number, and carries what its row draws", () => {
    const faction = entries().find((entry) => entry.id === "faction-10");
    expect(faction).toMatchObject({
      kind: "faction",
      label: "Thane's Ring (10)",
      standing: { own: false, merged: false, attitude: "Ally" }
    });
  });

  it("comes right after the towns and cities", () => {
    const kinds = buildPaletteEntries({
      armies: [],
      ownUnits: [],
      foreignUnits: [],
      staleUnits: [],
      settlements: [{ regionId: "1:12,34", label: "Akroitos [city] · plain (12,34)", run: noop }],
      factions: [{ factionId: "10", name: "Thane's Ring", own: false, merged: false, attitude: null, run: noop }],
      regions: [{ regionId: "1:12,34", label: "plain (12,34)", run: noop }],
      structures: [],
      actions: [],
      orderCommands: [],
      gameData: [],
      openGameData: noop
    }).map((entry) => entry.kind);
    expect(kinds).toEqual(["settlement", "faction", "region"]);
  });

  it("names a nameless faction by its number", () => {
    const [nameless] = buildPaletteEntries({
      armies: [],
      ownUnits: [],
      foreignUnits: [],
      staleUnits: [],
      settlements: [],
      factions: [
        { factionId: "77", name: null, own: false, merged: false, attitude: null, lastSeenTurn: 41, run: noop }
      ],
      regions: [],
      structures: [],
      actions: [],
      orderCommands: [],
      gameData: [],
      openGameData: noop
    });
    expect(nameless).toMatchObject({ label: "Unnamed faction (77)", lastSeenTurn: 41 });
  });

  it("finds a faction by its number", () => {
    expect(filterPalette(entries(), "10")[0]?.id).toBe("faction-10");
  });

  it("finds a faction by its name", () => {
    expect(filterPalette(entries(), "thane").map((entry) => entry.id)).toContain("faction-10");
  });

  it("does not search the attitude, so typing ally lists no ally", () => {
    expect(filterPalette(entries(), "ally").map((entry) => entry.kind)).not.toContain("faction");
  });
});

describe("filterPalette", () => {
  it("matches anywhere in a label, case-insensitively", () => {
    const found = filterPalette(entries(), "seven");
    expect(found[0].label).toContain("Seven of Eight");
  });

  it("finds a unit by its number", () => {
    const found = filterPalette(entries(), "13401");
    expect(found).toHaveLength(1);
    expect(found[0].label).toContain("Drones");
  });

  it("ranks prefix above word-start above a substring", () => {
    // "st" is a prefix of STUDY and merely scattered through "Seven of eighT": the prefix
    // must come back first, and the scattered match is dropped entirely (ah-yk6b rule 2).
    const prefixed = filterPalette(entries(), "st").map((entry) => entry.label);
    expect(prefixed.indexOf("STUDY")).toBe(0);
    expect(prefixed.some((label) => label.includes("Seven of Eight"))).toBe(false);

    // "set" starts a word of "Open settings", so the word start wins and the scattered
    // "Seven of eighT" is not offered beside it.
    const wordStart = filterPalette(entries(), "set").map((entry) => entry.label);
    expect(wordStart.indexOf("Open settings")).toBe(0);
    expect(wordStart.some((label) => label.includes("Seven of Eight"))).toBe(false);

    // A query that is a prefix of one label ranks that label first outright.
    expect(filterPalette(entries(), "toggle")[0].label).toBe("Toggle theme");
  });

  it("ranks a word start above a substring, among matches of one kind", () => {
    const found = filterPalette(
      of(["unit", "Deep Mine"], ["unit", "Undermine"], ["unit", "Mine Crew"]),
      "mine"
    ).map((entry) => entry.label);
    expect(found).toEqual(["Mine Crew", "Deep Mine", "Undermine"]);
  });

  it("keeps subsequence matches, for the half-remembered name", () => {
    // "svneight" is not a substring of anything; its letters appear in order in "Seven of
    // Eight", which is how fuzzy finders earn their keep.
    const found = filterPalette(entries(), "svneight");
    expect(found).toHaveLength(2);
    expect(found.every((entry) => entry.label.includes("Seven of Eight"))).toBe(true);
  });

  it("shows everything, in reading order, for an empty query", () => {
    expect(filterPalette(entries(), "")).toHaveLength(16);
  });

  it("returns every match, with no cap", () => {
    // Twenty units named for mining, and one Mine standing on the map: the structure used to
    // fall off the end of a twelve-row list with nothing on screen to say so (ah-yk6b).
    const crowd = of(
      ...Array.from(
        { length: 20 },
        (_, at) => ["unit", `Miners ${at}`] as [PaletteEntry["kind"], string]
      ),
      ["structure", "Arcane Mine [12]"]
    );
    const found = filterPalette(crowd, "mine");
    expect(found).toHaveLength(21);
    expect(found.some((entry) => entry.kind === "structure")).toBe(true);
  });

  it("drops subsequence matches when better ones exist", () => {
    const found = filterPalette(
      of(["structure", "Arcane Mine [12]"], ["building", "Magician's Tower"]),
      "mine"
    ).map((entry) => entry.label);
    expect(found).toEqual(["Arcane Mine [12]"]);
  });

  it("gives every matching kind a place at the top", () => {
    const crowd = of(
      ...Array.from(
        { length: 20 },
        (_, at) => ["unit", `Miners ${at}`] as [PaletteEntry["kind"], string]
      ),
      ["structure", "Arcane Mine [12]"],
      ["building", "Mine"]
    );
    const top = filterPalette(crowd, "mine").slice(0, 3);
    expect(new Set(top.map((entry) => entry.kind))).toEqual(
      new Set(["unit", "structure", "building"])
    );
  });

  it("still puts the best match first", () => {
    // The representatives lead in fit order, so a prefix match outranks a kind that merely
    // contains the query - Enter on a well-aimed query does what it always did.
    const found = filterPalette(
      of(["structure", "Arcane Mine [12]"], ["building", "Mine"], ["unit", "Deep Mine"]),
      "mine"
    );
    expect(found[0].label).toBe("Mine");
  });

  it("answers nothing for a query nothing matches", () => {
    expect(filterPalette(entries(), "zzzz")).toEqual([]);
  });
});

describe("paletteKeyReduce", () => {
  it("clamps the highlight at both ends", () => {
    // Uncapped, a wrapping list cycles past what you wanted for ever (ah-yk6b), and a number
    // must still come back at the ends so the caller calls preventDefault.
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2 }, "ArrowDown")).toBe(1);
    expect(paletteKeyReduce({ index: 2, count: 3, pageSize: 2 }, "ArrowDown")).toBe(2);
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2 }, "ArrowUp")).toBe(0);
  });

  it("moves a page at a time", () => {
    expect(paletteKeyReduce({ index: 0, count: 20, pageSize: 8 }, "PageDown")).toBe(8);
    expect(paletteKeyReduce({ index: 18, count: 20, pageSize: 8 }, "PageDown")).toBe(19);
    expect(paletteKeyReduce({ index: 10, count: 20, pageSize: 8 }, "PageUp")).toBe(2);
    expect(paletteKeyReduce({ index: 3, count: 20, pageSize: 8 }, "PageUp")).toBe(0);
  });

  it("jumps to the ends on Home and End", () => {
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "Home")).toBe(0);
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "End")).toBe(2);
  });

  it("leaves every other key to the input", () => {
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "a")).toBeNull();
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "Enter")).toBeNull();
  });

  it("stays put with nothing to highlight", () => {
    expect(paletteKeyReduce({ index: 0, count: 0, pageSize: 2 }, "ArrowDown")).toBeNull();
  });
});

describe("greyed rows (ah-mlls.7)", () => {
  // Rows 1 and 3 are greyed: the header greys their buttons.
  const enabled = [true, false, true, false, true];
  const at = (index: number, key: string) =>
    paletteKeyReduce({ index, count: enabled.length, pageSize: 2, enabled }, key);

  it("steps over a greyed row with the arrows", () => {
    expect(at(0, "ArrowDown")).toBe(2);
    expect(at(2, "ArrowDown")).toBe(4);
    expect(at(4, "ArrowUp")).toBe(2);
    expect(at(2, "ArrowUp")).toBe(0);
  });

  it("stays put when only greyed rows lie that way", () => {
    expect(at(4, "ArrowDown")).toBe(4);
    expect(at(0, "ArrowUp")).toBe(0);
    const tail = [true, false, false];
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2, enabled: tail }, "ArrowDown")).toBe(0);
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2, enabled: tail }, "End")).toBe(0);
  });

  it("lands a page, Home or End on the nearest row that can be chosen", () => {
    // PageDown from 0 aims at 2; PageDown from 2 aims at 4.
    expect(at(0, "PageDown")).toBe(2);
    expect(at(2, "PageDown")).toBe(4);
    // PageUp from 4 aims at 2; from 2 at 0.
    expect(at(4, "PageUp")).toBe(2);
    // A page aimed at a greyed row goes on past it, or comes back when nothing lies beyond.
    const greyedEnd = [true, true, false];
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2, enabled: greyedEnd }, "PageDown")).toBe(1);
    const greyedStart = [false, true, true];
    expect(paletteKeyReduce({ index: 2, count: 3, pageSize: 2, enabled: greyedStart }, "Home")).toBe(1);
    expect(paletteKeyReduce({ index: 2, count: 3, pageSize: 2, enabled: greyedStart }, "PageUp")).toBe(1);
  });

  it("still claims the key when every row is greyed, so the caret does not move", () => {
    const none = [false, false];
    expect(paletteKeyReduce({ index: 0, count: 2, pageSize: 2, enabled: none }, "ArrowDown")).toBe(0);
  });

  it("settles the highlight on a row that can be chosen, or on none", () => {
    expect(settleHighlight(0, [true, false])).toBe(0);
    expect(settleHighlight(0, [false, true])).toBe(1);
    expect(settleHighlight(5, [true, false])).toBe(0);
    expect(settleHighlight(1, [true, false])).toBe(0);
    expect(settleHighlight(0, [false, false])).toBe(-1);
    expect(settleHighlight(0, [])).toBe(-1);
  });

  it("carries a greyed action's reason onto its entry, and still finds it by typing", () => {
    const built = buildPaletteEntries({
      armies: [],
      ownUnits: [],
      foreignUnits: [],
      staleUnits: [],
      settlements: [],
      factions: [],
      regions: [],
      structures: [],
      actions: [
        { id: "send-orders", label: "Send orders", unavailable: "No #atlantis line.", run: noop },
        { id: "settings", label: "Open settings", run: noop }
      ],
      orderCommands: [],
      gameData: [],
      openGameData: noop
    });
    expect(built[0]?.unavailable).toBe("No #atlantis line.");
    expect(built[1]?.unavailable).toBeUndefined();
    expect(filterPalette(built, "orders").map((entry) => entry.id)).toEqual(["action-send-orders"]);
  });
});

describe("game data in the palette", () => {
  it("lists game data after order help, labelled with the tab it opens", () => {
    const all = entries();
    const data = all.slice(-3);
    expect(all.slice(0, -3).every((entry) => entry.kind !== "skill")).toBe(true);
    expect(data.map((entry) => entry.kind)).toEqual(["skill", "ship", "building"]);
    expect(data.map((entry) => entry.id)).toEqual([
      "data-skill:MINI",
      "data-ship:LONG",
      "data-building:MINE"
    ]);
    expect(data.map((entry) => entry.label)).toEqual([
      "mining MINI",
      "Longship LONG",
      "Mine"
    ]);
  });

  it("finds an item by its tag, because the tag is in the label", () => {
    expect(filterPalette(entries(), "LONG").map((entry) => entry.id)).toContain("data-ship:LONG");
  });

  it("offers no game data when the ruleset has not loaded", () => {
    const without = buildPaletteEntries({
      armies: [],
      ownUnits: [],
      foreignUnits: [],
      staleUnits: [],
      settlements: [],
      factions: [],
      regions: [],
      structures: [],
      actions: [],
      orderCommands: [],
      gameData: [],
      openGameData: noop
    });
    expect(without).toEqual([]);
  });
});

describe("structurePaletteLabel", () => {
  const hexLabel = () => "cavern (3,41)";

  it("shows a named structure's name and hex", () => {
    expect(
      structurePaletteLabel(
        { structureId: "12", name: "Arcane Mine", kind: "Mine", baseKind: "Mine", qualifiers: [], vessels: [], description: null, needs: null },
        hexLabel()
      )
    ).toBe("Arcane Mine [12] · cavern (3,41)");
  });

  it("shows an unnamed structure's kind too", () => {
    expect(
      structurePaletteLabel(
        { structureId: "4", name: "Building", kind: "Mine", baseKind: "Mine", qualifiers: [], vessels: [], description: null, needs: null },
        "plain (9,22)"
      )
    ).toBe("Building [4] · Mine · plain (9,22)");
  });

  it("treats a ship placeholder as unnamed", () => {
    expect(
      structurePaletteLabel(
        { structureId: "218", name: "ship", kind: "Longship", baseKind: "Longship", qualifiers: [], vessels: [], description: null, needs: null },
        "ocean (1,1)"
      )
    ).toBe("ship [218] · Longship · ocean (1,1)");
  });
});

/** A map node with only what the palette reads filled in. */
function node(
  regionId: string,
  label: string,
  settlement: HexNode["settlement"],
  knowledge: HexNode["knowledge"] = "current",
  lastSeenTurn: number | null = 71
): HexNode {
  return {
    regionId,
    coordinate: { x: 0, y: 0, z: 1 },
    terrain: "plain",
    province: "Hope",
    label,
    knowledge,
    lastSeenTurn,
    ageInTurns: null,
    settlementName: settlement?.name ?? null,
    settlement,
    region: null,
    rememberedUnits: [],
    ownUnitCount: 0,
    foreignUnitCount: 0
  };
}

describe("settlementPaletteRows (ah-mlls.2)", () => {
  const hexes = [
    node("1:12,34", "plain (12,34) in Hope", { name: "Akroitos", size: "city" }),
    node("1:12,36", "forest (12,36) in Hope", null),
    node("1:7,53", "mountain (7,53) in Inhead", { name: "Inholm", size: "city" }, "stale", 68),
    node("1:9,9", "swamp (9,9) in Fen", { name: "Mudwick", size: "village" }, "named", 64)
  ];

  it("gives every settlement a row reading name, size, then the hex's own label", () => {
    expect(settlementPaletteRows(hexes, 71)).toEqual([
      { regionId: "1:12,34", label: "Akroitos [city] · plain (12,34) in Hope" },
      { regionId: "1:7,53", label: "Inholm [city] · mountain (7,53) in Inhead", lastSeenTurn: 68 },
      { regionId: "1:9,9", label: "Mudwick [village] · swamp (9,9) in Fen", lastSeenTurn: 64 }
    ]);
  });

  it("marks nothing as earlier-turn when the report has no turn number", () => {
    expect(settlementPaletteRows([hexes[2]!], null)).toEqual([
      { regionId: "1:7,53", label: "Inholm [city] · mountain (7,53) in Inhead" }
    ]);
  });

  it("offers nothing when no settlement is known", () => {
    expect(settlementPaletteRows([], 71)).toEqual([]);
    expect(settlementPaletteRows([hexes[1]!], 71)).toEqual([]);
  });
});

describe("settlements in the palette (ah-mlls.2)", () => {
  const built = buildPaletteEntries({
    armies: [],
    ownUnits: [{ unitId: "18642", name: "Seven of Eight", run: noop }],
    foreignUnits: [],
    staleUnits: [
      { regionId: "1:7,53", unitId: "1", name: "Old Scout", lastSeenTurn: 60, run: noop }
    ],
    settlements: [
      { regionId: "1:12,34", label: "Akroitos [city] · plain (12,34) in Hope", run: noop },
      { regionId: "1:9,9", label: "Mudwick [village] · swamp (9,9) in Fen", lastSeenTurn: 64, run: noop },
      { regionId: "1:7,53", label: "Inholm [city] · mountain (7,53) in Inhead", run: noop }
    ],
    factions: [],
    regions: [
      { regionId: "1:12,34", label: "plain (12,34) in Hope", run: noop },
      { regionId: "1:7,53", label: "mountain (7,53) in Inhead", run: noop }
    ],
    structures: [{ structureId: "1", label: "Castle [1] · plain (12,34) in Hope", run: noop }],
    actions: [],
    orderCommands: [],
    gameData: [],
    openGameData: noop
  });

  it("sits after every unit and ahead of the hexes with nothing typed", () => {
    expect(built.map((entry) => entry.kind)).toEqual([
      "unit",
      "unit",
      "settlement",
      "settlement",
      "settlement",
      "region",
      "region",
      "structure"
    ]);
    expect(built[3]).toMatchObject({ id: "settlement-1:9,9", lastSeenTurn: 64 });
  });

  it("finds a settlement by its name with one row, not a duplicate hex row", () => {
    expect(filterPalette(built, "akroitos").map((entry) => entry.label)).toEqual([
      "Akroitos [city] · plain (12,34) in Hope"
    ]);
  });

  it("lists every city for 'city' and every village for 'village'", () => {
    expect(filterPalette(built, "city").map((entry) => entry.id)).toEqual([
      "settlement-1:12,34",
      "settlement-1:7,53"
    ]);
    expect(filterPalette(built, "village").map((entry) => entry.id)).toEqual([
      "settlement-1:9,9"
    ]);
  });

  it("finds a settlement by its province too, with its best fit given a seat at the top", () => {
    const shown = filterPalette(built, "hope");
    expect(shown.map((entry) => entry.kind).slice(0, 3).sort()).toEqual([
      "region",
      "settlement",
      "structure"
    ]);
    expect(shown.map((entry) => entry.id)).toContain("settlement-1:12,34");
  });
});

describe("Armies in the palette (ah-mlls.4)", () => {
  const armies = [
    { armyId: "a1", name: "Iron Guard", shownCount: 5, run: noop },
    { armyId: "a2", name: "Seven Seas", shownCount: 1, run: noop },
    { armyId: "a3", name: "Old Watch", shownCount: 0, run: noop }
  ];

  it("counts what this turn's report shows, in the words the acceptance fixes", () => {
    expect(armyCountLabel(5)).toEqual({ text: "5 units", quiet: false });
    expect(armyCountLabel(1)).toEqual({ text: "1 unit", quiet: false });
    expect(armyCountLabel(0)).toEqual({ text: "no units this turn", quiet: true });
  });

  it("lists the Armies first, in the order given, before the player's own units", () => {
    const built = entries(undefined, armies);
    expect(built.slice(0, 4).map((entry) => [entry.kind, entry.label])).toEqual([
      ["army", "Iron Guard"],
      ["army", "Seven Seas"],
      ["army", "Old Watch"],
      ["unit", "Seven of Eight (18642)"]
    ]);
    expect(built[0]).toMatchObject({ id: "army-a1", count: { text: "5 units", quiet: false } });
    expect(built[2]?.count).toEqual({ text: "no units this turn", quiet: true });
  });

  it("adds nothing when there are no Armies", () => {
    expect(entries().some((entry) => entry.kind === "army")).toBe(false);
  });

  it("finds an Army by its own name only - the count is not searched", () => {
    const shown = filterPalette(entries(undefined, armies), "units");
    expect(shown.some((entry) => entry.kind === "army")).toBe(false);
    const iron = filterPalette(entries(undefined, armies), "iron");
    expect(iron[0]).toMatchObject({ kind: "army", label: "Iron Guard" });
  });

  it("gives the best-matching Army a seat at the top among many unit matches", () => {
    const crowd = of(
      ...Array.from({ length: 30 }, (_, at) => ["unit", `Seven Scouts ${at}`] as [PaletteEntry["kind"], string]),
      ["army", "Northern Seven"]
    );
    const shown = filterPalette(crowd, "seven");
    expect(shown.slice(0, 2).map((entry) => entry.kind)).toContain("army");
  });
});

describe("notes in the palette (ah-mlls.5)", () => {
  const withNotes = (): PaletteEntry[] =>
    buildPaletteEntries({
      armies: [],
      ownUnits: [{ unitId: "2210", name: "Ironside Guard", run: noop }],
      foreignUnits: [],
      staleUnits: [],
      settlements: [],
      factions: [],
      regions: [{ regionId: "1:3,29", label: "hill (3,29) in Grey Reach", run: noop }],
      structures: [],
      actions: [],
      orderCommands: [],
      gameData: [],
      openGameData: noop,
      hexNotes: [
        {
          noteId: "n1",
          regionId: "1:3,29",
          text: "Scouted turn 61.\nA seam of iron under the ridge, iron again.",
          place: "hill (3,29) in Grey Reach · turn 61",
          run: noop
        },
        {
          noteId: "n2",
          regionId: "1:12,34",
          text: "Iron traders from Akroitos pass here every spring.",
          place: "plain (12,34) in Hope · turn 66",
          run: noop
        }
      ],
      mageNotes: [
        {
          key: "95/2214",
          text: "Needs FIRE 3 before the siege, then switch her to iron-working?",
          place: "Ulla the Grey (2214) · study planner",
          run: noop
        }
      ]
    });

  it("gives each note its own kind, its whole text as the label and its place beside it", () => {
    const notes = withNotes().filter((entry) => entry.note !== undefined);
    expect(notes.map((entry) => [entry.id, entry.kind, entry.note?.place])).toEqual([
      ["hex-note-n1", "hex-note", "hill (3,29) in Grey Reach · turn 61"],
      ["hex-note-n2", "hex-note", "plain (12,34) in Hope · turn 66"],
      ["mage-note-95/2214", "mage-note", "Ulla the Grey (2214) · study planner"]
    ]);
    expect(notes[0]?.label).toContain("A seam of iron");
  });

  it("adds no note rows when the input carries none", () => {
    expect(entries().some((entry) => entry.note !== undefined)).toBe(false);
  });

  it("leaves every note out while nothing is typed", () => {
    expect(filterPalette(withNotes(), "").some((entry) => entry.note !== undefined)).toBe(false);
    expect(filterPalette(withNotes(), "  ").some((entry) => entry.note !== undefined)).toBe(false);
  });

  it("finds a note by a word anywhere in it, one row per note however often the word appears", () => {
    const shown = filterPalette(withNotes(), "iron");
    expect(shown.filter((entry) => entry.kind === "hex-note").map((entry) => entry.id)).toEqual([
      "hex-note-n2",
      "hex-note-n1"
    ]);
    expect(shown.filter((entry) => entry.kind === "mage-note")).toHaveLength(1);
  });

  it("matches a word on a later line of a note", () => {
    const shown = filterPalette(withNotes(), "ridge");
    expect(shown.map((entry) => entry.id)).toEqual(["hex-note-n1"]);
  });

  it("gives the best hex note and the best mage note each a seat at the top", () => {
    const shown = filterPalette(withNotes(), "iron");
    expect(shown.slice(0, 3).map((entry) => entry.kind).sort()).toEqual([
      "hex-note",
      "mage-note",
      "unit"
    ]);
  });

  it("ranks a note's substring match as any other kind's, so it outranks scattered letters", () => {
    // Rule 2 as it already stands: a note is one more row whose text holds the word.
    const shown = filterPalette(withNotes(), "seam");
    expect(shown.map((entry) => entry.id)).toEqual(["hex-note-n1"]);
  });

  it("lists no notes for a typo while other kinds still match their scattered letters", () => {
    const shown = filterPalette(withNotes(), "irsd");
    expect(shown.some((entry) => entry.note !== undefined)).toBe(false);
    expect(shown.map((entry) => entry.label)).toEqual(["Ironside Guard (2210)"]);
  });
});

describe("hexNotePaletteRows (ah-mlls.5)", () => {
  const note = (over: Partial<{ id: string; regionId: string; text: string; turn: number }>) => ({
    id: "n1",
    gameId: "g",
    regionId: "1:3,29",
    text: "Good pasture; horses cheap.",
    onMap: true,
    turn: 58,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over
  });
  const label = (regionId: string) =>
    regionId === "1:3,29" ? "hill (3,29) in Grey Reach" : "plain (14,36) in Hope";

  it("places a note on its hex, as the hex row reads, and the turn it was written", () => {
    expect(hexNotePaletteRows([note({})], label)).toEqual([
      {
        noteId: "n1",
        regionId: "1:3,29",
        text: "Good pasture; horses cheap.",
        place: "hill (3,29) in Grey Reach · turn 58"
      }
    ]);
  });

  it("leaves the turn off a note stamped before any report was loaded", () => {
    const [row] = hexNotePaletteRows([note({ regionId: "1:14,36", turn: 0 })], label);
    expect(row?.place).toBe("plain (14,36) in Hope");
  });

  it("keeps one row per note, in the order given", () => {
    const rows = hexNotePaletteRows([note({ id: "a" }), note({ id: "b", turn: 66 })], label);
    expect(rows.map((row) => [row.noteId, row.place])).toEqual([
      ["a", "hill (3,29) in Grey Reach · turn 58"],
      ["b", "hill (3,29) in Grey Reach · turn 66"]
    ]);
  });
});

describe("mageNotePaletteRows (ah-mlls.5)", () => {
  const plan = (unitId: string, comment: string, factionId = "95") => ({
    factionId,
    unitId,
    goals: [],
    casts: [],
    comment,
    updatedAt: "2026-01-01T00:00:00Z"
  });
  const groups = [
    {
      mages: [
        { key: "95/2214", factionId: "95", unitId: "2214", name: "Ulla the Grey" },
        { key: "95/1988", factionId: "95", unitId: "1988", name: "Bram" }
      ]
    },
    { mages: [{ key: "17/3001", factionId: "17", unitId: "3001", name: "Far Sage" }] }
  ];

  it("lists a mage's note under his name and the study planner", () => {
    expect(
      mageNotePaletteRows([plan("2214", "Needs FIRE 3.")], groups, new Set(["2214"]))
    ).toEqual([
      { key: "95/2214", text: "Needs FIRE 3.", place: "Ulla the Grey (2214) · study planner" }
    ]);
  });

  it("leaves out an empty note", () => {
    expect(mageNotePaletteRows([plan("2214", "   ")], groups, new Set(["2214"]))).toEqual([]);
  });

  it("leaves out a mage this turn's report does not show", () => {
    expect(
      mageNotePaletteRows([plan("3001", "Iron", "17")], groups, new Set(["2214"]))
    ).toEqual([]);
  });

  it("leaves out a plan whose mage the planner does not list", () => {
    expect(mageNotePaletteRows([plan("1650", "Iron")], groups, new Set(["1650"]))).toEqual([]);
  });
});

describe("noteSnippet (ah-mlls.5)", () => {
  it("cuts out the line holding the match, keeping the note's own case", () => {
    expect(noteSnippet("Iron traders pass here.", "iron")).toEqual({
      lead: false,
      before: "",
      match: "Iron",
      after: " traders pass here."
    });
  });

  it("shows a later line when that is where the match is", () => {
    expect(noteSnippet("Scouted turn 61.\nA seam of iron under the ridge.", "iron")).toEqual({
      lead: false,
      before: "A seam of ",
      match: "iron",
      after: " under the ridge."
    });
  });

  it("starts a little before a match far into its line, at a word", () => {
    const text = "Needs FIRE 3 before the long winter siege, then switch her to iron-working? Ask.";
    const snippet = noteSnippet(text, "iron");
    expect(snippet.lead).toBe(true);
    expect(snippet.match).toBe("iron");
    expect(snippet.after).toBe("-working? Ask.");
    expect(snippet.before.length).toBeLessThanOrEqual(20);
    expect(snippet.before).toBe("then switch her to ");
  });

  it("matches the first place the typed text occurs", () => {
    expect(noteSnippet("ore, then more ore", "ore").before).toBe("");
  });

  it("returns the first line unmarked when nothing matches", () => {
    expect(noteSnippet("First line\nSecond", "zzz")).toEqual({
      lead: false,
      before: "First line",
      match: "",
      after: ""
    });
  });
});

describe("an order row (ah-mlls.6)", () => {
  function withOrders(openGameData: (entryId: string) => void): PaletteEntry[] {
    return buildPaletteEntries({
      armies: [],
      ownUnits: [],
      foreignUnits: [],
      staleUnits: [],
      settlements: [],
      factions: [],
      regions: [],
      structures: [],
      actions: [{ id: "theme", label: "Toggle theme", run: noop }],
      orderCommands: ["MOVE", "STUDY"],
      // The dictionary holds the orders too, now that they are game data entries.
      gameData: [
        { id: "skill:MINI", category: "skill", name: "mining", tag: "MINI" },
        { id: "order:MOVE", category: "order", name: "MOVE", tag: null },
        { id: "order:STUDY", category: "order", name: "STUDY", tag: null }
      ],
      openGameData
    });
  }

  it("opens the order's game data entry rather than typing it", () => {
    const opened: string[] = [];
    const study = withOrders((entryId) => opened.push(entryId)).find(
      (entry) => entry.label === "STUDY"
    );
    study?.run();
    expect(opened).toEqual(["order:STUDY"]);
  });

  it("lists each order once, as an order, in its old place before the dictionary", () => {
    expect(withOrders(noop).map((entry) => [entry.kind, entry.label])).toEqual([
      ["action", "Toggle theme"],
      ["order-help", "MOVE"],
      ["order-help", "STUDY"],
      ["skill", "mining MINI"]
    ]);
  });
});

describe("mageSheetPaletteAction (ah-mlls.8)", () => {
  const make = (hasReport: boolean, hasGameData: boolean, mageCount: number) =>
    mageSheetPaletteAction({ hasReport, hasGameData, mageCount, run: noop });

  it("is greyed with needs a report before any report, game data or not", () => {
    for (const hasGameData of [false, true]) {
      const action = make(false, hasGameData, 0);
      expect(action.label).toBe("Export mage sheet");
      expect(action.unavailable).toBe("needs a report");
      expect(action.count).toBeUndefined();
    }
  });

  it("is greyed with needs the game data when a report has no ruleset", () => {
    expect(make(true, false, 3).unavailable).toBe("needs the game data");
  });

  it("stays choosable with a dim no mages when the faction has none", () => {
    const action = make(true, true, 0);
    expect(action.unavailable).toBeUndefined();
    expect(action.count).toEqual({ text: "no mages", quiet: true });
  });

  it("carries no remark when there are mages", () => {
    const action = make(true, true, 6);
    expect(action.unavailable).toBeUndefined();
    expect(action.count).toBeUndefined();
  });

  it("reaches the palette as an action row, found by its label alone", () => {
    const build = (action: ReturnType<typeof make>) =>
      buildPaletteEntries({
        armies: [],
        ownUnits: [],
        foreignUnits: [],
        staleUnits: [],
        settlements: [],
        factions: [],
        regions: [],
        structures: [],
        actions: [action],
        orderCommands: [],
        gameData: [],
        openGameData: noop
      });
    expect(build(make(false, false, 0))).toEqual([
      expect.objectContaining({
        id: "action-export-mage-sheet",
        kind: "action",
        label: "Export mage sheet",
        unavailable: "needs a report"
      })
    ]);
    const empty = build(make(true, true, 0));
    expect(empty[0]?.count).toEqual({ text: "no mages", quiet: true });
    for (const query of ["exp", "mage", "sheet"]) {
      expect(filterPalette(empty, query)).toHaveLength(1);
    }
    expect(filterPalette(empty, "no mages")).toHaveLength(0);
  });
});
