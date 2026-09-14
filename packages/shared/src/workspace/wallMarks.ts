/**
 * What the map draws for a wall a report proves (ah-wq2e): the rampart's geometry and the note
 * pointing at it shows, kept free of React so it is testable without a DOM.
 */

import type { Coordinate, Direction, MapWall, WallProof } from "@atlantis/core-client";
import { corners, type Point } from "./mapHexView";
import { HEX_RADIUS, worldOf } from "./mapViewport";
import { radii } from "./mapThemes/geometry";

/** One side of a wall a pointer can rest on: the hex it belongs to, and what pointing there says. */
export type WallSide = {
  /** The hex this half of the wall lies inside. A click here answers as that hex would. */
  hex: Coordinate;
  /** `points` attribute of the hit strip, in world units. */
  hit: string;
  /** The note, exactly as the pointer shows it. */
  note: string;
};

/** Everything MapCanvas draws for one wall. */
export type WallMark = {
  /** Stable React key: `${from.x},${from.y},${from.z}:${direction}`. */
  key: string;
  /** The bar and its halo: `M x1,y1 L x2,y2`, corner to corner, in world units. */
  bar: string;
  /** The cross-ticks: one `M … L …` pair per tick, in world units. */
  ticks: string;
  /** Always two: the `from` side first, then the `to` side. */
  sides: [WallSide, WallSide];
};

/**
 * The side each direction crosses, as an index into `corners`: the side between corner `k` and
 * corner `k + 1`, the same one `regionDecorations.ts`'s `NEIGHBOR_OFFSETS[k]` crosses.
 */
const SIDE: Record<Direction, number> = {
  southeast: 0,
  south: 1,
  southwest: 2,
  northwest: 3,
  north: 4,
  northeast: 5
};

const OPPOSITE: Record<Direction, Direction> = {
  north: "south",
  northeast: "southwest",
  southeast: "northwest",
  south: "north",
  southwest: "northeast",
  northwest: "southeast"
};

/** Five ticks, evenly along the side; each reaches this far either side of the bar. */
const TICKS = 5;
const TICK_REACH = radii(0.118);

/** How far each hit strip reaches from the wall toward its own hex's centre. */
const STRIP_DEPTH = 0.25;

const CORNERS = corners(HEX_RADIUS);

function fmt(point: Point): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function toward(point: Point, target: Point, fraction: number): Point {
  return {
    x: point.x + (target.x - point.x) * fraction,
    y: point.y + (target.y - point.y) * fraction
  };
}

function strip(a: Point, b: Point, centre: Point): string {
  return [a, b, toward(b, centre, STRIP_DEPTH), toward(a, centre, STRIP_DEPTH)].map(fmt).join(" ");
}

/** `No way through: <terrain> (<x>,<y>,<z>) has no exit to the <direction>.` */
export function wallNote(proof: WallProof, direction: Direction): string {
  const { x, y, z } = proof.coordinate;
  return `No way through: ${proof.terrain} (${x},${y},${z}) has no exit to the ${direction}.`;
}

function markOf(wall: MapWall): WallMark {
  const centre = worldOf(wall.from);
  const k = SIDE[wall.direction];
  const a = { x: centre.x + CORNERS[k].x, y: centre.y + CORNERS[k].y };
  const b = {
    x: centre.x + CORNERS[(k + 1) % 6].x,
    y: centre.y + CORNERS[(k + 1) % 6].y
  };

  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const ticks = Array.from({ length: TICKS }, (_, index) => {
    const at = toward(a, b, (index + 1) / (TICKS + 1));
    const one = {
      x: at.x + normal.x * TICK_REACH,
      y: at.y + normal.y * TICK_REACH
    };
    const two = {
      x: at.x - normal.x * TICK_REACH,
      y: at.y - normal.y * TICK_REACH
    };
    return `M ${fmt(one)} L ${fmt(two)}`;
  }).join(" ");

  const [first, second] = wall.provenBy;
  const toNote = second
    ? wallNote(second, OPPOSITE[wall.direction])
    : wallNote(first, wall.direction);
  const { x, y, z } = wall.from;

  return {
    key: `${x},${y},${z}:${wall.direction}`,
    bar: `M ${fmt(a)} L ${fmt(b)}`,
    ticks,
    sides: [
      {
        hex: wall.from,
        hit: strip(a, b, centre),
        note: wallNote(first, wall.direction)
      },
      { hex: wall.to, hit: strip(a, b, worldOf(wall.to)), note: toNote }
    ]
  };
}

/** The walls on `level`, in the order the core listed them. */
export function wallMarks(walls: MapWall[], level: number): WallMark[] {
  return walls.filter((wall) => wall.from.z === level).map(markOf);
}
