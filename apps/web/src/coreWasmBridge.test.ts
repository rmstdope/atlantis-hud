import { afterEach, describe, expect, it } from "vitest";
import { resolveCoreWasmBindings } from "./coreWasmBridge";

describe("resolveCoreWasmBindings", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __ATLANTIS_CORE_WASM__?: unknown }).__ATLANTIS_CORE_WASM__;
  });

  it("provides in-memory project persistence even when wasm bindings are partially present", () => {
    (globalThis as typeof globalThis & {
      __ATLANTIS_CORE_WASM__?: { get_game_info(): unknown };
    }).__ATLANTIS_CORE_WASM__ = {
      get_game_info() {
        return {
          id: "atlantis",
          name: "Atlantis PBEM",
          ruleset_version: "4.0",
          max_faction_count: 128
        };
      }
    };

    const bindings = resolveCoreWasmBindings();
    expect(bindings.get_game_info()).toEqual({
      id: "atlantis",
      name: "Atlantis PBEM",
      ruleset_version: "4.0",
      max_faction_count: 128
    });

    const created = bindings.create_project_state("/tmp/example.atlantis-project.json", {
      manifestVersion: 1,
      metadata: {
        projectId: "faction-1",
        projectName: "Faction 1"
      },
      reportSources: [
        {
          sourceId: "turn-1",
          label: "Turn 1"
        }
      ]
    });

    expect(created).toEqual({
      projectFilePath: "/tmp/example.atlantis-project.json",
      databasePath: "memory:///tmp/example.atlantis-project.sqlite",
      schemaVersion: 2,
      manifest: {
        manifestVersion: 1,
        metadata: {
          projectId: "faction-1",
          projectName: "Faction 1"
        },
        reportSources: [
          {
            sourceId: "turn-1",
            label: "Turn 1"
          }
        ]
      }
    });

    expect(bindings.open_project_state("/tmp/example.atlantis-project.json")).toEqual(created);
  });
});
