import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

function withClipboard(clipboard: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value: clipboard === undefined ? {} : { clipboard },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText", () => {
  it("resolves false when the clipboard is absent", async () => {
    withClipboard(undefined);
    await expect(copyText("anything")).resolves.toBe(false);
  });

  it("resolves true on success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    withClipboard({ writeText });
    await expect(copyText("the block")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("the block");
  });

  it("resolves false rather than throwing when the browser refuses", async () => {
    withClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await expect(copyText("the block")).resolves.toBe(false);
  });
});
