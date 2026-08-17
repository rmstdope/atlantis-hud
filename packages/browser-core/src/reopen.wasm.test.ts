import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readReport } from "@atlantis/fixtures";
import type { GameManifest } from "@atlantis/core-client";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core's `latest_turn_state` rather than the routing stand-in used
 * elsewhere in this package (see `fakeWasm` in webCoreAdapter.test.ts). Those tests are about how
 * the adapter routes between the core and storage; this file is about the rule itself as seen from
 * TypeScript - the same one `crates/core/src/reopen.rs` pins in Rust.
 */
const REPORT_T70 = readReport("g7f95t70");
const REPORT_T71 = readReport("g7f95t71");
const REPORT_ALLY_T71 = readReport("g8f73t71");
const FACTION_ID = "95";
const ALLY_FACTION_ID = "73";

async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

function manifest(gameId: string, gameName: string): GameManifest {
  return {
    manifestVersion: 1,
    metadata: { gameId, gameName, rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-01T09:00:00Z"
  };
}

describe("which turn a game reopens on, across the WebAssembly boundary", () => {
  it("reopens on the highest turn, not the one imported last", async () => {
    const wasm = await realCore();
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);
    const opened = (await adapter.createGame(manifest("g7", "Game 7"))) as { databasePath: string };

    // The reported case: the higher turn first, an older report imported afterwards for history.
    await adapter.commitReportImport(
      opened.databasePath,
      "g7",
      FACTION_ID,
      REPORT_T71,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.commitReportImport(
      opened.databasePath,
      "g7",
      FACTION_ID,
      REPORT_T70,
      null,
      false,
      "2026-08-01T11:00:00Z"
    );

    // A draft on the older turn does not send the game back to it either.
    await adapter.saveOrderDraft(
      opened.databasePath,
      "g7",
      FACTION_ID,
      70,
      "@work",
      "2026-08-01T12:00:00Z"
    );

    expect(await adapter.loadLatestImportedTurn(opened.databasePath, "g7", null)).toMatchObject({
      key: { factionId: FACTION_ID, turnNumber: 71 }
    });
  });

  it("reopens as the remembered faction even when another holds the same turn", async () => {
    const wasm = await realCore();
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);
    const opened = (await adapter.createGame(manifest("g9", "Game 9"))) as { databasePath: string };

    await adapter.commitReportImport(
      opened.databasePath,
      "g9",
      FACTION_ID,
      REPORT_T71,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.commitReportImport(
      opened.databasePath,
      "g9",
      ALLY_FACTION_ID,
      REPORT_ALLY_T71,
      null,
      false,
      "2026-08-01T11:00:00Z"
    );

    expect(
      await adapter.loadLatestImportedTurn(opened.databasePath, "g9", FACTION_ID)
    ).toMatchObject({ key: { factionId: FACTION_ID, turnNumber: 71 } });
    expect(
      await adapter.loadLatestImportedTurn(opened.databasePath, "g9", ALLY_FACTION_ID)
    ).toMatchObject({ key: { factionId: ALLY_FACTION_ID, turnNumber: 71 } });
  });

  it("a game holding no imports reopens on nothing", async () => {
    const wasm = await realCore();
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);
    const opened = (await adapter.createGame(manifest("g8", "Game 8"))) as { databasePath: string };

    expect(await adapter.loadLatestImportedTurn(opened.databasePath, "g8", null)).toBeNull();
  });
});
