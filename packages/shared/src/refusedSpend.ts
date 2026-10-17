import type { RefusedSpend } from "@atlantis/core-client";
import { silverCauseLabel } from "./silverVocabulary";

/**
 * What an order the game refuses as a whole for want of silver leaves on the SILVER column
 * (`ah-rjz2`): its cost struck through, and one sentence saying why it is not paid. The core has
 * already left the cost out of every figure (`UnitSilver.refused`).
 *
 * Pure, and kept apart from the popup, so it can be tested at all - `packages/shared` has no
 * jsdom (`.cerebro/traps.md`).
 */

/** The struck line: the label the column gives the cause, and the cost it did not take. */
export function refusedSpendLine(spend: RefusedSpend): {
  label: string;
  value: string;
  struck: true;
} {
  return { label: silverCauseLabel(spend.cause), value: `-${spend.cost}`, struck: true };
}

/**
 * Why the struck line was not paid, in the words the designer agreed (`ah-rjz2`, Q1 A and Q5 A):
 * what the unit can draw on, what an earlier order left it, or that it has nothing at all.
 */
export function refusedSpendReason(spend: RefusedSpend): string {
  const study = spend.cause === "studied";
  const order = study ? "STUDY" : "CAST";
  const can =
    spend.available <= 0
      ? "this unit has nothing to draw on"
      : spend.afterSpending
        ? `only ${spend.available} is left to pay it then`
        : `this unit can draw on only ${spend.available}`;
  const tail = study ? " It does not work this month either." : "";
  return `${silverCauseLabel(spend.cause)}: not paid — the ${order} is refused, as it costs ${spend.cost} and ${can}.${tail}`;
}
