import { describe, expect, it } from "vitest";
import { createCoreWasmModuleDouble } from "./coreWasmModuleDouble";

describe("createCoreWasmModuleDouble", () => {
  it("accepts narrow stubs and names an unstubbed export when reached", () => {
    const wasm = createCoreWasmModuleDouble({
      get_engine_info: () => ({
        id: "atlantis",
        name: "Atlantis PBEM",
        rulesetVersion: "4.0",
        maxFactionCount: 128
      })
    });

    expect(wasm.get_engine_info().id).toBe("atlantis");
    expect(() => wasm.parse_report_state("report")).toThrow(
      'CoreWasmModule test double has no stub for "parse_report_state"'
    );
  });
});
