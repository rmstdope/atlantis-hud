/**
 * Where an inner passage comes out, proved by one of our own units going through it.
 *
 * No report names the far side of a passage, so the only honest source is the faction's own turn
 * history: a crossing our orders claimed in one turn, answered by where the next turn's report
 * found the unit. The claim half is the core's (`movement::passages`); this is the answer.
 *
 * Nothing is persisted. `imported_turns.raw_report` and `order_drafts.order_text` already keep
 * every input, so the whole memory is rebuilt by a scan - the decision `resourceMemory.ts` records
 * for itself, and for the same reason.
 *
 * Pure: no React, no store, no client, no clock.
 */

import type { Coordinate, ParsedReport, PassageClaim } from "@atlantis/core-client";

/** Where an inner passage comes out, proved by one of our own units going through it. */
export type KnownPassage = {
  /** The hex the passage is entered from. */
  entry: Coordinate;
  /** The structure's number, unique only within `entry`. */
  structureId: string;
  /** The structure as the report writes it: `Shaft [3]`. */
  structure: string;
  /** The hex the unit came out in. */
  destination: Coordinate;
  /** The destination's terrain, so the crossing can be priced without a map. */
  destinationTerrain: string;
  /** The turn whose report proved it. */
  learnedInTurn: number;
};

/** Every passage this faction has seen the far side of, keyed by {@link passageKey}. */
export type PassageMemory = ReadonlyMap<string, KnownPassage>;

/** Nothing remembered. Exported so callers need not build an empty Map each render. */
export const NO_PASSAGE_MEMORY: PassageMemory = new Map();

/**
 * `${z}:${x},${y}#${structureId}` - the hex and the number together.
 *
 * Structure numbers repeat between hexes (a `Building [1]` in one, a `Shaft [1]` in another), so a
 * number alone would merge two passages into one.
 */
export function passageKey(entry: Coordinate, structureId: string): string {
  return `${entry.z}:${entry.x},${entry.y}#${structureId}`;
}

/** Whether two coordinates name the same hex. */
function sameHex(a: Coordinate, b: Coordinate): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Last turn's claims answered by this turn's report.
 *
 * A claim is answered only when the report shows that unit, as our own, in a hex that is not the
 * one it went in from. Anything else - the unit gone, the unit still standing there because the
 * order failed - proves nothing and is dropped in silence.
 *
 * A later turn replaces an earlier answer for the same key: a structure can be destroyed and its
 * number given to the next one built in that hex, so the freshest crossing is the true one.
 *
 * Returns a new map; `memory` is never mutated.
 */
export function withCrossings(
  memory: PassageMemory,
  claims: readonly PassageClaim[],
  after: ParsedReport,
  afterTurn: number
): PassageMemory {
  if (claims.length === 0) {
    return memory;
  }

  const learned = new Map(memory);
  for (const claim of claims) {
    // One walk answers both questions the fold asks: where the unit is, and what terrain that hex
    // is. `ReportUnit` carries its own `regionId`, but the region is needed anyway for the terrain.
    const region = after.regions.find((candidate) =>
      candidate.units.some((unit) => unit.unitId === claim.unitId && unit.own)
    );
    if (!region || sameHex(region.coordinate, claim.entry)) {
      continue;
    }

    const key = passageKey(claim.entry, claim.structureId);
    const held = learned.get(key);
    if (held && held.learnedInTurn > afterTurn) {
      continue;
    }

    learned.set(key, {
      entry: claim.entry,
      structureId: claim.structureId,
      structure: claim.structure,
      destination: region.coordinate,
      destinationTerrain: region.terrain,
      learnedInTurn: afterTurn
    });
  }

  return learned;
}

/** The memory as the core will want it, ordered by key so two scans cannot differ. */
export function knownPassagesOf(memory: PassageMemory): KnownPassage[] {
  return [...memory.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, passage]) => passage);
}
