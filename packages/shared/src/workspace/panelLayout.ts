/**
 * How tall the slot around each panel is, given which panels are folded away.
 *
 * A folded panel is only its title bar, and the space it gives up goes to the panel beside it
 * rather than being left as a hole: folding the unit panel is how you get a full-height orders
 * editor. That rule cannot live in CSS - no selector can say "grow because a *sibling* folded" -
 * so it lives here, apart from the shell, where every arrangement can be tested without a browser.
 *
 * Whatever no panel claims falls through to the map, which the panels float over.
 */

import type { PanelName } from "../workspaceStore";

type Collapsed = Record<PanelName, boolean>;

/** A slot that is only as tall as the title bar inside it. */
const STRIP = "flex-none";

/** A slot that takes everything the others leave. `min-h-0` so its panel may scroll rather than push. */
const FLEXIBLE = "min-h-0 flex-1";

/**
 * The right column's default division: the unit panel takes the slack and the editor is pinned.
 *
 * The floor and ceiling both matter. Nineteen rems is around fifteen order lines, and the ceiling
 * stops a tall window from turning the editor into most of the column while the unit panel, which
 * has a fixed amount to say, stretches to fill the rest.
 */
const PINNED_EDITOR = "h-[19rem] max-h-[55%] min-h-[9rem] flex-none";

export function unitSlotClass(collapsed: Collapsed): string {
  return collapsed.unit ? STRIP : FLEXIBLE;
}

export function ordersSlotClass(collapsed: Collapsed): string {
  if (collapsed.orders) {
    return STRIP;
  }
  // With the unit panel folded there is nothing else in the column that can grow, so the editor
  // becomes the flexible one and the pinning has to go - otherwise it would stop at 19rem and
  // leave the column half empty.
  return collapsed.unit ? FLEXIBLE : PINNED_EDITOR;
}
