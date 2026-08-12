/**
 * The rectangle a player drags across the map to say which part of it to export.
 *
 * All of it is arithmetic on the game's own coordinates, kept out of the canvas component for the
 * usual reason: a rectangle that includes the wrong hexes is a privacy bug, and a bug in a pointer
 * handler is a bug no test in this repository can reach.
 */

import type { Coordinate } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { COLUMN_PITCH, HEX_RADIUS, ROW_PITCH } from "./mapViewport";

/** An inclusive box in map coordinates, normalised so `from` is always the smaller corner. */
export type MapRect = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

/**
 * The rectangle two dragged corners describe.
 *
 * Normalised here rather than at the point of use: a drag says nothing about which corner came
 * first, and every reader downstream would otherwise have to remember that.
 */
export function rectFromCorners(one: Coordinate, other: Coordinate): MapRect {
  return {
    fromX: Math.min(one.x, other.x),
    fromY: Math.min(one.y, other.y),
    toX: Math.max(one.x, other.x),
    toY: Math.max(one.y, other.y)
  };
}

/**
 * Whether a hex falls inside the rectangle, edges included.
 *
 * Reads the corners in either order, as the core does. A drag always arrives normalised, but the
 * dialog's corner fields are typed by hand and pass through every intermediate state on the way -
 * and a rectangle the core would export happily must not be one the dialog calls empty.
 */
export function rectContains(rect: MapRect, coordinate: Coordinate): boolean {
  return (
    between(coordinate.x, rect.fromX, rect.toX) && between(coordinate.y, rect.fromY, rect.toY)
  );
}

function between(value: number, oneEnd: number, otherEnd: number): boolean {
  return value >= Math.min(oneEnd, otherEnd) && value <= Math.max(oneEnd, otherEnd);
}

/** Whether a hex is one the export would write a region block for. */
function isVisited(hex: HexNode): boolean {
  return hex.knowledge !== "named";
}

/**
 * How many regions an export of this rectangle would contain.
 *
 * Hexes known only by name from a neighbour's `Exits` block are left out, because the export
 * leaves them out: they appear in the file as exits of their neighbours, never as blocks of their
 * own, and a count that included them would promise more than the file delivers.
 */
export function hexesInRect(hexes: HexNode[], rect: MapRect, level: number): number {
  return hexes.filter(
    (hex) => hex.coordinate.z === level && isVisited(hex) && rectContains(rect, hex.coordinate)
  ).length;
}

/** The box holding everything visited on one level, or nothing when the level holds none. */
export function boundsOfKnown(hexes: HexNode[], level: number): MapRect | null {
  const visited = hexes.filter((hex) => hex.coordinate.z === level && isVisited(hex));
  if (visited.length === 0) {
    return null;
  }

  const xs = visited.map((hex) => hex.coordinate.x);
  const ys = visited.map((hex) => hex.coordinate.y);
  return {
    fromX: Math.min(...xs),
    fromY: Math.min(...ys),
    toX: Math.max(...xs),
    toY: Math.max(...ys)
  };
}

/**
 * The band to draw, in the world units the hex layer is already drawn in.
 *
 * Reaches a half-hex past the centres it was built from, so the corner hexes look enclosed rather
 * than bisected. The two axes take different padding because a flat-top hex is not round: half its
 * width is the radius, half its height is one row pitch. Padding both with the radius would draw
 * the band over the centres of the rows just outside it, promising hexes the export leaves out.
 */
export function rectPixels(rect: MapRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = Math.min(rect.fromX, rect.toX) * COLUMN_PITCH - HEX_RADIUS;
  const y = Math.min(rect.fromY, rect.toY) * ROW_PITCH - ROW_PITCH;
  return {
    x,
    y,
    width: Math.max(rect.fromX, rect.toX) * COLUMN_PITCH + HEX_RADIUS - x,
    height: Math.max(rect.fromY, rect.toY) * ROW_PITCH + ROW_PITCH - y
  };
}
