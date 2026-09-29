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
 *
 * **The recorded object itself is returned when nothing needs turning off**, which almost always
 * it does not. That is not a micro-optimisation: the shell memoises on the map's identity, so a
 * fresh object per call would recompute everything keyed on it on every render.
 */
function withDrawableWrapping(map: MapShape): MapShape {
  const wrapX = map.wrapX && map.width % 2 === 0;
  const wrapY = map.wrapY && map.height % 2 === 0;
  if (wrapX === map.wrapX && wrapY === map.wrapY) {
    return map;
  }
  return { ...map, wrapX, wrapY };
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

export const MAP_LEVELS = ["surface", "underworld", "underdeep", "dungeon"] as const;

export type MapLevel = (typeof MAP_LEVELS)[number];

export type MapLevelDraft = {
  width: string;
  height: string;
};

export type MapSizesDraft = Record<MapLevel, MapLevelDraft> & {
  wrapX: boolean;
  wrapY: boolean;
};

export type MapSizes = {
  levels: Partial<Record<MapLevel, Pick<MapShape, "width" | "height">>>;
  wrapX: boolean;
  wrapY: boolean;
};

const MAP_LEVEL_LABELS: Record<MapLevel, string> = {
  surface: "Surface",
  underworld: "Underworld",
  underdeep: "Underdeep",
  dungeon: "Dungeon"
};

const EMPTY_LEVEL_DRAFT = (): MapLevelDraft => ({ width: "", height: "" });

/** The independent level rows and shared wrapping offered when creating a game. */
export function mapSizesDraftFor(rulesetId: string): MapSizesDraft {
  const draft: MapSizesDraft = {
    surface: EMPTY_LEVEL_DRAFT(),
    underworld: EMPTY_LEVEL_DRAFT(),
    underdeep: EMPTY_LEVEL_DRAFT(),
    dungeon: EMPTY_LEVEL_DRAFT(),
    wrapX: true,
    wrapY: false
  };

  if (rulesetId === "newage-arcanum" || rulesetId === "newage-trident") {
    draft.surface = { width: "64", height: "64" };
    draft.underworld = { width: "48", height: "48" };
    draft.underdeep = { width: "24", height: "24" };
    draft.dungeon = { width: "128", height: "32" };
  } else {
    const declared = defaultMapFor(rulesetId);
    if (declared !== null) {
      draft.surface = { width: String(declared.width), height: String(declared.height) };
      draft.wrapX = declared.wrapX;
      draft.wrapY = declared.wrapY;
    }
  }

  return draft;
}

/** Every incomplete level, ready for rendering beside its compact input row. */
export function mapSizesProblems(draft: MapSizesDraft): string[] {
  return MAP_LEVELS.flatMap((level) => {
    const { width, height } = draft[level];
    if ((width.trim() === "") !== (height.trim() === "")) {
      return [`${MAP_LEVEL_LABELS[level]} needs both a width and a height, or neither.`];
    }
    const parsedWidth = positiveWhole(width);
    const parsedHeight = positiveWhole(height);
    if (parsedWidth === null || parsedHeight === null) {
      return [];
    }
    return [
      ...(draft.wrapX && parsedWidth % 2 !== 0
        ? [`${MAP_LEVEL_LABELS[level]} needs an even width to wrap east to west.`]
        : []),
      ...(draft.wrapY && parsedHeight % 2 !== 0
        ? [`${MAP_LEVEL_LABELS[level]} needs an even height to wrap north to south.`]
        : [])
    ];
  });
}

/** The configured level sizes, or `null` until every row is complete or fully blank. */
export function mapSizesFromDraft(draft: MapSizesDraft): MapSizes | null {
  if (mapSizesProblems(draft).length > 0) {
    return null;
  }

  const levels: MapSizes["levels"] = {};
  for (const level of MAP_LEVELS) {
    const width = positiveWhole(draft[level].width);
    const height = positiveWhole(draft[level].height);
    if (width !== null && height !== null) {
      levels[level] = { width, height };
    }
  }
  return { levels, wrapX: draft.wrapX, wrapY: draft.wrapY };
}

/**
 * The shape a world with these level sizes records as its map: every configured level's size,
 * headed by the surface's (zero when no surface is configured). `undefined` when no level is.
 *
 * Mirrors `MapSizes::geometry` in `crates/core/src/backup.rs`, which records the same shape when
 * the sizes are edited; creating a game builds its manifest here instead (ah-byqe).
 */
export function mapShapeOfSizes(sizes: MapSizes): MapShape | undefined {
  const levels: NonNullable<MapShape["levels"]> = {};
  for (const level of MAP_LEVELS) {
    const size = sizes.levels[level];
    if (size !== undefined) {
      levels[level] = { width: size.width, height: size.height };
    }
  }
  if (Object.keys(levels).length === 0) {
    return undefined;
  }
  const surface = levels.surface ?? { width: 0, height: 0 };
  return { width: surface.width, height: surface.height, wrapX: sizes.wrapX, wrapY: sizes.wrapY, levels };
}

/** The level each map level row sizes, numbered as the core numbers `Coordinate.z`. */
const LEVEL_OF_Z: Record<number, MapLevel> = { 1: "surface", 2: "underworld", 3: "underdeep", 4: "dungeon" };

/**
 * The shape of level `z` alone, or `null` when that level has no size of its own - read as
 * "the game never said", so it wraps nowhere.
 *
 * A shape recorded without levels applies to every level, as it always did, and is returned
 * as-is so a memo keyed on it stays stable. Mirrors `MapGeometry::at_level` in the core.
 */
export function mapShapeAtLevel(shape: MapShape | null, z: number): MapShape | null {
  if (shape === null || shape.levels === undefined) {
    return shape;
  }
  const level = LEVEL_OF_Z[z];
  const size = level === undefined ? undefined : shape.levels[level];
  return size === undefined ? null : { width: size.width, height: size.height, wrapX: shape.wrapX, wrapY: shape.wrapY };
}

export function mapLevelLabel(level: MapLevel): string {
  return MAP_LEVEL_LABELS[level];
}

/**
 * The level sizes an existing world is configured with.
 *
 * A world created before map levels existed recorded only its single map, which is the surface's -
 * so that is read as a surface-only configuration rather than as nothing at all.
 */
export function mapSizesOfGame(recorded: MapSizes | undefined, map: MapShape | null): MapSizes | null {
  if (recorded !== undefined) {
    return recorded;
  }
  if (map === null) {
    return null;
  }
  return {
    levels: { surface: { width: map.width, height: map.height } },
    wrapX: map.wrapX,
    wrapY: map.wrapY
  };
}

/** The summary World settings shows: one line per map level, then one for the shared wrapping. */
export function mapSizesSummary(sizes: MapSizes | null): string[] {
  if (sizes === null || MAP_LEVELS.every((level) => sizes.levels[level] === undefined)) {
    return ["No map levels configured."];
  }
  const levels = MAP_LEVELS.map((level) => {
    const size = sizes.levels[level];
    return size === undefined
      ? `${MAP_LEVEL_LABELS[level]} not configured`
      : `${MAP_LEVEL_LABELS[level]} ${size.width} × ${size.height}`;
  });
  const wrapping =
    sizes.wrapX && sizes.wrapY
      ? "Wraps east to west and north to south"
      : sizes.wrapX
        ? "Wraps east to west"
        : sizes.wrapY
          ? "Wraps north to south"
          : "Does not wrap";
  return [...levels, wrapping];
}

/** The editing draft for a configuration; blank rows for the levels it does not have. */
export function mapSizesDraftOf(sizes: MapSizes | null): MapSizesDraft {
  const draft = mapSizesDraftFor("");
  if (sizes === null) {
    return draft;
  }
  for (const level of MAP_LEVELS) {
    const size = sizes.levels[level];
    if (size !== undefined) {
      draft[level] = { width: String(size.width), height: String(size.height) };
    }
  }
  return { ...draft, wrapX: sizes.wrapX, wrapY: sizes.wrapY };
}

/** A level made smaller or removed, and the field that did it - where "Keep editing" returns focus. */
export type ShrunkField = { level: MapLevel; field: "width" | "height" };

/**
 * The first configured level that `next` makes smaller or removes, or `null` when none - the one
 * change that asks for confirmation before saving.
 */
export function shrunkLevel(previous: MapSizes | null, next: MapSizes): ShrunkField | null {
  if (previous === null) {
    return null;
  }
  for (const level of MAP_LEVELS) {
    const before = previous.levels[level];
    if (before === undefined) {
      continue;
    }
    const after = next.levels[level];
    if (after === undefined || after.width < before.width) {
      return { level, field: "width" };
    }
    if (after.height < before.height) {
      return { level, field: "height" };
    }
  }
  return null;
}

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
