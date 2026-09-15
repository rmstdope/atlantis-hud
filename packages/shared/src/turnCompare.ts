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
 * The working turn is always one side of the pair, so clicking it changes nothing - it returns
 * `current` unchanged, whatever that is. There is nothing sensible to compare a turn against
 * itself, and if a comparison is already active, clicking the working row must not be a back-door
 * way to clear it. Clicking any other turn compares against it - the one already compared
 * included, which simply keeps it. A click never turns a comparison off: that is what dismissing
 * the Changes dialog does (the navigator, 2026-09-15, replacing ah-jg6.3's click-again-to-stop).
 */
export function toggleComparison(
  current: number | null,
  clicked: number,
  working: number
): number | null {
  return clicked === working ? current : clicked;
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
