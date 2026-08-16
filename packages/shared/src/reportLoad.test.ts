import type {
  CoreClient,
  KnownMap,
  OpenedGame,
  ParsedReport,
  RememberedRegion
} from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  factionLabelOf,
  firstUnitIn,
  loadTurn,
  openingSelection,
  reportParser,
  routeReport,
  storeOlderTurn
} from "./reportLoad";

function region(regionId: string, x: number, y: number, own: boolean, unitId = `${regionId}-u`) {
  return {
    ...regionNoUnits(regionId, x, y),
    units: [
      {
        unitId,
        name: "Scout",
        regionId,
        factionId: own ? "95" : null,
        factionName: own ? "Borg TNG" : null,
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
      }
    ]
  };
}

function regionNoUnits(regionId: string, x: number, y: number) {
  return {
    regionId,
    coordinate: { x, y, z: 1 },
    terrain: "plain",
    province: "Nowhere",
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
    units: []
  };
}

function report(overrides: Partial<ParsedReport["header"]> = {}, regions: unknown[] = []): ParsedReport {
  return {
    header: {
      factionId: "95",
      factionName: "Borg TNG",
      factionTypes: [],
      month: "January",
      year: 6,
      turnNumber: 71,
      engineVersion: null,
      ruleset: null,
      rulesetVersion: null,
      unclaimedSilver: null,
      errors: [],
      events: [],
      factionStatus: { entries: [], unparsed: [] },
      attitudes: { defaultAttitude: null, levels: [] },
      ...overrides
    },
    regions,
    battles: [],
    ordersTemplate: null
  } as unknown as ParsedReport;
}

const KNOWN_MAP: KnownMap = { hexes: [], levels: [], currentTurn: 71 };

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    loadMergedReports: vi.fn().mockResolvedValue([]),
    loadOrderDraft: vi.fn().mockResolvedValue(null),
    parseReportClassified: vi.fn().mockResolvedValue(report()),
    parseReportFull: vi.fn().mockResolvedValue(report()),
    knownMap: vi.fn().mockResolvedValue(KNOWN_MAP),
    ...overrides
  } as unknown as CoreClient;
}

const OPEN_GAME = {
  gameFilePath: "p.json",
  databasePath: "p.sqlite",
  schemaVersion: 5,
  manifest: {
    manifestVersion: 1,
    metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  }
} as OpenedGame;

const NOW = "2026-08-15T18:30:00Z";
const RULESET = '{"items":{}}';

describe("loadTurn", () => {
  it("commits the turn and reads the saved draft, when there is a game", async () => {
    const remembered: RememberedRegion[] = [{ region: region("1:1,1", 1, 1, false), lastSeenTurn: 71 }];
    const core = client({
      loadRegionSightings: vi.fn().mockResolvedValue(remembered),
      loadOrderDraft: vi
        .fn()
        .mockResolvedValue({ key: {}, orderText: "@work", updatedAt: NOW })
    });

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW);

    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      "raw text",
      RULESET,
      true,
      NOW
    );
    expect(loaded.remembered).toEqual(remembered);
    expect(loaded.orders).toBe("@work");
    expect(loaded.knownMap).toBe(KNOWN_MAP);
  });

  it("counts regions and units, and carries no warning when nothing went wrong", async () => {
    const core = client();
    const withRegions = report({}, [region("1:1,1", 1, 1, true), region("1:2,2", 2, 2, false)]);

    const loaded = await loadTurn(core, OPEN_GAME, withRegions, "raw text", RULESET, NOW);

    expect(loaded.status).toEqual({ text: "2 regions · 2 units", tone: "routine" });
  });

  it("prefers the remember warning over the draft warning as the status message", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full")),
      loadOrderDraft: vi.fn().mockRejectedValue(new Error("draft is locked"))
    });

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW);

    expect(loaded.status.text).toContain("disk is full");
    expect(loaded.status.tone).toBe("warning");
  });

  it("falls back to the draft warning when only the draft failed", async () => {
    const core = client({
      loadOrderDraft: vi.fn().mockRejectedValue(new Error("draft is locked"))
    });

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW);

    expect(loaded.status.text).toContain("draft is locked");
  });

  it("uses the report's own template when there is no saved draft", async () => {
    const core = client();
    const withTemplate = report();
    (withTemplate as { ordersTemplate: unknown }).ordersTemplate = {
      text: "#atlantis 95 pass",
      factionId: "95",
      units: []
    };

    const loaded = await loadTurn(core, OPEN_GAME, withTemplate, "raw text", RULESET, NOW);

    expect(loaded.orders).toBe("#atlantis 95 pass");
    expect(loaded.ordersSavedAt).toBeNull();
  });

  it("does not remember again when the caller already committed the turn", async () => {
    const core = client();

    await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW, {
      remembered: [],
      knownMap: null,
      merged: [],
      warning: null
    });

    expect(core.commitReportImport).not.toHaveBeenCalled();
    expect(core.loadRegionSightings).not.toHaveBeenCalled();
  });

  it("remembers nothing and uses the template when there is no open game", async () => {
    const core = client();

    const loaded = await loadTurn(core, null, report(), "raw text", RULESET, NOW);

    expect(loaded.remembered).toEqual([]);
    expect(loaded.merged).toEqual([]);
    expect(loaded.orders).toBe("");
    expect(loaded.status.tone).toBe("routine");
    expect(core.commitReportImport).not.toHaveBeenCalled();
  });

  it("resolves rather than rejects when only the remember failed - the report is still usable", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    await expect(loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW)).resolves.toBeDefined();
  });
});

describe("openingSelection", () => {
  it("picks the hex the player has units in, and its first unit", () => {
    const withRegions = report({}, [
      region("1:1,1", 1, 1, false),
      region("1:2,2", 2, 2, true, "own-unit")
    ]);

    expect(openingSelection(withRegions)).toEqual({ regionId: "1:2,2", unitId: "own-unit" });
  });

  it("falls back to the initial visited region with no unit when it has none", () => {
    const withRegions = report({}, [regionNoUnits("1:1,1", 1, 1)]);

    expect(openingSelection(withRegions)).toEqual({ regionId: "1:1,1", unitId: null });
  });

  it("is null when the report visits nowhere at all", () => {
    expect(openingSelection(report({}, []))).toBeNull();
  });
});

describe("firstUnitIn", () => {
  it("picks the first unit of a visited hex with units", () => {
    const withRegions = report({}, [region("1:2,2", 2, 2, true, "own-unit")]);

    expect(firstUnitIn(withRegions, "1:2,2")).toBe("own-unit");
  });

  it("is null for a visited hex with nobody in it", () => {
    const withRegions = report({}, [regionNoUnits("1:1,1", 1, 1)]);

    expect(firstUnitIn(withRegions, "1:1,1")).toBeNull();
  });

  it("is null for a hex the report does not visit", () => {
    const withRegions = report({}, [region("1:2,2", 2, 2, true)]);

    expect(firstUnitIn(withRegions, "1:9,9")).toBeNull();
  });
});

describe("storeOlderTurn", () => {
  it("says a turn was stored for history when the commit had no warning", async () => {
    const core = client();

    const status = await storeOlderTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW, 71);

    expect(status).toEqual({
      text: "turn 71 stored for history; still showing turn 71.",
      tone: "notice"
    });
  });

  it("carries the commit's own warning when it has one", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    const status = await storeOlderTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW, 71);

    expect(status.text).toContain("disk is full");
    expect(status.tone).toBe("warning");
  });
});

describe("routeReport", () => {
  it("loads when nothing is on screen", () => {
    expect(routeReport(null, report(), "text", "turn.rep")).toEqual({ kind: "load" });
  });

  it("rejects a report with no faction and says why", () => {
    const viewer = report({ turnNumber: 71 });
    const incoming = report({ factionId: null, factionName: null, turnNumber: null });

    expect(routeReport(viewer, incoming, "junk", "junk.rep")).toEqual({
      kind: "reject",
      reason: "the report does not name its faction"
    });
    expect(routeReport(null, incoming, "junk", "junk.rep")).toEqual({
      kind: "reject",
      reason: "the report does not name its faction"
    });
  });

  it("loads a newer turn of the same faction", () => {
    const viewer = report({ turnNumber: 70 });
    const incoming = report({ turnNumber: 71 });

    expect(routeReport(viewer, incoming, "text", "turn.rep")).toEqual({ kind: "load" });
  });

  it("stores an older report for history without asking", () => {
    const viewer = report({ turnNumber: 71 });
    const incoming = report({ turnNumber: 70 });

    expect(routeReport(viewer, incoming, "text", "turn.rep")).toEqual({
      kind: "storeOnly",
      currentTurn: 71
    });
  });

  it("asks with merge on offer for another faction's report of the same turn", () => {
    const viewer = report({ factionId: "95", factionName: "Borg TNG", turnNumber: 71 });
    const incoming = report({ factionId: "73", factionName: null, turnNumber: 71 });

    const route = routeReport(viewer, incoming, "text", "ally.rep");

    expect(route).toEqual({
      kind: "ask",
      pending: {
        report: incoming,
        text: "text",
        fileName: "ally.rep",
        canMerge: true,
        viewer: { factionId: "95", factionLabel: "Borg TNG (95)", turnNumber: 71 },
        incoming: { factionLabel: "73", turnNumber: 71 }
      }
    });
  });

  it("asks without merge on offer for another faction's report of a different turn", () => {
    const viewer = report({ factionId: "95", turnNumber: 71 });
    const incoming = report({ factionId: "73", turnNumber: 72 });

    const route = routeReport(viewer, incoming, "text", "ally.rep");

    expect(route.kind).toBe("ask");
    expect(route.kind === "ask" && route.pending.canMerge).toBe(false);
  });
});

describe("factionLabelOf", () => {
  it("combines the name and the id", () => {
    expect(factionLabelOf(report({ factionId: "95", factionName: "Borg TNG" }))).toBe(
      "Borg TNG (95)"
    );
  });

  it("falls back to whichever half it has", () => {
    expect(factionLabelOf(report({ factionId: "95", factionName: null }))).toBe("95");
    expect(factionLabelOf(report({ factionId: null, factionName: "Borg TNG" }))).toBe("Borg TNG");
  });

  it("is null for no report and for a report with neither", () => {
    expect(factionLabelOf(null)).toBeNull();
    expect(factionLabelOf(report({ factionId: null, factionName: null }))).toBeNull();
  });
});

describe("reportParser", () => {
  it("parses classified when the ruleset is ready", async () => {
    const core = client();

    const parse = reportParser(core, { status: "ready", text: RULESET });
    await parse("raw text");

    expect(core.parseReportClassified).toHaveBeenCalledWith("raw text", RULESET);
    expect(core.parseReportFull).not.toHaveBeenCalled();
  });

  it("parses full whenever the ruleset is not ready", async () => {
    const core = client();

    await reportParser(core, { status: "loading" })("raw text");
    await reportParser(core, { status: "unavailable" })("raw text");

    expect(core.parseReportFull).toHaveBeenCalledTimes(2);
    expect(core.parseReportClassified).not.toHaveBeenCalled();
  });
});
