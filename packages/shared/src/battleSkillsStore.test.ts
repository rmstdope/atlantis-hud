import type { CoreClient, ImportedTurnSummary, OpenedGame } from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetBattleSkillsStore,
  scanStoredTurns,
  useBattleSkillsStore
} from "./battleSkillsStore";

function game(gameId = "aug-2026"): OpenedGame {
  return {
    gameFilePath: "g.json",
    databasePath: "g.sqlite",
    schemaVersion: 9,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId, gameName: "Borg TNG", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-09T18:00:00Z"
    }
  } as OpenedGame;
}

function summary(factionId: string, turnNumber: number): ImportedTurnSummary {
  return {
    key: { gameId: "aug-2026", factionId, turnNumber },
    season: null,
    importedAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z"
  } as ImportedTurnSummary;
}

/** One roster entry for unit 4839, at whatever level the caller wants. */
function roster(level: number) {
  return [
    {
      unitId: "4839",
      unitName: "Watazka",
      coordinate: null,
      terrain: null,
      skills: [{ name: "combat", level }]
    }
  ];
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listImportedTurns: vi.fn().mockResolvedValue([]),
    loadImportedTurn: vi.fn().mockResolvedValue({ rawReport: "report", parseResult: {} }),
    rosterSkills: vi.fn().mockResolvedValue([]),
    ...overrides
  } as unknown as CoreClient;
}

beforeEach(() => {
  resetBattleSkillsStore();
});

describe("scanStoredTurns", () => {
  it("reads every stored turn of the game, whoever's report it is", async () => {
    const summaries = [summary("95", 70), summary("46", 71), summary("95", 71)];
    const rosterSkills = vi.fn().mockResolvedValue([]);
    const one = client({
      listImportedTurns: vi.fn().mockResolvedValue(summaries),
      rosterSkills
    });

    const result = await scanStoredTurns(one, game());

    expect(one.listImportedTurns).toHaveBeenCalledWith("g.sqlite", "aug-2026");
    expect(rosterSkills).toHaveBeenCalledTimes(3);
    expect(result.unreadTurns).toBe(0);
  });

  it("counts a turn it could not read and keeps the rest", async () => {
    const one = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("95", 70), summary("95", 71)]),
      loadImportedTurn: vi
        .fn()
        .mockRejectedValueOnce(new Error("no"))
        .mockResolvedValue({ rawReport: "report", parseResult: {} }),
      rosterSkills: vi.fn().mockResolvedValue(roster(5))
    });

    const result = await scanStoredTurns(one, game());

    expect(result.unreadTurns).toBe(1);
    expect(result.skills.get("4839")?.[0]?.level).toBe(5);
  });

  it("counts a turn whose record is missing", async () => {
    const one = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("95", 70)]),
      loadImportedTurn: vi.fn().mockResolvedValue(null)
    });

    const result = await scanStoredTurns(one, game());

    expect(result.unreadTurns).toBe(1);
    expect([...result.skills.keys()]).toEqual([]);
  });

  it("recovers nothing when the turns cannot be listed", async () => {
    const one = client({ listImportedTurns: vi.fn().mockRejectedValue(new Error("no storage")) });

    const result = await scanStoredTurns(one, game());

    expect([...result.skills.keys()]).toEqual([]);
    expect(result.unreadTurns).toBe(0);
  });
});

describe("useBattleSkillsStore", () => {
  it("holds what the scan recovered, and reports it ready", async () => {
    const one = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("95", 71)]),
      rosterSkills: vi.fn().mockResolvedValue(roster(3))
    });

    await useBattleSkillsStore.getState().scan(one, game());

    const state = useBattleSkillsStore.getState();
    expect(state.status).toBe("ready");
    expect(state.gameId).toBe("aug-2026");
    expect(state.skills.get("4839")?.[0]?.level).toBe(3);
  });

  it("reports ready even when the turns cannot be listed", async () => {
    const one = client({ listImportedTurns: vi.fn().mockRejectedValue(new Error("no storage")) });

    await expect(useBattleSkillsStore.getState().scan(one, game())).resolves.toBeUndefined();

    const state = useBattleSkillsStore.getState();
    expect(state.status).toBe("ready");
    expect([...state.skills.keys()]).toEqual([]);
    expect(state.unreadTurns).toBe(0);
  });

  it("a turn folded in during the scan survives the scan finishing", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("95", 68)]),
      loadImportedTurn: vi
        .fn()
        .mockImplementation(async () => held.then(() => ({ rawReport: "r", parseResult: {} }))),
      rosterSkills: vi.fn().mockResolvedValue(roster(1))
    });

    const scanning = useBattleSkillsStore.getState().scan(one, game());
    useBattleSkillsStore.getState().foldIn("aug-2026", roster(7), 71);
    release();
    await scanning;

    const held71 = useBattleSkillsStore.getState().skills.get("4839");
    expect(held71?.[0]?.level).toBe(7);
    expect(held71?.[0]?.turn).toBe(71);
  });

  it("ignores a fold for a game that is no longer open", async () => {
    await useBattleSkillsStore.getState().scan(client(), game("aug-2026"));

    useBattleSkillsStore.getState().foldIn("some-other-game", roster(9), 71);

    expect([...useBattleSkillsStore.getState().skills.keys()]).toEqual([]);
  });

  it("clear puts it back to nothing recovered", async () => {
    const one = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("95", 71)]),
      rosterSkills: vi.fn().mockResolvedValue(roster(3))
    });
    await useBattleSkillsStore.getState().scan(one, game());

    useBattleSkillsStore.getState().clear();

    const state = useBattleSkillsStore.getState();
    expect(state.gameId).toBeNull();
    expect(state.status).toBe("idle");
    expect([...state.skills.keys()]).toEqual([]);
    expect(state.unreadTurns).toBe(0);
  });
});
