import type { ProjectManifest, WasmBindings } from "@atlantis/core-client";

type AtlantisWasmGlobal = {
  __ATLANTIS_CORE_WASM__?: WasmBindings;
};

type OpenedProjectFallback = {
  projectFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: ProjectManifest;
};

const inMemoryProjects = new Map<string, OpenedProjectFallback>();

function resolveWebDatabasePath(projectFilePath: string): string {
  const canUseOpfs =
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function";

  const stem = projectFilePath.replace(/\.json$/u, "");
  if (canUseOpfs) {
    return `opfs://${stem}.sqlite`;
  }

  return `memory://${stem}.sqlite`;
}

export function resolveCoreWasmBindings(): WasmBindings {
  const bindings = (globalThis as AtlantisWasmGlobal).__ATLANTIS_CORE_WASM__;

  if (
    bindings &&
    typeof bindings.get_game_info === "function" &&
    typeof bindings.create_project_state === "function" &&
    typeof bindings.open_project_state === "function"
  ) {
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
    },
    create_project_state(projectFilePath: string, manifest: ProjectManifest) {
      const opened = {
        projectFilePath,
        databasePath: resolveWebDatabasePath(projectFilePath),
        schemaVersion: 1,
        manifest
      };
      inMemoryProjects.set(projectFilePath, opened);
      return opened;
    },
    open_project_state(projectFilePath: string) {
      const opened = inMemoryProjects.get(projectFilePath);
      if (!opened) {
        throw new Error(`project not found: ${projectFilePath}`);
      }
      return opened;
    }
  };
}
