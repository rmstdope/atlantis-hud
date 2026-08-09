import type { CoreClient, ParsedReport, RememberedRegion } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  openOrCreateGame,
  gamePathFor,
  rememberTurn,
  toStoredRegions
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
      events: []
    },
    regions: [],
    ordersTemplate: null
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    openGame: vi.fn().mockRejectedValue(new Error("no such game")),
    createGame: vi.fn().mockResolvedValue({
      gameFilePath: "p.json",
      databasePath: "p.sqlite",
      schemaVersion: 4,
      manifest: { manifestVersion: 1, metadata: { gameId: "faction-95", gameName: "Borg TNG" }, reportSources: [] }
    }),
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    ...overrides
  } as unknown as CoreClient;
}

describe("finding a faction's game", () => {
  it("names the game after the faction, so nobody has to choose a path", () => {
    expect(gamePathFor("95")).toContain("faction-95");
  });

  it("opens the game when it is already there", async () => {
    const openGame = vi.fn().mockResolvedValue({
      gameFilePath: "existing.json",
      databasePath: "existing.sqlite",
      schemaVersion: 4,
      manifest: { manifestVersion: 1, metadata: { gameId: "faction-95", gameName: "x" }, reportSources: [] }
    });
    const core = client({ openGame });

    const game = await openOrCreateGame(core, "95", "Borg TNG");

    expect(game.databasePath).toBe("existing.sqlite");
    expect(core.createGame).not.toHaveBeenCalled();
  });

  /** The first import of a faction has no game yet. That is ordinary, not a failure. */
  it("creates the game the first time, without complaining", async () => {
    const core = client();

    const game = await openOrCreateGame(core, "95", "Borg TNG");

    expect(game.databasePath).toBe("p.sqlite");
    expect(core.createGame).toHaveBeenCalledOnce();
  });
});

describe("remembering a turn", () => {
  it("commits the report and reads back everything the faction has seen", async () => {
    const remembered: RememberedRegion[] = [
      { region: region("1:1,1", 1, 1), lastSeenTurn: 40 },
      { region: region("1:2,2", 2, 2), lastSeenTurn: 71 }
    ];
    const core = client({ loadRegionSightings: vi.fn().mockResolvedValue(remembered) });

    const outcome = await rememberTurn(core, report("95"), "raw text");

    expect(outcome.warning).toBeNull();
    expect(outcome.remembered).toHaveLength(2);
    expect(outcome.remembered[0].lastSeenTurn).toBe(40);
    expect(outcome.remembered[0].region.regionId).toBe("1:1,1");
    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "faction-95",
      "95",
      "raw text",
      true
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

    const outcome = await rememberTurn(core, report("95"), "raw text");

    expect(outcome.warning).toContain("disk is full");
    expect(outcome.remembered).toEqual([]);
    expect(outcome.game).toBeNull();
  });

  it("says so when the report does not name its faction", async () => {
    const core = client();

    const outcome = await rememberTurn(core, report(null), "raw text");

    expect(outcome.warning).toContain("faction");
    expect(core.commitReportImport).not.toHaveBeenCalled();
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
