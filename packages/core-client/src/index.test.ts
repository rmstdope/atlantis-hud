import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { aParsedReport, aReportRegion } from "./builders";
import {
  createCoreClient,
  createTauriAdapter,
  type CoreAdapter,
  type GameManifest,
  type HexNoteRecord,
  type ImportedTurnRecord,
  type ImportedTurnSummary,
  type MapExportRequest,
  type RememberedRegion,
  type TauriInvoke
} from "./index";

// `CoreAdapter` is the one typed declaration of the boundary: checked here at compile time, not by
// a runtime normalizer. `vitest run` cannot fail these - they are caught only by `tsc --noEmit`
// (the `typecheck` script), which is why they are pinned separately from any runtime assertion.
expectTypeOf<Awaited<ReturnType<CoreAdapter["listGames"]>>>().toEqualTypeOf<GameManifest[]>();
expectTypeOf<Awaited<ReturnType<CoreAdapter["loadImportedTurn"]>>>().toEqualTypeOf<
  ImportedTurnRecord | null
>();
expectTypeOf<Awaited<ReturnType<CoreAdapter["deleteHexNote"]>>>().toEqualTypeOf<void>();

/**
 * One value per `CoreAdapter` method, typed against it - the compiler checks this helper is
 * complete whenever a method is added or removed. Every entry is a `vi.fn()` so a test can assert
 * on how `createCoreClient` called it, or override an entry to control what it resolves with.
 */
function fakeAdapter(overrides: Partial<CoreAdapter> = {}): CoreAdapter {
  const gameManifest: GameManifest = {
    manifestVersion: 1,
    metadata: { gameId: "faction-12", gameName: "Faction 12", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  };
  const openedGame = {
    gameFilePath: "/tmp/campaign.atlantis-game.json",
    databasePath: "/tmp/campaign.atlantis-game.sqlite",
    schemaVersion: 2,
    manifest: gameManifest
  };
  const reportParseResult = {
    meetsMinimumImportThreshold: true,
    turnHeader: null,
    detectedFactions: [],
    regions: [],
    units: [],
    inventories: [],
    messageSummaries: [],
    warnings: []
  };
  const hexNote: HexNoteRecord = {
    id: "note-1",
    gameId: "faction-12",
    regionId: "1:7,53",
    text: "Mustn't forget the mountain pass",
    onMap: true,
    turn: 12,
    createdAt: "2026-08-07T12:00:00Z",
    updatedAt: "2026-08-07T12:00:00Z"
  };
  const orderDraft = {
    key: { gameId: "faction-12", factionId: "17", turnNumber: 12 },
    orderText: "MOVE U100 R2",
    updatedAt: "2026-08-07T12:00:00Z"
  };

  return {
    getEngineInfo: vi.fn().mockResolvedValue({
      id: "atlantis",
      name: "Atlantis PBEM",
      rulesetVersion: "4.0",
      maxFactionCount: 128
    }),
    listGames: vi.fn().mockResolvedValue([gameManifest]),
    createGame: vi.fn().mockResolvedValue(openedGame),
    openGame: vi.fn().mockResolvedValue(openedGame),
    deleteGame: vi.fn().mockResolvedValue(undefined),
    exportGame: vi.fn().mockResolvedValue("{}"),
    importGame: vi.fn().mockResolvedValue(openedGame),
    setGameRuleset: vi.fn().mockResolvedValue(gameManifest),
    setGameName: vi.fn().mockResolvedValue(gameManifest),
    setActiveFaction: vi.fn().mockResolvedValue(gameManifest),
    parseReport: vi.fn().mockResolvedValue(reportParseResult),
    // `parseReportFull`/`parseReportClassified` resolve with a `ParsedReport`, not a
    // `ReportParseResult` - a different shape, caught by Copilot review on PR #331.
    parseReportFull: vi.fn().mockResolvedValue(aParsedReport()),
    parseReportClassified: vi.fn().mockResolvedValue(aParsedReport()),
    previewReportImport: vi.fn().mockResolvedValue({
      parseResult: reportParseResult,
      duplicatePreview: {
        exists: false,
        rawChanged: false,
        parsedChanged: false,
        warningsChanged: false
      },
      turnNumber: 12
    }),
    commitReportImport: vi.fn().mockResolvedValue({
      exists: false,
      rawChanged: false,
      parsedChanged: false,
      warningsChanged: false
    }),
    validateOrders: vi.fn().mockResolvedValue({ diagnostics: [] }),
    orderCommands: vi.fn().mockResolvedValue(["GIVE", "MOVE", "WORK"]),
    orderArgumentCompletions: vi.fn().mockResolvedValue([]),
    planRoute: vi.fn().mockResolvedValue({ plan: null, problem: null, risk: null, fullyModelled: true }),
    traceMoveOrders: vi.fn().mockResolvedValue({ path: null }),
    exportMap: vi.fn().mockResolvedValue("; Map export from Atlantis HUD\n"),
    knownMap: vi.fn().mockResolvedValue({ hexes: [], levels: [], currentTurn: null }),
    previewOrders: vi.fn().mockResolvedValue({ regions: [] }),
    tradeRoutes: vi.fn().mockResolvedValue([]),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    mergeReport: vi.fn().mockResolvedValue({
      turnNumber: 71,
      mergedFactionId: "73",
      mergedFactionName: "Borg",
      mergedRegionCount: 3,
      newRegionCount: 2
    }),
    loadMergedReports: vi.fn().mockResolvedValue([]),
    loadImportedTurn: vi.fn().mockResolvedValue(null),
    loadLatestImportedTurn: vi.fn().mockResolvedValue(null),
    listImportedTurns: vi.fn().mockResolvedValue([]),
    loadOrderDraft: vi.fn().mockResolvedValue(null),
    saveOrderDraft: vi.fn().mockResolvedValue(orderDraft),
    listHexNotes: vi.fn().mockResolvedValue([hexNote]),
    saveHexNote: vi.fn().mockResolvedValue(hexNote),
    deleteHexNote: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

// The browser transport is createWebCoreAdapter in @atlantis/browser-core, over IndexedDB, with
// its own tests there; this file pins only the tauri adapter's contract, which is what desktop
// speaks to core-tauri.
describe("core client tauri adapter contract", () => {
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
 * Merging an ally's report, across the same boundary as everything else. The argument names
 * themselves are pinned once, generically, in `tauriCommands.test.ts` — these tests are about the
 * behaviour on top of that: absent values, and how a diagnostic's fields carry through.
 */
describe("merging an allied report", () => {
  const DB = "/tmp/campaign.atlantis-game.sqlite";

  /**
   * Before a report is imported there is nothing to check the orders against, and the pane still
   * has to validate what is being typed. The report and the options are therefore optional, and
   * their absence has to reach the core as an absence rather than as a mistyped key. Absent
   * disabled codes reach the core as `null` too - the core's own default applies, rather than a
   * copy of it living here.
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
        disabled_codes: null
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
            regionId: null,
            unitId: null,
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

});

/**
 * The known map crosses the wire as three strings, the same shape `export_map` does. The argument
 * names are pinned generically in `tauriCommands.test.ts`; what is worth pinning here is that
 * `null` passes through unchanged - a `""` there would be a real ruleset to the Rust side, not
 * "none given".
 */
describe("known map", () => {
  const ANSWER = { hexes: [], currentTurn: 6 };

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


/**
 * `createCoreClient`'s own contract, independent of either transport: it is the adapter, plus the
 * three ergonomic conversions, and it re-validates nothing (ah-wxk.2).
 */
describe("createCoreClient", () => {
  it("is the adapter's methods, plus nothing", () => {
    const fake = fakeAdapter();

    const client = createCoreClient(fake);

    expect(Object.keys(client).sort()).toEqual(Object.keys(fake).sort());
  });

  it("stringifies the map export request", async () => {
    const fake = fakeAdapter();
    const request: MapExportRequest = {
      level: 1,
      fromX: 4,
      fromY: 50,
      toX: 8,
      toY: 54,
      content: { structures: true, units: false, advancedResources: false }
    };

    await createCoreClient(fake).exportMap("raw", "[]", request);

    expect(fake.exportMap).toHaveBeenCalledWith("raw", "[]", JSON.stringify(request));
  });

  it("stringifies the remembered regions for the known map", async () => {
    const fake = fakeAdapter();
    const remembered: RememberedRegion[] = [
      { region: aReportRegion({ coordinate: { x: 2, y: 2, z: 1 } }), lastSeenTurn: 5 }
    ];

    await createCoreClient(fake).knownMap("raw", "{}", remembered);

    expect(fake.knownMap).toHaveBeenCalledWith("raw", "{}", JSON.stringify(remembered));
  });

  it("passes disabled codes through, and null when no options are given", async () => {
    const fake = fakeAdapter();
    const client = createCoreClient(fake);

    await client.validateOrders("orders", null, null, { disabledCodes: ["hex-unguarded"] });
    await client.validateOrders("orders", null);

    expect(fake.validateOrders).toHaveBeenNthCalledWith(1, "orders", null, null, ["hex-unguarded"]);
    expect(fake.validateOrders).toHaveBeenNthCalledWith(2, "orders", null, null, null);
  });

  it("resolves with exactly what the adapter resolved", async () => {
    const games: GameManifest[] = [];
    const turn: ImportedTurnRecord | null = null;
    const fake = fakeAdapter({
      listGames: vi.fn().mockResolvedValue(games),
      loadImportedTurn: vi.fn().mockResolvedValue(turn)
    });
    const client = createCoreClient(fake);

    await expect(client.listGames()).resolves.toBe(games);
    await expect(client.loadImportedTurn("db", "g", "f", 1)).resolves.toBe(turn);
  });

  it("orders the turns it lists - turn ascending, then faction id as text - whatever order the adapter answered in", async () => {
    const unordered: ImportedTurnSummary[] = [
      { key: { gameId: "g", factionId: "9", turnNumber: 13 }, season: null, importedAt: "t", updatedAt: "t" },
      { key: { gameId: "g", factionId: "9", turnNumber: 12 }, season: null, importedAt: "t", updatedAt: "t" },
      { key: { gameId: "g", factionId: "10", turnNumber: 12 }, season: null, importedAt: "t", updatedAt: "t" }
    ];
    const fake = fakeAdapter({ listImportedTurns: vi.fn().mockResolvedValue(unordered) });
    const client = createCoreClient(fake);

    const listed = await client.listImportedTurns("db", "g");

    expect(listed.map((summary) => [summary.key.turnNumber, summary.key.factionId])).toEqual([
      [12, "10"],
      [12, "9"],
      [13, "9"]
    ]);
  });

  it("orders hex notes newest first, id ascending on a tie, whatever order the adapter answered in", async () => {
    const note = (id: string, createdAt: string): HexNoteRecord => ({
      id,
      gameId: "g",
      regionId: "1:7,53",
      text: "note",
      onMap: true,
      turn: 12,
      createdAt,
      updatedAt: createdAt
    });
    const unordered: HexNoteRecord[] = [
      note("b", "2026-08-01T09:00:00Z"),
      note("z", "2026-08-02T09:00:00Z"),
      note("a", "2026-08-01T09:00:00Z")
    ];
    const fake = fakeAdapter({ listHexNotes: vi.fn().mockResolvedValue(unordered) });
    const client = createCoreClient(fake);

    const listed = await client.listHexNotes("db", "g");

    expect(listed.map((n) => n.id)).toEqual(["z", "a", "b"]);
  });
});
