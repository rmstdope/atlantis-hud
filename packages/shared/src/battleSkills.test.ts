import { describe, expect, it } from "vitest";
import type { ArmyMemberRecord, RosterSkills } from "@atlantis/core-client";

import {
  derivedSkillsFor,
  mergedDerived,
  NO_DERIVED_SKILLS,
  rosterSkillTag,
  withRosterSkills
} from "./battleSkills";

const OCEAN = { level: 1, x: 25, y: 55 };

function anEntry(overrides: Partial<RosterSkills> = {}): RosterSkills {
  return {
    unitId: "4839",
    unitName: "Watazka",
    coordinate: OCEAN,
    terrain: "ocean",
    skills: [],
    ...overrides
  };
}

function aMember(overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord {
  return {
    unitId: "4839",
    name: "Watazka",
    factionId: "46",
    factionName: "Stormbringer",
    own: false,
    regionId: "1:26,52",
    flags: [],
    items: [],
    skills: [],
    combatSpell: null,
    men: 1,
    seenTurn: 71,
    seenAt: "2026-08-27T09:00:00Z",
    ...overrides
  };
}

describe("rosterSkillTag", () => {
  it("answers the ruleset tag for every name a roster can print", () => {
    expect(rosterSkillTag("combat")).toBe("COMB");
    expect(rosterSkillTag("riding")).toBe("RIDI");
    expect(rosterSkillTag("tactics")).toBe("TACT");
    expect(rosterSkillTag("longbow")).toBe("LBOW");
    expect(rosterSkillTag("crossbow")).toBe("XBOW");
    expect(rosterSkillTag("stealth")).toBeNull();
  });
});

describe("withRosterSkills", () => {
  it("reads a roster entry into a unit's skills, in the order the roster printed them", () => {
    const derived = withRosterSkills(
      NO_DERIVED_SKILLS,
      [
        anEntry({
          skills: [
            { name: "riding", level: 5 },
            { name: "combat", level: 2 },
            { name: "longbow", level: 4 }
          ]
        })
      ],
      71
    );

    expect([...derived.keys()]).toEqual(["4839"]);
    expect(derived.get("4839")).toEqual([
      { name: "riding", tag: "RIDI", level: 5, turn: 71, coordinate: OCEAN, terrain: "ocean" },
      { name: "combat", tag: "COMB", level: 2, turn: 71, coordinate: OCEAN, terrain: "ocean" },
      { name: "longbow", tag: "LBOW", level: 4, turn: 71, coordinate: OCEAN, terrain: "ocean" }
    ]);
  });

  it("a newer turn replaces a skill and an older turn does not", () => {
    const old = withRosterSkills(
      NO_DERIVED_SKILLS,
      [anEntry({ skills: [{ name: "combat", level: 4 }] })],
      68
    );
    const newer = withRosterSkills(old, [anEntry({ skills: [{ name: "combat", level: 5 }] })], 71);

    expect(newer.get("4839")).toEqual([
      { name: "combat", tag: "COMB", level: 5, turn: 71, coordinate: OCEAN, terrain: "ocean" }
    ]);

    const older = withRosterSkills(
      newer,
      [anEntry({ skills: [{ name: "combat", level: 2 }] })],
      60
    );

    expect(older.get("4839")).toEqual([
      { name: "combat", tag: "COMB", level: 5, turn: 71, coordinate: OCEAN, terrain: "ocean" }
    ]);
  });

  it("a later entry in the same turn wins", () => {
    const derived = withRosterSkills(
      NO_DERIVED_SKILLS,
      [
        anEntry({ skills: [{ name: "combat", level: 3 }] }),
        anEntry({ skills: [{ name: "combat", level: 5 }] })
      ],
      71
    );

    expect(derived.get("4839")?.map((skill) => skill.level)).toEqual([5]);
  });

  it("a skill this build has no tag for is dropped", () => {
    const derived = withRosterSkills(
      NO_DERIVED_SKILLS,
      [
        anEntry({
          skills: [
            { name: "stealth", level: 3 },
            { name: "combat", level: 5 }
          ]
        })
      ],
      71
    );

    expect(derived.get("4839")?.map((skill) => skill.name)).toEqual(["combat"]);
  });

  it("an update keeps the skill's position in the unit's list", () => {
    const first = withRosterSkills(
      NO_DERIVED_SKILLS,
      [
        anEntry({
          skills: [
            { name: "riding", level: 5 },
            { name: "combat", level: 2 }
          ]
        })
      ],
      68
    );
    const second = withRosterSkills(first, [anEntry({ skills: [{ name: "riding", level: 6 }] })], 71);

    expect(second.get("4839")).toEqual([
      { name: "riding", tag: "RIDI", level: 6, turn: 71, coordinate: OCEAN, terrain: "ocean" },
      { name: "combat", tag: "COMB", level: 2, turn: 68, coordinate: OCEAN, terrain: "ocean" }
    ]);
  });
});

describe("mergedDerived", () => {
  it("keeps the greater turn, and lets incoming win a tie", () => {
    const base = withRosterSkills(
      NO_DERIVED_SKILLS,
      [anEntry({ skills: [{ name: "combat", level: 5 }] })],
      71
    );
    const older = withRosterSkills(
      NO_DERIVED_SKILLS,
      [anEntry({ skills: [{ name: "combat", level: 2 }] })],
      60
    );
    const tie = withRosterSkills(
      NO_DERIVED_SKILLS,
      [anEntry({ skills: [{ name: "combat", level: 9 }] })],
      71
    );

    expect(mergedDerived(base, older).get("4839")?.[0]?.level).toBe(5);
    expect(mergedDerived(older, base).get("4839")?.[0]?.level).toBe(5);
    expect(mergedDerived(base, tie).get("4839")?.[0]?.level).toBe(9);
  });

  it("carries a unit only one side knows about", () => {
    const base = withRosterSkills(
      NO_DERIVED_SKILLS,
      [anEntry({ skills: [{ name: "combat", level: 5 }] })],
      71
    );
    const other = withRosterSkills(
      NO_DERIVED_SKILLS,
      [anEntry({ unitId: "1234", skills: [{ name: "riding", level: 1 }] })],
      71
    );

    const merged = mergedDerived(base, other);
    expect([...merged.keys()].sort()).toEqual(["1234", "4839"]);
  });
});

describe("derivedSkillsFor", () => {
  const derived = withRosterSkills(
    NO_DERIVED_SKILLS,
    [anEntry({ skills: [{ name: "combat", level: 5 }] })],
    71
  );

  it("answers a foreign member with no skills of its own", () => {
    expect(derivedSkillsFor(derived, aMember()).map((skill) => skill.tag)).toEqual(["COMB"]);
  });

  it("answers nothing for a foreign member the rosters never saw", () => {
    expect(derivedSkillsFor(derived, aMember({ unitId: "9999" }))).toEqual([]);
  });

  it("answers nothing for an own member, even one with no skills", () => {
    expect(derivedSkillsFor(derived, aMember({ own: true }))).toEqual([]);
  });

  it("answers nothing for a member that has skills of its own", () => {
    expect(
      derivedSkillsFor(
        derived,
        aMember({ skills: [{ name: "combat", tag: "COMB", level: 1, points: 30 }] })
      )
    ).toEqual([]);
  });
});
