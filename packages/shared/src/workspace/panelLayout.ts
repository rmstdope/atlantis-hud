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

/** The editor's height once the player has dragged it: the floor holds, the pin does not. */
const CUSTOM_EDITOR = "min-h-[9rem] flex-none";

/** The editor's default pin, and the bounds the drag and the stored value respect. */
export const ORDERS_DEFAULT_REM = 19;
export const ORDERS_MIN_REM = 9; // today's min-h-[9rem], kept
export const UNIT_MIN_REM = 6; // the unit panel may not be dragged below this
export const ORDERS_MAX_REM = 60; // sanity ceiling for stored values only
export const SPLIT_STEP_REM = 1; // one arrow-key press
export const RAIL_GAP_REM = 0.625; // the column's gap-2.5

export function unitSlotClass(collapsed: Collapsed): string {
  return collapsed.unit ? STRIP : FLEXIBLE;
}

export function ordersSlotClass(collapsed: Collapsed, hasCustomHeight: boolean): string {
  if (collapsed.orders) {
    return STRIP;
  }
  // With the unit panel folded there is nothing else in the column that can grow, so the editor
  // becomes the flexible one regardless of a stored height - otherwise it would stop short and
  // leave the column half empty.
  if (collapsed.unit) {
    return FLEXIBLE;
  }
  return hasCustomHeight ? CUSTOM_EDITOR : PINNED_EDITOR;
}

/** null unless the value is a finite number; otherwise clamped into [ORDERS_MIN_REM, ORDERS_MAX_REM]. */
export function clampOrdersHeight(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(ORDERS_MAX_REM, Math.max(ORDERS_MIN_REM, numeric));
}

/** One drag or key step resolved against the rail: clamped, and flagged when the raw value overshot. */
export type DragResult = { rem: number; atLimit: boolean };

/**
 * Resolves a drag (or one keyboard step) into a committed height.
 *
 * `startRem` is where the editor stood when the gesture began, `deltaRem` is how far the pointer
 * moved converted to rem (positive means the editor grows), and `railRem` is the whole column's
 * height. The ceiling follows the rail, not a fixed number, so a short window still leaves the
 * unit panel `UNIT_MIN_REM` plus one gap of its own; if the rail is too short to hold both floors
 * at once, the orders floor wins outright.
 */
export function dragOrdersHeight(startRem: number, deltaRem: number, railRem: number): DragResult {
  const raw = startRem + deltaRem;
  const ceiling = railRem - UNIT_MIN_REM - RAIL_GAP_REM;
  if (ceiling < ORDERS_MIN_REM) {
    return { rem: ORDERS_MIN_REM, atLimit: true };
  }
  const max = Math.min(ORDERS_MAX_REM, ceiling);
  const rem = Math.min(max, Math.max(ORDERS_MIN_REM, raw));
  return { rem, atLimit: rem !== raw };
}

/**
 * Inline style for the orders slot, or null while the default pin applies.
 *
 * The `maxHeight` is the clamp-to-fit on a short window: the unit panel keeps `UNIT_MIN_REM` plus
 * one gap of the rail's `gap-2.5` above the editor and below the region column's own padding, and
 * the stored preference is untouched underneath it - it comes back once the window grows again.
 */
export function ordersSlotStyle(
  collapsed: Collapsed,
  ordersHeightRem: number | null
): { height: string; maxHeight: string } | null {
  if (ordersHeightRem == null || collapsed.unit || collapsed.orders) {
    return null;
  }
  return {
    height: `${ordersHeightRem}rem`,
    maxHeight: `calc(100% - ${UNIT_MIN_REM + RAIL_GAP_REM}rem)`
  };
}

/**
 * The left and right rails' default widths (today's `w-[19rem]` and `w-[21rem]`) and the bounds a
 * drag, a keyboard step or a stored value must respect. Chosen with the navigator in
 * `docs/ui/rail-resize.html`: 12rem floor, 45rem ceiling, never more than half the window.
 */
export const RAIL_LEFT_DEFAULT_REM = 19;
export const RAIL_RIGHT_DEFAULT_REM = 21;
export const RAIL_MIN_REM = 12;
export const RAIL_MAX_REM = 45;

export type RailSide = "left" | "right";

/** null unless the value is a finite number; otherwise clamped into [RAIL_MIN_REM, RAIL_MAX_REM]. */
export function clampRailWidth(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(RAIL_MAX_REM, Math.max(RAIL_MIN_REM, numeric));
}

/**
 * Resolves a drag (or one keyboard step) for a rail's width.
 *
 * `deltaRem` is positive when the rail grows - the component maps pointer direction per side, so
 * the arithmetic here does not need to know which one it is. The ceiling is `min(RAIL_MAX_REM,
 * hostRem / 2)`: a rail may never take more than half the window. `hostRem` may be `Infinity` (an
 * unmeasurable host, e.g. a DOM-free test), in which case `RAIL_MAX_REM` alone rules.
 */
export function dragRailWidth(startRem: number, deltaRem: number, hostRem: number): DragResult {
  const raw = startRem + deltaRem;
  const ceiling = Math.min(RAIL_MAX_REM, hostRem / 2);
  const rem = Math.min(ceiling, Math.max(RAIL_MIN_REM, raw));
  return { rem, atLimit: rem !== raw };
}

/** Inline style for a rail's width, or null while the default class width applies. */
export function railWidthStyle(widthRem: number | null): { width: string } | null {
  if (widthRem == null) {
    return null;
  }
  return { width: `${widthRem}rem` };
}

/**
 * The units-in-hex pane's default height and bounds, in rem. Chosen with the navigator in
 * `docs/ui/units-pane-drag-resize.html`: twelve rows by default (what the old row count gave),
 * one row as the floor, never more than seven tenths of the map column.
 *
 * 20.625rem = 330px: title bar 28 + body padding 16 + column header 24 + eleven and a half rows
 * of 24 (ROW_HEIGHT). It was exactly twelve rows until ah-v09e took ROW_HEIGHT from 22 to 24 for
 * the taller pane type, and it deliberately stayed where it was rather than growing with them: at
 * a 720px window the extra 26px squeezes the right-hand column until the folded panels' own title
 * bars stop taking clicks, and the pane is draggable anyway. Half a row is a cheaper price.
 *
 * 5.75rem = 92px: title bar 28 + body padding 16 + column header 24 + one row of 24. This one did
 * follow ROW_HEIGHT, because a floor that cannot fit its single row is just a clipped row.
 */
export const UNITS_DEFAULT_REM = 20.625;
export const UNITS_MIN_REM = 5.75;
export const UNITS_MAX_REM = 60; // sanity ceiling for stored values only
export const UNITS_CEILING_FRACTION = 0.7;

const PINNED_UNITS = "h-[20.625rem] max-h-[70%] min-h-[5.75rem] flex-none";
const CUSTOM_UNITS = "min-h-[5.75rem] flex-none";

/** null unless a finite number; otherwise clamped into [UNITS_MIN_REM, UNITS_MAX_REM]. */
export function clampUnitsHeight(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(UNITS_MAX_REM, Math.max(UNITS_MIN_REM, numeric));
}

/**
 * One drag or key step on the units pane, resolved against the map column: `hostRem` is the
 * overlay column's content height (Infinity when unmeasurable, leaving UNITS_MAX_REM). Ceiling is
 * min(UNITS_MAX_REM, hostRem * UNITS_CEILING_FRACTION); if that falls under UNITS_MIN_REM the
 * floor wins outright with atLimit true.
 */
export function dragUnitsHeight(startRem: number, deltaRem: number, hostRem: number): DragResult {
  const raw = startRem + deltaRem;
  const ceiling = Math.min(UNITS_MAX_REM, hostRem * UNITS_CEILING_FRACTION);
  if (ceiling < UNITS_MIN_REM) {
    return { rem: UNITS_MIN_REM, atLimit: true };
  }
  const rem = Math.min(ceiling, Math.max(UNITS_MIN_REM, raw));
  return { rem, atLimit: rem !== raw };
}

/** The bottom slot's classes: STRIP when the pane is folded, otherwise pinned or custom. */
export function unitsSlotClass(collapsed: Collapsed, hasCustomHeight: boolean): string {
  if (collapsed.units) {
    return STRIP;
  }
  return hasCustomHeight ? CUSTOM_UNITS : PINNED_UNITS;
}

/** Inline style once a height is stored: the height, and the 70% clamp-to-fit for a short window. */
export function unitsSlotStyle(
  collapsed: Collapsed,
  unitsHeightRem: number | null
): { height: string; maxHeight: string } | null {
  if (unitsHeightRem == null || collapsed.units) {
    return null;
  }
  return { height: `${unitsHeightRem}rem`, maxHeight: "70%" };
}
