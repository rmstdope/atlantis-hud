import { describe, expect, it } from "vitest";
import { createCoreClient, createTauriAdapter, createWasmAdapter, type TauriInvoke, type WasmBindings } from "./index";

describe("core client adapter contract parity", () => {
  it("normalizes tauri and wasm responses into the same GameInfo contract", async () => {
    const openedProjectPayload = {
      project_file_path: "/tmp/campaign.atlantis-project.json",
      database_path: "/tmp/campaign.atlantis-project.sqlite",
      schema_version: 1,
      manifest: {
        manifest_version: 1,
        metadata: {
          project_id: "faction-12",
          project_name: "Faction 12"
        },
        report_sources: [
          {
            source_id: "turn-12-report",
            label: "Turn 12 report"
          }
        ]
      }
    };

    const wasmBindings: WasmBindings = {
      get_game_info() {
        return {
          id: "atlantis",
          name: "Atlantis PBEM",
          ruleset_version: "4.0",
          max_faction_count: 128
        };
      },
      create_project_state() {
        return openedProjectPayload;
      },
      open_project_state() {
        return openedProjectPayload;
      }
    };

    const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      invocations.push({ command, args });

      if (command === "get_game_info") {
        return Promise.resolve({
          id: "atlantis",
          name: "Atlantis PBEM",
          rulesetVersion: "4.0",
          maxFactionCount: 128
        } as T);
      }

      return Promise.resolve({
        projectFilePath: "/tmp/campaign.atlantis-project.json",
        databasePath: "/tmp/campaign.atlantis-project.sqlite",
        schemaVersion: 1,
        manifest: {
          manifestVersion: 1,
          metadata: {
            projectId: "faction-12",
            projectName: "Faction 12"
          },
          reportSources: [
            {
              sourceId: "turn-12-report",
              label: "Turn 12 report"
            }
          ]
        }
      } as T);
    };

    const wasmClient = createCoreClient(createWasmAdapter(wasmBindings));
    const tauriClient = createCoreClient(createTauriAdapter(invoke));

    await expect(wasmClient.getGameInfo()).resolves.toEqual({
      id: "atlantis",
      name: "Atlantis PBEM",
      rulesetVersion: "4.0",
      maxFactionCount: 128
    });

    await expect(tauriClient.getGameInfo()).resolves.toEqual(await wasmClient.getGameInfo());

    await expect(
      wasmClient.createProject("/tmp/campaign.atlantis-project.json", {
        manifestVersion: 1,
        metadata: {
          projectId: "faction-12",
          projectName: "Faction 12"
        },
        reportSources: [
          {
            sourceId: "turn-12-report",
            label: "Turn 12 report"
          }
        ]
      })
    ).resolves.toEqual({
      projectFilePath: "/tmp/campaign.atlantis-project.json",
      databasePath: "/tmp/campaign.atlantis-project.sqlite",
      schemaVersion: 1,
      manifest: {
        manifestVersion: 1,
        metadata: {
          projectId: "faction-12",
          projectName: "Faction 12"
        },
        reportSources: [
          {
            sourceId: "turn-12-report",
            label: "Turn 12 report"
          }
        ]
      }
    });

    await expect(
      tauriClient.createProject("/tmp/campaign.atlantis-project.json", {
        manifestVersion: 1,
        metadata: {
          projectId: "faction-12",
          projectName: "Faction 12"
        },
        reportSources: [
          {
            sourceId: "turn-12-report",
            label: "Turn 12 report"
          }
        ]
      })
    ).resolves.toEqual(await wasmClient.createProject("/tmp/campaign.atlantis-project.json", {
      manifestVersion: 1,
      metadata: {
        projectId: "faction-12",
        projectName: "Faction 12"
      },
      reportSources: [
        {
          sourceId: "turn-12-report",
          label: "Turn 12 report"
        }
      ]
    }));

    await expect(tauriClient.openProject("/tmp/campaign.atlantis-project.json")).resolves.toEqual(
      await wasmClient.openProject("/tmp/campaign.atlantis-project.json")
    );

    expect(invocations).toContainEqual({
      command: "create_project",
      args: {
        project_file_path: "/tmp/campaign.atlantis-project.json",
        manifest: {
          manifestVersion: 1,
          metadata: {
            projectId: "faction-12",
            projectName: "Faction 12"
          },
          reportSources: [
            {
              sourceId: "turn-12-report",
              label: "Turn 12 report"
            }
          ]
        }
      }
    });
    expect(invocations).toContainEqual({
      command: "open_project",
      args: {
        project_file_path: "/tmp/campaign.atlantis-project.json"
      }
    });
  });

  it("fails fast on invalid adapter payload", async () => {
    const invoke: TauriInvoke = async <T>(command: string) => {
      if (command === "get_game_info") {
        return Promise.resolve({ id: "atlantis" } as T);
      }

      return Promise.resolve({ manifest: {} } as T);
    };
    const client = createCoreClient(createTauriAdapter(invoke));

    await expect(client.getGameInfo()).rejects.toThrow("incomplete game info payload");
    await expect(client.openProject("/tmp/campaign.atlantis-project.json")).rejects.toThrow(
      "incomplete opened project payload"
    );
  });
});
