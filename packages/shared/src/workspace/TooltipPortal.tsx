import type { ReactNode, ReactPortal } from "react";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { placeTooltip, type Point } from "../unitTooltip";

/**
 * A panel shown where the pointer came to rest, measured before it is placed.
 *
 * Rendered into the body rather than beside the row it describes. The panel behind the table is
 * blurred and clips what overflows it, and a blurred ancestor is what a fixed position resolves
 * against — inside the panel this would be trapped in it and cut off at its edge.
 *
 * It is placed after it is measured, so the arithmetic that keeps it on screen works on the size
 * the text actually took. The measuring pass is laid out but not painted: assigning the position
 * happens in a layout effect, which the browser runs before it draws, so there is no frame in
 * which the panel is somewhere else.
 *
 * Shared by the whole-unit summary and the per-cell popup (`ah-rgkk.1`), so the two cannot drift
 * apart in where they land or in how they avoid the edges of the window.
 */
export function TooltipPortal({
  at,
  anchorKey,
  testId,
  column,
  hiddenFromReaders = false,
  children
}: {
  at: Point;
  /** Re-place when this changes: another unit, or another cell of the same row. */
  anchorKey: string;
  testId: string;
  /** Which column the panel is about, for the smoke suite. Absent on the whole-unit summary. */
  column?: string;
  /**
   * Set where the same words are already in the row for a screen reader to find, as the per-cell
   * popup's are in its cell's `sr-only` span (`ah-rgkk.1`, decision **F1**): exposing the panel as
   * well would read the same material twice.
   */
  hiddenFromReaders?: boolean;
  children: ReactNode;
}): ReactPortal {
  // The node is held as state rather than a ref so the effect below runs once it exists.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    setPlaced(
      placeTooltip(
        at,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [node, at, anchorKey]);

  return createPortal(
    <div
      ref={setNode}
      data-testid={testId}
      data-column={column}
      role={hiddenFromReaders ? undefined : "tooltip"}
      aria-hidden={hiddenFromReaders || undefined}
      // Hidden until it has been measured and placed, which is one layout pass and no painted
      // frame: shown, that pass would put it at the corner of the window for an instant.
      style={{
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
        visibility: placed ? "visible" : "hidden"
      }}
      // Transparent to the pointer, so resting on a row cannot put the panel under the cursor
      // and take away the very hover that opened it.
      className="pointer-events-none fixed z-50 max-h-[80vh] w-max max-w-sm overflow-hidden rounded-md border border-edge bg-panel/95 px-2.5 py-1.5 text-pane leading-snug text-ink shadow-lg backdrop-blur"
    >
      {children}
    </div>,
    document.body
  );
}
