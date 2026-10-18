import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { nextShortfallForm, shortfallText, type ShortfallForm } from "../unitTable";

/**
 * The small red `<N> short` the Silver cell writes after the figure of a unit that ends the month
 * in credit but cannot pay for all of its own orders (`ah-ottr`).
 *
 * A column too narrow for it shortens it to `▾<N>`, then to `▾…`, then to `▾` alone (`ah-sa9p`):
 * one step at a time while it does not fit (`nextShortfallForm`), starting again from the long
 * form whenever the cell's width, the amount or what sits beside it changes. It never shrinks
 * itself: the figure beside it, in the `data-silver-figure` box, is what truncates, so "does not
 * fit" is that figure being cut - and only once this has reached `▾` is the figure left cut. The
 * figure's box keeps one character's width, so at the column's floor it still shows its `…`.
 *
 * A screen reader always hears `<N> short`, whatever form is drawn.
 */
export function SilverShortfall({
  unitId,
  amount,
  beside
}: {
  unitId: string;
  amount: number;
  /** What the cell draws in front of it - the figure, and whether a ⚠ comes first. */
  beside: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState<ShortfallForm>("long");
  const [width, setWidth] = useState(0);

  // A new amount or a new width may have room for more, so it starts from the long form again.
  useLayoutEffect(() => {
    setForm("long");
  }, [amount, beside, width]);

  // Step narrower while the cell overflows; settles in at most two steps, each a change of `form`.
  useLayoutEffect(() => {
    const row = ref.current?.parentElement;
    if (!row) {
      return;
    }
    const figure = row.querySelector<HTMLElement>("[data-silver-figure]");
    const cut =
      row.scrollWidth > row.clientWidth ||
      (figure !== null && figure.scrollWidth > figure.clientWidth);
    // `data-silver-figure` is the box that truncates: around the plain figure, or inside the ⚠
    // button around its digits.
    const next = nextShortfallForm(form, cut);
    if (next !== form) {
      setForm(next);
    }
  }, [form, amount, beside, width]);

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
      // At `▾` alone the gap tightens too, so the 36 px floor still holds the figure's `…`.
      className={`${form === "arrow" ? "ml-0.5" : "ml-1.5"} shrink-0 text-pane-sm not-italic text-danger`}
    >
      <span aria-hidden>{shortfallText(form, amount)}</span>
      <span className="sr-only">{shortfallText("long", amount)}</span>
    </span>
  );
}
