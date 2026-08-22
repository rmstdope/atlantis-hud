/**
 * Which map a game is actually played on, and how the core is told about it.
 *
 * A plain module rather than logic inside a component, for the reason `gameSession` gives: the
 * part that can go wrong - an old game with nothing recorded, a ruleset that declares no map -
 * is testable without rendering anything.
 */

import type { MapShape } from "@atlantis/core-client";
import { defaultMapFor } from "./rulesets";

/** The map a game plays on, and whether the player actually said so. */
export type GameMapShape = {
  map: MapShape | null;
  /**
   * `true` when the game's own manifest recorded these values, `false` when they are the ruleset's
   * default standing in for a game that never said.
   *
   * The distinction is the whole reason the manifest field is optional: Settings shows an assumed
   * map *as assumed*, so a wrong default is something a player can find and correct rather than a
   * silent error whose only symptom is a movement line drawn wrong at the seam.
   */
  stated: boolean;
};

/**
 * The map to plan on for a game played under `rulesetId`, given whatever its manifest recorded.
 *
 * A game created before the app asked adopts the ruleset's declared map rather than being
 * interrupted for an answer - the navigator's choice - and `stated: false` is what carries the
 * fact that nobody confirmed it. A ruleset with no declared map yields none at all, because a
 * guessed width would put a wrap seam where the map has none.
 */
export function mapShapeOfGame(rulesetId: string, recorded: MapShape | undefined): GameMapShape {
  if (recorded !== undefined) {
    return { map: recorded, stated: true };
  }
  return { map: defaultMapFor(rulesetId), stated: false };
}

/**
 * The map as the core reads it across the boundary.
 *
 * The empty string is how "the game never said" crosses: the core treats it as unknown dimensions
 * and computes neighbours exactly as it did before any of this existed. `"null"` or `"{}"` would
 * be a parse error or a zero-width map, and either would be worse than saying nothing.
 */
export function mapShapeJson(map: MapShape | null): string {
  return map === null ? "" : JSON.stringify(map);
}
