import type { ReportUnit } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";

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
  | { kind: "not-in-turn"; lastSeenTurn: number | null };

/**
 * The refusal for this selection, or `null` when the unit can be ordered.
 *
 * A unit whose block the document does not carry yet is *not* refused: the report's orders template
 * is a convenience rather than a permission list, and the block is created on the first keystroke
 * (ah-0gs8, `ordersDocument.applyUnitOrders`).
 */
export function lockFor(unit: ReportUnit | null, hex: HexNode | null): Lock | null {
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
  }
}
