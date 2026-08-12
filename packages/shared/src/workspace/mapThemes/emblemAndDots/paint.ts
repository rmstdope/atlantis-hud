/**
 * How Emblem & Dots decides what a hex says.
 *
 * Built on the premise that everything can be present at once. However much a hex holds it shows
 * **one** large medallion - its most important fact, by a fixed priority - and everything else drops
 * into small shaped dots along the bottom. Density changes the number of dots and nothing else, so
 * the congested city hex and the empty plain have the same layout.
 *
 * Coordinates are the proposal's own, at radius 46 (`hex-design-proposals.html`, proposal 04).
 */

import type { HexView, SettlementTier } from "../hexView";

export const MOCKUP_RADIUS = 46;

/** Where the medallion sits, and how big it is. */
export const MEDALLION = { x: 0, y: -8, r: 14 };

/** Where the settlement's name is written, above the medallion. */
export const NAME_Y = -28;

/** The unit bar's track, and the two rows of dots below it. */
export const BAR = { x: -16, y: 15.56, width: 32, height: 7, inset: 1 };
export const DOT_ROW_Y = 26.68;
const DOT_ROW_PITCH = 8;
const DOT_PITCH = 9;

/** How far in from the edge the guard perimeter is drawn, as a fraction of the radius. */
export const GUARD_RING = 39.6 / MOCKUP_RADIUS;

export type Feature = "battle" | "settlement" | "gate" | "shaft" | "lair" | "ship";

/**
 * What a hex is *about*, in order.
 *
 * A battle outranks everything: it is the one fact that changes what you do this turn. Then the
 * settlement, which is why most hexes matter at all; then the ways in and out - a gate, a shaft -
 * then what is dangerous, then what can sail.
 */
export const EMBLEM_PRIORITY: Feature[] = [
  "battle",
  "settlement",
  "gate",
  "shaft",
  "lair",
  "ship"
];

function has(view: HexView, feature: Feature): boolean {
  switch (feature) {
    case "battle":
      return view.battle;
    case "settlement":
      return view.settlement !== null;
    case "gate":
      return view.gate;
    case "shaft":
      return view.shafts > 0;
    case "lair":
      return view.lairs > 0;
    case "ship":
      return view.ships > 0;
  }
}

/** The one fact the medallion states, or null for a hex holding none of them. */
export function emblemFor(view: HexView): Feature | null {
  return EMBLEM_PRIORITY.find((feature) => has(view, feature)) ?? null;
}

export type DotShape = "square" | "circle" | "diamond" | "triangle";
export type Dot = { feature: string; shape: DotShape; row: number; x: number };

/**
 * Everything the medallion is not already saying.
 *
 * Each feature keeps its own **shape** as well as its own colour, so the row still reads for anyone
 * who cannot separate the colours - and so a dot is identifiable in the dark half of a screenshot.
 * The order is fixed, so a hex that gains a feature does not reshuffle the ones it already had.
 */
const DOT_ORDER: Array<{ feature: string; shape: DotShape }> = [
  { feature: "battle", shape: "diamond" },
  { feature: "settlement", shape: "square" },
  { feature: "gate", shape: "diamond" },
  { feature: "shaft", shape: "square" },
  { feature: "lair", shape: "triangle" },
  { feature: "ship", shape: "circle" },
  { feature: "monsters", shape: "triangle" },
  { feature: "buildings", shape: "circle" }
];

/** More than this in a row and it would run off the edge of the hex, so it wraps. */
const ROW_LIMIT = 4;

export function dotRow(view: HexView): Dot[] {
  const emblem = emblemFor(view);
  const present = DOT_ORDER.filter(({ feature }) => {
    if (feature === emblem) {
      // Stated once. The medallion is the loudest way to say it, so it is not repeated below.
      return false;
    }
    if (feature === "monsters") {
      return view.units.monster > 0;
    }
    if (feature === "buildings") {
      return view.buildings > 0;
    }
    return has(view, feature as Feature);
  });

  const rows = present.length > ROW_LIMIT ? 2 : 1;
  const perRow = Math.ceil(present.length / rows);

  return present.map((dot, index) => {
    const row = Math.floor(index / perRow);
    const inRow = present.slice(row * perRow, (row + 1) * perRow).length;
    const place = index - row * perRow;
    return { ...dot, row, x: (place - (inRow - 1) / 2) * DOT_PITCH };
  });
}

/** How far below the first row of dots the second sits. */
export const DOT_ROW_STEP = DOT_ROW_PITCH;

export type BarSegment = { group: "own" | "foreign" | "monster"; x: number; width: number };

/**
 * The units, as one bar whose length is the head-count and whose colour split is the grouping.
 *
 * One bar rather than one mark per group: this design's whole argument is that congestion should
 * change a quantity, not a layout. The groups partition the hex - the view model's `foreign` still
 * holds the monsters - so the segments subtract before they are laid end to end.
 */
export function unitBar(units: { own: number; foreign: number; monster: number }): {
  total: number;
  width: number;
  segments: BarSegment[];
} | null {
  const groups: Array<{ group: BarSegment["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster }
  ];
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  if (total <= 0) {
    return null;
  }

  const width = BAR.width - BAR.inset * 2;
  let x = BAR.x + BAR.inset;
  const segments: BarSegment[] = [];
  for (const group of groups) {
    if (group.count <= 0) {
      continue;
    }
    const segment = (group.count / total) * width;
    segments.push({ group: group.group, x, width: segment });
    x += segment;
  }

  return { total, width, segments };
}

/**
 * The settlement's tier, as pips under the medallion.
 *
 * None at all when the report never said the size - a hex known from a neighbour's exits carries
 * the name and nothing else, and one pip would claim a village on no evidence.
 */
export function tierPips(tier: SettlementTier | null): number {
  if (tier === "city") {
    return 3;
  }
  if (tier === "town") {
    return 2;
  }
  return tier === "village" ? 1 : 0;
}
