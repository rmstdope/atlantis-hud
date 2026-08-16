/**
 * What the map does with the view it is handed when a game opens or a turn lands.
 *
 * A plain module rather than logic inside the component, because this decision has been wrong twice
 * and neither mistake was visible in anything that renders. It framed the whole level on every
 * model change, so a turn imported into the open game threw away a position the player had just
 * chosen; and the position restored when a game opened was pulled straight back to the faction's
 * opening hex, because that hex was selected a moment later and the map travels to a selection it
 * cannot see.
 */

import type { Viewport } from "./mapViewport";
import type { SavedMapView } from "./mapViewportStorage";

/**
 * The map view as the workspace store holds it: everything about "where the map is" that is not
 * the level or the selected hex (those are the store's own fields), owned in one place so the
 * decisions below are made from state, not from refs and effect order.
 */
export type MapViewState = {
  /** The game this view belongs to; `null` between games. */
  gameId: string | null;
  /** The pan and zoom last committed by the map, or `null` before the first frame or restore. */
  viewport: Viewport | null;
  /** A saved viewport still waiting for the map to apply it. */
  pendingViewport: Viewport | null;
  /** The level last framed for `gameId`, or `null` when none has been. */
  framedLevel: number | null;
  /** The hex a restore put back, for as long as it is still the one selected. */
  restoredRegionId: string | null;
};

/** The view before any game has been opened. */
export const NO_MAP_VIEW: MapViewState = {
  gameId: null,
  viewport: null,
  pendingViewport: null,
  framedLevel: null,
  restoredRegionId: null
};

/** The view for a game just opened, from its saved record (or none). */
export function mapViewOpened(gameId: string, saved: SavedMapView | null): MapViewState {
  return {
    gameId,
    viewport: null,
    pendingViewport: saved?.viewport ?? null,
    framedLevel: null,
    restoredRegionId: saved?.regionId ?? null
  };
}

/** After the map commits a viewport on a level: the pending restore is spent and the level is framed. */
export function mapViewCommitted(
  state: MapViewState,
  viewport: Viewport,
  level: number
): MapViewState {
  return { ...state, viewport, pendingViewport: null, framedLevel: level };
}

/**
 * After the selection changes: the restored hex's exemption ends unless it is still the one
 * selected (`keepsRestoredHex`). A no-op returns the same object, so callers that read `mapView`
 * for referential equality (a memo, an effect dependency) see nothing change.
 */
export function mapViewSelectionChanged(
  state: MapViewState,
  selectedRegionId: string | null
): MapViewState {
  if (state.restoredRegionId === null) {
    return state;
  }
  return keepsRestoredHex(selectedRegionId, state.restoredRegionId)
    ? state
    : { ...state, restoredRegionId: null };
}

/** Restore the saved position, frame the level from scratch, or leave the view alone. */
export type MapViewDecision =
  | { kind: "restore"; viewport: Viewport }
  | { kind: "fit" }
  | { kind: "hold" };

export type MapViewDecisionInput = {
  /** The map view, as the store holds it. */
  view: MapViewState;
  /** The game being drawn. */
  gameId: string | null;
  /** The level being drawn. */
  level: number;
  /** Whether this level has anything on it to frame. */
  hasHexes: boolean;
};

export function mapViewDecision({
  view,
  gameId,
  level,
  hasHexes
}: MapViewDecisionInput): MapViewDecision {
  const pending = view.pendingViewport;
  const framedLevel = view.gameId === gameId ? view.framedLevel : null;
  // Whichever level is on screen. The saved level is applied to the store as the game is entered,
  // in the same render as the game itself, so by the time this runs the level already agrees with
  // the record - and on the one path where it cannot (a saved level this game no longer draws) the
  // shell moves the level afterwards, which fits the new one over the top. Making the restore wait
  // for a level to match instead would strand the map at the origin in exactly that case.
  if (pending) {
    return { kind: "restore", viewport: pending };
  }

  // Nothing on this level to frame is a game with no report in it yet. Fitting would frame nowhere
  // and still count as framed, so the first report to arrive would never be framed at all.
  if (framedLevel !== level && hasHexes) {
    return { kind: "fit" };
  }

  return { kind: "hold" };
}

/**
 * Whether the map should travel to the selection, or stay where the player left it.
 *
 * It should whenever the player picks a hex from somewhere other than the map - the units table, a
 * problem in the panel - because a selection ring nobody can see is no answer. It should not for
 * the one hex a restore put back: the saved view is where the player left the map, and a player who
 * panned away from their own selection before quitting meant to.
 */
export function shouldFollowSelection(
  selectedRegionId: string | null,
  restoredRegionId: string | null
): boolean {
  if (selectedRegionId === null) {
    return false;
  }
  return selectedRegionId !== restoredRegionId;
}

/**
 * Whether the restored hex is still the one selected, and so still exempt from the travel above.
 *
 * Asked separately from [`shouldFollowSelection`], because the exemption has to end on paths that
 * do not follow anything: changing level clears the selection outright, and a hex remembered past
 * that would still be exempt when the player picked it again from the units table - leaving the
 * ring and the keyboard cursor off screen, which is the one thing the travel exists to prevent.
 */
export function keepsRestoredHex(
  selectedRegionId: string | null,
  restoredRegionId: string | null
): boolean {
  return restoredRegionId !== null && selectedRegionId === restoredRegionId;
}
