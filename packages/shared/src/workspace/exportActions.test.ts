import { describe, expect, it, vi } from "vitest";
import { deliverGameBackupExport, deliverMapExport, deliverOrdersExport } from "./exportActions";
import { exportFileName } from "../mapExport";

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
 * Rendering and delivering a map export (ah-k6i.4) - the part of `exportMap` with no dependency on
 * React state, pulled out the same way `deliverOrdersExport` was so it can be tested without
 * rendering the shell.
 */
describe("deliverMapExport", () => {
  const rect = { fromX: 0, fromY: 0, toX: 1, toY: 1 };
  const content = { structures: true, units: true, advancedResources: true };

  it("renders through the client and delivers the result under the map's file name", async () => {
    const client = { exportMap: vi.fn().mockResolvedValue("svg…") };
    const deliver = vi.fn().mockResolvedValue("/chosen/map-turn-71-level-1.txt");

    const path = await deliverMapExport(
      client,
      vi.fn(),
      "raw report",
      "[]",
      1,
      71,
      rect,
      content,
      deliver
    );

    expect(client.exportMap).toHaveBeenCalledWith("raw report", "[]", { level: 1, ...rect, content });
    expect(deliver).toHaveBeenCalledWith(
      expect.any(Function),
      exportFileName(71, 1),
      "svg…",
      "text/plain"
    );
    expect(path).toBe("/chosen/map-turn-71-level-1.txt");
  });

  it("a cancelled save (null) resolves null and writes nothing further", async () => {
    const client = { exportMap: vi.fn().mockResolvedValue("svg…") };
    const deliver = vi.fn().mockResolvedValue(null);

    await expect(
      deliverMapExport(client, vi.fn(), "raw report", "[]", 1, 71, rect, content, deliver)
    ).resolves.toBeNull();
  });

  it("a failed render rejects rather than being swallowed - the caller reports it in the dialog", async () => {
    const client = { exportMap: vi.fn().mockRejectedValue(new Error("core is unavailable")) };
    const deliver = vi.fn();

    await expect(
      deliverMapExport(client, vi.fn(), "raw report", "[]", 1, 71, rect, content, deliver)
    ).rejects.toThrow("core is unavailable");
    expect(deliver).not.toHaveBeenCalled();
  });
});
