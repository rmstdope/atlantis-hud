import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTextFileSaver } from "./downloadFile";

/**
 * These tests run under Node, where no `document` or `URL.createObjectURL` exists - the same
 * approach `selectionGuard.test.ts` takes: a stub carrying only what the code under test touches.
 */
type AnchorStub = { href: string; download: string; click: ReturnType<typeof vi.fn> };

function installDomStubs(): { anchor: AnchorStub; createObjectURL: ReturnType<typeof vi.fn>; revokeObjectURL: ReturnType<typeof vi.fn> } {
  const anchor: AnchorStub = { href: "", download: "", click: vi.fn() };
  const createObjectURL = vi.fn((blob: { type: string }) => `blob:${blob.type}`);
  const revokeObjectURL = vi.fn();
  (globalThis as { document?: unknown }).document = {
    createElement: vi.fn(() => anchor)
  };
  (globalThis as { URL: unknown }).URL = { createObjectURL, revokeObjectURL };
  return { anchor, createObjectURL, revokeObjectURL };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  vi.unstubAllGlobals();
});

describe("browserTextFileSaver", () => {
  it("clicks an anchor download and resolves with an empty path", async () => {
    const { anchor, createObjectURL, revokeObjectURL } = installDomStubs();

    const result = await browserTextFileSaver("orders-turn-71.txt", "unit 1 work", "text/plain");

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchor.href).toBe("blob:text/plain");
    expect(anchor.download).toBe("orders-turn-71.txt");
    expect(anchor.click).toHaveBeenCalled();
    expect(result).toBe("");

    // The revoke happens on a later task, not synchronously - see the implementation's comment.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:text/plain");
  });

  it("passes the mime type through to the blob it downloads", async () => {
    const { anchor } = installDomStubs();

    const result = await browserTextFileSaver("game-1.atlantis-hud-game.json", "{}", "application/json");

    expect(result).toBe("");
    expect(anchor.href).toBe("blob:application/json");
  });
});
