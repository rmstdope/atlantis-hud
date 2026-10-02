/**
 * Where Collective puts things, and why.
 *
 * The design is a cybernetic hive's readout: every hex a dark cell wrapped in its own wireframe
 * lattice, every mark a wireframe or a bracketed number. Like a readout, it keeps **fixed
 * stations** - a mark is present at its station or the station is empty, so the busiest hex on the
 * map is laid out exactly like the emptiest one and nothing has to shift to make room:
 *
 * - the settlement's wireframe cube in the centre, its name in capitals along the southern edge;
 * - the unit readouts either side of the cube - `[n]` for your own to the west, for everybody
 *   else's to the east - with a hollow triangle for a monster in the north-west;
 * - last turn's battle at the top, the terrain code in the north-east corner (terrain layer);
 * - a bottom row of five small wireframes: ships, shaft, gate, lair, buildings.
 *
 * Coordinates are the mockup's own (`new-themes.html`, the Collective card), drawn at radius 32;
 * the layer components scale each hex to `HEX_RADIUS` in one transform, so every number here can
 * be read straight off the mockup.
 */

import { markSpot, type MarkSpot } from "../biomeSymbols";
import type { HexView, SettlementTier } from "../hexView";
import type { TerrainPaint } from "../terrain";

export const MOCKUP_RADIUS = 32;

/** The cell's own radius: a hair inside the hex, so a dark seam runs between neighbouring cells. */
export const CELL_RADIUS = MOCKUP_RADIUS - 1;

/** Where every mark is drawn, in the mockup's coordinates. */
export const STATIONS = {
  /** The terrain code, faint in the north-east corner. Drawn by the terrain layer. */
  code: { x: 14, y: -17 },
  monster: { x: -13, y: -14 },
  battle: { x: 0, y: -18 },
  settlement: { x: 0, y: 0 },
  /** The readouts are anchored against the cube: own ends here, foreign starts at its mirror. */
  readout: { x: 9, y: 0 },
  ship: { x: -18, y: 13 },
  shaft: { x: -9, y: 13 },
  gate: { x: 0, y: 13 },
  lair: { x: 9, y: 13 },
  buildings: { x: 18, y: 13 },
  name: { x: 0, y: 25 }
} as const;

/** How big each bottom-row wireframe is drawn: a half-width, in mockup units. */
export const SMALL_GLYPH = 3.6;

/** The monster's triangle, as a half-width. */
export const MONSTER_SIZE = 6;

/** The battle mark, as a half-width. */
export const BATTLE_SIZE = 4.5;

/**
 * Three letters per terrain, as the hive would log it. Every kind the map can paint has one, and so
 * does the fallback: a cell with no code would be a cell the readout could not classify, and the
 * readout always classifies.
 */
export const TERRAIN_CODES: Record<TerrainPaint, string> = {
  ocean: "OCN",
  plain: "PLN",
  forest: "FOR",
  mountain: "MTN",
  swamp: "SWP",
  desert: "DST",
  jungle: "JNG",
  tundra: "TUN",
  volcano: "VOL",
  cavern: "CAV",
  underforest: "UFR",
  wasteland: "WST",
  hill: "HIL",
  tunnels: "TNL",
  grotto: "GRT",
  deepforest: "DFR",
  chasm: "CHS",
  other: "UNK"
};

/**
 * The code a hex prints. Ground nobody has surveyed still has a known terrain - a neighbour named
 * it - so it keeps its code, with a query after it: classified, but not confirmed.
 */
export function terrainCode(view: Pick<HexView, "terrainKind" | "unsurveyed">): string {
  const code = TERRAIN_CODES[view.terrainKind];
  return view.unsurveyed ? `${code}?` : code;
}

/** The three ways a cell can be drawn, read off the view's paint rather than its knowledge. */
export type CellState = "current" | "stale" | "unsurveyed";

/**
 * Which treatment a cell gets.
 *
 * Keyed on `unsurveyed` and the fade, never on `knowledge`: a named hex the player has switched
 * the unvisited treatment off for arrives with no rim and no fade, and must draw exactly like a
 * current one (ah-7czr). A stale hex with the staleness chip off arrives the same way.
 */
export function cellState(view: Pick<HexView, "unsurveyed" | "fogOpacity">): CellState {
  if (view.unsurveyed) {
    return "unsurveyed";
  }
  return view.fogOpacity > 0 ? "stale" : "current";
}

/**
 * Whether the cell shows its biome picture.
 *
 * A stale cell never does: in this design an old reading is one whose fill has dropped away,
 * leaving only the lattice that says what the ground was. Unsurveyed ground does - the terrain is
 * the one thing a neighbour's word tells us, so it is painted, then dimmed and rimmed.
 */
export function showsTexture(view: Pick<HexView, "texture" | "unsurveyed" | "fogOpacity">): boolean {
  return view.texture !== null && cellState(view) !== "stale";
}

/** How strongly the lattice is drawn over a cell, as an opacity class suffix. */
export type LatticeStrength = "full" | "textured" | "faint";

/**
 * The lattice is the cell's identity, so it is always drawn - but how hard depends on what is under
 * it. Over a biome picture it steps back so the picture reads; over unsurveyed ground it is faint,
 * a lattice pencilled in from a neighbour's report; and on a stale cell it is all there is.
 */
export function latticeStrength(
  view: Pick<HexView, "texture" | "unsurveyed" | "fogOpacity">
): LatticeStrength {
  const state = cellState(view);
  if (state === "unsurveyed") {
    return "faint";
  }
  if (state === "current" && view.texture !== null) {
    return "textured";
  }
  return "full";
}

/** The settlement's wireframe cube: bigger with the tier, a city with a core cube inside it. */
export function settlementCube(tier: SettlementTier | null): {
  size: number;
  core: number | null;
  known: boolean;
} {
  if (tier === "city") {
    return { size: 8, core: 3.5, known: true };
  }
  if (tier === "town") {
    return { size: 6.5, core: null, known: true };
  }
  // A village, and a settlement whose size the report never gave - drawn dashed, unconfirmed.
  return { size: 5, core: null, known: tier === "village" };
}

/**
 * A wireframe cube centred on the origin, half-width `size`: the hexagonal silhouette and the
 * three edges meeting at the near corner - the mockup's own path, moved to the origin.
 */
export function cubePath(size: number): string {
  const s = size;
  const h = s / 2;
  return [
    `M${-s},${-h} L0,${-s} L${s},${-h} L0,0 Z`,
    `M${-s},${-h} L${-s},${h} L0,${s} L${s},${h} L${s},${-h}`,
    `M0,0 L0,${s}`
  ].join(" ");
}

export type Readout = { group: "own" | "foreign"; count: number; text: string };

/**
 * The bracketed unit readouts: own and everybody else's, each `[n]`.
 *
 * Monsters are drawn as their own triangle, so they come out of the foreign count - the view
 * model's `foreign` is the whole foreign tally with the monsters still inside it, and a readout
 * built from it directly would count every monster twice.
 */
export function readouts(units: HexView["units"]): Readout[] {
  const foreign = Math.max(0, units.foreign - units.monster);
  const groups: Array<{ group: Readout["group"]; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: foreign }
  ];
  return groups
    .filter((group) => group.count > 0)
    .map((group) => ({ ...group, text: `[${group.count}]` }));
}

/**
 * Where this theme draws its marks in a hex, for the biome symbols to keep clear of (ah-d9jb.4).
 *
 * Read off the stations `MarkLayer` draws at. The guard is a ring just inside the rim and claims
 * nothing; the terrain code is part of the cell, not a mark, and is shown only in the near band.
 */
export function markFootprint(view: HexView): MarkSpot[] {
  const spots: MarkSpot[] = [];
  const claim = (at: { x: number; y: number }, size: number) =>
    spots.push(markSpot(at, size, MOCKUP_RADIUS));

  if (view.settlement) {
    claim(STATIONS.settlement, settlementCube(view.settlement.tier).size + 2);
    claim({ x: STATIONS.name.x, y: STATIONS.name.y - 3 }, 9);
  }
  for (const readout of readouts(view.units)) {
    const side = readout.group === "own" ? -1 : 1;
    claim({ x: side * (STATIONS.readout.x + 8), y: STATIONS.readout.y }, 9);
  }
  if (view.units.monster > 0) {
    claim(STATIONS.monster, MONSTER_SIZE + 2);
  }
  if (view.battle) {
    claim(STATIONS.battle, BATTLE_SIZE + 2);
  }
  const small: Array<[boolean, { x: number; y: number }]> = [
    [view.ships > 0, STATIONS.ship],
    [view.shafts > 0, STATIONS.shaft],
    [view.gate, STATIONS.gate],
    [view.lairs > 0, STATIONS.lair],
    [view.buildings > 0, STATIONS.buildings]
  ];
  for (const [present, at] of small) {
    if (present) {
      claim(at, SMALL_GLYPH + 2);
    }
  }
  return spots;
}

/**
 * Each terrain's wireframe lattice: one pattern tile, `size` mockup units square, and the path drawn
 * in it. The lattice is the theme's terrain - the tint under it is only a shade - so every kind gets
 * a structure of its own: a cube grid for plains, a triangle mesh for mountains, scan lines for
 * water, and so on. Two kinds sharing a lattice would be two kinds the map could only tell apart by
 * a few points of tint.
 */
export const LATTICES: Record<TerrainPaint, { size: number; d: string }> = {
  // A cube grid: squares with each corner's receding edge.
  plain: { size: 10, d: "M0,0 H10 M0,0 V10 M0,0 L3,3" },
  // A triangle mesh, tall and sharp.
  mountain: { size: 10, d: "M0,10 L5,0 L10,10 M0,10 H10" },
  // Low rounded rises.
  hill: { size: 10, d: "M0,8 Q5,1 10,8" },
  // Scan lines.
  ocean: { size: 12, d: "M0,2 H12 M0,6 H12 M0,10 H12" },
  // Broken scan lines: water that does not hold together.
  swamp: { size: 12, d: "M0,3 H4 M7,3 H12 M2,9 H9" },
  // Cross-hatching.
  forest: { size: 10, d: "M0,0 L10,10 M10,0 L0,10" },
  // Dense cross-hatching with a stem through it.
  jungle: { size: 6, d: "M0,0 L6,6 M6,0 L0,6 M3,0 V6" },
  // A sparse dot field.
  desert: { size: 10, d: "M2,2 h0.8 M7,7 h0.8" },
  // Plus marks, like frost crystals.
  tundra: { size: 10, d: "M5,2 V8 M2,5 H8" },
  // Vents: a peak with its plume.
  volcano: { size: 10, d: "M0,9 L5,3 L10,9 M5,3 V0" },
  // Open cells.
  cavern: { size: 10, d: "M5,1.5 A3.5,3.5 0 1 0 5.01,1.5" },
  // Single diagonals and a spore between them.
  underforest: { size: 10, d: "M0,10 L10,0 M2,3 h0.8" },
  // Cracks.
  wasteland: { size: 10, d: "M0,5 L3,2 L6,8 L10,5" },
  // A fine square grid: bored passages.
  tunnels: { size: 6, d: "M0,0 H6 M0,0 V6" },
  // Rippled water under rock.
  grotto: { size: 10, d: "M0,5 Q2.5,2 5,5 T10,5" },
  // Diamonds, packed tight.
  deepforest: { size: 6, d: "M3,0 L6,3 L3,6 L0,3 Z" },
  // Vertical drops.
  chasm: { size: 8, d: "M2,0 V8 M6,0 V8" },
  // Unclassified: a scatter of small crosses.
  other: { size: 10, d: "M4,4 l2,2 M6,4 l-2,2" }
};

/** The pattern a terrain's lattice is painted with, declared once in the theme's `Defs`. */
export function latticePatternId(kind: TerrainPaint): string {
  return `co-lattice-${kind}`;
}
