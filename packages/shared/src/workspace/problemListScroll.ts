import type { OrderDiagnostic } from "@atlantis/core-client";

/**
 * The orders panel's problem list, measured (ah-nup4).
 *
 * The list shrinks to as little as one row and scrolls so the editor above keeps its three lines;
 * these are the rules for what it says about the rows it is hiding and where it scrolls to. Pure,
 * because `packages/shared` has no DOM to test effects in: `ProblemList` measures and applies.
 */

/** Sub-pixel rounding allowance, so a list scrolled to its end does not still claim "1 more ↓". */
const ROUNDING_PX = 1;

/**
 * How many rows end below the list's visible bottom - a partly shown row counts as hidden.
 *
 * `rowBottoms` and `visibleBottom` are in the list's own scrolled coordinates (a row's
 * `offsetTop + offsetHeight`; the list's `scrollTop + clientHeight`).
 */
export function rowsBelow(rowBottoms: readonly number[], visibleBottom: number): number {
  return rowBottoms.filter((bottom) => bottom > visibleBottom + ROUNDING_PX).length;
}

/**
 * The `scrollTop` that shows a row with the least movement, the way `block: "nearest"` would -
 * computed rather than asked of `scrollIntoView`, which would scroll every ancestor too.
 *
 * A row taller than the view shows its top, where its line number and token are.
 */
export function revealRow(
  row: { top: number; bottom: number },
  view: { scrollTop: number; height: number }
): number {
  if (row.top < view.scrollTop || row.bottom - row.top > view.height) {
    return row.top;
  }
  if (row.bottom > view.scrollTop + view.height) {
    return row.bottom - view.height;
  }
  return view.scrollTop;
}

/**
 * Which of this unit's problems the F8 walk stands on.
 *
 * The walk's targets are re-based to the same block lines `diagnosticsForUnit` hands the panel
 * (`diagnosticNav.ts`), so a place and a code identify the row; they are different objects.
 */
export function walkedRowIndex(
  problems: readonly OrderDiagnostic[],
  walked: OrderDiagnostic | null
): number | null {
  if (walked === null) {
    return null;
  }
  const index = problems.findIndex(
    (candidate) =>
      candidate.code === walked.code &&
      candidate.lineStart === walked.lineStart &&
      candidate.columnStart === walked.columnStart
  );
  return index === -1 ? null : index;
}

/**
 * What the list's reveal effect is keyed on: a string, so a re-validation that leaves the walk on
 * the same problem - a fresh object every time - does not scroll a list the player moved by hand.
 */
export function walkedKey(walked: OrderDiagnostic | null): string | null {
  return walked === null
    ? null
    : `${walked.code}:${walked.lineStart ?? "-"}:${walked.columnStart ?? "-"}`;
}
