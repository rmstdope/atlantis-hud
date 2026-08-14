/**
 * Region outlines and names for the map: the "Regions" badge.
 *
 * A province is never stored as a group anywhere in the model - only as a name on each hex - so
 * this module builds the grouping itself: flood-fill same-province neighbours into connected
 * pieces, trace each piece's boundary as one SVG path, and place a name for it. Every name renders
 * at the same fixed size (MapCanvas/theme.css), whatever the size of the piece it names.
 *
 * Pure, no React, following `routeOverlay.ts` as the precedent for "overlay as a function,
 * MapCanvas renders it".
 */

import type { HexNode } from "../hexMapModel";
import { COLUMN_PITCH, HEX_RADIUS, ROW_PITCH } from "./mapViewport";
import { corners } from "./mapHexView";

export type RegionPiece = {
  province: string;
  hexCount: number;
  /** One SVG path `d`, world units, unordered M/L segment pairs - one per boundary edge. */
  outline: string;
  label: { x: number; y: number; text: string };
};

/**
 * The six neighbour offsets in the game's coordinate space, in the same order as the six hex
 * corners: offset `k` is the neighbour across the edge from corner `k` to corner `k+1`.
 *
 * Only `(x+/-1, y+/-1)` and `(0, y+/-2)` exist - the lattice only uses coordinates where `x+y` is
 * even, so a naive `(x+/-1,y)`/`(x,y+/-1)` neighbour set finds nothing and every hex ends up its
 * own piece.
 */
const NEIGHBOR_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 1 },
  { dx: 0, dy: 2 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -2 },
  { dx: 1, dy: -1 }
];

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function worldCenter(hex: HexNode): { x: number; y: number } {
  return { x: hex.coordinate.x * COLUMN_PITCH, y: hex.coordinate.y * ROW_PITCH };
}

/** Same-province neighbours flood-filled into connected pieces. Unnamed hexes join no piece. */
function groupIntoPieces(hexes: HexNode[]): HexNode[][] {
  const named = hexes.filter((hex) => hex.province !== "");
  const byKey = new Map(named.map((hex) => [keyOf(hex.coordinate.x, hex.coordinate.y), hex]));
  const visited = new Set<string>();
  const pieces: HexNode[][] = [];

  for (const seed of named) {
    const seedKey = keyOf(seed.coordinate.x, seed.coordinate.y);
    if (visited.has(seedKey)) {
      continue;
    }
    const piece: HexNode[] = [];
    const stack = [seed];
    visited.add(seedKey);
    while (stack.length > 0) {
      const current = stack.pop()!;
      piece.push(current);
      for (const { dx, dy } of NEIGHBOR_OFFSETS) {
        const neighborKey = keyOf(current.coordinate.x + dx, current.coordinate.y + dy);
        if (visited.has(neighborKey)) {
          continue;
        }
        const neighbor = byKey.get(neighborKey);
        if (neighbor && neighbor.province === seed.province) {
          visited.add(neighborKey);
          stack.push(neighbor);
        }
      }
    }
    pieces.push(piece);
  }
  return pieces;
}

/** The path `d` for one piece: every edge whose neighbour is not part of the same piece. */
function outlineOf(piece: HexNode[]): string {
  const pieceKeys = new Set(piece.map((hex) => keyOf(hex.coordinate.x, hex.coordinate.y)));
  const pts = corners(HEX_RADIUS);
  const segments: string[] = [];

  for (const hex of piece) {
    const center = worldCenter(hex);
    for (let edge = 0; edge < 6; edge += 1) {
      const { dx, dy } = NEIGHBOR_OFFSETS[edge];
      const neighborKey = keyOf(hex.coordinate.x + dx, hex.coordinate.y + dy);
      if (pieceKeys.has(neighborKey)) {
        continue;
      }
      const a = pts[edge];
      const b = pts[(edge + 1) % 6];
      segments.push(
        `M${round(center.x + a.x)},${round(center.y + a.y)} ` +
          `L${round(center.x + b.x)},${round(center.y + b.y)}`
      );
    }
  }
  return segments.join(" ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Whether `point` falls inside the regular hexagon centred at `center`. */
function hexContains(center: { x: number; y: number }, point: { x: number; y: number }): boolean {
  const pts = corners(HEX_RADIUS).map((corner) => ({
    x: corner.x + center.x,
    y: corner.y + center.y
  }));
  let sign = 0;
  for (let i = 0; i < 6; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 6];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const toPoint = { x: point.x - a.x, y: point.y - a.y };
    const cross = edge.x * toPoint.y - edge.y * toPoint.x;
    if (cross === 0) {
      continue;
    }
    const thisSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = thisSign;
    } else if (thisSign !== sign) {
      return false;
    }
  }
  return true;
}

/**
 * Where a piece's name is written: the raw centroid of its hexes when that centroid falls on
 * ground the province owns, or the centre of the piece's hex nearest that centroid otherwise - a
 * name never floats over ground the province does not own.
 */
function labelAnchor(piece: HexNode[]): { x: number; y: number } {
  const centers = piece.map(worldCenter);
  const raw = {
    x: centers.reduce((sum, c) => sum + c.x, 0) / centers.length,
    y: centers.reduce((sum, c) => sum + c.y, 0) / centers.length
  };

  if (centers.some((center) => hexContains(center, raw))) {
    return raw;
  }

  let nearest = centers[0];
  let nearestDistance = Infinity;
  for (const center of centers) {
    const distance = (center.x - raw.x) ** 2 + (center.y - raw.y) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = center;
    }
  }
  return nearest;
}

/**
 * Every known province, outlined and named: one piece per connected group of same-province hexes
 * on the given level. A province discovered in two places is outlined and named twice, once per
 * piece - see the acceptance criteria on disjoint pieces.
 */
export function regionDecorations(hexes: HexNode[], level: number): RegionPiece[] {
  const onLevel = hexes.filter((hex) => hex.coordinate.z === level);
  const pieces = groupIntoPieces(onLevel);

  return pieces.map((piece) => {
    const anchor = labelAnchor(piece);
    return {
      province: piece[0].province,
      hexCount: piece.length,
      outline: outlineOf(piece),
      label: { x: anchor.x, y: anchor.y, text: piece[0].province }
    };
  });
}
