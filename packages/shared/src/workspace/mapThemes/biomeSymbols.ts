/**
 * Where a hex's biome symbols go, and whether they are drawn at all (ah-d9jb.4).
 *
 * The rule is the exploration's "aside" sprinkle (`drawGlyphs` in the agreed mockup,
 * `docs/ui/ah-d9jb.4-biome-symbols.html`): five spots per hex, each nudged a little and some left
 * out, so neighbouring hexes do not look stamped; and any spot that would fall on a mark is left out
 * too, so the symbols never sit on a settlement, a unit or a road.
 *
 * What counts as a mark comes from outside: each theme says where it draws its own
 * (`MapTheme.markFootprint`), roads are shared geometry (`roadSpots`), and the map adds the marks it
 * draws itself. This module only applies the rule, and is pure so every case can be tested.
 */

import { regionHash } from "../mapHexView";
import { PIN_OFFSET } from "../mapNotes";
import { HEX_RADIUS, type ZoomBand } from "../mapViewport";
import { BLOCKED_LABEL_DROP } from "./geometry";
import { ROAD_VECTORS, type HexView, type RoadDirection } from "./hexView";

/** Room a mark takes in a hex: a circle, centred on the hex, in fractions of `HEX_RADIUS`. */
export type MarkSpot = { x: number; y: number; r: number };

/**
 * A mark's room, from a theme's own drawing coordinates: a point and a size in units of a hex drawn
 * at `radius`. Every theme draws at its mockup's radius, so this is how it states its footprint
 * in the numbers it already draws with.
 */
export function markSpot(at: { x: number; y: number }, size: number, radius: number): MarkSpot {
  return { x: at.x / radius, y: at.y / radius, r: size / radius };
}

/** The spike's five spots: upper-left, upper-right, centre, lower-left, lower-right. */
export const SYMBOL_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-0.42, -0.22],
  [0.36, -0.3],
  [0, 0.12],
  [-0.3, 0.45],
  [0.38, 0.38]
];

/** How far a spot may be nudged either way, and how often one is left out. */
const NUDGE = 0.12;
const OMIT_CHANCE = 0.25;

/** The room a symbol needs beyond a mark's own radius before it may be drawn next to it. */
const CLEARANCE = 0.2;

/** Where along a road its room is taken, and how wide; the spike's numbers. */
const ROAD_STEPS = [0.15, 0.45, 0.75];
const ROAD_WIDTH = 0.18;

/** The room the roads out of a hex take: three points out along each road's bearing. */
export function roadSpots(roads: readonly RoadDirection[]): MarkSpot[] {
  return roads.flatMap((direction) => {
    const { x, y } = ROAD_VECTORS[direction];
    return ROAD_STEPS.map((t) => ({ x: round(x * t), y: round(y * t), r: ROAD_WIDTH }));
  });
}

function round(value: number): number {
  return Number(value.toFixed(4)) + 0;
}

/** The room the note pin and the blocked label take: each about a symbol's width. */
const PIN_ROOM = 0.3;
const BLOCKED_LABEL_ROOM = 0.3;

/**
 * The room taken by the marks the map draws itself, the same under every theme: the roads out of
 * the hex, the label where guards stopped a move into it, and the pin of a note shown on the map
 * (`pinned` - whether this hex has one, with the Notes badge on).
 */
export function mapMarkSpots(view: HexView, pinned: boolean): MarkSpot[] {
  const spots = roadSpots(view.roads);
  if (view.blocked !== null) {
    spots.push({ x: 0, y: BLOCKED_LABEL_DROP, r: BLOCKED_LABEL_ROOM });
  }
  if (pinned) {
    spots.push({ x: PIN_OFFSET.x, y: PIN_OFFSET.y, r: PIN_ROOM });
  }
  return spots;
}

/** A small xorshift generator: the same seed gives the same run, which is the point. */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Where this hex's symbols are drawn, as world-space offsets from its centre.
 *
 * Seeded from the region id alone, so the pattern never changes between redraws: switching a badge
 * only takes spots away or gives them back, it never reshuffles the rest. The generator is drawn
 * from for every spot whether or not that spot survives, for the same reason.
 */
export function biomeSymbolPlacements(
  view: HexView,
  occupied: readonly MarkSpot[]
): Array<{ x: number; y: number }> {
  if (view.terrainKind === "other") {
    return [];
  }
  const next = generator(regionHash(`${view.key}:symbols`));
  const placements: Array<{ x: number; y: number }> = [];
  for (const [spotX, spotY] of SYMBOL_SPOTS) {
    const x = spotX + (next() - 0.5) * NUDGE;
    const y = spotY + (next() - 0.5) * NUDGE;
    if (next() < OMIT_CHANCE) {
      continue;
    }
    if (occupied.some((mark) => Math.hypot(mark.x - x, mark.y - y) < mark.r + CLEARANCE)) {
      continue;
    }
    placements.push({ x: x * HEX_RADIUS, y: y * HEX_RADIUS });
  }
  return placements;
}

/**
 * How strongly a hex's symbols are drawn: as much of them as still shows of the terrain under the
 * theme's wash, so a faded hex's symbols fade with it rather than standing out over it.
 */
export function biomeSymbolOpacity(view: HexView): number {
  return Number((1 - view.fogOpacity).toFixed(3));
}

/**
 * Whether the symbols are drawn: when they are on, and not when the map is zoomed far out - the same
 * band at which every theme hides its unit marks and settlement squares.
 */
export function drawsBiomeSymbols(band: ZoomBand, on: boolean): boolean {
  return on && band !== "far";
}
