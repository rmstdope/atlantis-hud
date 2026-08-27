import type { KeyboardEvent } from "react";
import type { SlotTab } from "../workspaceStore";

/** The other of the two, since there are only two. */
const other = (tab: SlotTab): SlotTab => (tab === "unit" ? "movement" : "unit");

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
  // Automatic activation: focus follows selection, which the browser does on its own because the
  // newly selected tab is the one carrying the only `tabIndex={0}`.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, self: SlotTab) => {
    const next =
      event.key === "ArrowLeft" || event.key === "ArrowRight"
        ? other(self)
        : event.key === "Home"
          ? "unit"
          : event.key === "End"
            ? "movement"
            : null;
    if (next === null) {
      return;
    }
    event.preventDefault();
    onSelect(next);
  };

  const style = (self: SlotTab) =>
    `rounded px-1.5 text-pane-sm uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass ${
      tab === self ? "text-brass" : "text-ink-dim hover:text-ink"
    }`;

  return (
    <div role="tablist" aria-label="Unit and movement" className="flex items-center gap-1">
      <button
        type="button"
        role="tab"
        id="slot-tab-unit"
        data-testid="slot-tab-unit"
        aria-controls="slot-panel-unit"
        aria-selected={tab === "unit"}
        tabIndex={tab === "unit" ? 0 : -1}
        onClick={() => onSelect("unit")}
        onKeyDown={(event) => onKeyDown(event, "unit")}
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
        onKeyDown={(event) => onKeyDown(event, "movement")}
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
