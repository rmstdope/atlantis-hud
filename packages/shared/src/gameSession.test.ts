import type { GameManifest } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  gameAfterDelete,
  gameNameOf,
  newGameManifest,
  newestGame,
  openNewestGame,
  rulesetUrlFor
} from "./gameSession";

function game(gameId: string, lastOpenedAt: string): GameManifest {
  return {
    manifestVersion: 1,
    metadata: { gameId, gameName: gameId, rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt
  };
}

describe("choosing which game to open", () => {
  it("picks the one opened most recently, so a launch lands where the player left off", () => {
    const chosen = newestGame([
      game("older", "2026-08-01T09:00:00Z"),
      game("newest", "2026-08-09T18:00:00Z"),
      game("middle", "2026-08-05T12:00:00Z")
    ]);

    expect(chosen?.metadata.gameId).toBe("newest");
  });

  it("has nothing to pick when there are no games", () => {
    expect(newestGame([])).toBeNull();
  });

  /** Deleting the open game must land the player in another one, not in an empty workspace. */
  it("falls back to the next most recent when a game is deleted", () => {
    const games = [
      game("doomed", "2026-08-09T18:00:00Z"),
      game("survivor", "2026-08-05T12:00:00Z")
    ];

    expect(gameAfterDelete(games, "doomed")?.metadata.gameId).toBe("survivor");
  });

  it("has nowhere to fall back to when the deleted game was the only one", () => {
    expect(gameAfterDelete([game("only", "2026-08-09T18:00:00Z")], "only")).toBeNull();
  });
});

describe("creating a game", () => {
  it("keeps the name the player typed, without its accidental whitespace", () => {
    const manifest = newGameManifest("  NewOrigins Aug 2026  ", "neworigins", NOW, "abc");

    expect(manifest.metadata.gameName).toBe("NewOrigins Aug 2026");
    expect(manifest.metadata.gameId).toBe("abc");
    expect(manifest.metadata.rulesetId).toBe("neworigins");
    expect(manifest.createdAt).toBe(NOW);
    expect(manifest.lastOpenedAt).toBe(NOW);
  });

  it("refuses a name that is only whitespace, rather than creating an unnameable game", () => {
    expect(() => newGameManifest("   ", "neworigins", NOW, "abc")).toThrow(/name/u);
  });

  it("refuses a ruleset the app does not ship, rather than falling back to one that is wrong", () => {
    expect(() => newGameManifest("A game", "atlantis-classic", NOW, "abc")).toThrow(/ruleset/u);
  });

  it("records the map the player stated", () => {
    const manifest = newGameManifest("A game", "neworigins", NOW, "abc", {
      width: 64,
      height: 64,
      wrapX: true,
      wrapY: true
    });

    expect(manifest.metadata.map).toEqual({ width: 64, height: 64, wrapX: true, wrapY: true });
  });

  it("omits the map entirely when nothing was stated, rather than writing the default in", () => {
    // Absence is what tells Settings the values are only assumed, and it is not recoverable
    // afterwards: a default written in here would be indistinguishable from a player's answer.
    const manifest = newGameManifest("A game", "neworigins", NOW, "abc");

    expect("map" in manifest.metadata).toBe(false);
  });

  it("does not bump the manifest version, because an optional field is the migration", () => {
    expect(newGameManifest("A game", "neworigins", NOW, "abc").manifestVersion).toBe(1);
  });
});

describe("the rule a game's name must obey", () => {
  it("trims accidental whitespace around a valid name", () => {
    expect(gameNameOf("  Binding of the North  ")).toBe("Binding of the North");
  });

  it("refuses a name that is only whitespace, with the words creation uses", () => {
    expect(() => gameNameOf("   ")).toThrow("a game needs a name");
  });

  it("refuses an empty name", () => {
    expect(() => gameNameOf("")).toThrow("a game needs a name");
  });
});

describe("finding a game's ruleset", () => {
  it("knows where NewOrigins is served from", () => {
    expect(rulesetUrlFor("neworigins")).toBe("/ruleset.json");
  });

  /**
   * A game recorded against a ruleset this build does not have is a real problem, and the
   * planner's own contract says movement values fail loudly rather than falling back.
   */
  it("says so when a game names a ruleset this build does not have", () => {
    expect(() => rulesetUrlFor("atlantis-classic")).toThrow(/atlantis-classic/u);
  });
});

const NOW = "2026-08-09T18:00:00Z";

describe("opening the newest game on startup", () => {
  it("opens the most recently opened game and hands it back", async () => {
    const openGame = vi.fn().mockResolvedValue({ databasePath: "db" });
    const client = {
      listGames: vi.fn().mockResolvedValue([
        game("older", "2026-08-01T09:00:00Z"),
        game("newest", "2026-08-09T18:00:00Z")
      ]),
      openGame
    } as unknown as Parameters<typeof openNewestGame>[0];

    const opened = await openNewestGame(client, NOW);

    expect(opened).toEqual({ databasePath: "db" });
    expect(openGame).toHaveBeenCalledWith("newest", NOW);
  });

  it("opens nothing when the player has no games yet", async () => {
    const client = {
      listGames: vi.fn().mockResolvedValue([]),
      openGame: vi.fn()
    } as unknown as Parameters<typeof openNewestGame>[0];

    expect(await openNewestGame(client, NOW)).toBeNull();
    expect(client.openGame).not.toHaveBeenCalled();
  });
});
