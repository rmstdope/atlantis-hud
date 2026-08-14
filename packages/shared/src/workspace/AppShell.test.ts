import type { ParsedReport } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { deliverGameBackupExport, deliverOrdersExport, isOlderTurn, loadComparisonTurn } from "./AppShell";

describe("isOlderTurn", () => {
  it("is older when the incoming turn is behind what is on screen", () => {
    expect(isOlderTurn(71, 2)).toBe(true);
  });

  it("is not older when the incoming turn is the same or ahead", () => {
    expect(isOlderTurn(71, 71)).toBe(false);
    expect(isOlderTurn(71, 72)).toBe(false);
  });

  it("is not older when either turn number is unknown", () => {
    expect(isOlderTurn(null, 2)).toBe(false);
    expect(isOlderTurn(71, null)).toBe(false);
    expect(isOlderTurn(undefined, 2)).toBe(false);
    expect(isOlderTurn(71, undefined)).toBe(false);
  });
});

describe("deliverOrdersExport", () => {
  it("forwards the shell's saver into deliverTextFile, which is what actually calls it", async () => {
    const saver = vi.fn().mockResolvedValue("/chosen/orders-turn-71.txt");
    const deliver = vi.fn().mockResolvedValue("/chosen/orders-turn-71.txt");

    await deliverOrdersExport(saver, 71, "unit 1 : work", null, false, deliver);

    expect(deliver).toHaveBeenCalledWith(saver, "orders-turn-71.txt", "unit 1 : work", "text/plain");
    expect(saver).not.toHaveBeenCalled();
  });

  it("forwards an undefined saver into deliverTextFile, which is what falls back to downloading", async () => {
    const deliver = vi.fn().mockResolvedValue("");

    await deliverOrdersExport(undefined, 71, "unit 1 : work", null, false, deliver);

    expect(deliver).toHaveBeenCalledWith(undefined, "orders-turn-71.txt", "unit 1 : work", "text/plain");
  });

  it("a cancelled save (null) writes nothing further and does not throw", async () => {
    const deliver = vi.fn().mockResolvedValue(null);

    await expect(
      deliverOrdersExport(vi.fn(), 71, "unit 1 : work", null, false, deliver)
    ).resolves.toBeUndefined();
  });

  it("logs and swallows a failed delivery instead of rejecting", async () => {
    const deliver = vi.fn().mockRejectedValue(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        deliverOrdersExport(vi.fn(), 71, "unit 1 : work", null, false, deliver)
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falls back to 'unknown' when the turn number is unavailable", async () => {
    const deliver = vi.fn().mockResolvedValue("");

    await deliverOrdersExport(undefined, null, "unit 1 : work", null, true, deliver);

    expect(deliver).toHaveBeenCalledWith(
      undefined,
      "orders-turn-unknown.txt",
      expect.any(String),
      "text/plain"
    );
  });
});

describe("deliverGameBackupExport", () => {
  it("forwards the shell's saver into deliverTextFile, which is what actually calls it", async () => {
    const saver = vi.fn().mockResolvedValue("/chosen/game-1.atlantis-hud-game.json");
    const deliver = vi.fn().mockResolvedValue("/chosen/game-1.atlantis-hud-game.json");

    const path = await deliverGameBackupExport(saver, "game-1", "{}", deliver);

    expect(deliver).toHaveBeenCalledWith(
      saver,
      "game-1.atlantis-hud-game.json",
      "{}",
      "application/json"
    );
    expect(saver).not.toHaveBeenCalled();
    expect(path).toBe("/chosen/game-1.atlantis-hud-game.json");
  });

  it("forwards an undefined saver into deliverTextFile, which is what falls back to downloading", async () => {
    const deliver = vi.fn().mockResolvedValue("");

    const path = await deliverGameBackupExport(undefined, "game-1", "{}", deliver);

    expect(deliver).toHaveBeenCalledWith(
      undefined,
      "game-1.atlantis-hud-game.json",
      "{}",
      "application/json"
    );
    expect(path).toBe("");
  });

  it("resolves null on a cancelled save, without throwing", async () => {
    const deliver = vi.fn().mockResolvedValue(null);

    await expect(deliverGameBackupExport(vi.fn(), "game-1", "{}", deliver)).resolves.toBeNull();
  });
});

/**
 * Loading the turn a comparison click asked for (ah-6l2).
 *
 * Extracted out of `handleSelectComparisonTurn` so this half of it - fetch, parse, shape the
 * result - is testable without rendering the whole shell. The other half (updating `comparison`,
 * `turnPickerOpen`) stays a `useCallback` in the component; this is the part that used to fail
 * silently. Unlike the code it replaces, every path here either resolves with a `ComparisonTurn`
 * or rejects with an `Error` the caller can put on the status line - there is no path that does
 * neither.
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
