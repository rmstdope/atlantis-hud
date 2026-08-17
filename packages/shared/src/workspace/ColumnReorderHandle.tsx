import type { KeyboardEvent, PointerEvent } from "react";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import { dragColumnOrder, REORDERABLE_COLUMNS, type ColumnOrder, type ColumnWidths, type UnitColumn } from "../unitTable";
import { guardSelection } from "./selectionGuard";

export type ColumnReorderHandleProps = {
  column: UnitColumn;
  order: ColumnOrder;
  widths: ColumnWidths | null;
  onCommit: (order: ColumnOrder) => void;
};

/**
 * The grip that reorders a column by dragging its header - the horizontal-drag sibling of
 * `ColumnSplitter`, built on the same choreography (pointer capture, an Escape that answers to the
 * dismiss stack, a selection guard) but resolving a full order rather than a boundary pair, because
 * that is what `dragColumnOrder` (`unitTable.ts`) hands back: reordering is not a two-column
 * negotiation the way resizing is, it is "where does the whole row of columns stand now."
 *
 * Sits at a header's leading edge, separate from `ColumnSplitter`'s trailing-edge resize handle -
 * two different gestures on two different edges of the same cell, so neither has to guess which
 * one a press meant. `own` carries no handle at all (see `REORDERABLE_COLUMNS`): a 24px marker
 * column has no room for a grip, and nothing sensible to trade places with either.
 */
export function ColumnReorderHandle({ column, order, widths, onCommit }: ColumnReorderHandleProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startOrder = order;

    const releaseSelection = guardSelection();
    const layer = pushDismissLayer();
    let committed: ColumnOrder = startOrder;
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      moved = true;
      committed = dragColumnOrder(startOrder, column, moveEvent.clientX - startX, widths);
    };

    // A press that never moved is a click, not a drag - nothing to commit, same posture
    // `ColumnSplitter`'s own pointer handler takes with a plain click on its grip.
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onEscape, true);
      releaseSelection();
      layer();
      if (commit && moved) {
        onCommit(committed);
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const index = order.indexOf(column);
    const targetIndex = event.key === "ArrowRight" ? index + 1 : index - 1;
    const target = order[targetIndex];
    if (!target || target === "own") {
      return;
    }
    const swapped = [...order];
    [swapped[index], swapped[targetIndex]] = [swapped[targetIndex], swapped[index]];
    onCommit(swapped);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`column-reorder-${column}`}
      aria-label={`Move the ${column} column`}
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
  return (REORDERABLE_COLUMNS as readonly UnitColumn[]).includes(column);
}
