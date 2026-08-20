import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import {
  COLUMN_LABELS,
  COLUMN_MIN_PX,
  DEFAULT_COLUMN_SHARES,
  dragColumnShare,
  shareOf,
  type ColumnShares,
  type UnitColumn
} from "../unitTable";
import { guardSelection } from "./selectionGuard";

/** One keyboard step, in pixels - about a quarter of the narrowest default column. */
const STEP_PX = 8;

export type ColumnSplitterProps = {
  /** The column to the handle's left; growing it is a positive drag. */
  left: UnitColumn;
  /** The column to the handle's right; it gives up whatever the left column gains. */
  right: UnitColumn;
  /** The two `<col>` elements the handle resizes; written to directly mid-drag. */
  columns: RefObject<Partial<Record<UnitColumn, HTMLTableColElement | null>>>;
  /** The table element, for measuring what a share is worth in pixels right now. */
  table: RefObject<HTMLTableElement | null>;
  /** The stored shares, which every gesture starts from - never a measured rectangle. */
  shares: ColumnShares | null;
  /** Called once per finished gesture: pointerup, one arrow press, or a reset. */
  onCommit: (shares: ColumnShares) => void;
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
 * The drag handle sitting between two adjacent column headers, moving share from one to the other
 * without changing the table's own width.
 *
 * The horizontal sibling of `RailSplitter`, and built to the same choreography - a selection guard
 * against WebKit's drag-anchored text selection, an Escape that answers to the dismiss stack, and
 * a commit only for a gesture that actually moved.
 *
 * Two things here are the whole point of ah-1owr.2, and neither is obvious:
 *
 * - **Every gesture starts from the *stored* shares, never from a measured rectangle.** The
 *   browser has already scaled the rendered widths to fit a 100%-wide table, so reading them back
 *   and storing them re-quantises through layout on every drag and the stored shape walks away
 *   from what is on screen. Starting from the stored share makes a drag exactly reversible.
 * - **`minShare` is computed once, at `pointerdown`**, from the table width measured then.
 *   Recomputing it per move would let the floor move under the gesture.
 */
export function ColumnSplitter({
  left,
  right,
  columns,
  table,
  shares,
  onCommit
}: ColumnSplitterProps) {
  /** The table's width right now, or 0 when it has not been laid out (or is being rendered
   *  without a DOM at all, as the unit tests do). */
  const measuredWidth = () => table.current?.getBoundingClientRect().width ?? 0;

  /** What `COLUMN_MIN_PX` is worth as a share of the table as it stands right now, or 0. */
  const measuredMinShare = () => {
    const width = measuredWidth();
    return width > 0 ? COLUMN_MIN_PX / width : 0;
  };

  const resetPair = () =>
    onCommit({ [left]: DEFAULT_COLUMN_SHARES[left], [right]: DEFAULT_COLUMN_SHARES[right] });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const leftCol = columns.current?.[left];
    const rightCol = columns.current?.[right];
    const tableWidth = table.current?.getBoundingClientRect().width ?? 0;
    if (!leftCol || !rightCol || tableWidth <= 0) {
      return;
    }
    const grip = event.currentTarget.firstElementChild as HTMLElement | null;
    const startX = event.clientX;
    const minShare = COLUMN_MIN_PX / tableWidth;
    const leftStart = shareOf(left, shares);
    const rightStart = shareOf(right, shares);
    const startLeftWidth = leftCol.style.width;
    const startRightWidth = rightCol.style.width;

    const releaseSelection = guardSelection();
    // Escape must mean "cancel this drag" even under an open dialog's own capture-phase listener;
    // the dismiss stack is how every such listener already arbitrates who Escape belongs to.
    const layer = pushDismissLayer();
    let committed = { left: leftStart, right: rightStart };
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      moved = true;
      const result = dragColumnShare(
        leftStart,
        rightStart,
        (moveEvent.clientX - startX) / tableWidth,
        minShare
      );
      committed = result;
      leftCol.style.width = `${result.left * 100}%`;
      rightCol.style.width = `${result.right * 100}%`;
      if (grip) {
        grip.className = gripClassName(true, result.atLimit);
      }
    };

    const cancel = () => {
      leftCol.style.width = startLeftWidth;
      rightCol.style.width = startRightWidth;
    };

    // `commit` is false for `pointercancel` and for Escape; it is also false for a `pointerup` the
    // pointer never moved for, so a plain click on the grip cannot quietly turn the shipped shape
    // into a stored preference of the same size. See `PanelSplitter`.
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
      const width = measuredWidth();
      if (width <= 0) {
        // The table has not been laid out, so a step has no length. Doing nothing is right: the
        // alternative is stepping by a share computed against a width of zero.
        return;
      }
      const minShare = COLUMN_MIN_PX / width;
      const deltaShare = (event.key === "ArrowRight" ? STEP_PX : -STEP_PX) / width;
      const result = dragColumnShare(
        shareOf(left, shares),
        shareOf(right, shares),
        deltaShare,
        minShare
      );
      onCommit({ [left]: result.left, [right]: result.right });
    } else if (event.key === "Enter") {
      event.preventDefault();
      resetPair();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${COLUMN_LABELS[left] ?? left} column`}
      tabIndex={0}
      data-testid={`column-splitter-${left}-${right}`}
      // The floor is a pixel one, so on a narrow enough table a column can legitimately render
      // below it and a bare `COLUMN_MIN_PX / width` would exceed `aria-valuenow` - which breaks
      // the ARIA range constraint rather than describing anything. Report the lower of the two.
      aria-valuemin={Math.min(
        Math.round(measuredMinShare() * 100),
        Math.round(shareOf(left, shares) * 100)
      )}
      aria-valuenow={Math.round(shareOf(left, shares) * 100)}
      aria-valuemax={100}
      // `right-0`, not the half-overhang `RailSplitter` uses: each header cell is `sticky z-10`,
      // so it is its own stacking context and the *next* cell - later in the DOM, same z - paints
      // its opaque background over anything of ours that reaches into it. A handle overhanging the
      // boundary is therefore visible but unclickable; keeping it inside its own cell is what
      // makes the drag reachable at all.
      className="group absolute inset-y-0 right-0 z-10 flex w-3 flex-none touch-none cursor-col-resize items-center justify-center pointer-events-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={resetPair}
    >
      <div className={gripClassName(false, false)} />
    </div>
  );
}
