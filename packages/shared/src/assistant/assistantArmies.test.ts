import { describe, expect, it } from "vitest";
import { aReportUnit, type ArmyRecord, type ReportUnit } from "@atlantis/core-client";
import { snapshotOf } from "../armies";
import { changeAssistantArmy, createAssistantArmy, sameSide, sideOf } from "./assistantArmies";

const NOW = "2026-11-11T09:00:00Z";
const LATER = "2026-11-11T10:00:00Z";
const TURN = 19;

const BORG = aReportUnit({ unitId: "7076", name: "Borg", own: true, men: 1 });
const RECRUITS = aReportUnit({ unitId: "2101", name: "Recruits", own: true, men: 29 });
const GUARD = aReportUnit({ unitId: "88", name: "City Guard", own: false, factionId: "1", factionName: "The Guardsmen", men: 120 });
const UNITS: ReadonlyMap<string, ReportUnit> = new Map([BORG, RECRUITS, GUARD].map((unit) => [unit.unitId, unit]));

function anArmy(overrides: Partial<ArmyRecord> = {}): ArmyRecord {
  return {
    id: "army-1",
    gameId: "g",
    name: "Home guard",
    members: [snapshotOf(BORG, TURN, NOW)],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("createAssistantArmy", () => {
  const create = (name: string, unitIds: readonly string[], armies: readonly ArmyRecord[] = []) =>
    createAssistantArmy({ armies, gameId: "g", name, unitIds, units: UNITS, turn: TURN, now: NOW });

  it("makes a named Army of the units named, own and foreign, marked as the assistant's", () => {
    const army = create("  Ibizzibith assault ", ["7076", "88"]);

    expect(army).toMatchObject({ gameId: "g", name: "Ibizzibith assault", madeByAssistant: true, createdAt: NOW });
    expect(army.members).toEqual([snapshotOf(BORG, TURN, NOW), snapshotOf(GUARD, TURN, NOW)]);
    expect(army.id).not.toBe("");
  });

  it("refuses a name another Army already has, whatever its case or spacing", () => {
    expect(() => create(" home GUARD", ["7076"], [anArmy()])).toThrow(/"Home guard" is already an Army's name/u);
  });

  it("refuses an empty name", () => {
    expect(() => create("  ", ["7076"])).toThrow(/needs a name/u);
  });

  it("refuses a unit this turn's report does not show, naming it", () => {
    expect(() => create("Raid", ["7076", "999"])).toThrow(/no unit 999/u);
  });

  it("refuses an empty unit list and a unit named twice", () => {
    expect(() => create("Raid", [])).toThrow(/at least one unit/u);
    expect(() => create("Raid", ["7076", "7076"])).toThrow(/7076 is named twice/u);
  });
});

describe("changeAssistantArmy", () => {
  const mine = anArmy({ name: "Assault", madeByAssistant: true });
  const change = (army: ArmyRecord, edit: { add?: readonly string[]; remove?: readonly string[] }) =>
    changeAssistantArmy({ army, add: edit.add ?? [], remove: edit.remove ?? [], units: UNITS, turn: TURN, now: LATER });

  it("adds and removes members of an Army the assistant made", () => {
    const changed = change(mine, { add: ["2101"], remove: ["7076"] });

    expect(changed.members).toEqual([snapshotOf(RECRUITS, TURN, LATER)]);
    expect(changed).toMatchObject({ id: "army-1", name: "Assault", madeByAssistant: true, updatedAt: LATER });
  });

  it("refuses an Army the player built", () => {
    expect(() => change(anArmy(), { add: ["2101"] })).toThrow(/the player built/u);
    expect(() => change(anArmy({ madeByAssistant: false }), { add: ["2101"] })).toThrow(/the player built/u);
  });

  it("refuses to add a unit the report does not show, and to remove one that is not a member", () => {
    expect(() => change(mine, { add: ["999"] })).toThrow(/no unit 999/u);
    expect(() => change(mine, { remove: ["2101"] })).toThrow(/2101 is not in "Assault"/u);
  });

  it("refuses to add a unit the Army already holds, rather than answering a change that changed nothing", () => {
    expect(() => change(mine, { add: ["7076"] })).toThrow(/7076 is already in "Assault"/u);
  });

  it("removes a member the report no longer shows", () => {
    const gone = { ...snapshotOf(BORG, TURN - 2, NOW), unitId: "555" };

    expect(change({ ...mine, members: [...mine.members, gone] }, { remove: ["555"] }).members).toEqual(mine.members);
  });

  it("refuses a change that names nothing, or names a unit on both sides", () => {
    expect(() => change(mine, {})).toThrow(/add or remove/u);
    expect(() => change(mine, { add: ["2101"], remove: ["2101"] })).toThrow(/2101 is named to add and to remove/u);
  });
});

describe("sameSide", () => {
  it("compares the name and the set of unit numbers, not the snapshots", () => {
    const army = anArmy({ members: [snapshotOf(BORG, TURN, NOW), snapshotOf(RECRUITS, TURN, NOW)] });
    const refreshed = { ...army, members: [snapshotOf(RECRUITS, TURN + 1, LATER), snapshotOf(BORG, TURN + 1, LATER)] };

    expect(sameSide(sideOf(army), sideOf(refreshed))).toBe(true);
    expect(sameSide(sideOf(army), sideOf({ ...army, name: "Other" }))).toBe(false);
    expect(sameSide(sideOf(army), sideOf({ ...army, members: army.members.slice(1) }))).toBe(false);
    expect(sameSide(null, null)).toBe(true);
    expect(sameSide(null, sideOf(army))).toBe(false);
  });
});
