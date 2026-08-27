import {
  aParsedReport,
  aReportRegion,
  aReportUnit,
  type ArmyRecord,
  type CoreClient,
  type OpenedGame
} from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetArmiesStore, useArmiesStore } from "./armiesStore";

function game(overrides: Partial<OpenedGame> = {}): OpenedGame {
  return {
    gameFilePath: "g.json",
    databasePath: "g.sqlite",
    schemaVersion: 9,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-09T18:00:00Z"
    },
    ...overrides
  } as OpenedGame;
}

function army(overrides: Partial<ArmyRecord> = {}): ArmyRecord {
  return {
    id: "army-1",
    gameId: "aug-2026",
    name: "Escort",
    members: [],
    createdAt: "2026-08-09T18:00:00Z",
    updatedAt: "2026-08-09T18:00:00Z",
    ...overrides
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listArmies: vi.fn().mockResolvedValue([]),
    saveArmy: vi.fn().mockImplementation((_db, one) => Promise.resolve(one)),
    deleteArmy: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as CoreClient;
}

function aMember(overrides: Partial<ArmyRecord["members"][number]> = {}): ArmyRecord["members"][number] {
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
    men: 1,
    seenTurn: 71,
    seenAt: "2026-08-01T09:00:00Z",
    ...overrides
  };
}

const NOW = "2026-08-09T18:30:00Z";

describe("the Armies store", () => {
  beforeEach(resetArmiesStore);

  describe("load", () => {
    it("puts the client's Armies in name order and ready", async () => {
      const c = client({
        listArmies: vi.fn().mockResolvedValue([army({ id: "z", name: "Vanguard" }), army({ id: "a", name: "Anvil" })])
      });

      await useArmiesStore.getState().load(c, game());

      const state = useArmiesStore.getState();
      expect(state.status).toBe("ready");
      expect(state.armies.map((one) => one.id)).toEqual(["a", "z"]);
      expect(state.gameId).toBe("aug-2026");
    });

    it("a load that finishes after the game changed is discarded", async () => {
      let release: (armies: ArmyRecord[]) => void = () => undefined;
      const c = client({
        listArmies: vi.fn().mockReturnValue(new Promise<ArmyRecord[]>((resolve) => (release = resolve)))
      });

      const loading = useArmiesStore.getState().load(c, game());
      useArmiesStore.setState({ gameId: "another-game" });
      release([army({ id: "late" })]);
      await loading;

      expect(useArmiesStore.getState().armies).toEqual([]);
      expect(useArmiesStore.getState().gameId).toBe("another-game");
    });

    it("goes to error with an empty list when the client rejects", async () => {
      const c = client({ listArmies: vi.fn().mockRejectedValue(new Error("no")) });

      await useArmiesStore.getState().load(c, game());

      expect(useArmiesStore.getState().status).toBe("error");
      expect(useArmiesStore.getState().armies).toEqual([]);
    });
  });

  describe("create", () => {
    it("puts the Army in the list before the save resolves, and takes it out again when the save fails", async () => {
      let reject: (error: Error) => void = () => undefined;
      const c = client({
        saveArmy: vi.fn().mockReturnValue(new Promise((_resolve, r) => (reject = r)))
      });

      const creating = useArmiesStore.getState().create(c, game(), "Escort", NOW);
      expect(useArmiesStore.getState().armies.map((one) => one.name)).toEqual(["Escort"]);

      reject(new Error("disk full"));
      await expect(creating).rejects.toThrow("disk full");
      expect(useArmiesStore.getState().armies).toEqual([]);
    });
  });

  describe("rename, remove, addUnit and removeUnit", () => {
    it("renames optimistically and puts the old name back when the save fails", async () => {
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [army()] });
      const c = client({ saveArmy: vi.fn().mockRejectedValue(new Error("no")) });

      await expect(useArmiesStore.getState().rename(c, game(), "army-1", "Vanguard", NOW)).rejects.toThrow();

      expect(useArmiesStore.getState().armies[0].name).toBe("Escort");
    });

    it("removes optimistically and puts the Army back when the delete fails", async () => {
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [army()] });
      const c = client({ deleteArmy: vi.fn().mockRejectedValue(new Error("no")) });

      await expect(useArmiesStore.getState().remove(c, game(), "army-1")).rejects.toThrow();

      expect(useArmiesStore.getState().armies.map((one) => one.id)).toEqual(["army-1"]);
    });

    it("adds and removes a unit, saving each time", async () => {
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [army()] });
      const c = client();

      await useArmiesStore.getState().addUnit(c, game(), "army-1", aReportUnit({ unitId: "204" }), 71, NOW);
      expect(useArmiesStore.getState().armies[0].members.map((m) => m.unitId)).toEqual(["204"]);

      await useArmiesStore.getState().removeUnit(c, game(), "army-1", "204", NOW);
      expect(useArmiesStore.getState().armies[0].members).toEqual([]);
      expect(c.saveArmy).toHaveBeenCalledTimes(2);
    });
  });

  describe("refreshFor", () => {
    const parsedWith = (units: ReturnType<typeof aReportUnit>[], turnNumber: number | null = 72) =>
      aParsedReport({
        header: { ...aParsedReport().header, turnNumber },
        regions: [aReportRegion({ units })]
      });

    it("saves only the Armies whose members actually changed", async () => {
      const moved = army({ id: "moved", name: "Moved", members: [aMember({ men: 1, seenTurn: 71 })] });
      const untouched = army({ id: "untouched", name: "Untouched", members: [] });
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [moved, untouched] });
      const c = client();

      await useArmiesStore
        .getState()
        .refreshFor(c, game(), parsedWith([aReportUnit({ unitId: "1", men: 9 })]), NOW);

      expect(c.saveArmy).toHaveBeenCalledTimes(1);
      expect((c.saveArmy as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ id: "moved" });
      expect(useArmiesStore.getState().armies.find((one) => one.id === "moved")?.members[0]).toMatchObject({
        men: 9,
        seenTurn: 72
      });
    });

    it("does nothing when the report names no turn", async () => {
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [army()] });
      const c = client();

      await useArmiesStore
        .getState()
        .refreshFor(c, game(), parsedWith([aReportUnit({ unitId: "1" })], null), NOW);

      expect(c.saveArmy).not.toHaveBeenCalled();
    });

    // A turn that loaded correctly must not be rolled back because a cache write failed - so the
    // caller sees nothing - and the cache is repaired from storage rather than left showing
    // snapshots that were never written.
    it("swallows a failed save and puts the cache back to what storage holds", async () => {
      const stored = army({ members: [aMember({ men: 1, seenTurn: 71 })] });
      const c = client({
        saveArmy: vi.fn().mockRejectedValue(new Error("disk full")),
        listArmies: vi.fn().mockResolvedValue([stored])
      });
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [stored] });

      await expect(
        useArmiesStore.getState().refreshFor(c, game(), parsedWith([aReportUnit({ unitId: "1", men: 9 })]), NOW)
      ).resolves.toBeUndefined();

      expect(c.listArmies).toHaveBeenCalled();
      expect(useArmiesStore.getState().armies[0].members[0].men).toBe(1);
    });
  });

  describe("clear", () => {
    it("empties the list and forgets the game", () => {
      useArmiesStore.setState({ gameId: "aug-2026", status: "ready", armies: [army()] });

      useArmiesStore.getState().clear();

      expect(useArmiesStore.getState()).toMatchObject({ gameId: null, status: "idle", armies: [] });
    });
  });
});
