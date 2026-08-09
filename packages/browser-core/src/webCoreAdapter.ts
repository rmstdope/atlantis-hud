/**
 * Web `CoreAdapter`: game logic from the Rust core compiled to WebAssembly, storage from the
 * browser.
 *
 * The split is deliberate. Parsing, order validation, the import-viability threshold and the
 * import-conflict comparison all come from Rust, so the desktop and the browser can never reach
 * different verdicts. Only the read and the write are the browser's own, and those carry no rules.
 */

import type { CoreAdapter, ProjectManifest } from "@atlantis/core-client";
import type { StoredTurnSnapshot, WebStore } from "./webStore";
import { createWebStore } from "./webStore";

/** The subset of the generated wasm module this adapter needs. */
export type CoreWasmModule = {
  get_game_info(): unknown;
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
 * The web has no filesystem, so a project's "database path" is just a stable handle derived from
 * the project file path. It keeps the `CoreClient` contract identical across platforms.
 */
function databaseHandleFor(projectFilePath: string): string {
  return `idb://${projectFilePath.replace(/\.json$/u, "")}`;
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
    projectId: string,
    factionId: string,
    turnNumber: number,
    candidate: StoredTurnSnapshot
  ): Promise<ImportedTurnDiff> => {
    const stored = await store.getImportedTurn(databasePath, projectId, factionId, turnNumber);
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
    getGameInfo() {
      return wasm.get_game_info();
    },

    parseReport(rawReport: string) {
      return wasm.parse_report_state(rawReport);
    },

    parseReportFull(rawReport: string) {
      return wasm.parse_report_full_state(rawReport);
    },

    async loadRegionSightings(databasePath: string, projectId: string, factionId: string) {
      const stored = await store.getRegionSightings(databasePath, projectId, factionId);

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

    async createProject(projectFilePath: string, manifest: ProjectManifest) {
      const existing = await store.getProject(projectFilePath);
      if (existing) {
        throw new Error(`project file already exists: ${projectFilePath}`);
      }

      const project = {
        projectFilePath,
        databasePath: databaseHandleFor(projectFilePath),
        schemaVersion: 1,
        manifest
      };
      await store.putProject(project);
      return project;
    },

    async openProject(projectFilePath: string) {
      const project = await store.getProject(projectFilePath);
      if (!project) {
        throw new Error(`project file does not exist: ${projectFilePath}`);
      }
      return project;
    },

    async previewReportImport(
      databasePath: string,
      projectId: string,
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
              projectId,
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
      projectId: string,
      confirmedFactionId: string,
      rawReport: string,
      allowOverwrite: boolean
    ) {
      const prepared = prepare(rawReport, confirmedFactionId);
      const turnNumber = requireAdmissible(prepared);
      const diff = await diffAgainstStored(
        databasePath,
        projectId,
        confirmedFactionId,
        turnNumber,
        prepared.candidate
      );

      if (diff.exists && !allowOverwrite) {
        throw new Error(
          `imported turn already exists for project ${projectId}, faction ${confirmedFactionId}, ` +
            `turn ${turnNumber} and requires explicit overwrite confirmation`
        );
      }

      await store.putImportedTurn({
        databasePath,
        projectId,
        factionId: confirmedFactionId,
        turnNumber,
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
            projectId,
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
      projectId: string,
      factionId: string,
      turnNumber: number
    ) {
      const stored = await store.getImportedTurn(databasePath, projectId, factionId, turnNumber);
      if (!stored) {
        return null;
      }

      return {
        key: { projectId, factionId, turnNumber },
        rawReport: stored.rawReport,
        parseResult: wasm.hydrate_parse_result_state(stored.parsedPayloadJson)
      };
    },

    async saveOrderDraft(
      databasePath: string,
      projectId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      const draft = { databasePath, projectId, factionId, turnNumber, orderText, updatedAt };
      await store.putOrderDraft(draft);
      return {
        key: { projectId, factionId, turnNumber },
        orderText,
        updatedAt
      };
    },

    async loadOrderDraft(
      databasePath: string,
      projectId: string,
      factionId: string,
      turnNumber: number
    ) {
      const stored = await store.getOrderDraft(databasePath, projectId, factionId, turnNumber);
      if (!stored) {
        return null;
      }

      return {
        key: { projectId, factionId, turnNumber },
        orderText: stored.orderText,
        updatedAt: stored.updatedAt
      };
    }
  };
}
