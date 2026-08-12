/**
 * Classic's own paint decisions, kept pure so they can be tested without a renderer.
 *
 * Only what Classic alone decides lives here; anything a second theme would want the same way
 * belongs in the shared view model instead.
 */

/**
 * How many roofs a count of buildings earns: one for a hamlet's worth, two for a handful, three
 * for a town of works.
 *
 * Count encodes scale, not identity. A glyph per building drowned the hex; a single glyph said
 * nothing about how much was standing there.
 */
export function structureGlyphCount(buildings: number): number {
  if (buildings <= 0) {
    return 0;
  }
  if (buildings <= 3) {
    return 1;
  }
  if (buildings <= 6) {
    return 2;
  }
  return 3;
}

/**
 * The pip size is deliberately not re-stated here.
 *
 * `unitPipRadius` still lives in `mapHexView.ts`, where the map has always kept it, and Classic
 * imports it. A second copy would be free to drift from the first while both test suites went on
 * passing.
 */
export { unitPipRadius } from "../../mapHexView";
