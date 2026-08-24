import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameManifest } from "@atlantis/core-client";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core's `edit_game_manifest_state` rather than the routing
 * stand-in used elsewhere in this package. What one edit does to a manifest is the core's rule and
 * the desktop's too (`ah-8z4y.3.1`); this file pins the one the browser used to hand-code as a
 * `delete metadata.map` - clearing a map removes the key rather than writing a null, because
 * absence is what tells the settings dialog the ruleset's default is only assumed.
 */
async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

function newGame(): GameManifest {
  return {
    manifestVersion: 1,
    metadata: { gameId: "g1", gameName: "Game One", rulesetId: "neworigins" },
    reportSources: [{ sourceId: "s1", label: "turn 1" }],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-01T09:00:00Z"
  };
}

describe("what one manifest edit does, across the WebAssembly boundary", () => {
  it("clearing a game's map removes the key rather than writing a null", async () => {
    const wasm = await realCore();
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);
    await adapter.createGame(newGame());
    await adapter.setGameMap(
      "g1",
      JSON.stringify({ width: 72, height: 96, wrapX: true, wrapY: false })
    );

    const cleared = await adapter.setGameMap("g1", "");

    expect("map" in cleared.metadata).toBe(false);
    const stored = (await store.getGame("g1"))?.manifest as GameManifest;
    expect("map" in stored.metadata).toBe(false);
  });

  it("records a map when it is given one", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    await adapter.createGame(newGame());

    const withMap = await adapter.setGameMap(
      "g1",
      JSON.stringify({ width: 72, height: 96, wrapX: true, wrapY: false })
    );

    expect(withMap.metadata.map).toEqual({ width: 72, height: 96, wrapX: true, wrapY: false });
  });

  it("leaves every other field alone", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    await adapter.createGame(newGame());

    const renamed = await adapter.setGameName("g1", "Renamed");

    // `activeFactionId` comes back explicitly null, unlike `map`: that field carries no
    // `skip_serializing_if`, so a round trip through the core states the absence rather than
    // dropping it. The difference is deliberate and is what the settings dialog reads.
    expect(renamed).toEqual({
      ...newGame(),
      metadata: { ...newGame().metadata, gameName: "Renamed", activeFactionId: null }
    });
  });

  it("stamps the open, the ruleset and the active faction", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    await adapter.createGame(newGame());

    await adapter.openGame("g1", "2026-08-05T09:00:00Z");
    await adapter.setGameRuleset("g1", "standard");
    const final = await adapter.setActiveFaction("g1", "f1");

    expect(final.lastOpenedAt).toBe("2026-08-05T09:00:00Z");
    expect(final.metadata.rulesetId).toBe("standard");
    expect(final.metadata.activeFactionId).toBe("f1");
  });
});
