import type { GameManifest, OpenedGame } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import type { GameClient } from "./gameActions";
import { changeRuleset, createGame, deleteGame, importGameBackup, openGame } from "./gameActions";

// A second ruleset this build "ships" only for this test, so `changeRuleset`'s actual move can be
// exercised - `rulesets.ts` ships exactly one ruleset otherwise, which cannot tell "known and
// different" apart from "same".
vi.mock("./rulesets", () => ({
  rulesetById: (rulesetId: string) =>
    ["neworigins", "otherworld"].includes(rulesetId) ? { id: rulesetId, label: rulesetId, url: "/x" } : null
}));

const NOW = "2026-08-09T18:00:00Z";

function manifest(gameId: string, lastOpenedAt: string, rulesetId = "neworigins"): GameManifest {
  return {
    manifestVersion: 1,
    metadata: { gameId, gameName: gameId, rulesetId },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt
  };
}

function opened(gameId: string, rulesetId = "neworigins"): OpenedGame {
  return {
    gameFilePath: `/games/${gameId}.json`,
    databasePath: `/games/${gameId}.sqlite`,
    schemaVersion: 1,
    manifest: manifest(gameId, NOW, rulesetId)
  };
}

/** A fake `GameClient`; only the methods a test exercises need a real implementation. */
function fakeClient(overrides: Partial<GameClient> = {}): GameClient {
  return {
    listGames: vi.fn().mockResolvedValue([]),
    openGame: vi.fn(),
    createGame: vi.fn(),
    deleteGame: vi.fn().mockResolvedValue(undefined),
    exportGame: vi.fn(),
    importGame: vi.fn(),
    setGameRuleset: vi.fn(),
    ...overrides
  };
}

describe("opening a game", () => {
  it("opens the game, then refreshes the list", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      openGame: vi.fn().mockImplementation(async (gameId: string) => {
        calls.push("openGame");
        return opened(gameId);
      }),
      listGames: vi.fn().mockImplementation(async () => {
        calls.push("listGames");
        return [manifest("g1", NOW)];
      })
    });

    const result = await openGame(client, "g1", NOW);

    expect(result.opened.manifest.metadata.gameId).toBe("g1");
    expect(result.games).toEqual([manifest("g1", NOW)]);
    expect(calls).toEqual(["openGame", "listGames"]);
  });
});

describe("creating a game", () => {
  it("hands the client a manifest built from the arguments", async () => {
    const client = fakeClient({
      createGame: vi.fn().mockImplementation(async (m: GameManifest) => ({
        gameFilePath: "/games/x.json",
        databasePath: "/games/x.sqlite",
        schemaVersion: 1,
        manifest: m
      })),
      listGames: vi.fn().mockResolvedValue([])
    });

    const result = await createGame(client, "My Game", "neworigins", NOW);

    expect(client.createGame).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(client.createGame).mock.calls[0][0];
    expect(passed.metadata.gameName).toBe("My Game");
    expect(passed.metadata.rulesetId).toBe("neworigins");
    expect(passed.createdAt).toBe(NOW);
    expect(result.opened.manifest.metadata.gameName).toBe("My Game");
    expect(result.games).toEqual([]);
  });
});

describe("importing a game backup", () => {
  it("passes the backup JSON through and returns the opened game and the refreshed list", async () => {
    const client = fakeClient({
      importGame: vi.fn().mockResolvedValue(opened("imported")),
      listGames: vi.fn().mockResolvedValue([manifest("imported", NOW)])
    });

    const result = await importGameBackup(client, "{\"backup\":true}", NOW);

    expect(client.importGame).toHaveBeenCalledWith("{\"backup\":true}", NOW);
    expect(result.opened.manifest.metadata.gameId).toBe("imported");
    expect(result.games).toEqual([manifest("imported", NOW)]);
  });
});

describe("deleting a game", () => {
  it("discards the open draft before deleting, when the deleted game is the open one", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      deleteGame: vi.fn().mockImplementation(async () => {
        calls.push("deleteGame");
      }),
      listGames: vi.fn().mockResolvedValue([manifest("survivor", "2026-08-05T12:00:00Z")]),
      openGame: vi.fn().mockImplementation(async (gameId: string) => {
        calls.push("openGame");
        return opened(gameId);
      })
    });
    const discardOpenDraft = vi.fn(() => {
      calls.push("discard");
    });

    const result = await deleteGame(client, "doomed", "doomed", NOW, discardOpenDraft);

    expect(calls).toEqual(["discard", "deleteGame", "openGame"]);
    expect(result.closedOpenGame).toBe(true);
    expect(result.opened?.manifest.metadata.gameId).toBe("survivor");
    expect(result.games).toEqual([manifest("survivor", "2026-08-05T12:00:00Z")]);
  });

  it("closes the workspace when the deleted game was the last one", async () => {
    const client = fakeClient({
      listGames: vi.fn().mockResolvedValue([])
    });
    const discardOpenDraft = vi.fn();

    const result = await deleteGame(client, "only", "only", NOW, discardOpenDraft);

    expect(discardOpenDraft).toHaveBeenCalledTimes(1);
    expect(result.closedOpenGame).toBe(true);
    expect(result.opened).toBeNull();
    expect(result.games).toEqual([]);
  });

  it("never discards or reopens when some other game was deleted", async () => {
    const client = fakeClient({
      listGames: vi.fn().mockResolvedValue([manifest("other", NOW)])
    });
    const discardOpenDraft = vi.fn();

    const result = await deleteGame(client, "gone", "open-one", NOW, discardOpenDraft);

    expect(discardOpenDraft).not.toHaveBeenCalled();
    expect(client.openGame).not.toHaveBeenCalled();
    expect(result.closedOpenGame).toBe(false);
    expect(result.opened).toBeNull();
    expect(result.games).toEqual([manifest("other", NOW)]);
  });
});

describe("changing a game's ruleset", () => {
  it("does nothing when the game is already on that ruleset", async () => {
    const client = fakeClient();
    const game = opened("g1", "neworigins");

    const result = await changeRuleset(client, game, "neworigins");

    expect(result).toBeNull();
    expect(client.setGameRuleset).not.toHaveBeenCalled();
  });

  it("refuses a ruleset this build does not ship, without touching the client", async () => {
    const client = fakeClient();
    const game = opened("g1", "neworigins");

    await expect(changeRuleset(client, game, "nope")).rejects.toThrow("unknown ruleset: nope");
    expect(client.setGameRuleset).not.toHaveBeenCalled();
  });

  it("moves the game to a known, different ruleset and refreshes the list", async () => {
    const movedManifest = manifest("g1", NOW, "otherworld");
    const client = fakeClient({
      setGameRuleset: vi.fn().mockResolvedValue(movedManifest),
      listGames: vi.fn().mockResolvedValue([movedManifest])
    });
    const game = opened("g1", "neworigins");

    const result = await changeRuleset(client, game, "otherworld");

    expect(client.setGameRuleset).toHaveBeenCalledWith("g1", "otherworld");
    expect(result?.manifest).toEqual(movedManifest);
    expect(result?.games).toEqual([movedManifest]);
  });
});
