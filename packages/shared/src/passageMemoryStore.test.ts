import type {
  CoreClient,
  Coordinate,
  ImportedTurnSummary,
  OpenedGame,
  ParsedReport
} from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { knownPassagesOf } from "./passageMemory";
import {
  resetPassageMemoryStore,
  scanStoredTurns,
  usePassageMemoryStore
} from "./passageMemoryStore";

const SHAFT_HEX: Coordinate = { x: 1, y: 1, z: 1 };
const UNDERWORLD: Coordinate = { x: 12, y: 34, z: 2 };

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

const standingIn = (coordinate: Coordinate, terrain: string, factionId = "1"): ParsedReport =>
  aParsedReport({
    header: aReportHeaderInfo({ factionId }),
    regions: [
      aReportRegion({
        coordinate,
        terrain,
        units: [aReportUnit({ unitId: "5", own: true })]
      })
    ]
  });

const CLAIM = {
  unitId: "5",
  entry: SHAFT_HEX,
  structureId: "1",
  structure: "Shaft [1]"
};

/**
 * A client whose stored turns are `turns` and whose claims are whatever `claims` returns for a
 * report's text. Every report's text is its turn key, so a fake can tell them apart.
 */
function fakeClient(
  turns: { factionId: string; turn: number; report: ParsedReport; draft: string | null }[]
) {
  const find = (factionId: string, turn: number) =>
    turns.find((entry) => entry.factionId === factionId && entry.turn === turn) ?? null;

  return {
    listImportedTurns: vi
      .fn()
      .mockResolvedValue(turns.map((entry) => summary(entry.factionId, entry.turn))),
    loadImportedTurn: vi.fn(async (_db: string, _g: string, factionId: string, turn: number) => {
      const entry = find(factionId, turn);
      return entry === null ? null : { rawReport: `${factionId}:${turn}` };
    }),
    loadOrderDraft: vi.fn(async (_db: string, _g: string, factionId: string, turn: number) => {
      const entry = find(factionId, turn);
      return entry?.draft == null ? null : { orderText: entry.draft };
    }),
    parseReportFull: vi.fn(async (rawReport: string) => {
      const [factionId, turn] = rawReport.split(":");
      return find(factionId, Number(turn))!.report;
    }),
    passageClaims: vi.fn(async () => [CLAIM])
  } as unknown as Pick<
    CoreClient,
    | "listImportedTurns"
    | "loadImportedTurn"
    | "loadOrderDraft"
    | "parseReportFull"
    | "passageClaims"
  >;
}

describe("scanStoredTurns (ah-3u7c.2.1)", () => {
  beforeEach(() => resetPassageMemoryStore());

  it("learns a passage from two consecutive turns", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" },
      { factionId: "1", turn: 56, report: standingIn(UNDERWORLD, "cavern"), draft: null }
    ]);

    const { memory, unreadTurns } = await scanStoredTurns(client, game(), "{}");

    expect(unreadTurns).toBe(0);
    expect(knownPassagesOf(memory)).toEqual([
      expect.objectContaining({ destination: UNDERWORLD, destinationTerrain: "cavern", learnedInTurn: 56 })
    ]);
  });

  it("learns nothing across a gap in the turns", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 3, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" },
      { factionId: "1", turn: 5, report: standingIn(UNDERWORLD, "cavern"), draft: null }
    ]);

    const { memory } = await scanStoredTurns(client, game(), "{}");

    expect(knownPassagesOf(memory)).toEqual([]);
  });

  it("does not answer one faction's claim with another faction's report", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" },
      { factionId: "2", turn: 56, report: standingIn(UNDERWORLD, "cavern", "2"), draft: null }
    ]);

    const { memory } = await scanStoredTurns(client, game(), "{}");

    expect(knownPassagesOf(memory)).toEqual([]);
  });

  it("counts a turn that will not load and carries on", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" },
      { factionId: "1", turn: 56, report: standingIn(UNDERWORLD, "cavern"), draft: null }
    ]);
    (client.loadImportedTurn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { memory, unreadTurns } = await scanStoredTurns(client, game(), "{}");

    expect(unreadTurns).toBe(1);
    expect(knownPassagesOf(memory)).toEqual([]);
  });

  it("does not walk the game at all while the ruleset is still fetching", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" },
      { factionId: "1", turn: 56, report: standingIn(UNDERWORLD, "cavern"), draft: null }
    ]);

    const { memory, unreadTurns } = await scanStoredTurns(client, game(), null);

    expect(knownPassagesOf(memory)).toEqual([]);
    expect(unreadTurns).toBe(0);
    expect(client.listImportedTurns).not.toHaveBeenCalled();
    expect(client.passageClaims).not.toHaveBeenCalled();
  });

  it("counts only the report as unread when the saved orders will not load", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" },
      { factionId: "1", turn: 56, report: standingIn(UNDERWORLD, "cavern"), draft: null }
    ]);
    (client.loadOrderDraft as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));

    const { unreadTurns } = await scanStoredTurns(client, game(), "{}");

    expect(unreadTurns).toBe(0);
  });

  it("makes no claims for a turn with no saved orders", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: null },
      { factionId: "1", turn: 56, report: standingIn(UNDERWORLD, "cavern"), draft: null }
    ]);

    const { memory } = await scanStoredTurns(client, game(), "{}");

    expect(knownPassagesOf(memory)).toEqual([]);
    expect(client.passageClaims).not.toHaveBeenCalled();
  });
});

describe("learnLatest (ah-3u7c.2.1)", () => {
  beforeEach(() => resetPassageMemoryStore());

  it("answers the turn on screen against the turn before it", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" }
    ]);
    usePassageMemoryStore.setState({ gameId: "aug-2026", status: "ready" });

    await usePassageMemoryStore
      .getState()
      .learnLatest(client as CoreClient, game(), standingIn(UNDERWORLD, "cavern"), 56, "{}");

    expect(client.loadImportedTurn).toHaveBeenCalledTimes(1);
    expect(client.loadOrderDraft).toHaveBeenCalledTimes(1);
    expect(knownPassagesOf(usePassageMemoryStore.getState().memory)).toEqual([
      expect.objectContaining({ destination: UNDERWORLD, learnedInTurn: 56 })
    ]);
  });

  it("writes nothing into a store the game was closed on", async () => {
    const client = fakeClient([
      { factionId: "1", turn: 55, report: standingIn(SHAFT_HEX, "plain"), draft: "unit 5\nMOVE IN\n" }
    ]);

    // `clear()` has run: the workspace holds no game, and a call still in flight must not set one.
    await usePassageMemoryStore
      .getState()
      .learnLatest(client as CoreClient, game(), standingIn(UNDERWORLD, "cavern"), 56, "{}");

    expect(usePassageMemoryStore.getState().gameId).toBeNull();
    expect(knownPassagesOf(usePassageMemoryStore.getState().memory)).toEqual([]);
  });

  it("learns nothing for the first turn of a game", async () => {
    const client = fakeClient([]);

    await usePassageMemoryStore
      .getState()
      .learnLatest(client as CoreClient, game(), standingIn(SHAFT_HEX, "plain"), 0, "{}");

    expect(client.loadImportedTurn).not.toHaveBeenCalled();
  });
});
