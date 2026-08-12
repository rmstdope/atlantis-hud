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

export type OverlayBox = { edge: Edge; box: Box };

function isVisible(box: Box): boolean {
  return box.right > box.left && box.bottom > box.top;
}

/** How far into the host a pane on this edge reaches. Never negative: a pane may sit outside. */
function reach(host: Box, { edge, box }: OverlayBox): number {
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
  for (const overlay of overlays) {
    if (!isVisible(overlay.box)) {
      continue;
    }
    insets[overlay.edge] = Math.max(insets[overlay.edge], reach(host, overlay), 0);
  }
  return insets;
}
