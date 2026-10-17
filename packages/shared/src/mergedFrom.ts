/**
 * Where a laid-over unit came from, and the words that say so (`ah-oqxn`).
 *
 * Kept apart from `mergedUnits.ts`, with no imports, so the item and tooltip helpers the table and
 * the panel share can ask "is this unit filled in from a merged report" without pulling the overlay
 * and everything it reads into their own import graph.
 */

import type { ReportUnit } from "@atlantis/core-client";

/** Whose own report a laid-over unit came from, and for which turn. */
export type MergedFrom = { factionLabel: string; turn: number };

/** A unit filled in from a merged faction's own report. */
export type MergedUnit = ReportUnit & { mergedFrom: MergedFrom };

/** Where a unit was filled in from, or null for a unit seen the ordinary way. The one reader. */
export function mergedFromOf(unit: ReportUnit): MergedFrom | null {
  return (unit as Partial<MergedUnit>).mergedFrom ?? null;
}

/** The mark's hover, and its accessible description. */
export function mergedMarkTitle(from: MergedFrom): string {
  return `Details from ${from.factionLabel}'s own report for turn ${from.turn}.`;
}

/** The band at the top of the Unit panel. */
export function mergedBandText(from: MergedFrom): string {
  return `From ${from.factionLabel}'s own report for turn ${from.turn}. You can't write orders for this unit.`;
}
