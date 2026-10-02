/**
 * Where Blueprint puts things, and why.
 *
 * An architect's cyanotype: terrain is a drafting hatch (a material symbol), a settlement is a
 * small floor plan, units are annotation callouts on leader lines, and a monster sits in a
 * revision cloud. Like the other themes every mark has a **fixed station** in the hex, so a busy
 * hex reads like a busy sheet of the same drawing rather than a different layout.
 *
 * Coordinates are the mockup's own, drawn at radius 32 (`.cerebro/scratch/themes/new-themes.html`,
 * the Blueprint card). The layer components scale each hex's marks by `HEX_RADIUS / 32`, so these
 * numbers can be read against the mockup.
 */

import { markSpot, type MarkSpot } from "../biomeSymbols";
import type { HexView, SettlementTier } from "../hexView";

/** The radius the mockup was drawn at. Everything below is in its coordinates. */
export const MOCKUP_RADIUS = 32;

/**
 * The stations. Read them as bearings: battle north, monster cloud north-east, gate east, shaft
 * west, ship south-west, lair south, works south-east; the two unit callouts run out north-west
 * (own) and south-east (foreign) on their leader lines; the plan sits in the middle.
 */
export const STATIONS = {
  settlement: { x: 0, y: -2 },
  battle: { x: 0, y: -21 },
  monster: { x: 17, y: -12 },
  gate: { x: 24, y: 0 },
  shaft: { x: -24, y: 0 },
  ship: { x: -14, y: 16 },
  lair: { x: 0, y: 22 },
  works: { x: 14, y: 21 },
  /** The near-zoom note on a stale sheet ("rev. t-8") and on an unsurveyed one ("TBD"). */
  note: { x: 0, y: -20 },
} as const;

/**
 * Where the settlement's name is lettered: along the southern edge, clear of the foreign callout
 * above it - a long name lettered just under the plan ran straight through that count.
 */
export const NAME_Y = 24;

export type Callout = {
  group: "own" | "foreign";
  count: number;
  /** Where the leader line starts (the dot), bends, and where the shelf the text sits on ends. */
  dot: { x: number; y: number };
  elbow: { x: number; y: number };
  end: { x: number; y: number };
  /** Where the text is lettered: centred on the shelf, just above it. */
  text: { x: number; y: number };
};

const CALLOUT_GEOMETRY = {
  own: {
    dot: { x: -7, y: -7 },
    elbow: { x: -12, y: -14 },
    end: { x: -23, y: -14 },
  },
  foreign: {
    dot: { x: 7, y: 6 },
    elbow: { x: 12, y: 13 },
    end: { x: 23, y: 13 },
  },
} as const;

/** How far above its shelf a callout's text sits. */
const TEXT_LIFT = 1.6;

/**
 * The annotation callouts, one per group of units.
 *
 * Own units and other factions' units get a callout each, lettered with the count alone: the colour
 * says whose they are (ink for own, amber for foreign). A word beside it ("3 own", "2 frn") was
 * tried and, being lettered at a constant screen size, ran into the neighbouring hex's callout at
 * every zoom the map offers. Monsters are not a callout - they are
 * drawn in their own revision cloud - so the foreign callout counts the foreign tally *without*
 * them: the view model's `foreign` still has the monsters inside it, and counting from it directly
 * would write every monster down twice.
 */
export function callouts(units: {
  own: number;
  foreign: number;
  monster: number;
}): Callout[] {
  const groups: Array<{ group: Callout["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
  ];
  return groups
    .filter((group) => group.count > 0)
    .map((group) => {
      const { dot, elbow, end } = CALLOUT_GEOMETRY[group.group];
      return {
        ...group,
        dot,
        elbow,
        end,
        text: { x: (elbow.x + end.x) / 2, y: elbow.y - TEXT_LIFT },
      };
    });
}

export type FloorPlan = {
  kind: "plan" | "unknown";
  width: number;
  height: number;
  /** Interior walls, as path data in plan coordinates (centred on the plan). */
  walls: string;
  /** Door swings: a quarter arc per door. */
  doors: string;
  /** A city's open courtyard, drawn as a rectangle inside the plan. */
  court: { x: number; y: number; width: number; height: number } | null;
};

/**
 * What a settlement's tier is drawn as: a floor plan that grows, room by room, with the tier.
 *
 * A village is one room with a door; a town is the mockup's two-room plan; a city is a larger plan
 * round an open courtyard. Size and room count are two channels, so the tiers stay apart when the
 * hex is small and the difference in size is a pixel or two.
 *
 * A settlement whose tier the report never gave (known only from a neighbour's exits) is drawn as
 * a dashed outline the size of the smallest plan - a site reserved, not a building claimed.
 */
export function floorPlan(tier: SettlementTier | null): FloorPlan {
  if (tier === "city") {
    return {
      kind: "plan",
      width: 22,
      height: 16,
      walls: "M-11,-1 H-4 M4,-8 V8 M4,2 H11",
      doors: "M-8,8 a3,3 0 0 0 3,-3 M7,8 a3,3 0 0 1 -3,-3",
      court: { x: -3, y: -6, width: 6, height: 5 },
    };
  }
  if (tier === "town") {
    return {
      kind: "plan",
      width: 18,
      height: 13,
      walls: "M-9,-0.5 H2 M2,-6.5 V6.5",
      doors: "M-4,6.5 a3,3 0 0 0 3,-3",
      court: null,
    };
  }
  return {
    kind: tier === "village" ? "plan" : "unknown",
    width: 12,
    height: 9,
    walls: "",
    doors: tier === "village" ? "M-2,4.5 a3,3 0 0 0 3,-3" : "",
    court: null,
  };
}

/**
 * Outbuildings beside the plan, banded rather than one per building: one small box for up to
 * three, two for up to six, three beyond that. A box per building drowns the hex; a single box
 * says nothing about scale.
 */
export function worksBoxes(buildings: number): Array<{ x: number; y: number }> {
  const boxes =
    buildings <= 0 ? 0 : buildings <= 3 ? 1 : buildings <= 6 ? 2 : 3;
  return Array.from({ length: boxes }, (_, index) => ({
    x: STATIONS.works.x - 4 + index * 4.5,
    y: STATIONS.works.y - index * 2.5,
  }));
}

/**
 * The revision note on a stale sheet: `rev. t-8` for a reading eight turns old.
 *
 * Only a hatched hex gets one - the view model hatches exactly the hexes it draws as stale - and
 * only when it has an age. A hex in this turn's report is current, and a hex known only by name was
 * never surveyed, so neither has a revision to date.
 */
export function revisionNote(
  view: Pick<HexView, "hatched" | "ageInTurns">,
): string | null {
  return view.hatched && view.ageInTurns !== null && view.ageInTurns > 0
    ? `rev. t-${view.ageInTurns}`
    : null;
}

/**
 * How strongly a hex's hatch is drawn.
 *
 * Full strength for a current sheet; half for a stale one (`hatched`), which is the theme's whole
 * statement about age and survives the far band because it is the terrain itself that fades. With
 * textures on the hatch rides over the toned photograph, so both drop to a little over half.
 */
export function hatchStrength(
  view: Pick<HexView, "hatched" | "texture">,
): number {
  const base = view.hatched ? 0.45 : 0.9;
  return Number((view.texture ? base * 0.6 : base).toFixed(3));
}

/**
 * Where this theme draws its marks in a hex, for the biome symbols to keep clear of (ah-d9jb.4).
 *
 * Read off the same stations `MarkLayer` draws at, each with the size of what is drawn there. The
 * guard is a dash-dot perimeter round the rim and claims nothing. The near-zoom notes drawn by the
 * terrain layer (rev. / TBD) are claimed with them.
 */
export function markFootprint(view: HexView): MarkSpot[] {
  const spots: MarkSpot[] = [];
  const claim = (at: { x: number; y: number }, size: number) =>
    spots.push(markSpot(at, size, MOCKUP_RADIUS));

  if (view.battle) {
    claim(STATIONS.battle, 7);
  }
  if (view.units.monster > 0) {
    claim(STATIONS.monster, 8);
  }
  if (view.gate) {
    claim(STATIONS.gate, 6);
  }
  if (view.shafts > 0) {
    claim(STATIONS.shaft, 6);
  }
  if (view.ships > 0) {
    claim(STATIONS.ship, 7);
  }
  if (view.lairs > 0) {
    claim(STATIONS.lair, 6);
  }
  for (const box of worksBoxes(view.buildings)) {
    claim(box, 4);
  }
  if (revisionNote(view) !== null || view.unsurveyed) {
    claim(STATIONS.note, 8);
  }
  if (view.settlement) {
    const plan = floorPlan(view.settlement.tier);
    claim(STATIONS.settlement, Math.max(plan.width, plan.height) / 2 + 2);
    claim({ x: 0, y: NAME_Y }, 8);
  }
  for (const callout of callouts(view.units)) {
    claim(callout.dot, 3);
    claim(callout.text, 7);
  }
  return spots;
}
