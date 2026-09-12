/**
 * The words on the two rings that mark an inner passage on the map.
 *
 * One pure module rather than strings inline in `MapCanvas.tsx`, so the three hovers sit together
 * and can be tested without rendering anything - `packages/shared` runs no effects and has no
 * jsdom, and a hover tested as a string is a hover that is actually tested (`ah-3u7c.2.2`).
 *
 * SVG `<title>` text, which is how every hover on this map works - the hex itself and the note pins
 * both - so the first line is a line rather than bold type.
 */

import type { TracedPassage } from "@atlantis/core-client";

import { levelFieldOf } from "../hexMapModel";

/**
 * `""` on the surface, `, in the underworld` for a named level, `, on level 5` otherwise.
 *
 * Built on `levelFieldOf` rather than on `levelClause`: the latter reads the known map's `levels`
 * list, which exists for the level control and would make a hover go silent about a level the
 * faction has not seen.
 */
function levelClauseOf(z: number): string {
  const name = levelFieldOf(z);
  if (name === null) {
    return "";
  }
  return /^\d+$/.test(name) ? `, on level ${name}` : `, in the ${name}`;
}

/** `On the surface`, `In the underworld`, `In the nexus`, `On level 5`. */
function levelPhraseOf(z: number): string {
  const name = levelFieldOf(z);
  if (name === null) {
    return "On the surface";
  }
  return /^\d+$/.test(name) ? `On level ${name}` : `In the ${name}`;
}

/**
 * The hover on the ring at the hex a passage is entered from.
 *
 * Three forms: the two `ah-3u7c.1` agreed for a passage nobody has proved the far side of, and the
 * one this bead adds for a passage a report has answered.
 */
export function passageTitle(passage: TracedPassage): string {
  const first = `Through the passage in ${passage.structure}`;
  const exit = passage.exit;
  if (exit) {
    const points = exit.cost === 1 ? "point" : "points";
    return [
      first,
      `Comes out in ${exit.terrain} (${exit.coordinate.x},${exit.coordinate.y})${levelClauseOf(exit.coordinate.z)}. ` +
        `Costs ${exit.cost} movement ${points}, the cost of entering that ${exit.terrain}.`
    ].join("\n");
  }
  return [
    first,
    passage.stepsAfter === 0
      ? "Where this passage comes out is not in any report yet, so where this unit ends the month is unknown."
      : `Where this passage comes out is not in any report yet, so the rest of the journey — ${passage.stepsAfter} more ${passage.stepsAfter === 1 ? "step" : "steps"} — cannot be drawn.`
  ].join("\n");
}

/**
 * The hover on the ring at the hex it comes out in. Only ever drawn for a passage whose `exit` is
 * known, which is the call site's guard: every word of this line is about the near end.
 *
 * It names the level the journey came *from*, which the reader cannot see: the far ring is drawn on
 * the destination's own level, and the entry hex is usually on another one.
 */
export function passageExitTitle(passage: TracedPassage): string {
  const from = passage.coordinate;
  return [
    `Out of the passage from ${passage.structure}`,
    `${levelPhraseOf(from.z)}, in ${passage.terrain} (${from.x},${from.y}). The journey carries on from here.`
  ].join("\n");
}
