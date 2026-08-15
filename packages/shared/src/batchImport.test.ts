import type { CoreClient, OpenedGame, ParsedReport } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { batchSummary, prepareBatch, viewerFactionOptions, walkBatch, type ChosenFile } from "./batchImport";

function report(overrides: Partial<ParsedReport["header"]> = {}): ParsedReport {
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
    regions: [],
    battles: [],
    ordersTemplate: null
  } as unknown as ParsedReport;
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    loadMergedReports: vi.fn().mockResolvedValue([]),
    mergeReport: vi.fn().mockResolvedValue(MERGE_RESULT),
    ...overrides
  } as unknown as CoreClient;
}

const MERGE_RESULT = {
  turnNumber: 71,
  mergedFactionId: "73",
  mergedFactionName: "Borg",
  mergedRegionCount: 3,
  newRegionCount: 2
};

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

const NOW = () => "2026-08-15T18:30:00Z";
const RULESET = '{"items":{}}';

function file(name: string, text: string): ChosenFile {
  return { name, text: () => Promise.resolve(text) };
}

describe("prepareBatch", () => {
  it("reads and parses every file, in order", async () => {
    const parse = vi.fn().mockImplementation((text: string) => Promise.resolve(report({ factionId: text })));

    const batch = await prepareBatch([file("a.rep", "95"), file("b.rep", "73")], parse);

    expect(batch.read).toEqual([
      { text: "95", report: report({ factionId: "95" }) },
      { text: "73", report: report({ factionId: "73" }) }
    ]);
    expect(batch.candidates).toEqual([
      { fileName: "a.rep", factionId: "95", turnNumber: 71 },
      { fileName: "b.rep", factionId: "73", turnNumber: 71 }
    ]);
    expect(batch.unreadable).toEqual([]);
  });

  it("costs a file its slot rather than the whole batch when it will not read", async () => {
    const parse = vi.fn().mockResolvedValue(report());
    const unreadable: ChosenFile = { name: "bad.rep", text: () => Promise.reject(new Error("gone")) };

    const batch = await prepareBatch([file("a.rep", "text"), unreadable], parse);

    expect(batch.read).toEqual([{ text: "text", report: report() }, null]);
    expect(batch.candidates).toEqual([
      { fileName: "a.rep", factionId: "95", turnNumber: 71 },
      { fileName: "bad.rep", factionId: null, turnNumber: null }
    ]);
    expect(batch.unreadable).toEqual([{ index: 1, fileName: "bad.rep", reason: "could not be read: gone" }]);
  });

  it("costs a file its slot rather than the whole batch when it will not parse", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("not a report"));

    const batch = await prepareBatch([file("bad.rep", "garbage")], parse);

    expect(batch.read).toEqual([null]);
    expect(batch.candidates).toEqual([{ fileName: "bad.rep", factionId: null, turnNumber: null }]);
    expect(batch.unreadable).toEqual([
      { index: 0, fileName: "bad.rep", reason: "could not be read: not a report" }
    ]);
  });
});

describe("viewerFactionOptions", () => {
  it("labels each option from the report naming that faction", async () => {
    const parse = vi.fn().mockImplementation((text: string) =>
      Promise.resolve(report({ factionId: text, factionName: text === "95" ? "Borg TNG" : null }))
    );
    const batch = await prepareBatch([file("a.rep", "95"), file("b.rep", "17")], parse);

    expect(viewerFactionOptions(batch, ["95", "17"])).toEqual([
      { factionId: "95", label: "Borg TNG (95)" },
      { factionId: "17", label: "17" }
    ]);
  });

  it("falls back to 'faction <id>' when no report names it", async () => {
    const batch = await prepareBatch([], vi.fn());

    expect(viewerFactionOptions(batch, ["95"])).toEqual([{ factionId: "95", label: "faction 95" }]);
  });
});

describe("walkBatch", () => {
  it("commits the viewer's own step and merges an ally's, in the plan's order", async () => {
    const core = client();
    const batch = {
      read: [
        { text: "own", report: report({ factionId: "95", turnNumber: 71 }) },
        { text: "ally", report: report({ factionId: "73", turnNumber: 71 }) }
      ],
      candidates: [
        { fileName: "own.rep", factionId: "95", turnNumber: 71 },
        { fileName: "ally.rep", factionId: "73", turnNumber: 71 }
      ],
      unreadable: []
    };
    const progress: [number, number][] = [];

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", null, RULESET, NOW, (done, total) =>
      progress.push([done, total])
    );

    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      "own",
      RULESET,
      true,
      NOW()
    );
    expect(core.mergeReport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      71,
      "ally",
      RULESET,
      NOW()
    );
    expect(walk.landed).toHaveLength(2);
    expect(walk.skipped).toEqual([]);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2]
    ]);
  });

  it("demotes a commit warning to a skip", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });
    const batch = {
      read: [{ text: "own", report: report({ factionId: "95", turnNumber: 71 }) }],
      candidates: [{ fileName: "own.rep", factionId: "95", turnNumber: 71 }],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", null, RULESET, NOW, () => {});

    expect(walk.landed).toEqual([]);
    expect(walk.skipped).toEqual([
      { index: 0, fileName: "own.rep", reason: "the turn could not be remembered: disk is full" }
    ]);
    expect(walk.finish).toBeNull();
  });

  it("demotes a rejecting merge to a skip with describeError's reason", async () => {
    const core = client({ mergeReport: vi.fn().mockRejectedValue(new Error("no such turn")) });
    const batch = {
      read: [{ text: "ally", report: report({ factionId: "73", turnNumber: 71 }) }],
      candidates: [{ fileName: "ally.rep", factionId: "73", turnNumber: 71 }],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", 71, RULESET, NOW, () => {});

    expect(walk.landed).toEqual([]);
    expect(walk.skipped).toEqual([{ index: 0, fileName: "ally.rep", reason: "no such turn" }]);
  });

  it("finishes on the last landed own import of the plan's final turn", async () => {
    const core = client();
    const batch = {
      read: [
        { text: "first", report: report({ factionId: "95", turnNumber: 71 }) },
        { text: "second", report: report({ factionId: "95", turnNumber: 71 }) }
      ],
      candidates: [
        { fileName: "first.rep", factionId: "95", turnNumber: 71 },
        { fileName: "second.rep", factionId: "95", turnNumber: 71 }
      ],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", null, RULESET, NOW, () => {});

    expect(walk.finish?.step.fileName).toBe("second.rep");
    expect(walk.finish?.source.text).toBe("second");
  });

  it("finishes null when only ally reports land", async () => {
    const core = client();
    const batch = {
      read: [{ text: "ally", report: report({ factionId: "73", turnNumber: 71 }) }],
      candidates: [{ fileName: "ally.rep", factionId: "73", turnNumber: 71 }],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", 71, RULESET, NOW, () => {});

    expect(walk.finish).toBeNull();
  });
});

describe("batchSummary", () => {
  it("names the turn on screen and the viewer's label from the finishing report", async () => {
    const core = client();
    const batch = {
      read: [{ text: "own", report: report({ factionId: "95", turnNumber: 71 }) }],
      candidates: [{ fileName: "own.rep", factionId: "95", turnNumber: 71 }],
      unreadable: []
    };
    const walk = await walkBatch(core, OPEN_GAME, batch, "95", null, RULESET, NOW, () => {});

    const summary = batchSummary(walk, null);

    expect(summary.finalTurn).toBe(71);
    expect(summary.viewerFactionLabel).toBe("Borg TNG (95)");
    expect(summary.steps).toEqual(walk.landed);
    expect(summary.skipped).toEqual(walk.skipped);
  });

  it("falls back to the viewer report and then 'an unnamed faction' when nothing finished", async () => {
    const core = client();
    const batch = { read: [], candidates: [], unreadable: [] };
    const walk = await walkBatch(core, OPEN_GAME, batch, "95", 71, RULESET, NOW, () => {});

    expect(batchSummary(walk, report({ factionName: "Borg TNG" })).viewerFactionLabel).toBe(
      "Borg TNG (95)"
    );
    expect(batchSummary(walk, null).viewerFactionLabel).toBe("an unnamed faction");
    expect(batchSummary(walk, null).finalTurn).toBeNull();
  });
});
