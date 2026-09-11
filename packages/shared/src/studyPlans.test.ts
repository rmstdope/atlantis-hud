import type { CoreClient, OpenedGame, StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  keyOf,
  loadStudyPlans,
  planFor,
  plannedGoals,
  reshapeStudyGoals,
  saveStudyPlans,
  type ScheduleChange
} from "./studyPlans";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { readTridentRuleset } from "@atlantis/fixtures";

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
  it("drops only unlearnable study goals when a tree is supplied", () => {
    const tree = buildMagicTree(parseGameData(readTridentRuleset()) as GameDataIndex);
    const goals = [
      { kind: "study", turn: 25, skill: "CPIR" } as StudyGoal,
      { kind: "teach", turn: 26, students: ["1205"], live: false } as StudyGoal,
      { kind: "study", turn: 27, skill: "FORC" } as StudyGoal
    ];

    expect(plannedGoals(goals, tree)).toEqual([
      goals[1],
      goals[2]
    ]);
  });

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

describe("reshapeStudyGoals", () => {
  const study = (turn: number, skill: string): StudyGoal => ({ kind: "study", turn, skill });
  const teach = (turn: number, student: string): StudyGoal => ({
    kind: "teach",
    turn,
    students: [student],
    live: true
  });
  const change = (kind: "insert" | "remove", turn: number): ScheduleChange => ({ kind, turn });

  it("inserts an empty turn by moving the target and every later goal one turn later", () => {
    expect(
      reshapeStudyGoals([study(25, "FORC"), study(26, "PATT"), study(27, "FORC")], change("insert", 26))
    ).toEqual([study(25, "FORC"), study(27, "PATT"), study(28, "FORC")]);
  });

  it("removes the target turn and moves every later goal one turn earlier", () => {
    expect(
      reshapeStudyGoals([study(25, "FORC"), study(26, "PATT"), study(27, "FORC")], change("remove", 26))
    ).toEqual([study(25, "FORC"), study(26, "FORC")]);
  });

  it("leaves every goal before the target alone", () => {
    expect(
      reshapeStudyGoals([study(25, "FORC"), study(26, "PATT")], change("insert", 27))
    ).toEqual([study(25, "FORC"), study(26, "PATT")]);
    expect(
      reshapeStudyGoals([study(25, "FORC"), study(26, "PATT")], change("remove", 27))
    ).toEqual([study(25, "FORC"), study(26, "PATT")]);
  });

  it("keeps goal payloads across both directions", () => {
    const goals = [teach(25, "1205"), study(26, "PATT")];
    expect(reshapeStudyGoals(goals, change("insert", 25))).toEqual([
      teach(26, "1205"),
      study(27, "PATT")
    ]);
    expect(reshapeStudyGoals(goals, change("remove", 26))).toEqual([teach(25, "1205")]);
  });

  it("drops an unlearnable study while reshaping a legacy plan", () => {
    const tree = buildMagicTree(parseGameData(readTridentRuleset()) as GameDataIndex);
    const goals = [
      study(25, "CPIR"),
      teach(26, "1205"),
      study(27, "FORC")
    ];

    expect(reshapeStudyGoals(goals, change("insert", 25), tree)).toEqual([
      teach(27, "1205"),
      study(28, "FORC")
    ]);
  });

  it("shifts the rightmost goal to an off-horizon turn on insert rather than dropping it", () => {
    // The schedule shows six turns; a goal pushed past them must survive so the report's
    // advancing turn brings it back.
    expect(reshapeStudyGoals([study(30, "FORC")], change("insert", 30))).toEqual([study(31, "FORC")]);
  });

  it("drops a goal whose turn is not a positive whole number, through plannedGoals", () => {
    expect(
      reshapeStudyGoals(
        [{ kind: "study", skill: "FORC" } as unknown as StudyGoal, study(25, "PATT")],
        change("remove", 30)
      )
    ).toEqual([study(25, "PATT")]);
  });

  it("sanitizes the result: ascending, one goal per turn, invalid turns gone", () => {
    // A hand-edited row with two entries naming one turn reads as its last entry before reshaping.
    expect(
      reshapeStudyGoals([study(27, "C"), study(25, "A"), study(26, "B")], change("insert", 25))
    ).toEqual([study(26, "A"), study(27, "B"), study(28, "C")]);
  });

  it("answers an empty list for an empty plan", () => {
    expect(reshapeStudyGoals([], change("insert", 25))).toEqual([]);
    expect(reshapeStudyGoals([], change("remove", 25))).toEqual([]);
  });
});
