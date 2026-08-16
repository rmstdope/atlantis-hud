import { describe, expect, it, vi } from "vitest";
import { deliverGameBackupExport, deliverMapExport, deliverOrdersExport } from "./exportActions";
import { exportFileName } from "../mapExport";

describe("deliverOrdersExport", () => {
  it("saves through the shell's saver, with the plain-text mime type", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/orders-turn-71.txt");

    await deliverOrdersExport(saveTextFile, 71, "unit 1 : work", null, false);

    expect(saveTextFile).toHaveBeenCalledWith("orders-turn-71.txt", "unit 1 : work", "text/plain");
  });

  it("a cancelled save (null) writes nothing further and does not throw", async () => {
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(deliverOrdersExport(saveTextFile, 71, "unit 1 : work", null, false)).resolves.toBeUndefined();
  });

  it("logs and swallows a failed delivery instead of rejecting", async () => {
    const saveTextFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        deliverOrdersExport(saveTextFile, 71, "unit 1 : work", null, false)
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falls back to 'unknown' when the turn number is unavailable", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("");

    await deliverOrdersExport(saveTextFile, null, "unit 1 : work", null, true);

    expect(saveTextFile).toHaveBeenCalledWith("orders-turn-unknown.txt", expect.any(String), "text/plain");
  });
});

describe("deliverGameBackupExport", () => {
  it("saves through the shell's saver, named after the game, with the JSON mime type", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/Backup game.atlantis-hud-game.json");

    const path = await deliverGameBackupExport(saveTextFile, "Backup game", "{}");

    expect(saveTextFile).toHaveBeenCalledWith(
      "Backup game.atlantis-hud-game.json",
      "{}",
      "application/json"
    );
    expect(path).toBe("/chosen/Backup game.atlantis-hud-game.json");
  });

  it("resolves null on a cancelled save, without throwing", async () => {
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(deliverGameBackupExport(saveTextFile, "Backup game", "{}")).resolves.toBeNull();
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
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/map-turn-71-level-1.txt");

    const path = await deliverMapExport(client, saveTextFile, "raw report", "[]", 1, 71, rect, content);

    expect(client.exportMap).toHaveBeenCalledWith("raw report", "[]", { level: 1, ...rect, content });
    expect(saveTextFile).toHaveBeenCalledWith(exportFileName(71, 1), "svg…", "text/plain");
    expect(path).toBe("/chosen/map-turn-71-level-1.txt");
  });

  it("a cancelled save (null) resolves null and writes nothing further", async () => {
    const client = { exportMap: vi.fn().mockResolvedValue("svg…") };
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(
      deliverMapExport(client, saveTextFile, "raw report", "[]", 1, 71, rect, content)
    ).resolves.toBeNull();
  });

  it("a failed render rejects rather than being swallowed - the caller reports it in the dialog", async () => {
    const client = { exportMap: vi.fn().mockRejectedValue(new Error("core is unavailable")) };
    const saveTextFile = vi.fn();

    await expect(
      deliverMapExport(client, saveTextFile, "raw report", "[]", 1, 71, rect, content)
    ).rejects.toThrow("core is unavailable");
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
