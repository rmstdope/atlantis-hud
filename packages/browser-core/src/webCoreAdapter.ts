/**
 * Web `CoreAdapter`: game logic from the Rust core compiled to WebAssembly, storage from the
 * browser.
 *
 * The split is deliberate. Parsing, order validation, the import-viability threshold and the
 * import-conflict comparison all come from Rust, so the desktop and the browser can never reach
 * different verdicts. Only the read and the write are the browser's own, and those carry no rules.
 */

import type { CoreAdapter, GameManifest } from "@atlantis/core-client";
import type { StoredTurnSnapshot, WebStore } from "./webStore";
import { createWebStore } from "./webStore";

/** The subset of the generated wasm module this adapter needs. */
export type CoreWasmModule = {
  get_engine_info(): unknown;
  parse_report_state(rawReport: string): unknown;
  parse_report_full_state(rawReport: string): unknown;
  parse_report_classified_state(rawReport: string, rulesetJson: string): unknown;
  validate_orders_state(rawOrders: string): unknown;
  plan_route_state(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string
  ): unknown;
  prepare_report_import_state(rawReport: string, confirmedFactionId: string): unknown;
  diff_imported_turn_state(existing: unknown, candidate: unknown): unknown;
  hydrate_parse_result_state(parsedPayloadJson: string): unknown;
};

type PreparedImport = {
  turnNumber: number | null;
  candidate: StoredTurnSnapshot;
  parseResult: unknown;
  /** `null` when the report may be imported; otherwise the core's reason to refuse it. */
  rejection: string | null;
};

type ImportedTurnDiff = {
  exists: boolean;
  rawChanged: boolean;
  parsedChanged: boolean;
  warningsChanged: boolean;
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
  const prepare = (rawReport: string, confirmedFactionId: string): PreparedImport => {
    const prepared = wasm.prepare_report_import_state(rawReport, confirmedFactionId) as
      PreparedImport;

    // Rust's None can arrive as undefined rather than null depending on serializer settings, and
    // the checks below are written against null. Normalise once, here.
    return {
      ...prepared,
      turnNumber: prepared.turnNumber ?? null,
      rejection: prepared.rejection ?? null
    };
  };

  const diffAgainstStored = async (
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number,
    candidate: StoredTurnSnapshot
  ): Promise<ImportedTurnDiff> => {
    const stored = await store.getImportedTurn(databasePath, gameId, factionId, turnNumber);
    const existing: StoredTurnSnapshot | null = stored
      ? {
          rawReport: stored.rawReport,
          parsedPayloadJson: stored.parsedPayloadJson,
          warningsPayloadJson: stored.warningsPayloadJson
        }
      : null;

    return wasm.diff_imported_turn_state(existing, candidate) as ImportedTurnDiff;
  };

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
      // Straight through to the core: planning is pure, so unlike the persistence entry points
      // there is no browser storage to stand in for a database.
      return wasm.plan_route_state(rulesetJson, rawReport, rememberedJson, unitId, destination);
    },
    validateOrders(rawOrders: string) {
      return wasm.validate_orders_state(rawOrders);
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

    async previewReportImport(
      databasePath: string,
      gameId: string,
      confirmedFactionId: string,
      rawReport: string
    ) {
      // Preview deliberately tolerates an inadmissible report: the panel shows the parse result
      // and its warnings so the user can see why it would be refused.
      const prepared = prepare(rawReport, confirmedFactionId);
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
      allowOverwrite: boolean,
      importedAt: string
    ) {
      const prepared = prepare(rawReport, confirmedFactionId);
      const turnNumber = requireAdmissible(prepared);
      const diff = await diffAgainstStored(
        databasePath,
        gameId,
        confirmedFactionId,
        turnNumber,
        prepared.candidate
      );

      if (diff.exists && !allowOverwrite) {
        throw new Error(
          `imported turn already exists for game ${gameId}, faction ${confirmedFactionId}, ` +
            `turn ${turnNumber} and requires explicit overwrite confirmation`
        );
      }

      // `importedAt` lands on the record for the same reason the desktop writes it into SQLite:
      // ranking a game's turns against its order drafts needs one clock and one format, and the
      // browser has no more business inventing either than the Rust core does.
      const existing = await store.getImportedTurn(
        databasePath,
        gameId,
        confirmedFactionId,
        turnNumber
      );

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
      // The desktop does the same thing into SQLite; this is the browser's half of it.
      const parsed = wasm.parse_report_full_state(rawReport) as {
        regions?: Array<{ regionId?: string; region_id?: string }>;
      };
      const regions = parsed.regions ?? [];
      if (regions.length > 0) {
        await store.putRegionSightings(
          regions.map((region) => ({
            databasePath,
            gameId,
            factionId: confirmedFactionId,
            regionId: region.regionId ?? region.region_id ?? "",
            lastSeenTurn: turnNumber,
            payloadJson: JSON.stringify(region)
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
