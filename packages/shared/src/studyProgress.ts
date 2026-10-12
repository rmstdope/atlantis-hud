import type { SkillInfo } from "@atlantis/core-client";

/**
 * How far a month of study carries a skill, as arithmetic on the numbers a report prints.
 *
 * `rules/skills_studying` gives the month structure - "for a unit to gain level 1 of a skill, they
 * must gain one months worth of training ... to raise this skill level to 2, the unit must add an
 * additional two months worth of training. Then, to raise this to skill level 3 requires another
 * three months" - and nothing else here is a rule: no formatting, no React, no notion of a mage.
 */

/**
 * Study points one month of study is worth.
 *
 * `rules/skills_studying` states the month structure but publishes no point rate. Thirty is what
 * every report in `tests/fixtures/reports/` agrees on: level thresholds land on 30, 90, 180, 300
 * and 450, which is exactly 30 x n(n+1)/2. Points that are not multiples of thirty exist and are
 * ordinary - practice gains them - so this is the rate of a STUDIED month, never a guarantee that
 * points advance by it.
 */
export const STUDY_POINTS_PER_MONTH = 30;

/**
 * What a month of practice adds: the 5 days a planned cast gives the skill it practises
 * (ah-9qdz.3, confirmed by the navigator for New Age, 2026-10-12). `rules/skills_studying` (New
 * Age: Trident): practice "is much slower than studying", and only one skill improves a month.
 */
export const PRACTICE_POINTS_PER_MONTH = 5;

/** The points a unit must hold to be at `level`. Level 0 is 0; level 5 is 450. */
export function pointsForLevel(level: number): number {
  const steps = Math.max(0, Math.floor(level));
  return (STUDY_POINTS_PER_MONTH * steps * (steps + 1)) / 2;
}

/**
 * The level `points` buys. Never negative; `levelForPoints(449)` is 4.
 *
 * Compares against thresholds rather than dividing: practice grants partial points
 * (`rules/skills_studying`: "A unit can also increase its level of training by using a skill"), so
 * a real report carries numbers such as `[BUIL] 2 (115)` that no division would place correctly.
 */
export function levelForPoints(points: number): number {
  let level = 0;
  while (points >= pointsForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

/** One month in one skill, as far as what it adds is concerned. */
export type MonthOfSkill = {
  /**
   * Months' worth of study it carries: 1 ordinarily, 2 taught, 1/2 unsheltered, 0 when he studies
   * something else - what `ScheduleCell.worth` holds.
   */
  studied: number;
  /** Whether the turn's practice lands on this skill (ah-9qdz.3). */
  practised: boolean;
};

/**
 * Where one month leaves a skill he holds at `held`: the studied months at
 * `STUDY_POINTS_PER_MONTH`, plus `PRACTICE_POINTS_PER_MONTH` when the practice lands on it, never
 * below the level he held and capped at `maxLevel`.
 *
 * The one place a month's points are added (ah-2k4z): the Schedule's projection and the "Can study"
 * preview both ask this, so a new input to a month is written once and the two cannot disagree.
 * Points stay fractional and are never rounded - a halved or diluted month is worth a fraction of
 * thirty, and the rate is itself an inference (see `STUDY_POINTS_PER_MONTH`). Applying study and
 * then practice in two calls ends where one call with both does, since `levelForPoints` is monotone.
 */
export function monthEnd(
  held: { level: number; points: number },
  month: MonthOfSkill,
  maxLevel: number
): { level: number; points: number } {
  const points =
    held.points +
    STUDY_POINTS_PER_MONTH * month.studied +
    (month.practised ? PRACTICE_POINTS_PER_MONTH : 0);
  return { level: Math.min(maxLevel, Math.max(held.level, levelForPoints(points))), points };
}

/**
 * The highest level `months` more months of study in this one skill could have reached, capped at
 * `maxLevel`. Returns `skill.level` itself when nothing could have moved, so a caller compares.
 *
 * **Race maximums are not modelled.** `rules/skills_limitations` caps a skill by the studying
 * unit's race; the ruleset we hold does not give us that per race in a form this module can read,
 * so the projection uses the skill's own maximum and may be optimistic for a non-leader. Mages are
 * leaders (`rules/magic`), so the case is narrow.
 */
export function projectedLevel(
  skill: Pick<SkillInfo, "level" | "points">,
  months: number,
  maxLevel: number
): number {
  const studied = Math.max(0, months) * STUDY_POINTS_PER_MONTH;
  const reached = levelForPoints(skill.points + studied);
  return Math.min(maxLevel, Math.max(skill.level, reached));
}
