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

/** The level a report describes unless it says otherwise; levels are counted from here. */
export const SURFACE = 1;

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
 * Held to the whole contract rather than to the shape of the text: levels are counted from the
 * surface, which is one, and only positions where `x + y` is even exist. A garbled id has to read
 * as no hex at all, because the alternative is a selection ring drawn off the lattice, or a
 * heading naming a level nobody plays on, with the panel looking as though it knew something.
 */
export function parseRegionId(regionId: string): Coordinate | null {
  const match = /^(\d+):(-?\d+),(-?\d+)$/.exec(regionId);
  if (!match) {
    return null;
  }
  const coordinate = { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
  if (coordinate.z < SURFACE || !isValidCoordinate(coordinate)) {
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

/** One entry of a region's `Exits` block: the only account there is of a hex nobody has entered. */
type Exit = ReportRegion["exits"][number];

/**
 * A hex as somebody's exits describe it, and the turn they described it in.
 *
 * `lastSeenTurn` is the turn whose exits named it, which is not the same claim the field makes for
 * a visited hex - nobody has stood here. It is carried because a naming has a vintage and the map
 * would otherwise throw it away; `ageInTurns` stays null, because a hex never visited has no age
 * for the fade to run.
 */
function namedFromExit(exit: Exit, namedInTurn: number | null): HexNode {
  return {
    regionId: regionIdOf(exit.coordinate),
    coordinate: exit.coordinate,
    terrain: exit.terrain,
    province: exit.province,
    label: hexLabelOf(exit),
    knowledge: "named",
    lastSeenTurn: namedInTurn,
    ageInTurns: null,
    settlementName: exit.settlement?.name ?? null,
    region: null,
    ownUnitCount: 0,
    foreignUnitCount: 0
  };
}

/**
 * The remembered regions, oldest sighting first.
 *
 * Copied before it is sorted: `sort` works in place, and reordering the caller's own array under it
 * is not this function's to do. A sighting carrying no payload carries no exits either and simply
 * contributes nothing, which is why nothing filters them out first.
 *
 * Sightings of the same turn come back in the order the store listed them, which is what `sort` has
 * guaranteed since ES2019 - stability is part of the language here rather than a habit of one
 * engine, and this package compiles to ES2022. The caller turns that order into "the first naming
 * of a turn wins", and `settles two namings from the same turn the way a report does` fails if
 * either half of that stops holding.
 */
function namingsOldestFirst(storedRegions: StoredRegion[]): StoredRegion[] {
  return [...storedRegions].sort((left, right) => left.lastSeenTurn - right.lastSeenTurn);
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
  //
  // Namings oldest first, so a later account of the same ground overwrites an earlier one. A
  // remembered region's exits are as old as the sighting that carried them, and within any single
  // turn the first naming wins - the rule the report below has always used, applied to memory too.
  // Without it the winner would be whichever row the store happened to list last, so a hex could
  // change terrain from one turn to the next with no new information having arrived.
  const namedInTurn = new Map<string, number>();
  for (const stored of namingsOldestFirst(storedRegions)) {
    for (const exit of stored.region?.exits ?? []) {
      const key = regionIdOf(exit.coordinate);
      if (namedInTurn.get(key) === stored.lastSeenTurn) {
        continue;
      }
      namedInTurn.set(key, stored.lastSeenTurn);
      byKey.set(key, namedFromExit(exit, stored.lastSeenTurn));
    }
  }

  // The report on screen names last and so wins, whatever turn it carries: it is the account the
  // player is reading, which is the same reason its regions beat a stored sighting below. Within it
  // the first naming of a hex wins, as it always has - `byKey` can no longer answer that question
  // on its own now that remembered namings are already in it.
  const namedNow = new Set<string>();
  for (const region of parsed.regions) {
    for (const exit of region.exits) {
      const key = regionIdOf(exit.coordinate);
      if (namedNow.has(key)) {
        continue;
      }
      namedNow.add(key);
      byKey.set(key, namedFromExit(exit, currentTurn));
    }
  }

  for (const stored of storedRegions) {
    const key = regionIdOf(stored.coordinate);
    const existing = byKey.get(key);
    if (existing && existing.knowledge !== "named") {
      continue;
    }
    // A sighting from this same turn - a hex only an ally reported, with none of my own - is as
    // fresh as anything in the current report and is not what "stale" means; only a sighting from
    // an earlier turn is memory, and a unit standing there when it was last seen may have moved,
    // disbanded or died since, so only that case drops its units (ah-o86, issue #53's territory).
    const isCurrentTurn = currentTurn !== null && stored.lastSeenTurn === currentTurn;
    const remembered = stored.region
      ? isCurrentTurn
        ? stored.region
        : { ...stored.region, units: [] }
      : null;
    byKey.set(key, {
      regionId: stored.regionId,
      coordinate: stored.coordinate,
      terrain: stored.terrain,
      province: stored.province,
      label: stored.label,
      knowledge: isCurrentTurn ? "current" : "stale",
      lastSeenTurn: stored.lastSeenTurn,
      ageInTurns: currentTurn === null ? null : Math.max(0, currentTurn - stored.lastSeenTurn),
      settlementName: stored.region?.settlement?.name ?? null,
      region: remembered,
      ...countUnits(remembered)
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
  // have never been to would be a strange place to start - which now includes a hex only an ally
  // reported this turn: it reads "current" for display, since the sighting is as fresh as anything
  // else on screen, but the player was never there, so `ownRegionIds` (built from the player's own
  // report, not from `knowledge`) is what "visited" means here (ah-o86).
  const ownRegionIds = new Set(parsed.regions.map((region) => region.regionId));
  const withOwnUnits = hexes.find((hex) => hex.ownUnitCount > 0);
  const visited = hexes.find((hex) => ownRegionIds.has(hex.regionId));

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
