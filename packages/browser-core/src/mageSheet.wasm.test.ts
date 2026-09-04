import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * The browser road to `export_mage_sheet`, through the real WebAssembly core rather than the
 * routing stand-in: the shell hands raw report text and a list of unit ids across, and gets the
 * file back as text to save (`ah-lyg6.1.1`).
 */
async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

const REPORT = [
  "Atlantis Report For:",
  "Borg (21) (Magic 5)",
  "December, Year 6",
  "",
  "plain (3,7) in Isaen, 1200 peasants (humans), $600.",
  "------------------------------------------------------------",
  "  Wages: $12.5 (Max: $400).",
  "",
  "* Woodsman (300), Borg (21), behind, 2 leaders [LEAD]. Skills: lumberjack [LUMB] 2 (90).",
  "* Outdoor Mage (301), Borg (21), behind, 1 leader [LEAD]. Skills: force [FORC] 3 (180).",
  ""
].join("\n");

describe("a mage sheet, across the WebAssembly boundary", () => {
  it("writes the named mage behind the marker line and leaves the rest of the hex out", async () => {
    const adapter = createWebCoreAdapter(await realCore(), createMemoryWebStore());

    const text = await adapter.exportMageSheet(REPORT, JSON.stringify(["301"]));

    expect(text.startsWith("; Mage sheet from Atlantis HUD")).toBe(true);
    expect(text).toContain("Outdoor Mage (301)");
    expect(text).toContain("force [FORC] 3 (180)");
    expect(text).not.toContain("Woodsman");
    expect(text).not.toContain("Wages:");
  });
});
