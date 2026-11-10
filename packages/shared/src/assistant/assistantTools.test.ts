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
  aTradedGood,
  aTradeRoute,
  aUnitSilver,
  type OrderDiagnostic,
  type OrderValidationResult,
  type OrdersPreviewResponse,
  type ProductionOverview,
  type ReportUnit,
  type RoutePlanResponse,
  type TradeRoute,
  type UnitPreview,
  type UnitSilver
} from "@atlantis/core-client";
import { battleFileOf, battleFileText } from "../armyExport";
import { NO_DERIVED_SKILLS, type DerivedSkills } from "../battleSkills";
import { NO_PRODUCTION } from "../orderEditor";
import { orderProcessingFor } from "../orderProcessing";
import { newAssistantSeen } from "./assistantSeen";
import { ordersVersion as V } from "./assistantWrites";
import type { EarlierTurnSource } from "./earlierTurns";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree, studyPlannerTree } from "../magicTree";
import { NO_TEACHING_RULE } from "../teachingPermission";
import type { StudyPlannerInputs } from "./assistantStudyPlans";
import type { RulesReference } from "./rulesReference";
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

/** Turn 11, stored: the home region then had fewer people, and Farmers fewer men. */
const EARLIER_ORDERS = ["#atlantis 3", "", ";*** plain (1,1) in Coast ***", "", "unit 100", "tax", "", "#end", ""].join("\n");

/** Turn 9, stored but never edited in the HUD: only its report's orders template is there. */
const TEMPLATE_ORDERS = ["#atlantis 3", "", ";*** plain (1,1) in Coast ***", "", "unit 100", "work", "", "#end", ""].join("\n");

function anEarlierTurnSource(): EarlierTurnSource {
  const parsed = aParsedReport({
    header: aReportHeaderInfo({ factionId: "3", turnNumber: 11, events: ["Farmers (100) collects 40 silver."] }),
    regions: [
      aReportRegion({
        regionId: "1,1,1",
        coordinate: { x: 1, y: 1, z: 1 },
        terrain: "plain",
        province: "Coast",
        population: 900,
        units: [aReportUnit({ unitId: "100", name: "Farmers", regionId: "1,1,1", own: true, factionId: "3", men: 8 })]
      })
    ]
  });
  const templated = aParsedReport({
    header: aReportHeaderInfo({ factionId: "3", turnNumber: 9 }),
    regions: parsed.regions,
    ordersTemplate: { text: TEMPLATE_ORDERS, factionId: "3", units: [] }
  });
  return {
    list: async () => [
      { turnNumber: 9, season: null, importedAt: "2026-01-09" },
      { turnNumber: 10, season: null, importedAt: "2026-01-10" },
      { turnNumber: 11, season: null, importedAt: "2026-01-11" },
      { turnNumber: 12, season: null, importedAt: "2026-01-12" }
    ],
    load: async (turnNumber) =>
      turnNumber === 11
        ? { turnNumber, parsed, ordersDocument: EARLIER_ORDERS }
        : turnNumber === 10
          ? { turnNumber, parsed: aParsedReport({ header: aReportHeaderInfo({ turnNumber: 10 }) }), ordersDocument: null }
          : turnNumber === 9
            ? { turnNumber, parsed: templated, ordersDocument: null }
            : null
  };
}

/** A Trident rules snapshot as the shell serves it, small enough to read in a test. */
const TRIDENT_REFERENCE: RulesReference = {
  worldId: "newage-trident",
  label: "New Age: Trident",
  rulesUrl: "https://example.test/trident/rules",
  catalogueUrl: "https://example.test/trident/database",
  fetchedAt: "2026-09-29T00:17:16.414Z",
  edition: "NewAge 1.1 Rules — Trident",
  lastChange: "September 28, 2026",
  sections: [
    { anchor: "give", title: "GIVE", text: "GIVE\n\nGIVE [unit] [quantity] [item]\nA unit may give silver." },
    { anchor: "giveall", title: "GIVE ALL", text: "GIVE ALL\n\nGives everything." }
  ],
  data: [
    { section: "items", name: "sword", tag: "SWOR", text: "sword [SWOR], weight 1." },
    { section: "items", name: "mithril sword", tag: "MSWO", text: "mithril sword [MSWO], weight 1." }
  ]
};

/** The fake shell's rules snapshots, by ruleset id; any other id is refused as the shell would. */
async function servedReference(rulesetId: string): Promise<string> {
  if (rulesetId === "newage-trident") {
    return JSON.stringify(TRIDENT_REFERENCE);
  }
  throw new Error(`This build carries no rules snapshot for ${rulesetId}.`);
}

/** What the fake host's preview and validation forecast, beside its diagnostics. */
interface Forecast {
  readonly silver?: UnitSilver[];
  readonly preview?: OrdersPreviewResponse;
  /** What the route planner answers; every question it is asked is recorded in `planned`. */
  readonly route?: RoutePlanResponse;
  readonly production?: ProductionOverview;
  /** The routes the Trade panel lists; none when left out. */
  readonly trade?: TradeRoute[];
}

/** What the host lends the army and study-plan tools, each part replaceable by a test. */
interface ArmyWorld {
  studyPlanner: StudyPlannerInputs | "loading" | "failed";
  armies: readonly ArmyRecord[] | "loading" | "failed";
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
    studyPlanner: "loading",
    armies: [],
    skills: NO_DERIVED_SKILLS,
    scanning: false,
    unreadTurns: 0,
    writeFails: null,
    ...world
  };
  const planned: { unitId: string; destination: string; carryingJson: string }[] = [];
  let current = turn;
  const host: AssistantHost & { typeByHand(document: string): void } = {
    armies: () => armyWorld.armies,
    studyPlanner: () => armyWorld.studyPlanner,
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
    earlierTurns: anEarlierTurnSource(),
    rulesReference: servedReference,
    bannerFor: (regionId) => (regionId === "1,1,1" ? ";*** plain (1,1) in Coast ***" : null),
    validate: async () =>
      ({ diagnostics, silver: forecast.silver ?? [], production: forecast.production ?? NO_PRODUCTION }) as unknown as OrderValidationResult,
    preview: async () => forecast.preview ?? { regions: [] },
    planRoute: async (unitId, destination, carryingJson) => {
      planned.push({ unitId, destination, carryingJson });
      return forecast.route ?? { plan: null, problem: { kind: "noKnownRoute" }, risk: null, fullyModelled: true };
    },
    tradeRoutes: async () => forecast.trade ?? [],
    writeOrders: (update) => {
      if (current !== null) {
        const document = update(current.ordersDocument);
        written.push(document);
        current = { ...current, ordersDocument: document };
      }
    }
  };
  return { host, written, files, planned };
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
        anchor: "give",
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
      orders: "work",
      version: V("work")
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
    expect(unit.version).toBe(V("work"));
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

  it("gives the whole orders document with every own unit's version, or one unit's block and version", async () => {
    const { host } = aHost(aTurn());

    expect(json((await call(host, "get_orders")).text)).toEqual({
      document: DOCUMENT,
      versions: { "100": V("work"), "101": V("") }
    });
    expect(json((await call(host, "get_orders", { unitId: "100" })).text)).toEqual({ orders: "work", version: V("work") });
  });
});

describe("write_orders", () => {
  /** Writes `units` for the open turn. */
  async function write(host: AssistantHost, ...units: Record<string, unknown>[]) {
    return call(host, "write_orders", { turnKey: KEY, units });
  }

  it("writes one unit's orders into the document, leaving the rest as it was", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await write(host, { unitId: "101", version: V(""), orders: "study FARM\n" });

    expect(answer.isError, answer.text).toBe(false);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(DOCUMENT.replace("unit 101\n", "unit 101\nstudy FARM\n"));
    expect(json((await call(host, "get_orders", { unitId: "101" })).text).orders).toBe("study FARM");
  });

  it("answers each unit's new version and what the validator makes of its orders", async () => {
    const { host } = aHost(aTurn(), [aDiagnostic({ lineStart: 9, lineEnd: 9, unitId: "101" })]);

    const answer = json((await write(host, { unitId: "101", version: V(""), orders: "fly" })).text);

    expect(answer).toEqual({
      written: [{ unitId: "101", version: V("fly"), problems: ["its line 1 error unknown-order: Unknown order FLY."] }]
    });
  });

  it("refuses a write once the player has changed the unit, writing nothing and showing the orders as they now stand", async () => {
    const { host, written } = aHost(aTurn());
    const read = json((await call(host, "get_orders", { unitId: "100" })).text);
    host.typeByHand(DOCUMENT.replace("unit 100\nwork", "unit 100\ntax\nclaim 10"));

    const answer = await write(host, { unitId: "100", version: read.version, orders: "work\nbuy 1 HORS" });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
    expect(answer.text).toContain("Nothing was written");
    const shown = json(answer.text.slice(answer.text.indexOf("{")));
    expect(shown).toEqual({
      changed: [{ unitId: "100", name: "Farmers", orders: "tax\nclaim 10", version: V("tax\nclaim 10") }]
    });
  });

  it("writes once the refusal's version is handed back", async () => {
    const { host, written } = aHost(aTurn());
    host.typeByHand(DOCUMENT.replace("unit 100\nwork", "unit 100\ntax"));
    await write(host, { unitId: "100", version: V("work"), orders: "work" });

    const answer = await write(host, { unitId: "100", version: V("tax"), orders: "tax\nbuy 1 HORS" });

    expect(answer.isError, answer.text).toBe(false);
    expect(written[0]).toContain("unit 100\ntax\nbuy 1 HORS");
  });

  it("does not list a refused unit again as an edit, since the refusal showed it", async () => {
    const { host } = aHost(aTurn());
    await call(host, "get_orders", { unitId: "100" });
    host.typeByHand(DOCUMENT.replace("unit 100\nwork", "unit 100\ntax"));

    await write(host, { unitId: "100", version: V("work"), orders: "work" });

    expect(json((await call(host, "list_order_edits")).text).edits).toEqual([]);
  });

  it("adds and removes single lines without the rest of the block", async () => {
    const turn = aTurn({ ordersDocument: DOCUMENT.replace("unit 100\nwork", "unit 100\nwork\nclaim 10") });
    const { host, written } = aHost(turn);

    const answer = await write(host, { unitId: "100", version: V("work\nclaim 10"), remove: ["claim 10"], add: ["buy 1 HORS"] });

    expect(answer.isError, answer.text).toBe(false);
    expect(written[0]).toContain("unit 100\nwork\nbuy 1 HORS\n\nunit 101");
  });

  it("refuses a line to remove that the unit's orders do not hold", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await write(host, { unitId: "100", version: V("work"), remove: ["tax"] });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("tax");
    expect(written).toEqual([]);
  });

  it("writes several units in one call", async () => {
    const { host, written } = aHost(aTurn());

    const answer = json(
      (await write(host, { unitId: "100", version: V("work"), orders: "tax" }, { unitId: "101", version: V(""), add: ["study FARM"] })).text
    );

    expect(answer.written.map((unit: { unitId: string }) => unit.unitId)).toEqual(["100", "101"]);
    expect(written.at(-1)).toBe(DOCUMENT.replace("unit 100\nwork", "unit 100\ntax").replace("unit 101\n", "unit 101\nstudy FARM\n"));
  });

  it("writes none of several units when one of them has changed", async () => {
    const { host, written } = aHost(aTurn());
    host.typeByHand(DOCUMENT.replace("unit 101\n", "unit 101\nstudy COMB\n"));

    const answer = await write(host, { unitId: "100", version: V("work"), orders: "tax" }, { unitId: "101", version: V(""), orders: "study FARM" });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
    expect(json(answer.text.slice(answer.text.indexOf("{"))).changed.map((unit: { unitId: string }) => unit.unitId)).toEqual(["101"]);
  });

  it("refuses a write without the version the orders were read with", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await write(host, { unitId: "100", orders: "tax" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("version");
    expect(written).toEqual([]);
  });

  it("creates the block of an own unit the document has none for, under its region's banner", async () => {
    const turn = aTurn({ ordersDocument: "#atlantis 3\n\n;*** plain (1,1) in Coast ***\n\n#end\n" });
    const { host, written } = aHost(turn);

    await write(host, { unitId: "100", version: V(""), orders: "work" });

    expect(written[0]).toContain("unit 100\nwork");
  });

  it("refuses to write orders for a unit that is not the faction's own", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await write(host, { unitId: "900", version: V(""), orders: "work" });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("hands out a key for the open turn, and refuses a write made for any other turn", async () => {
    const { host, written } = aHost(aTurn());

    const overview = json((await call(host, "get_turn_overview")).text);
    const stale = await call(host, "write_orders", { turnKey: "game-1/3/11", units: [{ unitId: "101", version: V(""), orders: "work" }] });

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

    await write(host, { unitId: "101", version: V(""), orders: "study FARM" });

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

    const replaced = await write(host, { unitId: "101", version: V(""), orders });
    const added = await write(host, { unitId: "101", version: V(""), add: orders.split("\n") });

    expect(replaced.isError).toBe(true);
    expect(added.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it.each([
    ["a unit header", "study FARM\nunit 100"],
    ["the end of the file", "study FARM\r\n#end"]
  ])("refuses a line to add that carries %s after a line break", async (_what, line) => {
    const { host, written } = aHost(aTurn());

    const answer = await write(host, { unitId: "101", version: V(""), add: [line] });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("refuses a line edit once the player has changed the unit", async () => {
    const { host, written } = aHost(aTurn());
    host.typeByHand(DOCUMENT.replace("unit 100\nwork", "unit 100\nwork\ntax"));

    const answer = await write(host, { unitId: "100", version: V("work"), remove: ["work"], add: ["claim 10"] });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
    expect(json(answer.text.slice(answer.text.indexOf("{"))).changed[0]).toMatchObject({ unitId: "100", orders: "work\ntax" });
  });

  it("shows the units the player changed even when another unit's line edit is refused too", async () => {
    const { host, written } = aHost(aTurn());
    host.typeByHand(DOCUMENT.replace("unit 100\nwork", "unit 100\ntax"));

    const answer = await write(host, { unitId: "100", version: V("work"), orders: "work" }, { unitId: "101", version: V(""), remove: ["tax"] });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
    expect(json(answer.text.slice(answer.text.indexOf("{"))).changed.map((unit: { unitId: string }) => unit.unitId)).toEqual(["100"]);
  });

  it("refuses empty orders for a unit with no block and no banner to make one under", async () => {
    const turn = aTurn({ ordersDocument: "#atlantis 3\n\n#end\n" });
    const { host, written } = aHost(turn);

    const answer = await write(host, { unitId: "100", version: V(""), orders: "" });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("refuses orders that are not text", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await write(host, { unitId: "101", version: V(""), orders: { order: "work" } });

    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });
});

describe("the rest of the turn's tools", () => {
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
      { unitId: "100", name: "Farmers", regionId: "1,1,1", before: "work", now: "tax", version: V("tax") }
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
    await call(host, "write_orders", { turnKey: KEY, units: [{ unitId: "101", version: V(""), orders: "study FARM" }] });

    expect(await edits(host)).toEqual([]);

    host.typeByHand((written[0] as string).replace("study FARM", "study COMB"));
    expect(await edits(host)).toEqual([
      { unitId: "101", name: "Scout", regionId: "1,1,1", before: "study FARM", now: "study COMB", version: V("study COMB") }
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

/** `aTurn` with products on both regions: iron and grain at home, wood in the forest. */
function aProducingTurn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  const turn = aTurn(overrides);
  const [home, away] = turn.parsed.regions;
  return {
    ...turn,
    parsed: {
      ...turn.parsed,
      regions: [
        {
          ...home,
          products: [
            { amount: 15, name: "iron", tag: "IRON" },
            { amount: 20, name: "grain", tag: "GRAI" }
          ]
        },
        { ...away, products: [{ amount: 30, name: "wood", tag: "WOOD" }] }
      ]
    }
  };
}

/** The core's overview of `aProducingTurn`: unit 100 mines 15 iron at home, capped by the region. */
const MINING: ProductionOverview = {
  limits: { pooled: 10, tax: null, trade: null },
  used: { pooled: 1, tax: 0, trade: 1 },
  regions: [
    {
      regionId: "1,1,1",
      orders: [{ kind: "produce", crafted: null }],
      usesTaxSlot: false,
      usesTradeSlot: true,
      tax: { base: null, taxed: false, collected: 0, pillaged: null, atMost: false },
      resources: [
        { name: "iron", tag: "IRON", produced: 15, available: 15, producers: [{ unitId: "100", regionId: "1,1,1" }] },
        { name: "grain", tag: "GRAI", produced: 0, available: 20, producers: [] }
      ]
    }
  ]
};

const MINER = aUnitSilver({
  unitId: "100",
  regionId: "1,1,1",
  produced: 15,
  producedName: "iron",
  productionWanted: 24,
  productionRequested: null,
  productionCappedBy: "region"
});

describe("production against each region's cap", () => {
  it("answers one region's products against what it offers, with the units producing them", async () => {
    const { host } = aHost(aProducingTurn(), [], { silver: [MINER], production: MINING });

    const answer = json((await call(host, "get_production", { regionId: "1,1,1" })).text);

    expect(answer.regions).toHaveLength(1);
    expect(answer.regions[0]).toMatchObject({ regionId: "1,1,1", region: "plain (1,1,1) in Coast", worked: true });
    expect(answer.regions[0].resources).toEqual([
      {
        tag: "IRON",
        name: "iron",
        available: 15,
        produced: 15,
        spare: 0,
        beyondCap: 9,
        producers: [
          { unitId: "100", name: "Farmers", produced: 15, couldMake: 24, asked: null, cappedBy: "region", sharedWithForeign: false }
        ]
      },
      { tag: "GRAI", name: "grain", available: 20, produced: 0, spare: 20, beyondCap: 0, producers: [] }
    ]);
    expect(answer).not.toHaveProperty("totals");
  });

  it("lists every worked region and every idle own region faction-wide, with totals per product", async () => {
    const turn = aProducingTurn();
    const [home, away] = turn.parsed.regions;
    const withOwnInForest = {
      ...turn,
      parsed: {
        ...turn.parsed,
        regions: [home, { ...away, units: [aReportUnit({ unitId: "102", regionId: "2,1,1", own: true, factionId: "3" })] }]
      }
    };
    const { host } = aHost(withOwnInForest, [], { silver: [MINER], production: MINING });

    const answer = json((await call(host, "get_production")).text);

    expect(answer.regions.map((region: { regionId: string; worked: boolean }) => [region.regionId, region.worked])).toEqual([
      ["1,1,1", true],
      ["2,1,1", false]
    ]);
    expect(answer.regions[1].resources).toEqual([
      { tag: "WOOD", name: "wood", available: 30, produced: 0, spare: 30, beyondCap: 0, producers: [] }
    ]);
    expect(answer.totals).toEqual([
      { tag: "IRON", name: "iron", available: 15, produced: 15, spare: 0, beyondCap: 9 },
      { tag: "GRAI", name: "grain", available: 20, produced: 0, spare: 20, beyondCap: 0 },
      { tag: "WOOD", name: "wood", available: 30, produced: 0, spare: 30, beyondCap: 0 }
    ]);
    expect(answer.regionsUsed).toEqual({ pooled: 1, tax: 0, trade: 1 });
    expect(answer.limits).toEqual({ pooled: 10, tax: null, trade: null });
  });

  it("counts as beyond the cap only what the region's amount stopped, not silver or materials", async () => {
    const broke = aUnitSilver({
      unitId: "101",
      regionId: "1,1,1",
      produced: 4,
      producedName: "grain",
      productionWanted: 10,
      productionCappedBy: "silver"
    });
    const farming: ProductionOverview = {
      ...MINING,
      regions: [
        {
          ...MINING.regions[0],
          resources: [
            MINING.regions[0].resources[0],
            { name: "grain", tag: "GRAI", produced: 4, available: 20, producers: [{ unitId: "101", regionId: "1,1,1" }] }
          ]
        }
      ]
    };
    const { host } = aHost(aProducingTurn(), [], { silver: [MINER, broke], production: farming });

    const answer = json((await call(host, "get_production", { regionId: "1,1,1" })).text);

    expect(answer.regions[0].resources[1]).toMatchObject({ tag: "GRAI", produced: 4, spare: 16, beyondCap: 0 });
    expect(answer.regions[0].resources[1].producers[0]).toMatchObject({ unitId: "101", couldMake: 10, cappedBy: "silver" });
  });

  it("totals a product's amount as unknown when one region's amount is", async () => {
    const turn = aProducingTurn();
    const [home, away] = turn.parsed.regions;
    const ironBoth = {
      ...turn,
      parsed: {
        ...turn.parsed,
        regions: [home, { ...away, products: [{ amount: 8, name: "iron", tag: "IRON" }] }]
      }
    };
    const unknownAmount: ProductionOverview = {
      ...MINING,
      regions: [
        MINING.regions[0],
        {
          ...MINING.regions[0],
          regionId: "2,1,1",
          resources: [{ name: "iron", tag: "IRON", produced: 3, available: null, producers: [] }]
        }
      ]
    };
    const { host } = aHost(ironBoth, [], { silver: [MINER], production: unknownAmount });

    const answer = json((await call(host, "get_production")).text);

    expect(answer.totals[0]).toEqual({ tag: "IRON", name: "iron", available: null, produced: 18, spare: null, beyondCap: 9 });
  });

  it("answers a named region nothing is produced in from its products, unworked", async () => {
    const { host } = aHost(aProducingTurn(), [], { silver: [MINER], production: MINING });

    const answer = json((await call(host, "get_production", { x: 2, y: 1, z: 1 })).text);

    expect(answer.regions).toEqual([
      {
        regionId: "2,1,1",
        region: "forest (2,1,1) in Woods",
        worked: false,
        orders: [],
        resources: [{ tag: "WOOD", name: "wood", available: 30, produced: 0, spare: 30, beyondCap: 0, producers: [] }]
      }
    ]);
  });

  it("refuses while the game data is still loading, rather than finding nothing produced", async () => {
    const { host } = aHost(aProducingTurn({ rulesetText: null }), [], { production: MINING });

    const answer = await call(host, "get_production");

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("game data has not loaded");
  });

  it("refuses a region this turn's report does not show", async () => {
    const { host } = aHost(aProducingTurn(), [], { production: MINING });

    const answer = await call(host, "get_production", { regionId: "9,9,1" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("shows no such region");
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

  it("answers loading while they load and while the list is still another game's", () => {
    expect(readyArmies({ gameId: "game-1", status: "loading", armies: [] }, "game-1")).toBe("loading");
    expect(readyArmies({ gameId: "game-2", status: "ready", armies: [HOST_ARMY] }, "game-1")).toBe("loading");
  });

  it("answers failed when the open game's Armies could not be read", () => {
    expect(readyArmies({ gameId: "game-1", status: "error", armies: [] }, "game-1")).toBe("failed");
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
    const { host } = aHost(aTurn(), [], {}, { armies: "loading" });

    const answer = await call(host, "list_armies");

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("still loading");
  });

  it("says the Armies could not be read, rather than to wait, when their load failed", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: "failed" });

    const answer = await call(host, "list_armies");

    expect(answer).toEqual({
      text: "The HUD could not read this game's Armies. Ask the player to open the game again.",
      isError: true
    });
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

  it("refuses with the dialog's own sentence when the player has saved no Armies, even with one named", async () => {
    const { host } = aHost(aTurn(), [], {}, { armies: [] });

    const answer = await call(host, "export_battle_file", { attackers: "Northern Host", path: "/tmp/x.json" });

    expect(answer).toEqual({ text: "No Armies to export. Make an Army first, then come back.", isError: true });
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

describe("planning a route", () => {
  /** Scout (101) walks from the plain at (1,1) east into the forest at (2,1), then on to (3,1). */
  const WALK: RoutePlanResponse = {
    plan: {
      from: { x: 1, y: 1, z: 1 },
      to: { x: 3, y: 1, z: 1 },
      mode: "walk",
      steps: [
        { direction: "southeast", to: { x: 2, y: 1, z: 1 }, terrain: "forest", cost: 2, road: false, estimated: false, overWater: false, canal: null },
        { direction: "southeast", to: { x: 3, y: 1, z: 1 }, terrain: "plain", cost: 1, road: true, estimated: true, overWater: false, canal: null }
      ],
      totalCost: 3,
      months: [
        { month: 1, steps: 1, endsAt: { x: 2, y: 1, z: 1 } },
        { month: 2, steps: 1, endsAt: { x: 3, y: 1, z: 1 } }
      ],
      order: "MOVE SE SE",
      loadUnchecked: false
    },
    problem: null,
    risk: { level: "low", worst: null, hexes: [] },
    fullyModelled: false
  } as unknown as RoutePlanResponse;

  it("answers the order, the movement points, the months and the steps the planner draws", async () => {
    const { host, planned } = aHost(aTurn(), [], { route: WALK });

    const answer = await call(host, "plan_route", { unitId: "101", x: 3, y: 1 });
    const route = json(answer.text);

    expect(answer.isError).toBe(false);
    expect(planned).toEqual([{ unitId: "101", destination: "1:3,1", carryingJson: "" }]);
    expect(route).toMatchObject({
      unitId: "101",
      from: "1:1,1",
      to: "1:3,1",
      mode: "walk",
      order: "MOVE SE SE",
      movementPoints: 3,
      months: 2,
      monthLegs: [
        { month: 1, steps: 1, endsAt: "1:2,1" },
        { month: 2, steps: 1, endsAt: "1:3,1" }
      ],
      risk: { level: "low", worst: null }
    });
    expect(route.steps[0]).toEqual({ direction: "southeast", regionId: "1:2,1", terrain: "forest", cost: 2 });
    expect(route.steps[1]).toMatchObject({ road: true, estimated: true });
    expect(route.notes.join(" ")).toContain("1 of these hexes is unexplored");
    expect(route.notes.join(" ")).toContain("lower bound");
  });

  it("answers why there is no route in the words the Movement panel uses, as an answer rather than an error", async () => {
    const { host } = aHost(aTurn(), [], {
      route: { plan: null, problem: { kind: "noKnownRoute" }, risk: null, fullyModelled: true } as RoutePlanResponse
    });

    const answer = await call(host, "plan_route", { unitId: "101", regionId: "1:19,5" });

    expect(answer.isError).toBe(false);
    expect(json(answer.text)).toEqual({
      unitId: "101",
      to: "1:19,5",
      problem: { kind: "noKnownRoute" },
      reason: "Nothing the faction has seen joins those two hexes up."
    });
  });

  it("names a destination by a region this report shows, or one the map remembers", async () => {
    const { host, planned } = aHost(aTurn(), [], { route: WALK });

    await call(host, "plan_route", { unitId: "101", regionId: "2,1,1" });
    await call(host, "plan_route", { unitId: "101", x: 19, y: 5, z: 1 });

    expect(planned.map((ask) => ask.destination)).toEqual(["1:2,1", "1:19,5"]);
  });

  it("plans for the unit as loaded by the items it will carry, tags upper-cased", async () => {
    const turn = aTurn({
      rulesetText: JSON.stringify({ items: { HUMN: { name: "human" }, HORS: { name: "horse" } }, skills: {}, buildings: {} })
    });
    const { host, planned } = aHost(turn, [], { route: WALK });

    await call(host, "plan_route", { unitId: "101", x: 3, y: 1, carrying: { hors: 4, HUMN: 1 } });

    expect(JSON.parse(planned[0].carryingJson)).toEqual({ HORS: 4, HUMN: 1 });
  });

  it("says a fleet is weighed as the report shows it when items are carried", async () => {
    const sail = { ...WALK, plan: { ...WALK.plan!, mode: "sail", order: "SAIL SE SE" } } as RoutePlanResponse;
    const { host } = aHost(aTurn(), [], { route: sail });

    const route = json((await call(host, "plan_route", { unitId: "101", x: 3, y: 1, carrying: { HUMN: 1 } })).text);

    expect(route.notes.join(" ")).toContain("fleet");
  });

  it.each([
    [{ x: 3, y: 1 }, '"unitId" is required.'],
    [{ unitId: "101" }, "Name the destination"],
    [{ unitId: "555", x: 3, y: 1 }, "no unit 555"],
    [{ unitId: "900", x: 3, y: 1 }, "not the faction's own"],
    [{ unitId: "101", regionId: "nowhere" }, "No region nowhere is known"],
    [{ unitId: "101", x: 3, y: 1, carrying: { ZZZZ: 1 } }, "ZZZZ"],
    [{ unitId: "101", x: 3, y: 1, carrying: { HUMN: -1 } }, "HUMN"],
    [{ unitId: "101", x: 3, y: 1, carrying: ["HUMN"] }, "carrying"]
  ])("refuses %j", async (args, message) => {
    const { host, planned } = aHost(aTurn(), [], { route: WALK });

    const answer = await call(host, "plan_route", args);

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain(message);
    expect(planned).toEqual([]);
  });

  it("refuses while the game data has not loaded", async () => {
    const { host } = aHost(aTurn({ rulesetText: null }), [], { route: WALK });

    const answer = await call(host, "plan_route", { unitId: "101", x: 3, y: 1 });

    expect(answer).toEqual({ isError: true, text: "The game data has not loaded yet; try again in a moment." });
  });
});

describe("reading an earlier turn", () => {
  it("lists the stored turns and marks the open one", async () => {
    const { host } = aHost(aTurn());

    const answer = json((await call(host, "list_turns")).text);

    expect(answer).toEqual({
      openTurn: 12,
      turns: [
        { turn: 9, season: null, importedAt: "2026-01-09", open: false },
        { turn: 10, season: null, importedAt: "2026-01-10", open: false },
        { turn: 11, season: null, importedAt: "2026-01-11", open: false },
        { turn: 12, season: null, importedAt: "2026-01-12", open: true }
      ]
    });
  });

  it("reads the events of a named earlier turn", async () => {
    const { host } = aHost(aTurn());

    const answer = json((await call(host, "get_turn_events", { turn: 11 })).text);

    expect(answer).toMatchObject({ turn: 11, earlier: true, events: ["Farmers (100) collects 40 silver."] });
  });

  it("reads the open turn as before when the turn named is the open one", async () => {
    const { host } = aHost(aTurn());

    const answer = json((await call(host, "get_turn_events", { turn: 12 })).text);

    expect(answer.events).toEqual(["Farmers (100) earns 50 silver."]);
    expect(answer.earlier).toBeUndefined();
  });

  it("reads a region and a unit as an earlier turn's report showed them", async () => {
    const { host } = aHost(aTurn());

    const region = json((await call(host, "get_region", { regionId: "1,1,1", turn: 11 })).text);
    const unit = json((await call(host, "get_unit", { unitId: "100", turn: 11 })).text);

    expect(region).toMatchObject({ turn: 11, earlier: true, regionId: "1,1,1", population: 900 });
    expect(unit).toMatchObject({ turn: 11, earlier: true, unit: { unitId: "100", men: 8 }, orders: "tax" });
  });

  it("refuses a region or unit the earlier report did not show", async () => {
    const { host } = aHost(aTurn());

    const region = await call(host, "get_region", { regionId: "2,1,1", turn: 11 });
    const unit = await call(host, "get_unit", { unitId: "101", turn: 11 });

    expect(region.isError).toBe(true);
    expect(region.text).toBe("Turn 11's report shows no such region.");
    expect(unit.isError).toBe(true);
    expect(unit.text).toContain("Turn 11's report shows no unit 101");
  });

  it("reads the orders written for an earlier turn, whole or for one unit", async () => {
    const { host } = aHost(aTurn());

    const whole = json((await call(host, "get_orders", { turn: 11 })).text);
    const one = json((await call(host, "get_orders", { turn: 11, unitId: "100" })).text);

    expect(whole).toEqual({ turn: 11, earlier: true, orders: EARLIER_ORDERS });
    expect(one).toEqual({ turn: 11, earlier: true, unitId: "100", orders: "tax" });
  });

  it("says when the HUD kept no orders for an earlier turn", async () => {
    const { host } = aHost(aTurn());

    const answer = json((await call(host, "get_orders", { turn: 10 })).text);

    expect(answer).toEqual({ turn: 10, earlier: true, orders: null, note: "The HUD kept no orders for turn 10." });
  });

  it("answers an earlier turn's report orders template, marked as such, when the HUD kept no orders", async () => {
    const { host } = aHost(aTurn());

    const whole = json((await call(host, "get_orders", { turn: 9 })).text);
    const one = json((await call(host, "get_orders", { turn: 9, unitId: "100" })).text);

    const note = "The HUD kept no orders for turn 9; these are the orders template from that turn's report, not orders the player saved.";
    expect(whole).toEqual({ turn: 9, earlier: true, orders: TEMPLATE_ORDERS, fromTemplate: true, note });
    expect(one).toEqual({ turn: 9, earlier: true, unitId: "100", orders: "work", fromTemplate: true, note });
  });

  it("refuses a unit's earlier orders when that turn's report did not show the unit", async () => {
    const { host } = aHost(aTurn());

    const answer = await call(host, "get_orders", { turn: 10, unitId: "100" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("Turn 10's report shows no unit 100");
  });

  it("does not count an earlier turn's orders as read for the open turn", async () => {
    const { host } = aHost(aTurn());
    await call(host, "get_unit", { unitId: "100", turn: 11 });
    host.typeByHand(DOCUMENT.replace("work", "study FARM"));

    const edits = json((await call(host, "list_order_edits")).text);

    expect(edits.edits).toEqual([]);
  });

  it("refuses a turn that is later than the open one, or not stored", async () => {
    const { host } = aHost(aTurn());

    const later = await call(host, "get_turn_events", { turn: 13 });
    const missing = await call(host, "get_turn_events", { turn: 4 });

    expect(later.isError).toBe(true);
    expect(later.text).toContain("Turn 13 is after the open turn 12");
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("list_turns");
  });

  it("refuses an earlier turn while the HUD cannot read stored turns", async () => {
    const { host } = aHost(aTurn());
    const without = { ...host, earlierTurns: null };

    const answer = await call(without, "get_region", { regionId: "1,1,1", turn: 11 });
    const list = await call(without, "list_turns");

    expect(answer.isError).toBe(true);
    expect(list.isError).toBe(true);
  });
});

describe("get_study_plans", () => {
  const tree = studyPlannerTree(buildMagicTree(parseGameData(readRuleset()) as GameDataIndex));
  /** Ereb, your mage, planned to study force on turn 13 - the first turn after this report's 12. */
  const PLANNER: StudyPlannerInputs = {
    groups: [
      {
        factionId: "3",
        factionLabel: "Testers (3)",
        source: "own",
        heading: "Testers (3) — your faction, turn 12",
        stale: false,
        mages: [
          {
            key: "3/101",
            factionId: "3",
            factionLabel: "Testers (3)",
            unitId: "101",
            name: "Ereb",
            regionId: "1,1,1",
            structureId: null,
            sheetTurn: null,
            monthsUnreported: 0,
            skills: [{ tag: "FORC", level: 1, points: 30 }]
          }
        ]
      }
    ] as unknown as StudyPlannerInputs["groups"],
    plans: [
      {
        factionId: "3",
        unitId: "101",
        goals: [{ kind: "study", turn: 13, skill: "FORC" }],
        casts: [],
        comment: "",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    tree,
    viewedTurn: 12,
    seats: new Map(),
    structureNames: new Map(),
    after: new Map(),
    rule: NO_TEACHING_RULE,
    assumeSheltered: false,
    label: () => "plain (1,1)"
  };

  it("answers with the planner's mages, turns and warnings", async () => {
    const { host } = aHost(aTurn(), [], {}, { studyPlanner: PLANNER });

    const answer = await call(host, "get_study_plans");

    expect(answer.isError).toBe(false);
    const read = json(answer.text);
    expect(read.turns[0]).toBe(13);
    expect(read.mages).toHaveLength(1);
    expect(read.mages[0]).toMatchObject({ unitId: "101", name: "Ereb", region: "plain (1,1)" });
    expect(read.mages[0].turns[0]).toMatchObject({ turn: 13, study: "FORC" });
    expect(read.summary).toBe("Nothing to warn about in this plan.");
  });

  it("answers one mage when a unit is named", async () => {
    const { host } = aHost(aTurn(), [], {}, { studyPlanner: PLANNER });

    const read = json((await call(host, "get_study_plans", { unitId: "101" })).text);

    expect(read.mages.map((mage: { unitId: string }) => mage.unitId)).toEqual(["101"]);
  });

  it("refuses a unit the planner does not show", async () => {
    const { host } = aHost(aTurn(), [], {}, { studyPlanner: PLANNER });

    const answer = await call(host, "get_study_plans", { unitId: "100" });

    expect(answer).toEqual({ text: "The study planner shows no mage 100: it lists only mages, yours and your allies'.", isError: true });
  });

  it("asks for a moment while the plans or the game data load", async () => {
    const { host } = aHost(aTurn());

    expect(await call(host, "get_study_plans")).toEqual({
      text: "The study plans have not loaded yet; try again in a moment.",
      isError: true
    });
  });

  it("says so when the plans could not be read", async () => {
    const { host } = aHost(aTurn(), [], {}, { studyPlanner: "failed" });

    expect(await call(host, "get_study_plans")).toEqual({
      text: "This game's study plans could not be read.",
      isError: true
    });
  });

  it("refuses a report with no turn number, which leaves the planner no turns", async () => {
    const { host } = aHost(aTurn(), [], {}, { studyPlanner: { ...PLANNER, viewedTurn: null } });

    expect(await call(host, "get_study_plans")).toEqual({
      text: "This turn's report has no turn number, so the study planner has no turns to plan.",
      isError: true
    });
  });
});

describe("trade routes", () => {
  /** Grain from the coast to the woods and iron back: a circuit, and the best route. */
  const circuit = aTradeRoute({
    from: { x: 1, y: 1, z: 1 },
    to: { x: 2, y: 1, z: 1 },
    outbound: [aTradedGood({ tag: "GRAI", name: "grain", buyPrice: 20, sellPrice: 35, quantity: 40, margin: 15, buySeenTurn: 12, sellSeenTurn: 12 })],
    inbound: [aTradedGood({ tag: "IRON", name: "iron", buyPrice: 60, sellPrice: 80, quantity: 10, margin: 20, buySeenTurn: 12, sellSeenTurn: 12 })],
    worth: 800,
    turns: { walk: 1, ride: 1, fly: 1 }
  });
  /** Livestock from the remembered plain to the coast, one way, priced on turn 9. */
  const oneWay = aTradeRoute({
    from: { x: 19, y: 5, z: 1 },
    to: { x: 1, y: 1, z: 1 },
    outbound: [aTradedGood({ tag: "LIVE", name: "livestock", buyPrice: 40, sellPrice: 50, quantity: 30, margin: 10, buySeenTurn: 9, sellSeenTurn: 12 })],
    inbound: [],
    worth: 300,
    turns: { walk: 6, ride: 3, fly: null }
  });

  it("lists the routes the HUD finds, best first, with goods, ends, months and margin", async () => {
    const { host } = aHost(aTurn(), [], { trade: [circuit, oneWay] });
    const answer = await call(host, "list_trade_routes");
    expect(answer.isError).toBe(false);
    const listed = json(answer.text);
    expect(listed.currentTurn).toBe(12);
    expect(listed.routes).toHaveLength(2);
    expect(listed.routes[0]).toEqual({
      from: "1,1,1",
      fromRegion: "plain (1,1,1) in Coast",
      to: "2,1,1",
      toRegion: "forest (2,1,1) in Woods",
      circuit: true,
      worth: 800,
      months: { walk: 1, ride: 1, fly: 1 },
      outbound: [{ tag: "GRAI", name: "grain", buyPrice: 20, sellPrice: 35, quantity: 40, margin: 15, buySeenTurn: 12, sellSeenTurn: 12 }],
      inbound: [{ tag: "IRON", name: "iron", buyPrice: 60, sellPrice: 80, quantity: 10, margin: 20, buySeenTurn: 12, sellSeenTurn: 12 }]
    });
    expect(listed.routes[1]).toMatchObject({ from: "1:19,5", fromRegion: "plain (19,5,1) in Borg", to: "1,1,1", circuit: false, months: { fly: null } });
    expect(listed.note).toMatch(/as last seen/u);
  });

  it("lists only the routes that start or end in a region, named by id or by coordinates", async () => {
    const { host } = aHost(aTurn(), [], { trade: [circuit, oneWay] });
    const byId = json((await call(host, "list_trade_routes", { regionId: "2,1,1" })).text);
    expect(byId.routes.map((route: { from: string }) => route.from)).toEqual(["1,1,1"]);
    const remembered = json((await call(host, "list_trade_routes", { regionId: "1:19,5" })).text);
    expect(remembered.routes.map((route: { to: string }) => route.to)).toEqual(["1,1,1"]);
    const byCoordinates = json((await call(host, "list_trade_routes", { x: 1, y: 1 })).text);
    expect(byCoordinates.routes).toHaveLength(2);
    const bare = json((await call(host, "list_trade_routes", { regionId: "1:2,1" })).text);
    expect(bare.routes).toHaveLength(1);
  });

  it("refuses a region neither the report nor the map knows", async () => {
    const { host } = aHost(aTurn(), [], { trade: [circuit] });
    for (const args of [{ regionId: "nowhere" }, { regionId: "1:99,99" }, { x: 99, y: 99 }, { x: 99, y: 99, z: 1 }]) {
      const answer = await call(host, "list_trade_routes", args);
      expect(answer.isError, JSON.stringify(args)).toBe(true);
      expect(answer.text, JSON.stringify(args)).toMatch(/list_known_regions/u);
    }
  });

  it("asks for the level when the coordinates are on more than one", async () => {
    const turn = aTurn();
    const map = aMap();
    const { host } = aHost(
      { ...turn, knownMap: { ...map, hexes: [...map.hexes, aKnownMapHex({ coordinate: { x: 1, y: 1, z: 2 }, terrain: "tunnels", province: "Deep" })] } },
      [],
      { trade: [circuit] }
    );
    const answer = await call(host, "list_trade_routes", { x: 1, y: 1 });
    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(/z: 1, 2/u);
  });

  it("stops a long list at the limit and says how many it left out", async () => {
    const many = Array.from({ length: 25 }, (_, index) => aTradeRoute({ from: { x: index, y: 40, z: 1 }, worth: 1000 - index }));
    const { host } = aHost(aTurn(), [], { trade: many });
    const shown = json((await call(host, "list_trade_routes")).text);
    expect(shown.routes).toHaveLength(20);
    expect(shown.leftOut).toBe(5);
    const fewer = json((await call(host, "list_trade_routes", { limit: 3 })).text);
    expect(fewer.routes.map((route: { worth: number }) => route.worth)).toEqual([1000, 999, 998]);
    expect(fewer.leftOut).toBe(22);
    const all = json((await call(host, "list_trade_routes", { limit: 500 })).text);
    expect(all.routes).toHaveLength(25);
    expect(all.leftOut).toBeUndefined();
  });

  it("refuses while the game data is still loading, rather than finding nothing to trade", async () => {
    const { host } = aHost(aTurn({ rulesetText: null }), [], { trade: [circuit] });
    const answer = await call(host, "list_trade_routes");
    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(/not loaded/u);
  });
});

describe("reading the open world's rules and data", () => {
  const trident = () => aHost({ ...aTurn(), rulesetId: "newage-trident" }).host;
  const SAYS_WHERE = { world: "New Age: Trident", snapshot: "2026-09-29", edition: "NewAge 1.1 Rules — Trident", lastChange: "September 28, 2026" };

  it("lists the open world's rules sections, naming the world and the snapshot", async () => {
    const answer = await call(trident(), "list_rules_sections");

    expect(answer.isError).toBe(false);
    expect(json(answer.text)).toEqual({
      ...SAYS_WHERE,
      sections: [
        { anchor: "give", title: "GIVE" },
        { anchor: "giveall", title: "GIVE ALL" }
      ]
    });
  });

  it("reads one section by its anchor", async () => {
    const answer = json((await call(trident(), "read_rules_section", { anchor: "give" })).text);

    expect(answer).toEqual({ ...SAYS_WHERE, source: "https://example.test/trident/rules", anchor: "give", title: "GIVE", text: TRIDENT_REFERENCE.sections[0]?.text });
  });

  it("refuses an anchor the world's rules do not have, offering the closest", async () => {
    const answer = await call(trident(), "read_rules_section", { anchor: "giv" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe('The New Age: Trident rules have no section called "giv". Closest: give, giveall.');
  });

  it("refuses an anchor with nothing close, pointing at the list", async () => {
    const answer = await call(trident(), "read_rules_section", { anchor: "zzzzzz" });

    expect(answer.text).toBe('The New Age: Trident rules have no section called "zzzzzz". list_rules_sections names them all.');
  });

  it("names the world when the snapshot served is not one", async () => {
    const { host } = aHost({ ...aTurn(), rulesetId: "newage-trident" });
    const broken = { ...host, rulesReference: async () => "<html>" };

    const answer = await call(broken, "list_rules_sections");

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe("The rules snapshot for New Age: Trident could not be read: the file served is not a rules snapshot.");
  });

  it("quotes fifty sections at most, saying how many more match", async () => {
    const many: RulesReference = {
      ...TRIDENT_REFERENCE,
      sections: Array.from({ length: 53 }, (_, index) => ({ anchor: `s${index}`, title: `S${index}`, text: "silver" }))
    };
    const { host } = aHost({ ...aTurn(), rulesetId: "newage-trident" });
    const busy = { ...host, rulesReference: async () => JSON.stringify(many) };

    const answer = json((await call(busy, "search_rules", { query: "silver" })).text);

    expect(answer.matches).toHaveLength(50);
    expect(answer.moreSections).toBe(3);
  });

  it("searches the rules, quoting the lines that match", async () => {
    const answer = json((await call(trident(), "search_rules", { query: "silver" })).text);

    expect(answer).toEqual({ ...SAYS_WHERE, matches: [{ anchor: "give", title: "GIVE", lines: ["A unit may give silver."] }] });
  });

  it("says so when no section mentions the query", async () => {
    const answer = json((await call(trident(), "search_rules", { query: "gold" })).text);

    expect(answer.matches).toEqual([]);
  });

  it("reads the data page's whole entry for a tag", async () => {
    const answer = json((await call(trident(), "read_data_entry", { query: "SWOR" })).text);

    expect(answer).toEqual({
      ...SAYS_WHERE,
      source: "https://example.test/trident/database",
      entries: [{ section: "items", name: "sword", tag: "SWOR", text: "sword [SWOR], weight 1." }]
    });
  });

  it("lists the names when a query fits several entries", async () => {
    const answer = json((await call(trident(), "read_data_entry", { query: "wor" })).text);

    expect(answer.names).toEqual([
      { section: "items", name: "sword", tag: "SWOR" },
      { section: "items", name: "mithril sword", tag: "MSWO" }
    ]);
  });

  it("refuses a data query nothing on the page fits", async () => {
    const answer = await call(trident(), "read_data_entry", { query: "laser" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe('Nothing on the New Age: Trident data page is called "laser".');
  });

  it("refuses while the game records no ruleset", async () => {
    const answer = await call(aHost(aTurn()).host, "list_rules_sections");

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe("This game records no ruleset, so the HUD cannot say which world's rules apply.");
  });

  it("refuses with the shell's own sentence when it cannot serve the snapshot", async () => {
    const answer = await call(aHost({ ...aTurn(), rulesetId: "atlantis-classic" }).host, "read_rules_section", { anchor: "give" });

    expect(answer.isError).toBe(true);
    expect(answer.text).toBe("This build carries no rules snapshot for atlantis-classic.");
  });

  it("asks the shell for the open turn's own world", async () => {
    const asked: string[] = [];
    const { host } = aHost({ ...aTurn(), rulesetId: "newage-trident" });
    const recording = { ...host, rulesReference: (id: string) => (asked.push(id), servedReference(id)) };

    await call(recording, "search_rules", { query: "give" });

    expect(asked).toEqual(["newage-trident"]);
  });
});
