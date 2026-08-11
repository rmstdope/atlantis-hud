/**
 * The map's view model: what the player knows about the world, and how confident they can be in it.
 *
 * A report only ever describes part of the world, so the map has four states rather than two, and
 * the distinction between them is the whole point of the thing:
 *
 * - `current`  — in this turn's report. Trustworthy.
 * - `stale`    — visited before, absent from this report. The data is real but may have moved on.
 * - `named`    — named in another region's `Exits` block. Terrain and province only, never visited.
 * - unexplored — not represented here at all; the renderer draws the empty lattice.
 */

import type { Coordinate, ParsedReport, ReportRegion } from "@atlantis/core-client";

/** How much the player can trust what the map shows for a hex. */
export type HexKnowledge = "current" | "stale" | "named";

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
  /** Level the hexes belong to; a report can describe more than one. */
  levels: number[];
  currentTurn: number | null;
  initialSelectedRegionId: string | null;
};

/** A region carried over from an earlier turn, as persistence hands it back. */
export type StoredRegion = {
  regionId: string;
  coordinate: Coordinate;
  terrain: string;
  province: string;
  label: string;
  lastSeenTurn: number;
  region: ReportRegion | null;
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

/** The coordinate an id names, or nothing when the text is not one. */
export function parseRegionId(regionId: string): Coordinate | null {
  const match = /^(-?\d+):(-?\d+),(-?\d+)$/.exec(regionId);
  if (!match) {
    return null;
  }
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
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
 * A hex in the current report, plus whatever an ally saw standing in it this same turn.
 *
 * The current report always wins a hex it describes, and that is right: it is the freshest account
 * there is, and a stored payload from before the ruleset was fetchable may still carry estimated
 * man counts where the live parse carries exact ones. But an ally's
 * report merged into this same turn (issue #53) is stored and not on screen, so without this the
 * deep merge of a hex both factions stood in would be written correctly and never drawn - it would
 * surface next turn, once the hex goes stale, which is a strange thing for "merged 31 regions" to
 * mean.
 *
 * Additive only. Nothing of the current report is replaced; units it does not already name are
 * appended, and by construction those are all foreign - the merge marks every unit it contributes
 * as somebody else's before it stores it. `ownUnitCount` and `foreignUnitCount` recount from the
 * result, so the tallies follow without being told.
 *
 * Restricted to a stored sighting of *this* turn. An older one describes a hex before whatever
 * happened in it since, and letting that intrude would put last month's army back on the board.
 */
function withAlliesUnits(
  region: ReportRegion,
  stored: StoredRegion | undefined,
  currentTurn: number | null
): ReportRegion {
  const alsoSeen = stored?.region;
  if (!alsoSeen || currentTurn === null || stored.lastSeenTurn !== currentTurn) {
    return region;
  }

  const named = new Set(region.units.map((unit) => unit.unitId));
  const extra = alsoSeen.units.filter((unit) => !named.has(unit.unitId));
  if (extra.length === 0) {
    return region;
  }

  return { ...region, units: [...region.units, ...extra.map((unit) => ({ ...unit, own: false }))] };
}

function nodeFromRegion(
  region: ReportRegion,
  knowledge: HexKnowledge,
  lastSeenTurn: number | null,
  currentTurn: number | null
): HexNode {
  return {
    regionId: region.regionId,
    coordinate: region.coordinate,
    terrain: region.terrain,
    province: region.province,
    label: hexLabelOf(region),
    knowledge,
    lastSeenTurn,
    ageInTurns:
      currentTurn !== null && lastSeenTurn !== null ? Math.max(0, currentTurn - lastSeenTurn) : null,
    settlementName: region.settlement?.name ?? null,
    region,
    ...countUnits(region)
  };
}

/**
 * Builds the map from this turn's report and whatever earlier turns left behind.
 *
 * Precedence matters and is deliberate: a hex in the current report always wins over a stored
 * sighting, and a visited hex always wins over one merely named by a neighbour's exit. Otherwise a
 * hex would lose detail it already has, or be marked less certain than it deserves.
 */
export function buildHexMapModel(
  parsed: ParsedReport,
  storedRegions: StoredRegion[] = []
): HexMapModel {
  const currentTurn = parsed.header.turnNumber;
  const byKey = new Map<string, HexNode>();
  const storedByKey = new Map(storedRegions.map((stored) => [regionIdOf(stored.coordinate), stored]));

  // Weakest first, so stronger knowledge overwrites it.
  for (const region of parsed.regions) {
    for (const exit of region.exits) {
      const key = regionIdOf(exit.coordinate);
      if (byKey.has(key)) {
        continue;
      }
      byKey.set(key, {
        regionId: key,
        coordinate: exit.coordinate,
        terrain: exit.terrain,
        province: exit.province,
        label: hexLabelOf(exit),
        knowledge: "named",
        lastSeenTurn: null,
        ageInTurns: null,
        settlementName: exit.settlement?.name ?? null,
        region: null,
        ownUnitCount: 0,
        foreignUnitCount: 0
      });
    }
  }

  for (const stored of storedRegions) {
    const key = regionIdOf(stored.coordinate);
    const existing = byKey.get(key);
    if (existing && existing.knowledge !== "named") {
      continue;
    }
    byKey.set(key, {
      regionId: stored.regionId,
      coordinate: stored.coordinate,
      terrain: stored.terrain,
      province: stored.province,
      label: stored.label,
      knowledge: "stale",
      lastSeenTurn: stored.lastSeenTurn,
      ageInTurns: currentTurn === null ? null : Math.max(0, currentTurn - stored.lastSeenTurn),
      settlementName: stored.region?.settlement?.name ?? null,
      region: stored.region,
      ...countUnits(stored.region)
    });
  }

  for (const region of parsed.regions) {
    const key = regionIdOf(region.coordinate);
    byKey.set(
      key,
      nodeFromRegion(
        withAlliesUnits(region, storedByKey.get(key), currentTurn),
        "current",
        currentTurn,
        currentTurn
      )
    );
  }

  const hexes = [...byKey.values()].sort((left, right) => {
    if (left.coordinate.z !== right.coordinate.z) {
      return left.coordinate.z - right.coordinate.z;
    }
    if (left.coordinate.y !== right.coordinate.y) {
      return left.coordinate.y - right.coordinate.y;
    }
    return left.coordinate.x - right.coordinate.x;
  });

  const levels = [...new Set(hexes.map((hex) => hex.coordinate.z))].sort((a, b) => a - b);

  // Open on a hex the player has units in, falling back to any visited hex. Opening on a hex they
  // have never been to would be a strange place to start.
  const withOwnUnits = hexes.find((hex) => hex.ownUnitCount > 0);
  const visited = hexes.find((hex) => hex.knowledge === "current");

  return {
    hexes,
    levels,
    currentTurn,
    initialSelectedRegionId: (withOwnUnits ?? visited)?.regionId ?? null
  };
}

/** Units of one hex, own faction first, then by name — one of 92 being yours should not be buried. */
export function unitsForHex(hex: HexNode | null) {
  if (!hex?.region) {
    return [];
  }
  return [...hex.region.units].sort((left, right) => {
    if (left.own !== right.own) {
      return left.own ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
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
