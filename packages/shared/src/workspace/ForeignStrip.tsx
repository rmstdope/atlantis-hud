import type { ReactElement, RefObject } from "react";
import { pinLabel } from "./foreignUnits";
import type { FactionPin } from "./unitSource";

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

  return (
    <div
      data-testid="foreign-strip"
      className="flex items-center gap-2 border-b border-edge px-2 py-1.5 text-pane text-ink"
    >
      <b className="min-w-0 truncate font-medium text-brass-bright" title={label}>
        {label}
      </b>
      <button
        type="button"
        data-testid="foreign-unpin"
        aria-label="stop showing only this faction"
        onClick={onClear}
        className="flex-none rounded border border-edge px-1.5 py-0.5 text-pane text-ink hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
        ref={buttonRef}
      >
        ✕
      </button>
      <span className="ml-auto" />
      {pin.kind === "hidden" ? (
        // No faction to hold an attitude toward: `rules/stealthobs` gives the unit and withholds
        // the owner when your Observation only equals its Stealth.
        <span className="flex-none text-ink-dim">Their owner is concealed from you this turn.</span>
      ) : (
        <span className="flex-none text-brass">{attitude ?? "not declared"}</span>
      )}
    </div>
  );
}
