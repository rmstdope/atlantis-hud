import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readReport } from "@atlantis/fixtures";
import type { ImportedTurnSummary } from "@atlantis/core-client";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core's `import_writes` rather than the routing stand-in used
 * elsewhere in this package (see `fakeWasm` in webCoreAdapter.test.ts). Those tests are about how
 * the adapter routes between the core and storage; this file is about the two rules themselves as
 * a browser user meets them - the same rules `crates/core/src/report/import.rs` pins in Rust.
 */
const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");
const FACTION_ID = "95";
const BORG_TURN_17 = readReport("g7f62t17");
const BORG_TURN_18 = readReport("g7f62t18");

async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

function manifest() {
  return {
    manifestVersion: 1,
    metadata: { gameId: "alpha", gameName: "Alpha", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-01T09:00:00Z"
  };
}

describe("what a report import writes, across the WebAssembly boundary", () => {
  it("an older report never overwrites a newer memory of a hex", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const opened = (await adapter.createGame(manifest())) as { databasePath: string };

    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      TURN_71,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      TURN_70,
      null,
      false,
      "2026-08-01T11:00:00Z"
    );

    const remembered = (await adapter.loadRegionSightings(
      opened.databasePath,
      "alpha",
      FACTION_ID
    )) as Array<{ region: { regionId?: string }; lastSeenTurn: number }>;
    expect(remembered).toHaveLength(11);
    const shared = remembered.find((entry) => entry.region.regionId === "1:10,50");
    expect(shared?.lastSeenTurn).toBe(71);
  });

  it("a newer report replaces the older memory of a hex", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const opened = (await adapter.createGame(manifest())) as { databasePath: string };

    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      TURN_70,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      TURN_71,
      null,
      false,
      "2026-08-01T11:00:00Z"
    );

    const remembered = (await adapter.loadRegionSightings(
      opened.databasePath,
      "alpha",
      FACTION_ID
    )) as Array<{ region: { regionId?: string }; lastSeenTurn: number }>;
    expect(remembered).toHaveLength(11);
    const shared = remembered.find((entry) => entry.region.regionId === "1:10,50");
    expect(shared?.lastSeenTurn).toBe(71);
  });

  it("persists a transferred retained unit under its receiving faction", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const opened = (await adapter.createGame(manifest())) as { databasePath: string };

    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      "62",
      BORG_TURN_17,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      "62",
      BORG_TURN_18,
      null,
      false,
      "2026-08-01T11:00:00Z"
    );

    const remembered = (await adapter.loadRegionSightings(opened.databasePath, "alpha", "62")) as Array<{
      region: { regionId: string; units: Array<{ unitId: string; factionId?: string; factionName?: string; own: boolean }> };
      lastSeenTurn: number;
    }>;
    const retained = remembered.find((entry) => entry.region.regionId === "1:42,80");
    const unit = retained?.region.units.find((entry) => entry.unitId === "7124");

    expect(retained?.lastSeenTurn).toBe(17);
    expect(unit).toMatchObject({ factionId: "34", factionName: "Queen XOT", own: false });
  });

  it("a re-imported turn keeps when it first arrived", async () => {
    const wasm = await realCore();
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const opened = (await adapter.createGame(manifest())) as { databasePath: string };

    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      TURN_71,
      null,
      false,
      "2026-08-01T10:00:00Z"
    );
    await adapter.commitReportImport(
      opened.databasePath,
      "alpha",
      FACTION_ID,
      TURN_71,
      null,
      true,
      "2026-08-02T10:00:00Z"
    );

    const listed = (await adapter.listImportedTurns(
      opened.databasePath,
      "alpha"
    )) as ImportedTurnSummary[];
    expect(listed).toHaveLength(1);
    expect(listed[0]?.importedAt).toBe("2026-08-01T10:00:00Z");
    expect(listed[0]?.updatedAt).toBe("2026-08-02T10:00:00Z");
  });
});
