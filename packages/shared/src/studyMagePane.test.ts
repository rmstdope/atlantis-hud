import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { magePane } from "./studyMagePane";
import { scheduleRows, scheduleTurns, type ScheduleRow } from "./studySchedule";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);
const turns = scheduleTurns(23);

function groups(skills = [{ tag: "FORC", level: 3, points: 270 }]) {
  return [
    {
      factionId: "21",
      factionLabel: "Wardens of the North (12)",
      source: "sheet" as const,
      heading: "Wardens of the North (12) — turn 20",
      stale: false,
      mages: [
        {
          key: "21/2431",
          factionId: "21",
          factionLabel: "Wardens of the North (12)",
          unitId: "2431",
          name: "Ereb",
          regionId: "1:7,53",
          sheetTurn: null,
          monthsUnreported: 0,
          skills
        }
      ]
    }
  ] as unknown as Parameters<typeof scheduleRows>[0]["groups"];
}

/** Ereb, studying force on every one of the six turns. */
function row(skills?: { tag: string; level: number; points: number }[]): ScheduleRow {
  return scheduleRows({
    groups: groups(skills),
    plans: [
      {
        factionId: "21",
        unitId: "2431",
        goals: turns.map((turn) => ({ kind: "study" as const, turn, skill: "FORC" })),
        comment: "",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    tree,
    turns,
    seats: new Map([["1:7,53/1", 1]])
  })[0];
}

function pane(turnIndex: number | null, skills?: { tag: string; level: number; points: number }[]) {
  return magePane({
    row: row(skills),
    turnIndex,
    turns,
    tree,
    factionLabel: "Wardens of the North (12)"
  });
}

describe("magePane on a turn", () => {
  it("names the mage, the turn he is being read at, and what he studies then", () => {
    const shown = pane(2);

    expect(shown.heading).toBe("Ereb (2431) — turn 26");
    expect(shown.sub).toBe("Wardens of the North (12) · studying force");
    expect(shown.knows.find((line) => line.name === "force")?.studying).toBe(true);
  });

  it("says where each skill stands at that turn, as the card it replaces did", () => {
    expect(pane(1).knows.find((line) => line.name === "force")?.right).toBe(
      "4 → 4  (330 of 450)"
    );
  });

  it("lists what he could study then, and counts them", () => {
    const shown = pane(2);

    expect(shown.canStudyHeading).toBe(`Can study on turn 26 — ${shown.canStudy.length}`);
    expect(shown.canStudy.length).toBeGreaterThan(0);
    // Level arrows alone: the points a month buys are the dropdown's business, and this pane is
    // read while deciding which cell to open.
    expect(shown.canStudy.find((choice) => choice.skill === "FORC")?.detail).toBe("4 → 4");
    expect(shown.canStudy.find((choice) => choice.skill === "PATT")?.detail).toBe("0 → 1");
  });

  it("offers nothing it would be pointless to offer", () => {
    // Every magic skill at its maximum: there is nothing left to study, and the pane says so
    // rather than showing an empty list under a count of zero.
    const maxed = [...tree.byTag].map(([tag, node]) => ({
      tag,
      level: node.maxLevel,
      points: 9999
    }));
    const shown = pane(2, maxed);

    expect(shown.canStudy).toEqual([]);
    expect(shown.canStudyHeading).toBe("Nothing he can study on turn 26.");
  });

  it("says where its figures come from", () => {
    expect(pane(2).foot).toBe("Projected from turn 23's report at 30 points a studied month.");
  });
});

describe("magePane on the mage himself", () => {
  it("reads him as he stands now, with no month applied", () => {
    const shown = pane(null);

    expect(shown.heading).toBe("Ereb (2431) — now");
    expect(shown.sub).toBe("Wardens of the North (12)");
    // No arrow: nothing has happened yet, so there is no before and after to put one between.
    expect(shown.knows.find((line) => line.name === "force")?.right).toBe("3  (270 of 300)");
    expect(shown.knows.every((line) => !line.studying)).toBe(true);
  });

  it("lists what he could study today", () => {
    const shown = pane(null);

    expect(shown.canStudyHeading).toBe(`Can study now — ${shown.canStudy.length}`);
    expect(shown.canStudy.find((choice) => choice.skill === "FORC")?.detail).toBe("3 → 4");
  });

  it("names the report the figures are his from", () => {
    expect(pane(null).foot).toBe("From turn 23's report.");
  });
});
