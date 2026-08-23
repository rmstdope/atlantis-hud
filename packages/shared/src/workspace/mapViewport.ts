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

import type { Coordinate, MapShape } from "@atlantis/core-client";

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

/**
 * Which hex a point on screen falls in - the inverse of [`worldOf`], through the view transform.
 *
 * This is what makes unexplored ground clickable at all. Known hexes are elements and answer for
 * themselves; the fog is a single patterned rectangle covering the whole map, so there is nothing
 * out there to ask and the hex has to be worked out from the pixel.
 *
 * The lattice only holds positions where `x + y` is even, so rounding each axis on its own would
 * land on positions that do not exist. The candidates around the point are measured instead, and
 * the nearest wins - which is also what makes the answer agree with what the player sees, since a
 * hex is the set of points closer to its centre than to any other.
 */
export function coordinateAt(
  pointerX: number,
  pointerY: number,
  viewport: Viewport,
  level: number
): Coordinate {
  const scale = scaleOf(viewport.step);
  const worldX = (pointerX - viewport.tx) / scale;
  const worldY = (pointerY - viewport.ty) / scale;

  const column = worldX / COLUMN_PITCH;
  const row = worldY / ROW_PITCH;

  let nearest = { x: 0, y: 0, z: level };
  let shortest = Infinity;
  for (const x of [Math.floor(column), Math.ceil(column)]) {
    // The rows this column holds are the ones matching its parity, two apart.
    const y = Math.round((row - x) / 2) * 2 + x;
    for (const candidate of [{ x, y }, { x, y: y - 2 }, { x, y: y + 2 }]) {
      const dx = (candidate.x - column) * COLUMN_PITCH;
      const dy = (candidate.y - row) * ROW_PITCH;
      const distance = dx * dx + dy * dy;
      if (distance < shortest) {
        shortest = distance;
        nearest = { ...candidate, z: level };
      }
    }
  }
  return nearest;
}

/**
 * Screen the map owns but cannot show anything in, because a pane is drawn over it.
 *
 * The panes float above the canvas rather than shrinking it, so the canvas size says nothing
 * about what the player can see. Everything that frames, centres or asks "is this visible" works
 * against the strip these leave rather than against the whole canvas.
 */
export type Insets = { left: number; right: number; top: number; bottom: number };

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * The narrowest strip worth framing into. Below this the panes have all but met - a window too
 * small for them - and framing into what is left would be a view of nothing. The whole canvas is
 * the honest fallback: partly covered beats off screen.
 */
const MIN_VISIBLE = 120;

/** The part of the canvas the panes leave, or the whole canvas where they leave too little. */
export function visibleRect(
  width: number,
  height: number,
  insets: Insets = NO_INSETS
): { x: number; y: number; width: number; height: number } {
  const strip = (size: number, near: number, far: number) =>
    size - near - far >= MIN_VISIBLE ? { start: near, size: size - near - far } : { start: 0, size };

  const horizontal = strip(width, insets.left, insets.right);
  const vertical = strip(height, insets.top, insets.bottom);
  return {
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.size,
    height: vertical.size
  };
}

export function fitTo(
  coordinates: Coordinate[],
  width: number,
  height: number,
  insets: Insets = NO_INSETS
): Viewport | null {
  if (coordinates.length === 0 || width <= 0 || height <= 0) {
    return null;
  }
  const visible = visibleRect(width, height, insets);

  const worlds = coordinates.map(worldOf);
  const minX = Math.min(...worlds.map((world) => world.x));
  const maxX = Math.max(...worlds.map((world) => world.x));
  const minY = Math.min(...worlds.map((world) => world.y));
  const maxY = Math.max(...worlds.map((world) => world.y));

  // The bounds are of hex centres, so they have to grow by half a hex to hold the whole shape.
  const spanX = maxX - minX + HEX_RADIUS * 2;
  const spanY = maxY - minY + ROW_PITCH * 2;

  const wanted = Math.min(visible.width / spanX, visible.height / spanY);
  // Floored to a whole step so that fitting never lands on a scale zooming cannot return to, and
  // never rounds up into a frame that clips the outermost hex.
  const step = clampStep(Math.floor(Math.log2(wanted) * STEPS_PER_DOUBLING));
  const scale = scaleOf(step);

  return {
    tx: visible.x + visible.width / 2 - ((minX + maxX) / 2) * scale,
    ty: visible.y + visible.height / 2 - ((minY + maxY) / 2) * scale,
    step
  };
}

export function centreOn(
  coordinate: Coordinate,
  viewport: Viewport,
  width: number,
  height: number,
  insets: Insets = NO_INSETS
): Viewport {
  const world = worldOf(coordinate);
  const scale = scaleOf(viewport.step);
  const visible = visibleRect(width, height, insets);
  return {
    tx: visible.x + visible.width / 2 - world.x * scale,
    ty: visible.y + visible.height / 2 - world.y * scale,
    step: viewport.step
  };
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
  height: number,
  insets: Insets = NO_INSETS
): boolean {
  const world = worldOf(coordinate);
  const scale = scaleOf(viewport.step);
  const x = viewport.tx + world.x * scale;
  const y = viewport.ty + world.y * scale;
  const halfWidth = HEX_RADIUS * scale;
  const halfHeight = ROW_PITCH * scale;
  const visible = visibleRect(width, height, insets);

  return (
    x - halfWidth < visible.x ||
    x + halfWidth > visible.x + visible.width ||
    y - halfHeight < visible.y ||
    y + halfHeight > visible.y + visible.height
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

/** How far apart the world's repeats are, per axis, in world units - `null` where it does not repeat. */
export type WrapSpans = { x: number | null; y: number | null };

/**
 * How far apart the world's repeats are, in world units, per axis - `null` where that axis does not
 * repeat.
 *
 * An axis repeats only when the game says it wraps AND the extent is **even**: the lattice holds
 * only positions where `x + y` is even, so shifting by an odd width lands rows half a hex out and
 * the two edges genuinely do not meet. A game saved before that combination is refused where it is
 * entered may already carry it, so drawing no seam is the honest answer.
 */
export function wrapSpans(shape: MapShape | null | undefined): WrapSpans {
  return {
    x: repeats(shape?.wrapX, shape?.width) ? shape!.width * COLUMN_PITCH : null,
    y: repeats(shape?.wrapY, shape?.height) ? shape!.height * ROW_PITCH : null
  };
}

function repeats(wraps: boolean | undefined, extent: number | undefined): boolean {
  return wraps === true && extent !== undefined && extent > 0 && extent % 2 === 0;
}

/**
 * How many worlds the ghost copies are shifted by, so the three of them (one either side of the
 * middle one) cover wherever the camera has got to.
 *
 * The camera itself is deliberately **not** folded. Folding it keeps the arithmetic in one repeat,
 * but the world is drawn once and the ghosts are clones of it: a folded camera leaves the player
 * looking at a clone while the real hexes, note pins and rings sit a world off screen, out of reach
 * of the keyboard, an assistive technology and every existing test. Moving the copies instead costs
 * one attribute write per ghost per frame and keeps what is on screen the thing it appears to be.
 */
export function ghostShift(translation: number, span: number | null, scale: number): number {
  if (span === null) return 0;
  const period = span * scale;
  if (!(period > 0)) return 0;
  // `|| 0` rather than a bare negation, so a translation inside the first repeat answers +0 rather
  // than the -0 that reads as a different number to anything comparing exactly.
  return -Math.round(translation / period) || 0;
}

/**
 * A coordinate folded into the map's own range, on whichever axes repeat.
 *
 * Mirrors `MapGeometry::wrap` exactly: the view and the movement planner disagreeing about which
 * hex `x = 72` is would be worse than either being wrong alone.
 */
export function foldCoordinate(coordinate: Coordinate, shape: MapShape | null | undefined): Coordinate {
  return {
    ...coordinate,
    x: repeats(shape?.wrapX, shape?.width)
      ? remEuclid(coordinate.x, shape!.width)
      : coordinate.x,
    y: repeats(shape?.wrapY, shape?.height)
      ? remEuclid(coordinate.y, shape!.height)
      : coordinate.y
  };
}

function remEuclid(value: number, extent: number): number {
  return ((value % extent) + extent) % extent;
}
