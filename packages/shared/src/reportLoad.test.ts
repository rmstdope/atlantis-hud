import type {
  CoreClient,
  KnownMap,
  OpenedGame,
  ParsedReport,
  RememberedRegion,
  ReportHeaderInfo,
  ReportRegion
} from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  REPORT_HAS_NOTHING_IN_IT,
  REPORT_NAMES_NO_FACTION,
  REPORT_NAMES_NO_TURN
} from "./reportLoadDecision";
import {
  factionLabelOf,
  firstUnitIn,
  loadTurn,
  openingSelection,
  reportParser,
  routeReport,
  storeOlderTurn
} from "./reportLoad";

function region(regionId: string, x: number, y: number, own: boolean, unitId = `${regionId}-u`): ReportRegion {
  return aReportRegion({
    ...regionNoUnits(regionId, x, y),
    units: [
      aReportUnit({
        unitId,
        name: "Scout",
        regionId,
        factionId: own ? "95" : null,
        factionName: own ? "Borg TNG" : null,
        own
      })
    ]
  });
}

function regionNoUnits(regionId: string, x: number, y: number): ReportRegion {
  return aReportRegion({ regionId, coordinate: { x, y, z: 1 }, terrain: "plain", province: "Nowhere" });
}

// One region by default: a report with nothing in it is refused outright (ah-sgn.1), so an empty
// one is a deliberate fixture rather than the baseline.
function report(
  overrides: Partial<ReportHeaderInfo> = {},
  regions: ReportRegion[] = [aReportRegion()]
): ParsedReport {
  return aParsedReport({ header: aReportHeaderInfo({ month: "January", ...overrides }), regions });
}

const KNOWN_MAP: KnownMap = { hexes: [], levels: [], currentTurn: 71 };

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    loadMergedReports: vi.fn().mockResolvedValue([]),
    loadOrderDraft: vi.fn().mockResolvedValue(null),
    setActiveFaction: vi.fn().mockImplementation(async () => REWRITTEN_MANIFEST),
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

const REWRITTEN_MANIFEST = {
  ...OPEN_GAME.manifest,
  metadata: { ...OPEN_GAME.manifest.metadata, activeFactionId: "95" }
};

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

  it("remembers the faction whose report became the working turn", async () => {
    const core = client();

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW);

    expect(core.setActiveFaction).toHaveBeenCalledTimes(1);
    expect(core.setActiveFaction).toHaveBeenCalledWith("aug-2026", "95");
    expect(loaded.manifest).toBe(REWRITTEN_MANIFEST);
    expect(loaded.status.tone).toBe("routine");
  });

  it("does not rewrite the remembered faction when it is already this one", async () => {
    const core = client();
    const settled = {
      ...OPEN_GAME,
      manifest: REWRITTEN_MANIFEST
    } as OpenedGame;

    const loaded = await loadTurn(core, settled, report(), "raw text", RULESET, NOW);

    expect(core.setActiveFaction).not.toHaveBeenCalled();
    expect(loaded.manifest).toBeNull();
  });

  it("remembers the faction on the batch path too, where the turn was already committed", async () => {
    const core = client();

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW, {
      remembered: [],
      knownMap: null,
      merged: [],
      warning: null
    });

    expect(core.setActiveFaction).toHaveBeenCalledWith("aug-2026", "95");
    expect(loaded.manifest).toBe(REWRITTEN_MANIFEST);
  });

  it("turns a manifest that will not write into a warning, not a failed load", async () => {
    const core = client({
      setActiveFaction: vi.fn().mockRejectedValue(new Error("the manifest is read-only"))
    });

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW);

    expect(loaded.parsed).toBeDefined();
    expect(loaded.manifest).toBeNull();
    expect(loaded.status.text).toContain("the manifest is read-only");
    expect(loaded.status.tone).toBe("warning");
  });

  it("lets the draft warning win over the remembering one", async () => {
    const core = client({
      loadOrderDraft: vi.fn().mockRejectedValue(new Error("draft is locked")),
      setActiveFaction: vi.fn().mockRejectedValue(new Error("the manifest is read-only"))
    });

    const loaded = await loadTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW);

    expect(loaded.status.text).toContain("draft is locked");
  });

  it("remembers nothing when there is no open game", async () => {
    const core = client();

    const loaded = await loadTurn(core, null, report(), "raw text", RULESET, NOW);

    expect(core.setActiveFaction).not.toHaveBeenCalled();
    expect(loaded.manifest).toBeNull();
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

  it("does not change which faction the game reopens as", async () => {
    const core = client();

    await storeOlderTurn(core, OPEN_GAME, report(), "raw text", RULESET, NOW, 71);

    expect(core.setActiveFaction).not.toHaveBeenCalled();
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
      reason: REPORT_NAMES_NO_FACTION
    });
    expect(routeReport(null, incoming, "junk", "junk.rep")).toEqual({
      kind: "reject",
      reason: REPORT_NAMES_NO_FACTION
    });
  });

  it("refuses an unnumbered report rather than loading it", () => {
    const incoming = report({ turnNumber: null });

    expect(routeReport(null, incoming, "text", "turn.rep")).toEqual({
      kind: "reject",
      reason: REPORT_NAMES_NO_TURN
    });
    expect(routeReport(report({ turnNumber: 71 }), incoming, "text", "turn.rep")).toEqual({
      kind: "reject",
      reason: REPORT_NAMES_NO_TURN
    });
  });

  it("refuses an empty report rather than replacing what is on screen", () => {
    const incoming = report({ turnNumber: 72 }, []);

    expect(routeReport(report({ turnNumber: 71 }), incoming, "text", "turn.rep")).toEqual({
      kind: "reject",
      reason: REPORT_HAS_NOTHING_IN_IT
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
