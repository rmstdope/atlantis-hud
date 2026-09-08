/**
 * One reading of a skill, in one place: `4(325)`, and the arrow where a month moves it.
 *
 * Every chip, cell, dropdown row, hover card and pane that words a skill's level with its points
 * calls this, so a decision about that wording is one file and one test rather than six template
 * literals across four modules.
 */

/**
 * A skill as a report prints it: a level, and the points held towards the next one.
 *
 * `points` of null is a report that printed none - the study planner's `KnownSkill` carries that
 * for a skill whose sheet gave no figure.
 */
export type SkillReading = { level: number; points: number | null };

/** One reading, rounded for display: `4(325)`, or `4` where no points were reported. */
function reading(held: SkillReading): string {
  return held.points === null ? `${held.level}` : `${held.level}(${Math.round(held.points)})`;
}

/**
 * `4(325)`; `4` when no points were reported; `4(325) → 4(355)` when `ends` is given and reads
 * differently.
 *
 * The level with its points in brackets and nothing else, closed up into one token - what a report
 * prints as `2 (90)` (navigator, 2026-09-07). Points are rounded **for display only**: a taught or
 * halved month makes them fractional, and a reading of `(133.33333333333334)` is the arithmetic
 * leaking through the glass.
 *
 * `ends` reading the same as `held` collapses to the held reading alone, deliberately:
 * `4(325) → 4(325)` for a turn nothing happened in promises a change and then denies it, and one
 * skill of the twenty a mage knows is the one actually going somewhere. The test is the two
 * *rendered* readings, so it cannot drift from what is drawn.
 */
export function skillWords(held: SkillReading, ends?: SkillReading | null): string {
  const from = reading(held);
  if (ends === undefined || ends === null) {
    return from;
  }
  const to = reading(ends);
  return from === to ? from : `${from} → ${to}`;
}
