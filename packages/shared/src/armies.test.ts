import { describe, expect, it } from "vitest";
import {
  aParsedReport,
  aReportRegion,
  aReportUnit,
  type ArmyRecord,
  type ReportUnit
} from "@atlantis/core-client";
import {
  memberIsStale,
  newArmy,
  refreshedAgainst,
  renameArmy,
  snapshotOf,
  unitsByIdIn,
  withMember,
  withoutMember,
  alreadyIn
} from "./armies";

const NOW = "2026-08-01T09:00:00Z";
const LATER = "2026-08-02T09:00:00Z";

function anArmyWith(members: ArmyRecord["members"]): ArmyRecord {
  return {
    id: "army-1",
    gameId: "g",
    name: "Escort",
    members,
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("snapshotOf", () => {
  it("copies the unit's men, items, skills, flags and faction, and stamps the turn it was seen", () => {
    const unit = aReportUnit({
      unitId: "204",
      name: "Pikes",
      factionId: "73",
      factionName: "Ally",
      own: false,
      regionId: "1:8,54",
      flags: ["behind"],
      items: [{ amount: 57, name: "grain", tag: "GRAI" }],
      skills: [{ name: "combat", tag: "COMB", level: 2, points: 90 }],
      men: 12
    });

    expect(snapshotOf(unit, 71, NOW)).toEqual({
      unitId: "204",
      name: "Pikes",
      factionId: "73",
      factionName: "Ally",
      own: false,
      regionId: "1:8,54",
      flags: ["behind"],
      items: [{ amount: 57, name: "grain", tag: "GRAI" }],
      skills: [{ name: "combat", tag: "COMB", level: 2, points: 90 }],
      combatSpell: null,
      men: 12,
      seenTurn: 71,
      seenAt: NOW
    });
  });

  it("keeps a concealed faction as null rather than an empty string", () => {
    const unit = aReportUnit({ factionId: null, factionName: null, own: false });

    const snapshot = snapshotOf(unit, 71, NOW);

    expect(snapshot.factionId).toBeNull();
    expect(snapshot.factionName).toBeNull();
  });

  it("copies the combat spell rather than sharing the report's object", () => {
    const unit = aReportUnit({ combatSpell: { name: "fire", tag: "FIRE" } });

    const snapshot = snapshotOf(unit, 71, NOW);

    expect(snapshot.combatSpell).toEqual({ name: "fire", tag: "FIRE" });
    expect(snapshot.combatSpell).not.toBe(unit.combatSpell);
  });

  it("keeps a unit with no combat spell at null", () => {
    expect(snapshotOf(aReportUnit(), 71, NOW).combatSpell).toBeNull();
  });

  it("does not carry menEstimated - the export never consults it", () => {
    const snapshot = snapshotOf(aReportUnit({ men: 12, menEstimated: true }), 71, NOW);

    expect(snapshot).not.toHaveProperty("menEstimated");
    expect(snapshot.men).toBe(12);
  });
});

describe("newArmy", () => {
  it("trims the name and starts with no members", () => {
    const army = newArmy({ gameId: "g", name: "  Northern escort  ", now: NOW });

    expect(army).toMatchObject({
      gameId: "g",
      name: "Northern escort",
      members: [],
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(army.id).not.toBe("");
  });

  it("throws when the name trims to empty", () => {
    expect(() => newArmy({ gameId: "g", name: "   ", now: NOW })).toThrow();
  });
});

describe("renameArmy", () => {
  it("keeps the id, createdAt and members, and moves updatedAt", () => {
    const army = anArmyWith([snapshotOf(aReportUnit(), 71, NOW)]);

    const renamed = renameArmy(army, "  Vanguard  ", LATER);

    expect(renamed).toMatchObject({
      id: "army-1",
      name: "Vanguard",
      createdAt: NOW,
      updatedAt: LATER
    });
    expect(renamed.members).toEqual(army.members);
  });

  it("throws when the new name trims to empty", () => {
    expect(() => renameArmy(anArmyWith([]), "  ", LATER)).toThrow();
  });
});

describe("withMember and withoutMember", () => {
  it("adds a unit, and replaces its snapshot when it is already a member", () => {
    const army = anArmyWith([]);

    const added = withMember(army, aReportUnit({ unitId: "1", men: 1 }), 71, NOW);
    const replaced = withMember(added, aReportUnit({ unitId: "1", men: 9 }), 72, LATER);

    expect(added.members.map((one) => one.unitId)).toEqual(["1"]);
    expect(replaced.members).toHaveLength(1);
    expect(replaced.members[0]).toMatchObject({ men: 9, seenTurn: 72 });
    expect(replaced.updatedAt).toBe(LATER);
  });

  it("removes one member by unit number, and returns the same object when it was not a member", () => {
    const army = withMember(anArmyWith([]), aReportUnit({ unitId: "1" }), 71, NOW);

    expect(withoutMember(army, "1", LATER).members).toEqual([]);
    expect(withoutMember(army, "999", LATER)).toBe(army);
  });
});

describe("alreadyIn", () => {
  const held = (unitIds: string[]) =>
    anArmyWith(unitIds.map((unitId) => snapshotOf(aReportUnit({ unitId }), 71, NOW)));

  it("counts only the named units the Army holds", () => {
    expect(alreadyIn(held(["1", "2", "3"]), ["2", "9"])).toBe(1);
  });

  it("is the whole list when every one is a member", () => {
    expect(alreadyIn(held(["1", "2", "3"]), ["1", "3"])).toBe(2);
  });

  it("is nought for an Army holding none of them, and for a list naming nobody", () => {
    expect(alreadyIn(held(["1"]), ["7", "8"])).toBe(0);
    expect(alreadyIn(held(["1"]), [])).toBe(0);
  });
});

describe("unitsByIdIn", () => {
  it("maps every unit in every region by its unit number", () => {
    const parsed = aParsedReport({
      regions: [
        aReportRegion({ units: [aReportUnit({ unitId: "1" }), aReportUnit({ unitId: "2" })] }),
        aReportRegion({
          coordinate: { x: 8, y: 54, z: 1 },
          units: [aReportUnit({ unitId: "3" })]
        })
      ]
    });

    expect([...unitsByIdIn(parsed).keys()].sort()).toEqual(["1", "2", "3"]);
  });
});

describe("refreshedAgainst", () => {
  const seen = (units: ReportUnit[]) => new Map(units.map((unit) => [unit.unitId, unit]));

  it("gives a member the report shows a new snapshot", () => {
    const army = withMember(anArmyWith([]), aReportUnit({ unitId: "1", men: 1 }), 71, NOW);

    const refreshed = refreshedAgainst(army, seen([aReportUnit({ unitId: "1", men: 9 })]), 72, LATER);

    expect(refreshed.members[0]).toMatchObject({ men: 9, seenTurn: 72, seenAt: LATER });
    expect(refreshed.updatedAt).toBe(LATER);
  });

  it("leaves a member the report does not mention exactly as it was", () => {
    const army = withMember(anArmyWith([]), aReportUnit({ unitId: "204", men: 12 }), 68, NOW);

    const refreshed = refreshedAgainst(army, seen([aReportUnit({ unitId: "1" })]), 72, LATER);

    expect(refreshed.members[0]).toEqual(army.members[0]);
  });

  it("does not overwrite a newer snapshot from an older turn", () => {
    const army = withMember(anArmyWith([]), aReportUnit({ unitId: "1", men: 9 }), 72, LATER);

    const refreshed = refreshedAgainst(army, seen([aReportUnit({ unitId: "1", men: 1 })]), 68, NOW);

    expect(refreshed).toBe(army);
  });

  it("returns the same object when nothing changed", () => {
    const army = withMember(anArmyWith([]), aReportUnit({ unitId: "1", men: 1 }), 71, NOW);
    const sameUnit = aReportUnit({ unitId: "1", men: 1 });

    expect(refreshedAgainst(army, seen([sameUnit]), 71, LATER)).toBe(army);
  });

  it("refreshes a member whose combat spell changed", () => {
    const army = withMember(
      anArmyWith([]),
      aReportUnit({ unitId: "1", combatSpell: { name: "force shield", tag: "FSHI" } }),
      71,
      NOW
    );

    const refreshed = refreshedAgainst(
      army,
      seen([aReportUnit({ unitId: "1", combatSpell: { name: "fire", tag: "FIRE" } })]),
      72,
      LATER
    );

    expect(refreshed).not.toBe(army);
    expect(refreshed.members[0].combatSpell).toEqual({ name: "fire", tag: "FIRE" });
  });

  it("refreshes a member seen in the same turn whose details moved", () => {
    const army = withMember(anArmyWith([]), aReportUnit({ unitId: "1", men: 1 }), 71, NOW);

    const refreshed = refreshedAgainst(army, seen([aReportUnit({ unitId: "1", men: 4 })]), 71, LATER);

    expect(refreshed.members[0]).toMatchObject({ men: 4, seenTurn: 71 });
  });
});

describe("memberIsStale", () => {
  it("is true only when the snapshot is older than the turn on screen", () => {
    const member = snapshotOf(aReportUnit(), 68, NOW);

    expect(memberIsStale(member, 71)).toBe(true);
    expect(memberIsStale(member, 68)).toBe(false);
    expect(memberIsStale(member, 67)).toBe(false);
  });
});
