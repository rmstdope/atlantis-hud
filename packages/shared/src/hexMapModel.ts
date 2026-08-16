/**
 * The map's view model: what the player knows about the world, and how confident they can be in it.
 *
 * A report only ever describes part of the world, so the map has four states rather than two, and
 * the distinction between them is the whole point of the thing:
 *
 * - `current`  — in this turn's report. Trustworthy.
 * - `stale`    — visited before, absent from this report. The data is real but may have moved on.
 * - `named`    — named in another region's `Exits` block, in this report or a remembered one.
 *                Terrain and province only, never visited.
 * - unexplored — not represented here at all; the renderer draws the empty lattice.
 *
 * Which state a hex is in, and every precedence rule behind it, is decided once in core -
 * `known_map::resolve_known_map` - and reaches the shell as a `KnownMap`. Nothing here derives that
 * any more; this module only converts the resolved hexes into what the map draws.
 */

import type {
  Coordinate,
  HexKnowledge,
  KnownMap,
  KnownMapHex,
  MapLevel,
  ReportRegion,
  ReportUnit
} from "@atlantis/core-client";

/** Owned by core since ah-u4e.1; re-exported so the map's consumers keep importing it from here. */
export type { HexKnowledge };
/** Owned by core since ah-4b4; re-exported so the map's consumers keep importing it from here. */
export type { MapLevel };

export type HexNode = {
  regionId: string;
  coordinate: Coordinate;
  terrain: string;
  province: string;
  label: string;
  knowledge: HexKnowledge;
  /** Turn this hex was last seen in, when known. */
  lastSeenTurn: number | null;
  /** Turns between `lastSeenTurn` and the current turn. Zero for a hex in this report. */
  ageInTurns: number | null;
  settlementName: string | null;
  /** Full detail, present only for a hex that has actually been visited. */
  region: ReportRegion | null;
  ownUnitCount: number;
  foreignUnitCount: number;
};

export type HexMapModel = {
  hexes: HexNode[];
  /** The levels the map has hexes on, shallowest first, each with the word the control shows. */
  levels: MapLevel[];
  currentTurn: number | null;
};

/**
 * Flat-top hex geometry, in the game's own coordinate space.
 *
 * Atlantis exits are north, south and the four diagonals, so a hex has a direct northern neighbour
 * and the hexes are flat-top. `(x, y +/- 2)` is vertical and `(x +/- 1, y +/- 1)` are the diagonals,
 * and only coordinates where `x + y` is even exist.
 *
 * The previous renderer drew pointy-top hexes, which have no northern neighbour at all.
 */
export function hexToPixel(coordinate: Coordinate, radius: number): { x: number; y: number } {
  return {
    x: coordinate.x * radius * 1.5,
    y: (coordinate.y * radius * Math.sqrt(3)) / 2
  };
}

/** Corner offsets of a flat-top hexagon, for a renderer to trace. */
export function hexCorners(radius: number): Array<{ x: number; y: number }> {
  return Array.from({ length: 6 }, (_, corner) => {
    const angle = (Math.PI / 180) * (60 * corner);
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

/** The nexus, level 0: above the surface, one hex, left once and never returned to. */
export const NEXUS = 0;

/** The level a report describes unless it says otherwise. */
export const SURFACE = 1;

/** The surface as a level entry, for a model with no game behind it. */
export const SURFACE_LEVEL: MapLevel = { z: SURFACE, name: "surface" };

/** The name the known map gives a level, or `null` when the map has no such level. */
export function levelNameOf(levels: MapLevel[], z: number): string | null {
  return levels.find((level) => level.z === z)?.name ?? null;
}

/**
 * The clause the region panel adds for an unexplored hex off the surface: `""` on the surface or
 * for a level the map does not list; `, in the nexus` / `, in the underworld` for a named level;
 * `, on level 5` when the core's name is its `level N` fallback (`report/level.rs` `level_name`).
 */
export function levelClause(levels: MapLevel[], z: number): string {
  if (z === SURFACE) {
    return "";
  }
  const name = levelNameOf(levels, z);
  if (name === null) {
    return "";
  }
  if (/^level \d+$/.test(name)) {
    return `, on ${name}`;
  }
  return `, in the ${name}`;
}

/** Whether a coordinate can exist: the lattice only uses positions where `x + y` is even. */
export function isValidCoordinate(coordinate: Coordinate): boolean {
  return (coordinate.x + coordinate.y) % 2 === 0;
}

/**
 * How a hex is addressed, as the game writes it: `1:7,53`.
 *
 * Unexplored ground has no region behind it, so this id is all a selection can be - which is why
 * writing and reading one live here rather than being spelled out wherever a hex is named.
 */
export function regionIdOf(coordinate: Coordinate): string {
  return `${coordinate.z}:${coordinate.x},${coordinate.y}`;
}

/** How a hex reads to a player: `mountain (7,53) in Inhead`, the way the report writes it. */
export function hexLabelOf(where: {
  terrain: string;
  coordinate: Coordinate;
  province: string;
}): string {
  return `${where.terrain} (${where.coordinate.x},${where.coordinate.y}) in ${where.province}`;
}

/**
 * The coordinate an id names, or nothing when the text does not name one the game could hold.
 *
 * Held to the whole contract rather than to the shape of the text: the nexus is level 0, and only
 * positions where `x + y` is even exist. A garbled id has to read as no hex at all, because the
 * alternative is a selection ring drawn off the lattice, or a heading naming a level nobody plays
 * on, with the panel looking as though it knew something.
 */
export function parseRegionId(regionId: string): Coordinate | null {
  const match = /^(\d+):(-?\d+),(-?\d+)$/.exec(regionId);
  if (!match) {
    return null;
  }
  const coordinate = { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
  if (!isValidCoordinate(coordinate)) {
    return null;
  }
  return coordinate;
}

function countUnits(region: ReportRegion | null) {
  if (!region) {
    return { ownUnitCount: 0, foreignUnitCount: 0 };
  }
  return {
    ownUnitCount: region.units.filter((unit) => unit.own).length,
    foreignUnitCount: region.units.filter((unit) => !unit.own).length
  };
}

/**
 * One resolved hex as the screen draws it. The core has already decided the knowledge, the age's
 * ingredients and which units (if any) count - this only shapes that decision into a `HexNode`.
 *
 * `ageInTurns` stays null for a `named` hex even though `lastSeenTurn` is set: nobody has stood
 * there, so there is no visit to fade, and the arithmetic below would otherwise happily produce a
 * number for a hex that was never seen.
 */
export function hexNodeOf(hex: KnownMapHex, currentTurn: number | null): HexNode {
  return {
    regionId: regionIdOf(hex.coordinate),
    coordinate: hex.coordinate,
    terrain: hex.terrain,
    province: hex.province,
    label: hexLabelOf(hex),
    knowledge: hex.knowledge,
    lastSeenTurn: hex.lastSeenTurn,
    ageInTurns:
      hex.knowledge === "named" || currentTurn === null || hex.lastSeenTurn === null
        ? null
        : Math.max(0, currentTurn - hex.lastSeenTurn),
    settlementName: hex.settlement?.name ?? null,
    region: hex.region,
    ...countUnits(hex.region)
  };
}

/**
 * The map as the screen draws it, converted from the core's resolution. No rule lives here any
 * more: which hex is current, stale or named, whose units count, and which naming won are all
 * `known_map::resolve_known_map`'s (crates/core/src/known_map.rs, module doc). This turns each
 * resolved hex into a `HexNode` and nothing else. The core hands the hexes sorted by level, row,
 * column, and that order is kept.
 */
export function buildHexMapModel(known: KnownMap): HexMapModel {
  const hexes = known.hexes.map((hex) => hexNodeOf(hex, known.currentTurn));

  return {
    hexes,
    levels: known.levels,
    currentTurn: known.currentTurn
  };
}

/** Own units first, then by name — one of 92 being yours should not be buried. */
export function sortUnitsForDisplay(units: ReportUnit[]): ReportUnit[] {
  return [...units].sort((left, right) => {
    if (left.own !== right.own) {
      return left.own ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

/** Units of one hex, for display. `[]` for a hex with no detail. */
export function unitsForHex(hex: HexNode | null) {
  return hex?.region ? sortUnitsForDisplay(hex.region.units) : [];
}

/** The report's long direction names, in the shorthand MOVE orders are written in. */
const DIRECTION_SHORTHAND: Record<string, string> = {
  north: "N",
  northeast: "NE",
  southeast: "SE",
  south: "S",
  southwest: "SW",
  northwest: "NW"
};

/**
 * "Southeast" as the compass shorthand "SE" - both shorter and the word the game itself speaks.
 *
 * A direction outside the six passes through untouched rather than being guessed at: the report's
 * exits have carried nothing else so far, but a wrong abbreviation would point somewhere real.
 */
export function abbreviateDirection(direction: string): string {
  return DIRECTION_SHORTHAND[direction.toLowerCase()] ?? direction;
}
