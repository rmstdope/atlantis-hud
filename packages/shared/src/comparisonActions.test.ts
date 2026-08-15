import type { ParsedReport } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { listComparableTurns, loadComparisonTurn, pickComparisonTurn } from "./comparisonActions";

/**
 * Loading the turn a comparison click asked for (ah-6l2).
 *
 * Moved verbatim out of `AppShell.tsx`/`AppShell.test.ts` (ah-k6i.3) so this half of it - fetch,
 * parse, shape the result - is testable without rendering the whole shell. Unlike the code it
 * replaces, every path here either resolves with a `ComparisonTurn` or rejects with an `Error` the
 * caller can put on the status line - there is no path that does neither.
 */
describe("loadComparisonTurn", () => {
  const parsedComparison = { header: { turnNumber: 70 } } as unknown as ParsedReport;

  it("loads and parses the requested turn into a ComparisonTurn", async () => {
    const client = {
      loadImportedTurn: vi.fn().mockResolvedValue({
        key: { factionId: "17", turnNumber: 70 },
        rawReport: "raw report text",
        parseResult: {}
      })
    };
    const parse = vi.fn().mockResolvedValue(parsedComparison);

    const comparison = await loadComparisonTurn(client, "/db", "game-1", "17", 70, parse);

    expect(client.loadImportedTurn).toHaveBeenCalledWith("/db", "game-1", "17", 70);
    expect(parse).toHaveBeenCalledWith("raw report text");
    expect(comparison).toEqual({
      key: { factionId: "17", turnNumber: 70 },
      parsed: parsedComparison
    });
  });

  it("rejects with an Error, rather than resolving to nothing, when the turn no longer exists", async () => {
    const client = { loadImportedTurn: vi.fn().mockResolvedValue(null) };
    const parse = vi.fn();

    await expect(loadComparisonTurn(client, "/db", "game-1", "17", 70, parse)).rejects.toThrow(
      /70/
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("propagates a load failure instead of swallowing it", async () => {
    const client = { loadImportedTurn: vi.fn().mockRejectedValue(new Error("database file missing")) };
    const parse = vi.fn();

    await expect(loadComparisonTurn(client, "/db", "game-1", "17", 70, parse)).rejects.toThrow(
      "database file missing"
    );
  });

  it("propagates a parse failure instead of swallowing it", async () => {
    const client = {
      loadImportedTurn: vi.fn().mockResolvedValue({
        key: { factionId: "17", turnNumber: 70 },
        rawReport: "raw report text",
        parseResult: {}
      })
    };
    const parse = vi.fn().mockRejectedValue(new Error("malformed report"));

    await expect(loadComparisonTurn(client, "/db", "game-1", "17", 70, parse)).rejects.toThrow(
      "malformed report"
    );
  });
});

describe("listComparableTurns", () => {
  it("keeps only the viewer's faction, in the order the client returns them", async () => {
    const client = {
      listImportedTurns: vi.fn().mockResolvedValue([
        { key: { factionId: "17", turnNumber: 70 }, season: null, importedAt: "a", updatedAt: "a" },
        { key: { factionId: "22", turnNumber: 70 }, season: null, importedAt: "b", updatedAt: "b" },
        { key: { factionId: "17", turnNumber: 71 }, season: null, importedAt: "c", updatedAt: "c" }
      ])
    };

    const turns = await listComparableTurns(client, "/db", "game-1", "17");

    expect(client.listImportedTurns).toHaveBeenCalledWith("/db", "game-1");
    expect(turns.map((turn) => turn.key.turnNumber)).toEqual([70, 71]);
    expect(turns.every((turn) => turn.key.factionId === "17")).toBe(true);
  });
});

describe("pickComparisonTurn", () => {
  const parsedComparison = { header: { turnNumber: 65 } } as unknown as ParsedReport;
  const baseContext = {
    databasePath: "/db",
    gameId: "game-1",
    factionId: "17",
    workingTurn: 71,
    currentTurn: null as number | null,
    parse: vi.fn().mockResolvedValue(parsedComparison)
  };

  it("clicking the working turn changes nothing and does not call the client", async () => {
    const client = { loadImportedTurn: vi.fn() };

    const result = await pickComparisonTurn(client, { ...baseContext, currentTurn: 65 }, 71);

    expect(result).toEqual({ changed: false });
    expect(client.loadImportedTurn).not.toHaveBeenCalled();
  });

  it("clicking the already-compared turn stops the comparison", async () => {
    const client = { loadImportedTurn: vi.fn() };

    const result = await pickComparisonTurn(client, { ...baseContext, currentTurn: 65 }, 65);

    expect(result).toEqual({ changed: true, comparison: null });
    expect(client.loadImportedTurn).not.toHaveBeenCalled();
  });

  it("clicking another turn loads it and returns the comparison", async () => {
    const client = {
      loadImportedTurn: vi.fn().mockResolvedValue({
        key: { factionId: "17", turnNumber: 65 },
        rawReport: "raw report text",
        parseResult: {}
      })
    };
    const parse = vi.fn().mockResolvedValue(parsedComparison);

    const result = await pickComparisonTurn(client, { ...baseContext, parse }, 65);

    expect(client.loadImportedTurn).toHaveBeenCalledWith("/db", "game-1", "17", 65);
    expect(result).toEqual({
      changed: true,
      comparison: { key: { factionId: "17", turnNumber: 65 }, parsed: parsedComparison }
    });
  });

  it("rejects when the clicked turn will not load", async () => {
    const client = { loadImportedTurn: vi.fn().mockResolvedValue(null) };

    await expect(pickComparisonTurn(client, baseContext, 65)).rejects.toThrow(/65/);
  });
});
