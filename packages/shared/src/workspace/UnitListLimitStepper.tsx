import { UNIT_LIST_LIMIT_MAX, UNIT_LIST_LIMIT_MIN } from "../settingsStore";

/** The movement panel's pane-action look, spelled the same way so the top bars read alike. */
const BUTTON =
  "rounded border border-edge bg-ground px-2 py-0.5 text-[11px] text-ink " +
  "hover:border-select aria-disabled:opacity-40 aria-disabled:hover:border-edge";

/**
 * How many unit rows the pane stands tall, set from the pane itself.
 *
 * The same preference the settings dialog's slider drives - it is one value, not one per hex, and
 * it sizes the pane rather than trimming the list. It is spelled "max" because it is a ceiling the
 * hex need not reach: a hex holding four units under a maximum of twelve is the ordinary case, and
 * the count would be a lie if it claimed otherwise. In fixed-size mode the pane always reserves
 * exactly this many rows, so "max" would itself be the lie - the label drops it and reads the bare
 * number.
 *
 * At an end the button is marked spent rather than disabled, so a keyboard user who steps down to
 * the floor keeps the focus they would otherwise have lost to the document as the button vanished
 * from the tab order. It answers the press with nothing rather than with a value out of range: the
 * store would clamp such a value away, but a control that announces itself as disabled and then
 * acts anyway is a lie, and the next caller may not have a clamp behind it.
 *
 * The names say rows rather than units on purpose. Nothing here removes a unit from the list -
 * every one of them stays scrollable - so "show fewer units" would describe a thing the pane
 * pointedly does not do.
 */
export function UnitListLimitStepper({
  value,
  onChange,
  fixed
}: {
  value: number;
  onChange: (next: number) => void;
  /** Fixed-size mode: the pane is exactly this many rows, so "max" would be a lie. */
  fixed: boolean;
}) {
  const atFloor = value <= UNIT_LIST_LIMIT_MIN;
  const atCeiling = value >= UNIT_LIST_LIMIT_MAX;

  return (
    <div role="group" aria-label="Rows of units shown" className="flex items-center gap-1">
      <button
        type="button"
        data-testid="unit-list-limit-less"
        aria-label="Show fewer rows"
        aria-disabled={atFloor}
        onClick={() => (atFloor ? undefined : onChange(value - 1))}
        className={BUTTON}
      >
        −
      </button>
      <span
        data-testid="unit-list-limit-value"
        // Wide enough for two digits, so the + does not walk sideways under the pointer as the
        // count crosses from 9 to 10 and the label grows a character.
        className="min-w-[3.5ch] text-center text-[11px] tabular-nums text-ink-dim"
        // Announced as it changes, since the thing it describes - the height of the pane behind
        // the button - is not something a screen reader can see move.
        aria-live="polite"
      >
        {fixed ? value : `max ${value}`}
      </span>
      <button
        type="button"
        data-testid="unit-list-limit-more"
        aria-label="Show more rows"
        aria-disabled={atCeiling}
        onClick={() => (atCeiling ? undefined : onChange(value + 1))}
        className={BUTTON}
      >
        +
      </button>
    </div>
  );
}
