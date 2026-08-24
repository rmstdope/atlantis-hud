import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameManifest } from "@atlantis/core-client";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core's `reset_game_manifest_state` rather than the routing
 * stand-in used elsewhere in this package. What a reset keeps is the core's rule and the desktop's
 * too (`ah-8z4y.1`); this file pins it as seen from the browser, which is the platform that had it
 * wrong - it carried the old manifest's version forward instead of stamping the current one.
 */
async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

describe("what a reset keeps, across the WebAssembly boundary", () => {
  it("stamps the current manifest version rather than carrying the old one forward", async () => {
    const wasm = await realCore();
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);
    const stale: GameManifest = {
      manifestVersion: 0,
      metadata: { gameId: "g1", gameName: "Game One", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-01T09:00:00Z"
    };
    await adapter.createGame(stale);

    await adapter.resetGame("g1", "2026-08-02T09:00:00Z");

    const reset = (await store.getGame("g1"))?.manifest as GameManifest;
    expect(reset.manifestVersion).not.toBe(0);
    expect(reset.metadata.gameName).toBe("Game One");
    expect(reset.metadata.rulesetId).toBe("neworigins");
    expect(reset.reportSources).toEqual([]);
    expect(reset.createdAt).toBe("2026-08-02T09:00:00Z");
  });
});
