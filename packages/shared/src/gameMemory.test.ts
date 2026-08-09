import type {
  CoreClient,
  OpenedGame,
  ParsedReport,
  RememberedRegion
} from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { rememberTurn, restoreLatestTurn, toStoredRegions } from "./gameMemory";

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
      events: []
    },
    regions: [],
    ordersTemplate: null
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    ...overrides
  } as unknown as CoreClient;
}

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

describe("remembering a turn", () => {
  it("commits the report and reads back everything the faction has seen", async () => {
    const remembered: RememberedRegion[] = [
      { region: region("1:1,1", 1, 1), lastSeenTurn: 40 },
      { region: region("1:2,2", 2, 2), lastSeenTurn: 71 }
    ];
    const core = client({ loadRegionSightings: vi.fn().mockResolvedValue(remembered) });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", NOW);

    expect(outcome.warning).toBeNull();
    expect(outcome.remembered).toHaveLength(2);
    expect(outcome.remembered[0].lastSeenTurn).toBe(40);
    expect(outcome.remembered[0].region.regionId).toBe("1:1,1");
    // The open game decides where the turn lands, not the faction the report happens to name.
    // The clock comes from the caller so both platforms stamp the same format.
    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "aug-2026",
      "95",
      "raw text",
      true,
      NOW
    );
  });

  /**
   * A report that parsed perfectly well must still be usable when the database will not cooperate.
   * Refusing to show it would trade something that works for something that does not.
   */
  it("warns rather than failing when the turn cannot be remembered", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    const outcome = await rememberTurn(core, OPEN_GAME, report("95"), "raw text", NOW);

    expect(outcome.warning).toContain("disk is full");
    expect(outcome.remembered).toEqual([]);
  });

  it("says so when the report does not name its faction", async () => {
    const core = client();

    const outcome = await rememberTurn(core, OPEN_GAME, report(null), "raw text", NOW);

    expect(outcome.warning).toContain("faction");
    expect(core.commitReportImport).not.toHaveBeenCalled();
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

    const restored = await restoreLatestTurn(core, OPEN_GAME, parse);

    expect(parse).toHaveBeenCalledWith("raw text of turn 71");
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

    await restoreLatestTurn(core, OPEN_GAME, vi.fn().mockResolvedValue(report("95")));

    expect(core.commitReportImport).not.toHaveBeenCalled();
  });

  it("has nothing to restore in a game that holds no imports", async () => {
    const core = restoring({ loadLatestImportedTurn: vi.fn().mockResolvedValue(null) });
    const parse = vi.fn();

    expect(await restoreLatestTurn(core, OPEN_GAME, parse)).toBeNull();
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
      vi.fn().mockResolvedValue(report("95"))
    );

    expect(restored?.turnNumber).toBe(71);
    expect(restored?.remembered).toEqual([]);
    expect(restored?.warning).toContain("database is locked");
  });

  it("falls back to the stored report's own template when nothing was written", async () => {
    const core = restoring();
    const withTemplate = {
      ...report("95"),
      ordersTemplate: { text: "#atlantis 95 pass", factionId: "95", units: [] }
    };

    const restored = await restoreLatestTurn(core, OPEN_GAME, vi.fn().mockResolvedValue(withTemplate));

    expect(restored?.orders).toBe("#atlantis 95 pass");
    expect(restored?.ordersSavedAt).toBeNull();
  });
});

describe("handing remembered regions to the map", () => {
  it("keeps the turn each was seen in, which is what staleness is drawn from", () => {
    const stored = toStoredRegions([{ region: region("1:7,53", 7, 53), lastSeenTurn: 63 }]);

    expect(stored).toEqual([
      {
        regionId: "1:7,53",
        coordinate: { x: 7, y: 53, z: 1 },
        terrain: "plain",
        province: "Nowhere",
        label: "plain (7,53) in Nowhere",
        lastSeenTurn: 63,
        region: region("1:7,53", 7, 53)
      }
    ]);
  });
});
