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
  HexNoteRecord,
  KnownMap,
  MoveOrderTraceResponse,
  OrderCompletion,
  OrderValidationResult,
  OrdersPreviewResponse,
  ParsedReport,
  ReportParseResult,
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
  parse_report_classified_state(rawReport: string, rulesetJson: string): ParsedReport;
  validate_orders_state(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport: string | null,
    disabledCodes: readonly string[] | null
  ): OrderValidationResult;
  order_commands_state(): string[];
  order_argument_completions_state(
    linePrefix: string,
    rulesetJson: string | null,
    rawReport: string | null,
    unitId: string | null
  ): OrderCompletion[];
  plan_route_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string
  ): RoutePlanResponse;
  trace_move_orders_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    orders: string
  ): MoveOrderTraceResponse;
  export_map_state(rawReport: string, rememberedJson: string, requestJson: string): string;
  known_map_state(
    rawReport: string,
    rulesetJson: string | null,
    rememberedJson: string
  ): KnownMap;
  preview_orders_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    ordersDocument: string
  ): OrdersPreviewResponse;
  trade_routes_state(rulesetJson: string, rawReport: string, rememberedJson: string): TradeRoute[];
  prepare_report_import_state(
    rawReport: string,
    confirmedFactionId: string,
    rulesetJson: string | null
  ): PreparedImport;
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
    existingSightingsJson: string,
    rulesetJson: string | null
  ): PreparedMerge;
  diff_imported_turn_state(
    existing: StoredTurnSnapshot | null,
    candidate: StoredTurnSnapshot
  ): ImportedTurnDiff;
  hydrate_parse_result_state(parsedPayloadJson: string): ReportParseResult;
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

    async loadRegionSightings(databasePath: string, gameId: string, factionId: string) {
      const stored = await store.getRegionSightings(databasePath, gameId, factionId);

      // A payload written by an older build may not parse. Dropping one remembered hex beats
      // losing the whole map, which is what the desktop does too.
      return stored.flatMap((sighting) => {
        try {
          return [{ region: JSON.parse(sighting.payloadJson), lastSeenTurn: sighting.lastSeenTurn }];
        } catch {
          return [];
        }
      });
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
      // The desktop refuses this in the same words. It cannot be decided in the core, which is
      // never told whose map is being merged into - only that a report is being folded into a turn
      // - so the one place that knows both is here. Refused before anything is written: a faction's
      // own report is loaded, not merged, and merging it would file its regions by a route that
      // deliberately stores no turn.
      if (prepared.mergedFactionId === viewerFactionId) {
        throw new Error("a faction's own report is loaded rather than merged");
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

      await store.putMergedReport({
        databasePath,
        gameId,
        factionId: viewerFactionId,
        turnNumber: prepared.turnNumber,
        mergedFactionId: prepared.mergedFactionId,
        mergedFactionName: prepared.mergedFactionName ?? prepared.mergedFactionId,
        mergedAt
      });

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

      // Oldest merge first, matching the desktop's ORDER BY. The panel lists them in the order
      // they happened, and a list that reorders itself between platforms is two applications.
      return [...stored]
        .sort(
          (left, right) =>
            left.mergedAt.localeCompare(right.mergedAt) ||
            left.mergedFactionId.localeCompare(right.mergedFactionId)
        )
        .map((record) => ({
          gameId: record.gameId,
          factionId: record.factionId,
          turnNumber: record.turnNumber,
          mergedFactionId: record.mergedFactionId,
          mergedFactionName: record.mergedFactionName,
          mergedAt: record.mergedAt
        }));
    },

    async parseReportClassified(rawReport: string, rulesetJson: string) {
      return wasm.parse_report_classified_state(rawReport, rulesetJson);
    },
    async planRoute(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      destination: string
    ) {
      // Straight through to the core: unlike the persistence entry points there is no browser
      // storage to stand in for a database. The report goes as text, which is what the core keys
      // its last parse on, so planning over the turn already on screen re-parses nothing.
      return wasm.plan_route_state(rulesetJson, rawReport, rememberedJson, unitId, destination);
    },
    async traceMoveOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      orders: string
    ) {
      // Straight through for the same reason planRoute is: no browser storage stands in.
      return wasm.trace_move_orders_state(rulesetJson, rawReport, rememberedJson, unitId, orders);
    },
    async exportMap(rawReport: string, rememberedJson: string, requestJson: string) {
      // Straight through as well: the export is pure computation over the arguments, and the file
      // it produces is handed back as text for the shell to save.
      return wasm.export_map_state(rawReport, rememberedJson, requestJson);
    },
    async knownMap(rawReport: string, rulesetJson: string | null, rememberedJson: string) {
      // Straight through as well: the resolution is pure computation over the arguments.
      return wasm.known_map_state(rawReport, rulesetJson, rememberedJson);
    },
    async previewOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      ordersDocument: string
    ) {
      // Straight through as well: the preview is pure computation over the arguments.
      return wasm.preview_orders_state(rulesetJson, rawReport, rememberedJson, ordersDocument);
    },
    async tradeRoutes(rulesetJson: string, rawReport: string, rememberedJson: string) {
      // Straight through as well: finding routes is pure computation over the arguments.
      return wasm.trade_routes_state(rulesetJson, rawReport, rememberedJson);
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
    async orderArgumentCompletions(
      linePrefix: string,
      rulesetJson: string | null,
      rawReport: string | null,
      unitId: string | null
    ) {
      return wasm.order_argument_completions_state(linePrefix, rulesetJson, rawReport, unitId);
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

      // Opening stamps the manifest, exactly as the desktop does, because that stamp is what
      // decides which game reopens next launch. Storing it only on the desktop would make the
      // two platforms disagree about which game the player was last in.
      const manifest = {
        ...(game.manifest as GameManifest),
        lastOpenedAt: openedAt
      };
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

    async exportGame(gameId: string, exportedAt: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      const [importedTurns, orderDrafts, regionSightings, mergedReports, hexNotes] =
        await Promise.all([
          store.getImportedTurns(game.databasePath, gameId),
          store.getOrderDrafts(game.databasePath, gameId),
          store.getAllRegionSightings(game.databasePath, gameId),
          store.getAllMergedReports(game.databasePath, gameId),
          store.getHexNotes(game.databasePath, gameId)
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
            hexNotes
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
      // there — the web's counterpart of the desktop rewriting the JSON manifest on disk.
      const manifest = {
        ...(game.manifest as GameManifest),
        metadata: { ...(game.manifest as GameManifest).metadata, rulesetId }
      };
      await store.putGame({ ...game, manifest });
      return manifest;
    },

    async setGameName(gameId: string, gameName: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // The registry's copy of the manifest is what every later open reads, so the change lands
      // there — the web's counterpart of the desktop rewriting the JSON manifest on disk.
      const manifest = {
        ...(game.manifest as GameManifest),
        metadata: { ...(game.manifest as GameManifest).metadata, gameName }
      };
      await store.putGame({ ...game, manifest });
      return manifest;
    },

    async setActiveFaction(gameId: string, factionId: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      // The registry's copy of the manifest is what every later open reads, so the change lands
      // there — the web's counterpart of the desktop rewriting the JSON manifest on disk.
      const manifest = {
        ...(game.manifest as GameManifest),
        metadata: { ...(game.manifest as GameManifest).metadata, activeFactionId: factionId }
      };
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
    }
  };
}
