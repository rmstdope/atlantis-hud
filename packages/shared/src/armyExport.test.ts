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

const NOW = "2026-08-27T09:00:00Z";

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

    expect(battleUnitOf(member)).toEqual({
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
    const unit = battleUnitOf(aMember({ flags: ["avoiding"], skills: [], combatSpell: null }));

    expect(unit).not.toHaveProperty("flags");
    expect(unit).not.toHaveProperty("combatSpell");
    expect(unit.skills).toEqual([]);
    expect(unit.items).toEqual([]);
  });
});

describe("battleSideOf and battleFileOf", () => {
  it("both keys are present however few Armies were chosen", () => {
    const army = anArmy("Northern Host", [aMember()]);

    const file = battleFileOf(army, null);

    expect(Object.keys(file)).toEqual(["attackers", "defenders"]);
    expect(file.attackers.units).toHaveLength(1);
    expect(file.defenders.units).toEqual([]);
    expect(battleSideOf(null)).toEqual({ units: [] });
  });

  it("keeps the Army's own member order", () => {
    const army = anArmy("Northern Host", [
      aMember({ unitId: "2", name: "Second" }),
      aMember({ unitId: "1", name: "First" })
    ]);

    expect(battleSideOf(army).units.map((unit) => unit.name)).toEqual([
      "Second (2)",
      "First (1)"
    ]);
  });

  it("writes the file as indented JSON", () => {
    const text = battleFileText(battleFileOf(null, null));

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
      exportReadiness({ armies: [], attackers: null, defenders: null, currentTurn: 71 })
    ).toEqual({
      count: 0,
      countText: null,
      refusal: "No Armies to export. Make an Army first, then come back.",
      notices: []
    });

    expect(
      exportReadiness({
        armies: [northern],
        attackers: null,
        defenders: null,
        currentTurn: 71
      }).refusal
    ).toBe("Choose at least one Army.");

    expect(
      exportReadiness({
        armies: [northern, empty],
        attackers: empty,
        defenders: northern,
        currentTurn: 71
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
        currentTurn: 71
      }).refusal
    ).toBe("Empty Host has no units in it.");
  });

  it("counts the units and says nothing else when there is nothing to say", () => {
    const readiness = exportReadiness({
      armies: [northern, coastal],
      attackers: northern,
      defenders: coastal,
      currentTurn: 71
    });

    expect(readiness).toEqual({
      count: 2,
      countText: "2 units will be exported.",
      refusal: null,
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
        currentTurn: 71
      }).countText
    ).toBe("1 unit will be exported.");
    expect(
      exportReadiness({
        armies: [both],
        attackers: both,
        defenders: null,
        currentTurn: 71
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
      currentTurn: 71
    });

    expect(readiness.count).toBe(3);
    expect(readiness.notices).toEqual([
      {
        kind: "remembered",
        text: "1 unit was not in this turn's report. It goes out as it was when last seen."
      },
      {
        kind: "foreign",
        text: "1 unit belongs to another faction. It goes out with its men and equipment but no skills — a report never shows you those."
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
        currentTurn: 71
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
      currentTurn: 71
    });

    expect(readiness.notices).toEqual([
      {
        kind: "remembered",
        text: "2 units were not in this turn's report. They go out as they were when last seen."
      },
      {
        kind: "foreign",
        text: "2 units belong to another faction. They go out with their men and equipment but no skills — a report never shows you those."
      }
    ]);
  });

  it("says which side will be empty", () => {
    expect(
      exportReadiness({
        armies: [northern],
        attackers: northern,
        defenders: null,
        currentTurn: 71
      }).notices
    ).toEqual([{ kind: "empty-side", text: "The defending side will be empty." }]);

    expect(
      exportReadiness({
        armies: [northern],
        attackers: null,
        defenders: northern,
        currentTurn: 71
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
      currentTurn: 71
    });

    expect(readiness.count).toBe(4);
    expect(readiness.notices).toEqual([
      {
        kind: "remembered",
        text: "2 units were not in this turn's report. They go out as they were when last seen."
      },
      {
        kind: "foreign",
        text: "2 units belong to another faction. They go out with their men and equipment but no skills — a report never shows you those."
      }
    ]);
  });
});
