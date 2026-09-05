/**
 * Web `CoreAdapter`: game logic from the Rust core compiled to WebAssembly, storage from the
 * browser.
 *
 * The split is deliberate. Parsing, order validation, the import-viability threshold and the
 * import-conflict comparison all come from Rust, so the desktop and the browser can never reach
 * different verdicts. Only the read and the write are the browser's own, and those carry no rules.
 */

import type {
  CoreAdapter,
  EngineInfo,
  GameManifest,
  ManifestEdit,
  MapShape,
  MergedReportRecord,
  AlliedMageKey,
  StudyPlanKey,
  StudyPlanRecord,
  AlliedMageRecord,
  ArmyRecord,
  HexNoteRecord,
  KnownMap,
  MoveOrderTraceResponse,
  CaretCompletions,
  OrderCompletion,
  OrderValidationResult,
  OrdersPreviewResponse,
  ParsedReport,
  ReportParseResult,
  ReportRegion,
  RosterSkills,
  RoutePlanResponse,
  TradeRoute,
  TurnRef
} from "@atlantis/core-client";
import type { StoredTurn, StoredTurnSnapshot, WebStore } from "./webStore";
import { createWebStore } from "./webStore";

/**
 * The subset of the generated wasm module this adapter needs, typed against what each function
 * hands back rather than `unknown` — the one trust point on the web, mirroring `invoke<T>` on the
 * desktop: the module's return types are what the core serializes, checked nowhere at runtime
 * (ah-wxk.2).
 */
export type CoreWasmModule = {
  get_engine_info(): EngineInfo;
  parse_report_state(rawReport: string): ReportParseResult;
  parse_report_full_state(rawReport: string): ParsedReport;
  roster_skills_state(rawReport: string): RosterSkills[];
  parse_report_classified_state(rawReport: string, rulesetJson: string): ParsedReport;
  validate_orders_state(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport: string | null,
    disabledCodes: readonly string[] | null
  ): OrderValidationResult;
  order_commands_state(): string[];
  order_vocabulary_state(rulesetJson: string | null): string[];
  order_argument_completions_state(
    linePrefix: string,
    rulesetJson: string | null,
    rawReport: string | null,
    unitId: string | null
  ): OrderCompletion[];
  completions_at_caret_state(
    linePrefix: string,
    rulesetJson: string | null,
    rawReport: string | null,
    unitId: string | null
  ): CaretCompletions;
  plan_route_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string,
    mapJson: string
  ): RoutePlanResponse;
  trace_move_orders_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    ordersDocument: string,
    mapJson: string
  ): MoveOrderTraceResponse;
  export_map_state(rawReport: string, rememberedJson: string, requestJson: string): string;
  export_mage_sheet_state(rawReport: string, unitIdsJson: string): string;
  known_map_state(
    rawReport: string,
    rulesetJson: string | null,
    rememberedJson: string
  ): KnownMap;
  preview_orders_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    ordersDocument: string,
    mapJson: string
  ): OrdersPreviewResponse;
  trade_routes_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    mapJson: string
  ): TradeRoute[];
  prepare_report_import_state(
    rawReport: string,
    confirmedFactionId: string,
    rulesetJson: string | null
  ): PreparedImport;
  reset_game_manifest_state(manifestJson: string, now: string): GameManifest;
  edit_game_manifest_state(manifestJson: string, editJson: string): GameManifest;
  report_import_writes_state(
    rawReport: string,
    rulesetJson: string | null,
    existingImportedAt: string | null,
    seenJson: string,
    at: string
  ): ImportWrites;
  prepare_report_merge_state(
    rawReport: string,
    viewerTurnNumber: number,
    viewerFactionId: string,
    existingSightingsJson: string,
    rulesetJson: string | null
  ): PreparedMerge;
  diff_imported_turn_state(
    existing: StoredTurnSnapshot | null,
    candidate: StoredTurnSnapshot
  ): ImportedTurnDiff;
  hydrate_parse_result_state(parsedPayloadJson: string): ReportParseResult;
  /** Fills the split structure fields of a region payload remembered before `ah-nmts`. */
  ordered_merged_reports_state(recordsJson: string): MergedReportRecord[];
  remembered_regions_state(
    storedJson: string
  ): Array<{ region: ReportRegion; lastSeenTurn: number }>;
  /**
   * Which turn a game reopens on, given every turn's `(factionId, turnNumber)` as a JSON array
   * and the faction the game remembers as the player's. Returns `{ factionId, turnNumber }` or
   * `null`. The rule and its one tie-break are `atlantis_hud_core::reopen::latest_turn`'s.
   */
  latest_turn_state(turnsJson: string, activeFactionId: string | null): TurnRef | null;
  encode_game_backup_state(contentJson: string, exportedAt: string): string;
  decode_game_backup_state(backupJson: string, openedAt: string): DecodedGameBackup;
};

/** One region as the core serialized it, ready to be written as a row. */
type PreparedRegionSighting = {
  regionId: string;
  lastSeenTurn: number;
  payloadJson: string;
};

type PreparedImport = {
  turnNumber: number | null;
  candidate: StoredTurnSnapshot;
  parseResult: ReportParseResult;
  /**
   * `null` when the report may be imported; otherwise the core's reason to refuse it. Optional
   * because `prepare` below tolerates its absence: `serde_wasm_bindgen` can omit a `None`-valued
   * field entirely rather than serializing it as `null`, depending on serializer settings, and
   * this one has always been read with `??` for exactly that reason.
   */
  rejection?: string | null;
};

/** What the core says one import writes: the turn's two stamps and the hexes to remember. */
type ImportWrites = {
  importedAt: string;
  updatedAt: string;
  regionSightings: PreparedRegionSighting[];
};

type PreparedMerge = {
  turnNumber: number | null;
  mergedFactionId: string | null;
  mergedFactionName: string | null;
  /** Only the rows that changed. The core decides which those are; the store just writes them. */
  regionSightings: PreparedRegionSighting[];
  mergedRegionCount: number;
  newRegionCount: number;
  /**
   * Whether the core recognised the file as one of our own map exports. The core decides it, for
   * the same reason it decides the merge: the desktop must not be able to answer differently.
   */
  mapExport: boolean;
  /** `null` when the report may be merged; otherwise the core's reason to refuse it. */
  rejection: string | null;
};

type ImportedTurnDiff = {
  exists: boolean;
  rawChanged: boolean;
  parsedChanged: boolean;
  warningsChanged: boolean;
};

/**
 * What `decode_game_backup_state` hands back: rows ready to write, and a manifest already stamped
 * with the opening time. Mirrors the core's `DecodedGameBackup`, camelCase.
 */
type DecodedGameBackup = {
  manifest: GameManifest;
  importedTurns: Array<
    StoredTurnSnapshot & {
      factionId: string;
      turnNumber: number;
      importedAt: string;
      updatedAt: string;
    }
  >;
  orderDrafts: Array<{
    factionId: string;
    turnNumber: number;
    orderText: string;
    updatedAt: string;
  }>;
  regionSightings: Array<{
    factionId: string;
    regionId: string;
    lastSeenTurn: number;
    payloadJson: string;
  }>;
  mergedReports: Array<{
    factionId: string;
    turnNumber: number;
    mergedFactionId: string;
    mergedFactionName: string;
    mergedAt: string;
  }>;
  // A decoded note carries no gameId - the file never carries one, the store adds it.
  hexNotes: Array<Omit<HexNoteRecord, "gameId">>;
  // Same for an Army: the game is the document's, not the row's.
  armies: Array<Omit<ArmyRecord, "gameId">>;
  // No `Omit`: an allied mage row carries no gameId to strip.
  alliedMages: AlliedMageRecord[];
  // Same for a study plan.
  studyPlans: StudyPlanRecord[];
};

/**
 * The web has no filesystem, so a game's "database path" is just a stable handle derived from its
 * id. It keeps the `CoreClient` contract identical across platforms: the desktop puts a real path
 * in this slot, the browser puts a handle, and neither caller has to know which.
 */
function databaseHandleFor(gameId: string): string {
  return `idb://game-${gameId}`;
}

/**
 * Refuses an inadmissible import using the core's own wording.
 *
 * The desktop path refuses the same reports for the same reasons, because both ask the same Rust
 * function. Never restate the rule here.
 */
function requireAdmissible(prepared: PreparedImport): number {
  if (prepared.rejection !== null) {
    throw new Error(prepared.rejection);
  }
  if (prepared.turnNumber === null) {
    throw new Error("turn header missing from parsed report");
  }
  return prepared.turnNumber;
}

/**
 * A row stored before goals existed, read as a one-goal queue.
 *
 * The desktop's 0012 migration does this in SQL; IndexedDB has no migration step, so the browser
 * does it here, on the one path every read takes. Rows like these only exist in a local build -
 * study plans were never in a release before goals were - so this is a courtesy, not a contract,
 * and it can be deleted once no such browser is left.
 */
function withGoals(
  plan: StudyPlanRecord & { skill?: string | null; targetLevel?: number | null }
): StudyPlanRecord {
  // `turn: 0` for anything written before ah-lyg6.2.3's redesign, exactly as the desktop reader
  // answers: a queue of goals names no turn and cannot be converted without the report it was
  // projected against, so `plannedGoals` drops it and the next save rewrites the row.
  const goals =
    plan.goals ?? (plan.skill ? [{ kind: "study" as const, turn: 0, skill: plan.skill }] : []);
  // Built field by field rather than spread-minus-the-legacy-ones, so a flat `skill` or
  // `targetLevel` column cannot reach a caller however many of them a stored row turns out to
  // carry. A goal written before ah-lyg6.3 carries no discriminant, and is stamped here for the
  // same reason and deletable on the same day: study plans were never in a release.
  return {
    factionId: plan.factionId,
    unitId: plan.unitId,
    comment: plan.comment,
    updatedAt: plan.updatedAt,
    goals: goals.map((goal) => {
      const one = goal as { kind?: string; turn?: number; skill?: string; students?: string[] };
      return one.kind === "teach"
        ? { kind: "teach" as const, turn: one.turn ?? 0, students: one.students ?? [] }
        : { kind: "study" as const, turn: one.turn ?? 0, skill: one.skill ?? "" };
    })
  };
}

export function createWebCoreAdapter(
  wasm: CoreWasmModule,
  store: WebStore = createWebStore()
): CoreAdapter {
  const prepare = (
    rawReport: string,
    confirmedFactionId: string,
    rulesetJson: string | null
  ): PreparedImport => {
    const prepared = wasm.prepare_report_import_state(rawReport, confirmedFactionId, rulesetJson);

    // Rust's None can arrive as undefined rather than null depending on serializer settings, and
    // the checks below are written against null. Normalise once, here.
    return {
      ...prepared,
      turnNumber: prepared.turnNumber ?? null,
      rejection: prepared.rejection ?? null
    };
  };

  /** Whether a candidate changes what is already stored, given whatever is already stored. */
  const diffAgainst = (stored: StoredTurn | null, candidate: StoredTurnSnapshot) => {
    const existing: StoredTurnSnapshot | null = stored
      ? {
          rawReport: stored.rawReport,
          parsedPayloadJson: stored.parsedPayloadJson,
          warningsPayloadJson: stored.warningsPayloadJson
        }
      : null;

    return wasm.diff_imported_turn_state(existing, candidate);
  };

  const diffAgainstStored = async (
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number,
    candidate: StoredTurnSnapshot
  ): Promise<ImportedTurnDiff> =>
    diffAgainst(
      await store.getImportedTurn(databasePath, gameId, factionId, turnNumber),
      candidate
    );

  return {
    async getEngineInfo() {
      return wasm.get_engine_info();
    },

    async parseReport(rawReport: string) {
      return wasm.parse_report_state(rawReport);
    },

    async parseReportFull(rawReport: string) {
      return wasm.parse_report_full_state(rawReport);
    },

    async rosterSkills(rawReport: string) {
      return wasm.roster_skills_state(rawReport);
    },

    async loadRegionSightings(databasePath: string, gameId: string, factionId: string) {
      const stored = await store.getRegionSightings(databasePath, gameId, factionId);

      // Which hexes survive, what an old payload is back-filled with, and the order they come back
      // in are all the core's, and the desktop asks it the same question (`ah-8z4y.3.2`). Catching
      // a throw per hex used to decide the first of those here, and decided it differently: the
      // hydrator does not throw on a stored `null`, so the map was handed a region that was not one.
      return wasm.remembered_regions_state(
        JSON.stringify(
          stored.map((sighting) => ({
            regionId: sighting.regionId,
            lastSeenTurn: sighting.lastSeenTurn,
            payloadJson: sighting.payloadJson
          }))
        )
      );
    },
    /**
     * Folds an allied report into the viewer's map: read, rule, write.
     *
     * The three steps are the desktop's three steps, in the same order, against a different store.
     * Only the middle one carries any judgement and it is the core's: which account of a hex wins,
     * which of the ally's units may be commanded, whether the report belongs to this turn at all.
     *
     * The rows are written under `viewerFactionId`, never the report's own. That is the whole point
     * of merging rather than importing - the map is read back one faction at a time, so a row filed
     * under the ally would be stored perfectly and never looked at. Nothing is written to
     * `importedTurns`, so which turn the game reopens on is left exactly as it was.
     */
    async mergeReport(
      databasePath: string,
      gameId: string,
      viewerFactionId: string,
      viewerTurnNumber: number,
      rawReport: string,
      rulesetJson: string | null,
      mergedAt: string
    ) {
      const existing = await store.getRegionSightings(databasePath, gameId, viewerFactionId);
      const prepared = wasm.prepare_report_merge_state(
        rawReport,
        viewerTurnNumber,
        // Whose map is being merged into: the core refuses a faction's own report, so this is the
        // last thing it was missing to decide every merge rule itself (`ah-8z4y.3.2`).
        viewerFactionId,
        // Three fields, because three fields are all a merge reads and all this store holds. The
        // coordinate and label a sighting also carries are derived from the payload, and the core
        // derives them again from the merged one.
        JSON.stringify(
          existing.map((sighting) => ({
            regionId: sighting.regionId,
            lastSeenTurn: sighting.lastSeenTurn,
            payloadJson: sighting.payloadJson
          }))
        ),
        rulesetJson
      );

      if (prepared.rejection) {
        throw new Error(prepared.rejection);
      }
      if (prepared.turnNumber === null || prepared.mergedFactionId === null) {
        throw new Error("merged report does not name its turn or its faction");
      }
      await store.putRegionSightings(
        prepared.regionSightings.map((sighting) => ({
          databasePath,
          gameId,
          factionId: viewerFactionId,
          regionId: sighting.regionId,
          lastSeenTurn: sighting.lastSeenTurn,
          payloadJson: sighting.payloadJson
        }))
      );

      // A map export of the viewer's own map writes no provenance row: its key would name the
      // viewer as their own ally, which is nonsense in front of anything reading merged reports.
      // An ally's map export still writes one, which is the provenance worth keeping.
      const ownMapExport = prepared.mapExport && prepared.mergedFactionId === viewerFactionId;
      if (!ownMapExport) {
        await store.putMergedReport({
          databasePath,
          gameId,
          factionId: viewerFactionId,
          turnNumber: prepared.turnNumber,
          mergedFactionId: prepared.mergedFactionId,
          mergedFactionName: prepared.mergedFactionName ?? prepared.mergedFactionId,
          mergedAt
        });
      }

      return {
        turnNumber: prepared.turnNumber,
        mergedFactionId: prepared.mergedFactionId,
        mergedFactionName: prepared.mergedFactionName ?? prepared.mergedFactionId,
        mergedRegionCount: prepared.mergedRegionCount,
        newRegionCount: prepared.newRegionCount
      };
    },

    async loadMergedReports(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number
    ) {
      const stored = await store.getMergedReports(databasePath, gameId, factionId, turnNumber);

      // The order is the core's, and the desktop's ORDER BY implements the same definition. The
      // panel lists them in the order they happened, and a list that reorders itself between
      // platforms is two applications (`ah-8z4y.3.2`).
      return wasm.ordered_merged_reports_state(
        JSON.stringify(
          stored.map((record) => ({
            gameId: record.gameId,
            factionId: record.factionId,
            turnNumber: record.turnNumber,
            mergedFactionId: record.mergedFactionId,
            mergedFactionName: record.mergedFactionName,
            mergedAt: record.mergedAt
          }))
        )
      );
    },

    async parseReportClassified(rawReport: string, rulesetJson: string) {
      return wasm.parse_report_classified_state(rawReport, rulesetJson);
    },
    async planRoute(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      destination: string,
      mapJson: string
    ) {
      // Straight through to the core: unlike the persistence entry points there is no browser
      // storage to stand in for a database. The report goes as text, which is what the core keys
      // its last parse on, so planning over the turn already on screen re-parses nothing.
      return wasm.plan_route_state(
        rulesetJson,
        rawReport,
        rememberedJson,
        unitId,
        destination,
        mapJson
      );
    },
    async traceMoveOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      ordersDocument: string,
      mapJson: string
    ) {
      // Straight through for the same reason planRoute is: no browser storage stands in. The whole
      // document goes, not one unit's block: a passenger's route is the hull's (ah-048).
      return wasm.trace_move_orders_state(
        rulesetJson,
        rawReport,
        rememberedJson,
        unitId,
        ordersDocument,
        mapJson
      );
    },
    async exportMap(rawReport: string, rememberedJson: string, requestJson: string) {
      // Straight through as well: the export is pure computation over the arguments, and the file
      // it produces is handed back as text for the shell to save.
      return wasm.export_map_state(rawReport, rememberedJson, requestJson);
    },
    async exportMageSheet(rawReport: string, unitIdsJson: string) {
      // Straight through as well: the sheet is pure computation over the arguments, and the file
      // it produces is handed back as text for the shell to save.
      return wasm.export_mage_sheet_state(rawReport, unitIdsJson);
    },
    async knownMap(rawReport: string, rulesetJson: string | null, rememberedJson: string) {
      // Straight through as well: the resolution is pure computation over the arguments.
      return wasm.known_map_state(rawReport, rulesetJson, rememberedJson);
    },
    async previewOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      ordersDocument: string,
      mapJson: string
    ) {
      // Straight through as well: the preview is pure computation over the arguments.
      return wasm.preview_orders_state(
        rulesetJson,
        rawReport,
        rememberedJson,
        ordersDocument,
        mapJson
      );
    },
    async tradeRoutes(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      mapJson: string
    ) {
      // Straight through as well: finding routes is pure computation over the arguments.
      return wasm.trade_routes_state(rulesetJson, rawReport, rememberedJson, mapJson);
    },
    async validateOrders(
      rawOrders: string,
      rulesetJson: string | null,
      rawReport: string | null,
      disabledCodes: readonly string[] | null
    ) {
      // As with planning, the report goes across as text: the core keys its last parse on it, so
      // validating against the turn already on screen re-parses nothing.
      return wasm.validate_orders_state(rawOrders, rulesetJson, rawReport, disabledCodes);
    },
    async orderCommands() {
      return wasm.order_commands_state();
    },
    async orderVocabulary(rulesetJson: string | null) {
      return wasm.order_vocabulary_state(rulesetJson);
    },
    async orderArgumentCompletions(
      linePrefix: string,
      rulesetJson: string | null,
      rawReport: string | null,
      unitId: string | null
    ) {
      return wasm.order_argument_completions_state(linePrefix, rulesetJson, rawReport, unitId);
    },
    async completionsAtCaret(
      linePrefix: string,
      rulesetJson: string | null,
      rawReport: string | null,
      unitId: string | null
    ) {
      return wasm.completions_at_caret_state(linePrefix, rulesetJson, rawReport, unitId);
    },

    async listGames() {
      // The registry stores a manifest as an untyped blob; every other read of it in this file
      // (openGame, setGameRuleset, setGameName below) trusts the same cast.
      return (await store.listGames()).map((game) => game.manifest as GameManifest);
    },

    async createGame(manifest: GameManifest) {
      const gameId = manifest.metadata.gameId;
      const existing = await store.getGame(gameId);
      if (existing) {
        throw new Error(`game already exists: ${gameId}`);
      }

      const game = {
        gameId,
        databasePath: databaseHandleFor(gameId),
        schemaVersion: 1,
        manifest
      };
      await store.putGame(game);
      return { ...game, gameFilePath: game.databasePath };
    },

    async openGame(gameId: string, openedAt: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // What an edit does to a manifest is the core's, and so is this one: the stamp is what
      // decides which game reopens next launch, so the two platforms cannot be allowed to
      // disagree about it (`ah-8z4y.3.1`).
      const edit: ManifestEdit = { kind: "opened", value: openedAt };
      const manifest = wasm.edit_game_manifest_state(
        JSON.stringify(game.manifest),
        JSON.stringify(edit)
      );
      const opened = { ...game, manifest };
      await store.putGame(opened);
      return { ...opened, gameFilePath: opened.databasePath };
    },

    async deleteGame(gameId: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }
      await store.deleteGame(gameId);
    },

    async resetGame(gameId: string, now: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      const previous = game.manifest as GameManifest;
      // The rule lives in the core and is the desktop's too - `ah-8z4y.1`. What a reset keeps is
      // not this adapter's opinion.
      const manifest = wasm.reset_game_manifest_state(JSON.stringify(previous), now);
      // The registry row first — the opposite order from the desktop's rename-aside, and for the same
      // reason: a failure after this leaves an empty game, which is what was asked for, while a
      // failure the other way round would leave a full game the picker no longer lists. Do not "make
      // the two platforms consistent" here.
      await store.putGame({ ...game, manifest });
      await store.dropGameData(game.databasePath);

      return { ...game, manifest, gameFilePath: game.databasePath };
    },

    async exportGame(gameId: string, exportedAt: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      const [
        importedTurns,
        orderDrafts,
        regionSightings,
        mergedReports,
        hexNotes,
        armies,
        alliedMages,
        studyPlans
      ] = await Promise.all([
        store.getImportedTurns(game.databasePath, gameId),
        store.getOrderDrafts(game.databasePath, gameId),
        store.getAllRegionSightings(game.databasePath, gameId),
        store.getAllMergedReports(game.databasePath, gameId),
        store.getHexNotes(game.databasePath, gameId),
        store.getArmies(game.databasePath, gameId),
        store.getAlliedMages(game.databasePath, gameId),
        store.getStudyPlans(game.databasePath, gameId)
      ]);

      try {
        // The store's own records go over as they are (`databasePath`, `gameId` and all); the
        // codec ignores what it does not know. `JSON.stringify` drops an `undefined`
        // `importedAt`, which the codec reads as absent - the one place this leniency is relied
        // on.
        return wasm.encode_game_backup_state(
          JSON.stringify({
            manifest: game.manifest,
            importedTurns,
            orderDrafts,
            regionSightings,
            mergedReports,
            hexNotes,
            armies,
            alliedMages,
            studyPlans
          }),
          exportedAt
        );
      } catch (error) {
        // wasm-bindgen throws the Rust error's text as a bare string, same as decode - see the
        // wrapper in importGame below.
        throw error instanceof Error ? error : new Error(String(error));
      }
    },

    async setGameRuleset(gameId: string, rulesetId: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // The registry's copy of the manifest is what every later open reads, so the change lands
      // there. What the change itself is belongs to the core, which the desktop calls too
      // (`ah-8z4y.3.1`).
      const edit: ManifestEdit = { kind: "ruleset", value: rulesetId };
      const manifest = wasm.edit_game_manifest_state(
        JSON.stringify(game.manifest),
        JSON.stringify(edit)
      );
      await store.putGame({ ...game, manifest });
      return manifest;
    },

    async setGameMap(gameId: string, mapJson: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // An empty string means "no map" — this adapter's own contract with its caller. That an
      // absent map stays absent rather than becoming a null is the core's rule, kept by
      // `skip_serializing_if` on the way out (`ah-8z4y.3.1`).
      const edit: ManifestEdit = {
        kind: "map",
        value: mapJson === "" ? null : (JSON.parse(mapJson) as MapShape)
      };
      const manifest = wasm.edit_game_manifest_state(
        JSON.stringify(game.manifest),
        JSON.stringify(edit)
      );
      await store.putGame({ ...game, manifest });
      return manifest;
    },

    async setGameName(gameId: string, gameName: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // The registry's copy of the manifest is what every later open reads, so the change lands
      // there. What the change itself is belongs to the core (`ah-8z4y.3.1`); trimming and
      // validating the name stays the shell's.
      const edit: ManifestEdit = { kind: "name", value: gameName };
      const manifest = wasm.edit_game_manifest_state(
        JSON.stringify(game.manifest),
        JSON.stringify(edit)
      );
      await store.putGame({ ...game, manifest });
      return manifest;
    },

    async setActiveFaction(gameId: string, factionId: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // The registry's copy of the manifest is what every later open reads, so the change lands
      // there. What the change itself is belongs to the core (`ah-8z4y.3.1`).
      const edit: ManifestEdit = { kind: "activeFaction", value: factionId };
      const manifest = wasm.edit_game_manifest_state(
        JSON.stringify(game.manifest),
        JSON.stringify(edit)
      );
      await store.putGame({ ...game, manifest });
      return manifest;
    },

    async importGame(backupJson: string, openedAt: string) {
      let decoded: DecodedGameBackup;
      try {
        decoded = wasm.decode_game_backup_state(backupJson, openedAt);
      } catch (error) {
        // wasm-bindgen throws the Rust error's text as a bare string; the shell's describeError
        // would show it either way, but `rejects.toThrow` and every caller expecting an Error
        // would not.
        throw error instanceof Error ? error : new Error(String(error));
      }

      const gameId = decoded.manifest.metadata.gameId;
      if (await store.getGame(gameId)) {
        throw new Error(`game already exists: ${gameId}`);
      }

      const manifest = decoded.manifest;
      const databasePath = databaseHandleFor(gameId);
      const game = {
        gameId,
        databasePath,
        schemaVersion: 1,
        manifest
      };

      try {
        await store.putGame(game);
        await Promise.all(
          decoded.importedTurns.map((turn) =>
            store.putImportedTurn({
              databasePath,
              gameId,
              factionId: turn.factionId,
              turnNumber: turn.turnNumber,
              rawReport: turn.rawReport,
              parsedPayloadJson: turn.parsedPayloadJson,
              warningsPayloadJson: turn.warningsPayloadJson,
              importedAt: turn.importedAt,
              updatedAt: turn.updatedAt
            })
          )
        );
        await Promise.all(
          decoded.orderDrafts.map((draft) =>
            store.putOrderDraft({
              databasePath,
              gameId,
              factionId: draft.factionId,
              turnNumber: draft.turnNumber,
              orderText: draft.orderText,
              updatedAt: draft.updatedAt
            })
          )
        );
        await store.putRegionSightings(
          decoded.regionSightings.map((sighting) => ({
            databasePath,
            gameId,
            factionId: sighting.factionId,
            regionId: sighting.regionId,
            lastSeenTurn: sighting.lastSeenTurn,
            payloadJson: sighting.payloadJson
          }))
        );
        await Promise.all(
          decoded.mergedReports.map((record) =>
            store.putMergedReport({
              databasePath,
              gameId,
              factionId: record.factionId,
              turnNumber: record.turnNumber,
              mergedFactionId: record.mergedFactionId,
              mergedFactionName: record.mergedFactionName,
              mergedAt: record.mergedAt
            })
          )
        );
        await Promise.all(
          decoded.hexNotes.map((note) =>
            store.putHexNote({
              databasePath,
              gameId,
              id: note.id,
              regionId: note.regionId,
              text: note.text,
              onMap: note.onMap,
              turn: note.turn,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt
            })
          )
        );
        await Promise.all(
          decoded.armies.map((army) =>
            store.putArmy({
              databasePath,
              gameId,
              id: army.id,
              name: army.name,
              members: army.members,
              createdAt: army.createdAt,
              updatedAt: army.updatedAt
            })
          )
        );
        await store.putAlliedMages(
          databasePath,
          decoded.alliedMages.map((mage) => ({ databasePath, ...mage })),
          []
        );
        await store.putStudyPlans(
          databasePath,
          decoded.studyPlans.map((plan) => ({ databasePath, ...plan })),
          []
        );
      } catch (error) {
        await store.deleteGame(gameId).catch(() => null);
        throw error;
      }

      return { ...game, gameFilePath: databasePath };
    },

    async previewReportImport(
      databasePath: string,
      gameId: string,
      confirmedFactionId: string,
      rawReport: string
    ) {
      // Preview deliberately tolerates an inadmissible report: the panel shows the parse result
      // and its warnings so the user can see why it would be refused.
      //
      // No ruleset: a preview stores nothing, and the summary it compares carries no men counts.
      const prepared = prepare(rawReport, confirmedFactionId, null);
      const duplicatePreview =
        prepared.turnNumber === null
          ? { exists: false, rawChanged: false, parsedChanged: false, warningsChanged: false }
          : await diffAgainstStored(
              databasePath,
              gameId,
              confirmedFactionId,
              prepared.turnNumber,
              prepared.candidate
            );

      return {
        parseResult: prepared.parseResult,
        duplicatePreview,
        turnNumber: prepared.turnNumber
      };
    },

    async commitReportImport(
      databasePath: string,
      gameId: string,
      confirmedFactionId: string,
      rawReport: string,
      rulesetJson: string | null,
      allowOverwrite: boolean,
      importedAt: string
    ) {
      const prepared = prepare(rawReport, confirmedFactionId, rulesetJson);
      const turnNumber = requireAdmissible(prepared);

      // Read once and used twice: the diff needs the stored payloads, and the write below needs
      // the timestamp on the same record. Asking storage for it a second time would be the kind of
      // repeated work issue #28 spent a whole PR taking back out of this path.
      const existing = await store.getImportedTurn(
        databasePath,
        gameId,
        confirmedFactionId,
        turnNumber
      );
      const diff = diffAgainst(existing, prepared.candidate);

      if (diff.exists && !allowOverwrite) {
        throw new Error(
          `imported turn already exists for game ${gameId}, faction ${confirmedFactionId}, ` +
            `turn ${turnNumber} and requires explicit overwrite confirmation`
        );
      }

      // What the store already holds is handed to the core, and what comes back is written as it
      // is: whether an older report may overwrite a hex, and which stamp a re-import keeps, are
      // the core's rules, decided once for both platforms (`import_writes` in the Rust core).
      const seen = await store.getRegionSightings(databasePath, gameId, confirmedFactionId);
      const writes = wasm.report_import_writes_state(
        rawReport,
        rulesetJson,
        existing?.importedAt ?? null,
        JSON.stringify(seen.map((s) => ({ regionId: s.regionId, lastSeenTurn: s.lastSeenTurn }))),
        importedAt
      );

      // `importedAt`/`updatedAt` land on the record for the same reason the desktop writes them
      // into SQLite: ranking a game's turns against its order drafts needs one clock and one
      // format, and the browser has no more business inventing either than the Rust core does.
      await store.putImportedTurn({
        databasePath,
        gameId,
        factionId: confirmedFactionId,
        turnNumber,
        importedAt: writes.importedAt,
        updatedAt: writes.updatedAt,
        ...prepared.candidate
      });

      // Regions also get remembered one by one, each carrying the turn it was seen in. Without
      // this the map only ever knows the latest report, and no route can be longer than one step.
      // The desktop does the same thing into SQLite; this is the browser's half of it, and the
      // rows to write were already decided above by the core, so a remembered hex cannot come out
      // different between platforms.
      if (writes.regionSightings.length > 0) {
        await store.putRegionSightings(
          writes.regionSightings.map((sighting) => ({
            databasePath,
            gameId,
            factionId: confirmedFactionId,
            regionId: sighting.regionId,
            lastSeenTurn: sighting.lastSeenTurn,
            payloadJson: sighting.payloadJson
          }))
        );
      }

      return diff;
    },

    async loadImportedTurn(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number
    ) {
      const stored = await store.getImportedTurn(databasePath, gameId, factionId, turnNumber);
      if (!stored) {
        return null;
      }

      return {
        key: { gameId, factionId, turnNumber },
        rawReport: stored.rawReport,
        parseResult: wasm.hydrate_parse_result_state(stored.parsedPayloadJson)
      };
    },

    /**
     * The turn this game reopens on.
     *
     * Two fields per row cross to the core, with the faction the game remembers, and it names the
     * turn; the payloads stay here. Which turn that is - the remembered faction's highest, else
     * the game's highest - is decided once, in `atlantis_hud_core::reopen`, for both platforms.
     */
    async loadLatestImportedTurn(
      databasePath: string,
      gameId: string,
      activeFactionId: string | null
    ) {
      const turns = await store.getImportedTurns(databasePath, gameId);

      const named = wasm.latest_turn_state(
        JSON.stringify(turns.map(({ factionId, turnNumber }) => ({ factionId, turnNumber }))),
        activeFactionId
      );
      if (!named) {
        return null;
      }

      const latest = turns.find(
        (turn) => turn.factionId === named.factionId && turn.turnNumber === named.turnNumber
      );
      if (!latest) {
        throw new Error("the core named a turn the store does not hold");
      }

      return {
        key: { gameId, factionId: latest.factionId, turnNumber: latest.turnNumber },
        rawReport: latest.rawReport,
        parseResult: wasm.hydrate_parse_result_state(latest.parsedPayloadJson)
      };
    },

    /**
     * Every turn imported for a game, across every faction, in no particular order —
     * `@atlantis/core-client` orders it.
     *
     * No storage of its own is needed: `getImportedTurns` already carries everything but the
     * season, which is read the way `loadImportedTurn` above reads a full parse result — through
     * the wasm hydrator, so the browser reaches the same verdict as the desktop's stored-JSON peek
     * without a second copy of the parsing rules.
     */
    async listImportedTurns(databasePath: string, gameId: string) {
      const turns = await store.getImportedTurns(databasePath, gameId);

      // A row whose payload the hydrator cannot parse must not take the rest of the list down
      // with it. `hydrate_parse_result_state` returns a Rust `Result`, so a bad payload crosses
      // the wasm boundary as a thrown exception rather than an error value — unlike the
      // desktop/persistence peek, which the Rust side already treats as `season: None` on a bad
      // row rather than failing the whole list. This keeps the two paths agreeing.
      //
      // The hydrator returns `ReportParseResult`, camelCase throughout since ah-164.1, typed rather
      // than cast since ah-wxk.2.
      const seasonOf = (parsedPayloadJson: string): string | null => {
        try {
          return wasm.hydrate_parse_result_state(parsedPayloadJson).turnHeader?.season ?? null;
        } catch {
          return null;
        }
      };

      return turns.map((turn) => ({
        key: { gameId, factionId: turn.factionId, turnNumber: turn.turnNumber },
        season: seasonOf(turn.parsedPayloadJson),
        importedAt: turn.importedAt ?? "",
        updatedAt: turn.updatedAt ?? ""
      }));
    },

    async saveOrderDraft(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      const draft = { databasePath, gameId, factionId, turnNumber, orderText, updatedAt };
      await store.putOrderDraft(draft);
      return {
        key: { gameId, factionId, turnNumber },
        orderText,
        updatedAt
      };
    },

    async loadOrderDraft(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number
    ) {
      const stored = await store.getOrderDraft(databasePath, gameId, factionId, turnNumber);
      if (!stored) {
        return null;
      }

      return {
        key: { gameId, factionId, turnNumber },
        orderText: stored.orderText,
        updatedAt: stored.updatedAt
      };
    },

    async listHexNotes(databasePath: string, gameId: string) {
      const notes = await store.getHexNotes(databasePath, gameId);
      return notes.map(({ databasePath: _databasePath, ...note }) => note);
    },

    async saveHexNote(databasePath: string, note: HexNoteRecord) {
      await store.putHexNote({ databasePath, ...note });
      return note;
    },

    async deleteHexNote(databasePath: string, gameId: string, noteId: string) {
      await store.deleteHexNote(databasePath, gameId, noteId);
    },

    async listArmies(databasePath: string, gameId: string) {
      const armies = await store.getArmies(databasePath, gameId);
      return armies.map(({ databasePath: _databasePath, ...army }) => army);
    },

    async saveArmy(databasePath: string, army: ArmyRecord) {
      await store.putArmy({ databasePath, ...army });
      return army;
    },

    async deleteArmy(databasePath: string, gameId: string, armyId: string) {
      await store.deleteArmy(databasePath, gameId, armyId);
    },

    async listAlliedMages(databasePath: string, gameId: string) {
      const mages = await store.getAlliedMages(databasePath, gameId);
      return mages.map(({ databasePath: _databasePath, ...mage }) => mage);
    },

    async saveAlliedMages(
      databasePath: string,
      gameId: string,
      mages: readonly AlliedMageRecord[],
      removed: readonly AlliedMageKey[]
    ) {
      await store.putAlliedMages(
        databasePath,
        mages.map((mage) => ({ databasePath, ...mage })),
        removed
      );
    },

    async listStudyPlans(databasePath: string, gameId: string) {
      const plans = await store.getStudyPlans(databasePath, gameId);
      return plans.map(({ databasePath: _databasePath, ...plan }) => withGoals(plan));
    },

    async saveStudyPlans(
      databasePath: string,
      gameId: string,
      plans: readonly StudyPlanRecord[],
      removed: readonly StudyPlanKey[]
    ) {
      await store.putStudyPlans(
        databasePath,
        plans.map((plan) => ({ databasePath, ...plan })),
        removed
      );
    }
  };
}
