/**
 * The geometry every theme draws on, worked out once.
 *
 * A theme places its marks in fractions of `HEX_RADIUS` rather than in absolute pixels: the design
 * proposals were drawn at radius 46 and the map runs at 18, so an anchor taken from a mockup is
 * that mockup's value divided by 46. What a mark means stays fixed; how big it is does not.
 */

import { HEX_RADIUS } from "../mapViewport";
import { hexPointsAttribute } from "../mapHexView";
import type { HexView } from "./hexView";

/** The hexagon itself, as a `points` attribute. Flat-top, with a vertex due east. */
export const HEX_POINTS = hexPointsAttribute(HEX_RADIUS);

/** Moves a mark group to a hex's centre. */
export function translateOf(view: HexView): string {
  return `translate(${view.at.x.toFixed(2)},${view.at.y.toFixed(2)})`;
}

/** A length given as a fraction of the hex's radius. */
export function radii(fraction: number): number {
  return HEX_RADIUS * fraction;
}
