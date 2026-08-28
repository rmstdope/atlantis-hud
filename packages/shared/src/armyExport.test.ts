import { describe, expect, it } from "vitest";
import type { ArmyMemberRecord, ArmyRecord } from "@atlantis/core-client";

import {
  battleFileName,
  battleFileOf,
  battleFileText,
  battleSideOf,
  battleUnitOf,
  exportReadiness,
  exportedStatus
} from "./armyExport";
import { NO_DERIVED_SKILLS, withRosterSkills } from "./battleSkills";

const NOW = "2026-08-27T09:00:00Z";

/** Unit 4839 "Watazka" as the fixture's turn-71 roster prints it: `riding 5, combat 2, longbow 4`. */
const WATAZKA_ROSTER = withRosterSkills(
  NO_DERIVED_SKILLS,
  [
    {
      unitId: "4839",
      unitName: "Watazka",
      coordinate: { x: 25, y: 55, z: 1 },
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

function aMember(overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord {
  return {
    unitId: "7954",
    name: "Shieldwall",
    factionId: "95",
    factionName: "Borg TNG",
    own: true,
    regionId: "1:7,53",
    flags: [],
    items: [],
    skills: [],
    combatSpell: null,
    men: 1,
    seenTurn: 71,
    seenAt: NOW,
    ...overrides
  };
}

function anArmy(name: string, members: ArmyMemberRecord[], id = name): ArmyRecord {
  return {
    id,
    gameId: "game-1",
    name,
    members,
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("battleUnitOf", () => {
  it("a member becomes a simulator unit", () => {
    const member = aMember({
      unitId: "7954",
      name: "Shieldwall",
      flags: ["behind", "avoiding"],
      items: [
        { amount: 30, name: "leaders", tag: "LEAD" },
        { amount: 4210, name: "silver", tag: "SILV" },
        { amount: 30, name: "plate armor", tag: "PARM" }
      ],
      skills: [
        { name: "combat", tag: "COMB", level: 3, points: 180 },
        { name: "fire", tag: "FIRE", level: 2, points: 90 }
      ],
      combatSpell: { name: "fire", tag: "FIRE" }
    });

    expect(battleUnitOf(member, NO_DERIVED_SKILLS)).toEqual({
      name: "Shieldwall (7954)",
      skills: [
        { abbr: "COMB", level: 3 },
        { abbr: "FIRE", level: 2 }
      ],
      items: [
        { abbr: "LEAD", amount: 30 },
        { abbr: "PARM", amount: 30 }
      ],
      flags: ["behind"],
      combatSpell: "FIRE"
    });
  });

  it("omits flags and combatSpell entirely rather than writing empty ones", () => {
    const unit = battleUnitOf(aMember({ flags: ["avoiding"], skills: [], combatSpell: null }), NO_DERIVED_SKILLS);

    expect(unit).not.toHaveProperty("flags");
    expect(unit).not.toHaveProperty("combatSpell");
    expect(unit.skills).toEqual([]);
    expect(unit.items).toEqual([]);
  });

  it("a foreign member goes out with the skills a roster disclosed", () => {
    const member = aMember({ unitId: "4839", name: "Watazka", own: false, skills: [] });

    expect(battleUnitOf(member, WATAZKA_ROSTER).skills).toEqual([
      { abbr: "RIDI", level: 5 },
      { abbr: "COMB", level: 2 },
      { abbr: "LBOW", level: 4 }
    ]);
  });

  it("an own member's own skills are untouched", () => {
    const member = aMember({
      unitId: "4839",
      own: true,
      skills: [{ name: "combat", tag: "COMB", level: 3, points: 180 }]
    });

    expect(battleUnitOf(member, WATAZKA_ROSTER).skills).toEqual([{ abbr: "COMB", level: 3 }]);
  });
});

describe("battleSideOf and battleFileOf", () => {
  it("both keys are present however few Armies were chosen", () => {
    const army = anArmy("Northern Host", [aMember()]);

    const file = battleFileOf(army, null, NO_DERIVED_SKILLS);

    expect(Object.keys(file)).toEqual(["attackers", "defenders"]);
    expect(file.attackers.units).toHaveLength(1);
    expect(file.defenders.units).toEqual([]);
    expect(battleSideOf(null, NO_DERIVED_SKILLS)).toEqual({ units: [] });
  });

  it("keeps the Army's own member order", () => {
    const army = anArmy("Northern Host", [
      aMember({ unitId: "2", name: "Second" }),
      aMember({ unitId: "1", name: "First" })
    ]);

    expect(battleSideOf(army, NO_DERIVED_SKILLS).units.map((unit) => unit.name)).toEqual([
      "Second (2)",
      "First (1)"
    ]);
  });

  it("writes the file as indented JSON", () => {
    const text = battleFileText(battleFileOf(null, null, NO_DERIVED_SKILLS));

    expect(text).toBe(JSON.stringify({ attackers: { units: [] }, defenders: { units: [] } }, null, 2));
  });
});

describe("battleFileName and exportedStatus", () => {
  it("names both sides, or the one Army chosen", () => {
    const northern = anArmy("Northern Host", [aMember()]);
    const coastal = anArmy("Coastal Watch", [aMember()]);

    expect(battleFileName(northern, coastal)).toBe("northern-host-vs-coastal-watch.json");
    expect(battleFileName(northern, null)).toBe("northern-host.json");
    expect(battleFileName(null, coastal)).toBe("coastal-watch.json");
    expect(battleFileName(anArmy("!!!", []), null)).toBe("army.json");
    expect(battleFileName(northern, northern)).toBe("northern-host-vs-northern-host.json");
  });

  it("says what went out", () => {
    const northern = anArmy("Northern Host", [aMember()]);
    const coastal = anArmy("Coastal Watch", [aMember()]);

    expect(exportedStatus(northern, coastal)).toBe("exported Northern Host vs Coastal Watch");
    expect(exportedStatus(northern, null)).toBe("exported Northern Host");
    expect(exportedStatus(null, coastal)).toBe("exported Coastal Watch");
  });
});

describe("exportReadiness", () => {
  const northern = anArmy("Northern Host", [aMember()]);
  const coastal = anArmy("Coastal Watch", [aMember({ unitId: "2" })]);
  const empty = anArmy("Empty Host", []);

  it("refuses before it warns", () => {
    expect(
      exportReadiness({
        armies: [],
        attackers: null,
        defenders: null,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      })
    ).toEqual({
      count: 0,
      countText: null,
      refusal: "No Armies to export. Make an Army first, then come back.",
      waiting: false,
      notices: []
    });

    expect(
      exportReadiness({
        armies: [northern],
        attackers: null,
        defenders: null,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).refusal
    ).toBe("Choose at least one Army.");

    expect(
      exportReadiness({
        armies: [northern, empty],
        attackers: empty,
        defenders: northern,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).refusal
    ).toBe("Empty Host has no units in it.");
  });

  it("names the attacker when both chosen Armies are empty", () => {
    const other = anArmy("Other Host", []);

    expect(
      exportReadiness({
        armies: [empty, other],
        attackers: empty,
        defenders: other,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).refusal
    ).toBe("Empty Host has no units in it.");
  });

  it("counts the units and says nothing else when there is nothing to say", () => {
    const readiness = exportReadiness({
      armies: [northern, coastal],
      attackers: northern,
      defenders: coastal,
      currentTurn: 71,
      derived: NO_DERIVED_SKILLS,
      scanning: false,
      unreadTurns: 0
    });

    expect(readiness).toEqual({
      count: 2,
      countText: "2 units will be exported.",
      refusal: null,
      waiting: false,
      notices: []
    });
  });

  it("counts one unit in the singular", () => {
    const both = anArmy("Northern Host", [aMember(), aMember({ unitId: "2" })]);

    expect(
      exportReadiness({
        armies: [northern, both],
        attackers: northern,
        defenders: null,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).countText
    ).toBe("1 unit will be exported.");
    expect(
      exportReadiness({
        armies: [both],
        attackers: both,
        defenders: null,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).countText
    ).toBe("2 units will be exported.");
  });

  it("counts remembered and foreign members", () => {
    const mixed = anArmy("Mixed Host", [
      aMember({ unitId: "1", seenTurn: 68 }),
      aMember({ unitId: "2", seenTurn: 71, own: false }),
      aMember({ unitId: "3", seenTurn: 71 })
    ]);

    const readiness = exportReadiness({
      armies: [mixed],
      attackers: mixed,
      defenders: null,
      currentTurn: 71,
      derived: NO_DERIVED_SKILLS,
      scanning: false,
      unreadTurns: 0
    });

    expect(readiness.count).toBe(3);
    expect(readiness.notices).toEqual([
      {
        kind: "remembered",
        text: "1 unit was not in this turn's report. It goes out as it was when last seen."
      },
      {
        kind: "foreign",
        text: "1 unit belongs to another faction. It goes out with no skills — no battle we have seen involved it."
      },
      { kind: "empty-side", text: "The defending side will be empty." }
    ]);
  });

  it("says all of them when every unit is remembered", () => {
    const stale = anArmy("Old Host", [
      aMember({ unitId: "1", seenTurn: 68 }),
      aMember({ unitId: "2", seenTurn: 69 })
    ]);

    expect(
      exportReadiness({
        armies: [stale],
        attackers: stale,
        defenders: stale,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).notices[0]
    ).toEqual({
      kind: "remembered",
      text: "All 4 units were not in this turn's report. They go out as they were when last seen."
    });
  });

  it("pluralises the remembered and foreign lines", () => {
    const mixed = anArmy("Mixed Host", [
      aMember({ unitId: "1", seenTurn: 68 }),
      aMember({ unitId: "2", seenTurn: 68 }),
      aMember({ unitId: "3", seenTurn: 71, own: false }),
      aMember({ unitId: "4", seenTurn: 71, own: false }),
      aMember({ unitId: "5", seenTurn: 71 })
    ]);

    const readiness = exportReadiness({
      armies: [mixed, coastal],
      attackers: mixed,
      defenders: coastal,
      currentTurn: 71,
      derived: NO_DERIVED_SKILLS,
      scanning: false,
      unreadTurns: 0
    });

    expect(readiness.notices).toEqual([
      {
        kind: "remembered",
        text: "2 units were not in this turn's report. They go out as they were when last seen."
      },
      {
        kind: "foreign",
        text: "2 units belong to another faction. They go out with no skills — no battle we have seen involved any of them."
      }
    ]);
  });

  it("says which side will be empty", () => {
    expect(
      exportReadiness({
        armies: [northern],
        attackers: northern,
        defenders: null,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).notices
    ).toEqual([{ kind: "empty-side", text: "The defending side will be empty." }]);

    expect(
      exportReadiness({
        armies: [northern],
        attackers: null,
        defenders: northern,
        currentTurn: 71,
        derived: NO_DERIVED_SKILLS,
        scanning: false,
        unreadTurns: 0
      }).notices
    ).toEqual([{ kind: "empty-side", text: "The attacking side will be empty." }]);
  });

  it("counts an Army chosen on both sides twice", () => {
    const mixed = anArmy("Mixed Host", [
      aMember({ unitId: "1", seenTurn: 68 }),
      aMember({ unitId: "2", seenTurn: 71, own: false })
    ]);

    const readiness = exportReadiness({
      armies: [mixed],
      attackers: mixed,
      defenders: mixed,
      currentTurn: 71,
      derived: NO_DERIVED_SKILLS,
      scanning: false,
      unreadTurns: 0
    });

    expect(readiness.count).toBe(4);
    expect(readiness.notices).toEqual([
      {
        kind: "remembered",
        text: "2 units were not in this turn's report. They go out as they were when last seen."
      },
      {
        kind: "foreign",
        text: "2 units belong to another faction. They go out with no skills — no battle we have seen involved any of them."
      }
    ]);
  });
});

describe("exportReadiness, battle skills", () => {
  /** `n` foreign members, the first `recovered` of them with skills a roster disclosed. */
  function withForeign(foreign: number, recovered: number) {
    const members = Array.from({ length: foreign }, (_unused, at) =>
      aMember({ unitId: `f${at}`, own: false })
    );
    const army = anArmy("Mixed Host", members);
    const derived = withRosterSkills(
      NO_DERIVED_SKILLS,
      members.slice(0, recovered).map((member) => ({
        unitId: member.unitId,
        unitName: member.name,
        coordinate: null,
        terrain: null,
        skills: [{ name: "combat", level: 2 }]
      })),
      71
    );
    return { army, derived };
  }

  function foreignNotice(foreign: number, recovered: number): string | undefined {
    const { army, derived } = withForeign(foreign, recovered);
    return exportReadiness({
      armies: [army],
      attackers: army,
      defenders: null,
      currentTurn: 71,
      derived,
      scanning: false,
      unreadTurns: 0
    }).notices.find((notice) => notice.kind === "foreign")?.text;
  }

  it("names how many of the foreign units carry recovered skills", () => {
    expect(foreignNotice(6, 4)).toEqual(
      "6 units belong to another faction. 4 of them go out with combat skills read from battle reports; the other 2 go out with none."
    );
  });

  it('says "the other" when one unit is left over', () => {
    expect(foreignNotice(2, 1)).toEqual(
      "2 units belong to another faction. 1 of them goes out with combat skills read from battle reports; the other goes out with none."
    );
  });

  it('says "the other" when one is left over of three', () => {
    expect(foreignNotice(3, 2)).toEqual(
      "3 units belong to another faction. 2 of them go out with combat skills read from battle reports; the other goes out with none."
    );
  });

  it("counts up as well as down", () => {
    expect(foreignNotice(3, 1)).toEqual(
      "3 units belong to another faction. 1 of them goes out with combat skills read from battle reports; the other 2 go out with none."
    );
  });

  it('says "All of them" when every foreign unit was recovered', () => {
    expect(foreignNotice(4, 4)).toEqual(
      "4 units belong to another faction. All of them go out with combat skills read from battle reports."
    );
  });

  it('says "It goes out" for a single recovered unit', () => {
    expect(foreignNotice(1, 1)).toEqual(
      "1 unit belongs to another faction. It goes out with combat skills read from battle reports."
    );
  });

  it("says no battle involved them when none were recovered", () => {
    expect(foreignNotice(6, 0)).toEqual(
      "6 units belong to another faction. They go out with no skills — no battle we have seen involved any of them."
    );
  });

  it("says no battle involved it for a single unit", () => {
    expect(foreignNotice(1, 0)).toEqual(
      "1 unit belongs to another faction. It goes out with no skills — no battle we have seen involved it."
    );
  });

  it("waits, and says so, while the scan is running and foreign units are in the file", () => {
    const { army, derived } = withForeign(2, 1);

    const readiness = exportReadiness({
      armies: [army],
      attackers: army,
      defenders: null,
      currentTurn: 71,
      derived,
      scanning: true,
      unreadTurns: 0
    });

    expect(readiness.waiting).toBe(true);
    expect(readiness.notices).toContainEqual({
      kind: "scanning",
      text: "Still reading this game's battle reports. The foreign units' skills are not counted yet."
    });
    expect(readiness.notices.some((notice) => notice.kind === "foreign")).toBe(false);
  });

  it("does not wait when no foreign unit is being exported", () => {
    const own = anArmy("Own Host", [aMember({ unitId: "1" }), aMember({ unitId: "2" })]);

    const readiness = exportReadiness({
      armies: [own],
      attackers: own,
      defenders: null,
      currentTurn: 71,
      derived: NO_DERIVED_SKILLS,
      scanning: true,
      unreadTurns: 3
    });

    expect(readiness.waiting).toBe(false);
    expect(readiness.notices.map((notice) => notice.kind)).toEqual(["empty-side"]);
  });

  it("names the stored turns it could not read", () => {
    const { army, derived } = withForeign(2, 1);

    const readiness = exportReadiness({
      armies: [army],
      attackers: army,
      defenders: army,
      currentTurn: 71,
      derived,
      scanning: false,
      unreadTurns: 2
    });

    expect(readiness.notices.map((notice) => notice.kind)).toEqual(["foreign", "unread-turns"]);
    expect(readiness.notices[1]).toEqual({
      kind: "unread-turns",
      text: "2 stored turns could not be read. Any battle in them was not counted."
    });
  });

  it("names a single stored turn it could not read in the singular", () => {
    const { army, derived } = withForeign(2, 1);

    expect(
      exportReadiness({
        armies: [army],
        attackers: army,
        defenders: army,
        currentTurn: 71,
        derived,
        scanning: false,
        unreadTurns: 1
      }).notices[1]
    ).toEqual({
      kind: "unread-turns",
      text: "1 stored turn could not be read. Any battle in it was not counted."
    });
  });

  it("says nothing about unread turns while still scanning", () => {
    const { army, derived } = withForeign(2, 1);

    const readiness = exportReadiness({
      armies: [army],
      attackers: army,
      defenders: null,
      currentTurn: 71,
      derived,
      scanning: true,
      unreadTurns: 2
    });

    expect(readiness.notices.some((notice) => notice.kind === "unread-turns")).toBe(false);
  });
});
