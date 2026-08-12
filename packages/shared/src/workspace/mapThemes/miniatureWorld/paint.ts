/**
 * How the diorama is composed.
 *
 * Not a grid of stations but a **scene**, laid out like a painting: the settlement holds the
 * centre, the guard stands at the north-west approach, monsters prowl the eastern rim, the arch
 * rises in the west, the pit sinks south-west, cave and harbour share the south-east shore,
 * workshops sit north-east, and the people gather along the bottom.
 *
 * The grounds are fixed for the same reason the other designs fix their anchors - a full hex has to
 * read as a rich scene rather than as icons piled on each other - but they are chosen for depth
 * rather than for symmetry: things that are far away sit high in the frame, things nearby sit low.
 *
 * Coordinates are the proposal's own, at radius 46 (`hex-design-proposals.html`, proposal 03).
 */

import type { SettlementTier } from "../hexView";

export const MOCKUP_RADIUS = 46;

/** Where each piece of the scene stands. */
export const GROUNDS = {
  guard: { x: -23.92, y: -16.56 },
  battle: { x: 20.7, y: -21.16 },
  gate: { x: -25.76, y: -2 },
  monsters: { x: 27.6, y: -4 },
  shaft: { x: -14.72, y: 14.72 },
  cave: { x: 13.8, y: 12.88 },
  harbour: { x: 17.48, y: 8.28 },
  workshops: { x: 23.92, y: -13.8 },
  people: { x: 0, y: 25.76 }
} as const;

/** Where the settlement's name is written, above the roofs. */
export const NAME_Y = -22;

/** How far apart two groups of people stand, and how far below them the count is printed. */
const STAND_PITCH = 13.5;
const COUNT_DROP = 9;

export type Roof = { x: number; y: number; scale: number };

/**
 * The roofs of a settlement, and whether the ground under them is shadowed.
 *
 * This design's whole claim about settlements is that the tier is readable from the cluster alone,
 * with no label and no legend: one roof is a village, two a town, and six plus a ground shadow a
 * city. The scales and offsets are the proposal's, which stagger the roofs so a city reads as a
 * huddle seen in perspective rather than as a row.
 */
export function roofCluster(tier: SettlementTier | null): { roofs: Roof[]; shadow: boolean } {
  if (tier === "city") {
    return {
      roofs: [
        { x: 0, y: -11, scale: 1.1 },
        { x: -9, y: -5, scale: 1 },
        { x: 9, y: -5, scale: 1 },
        { x: 0, y: -1, scale: 0.9 },
        { x: -8, y: -12, scale: 0.8 },
        { x: 8, y: -12, scale: 0.8 }
      ],
      shadow: true
    };
  }
  if (tier === "town") {
    return {
      roofs: [
        { x: -6, y: -5, scale: 1 },
        { x: 6, y: -5, scale: 1 }
      ],
      shadow: false
    };
  }
  // A village, and anything whose tier the report never stated.
  return { roofs: [{ x: 0, y: -6, scale: 1 }], shadow: false };
}

/**
 * How many little people stand for a count of units.
 *
 * Three at most: past that the figures stop being a crowd and start being a texture, and the
 * printed count carries the number anyway.
 */
export function figureCount(units: number): number {
  if (units <= 2) {
    return 1;
  }
  return units <= 8 ? 2 : 3;
}

export type Stand = { group: "own" | "foreign" | "monster"; count: number; x: number };

/**
 * Who is gathered along the bottom of the scene.
 *
 * The three groups partition the hex: the view model's `foreign` is the whole foreign tally with
 * the monsters still inside it, so a stand built from it directly would count every monster twice.
 */
export function unitStand(units: { own: number; foreign: number; monster: number }): Stand[] {
  const groups: Array<{ group: Stand["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster }
  ];
  const present = groups.filter((group) => group.count > 0);

  return present.map((group, index) => ({
    ...group,
    x: (index - (present.length - 1) / 2) * STAND_PITCH
  }));
}

export const STAND_COUNT_DROP = COUNT_DROP;

/**
 * What is painted on a terrain in flat-colour mode.
 *
 * Only the terrains with something that obviously stands or moves on them; the rest are ground and
 * are left as ground. With the biome images on, these are dropped entirely - the photograph is
 * doing this job, and painting two mountains over a picture of a mountain is the one thing this
 * design must not do.
 */
export function decorationFor(terrain: string): "peaks" | "trees" | "waves" | "dunes" | null {
  switch (terrain.toLowerCase()) {
    case "mountain":
    case "volcano":
      return "peaks";
    case "forest":
    case "jungle":
    case "underforest":
    case "swamp":
      return "trees";
    case "ocean":
      return "waves";
    case "desert":
    case "wasteland":
      return "dunes";
    default:
      return null;
  }
}
