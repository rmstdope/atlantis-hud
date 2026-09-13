import { aReportUnit, type ArmyMemberRecord, type ArmyRecord, type ReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { armyRows, seenLabel, shownMemberCount } from "./armyRows";

function member(overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord {
  return {
    unitId: "1",
    name: "Scouts",
    factionId: "95",
    factionName: "Borg TNG",
    own: true,
    regionId: "1:7,53",
    flags: [],
    items: [],
    skills: [],
    combatSpell: null,
    men: 4,
    seenTurn: 71,
    seenAt: "2026-08-01T09:00:00Z",
    ...overrides
  };
}

function army(members: ArmyMemberRecord[]): ArmyRecord {
  return {
    id: "army-1",
    gameId: "aug-2026",
    name: "Northern Host",
    members,
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z"
  };
}

const byId = (units: ReportUnit[]) => new Map(units.map((unit) => [unit.unitId, unit]));

describe("an Army's members as table rows", () => {
  it("a member the report shows comes through as the report's own unit, not the snapshot", () => {
    const live = aReportUnit({ unitId: "1", name: "Scouts", men: 9, structureId: "s-1", weight: 40 });

    const { rows } = armyRows(army([member({ unitId: "1", men: 4 })]), byId([live]), 71);

    expect(rows).toHaveLength(1);
    // The very same object: the live row's structure, weight, long order and silver are then all
    // as good as any other row's.
    expect(rows[0]).toBe(live);
  });

  it("a member no report of this turn shows is not a row at all", () => {
    const rows = armyRows(
      army([member({ unitId: "1" }), member({ unitId: "7" })]),
      byId([aReportUnit({ unitId: "1" })]),
      71
    );

    expect(rows.rows.map((row) => row.unitId)).toEqual(["1"]);
    expect(rows.seen.has("7")).toBe(false);
  });

  it("a shown member reads now, whatever turn its snapshot is from", () => {
    const rows = armyRows(
      army([member({ unitId: "7", seenTurn: 68 })]),
      byId([aReportUnit({ unitId: "7" })]),
      71
    );

    expect(seenLabel(rows.seen.get("7"), 71)).toBe("now");
  });

  it("with no turn, a shown member keeps its snapshot's turn", () => {
    const rows = armyRows(
      army([member({ unitId: "7", seenTurn: 68 })]),
      byId([aReportUnit({ unitId: "7" })]),
      null
    );

    expect(rows.seen.get("7")).toBe(68);
    expect(seenLabel(rows.seen.get("7"), null)).toBe("now");
  });
});

describe("the count an Army prints", () => {
  it("counts only the members a report of this turn shows", () => {
    const members = army([member({ unitId: "1" }), member({ unitId: "7" }), member({ unitId: "9" })]);

    expect(shownMemberCount(members, byId([aReportUnit({ unitId: "1" })]))).toBe(1);
  });
});

describe("what the Seen column reads", () => {
  it("says now for a member this turn's report showed", () => {
    expect(seenLabel(71, 71)).toBe("now");
  });

  it("names the turn a remembered member was last seen on", () => {
    expect(seenLabel(68, 71)).toBe("turn 68");
  });

  it("says now when either turn is unknown", () => {
    expect(seenLabel(undefined, 71)).toBe("now");
    expect(seenLabel(68, null)).toBe("now");
  });
});
