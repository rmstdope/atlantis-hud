/**
 * Where Chronicle puts things, and why.
 *
 * Chronicle is an illuminated campaign map: watercolour washes on parchment, a little ink icon for
 * every terrain, towns as castles, units as heraldic shields. Like every theme here it keeps a
 * **fixed anchor** for each mark, so a crowded hex reads as a crowded page of the same chronicle
 * rather than as a different design:
 *
 * - the castle stands in the middle, a little north, with its name written under its gate;
 * - the guard's banner flies north-west and the crossed swords of a battle lie north-east;
 * - the gate's arch stands west and a ship rides east, workshops huddle against the castle's west
 *   wall;
 * - the shaft's headframe is south-west and a lair's mouth south-east;
 * - the units march along the southern edge: your shield, then the others', then the serpent.
 *
 * Coordinates are the mockup's own, drawn at radius 32 (`new-themes.html`, the Chronicle card).
 * The layer components scale the whole hex by `HEX_RADIUS / 32`, so these numbers can be compared
 * with the mockup directly.
 */

import { regionHash } from "../../mapHexView";
import { markSpot, type MarkSpot } from "../biomeSymbols";
import type { HexView, SettlementTier } from "../hexView";
import type { TerrainPaint } from "../terrain";

/** The radius the mockup was drawn at. Everything below is in its coordinates. */
export const MOCKUP_RADIUS = 32;

/** The compass this design is built on, in mockup units from the hex's centre. */
export const ANCHORS = {
  settlement: { x: 0, y: -6 },
  guard: { x: -15, y: -17 },
  battle: { x: 15, y: -15 },
  gate: { x: -22, y: -1 },
  harbour: { x: 21, y: -1 },
  workshops: { x: -14, y: -4 },
  shaft: { x: -20, y: 8 },
  lair: { x: 20, y: 8 },
  units: { x: 0, y: 18 },
} as const;

/** How far below the castle's centre its name's baseline sits. Under the gate, over the shields. */
export const NAME_DROP = 14;

export type CastleGlyph = {
  /** What is drawn: a lone tower and a cottage, a walled town, or a walled town with a keep. */
  kind: "village" | "town" | "city" | "unknown";
  /** How much the glyph is scaled, so a tier reads by size as well as by shape. */
  scale: number;
};

/**
 * What a settlement is drawn as.
 *
 * A village is a single tower beside a cottage, a town the mockup's walled castle, and a city the
 * same castle with a keep rising behind it - three shapes, three sizes. A settlement whose tier
 * nobody reported (a name heard from a neighbour's exits) is only pencilled in: a lone tower
 * sketched in dashes, rather than a size claimed on no evidence.
 */
export function castleOf(tier: SettlementTier | null): CastleGlyph {
  switch (tier) {
    case "city":
      return { kind: "city", scale: 1 };
    case "town":
      return { kind: "town", scale: 0.9 };
    case "village":
      return { kind: "village", scale: 0.85 };
    default:
      return { kind: "unknown", scale: 0.85 };
  }
}

/** The room a castle takes: centre and size, in mockup units around the settlement anchor. */
const CASTLE_ROOM: Record<
  CastleGlyph["kind"],
  { above: number; size: number }
> = {
  city: { above: 6, size: 14 },
  town: { above: 4, size: 12 },
  village: { above: 3, size: 9 },
  unknown: { above: 3, size: 8 },
};

export type UnitMark = {
  group: "own" | "foreign" | "monster";
  count: number;
  x: number;
};

/** How far apart two marks in the unit row stand. */
const UNIT_PITCH = 12;

/**
 * The unit row along the southern edge: a blue shield for yours, a red one for everybody else's,
 * and a coiled serpent for the monsters, in that order and centred whatever it holds.
 *
 * The view model's `foreign` is the whole foreign tally with the monsters still inside it, so the
 * red shield counts `foreign - monster`; otherwise every monster would be counted twice.
 */
export function unitRow(units: {
  own: number;
  foreign: number;
  monster: number;
}): UnitMark[] {
  const groups: Array<{ group: UnitMark["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster },
  ];
  const present = groups.filter((group) => group.count > 0);
  return present.map((group, index) => ({
    ...group,
    x: (index - (present.length - 1) / 2) * UNIT_PITCH,
  }));
}

/**
 * The numeral painted inside a shield, in mockup units. Two digits fit the shield at the mockup's
 * size; a third would spill over its edges, so a three-digit count is set smaller.
 */
export function numeralSize(count: number): number {
  return count >= 100 ? 5.5 : 8;
}

/**
 * How many roofs the workshops get: none, one, or a hall of two. Banded rather than one roof per
 * building, as the map has always done - a roof per building drowns the hex.
 */
export function workshopRoofs(buildings: number): 0 | 1 | 2 {
  if (buildings <= 0) {
    return 0;
  }
  return buildings <= 3 ? 1 : 2;
}

/**
 * Whether a hex gets its little ink terrain icon.
 *
 * Not where a castle stands - the mockup leaves a town's hex to its castle, and an icon under the
 * walls only muddies both. And not on ground nobody has walked: a named hex keeps its terrain's
 * wash, faint, and the chronicler has drawn nothing on it yet.
 */
export function drawsTerrainIcon(view: HexView): boolean {
  return !view.unsurveyed && view.settlement === null;
}

/**
 * How strongly the terrain icon is inked. Full on a current hex; faded as a stale sighting ages, so
 * an old page's ink looks old; and a little lighter over a biome photograph, which is busy enough.
 */
export function iconOpacity(view: HexView): number {
  const faded =
    view.fogOpacity > 0 ? Math.max(0.3, 1 - 1.4 * view.fogOpacity) : 1;
  const base = view.texture ? 0.8 : 1;
  return round(base * faded);
}

/**
 * How strongly the watercolour is laid on. A named hex keeps its terrain's colour, since terrain
 * is the one thing a neighbour's word tells, but only as a faint wash: nobody has painted it in.
 */
export function washOpacity(view: HexView): number {
  return view.unsurveyed ? 0.6 : 0.75;
}

/**
 * How thick the parchment veil over a biome photograph is. Light over walked ground, just enough
 * to keep the ink legible; heavier over a named hex, the photograph's version of the faint wash,
 * so unwalked ground does not look as finished as ground somebody has surveyed.
 */
export function veilOpacity(view: HexView): number {
  return view.unsurveyed ? 0.55 : 0.32;
}

/** Every terrain kind with its icon's id in the theme's `<defs>`. */
export function iconId(kind: TerrainPaint): string {
  return `ch-icon-${kind}`;
}

/**
 * A small, stable nudge for a hex's icon so neighbouring hexes do not look stamped: an offset of a
 * couple of mockup units and, for every other hex, a mirror image.
 */
export function iconPlacement(key: string): {
  dx: number;
  dy: number;
  mirror: boolean;
} {
  const hash = regionHash(`${key}:icon`);
  return {
    dx: ((hash % 5) - 2) * 0.8,
    dy: (((hash >>> 3) % 5) - 2) * 0.6,
    mirror: ((hash >>> 6) & 1) === 1,
  };
}

/** How many brush outlines there are to choose from; each hex takes one by its key. */
export const WASH_VARIANTS = 8;

/**
 * A watercolour wash's outline: the hexagon with its edges wobbling a little outward and its
 * corners softened, so neighbouring washes overlap and pool along their seams instead of meeting on
 * a hard grid line - the mockup's look, without an SVG filter on every hex.
 *
 * Twelve points, one at each corner and one at each edge's middle, pushed outward by a jittered
 * amount and joined by quadratic curves through their midpoints. Deterministic per variant, so the
 * eight outlines are worked out once and shared.
 */
export function washOutline(variant: number): string {
  const corner = MOCKUP_RADIUS;
  const apothem = (MOCKUP_RADIUS * Math.sqrt(3)) / 2;
  let seed = regionHash(`wash:${variant}`) || 1;
  const random = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
  const points = Array.from({ length: 12 }, (_, index) => {
    const angle = (Math.PI / 6) * index + (random() - 0.5) * 0.08;
    const radius =
      index % 2 === 0
        ? corner + 1 + random() * 1.5
        : apothem + 1.2 + random() * 1.8;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const fmt = (point: { x: number; y: number }) =>
    `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  const start = mid(points[11], points[0]);
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return `Q${fmt(point)} ${fmt(mid(point, next))}`;
  });
  return `M${fmt(start)} ${segments.join(" ")} Z`;
}

/** The wash outline a hex takes, by its key. */
export function washVariant(key: string): number {
  return regionHash(`${key}:wash`) % WASH_VARIANTS;
}

/**
 * Where this theme draws its marks in a hex, for the biome symbols to keep clear of (ah-d9jb.4).
 *
 * Read off the same anchors `MarkLayer` draws at, each with the size of what is drawn there. The
 * name is drawn at a constant size on screen, so its room is a fair middle of how wide a name runs
 * at the zooms the symbols are shown at.
 */
export function markFootprint(view: HexView): MarkSpot[] {
  const spots: MarkSpot[] = [];
  const claim = (at: { x: number; y: number }, size: number) =>
    spots.push(markSpot(at, size, MOCKUP_RADIUS));

  if (view.settlement) {
    const castle = castleOf(view.settlement.tier);
    const room = CASTLE_ROOM[castle.kind];
    claim(
      { x: ANCHORS.settlement.x, y: ANCHORS.settlement.y - room.above },
      room.size,
    );
    claim({ x: 0, y: ANCHORS.settlement.y + NAME_DROP - 3 }, 9);
  }
  if (view.guard) {
    // The banner flies east of its pole, so its room is centred along the flag.
    claim({ x: ANCHORS.guard.x + 4, y: ANCHORS.guard.y - 2 }, 7);
  }
  if (view.battle) {
    claim(ANCHORS.battle, 6);
  }
  if (view.gate) {
    claim(ANCHORS.gate, 6);
  }
  if (view.ships > 0) {
    claim({ x: ANCHORS.harbour.x, y: ANCHORS.harbour.y - 3 }, 7);
  }
  if (workshopRoofs(view.buildings) > 0) {
    claim(ANCHORS.workshops, 5);
  }
  if (view.shafts > 0) {
    claim(ANCHORS.shaft, 6);
  }
  if (view.lairs > 0) {
    claim(ANCHORS.lair, 6);
  }
  for (const mark of unitRow(view.units)) {
    claim({ x: mark.x, y: ANCHORS.units.y }, 7);
  }
  return spots;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
