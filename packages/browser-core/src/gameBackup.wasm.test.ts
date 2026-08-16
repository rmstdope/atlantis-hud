import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readReport } from "@atlantis/fixtures";
import type { GameManifest } from "@atlantis/core-client";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core's backup codec rather than the routing stand-in used
 * elsewhere in this package (see `fakeWasm` in webCoreAdapter.test.ts). Those tests are about how
 * the adapter routes between the codec and storage; this file is about the codec itself as seen
 * from TypeScript - the same rules `crates/core/src/backup.rs` pins in Rust.
 */
const REPORT = readReport("g7f95t71");
const FACTION_ID = "95";

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

describe("the game backup codec across the WebAssembly boundary", () => {
  it("round trips one whole game through the core's codec", async () => {
    const wasm = await realCore();
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);
    const opened = (await adapter.createGame(manifest("alpha", "Alpha"))) as {
      databasePath: string;
    };

    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      REPORT,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.saveOrderDraft(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      71,
      "@work",
      "2026-08-01T11:00:00Z"
    );
    await adapter.saveHexNote(opened.databasePath, {
      id: "note-1",
      gameId: "alpha",
      regionId: "1:7,53",
      text: "Mustn't forget the mountain pass",
      onMap: true,
      turn: 71,
      createdAt: "2026-08-01T11:00:00Z",
      updatedAt: "2026-08-01T11:00:00Z"
    });

    const backupJson = (await adapter.exportGame("alpha", "2026-08-02T00:00:00Z")) as string;
    const backup = JSON.parse(backupJson) as { manifest: { metadata: { gameId: string } } };
    backup.manifest.metadata.gameId = "beta";

    const restoredAdapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const restored = (await restoredAdapter.importGame(
      JSON.stringify(backup),
      "2026-08-03T00:00:00Z"
    )) as { databasePath: string };

    expect(await restoredAdapter.listImportedTurns(restored.databasePath, "beta")).toHaveLength(1);
    expect(
      await restoredAdapter.loadOrderDraft(restored.databasePath, "beta", FACTION_ID, 71)
    ).toMatchObject({ orderText: "@work" });
    expect(await restoredAdapter.listHexNotes(restored.databasePath, "beta")).toEqual([
      expect.objectContaining({ id: "note-1", text: "Mustn't forget the mountain pass" })
    ]);
    const sightings = (await restoredAdapter.loadRegionSightings(
      restored.databasePath,
      "beta",
      FACTION_ID
    )) as unknown[];
    expect(sightings.length).toBeGreaterThan(0);
  });

  it("writes tables in the same order whichever store produced them", async () => {
    const wasm = await realCore();
    const first = createWebCoreAdapter(wasm, createMemoryWebStore());
    const second = createWebCoreAdapter(wasm, createMemoryWebStore());

    for (const adapter of [first, second]) {
      await adapter.createGame(manifest("order", "Order"));
    }

    const factionOrder = [
      ["17", 1],
      ["2", 2],
      ["9", 1]
    ] as const;
    for (const [factionId, turnNumber] of factionOrder) {
      await first.saveOrderDraft(
        "idb://game-order",
        "order",
        factionId,
        turnNumber,
        "@work",
        "2026-08-01T09:00:00Z"
      );
    }
    for (const [factionId, turnNumber] of [...factionOrder].reverse()) {
      await second.saveOrderDraft(
        "idb://game-order",
        "order",
        factionId,
        turnNumber,
        "@work",
        "2026-08-01T09:00:00Z"
      );
    }

    const exportedAt = "2026-08-02T00:00:00Z";
    const firstBackup = (await first.exportGame("order", exportedAt)) as string;
    const secondBackup = (await second.exportGame("order", exportedAt)) as string;

    expect(firstBackup).toBe(secondBackup);
  });

  it("imports a backup written before hex notes existed", async () => {
    const wasm = await realCore();
    const backup = JSON.stringify({
      format: "atlantis-hud-game-backup",
      version: 1,
      exportedAt: "2026-08-01T09:00:00Z",
      manifest: manifest("pre-hex-notes", "Pre Hex Notes"),
      importedTurns: [],
      orderDrafts: [],
      regionSightings: [],
      mergedReports: []
      // No hexNotes key at all — the field did not exist yet.
    });

    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const restored = (await adapter.importGame(backup, "2026-08-01T09:00:00Z")) as {
      databasePath: string;
    };

    expect(await adapter.listHexNotes(restored.databasePath, "pre-hex-notes")).toEqual([]);
  });

  it("refuses a backup file from a newer format version", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    // No exportedAt: the envelope is judged before the body, so a future-version file is refused
    // for its version even when its body is also incomplete.
    const backup = JSON.stringify({
      format: "atlantis-hud-game-backup",
      version: 99
    });

    await expect(adapter.importGame(backup, "2026-08-01T09:00:00Z")).rejects.toThrow(
      /newer than this build supports/u
    );
  });

  it("refuses a file that is not a backup, and says so", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await expect(
      adapter.importGame(JSON.stringify({ hello: 1 }), "2026-08-01T09:00:00Z")
    ).rejects.toThrow(/not an Atlantis HUD game export/u);
    await expect(adapter.importGame("not json", "2026-08-01T09:00:00Z")).rejects.toThrow(
      /not valid JSON/u
    );
  });

  it("refuses a remembered region whose payload does not match its row", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const backup = JSON.stringify({
      format: "atlantis-hud-game-backup",
      version: 1,
      exportedAt: "2026-08-01T09:00:00Z",
      manifest: manifest("mismatched", "Mismatched"),
      importedTurns: [],
      orderDrafts: [],
      regionSightings: [
        {
          factionId: "17",
          regionId: "1:7,53",
          lastSeenTurn: 12,
          payloadJson: JSON.stringify({
            regionId: "9:9,9",
            coordinate: { x: 9, y: 9, z: 9 },
            terrain: "plain",
            province: "P"
          })
        }
      ],
      mergedReports: []
    });

    await expect(adapter.importGame(backup, "2026-08-01T09:00:00Z")).rejects.toThrow(
      /does not match its payload id/u
    );
  });
});
