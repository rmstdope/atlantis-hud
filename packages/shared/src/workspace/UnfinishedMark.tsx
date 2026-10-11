/**
 * The unfinished mark: a small dashed square in brass, about one character wide (`ah-2ql5`,
 * `docs/ui/ah-2ql5-unfinished-mark.html`). The dashed look is the one the map already gives an
 * unfinished road.
 *
 * Hidden from screen readers: the words beside it, or the cell's own hover sentence, already say
 * "unfinished". `shrink-0` and `inline-block` keep it whole at the front of a truncating cell, so a
 * narrow column cuts the name after it, never the mark.
 */
export function UnfinishedMark() {
  return (
    <span
      aria-hidden
      data-unfinished-mark=""
      className="mr-[5px] inline-block h-[11px] w-[11px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-brass align-[-1px]"
    />
  );
}
