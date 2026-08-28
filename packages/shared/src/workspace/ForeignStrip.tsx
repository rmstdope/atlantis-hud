import type { ReactElement, RefObject } from "react";
import { pinLabel } from "./foreignUnits";
import type { FactionPin } from "./unitSource";

/** Why a concealed pin shows no attitude. `rules/stealthobs`; the wording is verified (ah-dbw4). */
const CONCEALED = "Their owner is concealed from you this turn.";

/**
 * What the `Other factions` list is narrowed to, above the table.
 *
 * The name truncates before the attitude does: the attitude is the one word here that changes how
 * the rows below are read, and a fact that vanishes with the window width is worse than one that is
 * always abbreviated (the navigator's W3). The strip never wraps, so the table below it never jumps
 * as the window is dragged - `ArmyStrip` does not wrap either, and the two sit in the same place.
 *
 * A file of its own rather than a private function in `UnitTableDock`, as `ArmyStrip` is, because
 * `packages/shared` has no jsdom: `UnitTableDock.test.tsx` cannot click its way to a pinned state,
 * so the strip is tested by static render here instead (`../testing/README.md`).
 */
export function ForeignStrip({
  pin,
  attitude,
  onClear,
  buttonRef
}: {
  pin: FactionPin;
  /** `attitudeToward`'s answer, or null. `not declared` is printed for null. */
  attitude: string | null;
  onClear: () => void;
  /** The dock focuses this when a pin leaves the table with no rows. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const label = pinLabel(pin);
  // Named `concealed`, not `hidden`: that word is also the Tailwind class used below.
  const concealed = pin.kind === "hidden";

  return (
    <div
      data-testid="foreign-strip"
      className="@container flex items-center gap-2 border-b border-edge px-2 py-1.5 text-pane text-ink"
    >
      <span
        data-testid="foreign-chip"
        className={`flex items-center gap-1.5 rounded border border-brass py-0.5 pr-1 pl-2 text-brass-bright ${
          concealed ? "flex-none" : "min-w-0"
        }`}
      >
        <b data-testid="foreign-chip-name" className="min-w-0 truncate font-medium" title={label}>
          {label}
        </b>
        <button
          type="button"
          data-testid="foreign-unpin"
          aria-label="stop showing only this faction"
          onClick={onClear}
          className="flex-none rounded px-1 text-ink-dim hover:bg-panel hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
          ref={buttonRef}
        >
          ✕
        </button>
      </span>
      {concealed ? (
        // No faction to hold an attitude toward: `rules/stealthobs` gives the unit and withholds
        // the owner when your Observation only equals its Stealth. The chip is the only way out of
        // the pin and its label is short and fixed, so the sentence is what gives way (W7a).
        <span
          data-testid="foreign-concealed"
          className="min-w-0 truncate text-ink-dim"
          title={CONCEALED}
        >
          {CONCEALED}
        </span>
      ) : (
        <>
          {attitude === null ? null : (
            // W5a: `you have declared not declared` does not read, so the lead-in is dropped when
            // there is nothing declared.
            <span
              data-testid="foreign-attitude-lead"
              className="hidden flex-none text-ink-dim @sm:block"
            >
              you have declared
            </span>
          )}
          <span data-testid="foreign-attitude" className="flex-none text-brass">
            {attitude ?? "not declared"}
          </span>
        </>
      )}
    </div>
  );
}
