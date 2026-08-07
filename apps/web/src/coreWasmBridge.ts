import type { WasmBindings } from "@atlantis/core-client";

type AtlantisWasmGlobal = {
  __ATLANTIS_CORE_WASM__?: WasmBindings;
};

export function resolveCoreWasmBindings(): WasmBindings {
  const bindings = (globalThis as AtlantisWasmGlobal).__ATLANTIS_CORE_WASM__;

  if (bindings && typeof bindings.get_game_info === "function") {
    return bindings;
  }

  return {
    get_game_info() {
      return {
        id: "atlantis",
        name: "Atlantis PBEM",
        ruleset_version: "4.0",
        max_faction_count: 128
      };
    }
  };
}
