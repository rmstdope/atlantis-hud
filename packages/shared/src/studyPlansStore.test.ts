import type { CoreClient, OpenedGame, StudyPlanRecord } from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStudyPlansStore, useStudyPlansStore } from "./studyPlansStore";

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

function plan(unitId = "1204", skill: string | null = "FORC"): StudyPlanRecord {
  return {
    factionId: "21",
    unitId,
    goals: skill ? [{ kind: "study" as const, turn: 24, skill }] : [],
    comment: "",
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

beforeEach(() => {
  resetStudyPlansStore();
});

describe("load", () => {
  it("holds the game's plans, and says it is ready", async () => {
    const plans = [plan()];
    const core = client({ listStudyPlans: vi.fn().mockResolvedValue(plans) });

    await useStudyPlansStore.getState().load(core, game());

    expect(useStudyPlansStore.getState()).toMatchObject({
      gameId: "aug-2026",
      status: "ready",
      plans
    });
  });

  it("says error and holds nothing when the client fails", async () => {
    const core = client({ listStudyPlans: vi.fn().mockRejectedValue(new Error("no")) });

    await useStudyPlansStore.getState().load(core, game());

    expect(useStudyPlansStore.getState()).toMatchObject({ status: "error", plans: [] });
  });

  it("discards a late result for a game that is no longer open", async () => {
    let settle: (rows: StudyPlanRecord[]) => void = () => {};
    const core = client({
      listStudyPlans: vi.fn().mockReturnValue(
        new Promise<StudyPlanRecord[]>((resolve) => {
          settle = resolve;
        })
      )
    });
    const pending = useStudyPlansStore.getState().load(core, game("old-game"));
    await useStudyPlansStore.getState().load(client(), game("new-game"));

    settle([plan()]);
    await pending;

    expect(useStudyPlansStore.getState()).toMatchObject({ gameId: "new-game", plans: [] });
  });
});

describe("save", () => {
  it("writes before touching the cache", async () => {
    const seen: string[] = [];
    const core = client({
      saveStudyPlans: vi.fn().mockImplementation(async () => {
        seen.push(`cache held ${useStudyPlansStore.getState().plans.length}`);
      })
    });

    await useStudyPlansStore.getState().save(core, game(), plan());

    expect(seen).toEqual(["cache held 0"]);
    expect(useStudyPlansStore.getState().plans).toEqual([plan()]);
  });

  it("leaves the cache alone and rethrows when the write fails", async () => {
    const core = client({ saveStudyPlans: vi.fn().mockRejectedValue(new Error("no")) });

    await expect(useStudyPlansStore.getState().save(core, game(), plan())).rejects.toThrow("no");

    expect(useStudyPlansStore.getState().plans).toEqual([]);
  });

  it("replaces the row held for the same mage rather than adding a second", async () => {
    const core = client();
    await useStudyPlansStore.getState().save(core, game(), plan("1204", "FORC"));

    await useStudyPlansStore.getState().save(core, game(), plan("1204", "PATT"));

    expect(useStudyPlansStore.getState().plans).toEqual([plan("1204", "PATT")]);
  });

  it("keeps the cache in the order the pane renders", async () => {
    const core = client();

    await useStudyPlansStore.getState().save(core, game(), plan("9"));
    await useStudyPlansStore.getState().save(core, game(), plan("10"));

    expect(useStudyPlansStore.getState().plans.map((one) => one.unitId)).toEqual(["10", "9"]);
  });
});

describe("remove", () => {
  it("drops the named rows, and only those", async () => {
    const core = client();
    await useStudyPlansStore.getState().save(core, game(), plan("1204"));
    await useStudyPlansStore.getState().save(core, game(), plan("1205"));

    await useStudyPlansStore
      .getState()
      .remove(core, game(), [{ factionId: "21", unitId: "1204" }]);

    expect(useStudyPlansStore.getState().plans).toEqual([plan("1205")]);
  });

  it("rethrows and keeps the cache when the write fails", async () => {
    const core = client();
    await useStudyPlansStore.getState().save(core, game(), plan("1204"));
    const failing = client({ saveStudyPlans: vi.fn().mockRejectedValue(new Error("no")) });

    await expect(
      useStudyPlansStore.getState().remove(failing, game(), [{ factionId: "21", unitId: "1204" }])
    ).rejects.toThrow("no");

    expect(useStudyPlansStore.getState().plans).toEqual([plan("1204")]);
  });
});

describe("clear", () => {
  it("empties everything", async () => {
    await useStudyPlansStore.getState().load(client(), game());

    useStudyPlansStore.getState().clear();

    expect(useStudyPlansStore.getState()).toMatchObject({
      gameId: null,
      status: "idle",
      plans: []
    });
  });
});
