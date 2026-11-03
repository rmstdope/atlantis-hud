import { describe, expect, it, vi } from "vitest";
import {
  failedLine,
  isOldAddress,
  savedLine,
  saveAllGames,
  saveAllGamesListedBy,
  savingLabel,
  UNREAD_GAMES
} from "./oldAddress";

describe("isOldAddress", () => {
  it("is true only for the old web address", () => {
    expect(isOldAddress("atlantis-hud.kurelid.se")).toBe(true);
    expect(isOldAddress("Atlantis-HUD.Kurelid.SE")).toBe(true);
  });

  it("is false everywhere else: the new address, local development, the desktop app, look-alikes", () => {
    for (const host of [
      "atlantis-hud.rmstdope.eu",
      "localhost",
      "127.0.0.1",
      "tauri.localhost",
      "",
      "kurelid.se",
      "www.atlantis-hud.kurelid.se",
      "atlantis-hud.kurelid.se.example.com"
    ]) {
      expect(isOldAddress(host), host).toBe(false);
    }
  });
});

describe("the words", () => {
  it("says how far the saving has got", () => {
    expect(savingLabel(2, 3)).toBe("Saving… 2 of 3");
  });

  it("lists every saved file, and says one game in the singular", () => {
    expect(savedLine(["Nexus.json", "Ered Luin.json", "Test.json"])).toBe(
      "Saved 3 games: Nexus.json, Ered Luin.json, Test.json"
    );
    expect(savedLine(["Nexus.json"])).toBe("Saved 1 game: Nexus.json");
  });

  it("names a game that could not be saved and says how to try again", () => {
    expect(failedLine("Ered Luin")).toBe("Couldn’t save Ered Luin. Press the button to try again.");
  });
});

describe("saveAllGames", () => {
  const games = [
    { gameId: "a", gameName: "Nexus" },
    { gameId: "b", gameName: "Ered Luin" },
    { gameId: "c", gameName: "Test" }
  ];

  it("saves one game at a time, in order, reporting progress, and lists the files written", async () => {
    const order: string[] = [];
    let inFlight = 0;
    const saveOne = vi.fn(async (game: { gameId: string; gameName: string }) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      order.push(game.gameId);
      await Promise.resolve();
      inFlight -= 1;
      return "";
    });
    const progress: Array<[number, number]> = [];

    const outcome = await saveAllGames(games, saveOne, (done, total) => progress.push([done, total]));

    expect(order).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3]
    ]);
    expect(outcome).toEqual({
      saved: [
        "Nexus.atlantis-hud-game.json",
        "Ered Luin.atlantis-hud-game.json",
        "Test.atlantis-hud-game.json"
      ],
      failed: []
    });
  });

  it("counts a refused or cancelled save as failed and carries on with the rest", async () => {
    const saveOne = async (game: { gameId: string }) => {
      if (game.gameId === "a") {
        throw new Error("disk full");
      }
      return game.gameId === "b" ? null : "";
    };

    const outcome = await saveAllGames(games, saveOne, () => {});

    expect(outcome).toEqual({ saved: ["Test.atlantis-hud-game.json"], failed: ["Nexus", "Ered Luin"] });
  });

  it("starts the progress at 1 of the total as the first game begins", async () => {
    const progress: Array<[number, number]> = [];
    let firstSeen: Array<[number, number]> | null = null;
    await saveAllGames(
      games.slice(0, 1),
      async () => {
        firstSeen = [...progress];
        return "";
      },
      (done, total) => progress.push([done, total])
    );
    expect(firstSeen).toEqual([[1, 1]]);
  });
});

describe("saveAllGamesListedBy", () => {
  it("reads the games at the press and saves each of them", async () => {
    const outcome = await saveAllGamesListedBy(
      async () => [{ gameId: "a", gameName: "Nexus" }],
      async () => "",
      () => {}
    );
    expect(outcome).toEqual({ saved: ["Nexus.atlantis-hud-game.json"], failed: [] });
  });

  it("when the games still cannot be read, says so as one failure to try again", async () => {
    const outcome = await saveAllGamesListedBy(
      async () => {
        throw new Error("held by another tab");
      },
      async () => "",
      () => {}
    );
    expect(outcome).toEqual({ saved: [], failed: [UNREAD_GAMES] });
    expect(failedLine(UNREAD_GAMES)).toBe("Couldn’t save your games. Press the button to try again.");
  });
});
