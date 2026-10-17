/**
 * Where the Add to army list opens and how tall it may grow (ah-gnmx), as plain arithmetic.
 *
 * The page root clips what overflows it (ah-gmg8), so a list taller than the room under its button
 * would leave its lower rows - and New Army… - out of reach. The component measures; the rule is
 * here, where a test without a DOM can reach it (`testing/README.md`).
 */

/** How far the list stays clear of the window's top or bottom edge: "a few pixels". */
export const MENU_EDGE_MARGIN = 8;

/** The gap between the button and the list - `PopoverFrame`'s `mt-1` / `mb-1`. */
export const MENU_ANCHOR_GAP = 4;

/** Fewer army rows than this fitting below is what turns the list upward. */
export const MIN_ROWS_BELOW = 5;

export type MenuSide = "below" | "above";

export type MenuFit = { side: MenuSide; maxHeight: number };

/**
 * Below, as every drop-down here opens, while the whole list fits there or the room left shows at
 * least `MIN_ROWS_BELOW` army rows; otherwise whichever side has more room, a tie staying below.
 *
 * The height never drops under the naming line, one army row and New Army…: in a window too small
 * for even that, keeping New Army… on screen matters more than the margin.
 */
export function fitArmyMenu(m: {
  /** The button's top and bottom, in viewport coordinates. */
  anchorTop: number;
  anchorBottom: number;
  viewportHeight: number;
  /** The list's height with no cap at all. */
  naturalHeight: number;
  /** Everything that does not scroll: naming line, separator, New Army…, padding and border. */
  chromeHeight: number;
  rowHeight: number;
}): MenuFit {
  const spare = MENU_ANCHOR_GAP + MENU_EDGE_MARGIN;
  const below = m.viewportHeight - m.anchorBottom - spare;
  const above = m.anchorTop - spare;

  const roomyBelow =
    m.naturalHeight <= below || (below - m.chromeHeight) / m.rowHeight >= MIN_ROWS_BELOW;
  const side: MenuSide = roomyBelow || below >= above ? "below" : "above";
  const room = side === "below" ? below : above;
  const floor = Math.min(m.naturalHeight, m.chromeHeight + m.rowHeight);

  return { side, maxHeight: Math.max(room, floor) };
}

/**
 * The right-click list's top, moved so it stays `MENU_EDGE_MARGIN` clear of both window edges.
 * `placeTooltip` keeps a box inside the window but lets it touch an edge; the list's cap
 * (`100vh - 16px`) always leaves room for both margins.
 */
export function clearOfEdges(top: number, height: number, viewportHeight: number): number {
  return Math.max(MENU_EDGE_MARGIN, Math.min(top, viewportHeight - height - MENU_EDGE_MARGIN));
}

export type EdgeFades = { top: boolean; bottom: boolean };

/** A fade on each edge of the army rows that has rows hidden past it. */
export function edgeFades(s: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): EdgeFades {
  // A pixel of slack: zoom and fractional layout leave a scrolled-to-the-end list half a pixel shy.
  return {
    top: s.scrollTop > 1,
    bottom: s.scrollTop + s.clientHeight < s.scrollHeight - 1
  };
}
