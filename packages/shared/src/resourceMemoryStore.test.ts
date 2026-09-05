import type { CoreClient, ImportedTurnSummary, OpenedGame } from "@atlantis/core-client";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameDataEntry, GameDataIndex } from "./gameData";
import { NO_RESOURCE_MEMORY, rememberedFor } from "./resourceMemory";
import {
  resetResourceMemoryStore,
  scanStoredTurns,
  useResourceMemoryStore
} from "./resourceMemoryStore";

const anIndex = (): GameDataIndex => ({
  entries: [],
  byId: new Map([
    [
      "equipment:FLOA",
      { id: "equipment:FLOA", category: "equipment", name: "floater hide", tag: "FLOA" }
    ]
  ] as [string, GameDataEntry][]),
  detailOf: () => null,
  revealedBy: new Map([["FLOA", { skillTag: "HUNT", skillName: "hunting", level: 3 }]]),
  terrainResources: new Map([["swamp", ["WOOD", "FLOA"]]])
});

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

const hunter = aReportUnit({ skills: [{ name: "hunting", tag: "HUNT", level: 3, points: 180 }] });

const swampReport = (products: { amount: number; name: string; tag: string }[]) =>
  aParsedReport({
    regions: [aReportRegion({ terrain: "swamp", products, units: [hunter] })]
  });

const hexId = aReportRegion({ terrain: "swamp" }).regionId;
const ABSENT = swampReport([{ amount: 16, name: "wood", tag: "WOOD" }]);
const PRESENT = swampReport([{ amount: 8, name: "floater hides", tag: "FLOA" }]);

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listImportedTurns: vi.fn().mockResolvedValue([]),
    loadImportedTurn: vi.fn().mockResolvedValue({ rawReport: "report", parseResult: {} }),
    parseReportFull: vi.fn().mockResolvedValue(ABSENT),
    ...overrides
  } as unknown as CoreClient;
}

beforeEach(() => {
  resetResourceMemoryStore();
});

describe("scanStoredTurns (ah-tgtp)", () => {
  it("folds every stored turn into the memory", async () => {
    const core = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("21", 23), summary("21", 25)]),
      parseReportFull: vi
        .fn()
        .mockResolvedValueOnce(ABSENT)
        .mockResolvedValueOnce(PRESENT)
    });

    const { memory, unreadTurns } = await scanStoredTurns(core, game(), anIndex());

    expect(unreadTurns).toBe(0);
    expect(rememberedFor(memory, hexId).get("FLOA")).toEqual({
      tag: "FLOA",
      amount: 8,
      name: "floater hides",
      turn: 25
    });
  });

  it("counts a turn it cannot read and carries on", async () => {
    const core = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("21", 23), summary("21", 25)]),
      loadImportedTurn: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ rawReport: "report", parseResult: {} }),
      parseReportFull: vi.fn().mockResolvedValue(PRESENT)
    });

    const { memory, unreadTurns } = await scanStoredTurns(core, game(), anIndex());

    expect(unreadTurns).toBe(1);
    expect(rememberedFor(memory, hexId).get("FLOA")?.turn).toBe(25);
  });

  it("counts a turn that will not parse and carries on", async () => {
    const core = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("21", 23), summary("21", 25)]),
      parseReportFull: vi
        .fn()
        .mockRejectedValueOnce(new Error("no"))
        .mockResolvedValueOnce(PRESENT)
    });

    const { memory, unreadTurns } = await scanStoredTurns(core, game(), anIndex());

    expect(unreadTurns).toBe(1);
    expect(rememberedFor(memory, hexId).get("FLOA")?.turn).toBe(25);
  });

  it("recovers nothing when the turn listing itself fails", async () => {
    const core = client({ listImportedTurns: vi.fn().mockRejectedValue(new Error("no storage")) });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(scanStoredTurns(core, game(), anIndex())).resolves.toEqual({
      memory: NO_RESOURCE_MEMORY,
      unreadTurns: 0
    });
  });

  it("remembers nothing without a catalogue", async () => {
    const core = client({
      listImportedTurns: vi.fn().mockResolvedValue([summary("21", 23)]),
      parseReportFull: vi.fn().mockResolvedValue(PRESENT)
    });

    const { memory } = await scanStoredTurns(core, game(), null);

    expect(rememberedFor(memory, hexId).size).toBe(0);
  });
});

describe("useResourceMemoryStore (ah-tgtp)", () => {
  it("ignores a scan that finished after a newer one started", async () => {
    let releaseFirst: (value: ImportedTurnSummary[]) => void = () => {};
    const first = new Promise<ImportedTurnSummary[]>((resolve) => {
      releaseFirst = resolve;
    });
    const core = client({
      listImportedTurns: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce([summary("21", 25)]),
      parseReportFull: vi.fn().mockResolvedValue(PRESENT)
    });

    const slow = useResourceMemoryStore.getState().scan(core, game(), anIndex());
    await useResourceMemoryStore.getState().scan(core, game(), anIndex());
    releaseFirst([summary("21", 23)]);
    await slow;

    const { memory, status } = useResourceMemoryStore.getState();
    expect(status).toBe("ready");
    expect(rememberedFor(memory, hexId).get("FLOA")?.turn).toBe(25);
  });

  it("ignores a fold for another game", async () => {
    await useResourceMemoryStore.getState().scan(client(), game(), anIndex());

    useResourceMemoryStore.getState().foldIn("other-game", PRESENT, 25, anIndex());

    expect(useResourceMemoryStore.getState().memory.size).toBe(0);
  });
});
