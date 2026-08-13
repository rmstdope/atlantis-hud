import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCoreClient } from "@atlantis/core-client";
import { createWebCoreAdapter } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core rather than a stand-in.
 *
 * The unit tests elsewhere in this package use a fake module, because they are about how the
 * adapter routes between logic and storage. This one is about the boundary itself: that the Rust
 * model crosses into TypeScript with the shape the types promise.
 */
const REPORT = readFileSync(
  new URL("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep", import.meta.url),
  "utf8"
);

async function realCore() {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as Parameters<typeof createWebCoreAdapter>[0];
}

describe("the full model across the WebAssembly boundary", () => {
  it("delivers regions, units and the orders template to TypeScript", async () => {
    // Through the typed client, so the test also proves the declared contract holds.
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));

    const parsed = await client.parseReportFull(REPORT);

    expect(parsed.header.factionName).toBe("Borg TNG");
    expect(parsed.header.turnNumber).toBe(71);
    expect(parsed.regions).toHaveLength(11);

    const inholm = parsed.regions.find((region) => region.regionId === "1:7,53");
    expect(inholm?.settlement?.name).toBe("Inholm");
    expect(inholm?.coordinate).toEqual({ x: 7, y: 53, z: 1 });
    expect(inholm?.structures).toHaveLength(24);
    expect(inholm?.units).toHaveLength(92);

    // Ownership survives the crossing, which is what the read-only orders rule depends on.
    const own = inholm?.units.filter((unit) => unit.own) ?? [];
    expect(own.map((unit) => unit.unitId)).toEqual(["18642"]);
    expect(own[0]?.skills.some((skill) => skill.tag === "STEA")).toBe(true);

    expect(parsed.ordersTemplate?.units).toHaveLength(27);
    expect(parsed.ordersTemplate?.text.startsWith("#atlantis 95 ")).toBe(true);

    // Battles are the one part of this model with a nested struct of its own, which does not
    // inherit the outer `#[serde(rename_all = "camelCase")]` - so this is the only place a naming
    // mismatch (e.g. `line_start` crossing over unrenamed) could be caught.
    expect(parsed.battles).toHaveLength(2);
    const first = parsed.battles[0];
    expect(first?.defender?.name).toBe("Pirates");
    expect(first?.terrain).toBe("ocean");
    expect(first?.coordinate).toEqual({ x: 25, y: 55, z: 1 });
    expect(first?.damagedUnits).toEqual(["14789"]);
    expect(first?.lineStart).toBeGreaterThan(0);
    expect(first?.lineEnd).toBeGreaterThan(first?.lineStart ?? 0);
  });

  it("renders optional fields as null rather than undefined", async () => {
    // Rust's None must arrive as null, or every `=== null` check on this side silently fails.
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));
    const parsed = await client.parseReportFull(REPORT);

    const ocean = parsed.regions.find((region) => region.terrain === "ocean");
    expect(ocean?.settlement).toBeNull();
    expect(ocean?.population).toBeNull();
  });
});
