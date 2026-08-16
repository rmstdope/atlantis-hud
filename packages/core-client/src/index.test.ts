import { describe, expect, it } from "vitest";
import {
  createCoreClient,
  createTauriAdapter,
  type HexNoteRecord,
  type TauriInvoke
} from "./index";

// The browser transport is createWebCoreAdapter in @atlantis/browser-core, over IndexedDB, with
// its own tests there; this file pins only the tauri adapter's contract, which is what desktop
// speaks to core-tauri.
describe("core client tauri adapter contract", () => {
  it("normalizes tauri responses into the client's contracts", async () => {
    const orderVocabulary = ["GIVE", "MOVE", "WORK"];

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
        months: [{ month: 1, steps: 1, endsAt: { x: 7, y: 51, z: 1 } }],
        order: "MOVE N"
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
      // Both turn loads answer with the same record; only the question differs.
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
      const tauriHexNote = {
        id: "note-1",
        gameId: "faction-12",
        regionId: "1:7,53",
        text: "Mustn't forget the mountain pass",
        onMap: true,
        turn: 12,
        createdAt: "2026-08-07T12:00:00Z",
        updatedAt: "2026-08-07T12:00:00Z"
      };
      if (command === "list_hex_notes") {
        return Promise.resolve([tauriHexNote] as T);
      }
      if (command === "save_hex_note") {
        return Promise.resolve(tauriHexNote as T);
      }
      if (command === "delete_hex_note") {
        return Promise.resolve(true as T);
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

    const tauriClient = createCoreClient(createTauriAdapter(invoke));

    await expect(tauriClient.getEngineInfo()).resolves.toEqual({
      id: "atlantis",
      name: "Atlantis PBEM",
      rulesetVersion: "4.0",
      maxFactionCount: 128
    });

    // Game management crosses the same boundary as everything else: one payload per command,
    // normalized to the client's own contract.
    const games = await tauriClient.listGames();
    expect(games[0].metadata.rulesetId).toBe("neworigins");
    expect(games[0].lastOpenedAt).toBe("2026-08-09T18:00:00Z");

    const openedGame = {
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
        reportSources: [{ sourceId: "turn-12-report", label: "Turn 12 report" }],
        createdAt: "2026-08-01T09:00:00Z",
        lastOpenedAt: "2026-08-09T18:00:00Z"
      }
    };
    await expect(tauriClient.createGame(games[0])).resolves.toEqual(openedGame);
    await expect(tauriClient.openGame("faction-12", "2026-08-09T18:00:00Z")).resolves.toEqual(
      openedGame
    );
    await expect(tauriClient.deleteGame("faction-12")).resolves.toBeUndefined();

    // The planner's answer is returned as-is: the core already serializes it to this shape.
    const tauriPlan = await tauriClient.planRoute("{}", "report", "[]", "18642", "1:7,51");
    expect(tauriPlan.plan?.totalCost).toBe(2);
    expect(tauriPlan.plan?.steps[0].terrain).toBe("mountain");
    expect(tauriPlan.problem).toBeNull();
    expect(tauriPlan.fullyModelled).toBe(false);

    // A traced order comes back the same way.
    const tauriTrace = await tauriClient.traceMoveOrders("{}", "report", "[]", "18642", "MOVE N");
    expect(tauriTrace.path?.steps[0].terrain).toBe("mountain");
    expect(tauriTrace.path?.months[0].endsAt).toEqual({ x: 7, y: 51, z: 1 });
    expect(tauriTrace.path?.mode).toBe("walk");

    // The orders preview, likewise: the table shows the coming month.
    const tauriPreview = await tauriClient.previewOrders("{}", "report", "[]", "orders");
    expect(tauriPreview.regions[0].units[0].status).toBe("departing");
    expect(tauriPreview.regions[0].units[0].unit.name).toBe("Nine of Eight");
    expect(tauriPreview.regions[0].units[0].changes[0]).toEqual({
      field: "name",
      original: "Seven of Eight"
    });
    expect(tauriPreview.regions[0].units[0].departingTo).toBe("1:7,51");
    await expect(
      tauriClient.parseReport("TURN: 12 Spring\nFACTION: 17 | Crimson Tide\nREGION: R1 | Coast of Dawn")
    ).resolves.toEqual({
      turnHeader: { turnNumber: 12, season: "Spring" },
      detectedFactions: [{ factionId: "17", name: "Crimson Tide" }],
      regions: [{ regionId: "R1", name: "Coast of Dawn" }],
      units: [{ unitId: "U100", name: "Guard Patrol", regionId: "R1" }],
      inventories: [{ unitId: "U100", item: "silver", quantity: 12 }],
      messageSummaries: [{ kind: "order", source: "U100", text: "MOVE R2" }],
      warnings: [],
      meetsMinimumImportThreshold: true
    });
    await expect(
      tauriClient.previewReportImport("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", "same")
    ).resolves.toEqual({
      parseResult: {
        turnHeader: { turnNumber: 12, season: "Spring" },
        detectedFactions: [{ factionId: "17", name: "Crimson Tide" }],
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
    });
    await expect(
      tauriClient.commitReportImport(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        "same",
        null,
        true,
        "2026-08-09T18:00:00Z"
      )
    ).resolves.toEqual({
      exists: true,
      rawChanged: false,
      parsedChanged: false,
      warningsChanged: false
    });
    await expect(tauriClient.validateOrders("bad input", null)).resolves.toEqual({
      diagnostics: [
        {
          code: "unknown-command",
          message: "unknown order command",
          lineStart: 1,
          lineEnd: 1,
          columnStart: 0,
          columnEnd: 3,
          severity: "error",
          regionId: null,
          unitId: null
        },
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 2,
          lineEnd: 2,
          columnStart: 5,
          columnEnd: 9,
          severity: "warning",
          regionId: null,
          unitId: null
        }
      ]
    });
    await expect(tauriClient.orderCommands()).resolves.toEqual(orderVocabulary);
    const orderDraft = {
      key: { gameId: "faction-12", factionId: "17", turnNumber: 12 },
      orderText: "MOVE U100 R2",
      updatedAt: "2026-08-07T12:00:00Z"
    };
    await expect(
      tauriClient.loadOrderDraft("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", 12)
    ).resolves.toEqual(orderDraft);
    await expect(
      tauriClient.saveOrderDraft(
        "/tmp/campaign.atlantis-game.sqlite",
        "faction-12",
        "17",
        12,
        "MOVE U100 R2",
        "2026-08-07T12:00:00Z"
      )
    ).resolves.toEqual(orderDraft);
    const importedTurn = {
      key: { gameId: "faction-12", factionId: "17", turnNumber: 12 },
      rawReport: "TURN: 12 Spring\nFACTION: 17 | Crimson Tide\nREGION: A1 | Coast of Dawn",
      parseResult: {
        turnHeader: { turnNumber: 12, season: "Spring" },
        detectedFactions: [{ factionId: "17", name: "Crimson Tide" }],
        regions: [{ regionId: "R1", name: "Coast of Dawn" }],
        units: [{ unitId: "U100", name: "Guard Patrol", regionId: "R1" }],
        inventories: [{ unitId: "U100", item: "silver", quantity: 12 }],
        messageSummaries: [{ kind: "order", source: "U100", text: "MOVE R2" }],
        warnings: [],
        meetsMinimumImportThreshold: true
      }
    };
    await expect(
      tauriClient.loadImportedTurn("/tmp/campaign.atlantis-game.sqlite", "faction-12", "17", 12)
    ).resolves.toEqual(importedTurn);
    // The turn a game reopens on decides what the player sees on launch.
    const tauriLatest = await tauriClient.loadLatestImportedTurn(
      "/tmp/campaign.atlantis-game.sqlite",
      "faction-12"
    );
    expect(tauriLatest).toEqual(importedTurn);
    expect(tauriLatest?.key).toEqual({ gameId: "faction-12", factionId: "17", turnNumber: 12 });
    await expect(
      tauriClient.listImportedTurns("/tmp/campaign.atlantis-game.sqlite", "faction-12")
    ).resolves.toEqual([
      {
        key: { gameId: "faction-12", factionId: "17", turnNumber: 12 },
        season: "Spring",
        importedAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z"
      }
    ]);
    const tauriNotes = await tauriClient.listHexNotes(
      "/tmp/campaign.atlantis-game.sqlite",
      "faction-12"
    );
    expect(tauriNotes[0]).toEqual({
      id: "note-1",
      gameId: "faction-12",
      regionId: "1:7,53",
      text: "Mustn't forget the mountain pass",
      onMap: true,
      turn: 12,
      createdAt: "2026-08-07T12:00:00Z",
      updatedAt: "2026-08-07T12:00:00Z"
    });
    const noteToSave: HexNoteRecord = tauriNotes[0];
    await expect(
      tauriClient.saveHexNote("/tmp/campaign.atlantis-game.sqlite", noteToSave)
    ).resolves.toEqual(noteToSave);
    await expect(
      tauriClient.deleteHexNote("/tmp/campaign.atlantis-game.sqlite", "faction-12", "note-1")
    ).resolves.toBeUndefined();
  });

  /**
   * A sea route rides the same wire shape as a land one, and the refusal it can carry - a crew
   * short of the sailing skill a fleet needs - is a new `RouteProblem` kind, not a new shape.
   * Pinned separately from the giant parity test above so a change to that test's many payloads
   * cannot hide a regression here.
   */
  it("carries a sail plan and a crew refusal", async () => {
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
        months: [{ month: 1, steps: 1, endsAt: { x: 49, y: 5, z: 1 } }],
        order: "SAIL S"
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

    const invoke: TauriInvoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === "plan_route") {
        return Promise.resolve(
          (args?.unit_id === "crewed" ? sailPlanPayload : crewRefusalPayload) as T
        );
      }
      throw new Error(`unexpected command ${command}`);
    };

    const tauriClient = createCoreClient(createTauriAdapter(invoke));

    const tauriSail = await tauriClient.planRoute("{}", "report", "[]", "crewed", "1:49,5");
    expect(tauriSail).toEqual(sailPlanPayload);
    expect(tauriSail.plan?.mode).toBe("sail");
    expect(tauriSail.problem).toBeNull();

    const tauriRefusal = await tauriClient.planRoute("{}", "report", "[]", "undercrewed", "1:49,5");
    expect(tauriRefusal).toEqual(crewRefusalPayload);
    expect(tauriRefusal.plan).toBeNull();
    expect(tauriRefusal.problem).toEqual({ kind: "crewCannotSail", required: 4, available: 1 });
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
      { disabledCodes: [] }
    );

    expect(calls).toEqual([
      {
        command: "validate_orders",
        args: {
          raw_orders: "@work",
          ruleset_json: "the ruleset its items are checked against",
          raw_report: "the report the orders were written for",
          disabled_codes: []
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
        disabled_codes: ["hex-unguarded"]
      }
    ]);
  });

  it("carries the column span a diagnostic points at", async () => {
    const camel: TauriInvoke = <T,>() =>
      Promise.resolve({
        diagnostics: [
          {
            code: "bad-argument",
            message: 'expected a number, found "swords"',
            lineStart: 2,
            lineEnd: 2,
            columnStart: 10,
            columnEnd: 16,
            severity: "error"
          }
        ]
      } as T);

    const result = await createCoreClient(createTauriAdapter(camel)).validateOrders("x", null);

    expect(result.diagnostics[0].columnStart).toBe(10);
    expect(result.diagnostics[0].columnEnd).toBe(16);
    expect(result.diagnostics[0].regionId).toBeNull();
    expect(result.diagnostics[0].unitId).toBeNull();
  });

  /**
   * The contract from ah-164.1 on: every anchor is optional, so a payload carrying only the old
   * snake_case spelling does not throw - it reads as an anchor-free diagnostic, since the
   * normalizer no longer falls back to the old spelling.
   */
  it("reads a diagnostic's optional anchors as absent when only the old snake_case spelling is present", async () => {
    const snake: TauriInvoke = <T,>() =>
      Promise.resolve({
        diagnostics: [
          {
            code: "bad-argument",
            message: 'expected a number, found "swords"',
            line_start: 2,
            line_end: 2,
            severity: "error"
          }
        ]
      } as T);

    const result = await createCoreClient(createTauriAdapter(snake)).validateOrders("x", null);

    expect(result.diagnostics[0].lineStart).toBeNull();
    expect(result.diagnostics[0].lineEnd).toBeNull();
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
            lineStart: null,
            lineEnd: null,
            columnStart: null,
            columnEnd: null,
            regionId: "1:7,53",
            unitId: null,
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

  /**
   * The contract from ah-164.1 on: `turnHeader.turnNumber` is required, so a payload carrying
   * only the old snake_case spelling is refused rather than silently read.
   */
  it("refuses a parse result whose turn header carries only the old snake_case spelling", async () => {
    const snake: TauriInvoke = <T,>() =>
      Promise.resolve({
        turnHeader: { turn_number: 12, season: "Spring" },
        detectedFactions: [],
        regions: [],
        units: [],
        inventories: [],
        messageSummaries: [],
        warnings: [],
        meetsMinimumImportThreshold: false
      } as T);

    await expect(
      createCoreClient(createTauriAdapter(snake)).parseReport("garbage")
    ).rejects.toThrow(/incomplete turn header payload/);
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
 * Loading one imported turn to compare against the working one (ah-jg6.3/ah-6l2).
 *
 * `loadLatestImportedTurn` right above this in the source already guards against both `null` and
 * `undefined` for Rust's `None`, with a comment explaining why: serde_wasm_bindgen can emit either.
 * `loadImportedTurn` only checked `null` - so an adapter answering `undefined` for "no such turn"
 * threw out of `normalizeImportedTurnRecord` instead of resolving to `null` like its sibling, and
 * that throw had nowhere caught to land (ah-6l2).
 */
describe("loading one imported turn", () => {
  const DB = "/tmp/campaign.atlantis-game.sqlite";

  it("treats undefined the same as null for Rust's None, like loadLatestImportedTurn does", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve(undefined as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).loadImportedTurn(DB, "g", "faction-95", 70)
    ).resolves.toBeNull();
  });
});

/** Same "nothing stored yet" shape as loading an imported turn, and the same gap it had (ah-6l2). */
describe("loading an order draft", () => {
  const DB = "/tmp/campaign.atlantis-game.sqlite";

  it("treats undefined the same as null for Rust's None", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve(undefined as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).loadOrderDraft(DB, "g", "faction-95", 70)
    ).resolves.toBeNull();
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

});

/**
 * Renaming follows the same shape as changing the ruleset: one round trip, the updated manifest
 * comes back normalized.
 */
describe("renaming a game", () => {
  const wireManifest = {
    manifest_version: 1,
    metadata: {
      game_id: "faction-12",
      game_name: "Binding of the North",
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

    const manifest = await createCoreClient(createTauriAdapter(invoke)).setGameName(
      "faction-12",
      "Binding of the North"
    );

    expect(calls).toEqual([
      {
        command: "set_game_name",
        args: { game_id: "faction-12", game_name: "Binding of the North" }
      }
    ]);
    expect(manifest.metadata.gameName).toBe("Binding of the North");
    expect(manifest.lastOpenedAt).toBe("2026-08-09T18:00:00Z");
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

  // An export nobody can read is worse than none: a file saved from an unreadable answer would be
  // an empty document the player believes holds their map.
  it("refuses an answer that is not text", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve({ not: "text" } as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).exportMap("report", "[]", REQUEST)
    ).rejects.toThrow("map export did not come back as text");
  });
});

/**
 * The known map crosses the wire as three strings, the same shape `export_map` does, so the thing
 * worth pinning is the argument names Tauri declares and that `null` passes through unchanged - a
 * `""` there would be a real ruleset to the Rust side, not "none given".
 */
describe("known map", () => {
  const REMEMBERED = [
    {
      region: {
        regionId: "1:2,2",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "plain",
        province: "Nowhere",
        settlement: null,
        population: null,
        race: null,
        tax: null,
        taxBase: null,
        wages: null,
        maxWages: null,
        entertainment: null,
        exits: [],
        structures: [],
        units: [],
        products: [],
        forSale: [],
        wanted: []
      },
      lastSeenTurn: 5
    }
  ];
  const ANSWER = { hexes: [], currentTurn: 6 };

  it("asks tauri to resolve with the argument names its command declares", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve(ANSWER as T);
    };

    const known = await createCoreClient(createTauriAdapter(invoke)).knownMap(
      "the turn's report",
      "{ruleset}",
      REMEMBERED
    );

    expect(calls).toEqual([
      {
        command: "known_map",
        args: {
          raw_report: "the turn's report",
          ruleset_json: "{ruleset}",
          remembered_json: JSON.stringify(REMEMBERED)
        }
      }
    ]);
    expect(known).toEqual(ANSWER);
  });

  it("passes a null ruleset through unchanged, never as an empty string", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return Promise.resolve(ANSWER as T);
    };

    await createCoreClient(createTauriAdapter(invoke)).knownMap("report", null, []);

    expect(calls[0]?.args?.ruleset_json).toBeNull();
  });
});

describe("hex notes", () => {
  const NOTE: HexNoteRecord = {
    id: "note-1",
    gameId: "faction-12",
    regionId: "1:7,53",
    text: "Mustn't forget the mountain pass",
    onMap: true,
    turn: 12,
    createdAt: "2026-08-07T12:00:00Z",
    updatedAt: "2026-08-07T12:00:00Z"
  };

  it("treats undefined the same as null for listing", async () => {
    const invoke: TauriInvoke = <T,>() => Promise.resolve(undefined as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).listHexNotes("/db", "faction-12")
    ).resolves.toEqual([]);
  });

  it("accepts on_map as 0/1 and as a boolean", async () => {
    const invokeWith = (onMap: number | boolean): TauriInvoke =>
      <T,>() =>
        Promise.resolve([
          {
            id: "note-1",
            game_id: "faction-12",
            region_id: "1:7,53",
            text: "text",
            on_map: onMap,
            turn: 12,
            created_at: "2026-08-07T12:00:00Z",
            updated_at: "2026-08-07T12:00:00Z"
          }
        ] as T);

    const zeroNotes = await createCoreClient(createTauriAdapter(invokeWith(0))).listHexNotes(
      "/db",
      "faction-12"
    );
    const oneNotes = await createCoreClient(createTauriAdapter(invokeWith(1))).listHexNotes(
      "/db",
      "faction-12"
    );
    const boolNotes = await createCoreClient(
      createTauriAdapter(<T,>() => Promise.resolve([{ ...NOTE }] as T))
    ).listHexNotes("/db", "faction-12");

    expect(zeroNotes[0].onMap).toBe(false);
    expect(oneNotes[0].onMap).toBe(true);
    expect(boolNotes[0].onMap).toBe(true);
  });

  it("rejects a note without an id", async () => {
    const invoke: TauriInvoke = <T,>() =>
      Promise.resolve([
        {
          game_id: "faction-12",
          region_id: "1:7,53",
          text: "text",
          on_map: true,
          turn: 12,
          created_at: "2026-08-07T12:00:00Z",
          updated_at: "2026-08-07T12:00:00Z"
        }
      ] as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).listHexNotes("/db", "faction-12")
    ).rejects.toThrow("incomplete hex note payload");
  });

  it("rejects an on_map value that is neither 0, 1 nor a boolean", async () => {
    const invoke: TauriInvoke = <T,>() =>
      Promise.resolve([
        {
          id: "note-1",
          game_id: "faction-12",
          region_id: "1:7,53",
          text: "text",
          on_map: 2,
          turn: 12,
          created_at: "2026-08-07T12:00:00Z",
          updated_at: "2026-08-07T12:00:00Z"
        }
      ] as T);

    await expect(
      createCoreClient(createTauriAdapter(invoke)).listHexNotes("/db", "faction-12")
    ).rejects.toThrow("incomplete hex note payload");
  });
});
