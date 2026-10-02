/**
 * How Beveled Tile racks a hex.
 *
 * One chip grammar for everything: the battle chip owns the top centre, other feature chips fill
 * the side rails, unit tokens hold the bottom row, and the settlement is a central medallion whose
 * size and pips give the tier. Nothing floats - every mark has a slot, and a full tile is a full
 * rack rather than a crowded one.
 *
 * Coordinates are the proposal's own, at radius 46 (`hex-design-proposals.html`, proposal 05).
 */

import { markSpot, type MarkSpot } from "../biomeSymbols";
import type { HexView, SettlementTier } from "../hexView";

export const MOCKUP_RADIUS = 46;

/** The tile's own radius. Smaller than the hex, and the difference is the seam. */
export const TILE_RADIUS = 42.8;

/** Where the guard ring sits: outside the tile, just inside the lattice. */
export const GUARD_RADIUS = 45.5;

/** The medallion's centre, and the row of building glyphs under it. */
export const MEDALLION_Y = -4;
export const BUILDINGS_Y = 15.3;

/** Where a settlement's name is written, above the medallion. */
export const NAME_Y = -22.9;

/** The bottom row of unit tokens. */
export const TOKEN_ROW_Y = 25.76;
export const TOKEN_RADIUS = 7.5;
const TOKEN_PITCH = 17;

/** The chip the battle owns, and where it steps aside to when a name holds the top of the tile. */
const BATTLE_CENTRE = { x: 0, y: -25.76 };
const BATTLE_BESIDE_NAME = { x: 17.48, y: -25.76 };

/**
 * The side rails, in the order they fill: the left rail top-down, then the right.
 *
 * Five slots, which is what the rails hold. A tile carrying more than five rackable features
 * overflows, and clamping is the accepted answer - the alternative is chips off the edge of the
 * tile, which is the one thing this design promises never to do.
 */
export const RAILS: Array<{ x: number; y: number }> = [
  // The left rail follows the tile's own edge: it starts tucked in, because a hexagon has already
  // narrowed by the time it reaches the top. A slot further out up there put its chip over the
  // neighbouring tile - the one thing a racked design must never do.
  { x: -17.48, y: -25.76 },
  { x: -25.3, y: -12 },
  { x: -25.3, y: 4 },
  { x: 25.3, y: -12 },
  { x: 25.3, y: 4 }
];

/** How big a chip is. */
export const CHIP_RADIUS = 7;

export function battleChip(besideName: boolean): { x: number; y: number } {
  return besideName ? BATTLE_BESIDE_NAME : BATTLE_CENTRE;
}

export type RailChip = { feature: string; at: { x: number; y: number } };

/**
 * What goes on the rails, in a fixed order.
 *
 * Fixed so that a tile which gains a feature does not rearrange the ones it already had - the rack
 * should look like the same rack from turn to turn, with one more chip in it.
 */
const RAIL_ORDER = ["gate", "shaft", "lair", "ship", "monsters"] as const;

export function railChips(features: {
  gate: boolean;
  shafts: number;
  lairs: number;
  ships: number;
  monsters: number;
}): RailChip[] {
  const present = RAIL_ORDER.filter((feature) => {
    switch (feature) {
      case "gate":
        return features.gate;
      case "shaft":
        return features.shafts > 0;
      case "lair":
        return features.lairs > 0;
      case "ship":
        return features.ships > 0;
      case "monsters":
        return features.monsters > 0;
    }
  });

  return present.slice(0, RAILS.length).map((feature, index) => ({
    feature,
    at: RAILS[index]
  }));
}

export type Token = { group: "own" | "foreign" | "monster"; count: number; x: number };

/**
 * The unit tokens along the bottom row.
 *
 * The three groups partition the tile: the view model's `foreign` is the whole foreign tally with
 * the monsters still inside it, so a row built from it directly would count every monster twice.
 */
export function tokenRow(units: { own: number; foreign: number; monster: number }): Token[] {
  const groups: Array<{ group: Token["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster }
  ];
  const present = groups.filter((group) => group.count > 0);

  return present.map((group, index) => ({
    ...group,
    x: (index - (present.length - 1) / 2) * TOKEN_PITCH
  }));
}

/**
 * The settlement's medallion: wider with the tier, and counted in pips across its face.
 *
 * Two channels again, size and pips, so the tiers stay apart when the tile is small. No pips at all
 * when the report never said the size - a hex known from a neighbour's exits carries the name and
 * nothing else, and one pip would claim a village on no evidence.
 */
export function medallion(tier: SettlementTier | null): { radius: number; pips: number } {
  if (tier === "city") {
    return { radius: 13.9, pips: 3 };
  }
  if (tier === "town") {
    return { radius: 12.1, pips: 2 };
  }
  return { radius: 10.4, pips: tier === "village" ? 1 : 0 };
}

/** How far apart the pips sit across the medallion's face. */
export const PIP_PITCH = 5.5;

/** The workshop roofs under the medallion: banded, one to three, as everywhere on the map. */
export function roofAnchors(buildings: number): Array<{ x: number; y: number }> {
  const roofs = buildings <= 0 ? 0 : buildings <= 3 ? 1 : buildings <= 6 ? 2 : 3;
  return Array.from({ length: roofs }, (_, index) => ({ x: (index - 1) * 6, y: BUILDINGS_Y }));
}

/**
 * Where this theme draws its marks in a hex, for the biome symbols to keep clear of (ah-d9jb.4).
 *
 * The medallion and the settlement's name, the battle chip, the chips racked on the rails, the
 * workshop roofs and the token row. The guard is a ring round the rim and claims nothing.
 */
export function markFootprint(view: HexView): MarkSpot[] {
  const spots: MarkSpot[] = [];
  const claim = (at: { x: number; y: number }, size: number) =>
    spots.push(markSpot(at, size, MOCKUP_RADIUS));

  if (view.settlement) {
    claim({ x: 0, y: MEDALLION_Y }, medallion(view.settlement.tier).radius + 2);
    claim({ x: 0, y: NAME_Y }, 14);
  }
  if (view.battle) {
    claim(battleChip(view.settlement !== null), CHIP_RADIUS + 1);
  }
  const chips = railChips({
    gate: view.gate,
    shafts: view.shafts,
    lairs: view.lairs,
    ships: view.ships,
    monsters: view.units.monster
  });
  for (const chip of chips) {
    claim(chip.at, CHIP_RADIUS + 1);
  }
  for (const roof of roofAnchors(view.buildings)) {
    claim(roof, 5);
  }
  for (const token of tokenRow(view.units)) {
    claim({ x: token.x, y: TOKEN_ROW_Y }, TOKEN_RADIUS + 1);
  }
  return spots;
}
