import { aReportUnit, type ArmyMemberRecord, type ArmyRecord, type ReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { armyRows, seenLabel, staleLine } from "./armyRows";

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

  it("a member the report does not show is rebuilt from its snapshot, with no structure and no weight", () => {
    const { rows } = armyRows(
      army([member({ unitId: "7", name: "Outriders", men: 12, regionId: "1:9,55" })]),
      byId([]),
      71
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      unitId: "7",
      name: "Outriders",
      men: 12,
      regionId: "1:9,55",
      structureId: null,
      weight: null,
      capacity: null,
      menByRace: []
    });
    // A figure from three turns ago is exactly an estimate.
    expect(rows[0].menEstimated).toBe(true);
  });

  it("a rebuilt row keeps the guard the snapshot's flags recorded", () => {
    const { rows } = armyRows(army([member({ unitId: "7", flags: ["on guard"] })]), byId([]), 71);

    expect(rows[0].onGuard).toBe(true);
  });

  it("missing counts only the members the report does not show", () => {
    const live = aReportUnit({ unitId: "1" });

    const rows = armyRows(
      army([member({ unitId: "1" }), member({ unitId: "7" }), member({ unitId: "9" })]),
      byId([live]),
      71
    );

    expect(rows.missing).toBe(2);
    expect(rows.rows).toHaveLength(3);
  });

  it("carries each member's seen turn beside the rows", () => {
    const rows = armyRows(
      army([member({ unitId: "1", seenTurn: 71 }), member({ unitId: "7", seenTurn: 68 })]),
      byId([aReportUnit({ unitId: "1" })]),
      71
    );

    expect(rows.seen.get("1")).toBe(71);
    expect(rows.seen.get("7")).toBe(68);
  });

  it("every member reads now when the report names no turn", () => {
    const rows = armyRows(army([member({ unitId: "7", seenTurn: 68 })]), byId([]), null);

    // With no turn to compare against, calling a member stale would be a guess.
    expect(rows.missing).toBe(0);
    expect(seenLabel(rows.seen.get("7"), null)).toBe("now");
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

describe("the standing line above the table", () => {
  it("staleLine is singular for one member and null for none", () => {
    expect(staleLine(0)).toBeNull();
    expect(staleLine(1)).toEqual({
      text: "1 unit was not in this turn's report.",
      button: "Remove it"
    });
  });

  it("staleLine is plural for several", () => {
    expect(staleLine(2)).toEqual({
      text: "2 units were not in this turn's report.",
      button: "Remove them"
    });
  });
});
