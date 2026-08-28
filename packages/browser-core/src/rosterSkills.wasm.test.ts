import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readReport } from "@atlantis/fixtures";
import { createCoreClient } from "@atlantis/core-client";
import { createWebCoreAdapter } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Exercises the real WebAssembly core rather than a stand-in.
 *
 * `CoreWasmModule` declares `roster_skills_state`'s return type and nothing re-validates it at
 * runtime (`docs/adapter-api.md`), so this is the one test that proves the declaration is not a
 * lie.
 */
const REPORT = readReport("g7f95t71");

async function realCore() {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as Parameters<typeof createWebCoreAdapter>[0];
}

describe("the battle rosters' combat skills across the WebAssembly boundary", () => {
  it("delivers each roster entry's skills to TypeScript", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));

    const disclosed = await client.rosterSkills(REPORT);

    // Watazka's real roster line in this turn ends `riding 5, combat 2, longbow 4`.
    const watazka = disclosed.find((entry) => entry.unitId === "4839");
    expect(watazka?.unitName).toBe("Watazka");
    expect(watazka?.skills).toEqual([
      { name: "riding", level: 5 },
      { name: "combat", level: 2 },
      { name: "longbow", level: 4 }
    ]);

    // The serde rename survives the crossing: `unit_id` arriving unrenamed would leave every
    // `unitId` above undefined, and the whole `find` would miss.
    expect(watazka?.terrain).toBe("ocean");
    expect(watazka?.coordinate).toEqual({ x: 25, y: 55, z: 1 });
  });
});
