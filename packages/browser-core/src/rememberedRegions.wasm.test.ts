import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core's `remembered_regions` rather than the routing stand-in used
 * in webCoreAdapter.test.ts. This file is about the rules themselves as a browser user meets them -
 * the same rules `crates/core/src/report/sighting.rs` pins in Rust (`ah-8z4y.3.2`).
 */
async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

async function remembering(
  rows: Array<{ regionId: string; lastSeenTurn: number; payloadJson: string }>
) {
  const store = createMemoryWebStore();
  await store.putRegionSightings(
    rows.map((row) => ({ databasePath: "/db", gameId: "alpha", factionId: "95", ...row }))
  );
  const adapter = createWebCoreAdapter(await realCore(), store);
  return (await adapter.loadRegionSightings("/db", "alpha", "95")) as Array<{
    region: Record<string, unknown>;
    lastSeenTurn: number;
  }>;
}

describe("the remembered map, across the WebAssembly boundary", () => {
  /**
   * The divergence this bead settles. A stored `null` is valid JSON, so hydrating one hex at a time
   * and catching a throw kept it - the browser handed the map a region that was not one, while the
   * desktop dropped it explicitly. The stricter behaviour is now the only one there is.
   */
  it("drops a hex whose stored payload is null", async () => {
    const remembered = await remembering([
      { regionId: "1:1,1", lastSeenTurn: 12, payloadJson: "null" },
      { regionId: "1:2,2", lastSeenTurn: 12, payloadJson: '{"regionId":"1:2,2"}' }
    ]);

    expect(remembered).toEqual([{ region: { regionId: "1:2,2" }, lastSeenTurn: 12 }]);
  });

  it("drops a hex whose stored payload will not parse and keeps the rest", async () => {
    const remembered = await remembering([
      { regionId: "1:1,1", lastSeenTurn: 12, payloadJson: "{not json" },
      { regionId: "1:2,2", lastSeenTurn: 12, payloadJson: '{"regionId":"1:2,2"}' }
    ]);

    expect(remembered).toHaveLength(1);
  });

  /** The order the browser never had: the desktop's own ORDER BY, now stated once in the core. */
  it("lists hexes newest first, then by region id", async () => {
    const remembered = await remembering([
      { regionId: "1:9,9", lastSeenTurn: 70, payloadJson: '{"regionId":"1:9,9"}' },
      { regionId: "1:1,1", lastSeenTurn: 71, payloadJson: '{"regionId":"1:1,1"}' },
      { regionId: "1:0,0", lastSeenTurn: 71, payloadJson: '{"regionId":"1:0,0"}' }
    ]);

    expect(remembered.map((hex) => hex.region.regionId)).toEqual(["1:0,0", "1:1,1", "1:9,9"]);
  });

  /** A hex remembered before `ah-nmts` reaches the map as one stored today. */
  it("back-fills a hex stored before the structure split", async () => {
    const remembered = await remembering([
      {
        regionId: "1:1,1",
        lastSeenTurn: 12,
        payloadJson: '{"regionId":"1:1,1","structures":[{"kind":"Mine"}]}'
      }
    ]);

    expect(remembered[0].region.structures).toEqual([
      { kind: "Mine", baseKind: "Mine", qualifiers: [], vessels: [] }
    ]);
  });
});
