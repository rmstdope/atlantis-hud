import {
  aReportUnit,
  type AlliedMageRecord,
  type CoreClient,
  type OpenedGame
} from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlliedMagesStore, useAlliedMagesStore } from "./alliedMagesStore";

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
  } as unknown as OpenedGame;
}

function row(unitId = "1204"): AlliedMageRecord {
  return {
    factionId: "21",
    factionName: "Borg",
    unit: aReportUnit({ unitId, own: false }),
    sheetTurn: 23,
    receivedAt: "2026-01-01T00:00:00.000Z"
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listAlliedMages: vi.fn().mockResolvedValue([]),
    saveAlliedMages: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as CoreClient;
}

beforeEach(() => {
  resetAlliedMagesStore();
});

describe("load", () => {
  it("holds the game's mages, and says it is ready", async () => {
    const mages = [row()];
    const core = client({ listAlliedMages: vi.fn().mockResolvedValue(mages) });

    await useAlliedMagesStore.getState().load(core, game());

    expect(useAlliedMagesStore.getState()).toMatchObject({
      gameId: "aug-2026",
      status: "ready",
      mages
    });
    expect(core.listAlliedMages).toHaveBeenCalledWith("g.sqlite", "aug-2026");
  });

  it("holds nothing and says so when the read fails", async () => {
    const core = client({ listAlliedMages: vi.fn().mockRejectedValue(new Error("no")) });

    await useAlliedMagesStore.getState().load(core, game());

    expect(useAlliedMagesStore.getState()).toMatchObject({ status: "error", mages: [] });
  });

  it("drops a late result for a game that is no longer open", async () => {
    const core = client({ listAlliedMages: vi.fn().mockResolvedValue([row()]) });
    const pending = useAlliedMagesStore.getState().load(core, game("old-game"));
    useAlliedMagesStore.setState({ gameId: "new-game" });

    await pending;

    expect(useAlliedMagesStore.getState().mages).toEqual([]);
  });
});

describe("takeIn", () => {
  it("writes the sheet before it caches it", async () => {
    const rows = [row()];
    const order: string[] = [];
    const core = client({
      saveAlliedMages: vi.fn().mockImplementation(async () => {
        order.push("write");
        expect(useAlliedMagesStore.getState().mages).toEqual([]);
      })
    });

    await useAlliedMagesStore.getState().takeIn(core, game(), rows);

    expect(order).toEqual(["write"]);
    expect(useAlliedMagesStore.getState().mages).toEqual(rows);
    expect(core.saveAlliedMages).toHaveBeenCalledWith("g.sqlite", "aug-2026", rows, []);
  });

  it("replaces a mage the sheet carries again and keeps the ones it leaves out", async () => {
    // Leaving them out is not discarding them: what becomes of them is the player's answer to the
    // missing-mages question, which `discard` carries out.
    const older = { ...row("1301"), sheetTurn: 21 };
    useAlliedMagesStore.setState({ mages: [row("1204"), older] });

    await useAlliedMagesStore.getState().takeIn(client(), game(), [row("1301")]);

    const mages = useAlliedMagesStore.getState().mages;
    expect(mages.map((one) => one.unit.unitId).sort()).toEqual(["1204", "1301"]);
    expect(mages.find((one) => one.unit.unitId === "1301")?.sheetTurn).toBe(23);
  });

  it("rethrows a failed write and leaves the cache alone", async () => {
    const core = client({ saveAlliedMages: vi.fn().mockRejectedValue(new Error("full")) });

    await expect(useAlliedMagesStore.getState().takeIn(core, game(), [row()])).rejects.toThrow(
      "full"
    );
    expect(useAlliedMagesStore.getState().mages).toEqual([]);
  });
});

describe("discard", () => {
  it("drops exactly the named mages", async () => {
    const core = client();
    useAlliedMagesStore.setState({ mages: [row("1204"), row("1301")] });

    await useAlliedMagesStore
      .getState()
      .discard(core, game(), [{ factionId: "21", unitId: "1204" }]);

    expect(useAlliedMagesStore.getState().mages.map((one) => one.unit.unitId)).toEqual(["1301"]);
    expect(core.saveAlliedMages).toHaveBeenCalledWith("g.sqlite", "aug-2026", [], [
      { factionId: "21", unitId: "1204" }
    ]);
  });

  it("rethrows a failed write and leaves the cache alone", async () => {
    const core = client({ saveAlliedMages: vi.fn().mockRejectedValue(new Error("full")) });
    useAlliedMagesStore.setState({ mages: [row("1204")] });

    await expect(
      useAlliedMagesStore.getState().discard(core, game(), [{ factionId: "21", unitId: "1204" }])
    ).rejects.toThrow("full");
    expect(useAlliedMagesStore.getState().mages).toHaveLength(1);
  });
});

describe("clear", () => {
  it("forgets the game", () => {
    useAlliedMagesStore.setState({ gameId: "aug-2026", status: "ready", mages: [row()] });

    useAlliedMagesStore.getState().clear();

    expect(useAlliedMagesStore.getState()).toMatchObject({
      gameId: null,
      status: "idle",
      mages: []
    });
  });
});
