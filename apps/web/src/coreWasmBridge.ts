import type { ProjectManifest, WasmBindings } from "@atlantis/core-client";

type AtlantisWasmGlobal = {
  __ATLANTIS_CORE_WASM__?: WasmBindings;
};

type OpenedProjectFallback = {
  projectFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: ProjectManifest;
};

const inMemoryProjects = new Map<string, OpenedProjectFallback>();
const inMemoryImports = new Map<string, {
  rawReport: string;
  parsedPayloadJson: string;
  warningsPayloadJson: string;
}>();
const inMemoryOrderDrafts = new Map<string, string>();

function importKey(databasePath: string, projectId: string, factionId: string, turnNumber: number): string {
  return `${databasePath}::${projectId}::${factionId}::${turnNumber}`;
}

function draftKey(databasePath: string, projectId: string, factionId: string, turnNumber: number): string {
  return `${databasePath}::${projectId}::${factionId}::${turnNumber}`;
}

function getDraftStorage() {
  if (typeof window !== "undefined" && "localStorage" in window) {
    return window.localStorage;
  }

  return {
    getItem(key: string) {
      return inMemoryOrderDrafts.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      inMemoryOrderDrafts.set(key, value);
    }
  };
}

function loadDraftPayload(key: string) {
  const serialized = getDraftStorage().getItem(key);
  return serialized ? (JSON.parse(serialized) as { key: unknown; order_text: string; updated_at: string }) : null;
}

function resolveWebDatabasePath(projectFilePath: string): string {
  const canUseOpfs =
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function";

  const stem = projectFilePath.replace(/\.json$/u, "");
  if (canUseOpfs) {
    return `opfs://${stem}.sqlite`;
  }

  return `memory://${stem}.sqlite`;
}

function validateOrderText(rawOrders: string) {
  const diagnostics: Array<{
    code: string;
    message: string;
    line_start: number;
    line_end: number;
    severity: "warning" | "error";
  }> = [];

  rawOrders.split(/\r?\n/u).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const tokens = trimmed.split(/\s+/u);
    const command = tokens[0];
    const args = tokens.slice(1);

    if (command === "MOVE") {
      if (args.length < 2) {
        diagnostics.push({
          code: "missing-arguments",
          message: "missing required arguments for MOVE",
          line_start: lineNumber,
          line_end: lineNumber,
          severity: "error"
        });
      } else if (args.length > 2) {
        diagnostics.push({
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          line_start: lineNumber,
          line_end: lineNumber,
          severity: "warning"
        });
      }
      return;
    }

    if (command === "HOLD") {
      if (args.length > 0) {
        diagnostics.push({
          code: "extra-arguments",
          message: "extra arguments ignored for HOLD",
          line_start: lineNumber,
          line_end: lineNumber,
          severity: "warning"
        });
      }
      return;
    }

    diagnostics.push({
      code: "unknown-command",
      message: "unknown order command",
      line_start: lineNumber,
      line_end: lineNumber,
      severity: "error"
    });
  });

  return {
    diagnostics
  };
}

export function resolveCoreWasmBindings(): WasmBindings {
  const bindings = (globalThis as AtlantisWasmGlobal).__ATLANTIS_CORE_WASM__;
  const getGameInfo =
    bindings && typeof bindings.get_game_info === "function"
      ? bindings.get_game_info.bind(bindings)
      : () => ({
          id: "atlantis",
          name: "Atlantis PBEM",
          ruleset_version: "4.0",
          max_faction_count: 128
        });
  const parseReportState = (rawReport: string) => {
    const lines = rawReport.split(/\r?\n/u);
    let turnHeader: { turn_number: number; season: string } | null = null;
    const detectedFactions: Array<{ faction_id: string; name: string }> = [];
    const regions: Array<{ region_id: string; name: string }> = [];
    const units: Array<{ unit_id: string; name: string; region_id: string }> = [];
    const inventories: Array<{ unit_id: string; item: string; quantity: number }> = [];
    const messageSummaries: Array<{ kind: string; source: string; text: string }> = [];
    const warnings: Array<{
      code: string;
      section: string;
      message: string;
      line_start: number;
      line_end: number;
      severity: "warning" | "error";
    }> = [];

    lines.forEach((line, index) => {
      const row = index + 1;
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      const parseFields = (prefix: string, count: number): string[] | null => {
        if (!trimmed.startsWith(prefix)) {
          return null;
        }
        const fields = trimmed
          .slice(prefix.length)
          .split("|")
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        return fields.length === count ? fields : [];
      };

      if (trimmed.startsWith("TURN:")) {
        const payload = trimmed.slice("TURN:".length).trim().split(/\s+/u);
        const turnNumber = Number.parseInt(payload[0] ?? "", 10);
        if (!Number.isFinite(turnNumber) || payload.length < 2) {
          warnings.push({
            code: "turn-malformed-line",
            section: "turn",
            message: "could not parse turn line",
            line_start: row,
            line_end: row,
            severity: "warning"
          });
          return;
        }
        turnHeader = {
          turn_number: turnNumber,
          season: payload[1]
        };
        return;
      }

      const factionFields = parseFields("FACTION:", 2);
      if (factionFields) {
        if (factionFields.length === 2) {
          detectedFactions.push({ faction_id: factionFields[0], name: factionFields[1] });
        } else {
          warnings.push({
            code: "faction-malformed-line",
            section: "faction",
            message: "could not parse faction line",
            line_start: row,
            line_end: row,
            severity: "warning"
          });
        }
        return;
      }

      const regionFields = parseFields("REGION:", 2);
      if (regionFields) {
        if (regionFields.length === 2) {
          regions.push({ region_id: regionFields[0], name: regionFields[1] });
        } else {
          warnings.push({
            code: "region-malformed-line",
            section: "region",
            message: "could not parse region line",
            line_start: row,
            line_end: row,
            severity: "warning"
          });
        }
        return;
      }

      const unitFields = parseFields("UNIT:", 3);
      if (unitFields) {
        if (unitFields.length === 3) {
          units.push({ unit_id: unitFields[0], name: unitFields[1], region_id: unitFields[2] });
        } else {
          warnings.push({
            code: "unit-malformed-line",
            section: "unit",
            message: "could not parse unit line",
            line_start: row,
            line_end: row,
            severity: "warning"
          });
        }
        return;
      }

      const itemFields = parseFields("ITEM:", 3);
      if (itemFields) {
        const quantity = Number.parseInt(itemFields[2] ?? "", 10);
        if (itemFields.length === 3 && Number.isFinite(quantity)) {
          inventories.push({ unit_id: itemFields[0], item: itemFields[1], quantity });
        } else {
          warnings.push({
            code: "item-malformed-line",
            section: "item",
            message: "could not parse item line",
            line_start: row,
            line_end: row,
            severity: "warning"
          });
        }
        return;
      }

      const messageFields = parseFields("MESSAGE:", 3);
      if (messageFields) {
        if (messageFields.length === 3) {
          messageSummaries.push({ kind: messageFields[0], source: messageFields[1], text: messageFields[2] });
        } else {
          warnings.push({
            code: "message-malformed-line",
            section: "message",
            message: "could not parse message line",
            line_start: row,
            line_end: row,
            severity: "warning"
          });
        }
      }
    });

    return {
      turn_header: turnHeader,
      detected_factions: detectedFactions,
      regions,
      units,
      inventories,
      message_summaries: messageSummaries,
      warnings,
      meets_minimum_import_threshold:
        turnHeader !== null && detectedFactions.length > 0 && (regions.length > 0 || units.length > 0)
    };
  };

  return {
    get_game_info: getGameInfo,
    create_project_state(projectFilePath: string, manifest: ProjectManifest) {
      const opened = {
        projectFilePath,
        databasePath: resolveWebDatabasePath(projectFilePath),
        schemaVersion: 2,
        manifest
      };
      inMemoryProjects.set(projectFilePath, opened);
      return opened;
    },
    open_project_state(projectFilePath: string) {
      const opened = inMemoryProjects.get(projectFilePath);
      if (!opened) {
        throw new Error(`project not found: ${projectFilePath}`);
      }
      return opened;
    },
    parse_report_state: parseReportState,
    preview_report_import_state(databasePath: string, projectId: string, confirmedFactionId: string, rawReport: string) {
      const parsed = parseReportState(rawReport) as {
        turn_header: { turn_number: number } | null;
        warnings: unknown;
      };
      const turnNumber = parsed.turn_header?.turn_number ?? null;
      const previous = turnNumber !== null
        ? inMemoryImports.get(importKey(databasePath, projectId, confirmedFactionId, turnNumber))
        : undefined;
      const parsedPayloadJson = JSON.stringify(parsed);
      const warningsPayloadJson = JSON.stringify(parsed.warnings);

      return {
        parse_result: parsed,
        duplicate_preview: {
          exists: previous !== undefined,
          raw_changed: previous ? previous.rawReport !== rawReport : false,
          parsed_changed: previous ? previous.parsedPayloadJson !== parsedPayloadJson : false,
          warnings_changed: previous ? previous.warningsPayloadJson !== warningsPayloadJson : false
        },
        turn_number: turnNumber
      };
    },
    commit_report_import_state(
      databasePath: string,
      projectId: string,
      confirmedFactionId: string,
      rawReport: string,
      allowOverwrite: boolean
    ) {
      const parsed = parseReportState(rawReport) as {
        turn_header: { turn_number: number } | null;
        detected_factions: Array<{ faction_id: string }>;
        meets_minimum_import_threshold: boolean;
        warnings: unknown;
      };
      if (!parsed.meets_minimum_import_threshold) {
        throw new Error("parsed report did not meet minimum import threshold");
      }
      if (!parsed.turn_header) {
        throw new Error("turn header missing from parsed report");
      }
      const factionDetected = parsed.detected_factions.some(
        (faction) => faction.faction_id === confirmedFactionId
      );
      if (!factionDetected) {
        throw new Error("confirmed faction does not exist in parsed report candidates");
      }
      const key = importKey(databasePath, projectId, confirmedFactionId, parsed.turn_header.turn_number);
      const previous = inMemoryImports.get(key);
      if (previous && !allowOverwrite) {
        throw new Error("duplicate import exists and requires explicit overwrite confirmation");
      }
      const parsedPayloadJson = JSON.stringify(parsed);
      const warningsPayloadJson = JSON.stringify(parsed.warnings);
      inMemoryImports.set(key, {
        rawReport,
        parsedPayloadJson,
        warningsPayloadJson
      });
      return {
        exists: previous !== undefined,
        raw_changed: previous ? previous.rawReport !== rawReport : false,
        parsed_changed: previous ? previous.parsedPayloadJson !== parsedPayloadJson : false,
        warnings_changed: previous ? previous.warningsPayloadJson !== warningsPayloadJson : false
      };
    },
    validate_orders_state(rawOrders: string) {
      return validateOrderText(rawOrders);
    },
    load_order_draft_state(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      const draft = loadDraftPayload(draftKey(databasePath, projectId, factionId, turnNumber));
      if (!draft) {
        return null;
      }

      return {
        key: {
          project_id: projectId,
          faction_id: factionId,
          turn_number: turnNumber
        },
        order_text: draft.order_text,
        updated_at: draft.updated_at
      };
    },
    save_order_draft_state(
      databasePath: string,
      projectId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      const storage = getDraftStorage();
      storage.setItem(
        draftKey(databasePath, projectId, factionId, turnNumber),
        JSON.stringify({
          key: {
            project_id: projectId,
            faction_id: factionId,
            turn_number: turnNumber
          },
          order_text: orderText,
          updated_at: updatedAt
        })
      );

      return {
        key: {
          project_id: projectId,
          faction_id: factionId,
          turn_number: turnNumber
        },
        order_text: orderText,
        updated_at: updatedAt
      };
    }
  };
}
