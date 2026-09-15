/**
 * What happens when several Atlantis HUD tabs want the same saved data.
 *
 * Here rather than in the browser store because it is the one package both that store and the
 * shared shell depend on: the store throws these, and the shell turns them into notices.
 */

/** Which saved data another tab is holding: one game's own database, or the list of games. */
export type StorageHeldScope = "game" | "games-list";

const NAME = "StorageHeldElsewhereError";

const MESSAGES: Record<StorageHeldScope, string> = {
  game: "this game is open in another tab, which is holding its storage open",
  "games-list":
    "Another Atlantis HUD tab is holding on to your saved games, so they can't be read here."
};

/** Thrown by the browser store when another tab holds a database this tab needs. */
export class StorageHeldElsewhereError extends Error {
  readonly scope: StorageHeldScope;

  constructor(scope: StorageHeldScope) {
    super(MESSAGES[scope]);
    this.name = NAME;
    this.scope = scope;
  }
}

/** True for a StorageHeldElsewhereError, matched on `name` so a second bundle copy still matches. */
export function isStorageHeldElsewhere(error: unknown): error is StorageHeldElsewhereError {
  if (!(error instanceof Error) || error.name !== NAME) {
    return false;
  }
  const scope = (error as { scope?: unknown }).scope;
  return scope === "game" || scope === "games-list";
}

/** Why this tab was asked to let go: a newer build upgrading a database, or anything else (a delete). */
export type StorageStopCause = "update" | "other";

export type StorageStopListener = (cause: StorageStopCause) => void | Promise<void>;

/** Something that can tell a tab it has been asked to let go of its storage. Returns an unsubscribe. */
export type StorageStopSource = { onStop(listener: StorageStopListener): () => void };
