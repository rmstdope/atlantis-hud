/**
 * How much of the map the panes are standing on.
 *
 * The inspector panels are drawn over the map rather than beside it, so the canvas is always the
 * full size of the area while the part of it the player can actually read is a strip in the
 * middle. Framing against the canvas therefore centred the world underneath the panels; framing
 * against this strip is what "fit everything" means to someone looking at the screen.
 *
 * Measured from the live boxes rather than from the panel widths, because a panel folds, a dock
 * grows with the number of units in a hex, and a feature-flagged pane may not be there at all.
 * Anything that wants to claim space marks itself with `data-map-overlay`; nothing else has to
 * know it exists.
 */

import { NO_INSETS, type Insets } from "./mapViewport";

/** Which side of the map a pane is anchored to. */
export type Edge = "left" | "right" | "top" | "bottom";

/** The parts of a `DOMRect` this needs, so the arithmetic can be tested without a DOM. */
export type Box = { left: number; right: number; top: number; bottom: number };

/**
 * `edge` is deliberately as wide as what an HTML attribute can hold rather than an `Edge`.
 *
 * It arrives as `dataset.mapOverlay`, which is whatever someone typed - a misspelling, or nothing
 * at all. Asserting it into the union at the call site only moves the mistake somewhere it cannot
 * be seen: an unknown key lands in the insets as `NaN`, and framing against a `NaN` opens the map
 * nowhere. Narrowed here instead, where the four names are known.
 */
export type OverlayBox = { edge: string | undefined; box: Box };

const EDGES: Edge[] = ["left", "right", "top", "bottom"];

function isEdge(edge: string | undefined): edge is Edge {
  return EDGES.includes(edge as Edge);
}

function isVisible(box: Box): boolean {
  return box.right > box.left && box.bottom > box.top;
}

/** How far into the host a pane on this edge reaches. Never negative: a pane may sit outside. */
function reach(host: Box, edge: Edge, box: Box): number {
  switch (edge) {
    case "left":
      return box.right - host.left;
    case "right":
      return host.right - box.left;
    case "top":
      return box.bottom - host.top;
    default:
      return host.bottom - box.top;
  }
}

export function overlayInsets(host: Box, overlays: OverlayBox[]): Insets {
  const insets = { ...NO_INSETS };
  for (const { edge, box } of overlays) {
    if (!isEdge(edge) || !isVisible(box)) {
      continue;
    }
    insets[edge] = Math.max(insets[edge], reach(host, edge, box), 0);
  }
  return insets;
}
