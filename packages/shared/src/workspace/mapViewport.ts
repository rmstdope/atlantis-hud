/**
 * The map's view transform, and the arithmetic that moves it.
 *
 * Everything here is pure so that it can be tested without a DOM. The renderer owns a single
 * `Viewport` and writes it to one SVG group; nothing in this module knows that.
 *
 * Three things it refuses to do:
 *
 * - **Drift.** Zoom is a whole number of steps and the scale is derived from it, so zooming in N
 *   steps and back out N steps returns the identical number rather than a near one. The previous
 *   renderer multiplied by 1.1 and 0.9, losing 1% on every round trip and never recovering.
 * - **Guess how much a wheel gesture meant.** `WheelEvent.deltaY` is in pixels, lines or pages
 *   depending on the device, so it is normalised before use. A trackpad also emits a stream of
 *   tiny deltas where a mouse emits one large one, which is why travel accumulates rather than
 *   counting one step per event.
 * - **Move somewhere unreversible.** Left and right step to opposite corners of the hex, so every
 *   arrow key undoes another. Two keys that both lead north would let focus drift with no way back.
 */

import type { Coordinate } from "@atlantis/core-client";

/** Radius of one hex in world units. The world is drawn at this size and then transformed. */
export const HEX_RADIUS = 18;

/** Horizontal distance between adjacent columns, and vertical distance per unit of y. */
export const COLUMN_PITCH = HEX_RADIUS * 1.5;
export const ROW_PITCH = (HEX_RADIUS * Math.sqrt(3)) / 2;

/**
 * Zoom is held as a whole number of steps; the scale is `2 ** (step / 4)`.
 *
 * Integers are what make a round trip exact. Holding the scale itself and multiplying by a factor
 * accumulates floating-point error, and clamping it loses the information needed to come back.
 */
export const MIN_STEP = -8;
export const MAX_STEP = 8;
export const STEPS_PER_DOUBLING = 4;

/** Where the world sits: a translation in screen pixels, and a zoom step. */
export type Viewport = { tx: number; ty: number; step: number };

/**
 * How much detail the map shows.
 *
 * Labels are drawn at a constant screen size, so as hexes shrink the text does not: past a point
 * every label overlaps its neighbours and the map becomes unreadable. The bands are where things
 * are dropped, not decoration. They key off the step rather than the scale so that a jittering
 * trackpad cannot flip the band twice in one gesture.
 */
export type ZoomBand = "far" | "mid" | "near";

/** Arrow keys move between hexes, so each maps to one of the game's own exits. */
export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** How far the wheel must travel, in normalised pixels, to earn one zoom step. */
export const PIXELS_PER_STEP = 50;

/** A line of wheel travel, in pixels. Browsers report lines for most mice. */
const PIXELS_PER_LINE = 16;

/** Widest band that still leaves a hex too small to label, and the narrowest that holds detail. */
const LAST_FAR_STEP = -3;
const FIRST_NEAR_STEP = 3;

/**
 * Strides a ruler may thin down to.
 *
 * Rows start at two because a column of the lattice only holds every second one: a stride of one
 * would label rows that cannot exist.
 */
const COLUMN_STRIDES = [1, 2, 5, 10, 20, 50, 100];
const ROW_STRIDES = [2, 4, 10, 20, 50, 100];

function clampStep(step: number): number {
  return Math.min(MAX_STEP, Math.max(MIN_STEP, step));
}

export function scaleOf(step: number): number {
  return 2 ** (step / STEPS_PER_DOUBLING);
}

export function zoomBand(step: number): ZoomBand {
  if (step <= LAST_FAR_STEP) {
    return "far";
  }
  return step >= FIRST_NEAR_STEP ? "near" : "mid";
}

export function transformString(viewport: Viewport): string {
  const scale = scaleOf(viewport.step);
  // Rounded so the string only changes when the view actually moves; unrounded floats give
  // seventeen-character attributes on every node that reads them.
  return `translate(${viewport.tx.toFixed(2)},${viewport.ty.toFixed(2)}) scale(${scale.toFixed(4)})`;
}

export function worldOf(coordinate: Coordinate): { x: number; y: number } {
  return { x: coordinate.x * COLUMN_PITCH, y: coordinate.y * ROW_PITCH };
}

export function zoomAt(
  viewport: Viewport,
  steps: number,
  pointerX: number,
  pointerY: number
): Viewport {
  const step = clampStep(viewport.step + steps);
  const before = scaleOf(viewport.step);
  const after = scaleOf(step);

  // Zoom about the pointer rather than the origin, so the hex under the cursor stays put.
  const worldX = (pointerX - viewport.tx) / before;
  const worldY = (pointerY - viewport.ty) / before;

  return { tx: pointerX - worldX * after, ty: pointerY - worldY * after, step };
}

export function wheelPixels(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) {
    return deltaY * PIXELS_PER_LINE;
  }
  if (deltaMode === 2) {
    return deltaY * viewportHeight;
  }
  return deltaY;
}

/**
 * Turns a stream of wheel travel into whole zoom steps.
 *
 * Travel banked in one direction is dropped the moment the wheel reverses, so a gesture that
 * nearly earned a step cannot combine with the start of the opposite gesture to overshoot.
 */
export function accumulateWheel(carry: number, pixels: number): { steps: number; carry: number } {
  const reversed = carry !== 0 && pixels !== 0 && Math.sign(pixels) !== Math.sign(carry);
  const total = (reversed ? 0 : carry) + pixels;
  // `|| 0` because truncating a small negative gives -0, which reads as a direction that is not
  // there and compares unequal to 0.
  const steps = Math.trunc(total / PIXELS_PER_STEP) || 0;
  return { steps, carry: total - steps * PIXELS_PER_STEP };
}

/** The rectangle of game coordinates the faction knows anything about. */
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export function hexBounds(coordinates: Coordinate[]): Bounds | null {
  if (coordinates.length === 0) {
    return null;
  }
  return {
    minX: Math.min(...coordinates.map((one) => one.x)),
    maxX: Math.max(...coordinates.map((one) => one.x)),
    minY: Math.min(...coordinates.map((one) => one.y)),
    maxY: Math.max(...coordinates.map((one) => one.y))
  };
}

/**
 * Whether the keyboard cursor is allowed to stand on a coordinate.
 *
 * Deliberately not "is there a hex here". Two islands of known ground with unvisited hexes between
 * them have to be reachable from one another, so the cursor crosses the gap; only selecting cares
 * whether anything is actually there. The margin stops a held arrow key from carrying the cursor
 * off into ground nobody will ever have a reason to look at.
 */
export function isWithinReach(
  coordinate: Coordinate,
  bounds: Bounds | null,
  margin: number
): boolean {
  if (!bounds) {
    return false;
  }
  return (
    coordinate.x >= bounds.minX - margin &&
    coordinate.x <= bounds.maxX + margin &&
    coordinate.y >= bounds.minY - margin &&
    coordinate.y <= bounds.maxY + margin
  );
}

export function fitTo(
  coordinates: Coordinate[],
  width: number,
  height: number
): Viewport | null {
  if (coordinates.length === 0 || width <= 0 || height <= 0) {
    return null;
  }

  const worlds = coordinates.map(worldOf);
  const minX = Math.min(...worlds.map((world) => world.x));
  const maxX = Math.max(...worlds.map((world) => world.x));
  const minY = Math.min(...worlds.map((world) => world.y));
  const maxY = Math.max(...worlds.map((world) => world.y));

  // The bounds are of hex centres, so they have to grow by half a hex to hold the whole shape.
  const spanX = maxX - minX + HEX_RADIUS * 2;
  const spanY = maxY - minY + ROW_PITCH * 2;

  const wanted = Math.min(width / spanX, height / spanY);
  // Floored to a whole step so that fitting never lands on a scale zooming cannot return to, and
  // never rounds up into a frame that clips the outermost hex.
  const step = clampStep(Math.floor(Math.log2(wanted) * STEPS_PER_DOUBLING));
  const scale = scaleOf(step);

  return {
    tx: width / 2 - ((minX + maxX) / 2) * scale,
    ty: height / 2 - ((minY + maxY) / 2) * scale,
    step
  };
}

export function centreOn(
  coordinate: Coordinate,
  viewport: Viewport,
  width: number,
  height: number
): Viewport {
  const world = worldOf(coordinate);
  const scale = scaleOf(viewport.step);
  return { tx: width / 2 - world.x * scale, ty: height / 2 - world.y * scale, step: viewport.step };
}

/**
 * Whether any part of a hex falls outside the viewport.
 *
 * Partly visible counts as off screen: a selection ring half over the edge is a selection the
 * player cannot read, which is the whole reason anything asks.
 */
export function isOffScreen(
  coordinate: Coordinate,
  viewport: Viewport,
  width: number,
  height: number
): boolean {
  const world = worldOf(coordinate);
  const scale = scaleOf(viewport.step);
  const x = viewport.tx + world.x * scale;
  const y = viewport.ty + world.y * scale;
  const halfWidth = HEX_RADIUS * scale;
  const halfHeight = ROW_PITCH * scale;

  return (
    x - halfWidth < 0 || x + halfWidth > width || y - halfHeight < 0 || y + halfHeight > height
  );
}

export function neighbour(coordinate: Coordinate, key: ArrowKey): Coordinate {
  const { x, y, z } = coordinate;
  switch (key) {
    case "ArrowUp":
      return { x, y: y - 2, z };
    case "ArrowDown":
      return { x, y: y + 2, z };
    // South-west and north-east are opposites, so each key undoes the other. North-west and
    // south-east are one further press away, which keeps every hex reachable without a modifier.
    case "ArrowLeft":
      return { x: x - 1, y: y + 1, z };
    default:
      return { x: x + 1, y: y - 1, z };
  }
}

export type Tick = { index: number; offset: number };

/**
 * Which coordinates a ruler should label, and where they fall.
 *
 * `offset` deliberately excludes the pan: the ruler group is translated as the map moves, so the
 * tick list only has to be rebuilt when the zoom or the viewport size changes.
 */
export function rulerTicks(
  axis: "x" | "y",
  viewport: Viewport,
  size: number,
  minPixels: number
): Tick[] {
  const pitch = axis === "x" ? COLUMN_PITCH : ROW_PITCH;
  const strides = axis === "x" ? COLUMN_STRIDES : ROW_STRIDES;
  const scale = scaleOf(viewport.step);
  const screenPitch = pitch * scale;
  const translate = axis === "x" ? viewport.tx : viewport.ty;

  const stride =
    strides.find((candidate) => candidate * screenPitch >= minPixels) ??
    strides[strides.length - 1];

  const first = Math.ceil((0 - translate) / screenPitch);
  const last = Math.floor((size - translate) / screenPitch);

  const ticks: Tick[] = [];
  for (let index = Math.ceil(first / stride) * stride; index <= last; index += stride) {
    ticks.push({ index, offset: index * screenPitch });
  }
  return ticks;
}
