import { describe, expect, it } from "vitest";
import {
  aParsedReport,
  aReportRegion,
  aReportUnit,
  type ArmyRecord,
  type HexNoteRecord,
  type ParsedReport,
  type ReportUnit,
  type StudyPlanRecord
} from "@atlantis/core-client";
import { aHexNode } from "../testing/builders";
import type { PaletteAction, PaletteEntry } from "../commandPalette";
import {
  assemblePaletteInput,
  paletteEntriesFor,
  type PaletteDoors,
  type PaletteWorld
} from "./paletteInput";

/** Every door, recording what it was asked to do, so a row's `run` can be checked by its call. */
function doors(): { doors: PaletteDoors; calls: string[] } {
  const calls: string[] = [];
  const say =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args.map(String)].join(" "));
    };
  return {
    calls,
    doors: {
      showArmy: say("showArmy"),
      goToUnit: say("goToUnit"),
      selectHex: say("selectHex"),
      openFaction: say("openFaction"),
      openSettings: say("openSettings"),
      switchGame: say("switchGame"),
      setTheme: say("setTheme"),
      openDialog: (dialog) => calls.push(`openDialog ${JSON.stringify(dialog)}`),
      openExport: say("openExport"),
      exportMageSheet: say("exportMageSheet"),
      openBattles: say("openBattles"),
      openProduction: say("openProduction"),
      addHexNote: say("addHexNote"),
      revealHexNote: say("revealHexNote"),
      revealMageNote: say("revealMageNote")
    }
  };
}

/** A world with no game, no report and an empty map, overridden as each test needs. */
function world(overrides: Partial<PaletteWorld> = {}): PaletteWorld {
  return {
    gameOpen: false,
    parsed: null,
    merged: [],
    hexes: [],
    currentTurn: null,
    armies: [],
    unitsById: new Map(),
    orderedOwnUnitIds: [],
    hexLabel: (regionId) => `hex ${regionId}`,
    orderCommands: [],
    gameDataEntries: null,
    magicTreeReady: false,
    offersProduction: false,
    mageCount: 0,
    selectedRegionId: null,
    theme: "dark",
    mac: false,
    hexNotes: [],
    studyPlans: [],
    plannerGroups: [],
    ...overrides
  };
}

const actionIds = (w: PaletteWorld) =>
  (assemblePaletteInput(w, doors().doors).actions ?? []).map((action) => action.id);

const report = (units: ReportUnit[], extra: Partial<ParsedReport> = {}) =>
  aParsedReport({ regions: [aReportRegion({ regionId: "1:7,53", units })], ...extra });

describe("assemblePaletteInput (ah-1xl5)", () => {
  it("lists the player's own units in the given order, named from the report", () => {
    const parsed = report([
      aReportUnit({ unitId: "13401", name: "Drones", own: true }),
      aReportUnit({ unitId: "18642", name: "Seven of Eight", own: true })
    ]);
    const { doors: d, calls } = doors();
    const input = assemblePaletteInput(
      world({ parsed, orderedOwnUnitIds: ["18642", "13401", "999"] }),
      d
    );
    expect(input.ownUnits?.map(({ unitId, name }) => [unitId, name])).toEqual([
      ["18642", "Seven of Eight"],
      ["13401", "Drones"],
      ["999", "999"]
    ]);
    input.ownUnits?.[0]?.run();
    expect(calls).toEqual(["goToUnit 18642"]);
  });

  it("lists the Armies only with a game open, counted from this turn's units", () => {
    const army: ArmyRecord = {
      id: "army-1",
      gameId: "g",
      name: "Northern escort",
      members: [
        { unitId: "1", factionId: "95" },
        { unitId: "2", factionId: "95" }
      ] as ArmyRecord["members"],
      createdAt: "",
      updatedAt: ""
    };
    const unitsById = new Map([["1", aReportUnit({ unitId: "1" })]]);
    expect(assemblePaletteInput(world({ armies: [army], unitsById }), doors().doors).armies).toEqual(
      []
    );
    const { doors: d, calls } = doors();
    const [row] = assemblePaletteInput(world({ gameOpen: true, armies: [army], unitsById }), d).armies ?? [];
    expect(row).toMatchObject({ armyId: "army-1", name: "Northern escort", shownCount: 1 });
    row?.run();
    expect(calls).toEqual(["showArmy army-1"]);
  });

  it("lists other factions' units with their owner, going to the unit in its hex", () => {
    const parsed = report([
      aReportUnit({ unitId: "2207", name: "Wardens", own: false, factionId: "10", factionName: "Thane's Ring" }),
      aReportUnit({ unitId: "3110", name: "Scouts", own: false, factionId: null, factionName: null }),
      aReportUnit({ unitId: "518", name: "Guard", own: true })
    ]);
    const { doors: d, calls } = doors();
    const foreign = assemblePaletteInput(world({ parsed }), d).foreignUnits ?? [];
    expect(foreign.map(({ unitId, faction }) => [unitId, faction])).toEqual([
      ["2207", { label: "Thane's Ring (10)", concealed: false }],
      ["3110", { label: "Faction not shown", concealed: true }]
    ]);
    foreign[0]?.run();
    expect(calls).toEqual(["goToUnit 2207 1:7,53"]);
  });

  it("lists remembered units from stale hexes only, choosing one selects its hex", () => {
    const sighting = { unit: aReportUnit({ unitId: "1", name: "Old Scout" }), lastSeenTurn: 60 };
    const hexes = [
      aHexNode({ regionId: "1:1,1", knowledge: "stale", rememberedUnits: [sighting] as never }),
      aHexNode({ regionId: "1:3,3", knowledge: "current", rememberedUnits: [sighting] as never })
    ];
    const { doors: d, calls } = doors();
    const stale = assemblePaletteInput(world({ hexes }), d).staleUnits ?? [];
    expect(stale.map(({ regionId, name, lastSeenTurn }) => [regionId, name, lastSeenTurn])).toEqual([
      ["1:1,1", "Old Scout", 60]
    ]);
    stale[0]?.run();
    expect(calls).toEqual(["selectHex 1:1,1"]);
  });

  it("lists the known factions, opening another's details or the player's own", () => {
    const parsed = report([
      aReportUnit({ unitId: "2207", own: false, factionId: "10", factionName: "Thane's Ring" })
    ]);
    const { doors: d, calls } = doors();
    const factions = assemblePaletteInput(world({ parsed }), d).factions ?? [];
    expect(factions.map(({ factionId, own }) => [factionId, own])).toEqual([
      ["95", true],
      ["10", false]
    ]);
    for (const faction of factions) faction.run();
    expect(calls).toEqual(["openFaction null", "openFaction 10"]);
  });

  it("lists every known gate, remembered ones included, choosing one selects its hex (ah-uni7j)", () => {
    const hexes = [
      aHexNode({
        regionId: "1:36,4",
        label: "mountain (36,4) in Slounspifra",
        region: aReportRegion({ regionId: "1:36,4", gate: "There is a Gate here (Gate 987)." })
      }),
      aHexNode({
        regionId: "1:2,4",
        label: "tundra (2,4) in Frostmere",
        region: aReportRegion({ regionId: "1:2,4", gate: null })
      })
    ];
    const gates = new Map([["1:2,4", { sentence: "There is a Gate here (Gate 12).", turn: 68 }]]);
    const { doors: d, calls } = doors();
    const rows = assemblePaletteInput(world({ hexes, currentTurn: 70, gates }), d).gates ?? [];
    expect(rows.map(({ label, lastSeenTurn }) => [label, lastSeenTurn])).toEqual([
      ["Gate 12 · tundra (2,4) in Frostmere", 68],
      ["Gate 987 · mountain (36,4) in Slounspifra", undefined]
    ]);
    rows[1]?.run();
    expect(calls).toEqual(["selectHex 1:36,4"]);
  });

  it("lists a report's own gate when no gate memory is given (ah-uni7j)", () => {
    const hexes = [
      aHexNode({
        regionId: "1:36,4",
        label: "mountain (36,4) in Slounspifra",
        region: aReportRegion({ regionId: "1:36,4", gate: "There is a closed Gate here." })
      })
    ];
    const rows = assemblePaletteInput(world({ hexes, currentTurn: 70 }), doors().doors).gates ?? [];
    expect(rows.map((row) => row.label)).toEqual(["Gate (closed) · mountain (36,4) in Slounspifra"]);
  });

  it("lists settlements with the turn a stale one was seen, choosing one selects its hex", () => {
    const settlement = { name: "Mudwick", size: "village" };
    const hexes = [
      aHexNode({ regionId: "1:9,9", knowledge: "stale", lastSeenTurn: 64, settlement, label: "swamp (9,9)" })
    ];
    const { doors: d, calls } = doors();
    const [row] = assemblePaletteInput(world({ hexes, currentTurn: 70 }), d).settlements ?? [];
    expect(row).toMatchObject({
      regionId: "1:9,9",
      label: "Mudwick [village] · swamp (9,9)",
      lastSeenTurn: 64
    });
    row?.run();
    expect(calls).toEqual(["selectHex 1:9,9"]);
  });

  it("lists every hex as a region, choosing one selects it", () => {
    const { doors: d, calls } = doors();
    const regions =
      assemblePaletteInput(world({ hexes: [aHexNode({ regionId: "1:7,53", label: "mountain (7,53)" })] }), d)
        .regions ?? [];
    expect(regions.map(({ regionId, label }) => [regionId, label])).toEqual([["1:7,53", "mountain (7,53)"]]);
    regions[0]?.run();
    expect(calls).toEqual(["selectHex 1:7,53"]);
  });

  const mine = {
    structureId: "4",
    name: "Soggy Saw Mill",
    kind: "Mine",
    baseKind: "Mine",
    qualifiers: [],
    vessels: [],
    description: null,
    needs: null
  };

  it("takes structures from the map, a stale hex's carrying the turn it was seen", () => {
    const region = aReportRegion({ regionId: "1:7,53", structures: [mine] as never });
    const hexes = [aHexNode({ regionId: "1:7,53", knowledge: "stale", lastSeenTurn: 60, region })];
    const [row] = assemblePaletteInput(world({ hexes }), doors().doors).structures ?? [];
    expect(row).toMatchObject({ structureId: "1:7,53-4", lastSeenTurn: 60 });
    expect(row?.label).toContain("Soggy Saw Mill");
  });

  it("takes structures from the report when the map is empty", () => {
    const parsed = aParsedReport({
      regions: [aReportRegion({ regionId: "1:7,53", structures: [mine] as never })]
    });
    const [row] = assemblePaletteInput(world({ parsed }), doors().doors).structures ?? [];
    expect(row?.structureId).toBe("1:7,53-4");
    expect(row?.lastSeenTurn).toBeUndefined();
  });

  it("offers the always-there actions with nothing loaded, the mage sheet greyed", () => {
    const input = assemblePaletteInput(world(), doors().doors);
    expect(input.actions?.map((action) => action.id)).toEqual([
      "settings",
      "toggle-theme",
      "shortcuts",
      "export-mage-sheet"
    ]);
    expect(input.actions?.find((action) => action.id === "export-mage-sheet")?.unavailable).toBe(
      "needs a report"
    );
  });

  it("offers each gated action only where it can open", () => {
    expect(actionIds(world({ gameOpen: true }))).toContain("switch-game");
    expect(actionIds(world({ gameDataEntries: [] }))).toContain("browse-game-data");
    expect(actionIds(world({ magicTreeReady: true }))).toEqual(
      expect.arrayContaining(["magic-study-tree", "study-planner"])
    );
    const parsed = report([]);
    expect(actionIds(world({ parsed }))).toContain("export-map");
    expect(actionIds(world({ parsed }))).not.toContain("open-battles");
    expect(actionIds(world({ parsed: { ...parsed, battles: [{}] as never } }))).toContain("open-battles");
    expect(actionIds(world({ offersProduction: true }))).not.toContain("open-production");
    expect(actionIds(world({ parsed, offersProduction: true }))).toContain("open-production");
    expect(actionIds(world({ gameOpen: true }))).not.toContain("add-hex-note");
    expect(actionIds(world({ selectedRegionId: "1:7,53" }))).not.toContain("add-hex-note");
    expect(actionIds(world({ gameOpen: true, selectedRegionId: "1:7,53" }))).toContain("add-hex-note");
  });

  it("runs each action through its door", () => {
    const { doors: d, calls } = doors();
    const parsed = report([], { battles: [{}] as never });
    const input = assemblePaletteInput(
      world({
        gameOpen: true,
        parsed,
        gameDataEntries: [],
        magicTreeReady: true,
        offersProduction: true,
        selectedRegionId: "1:7,53",
        theme: "light"
      }),
      d
    );
    for (const action of input.actions ?? []) action.run();
    expect(calls).toEqual([
      "openSettings",
      "switchGame",
      "setTheme dark",
      'openDialog {"id":"help"}',
      'openDialog {"id":"gameData","entryId":null}',
      'openDialog {"id":"magicTree","tag":null}',
      'openDialog {"id":"studyPlanner"}',
      "openExport",
      "exportMageSheet",
      "openBattles",
      "openProduction",
      "addHexNote 1:7,53"
    ]);
  });

  it("shows each binding in the platform's own spelling", () => {
    const binding = (mac: boolean) =>
      assemblePaletteInput(world({ mac }), doors().doors).actions?.find((a) => a.id === "shortcuts")
        ?.binding;
    expect(binding(true)).toBeDefined();
    expect(binding(false)).toBeDefined();
    expect(binding(true)).not.toEqual(binding(false));
  });

  it("opens an order or a dictionary entry in the game data dialog", () => {
    const { doors: d, calls } = doors();
    const input = assemblePaletteInput(
      world({
        orderCommands: ["MOVE"],
        gameDataEntries: [{ id: "skill:MINI", category: "skill", name: "mining", tag: "MINI" }]
      }),
      d
    );
    expect(input.orderCommands).toEqual(["MOVE"]);
    expect(input.gameData?.map((entry) => entry.id)).toEqual(["skill:MINI"]);
    input.openGameData?.("skill:MINI");
    expect(calls).toEqual(['openDialog {"id":"gameData","entryId":"skill:MINI"}']);
  });

  const note: HexNoteRecord = {
    id: "n1",
    gameId: "g",
    regionId: "1:7,53",
    text: "A seam of iron",
    onMap: true,
    turn: 61,
    createdAt: "",
    updatedAt: ""
  };

  it("lists hex notes only with a game open and a report loaded", () => {
    const parsed = report([]);
    const hexes = [aHexNode({ regionId: "1:7,53", label: "mountain (7,53)" })];
    expect(assemblePaletteInput(world({ hexNotes: [note], parsed, hexes }), doors().doors).hexNotes).toEqual([]);
    expect(
      assemblePaletteInput(world({ hexNotes: [note], gameOpen: true, hexes }), doors().doors).hexNotes
    ).toEqual([]);
    const { doors: d, calls } = doors();
    const [row] =
      assemblePaletteInput(world({ hexNotes: [note], gameOpen: true, parsed, hexes }), d).hexNotes ?? [];
    expect(row).toMatchObject({ noteId: "n1", text: "A seam of iron", place: "mountain (7,53) · turn 61" });
    row?.run();
    expect(calls).toEqual(["selectHex 1:7,53", "revealHexNote 1:7,53 n1"]);
  });

  it("places a hex note off the map by the hex label it is given", () => {
    const [row] =
      assemblePaletteInput(world({ hexNotes: [note], gameOpen: true, parsed: report([]) }), doors().doors)
        .hexNotes ?? [];
    expect(row?.place).toBe("hex 1:7,53 · turn 61");
  });

  it("lists mage notes only with a game open and the magic tree loaded", () => {
    const plan = { factionId: "95", unitId: "18642", comment: "Push to FORC 3" } as StudyPlanRecord;
    const plannerGroups = [
      { mages: [{ key: "95/18642", factionId: "95", unitId: "18642", name: "Seven" }] }
    ];
    const parsed = report([aReportUnit({ unitId: "18642", own: true })]);
    const base = { studyPlans: [plan], plannerGroups, parsed };
    expect(assemblePaletteInput(world({ ...base, gameOpen: true }), doors().doors).mageNotes).toEqual([]);
    expect(assemblePaletteInput(world({ ...base, magicTreeReady: true }), doors().doors).mageNotes).toEqual([]);
    const { doors: d, calls } = doors();
    const [row] =
      assemblePaletteInput(world({ ...base, gameOpen: true, magicTreeReady: true }), d).mageNotes ?? [];
    expect(row).toMatchObject({ key: "95/18642", text: "Push to FORC 3" });
    row?.run();
    expect(calls).toEqual(["revealMageNote 95/18642"]);
  });
});

describe("paletteEntriesFor (ah-1xl5)", () => {
  it("puts the leading actions before the input's own", () => {
    const noop = () => {};
    const leading: PaletteAction[] = [{ id: "import", label: "Import report", run: noop }];
    const entries: PaletteEntry[] = paletteEntriesFor(
      { actions: [{ id: "settings", label: "Open settings", run: noop }] },
      leading
    );
    expect(entries.map((entry) => entry.id)).toEqual(["action-import", "action-settings"]);
  });
});
