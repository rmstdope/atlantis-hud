import { describe, expect, it } from "vitest";
import { createCoreWasmModuleDouble } from "./coreWasmModuleDouble";

describe("createCoreWasmModuleDouble", () => {
  it("accepts narrow stubs and names an unstubbed export when reached", () => {
    const wasm = createCoreWasmModuleDouble({
      query: (name: string) => ({ id: "atlantis", asked: name })
    });

    expect(wasm.query("get_engine_info", [])).toEqual({ id: "atlantis", asked: "get_engine_info" });
    expect(() => wasm.parse_report_state("report")).toThrow(
      'CoreWasmModule test double has no stub for "parse_report_state"'
    );
  });
});
