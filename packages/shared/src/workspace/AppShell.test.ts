import { describe, expect, it, vi } from "vitest";
import { confirmOlderTurnLoad, deliverOrdersExport, shouldConfirmOlderTurnLoad } from "./AppShell";

describe("shouldConfirmOlderTurnLoad", () => {
  it("requires confirmation when loading an older turn", () => {
    expect(shouldConfirmOlderTurnLoad(71, 2)).toBe(true);
  });

  it("does not require confirmation when loading the same or newer turn", () => {
    expect(shouldConfirmOlderTurnLoad(71, 71)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(71, 72)).toBe(false);
  });

  it("does not require confirmation when either turn number is unknown", () => {
    expect(shouldConfirmOlderTurnLoad(null, 2)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(71, null)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(undefined, 2)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(71, undefined)).toBe(false);
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

describe("confirmOlderTurnLoad", () => {
  it("accepts by default when confirm is unavailable", () => {
    vi.stubGlobal("confirm", undefined);
    try {
      expect(confirmOlderTurnLoad(71, 2)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks for explicit confirmation with an old-turn warning", () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    try {
      expect(confirmOlderTurnLoad(71, 2)).toBe(false);
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining("older than the currently loaded turn 71")
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
