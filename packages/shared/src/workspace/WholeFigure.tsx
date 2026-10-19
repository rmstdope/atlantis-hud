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
 * digits are given no opacity (not a transparent colour, which forced colours would repaint) and
 * the `…` is drawn over the box's right edge, from a `::before` on an `aria-hidden` span, so the
 * cell's text and what a screen reader hears are still the whole figure.
 * Since nothing here changes layout, measuring it cannot feed back into what is measured.
 */
export function WholeFigure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);

  // A new figure may not fit where the old one did.
  useLayoutEffect(() => {
    const box = ref.current;
    if (box) {
      setCut(figureIsCut(box));
    }
  }, [children]);

  // And every resize of the box: the player narrowing or widening the column, or the ⚠ or the
  // shortfall beside it taking more or less of the cell.
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
    // The figure's box keeps at least one character; the `…` is drawn outside the box that clips
    // the digits, so a face whose `…` is a little wider than its digits still draws it whole -
    // into the cell's padding if it must (`ah-j92v`, CI's Linux face at the 36 px floor).
    <span className="relative inline-flex min-w-[1ch] max-w-full align-bottom">
      <span
        ref={ref}
        data-silver-figure
        className="min-w-0 overflow-hidden whitespace-nowrap"
      >
        <span data-figure-digits className={cut ? "opacity-0" : undefined}>
          {children}
        </span>
      </span>
      {cut ? (
        <span
          aria-hidden
          data-figure-ellipsis
          className="absolute inset-y-0 right-0 whitespace-nowrap before:content-['\2026']"
        />
      ) : null}
    </span>
  );
}
