/**
 * Where Tactical HUD puts things, and why.
 *
 * The design is a **station grid**: seven reserved positions round the hex, the settlement in the
 * centre, unit counters above the southern edge and the name along it. A mark is either present at
 * its station or the station is empty - nothing ever shifts to make room, so a hex carrying every
 * mark at once has no collisions to resolve and an empty hex shows only terrain and lattice.
 *
 * Counts are **stated**, never estimated by the size of a mark: this design's whole argument is
 * that a commander wants the number.
 *
 * Coordinates are the design proposal's own, drawn at radius 46 (`hex-design-proposals.html`,
 * proposal 02); the layer components scale the hex down to `HEX_RADIUS` in one transform.
 */

import type { SettlementTier } from "../hexView";

export const MOCKUP_RADIUS = 46;

/**
 * The seven stations, clockwise from the top left. Left and right mirror each other so the readout
 * stays balanced whichever marks a hex happens to carry.
 */
export const STATIONS = {
  ship: { x: -18.4, y: -17.48 },
  battle: { x: 0, y: -28.98 },
  gate: { x: 18.4, y: -17.48 },
  shaft: { x: -26.68, y: 0 },
  monster: { x: 26.68, y: 0 },
  lair: { x: -18.4, y: 17.48 },
  buildings: { x: 25.76, y: 14.72 }
} as const;

/** Where the counters sit, and how far apart. Above the name, which owns the southern edge. */
export const COUNTER_ROW_Y = 24.84;
const COUNTER_PITCH = 19;

/** Where the settlement's name is written, along the southern edge. */
export const NAME_Y = 35.88;

/** Where a stale hex states its age, under the settlement square. */
export const AGE_Y = 11.96;

export type Counter = { group: "own" | "foreign" | "monster"; count: number; x: number };

/**
 * The unit counters, one box per group with its unit count printed in it.
 *
 * Units, not people: the view model counts units and says so.
 *
 * The three groups partition the hex. The view model's `foreign` is the whole foreign tally with
 * the monsters still inside it, so a row built from it directly would count every monster twice.
 */
export function counterRow(units: {
  own: number;
  foreign: number;
  monster: number;
}): Counter[] {
  const groups: Array<{ group: Counter["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster }
  ];
  const present = groups.filter((group) => group.count > 0);

  return present.map((group, index) => ({
    ...group,
    x: (index - (present.length - 1) / 2) * COUNTER_PITCH
  }));
}

/**
 * The building count, prefixed so the number cannot be read as anything else.
 *
 * Unlike every other theme this states the count outright rather than banding it into glyphs: a
 * readout that rounded its own numbers would be a strange sort of readout.
 */
export function buildingLabel(buildings: number): string | null {
  return buildings > 0 ? `B${buildings}` : null;
}

/**
 * How old the reading is, counted down from now.
 *
 * Only a hex that has actually been visited has an age. A hex known from a neighbour's exits has
 * none, and a hex in this turn's report is current - neither gets a number, because "T-0" would
 * claim a reading that was never taken.
 */
export function ageLabel(ageInTurns: number | null): string | null {
  return ageInTurns !== null && ageInTurns > 0 ? `T-${ageInTurns}` : null;
}

/**
 * The settlement square: bigger with the tier, and filled at its core for a town or a city.
 *
 * Two channels rather than one, so the tiers stay apart at a glance even when the hex is small and
 * the difference between three square sizes is a couple of pixels.
 */
export function settlementBox(tier: SettlementTier | null): {
  outer: number;
  inner: number | null;
} {
  if (tier === "city") {
    return { outer: 15.5, inner: 8.5 };
  }
  if (tier === "town") {
    return { outer: 12, inner: 5 };
  }
  // A village, and anything whose tier the report never stated: the plain outline.
  return { outer: 8.5, inner: null };
}

/** How far in from the hex's edge the guard perimeter is drawn, as a fraction of the radius. */
export const GUARD_RING = 38.6 / MOCKUP_RADIUS;
