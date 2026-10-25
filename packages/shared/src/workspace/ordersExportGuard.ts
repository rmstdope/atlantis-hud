import type { ValidationMarker } from "./validationInputs";

/**
 * What exporting the orders does while the orders checker has found errors (ah-koleq).
 *
 * Warn, never refuse: the navigator chose that over blocking the export, so a checker that may be
 * wrong never stands between a player and a PBEM deadline. The rule is kept here, away from the
 * shell, because the shell's half of it - waiting on a check that is still running - is an effect,
 * and effects cannot be tested in this package (`testing/README.md`).
 */

/** Which of the two order exports was pressed. "long" puts the unit descriptions back in. */
export type OrdersExportKind = "plain" | "long";

export type OrdersExportStep = { kind: "wait" } | { kind: "save" } | { kind: "confirm"; errorCount: number };

/**
 * `checked` says whether a check for the orders on screen has finished - successfully or not; a
 * failed one leaves the last finished count, which is what `errorCount` then is. Until one has,
 * the export waits, so a just-made or just-fixed error is never counted wrongly.
 *
 * `errorCount` is errors only, across all the orders: warnings alone never ask.
 */
export function ordersExportStep(checked: ValidationMarker, errorCount: number): OrdersExportStep {
  if (checked === "pending") {
    return { kind: "wait" };
  }
  return errorCount > 0 ? { kind: "confirm", errorCount } : { kind: "save" };
}

/** The dialog's title and body, exactly as agreed in the bead's acceptance. */
export function ordersExportWarningText(errorCount: number): { title: string; body: string } {
  if (errorCount === 1) {
    return {
      title: "Export orders with 1 error?",
      body: "The orders checker found 1 error. The game may reject that order or read it differently from what you meant. You can still export the orders as they are."
    };
  }
  return {
    title: `Export orders with ${errorCount} errors?`,
    body: `The orders checker found ${errorCount} errors. The game may reject those orders or read them differently from what you meant. You can still export the orders as they are.`
  };
}

/**
 * Where Tab (or Shift+Tab) goes among `count` buttons from the one at `index`, wrapping at both
 * ends so focus stays inside the dialog. `index` -1 means focus is on none of them.
 */
export function wrappedFocusIndex(index: number, count: number, backwards: boolean): number {
  if (index < 0) {
    return backwards ? count - 1 : 0;
  }
  return (index + (backwards ? count - 1 : 1)) % count;
}
