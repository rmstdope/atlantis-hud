import type { CoreClient, OpenedGame, StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { keyOf, loadStudyPlans, planFor, remainingGoals, saveStudyPlans } from "./studyPlans";

function game(gameId = "aug-2026"): OpenedGame {
  return {
    gameFilePath: "g.json",
    databasePath: "g.sqlite",
    schemaVersion: 11,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId, gameName: "Borg TNG", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-09T18:00:00Z"
    }
  } as unknown as OpenedGame;
}

function plan(unitId = "1204", factionId = "21"): StudyPlanRecord {
  return {
    factionId,
    unitId,
    goals: [{ kind: "study" as const, skill: "FORC", targetLevel: 4 }],
    comment: "heading for Gate Lore",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listStudyPlans: vi.fn().mockResolvedValue([]),
    saveStudyPlans: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as CoreClient;
}

describe("loadStudyPlans", () => {
  it("asks the client for the open game's plans", async () => {
    const rows = [plan()];
    const core = client({ listStudyPlans: vi.fn().mockResolvedValue(rows) });

    expect(await loadStudyPlans(core, game())).toEqual(rows);
    expect(core.listStudyPlans).toHaveBeenCalledWith("g.sqlite", "aug-2026");
  });
});

describe("saveStudyPlans", () => {
  it("passes both lists through, scoped to the open game", async () => {
    const core = client();
    const rows = [plan()];
    const removed = [{ factionId: "21", unitId: "1205" }];

    await saveStudyPlans(core, game(), rows, removed);

    expect(core.saveStudyPlans).toHaveBeenCalledWith("g.sqlite", "aug-2026", rows, removed);
  });
});

describe("planFor", () => {
  it("finds the row for one mage", () => {
    const wanted = plan("1204");

    expect(planFor([plan("1200"), wanted], "21", "1204")).toEqual(wanted);
  });

  it("does not match another faction's unit of the same number", () => {
    expect(planFor([plan("1204", "22")], "21", "1204")).toBeNull();
  });

  it("answers null when no row is held for that mage", () => {
    expect(planFor([plan("1200")], "21", "1204")).toBeNull();
  });
});

describe("keyOf", () => {
  it("keeps the two key fields and nothing else", () => {
    expect(keyOf(plan("1204"))).toEqual({ factionId: "21", unitId: "1204" });
  });
});

describe("remainingGoals", () => {
  const levels = new Map([
    ["FORC", 4],
    ["PATT", 2]
  ]);

  it("is empty for an empty queue", () => {
    expect(remainingGoals([], levels)).toEqual([]);
  });

  it("drops a head goal the mage has already reached", () => {
    expect(
      remainingGoals(
        [
          { kind: "study" as const, skill: "FORC", targetLevel: 3 },
          { kind: "study" as const, skill: "PATT", targetLevel: 5 }
        ],
        levels
      )
    ).toEqual([{ kind: "study" as const, skill: "PATT", targetLevel: 5 }]);
  });

  it("drops every satisfied goal at the front, not only the first", () => {
    expect(
      remainingGoals(
        [
          { kind: "study" as const, skill: "FORC", targetLevel: 4 },
          { kind: "study" as const, skill: "PATT", targetLevel: 2 },
          { kind: "study" as const, skill: "SPIR", targetLevel: 1 }
        ],
        levels
      )
    ).toEqual([{ kind: "study" as const, skill: "SPIR", targetLevel: 1 }]);
  });

  it("stops at the first unsatisfied goal, even when a later one is satisfied", () => {
    const goals = [
      { kind: "study" as const, skill: "SPIR", targetLevel: 1 },
      { kind: "study" as const, skill: "FORC", targetLevel: 3 }
    ];

    expect(remainingGoals(goals, levels)).toEqual(goals);
  });

  it("never treats a one-month goal as satisfied", () => {
    const goals = [{ kind: "study" as const, skill: "FORC", targetLevel: null }];

    expect(remainingGoals(goals, levels)).toEqual(goals);
  });

  // `rules/teach`: a teach month is a month somebody decided to spend, so nothing anyone already
  // knows can satisfy it in advance.
  it("never treats a teach goal as satisfied in advance", () => {
    const goals: StudyGoal[] = [
      { kind: "teach", students: ["2517"] },
      { kind: "study", skill: "FORC", targetLevel: 1 }
    ];

    expect(remainingGoals(goals, levels)).toEqual(goals);
  });

  it("treats a skill the mage does not hold as level zero", () => {
    expect(remainingGoals([{ kind: "study" as const, skill: "SPIR", targetLevel: 1 }], levels)).toEqual([
      { kind: "study" as const, skill: "SPIR", targetLevel: 1 }
    ]);
  });
});
