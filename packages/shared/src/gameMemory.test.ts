import type {
  CoreClient,
  KnownMap,
  OpenedGame,
  ParsedReport,
  RememberedRegion
} from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  commitTurn,
  knownMapFor,
  mergeTurn,
  readMemory,
  rememberTurn,
  restoreLatestTurn
} from "./gameMemory";

function region(regionId: string, x: number, y: number) {
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

function report(factionId: string | null): ParsedReport {
  return {
    header: {
      factionId,
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
      attitudes: { defaultAttitude: null, levels: [] }
    },
    regions: [],
    battles: [],
    ordersTemplate: null
  };
}

const KNOWN_MAP: KnownMap = { hexes: [], levels: [], currentTurn: 71 };

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    loadMergedReports: vi.fn().mockResolvedValue([]),
    mergeReport: vi.fn().mockResolvedValue(MERGE_RESULT),
    knownMap: vi.fn().mockResolvedValue(KNOWN_MAP),
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

const MERGE_RECORD = {
  gameId: "aug-2026",
  factionId: "95",
  turnNumber: 71,
  mergedFactionId: "73",
  mergedFactionName: "Borg",
  mergedAt: "2026-08-09T18:30:00Z"
};

/** The game the player has open. Remembering files a turn here and nowhere else. */
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

/** The clock is the caller's, so a test can state it rather than mock one. */
const NOW = "2026-08-09T18:30:00Z";

/** Stands in for the served catalogue; the tests only assert it is handed on untouched. */
const RULESET = '{"items":{}}';

describe("remembering a turn", () => {
  it("commits the report and reads back everything the faction has seen", async () => {
    const remembered: RememberedRegion[] = [
      { region: region("1:1,1", 1, 1), lastSeenTurn: 40 },
      { region: region("1:2,2", 2, 2), lastSeenTurn: 71 }
    ];
    const core = client({ loadRegionSightings: vi.fn().mockResolvedValue(remembered) });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(outcome.warning).toBeNull();
    expect(outcome.remembered).toHaveLength(2);
    expect(outcome.remembered[0].lastSeenTurn).toBe(40);
    expect(outcome.remembered[0].region.regionId).toBe("1:1,1");
    // The open game decides where the turn lands, not the faction the report happens to name.
    // The clock comes from the caller so both platforms stamp the same format. The ruleset rides
    // along so what is stored is classified the way what is shown is.
    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      "raw text",
      RULESET,
      true,
      NOW
    );
    expect(core.knownMap).toHaveBeenCalledWith("raw text", RULESET, remembered);
    expect(outcome.knownMap).toBe(KNOWN_MAP);
  });

  /**
   * A report that parsed perfectly well must still be usable when the database will not cooperate.
   * Refusing to show it would trade something that works for something that does not.
   */
  it("warns rather than failing when the turn cannot be remembered", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(outcome.warning).toContain("disk is full");
    expect(outcome.remembered).toEqual([]);
  });

  /**
   * The map is still drawn from the report alone when the memory itself cannot be read, so the
   * screen shows something rather than an empty lattice on a database hiccup.
   */
  it("draws the map from the report alone when the memory cannot be read", async () => {
    const core = client({
      loadRegionSightings: vi.fn().mockRejectedValue(new Error("database is locked"))
    });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(core.knownMap).toHaveBeenCalledWith("raw text", RULESET, []);
    expect(outcome.knownMap).toBe(KNOWN_MAP);
    expect(outcome.warning).toContain("database is locked");
  });

  it("says so when the report does not name its faction", async () => {
    const core = client();

    const outcome = await rememberTurn(core, OPEN_GAME, report(null), "raw text", RULESET, NOW);

    expect(outcome.warning).toContain("faction");
    expect(core.commitReportImport).not.toHaveBeenCalled();
  });

  /** The chip belongs to the turn on screen, so loading one has to bring its own merges with it. */
  it("brings back who has been merged into the turn it just loaded", async () => {
    const core = client({ loadMergedReports: vi.fn().mockResolvedValue([MERGE_RECORD]) });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(outcome.merged).toEqual([MERGE_RECORD]);
    expect(core.loadMergedReports).toHaveBeenCalledWith("p.sqlite", "aug-2026", "95", 71);
  });

  /** Losing the chip is not worth losing the turn it sits beside. */
  it("still remembers the turn when the list of merges cannot be read", async () => {
    const core = client({
      loadMergedReports: vi.fn().mockRejectedValue(new Error("database is locked"))
    });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(outcome.warning).toBeNull();
    expect(outcome.merged).toEqual([]);
  });
});

/**
 * The halves [`rememberTurn`] is made of, which a batch import needs separately: thirty reports
 * mean thirty commits but only one read-back, and reading the whole remembered map back after each
 * one is the entire cost of importing a run of turns.
 */
describe("committing a turn without reading the map back", () => {
  it("commits exactly what remembering a turn commits", async () => {
    const core = client();

    const outcome = await commitTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(outcome.warning).toBeNull();
    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      "raw text",
      RULESET,
      true,
      NOW
    );
  });

  it("does not read the remembered map back", async () => {
    const core = client();

    await commitTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(core.loadRegionSightings).not.toHaveBeenCalled();
    expect(core.loadMergedReports).not.toHaveBeenCalled();
  });

  it("warns rather than failing when the turn cannot be committed", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    const outcome = await commitTurn(core, OPEN_GAME, report("95"), "raw text", RULESET, NOW);

    expect(outcome.warning).toContain("disk is full");
  });

  it("says so when the report does not name its faction", async () => {
    const core = client();

    const outcome = await commitTurn(core, OPEN_GAME, report(null), "raw text", RULESET, NOW);

    expect(outcome.warning).toContain("faction");
    expect(core.commitReportImport).not.toHaveBeenCalled();
  });
});

describe("reading a faction's memory back", () => {
  it("answers with the map and everyone merged into the turn", async () => {
    const remembered: RememberedRegion[] = [{ region: region("1:1,1", 1, 1), lastSeenTurn: 71 }];
    const core = client({
      loadRegionSightings: vi.fn().mockResolvedValue(remembered),
      loadMergedReports: vi.fn().mockResolvedValue([MERGE_RECORD])
    });

    const memory = await readMemory(core, OPEN_GAME, "95", 71, "raw text", RULESET);

    expect(memory.remembered).toEqual(remembered);
    expect(memory.merged).toEqual([MERGE_RECORD]);
    expect(memory.warning).toBeNull();
    expect(core.knownMap).toHaveBeenCalledWith("raw text", RULESET, remembered);
    expect(memory.knownMap).toBe(KNOWN_MAP);
  });

  /** The same trade remembering a turn makes: a map that will not load is a warning, not a failure. */
  it("warns rather than failing when the map cannot be read", async () => {
    const core = client({
      loadRegionSightings: vi.fn().mockRejectedValue(new Error("database is locked"))
    });

    const memory = await readMemory(core, OPEN_GAME, "95", 71, "raw text", RULESET);

    expect(memory.warning).toContain("database is locked");
    expect(memory.remembered).toEqual([]);
  });

  /**
   * The memory read and the map resolved from what is left of it can fail independently. A message
   * naming only the first would hide the second, especially when the map ends up empty too (review
   * of PR #313).
   */
  it("names both failures when the map also will not resolve after the memory read failed", async () => {
    const core = client({
      loadRegionSightings: vi.fn().mockRejectedValue(new Error("database is locked")),
      knownMap: vi.fn().mockRejectedValue(new Error("the report will not parse"))
    });

    const memory = await readMemory(core, OPEN_GAME, "95", 71, "raw text", RULESET);

    expect(memory.warning).toContain("database is locked");
    expect(memory.warning).toContain("the report will not parse");
    expect(memory.knownMap).toBeNull();
  });

  /** Nothing on screen to hang a merge chip off, so there is no turn to ask about. */
  it("asks for nobody's merges when the turn is unknown", async () => {
    const core = client();

    const memory = await readMemory(core, OPEN_GAME, "95", null, "raw text", RULESET);

    expect(memory.merged).toEqual([]);
    expect(core.loadMergedReports).not.toHaveBeenCalled();
  });
});

/**
 * `knownMapFor` resolves the map the screen draws, and never throws: the report is already
 * showable, so a map that will not resolve is a warning rather than a rejection.
 */
describe("resolving the known map", () => {
  it("resolves with the memory it is given", async () => {
    const core = client();

    const outcome = await knownMapFor(core, "raw text", RULESET, []);

    expect(core.knownMap).toHaveBeenCalledWith("raw text", RULESET, []);
    expect(outcome).toEqual({ knownMap: KNOWN_MAP, warning: null });
  });

  it("warns and draws from the report alone when the map will not resolve with the memory", async () => {
    const core = client({
      knownMap: vi
        .fn()
        .mockRejectedValueOnce(new Error("remembered region is corrupt"))
        .mockResolvedValueOnce(KNOWN_MAP)
    });

    const outcome = await knownMapFor(core, "raw text", RULESET, [
      { region: region("1:1,1", 1, 1), lastSeenTurn: 71 }
    ]);

    expect(core.knownMap).toHaveBeenNthCalledWith(2, "raw text", RULESET, []);
    expect(outcome.knownMap).toBe(KNOWN_MAP);
    expect(outcome.warning).toContain("the remembered map could not be drawn");
    expect(outcome.warning).toContain("remembered region is corrupt");
  });

  it("leaves the map empty, with a warning, when it will not resolve at all", async () => {
    const core = client({
      knownMap: vi.fn().mockRejectedValue(new Error("the report will not parse"))
    });

    const outcome = await knownMapFor(core, "raw text", RULESET, []);

    expect(outcome.knownMap).toBeNull();
    expect(outcome.warning).toContain("the map could not be drawn");
    expect(outcome.warning).toContain("the report will not parse");
  });
});

describe("merging an ally's report into the turn on screen", () => {
  it("merges under the viewer's faction and turn, not the report's", async () => {
    const core = client();

    await mergeTurn(core, OPEN_GAME, "95", 71, "the ally's report", RULESET, NOW, "the viewer's report");

    expect(core.mergeReport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      71,
      "the ally's report",
      RULESET,
      NOW
    );
    expect(core.loadRegionSightings).toHaveBeenCalledWith("p.sqlite", "aug-2026", "95");
  });

  it("reads back the grown map and everyone who has been merged into it", async () => {
    const remembered: RememberedRegion[] = [
      { region: region("1:9,51", 9, 51), lastSeenTurn: 71 },
      { region: region("1:9,53", 9, 53), lastSeenTurn: 71 }
    ];
    const core = client({
      loadRegionSightings: vi.fn().mockResolvedValue(remembered),
      loadMergedReports: vi.fn().mockResolvedValue([MERGE_RECORD])
    });

    const outcome = await mergeTurn(
      core,
      OPEN_GAME,
      "95",
      71,
      "the ally's report",
      RULESET,
      NOW,
      "the viewer's report"
    );

    expect(outcome.remembered).toHaveLength(2);
    expect(outcome.merged).toEqual([MERGE_RECORD]);
    expect(outcome.result).toEqual(MERGE_RESULT);
    expect(outcome.knownMap).toBe(KNOWN_MAP);
  });

  /** The known map is resolved against the report on screen, not the ally's text being merged. */
  it("resolves the known map against the viewer's report, not the ally's", async () => {
    const core = client();

    await mergeTurn(core, OPEN_GAME, "95", 71, "the ally's report", RULESET, NOW, "the viewer's report");

    expect(core.knownMap).toHaveBeenCalledWith("the viewer's report", RULESET, []);
  });

  /**
   * Unlike remembering a turn, this fails loudly. There is no report to salvage - nothing else
   * happened on this path - and a status line saying the merge worked over a database that was
   * never written would be a lie.
   */
  it("fails rather than warning when the merge is refused", async () => {
    const core = client({
      mergeReport: vi
        .fn()
        .mockRejectedValue(new Error("a report from turn 2 cannot be merged into turn 71"))
    });

    await expect(
      mergeTurn(core, OPEN_GAME, "95", 71, "an older report", RULESET, NOW, "the viewer's report")
    ).rejects.toThrow("cannot be merged into turn 71");
  });
});

describe("reopening the turn the player was last in", () => {
  const STORED_TURN = {
    key: { gameId: "aug-2026", factionId: "95", turnNumber: 71 },
    rawReport: "raw text of turn 71",
    parseResult: {}
  };

  function restoring(overrides: Partial<CoreClient> = {}): CoreClient {
    return client({
      loadLatestImportedTurn: vi.fn().mockResolvedValue(STORED_TURN),
      loadOrderDraft: vi.fn().mockResolvedValue(null),
      ...overrides
    });
  }

  it("brings back the turn, the map and the orders", async () => {
    const remembered: RememberedRegion[] = [
      { region: region("1:7,53", 7, 53), lastSeenTurn: 71 }
    ];
    const core = restoring({
      loadRegionSightings: vi.fn().mockResolvedValue(remembered),
      loadOrderDraft: vi.fn().mockResolvedValue({
        key: { gameId: "aug-2026", factionId: "95", turnNumber: 71 },
        orderText: "@work",
        updatedAt: NOW
      })
    });
    const parse = vi.fn().mockResolvedValue(report("95"));

    const restored = await restoreLatestTurn(core, OPEN_GAME, parse, RULESET);

    expect(parse).toHaveBeenCalledWith("raw text of turn 71");
    expect(core.knownMap).toHaveBeenCalledWith("raw text of turn 71", RULESET, remembered);
    expect(restored).toMatchObject({
      factionId: "95",
      turnNumber: 71,
      rawReport: "raw text of turn 71",
      orders: "@work",
      ordersSavedAt: NOW,
      warning: null
    });
    expect(restored?.remembered).toHaveLength(1);
  });

  /**
   * The turn is already stored. Re-committing would move its `updated_at`, and that column is what
   * decides which turn reopens - so merely opening a game would look exactly like working in it.
   */
  it("does not commit the turn it just read", async () => {
    const core = restoring();

    await restoreLatestTurn(core, OPEN_GAME, vi.fn().mockResolvedValue(report("95")), RULESET);

    expect(core.commitReportImport).not.toHaveBeenCalled();
  });

  it("has nothing to restore in a game that holds no imports", async () => {
    const core = restoring({ loadLatestImportedTurn: vi.fn().mockResolvedValue(null) });
    const parse = vi.fn();

    expect(await restoreLatestTurn(core, OPEN_GAME, parse, RULESET)).toBeNull();
    // A game just created, not a failure: nothing is parsed and nothing is complained about.
    expect(parse).not.toHaveBeenCalled();
  });

  /**
   * The report and the map are read separately and either can fail alone. A turn that parsed
   * perfectly well must still be shown when the accumulated map will not load.
   */
  it("still restores the turn when the remembered map cannot be read", async () => {
    const core = restoring({
      loadRegionSightings: vi.fn().mockRejectedValue(new Error("database is locked"))
    });

    const restored = await restoreLatestTurn(
      core,
      OPEN_GAME,
      vi.fn().mockResolvedValue(report("95")),
      RULESET
    );

    expect(restored?.turnNumber).toBe(71);
    expect(restored?.remembered).toEqual([]);
    expect(restored?.warning).toContain("database is locked");
  });

  /** A reopened game has to say whose eyes it is showing, or the extra hexes have no explanation. */
  it("brings back who was merged into the turn it reopens", async () => {
    const core = restoring({ loadMergedReports: vi.fn().mockResolvedValue([MERGE_RECORD]) });

    const restored = await restoreLatestTurn(
      core,
      OPEN_GAME,
      vi.fn().mockResolvedValue(report("95")),
      RULESET
    );

    expect(restored?.merged).toEqual([MERGE_RECORD]);
    expect(core.loadMergedReports).toHaveBeenCalledWith("p.sqlite", "aug-2026", "95", 71);
  });

  it("still reopens the turn when the list of merges cannot be read", async () => {
    const core = restoring({
      loadMergedReports: vi.fn().mockRejectedValue(new Error("database is locked"))
    });

    const restored = await restoreLatestTurn(
      core,
      OPEN_GAME,
      vi.fn().mockResolvedValue(report("95")),
      RULESET
    );

    expect(restored?.turnNumber).toBe(71);
    expect(restored?.merged).toEqual([]);
    expect(restored?.warning).toBeNull();
  });

  it("falls back to the stored report's own template when nothing was written", async () => {
    const core = restoring();
    const withTemplate = {
      ...report("95"),
      ordersTemplate: { text: "#atlantis 95 pass", factionId: "95", units: [] }
    };

    const restored = await restoreLatestTurn(core, OPEN_GAME, vi.fn().mockResolvedValue(withTemplate), RULESET);

    expect(restored?.orders).toBe("#atlantis 95 pass");
    expect(restored?.ordersSavedAt).toBeNull();
  });
});
