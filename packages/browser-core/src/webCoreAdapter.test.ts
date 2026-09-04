import { describe, expect, it } from "vitest";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import {
  aReportHeaderInfo,
  type GameManifest,
  type ManifestEdit,
  type AlliedMageRecord,
  type StudyPlanRecord,
  type ArmyRecord,
  type HexNoteRecord,
  type ImportedTurnSummary,
  type MergedReportRecord,
  type ParsedReport,
  type ReportParseResult,
  type ReportRegion,
  type TradeRoute
} from "@atlantis/core-client";
import { createMemoryWebStore, type StoredTurnSnapshot } from "./webStore";
import { createCoreWasmModuleDouble } from "./testing/coreWasmModuleDouble";

/** A minimal, complete `ReportParseResult` - every fake below merges its own fields over this. */
const EMPTY_PARSE_RESULT: ReportParseResult = {
  meetsMinimumImportThreshold: true,
  turnHeader: null,
  detectedFactions: [],
  regions: [],
  units: [],
  inventories: [],
  messageSummaries: [],
  warnings: []
};

/** Likewise for `ParsedReport`. */
const EMPTY_PARSED_REPORT: ParsedReport = {
  header: aReportHeaderInfo(),
  regions: [],
  battles: [],
  ordersTemplate: null,
  unreadableLines: []
};

/** A single fixed answer `trade_routes_state` hands back, so a test can assert it passed straight through. */
const FAKE_TRADE_ROUTES: TradeRoute[] = [
  {
    from: { x: 1, y: 1, z: 1 },
    to: { x: 2, y: 2, z: 1 },
    outbound: [
      {
        tag: "SILK",
        name: "silk",
        buyPrice: 60,
        sellPrice: 300,
        quantity: 15,
        margin: 240,
        buySeenTurn: null,
        sellSeenTurn: null
      }
    ],
    inbound: [],
    worth: 3600,
    turns: { walk: null, ride: null, fly: null }
  }
];

/**
 * Stands in for the compiled Rust core.
 *
 * It only needs to be self-consistent, not correct: these tests are about how the adapter routes
 * between logic and storage, and about the overwrite rule. Parsing itself is tested in Rust.
 */
function fakeWasm(overrides: Partial<CoreWasmModule> = {}): CoreWasmModule {
  const stubs: Partial<CoreWasmModule> = {
    get_engine_info: () => ({
      id: "atlantis",
      name: "Atlantis PBEM",
      rulesetVersion: "4.0",
      maxFactionCount: 128
    }),
    // `raw` rides along as an extra field (harmless - it is not part of `ReportParseResult`) so the
    // "routes logic calls to the core" test below can prove the argument crossed unshuffled.
    parse_report_state: (raw: string) => ({ ...EMPTY_PARSE_RESULT, raw }),
    parse_report_full_state: (_raw: string) => EMPTY_PARSED_REPORT,
    roster_skills_state: (_raw: string) => [],
    parse_report_classified_state: (_raw: string, _ruleset: string) => EMPTY_PARSED_REPORT,
    validate_orders_state: (
      rawOrders: string,
      rulesetJson: string | null,
      rawReport: string | null,
      disabledCodes: readonly string[]
    ) => ({ diagnostics: [], silver: [], rawOrders, rulesetJson, rawReport, disabledCodes }),
    order_commands_state: () => ["GIVE", "MOVE", "WORK"],
    order_vocabulary_state: () => ["ALL", "MOVE", "SILV"],
    order_argument_completions_state: () => [],
    completions_at_caret_state: () => ({
      position: "nowhere" as const,
      wordStart: 0,
      word: "",
      options: []
    }),
    export_map_state: (rawReport: string, rememberedJson: string, requestJson: string) =>
      `; Map export from Atlantis HUD\n; ${rawReport} ${rememberedJson} ${requestJson}\n`,
    known_map_state: (rawReport: string, rulesetJson: string | null, rememberedJson: string) => ({
      hexes: [],
      levels: [],
      currentTurn: null,
      echoed: { rawReport, rulesetJson, rememberedJson }
    }),
    plan_route_state: (
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      destination: string,
      mapJson: string
    ) => ({
      plan: null,
      problem: { kind: "noKnownRoute" },
      risk: null,
      fullyModelled: false,
      echoed: { rulesetJson, rawReport, rememberedJson, unitId, destination, mapJson }
    }),
    trace_move_orders_state: (
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      ordersDocument: string
    ) => ({
      path: null,
      echoed: { rulesetJson, rawReport, rememberedJson, unitId, ordersDocument }
    }),
    preview_orders_state: (
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      ordersDocument: string
    ) => ({
      regions: [],
      echoed: { rulesetJson, rawReport, rememberedJson, ordersDocument }
    }),
    trade_routes_state: () => FAKE_TRADE_ROUTES,
    prepare_report_import_state: (raw: string, confirmedFactionId: string) => {
      const hasTurn = raw.includes("TURN: 12");
      const factionMatches = raw.includes(`FACTION: ${confirmedFactionId}`);
      return {
        turnNumber: hasTurn ? 12 : null,
        candidate: {
          rawReport: raw,
          parsedPayloadJson: `parsed:${raw}`,
          warningsPayloadJson: "[]"
        },
        parseResult: { ...EMPTY_PARSE_RESULT, raw },
        rejection: !hasTurn
          ? "parsed report did not meet minimum import threshold"
          : factionMatches
            ? null
            : "confirmed faction does not exist in parsed report candidates"
      };
    },
    // Echoes rather than decides, like the rest of this stand-in: what a reset actually keeps is
    // the core's rule, pinned in `backup.rs` and against the real module in resetGame.wasm.test.ts.
    reset_game_manifest_state: (manifestJson: string, now: string) => {
      const previous = JSON.parse(manifestJson) as GameManifest;
      return {
        manifestVersion: previous.manifestVersion,
        metadata: {
          gameId: previous.metadata.gameId,
          gameName: previous.metadata.gameName,
          rulesetId: previous.metadata.rulesetId
        },
        reportSources: [],
        createdAt: now,
        lastOpenedAt: now
      } satisfies GameManifest;
    },
    // Echoes rather than decides, like the reset above: what one edit does to a manifest is the
    // core's rule, pinned in `backup.rs` and against the real module in manifestEdit.wasm.test.ts.
    edit_game_manifest_state: (manifestJson: string, editJson: string) => {
      const manifest = JSON.parse(manifestJson) as GameManifest;
      const edit = JSON.parse(editJson) as ManifestEdit;
      const metadata = { ...manifest.metadata };
      switch (edit.kind) {
        case "opened":
          return { ...manifest, lastOpenedAt: edit.value } satisfies GameManifest;
        case "ruleset":
          metadata.rulesetId = edit.value;
          break;
        case "name":
          metadata.gameName = edit.value;
          break;
        case "activeFaction":
          metadata.activeFactionId = edit.value ?? undefined;
          break;
        case "map":
          if (edit.value === null) {
            delete metadata.map;
          } else {
            metadata.map = edit.value;
          }
          break;
      }
      return { ...manifest, metadata } satisfies GameManifest;
    },
    // Echoes rather than decides: the adapter must hand the stored stamp and the seen hexes
    // across and write back what returns. The rules themselves are the core's, tested in Rust and
    // against the real module in reportImport.wasm.test.ts.
    report_import_writes_state: (
      _raw: string,
      _rulesetJson: string | null,
      existingImportedAt: string | null,
      _seenJson: string,
      at: string
    ) => ({ importedAt: existingImportedAt ?? at, updatedAt: at, regionSightings: [] }),
    diff_imported_turn_state: (existing: unknown, candidate: unknown) => {
      const stored = existing as StoredTurnSnapshot | null;
      const next = candidate as StoredTurnSnapshot;
      if (!stored) {
        return { exists: false, rawChanged: false, parsedChanged: false, warningsChanged: false };
      }
      return {
        exists: true,
        rawChanged: stored.rawReport !== next.rawReport,
        parsedChanged: stored.parsedPayloadJson !== next.parsedPayloadJson,
        warningsChanged: stored.warningsPayloadJson !== next.warningsPayloadJson
      };
    },
    hydrate_parse_result_state: (json: string) => ({ ...EMPTY_PARSE_RESULT, hydratedFrom: json }),
    ordered_merged_reports_state: (recordsJson: string) =>
      (JSON.parse(recordsJson) as MergedReportRecord[]).sort(
        (left, right) =>
          left.mergedAt.localeCompare(right.mergedAt) ||
          left.mergedFactionId.localeCompare(right.mergedFactionId)
      ),
    // Self-consistent, not correct: dropping, back-filling and ordering are the core's, pinned in
    // `sighting.rs` and against the real module in `rememberedRegions.wasm.test.ts`. This stand-in
    // only has to agree with itself so the routing tests below read true.
    remembered_regions_state: (storedJson: string) =>
      (JSON.parse(storedJson) as Array<{ lastSeenTurn: number; payloadJson: string }>).flatMap(
        (sighting) => {
          try {
            const region = JSON.parse(sighting.payloadJson) as ReportRegion | null;
            return region === null ? [] : [{ region, lastSeenTurn: sighting.lastSeenTurn }];
          } catch {
            return [];
          }
        }
      ),
    // Self-consistent, not correct: the real rule (and its tie-break) is the core's, pinned in
    // `reopen.rs` and against the real module in `reopen.wasm.test.ts`. This stand-in only has to
    // agree with itself so the routing tests below - which check the adapter hands over every
    // turn and the remembered faction rather than deciding the ranking here - read true.
    latest_turn_state: (turnsJson: string, activeFactionId: string | null) => {
      const turns = JSON.parse(turnsJson) as Array<{ factionId: string; turnNumber: number }>;
      const mine = turns.filter((turn) => turn.factionId === activeFactionId);
      const pool = mine.length > 0 ? mine : turns;
      const latest = pool.reduce<(typeof pool)[number] | null>(
        (best, turn) => (best === null || turn.turnNumber > best.turnNumber ? turn : best),
        null
      );
      return latest ? { factionId: latest.factionId, turnNumber: latest.turnNumber } : null;
    },
    /**
     * Self-consistent, not correct: it reads `MERGE: <factionId> <turn> <regionId,…>` out of the
     * text and folds those regions into whatever the adapter handed it. Which account of a hex wins
     * is the real core's business and is tested in Rust; what matters here is that the adapter reads
     * the *viewer's* rows, sends them across, and writes what comes back under the viewer's faction.
     */
    prepare_report_merge_state: (
      raw: string,
      viewerTurnNumber: number,
      viewerFactionId: string,
      existingSightingsJson: string
    ) => {
      const [, factionId, turn, regionList] = /MERGE: (\S+) (\d+) (\S+)/u.exec(raw) ?? [];
      // The real core answers this from the marker on the file's first line, and so does this.
      const mapExport = raw.startsWith("; Map export from Atlantis HUD");
      if (!factionId) {
        return {
          turnNumber: null,
          mergedFactionId: null,
          mergedFactionName: null,
          regionSightings: [],
          mergedRegionCount: 0,
          newRegionCount: 0,
          mapExport: false,
          rejection: "parsed report did not meet minimum import threshold"
        };
      }
      if (!mapExport && factionId === viewerFactionId) {
        return {
          turnNumber: Number(turn),
          mergedFactionId: null,
          mergedFactionName: null,
          regionSightings: [],
          mergedRegionCount: 0,
          newRegionCount: 0,
          mapExport: false,
          rejection: "a faction's own report is loaded rather than merged"
        };
      }
      if (!mapExport && Number(turn) !== viewerTurnNumber) {
        return {
          turnNumber: Number(turn),
          mergedFactionId: null,
          mergedFactionName: null,
          regionSightings: [],
          mergedRegionCount: 0,
          newRegionCount: 0,
          mapExport: false,
          rejection: `a report from turn ${turn} cannot be merged into turn ${viewerTurnNumber}`
        };
      }

      const existing = JSON.parse(existingSightingsJson) as Array<{ regionId: string }>;
      const known = new Set(existing.map((sighting) => sighting.regionId));
      // Split on "|", because a region id has a comma in it.
      const regions = regionList.split("|");
      return {
        turnNumber: viewerTurnNumber,
        mergedFactionId: factionId,
        mergedFactionName: `Faction ${factionId}`,
        regionSightings: regions.map((regionId) => ({
          regionId,
          lastSeenTurn: viewerTurnNumber,
          payloadJson: JSON.stringify({ regionId, mergedFrom: factionId })
        })),
        mergedRegionCount: regions.length,
        newRegionCount: regions.filter((regionId) => !known.has(regionId)).length,
        mapExport,
        rejection: null
      };
    },
    // Routing stand-ins, not the codec: the codec's rules are tested in Rust and against the real
    // module in gameBackup.wasm.test.ts.
    encode_game_backup_state: (contentJson: string, exportedAt: string) =>
      JSON.stringify(
        {
          format: "atlantis-hud-game-backup",
          version: 1,
          exportedAt,
          ...JSON.parse(contentJson)
        },
        null,
        2
      ),
    decode_game_backup_state: (backupJson: string, openedAt: string) => {
      const b = JSON.parse(backupJson) as Record<string, unknown>;
      // Self-consistent, not the real codec: the fields the fixtures below actually set come
      // through as-is, and whatever is missing defaults to empty - the same tolerance the real
      // decoder's `hexNotes` already has. The cast is the fake's, not production code's; the real
      // decoder is typed and tested against the real wasm module in gameBackup.wasm.test.ts.
      return {
        importedTurns: b.importedTurns ?? [],
        orderDrafts: b.orderDrafts ?? [],
        regionSightings: b.regionSightings ?? [],
        mergedReports: b.mergedReports ?? [],
        ...b,
        manifest: { ...(b.manifest as Record<string, unknown>), lastOpenedAt: openedAt },
        hexNotes: b.hexNotes ?? [],
        armies: b.armies ?? []
      } as unknown as ReturnType<CoreWasmModule["decode_game_backup_state"]>;
    },
    ...overrides
  };
  return createCoreWasmModuleDouble(stubs);
}

/** An Army with one member, for the tests that are about routing rather than about a snapshot. */
function anArmy(id: string, gameId = "p"): ArmyRecord {
  return {
    id,
    gameId,
    name: "Escort",
    members: [
      {
        unitId: "1",
        name: "Scouts",
        factionId: "95",
        factionName: "Borg TNG",
        own: true,
        regionId: "1:7,53",
        flags: [],
        items: [],
        skills: [],
        combatSpell: null,
        men: 1,
        seenTurn: 71,
        seenAt: "2026-08-01T09:00:00Z"
      }
    ],
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z"
  };
}

const REPORT = "TURN: 12 Spring\nFACTION: 17 | Crimson Tide";
const DB = "idb://game";
const NOW = "2026-08-01T09:00:00Z";
/** The clock is the caller's, here as on the desktop, so a test states it rather than mocks one. */
const IMPORTED_AT = "2026-08-01T10:00:00Z";

function manifest(gameId: string, gameName: string): GameManifest {
  return {
    manifestVersion: 1,
    metadata: { gameId, gameName, rulesetId: "neworigins" },
    reportSources: [],
    createdAt: NOW,
    lastOpenedAt: NOW
  };
}

describe("web core adapter", () => {
  it("changes a game's ruleset in the stored manifest", async () => {
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(fakeWasm(), store);
    await adapter.createGame(manifest("g1", "Game One"));

    const updated = (await adapter.setGameRuleset("g1", "magicdeep")) as GameManifest;

    expect(updated.metadata.rulesetId).toBe("magicdeep");
    // And it stuck: the registry's copy is what every later open reads.
    const stored = await store.getGame("g1");
    expect((stored?.manifest as GameManifest).metadata.rulesetId).toBe("magicdeep");
  });

  it("refuses to change the ruleset of a game it does not hold", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.setGameRuleset("ghost", "magicdeep")).rejects.toThrow(
      "no game with id ghost"
    );
  });

  it("renames a game in the stored manifest", async () => {
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(fakeWasm(), store);
    await adapter.createGame(manifest("g1", "Game One"));

    const updated = (await adapter.setGameName("g1", "Binding of the North")) as GameManifest;

    expect(updated.metadata.gameName).toBe("Binding of the North");
    // And it stuck: the registry's copy is what every later open reads.
    const stored = await store.getGame("g1");
    expect((stored?.manifest as GameManifest).metadata.gameName).toBe("Binding of the North");
  });

  it("remembers which faction is yours, and hands it back on the next open", async () => {
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(fakeWasm(), store);
    await adapter.createGame(manifest("g1", "Game One"));

    await adapter.setActiveFaction("g1", "95");

    const opened = await adapter.openGame("g1", "2026-08-17T00:00:00Z");
    expect((opened.manifest as GameManifest).metadata.activeFactionId).toBe("95");
  });

  it("refuses to record an active faction for a game it does not hold", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.setActiveFaction("ghost", "95")).rejects.toThrow("no game with id ghost");
  });

  it("refuses to rename a game it does not hold", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.setGameName("ghost", "Binding of the North")).rejects.toThrow(
      "no game with id ghost"
    );
  });

  it("routes logic calls to the core rather than to storage", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    expect(await adapter.getEngineInfo()).toEqual({
      id: "atlantis",
      name: "Atlantis PBEM",
      rulesetVersion: "4.0",
      maxFactionCount: 128
    });
    expect(await adapter.parseReport("anything")).toMatchObject({ raw: "anything" });
    // Every argument is asserted, not just the orders: the report and the option are what the
    // checks that read the turn depend on, and an adapter that dropped them would still return a
    // perfectly well-shaped answer with half the checks silently not run.
    expect(
      await adapter.validateOrders("MOVE R1 R2", null, "the report", ["hex-unguarded"])
    ).toEqual({
      diagnostics: [],
      silver: [],
      rawOrders: "MOVE R1 R2",
      rulesetJson: null,
      rawReport: "the report",
      disabledCodes: ["hex-unguarded"]
    });
    expect(await adapter.orderCommands()).toEqual(["GIVE", "MOVE", "WORK"]);
  });

  it("hands the ruleset to the wasm vocabulary call", async () => {
    let seen: string | null | undefined;
    const adapter = createWebCoreAdapter(
      fakeWasm({
        order_vocabulary_state: (rulesetJson: string | null) => {
          seen = rulesetJson;
          return ["ALL", "MOVE", "SILV"];
        }
      })
    );

    expect(await adapter.orderVocabulary("{}")).toEqual(["ALL", "MOVE", "SILV"]);
    expect(seen).toBe("{}");
  });

  it("routes an argument-completion call to the core, every argument included", async () => {
    const nameables = ["UNIT", "FACTION", "OBJECT", "CITY"].map((value) => ({
      value,
      name: "",
      detail: ""
    }));
    const adapter = createWebCoreAdapter(
      fakeWasm({
        order_argument_completions_state: (
          linePrefix: string,
          rulesetJson: string | null,
          rawReport: string | null,
          unitId: string | null
        ) =>
          linePrefix === "NAME U" && rulesetJson === "the ruleset" && rawReport === "the report" && unitId === "18642"
            ? nameables
            : []
      }),
      createMemoryWebStore()
    );

    expect(
      await adapter.orderArgumentCompletions("NAME U", "the ruleset", "the report", "18642")
    ).toEqual(nameables);
  });

  /**
   * The ruleset must reach the core, because the core classifies what gets stored with it. This is
   * what keeps a remembered unit's man count exact rather than a tilde'd estimate; dropping the
   * argument on the way through would revive the bug silently, since everything else still works.
   */
  it("hands the ruleset to the core when importing and when merging", async () => {
    const seen: Array<string | null> = [];
    const adapter = createWebCoreAdapter(
      fakeWasm({
        prepare_report_import_state: (raw: string, _faction: string, rulesetJson: string | null) => {
          seen.push(rulesetJson);
          return fakeWasm().prepare_report_import_state(raw, "17", rulesetJson);
        },
        report_import_writes_state: (
          raw: string,
          rulesetJson: string | null,
          existingImportedAt: string | null,
          seenJson: string,
          at: string
        ) => {
          seen.push(rulesetJson);
          return fakeWasm().report_import_writes_state(
            raw,
            rulesetJson,
            existingImportedAt,
            seenJson,
            at
          );
        },
        prepare_report_merge_state: (
          raw: string,
          viewerTurnNumber: number,
          viewerFactionId: string,
          existingSightingsJson: string,
          rulesetJson: string | null
        ) => {
          seen.push(rulesetJson);
          return fakeWasm().prepare_report_merge_state(
            raw,
            viewerTurnNumber,
            viewerFactionId,
            existingSightingsJson,
            rulesetJson
          );
        }
      }),
      createMemoryWebStore()
    );

    await adapter.commitReportImport(DB, "p", "17", REPORT, '{"items":{}}', false, IMPORTED_AT);
    await adapter.mergeReport(DB, "p", "95", 12, "MERGE: 73 12 1:1,1", '{"items":{}}', NOW);

    expect(seen).toEqual(['{"items":{}}', '{"items":{}}', '{"items":{}}']);
  });

  it("hands the stored stamp and the seen hexes to the core, and writes back what it returns", async () => {
    const seenArgs: Array<{ existingImportedAt: string | null; seenJson: string }> = [];
    const adapter = createWebCoreAdapter(
      fakeWasm({
        report_import_writes_state: (
          _raw: string,
          _rulesetJson: string | null,
          existingImportedAt: string | null,
          seenJson: string,
          _at: string
        ) => {
          seenArgs.push({ existingImportedAt, seenJson });
          return {
            importedAt: "core-says-imported",
            updatedAt: "core-says-updated",
            regionSightings: [{ regionId: "1:1,1", lastSeenTurn: 12, payloadJson: "{}" }]
          };
        }
      }),
      createMemoryWebStore()
    );

    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);

    const listed = (await adapter.listImportedTurns(DB, "p")) as ImportedTurnSummary[];
    expect(listed[0]?.importedAt).toBe("core-says-imported");
    expect(listed[0]?.updatedAt).toBe("core-says-updated");

    await adapter.commitReportImport(DB, "p", "17", REPORT, null, true, NOW);

    expect(seenArgs[1]?.existingImportedAt).toBe("core-says-imported");
    expect(JSON.parse(seenArgs[1]?.seenJson ?? "[]")).toEqual([
      { regionId: "1:1,1", lastSeenTurn: 12 }
    ]);
  });

  it("reports no conflict when the turn has never been imported", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const preview = await adapter.previewReportImport(DB, "p", "17", REPORT);

    expect(preview).toMatchObject({
      turnNumber: 12,
      duplicatePreview: { exists: false, rawChanged: false }
    });
  });

  it("detects a changed re-import of the same turn", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);

    const preview = await adapter.previewReportImport(DB, "p", "17", `${REPORT}\nextra`);

    expect(preview).toMatchObject({
      duplicatePreview: { exists: true, rawChanged: true, parsedChanged: true }
    });
  });

  it("refuses to overwrite an existing turn without confirmation", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);

    await expect(adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT)).rejects.toThrow(
      /requires explicit overwrite confirmation/u
    );
  });

  it("overwrites when confirmation is given", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);

    await expect(
      adapter.commitReportImport(DB, "p", "17", `${REPORT}\nextra`, null, true, IMPORTED_AT)
    ).resolves.toMatchObject({ exists: true, rawChanged: true });

    const loaded = await adapter.loadImportedTurn(DB, "p", "17", 12);
    expect(loaded).toMatchObject({ rawReport: `${REPORT}\nextra` });
  });

  it("refuses an import the core rejects, using the core's own wording", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.commitReportImport(DB, "p", "17", "no header", null, false, IMPORTED_AT)).rejects.toThrow(
      /did not meet minimum import threshold/u
    );
  });

  it("refuses an import under a faction the report does not contain", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.commitReportImport(DB, "p", "99", REPORT, null, false, IMPORTED_AT)).rejects.toThrow(
      /confirmed faction does not exist/u
    );
  });

  it("treats an absent rejection field as admissible", async () => {
    // serde_wasm_bindgen can emit undefined rather than null for Rust's None. An admissible
    // import must not be refused just because the field arrived in that shape.
    const wasm = fakeWasm({
      prepare_report_import_state: (raw: string) => ({
        turnNumber: 12,
        candidate: {
          rawReport: raw,
          parsedPayloadJson: `parsed:${raw}`,
          warningsPayloadJson: "[]"
        },
        parseResult: { ...EMPTY_PARSE_RESULT, raw }
        // rejection deliberately absent
      })
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await expect(adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT)).resolves.toMatchObject({
      exists: false
    });
  });

  it("still previews a report it would refuse to import", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.previewReportImport(DB, "p", "99", REPORT)).resolves.toMatchObject({
      turnNumber: 12
    });
  });

  it("keeps games apart even when they share a game id", async () => {
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.commitReportImport("idb://campaign-a", "p", "17", REPORT, null, false, IMPORTED_AT);

    // Same gameId, different game: must not be seen as a duplicate, and must not collide.
    const preview = await adapter.previewReportImport("idb://campaign-b", "p", "17", REPORT);
    expect(preview).toMatchObject({ duplicatePreview: { exists: false } });

    await adapter.commitReportImport("idb://campaign-b", "p", "17", `${REPORT}\nextra`, null, false, IMPORTED_AT);

    const a = await adapter.loadImportedTurn("idb://campaign-a", "p", "17", 12);
    const b = await adapter.loadImportedTurn("idb://campaign-b", "p", "17", 12);
    expect(a).toMatchObject({ rawReport: REPORT });
    expect(b).toMatchObject({ rawReport: `${REPORT}\nextra` });
  });

  it("keeps order drafts apart across games sharing a game id", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveOrderDraft("idb://campaign-a", "p", "17", 12, "@work", "t0");
    await adapter.saveOrderDraft("idb://campaign-b", "p", "17", 12, "@study comb", "t1");

    expect(await adapter.loadOrderDraft("idb://campaign-a", "p", "17", 12)).toMatchObject({
      orderText: "@work"
    });
    expect(await adapter.loadOrderDraft("idb://campaign-b", "p", "17", 12)).toMatchObject({
      orderText: "@study comb"
    });
  });

  it("rehydrates a stored parse result through the core, not in TypeScript", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);

    const loaded = await adapter.loadImportedTurn(DB, "p", "17", 12);

    expect(loaded).toMatchObject({
      key: { gameId: "p", factionId: "17", turnNumber: 12 },
      parseResult: { hydratedFrom: `parsed:${REPORT}` }
    });
  });

  it("returns null for a turn that was never imported", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    expect(await adapter.loadImportedTurn(DB, "p", "17", 99)).toBeNull();
  });

  it("has no latest turn in a game that holds no imports", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    // A game just created, not a failure. The workspace opens empty rather than refusing.
    expect(await adapter.loadLatestImportedTurn(DB, "p", null)).toBeNull();
  });

  /**
   * The browser answers "which turn do I come back to" the same way the desktop does.
   *
   * Both stores hand every turn and the remembered faction to the core, and it names the turn -
   * the same rule on both platforms, pinned once in `reopen.rs`.
   */
  it("reopens on the highest turn of the remembered faction", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const OTHER = "TURN: 12 Spring\nFACTION: 18 | Azure Wake";

    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, "2026-08-09T18:00:00Z");
    await adapter.commitReportImport(DB, "p", "18", OTHER, null, false, "2026-08-09T19:00:00Z");

    // Remembering none, the fallback takes the game's highest turn - here a tie the stand-in
    // settles on the first it saw.
    expect(await adapter.loadLatestImportedTurn(DB, "p", null)).toMatchObject({
      key: { gameId: "p", turnNumber: 12 }
    });

    // Remembering one, that faction's turn is the answer whatever else the game holds.
    expect(await adapter.loadLatestImportedTurn(DB, "p", "17")).toMatchObject({
      key: { gameId: "p", factionId: "17", turnNumber: 12 },
      rawReport: REPORT
    });
  });

  it("never reopens one game on another game's turn", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.commitReportImport("idb://campaign-a", "p", "17", REPORT, null, false, IMPORTED_AT);

    expect(await adapter.loadLatestImportedTurn("idb://campaign-b", "p", null)).toBeNull();
  });

  it("hands every turn and the remembered faction to the core, two fields each", async () => {
    let seenTurnsJson = "";
    let seenFaction: string | null | undefined;
    const wasm = fakeWasm({
      latest_turn_state: (turnsJson: string, activeFactionId: string | null) => {
        seenTurnsJson = turnsJson;
        seenFaction = activeFactionId;
        return { factionId: "17", turnNumber: 12 };
      }
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const OTHER = "TURN: 12 Spring\nFACTION: 18 | Azure Wake";

    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, "2026-08-09T18:00:00Z");
    await adapter.commitReportImport(DB, "p", "18", OTHER, null, false, "2026-08-09T19:00:00Z");
    await adapter.saveOrderDraft(DB, "p", "18", 12, "@work", "2026-08-09T20:00:00Z");

    const result = await adapter.loadLatestImportedTurn(DB, "p", "17");

    const seenTurns = JSON.parse(seenTurnsJson) as unknown[];
    expect(seenTurns).toEqual(
      expect.arrayContaining([
        { factionId: "17", turnNumber: 12 },
        { factionId: "18", turnNumber: 12 }
      ])
    );
    expect(seenTurns).toHaveLength(2);
    expect(seenFaction).toBe("17");
    expect(result?.rawReport).toBe(REPORT);
  });

  it("refuses to answer with a turn the store does not hold, rather than silently returning nothing", async () => {
    const wasm = fakeWasm({
      latest_turn_state: () => ({ factionId: "never-imported", turnNumber: 999 })
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);

    await expect(adapter.loadLatestImportedTurn(DB, "p", null)).rejects.toThrow(
      "the core named a turn the store does not hold"
    );
  });

  it("lists no turns for a game that holds none", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    expect(await adapter.listImportedTurns(DB, "p")).toEqual([]);
  });

  /**
   * Same wasm hydrator as `loadImportedTurn` and `loadLatestImportedTurn`, so the season comes
   * from wherever their parse results carry it, without a second copy of the parsing rules.
   *
   * The real hydrator returns `ReportParseResultWire`, camelCase throughout since ah-164.1: the
   * flattened `ReportParseResult` fields and `meetsMinimumImportThreshold` beside them agree on
   * casing now that the inner struct itself is `rename_all = "camelCase"`.
   */
  it("lists every imported turn of a game", async () => {
    const wasm = fakeWasm({
      hydrate_parse_result_state: (json: string) => ({
        ...EMPTY_PARSE_RESULT,
        hydratedFrom: json,
        turnHeader: { turnNumber: 12, season: "Spring" }
      })
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());
    const OTHER = "TURN: 12 Spring\nFACTION: 18 | Azure Wake";

    await adapter.commitReportImport(DB, "p", "17", REPORT, null, false, IMPORTED_AT);
    await adapter.commitReportImport(DB, "p", "18", OTHER, null, false, IMPORTED_AT);

    const listed = (await adapter.listImportedTurns(DB, "p")) as ImportedTurnSummary[];

    expect(listed).toHaveLength(2);
    expect(listed.map((summary) => summary.key.factionId).sort()).toEqual(["17", "18"]);
    expect(listed.every((summary) => summary.key.turnNumber === 12)).toBe(true);
    expect(listed.every((summary) => summary.season === "Spring")).toBe(true);
  });

  /**
   * The wasm hydrator throws on a payload it cannot parse - `hydrate_parse_result_state` returns
   * a Rust `Result`, and an `Err` crosses the boundary as a thrown JS exception. A list that let
   * one bad row's throw escape would lose every turn in the game to it, not just that one.
   */
  it("still lists a turn whose payload cannot be hydrated", async () => {
    const wasm = fakeWasm({
      hydrate_parse_result_state: () => {
        throw new Error("payload did not parse");
      }
    });
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(wasm, store);

    await store.putImportedTurn({
      databasePath: DB,
      gameId: "p",
      factionId: "17",
      turnNumber: 12,
      rawReport: REPORT,
      parsedPayloadJson: "not json at all",
      warningsPayloadJson: "[]",
      importedAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT
    });

    const listed = (await adapter.listImportedTurns(DB, "p")) as ImportedTurnSummary[];

    expect(listed).toHaveLength(1);
    expect(listed[0].season).toBeNull();
  });

  it("round trips an order draft", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveOrderDraft(DB, "p", "17", 12, "@work", "2026-08-08T00:00:00Z");

    expect(await adapter.loadOrderDraft(DB, "p", "17", 12)).toEqual({
      key: { gameId: "p", factionId: "17", turnNumber: 12 },
      orderText: "@work",
      updatedAt: "2026-08-08T00:00:00Z"
    });
  });

  it("returns null for an order draft that was never saved", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    expect(await adapter.loadOrderDraft(DB, "p", "17", 12)).toBeNull();
  });

  it("round trips hex notes", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveHexNote(DB, {
      id: "note-older",
      gameId: "p",
      regionId: "1:7,53",
      text: "First note",
      onMap: true,
      turn: 12,
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:00:00Z"
    });
    await adapter.saveHexNote(DB, {
      id: "note-newer",
      gameId: "p",
      regionId: "1:7,53",
      text: "Second note",
      onMap: false,
      turn: 13,
      createdAt: "2026-08-02T09:00:00Z",
      updatedAt: "2026-08-02T09:00:00Z"
    });

    const listed = (await adapter.listHexNotes(DB, "p")) as HexNoteRecord[];
    expect(listed.map((note) => note.id).sort()).toEqual(["note-newer", "note-older"]);
  });

  it("saves an Army through the adapter and lists it back with its members", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const army: ArmyRecord = {
      id: "army-1",
      gameId: "p",
      name: "Northern escort",
      members: [
        {
          unitId: "204",
          name: "Pikes",
          factionId: null,
          factionName: null,
          own: false,
          regionId: "1:7,53",
          flags: ["behind"],
          items: [{ amount: 57, name: "grain", tag: "GRAI" }],
          skills: [{ name: "combat", tag: "COMB", level: 2, points: 90 }],
          combatSpell: { name: "fire", tag: "FIRE" },
          men: 12,
          seenTurn: 68,
          seenAt: "2026-08-01T09:00:00Z"
        }
      ],
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:00:00Z"
    };

    await adapter.saveArmy(DB, army);

    expect(await adapter.listArmies(DB, "p")).toEqual([army]);
  });

  it("deletes an Army, and tolerates deleting it again", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.saveArmy(DB, anArmy("army-1"));

    await adapter.deleteArmy(DB, "p", "army-1");
    await adapter.deleteArmy(DB, "p", "army-1");

    expect(await adapter.listArmies(DB, "p")).toEqual([]);
  });

  it("stores a faction's mages and lists them back whole", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const mage = aMage("9001");

    await adapter.saveAlliedMages(DB, "p", [mage], []);

    expect(await adapter.listAlliedMages(DB, "p")).toEqual([mage]);
  });

  it("removes the mages named in the same call that stores the rest", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.saveAlliedMages(DB, "p", [aMage("9001"), aMage("9002")], []);

    await adapter.saveAlliedMages(
      DB,
      "p",
      [aMage("9003")],
      [{ factionId: "21", unitId: "9002" }]
    );

    const listed = (await adapter.listAlliedMages(DB, "p")) as AlliedMageRecord[];
    expect(listed.map((mage) => mage.unit.unitId).sort()).toEqual(["9001", "9003"]);
  });

  // The same resolution the desktop store documents and pins: `removed` is applied first, so a
  // unit named in both halves of one call ends up present. Both platforms must answer alike.
  it("stores a mage named in both halves of the same call", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const mage = aMage("9001");

    await adapter.saveAlliedMages(DB, "p", [mage], [{ factionId: "21", unitId: "9001" }]);

    expect(await adapter.listAlliedMages(DB, "p")).toEqual([mage]);
  });

  it("keeps allied mages apart per database", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveAlliedMages("idb://campaign-a", "p", [aMage("9001")], []);
    await adapter.saveAlliedMages("idb://campaign-b", "p", [aMage("9002")], []);

    expect(
      ((await adapter.listAlliedMages("idb://campaign-a", "p")) as AlliedMageRecord[])[0].unit
        .unitId
    ).toBe("9001");
    expect(
      ((await adapter.listAlliedMages("idb://campaign-b", "p")) as AlliedMageRecord[])[0].unit
        .unitId
    ).toBe("9002");
  });

  it("stores a mage's study plan and lists it back whole", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const plan = aStudyPlan("9001");

    await adapter.saveStudyPlans(DB, "p", [plan], []);

    expect(await adapter.listStudyPlans(DB, "p")).toEqual([plan]);
  });

  it("removes the study plans named in the same call that stores the rest", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.saveStudyPlans(DB, "p", [aStudyPlan("9001"), aStudyPlan("9002")], []);

    await adapter.saveStudyPlans(
      DB,
      "p",
      [aStudyPlan("9003")],
      [{ factionId: "21", unitId: "9002" }]
    );

    const listed = (await adapter.listStudyPlans(DB, "p")) as StudyPlanRecord[];
    expect(listed.map((plan) => plan.unitId).sort()).toEqual(["9001", "9003"]);
  });

  // The same resolution the desktop store documents and pins: `removed` is applied first, so a
  // unit named in both halves of one call ends up present. Both platforms must answer alike.
  it("stores a study plan named in both halves of the same call", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const plan = aStudyPlan("9001");

    await adapter.saveStudyPlans(DB, "p", [plan], [{ factionId: "21", unitId: "9001" }]);

    expect(await adapter.listStudyPlans(DB, "p")).toEqual([plan]);
  });

  it("keeps study plans apart per database", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveStudyPlans("idb://campaign-a", "p", [aStudyPlan("9001")], []);
    await adapter.saveStudyPlans("idb://campaign-b", "p", [aStudyPlan("9002")], []);

    expect(
      ((await adapter.listStudyPlans("idb://campaign-a", "p")) as StudyPlanRecord[])[0].unitId
    ).toBe("9001");
    expect(
      ((await adapter.listStudyPlans("idb://campaign-b", "p")) as StudyPlanRecord[])[0].unitId
    ).toBe("9002");
  });

  it("keeps Armies apart per database", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveArmy("idb://campaign-a", anArmy("army-a"));
    await adapter.saveArmy("idb://campaign-b", anArmy("army-b"));

    expect(((await adapter.listArmies("idb://campaign-a", "p")) as ArmyRecord[])[0]).toMatchObject({
      id: "army-a"
    });
    expect(((await adapter.listArmies("idb://campaign-b", "p")) as ArmyRecord[])[0]).toMatchObject({
      id: "army-b"
    });
  });

  // The adapter's contract is void (ah-wxk.2, matching the desktop side, which discards the same
  // bool Tauri answers with) - deleting twice must not throw either time, and the note is gone.
  it("deletes a hex note, and tolerates deleting it again", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.saveHexNote(DB, {
      id: "note-1",
      gameId: "p",
      regionId: "1:7,53",
      text: "text",
      onMap: true,
      turn: 12,
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:00:00Z"
    });

    await adapter.deleteHexNote(DB, "p", "note-1");
    await adapter.deleteHexNote(DB, "p", "note-1");

    expect(await adapter.listHexNotes(DB, "p")).toEqual([]);
  });

  it("keeps hex notes apart per database", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveHexNote("idb://campaign-a", {
      id: "note-1",
      gameId: "p",
      regionId: "1:7,53",
      text: "in a",
      onMap: true,
      turn: 12,
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:00:00Z"
    });
    await adapter.saveHexNote("idb://campaign-b", {
      id: "note-1",
      gameId: "p",
      regionId: "1:7,53",
      text: "in b",
      onMap: true,
      turn: 12,
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:00:00Z"
    });

    expect(((await adapter.listHexNotes("idb://campaign-a", "p")) as HexNoteRecord[])[0]).toMatchObject({
      text: "in a"
    });
    expect(((await adapter.listHexNotes("idb://campaign-b", "p")) as HexNoteRecord[])[0]).toMatchObject({
      text: "in b"
    });
  });

  it("refuses to create a game over an existing one", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.createGame(manifest("p", "P"));

    await expect(adapter.createGame(manifest("p", "P"))).rejects.toThrow(/already exists/u);
  });

  it("fails to open a game that was never created", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await expect(adapter.openGame("missing", NOW)).rejects.toThrow(/no game/u);
  });
});

describe("managing games", () => {
  it("lists every game that was created", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.createGame(manifest("alpha", "Alpha"));
    await adapter.createGame(manifest("beta", "Beta"));

    const listed = (await adapter.listGames()) as GameManifest[];

    expect(listed.map((game) => game.metadata.gameId).sort()).toEqual(["alpha", "beta"]);
  });

  it("has no games before any is created", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    expect(await adapter.listGames()).toEqual([]);
  });

  /** Which game reopens next launch is read off this stamp, so opening has to move it. */
  it("stamps when a game was last opened", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.createGame(manifest("alpha", "Alpha"));

    await adapter.openGame("alpha", "2026-08-09T18:30:00Z");

    const listed = (await adapter.listGames()) as GameManifest[];
    expect(listed[0].lastOpenedAt).toBe("2026-08-09T18:30:00Z");
    expect(listed[0].createdAt).toBe(NOW);
  });

  it("remembers which ruleset a game is played under", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.createGame(manifest("alpha", "Alpha"));

    const opened = (await adapter.openGame("alpha", NOW)) as { manifest: GameManifest };

    expect(opened.manifest.metadata.rulesetId).toBe("neworigins");
  });

  /**
   * The whole point of a database per game. A turn committed to one game must be invisible to the
   * other, and deleting a game must take its turns with it while leaving the survivor intact.
   */
  it("keeps one game's turns out of another, and deletes them with the game", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const alpha = (await adapter.createGame(manifest("alpha", "Alpha"))) as { databasePath: string };
    const beta = (await adapter.createGame(manifest("beta", "Beta"))) as { databasePath: string };

    await adapter.commitReportImport(alpha.databasePath, "alpha", "17", REPORT, null, false, IMPORTED_AT);

    expect(await adapter.loadImportedTurn(beta.databasePath, "beta", "17", 12)).toBeNull();

    await adapter.deleteGame("alpha");

    expect((await adapter.listGames()) as GameManifest[]).toHaveLength(1);
    expect(await adapter.loadImportedTurn(alpha.databasePath, "alpha", "17", 12)).toBeNull();
  });

  it("fails to delete a game that is not there", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await expect(adapter.deleteGame("missing")).rejects.toThrow(/no game/u);
  });

  it("empties a game and keeps it in the list", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const alpha = (await adapter.createGame(manifest("alpha", "Alpha"))) as { databasePath: string };
    await adapter.commitReportImport(
      alpha.databasePath,
      "alpha",
      "17",
      REPORT,
      null,
      false,
      IMPORTED_AT
    );
    await adapter.saveHexNote(alpha.databasePath, {
      id: "note-1",
      gameId: "alpha",
      regionId: "1:7,53",
      text: "Watch this pass",
      onMap: true,
      turn: 12,
      createdAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT
    });

    await adapter.resetGame("alpha", "2026-08-17T09:00:00Z");

    expect((await adapter.listGames()) as GameManifest[]).toHaveLength(1);
    expect(await adapter.loadLatestImportedTurn(alpha.databasePath, "alpha", null)).toBeNull();
    expect(await adapter.listHexNotes(alpha.databasePath, "alpha")).toEqual([]);
  });

  it("keeps the name and ruleset and forgets the faction", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.createGame(manifest("alpha", "Alpha"));
    await adapter.setActiveFaction("alpha", "17");

    const reset = (await adapter.resetGame("alpha", "2026-08-17T09:00:00Z")) as {
      manifest: GameManifest;
    };

    expect(reset.manifest.metadata.gameName).toBe("Alpha");
    expect(reset.manifest.metadata.rulesetId).toBe("neworigins");
    expect(reset.manifest.metadata.activeFactionId).toBeUndefined();
    expect(reset.manifest.reportSources).toEqual([]);
    expect(reset.manifest.createdAt).toBe("2026-08-17T09:00:00Z");

    // And it stuck: what a later open reads is the emptied manifest, not the old one.
    const reopened = (await adapter.openGame("alpha", "2026-08-17T10:00:00Z")) as {
      manifest: GameManifest;
    };
    expect(reopened.manifest.metadata.gameName).toBe("Alpha");
    expect(reopened.manifest.metadata.activeFactionId).toBeUndefined();
    expect(reopened.manifest.createdAt).toBe("2026-08-17T09:00:00Z");
  });

  it("a reset game is not another game's business", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const alpha = (await adapter.createGame(manifest("alpha", "Alpha"))) as { databasePath: string };
    const beta = (await adapter.createGame(manifest("beta", "Beta"))) as { databasePath: string };
    await adapter.commitReportImport(
      beta.databasePath,
      "beta",
      "17",
      REPORT,
      null,
      false,
      IMPORTED_AT
    );

    await adapter.resetGame("alpha", "2026-08-17T09:00:00Z");

    expect((await adapter.listGames()) as GameManifest[]).toHaveLength(2);
    expect(await adapter.loadLatestImportedTurn(beta.databasePath, "beta", null)).toMatchObject({
      key: { gameId: "beta", factionId: "17", turnNumber: 12 }
    });
    expect(alpha.databasePath).not.toBe(beta.databasePath);
  });
});

describe("exporting and importing games", () => {
  it("round trips one whole game through one backup file", async () => {
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(fakeWasm(), store);
    const opened = (await adapter.createGame(manifest("alpha", "Alpha"))) as { databasePath: string };

    await adapter.commitReportImport(opened.databasePath, "alpha", "17", REPORT, null, false, IMPORTED_AT);
    await adapter.saveOrderDraft(
      opened.databasePath,
      "alpha",
      "17",
      12,
      "@work\n@study combat",
      "2026-08-08T00:00:00Z"
    );
    await store.putRegionSightings([
      {
        databasePath: opened.databasePath,
        gameId: "alpha",
        factionId: "17",
        regionId: "1:7,53",
        lastSeenTurn: 12,
        payloadJson: JSON.stringify({ regionId: "1:7,53", terrain: "plain", exits: [] })
      }
    ]);
    await store.putMergedReport({
      databasePath: opened.databasePath,
      gameId: "alpha",
      factionId: "17",
      turnNumber: 12,
      mergedFactionId: "73",
      mergedFactionName: "Faction 73",
      mergedAt: "2026-08-08T00:05:00Z"
    });
    await adapter.saveHexNote(opened.databasePath, {
      id: "note-1",
      gameId: "alpha",
      regionId: "1:7,53",
      text: "Mustn't forget the mountain pass",
      onMap: true,
      turn: 12,
      createdAt: "2026-08-08T00:00:00Z",
      updatedAt: "2026-08-08T00:00:00Z"
    });

    await adapter.saveArmy(opened.databasePath, anArmy("army-1", "alpha"));
    await adapter.saveAlliedMages(opened.databasePath, "alpha", [aMage("9001")], []);

    const backupJson = (await adapter.exportGame("alpha", NOW)) as string;
    expect(JSON.parse(backupJson)).toMatchObject({
      format: "atlantis-hud-game-backup",
      version: 1,
      exportedAt: NOW,
      manifest: { metadata: { gameId: "alpha" } },
      importedTurns: [
        {
          factionId: "17",
          turnNumber: 12,
          rawReport: REPORT,
          importedAt: IMPORTED_AT,
          updatedAt: IMPORTED_AT
        }
      ],
      orderDrafts: [{ factionId: "17", turnNumber: 12, orderText: "@work\n@study combat" }],
      regionSightings: [{ factionId: "17", regionId: "1:7,53", lastSeenTurn: 12 }],
      mergedReports: [{ factionId: "17", turnNumber: 12, mergedFactionId: "73" }],
      hexNotes: [{ id: "note-1", regionId: "1:7,53", text: "Mustn't forget the mountain pass" }],
      armies: [{ id: "army-1", name: "Escort", members: [{ unitId: "1", seenTurn: 71 }] }],
      alliedMages: [{ factionId: "21", sheetTurn: 23, unit: { unitId: "9001" } }]
    });

    const imported = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const restored = (await imported.importGame(
      backupJson,
      "2026-08-09T18:30:00Z"
    )) as { databasePath: string; manifest: GameManifest };

    expect(restored.manifest.lastOpenedAt).toBe("2026-08-09T18:30:00Z");
    expect(await imported.loadImportedTurn(restored.databasePath, "alpha", "17", 12)).toEqual({
      key: { gameId: "alpha", factionId: "17", turnNumber: 12 },
      rawReport: REPORT,
      parseResult: { ...EMPTY_PARSE_RESULT, hydratedFrom: `parsed:${REPORT}` }
    });
    expect(await imported.loadOrderDraft(restored.databasePath, "alpha", "17", 12)).toEqual({
      key: { gameId: "alpha", factionId: "17", turnNumber: 12 },
      orderText: "@work\n@study combat",
      updatedAt: "2026-08-08T00:00:00Z"
    });
    expect(await imported.loadRegionSightings(restored.databasePath, "alpha", "17")).toEqual([
      {
        region: { regionId: "1:7,53", terrain: "plain", exits: [] },
        lastSeenTurn: 12
      }
    ]);
    expect(await imported.loadMergedReports(restored.databasePath, "alpha", "17", 12)).toEqual([
      {
        gameId: "alpha",
        factionId: "17",
        turnNumber: 12,
        mergedFactionId: "73",
        mergedFactionName: "Faction 73",
        mergedAt: "2026-08-08T00:05:00Z"
      }
    ]);
    expect(await imported.listHexNotes(restored.databasePath, "alpha")).toEqual([
      {
        id: "note-1",
        gameId: "alpha",
        regionId: "1:7,53",
        text: "Mustn't forget the mountain pass",
        onMap: true,
        turn: 12,
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:00:00Z"
      }
    ]);
    expect(await imported.listArmies(restored.databasePath, "alpha")).toEqual([
      anArmy("army-1", "alpha")
    ]);
    expect(await imported.listAlliedMages(restored.databasePath, "alpha")).toEqual([aMage("9001")]);
  });

  it("refuses to import over an existing game", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.createGame(manifest("alpha", "Alpha"));

    const backup = JSON.stringify({
      format: "atlantis-hud-game-backup",
      version: 1,
      manifest: manifest("alpha", "Alpha"),
      importedTurns: [],
      orderDrafts: [],
      regionSightings: [],
      mergedReports: []
    });

    await expect(adapter.importGame(backup, NOW)).rejects.toThrow(/already exists/u);
  });
});

describe("planning a route", () => {
  /**
   * Planning is pure, so the adapter has nothing to do but pass the arguments through in the right
   * order. Getting that order wrong would plan somebody else's move, so it is worth pinning - and
   * the map shape is pinned with them, because a shape that failed to arrive would draw the wrap
   * seam wrong with nothing to show for it.
   */
  it("passes the request straight to the core, unshuffled", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const answer = (await adapter.planRoute(
      "{ruleset}",
      "{report}",
      "[remembered]",
      "18642",
      "1:7,51",
      '{"width":72,"height":96,"wrapX":true,"wrapY":false}'
    )) as unknown as { echoed: Record<string, string> };

    expect(answer.echoed).toEqual({
      rulesetJson: "{ruleset}",
      rawReport: "{report}",
      rememberedJson: "[remembered]",
      unitId: "18642",
      destination: "1:7,51",
      mapJson: '{"width":72,"height":96,"wrapX":true,"wrapY":false}'
    });
  });
});

describe("finding trade routes", () => {
  /**
   * Finding routes is pure, so the adapter has nothing to do but hand back what the core found.
   */
  it("resolves to what the core found", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const routes = await adapter.tradeRoutes("{ruleset}", "{report}", "[remembered]", "");

    expect(routes).toEqual(FAKE_TRADE_ROUTES);
  });
});

describe("resolving the known map", () => {
  /**
   * Resolution is pure, so the adapter has nothing to do but pass the three arguments through in
   * the right order.
   */
  it("passes the request straight to the core, unshuffled", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const answer = (await adapter.knownMap("{report}", "{ruleset}", "[remembered]")) as unknown as {
      echoed: Record<string, string | null>;
    };

    expect(answer.echoed).toEqual({
      rawReport: "{report}",
      rulesetJson: "{ruleset}",
      rememberedJson: "[remembered]"
    });
  });

  it("passes a null ruleset through unchanged", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const answer = (await adapter.knownMap("{report}", null, "[]")) as unknown as {
      echoed: Record<string, string | null>;
    };

    expect(answer.echoed.rulesetJson).toBeNull();
  });
});

describe("remembering the map across turns", () => {
  /**
   * Builds the sighting rows the core hands over with a prepared import.
   *
   * These used to be harvested here from a second `parse_report_full_state` call, which meant the
   * report was parsed a third time and every region was serialized again in JavaScript. The core
   * has the parsed regions already, so it serializes them once and only the strings cross.
   */
  const prepareWith = (
    regions: Array<{ regionId: string; terrain: string }>
  ): Partial<CoreWasmModule> => ({
    prepare_report_import_state: (raw: string) => ({
      turnNumber: 12,
      candidate: {
        rawReport: raw,
        parsedPayloadJson: `parsed:${raw}`,
        warningsPayloadJson: "[]"
      },
      parseResult: { ...EMPTY_PARSE_RESULT, raw },
      rejection: null
    }),
    report_import_writes_state: (
      _raw: string,
      _rulesetJson: string | null,
      existingImportedAt: string | null,
      _seenJson: string,
      at: string
    ) => ({
      importedAt: existingImportedAt ?? at,
      updatedAt: at,
      regionSightings: regions.map((region) => ({
        regionId: region.regionId,
        lastSeenTurn: 12,
        payloadJson: JSON.stringify({ ...region, exits: [] })
      }))
    })
  });

  /**
   * The browser's half of what the desktop does into SQLite. Without it the map only ever knows the
   * latest report, and no route can be longer than one step - a report describes its neighbours but
   * not theirs.
   */
  it("remembers every region a committed import described", async () => {
    const wasm = fakeWasm(
      prepareWith([
        { regionId: "1:1,1", terrain: "plain" },
        { regionId: "1:2,2", terrain: "mountain" }
      ])
    );
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", null, true, IMPORTED_AT);
    const remembered = await adapter.loadRegionSightings("/db", "p", "12");

    expect(remembered).toEqual([
      { region: { regionId: "1:1,1", terrain: "plain", exits: [] }, lastSeenTurn: 12 },
      { region: { regionId: "1:2,2", terrain: "mountain", exits: [] }, lastSeenTurn: 12 }
    ]);
  });

  /**
   * Committing must not ask the core to read the report again.
   *
   * The report has already been parsed by the time this runs - once, for the map, which is the
   * parse the prepared import then reuses. Reading it again here cost more than that parse did,
   * because the whole model has to be converted into JavaScript objects to reach this function at
   * all, only to be thrown away once its regions have been serialized.
   */
  it("does not parse the report again to collect its regions", async () => {
    let fullParses = 0;
    const wasm = fakeWasm({
      ...prepareWith([{ regionId: "1:1,1", terrain: "plain" }]),
      parse_report_full_state: (_raw: string) => {
        fullParses += 1;
        return EMPTY_PARSED_REPORT;
      }
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", null, true, IMPORTED_AT);

    expect(fullParses).toBe(0);
    await expect(adapter.loadRegionSightings("/db", "p", "12")).resolves.toHaveLength(1);
  });

  /** A hex seen again replaces the older memory of it rather than accumulating a duplicate. */
  it("keeps one memory per hex, not one per turn", async () => {
    const store = createMemoryWebStore();

    let terrain = "plain";
    const adapter = createWebCoreAdapter(
      fakeWasm({
        prepare_report_import_state: (raw: string) => ({
          turnNumber: 12,
          candidate: {
            rawReport: raw,
            parsedPayloadJson: `parsed:${raw}`,
            warningsPayloadJson: "[]"
          },
          parseResult: { ...EMPTY_PARSE_RESULT, raw },
          rejection: null
        }),
        report_import_writes_state: (
          _raw: string,
          _rulesetJson: string | null,
          existingImportedAt: string | null,
          _seenJson: string,
          at: string
        ) => ({
          importedAt: existingImportedAt ?? at,
          updatedAt: at,
          regionSightings: [
            {
              regionId: "1:1,1",
              lastSeenTurn: 12,
              payloadJson: JSON.stringify({ regionId: "1:1,1", terrain, exits: [] })
            }
          ]
        })
      }),
      store
    );

    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", null, true, IMPORTED_AT);
    terrain = "mountain";
    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", null, true, IMPORTED_AT);

    const remembered = (await adapter.loadRegionSightings("/db", "p", "12")) as Array<{
      region: { terrain: string };
    }>;
    expect(remembered).toHaveLength(1);
    expect(remembered[0].region.terrain).toBe("mountain");
  });

  it("has nothing to remember before anything is imported", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.loadRegionSightings("/db", "p", "12")).resolves.toEqual([]);
  });

  /** A payload an older build wrote may not parse. Losing one hex beats losing the whole map. */
  it("skips a memory it cannot read rather than failing the lot", async () => {
    const store = createMemoryWebStore();
    await store.putRegionSightings([
      { databasePath: "/db", gameId: "p", factionId: "12", regionId: "1:1,1", lastSeenTurn: 9, payloadJson: "{" },
      { databasePath: "/db", gameId: "p", factionId: "12", regionId: "1:2,2", lastSeenTurn: 9, payloadJson: '{"regionId":"1:2,2"}' }
    ]);
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    const remembered = await adapter.loadRegionSightings("/db", "p", "12");
    expect(remembered).toEqual([{ region: { regionId: "1:2,2" }, lastSeenTurn: 9 }]);
  });
});

describe("merging an allied report", () => {
  const MERGED_AT = "2026-08-10T18:30:00Z";
  /** Faction 73's turn 71, covering a hex the viewer has and one it has not. */
  const ALLY = "MERGE: 73 71 1:1,1|1:9,9";

  const withViewersMap = async () => {
    const store = createMemoryWebStore();
    await store.putRegionSightings([
      {
        databasePath: "/db",
        gameId: "p",
        factionId: "95",
        regionId: "1:1,1",
        lastSeenTurn: 71,
        payloadJson: '{"regionId":"1:1,1"}'
      }
    ]);
    return store;
  };

  /**
   * The rows have to land under the viewer, not the reporter. The map is read back one faction at
   * a time, so a row filed under the ally would be written perfectly and never looked at again.
   */
  it("writes the ally's hexes into the viewer's map", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    const result = await adapter.mergeReport("/db", "p", "95", 71, ALLY, null, MERGED_AT);

    expect(result).toEqual({
      turnNumber: 71,
      mergedFactionId: "73",
      mergedFactionName: "Faction 73",
      mergedRegionCount: 2,
      newRegionCount: 1
    });
    await expect(adapter.loadRegionSightings("/db", "p", "95")).resolves.toHaveLength(2);
    await expect(adapter.loadRegionSightings("/db", "p", "73")).resolves.toEqual([]);
  });

  const OWN_MAP_EXPORT = "; Map export from Atlantis HUD\nMERGE: 95 40 1:5,5";
  const ALLYS_MAP_EXPORT = "; Map export from Atlantis HUD\nMERGE: 73 40 1:5,5";

  /**
   * A map export of the viewer's own map would file a provenance row naming the viewer as their own
   * ally, which is nonsense in front of anything reading `loadMergedReports`.
   */
  it("records no ally for a map export of the viewer's own map", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.mergeReport("/db", "p", "95", 71, OWN_MAP_EXPORT, null, MERGED_AT);

    await expect(adapter.loadMergedReports("/db", "p", "95", 71)).resolves.toEqual([]);
    await expect(adapter.loadRegionSightings("/db", "p", "95")).resolves.toHaveLength(2);
  });

  /** An ally's map export still records who it came from, which is provenance worth keeping. */
  it("records the ally behind their own map export", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.mergeReport("/db", "p", "95", 71, ALLYS_MAP_EXPORT, null, MERGED_AT);

    await expect(adapter.loadMergedReports("/db", "p", "95", 71)).resolves.toMatchObject([
      { mergedFactionId: "73" }
    ]);
  });

  /**
   * The proof that merging is not importing. Storing the ally's turn would put it at the top of
   * `loadLatestImportedTurn`, so reopening the game would silently come back up as the ally.
   */
  it("stores no turn of the ally's", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.mergeReport("/db", "p", "95", 71, ALLY, null, MERGED_AT);

    await expect(store.getImportedTurns("/db", "p")).resolves.toEqual([]);
    await expect(adapter.loadLatestImportedTurn("/db", "p", null)).resolves.toBeNull();
  });

  it("records who was merged, and reads it back oldest first", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.mergeReport("/db", "p", "95", 71, "MERGE: 81 71 1:5,5", null, "2026-08-10T19:00:00Z");
    await adapter.mergeReport("/db", "p", "95", 71, ALLY, null, MERGED_AT);

    const merged = await adapter.loadMergedReports("/db", "p", "95", 71);
    expect(merged).toEqual([
      {
        gameId: "p",
        factionId: "95",
        turnNumber: 71,
        mergedFactionId: "73",
        mergedFactionName: "Faction 73",
        mergedAt: MERGED_AT
      },
      {
        gameId: "p",
        factionId: "95",
        turnNumber: 71,
        mergedFactionId: "81",
        mergedFactionName: "Faction 81",
        mergedAt: "2026-08-10T19:00:00Z"
      }
    ]);
  });

  it("keeps one record per ally however often it is merged", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.mergeReport("/db", "p", "95", 71, ALLY, null, MERGED_AT);
    await adapter.mergeReport("/db", "p", "95", 71, ALLY, null, "2026-08-10T21:00:00Z");

    const merged = await store.getMergedReports("/db", "p", "95", 71);
    expect(merged).toHaveLength(1);
    expect(merged[0].mergedAt).toBe("2026-08-10T21:00:00Z");
  });

  it("refuses a report the core will not merge, in the core's own words", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(
      adapter.mergeReport("/db", "p", "95", 71, "MERGE: 73 2 1:1,1", null, MERGED_AT)
    ).rejects.toThrow("a report from turn 2 cannot be merged into turn 71");
  });

  /**
   * The desktop's `command_merge_report` refuses this in the same words, and the two commands have
   * to stay equivalent. The workspace never asks for it - `decideReportLoad` only offers a merge
   * when the factions differ - but the adapter is a contract, not only the thing that shell calls,
   * and a faction's own report merged rather than loaded would write its regions by a route that
   * stores no turn at all.
   */
  it("refuses a faction's own report, as the desktop does", async () => {
    const store = await withViewersMap();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await expect(
      adapter.mergeReport("/db", "p", "95", 71, "MERGE: 95 71 1:1,1", null, MERGED_AT)
    ).rejects.toThrow("a faction's own report is loaded rather than merged");

    // And refuses it before writing anything, rather than half way through.
    await expect(store.getMergedReports("/db", "p", "95", 71)).resolves.toEqual([]);
    await expect(store.getRegionSightings("/db", "p", "95")).resolves.toHaveLength(1);
  });

  it("has nothing merged into a turn nothing was merged into", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.loadMergedReports("/db", "p", "95", 71)).resolves.toEqual([]);
  });
});

/** One mage's plan for next turn, as the planner will write it. */
function aStudyPlan(unitId: string, factionId = "21"): StudyPlanRecord {
  return {
    factionId,
    unitId,
    skill: "FORC",
    targetLevel: 4,
    comment: "heading for Gate Lore",
    updatedAt: "2026-08-07T12:00:00Z"
  };
}

/** An allied mage, as a sheet described him. */
function aMage(unitId: string, factionId = "21"): AlliedMageRecord {
  return {
    factionId,
    factionName: "Borg",
    unit: {
      unitId,
      name: "Sweep Mage",
      regionId: "1:7,53",
      factionId,
      factionName: "Borg",
      own: false,
      onGuard: false,
      flags: [],
      items: [{ amount: 1, name: "leader", tag: "LEAD" }],
      skills: [{ name: "force", tag: "FORC", level: 3, points: 180 }],
      combatSpell: { name: "fire", tag: "FIRE" },
      men: 1,
      menEstimated: true,
      menByRace: [],
      weight: null,
      capacity: null,
      movement: null,
      structureId: null
    },
    sheetTurn: 23,
    receivedAt: "2026-08-01T09:00:00Z"
  };
}
