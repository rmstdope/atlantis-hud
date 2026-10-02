/**
 * The comet that runs along a movement line: where its head is at a given moment.
 *
 * Kept apart from the component that draws it so the timing can be tested without a browser. The
 * comet runs from the unit to the end of the line, keeps going past the end for a short beat so its
 * trail can fade out there, and starts again. Speed is in hexes per second: the hex is the one
 * distance a player can judge on the map at any zoom.
 */

import { HEX_RADIUS } from "./mapViewport";

export type Point = { x: number; y: number };

/** Hexes per second the slider runs between, and where it starts. */
export const MOVEMENT_ANIMATION_SPEED_MIN = 2.5;
export const MOVEMENT_ANIMATION_SPEED_MAX = 9.25;
export const MOVEMENT_ANIMATION_SPEED_STEP = 0.25;
export const DEFAULT_MOVEMENT_ANIMATION_SPEED = 4.5;

/** Snapped to the slider's steps and kept inside its range; anything unreadable is the default. */
export function clampMovementAnimationSpeed(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MOVEMENT_ANIMATION_SPEED;
  }
  const stepped = Math.round(numeric / MOVEMENT_ANIMATION_SPEED_STEP) * MOVEMENT_ANIMATION_SPEED_STEP;
  return Math.min(MOVEMENT_ANIMATION_SPEED_MAX, Math.max(MOVEMENT_ANIMATION_SPEED_MIN, stepped));
}

/** Centre to centre, one hex to its neighbour. */
const HEX_STEP = Math.sqrt(3) * HEX_RADIUS;

/** How far past the end the head travels, unseen, while its trail fades. */
export const COMET_RUN_OUT = 1.9 * HEX_RADIUS;

/** The points of an SVG `points` attribute. */
export function parsePoints(points: string): Point[] {
  return points
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

export type CometPath = {
  points: Point[];
  /** Distance along the path to each point. */
  lengths: number[];
  /** Total length. */
  length: number;
  /** Where this month's part of the journey ends. */
  monthEnd: number;
};

/**
 * One path through the solid (this month) and dotted (later) halves of a line. The dotted half
 * starts at the last solid point, so that point is not repeated.
 */
export function cometPath(solid: string, dotted: string): CometPath {
  const near = parsePoints(solid);
  const far = parsePoints(dotted);
  const joined = near.length > 0 && far.length > 0 ? [...near, ...far.slice(1)] : [...near, ...far];
  const lengths = [0];
  for (let index = 1; index < joined.length; index += 1) {
    const a = joined[index - 1];
    const b = joined[index];
    lengths.push(lengths[index - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = lengths[lengths.length - 1] ?? 0;
  const monthEnd = near.length > 0 ? lengths[near.length - 1] : 0;
  return { points: joined, lengths, length, monthEnd };
}

/** The point a given distance along the path, clamped to its ends. */
export function pointAlong(path: CometPath, distance: number): Point {
  const { points, lengths, length } = path;
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const clamped = Math.max(0, Math.min(length, distance));
  let index = 1;
  while (index < lengths.length - 1 && lengths[index] < clamped) {
    index += 1;
  }
  const a = points[index - 1] ?? points[0];
  const b = points[index] ?? a;
  const span = (lengths[index] ?? 0) - (lengths[index - 1] ?? 0);
  const fraction = span > 0 ? (clamped - lengths[index - 1]) / span : 0;
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

/**
 * How far along the path the head is, `seconds` after the animation started: it loops, running
 * the path and then the run-out at `hexesPerSecond`.
 */
export function cometHead(path: CometPath, seconds: number, hexesPerSecond: number): number {
  const lap = path.length + COMET_RUN_OUT;
  if (lap <= 0) {
    return 0;
  }
  const travelled = seconds * hexesPerSecond * HEX_STEP;
  return travelled % lap;
}
