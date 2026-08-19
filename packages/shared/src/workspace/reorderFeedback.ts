/**
 * What a column reorder shows while it is happening.
 *
 * PR #421 built the reorder gesture with none of this: the order was recomputed on every
 * `pointermove` and only shown on `pointerup`, so a player dragging a column could not see where
 * it would land (ah-1owr.3). The arithmetic was never the defect - showing its answer was.
 *
 * It lives in a module of its own, and writes to the elements directly rather than through React
 * state, for the same reason `ColumnSplitter` writes `style.width` mid-drag: a state update per
 * pointermove makes the gesture stutter, and here it would also reorder the table under the
 * pointer - which was the rejected option A.
 */

/** How much of the dragged column is left showing while it is in the player's hand. */
const DRAGGED_OPACITY = "0.4";

export type ReorderFeedback = {
  /**
   * Draws (or moves) the drop line and the chip: the line at the boundary the column will land
   * on, the chip under the pointer. Both appear on the first call, so nothing is on screen for a
   * press that never moved.
   */
  showAt(boundaryX: number, pointerX: number): void;
  /** Takes both away. Safe to call twice - `pointerup` and `pointercancel` can both arrive. */
  remove(): void;
};

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * The drop line and the drag chip, drawn in a positioned overlay over the table.
 *
 * The overlay is a sibling of the `<table>`, never a child of `<thead>`: a positioned element
 * inside a `table-fixed` header is at the mercy of table layout, and every row must stay exactly
 * `rowHeightAt(interfaceSize)` tall or the windowing misaligns.
 */
export function createReorderFeedback(overlay: HTMLElement, label: string): ReorderFeedback {
  const create = (overlay.ownerDocument ?? document).createElement.bind(
    overlay.ownerDocument ?? document
  );
  let line: HTMLElement | null = null;
  let chip: HTMLElement | null = null;

  const draw = () => {
    line = create("div") as HTMLElement;
    line.className = "pointer-events-none absolute top-0 bottom-0 w-0.5 bg-brass";
    line.dataset.testid = "column-drop-line";

    chip = create("div") as HTMLElement;
    chip.className =
      "pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded border border-brass bg-panel px-1 text-pane-sm text-ink shadow";
    chip.dataset.testid = "column-drag-chip";
    chip.textContent = label;

    overlay.appendChild(line);
    overlay.appendChild(chip);
  };

  return {
    showAt(boundaryX, pointerX) {
      if (!line || !chip) {
        draw();
      }
      const width = overlay.getBoundingClientRect().width;
      line!.style.left = `${boundaryX}px`;
      // The chip is centred on this coordinate (`-translate-x-1/2`), so clamping the coordinate
      // to the table alone would still let half the chip hang over each edge. Its own half-width
      // is the inset - and zero when it has not been laid out, which leaves the old behaviour.
      const half = (chip!.offsetWidth ?? 0) / 2;
      chip!.style.left = `${clamp(pointerX, Math.min(half, width / 2), Math.max(width - half, width / 2))}px`;
    },
    remove() {
      line?.remove();
      chip?.remove();
      line = null;
      chip = null;
    }
  };
}

/**
 * Fades the column being dragged, header and cells alike, and answers how to put it back.
 *
 * `index` is the column's position in the order as drawn, counted from zero - what
 * `order.indexOf(column)` gives, so no caller has to remember that `:nth-child` counts from one.
 * The table does not reorder during the drag, so that position does not move either.
 */
export function dimColumn(table: HTMLTableElement, index: number): () => void {
  const cells = Array.from(
    table.querySelectorAll<HTMLElement>(`th:nth-child(${index + 1}), td:nth-child(${index + 1})`)
  );
  for (const cell of cells) {
    cell.style.opacity = DRAGGED_OPACITY;
  }
  return () => {
    for (const cell of cells) {
      cell.style.opacity = "";
    }
  };
}
