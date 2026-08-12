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
 * the count would be a lie if it claimed otherwise.
 *
 * At an end the button is marked spent rather than disabled, and still takes the press: the store
 * clamps, so the press is a no-op, and a keyboard user who steps down to the floor keeps the focus
 * they would otherwise have lost to the document as the button vanished from the tab order.
 *
 * The names say rows rather than units on purpose. Nothing here removes a unit from the list -
 * every one of them stays scrollable - so "show fewer units" would describe a thing the pane
 * pointedly does not do.
 */
export function UnitListLimitStepper({
  value,
  onChange
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div role="group" aria-label="Units shown in the pane" className="flex items-center gap-1">
      <button
        type="button"
        data-testid="unit-list-limit-less"
        aria-label="Show fewer rows"
        aria-disabled={value <= UNIT_LIST_LIMIT_MIN}
        onClick={() => onChange(value - 1)}
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
        max {value}
      </span>
      <button
        type="button"
        data-testid="unit-list-limit-more"
        aria-label="Show more rows"
        aria-disabled={value >= UNIT_LIST_LIMIT_MAX}
        onClick={() => onChange(value + 1)}
        className={BUTTON}
      >
        +
      </button>
    </div>
  );
}
