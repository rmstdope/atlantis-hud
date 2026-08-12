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

/** Restore the saved position, frame the level from scratch, or leave the view alone. */
export type MapViewDecision =
  | { kind: "restore"; viewport: Viewport }
  | { kind: "fit" }
  | { kind: "hold" };

export type MapViewInput = {
  /** The saved view for this game, while it is still waiting to be applied. */
  pending: SavedMapView | null;
  /** The level being drawn. */
  level: number;
  /** The level last framed for this game, or `null` when none has been. */
  framedLevel: number | null;
  /** Whether this level has anything on it to frame. */
  hasHexes: boolean;
};

export function mapViewDecision({
  pending,
  level,
  framedLevel,
  hasHexes
}: MapViewInput): MapViewDecision {
  // Whichever level is on screen. The saved level is applied to the store as the game is entered,
  // in the same render as the game itself, so by the time this runs the level already agrees with
  // the record - and on the one path where it cannot (a saved level this game no longer draws) the
  // shell moves the level afterwards, which fits the new one over the top. Making the restore wait
  // for a level to match instead would strand the map at the origin in exactly that case.
  if (pending?.viewport) {
    return { kind: "restore", viewport: pending.viewport };
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
