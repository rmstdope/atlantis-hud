import type { CoreClient, OpenedGame, StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  keyOf,
  loadStudyPlans,
  planFor,
  plannedGoals,
  saveStudyPlans
} from "./studyPlans";

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
    goals: [{ kind: "study" as const, turn: 24, skill: "FORC" }],
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

describe("plannedGoals", () => {
  const study = (turn: number, skill: string): StudyGoal => ({ kind: "study", turn, skill });

  it("drops a goal with no turn", () => {
    const goals = [{ kind: "study", skill: "FORC" } as unknown as StudyGoal, study(25, "PATT")];
    expect(plannedGoals(goals)).toEqual([study(25, "PATT")]);
  });

  it("drops a goal whose turn is zero, negative or fractional", () => {
    expect(plannedGoals([study(0, "A"), study(-3, "B"), study(2.5, "C"), study(25, "D")])).toEqual([
      study(25, "D")
    ]);
  });

  it("sorts ascending by turn", () => {
    expect(plannedGoals([study(27, "C"), study(25, "A"), study(26, "B")])).toEqual([
      study(25, "A"),
      study(26, "B"),
      study(27, "C")
    ]);
  });

  it("keeps the last of two entries naming one turn", () => {
    expect(plannedGoals([study(25, "FIRST"), study(25, "LAST")])).toEqual([study(25, "LAST")]);
  });

  it("leaves a good list alone", () => {
    const goals = [study(25, "FORC"), study(26, "PATT")];
    expect(plannedGoals(goals)).toEqual(goals);
  });
});
