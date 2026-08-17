import type { GameManifest, OpenedGame } from "@atlantis/core-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameClient } from "./gameActions";
import {
  changeRuleset,
  createGame,
  deleteGame,
  importGameBackup,
  importGameBackupAsCopy,
  openGame,
  renameGame,
  replaceGameWithBackup,
  resetGame
} from "./gameActions";
import { loadSavedView, saveMapView } from "./workspace/mapViewportStorage";

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
    setGameName: vi.fn(),
    resetGame: vi.fn().mockImplementation(async (gameId: string) => opened(gameId)),
    ...overrides
  };
}

/**
 * A localStorage stand-in on the global, so `resetGame`'s call into `forgetMapView` - which reaches
 * for the real one - has something to reach. These tests run without a DOM, where `localStorage` is
 * undefined and every saved view silently vanishes, which would make the forget assertion vacuous.
 */
function stubGlobalStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key)
  });
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

function alphaBackupJson(): string {
  return JSON.stringify({
    format: "atlantis-hud-game-backup",
    version: 1,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId: "alpha", gameName: "Alpha game", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: NOW
    },
    exportedAt: NOW,
    importedTurns: [],
    orderDrafts: [],
    regionSightings: [],
    mergedReports: [],
    hexNotes: []
  });
}

describe("importing a game backup as a copy", () => {
  it("imports under a fresh id with the imported suffix, and returns the opened game and the refreshed list", async () => {
    const client = fakeClient({
      importGame: vi.fn().mockResolvedValue(opened("copy-id")),
      listGames: vi.fn().mockResolvedValue([manifest("copy-id", NOW)])
    });

    const result = await importGameBackupAsCopy(client, alphaBackupJson(), NOW);

    expect(client.importGame).toHaveBeenCalledTimes(1);
    const [passedJson, passedNow] = vi.mocked(client.importGame).mock.calls[0];
    const passed = JSON.parse(passedJson as string);
    expect(passed.manifest.metadata.gameId).not.toBe("alpha");
    expect(passed.manifest.metadata.gameName).toBe("Alpha game (imported)");
    expect(passedNow).toBe(NOW);
    expect(result.opened.manifest.metadata.gameId).toBe("copy-id");
    expect(result.games).toEqual([manifest("copy-id", NOW)]);
  });
});

describe("replacing a game with its backup", () => {
  it("when the game named in the backup is the open one: discards the draft, snapshots, deletes, imports, in that order", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      exportGame: vi.fn().mockImplementation(async (gameId: string) => {
        calls.push(`exportGame(${gameId})`);
        return "snapshot-json";
      }),
      deleteGame: vi.fn().mockImplementation(async (gameId: string) => {
        calls.push(`deleteGame(${gameId})`);
      }),
      importGame: vi.fn().mockImplementation(async (json: string) => {
        calls.push(`importGame(${json})`);
        return opened("alpha");
      }),
      listGames: vi.fn().mockImplementation(async () => {
        calls.push("listGames");
        return [manifest("alpha", NOW)];
      })
    });
    const flush = vi.fn(async () => {
      calls.push("flush");
    });
    const discardOpenDraft = vi.fn(() => {
      calls.push("discardOpenDraft");
    });

    const result = await replaceGameWithBackup(client, alphaBackupJson(), "alpha", NOW, {
      flush,
      discardOpenDraft
    });

    expect(discardOpenDraft).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "discardOpenDraft",
      "exportGame(alpha)",
      "deleteGame(alpha)",
      `importGame(${alphaBackupJson()})`,
      "listGames"
    ]);
    expect(result.opened.manifest.metadata.gameId).toBe("alpha");
    expect(result.games).toEqual([manifest("alpha", NOW)]);
  });

  it("when the game named in the backup is some other game: flushes rather than discarding", async () => {
    const client = fakeClient({
      exportGame: vi.fn().mockResolvedValue("snapshot-json"),
      deleteGame: vi.fn().mockResolvedValue(undefined),
      importGame: vi.fn().mockResolvedValue(opened("alpha")),
      listGames: vi.fn().mockResolvedValue([manifest("alpha", NOW)])
    });
    const flush = vi.fn(async () => {});
    const discardOpenDraft = vi.fn();

    await replaceGameWithBackup(client, alphaBackupJson(), "beta", NOW, { flush, discardOpenDraft });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(discardOpenDraft).not.toHaveBeenCalled();
    expect(client.exportGame).toHaveBeenCalledWith("alpha", NOW);
    expect(client.deleteGame).toHaveBeenCalledWith("alpha");
  });

  it("restores the snapshot and rethrows when the import of the backup itself fails", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      exportGame: vi.fn().mockImplementation(async () => {
        calls.push("exportGame");
        return "snapshot-json";
      }),
      deleteGame: vi.fn().mockImplementation(async () => {
        calls.push("deleteGame");
      }),
      importGame: vi
        .fn()
        .mockImplementationOnce(async () => {
          calls.push("importGame(backup)");
          throw new Error("core refused the backup");
        })
        .mockImplementationOnce(async (json: string) => {
          calls.push(`importGame(${json})`);
          return opened("alpha");
        })
    });
    const flush = vi.fn(async () => {});
    const discardOpenDraft = vi.fn();

    await expect(
      replaceGameWithBackup(client, alphaBackupJson(), "beta", NOW, { flush, discardOpenDraft })
    ).rejects.toThrow("core refused the backup");

    expect(calls).toEqual(["exportGame", "deleteGame", "importGame(backup)", "importGame(snapshot-json)"]);
  });

  it("when the backup does not name a known game (backupGameIdentity is null): imports as-is without exporting or deleting anything", async () => {
    const client = fakeClient({
      importGame: vi.fn().mockResolvedValue(opened("whatever")),
      listGames: vi.fn().mockResolvedValue([manifest("whatever", NOW)])
    });
    const flush = vi.fn(async () => {});
    const discardOpenDraft = vi.fn();

    const result = await replaceGameWithBackup(client, "not json", "beta", NOW, {
      flush,
      discardOpenDraft
    });

    expect(client.exportGame).not.toHaveBeenCalled();
    expect(client.deleteGame).not.toHaveBeenCalled();
    expect(client.importGame).toHaveBeenCalledWith("not json", NOW);
    expect(result.opened.manifest.metadata.gameId).toBe("whatever");
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

describe("resetting a game", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("empties the game and refreshes the list", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      resetGame: vi.fn().mockImplementation(async (gameId: string) => {
        calls.push("resetGame");
        return opened(gameId);
      }),
      listGames: vi.fn().mockImplementation(async () => {
        calls.push("listGames");
        return [manifest("kept", NOW)];
      })
    });

    const result = await resetGame(client, "kept", null, NOW, vi.fn());

    expect(client.resetGame).toHaveBeenCalledWith("kept", NOW);
    expect(calls).toEqual(["resetGame", "listGames"]);
    expect(result.opened.manifest.metadata.gameId).toBe("kept");
    expect(result.games).toEqual([manifest("kept", NOW)]);
    expect(result.wasOpenGame).toBe(false);
  });

  it("discards the open draft when the game being emptied is the open one", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      resetGame: vi.fn().mockImplementation(async (gameId: string) => {
        calls.push("resetGame");
        return opened(gameId);
      })
    });
    const discardOpenDraft = vi.fn(() => {
      calls.push("discard");
    });

    const result = await resetGame(client, "open-one", "open-one", NOW, discardOpenDraft);

    expect(calls).toEqual(["discard", "resetGame"]);
    expect(result.wasOpenGame).toBe(true);
  });

  it("leaves another game's draft alone", async () => {
    const client = fakeClient();
    const discardOpenDraft = vi.fn();

    const result = await resetGame(client, "other", "open-one", NOW, discardOpenDraft);

    expect(discardOpenDraft).not.toHaveBeenCalled();
    expect(result.wasOpenGame).toBe(false);
  });

  it("forgets the emptied game's saved view", async () => {
    stubGlobalStorage();
    saveMapView("emptied", { viewport: { tx: 1, ty: 2, step: 0 }, level: 1, regionId: null });
    saveMapView("untouched", { viewport: { tx: 3, ty: 4, step: 0 }, level: 1, regionId: null });
    // The control: without this the assertion below could pass against a view that was never saved.
    expect(loadSavedView("emptied")).not.toBeNull();

    await resetGame(fakeClient(), "emptied", null, NOW, vi.fn());

    expect(loadSavedView("emptied")).toBeNull();
    expect(loadSavedView("untouched")).not.toBeNull();
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

describe("renaming a game", () => {
  it("calls setGameName with the game's id and the trimmed name, and refreshes the list", async () => {
    const renamedManifest = { ...manifest("g1", NOW), metadata: { gameId: "g1", gameName: "Binding of the North", rulesetId: "neworigins" } };
    const client = fakeClient({
      setGameName: vi.fn().mockResolvedValue(renamedManifest),
      listGames: vi.fn().mockResolvedValue([renamedManifest])
    });
    const game = opened("g1");

    const result = await renameGame(client, game, "  Binding of the North  ");

    expect(client.setGameName).toHaveBeenCalledWith("g1", "Binding of the North");
    expect(result.manifest).toEqual(renamedManifest);
    expect(result.games).toEqual([renamedManifest]);
  });

  it("rejects an empty name and calls nothing", async () => {
    const client = fakeClient();
    const game = opened("g1");

    await expect(renameGame(client, game, "   ")).rejects.toThrow("a game needs a name");
    expect(client.setGameName).not.toHaveBeenCalled();
  });
});
