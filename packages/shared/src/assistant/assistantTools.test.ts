import { describe, expect, it } from "vitest";
import {
  type ArmyMemberRecord,
  type ArmyRecord,
  aKnownMap,
  aKnownMapHex,
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit,
  aUnitSilver,
  type OrderDiagnostic,
  type OrderValidationResult,
  type OrdersPreviewResponse,
  type ReportUnit,
  type UnitPreview,
  type UnitSilver
} from "@atlantis/core-client";
import { battleFileOf, battleFileText } from "../armyExport";
import { NO_DERIVED_SKILLS, type DerivedSkills } from "../battleSkills";
import { orderProcessingFor } from "../orderProcessing";
import { newAssistantSeen } from "./assistantSeen";
import { ASSISTANT_TOOLS, answerToolCall, readyArmies, type AssistantHost, type AssistantTurn } from "./assistantTools";

const DOCUMENT = [
  "#atlantis 3",
  "",
  ";*** plain (1,1) in Coast ***",
  "",
  "unit 100",
  "work",
  "",
  "unit 101",
  "",
  "#end",
  ""
].join("\n");

/** A plains hex last seen on turn 9, with a shaft and a foreign unit standing there then. */
const REMEMBERED = aReportRegion({
  regionId: "1:19,5",
  coordinate: { x: 19, y: 5, z: 1 },
  terrain: "plain",
  province: "Borg",
  settlement: { name: "Ibiz", size: "village" },
  exits: [
    {
      direction: "North",
      terrain: "forest",
      coordinate: { x: 19, y: 3, z: 1 },
      province: "Borg",
      settlement: null
    }
  ],
  structures: [
    {
      structureId: "4",
      name: "Shaft",
      kind: "Shaft",
      baseKind: "Shaft",
      qualifiers: [],
      vessels: [],
      description: null,
      needs: null
    }
  ],
  units: []
});

/** The map the HUD draws for `aTurn`: the report's two regions, one remembered, one only named. */
function aMap() {
  return aKnownMap({
    currentTurn: 12,
    hexes: [
      aKnownMapHex({ coordinate: { x: 1, y: 1, z: 1 }, terrain: "plain", province: "Coast", lastSeenTurn: 12 }),
      aKnownMapHex({ coordinate: { x: 2, y: 1, z: 1 }, terrain: "forest", province: "Woods", lastSeenTurn: 12 }),
      aKnownMapHex({ coordinate: { x: 19, y: 3, z: 1 }, terrain: "forest", province: "Borg", knowledge: "named", lastSeenTurn: 9 }),
      aKnownMapHex({
        coordinate: { x: 19, y: 5, z: 1 },
        terrain: "plain",
        province: "Borg",
        knowledge: "stale",
        lastSeenTurn: 9,
        region: REMEMBERED,
        settlement: { name: "Ibiz", size: "village" },
        rememberedUnits: [
          {
            unit: aReportUnit({ unitId: "777", name: "Guards", own: false, factionId: "5", factionName: "Borgs", men: 20 }),
            lastSeenTurn: 9
          }
        ]
      })
    ]
  });
}

/** What `get_turn_overview` names the turn `aTurn` builds: game, faction and turn number. */
const KEY = "game-1/3/12";

function aTurn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  const home = aReportRegion({
    regionId: "1,1,1",
    coordinate: { x: 1, y: 1, z: 1 },
    terrain: "plain",
    province: "Coast",
    units: [
      aReportUnit({
        unitId: "100",
        name: "Farmers",
        regionId: "1,1,1",
        own: true,
        factionId: "3",
        men: 10,
        items: [{ amount: 10, name: "humans", tag: "HUMN" }],
        skills: [{ name: "farming", tag: "FARM", level: 1, points: 30 }]
      }),
      aReportUnit({ unitId: "101", name: "Scout", regionId: "1,1,1", own: true, factionId: "3", men: 1 }),
      aReportUnit({ unitId: "900", name: "Stranger", regionId: "1,1,1", own: false, factionId: "9" })
    ]
  });
  const away = aReportRegion({
    regionId: "2,1,1",
    coordinate: { x: 2, y: 1, z: 1 },
    terrain: "forest",
    province: "Woods",
    units: []
  });
  return {
    gameId: "game-1",
    gameName: "Test game",
    rulesetId: null,
    rulesetText: JSON.stringify({
      items: { HUMN: { name: "human", kind: "man" } },
      skills: { FARM: { name: "farming", cost: 10 } },
      buildings: {}
    }),
    parsed: aParsedReport({
      header: aReportHeaderInfo({
        factionId: "3",
        factionName: "Testers",
        turnNumber: 12,
        month: "March",
        year: 2,
        events: ["Farmers (100) earns 50 silver."]
      }),
      regions: [home, away]
    }),
    rawReport: "Testers (3) Report\nline two about silver\nline three\n",
    ordersDocument: DOCUMENT,
    knownMap: aMap(),
    ...overrides
  };
}

function aDiagnostic(overrides: Partial<OrderDiagnostic> = {}): OrderDiagnostic {
  return {
    code: "unknown-order",
    message: "Unknown order FLY.",
    lineStart: 9,
    lineEnd: 9,
    severity: "error",
    unitId: "101",
    regionId: "1,1,1",
    ...overrides
  } as OrderDiagnostic;
}

/** What the fake host's preview and validation forecast, beside its diagnostics. */
interface Forecast {
  readonly silver?: UnitSilver[];
  readonly preview?: OrdersPreviewResponse;
}

/** What the host lends the army tools, each part replaceable by a test. */
interface ArmyWorld {
  armies: readonly ArmyRecord[] | null;
  skills: DerivedSkills;
  scanning: boolean;
  unreadTurns: number;
  /** Rejects every write with this message when set. */
  writeFails: string | null;
}

/** A host over one turn, recording what it was asked to write and answering with `diagnostics`. */
function aHost(turn: AssistantTurn | null, diagnostics: OrderDiagnostic[] = [], forecast: Forecast = {}, world: Partial<ArmyWorld> = {}) {
  const written: string[] = [];
  const files: { path: string; text: string }[] = [];
  const armyWorld: ArmyWorld = {
    armies: [],
    skills: NO_DERIVED_SKILLS,
    scanning: false,
    unreadTurns: 0,
    writeFails: null,
    ...world
  };
  let current = turn;
  const host: AssistantHost & { typeByHand(document: string): void } = {
    armies: () => armyWorld.armies,
    battleSkills: () => ({ skills: armyWorld.skills, scanning: armyWorld.scanning, unreadTurns: armyWorld.unreadTurns }),
    writeFile: async (path, text) => {
      if (armyWorld.writeFails !== null) {
        throw new Error(armyWorld.writeFails);
      }
      files.push({ path, text });
    },
    turn: () => current,
    seen: newAssistantSeen(),
    typeByHand: (document) => {
      if (current !== null) {
        current = { ...current, ordersDocument: document };
      }
    },
    orders: orderProcessingFor(null),
    bannerFor: (regionId) => (regionId === "1,1,1" ? ";*** plain (1,1) in Coast ***" : null),
    validate: async () => ({ diagnostics, silver: forecast.silver ?? [] }) as unknown as OrderValidationResult,
    preview: async () => forecast.preview ?? { regions: [] },
    writeOrders: (update) => {
      if (current !== null) {
        const document = update(current.ordersDocument);
        written.push(document);
        current = { ...current, ordersDocument: document };
      }
    }
  };
  return { host, written, files };
}

async function call(host: AssistantHost, name: string, args: Record<string, unknown> = {}) {
  return answerToolCall(host, name, args);
}

function json(text: string): any {
  return JSON.parse(text);
}

describe("the assistant's tool list", () => {
  it("declares every tool with a description and an object schema", () => {
    const names = ASSISTANT_TOOLS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("answers every tool it declares", async () => {
    const { host } = aHost(aTurn());

    for (const tool of ASSISTANT_TOOLS) {
      const answer = await call(host, tool.name, {
        turnKey: KEY,
        unitId: "100",
        regionId: "1,1,1",
        orders: "work",
        query: "silver",
        path: "/tmp/battle.json"
      });
      expect(answer.text).not.toContain("no tool called");
    }
  });
});

describe("answering a call", () => {
  it("refuses every call while no turn is open", async () => {
    const { host } = aHost(null);

    const answer = await call(host, "get_turn_overview");

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("No turn is open");
  });

  it("refuses a tool it does not have", async () => {
    const { host } = aHost(aTurn());

    const answer = await call(host, "launch_missiles");

    expect(answer).toEqual({ isError: true, text: 'Atlantis HUD has no tool called "launch_missiles".' });
  });

  it("names the faction, the turn and what the faction has in the overview", async () => {
    const { host } = aHost(aTurn());

    const overview = json((await call(host, "get_turn_overview")).text);

    expect(overview).toMatchObject({
      game: "Test game",
      faction: { id: "3", name: "Testers" },
      turn: 12,
      month: "March",
      year: 2,
      ownUnits: 2,
      regionsWithOwnUnits: 1
    });
  });

  it("lists the faction's own units with where they stand and what they are doing", async () => {
    const { host } = aHost(aTurn());

    const units = json((await call(host, "list_units")).text);

    expect(units.map((unit: { unitId: string }) => unit.unitId)).toEqual(["100", "101"]);
    expect(units[0]).toMatchObject({
      unitId: "100",
      name: "Farmers",
      regionId: "1,1,1",
      region: "plain (1,1,1) in Coast",
      men: 10,
      skills: "FARM 1 (30)",
      orders: "work"
    });
  });

  it("lists foreign units too when asked", async () => {
    const { host } = aHost(aTurn());

    const units = json((await call(host, "list_units", { includeForeign: true })).text);

    expect(units.map((unit: { unitId: string }) => unit.unitId)).toEqual(["100", "101", "900"]);
  });

  it("gives one unit whole, with its orders and the problems the validator finds in them", async () => {
    const { host } = aHost(aTurn(), [aDiagnostic({ lineStart: 6, lineEnd: 6, unitId: "100" })]);

    const unit = json((await call(host, "get_unit", { unitId: "100" })).text);

    expect(unit.unit.name).toBe("Farmers");
    expect(unit.orders).toBe("work");
    expect(unit.problems).toEqual(["its line 1 error unknown-order: Unknown order FLY."]);
  });

  it("refuses a unit the report does not show", async () => {
    const { host } = aHost(aTurn());

    const answer = await call(host, "get_unit", { unitId: "555" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("555");
  });

  it("finds a region by its id or by its coordinates", async () => {
    const { host } = aHost(aTurn());

    const byId = json((await call(host, "get_region", { regionId: "2,1,1" })).text);
    const byCoordinates = json((await call(host, "get_region", { x: 2, y: 1, z: 1 })).text);

    expect(byId.province).toBe("Woods");
    expect(byCoordinates.province).toBe("Woods");
  });

  it("refuses to list the units of a region the report does not show, rather than answering with none", async () => {
    const { host } = aHost(aTurn());

    const answer = await call(host, "list_units", { regionId: "9,9,9" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("list_regions");
  });

  it("asks for the level when coordinates alone match more than one region", async () => {
    const turn = aTurn();
    const below = aReportRegion({
      regionId: "1,1,2",
      coordinate: { x: 1, y: 1, z: 2 },
      terrain: "tunnels",
      province: "Deep",
      units: []
    });
    const { host } = aHost({ ...turn, parsed: { ...turn.parsed, regions: [...turn.parsed.regions, below] } });

    const ambiguous = await call(host, "get_region", { x: 1, y: 1 });
    const unambiguous = json((await call(host, "get_region", { x: 2, y: 1 })).text);

    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("z");
    expect(unambiguous.province).toBe("Woods");
  });

  it("lists every region of the turn, saying whose units stand in it", async () => {
    const { host } = aHost(aTurn());

    const regions = json((await call(host, "list_regions")).text);

    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ regionId: "1,1,1", ownUnits: ["100", "101"], foreignUnits: 1 });
  });

  it("gives the turn's events", async () => {
    const { host } = aHost(aTurn());

    const events = json((await call(host, "get_turn_events")).text);

    expect(events.events).toEqual(["Farmers (100) earns 50 silver."]);
  });

  it("gives the whole orders document, or one unit's block of it", async () => {
    const { host } = aHost(aTurn());

    expect((await call(host, "get_orders")).text).toBe(DOCUMENT);
    expect((await call(host, "get_orders", { unitId: "100" })).text).toBe("work");
  });

  it("writes one unit's orders into the document, leaving the rest as it was", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await call(host, "set_unit_orders", { turnKey: KEY, unitId: "101", orders: "study FARM\n" });

    expect(answer.isError).toBe(false);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(DOCUMENT.replace("unit 101\n", "unit 101\nstudy FARM\n"));
    expect((await call(host, "get_orders", { unitId: "101" })).text).toBe("study FARM");
  });

  it("reports what the validator makes of a unit's orders once they are written", async () => {
    const { host } = aHost(aTurn(), [aDiagnostic({ lineStart: 9, lineEnd: 9, unitId: "101" })]);

    const answer = json((await call(host, "set_unit_orders", { turnKey: KEY, unitId: "101", orders: "fly" })).text);

    expect(answer.written).toBe(true);
    expect(answer.problems).toEqual(["its line 1 error unknown-order: Unknown order FLY."]);
  });

  it("creates the block of an own unit the document has none for, under its region's banner", async () => {
    const turn = aTurn({ ordersDocument: "#atlantis 3\n\n;*** plain (1,1) in Coast ***\n\n#end\n" });
    const { host, written } = aHost(turn);

    await call(host, "set_unit_orders", { turnKey: KEY, unitId: "100", orders: "work" });

    expect(written[0]).toContain("unit 100\nwork");
  });

  it("refuses to write orders for a unit that is not the faction's own", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await call(host, "set_unit_orders", { turnKey: KEY, unitId: "900", orders: "work" });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("hands out a key for the open turn, and refuses a write made for any other turn", async () => {
    const { host, written } = aHost(aTurn());

    const overview = json((await call(host, "get_turn_overview")).text);
    const stale = await call(host, "set_unit_orders", { turnKey: "game-1/3/11", unitId: "101", orders: "work" });

    expect(overview.turnKey).toBe(KEY);
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("get_turn_overview");
    expect(written).toEqual([]);
  });

  it("makes its write on the document as it then stands, keeping what the player typed since", async () => {
    const { host } = aHost(aTurn());
    let landed = "";
    let touched = "";
    host.writeOrders = (update, unitId) => {
      landed = update(DOCUMENT.replace("unit 100\nwork", "unit 100\ntax"));
      touched = unitId;
    };

    await call(host, "set_unit_orders", { turnKey: KEY, unitId: "101", orders: "study FARM" });

    expect(landed).toContain("unit 100\ntax");
    expect(landed).toContain("unit 101\nstudy FARM");
    expect(touched).toBe("101");
  });

  it.each([
    ["the unit's own header", "unit 101\nstudy FARM"],
    ["another unit's block", "work\nunit 100\nmove N"],
    ["a header in another case, indented", "work\n  UNIT 100\nmove N"],
    ["the end of the file", "work\n#end"],
    ["the start of the file", "#atlantis 3\nwork"]
  ])("refuses orders that carry %s, which would reshape the document", async (_what, orders) => {
    const { host, written } = aHost(aTurn());

    const answer = await call(host, "set_unit_orders", { turnKey: KEY, unitId: "101", orders });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("refuses orders that are not text", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await call(host, "set_unit_orders", { turnKey: KEY, unitId: "101", orders: { order: "work" } });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("lists every problem in the document with the unit it belongs to", async () => {
    const { host } = aHost(aTurn(), [
      aDiagnostic(),
      aDiagnostic({ severity: "warning", code: "idle", message: "No long order.", unitId: "100", lineStart: 5 })
    ]);

    const problems = json((await call(host, "validate_orders")).text);

    expect(problems).toEqual({
      errors: 1,
      warnings: 1,
      problems: [
        "unit 101 line 9 error unknown-order: Unknown order FLY.",
        "unit 100 line 5 warning idle: No long order."
      ]
    });
  });

  it("looks an item or skill up in the game data by tag or by name", async () => {
    const { host } = aHost(aTurn());

    const byTag = json((await call(host, "get_game_data", { query: "FARM" })).text);
    const byName = json((await call(host, "get_game_data", { query: "human" })).text);

    expect(byTag).toEqual([{ kind: "skills", tag: "FARM", data: { name: "farming", cost: 10 } }]);
    expect(byName).toEqual([{ kind: "items", tag: "HUMN", data: { name: "human", kind: "man" } }]);
  });

  it("searches the report's own text, numbering each line it finds", async () => {
    const { host } = aHost(aTurn());

    const found = (await call(host, "search_report", { query: "silver" })).text;

    expect(found).toBe("2: line two about silver");
  });

  it("reads a stretch of the report's own text", async () => {
    const { host } = aHost(aTurn());

    const read = (await call(host, "read_report", { fromLine: 2, lineCount: 2 })).text;

    expect(read).toBe("2: line two about silver\n3: line three");
  });
});

describe("list_order_edits", () => {
  const EDITED = DOCUMENT.replace("unit 100\nwork", "unit 100\ntax");

  async function edits(host: AssistantHost) {
    const answer = await call(host, "list_order_edits");
    expect(answer.isError, answer.text).toBe(false);
    return json(answer.text).edits;
  }

  it("lists a unit the player edited after the assistant read it, with its orders before and now", async () => {
    const { host } = aHost(aTurn());
    await call(host, "get_orders", { unitId: "100" });

    host.typeByHand(EDITED);

    expect(await edits(host)).toEqual([
      { unitId: "100", name: "Farmers", regionId: "1,1,1", before: "work", now: "tax" }
    ]);
  });

  it("lists nothing the assistant has not read", async () => {
    const { host } = aHost(aTurn());

    host.typeByHand(EDITED);

    expect(await edits(host)).toEqual([]);
  });

  it.each([
    ["get_orders for the whole document", "get_orders", {}],
    ["get_unit", "get_unit", { unitId: "100" }],
    ["list_units", "list_units", {}]
  ])("counts %s as reading the unit", async (_label, tool, args) => {
    const { host } = aHost(aTurn());
    await call(host, tool, args);

    host.typeByHand(EDITED);

    expect((await edits(host)).map((edit: { unitId: string }) => edit.unitId)).toEqual(["100"]);
  });

  it("does not count a unit list_units left out as read", async () => {
    const { host } = aHost(aTurn());
    await call(host, "list_units", { regionId: "2,1,1" });

    host.typeByHand(EDITED);

    expect(await edits(host)).toEqual([]);
  });

  it("does not list the assistant's own write, but lists the player's edit after it", async () => {
    const { host, written } = aHost(aTurn());
    await call(host, "set_unit_orders", { turnKey: KEY, unitId: "101", orders: "study FARM" });

    expect(await edits(host)).toEqual([]);

    host.typeByHand((written[0] as string).replace("study FARM", "study COMB"));
    expect(await edits(host)).toEqual([
      { unitId: "101", name: "Scout", regionId: "1,1,1", before: "study FARM", now: "study COMB" }
    ]);
  });

  it("is refused while no turn is open", async () => {
    const answer = await call(aHost(null).host, "list_order_edits");

    expect(answer.isError).toBe(true);
  });

  it("counts its own answer as a look, so an edit is listed once", async () => {
    const { host } = aHost(aTurn());
    await call(host, "get_orders", { unitId: "100" });
    host.typeByHand(EDITED);
    await edits(host);

    expect(await edits(host)).toEqual([]);
  });
});

/** One previewed row, with nothing changed but what `overrides` says. */
function aUnitPreview(unit: ReportUnit, overrides: Partial<UnitPreview> = {}): UnitPreview {
  return {
    unit,
    status: "present",
    changes: [],
    arrivingFrom: null,
    departingTo: null,
    aboard: null,
    uncounted: [],
    takenUnshown: [],
    produced: [],
    built: [],
    created: [],
    refusedCasts: [],
    transportSent: [],
    transportReceived: [],
    transportTargetIssues: [],
    shipmentUnmeasured: false,
    itemChanges: [],
    dissolvesInto: null,
    formed: false,
    dissolving: false,
    skillMerges: [],
    reportedSkills: [],
    recruitsUnmerged: false,
    menOfUnknownSkill: [],
    study: null,
    ...overrides
  };
}

/** Farmers (100) as the orders leave them: buying, producing, studying and sent goods. */
function farmersNextMonth(): UnitPreview {
  return aUnitPreview(
    aReportUnit({
      unitId: "100",
      name: "Farmers",
      regionId: "1,1,1",
      own: true,
      factionId: "3",
      men: 12,
      items: [
        { amount: 12, name: "humans", tag: "HUMN" },
        { amount: 5, name: "grain", tag: "GRAI" }
      ],
      skills: [{ name: "farming", tag: "FARM", level: 1, points: 45 }]
    }),
    {
      produced: [{ amount: 5, tag: "GRAI" }],
      transportReceived: [{ amount: 20, tag: "WOOD", from: "Carters (300)" }],
      study: {
        tag: "FARM",
        name: "farming",
        levelBefore: 1,
        pointsBefore: 30,
        monthsNumerator: 1,
        monthsDenominator: 1,
        teachers: [],
        halvedOutsideABuilding: false,
        pointsAfter: 60,
        levelAfter: 2,
        ceilingLevel: 5,
        limitingRaces: [],
        cannotRaiseTheLevel: false,
        doubts: []
      }
    }
  );
}

const FARMERS_SILVER = aUnitSilver({
  unitId: "100",
  regionId: "1,1,1",
  held: 500,
  income: 0,
  lateIncome: 0,
  expense: 120,
  atMonthEnd: 380,
  upkeep: 100,
  upkeepLent: 0,
  shortForOrders: 0
});

describe("the forecast", () => {
  it("answers a unit's month as the preview leaves it", async () => {
    const { host } = aHost(aTurn(), [], {
      silver: [FARMERS_SILVER],
      preview: { regions: [{ regionId: "1,1,1", units: [farmersNextMonth()] }] }
    });

    const forecast = json((await call(host, "get_forecast", { unitId: "100" })).text);

    expect(forecast.units).toHaveLength(1);
    const farmers = forecast.units[0];
    expect(farmers).toMatchObject({
      unitId: "100",
      name: "Farmers",
      status: "present",
      men: 12,
      itemsAtMonthEnd: "12 HUMN, 5 GRAI",
      skillsAtMonthEnd: "FARM 1 (45)",
      produced: [{ amount: 5, tag: "GRAI" }],
      transportReceived: [{ amount: 20, tag: "WOOD", from: "Carters (300)" }],
      study: { tag: "FARM", levelAfter: 2, pointsAfter: 60 },
      silver: { held: 500, expense: 120, atMonthEnd: 380, upkeep: 100, atMonthEndAfterUpkeep: 280, shortForOrders: 0 }
    });
    expect(farmers).not.toHaveProperty("transportSent");
    expect(farmers).not.toHaveProperty("dissolving");
  });

  it("answers every unit in a hex, the ones the orders leave alone included", async () => {
    const arriving = aUnitPreview(
      aReportUnit({ unitId: "200", name: "Walkers", regionId: "2,1,1", own: true, factionId: "3", men: 2 }),
      { status: "arriving", arrivingFrom: "forest (2,1,1)" }
    );
    const { host } = aHost(aTurn(), [], {
      silver: [FARMERS_SILVER],
      preview: { regions: [{ regionId: "1,1,1", units: [farmersNextMonth(), arriving] }] }
    });

    const forecast = json((await call(host, "get_forecast", { regionId: "1,1,1" })).text);

    expect(forecast.region).toBe("plain (1,1,1) in Coast");
    expect(forecast.units.map((unit: { unitId: string; status: string }) => [unit.unitId, unit.status])).toEqual([
      ["100", "present"],
      ["200", "arriving"],
      ["101", "unchanged"]
    ]);
    expect(forecast.units[1].arrivingFrom).toBe("forest (2,1,1)");
    expect(forecast.units[2]).not.toHaveProperty("silver");
  });

  it("finds a hex by its coordinates", async () => {
    const { host } = aHost(aTurn(), [], { preview: { regions: [] } });

    const forecast = json((await call(host, "get_forecast", { x: 1, y: 1 })).text);

    expect(forecast.units.map((unit: { unitId: string }) => unit.unitId)).toEqual(["100", "101"]);
  });

  it("refuses a unit or a hex the report does not show", async () => {
    const { host } = aHost(aTurn());

    const unit = await call(host, "get_forecast", { unitId: "555" });
    const region = await call(host, "get_forecast", { regionId: "9,9,9" });
    const neither = await call(host, "get_forecast", {});

    expect(unit.isError).toBe(true);
    expect(unit.text).toContain("no unit 555");
    expect(region.isError).toBe(true);
    expect(neither.isError).toBe(true);
  });

  it("refuses while the game data is still loading, for a unit or a hex", async () => {
    const { host } = aHost(aTurn({ rulesetText: null }));

    const unit = await call(host, "get_forecast", { unitId: "100" });
    const hex = await call(host, "get_forecast", { regionId: "1,1,1" });

    expect(unit.isError).toBe(true);
    expect(unit.text).toContain("game data has not loaded");
    expect(hex.isError).toBe(true);
    expect(hex.text).toContain("game data has not loaded");
  });

  it("refuses another faction's unit", async () => {
    const { host } = aHost(aTurn());

    const answer = await call(host, "get_forecast", { unitId: "900" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("only own units are forecast");
  });

  it("says where a departing unit goes and what carries it", async () => {
    const departing = aUnitPreview(
      aReportUnit({ unitId: "101", name: "Scout", regionId: "1,1,1", own: true, factionId: "3", men: 1 }),
      { status: "departing", departingTo: "forest (2,1,1)", aboard: "Swift [5]" }
    );
    const { host } = aHost(aTurn(), [], { preview: { regions: [{ regionId: "1,1,1", units: [departing] }] } });

    const forecast = json((await call(host, "get_forecast", { regionId: "1,1,1" })).text);

    expect(forecast.units[0]).toMatchObject({
      unitId: "101",
      status: "departing",
      departingTo: "forest (2,1,1)",
      aboard: "Swift [5]"
    });
  });

  it("leaves silver out of the items, since the silver figures say it", async () => {
    const holding = aUnitPreview(
      aReportUnit({
        unitId: "100",
        name: "Farmers",
        regionId: "1,1,1",
        own: true,
        factionId: "3",
        men: 10,
        items: [
          { amount: 10, name: "humans", tag: "HUMN" },
          { amount: 380, name: "silver", tag: "SILV" }
        ]
      })
    );
    const { host } = aHost(aTurn(), [], {
      silver: [FARMERS_SILVER],
      preview: { regions: [{ regionId: "1,1,1", units: [holding] }] }
    });

    const forecast = json((await call(host, "get_forecast", { unitId: "100" })).text);

    expect(forecast.units[0].itemsAtMonthEnd).toBe("10 HUMN");
    expect(forecast.units[0].silver.atMonthEnd).toBe(380);
  });
});

describe("where silver runs short", () => {
  it("lists every unit whose silver runs short, hex by hex", async () => {
    const short = aUnitSilver({ unitId: "100", regionId: "1,1,1", shortForOrders: 300, shortOn: "buy", atMonthEnd: 0, upkeep: 0 });
    const redAfterUpkeep = aUnitSilver({ unitId: "101", regionId: "1,1,1", atMonthEnd: 20, upkeep: 50, upkeepLent: 0, shortForOrders: 0 });
    const healthy = aUnitSilver({ unitId: "102", regionId: "2,1,1", atMonthEnd: 900, upkeep: 10, upkeepLent: 0, shortForOrders: 0 });
    const { host } = aHost(aTurn(), [], { silver: [short, redAfterUpkeep, healthy] });

    const answer = json((await call(host, "get_silver_shortfalls")).text);

    expect(answer.regions).toHaveLength(1);
    expect(answer.regions[0]).toMatchObject({ regionId: "1,1,1", region: "plain (1,1,1) in Coast" });
    expect(answer.regions[0].units).toEqual([
      expect.objectContaining({ unitId: "100", name: "Farmers", shortForOrders: 300, shortOn: "buy" }),
      expect.objectContaining({ unitId: "101", name: "Scout", atMonthEndAfterUpkeep: -30 })
    ]);
    expect(answer.regions[0].units[0]).not.toHaveProperty("changes");
  });

  it("lists a unit whose month could not be priced, or whose order the game refuses", async () => {
    const doubted = aUnitSilver({ unitId: "100", regionId: "1,1,1", doubt: "unknown-tax-base", atMonthEnd: null, shortForOrders: null });
    const refused = aUnitSilver({
      unitId: "101",
      regionId: "1,1,1",
      atMonthEnd: 10,
      upkeep: 0,
      shortForOrders: 0,
      refused: [{ cause: "studied", line: 8, cost: 50, available: 10, afterSpending: false }]
    });
    const { host } = aHost(aTurn(), [], { silver: [doubted, refused] });

    const answer = json((await call(host, "get_silver_shortfalls")).text);

    expect(answer.regions[0].units.map((unit: { unitId: string }) => unit.unitId)).toEqual(["100", "101"]);
    expect(answer.regions[0].units[0].doubt).toBe("unknown-tax-base");
    expect(answer.regions[0].units[1].refused).toHaveLength(1);
  });

  it("refuses while the game data is still loading, rather than finding nobody short", async () => {
    const { host } = aHost(aTurn({ rulesetText: null }));

    const answer = await call(host, "get_silver_shortfalls");

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("game data has not loaded");
  });

  it("names a unit this month's orders form by its alias", async () => {
    const formed = aUnitSilver({
      unitId: "new-1",
      regionId: "1,1,1",
      shortForOrders: 40,
      formed: { alias: "new 1", formedBy: "100" }
    });
    const { host } = aHost(aTurn(), [], { silver: [formed] });

    const answer = json((await call(host, "get_silver_shortfalls")).text);

    expect(answer.regions[0].units[0]).toMatchObject({ unitId: "new-1", name: "new 1" });
  });

  it("is empty when nobody is short", async () => {
    const { host } = aHost(aTurn(), [], {
      silver: [aUnitSilver({ unitId: "100", regionId: "1,1,1", atMonthEnd: 5, upkeep: 5, upkeepLent: 0, shortForOrders: 0 })]
    });

    const answer = json((await call(host, "get_silver_shortfalls")).text);

    expect(answer.regions).toEqual([]);
  });
});

describe("regions the HUD remembers from earlier reports", () => {
  it("answers a region this report does not show from the map, with the turn it was last seen", async () => {
    const { host } = aHost(aTurn());

    for (const args of [{ x: 19, y: 5 }, { x: 19, y: 5, z: 1 }, { regionId: "1:19,5" }]) {
      const answer = await call(host, "get_region", args);
      const region = json(answer.text);

      expect(answer.isError).toBe(false);
      expect(region.remembered).toBe(true);
      expect(region.knowledge).toBe("stale");
      expect(region.lastSeenTurn).toBe(9);
      expect(region.currentTurn).toBe(12);
      expect(region.terrain).toBe("plain");
      expect(region.exits).toEqual(REMEMBERED.exits);
      expect(region.structures.map((structure: { name: string }) => structure.name)).toEqual(["Shaft"]);
      expect(region.settlement).toEqual({ name: "Ibiz", size: "village" });
      expect(region.unitsLastSeen).toEqual([{ unitId: "777", name: "Guards", faction: "Borgs", men: 20, lastSeenTurn: 9 }]);
    }
  });

  it("still answers a region in this report as the report shows it", async () => {
    const { host } = aHost(aTurn());

    const region = json((await call(host, "get_region", { x: 2, y: 1, z: 1 })).text);

    expect(region.remembered).toBeUndefined();
    expect(region.province).toBe("Woods");
  });

  it("says when a hex is only named by an exit, never described", async () => {
    const { host } = aHost(aTurn());

    const region = json((await call(host, "get_region", { x: 19, y: 3 })).text);

    expect(region.knowledge).toBe("named");
    expect(region.terrain).toBe("forest");
    expect(region.lastSeenTurn).toBe(9);
    expect(region.exits).toBeUndefined();
    expect(region.note).toContain("exit");
  });

  it("refuses a region neither the report nor the map knows", async () => {
    const { host } = aHost(aTurn());

    const answer = await call(host, "get_region", { x: 40, y: 40 });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("list_known_regions");
  });

  it("asks for the level when the report and the map hold the coordinates on different levels", async () => {
    const turn = aTurn();
    const map = aMap();
    const below = aKnownMapHex({ coordinate: { x: 2, y: 1, z: 2 }, terrain: "tunnels", province: "Deep", knowledge: "named" });
    const { host } = aHost({ ...turn, knownMap: { ...map, hexes: [...map.hexes, below] } });

    const ambiguous = await call(host, "get_region", { x: 2, y: 1 });

    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("1, 2");
  });

  it("lists every hex on the map, in the map's order, each with when it was last seen", async () => {
    const { host } = aHost(aTurn());

    const rows = json((await call(host, "list_known_regions")).text).regions;

    expect(rows.map((row: { regionId: string }) => row.regionId)).toEqual(["1:1,1", "1:2,1", "1:19,3", "1:19,5"]);
    expect(rows[3]).toEqual({
      regionId: "1:19,5",
      region: "plain (19,5,1) in Borg",
      knowledge: "stale",
      lastSeenTurn: 9,
      settlement: "Ibiz (village)",
      structures: ["Shaft: Shaft"],
      unitsLastSeen: 1
    });
  });

  it("lists the hexes in an area, or of one terrain", async () => {
    const { host } = aHost(aTurn());
    const ids = async (args: Record<string, unknown>) =>
      json((await call(host, "list_known_regions", args)).text).regions.map((row: { regionId: string }) => row.regionId);

    expect(await ids({ xMin: 10, xMax: 20, yMin: 4, yMax: 9 })).toEqual(["1:19,5"]);
    expect(await ids({ terrain: "Forest" })).toEqual(["1:2,1", "1:19,3"]);
    expect(await ids({ terrain: "forest", xMin: 10 })).toEqual(["1:19,3"]);
    expect(await ids({ z: 2 })).toEqual([]);
  });

  it("stops a long list and says how many it left out", async () => {
    const hexes = Array.from({ length: 503 }, (_, index) =>
      aKnownMapHex({ coordinate: { x: index, y: 0, z: 1 }, terrain: "ocean", province: "Sea", knowledge: "named" })
    );
    const { host } = aHost(aTurn({ knownMap: aKnownMap({ hexes }) }));

    const answer = json((await call(host, "list_known_regions")).text);

    expect(answer.regions).toHaveLength(500);
    expect(answer.leftOut).toBe(3);
  });

  it("says so while the HUD has no map", async () => {
    const { host } = aHost(aTurn({ knownMap: null }));

    const listed = await call(host, "list_known_regions");
    const region = await call(host, "get_region", { x: 19, y: 5 });

    expect(listed.isError).toBe(true);
    expect(listed.text).toContain("no map");
    expect(region.isError).toBe(true);
    expect(region.text).toContain("no map");
  });

  it("does not call a hex seen this very turn remembered", async () => {
    const turn = aTurn();
    const map = aMap();
    const allySighting = aKnownMapHex({
      coordinate: { x: 30, y: 2, z: 1 },
      terrain: "hill",
      province: "Ally",
      knowledge: "current",
      lastSeenTurn: 12,
      region: aReportRegion({ regionId: "1:30,2", coordinate: { x: 30, y: 2, z: 1 }, terrain: "hill", units: [] })
    });
    const { host } = aHost({ ...turn, knownMap: { ...map, hexes: [...map.hexes, allySighting] } });

    const region = json((await call(host, "get_region", { regionId: "1:30,2" })).text);

    expect(region.remembered).toBe(false);
    expect(region.knowledge).toBe("current");
  });
});

function aMember(overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord {
  return {
    unitId: "100",
    name: "Farmers",
    factionId: "3",
    factionName: "Testers",
    own: true,
    regionId: "1,1,1",
    flags: [],
    items: [{ amount: 10, name: "humans", tag: "HUMN" }],
    skills: [],
    combatSpell: null,
    men: 10,
    seenTurn: 12,
    seenAt: "2026-11-10T12:00:00Z",
    ...overrides
  } as ArmyMemberRecord;
}

function anArmy(id: string, name: string, members: ArmyMemberRecord[]): ArmyRecord {
  return { id, gameId: "game-1", name, members, createdAt: "2026-11-10T12:00:00Z", updatedAt: "2026-11-10T12:00:00Z" };
}

const GUARDS = aMember({
  unitId: "900",
  name: "City Guard",
  factionId: "1",
  factionName: "The Guardsmen",
  own: false,
  flags: ["behind"],
  items: [{ amount: 20, name: "swords", tag: "SWOR" }],
  seenTurn: 10
});
const HOST_ARMY = anArmy("army-1", "Northern Host", [
  aMember({
    skills: [{ name: "combat", tag: "COMB", level: 2, points: 90 }],
    combatSpell: { name: "fireball", tag: "FIRE" }
  } as Partial<ArmyMemberRecord>)
]);
const WATCH_ARMY = anArmy("army-2", "Coastal Watch", [GUARDS]);

describe("readyArmies", () => {
  it("answers the open game's Armies once they have loaded", () => {
    expect(readyArmies({ gameId: "game-1", status: "ready", armies: [HOST_ARMY] }, "game-1")).toEqual([HOST_ARMY]);
  });

  it("answers null while they load, after a failed load, and for another game's list", () => {
    expect(readyArmies({ gameId: "game-1", status: "loading", armies: [] }, "game-1")).toBeNull();
    expect(readyArmies({ gameId: "game-1", status: "error", armies: [] }, "game-1")).toBeNull();
    expect(readyArmies({ gameId: "game-2", status: "ready", armies: [HOST_ARMY] }, "game-1")).toBeNull();
  });
});

describe("list_armies", () => {
  it("lists each saved Army with its members as last seen", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY, WATCH_ARMY] });

    const listed = json((await call(host, "list_armies")).text);

    expect(listed).toEqual([
      {
        armyId: "army-1",
        name: "Northern Host",
        members: [
          {
            unitId: "100",
            name: "Farmers",
            faction: "own",
            men: 10,
            regionId: "1,1,1",
            seenTurn: 12,
            notInThisTurn: false,
            items: "10 HUMN",
            skills: "COMB 2",
            behind: false,
            combatSpell: "FIRE"
          }
        ]
      },
      {
        armyId: "army-2",
        name: "Coastal Watch",
        members: [
          {
            unitId: "900",
            name: "City Guard",
            faction: "The Guardsmen (1)",
            men: 10,
            regionId: "1,1,1",
            seenTurn: 10,
            notInThisTurn: true,
            items: "20 SWOR",
            skills: "",
            behind: true,
            combatSpell: null
          }
        ]
      }
    ]);
  });

  it("refuses while the game's Armies are still loading", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: null });

    const answer = await call(host, "list_armies");

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("still loading");
  });
});

describe("export_battle_file", () => {
  it("writes exactly the file the Export button would, to the path it was given", async () => {
    const { host, files } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY, WATCH_ARMY] });

    const answer = await call(host, "export_battle_file", {
      attackers: "army-1",
      defenders: "Coastal Watch",
      path: "/tmp/host-vs-watch.json"
    });

    expect(answer.isError).toBe(false);
    expect(files).toEqual([
      { path: "/tmp/host-vs-watch.json", text: battleFileText(battleFileOf(HOST_ARMY, WATCH_ARMY, NO_DERIVED_SKILLS)) }
    ]);
    expect(json(answer.text)).toEqual({
      written: "/tmp/host-vs-watch.json",
      units: 2,
      notices: [
        "1 unit was not in this turn's report. It goes out as it was when last seen.",
        "1 unit belongs to another faction. It goes out with no skills — no battle we have seen involved it."
      ]
    });
  });

  it("carries the combat skills the battle-roster scan recovered, as the Export button does", async () => {
    const skills: DerivedSkills = new Map([["900", [{ name: "combat", tag: "COMB", level: 3, turn: 11, coordinate: null, terrain: null }]]]);
    const { host, files } = aHost(aTurn(), [], {}, { armies: [WATCH_ARMY], skills });

    await call(host, "export_battle_file", { defenders: "coastal watch", path: "/tmp/watch.json" });

    expect(files[0]?.text).toBe(battleFileText(battleFileOf(null, WATCH_ARMY, skills)));
  });

  it("refuses with the Export dialog's own sentence when an Army has nobody in it", async () => {
    const { host, files } = aHost(aTurn(), [], {}, { armies: [anArmy("army-3", "Empty", [])] });

    const answer = await call(host, "export_battle_file", { attackers: "Empty", path: "/tmp/x.json" });

    expect(answer).toEqual({ text: "Empty has no units in it.", isError: true });
    expect(files).toEqual([]);
  });

  it("refuses when no Army is named for either side", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY] });

    const answer = await call(host, "export_battle_file", { path: "/tmp/x.json" });

    expect(answer).toEqual({ text: "Choose at least one Army.", isError: true });
  });

  it("refuses an Army it cannot find, and a name two Armies share", async () => {
    const twin = anArmy("army-9", "Northern Host", [aMember()]);
    const { host } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY, twin] });

    const unknown = await call(host, "export_battle_file", { attackers: "Nobody", path: "/tmp/x.json" });
    const shared = await call(host, "export_battle_file", { attackers: "Northern Host", path: "/tmp/x.json" });

    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("No Army is called");
    expect(shared.isError).toBe(true);
    expect(shared.text).toContain("army-1, army-9");
  });

  it("waits, as the dialog does, while the scan could still give foreign units their skills", async () => {
    const { host, files } = aHost(aTurn(), [], {}, { armies: [WATCH_ARMY], scanning: true });

    const answer = await call(host, "export_battle_file", { defenders: "army-2", path: "/tmp/x.json" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("Still reading this game's battle reports");
    expect(files).toEqual([]);
  });

  it("does not wait on the scan when every unit is the faction's own", async () => {
    const { host, files } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY], scanning: true });

    await call(host, "export_battle_file", { attackers: "army-1", path: "/tmp/x.json" });

    expect(files).toHaveLength(1);
  });

  it("says why when the file could not be written", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY], writeFails: "the folder /nowhere does not exist" });

    const answer = await call(host, "export_battle_file", { attackers: "army-1", path: "/nowhere/x.json" });

    expect(answer).toEqual({ text: "The file was not written: the folder /nowhere does not exist", isError: true });
  });

  it("needs a path", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: [HOST_ARMY] });

    const answer = await call(host, "export_battle_file", { attackers: "army-1" });

    expect(answer).toEqual({ text: '"path" is required.', isError: true });
  });
});
