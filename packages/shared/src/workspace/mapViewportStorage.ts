/**
 * Saving and restoring the map viewport position between sessions.
 *
 * The viewport (pan and zoom) is stored in localStorage keyed by game identifier, so each game
 * reopens exactly where the player left it. Failures are silently tolerated — viewport persistence
 * is a convenience and should never crash the application.
 */

import { MAX_STEP, MIN_STEP, type Viewport } from "./mapViewport";

/** The minimal interface this module needs from any storage backend. */
export type ViewportStorage = Pick<Storage, "getItem" | "setItem">;

/** localStorage key for the saved viewport of a specific game. */
function viewportStorageKey(gameId: string): string {
  return `atlantis-hud-viewport-${gameId}`;
}

/**
 * Returns localStorage when it is available, or null when it is not.
 *
 * Degrades gracefully under Node (where `localStorage` is undefined) and when the browser blocks
 * storage access entirely.
 */
function optionalStorage(): ViewportStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the saved viewport for a game.
 *
 * Returns `null` when nothing has been saved yet, localStorage is unavailable, or the stored value
 * does not parse into a valid viewport.
 *
 * `storage` is injectable for testing; production callers omit it and get localStorage.
 */
export function loadSavedViewport(
  gameId: string,
  storage: ViewportStorage | null = optionalStorage()
): Viewport | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(viewportStorageKey(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).tx === "number" &&
      typeof (parsed as Record<string, unknown>).ty === "number" &&
      typeof (parsed as Record<string, unknown>).step === "number"
    ) {
      const tx = (parsed as Record<string, number>).tx;
      const ty = (parsed as Record<string, number>).ty;
      const step = (parsed as Record<string, number>).step;
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(step)) {
        return null;
      }
      return {
        tx,
        ty,
        step: Math.min(MAX_STEP, Math.max(MIN_STEP, Math.trunc(step)))
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists the current viewport for a game.
 *
 * Failures are silently ignored — viewport persistence is a convenience and should never crash the
 * application.
 *
 * `storage` is injectable for testing; production callers omit it and get localStorage.
 */
export function saveViewportForGame(
  gameId: string,
  viewport: Viewport,
  storage: ViewportStorage | null = optionalStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(viewportStorageKey(gameId), JSON.stringify(viewport));
  } catch {
    // Storage full or blocked; viewport is not critical.
  }
}
