/**
 * Saving and restoring the map view between sessions.
 *
 * Pan, zoom, which level was on screen and which hex was selected are stored in localStorage keyed
 * by game identifier, so each game reopens exactly where the player left it. Failures are silently
 * tolerated — remembering a view is a convenience and should never crash the application.
 *
 * There is one writer: the workspace store holds the whole view (`mapViewState.ts`), and the shell
 * writes the whole record whenever any part of it changes. Nothing here reads the record back to
 * preserve half of it, because there is nothing left that owns only half.
 */

import { NEXUS, parseRegionId } from "../hexMapModel";
import { MAX_STEP, MIN_STEP, type Viewport } from "./mapViewport";

/** The minimal interface this module needs from any storage backend. */
export type ViewportStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * localStorage key for the saved view of a specific game.
 *
 * Still named for the viewport, which is all it once held. The name is what is already in every
 * player's browser, and renaming it would abandon the pan and zoom stored under it.
 */
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

/** Everything a reopened game needs to put the map back where the player left it. */
export type SavedMapView = {
  /** Pan and zoom, or `null` when the record holds no usable one. */
  viewport: Viewport | null;
  /** Which level was on screen, or `null` when the record predates storing it. */
  level: number | null;
  /** The hex that was selected, or `null` when none was. */
  regionId: string | null;
};

/** How the record is written: flat, and with the original three fields where they always were. */
type StoredView = {
  tx?: unknown;
  ty?: unknown;
  step?: unknown;
  level?: unknown;
  regionId?: unknown;
};

/**
 * The pan and zoom in a stored record, or `null` when it holds none worth using.
 *
 * The step is clamped rather than rejected: storage is hand-editable and a build can be downgraded
 * past a zoom range it once offered, and a view one step outside the range is still the view the
 * player wants. A translation that is not a finite number is not salvageable that way.
 */
function viewportIn(stored: StoredView): Viewport | null {
  const { tx, ty, step } = stored;
  if (typeof tx !== "number" || typeof ty !== "number" || typeof step !== "number") {
    return null;
  }
  if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(step)) {
    return null;
  }
  return { tx, ty, step: Math.min(MAX_STEP, Math.max(MIN_STEP, Math.trunc(step))) };
}

/**
 * The level in a stored record, or `null` when it holds none worth using.
 *
 * A level is a z coordinate: a whole number, and no shallower than the nexus, level 0. Rejected
 * rather than rounded, because a record that has been edited by hand into something impossible is
 * not a record whose intent can be guessed - and the caller's fallback is the surface, which is
 * where a game with no saved level opens anyway. A fraction would be the worst of the three to let
 * through: it matches no hex on any level, so the map would draw nothing at all.
 */
function levelIn(stored: StoredView): number | null {
  const { level } = stored;
  if (typeof level !== "number" || !Number.isInteger(level) || level < NEXUS) {
    return null;
  }
  return level;
}

/**
 * The selected hex in a stored record, or `null` when it names no real one.
 *
 * Judged by `parseRegionId` rather than by a shape check written again here, so this cannot drift
 * away from what the rest of the application will accept: half the coordinate pairs are off the
 * hex lattice entirely, and a selection pointing at one would have the panels describing a place
 * that is not on the map.
 */
function regionIdIn(stored: StoredView): string | null {
  const { regionId } = stored;
  if (typeof regionId !== "string" || parseRegionId(regionId) === null) {
    return null;
  }
  return regionId;
}

/** Reads the raw record, or `null` when there is none or it will not parse. */
function storedView(gameId: string, storage: ViewportStorage | null): StoredView | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(viewportStorageKey(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as StoredView;
  } catch {
    return null;
  }
}

/**
 * Reads the whole saved view for a game.
 *
 * Returns `null` when nothing has been saved, storage is unavailable, or the stored record holds
 * nothing usable at all. Each part is read on its own: a record whose translation has been
 * corrupted still names a level and a hex worth putting back, and a record written before those
 * two were stored still holds a perfectly good pan and zoom.
 *
 * `storage` is injectable for testing; production callers omit it and get localStorage.
 */
export function loadSavedView(
  gameId: string,
  storage: ViewportStorage | null = optionalStorage()
): SavedMapView | null {
  const stored = storedView(gameId, storage);
  if (stored === null) {
    return null;
  }

  const viewport = viewportIn(stored);
  const level = levelIn(stored);
  const regionId = regionIdIn(stored);

  if (viewport === null && level === null && regionId === null) {
    return null;
  }
  return { viewport, level, regionId };
}

/**
 * Persists the whole view for a game: pan, zoom, level and the selected hex, written together.
 *
 * There is one writer now (the shell, from the store's `mapView`), so there is nothing to preserve
 * from a previous write - the record is replaced whole. A `null` hex is stored as such rather than
 * skipped: deselecting is a change to remember too, and a record that kept the last hex forever
 * would reopen on one the player had deliberately left.
 *
 * Failures are silently ignored — remembering a view is a convenience and should never crash the
 * application. `storage` is injectable for testing; production callers omit it and get
 * localStorage.
 */
export function saveMapView(
  gameId: string,
  view: { viewport: Viewport; level: number; regionId: string | null },
  storage: ViewportStorage | null = optionalStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      viewportStorageKey(gameId),
      JSON.stringify({
        tx: view.viewport.tx,
        ty: view.viewport.ty,
        step: view.viewport.step,
        level: view.level,
        regionId: view.regionId
      })
    );
  } catch {
    // Storage full or blocked; the view is not critical.
  }
}
