/**
 * What a unit's pane, table and ledger say about a unit whose line the parser could not fully read.
 *
 * A report wrapped at a narrower column than the game's own leaves a unit's line cut short, and
 * everything after the break - items, `Weight`, `Capacity`, `Skills` - never reaches the model
 * (`UnitRead`, `crates/core/src/report/model.rs`). Every surface that would otherwise draw a zero,
 * a `none` or a missing row for such a unit reads from here instead, so the three cannot drift into
 * describing the same absence three different ways.
 *
 * Pure on purpose: `packages/shared` has no jsdom (ah-nass), so a string is only testable when it
 * lives outside a component.
 */

import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { itemEntryId, type GameDataIndex } from "./gameData";

/**
 * The single phrase for a figure the report never reached, everywhere it appears.
 *
 * One phrase and not two: "not read" was considered at the UX stage and dropped, because in a
 * Silver column it could be misread as "you have not read it".
 */
export const NOT_KNOWN = "not known";

/** Whether the whole of this unit's line was read. True for every unit in every healthy report. */
export function unitWasFullyRead(unit: ReportUnit): boolean {
  return unit.read === "complete";
}

/** The banner sentence for a unit whose line was cut short, or null for one that was read. */
export function unreadBannerText(unit: ReportUnit): string | null {
  switch (unit.read) {
    case "nothing":
      return (
        "This unit was not read. Its line in the turn report was not in a shape Atlantis HUD " +
        "could read, so nothing it holds is known and no advice is given for it."
      );
    case "partial":
      return (
        "Part of this unit was not read. Its line in the turn report was not in a shape Atlantis " +
        "HUD could read, so what it holds is not fully known and no advice is given for it."
      );
    default:
      return null;
  }
}

/**
 * A lower bound on what an unread unit is carrying, from the items that *were* read.
 *
 * Null when the catalogue has not loaded, when nothing was read, or when the floor works out at 0 -
 * "0 or more" is true of every unit alive and so says nothing. An item the catalogue does not know
 * contributes nothing: a floor stays a floor when a term is dropped. Silver needs no special case,
 * `data/items` giving `silver [SILV], weight 0`.
 */
export function weightFloor(unit: ReportUnit, index: GameDataIndex | null): number | null {
  if (index === null) {
    return null;
  }

  let total = 0;
  for (const item of unit.items) {
    const id = itemEntryId(index, item.tag);
    const detail = id === null ? null : index.detailOf(id);
    if (detail !== null && detail.kind === "item") {
      total += detail.weight * item.amount;
    }
  }
  return total === 0 ? null : total;
}

/** How many of these rows lost part or all of what their unit was carrying. */
export function unreadCount(units: readonly ReportUnit[]): number {
  return units.filter((unit) => !unitWasFullyRead(unit)).length;
}

/**
 * The amber line above the units table, or null when the whole list was read.
 *
 * `total` is the list, not what a filter left on screen: the line warns about the list, so a filter
 * that hides every affected row leaves it up and unchanged (the agreed record says so by name).
 */
export function unreadLine(unread: number, total: number): string | null {
  if (unread === 0) {
    return null;
  }
  return `⚠ ${unread} of these ${total} unit${total === 1 ? "" : "s"} could not be read. Anything counted here is a floor.`;
}

/**
 * The report never reached this unit's silver, so `held` is a zero nobody measured.
 *
 * Asked of the forecast rather than of the unit's items, because the row a table draws is a
 * `PreviewedUnit` whose items already carry this month's gifts: a unit given silver by a
 * neighbour would look as though its own had been read.
 */
export function silverWasNeverRead(silver: UnitSilver | null | undefined): boolean {
  return silver?.doubt === "silver-never-read";
}

/** This unit's month cannot be added up because its line was cut short - either way round. */
export function monthLostToAnUnreadLine(silver: UnitSilver | null | undefined): boolean {
  return silver?.doubt === "silver-never-read" || silver?.doubt === "unit-line-cut-short";
}

/**
 * How the silver notes open: the whole line was lost, or part of it was.
 *
 * The agreed record writes the two sentences out in full and they differ only here, so the clause
 * is shared and the rest of each sentence is written once.
 *
 * `complete` is unreachable by construction - the core raises these doubts only for a unit whose
 * line was cut short - and it falls to the whole-line clause rather than to "Part of", which would
 * be false of a unit that was read.
 */
export function unreadLineClause(unit: ReportUnit): string {
  return unit.read === "partial"
    ? "Part of this unit's line in the turn report"
    : "This unit's line in the turn report";
}

/**
 * A figure that is the most it can be, in the words the designer agreed: `60 at most`.
 *
 * Takes the already-formatted text rather than a number, so it composes with both formatters that
 * reach it - the hover's bare `String(amount)` and the Silver cell's own.
 */
export function atMost(text: string): string {
  return `${text} at most`;
}

/**
 * Whether this unit's month-end figure is a ceiling rather than a forecast, because a unit in the
 * same hex whose line was cut short may be drawing on a pool it draws on too (`ah-0n2k.1`).
 *
 * Either half bounds the total. The core sets neither field where the figure is not a number, so
 * this never fires on a unit whose month reads `not known`.
 */
export function shareBoundedByAnUnreadUnit(silver: UnitSilver | null | undefined): boolean {
  return (silver?.incomeInTimeAtMost ?? false) || (silver?.lateIncomeAtMost ?? false);
}
