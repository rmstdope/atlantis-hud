import { describe, expect, it, vi } from "vitest";
import { confirmOlderTurnLoad, shouldConfirmOlderTurnLoad } from "./AppShell";

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
