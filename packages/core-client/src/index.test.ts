import { describe, expect, it } from "vitest";
import { createCoreClient, createTauriAdapter, createWasmAdapter, type TauriInvoke, type WasmBindings } from "./index";

describe("core client adapter contract parity", () => {
  it("normalizes tauri and wasm responses into the same GameInfo contract", async () => {
    const wasmBindings: WasmBindings = {
      get_game_info() {
        return {
          id: "atlantis",
          name: "Atlantis PBEM",
          ruleset_version: "4.0",
          max_faction_count: 128
        };
      }
    };

    const invoke: TauriInvoke = async <T>() =>
      Promise.resolve({
        id: "atlantis",
        name: "Atlantis PBEM",
        rulesetVersion: "4.0",
        maxFactionCount: 128
      } as T);

    const wasmClient = createCoreClient(createWasmAdapter(wasmBindings));
    const tauriClient = createCoreClient(createTauriAdapter(invoke));

    await expect(wasmClient.getGameInfo()).resolves.toEqual({
      id: "atlantis",
      name: "Atlantis PBEM",
      rulesetVersion: "4.0",
      maxFactionCount: 128
    });

    await expect(tauriClient.getGameInfo()).resolves.toEqual(await wasmClient.getGameInfo());
  });

  it("fails fast on invalid adapter payload", async () => {
    const invoke: TauriInvoke = async <T>() => Promise.resolve({ id: "atlantis" } as T);
    const client = createCoreClient(createTauriAdapter(invoke));

    await expect(client.getGameInfo()).rejects.toThrow("incomplete game info payload");
  });
});
