import { describe, expect, it, vi } from "vitest";
import { deliverGameBackupExport, deliverOrdersExport, isOlderTurn } from "./AppShell";

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
