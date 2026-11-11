import { describe, expect, it } from "vitest";
import { aReportUnit, type ArmyMemberRecord, type ArmyRecord } from "@atlantis/core-client";
import { snapshotOf } from "../armies";
import { NO_ASSISTANT_CHANGES, type AssistantChangesState } from "./assistantChanges";
import { sideOf, type ArmySide } from "./assistantArmies";
import {
  armyRevert,
  armySummary,
  assistantArmyViews,
  keepAssistantArmyChange,
  memberLine,
  recordAssistantArmyWrite,
  settleAssistantArmyChanges
} from "./assistantArmyChanges";

const NOW = "2026-11-11T09:00:00Z";

function member(unitId: string, name: string, men: number, faction?: { id: string | null; name: string | null }): ArmyMemberRecord {
  const unit = aReportUnit({
    unitId,
    name,
    men,
    own: faction === undefined,
    factionId: faction === undefined ? "19" : faction.id,
    factionName: faction === undefined ? "Borg" : faction.name
  });
  return snapshotOf(unit, 19, NOW);
}

const RIDERS = member("2301", "Riders", 12);
const ARCHERS = member("2302", "Archers", 8);
const SPEARS = member("2303", "Spears", 20);
const LONGBOWS = member("2310", "Longbows", 10);
const BORG = member("7076", "Borg", 1);

function anArmy(id: string, name: string, members: ArmyMemberRecord[]): ArmyRecord {
  return { id, gameId: "g", name, members, createdAt: NOW, updatedAt: NOW, madeByAssistant: true };
}

function side(name: string, members: ArmyMemberRecord[]): ArmySide {
  return { name, members };
}

function wrote(armyId: string, replaced: ArmySide | null, after: ArmySide, state: AssistantChangesState = NO_ASSISTANT_CHANGES) {
  return recordAssistantArmyWrite(state, { armyId, replaced, wrote: after });
}

describe("recordAssistantArmyWrite", () => {
  it("lists a new Army with no Before", () => {
    expect(wrote("a1", null, side("Raid", [BORG])).armies).toEqual([{ armyId: "a1", before: null, after: side("Raid", [BORG]) }]);
  });

  it("keeps several writes to one Army as one entry: first Before, latest After", () => {
    const once = wrote("a1", side("Raid", [RIDERS]), side("Raid", [RIDERS, ARCHERS]));
    const twice = wrote("a1", side("Raid", [RIDERS, ARCHERS]), side("Raid", [ARCHERS]), once);

    expect(twice.armies).toEqual([{ armyId: "a1", before: side("Raid", [RIDERS]), after: side("Raid", [ARCHERS]) }]);
  });

  it("takes the player's edit as Before when the assistant writes over it, so Revert never loses it", () => {
    const once = wrote("a1", null, side("Raid", [RIDERS, ARCHERS]));
    const edited = side("Raid", [RIDERS]);
    const again = wrote("a1", edited, side("Raid", [RIDERS, SPEARS]), once);

    expect(again.armies).toEqual([{ armyId: "a1", before: edited, after: side("Raid", [RIDERS, SPEARS]) }]);
  });

  it("takes an Army written back to Before off the list", () => {
    const once = wrote("a1", side("Raid", [RIDERS]), side("Raid", [RIDERS, ARCHERS]));

    expect(wrote("a1", side("Raid", [RIDERS, ARCHERS]), side("Raid", [RIDERS]), once).armies).toEqual([]);
  });

  it("opens the panel when the list goes from empty to something, and leaves a closed one closed otherwise", () => {
    const closedEmpty = { ...NO_ASSISTANT_CHANGES, open: false };
    const closedListed = { ...closedEmpty, changes: [{ unitId: "100", before: "", after: "work" }] };

    expect(wrote("a1", null, side("Raid", [BORG]), closedEmpty).open).toBe(true);
    expect(wrote("a1", null, side("Raid", [BORG]), closedListed).open).toBe(false);
  });
});

describe("keepAssistantArmyChange", () => {
  it("takes one Army off the list, and answers the same state for one not listed", () => {
    const listed = wrote("a1", null, side("Raid", [BORG]));

    expect(keepAssistantArmyChange(listed, "a1").armies).toEqual([]);
    expect(keepAssistantArmyChange(listed, "a2")).toBe(listed);
  });
});

describe("settleAssistantArmyChanges", () => {
  it("takes off an Army the player deleted and one edited back to Before, and keeps the rest", () => {
    let state = wrote("gone", null, side("Gone", [BORG]));
    state = wrote("back", side("Back", [RIDERS]), side("Back", [RIDERS, ARCHERS]), state);
    state = wrote("stays", side("Stays", [RIDERS]), side("Stays", [ARCHERS]), state);
    const armies = [anArmy("back", "Back", [RIDERS]), anArmy("stays", "Stays", [ARCHERS])];

    expect(settleAssistantArmyChanges(state, armies).armies.map((change) => change.armyId)).toEqual(["stays"]);
  });

  it("answers the same state when nothing settles", () => {
    const state = wrote("a1", null, side("Raid", [BORG]));

    expect(settleAssistantArmyChanges(state, [anArmy("a1", "Raid", [BORG])])).toBe(state);
  });
});

describe("armyRevert", () => {
  it("deletes a new Army still as the assistant left it", () => {
    const [change] = wrote("a1", null, side("Raid", [BORG])).armies;

    expect(armyRevert(change!, anArmy("a1", "Raid", [BORG]))).toEqual({ kind: "delete", armyId: "a1" });
  });

  it("puts a changed Army's members back as Before, keeping the newer snapshot of a member still in it", () => {
    const [change] = wrote("a1", side("Raid", [RIDERS, ARCHERS]), side("Raid", [RIDERS, LONGBOWS])).armies;
    const refreshedRiders = { ...RIDERS, men: 13, seenTurn: 20 };
    const current = anArmy("a1", "Raid", [refreshedRiders, LONGBOWS]);

    expect(armyRevert(change!, current)).toEqual({ kind: "save", army: { ...current, members: [refreshedRiders, ARCHERS] } });
  });

  it("does nothing to an Army the player has edited since, or deleted", () => {
    const [change] = wrote("a1", null, side("Raid", [BORG, RIDERS])).armies;

    expect(armyRevert(change!, anArmy("a1", "Raid", [BORG]))).toBeNull();
    expect(armyRevert(change!, anArmy("a1", "Renamed", [BORG, RIDERS]))).toBeNull();
    expect(armyRevert(change!, undefined)).toBeNull();
  });
});

describe("memberLine", () => {
  it("reads name, number and men, with another faction's name and number", () => {
    expect(memberLine(RIDERS)).toBe("Riders (2301) · 12 men");
    expect(memberLine(BORG)).toBe("Borg (7076) · 1 man");
    expect(memberLine(member("88", "City Guard", 120, { id: "1", name: "The Guardsmen" }))).toBe(
      "City Guard (88), The Guardsmen (1) · 120 men"
    );
  });

  it("leaves the faction out when the report concealed it", () => {
    expect(memberLine(member("77", "Spy", 1, { id: null, name: null }))).toBe("Spy (77) · 1 man");
  });
});

describe("armySummary", () => {
  it("says how many units a new Army has, and how a changed one's count moved", () => {
    expect(armySummary(null, side("Raid", Array.from({ length: 9 }, () => BORG)))).toBe("new army · 9 units");
    expect(armySummary(null, side("Raid", [BORG]))).toBe("new army · 1 unit");
    expect(armySummary(side("Raid", [RIDERS, ARCHERS, SPEARS, LONGBOWS, BORG, BORG]), side("Raid", [RIDERS, ARCHERS, SPEARS, LONGBOWS, BORG]))).toBe(
      "6 → 5 units"
    );
    expect(armySummary(side("Raid", [RIDERS, ARCHERS, SPEARS, LONGBOWS]), side("Raid", []))).toBe("4 → 0 units");
    expect(armySummary(side("Raid", [RIDERS, ARCHERS]), side("Raid", [RIDERS]))).toBe("2 → 1 unit");
  });
});

describe("assistantArmyViews", () => {
  it("lists every member of a new Army as added, against no army", () => {
    const state = wrote("a1", null, side("Raid", [BORG, RIDERS]));

    const [view] = assistantArmyViews(state, [anArmy("a1", "Raid", [BORG, RIDERS])]);

    expect(view).toEqual({
      armyId: "a1",
      name: "Raid",
      summary: "new army · 2 units",
      isNew: true,
      edited: false,
      beforeEmpty: true,
      afterEmpty: false,
      rows: [
        { before: null, after: "Borg (7076) · 1 man", changed: true },
        { before: null, after: "Riders (2301) · 12 men", changed: true }
      ]
    });
  });

  it("lists only the members that came or went of a changed Army, folding the rest into one line", () => {
    const state = wrote("a1", side("River raid", [RIDERS, ARCHERS, SPEARS, BORG]), side("River raid", [RIDERS, SPEARS, BORG, LONGBOWS]));

    const [view] = assistantArmyViews(state, [anArmy("a1", "River raid", [RIDERS, SPEARS, BORG, LONGBOWS])]);

    expect(view?.summary).toBe("4 → 4 units");
    expect(view?.rows).toEqual([
      { before: "Archers (2302) · 8 men", after: "Longbows (2310) · 10 men", changed: true },
      { before: "… 3 more unchanged", after: "… 3 more unchanged", changed: false }
    ]);
  });

  it("gives an emptied Army one row, its After side to be read as no units", () => {
    const state = wrote("a1", side("Raid", [RIDERS, ARCHERS]), side("Raid", []));

    const [view] = assistantArmyViews(state, [anArmy("a1", "Raid", [])]);

    expect(view).toMatchObject({ summary: "2 → 0 units", afterEmpty: true, beforeEmpty: false });
    expect(view?.rows).toEqual([
      { before: "Riders (2301) · 12 men", after: null, changed: true },
      { before: "Archers (2302) · 8 men", after: null, changed: true }
    ]);
  });

  it("marks an Army the player edited since, still showing what the assistant wrote", () => {
    const state = wrote("a1", null, side("Raid", [BORG, RIDERS]));

    const [view] = assistantArmyViews(state, [anArmy("a1", "Raid", [BORG])]);

    expect(view).toMatchObject({ edited: true, summary: "new army · 2 units" });
    expect(view?.rows.map((row) => row.after)).toEqual(["Borg (7076) · 1 man", "Riders (2301) · 12 men"]);
  });

  it("names an Army as it is called now, sorts by that name, and leaves out one deleted or back to Before", () => {
    let state = wrote("b", null, side("Beta", [BORG]));
    state = wrote("a", null, side("Zulu", [BORG]), state);
    state = wrote("gone", null, side("Gone", [BORG]), state);
    state = wrote("back", side("Back", [RIDERS]), side("Back", [RIDERS, ARCHERS]), state);
    const armies = [anArmy("b", "Beta", [BORG]), anArmy("a", "Alpha", [BORG]), anArmy("back", "Back", [RIDERS])];

    expect(assistantArmyViews(state, armies).map((view) => [view.armyId, view.name, view.edited])).toEqual([
      ["a", "Alpha", true],
      ["b", "Beta", false]
    ]);
  });
});
