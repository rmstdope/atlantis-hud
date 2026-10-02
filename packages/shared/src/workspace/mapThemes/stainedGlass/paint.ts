/**
 * Where Stained Glass puts things, and how each pane is cut.
 *
 * Every hex is a pane of jewel-toned glass held in a lead came, and every pane is cut into three
 * irregular shards by lead lines of its own. The cut is chosen from the hex's key, not at random,
 * so the window looks hand-leaded but never re-cuts itself on a redraw.
 *
 * The marks keep fixed anchors round a gold-leaf rosette in the middle: small gold glyphs up the
 * sides, the battle starburst at the top right, and the unit gems in a row beneath the rosette.
 * Coordinates are the mockup's own, drawn at radius 32 (`.cerebro/scratch/themes/new-themes.html`,
 * the "glass" entry); the mark layer scales the hex to `HEX_RADIUS` in one transform.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { corners, regionHash } from "../../mapHexView";
import { markSpot, type MarkSpot } from "../biomeSymbols";
import type { HexView, SettlementTier } from "../hexView";

/** The radius the mockup was drawn at. Every mark coordinate below is in its units. */
export const MOCKUP_RADIUS = 32;

/**
 * How a pane is cut: three lead lines from one point near the centre out to three of the hex's
 * corners. `centre` is in fractions of the radius; `cuts` are corner indices into `corners()`
 * (vertex due east is 0, then clockwise on screen), in cyclic order.
 */
export type ShardCut = { centre: { x: number; y: number }; cuts: [number, number, number] };

/** How far the cuts' meeting point may wander from the hex's centre, either way, in radii. */
const CENTRE_WANDER = 0.16;

/** xorshift32, seeded from the key: the mockup's own generator, so the cuts look the same. */
function seeded(seed: number): () => number {
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
 * The cut for one hex, from its key alone.
 *
 * Each cut runs to a corner, and consecutive cuts are always two or three corners apart, so every
 * shard spans at least one whole edge - none is a sliver - and the three of them together tile the
 * hex exactly. The starting corner alternates too, so neighbouring panes are not all cut alike.
 */
export function shardCut(key: string): ShardCut {
  const next = seeded(regionHash(key) + 5);
  const centre = {
    x: round((next() - 0.5) * 2 * CENTRE_WANDER),
    y: round((next() - 0.5) * 2 * CENTRE_WANDER)
  };
  const start = next() < 0.5 ? 0 : 1;
  const second = start + 2 + (next() < 0.5 ? 0 : 1);
  const third = start + 4 + (next() < 0.5 ? 0 : 1);
  return { centre, cuts: [start, second % 6, third % 6] };
}

/** The corners a shard runs along, from one cut round to the next. */
function shardCorners(from: number, to: number): number[] {
  const walked: number[] = [from];
  for (let corner = (from + 1) % 6; corner !== to; corner = (corner + 1) % 6) {
    walked.push(corner);
  }
  walked.push(to);
  return walked;
}

export type ShardShapes = {
  /** The three shards as `points` attributes, in world units about the hex's centre. */
  shards: [string, string, string];
  /** The three lead cuts as one path, in the same units. */
  lead: string;
};

const HEX_CORNERS = corners(HEX_RADIUS);

function point(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function shapesOf(cut: ShardCut): ShardShapes {
  const cx = cut.centre.x * HEX_RADIUS;
  const cy = cut.centre.y * HEX_RADIUS;
  const middle = point(cx, cy);
  const shard = (index: number): string => {
    const from = cut.cuts[index];
    const to = cut.cuts[(index + 1) % 3];
    return [middle, ...shardCorners(from, to).map((c) => point(HEX_CORNERS[c].x, HEX_CORNERS[c].y))].join(
      " "
    );
  };
  const lead = cut.cuts
    .map((c) => `M${middle} L${point(HEX_CORNERS[c].x, HEX_CORNERS[c].y)}`)
    .join(" ");
  return { shards: [shard(0), shard(1), shard(2)], lead };
}

/**
 * Remembered per key: a level holds thousands of panes and their cuts never change, so the
 * strings are built once rather than on every render. Bounded, so switching between huge levels
 * cannot grow it without end.
 */
const SHAPES = new Map<string, ShardShapes>();
const SHAPES_LIMIT = 20000;

/** A hex's three shards and its lead cuts, ready to draw. */
export function shardShapes(key: string): ShardShapes {
  const known = SHAPES.get(key);
  if (known) {
    return known;
  }
  if (SHAPES.size >= SHAPES_LIMIT) {
    SHAPES.clear();
  }
  const shapes = shapesOf(shardCut(key));
  SHAPES.set(key, shapes);
  return shapes;
}

/**
 * The fixed anchors, in mockup units. The rosette sits a little above centre so the gem row and
 * the name fit beneath it; the gold glyphs stand up either side, the battle at the top right.
 */
export const ANCHORS = {
  settlement: { x: 0, y: -5 },
  battle: { x: 9, y: -19 },
  buildings: { x: -9, y: -19 },
  ship: { x: -19, y: -7 },
  gate: { x: 19, y: -7 },
  shaft: { x: -20, y: 4 },
  lair: { x: 20, y: 4 }
} as const;

/** How much room each small gold glyph takes about its anchor. */
export const GLYPH_SIZE = 4.5;
/** The battle starburst's outer and inner radius. */
export const STARBURST = { outer: 6.5, inner: 3 };

/** Where the gem row sits, how far apart its gems are, and how big a gem is. */
export const GEM_ROW_Y = 10;
const GEM_PITCH = 12;
export const GEM = { rx: 5.5, ry: 4.8 };

/** Where the settlement's name is engraved: beneath the gems, along the southern edge. */
export const NAME_Y = 24;

/** How far in from the came the guard's ring runs, as a fraction of the radius. */
export const GUARD_RING = 0.86;

export type Rosette = {
  /** The roundel's radius, in mockup units. */
  radius: number;
  /** How many gold-leaf petals ring it; none for a town whose size the report never gave. */
  petals: number;
};

/**
 * The gold-leaf rosette a settlement is drawn as, sized by its tier and petalled by it too.
 *
 * Two channels rather than one, so the tiers still part at a glance when the hex is small and three
 * sizes of roundel are a pixel apart. A tier the report never stated gets the village's size and a
 * plain roundel with no petals at all - the window does not claim a city it never saw.
 */
export function rosetteOf(tier: SettlementTier | null): Rosette {
  switch (tier) {
    case "city":
      return { radius: 10, petals: 12 };
    case "town":
      return { radius: 8, petals: 8 };
    case "village":
      return { radius: 6, petals: 6 };
    default:
      return { radius: 6, petals: 0 };
  }
}

/**
 * The rosette's petals as one path: a pointed leaf from near the centre out to the rim along each
 * of `petals` evenly spaced bearings. One element for the whole flower, however many petals.
 */
export function petalPath(petals: number, radius: number): string {
  if (petals <= 0) {
    return "";
  }
  const inner = radius * 0.22;
  const outer = radius * 0.86;
  const bulge = radius * 0.24;
  const parts: string[] = [];
  for (let index = 0; index < petals; index += 1) {
    const angle = (Math.PI * 2 * index) / petals - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const mid = (inner + outer) / 2;
    const fx = (value: number) => value.toFixed(2);
    const start = `${fx(cos * inner)},${fx(sin * inner)}`;
    const tip = `${fx(cos * outer)},${fx(sin * outer)}`;
    const left = `${fx(cos * mid - sin * bulge)},${fx(sin * mid + cos * bulge)}`;
    const right = `${fx(cos * mid + sin * bulge)},${fx(sin * mid - cos * bulge)}`;
    parts.push(`M${start} Q${left} ${tip} Q${right} ${start}Z`);
  }
  return parts.join(" ");
}

/** A star of `points` rays, as a `points` attribute about the origin, the first ray straight up. */
export function starburstPoints(points: number, outer: number, inner: number): string {
  return Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
  }).join(" ");
}

export type Gem = { group: "own" | "foreign" | "monster"; count: number; x: number };

/**
 * The cabochon gems beneath the rosette, one per group of units with its count cut into it: gold
 * for your own, ruby for other factions, onyx for monsters.
 *
 * The three groups partition the hex. The view model's `foreign` is the whole foreign tally with
 * the monsters still inside it, so a row built from it directly would count every monster twice.
 * The row is centred whatever it holds.
 */
export function gemRow(units: { own: number; foreign: number; monster: number }): Gem[] {
  const groups: Array<{ group: Gem["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster }
  ];
  const present = groups.filter((group) => group.count > 0);
  return present.map((group, index) => ({
    ...group,
    x: (index - (present.length - 1) / 2) * GEM_PITCH
  }));
}

/**
 * Where this theme draws its marks in a hex, for the biome symbols to keep clear of (ah-d9jb.4).
 *
 * Read off the same anchors `MarkLayer` draws at. The guard is a ring just inside the came and
 * claims nothing; the name is drawn at a constant size on screen, so its room is a fair middle of
 * how wide a name runs at the zooms the symbols are shown at.
 */
export function markFootprint(view: HexView): MarkSpot[] {
  const spots: MarkSpot[] = [];
  const claim = (at: { x: number; y: number }, size: number) =>
    spots.push(markSpot(at, size, MOCKUP_RADIUS));

  if (view.battle) {
    claim(ANCHORS.battle, STARBURST.outer);
  }
  if (view.buildings > 0) {
    claim(ANCHORS.buildings, GLYPH_SIZE);
  }
  if (view.ships > 0) {
    claim(ANCHORS.ship, GLYPH_SIZE);
  }
  if (view.gate) {
    claim(ANCHORS.gate, GLYPH_SIZE);
  }
  if (view.shafts > 0) {
    claim(ANCHORS.shaft, GLYPH_SIZE);
  }
  if (view.lairs > 0) {
    claim(ANCHORS.lair, GLYPH_SIZE);
  }
  if (view.settlement) {
    claim(ANCHORS.settlement, rosetteOf(view.settlement.tier).radius + 1);
    claim({ x: 0, y: NAME_Y }, 12);
  }
  for (const gem of gemRow(view.units)) {
    claim({ x: gem.x, y: GEM_ROW_Y }, GEM.rx);
  }
  return spots;
}

function round(value: number): number {
  return Number(value.toFixed(4)) + 0;
}
