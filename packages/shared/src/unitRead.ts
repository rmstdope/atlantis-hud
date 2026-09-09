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

import type { ReportUnit } from "@atlantis/core-client";
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
