import type { KeyboardEvent, PointerEvent, RefObject } from "react";

import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import {
  COLUMN_LABELS,
  REORDERABLE_COLUMNS,
  dragColumnOrder,
  dropBoundaryX,
  shareOf,
  type ColumnOrder,
  type ColumnShares,
  type UnitColumn
} from "../unitTable";
import { createReorderFeedback, dimColumn } from "./reorderFeedback";
import { guardSelection } from "./selectionGuard";

export type ColumnReorderHandleProps = {
  column: UnitColumn;
  order: ColumnOrder;
  /** The stored widths, resolved to pixels once per gesture - never a measured rectangle. */
  shares: ColumnShares | null;
  /** The table element, for measuring what a share is worth in pixels right now. */
  table: RefObject<HTMLTableElement | null>;
  /** Where the drag feedback is drawn: the positioned overlay sitting over the table. */
  overlay: RefObject<HTMLElement | null>;
  onCommit: (order: ColumnOrder) => void;
};

/**
 * The grip that reorders a column by dragging its header - the horizontal-drag sibling of
 * `ColumnSplitter`, built on the same choreography (window-level pointer listeners, a selection
 * guard, an Escape that answers to the dismiss stack, and a `moved` rule so a click commits
 * nothing) but resolving a whole order rather than a boundary pair: reordering is not a
 * two-column negotiation the way resizing is.
 *
 * Sits at a header's leading edge, separate from `ColumnSplitter`'s trailing-edge resize handle,
 * so neither gesture has to guess what a press meant. `own` carries no handle at all (see
 * `REORDERABLE_COLUMNS`).
 *
 * **The table does not reorder while the drag is happening.** What moves is a drop line and a chip
 * drawn in the overlay, with the dragged column faded - the navigator's choice over reordering the
 * table live, which reads as busy as columns jump under the pointer. It is also why cancelling is
 * trivial: remove the line and the chip and nothing on screen has to be put back.
 *
 * PR #421 showed nothing at all until the pointer came up, which is the defect ah-1owr.3 exists to
 * not repeat: the prospective order was computed on every move and simply never drawn.
 */
export function ColumnReorderHandle({
  column,
  order,
  shares,
  table,
  overlay,
  onCommit
}: ColumnReorderHandleProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const tableElement = table.current;
    const overlayElement = overlay.current;
    const tableWidth = tableElement?.getBoundingClientRect().width ?? 0;
    if (!tableElement || !overlayElement || tableWidth <= 0) {
      return;
    }

    const startX = event.clientX;
    const startOrder = order;
    const index = startOrder.indexOf(column);
    // Widths cannot change during a reorder, so a share is worth the same number of pixels for the
    // whole gesture: resolve it once rather than remeasuring per move.
    const widthPxOf = (each: UnitColumn) => shareOf(each, shares) * tableWidth;
    const tableLeft = tableElement.getBoundingClientRect().left ?? 0;

    const feedback = createReorderFeedback(overlayElement, COLUMN_LABELS[column] ?? column);
    const undim = dimColumn(tableElement, index);
    const releaseSelection = guardSelection();
    // Escape must mean "cancel this drag" even under an open dialog's own capture-phase listener;
    // the dismiss stack is how every such listener already arbitrates who Escape belongs to.
    const layer = pushDismissLayer();
    let prospective: ColumnOrder = startOrder;
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      moved = true;
      prospective = dragColumnOrder(startOrder, column, moveEvent.clientX - startX, widthPxOf);
      feedback.showAt(
        dropBoundaryX(prospective, column, widthPxOf),
        moveEvent.clientX - tableLeft
      );
    };

    /** Whether the gesture actually rearranged anything, rather than merely happening. */
    const changed = () => prospective.some((each, at) => each !== startOrder[at]);

    // `commit` is false for `pointercancel` and for Escape; it is also false for a `pointerup` the
    // pointer never moved for, so a plain click on the grip stores nothing. See `ColumnSplitter`.
    //
    // A drag that moved but never crossed a neighbour is the same case: it resolves to the order
    // it started from, and storing that would quietly turn the shipped order into a preference of
    // its own - which then survives a build that ships a different one.
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onEscape, true);
      feedback.remove();
      undim();
      releaseSelection();
      layer();
      if (commit && moved && changed()) {
        onCommit(prospective);
      }
    };

    const up = () => end(true);
    const cancelDrag = () => end(false);
    const onEscape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === "Escape" && isTopDismissLayer(layer)) {
        keyEvent.stopPropagation();
        end(false);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelDrag);
    document.addEventListener("keydown", onEscape, true);
  };

  // One press is a complete action, so it commits immediately: there is no chip, no line and
  // nothing to cancel.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const index = order.indexOf(column);
    const targetIndex = event.key === "ArrowRight" ? index + 1 : index - 1;
    const target = order[targetIndex];
    if (index === -1 || !target || target === "own" || column === "own") {
      return;
    }
    const swapped = [...order];
    [swapped[index], swapped[targetIndex]] = [swapped[targetIndex], swapped[index]];
    onCommit(swapped);
  };

  return (
    <div
      // A button rather than a `separator`: it does not sit between two things and has no value
      // to report - unlike `ColumnSplitter`, which does both.
      role="button"
      tabIndex={0}
      data-testid={`column-reorder-${column}`}
      aria-label={`Move the ${COLUMN_LABELS[column] ?? column} column`}
      title="Drag to reorder this column"
      className="flex w-3 flex-none cursor-grab touch-none items-center justify-center text-ink-dim hover:text-brass focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden>⠿</span>
    </div>
  );
}

/** Every column but `own` carries a handle - see `REORDERABLE_COLUMNS`'s own doc comment. */
export function isReorderable(column: UnitColumn): boolean {
  return REORDERABLE_COLUMNS.includes(column);
}
