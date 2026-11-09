import { describe, expect, it } from "vitest";
import {
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit,
  type OrderDiagnostic,
  type OrderValidationResult
} from "@atlantis/core-client";
import { orderProcessingFor } from "../orderProcessing";
import { ASSISTANT_TOOLS, answerToolCall, type AssistantHost, type AssistantTurn } from "./assistantTools";

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

/** A host over one turn, recording what it was asked to write and answering with `diagnostics`. */
function aHost(turn: AssistantTurn | null, diagnostics: OrderDiagnostic[] = []) {
  const written: string[] = [];
  let current = turn;
  const host: AssistantHost = {
    turn: () => current,
    orders: orderProcessingFor(null),
    bannerFor: (regionId) => (regionId === "1,1,1" ? ";*** plain (1,1) in Coast ***" : null),
    validate: async () => ({ diagnostics }) as unknown as OrderValidationResult,
    writeOrders: (document) => {
      written.push(document);
      current = current === null ? null : { ...current, ordersDocument: document };
    }
  };
  return { host, written };
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
      const answer = await call(host, tool.name, { unitId: "100", regionId: "1,1,1", orders: "work", query: "silver" });
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

    const answer = await call(host, "set_unit_orders", { unitId: "101", orders: "study FARM\n" });

    expect(answer.isError).toBe(false);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(DOCUMENT.replace("unit 101\n", "unit 101\nstudy FARM\n"));
    expect((await call(host, "get_orders", { unitId: "101" })).text).toBe("study FARM");
  });

  it("reports what the validator makes of a unit's orders once they are written", async () => {
    const { host } = aHost(aTurn(), [aDiagnostic({ lineStart: 9, lineEnd: 9, unitId: "101" })]);

    const answer = json((await call(host, "set_unit_orders", { unitId: "101", orders: "fly" })).text);

    expect(answer.written).toBe(true);
    expect(answer.problems).toEqual(["its line 1 error unknown-order: Unknown order FLY."]);
  });

  it("creates the block of an own unit the document has none for, under its region's banner", async () => {
    const turn = aTurn({ ordersDocument: "#atlantis 3\n\n;*** plain (1,1) in Coast ***\n\n#end\n" });
    const { host, written } = aHost(turn);

    await call(host, "set_unit_orders", { unitId: "100", orders: "work" });

    expect(written[0]).toContain("unit 100\nwork");
  });

  it("refuses to write orders for a unit that is not the faction's own", async () => {
    const { host, written } = aHost(aTurn());

    const answer = await call(host, "set_unit_orders", { unitId: "900", orders: "work" });

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
