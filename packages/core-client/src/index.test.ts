import { describe, expect, it } from "vitest";
import {
  createCoreClient,
  createTauriAdapter,
  createWasmAdapter,
  type TauriInvoke,
  type WasmBindings
} from "./index";

describe("core client adapter contract parity", () => {
  it("normalizes tauri and wasm responses into the same contracts", async () => {
    const parsePayload = {
      turn_header: {
        turn_number: 12,
        season: "Spring"
      },
      detected_factions: [
        {
          faction_id: "17",
          name: "Crimson Tide"
        }
      ],
      regions: [{ region_id: "R1", name: "Coast of Dawn" }],
      units: [{ unit_id: "U100", name: "Guard Patrol", region_id: "R1" }],
      inventories: [{ unit_id: "U100", item: "silver", quantity: 12 }],
      message_summaries: [{ kind: "order", source: "U100", text: "MOVE R2" }],
      warnings: [],
      meets_minimum_import_threshold: true
    };
    const reportPreviewPayload = {
      parse_result: parsePayload,
      duplicate_preview: {
        exists: false,
        raw_changed: false,
        parsed_changed: false,
        warnings_changed: false
      },
      turn_number: 12
    };
    const openedProjectPayload = {
      project_file_path: "/tmp/campaign.atlantis-project.json",
      database_path: "/tmp/campaign.atlantis-project.sqlite",
      schema_version: 2,
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
      },
      parse_report_state() {
        return parsePayload;
      },
      preview_report_import_state() {
        return reportPreviewPayload;
      },
      commit_report_import_state() {
        return {
          exists: true,
          raw_changed: false,
          parsed_changed: false,
          warnings_changed: false
        };
      }
    };

    const invoke: TauriInvoke = async <T>(command: string) => {
      if (command === "get_game_info") {
        return Promise.resolve({
          id: "atlantis",
          name: "Atlantis PBEM",
          rulesetVersion: "4.0",
          maxFactionCount: 128
        } as T);
      }
      if (command === "parse_report") {
        return Promise.resolve({
          turnHeader: {
            turnNumber: 12,
            season: "Spring"
          },
          detectedFactions: [
            {
              factionId: "17",
              name: "Crimson Tide"
            }
          ],
          regions: [{ regionId: "R1", name: "Coast of Dawn" }],
          units: [{ unitId: "U100", name: "Guard Patrol", regionId: "R1" }],
          inventories: [{ unitId: "U100", item: "silver", quantity: 12 }],
          messageSummaries: [{ kind: "order", source: "U100", text: "MOVE R2" }],
          warnings: [],
          meetsMinimumImportThreshold: true
        } as T);
      }
      if (command === "preview_report_import") {
        return Promise.resolve({
          parseResult: {
            turnHeader: {
              turnNumber: 12,
              season: "Spring"
            },
            detectedFactions: [
              {
                factionId: "17",
                name: "Crimson Tide"
              }
            ],
            regions: [{ regionId: "R1", name: "Coast of Dawn" }],
            units: [{ unitId: "U100", name: "Guard Patrol", regionId: "R1" }],
            inventories: [{ unitId: "U100", item: "silver", quantity: 12 }],
            messageSummaries: [{ kind: "order", source: "U100", text: "MOVE R2" }],
            warnings: [],
            meetsMinimumImportThreshold: true
          },
          duplicatePreview: {
            exists: false,
            rawChanged: false,
            parsedChanged: false,
            warningsChanged: false
          },
          turnNumber: 12
        } as T);
      }
      if (command === "commit_report_import") {
        return Promise.resolve({
          exists: true,
          rawChanged: false,
          parsedChanged: false,
          warningsChanged: false
        } as T);
      }
      return Promise.resolve({
        projectFilePath: "/tmp/campaign.atlantis-project.json",
        databasePath: "/tmp/campaign.atlantis-project.sqlite",
        schemaVersion: 2,
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

    await expect(wasmClient.getGameInfo()).resolves.toEqual(await tauriClient.getGameInfo());
    await expect(
      wasmClient.parseReport("TURN: 12 Spring\nFACTION: 17 | Crimson Tide\nREGION: R1 | Coast of Dawn")
    ).resolves.toEqual(await tauriClient.parseReport("same"));
    await expect(
      wasmClient.previewReportImport("/tmp/campaign.atlantis-project.sqlite", "faction-12", "17", "same")
    ).resolves.toEqual(
      await tauriClient.previewReportImport("/tmp/campaign.atlantis-project.sqlite", "faction-12", "17", "same")
    );
    await expect(
      wasmClient.commitReportImport("/tmp/campaign.atlantis-project.sqlite", "faction-12", "17", "same", true)
    ).resolves.toEqual(
      await tauriClient.commitReportImport("/tmp/campaign.atlantis-project.sqlite", "faction-12", "17", "same", true)
    );
  });
});
