import { describe, expect, it } from "vitest";
import { aReportUnit, type ReportUnit, type StudyForecast } from "@atlantis/core-client";

import { battleSkillGroups, battleSkillSource, unitSkillsCell, type BattleSkillGroup } from "./battleSkillPresentation";
import { NO_DERIVED_SKILLS, withRosterSkills, type DerivedSkill } from "./battleSkills";
import { filterUnits } from "./unitTable";

const OCEAN = { x: 25, y: 55, z: 1 };

/** A `DerivedSkill`, built directly rather than through `withRosterSkills`, for the presentation tests. */
function aSkill(overrides: Partial<DerivedSkill> = {}): DerivedSkill {
  return {
    name: "combat",
    tag: "COMB",
    level: 2,
    turn: 71,
    coordinate: OCEAN,
    terrain: "ocean",
    ...overrides
  };
}

const aGroup = (overrides: Partial<BattleSkillGroup> = {}): BattleSkillGroup => ({
  turn: 71,
  coordinate: OCEAN,
  terrain: "ocean",
  skills: [aSkill()],
  ...overrides
});

const foreignUnit = (overrides: Parameters<typeof aReportUnit>[0] = {}) =>
  aReportUnit({ own: false, skills: [], ...overrides });

/** A study forecast with nothing doubted, for the cells a STUDY moves (`ah-uxlh`). */
function aStudy(overrides: Partial<StudyForecast>): StudyForecast {
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

describe("unitSkillsCell", () => {
  it("a report-native skill list prints exactly as the table always has", () => {
    const unit = aReportUnit({
      skills: [
        { name: "lumberjack", tag: "LUMB", level: 2, points: 90 },
        { name: "combat", tag: "COMB", level: 1, points: 30 }
      ]
    });

    expect(unitSkillsCell(unit, NO_DERIVED_SKILLS)).toBe("LUMB 2 (90), COMB 1 (30)");
  });

  it("a studying unit prints its skills as they will be next month (ah-uxlh)", () => {
    const unit = {
      ...aReportUnit({
        skills: [
          { name: "combat", tag: "COMB", level: 2, points: 150 },
          { name: "riding", tag: "RIDI", level: 1, points: 30 }
        ]
      }),
      study: aStudy({ tag: "COMB", name: "combat", levelBefore: 2, pointsBefore: 150, levelAfter: 3, pointsAfter: 180 })
    };

    expect(unitSkillsCell(unit, NO_DERIVED_SKILLS)).toBe("COMB 3 (180), RIDI 1 (30)");
  });

  it("the table filter finds a studying unit by next month's figures (ah-uxlh)", () => {
    const unit = {
      ...aReportUnit({ skills: [{ name: "combat", tag: "COMB", level: 2, points: 150 }] }),
      study: aStudy({ tag: "COMB", name: "combat", levelBefore: 2, pointsBefore: 150, levelAfter: 3, pointsAfter: 180 })
    };
    // As the table calls it: typed as a report unit, carrying the preview's `study` at run time.
    const cell = (shown: ReportUnit) => unitSkillsCell(shown, NO_DERIVED_SKILLS);

    expect(filterUnits([unit], "COMB 3", new Map(), cell)).toEqual([unit]);
    expect(filterUnits([unit], "COMB 2", new Map(), cell)).toEqual([]);
  });

  it("an own unit with no skills that studies its first prints that skill (ah-uxlh)", () => {
    const unit = {
      ...aReportUnit({ own: true, skills: [] }),
      study: aStudy({ tag: "FORC", name: "force", levelAfter: 1, pointsAfter: 30 })
    };

    expect(unitSkillsCell(unit, NO_DERIVED_SKILLS)).toBe("FORC 1 (30)");
  });

  it("an own unit with no skills prints the empty cell, never a battle notice", () => {
    const derived = withRosterSkills(
      NO_DERIVED_SKILLS,
      [{ unitId: "1", unitName: "Scouts", coordinate: OCEAN, terrain: "ocean", skills: [{ name: "combat", level: 5 }] }],
      71
    );

    expect(unitSkillsCell(aReportUnit({ unitId: "1", own: true, skills: [] }), derived)).toBe("");
  });

  it("nothing recovered prints the empty cell", () => {
    expect(unitSkillsCell(foreignUnit({ unitId: "4839" }), NO_DERIVED_SKILLS)).toBe("");
  });

  it("a shared turn is written once in the table cell", () => {
    const derived = withRosterSkills(
      NO_DERIVED_SKILLS,
      [
        {
          unitId: "4839",
          unitName: "Watazka",
          coordinate: OCEAN,
          terrain: "ocean",
          skills: [
            { name: "riding", level: 5 },
            { name: "combat", level: 2 },
            { name: "longbow", level: 4 }
          ]
        }
      ],
      71
    );

    expect(unitSkillsCell(foreignUnit({ unitId: "4839" }), derived)).toBe("RIDI 5, COMB 2, LBOW 4 (turn 71)");
  });

  it("different turns are written beside their skills", () => {
    const withCombat = withRosterSkills(
      NO_DERIVED_SKILLS,
      [{ unitId: "4839", unitName: "Watazka", coordinate: OCEAN, terrain: "ocean", skills: [{ name: "combat", level: 4 }] }],
      68
    );
    const derived = withRosterSkills(
      withCombat,
      [{ unitId: "4839", unitName: "Watazka", coordinate: OCEAN, terrain: "ocean", skills: [{ name: "riding", level: 5 }] }],
      71
    );

    expect(unitSkillsCell(foreignUnit({ unitId: "4839" }), derived)).toBe("COMB 4 (turn 68), RIDI 5 (turn 71)");
  });
});

describe("skills carried from a merged report (ah-oqxn)", () => {
  const carried = aSkill({ name: "combat", tag: "COMB", level: 2, turn: 17, coordinate: null, terrain: null, from: "Borg (62)" });

  it("reads in the cell the way a battle-learned skill does", () => {
    expect(unitSkillsCell(foreignUnit({ unitId: "7124" }), new Map([["7124", [carried]]]))).toBe("COMB 2 (turn 17)");
  });

  it("is its own group, apart from a battle in the same turn", () => {
    const battle = aSkill({ turn: 17, coordinate: null, terrain: null });

    expect(battleSkillGroups([carried, battle]).map((group) => group.from ?? null)).toEqual(["Borg (62)", null]);
  });

  it("names the merged report rather than a battle, in both voices", () => {
    const [group] = battleSkillGroups([carried]);

    expect(battleSkillSource(group, "read")).toBe("From Borg (62)'s own report for turn 17.");
    expect(battleSkillSource(group, "seen")).toBe("From Borg (62)'s own report for turn 17.");
  });
});

describe("battleSkillGroups", () => {
  it("skills are grouped by identical battle source without reordering them", () => {
    const first = aSkill({ name: "riding", tag: "RIDI", level: 5, turn: 71, coordinate: OCEAN, terrain: "ocean" });
    const second = aSkill({ name: "combat", tag: "COMB", level: 4, turn: 68, coordinate: { x: 7, y: 53, z: 1 }, terrain: "mountain" });
    const third = aSkill({ name: "longbow", tag: "LBOW", level: 4, turn: 71, coordinate: OCEAN, terrain: "ocean" });

    const groups = battleSkillGroups([first, second, third]);

    expect(groups).toEqual([
      { turn: 71, coordinate: OCEAN, terrain: "ocean", skills: [first, third] },
      { turn: 68, coordinate: { x: 7, y: 53, z: 1 }, terrain: "mountain", skills: [second] }
    ]);
  });

  it("two battles in the same turn but different hexes stay separate groups", () => {
    const here = aSkill({ turn: 71, coordinate: OCEAN, terrain: "ocean" });
    const there = aSkill({ turn: 71, coordinate: { x: 7, y: 53, z: 1 }, terrain: "mountain" });

    expect(battleSkillGroups([here, there])).toEqual([
      { turn: 71, coordinate: OCEAN, terrain: "ocean", skills: [here] },
      { turn: 71, coordinate: { x: 7, y: 53, z: 1 }, terrain: "mountain", skills: [there] }
    ]);
  });
});

describe("battleSkillSource", () => {
  it("a source with no complete location omits the location", () => {
    expect(battleSkillSource(aGroup({ turn: 70, coordinate: null, terrain: null }), "read")).toBe(
      "Read from a battle on turn 70."
    );
    expect(battleSkillSource(aGroup({ turn: 70, coordinate: null, terrain: null }), "seen")).toBe(
      "Seen in a battle on turn 70."
    );
  });

  it("a defensive half-present source also omits the location", () => {
    expect(battleSkillSource(aGroup({ turn: 70, coordinate: OCEAN, terrain: null }), "read")).toBe(
      "Read from a battle on turn 70."
    );
    expect(battleSkillSource(aGroup({ turn: 70, coordinate: null, terrain: "ocean" }), "read")).toBe(
      "Read from a battle on turn 70."
    );
  });

  it("the read voice names the battle and its location", () => {
    expect(battleSkillSource(aGroup({ turn: 71 }), "read")).toBe(
      "Read from the battle in ocean (25,55) on turn 71."
    );
  });

  it("the seen voice names the battle and its location", () => {
    expect(battleSkillSource(aGroup({ turn: 71 }), "seen")).toBe(
      "Seen in the battle in ocean (25,55), turn 71."
    );
  });
});
