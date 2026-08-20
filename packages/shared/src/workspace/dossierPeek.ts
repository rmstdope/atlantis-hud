/**
 * Where the map goes while the reader runs down the faction dossier, and how it finds its way back.
 *
 * `ah-bu2c` rings the hex under the hovered row; this is the movement that makes the ring worth
 * drawing (ah-mwqa). The rule lives here rather than inside `MapCanvas` because this package's
 * components are rendered to static markup in tests - it has no jsdom - so a rule written inside a
 * component is a rule no test can read. `tradeArrow.ts` is the sibling of this module and was
 * written first; the two are deliberately kept apart, because they differ in their rule, in their
 * debounce and in what abandons them, and merging two small effects to share a ref would cost more
 * than it saves.
 */

import type { Coordinate } from "@atlantis/core-client";
import { type Box, isVisible, reach } from "./mapOverlayInsets";
import { NO_INSETS, type Insets, type Viewport, centreOn, isOffScreen } from "./mapViewport";

/** A rectangle of the map the reader cannot see through - the dossier popover, in host pixels. */
export type KeepClear = Box;

/**
 * Why a hex is being shown: the pointer resting on a row, or focus landing on one.
 *
 * A hover is a peek and returns; focus is navigation and stays. Tabbing through the dossier with
 * the map yo-yoing back after every row would be unusable (navigator, 2026-08-20).
 */
export type PeekMode = "peek" | "settle";

/**
 * The insets a keep-clear rectangle adds, treated as reaching in from whichever edge it reaches
 * furthest into.
 *
 * `Insets` are edge-based and the dossier floats: it is `w-80` and opens beside a row, so in
 * practice it hugs one side, but it need not. Approximating a floating rectangle as an edge inset
 * over-reserves when it sits mid-map, which moves the map slightly more than strictly needed and
 * never leaves the hex hidden - the safe direction to be wrong in.
 */
export function keepClearInsets(host: Box, rect: KeepClear | null): Insets {
  if (!rect || !isVisible(rect)) {
    return NO_INSETS;
  }
  // The edge that costs the least map, not the shallowest one. A `w-80` panel down the side of a
  // 1280x647 host reaches 626px in from the left and 590px in from the top: the top is shallower
  // and yet reserving it would leave a 57px strip and no map at all, while the left leaves a third
  // of the width. Weighing each reach by the span it eats settles that the way a reader would.
  const hostWidth = host.right - host.left;
  const hostHeight = host.bottom - host.top;
  const reaches = (["left", "right", "top", "bottom"] as const)
    .map((edge) => {
      const depth = reach(host, edge, rect);
      const span = edge === "left" || edge === "right" ? hostHeight : hostWidth;
      return { edge, depth, lost: depth * span };
    })
    .filter(({ depth }) => depth > 0);
  if (reaches.length === 0) {
    return NO_INSETS;
  }
  const cheapest = reaches.reduce((best, next) => (next.lost < best.lost ? next : best));
  return { ...NO_INSETS, [cheapest.edge]: cheapest.depth };
}

/** The larger reach per edge, the way `overlayInsets` already combines two panes on one side. */
function widest(a: Insets, b: Insets): Insets {
  return {
    left: Math.max(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom)
  };
}

/**
 * Where the map should go so the reader can see `coordinate`, or `null` when it is already visible
 * and unobscured - the dossier's answer to `viewportForArrow`.
 *
 * Because the keep-clear area becomes an inset, `visibleRect` shrinks, `isOffScreen` answers
 * "hidden behind the popover" for free, and `centreOn` centres into the part still showing.
 */
export function viewportForPeek(
  coordinate: Coordinate,
  current: Viewport,
  width: number,
  height: number,
  insets: Insets = NO_INSETS,
  keepClear: KeepClear | null = null,
  host: Box = { left: 0, top: 0, right: width, bottom: height }
): Viewport | null {
  const combined = widest(insets, keepClearInsets(host, keepClear));
  if (!isOffScreen(coordinate, current, width, height, combined)) {
    return null;
  }
  return centreOn(coordinate, current, width, height, combined);
}

/**
 * What the map does when the dossier's highlighted hex changes, and what it must remember.
 *
 * `restore` is written **once per hover run, not once per row**: sweeping down a list must return
 * to where the reader was before the *first* row that moved anything, or "back" would mean "the
 * previous row's position" and the map would never find its way home. A row that needed no
 * movement never becomes the restore point, for the same reason.
 *
 * A `null` `restore` on the way in means the restore was abandoned - the reader panned, selected
 * something, or closed the panel - and leaving the row then leaves the map where it is rather than
 * snapping away from what they just did.
 */
export function peekStep(input: {
  /** The hex to show, or `null` because the reader looked away. */
  target: Coordinate | null;
  mode: PeekMode;
  current: Viewport;
  restore: Viewport | null;
  host: Box;
  width: number;
  height: number;
  insets: Insets;
  keepClear: KeepClear | null;
}): { commit: Viewport | null; restore: Viewport | null } {
  const { target, mode, current, restore, host, width, height, insets, keepClear } = input;

  if (target === null) {
    // `settle` on the way out means "leave the map where it is": blur, after focus already moved
    // it, and the dossier being dismissed mid-hover - which the navigator asked for explicitly,
    // rather than the map snapping away as the panel disappears.
    return mode === "settle" ? { commit: null, restore: null } : { commit: restore, restore: null };
  }

  const wanted = viewportForPeek(target, current, width, height, insets, keepClear, host);

  if (mode === "settle") {
    // Focus moves and stays, so there is nothing to come back to - and a later hover peeks away
    // from wherever focus left the map and returns to exactly that.
    return { commit: wanted, restore: null };
  }

  if (!wanted) {
    return { commit: null, restore };
  }
  return { commit: wanted, restore: restore ?? current };
}
