import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import {
  DEFAULT_COLUMN_WIDTH_PX,
  dragColumnBoundary,
  type ColumnWidths,
  type UnitColumn
} from "../unitTable";
import { guardSelection } from "./selectionGuard";

/** One keyboard step, in pixels - about a third of the narrowest default column. */
const STEP_PX = 8;

export type ColumnSplitterProps = {
  /** The column to the handle's left; growing it is a positive drag. */
  left: UnitColumn;
  /** The column to the handle's right; it gives up whatever the left column gains. */
  right: UnitColumn;
  /** The two `<col>` elements the handle resizes; read at gesture start, written to mid-drag. */
  columns: RefObject<Partial<Record<UnitColumn, HTMLTableColElement | null>>>;
  /** The stored widths, so a gesture starts from what is actually on screen. */
  widths: ColumnWidths | null;
  /** Called once per finished gesture: pointerup, one arrow press, or a double-click reset. */
  onCommit: (widths: ColumnWidths) => void;
};

/** The grip pill's classes for its current state - identical vocabulary to `RailSplitter`'s. */
function gripClassName(dragging: boolean, atLimit: boolean): string {
  const base = "h-4 w-1 rounded-full transition-all";
  if (atLimit) {
    return `${base} bg-amber-400`;
  }
  if (dragging) {
    return `${base} bg-brass`;
  }
  return `${base} bg-edge group-hover:bg-brass`;
}

/**
 * The drag handle sitting between two adjacent column headers, moving pixels from one to the
 * other without changing the table's own width.
 *
 * The horizontal sibling of `RailSplitter`, and built to the same choreography - pointer capture,
 * an Escape that answers to the dismiss stack, a selection guard against WebKit's drag-anchored
 * text selection - but resolving a pair rather than one side against a fixed total, because that
 * is what a column boundary is: `dragColumnBoundary` (`unitTable.ts`) is the arithmetic this
 * component is a thin shell over, exactly as `dragRailWidth` is for `RailSplitter`.
 *
 * Widths are plain CSS pixels, not rem: a table column has no reason to track the root font size,
 * and every width this file touches - `DEFAULT_COLUMN_WIDTH_PX`, the stored record, the drag delta
 * - is already in the same unit, so nothing here converts.
 */
export function ColumnSplitter({ left, right, columns, widths, onCommit }: ColumnSplitterProps) {
  const widthOf = (column: UnitColumn) => widths?.[column] ?? DEFAULT_COLUMN_WIDTH_PX[column];

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const leftCol = columns.current?.[left];
    const rightCol = columns.current?.[right];
    if (!leftCol || !rightCol) {
      return;
    }
    const grip = event.currentTarget.firstElementChild as HTMLElement | null;
    const startX = event.clientX;
    const leftStart = leftCol.getBoundingClientRect().width;
    const rightStart = rightCol.getBoundingClientRect().width;
    const startLeftWidth = leftCol.style.width;
    const startRightWidth = rightCol.style.width;

    const releaseSelection = guardSelection();
    const layer = pushDismissLayer();
    let committed: { left: number; right: number } = { left: leftStart, right: rightStart };
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      moved = true;
      const result = dragColumnBoundary(leftStart, rightStart, moveEvent.clientX - startX);
      committed = result;
      leftCol.style.width = `${result.left}px`;
      rightCol.style.width = `${result.right}px`;
      if (grip) {
        grip.className = gripClassName(true, result.atLimit);
      }
    };

    const cancel = () => {
      leftCol.style.width = startLeftWidth;
      rightCol.style.width = startRightWidth;
    };

    // See `RailSplitter.onPointerDown` for why `commit` is false on cancel/Escape and on a
    // pointerup that never moved - a plain click must not turn the default width into a stored
    // one of the same value.
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onEscape, true);
      releaseSelection();
      layer();
      if (grip) {
        grip.className = gripClassName(false, false);
      }
      if (commit && moved) {
        onCommit({ [left]: committed.left, [right]: committed.right });
      } else {
        cancel();
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const deltaPx = event.key === "ArrowRight" ? STEP_PX : -STEP_PX;
      const result = dragColumnBoundary(widthOf(left), widthOf(right), deltaPx);
      onCommit({ [left]: result.left, [right]: result.right });
    } else if (event.key === "Enter") {
      onCommit({ [left]: DEFAULT_COLUMN_WIDTH_PX[left], [right]: DEFAULT_COLUMN_WIDTH_PX[right] });
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${left} column`}
      tabIndex={0}
      data-testid={`column-splitter-${left}-${right}`}
      aria-valuemin={0}
      aria-valuenow={widthOf(left)}
      className="group absolute inset-y-0 -right-1.5 z-10 flex w-3 flex-none touch-none cursor-col-resize items-center justify-center pointer-events-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() =>
        onCommit({ [left]: DEFAULT_COLUMN_WIDTH_PX[left], [right]: DEFAULT_COLUMN_WIDTH_PX[right] })
      }
    >
      <div className={gripClassName(false, false)} />
    </div>
  );
}
