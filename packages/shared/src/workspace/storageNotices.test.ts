import { describe, expect, it } from "vitest";
import {
  REOPEN_GAME_KEY,
  heldNoticeReducer,
  heldNoticeWords,
  rememberReopenGame,
  stoppedNoticeWords,
  takeReopenGame,
  type HeldNotice,
  type SessionStore
} from "./storageNotices";

const blockedGame = (gameId: string, gameName: string) =>
  ({ type: "blocked", scope: "game", gameId, gameName }) as const;
const blockedList = { type: "blocked", scope: "games-list", gameId: null, gameName: null } as const;

describe("the held notice's state", () => {
  it("appears on the first failure", () => {
    expect(heldNoticeReducer(null, blockedGame("g1", "Midgard"))).toEqual({
      scope: "game",
      gameId: "g1",
      gameName: "Midgard",
      attempt: "first",
      retrying: false
    });
  });

  it("says still when the same game fails again, and can be pressed again", () => {
    let state = heldNoticeReducer(null, blockedGame("g1", "Midgard"));
    state = heldNoticeReducer(state, { type: "retry-started" });
    expect(state?.retrying).toBe(true);
    state = heldNoticeReducer(state, blockedGame("g1", "Midgard"));
    expect(state?.attempt).toBe("still");
    expect(state?.retrying).toBe(false);
    expect(heldNoticeReducer(state, blockedGame("g1", "Midgard"))?.attempt).toBe("still");
  });

  it("starts over for a different game", () => {
    const state = heldNoticeReducer(
      heldNoticeReducer(null, blockedGame("g1", "Midgard")),
      blockedGame("g2", "Asgard")
    );
    expect(state?.attempt).toBe("first");
    expect(state?.gameName).toBe("Asgard");
  });

  it("can be pressed again after an attempt that failed for another reason", () => {
    let state = heldNoticeReducer(null, blockedGame("g1", "Midgard"));
    state = heldNoticeReducer(state, { type: "retry-started" });
    state = heldNoticeReducer(state, { type: "retry-failed" });
    expect(state?.retrying).toBe(false);
    expect(state?.attempt).toBe("still");
    expect(heldNoticeReducer(null, { type: "retry-failed" })).toBeNull();
  });

  it("leaves a notice nobody retried alone when something else fails", () => {
    const list = heldNoticeReducer(null, blockedList);
    expect(heldNoticeReducer(list, { type: "retry-failed" })).toBe(list);
  });

  it("does nothing when trying again with no notice", () => {
    expect(heldNoticeReducer(null, { type: "retry-started" })).toBeNull();
  });

  it("goes when the held data opens, and only that data", () => {
    const game = heldNoticeReducer(null, blockedGame("g1", "Midgard"));
    expect(heldNoticeReducer(game, { type: "opened", scope: "game" })).toBeNull();
    expect(heldNoticeReducer(game, { type: "opened", scope: "games-list" })).toBe(game);
  });

  it("goes with the game being left, but a held games list stays until it is read", () => {
    const game = heldNoticeReducer(null, blockedGame("g1", "Midgard"));
    const list = heldNoticeReducer(null, blockedList);
    expect(heldNoticeReducer(game, { type: "game-changed" })).toBeNull();
    expect(heldNoticeReducer(list, { type: "game-changed" })).toBe(list);
  });
});

const notice = (overrides: Partial<HeldNotice>): HeldNotice => ({
  scope: "game",
  gameId: "g1",
  gameName: "Midgard",
  attempt: "first",
  retrying: false,
  ...overrides
});

describe("the notices' words", () => {
  const gameText =
    "Another Atlantis HUD tab is holding on to this game's saved data, so it can't be opened here. Close the other Atlantis HUD tabs, then try again.";
  const listText =
    "Another Atlantis HUD tab is holding on to your saved games, so they can't be read here. Close the other Atlantis HUD tabs, then try again.";

  it("names the held game", () => {
    expect(heldNoticeWords(notice({}))).toEqual({
      heading: "Midgard is open in another tab",
      text: gameText,
      button: "Try again"
    });
    expect(heldNoticeWords(notice({ attempt: "still" })).heading).toBe(
      "Midgard is still open in another tab"
    );
  });

  it("keeps a long game name whole", () => {
    expect(heldNoticeWords(notice({ gameName: "The Long Winter of Midgard" })).heading).toBe(
      "The Long Winter of Midgard is open in another tab"
    );
  });

  it("speaks of saved games when the list is held", () => {
    const list = notice({ scope: "games-list", gameId: null, gameName: null });
    expect(heldNoticeWords(list)).toEqual({
      heading: "Your saved games are open in another tab",
      text: listText,
      button: "Try again"
    });
    expect(heldNoticeWords({ ...list, attempt: "still" }).heading).toBe(
      "Your saved games are still open in another tab"
    );
  });

  it("names an update, and uses general words for anything else", () => {
    expect(stoppedNoticeWords("update")).toEqual({
      heading: "Atlantis HUD was updated in another tab",
      text: "A newer version of Atlantis HUD is open in another tab, so this one has stopped. Your orders are saved. Reload this tab to carry on here, or close it.",
      button: "Reload"
    });
    expect(stoppedNoticeWords("other")).toEqual({
      heading: "This tab has stopped",
      text: "Another Atlantis HUD tab needed the saved data this tab was using. Your orders are saved. Reload this tab to carry on here, or close it.",
      button: "Reload"
    });
  });
});

describe("reopening the same game after Reload", () => {
  const memory = (): SessionStore => {
    const entries = new Map<string, string>();
    return {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => void entries.set(key, value),
      removeItem: (key) => void entries.delete(key)
    };
  };

  it("hands the remembered game back for one reload only", () => {
    const storage = memory();
    rememberReopenGame(storage, "g1");
    expect(storage.getItem(REOPEN_GAME_KEY)).toBe("g1");
    expect(takeReopenGame(storage)).toBe("g1");
    expect(takeReopenGame(storage)).toBeNull();
  });

  it("survives a storage that throws, and no storage at all", () => {
    const throwing: SessionStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      }
    };
    expect(() => rememberReopenGame(throwing, "g1")).not.toThrow();
    expect(takeReopenGame(throwing)).toBeNull();
    expect(() => rememberReopenGame(null, "g1")).not.toThrow();
    expect(takeReopenGame(null)).toBeNull();
  });
});
