import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { nextShortfallForm, shortfallText, type ShortfallForm } from "../unitTable";

/**
 * The small red `<N> short` the Silver cell writes after the figure of a unit that ends the month
 * in credit but cannot pay for all of its own orders (`ah-ottr`).
 *
 * A column too narrow for it shortens it to `▾<N>`, then to `▾…`: one step at a time while the
 * cell overflows (`nextShortfallForm`), starting again from the long form whenever the cell's
 * width changes. The cell is right-aligned and clips on the right, so the figure in front of this
 * is never the part that is cut first.
 *
 * A screen reader always hears `<N> short`, whatever form is drawn.
 */
export function SilverShortfall({ unitId, amount }: { unitId: string; amount: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState<ShortfallForm>("long");
  const [width, setWidth] = useState(0);

  // A new amount or a new width may have room for more, so it starts from the long form again.
  useLayoutEffect(() => {
    setForm("long");
  }, [amount, width]);

  // Step narrower while the cell overflows; settles in at most two steps.
  useLayoutEffect(() => {
    const cell = ref.current?.closest("td");
    if (!cell) {
      return;
    }
    const next = nextShortfallForm(form, cell.scrollWidth > cell.clientWidth);
    if (next !== form) {
      setForm(next);
    }
  });

  useEffect(() => {
    const cell = ref.current?.closest("td");
    if (!cell || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setWidth(Math.round(entry.contentRect.width));
      }
    });
    observer.observe(cell);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      data-testid={`silver-shortfall-${unitId}`}
      data-form={form}
      className="ml-1.5 text-pane-sm not-italic text-danger"
    >
      <span aria-hidden>{shortfallText(form, amount)}</span>
      <span className="sr-only">{shortfallText("long", amount)}</span>
    </span>
  );
}
