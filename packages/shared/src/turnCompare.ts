import type { ParsedReport } from "@atlantis/core-client";

/**
 * A second, read-only turn held beside the working one, so the diff view (ah-jg6.4) has something
 * to diff against.
 *
 * Nothing here ever touches `parsed`, `rawReport`, `ordersDocument` or any of the working turn's
 * state - a comparison turn is a sibling to those, not a replacement for them. Loading one into the
 * working slots would make the next autosave silently overwrite the *compared* turn's stored draft,
 * in an app with no undo.
 */
export type ComparisonTurn = {
  key: { factionId: string; turnNumber: number };
  parsed: ParsedReport;
};

/**
 * What clicking a turn in the picker does to the current comparison.
 *
 * The working turn is always one side of the pair, so clicking it does nothing (returning `null`
 * is a no-op close, not an error - there is nothing sensible to compare a turn against itself).
 * Clicking the turn already being compared turns the comparison off; clicking any other turn starts
 * or switches to it. One click, one meaning, whatever the current state.
 */
export function toggleComparison(
  current: number | null,
  clicked: number,
  working: number
): number | null {
  if (clicked === working) {
    return null;
  }
  if (clicked === current) {
    return null;
  }
  return clicked;
}

/**
 * The Turn chip's label, split into the parts the header styles differently: the working turn
 * always, and the compared turn - in brass - only when a comparison is on.
 */
export function comparisonChipLabel(
  workingTurn: number,
  comparedTurn: number | null
): { working: string; compared: string | null } {
  return {
    working: String(workingTurn),
    compared: comparedTurn === null ? null : String(comparedTurn)
  };
}
