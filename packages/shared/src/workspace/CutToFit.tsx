import { useLayoutEffect, useRef, useState } from "react";
import { cutTitle, isCut } from "./cutRule";

/**
 * One piece of a line that never wraps: cut short with a trailing "…" when it does not fit, and
 * then - only then - carrying its full text as a tooltip (ah-sgvo).
 *
 * The cutting is CSS; whether it happened is measured, on every resize of the piece and every
 * change of its text, so a save completing or a count changing re-fits at once. A piece that fits
 * draws exactly what it drew before, with no tooltip.
 */
export function CutToFit({
  text,
  className,
  testId
}: {
  text: string;
  className?: string;
  testId?: string;
}) {
  const piece = useRef<HTMLSpanElement | null>(null);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const element = piece.current;
    if (!element) {
      return;
    }
    const measure = () => setCut(isCut(element.scrollWidth, element.clientWidth));
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    return () => resized.disconnect();
  }, [text]);

  return (
    <span
      ref={piece}
      data-testid={testId}
      title={cutTitle(text, cut)}
      className={`min-w-[1em] overflow-hidden text-ellipsis whitespace-nowrap ${className ?? ""}`}
    >
      {text}
    </span>
  );
}
