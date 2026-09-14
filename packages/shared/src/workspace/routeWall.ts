/**
 * Where a route that ran into a wall ends, and the red bar laid across that end.
 *
 * Pure, so the geometry is tested without a renderer (`.cerebro/traps.md`): `MapCanvas` only draws
 * what this works out.
 */

import type { TracedWall } from "@atlantis/core-client";
import { HEX_SIDE, type Point } from "./mapHexView";
import { worldOf } from "./mapViewport";
import { radii } from "./mapThemes/geometry";

/** How far from its hex centre a route that met a wall stops: short of the side, as agreed. */
export const WALL_TIP_REACH = radii(0.6);

/** Half the length of the red bar laid across that tip. */
export const WALL_TIP_HALF_LENGTH = radii(0.3);

/** Where a route that met a wall ends, and the bar across its end, in world units. */
export type WallTip = {
  /** The route's last point, to pass to `routeSegments` as its `tail`. */
  tail: Point;
  /** The bar across it: `M x1,y1 L x2,y2`, perpendicular to the blocked step. */
  bar: string;
};

/** The tip of a route stopped by `wall`, drawn from the hex the blocked step would have left. */
export function wallTip(wall: TracedWall): WallTip {
  const centre = worldOf(wall.coordinate);
  // Side `k`'s midpoint lies at `60k + 30` degrees from the centre, y down, like `corners`.
  const angle = (Math.PI / 180) * (60 * HEX_SIDE[wall.direction] + 30);
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const tail = { x: centre.x + u.x * WALL_TIP_REACH, y: centre.y + u.y * WALL_TIP_REACH };
  const p = { x: -u.y, y: u.x };
  const h = WALL_TIP_HALF_LENGTH;
  return {
    tail,
    bar: `M ${f(tail.x - p.x * h)},${f(tail.y - p.y * h)} L ${f(tail.x + p.x * h)},${f(tail.y + p.y * h)}`
  };
}

/** Rounded as `mapHexView.ts` rounds its attributes, without a negative zero. */
function f(value: number): string {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}
