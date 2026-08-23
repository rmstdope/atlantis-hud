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
    return { map: withDrawableWrapping(recorded), stated: true };
  }
  return { map: defaultMapFor(rulesetId), stated: false };
}

/**
 * The same shape with any wrapping that cannot be drawn turned off - an odd width cannot wrap
 * east-west, an odd height cannot wrap north-south.
 *
 * Games saved before `ah-teg0` may carry either combination, and the map is drawn without that
 * seam whatever the manifest says. Applying it here rather than at each reader means the interface
 * and the core cannot disagree about it. The recorded shape itself is left alone: correcting the
 * stored manifest is a write to a game the player may have opened only to look at.
 *
 * `defaultMapFor` is not passed through this: a ruleset's own declared map is a fact about the
 * ruleset, and one that failed this test would be a bug in `rulesets.ts` rather than something to
 * paper over per game.
 */
function withDrawableWrapping(map: MapShape): MapShape {
  return {
    width: map.width,
    height: map.height,
    wrapX: map.wrapX && map.width % 2 === 0,
    wrapY: map.wrapY && map.height % 2 === 0
  };
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

/** Which axis a map shape's parity problem is on, and what to say about it. */
export type MapShapeProblem = {
  axis: "x" | "y";
  /** The sentence shown under the Wraps row, ready to render. */
  message: string;
};

/**
 * Why this draft's wrapping cannot be drawn, if it cannot.
 *
 * A hex lattice only holds positions where `x + y` is even, so a seam joins only at an even span:
 * at an odd one the rows on the two sides sit half a hex out of step and the edges do not meet.
 *
 * Empty for every draft that is fine, **including one whose dimensions cannot be read at all** -
 * an unreadable width states no map (`mapFromDraft` returns `null`), and a map nobody stated wraps
 * nowhere, so there is nothing to refuse. Reporting a parity problem about a field the player has
 * cleared would be an error about an absence.
 *
 * Both axes are reported when both are wrong; the navigator chose two lines over one.
 */
export function mapShapeProblems(draft: MapDraft): MapShapeProblem[] {
  const map = mapFromDraft(draft);
  if (map === null) {
    return [];
  }
  const problems: MapShapeProblem[] = [];
  if (map.wrapX && map.width % 2 !== 0) {
    problems.push({
      axis: "x",
      message:
        `A ${map.width}-wide map cannot wrap east-west: the eastern and western edges would sit ` +
        "half a hex out of step. Use an even width, or turn off east-west wrap."
    });
  }
  if (map.wrapY && map.height % 2 !== 0) {
    problems.push({
      axis: "y",
      message:
        `A ${map.height}-high map cannot wrap north-south: the northern and southern edges would ` +
        "sit half a hex out of step. Use an even height, or turn off north-south wrap."
    });
  }
  return problems;
}

/**
 * What committing this draft should store, or `null` when it must store nothing at all.
 *
 * Settings > Per game has no Save button - numbers commit on blur, checkboxes at once - so there
 * is no button to disable there. The refusal is this instead: a draft whose wrapping cannot be
 * drawn commits nothing, the game keeps the map it had, and the player's typing is left alone so
 * they can fix either field in either order.
 *
 * `{ store: undefined }` is distinct from `null`: it is the ordinary "records nothing" of cleared
 * fields, which puts the game back to assuming its ruleset's default.
 */
export function mapCommitOf(draft: MapDraft): { store: MapShape | undefined } | null {
  if (mapShapeProblems(draft).length > 0) {
    return null;
  }
  return { store: mapFromDraft(draft) ?? undefined };
}
