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
          column_start: 0,
          column_end: 3,
          severity: "error"
        },
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          line_start: 2,
          line_end: 2,
          column_start: 5,
          column_end: 9,
          severity: "warning"
        }
      ]
    };
    // Both transports hand back the core's own list, so parity here is the two agreeing about it.
    const orderVocabulary = ["GIVE", "MOVE", "WORK"];
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
    const importedTurnSummaryPayload = [
      {
        key: {
          game_id: "faction-12",
          faction_id: "17",
          turn_number: 12
        },
        season: "Spring",
        imported_at: "2026-08-01T10:00:00Z",
        updated_at: "2026-08-01T10:00:00Z"
      }
    ];
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

    // A traced order rides the same wire shape as a planned route's pieces, with the path
    // optional and the mode nullable for a unit whose speed is unknown.
    const tracePayload = {
      path: {
        from: { x: 7, y: 53, z: 1 },
        steps: [
          {
            direction: "north",
            to: { x: 7, y: 51, z: 1 },
            terrain: "mountain",
            cost: 2,
            road: false
          }
        ],
        months: [{ month: 1, steps: 1, endsAt: { x: 7, y: 51, z: 1 } }],
        mode: "walk",
        blockedFrom: null
      }
    };

    const previewPayload = {
      regions: [
        {
          regionId: "1:7,53",
          units: [
            {
              unit: {
                unitId: "18642",
                name: "Nine of Eight",
                regionId: "1:7,53",
                factionId: "95",
                factionName: "Foo",
                own: true,
                onGuard: true,
                flags: ["guarding"],
                items: [],
                skills: [],
                men: 1,
                menEstimated: false,
                menByRace: [],
                weight: 10,
                capacity: "0/0/15/0",
                structureId: null
              },
              status: "departing",
              changes: [{ field: "name", original: "Seven of Eight" }],
              arrivingFrom: null,
              departingTo: "1:7,51"
            }
          ]
        }
      ]
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
      order_commands_state() {
        return orderVocabulary;
      },
      load_imported_turn_state() {
        return importedTurnPayload;
      },
      load_latest_imported_turn_state() {
        return importedTurnPayload;
      },
      list_imported_turns_state() {
        return importedTurnSummaryPayload;
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
      export_map_state() {
        return "; Map export from Atlantis HUD\n";
      },
      trace_move_orders_state() {
        return tracePayload;
      },
      preview_orders_state() {
        return previewPayload;
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
      if (command === "trace_move_orders") {
        return Promise.resolve(tracePayload as T);
      }
      if (command === "preview_orders") {
        return Promise.resolve(previewPayload as T);
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
      if (command === "order_commands") {
        return Promise.resolve(orderVocabulary as T);
      }
      if (command === "validate_orders") {
        return Promise.resolve({
          diagnostics: [
            {
              code: "unknown-command",
              message: "unknown order command",
              lineStart: 1,
              lineEnd: 1,
              columnStart: 0,
              columnEnd: 3,
              severity: "error"
            },
            {
              code: "extra-arguments",
              message: "extra arguments ignored for MOVE",
              lineStart: 2,
              lineEnd: 2,
              columnStart: 5,
              columnEnd: 9,
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
      if (command === "list_imported_turns") {
        return Promise.resolve([
          {
            key: {
              gameId: "faction-12",
              factionId: "17",
              turnNumber: 12
            },
            season: "Spring",
            importedAt: "2026-08-01T10:00:00Z",
            updatedAt: "2026-08-01T10:00:00Z"
          }
        ] as T);
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

    // A traced order must come back identically on both transports too, for the same reason.
    const wasmTrace = await wasmClient.traceMoveOrders("{}", "report", "[]", "18642", "MOVE N");
    const tauriTrace = await tauriClient.traceMoveOrders("{}", "report", "[]", "18642", "MOVE N");
    expect(wasmTrace).toEqual(tauriTrace);
    expect(wasmTrace.path?.steps[0].terrain).toBe("mountain");
    expect(wasmTrace.path?.months[0].endsAt).toEqual({ x: 7, y: 51, z: 1 });
    expect(wasmTrace.path?.mode).toBe("walk");

    // The orders preview must come back identically on both transports as well: the table shows
    // the coming month, and the desktop and the browser must show the same one.
    const wasmPreview = await wasmClient.previewOrders("{}", "report", "[]", "orders");
    const tauriPreview = await tauriClient.previewOrders("{}", "report", "[]", "orders");
    expect(wasmPreview).toEqual(tauriPreview);
    expect(wasmPreview.regions[0].units[0].status).toBe("departing");
    expect(wasmPreview.regions[0].units[0].unit.name).toBe("Nine of Eight");
    expect(wasmPreview.regions[0].units[0].changes[0]).toEqual({
      field: "name",
      original: "Seven of Eight"
    });
    expect(wasmPreview.regions[0].units[0].departingTo).toBe("1:7,51");
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
        null,
        true,
        "2026-08-09T18:00:00Z"
      )
    ).resolves.toEqual(
      await tauriClient.commitReportImport(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        "same",
        null,
        true,
        "2026-08-09T18:00:00Z"
      )
    );
    await expect(wasmClient.validateOrders("bad input", null)).resolves.toEqual(
      await tauriClient.validateOrders("bad input", null)
    );
    await expect(wasmClient.orderCommands()).resolves.toEqual(await tauriClient.orderCommands());
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
    await expect(
      wasmClient.listImportedTurns("/tmp/campaign.atlantis-game.sqlite", "faction-12")
    ).resolves.toEqual(
      await tauriClient.listImportedTurns("/tmp/campaign.atlantis-game.sqlite", "faction-12")
    );
  });

  /**
   * A sea route rides the same wire shape as a land one, and the refusal it can carry - a crew
   * short of the sailing skill a fleet needs - is a new `RouteProblem` kind, not a new shape.
   * Pinned separately from the giant parity test above so a change to that test's many payloads
   * cannot hide a regression here.
   */
  it("carries a sail plan and a crew refusal identically on both transports", async () => {
    const sailPlanPayload = {
      plan: {
        from: { x: 49, y: 3, z: 1 },
        to: { x: 49, y: 5, z: 1 },
        mode: "sail",
        steps: [
          {
            direction: "south",
            to: { x: 49, y: 5, z: 1 },
            terrain: "ocean",
            cost: 1,
            road: false
          }
        ],
        totalCost: 1,
        months: [{ month: 1, steps: 1, endsAt: { x: 49, y: 5, z: 1 } }]
      },
      problem: null,
      risk: { level: "low", worst: null, hexes: [] },
      fullyModelled: false
    };
    const crewRefusalPayload = {
      plan: null,
      problem: { kind: "crewCannotSail", required: 4, available: 1 },
      risk: null,
      fullyModelled: false
    };

    const bindings = {
      plan_route_state(
        _rulesetJson: string,
        _rawReport: string,
        _rememberedJson: string,
        unitId: string
      ) {
        return unitId === "crewed" ? sailPlanPayload : crewRefusalPayload;
      }
    } as unknown as WasmBindings;
    const invoke: TauriInvoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "plan_route") {
        return Promise.resolve(
          (args?.unit_id === "crewed" ? sailPlanPayload : crewRefusalPayload) as T
        );
      }
      throw new Error(`unexpected command ${command}`);
    };

    const wasmClient = createCoreClient(createWasmAdapter(bindings));
    const tauriClient = createCoreClient(createTauriAdapter(invoke));

    const wasmSail = await wasmClient.planRoute("{}", "report", "[]", "crewed", "1:49,5");
    const tauriSail = await tauriClient.planRoute("{}", "report", "[]", "crewed", "1:49,5");
    expect(wasmSail).toEqual(tauriSail);
    expect(wasmSail.plan?.mode).toBe("sail");
    expect(wasmSail.problem).toBeNull();

    const wasmRefusal = await wasmClient.planRoute("{}", "report", "[]", "undercrewed", "1:49,5");
    const tauriRefusal = await tauriClient.planRoute("{}", "report", "[]", "undercrewed", "1:49,5");
    expect(wasmRefusal).toEqual(tauriRefusal);
    expect(wasmRefusal.plan).toBeNull();
    expect(wasmRefusal.problem).toEqual({ kind: "crewCannotSail", required: 4, available: 1 });
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

  /**
   * The ruleset is what turns an unrecognised item name into a warning, so a mistyped key would
   * deserialize as `None` on the Rust side without an error and quietly stop every item from being
   * checked. Only the key names catch that.
   */
  it("asks tauri to validate with the argument names its command declares", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve({ diagnostics: [] } as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).validateOrders(
      "@work",
      "the ruleset its items are checked against",
      "the report the orders were written for",
      { warnOnUnguardedHex: true }
    );

    expect(calls).toEqual([
      {
        command: "validate_orders",
        args: {
          raw_orders: "@work",
          ruleset_json: "the ruleset its items are checked against",
          raw_report: "the report the orders were written for",
          warn_on_unguarded_hex: true
        }
      }
    ]);
  });

  /**
   * Before a report is imported there is nothing to check the orders against, and the pane still
   * has to validate what is being typed. The report and the options are therefore optional, and
   * their absence has to reach the core as an absence rather than as a mistyped key.
   */
  it("validates without a report, which is what the pane does before an import", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const invoke: TauriInvoke = <T,>(_command: string, args?: Record<string, unknown>) => {
      calls.push(args);
      return Promise.resolve({ diagnostics: [] } as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).validateOrders("@work", null);

    expect(calls).toEqual([
      {
        raw_orders: "@work",
        ruleset_json: null,
        raw_report: null,
        warn_on_unguarded_hex: false
      }
    ]);
  });

  it("carries the column span a diagnostic points at, in either casing", async () => {
    const snake: TauriInvoke = <T,>() =>
      Promise.resolve({
        diagnostics: [
          {
            code: "bad-argument",
            message: 'expected a number, found "swords"',
            line_start: 2,
            line_end: 2,
            column_start: 10,
            column_end: 16,
            severity: "error"
          }
        ]
      } as T);

    const result = await createCoreClient(createTauriAdapter(snake)).validateOrders("x", null);

    expect(result.diagnostics[0].columnStart).toBe(10);
    expect(result.diagnostics[0].columnEnd).toBe(16);
    expect(result.diagnostics[0].regionId).toBeNull();
    expect(result.diagnostics[0].unitId).toBeNull();
  });

  /**
   * A semantic finding carries the hex and the unit instead of, or as well as, a line. "Nobody is
   * guarding this hex" sits on no line at all, so a normalizer that insisted on one would throw
   * the whole payload away and leave the panel showing nothing.
   */
  it("carries a finding that belongs to a hex rather than to a line", async () => {
    const wire: TauriInvoke = <T,>() =>
      Promise.resolve({
        diagnostics: [
          {
            code: "hex-unguarded",
            message: "you have units here and none of them is guarding this hex",
            line_start: null,
            line_end: null,
            column_start: null,
            column_end: null,
            region_id: "1:7,53",
            unit_id: null,
            severity: "warning"
          },
          {
            code: "not-enough-silver",
            message: "short $60",
            lineStart: 4,
            lineEnd: 4,
            columnStart: 0,
            columnEnd: 4,
            regionId: "1:7,53",
            unitId: "18642",
            severity: "warning"
          }
        ]
      } as T);

    const result = await createCoreClient(createTauriAdapter(wire)).validateOrders("x", null);

    expect(result.diagnostics[0]).toEqual({
      code: "hex-unguarded",
      message: "you have units here and none of them is guarding this hex",
      lineStart: null,
      lineEnd: null,
      columnStart: null,
      columnEnd: null,
      regionId: "1:7,53",
      unitId: null,
      severity: "warning"
    });
    expect(result.diagnostics[1].lineStart).toBe(4);
    expect(result.diagnostics[1].unitId).toBe("18642");
  });

  /** A payload with no anchors at all is still incomplete if it says nothing else either. */
  it("still refuses a diagnostic missing its code or severity", async () => {
    const broken: TauriInvoke = <T,>() =>
      Promise.resolve({ diagnostics: [{ message: "no code here", severity: "warning" }] } as T);

    await expect(
      createCoreClient(createTauriAdapter(broken)).validateOrders("x", null)
    ).rejects.toThrow(/incomplete order validation payload/);
  });

  it("asks tauri for the order vocabulary rather than keeping one of its own", async () => {
    const calls: string[] = [];
    const invoke: TauriInvoke = <T,>(command: string) => {
      calls.push(command);
      return Promise.resolve(["GIVE", "MOVE", "WORK"] as T);
    };

    await expect(createCoreClient(createTauriAdapter(invoke)).orderCommands()).resolves.toEqual([
      "GIVE",
      "MOVE",
      "WORK"
    ]);
    expect(calls).toEqual(["order_commands"]);
  });

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
      "the ruleset it is classified against",
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
          ruleset_json: "the ruleset it is classified against",
          merged_at: "2026-08-10T18:30:00Z"
        }
      }
    ]);
  });

  /**
   * The same pinning for the import: a typo in the `ruleset_json` key would deserialize as `None`
   * on the Rust side without an error, and every remembered unit would quietly go back to being an
   * estimate. Only the key names catch that, so the key names are what this asserts.
   */
  it("asks tauri to commit an import with the argument names its commands declare", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve({
        exists: false,
        raw_changed: false,
        parsed_changed: false,
        warnings_changed: false
      } as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).commitReportImport(
      DB,
      "faction-95",
      "95",
      "the turn's report",
      "the ruleset it is classified against",
      true,
      "2026-08-10T18:30:00Z"
    );

    expect(calls).toEqual([
      {
        command: "commit_report_import",
        args: {
          database_path: DB,
          game_id: "faction-95",
          confirmed_faction_id: "95",
          raw_report: "the turn's report",
          ruleset_json: "the ruleset it is classified against",
          allow_overwrite: true,
          imported_at: "2026-08-10T18:30:00Z"
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
      createCoreClient(createTauriAdapter(invoke)).mergeReport(DB, "g", "95", 71, "r", null, "now");

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
      createCoreClient(createTauriAdapter(invoke)).mergeReport(DB, "g", "95", 71, "r", null, "now")
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

    expect(() => createWasmAdapter(bindings).mergeReport(DB, "g", "95", 71, "r", null, "now")).toThrow(
      "game persistence is not linked into this wasm build"
    );
    await expect(
      createCoreClient(createWasmAdapter(bindings)).loadMergedReports(DB, "g", "95", 71)
    ).resolves.toEqual([]);
  });
});

/**
 * Listing every turn imported for a game, across the same boundary as everything else.
 *
 * Same literal argument-name assertion as the suites above, and for the same reason: a camelCase
 * key does not fail loudly under `rename_all = "snake_case"`, it just arrives missing.
 */
describe("listing imported turns", () => {
  const DB = "/tmp/campaign.atlantis-game.sqlite";

  it("asks tauri to list with the argument names its command declares", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve([] as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).listImportedTurns(DB, "faction-95");

    expect(calls).toEqual([
      {
        command: "list_imported_turns",
        args: {
          database_path: DB,
          game_id: "faction-95"
        }
      }
    ]);
  });

  // A game with no imports is the ordinary state of a game just created, not a failure.
  it("treats an unreadable list of turns as no turns", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve(null as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).listImportedTurns(DB, "g")
    ).resolves.toEqual([]);
  });
});

/**
 * Changing a game's ruleset after creation, across the same boundary as everything else.
 *
 * Same literal argument-name assertions as the merge suite above, and for the same reason: a
 * camelCase key does not fail loudly under `rename_all = "snake_case"`, it just arrives missing.
 */
describe("changing a game's ruleset", () => {
  const wireManifest = {
    manifest_version: 1,
    metadata: {
      game_id: "faction-12",
      game_name: "Faction 12",
      ruleset_id: "magicdeep"
    },
    report_sources: [],
    created_at: "2026-08-01T09:00:00Z",
    last_opened_at: "2026-08-09T18:00:00Z"
  };

  it("asks tauri with the argument names its command declares, and normalizes the answer", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve(wireManifest as T);
    };

    const manifest = await createCoreClient(createTauriAdapter(invoke)).setGameRuleset(
      "faction-12",
      "magicdeep"
    );

    expect(calls).toEqual([
      {
        command: "set_game_ruleset",
        args: { game_id: "faction-12", ruleset_id: "magicdeep" }
      }
    ]);
    expect(manifest.metadata.rulesetId).toBe("magicdeep");
    expect(manifest.lastOpenedAt).toBe("2026-08-09T18:00:00Z");
  });

  it("normalizes the wasm answer to the same manifest", async () => {
    const bindings = {
      set_game_ruleset_state: (gameId: string, rulesetId: string) => ({
        ...wireManifest,
        metadata: { ...wireManifest.metadata, game_id: gameId, ruleset_id: rulesetId }
      })
    } as unknown as WasmBindings;

    const manifest = await createCoreClient(createWasmAdapter(bindings)).setGameRuleset(
      "faction-12",
      "magicdeep"
    );

    expect(manifest.metadata.gameId).toBe("faction-12");
    expect(manifest.metadata.rulesetId).toBe("magicdeep");
  });

  // A write, so it refuses rather than answering emptily: a change that quietly went nowhere
  // would leave the dialog claiming a ruleset the manifest does not hold.
  it("refuses through a wasm build with no persistence linked in", () => {
    const bindings = {} as WasmBindings;

    expect(() => createWasmAdapter(bindings).setGameRuleset("g", "magicdeep")).toThrow(
      "game persistence is not linked into this wasm build"
    );
  });
});

/**
 * The map export crosses the wire as three strings and comes back as one, so the things worth
 * pinning are the argument names Tauri declares and the fact that neither adapter reshapes the
 * text. A typo in a key deserializes as a missing field on the Rust side, and the error that
 * follows would name the request rather than the key - which is why the keys are asserted here.
 */
describe("map export", () => {
  const REQUEST = {
    level: 1,
    fromX: 4,
    fromY: 50,
    toX: 8,
    toY: 54,
    content: { structures: true, units: false, advancedResources: false }
  };
  const EXPORTED = "; Map export from Atlantis HUD\n";

  it("asks tauri to export with the argument names its command declares", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve(EXPORTED as T);
    };

    const text = await createCoreClient(createTauriAdapter(invoke)).exportMap(
      "the turn's report",
      "[]",
      REQUEST
    );

    expect(calls).toEqual([
      {
        command: "export_map",
        args: {
          raw_report: "the turn's report",
          remembered_json: "[]",
          request_json: JSON.stringify(REQUEST)
        }
      }
    ]);
    expect(text).toBe(EXPORTED);
  });

  it("asks the wasm binding for the same export", async () => {
    const calls: string[][] = [];
    const bindings = {
      export_map_state: (rawReport: string, rememberedJson: string, requestJson: string) => {
        calls.push([rawReport, rememberedJson, requestJson]);
        return EXPORTED;
      }
    } as unknown as WasmBindings;

    const text = await createCoreClient(createWasmAdapter(bindings)).exportMap(
      "the turn's report",
      "[]",
      REQUEST
    );

    expect(calls).toEqual([["the turn's report", "[]", JSON.stringify(REQUEST)]]);
    expect(text).toBe(EXPORTED);
  });

  // An export nobody can read is worse than none: a file saved from an unreadable answer would be
  // an empty document the player believes holds their map.
  it("refuses an answer that is not text", async () => {
    const bindings = {
      export_map_state: () => ({ not: "text" })
    } as unknown as WasmBindings;

    await expect(
      createCoreClient(createWasmAdapter(bindings)).exportMap("report", "[]", REQUEST)
    ).rejects.toThrow("map export did not come back as text");
  });
});
