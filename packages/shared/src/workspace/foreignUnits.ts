/**
 * The `Other factions` source: every unit in the report that is not yours, and the pin that
 * narrows it to one faction.
 *
 * Every rule the source has lives here rather than in `UnitTableDock`, because `packages/shared`
 * has no jsdom (`ah-nass`): a component test there renders with `renderToStaticMarkup`, which runs
 * no effects and attaches no refs, so a rule inside the component is a rule nothing can pin. See
 * `../testing/README.md`.
 *
 * What the game discloses about a foreign unit is what shapes this module. A unit's owning faction
 * is named only when your Observation *beats* its Stealth - equal Observation shows the unit and
 * not the owner (`rules/stealthobs`) - which is why `ReportUnit.factionId` is nullable and why a
 * `hidden` pin has a real group of units to gather.
 */

import type { ParsedReport, ReportUnit } from "@atlantis/core-client";
import { type FactionPin, type UnitSource } from "./unitSource";

/** Every unit in the report that is not yours, in report order. The `Other factions` source. */
export function foreignUnitsIn(parsed: ParsedReport): ReportUnit[] {
  return parsed.regions.flatMap((region) => region.units.filter((unit) => !unit.own));
}

/**
 * Whether the report tells you who owns this unit.
 *
 * `factionId` and `factionName` are independently nullable in the model, so either being null is
 * enough to make the owner unknown. `pinForRow` and the table's Faction cell must agree on this
 * test; they must not drift apart.
 */
function ownerConcealed(unit: ReportUnit): boolean {
  return unit.factionId === null || unit.factionName === null;
}

/**
 * The rows a pin leaves. The same array back, **by identity**, when nothing is pinned.
 *
 * The identity is the contract, not an optimisation detail: the dock memoises on it, and a fresh
 * array every render would re-sort and re-filter every row on every keystroke in the filter box.
 */
export function pinnedRows(
  units: readonly ReportUnit[],
  pin: FactionPin | null
): readonly ReportUnit[] {
  if (pin === null) {
    return units;
  }
  if (pin.kind === "hidden") {
    return units.filter(ownerConcealed);
  }
  return units.filter((unit) => !ownerConcealed(unit) && unit.factionId === pin.factionId);
}

/**
 * A pin survives a turn load and does not survive leaving the source.
 *
 * Returns the pin when `source.kind === "foreign"`, and null otherwise. It is deliberately not a
 * function of the report: the pin is a faction *number*, and faction numbers are stable across
 * turns, so the same pin means the same faction next month.
 */
export function pinStillApplies(source: UnitSource, pin: FactionPin | null): FactionPin | null {
  return source.kind === "foreign" ? pin : null;
}

/**
 * How a pin reads on the strip: `Thane's Ring (10)`, or `Faction not shown`.
 *
 * Its sentence-middle twin, `pinHintLabel`, lives in `unitSource.ts` instead: `headerFor` needs it
 * and this module already imports that one, so declaring it here would be a cycle.
 */
export function pinLabel(pin: FactionPin): string {
  return pin.kind === "hidden" ? "Faction not shown" : `${pin.factionName} (${pin.factionId})`;
}

/** The pin a click on a row's faction cell would set, or null when that cell pins nothing. */
export function pinForRow(unit: ReportUnit): FactionPin | null {
  if (unit.own) {
    // Own units never appear in this source anyway, and there is no list of them to narrow.
    return null;
  }
  const { factionId, factionName } = unit;
  if (factionId === null || factionName === null) {
    return { kind: "hidden" };
  }
  return { kind: "faction", factionId, factionName };
}

/**
 * The line the `Other factions` source shows when it has no rows to draw, and the label of the
 * way out beside it. Null when there are rows.
 */
export function foreignEmptyLine(args: {
  hasReport: boolean;
  /** Foreign units in the report, before the pin. */
  total: number;
  /** After the pin, before the filter. */
  pinned: number;
  /** After the filter. */
  shown: number;
  pin: FactionPin | null;
}): { text: string; showAll: string | null } | null {
  if (!args.hasReport) {
    return { text: "No report loaded.", showAll: null };
  }
  if (args.total === 0) {
    return { text: "No other faction's units in this turn's report.", showAll: null };
  }
  if (args.pinned === 0 && args.pin !== null) {
    const text =
      args.pin.kind === "hidden"
        ? "No unit is hiding its faction in this turn's report."
        : `${pinLabel(args.pin)} has no units in this turn's report.`;
    return { text, showAll: `Show all ${args.total}` };
  }
  if (args.shown === 0) {
    return { text: "No unit matches that filter.", showAll: null };
  }
  return null;
}
