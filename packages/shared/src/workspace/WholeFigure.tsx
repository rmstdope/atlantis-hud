import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { figureIsCut } from "../unitTable";

/**
 * A Silver figure shown whole, or not at all (`ah-j92v`): when the column is too narrow for every
 * digit, a single `…` is drawn in its place - never its leading digits, which would read as a
 * smaller whole number (`3.` for 33). A spreadsheet's `#####` is the same convention.
 *
 * The whole figure always stays in the box and in layout, so the box is exactly as wide as a
 * truncated figure would be and the shortfall beside it (`SilverShortfall`, which measures this box
 * through `data-silver-figure`) narrows exactly as before. Only the paint changes: a cut figure's
 * digits turn transparent and the `…` is drawn over the box's right edge, from a `::before` on an
 * `aria-hidden` span, so the cell's text and what a screen reader hears are still the whole figure.
 * Since nothing here changes layout, measuring it cannot feed back into what is measured.
 */
export function WholeFigure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);

  // Every render: a new figure, or the ⚠ or shortfall beside it changing, may change what fits.
  useLayoutEffect(() => {
    const box = ref.current;
    if (box) {
      setCut(figureIsCut(box));
    }
  });

  // And every resize: the player narrowing or widening the column.
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setCut(figureIsCut(box)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      data-silver-figure
      // The floor holds one `…`: the table's face is monospaced, so `…` is exactly `1ch` wide.
      className="relative inline-block min-w-[1ch] max-w-full overflow-hidden align-bottom whitespace-nowrap"
    >
      <span data-figure-digits className={cut ? "text-transparent" : undefined}>
        {children}
      </span>
      {cut ? (
        <span
          aria-hidden
          data-figure-ellipsis
          className="absolute inset-y-0 right-0 before:content-['\2026']"
        />
      ) : null}
    </span>
  );
}
