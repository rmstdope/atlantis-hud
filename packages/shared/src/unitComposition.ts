/**
 * Saying how many people a unit holds, and how sure we are of it.
 *
 * A turn report writes a unit's people and its equipment as one undifferentiated list, so the two
 * can only be told apart against the scraped item catalogue. Until a report has been classified -
 * or when the catalogue does not recognise something the unit is carrying - the figure is the
 * leading item group, which is right for most units and wrong for one holding two races.
 *
 * Both presentations live here rather than in a component so the panel and the table cannot drift
 * into describing the same uncertainty two different ways, which is exactly what happened when the
 * table hand-rolled a `~` of its own.
 */

import type { ReportUnit } from "@atlantis/core-client";

/**
 * The full form, for a panel with room to explain itself.
 *
 * A classified unit holding one race reads `99`; one holding two reads `99 (50 gnolls, 49 orcs)`.
 * An unclassified unit reads `about 50`.
 */
export function describeMen(unit: ReportUnit): string {
  const total = unit.men.toLocaleString();
  if (unit.menEstimated) {
    return `about ${total}`;
  }
  if (unit.menByRace.length <= 1) {
    return total;
  }

  const races = unit.menByRace.map((race) => `${race.amount.toLocaleString()} ${race.name}`);
  return `${total} (${races.join(", ")})`;
}

/**
 * The compact form, for a table cell.
 *
 * Zero is written out rather than left blank: a unit of nobody is worth seeing, and a blank cell
 * reads as missing data.
 */
export function describeMenBriefly(unit: ReportUnit): string {
  return unit.men.toLocaleString();
}

/** Why a figure is marked as a guess, for a tooltip. */
export function whyEstimated(unit: ReportUnit): string | undefined {
  return unit.menEstimated
    ? "estimated: the report has not been matched against the item catalogue, so only the first group of people is counted"
    : undefined;
}
