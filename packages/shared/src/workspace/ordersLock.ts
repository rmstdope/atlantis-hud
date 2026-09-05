import type { ReportUnit } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { formBlockFor, formedAlias } from "../ordersDocument";

/**
 * Why the editor is refusing an edit, and the words it says about it.
 *
 * Pure functions of their arguments, kept out of `OrdersPanel` so the decision and its wording can
 * be tested directly: `packages/shared` renders components with `renderToStaticMarkup`, which runs
 * no effects and observes very little (ah-nass, `testing/README.md`).
 */

/** Why the editor is refusing an edit. Each reason needs its own wording to be any use. */
export type Lock =
  | { kind: "no-unit" }
  | { kind: "foreign"; factionName: string; factionId: string | null }
  | { kind: "not-in-turn"; lastSeenTurn: number | null }
  | { kind: "no-form-block"; alias: string };

/** The selected unit as a unit this month's `FORM` orders create, when it is one. */
export type FormedSelection = {
  /** The `NEW n` alias, as the orders write it. */
  alias: string;
  /** The reported unit whose block holds the `FORM`, or `null` when the document has no such block. */
  formedBy: string | null;
};

/**
 * The selected id as a formed selection, or `null` when it names a unit the report shows.
 *
 * `regionUnitIds` is the reported units of the hex on screen. Answering `formedBy: null` is a real
 * answer and not a failure: the forecast is 300ms behind the document, so a `new-1` selection can
 * outlive the `FORM` that created it by exactly that long.
 */
export function formedSelectionFor(
  document: string,
  selectedUnitId: string | null,
  regionUnitIds: ReadonlySet<string>
): FormedSelection | null {
  if (selectedUnitId === null) {
    return null;
  }
  const alias = formedAlias(selectedUnitId);
  if (alias === null) {
    return null;
  }
  return { alias, formedBy: formBlockFor(document, alias, regionUnitIds)?.unitId ?? null };
}

/**
 * The refusal for this selection, or `null` when the unit can be ordered.
 *
 * A unit whose block the document does not carry yet is *not* refused: the report's orders template
 * is a convenience rather than a permission list, and the block is created on the first keystroke
 * (ah-0gs8, `ordersDocument.applyUnitOrders`).
 */
export function lockFor(
  unit: ReportUnit | null,
  hex: HexNode | null,
  formed: FormedSelection | null
): Lock | null {
  // Answered first, because `unit` can be `null` while a formed unit is selected: the forecast is
  // debounced behind the document, so between deleting the last order and the next forecast the row
  // is gone and the `FORM` block is still there. A formed unit needs no ownership or staleness test
  // either - the core mints it owned, in its creator's hex.
  if (formed) {
    return formed.formedBy === null ? { kind: "no-form-block", alias: formed.alias } : null;
  }
  if (!unit) {
    return { kind: "no-unit" };
  }
  if (!unit.own) {
    return {
      kind: "foreign",
      factionName: unit.factionName ?? "another faction",
      factionId: unit.factionId
    };
  }
  // A unit carried over from an earlier turn cannot be ordered: you cannot command what you cannot
  // presently see, and the server would reject orders for it.
  if (hex?.knowledge === "stale") {
    return { kind: "not-in-turn", lastSeenTurn: hex.lastSeenTurn };
  }
  return null;
}

/** The badge and lines the locked panel shows. */
export function describeLock(lock: Lock, ownFaction: string): { badge: string; lines: string[] } {
  switch (lock.kind) {
    case "no-unit":
      return { badge: "No unit", lines: ["Select a unit to write its orders."] };
    case "foreign":
      return {
        badge: "Read only",
        lines: [
          `This unit belongs to ${lock.factionName}${lock.factionId ? ` (${lock.factionId})` : ""}.`,
          `You can only write orders for units in ${ownFaction}.`
        ]
      };
    case "not-in-turn":
      return {
        badge: "Not in this turn",
        lines: [
          lock.lastSeenTurn === null
            ? "This unit is not in the current report."
            : `This unit was last seen on turn ${lock.lastSeenTurn} and is not in the current report.`,
          "Orders can only be written for units present in the current turn."
        ]
      };
    case "no-form-block":
      return {
        badge: "No FORM order",
        lines: [
          `The orders no longer carry a FORM ${lock.alias} that creates this unit in this hex.`,
          `Select the unit that should create it and write a FORM ${lock.alias} order in its orders.`
        ]
      };
  }
}
