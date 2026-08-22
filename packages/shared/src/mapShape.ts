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

/** The four map fields as a form holds them, before anything has been validated. */
export type MapDraft = {
  width: string;
  height: string;
  wrapX: boolean;
  wrapY: boolean;
};

/**
 * What the map fields should show for a game about to be played under `rulesetId`.
 *
 * Called again whenever the ruleset selection changes, so the prefill refills rather than leaving
 * a stale 72x96 sitting under a newly-chosen variant - a wrong value that looks deliberate is
 * worse than no value at all. A ruleset that declares no map offers empty fields for the same
 * reason.
 */
export function mapDraftFor(rulesetId: string): MapDraft {
  const declared = defaultMapFor(rulesetId);
  if (declared === null) {
    return { width: "", height: "", wrapX: false, wrapY: false };
  }
  return {
    width: String(declared.width),
    height: String(declared.height),
    wrapX: declared.wrapX,
    wrapY: declared.wrapY
  };
}

/**
 * The map a draft describes, or `null` when it describes none.
 *
 * `null` is the ordinary answer for a player who cleared the fields because they do not know their
 * map's size, and it is what makes the manifest omit them - so the ruleset's default is assumed
 * and Settings says so. A dimension that is not a positive whole number is `null` for the same
 * reason rather than an error: a zero or negative width would divide the map into nothing, and
 * refusing to create the game over it would be a poor trade.
 */
export function mapFromDraft(draft: MapDraft): MapShape | null {
  const width = positiveWhole(draft.width);
  const height = positiveWhole(draft.height);
  if (width === null || height === null) {
    return null;
  }
  return { width, height, wrapX: draft.wrapX, wrapY: draft.wrapY };
}

function positiveWhole(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value > 0 ? value : null;
}
