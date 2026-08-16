/**
 * Where Field Marks puts things, and which external image file goes at each anchor.
 *
 * Same idea as Cartographer's Table's `paint.ts` - a fixed compass anchor per mark, in the design
 * proposal's own radius-46 coordinates - but every mark here is an external image file rather than
 * a hand-drawn path, because that is the one thing this theme exists to be: a set of icons the
 * player supplies, at a spot in the code that says exactly what file goes where.
 *
 * Nothing here imports another theme - see `mapTheme.ts` - so the anchors are this theme's own,
 * even though several are the same numbers Cartographer's Table settled on for the same bearings.
 */

import type { SettlementTier } from "../hexView";

export const MOCKUP_RADIUS = 46;

export const ANCHORS = {
  guard: { x: -24.84, y: -19.32 },
  monsters: { x: 27.6, y: -1 },
  shaft: { x: -15.64, y: 14.72 },
  lair: { x: 14.72, y: 13.8 },
  harbour: { x: 16.56, y: 10.12 },
  shields: { x: 0, y: 27.6 },
  workshops: { x: 23, y: -14.72 }
} as const;

const WORKSHOP_STEP = { x: 4.6, y: 6.9 };
const SHIELD_PITCH = 14;
export const SHIELD_COUNT_DROP = 12.5;

/**
 * Every image file this theme references, and nothing it does not - `badges.test.ts` checks the
 * two stay the same list. `BADGES_DIR` is where a player drops the files; nothing else in the
 * app writes there, so restoring the shipped set (once there is one) is deleting the directory.
 *
 * Sizes are the square an image is drawn into, in this file's own radius-46 coordinates - see
 * `docs/ui/field-marks-icons.md` for the full brief (exact pixel export sizes, style notes, and
 * one worked example) a player draws from. A file that has not arrived yet simply draws nothing:
 * an `<image>` with no source paints an empty square, never a broken-image glyph.
 */
export const BADGE_KEYS = [
  "settlement-house",
  "settlement-keep",
  "guard-own",
  "guard-foreign",
  "monster",
  "shaft",
  "lair",
  "ship",
  "unit-own",
  "unit-foreign",
  "unit-monster"
] as const;

export type BadgeKey = (typeof BADGE_KEYS)[number];

export const BADGES_DIR = "/badges";

export type BadgeSpec = {
  key: BadgeKey;
  file: string;
  /** The square this image is drawn into, in radius-46 units - see the anchor it is drawn at. */
  size: number;
  description: string;
};

export const BADGE_SPECS: Record<BadgeKey, BadgeSpec> = {
  "settlement-house": {
    key: "settlement-house",
    file: "settlement-house.svg",
    size: 16,
    description:
      "A village's or town's settlement. Drawn once for a village and twice, side by side, for a " +
      "town - and reused, scaled down, for a workshop band, so one file stands for all three."
  },
  "settlement-keep": {
    key: "settlement-keep",
    file: "settlement-keep.svg",
    size: 34,
    description: "A city's settlement - the one tier that gets its own icon rather than a repeat."
  },
  "guard-own": {
    key: "guard-own",
    file: "guard-own.svg",
    size: 20,
    description: "The guard banner when the hex's guard is this faction's own."
  },
  "guard-foreign": {
    key: "guard-foreign",
    file: "guard-foreign.svg",
    size: 20,
    description: "The guard banner when the hex's guard belongs to somebody else."
  },
  monster: {
    key: "monster",
    file: "monster.svg",
    size: 14,
    description: "Presence marker, east rim, whenever a monster faction holds units in the hex."
  },
  shaft: {
    key: "shaft",
    file: "shaft.svg",
    size: 16,
    description: "A shaft down to the underworld, south-west."
  },
  lair: {
    key: "lair",
    file: "lair.svg",
    size: 16,
    description: "A monster lair, south-east."
  },
  ship: {
    key: "ship",
    file: "ship.svg",
    size: 22,
    description: "A harbour with something afloat in it."
  },
  "unit-own": {
    key: "unit-own",
    file: "unit-own.svg",
    size: 12,
    description:
      "One of the south-edge unit-group shields, for this faction's own units. Pre-coloured by " +
      "the file itself - see the colour note in the brief - rather than tinted in code."
  },
  "unit-foreign": {
    key: "unit-foreign",
    file: "unit-foreign.svg",
    size: 12,
    description: "The same shield, pre-coloured for another faction's units."
  },
  "unit-monster": {
    key: "unit-monster",
    file: "unit-monster.svg",
    size: 12,
    description: "The same shield again, pre-coloured for a monster faction."
  }
};

/** Where a badge's file is served from - every reference in `index.tsx` goes through this. */
export function badgeHref(key: BadgeKey): string {
  return `${BADGES_DIR}/${BADGE_SPECS[key].file}`;
}

export type SettlementGlyph = { key: BadgeKey; houses: number };

/** Same tiers Cartographer's Table draws, resolved to which file (and how many copies) to use. */
export function keepOf(tier: SettlementTier | null): SettlementGlyph {
  if (tier === "city") {
    return { key: "settlement-keep", houses: 0 };
  }
  return { key: "settlement-house", houses: tier === "town" ? 2 : 1 };
}

export function housePositions(houses: number): Array<{ x: number; y: number }> {
  if (houses <= 1) {
    return [{ x: 0, y: -4 }];
  }
  return [
    { x: -6, y: -3 },
    { x: 6, y: -5 }
  ];
}

export function nameLift(tier: SettlementTier | null): number {
  return tier === "city" ? -26 : -15;
}

export type Shield = { group: "own" | "foreign" | "monster"; count: number; x: number };

/** Identical partition to Cartographer's Table's `shieldRow` - see its own doc comment. */
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

export function workshopAnchors(buildings: number): Array<{ x: number; y: number }> {
  const roofs = buildings <= 0 ? 0 : buildings <= 3 ? 1 : buildings <= 6 ? 2 : 3;
  return Array.from({ length: roofs }, (_, index) => ({
    x: ANCHORS.workshops.x + index * WORKSHOP_STEP.x,
    y: ANCHORS.workshops.y + index * WORKSHOP_STEP.y
  }));
}
