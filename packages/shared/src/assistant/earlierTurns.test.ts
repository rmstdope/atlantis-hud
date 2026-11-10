import { describe, expect, it } from "vitest";
import { aParsedReport, aReportHeaderInfo, type ImportedTurnSummary, type ParsedReport } from "@atlantis/core-client";
import { earlierTurnSource } from "./earlierTurns";

const WHERE = { databasePath: "/db", gameId: "game-1", factionId: "3" };

function aSummary(factionId: string, turnNumber: number): ImportedTurnSummary {
  return {
    key: { gameId: "game-1", factionId, turnNumber },
    season: `season ${turnNumber}`,
    importedAt: `2026-01-${String(turnNumber).padStart(2, "0")}`,
    updatedAt: "2026-01-01"
  };
}

/** A client over turns 10 and 11 of faction 3 (orders kept for 10 only) and turn 10 of faction 4. */
function aClient() {
  const draftReads: number[] = [];
  const client = {
    listImportedTurns: async () => [aSummary("3", 10), aSummary("4", 10), aSummary("3", 11)],
    loadImportedTurn: async (_path: string, _game: string, factionId: string, turnNumber: number) =>
      factionId === "3" && (turnNumber === 10 || turnNumber === 11)
        ? { key: { gameId: "game-1", factionId, turnNumber }, rawReport: `report ${turnNumber}` }
        : null,
    loadOrderDraft: async (_path: string, _game: string, factionId: string, turnNumber: number) => {
      draftReads.push(turnNumber);
      return turnNumber === 10
        ? { key: { gameId: "game-1", factionId, turnNumber }, orderText: "#atlantis 3\nunit 100\nwork\n#end\n", updatedAt: "x" }
        : null;
    }
  };
  return { client, draftReads };
}

function counting() {
  const parsed: string[] = [];
  const parse = async (text: string): Promise<ParsedReport> => {
    parsed.push(text);
    return aParsedReport({ header: aReportHeaderInfo({ turnNumber: Number(text.split(" ")[1]) }) });
  };
  return { parse, parsed };
}

describe("the earlier turns an assistant can read", () => {
  it("lists only this faction's turns", async () => {
    const { client } = aClient();
    const source = earlierTurnSource(client, WHERE, counting().parse);

    expect(await source.list()).toEqual([
      { turnNumber: 10, season: "season 10", importedAt: "2026-01-10" },
      { turnNumber: 11, season: "season 11", importedAt: "2026-01-11" }
    ]);
  });

  it("loads a turn's parsed report and its orders, and parses it once", async () => {
    const { client, draftReads } = aClient();
    const { parse, parsed } = counting();
    const source = earlierTurnSource(client, WHERE, parse);

    const first = await source.load(10);
    const again = await source.load(10);

    expect(first?.turnNumber).toBe(10);
    expect(first?.parsed.header.turnNumber).toBe(10);
    expect(first?.ordersDocument).toContain("unit 100");
    expect(again?.parsed).toBe(first?.parsed);
    expect(parsed).toEqual(["report 10"]);
    expect(draftReads).toEqual([10, 10]);
  });

  it("answers no orders for a turn the HUD kept none for", async () => {
    const { client } = aClient();
    const source = earlierTurnSource(client, WHERE, counting().parse);

    expect((await source.load(11))?.ordersDocument).toBeNull();
  });

  it("answers nothing for a turn that is not stored", async () => {
    const { client } = aClient();
    const source = earlierTurnSource(client, WHERE, counting().parse);

    expect(await source.load(7)).toBeNull();
  });

  it("keeps the most recently read parsed reports, a few at most", async () => {
    const { client } = aClient();
    const { parse, parsed } = counting();
    const many = {
      ...client,
      listImportedTurns: async () => [1, 2, 3, 4].map((turn) => aSummary("3", turn)),
      loadImportedTurn: async (_p: string, _g: string, factionId: string, turnNumber: number) => ({
        key: { gameId: "game-1", factionId, turnNumber },
        rawReport: `report ${turnNumber}`
      })
    };
    const source = earlierTurnSource(many, WHERE, parse);

    for (const turn of [1, 2, 3, 1, 4, 1, 2]) {
      await source.load(turn);
    }

    expect(parsed).toEqual(["report 1", "report 2", "report 3", "report 4", "report 2"]);
  });

  it("parses a turn again once it has been imported again", async () => {
    const { client } = aClient();
    const { parse, parsed } = counting();
    let updatedAt = "first";
    const reimporting = {
      ...client,
      listImportedTurns: async () => [{ ...aSummary("3", 10), updatedAt }]
    };
    const source = earlierTurnSource(reimporting, WHERE, parse);

    await source.load(10);
    updatedAt = "second";
    await source.load(10);

    expect(parsed).toEqual(["report 10", "report 10"]);
  });

  it("parses a turn once when it is asked for twice at the same moment", async () => {
    const { client } = aClient();
    const { parse, parsed } = counting();
    const source = earlierTurnSource(client, WHERE, parse);

    const [first, second] = await Promise.all([source.load(10), source.load(10)]);

    expect(parsed).toEqual(["report 10"]);
    expect(second?.parsed).toBe(first?.parsed);
  });

  it("tries a failed parse again on the next read", async () => {
    const { client } = aClient();
    let fail = true;
    const parse = async (text: string) => {
      if (fail) {
        fail = false;
        throw new Error("bad");
      }
      return counting().parse(text);
    };
    const source = earlierTurnSource(client, WHERE, parse);

    await expect(source.load(10)).rejects.toThrow("bad");
    expect((await source.load(10))?.turnNumber).toBe(10);
  });

  it("loads a listed turn again once its report could not be read", async () => {
    const { client } = aClient();
    const { parse, parsed } = counting();
    let readable = false;
    const flaky = {
      ...client,
      loadImportedTurn: async (_p: string, _g: string, factionId: string, turnNumber: number) =>
        readable ? { key: { gameId: "game-1", factionId, turnNumber }, rawReport: `report ${turnNumber}` } : null
    };
    const source = earlierTurnSource(flaky, WHERE, parse);

    expect(await source.load(10)).toBeNull();
    readable = true;

    expect((await source.load(10))?.turnNumber).toBe(10);
    expect(parsed).toEqual(["report 10"]);
  });
});
