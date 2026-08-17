import type { Coordinate, TradeRoute } from "@atlantis/core-client";
import { fitTo, isOffScreen, NO_INSETS, type Insets, type Viewport } from "./mapViewport";

/**
 * The arrow a hovered trade route draws, in the map's own terms.
 *
 * A rule in its own module rather than inside a component, because this package's components are
 * rendered to static markup in tests and a rule written inside one is a rule no test can read.
 */
export type TradeArrow = {
  from: Coordinate;
  to: Coordinate;
  /** True when the way back pays too, so the line carries a head at both ends. */
  twoWay: boolean;
};

/** The arrow for a hovered route, or `null` when nothing is hovered. */
export function arrowFor(route: TradeRoute | null): TradeArrow | null {
  if (!route) {
    return null;
  }
  return { from: route.from, to: route.to, twoWay: route.inbound.length > 0 };
}

/**
 * The viewport a hovered arrow wants, or `null` to leave the map exactly where it is.
 *
 * `null` when both ends are already on screen: a map that jumps for a route the reader can see
 * entirely is movement for nothing, and most rows in a good list are the near ones (navigator,
 * 2026-08-17). `null` too when `fitTo` declines - an unmeasured host - because "do not move" is the
 * honest answer there, and the arrow is still drawn either way.
 */
export function viewportForArrow(
  arrow: TradeArrow,
  current: Viewport,
  width: number,
  height: number,
  insets: Insets = NO_INSETS
): Viewport | null {
  const offScreen =
    isOffScreen(arrow.from, current, width, height, insets) ||
    isOffScreen(arrow.to, current, width, height, insets);
  if (!offScreen) {
    return null;
  }
  return fitTo([arrow.from, arrow.to], width, height, insets);
}
