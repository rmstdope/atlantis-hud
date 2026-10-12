import { describe, expect, it } from "vitest";
import type { SkillInfo, StudyForecast } from "@atlantis/core-client";

import { skillsNextMonth } from "./skillsNextMonth";

const skill = (tag: string, level: number, points: number, name = tag.toLowerCase()): SkillInfo => ({
  name,
  tag,
  level,
  points
});

/** A forecast for `tag`, landing at `levelAfter (pointsAfter)`, nothing doubted. */
function study(overrides: Partial<StudyForecast>): StudyForecast {
  return {
    tag: "COMB",
    name: "combat",
    levelBefore: 0,
    pointsBefore: 0,
    monthsNumerator: 1,
    monthsDenominator: 1,
    teachers: [],
    halvedOutsideABuilding: false,
    pointsAfter: 30,
    levelAfter: 1,
    ceilingLevel: 5,
    limitingRaces: [],
    cannotRaiseTheLevel: false,
    doubts: [],
    ...overrides
  };
}

describe("skillsNextMonth (ah-uxlh)", () => {
  const held = [skill("COMB", 2, 150), skill("RIDI", 1, 30)];

  it("raises the studied skill in place when the month gains a level", () => {
    expect(skillsNextMonth(held, study({ levelBefore: 2, pointsBefore: 150, levelAfter: 3, pointsAfter: 180 }))).toEqual([
      skill("COMB", 3, 180),
      skill("RIDI", 1, 30)
    ]);
  });

  it("adds the days alone when the month gains no level, keeping the order", () => {
    const observing = [skill("OBSE", 1, 30), skill("STEA", 1, 30)];
    expect(
      skillsNextMonth(
        observing,
        study({ tag: "STEA", name: "stealth", levelBefore: 1, pointsBefore: 30, levelAfter: 1, pointsAfter: 60 })
      )
    ).toEqual([skill("OBSE", 1, 30), skill("STEA", 1, 60)]);
  });

  it("appends a skill studied for the first time at the end (N1)", () => {
    const fighting = [skill("COMB", 1, 30), skill("RIDI", 1, 30)];
    expect(skillsNextMonth(fighting, study({ tag: "FORC", name: "force", levelAfter: 1, pointsAfter: 30 }))).toEqual([
      skill("COMB", 1, 30),
      skill("RIDI", 1, 30),
      skill("FORC", 1, 30, "force")
    ]);
  });

  it("keeps today's figures for a study that may not happen at all (D2)", () => {
    const doubted = study({
      levelBefore: 2,
      pointsBefore: 150,
      levelAfter: 3,
      pointsAfter: 180,
      doubts: [{ reason: "feeShort", fee: 100, shortBy: 40, teacher: "" }]
    });
    expect(skillsNextMonth(held, doubted)).toBe(held);
  });

  it("counts only what is sure when a teacher alone is in doubt (T1)", () => {
    const taughtInDoubt = study({
      levelBefore: 2,
      pointsBefore: 150,
      levelAfter: 3,
      pointsAfter: 180,
      doubts: [
        { reason: "teacherUnsettled", fee: 0, shortBy: 0, teacher: "Masters (12)" },
        { reason: "teacherStudentsUnknown", fee: 0, shortBy: 0, teacher: "Masters (12)" }
      ]
    });
    expect(skillsNextMonth(held, taughtInDoubt)).toEqual([skill("COMB", 3, 180), skill("RIDI", 1, 30)]);
  });

  it("changes nothing for a study already at its ceiling", () => {
    expect(
      skillsNextMonth(
        held,
        study({ levelBefore: 2, pointsBefore: 150, levelAfter: 2, pointsAfter: 180, ceilingLevel: 2, cannotRaiseTheLevel: true })
      )
    ).toBe(held);
  });

  it("changes nothing for a unit that is not studying", () => {
    expect(skillsNextMonth(held, null)).toBe(held);
    expect(skillsNextMonth(held, undefined)).toBe(held);
  });
});
