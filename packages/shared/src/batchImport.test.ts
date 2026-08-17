import type { CoreClient, OpenedGame, ParsedReport, ReportHeaderInfo } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { batchSummary, prepareBatch, viewerFactionOptions, walkBatch, type ChosenFile } from "./batchImport";
import type { BatchCandidate } from "./reportBatch";
import { REPORT_NAMES_NO_FACTION, REPORT_NAMES_NO_TURN } from "./reportLoadDecision";

/**
 * A candidate as `prepareBatch` builds one: `usable` is what `judgeReportUsable` said about the
 * report behind it, derived here from the identity so a fixture cannot forget the judgement.
 */
function candidate(
  fields: Omit<BatchCandidate, "usable"> & Partial<Pick<BatchCandidate, "usable">>
): BatchCandidate {
  const usable: BatchCandidate["usable"] =
    fields.usable ??
    (fields.factionId === null
      ? { ok: false, reason: REPORT_NAMES_NO_FACTION }
      : fields.turnNumber === null
        ? { ok: false, reason: REPORT_NAMES_NO_TURN }
        : { ok: true });
  return { ...fields, usable };
}

// One region, because a report with nothing in it is refused outright (ah-sgn.1) and these fixtures
// stand for reports the batch is meant to act on.
function report(overrides: Partial<ReportHeaderInfo> = {}): ParsedReport {
  return aParsedReport({
    header: aReportHeaderInfo({ month: "January", ...overrides }),
    regions: [aReportRegion()]
  });
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
      candidate({ fileName: "a.rep", factionId: "95", turnNumber: 71 }),
      candidate({ fileName: "b.rep", factionId: "73", turnNumber: 71 })
    ]);
    expect(batch.unreadable).toEqual([]);
  });

  it("costs a file its slot rather than the whole batch when it will not read", async () => {
    const parse = vi.fn().mockResolvedValue(report());
    const unreadable: ChosenFile = { name: "bad.rep", text: () => Promise.reject(new Error("gone")) };

    const batch = await prepareBatch([file("a.rep", "text"), unreadable], parse);

    expect(batch.read).toEqual([{ text: "text", report: report() }, null]);
    expect(batch.candidates).toEqual([
      candidate({ fileName: "a.rep", factionId: "95", turnNumber: 71 }),
      candidate({
        fileName: "bad.rep",
        factionId: null,
        turnNumber: null,
        // A file nothing could be read from carries the read failure as its verdict too, so the plan
        // never reports a faction-shaped reason for a parse failure.
        usable: { ok: false, reason: "could not be read: gone" }
      })
    ]);
    expect(batch.unreadable).toEqual([{ index: 1, fileName: "bad.rep", reason: "could not be read: gone" }]);
  });

  it("costs a file its slot rather than the whole batch when it will not parse", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("not a report"));

    const batch = await prepareBatch([file("bad.rep", "garbage")], parse);

    expect(batch.read).toEqual([null]);
    expect(batch.candidates).toEqual([
      candidate({
        fileName: "bad.rep",
        factionId: null,
        turnNumber: null,
        usable: { ok: false, reason: "could not be read: not a report" }
      })
    ]);
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
        candidate({ fileName: "own.rep", factionId: "95", turnNumber: 71 }),
        candidate({ fileName: "ally.rep", factionId: "73", turnNumber: 71 })
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

  /**
   * The walk merges through `commitMerge`, the half of `mergeTurn` that writes: the map is read
   * back once at the end of the whole batch, not after every merged step. Merging through the whole
   * of `mergeTurn` instead would read the sightings and resolve a map per step - work thrown away,
   * and a read-back failure would then be counted against a step that landed (ah-u4e.3, PR #313).
   */
  it("does not read the map back after each merged step", async () => {
    const core = client({ knownMap: vi.fn().mockResolvedValue({ hexes: [], levels: [], currentTurn: 71 }) });
    const batch = {
      read: [
        { text: "ally", report: report({ factionId: "73", turnNumber: 71 }) },
        { text: "other", report: report({ factionId: "12", turnNumber: 71 }) }
      ],
      candidates: [
        candidate({ fileName: "ally.rep", factionId: "73", turnNumber: 71 }),
        candidate({ fileName: "other.rep", factionId: "12", turnNumber: 71 })
      ],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", 71, RULESET, NOW, () => {});

    expect(walk.landed).toHaveLength(2);
    expect(core.mergeReport).toHaveBeenCalledTimes(2);
    expect(core.loadRegionSightings).not.toHaveBeenCalled();
    expect(core.loadMergedReports).not.toHaveBeenCalled();
    expect(core.knownMap).not.toHaveBeenCalled();
  });

  it("demotes a commit warning to a skip", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });
    const batch = {
      read: [{ text: "own", report: report({ factionId: "95", turnNumber: 71 }) }],
      candidates: [candidate({ fileName: "own.rep", factionId: "95", turnNumber: 71 })],
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
      candidates: [candidate({ fileName: "ally.rep", factionId: "73", turnNumber: 71 })],
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
        candidate({ fileName: "first.rep", factionId: "95", turnNumber: 71 }),
        candidate({ fileName: "second.rep", factionId: "95", turnNumber: 71 })
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
      candidates: [candidate({ fileName: "ally.rep", factionId: "73", turnNumber: 71 })],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, "95", 71, RULESET, NOW, () => {});

    expect(walk.finish).toBeNull();
  });

  it("still returns every file as skipped, rather than doing nothing, when the batch cannot say whose it is", async () => {
    const core = client();
    const batch = {
      read: [{ text: "mystery", report: report({ factionId: null, turnNumber: null }) }],
      candidates: [candidate({ fileName: "mystery.rep", factionId: null, turnNumber: null })],
      unreadable: []
    };

    const walk = await walkBatch(core, OPEN_GAME, batch, null, null, RULESET, NOW, () => {});

    expect(core.commitReportImport).not.toHaveBeenCalled();
    expect(core.mergeReport).not.toHaveBeenCalled();
    expect(walk.landed).toEqual([]);
    expect(walk.skipped).toEqual([
      { index: 0, fileName: "mystery.rep", reason: "the report does not name its faction" }
    ]);
    expect(walk.finish).toBeNull();
  });
});

describe("batchSummary", () => {
  it("names the turn on screen and the viewer's label from the finishing report", async () => {
    const core = client();
    const batch = {
      read: [{ text: "own", report: report({ factionId: "95", turnNumber: 71 }) }],
      candidates: [candidate({ fileName: "own.rep", factionId: "95", turnNumber: 71 })],
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
