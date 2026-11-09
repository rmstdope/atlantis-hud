/**
 * How the ocean's picture drifts: one hex width every eighteen seconds, redrawn eight times a
 * second rather than on every frame the screen can show (ah-5l9jg).
 *
 * The rate is the whole cost. Every redraw repaints the whole map, so a smooth drift cost a full
 * core on a map nobody was touching. The agreed floor is four a second; below that is not agreed.
 *
 * Pure, because the timer in `useWaterDrift` is the part a unit test here cannot reach.
 */

export const WATER_REDRAWS_PER_SECOND = 8;
export const WATER_SECONDS_PER_WIDTH = 18;

/** Marks a sliding group; its value is how many widths the picture's loop runs. */
export const WATER_LOOP_ATTRIBUTE = "data-water-loop";

const STEP_MS = 1000 / WATER_REDRAWS_PER_SECOND;
const STEPS_PER_WIDTH = WATER_SECONDS_PER_WIDTH * WATER_REDRAWS_PER_SECOND;

/** Which redraw this moment falls in. */
export function waterDriftStep(elapsedMs: number): number {
  return Math.floor(elapsedMs / STEP_MS);
}

/** Where the picture sits at that redraw, wrapped to its loop. */
export function waterDriftTransform(step: number, loopWidths: number): string {
  return `translate(${(step % (STEPS_PER_WIDTH * loopWidths)) / STEPS_PER_WIDTH} 0)`;
}

/** How long until the next redraw is due: redraws land on the clock, so every sea steps together. */
export function msUntilNextWaterStep(elapsedMs: number): number {
  return STEP_MS - (elapsedMs % STEP_MS);
}
