/**
 * Web `CoreAdapter`: game logic from the Rust core compiled to WebAssembly, storage from the
 * browser.
 *
 * The split is deliberate. Parsing, order validation, the import-viability threshold and the
 * import-conflict comparison all come from Rust, so the desktop and the browser can never reach
 * different verdicts. Only the read and the write are the browser's own, and those carry no rules.
 */

import type { CoreAdapter, GameManifest } from "@atlantis/core-client";
import type { StoredTurn, StoredTurnSnapshot, WebStore } from "./webStore";
import { createWebStore } from "./webStore";

const GAME_BACKUP_FORMAT = "atlantis-hud-game-backup";
const CURRENT_GAME_BACKUP_VERSION = 1;

/** The subset of the generated wasm module this adapter needs. */
export type CoreWasmModule = {
  get_engine_info(): unknown;
  parse_report_state(rawReport: string): unknown;
  parse_report_full_state(rawReport: string): unknown;
  parse_report_classified_state(rawReport: string, rulesetJson: string): unknown;
  validate_orders_state(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport: string | null,
    warnOnUnguardedHex: boolean
  ): unknown;
  order_commands_state(): unknown;
  plan_route_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string
  ): unknown;
  prepare_report_import_state(
    rawReport: string,
    confirmedFactionId: string,
    rulesetJson: string | null
  ): unknown;
  prepare_report_merge_state(
    rawReport: string,
    viewerTurnNumber: number,
    existingSightingsJson: string,
    rulesetJson: string | null
  ): unknown;
  diff_imported_turn_state(existing: unknown, candidate: unknown): unknown;
  hydrate_parse_result_state(parsedPayloadJson: string): unknown;
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
  /**
   * Every region the report described, already serialized.
   *
   * The core builds these from the parse it has just made. Asking for the whole model back and
   * serializing each region here instead meant a third parse of the same report and a JSON round
   * trip of eleven regions, which together cost more than the parsing did.
   */
  regionSightings: PreparedRegionSighting[];
  parseResult: unknown;
  /** `null` when the report may be imported; otherwise the core's reason to refuse it. */
  rejection: string | null;
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

type GameBackupImportedTurn = StoredTurnSnapshot & {
  factionId: string;
  turnNumber: number;
  importedAt?: string;
  updatedAt?: string;
};

type GameBackupOrderDraft = {
  factionId: string;
  turnNumber: number;
  orderText: string;
  updatedAt: string;
};

type GameBackupRegionSighting = {
  factionId: string;
  regionId: string;
  lastSeenTurn: number;
  payloadJson: string;
};

type GameBackupMergedReport = {
  factionId: string;
  turnNumber: number;
  mergedFactionId: string;
  mergedFactionName: string;
  mergedAt: string;
};

type GameBackupPayload = {
  format: string;
  version: number;
  exportedAt: string;
  manifest: GameManifest;
  importedTurns: GameBackupImportedTurn[];
  orderDrafts: GameBackupOrderDraft[];
  regionSightings: GameBackupRegionSighting[];
  mergedReports: GameBackupMergedReport[];
};

/**
 * The web has no filesystem, so a game's "database path" is just a stable handle derived from its
 * id. It keeps the `CoreClient` contract identical across platforms: the desktop puts a real path
 * in this slot, the browser puts a handle, and neither caller has to know which.
 */
function databaseHandleFor(gameId: string): string {
  return `idb://game-${gameId}`;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  return value;
}

function readOptionalString(value: unknown, message: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readString(value, message);
}

function readNumber(value: unknown, message: string): number {
  if (typeof value !== "number") {
    throw new Error(message);
  }
  return value;
}

function readArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function parseBackupJson(backupJson: string): GameBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    throw new Error("backup file is not valid JSON");
  }

  const payload = asRecord(parsed, "backup file is not an object");
  const format = readString(payload.format, "backup file does not declare its format");
  if (format !== GAME_BACKUP_FORMAT) {
    throw new Error("backup file is not an Atlantis HUD game export");
  }

  const version = readNumber(payload.version, "backup file does not say which version it is");
  if (version > CURRENT_GAME_BACKUP_VERSION) {
    throw new Error(
      `backup file format version ${version} is newer than this build supports (${CURRENT_GAME_BACKUP_VERSION})`
    );
  }
  if (version < 1) {
    throw new Error(`backup file format version ${version} is not supported`);
  }

  const manifest = asRecord(payload.manifest, "backup file is missing its game manifest") as
    | GameManifest
    | Record<string, unknown>;
  const metadata = asRecord(manifest.metadata, "backup file manifest is missing its game metadata");
  readString(metadata.gameId, "backup file manifest is missing its game id");
  readString(metadata.gameName, "backup file manifest is missing its game name");
  readString(metadata.rulesetId, "backup file manifest is missing its ruleset id");
  readNumber(manifest.manifestVersion, "backup file manifest is missing its manifest version");
  readString(manifest.createdAt, "backup file manifest is missing its creation time");
  readString(manifest.lastOpenedAt, "backup file manifest is missing its last-opened time");
  readArray(manifest.reportSources, "backup file manifest is missing its report sources");

  return {
    format,
    version,
    exportedAt:
      typeof payload.exportedAt === "string" ? payload.exportedAt : new Date(0).toISOString(),
    manifest: manifest as GameManifest,
    importedTurns: readArray(
      payload.importedTurns,
      "backup file is missing its imported turns"
    ).map((entry, index) => {
      const record = asRecord(entry, `backup file imported turn ${index + 1} is invalid`);
      return {
        factionId: readString(
          record.factionId,
          `backup file imported turn ${index + 1} is missing its faction id`
        ),
        turnNumber: readNumber(
          record.turnNumber,
          `backup file imported turn ${index + 1} is missing its turn number`
        ),
        rawReport: readString(
          record.rawReport,
          `backup file imported turn ${index + 1} is missing its raw report`
        ),
        parsedPayloadJson: readString(
          record.parsedPayloadJson,
          `backup file imported turn ${index + 1} is missing its parsed payload`
        ),
        warningsPayloadJson: readString(
          record.warningsPayloadJson,
          `backup file imported turn ${index + 1} is missing its warning payload`
        ),
        importedAt: readOptionalString(
          record.importedAt,
          `backup file imported turn ${index + 1} has an invalid imported time`
        ),
        updatedAt: readOptionalString(
          record.updatedAt,
          `backup file imported turn ${index + 1} has an invalid updated time`
        )
      };
    }),
    orderDrafts: readArray(payload.orderDrafts, "backup file is missing its order drafts").map(
      (entry, index) => {
        const record = asRecord(entry, `backup file order draft ${index + 1} is invalid`);
        return {
          factionId: readString(
            record.factionId,
            `backup file order draft ${index + 1} is missing its faction id`
          ),
          turnNumber: readNumber(
            record.turnNumber,
            `backup file order draft ${index + 1} is missing its turn number`
          ),
          orderText: readString(
            record.orderText,
            `backup file order draft ${index + 1} is missing its order text`
          ),
          updatedAt: readString(
            record.updatedAt,
            `backup file order draft ${index + 1} is missing its update time`
          )
        };
      }
    ),
    regionSightings: readArray(
      payload.regionSightings,
      "backup file is missing its remembered map"
    ).map((entry, index) => {
      const record = asRecord(entry, `backup file remembered region ${index + 1} is invalid`);
      return {
        factionId: readString(
          record.factionId,
          `backup file remembered region ${index + 1} is missing its faction id`
        ),
        regionId: readString(
          record.regionId,
          `backup file remembered region ${index + 1} is missing its region id`
        ),
        lastSeenTurn: readNumber(
          record.lastSeenTurn,
          `backup file remembered region ${index + 1} is missing its turn`
        ),
        payloadJson: readString(
          record.payloadJson,
          `backup file remembered region ${index + 1} is missing its payload`
        )
      };
    }),
    mergedReports: readArray(
      payload.mergedReports,
      "backup file is missing its merged reports"
    ).map((entry, index) => {
      const record = asRecord(entry, `backup file merged report ${index + 1} is invalid`);
      return {
        factionId: readString(
          record.factionId,
          `backup file merged report ${index + 1} is missing its faction id`
        ),
        turnNumber: readNumber(
          record.turnNumber,
          `backup file merged report ${index + 1} is missing its turn number`
        ),
        mergedFactionId: readString(
          record.mergedFactionId,
          `backup file merged report ${index + 1} is missing its merged faction id`
        ),
        mergedFactionName: readString(
          record.mergedFactionName,
          `backup file merged report ${index + 1} is missing its merged faction name`
        ),
        mergedAt: readString(
          record.mergedAt,
          `backup file merged report ${index + 1} is missing its merge time`
        )
      };
    })
  };
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
    const prepared = wasm.prepare_report_import_state(
      rawReport,
      confirmedFactionId,
      rulesetJson
    ) as PreparedImport;

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

    return wasm.diff_imported_turn_state(existing, candidate) as ImportedTurnDiff;
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
    getEngineInfo() {
      return wasm.get_engine_info();
    },

    parseReport(rawReport: string) {
      return wasm.parse_report_state(rawReport);
    },

    parseReportFull(rawReport: string) {
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
      ) as PreparedMerge;

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

    parseReportClassified(rawReport: string, rulesetJson: string) {
      return wasm.parse_report_classified_state(rawReport, rulesetJson);
    },
    planRoute(
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
    validateOrders(
      rawOrders: string,
      rulesetJson: string | null,
      rawReport: string | null,
      warnOnUnguardedHex: boolean
    ) {
      // As with planning, the report goes across as text: the core keys its last parse on it, so
      // validating against the turn already on screen re-parses nothing.
      return wasm.validate_orders_state(rawOrders, rulesetJson, rawReport, warnOnUnguardedHex);
    },
    orderCommands() {
      return wasm.order_commands_state();
    },

    async listGames() {
      return (await store.listGames()).map((game) => game.manifest);
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
      return null;
    },

    async exportGame(gameId: string, exportedAt: string) {
      const game = await store.getGame(gameId);
      if (!game) {
        throw new Error(`no game with id ${gameId}`);
      }

      const [importedTurns, orderDrafts, regionSightings, mergedReports] = await Promise.all([
        store.getImportedTurns(game.databasePath, gameId),
        store.getOrderDrafts(game.databasePath, gameId),
        store.getAllRegionSightings(game.databasePath, gameId),
        store.getAllMergedReports(game.databasePath, gameId)
      ]);

      return JSON.stringify(
        {
          format: GAME_BACKUP_FORMAT,
          version: CURRENT_GAME_BACKUP_VERSION,
          exportedAt,
          manifest: game.manifest,
          importedTurns: importedTurns.map((turn) => ({
            factionId: turn.factionId,
            turnNumber: turn.turnNumber,
            rawReport: turn.rawReport,
            parsedPayloadJson: turn.parsedPayloadJson,
            warningsPayloadJson: turn.warningsPayloadJson,
            importedAt: turn.importedAt,
            updatedAt: turn.updatedAt
          })),
          orderDrafts: orderDrafts.map((draft) => ({
            factionId: draft.factionId,
            turnNumber: draft.turnNumber,
            orderText: draft.orderText,
            updatedAt: draft.updatedAt
          })),
          regionSightings: regionSightings.map((sighting) => ({
            factionId: sighting.factionId,
            regionId: sighting.regionId,
            lastSeenTurn: sighting.lastSeenTurn,
            payloadJson: sighting.payloadJson
          })),
          mergedReports: mergedReports.map((record) => ({
            factionId: record.factionId,
            turnNumber: record.turnNumber,
            mergedFactionId: record.mergedFactionId,
            mergedFactionName: record.mergedFactionName,
            mergedAt: record.mergedAt
          }))
        },
        null,
        2
      );
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

    async importGame(backupJson: string, openedAt: string) {
      const backup = parseBackupJson(backupJson);
      const gameId = backup.manifest.metadata.gameId;
      if (await store.getGame(gameId)) {
        throw new Error(`game already exists: ${gameId}`);
      }

      const manifest = { ...backup.manifest, lastOpenedAt: openedAt };
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
          backup.importedTurns.map((turn) =>
            store.putImportedTurn({
              databasePath,
              gameId,
              factionId: turn.factionId,
              turnNumber: turn.turnNumber,
              rawReport: turn.rawReport,
              parsedPayloadJson: turn.parsedPayloadJson,
              warningsPayloadJson: turn.warningsPayloadJson,
              importedAt: turn.importedAt,
              updatedAt: turn.updatedAt ?? turn.importedAt ?? manifest.createdAt
            })
          )
        );
        await Promise.all(
          backup.orderDrafts.map((draft) =>
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
          backup.regionSightings.map((sighting) => ({
            databasePath,
            gameId,
            factionId: sighting.factionId,
            regionId: sighting.regionId,
            lastSeenTurn: sighting.lastSeenTurn,
            payloadJson: sighting.payloadJson
          }))
        );
        await Promise.all(
          backup.mergedReports.map((record) =>
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
      // It shares `prepare` with the commit, so it also receives region rows it has no use for.
      // Left as it is rather than split into two core calls: the parse behind them is a cache hit,
      // what is left is serializing eleven regions, and nothing on the report-loading path calls
      // this. Worth splitting the moment something does.
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

      // `importedAt` lands on the record for the same reason the desktop writes it into SQLite:
      // ranking a game's turns against its order drafts needs one clock and one format, and the
      // browser has no more business inventing either than the Rust core does.
      await store.putImportedTurn({
        databasePath,
        gameId,
        factionId: confirmedFactionId,
        turnNumber,
        // Re-importing moves `updatedAt` and leaves `importedAt`: when a turn first arrived does
        // not change because it arrived again. The desktop's UPSERT says the same thing in SQL.
        importedAt: existing?.importedAt ?? importedAt,
        updatedAt: importedAt,
        ...prepared.candidate
      });

      // Regions also get remembered one by one, each carrying the turn it was seen in. Without
      // this the map only ever knows the latest report, and no route can be longer than one step.
      // The desktop does the same thing into SQLite; this is the browser's half of it, and both
      // build the rows with the same core function so a remembered hex cannot come out different.
      const sightings = prepared.regionSightings ?? [];
      if (sightings.length > 0) {
        await store.putRegionSightings(
          sightings.map((sighting) => ({
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
     * The turn this game was last worked on.
     *
     * The desktop asks SQLite for this with a LEFT JOIN; IndexedDB has no joins, so the two stores
     * are read and matched here. The ranking rule is the same on both: the later of when a turn was
     * imported and when its orders were last edited, ties broken by turn number.
     */
    async loadLatestImportedTurn(databasePath: string, gameId: string) {
      const [turns, drafts] = await Promise.all([
        store.getImportedTurns(databasePath, gameId),
        store.getOrderDrafts(databasePath, gameId)
      ]);

      const editedAt = new Map(
        drafts.map((draft) => [`${draft.factionId}:${draft.turnNumber}`, draft.updatedAt])
      );
      // A record written before turns carried a time has none. It sorts last rather than being
      // dropped: one unrankable turn must not turn into a game that reopens on nothing.
      const touchedAt = (turn: StoredTurn) => {
        const edited = editedAt.get(`${turn.factionId}:${turn.turnNumber}`) ?? "";
        const imported = turn.updatedAt ?? "";
        return edited > imported ? edited : imported;
      };

      const latest = turns.reduce<StoredTurn | null>((best, turn) => {
        if (best === null) {
          return turn;
        }
        const [a, b] = [touchedAt(turn), touchedAt(best)];
        if (a !== b) {
          return a > b ? turn : best;
        }
        return turn.turnNumber > best.turnNumber ? turn : best;
      }, null);

      if (!latest) {
        return null;
      }

      return {
        key: { gameId, factionId: latest.factionId, turnNumber: latest.turnNumber },
        rawReport: latest.rawReport,
        parseResult: wasm.hydrate_parse_result_state(latest.parsedPayloadJson)
      };
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
    }
  };
}
