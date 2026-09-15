/**
 * The two notices a tab shows when several Atlantis HUD tabs want the same saved data: the rules
 * and the words, apart from the components so they can be tested without effects.
 *
 * The held notice is this tab failing to open something another tab holds. The stopped notice is
 * this tab having let go of its storage because another tab asked for it.
 */

import type { StorageHeldScope, StorageStopCause } from "@atlantis/core-client";

export type HeldNotice = {
  scope: StorageHeldScope;
  /** The game whose data is held; null for "games-list". */
  gameId: string | null;
  /** The name shown in the heading; null for "games-list". */
  gameName: string | null;
  /** "still" after any failed Try again for the same scope and game. */
  attempt: "first" | "still";
  /** True from pressing Try again until that attempt settles. */
  retrying: boolean;
};

export type HeldAction =
  | { type: "blocked"; scope: StorageHeldScope; gameId: string | null; gameName: string | null }
  | { type: "retry-started" }
  /** The attempt failed for a reason other than another tab: the button must work again. */
  | { type: "retry-failed" }
  | { type: "opened"; scope: StorageHeldScope }
  | { type: "game-changed" };

export function heldNoticeReducer(state: HeldNotice | null, action: HeldAction): HeldNotice | null {
  switch (action.type) {
    case "blocked":
      if (state !== null && state.scope === action.scope && state.gameId === action.gameId) {
        return { ...state, gameName: action.gameName, attempt: "still", retrying: false };
      }
      return {
        scope: action.scope,
        gameId: action.gameId,
        gameName: action.gameName,
        attempt: "first",
        retrying: false
      };
    case "retry-started":
      return state === null ? null : { ...state, retrying: true };
    case "retry-failed":
      // Only an attempt the player made: an unrelated failure must not turn a notice to "still".
      return state?.retrying ? { ...state, attempt: "still", retrying: false } : state;
    case "opened":
      return state !== null && state.scope === action.scope ? null : state;
    case "game-changed":
      // A game notice belongs to the game being left. A games-list notice waits for `opened`,
      // because the startup retry enters a game before it knows the list was read.
      return state?.scope === "game" ? null : state;
  }
}

export type NoticeWords = { heading: string; text: string; button: string };

export function heldNoticeWords(notice: HeldNotice): NoticeWords {
  const still = notice.attempt === "still" ? "still " : "";
  if (notice.scope === "game") {
    return {
      heading: `${notice.gameName ?? ""} is ${still}open in another tab`,
      text: "Another Atlantis HUD tab is holding on to this game's saved data, so it can't be opened here. Close the other Atlantis HUD tabs, then try again.",
      button: "Try again"
    };
  }
  return {
    heading: `Your saved games are ${still}open in another tab`,
    text: "Another Atlantis HUD tab is holding on to your saved games, so they can't be read here. Close the other Atlantis HUD tabs, then try again.",
    button: "Try again"
  };
}

export function stoppedNoticeWords(cause: StorageStopCause): NoticeWords {
  if (cause === "update") {
    return {
      heading: "Atlantis HUD was updated in another tab",
      text: "A newer version of Atlantis HUD is open in another tab, so this one has stopped. Your orders are saved. Reload this tab to carry on here, or close it.",
      button: "Reload"
    };
  }
  return {
    heading: "This tab has stopped",
    text: "Another Atlantis HUD tab needed the saved data this tab was using. Your orders are saved. Reload this tab to carry on here, or close it.",
    button: "Reload"
  };
}

/** sessionStorage key naming the game a stopped tab should reopen after Reload. */
export const REOPEN_GAME_KEY = "atlantis-hud:reopen-game";

export type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Both swallow storage failures: a private window may throw, and losing the reopen only means
// startup opens the newest game instead.
export function rememberReopenGame(storage: SessionStore | null, gameId: string): void {
  try {
    storage?.setItem(REOPEN_GAME_KEY, gameId);
  } catch {
    // Nothing to do: see above.
  }
}

/** Reads and removes it, so it applies to one reload only. */
export function takeReopenGame(storage: SessionStore | null): string | null {
  try {
    const gameId = storage?.getItem(REOPEN_GAME_KEY) ?? null;
    storage?.removeItem(REOPEN_GAME_KEY);
    return gameId;
  } catch {
    return null;
  }
}
