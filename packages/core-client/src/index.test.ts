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
    const orderValidationPayload = {
      diagnostics: [
        {
          code: "unknown-command",
          message: "unknown order command",
          line_start: 1,
          line_end: 1,
          severity: "error"
        },
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          line_start: 2,
          line_end: 2,
          severity: "warning"
        }
      ]
    };
    const orderDraftPayload = {
      key: {
        game_id: "faction-12",
        faction_id: "17",
        turn_number: 12
      },
      order_text: "MOVE U100 R2",
      updated_at: "2026-08-07T12:00:00Z"
    };
    const importedTurnPayload = {
      key: {
        game_id: "faction-12",
        faction_id: "17",
        turn_number: 12
      },
      raw_report: "TURN: 12 Spring\nFACTION: 17 | Crimson Tide\nREGION: A1 | Coast of Dawn",
      parse_result: parsePayload
    };
    const openedGamePayload = {
      game_file_path: "/tmp/campaign.atlantis-game.json",
      database_path: "/tmp/campaign.atlantis-game.sqlite",
      schema_version: 2,
      manifest: {
        manifest_version: 1,
        metadata: {
          game_id: "faction-12",
          game_name: "Faction 12",
          ruleset_id: "neworigins"
        },
        report_sources: [
          {
            source_id: "turn-12-report",
            label: "Turn 12 report"
          }
        ],
        created_at: "2026-08-01T09:00:00Z",
        last_opened_at: "2026-08-09T18:00:00Z"
      }
    };

    // The planner's answer is the same object shape on both transports: the core serializes it
    // once and neither adapter reshapes it. Pinning it here is what stops one of them drifting.
    const planPayload = {
      plan: {
        from: { x: 7, y: 53, z: 1 },
        to: { x: 7, y: 51, z: 1 },
        mode: "walk",
        steps: [
          {
            direction: "north",
            to: { x: 7, y: 51, z: 1 },
            terrain: "mountain",
            cost: 2,
            road: false
          }
        ],
        totalCost: 2,
        months: [{ month: 1, steps: 1, endsAt: { x: 7, y: 51, z: 1 } }]
      },
      problem: null,
      risk: {
        level: "medium",
        worst: null,
        hexes: []
      },
      fullyModelled: false
    };

    const wasmBindings: WasmBindings = {
      get_engine_info() {
        return {
          id: "atlantis",
          name: "Atlantis PBEM",
          ruleset_version: "4.0",
          max_faction_count: 128
        };
      },
      create_game_state() {
        return openedGamePayload;
      },
      list_games_state() {
        return [openedGamePayload.manifest];
      },
      delete_game_state() {
        return null;
      },
      open_game_state() {
        return openedGamePayload;
      },
      parse_report_full_state() {
      return { header: {}, regions: [], ordersTemplate: null };
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
      },
      validate_orders_state() {
        return orderValidationPayload;
      },
      load_imported_turn_state() {
        return importedTurnPayload;
      },
      load_latest_imported_turn_state() {
        return importedTurnPayload;
      },
      load_order_draft_state() {
        return orderDraftPayload;
      },
      parse_report_classified_state() {
        return { header: {}, regions: [], ordersTemplate: null };
      },
      plan_route_state() {
        return planPayload;
      },
      save_order_draft_state() {
        return orderDraftPayload;
      }
    };

    const invoke: TauriInvoke = async <T>(command: string) => {
      if (command === "parse_report_classified") {
        return Promise.resolve({ header: {}, regions: [], ordersTemplate: null } as T);
      }
      if (command === "plan_route") {
        return Promise.resolve(planPayload as T);
      }
      if (command === "list_games") {
        return Promise.resolve([
          {
            manifestVersion: 1,
            metadata: {
              gameId: "faction-12",
              gameName: "Faction 12",
              rulesetId: "neworigins"
            },
            reportSources: [{ sourceId: "turn-12-report", label: "Turn 12 report" }],
            createdAt: "2026-08-01T09:00:00Z",
            lastOpenedAt: "2026-08-09T18:00:00Z"
          }
        ] as T);
      }
      if (command === "delete_game") {
        return Promise.resolve(null as T);
      }
      if (command === "get_engine_info") {
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
      if (command === "validate_orders") {
        return Promise.resolve({
          diagnostics: [
            {
              code: "unknown-command",
              message: "unknown order command",
              lineStart: 1,
              lineEnd: 1,
              severity: "error"
            },
            {
              code: "extra-arguments",
              message: "extra arguments ignored for MOVE",
              lineStart: 2,
              lineEnd: 2,
              severity: "warning"
            }
          ]
        } as T);
      }
      if (command === "load_order_draft" || command === "save_order_draft") {
        return Promise.resolve({
          key: {
            gameId: "faction-12",
            factionId: "17",
            turnNumber: 12
          },
          orderText: "MOVE U100 R2",
          updatedAt: "2026-08-07T12:00:00Z"
        } as T);
      }
      // Both turn loads answer with the same record; only the question differs. The wasm side
      // returns the snake_case payload above, so this is where the casing must be bridged.
      if (command === "load_imported_turn" || command === "load_latest_imported_turn") {
        return Promise.resolve({
          key: {
            gameId: "faction-12",
            factionId: "17",
            turnNumber: 12
          },
          rawReport: "TURN: 12 Spring\nFACTION: 17 | Crimson Tide\nREGION: A1 | Coast of Dawn",
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
          }
        } as T);
      }
      return Promise.resolve({
        gameFilePath: "/tmp/campaign.atlantis-game.json",
        databasePath: "/tmp/campaign.atlantis-game.sqlite",
        schemaVersion: 2,
        manifest: {
          manifestVersion: 1,
          metadata: {
            gameId: "faction-12",
            gameName: "Faction 12",
            rulesetId: "neworigins"
          },
          reportSources: [
            {
              sourceId: "turn-12-report",
              label: "Turn 12 report"
            }
          ],
          createdAt: "2026-08-01T09:00:00Z",
          lastOpenedAt: "2026-08-09T18:00:00Z"
        }
      } as T);
    };

    const wasmClient = createCoreClient(createWasmAdapter(wasmBindings));
    const tauriClient = createCoreClient(createTauriAdapter(invoke));

    await expect(wasmClient.getEngineInfo()).resolves.toEqual(await tauriClient.getEngineInfo());

    // Game management crosses the same boundary as everything else, so it gets the same
    // treatment: one payload per transport, in that transport's own casing, normalized to one
    // answer. A game that lists differently on desktop and on web is two applications.
    const wasmGames = await wasmClient.listGames();
    expect(wasmGames).toEqual(await tauriClient.listGames());
    expect(wasmGames[0].metadata.rulesetId).toBe("neworigins");
    expect(wasmGames[0].lastOpenedAt).toBe("2026-08-09T18:00:00Z");

    await expect(wasmClient.createGame(wasmGames[0])).resolves.toEqual(
      await tauriClient.createGame(wasmGames[0])
    );
    await expect(wasmClient.openGame("faction-12", "2026-08-09T18:00:00Z")).resolves.toEqual(
      await tauriClient.openGame("faction-12", "2026-08-09T18:00:00Z")
    );
    await expect(wasmClient.deleteGame("faction-12")).resolves.toBeUndefined();
    await expect(tauriClient.deleteGame("faction-12")).resolves.toBeUndefined();

    // The planner's answer must be identical on both transports, down to the nested route and its
    // risk: the desktop and the browser plan the same move or one of them is lying.
    const wasmPlan = await wasmClient.planRoute("{}", "report", "[]", "18642", "1:7,51");
    const tauriPlan = await tauriClient.planRoute("{}", "report", "[]", "18642", "1:7,51");
    expect(wasmPlan).toEqual(tauriPlan);
    expect(wasmPlan.plan?.totalCost).toBe(2);
    expect(wasmPlan.plan?.steps[0].terrain).toBe("mountain");
    expect(wasmPlan.problem).toBeNull();
    expect(wasmPlan.fullyModelled).toBe(false);
    await expect(
      wasmClient.parseReport("TURN: 12 Spring\nFACTION: 17 | Crimson Tide\nREGION: R1 | Coast of Dawn")
    ).resolves.toEqual(await tauriClient.parseReport("same"));
    await expect(
      wasmClient.previewReportImport("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", "same")
    ).resolves.toEqual(
      await tauriClient.previewReportImport("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", "same")
    );
    await expect(
      wasmClient.commitReportImport(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        "same",
        true,
        "2026-08-09T18:00:00Z"
      )
    ).resolves.toEqual(
      await tauriClient.commitReportImport(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        "same",
        true,
        "2026-08-09T18:00:00Z"
      )
    );
    await expect(wasmClient.validateOrders("bad input")).resolves.toEqual(await tauriClient.validateOrders("bad input"));
    await expect(
      wasmClient.loadOrderDraft("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", 12)
    ).resolves.toEqual(
      await tauriClient.loadOrderDraft("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", 12)
    );
    await expect(
      wasmClient.saveOrderDraft(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        12,
        "MOVE U100 R2",
        "2026-08-07T12:00:00Z"
      )
    ).resolves.toEqual(
      await tauriClient.saveOrderDraft(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        12,
        "MOVE U100 R2",
        "2026-08-07T12:00:00Z"
      )
    );
    await expect(
      wasmClient.loadImportedTurn("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", 12)
    ).resolves.toEqual(
      await tauriClient.loadImportedTurn("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", 12)
    );
    // The turn a game reopens on must be the same record on both transports. It decides what the
    // player sees on launch, so a divergence here is two applications rather than one.
    const wasmLatest = await wasmClient.loadLatestImportedTurn(
      "/tmp/campaign.atlantis-game.sqlite",
      "faction-12"
    );
    expect(wasmLatest).toEqual(
      await tauriClient.loadLatestImportedTurn("/tmp/campaign.atlantis-game.sqlite", "faction-12")
    );
    expect(wasmLatest?.key).toEqual({ gameId: "faction-12", factionId: "17", turnNumber: 12 });
  });
});

/**
 * Merging an ally's report, across the same boundary as everything else.
 *
 * The argument names are asserted literally rather than through a helper. Tauri's commands are
 * declared `rename_all = "snake_case"`, so a camelCase key does not fail loudly - it arrives as a
 * missing argument, and the command answers as though the caller meant nothing by it.
 */
describe("merging an allied report", () => {
  const DB = "/tmp/campaign.atlantis-game.sqlite";

  const mergePayload = {
    turn_number: 71,
    merged_faction_id: "73",
    merged_faction_name: "Borg",
    merged_region_count: 3,
    new_region_count: 2
  };

  it("asks tauri to merge with the argument names its commands declare", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve(mergePayload as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).mergeReport(
      DB,
      "faction-95",
      "95",
      71,
      "the ally's report",
      "2026-08-10T18:30:00Z"
    );

    expect(calls).toEqual([
      {
        command: "merge_report",
        args: {
          database_path: DB,
          game_id: "faction-95",
          viewer_faction_id: "95",
          viewer_turn_number: 71,
          raw_report: "the ally's report",
          merged_at: "2026-08-10T18:30:00Z"
        }
      }
    ]);
  });

  it("asks tauri for merged reports by faction and turn", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve([] as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).loadMergedReports(DB, "faction-95", "95", 71);

    expect(calls).toEqual([
      {
        command: "load_merged_reports",
        args: {
          database_path: DB,
          game_id: "faction-95",
          faction_id: "95",
          turn_number: 71
        }
      }
    ]);
  });

  it("normalizes the outcome whichever casing it arrives in", async () => {
    const snake: TauriInvoke = <T,>() => Promise.resolve(mergePayload as T);
    const camel: TauriInvoke = <T,>() =>
      Promise.resolve({
        turnNumber: 71,
        mergedFactionId: "73",
        mergedFactionName: "Borg",
        mergedRegionCount: 3,
        newRegionCount: 2
      } as T);

    const merge = (invoke: TauriInvoke) =>
      createCoreClient(createTauriAdapter(invoke)).mergeReport(DB, "g", "95", 71, "r", "now");

    await expect(merge(snake)).resolves.toEqual({
      turnNumber: 71,
      mergedFactionId: "73",
      mergedFactionName: "Borg",
      mergedRegionCount: 3,
      newRegionCount: 2
    });
    expect(await merge(camel)).toEqual(await merge(snake));
  });

  // Strict on purpose: a count nobody can read would have the status line say the merge did
  // nothing while the database says otherwise.
  it("refuses an outcome it cannot read rather than reporting an empty merge", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve({ turn_number: 71 } as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).mergeReport(DB, "g", "95", 71, "r", "now")
    ).rejects.toThrow("incomplete report merge payload");
  });

  // Tolerant on purpose: a turn with nothing merged into it is the ordinary case.
  it("treats an unreadable list of merges as no merges", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve(null as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).loadMergedReports(DB, "g", "95", 71)
    ).resolves.toEqual([]);
  });

  it("refuses to merge through a wasm build with no persistence linked in", async () => {
    const bindings = {} as WasmBindings;

    expect(() => createWasmAdapter(bindings).mergeReport(DB, "g", "95", 71, "r", "now")).toThrow(
      "game persistence is not linked into this wasm build"
    );
    await expect(
      createCoreClient(createWasmAdapter(bindings)).loadMergedReports(DB, "g", "95", 71)
    ).resolves.toEqual([]);
  });
});
