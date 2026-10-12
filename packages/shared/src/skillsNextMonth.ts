/**
 * A unit's skills as they will stand next month, for the units table's Skills cell (`ah-uxlh`).
 *
 * Pure: no React, no store. It derives no arithmetic of its own — the figures are the study
 * forecast's (`ah-rgkk.2.2`), the very ones the Skills popup draws as its blue third figure, so the
 * cell and the popup always agree.
 */

import type { SkillInfo, StudyForecast } from "@atlantis/core-client";

/**
 * `skills` with this month's study laid on top.
 *
 * - No study, or one that cannot raise the level (`ah-dpvh`): `skills` itself, unchanged.
 * - A study that may not happen at all — short of the fee, the popup's "…so the study may not
 *   happen at all" (decision **D2**): `skills` itself. The cell never states a gain the forecast is
 *   not sure of; it stays brass and the popup says why.
 * - Otherwise the studied skill takes the forecast's `levelAfter (pointsAfter)`: in place when the
 *   unit holds it, so every held skill keeps its place, and appended at the end when it is the
 *   unit's first month of it (decision **N1**). A doubted teacher is already left out of those
 *   figures by the core — "its month is not counted here" — which is decision **T1**.
 */
export function skillsNextMonth(
  skills: readonly SkillInfo[],
  study: StudyForecast | null | undefined
): readonly SkillInfo[] {
  if (!study || study.cannotRaiseTheLevel || study.doubts.some((doubt) => doubt.reason === "feeShort")) {
    return skills;
  }
  const studied = { level: study.levelAfter, points: study.pointsAfter };
  if (skills.some((skill) => skill.tag === study.tag)) {
    return skills.map((skill) => (skill.tag === study.tag ? { ...skill, ...studied } : skill));
  }
  return [...skills, { name: study.name, tag: study.tag, ...studied }];
}
