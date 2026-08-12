/**
 * Where Cartographer's Table puts things, and why.
 *
 * Every mark has a **fixed compass anchor**, like the conventions printed on a survey sheet: a
 * mark's place never depends on what else is in the hex, so a hex holding a city, a battle, a
 * guard, three unit groups, works and a ship reads like a busy page of the same atlas rather than
 * a different design. Nothing here moves to make room for anything else.
 *
 * Coordinates are the design proposal's own, drawn at radius 46 (`docs/ui/hex-design-proposals.html`,
 * proposal 01). The layer components scale the whole hex by `HEX_RADIUS / 46`, so these numbers can
 * be read straight off the mockup and compared with it.
 */

import type { SettlementTier } from "../hexView";

/** The radius the proposal was drawn at. Everything below is in its coordinates. */
export const MOCKUP_RADIUS = 46;

/**
 * The compass rose this design is built on.
 *
 * Read them as bearings: guard north-west, battle north-east, gate west, monsters east, shaft
 * south-west, lair and harbour south-east, unit shields along the southern edge.
 */
export const ANCHORS = {
  guard: { x: -24.84, y: -19.32 },
  battle: { x: 20.24, y: -20.24 },
  gate: { x: -27.6, y: 0 },
  monsters: { x: 27.6, y: -1 },
  shaft: { x: -15.64, y: 14.72 },
  lair: { x: 14.72, y: 13.8 },
  harbour: { x: 16.56, y: 10.12 },
  shields: { x: 0, y: 27.6 },
  /** The first workshop roof; the rest cascade right and down from here. */
  workshops: { x: 23, y: -14.72 }
} as const;

const WORKSHOP_STEP = { x: 4.6, y: 6.9 };

/** How far apart two shields stand, and how far below one its count is printed. */
const SHIELD_PITCH = 14;
const COUNT_DROP = 12.5;

export type SettlementGlyph = { kind: "keep" | "houses"; houses: number };

/**
 * What a settlement's tier is drawn as: one house for a village, two for a town, and a
 * three-towered keep for a city.
 *
 * The tiers differ hugely in market depth, recruitment and guard strength, and drawing one glyph
 * for all three was the thing this design set out to fix.
 *
 * An unknown tier gets the village's single house. A hex named by a neighbour's exits carries the
 * settlement's name and nothing else about it, and a keep drawn there would claim a city on no
 * evidence at all.
 */
export function keepOf(tier: SettlementTier | null): SettlementGlyph {
  if (tier === "city") {
    return { kind: "keep", houses: 0 };
  }
  return { kind: "houses", houses: tier === "town" ? 2 : 1 };
}

/** Where a settlement's houses stand, so two of them sit either side of centre rather than overlap. */
export function housePositions(houses: number): Array<{ x: number; y: number }> {
  if (houses <= 1) {
    return [{ x: 0, y: -4 }];
  }
  return [
    { x: -6, y: -3 },
    { x: 6, y: -5 }
  ];
}

/** How high above centre the settlement's name sits. A keep stands taller than a house. */
export function nameLift(tier: SettlementTier | null): number {
  return tier === "city" ? -26 : -15;
}

export type Shield = { group: "own" | "foreign" | "monster"; count: number; x: number };

/**
 * The heraldic shields along the southern edge, one per group of units, with its count beneath.
 *
 * The three groups partition the hex: the view model's `foreign` is the *whole* foreign tally with
 * the monsters still inside it, so a row built from it directly would count every monster twice -
 * once as somebody's unit and once as a monster.
 *
 * The row is centred whatever it holds, so a hex with one group and a hex with three are both
 * balanced on the same edge.
 */
export function shieldRow(units: { own: number; foreign: number; monster: number }): Shield[] {
  const groups: Array<{ group: Shield["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster }
  ];
  const present = groups.filter((group) => group.count > 0);

  return present.map((group, index) => ({
    ...group,
    x: (index - (present.length - 1) / 2) * SHIELD_PITCH
  }));
}

/** How far below a shield its count is printed. */
export const SHIELD_COUNT_DROP = COUNT_DROP;

/**
 * Where the workshop roofs sit, cascading right and down between the settlement and the monsters.
 *
 * Counted in bands rather than one roof per building, for the same reason the map has always
 * banded them: a roof per building drowns the hex, and a single roof says nothing about scale.
 */
export function workshopAnchors(buildings: number): Array<{ x: number; y: number }> {
  const roofs = buildings <= 0 ? 0 : buildings <= 3 ? 1 : buildings <= 6 ? 2 : 3;
  return Array.from({ length: roofs }, (_, index) => ({
    x: ANCHORS.workshops.x + index * WORKSHOP_STEP.x,
    y: ANCHORS.workshops.y + index * WORKSHOP_STEP.y
  }));
}
