import type { KeyboardEvent } from "react";
import type { SlotTab } from "../workspaceStore";

/** The other of the two, since there are only two. */
const other = (tab: SlotTab): SlotTab => (tab === "unit" ? "movement" : "unit");

/** Which tab an arrow, Home or End asks for, or null for a key this strip leaves alone. */
export function nextSlotTab(tab: SlotTab, key: string): SlotTab | null {
  switch (key) {
    // There are only two, so both arrows do the same thing: hand back the other one.
    case "ArrowLeft":
    case "ArrowRight":
      return other(tab);
    case "Home":
      return "unit";
    case "End":
      return "movement";
    default:
      return null;
  }
}

/**
 * The shared Unit/Movement slot's tab strip, standing where a panel title usually does.
 *
 * Hook-free on purpose: `findByTestId` descends by *calling* components, so a hook here would put
 * every tab out of reach of this package's tests (`testing/elementTree.ts`).
 *
 * Tabs carry `aria-selected`, never `aria-expanded` - the fold control beside them owns that, and
 * the smoke suite's `foldPanel` finds it by exactly that role filter.
 */
export function SlotTabs({
  tab,
  hasRoute,
  onSelect
}: {
  tab: SlotTab;
  /** True when a route is standing, which puts the dot on the Movement tab. */
  hasRoute: boolean;
  onSelect: (tab: SlotTab) => void;
}) {
  const style = (self: SlotTab) =>
    `rounded px-1.5 text-pane-sm uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass ${
      tab === self ? "text-brass" : "text-ink-dim hover:text-ink"
    }`;

  return (
    <div
      role="tablist"
      aria-label="Unit and movement"
      data-testid="slot-tabs"
      // One tab stop, not two: only the selected tab is tabbable and the arrows move within the
      // list, selection following focus, as the ARIA tabs pattern asks. The `.focus()` is not
      // optional - a roving `tabIndex` re-renders but moves nothing, so without it the strip would
      // select the other tab while the keyboard stayed on the one it started from, and every later
      // arrow would ask for the same neighbour again. The same handler `SettingsDialog` and
      // `ChangesDialog` carry, on the list rather than on each tab for the same reason: the key is
      // about the strip, not about whichever button happens to have the caret.
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const next = nextSlotTab(tab, event.key);
        if (next === null) {
          return;
        }
        event.preventDefault();
        onSelect(next);
        event.currentTarget
          .querySelector<HTMLButtonElement>(`[data-testid="slot-tab-${next}"]`)
          ?.focus();
      }}
      className="flex items-center gap-1"
    >
      <button
        type="button"
        role="tab"
        id="slot-tab-unit"
        data-testid="slot-tab-unit"
        aria-controls="slot-panel-unit"
        aria-selected={tab === "unit"}
        tabIndex={tab === "unit" ? 0 : -1}
        onClick={() => onSelect("unit")}
        className={style("unit")}
      >
        Unit
      </button>
      <button
        type="button"
        role="tab"
        id="slot-tab-movement"
        data-testid="slot-tab-movement"
        aria-controls="slot-panel-movement"
        aria-selected={tab === "movement"}
        tabIndex={tab === "movement" ? 0 : -1}
        // The dot is a mark, so it is spoken as part of the tab's name rather than left silent.
        aria-label={hasRoute ? "Movement, a route is planned" : undefined}
        onClick={() => onSelect("movement")}
        className={style("movement")}
      >
        Movement
        {hasRoute ? (
          <span aria-hidden className="ml-1 text-brass">
            •
          </span>
        ) : null}
      </button>
    </div>
  );
}
