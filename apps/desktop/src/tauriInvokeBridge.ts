import { invoke } from "@tauri-apps/api/core";
import type { TauriInvoke } from "@atlantis/core-client";

type OrderDraftPayload = {
  orderText: string;
  updatedAt: string;
};

type ParsedReportPayload = {
  turn_header: { turn_number: number; season: string } | null;
  detected_factions: Array<{ faction_id: string; name: string }>;
  regions: Array<{ region_id: string; name: string }>;
  units: Array<{ unit_id: string; name: string; region_id: string }>;
  inventories: Array<{ unit_id: string; item: string; quantity: number }>;
  message_summaries: Array<{ kind: string; source: string; text: string }>;
  warnings: Array<{
    code: string;
    section: string;
    message: string;
    line_start: number;
    line_end: number;
    severity: "warning" | "error";
  }>;
  meets_minimum_import_threshold: boolean;
};

const inMemoryOrderDrafts = new Map<string, string>();
const inMemoryImports = new Map<string, {
  rawReport: string;
  parsedPayloadJson: string;
}>();
const gameInfo = {
  id: "atlantis",
  name: "Atlantis PBEM",
  rulesetVersion: "4.0",
  maxFactionCount: 128
};

function draftKey(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
  return `${databasePath}::${projectId}::${factionId}::${turnNumber}`;
}

function importKey(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
  return `${databasePath}::${projectId}::${factionId}::${turnNumber}`;
}

function parseReport(rawReport: string): ParsedReportPayload {
  const lines = rawReport.split(/\r?\n/u);
  let turnHeader: { turn_number: number; season: string } | null = null;
  const detectedFactions: Array<{ faction_id: string; name: string }> = [];
  const regions: Array<{ region_id: string; name: string }> = [];
  const units: Array<{ unit_id: string; name: string; region_id: string }> = [];
  const warnings: ParsedReportPayload["warnings"] = [];

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
      turnHeader = { turn_number: turnNumber, season: payload[1] ?? "Unknown" };
      return;
    }

    const factionFields = parseFields("FACTION:", 2);
    if (factionFields) {
      if (factionFields.length === 2) {
        detectedFactions.push({ faction_id: factionFields[0], name: factionFields[1] });
      }
      return;
    }

    const regionFields = parseFields("REGION:", 2);
    if (regionFields) {
      if (regionFields.length === 2) {
        regions.push({ region_id: regionFields[0], name: regionFields[1] });
      }
      return;
    }

    const unitFields = parseFields("UNIT:", 3);
    if (unitFields && unitFields.length === 3) {
      units.push({
        unit_id: unitFields[0],
        name: unitFields[1],
        region_id: unitFields[2]
      });
    }
  });

  return {
    turn_header: turnHeader,
    detected_factions: detectedFactions,
    regions,
    units,
    inventories: [],
    message_summaries: [],
    warnings,
    meets_minimum_import_threshold:
      turnHeader !== null && detectedFactions.length > 0 && (regions.length > 0 || units.length > 0)
  };
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

function validateOrders(rawOrders: string) {
  const diagnostics: Array<{
    code: string;
    message: string;
    lineStart: number;
    lineEnd: number;
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
          lineStart: lineNumber,
          lineEnd: lineNumber,
          severity: "error"
        });
      } else if (args.length > 2) {
        diagnostics.push({
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: lineNumber,
          lineEnd: lineNumber,
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
          lineStart: lineNumber,
          lineEnd: lineNumber,
          severity: "warning"
        });
      }
      return;
    }

    diagnostics.push({
      code: "unknown-command",
      message: "unknown order command",
      lineStart: lineNumber,
      lineEnd: lineNumber,
      severity: "error"
    });
  });

  return { diagnostics };
}

function browserFallback(command: string, args?: Record<string, unknown>) {
  switch (command) {
    case "get_game_info":
      return gameInfo;
    case "validate_orders":
      return validateOrders(String(args?.raw_orders ?? ""));
    case "commit_report_import": {
      const databasePath = String(args?.database_path ?? "");
      const projectId = String(args?.project_id ?? "");
      const factionId = String(args?.confirmed_faction_id ?? "");
      const rawReport = String(args?.raw_report ?? "");
      const parsed = parseReport(rawReport);

      if (!parsed.meets_minimum_import_threshold || !parsed.turn_header) {
        throw new Error("parsed report did not meet minimum import threshold");
      }

      if (!parsed.detected_factions.some((faction) => faction.faction_id === factionId)) {
        throw new Error("confirmed faction does not exist in parsed report candidates");
      }

      const key = importKey(databasePath, projectId, factionId, parsed.turn_header.turn_number);
      const exists = inMemoryImports.has(key);
      inMemoryImports.set(key, {
        rawReport,
        parsedPayloadJson: JSON.stringify(parsed)
      });

      return {
        exists,
        raw_changed: false,
        parsed_changed: false,
        warnings_changed: false
      };
    }
    case "load_imported_turn": {
      const databasePath = String(args?.database_path ?? "");
      const projectId = String(args?.project_id ?? "");
      const factionId = String(args?.faction_id ?? "");
      const turnNumber = Number(args?.turn_number ?? 0);
      const key = importKey(databasePath, projectId, factionId, turnNumber);
      const stored = inMemoryImports.get(key);
      if (!stored) {
        return null;
      }
      return {
        key: {
          project_id: projectId,
          faction_id: factionId,
          turn_number: turnNumber
        },
        raw_report: stored.rawReport,
        parse_result: JSON.parse(stored.parsedPayloadJson)
      };
    }
    case "load_order_draft": {
      const key = draftKey(
        String(args?.database_path ?? ""),
        String(args?.project_id ?? ""),
        String(args?.faction_id ?? ""),
        Number(args?.turn_number ?? 0)
      );
      const serialized = getDraftStorage().getItem(key);
      if (!serialized) {
        return null;
      }
      return JSON.parse(serialized) as {
        key: {
          project_id: string;
          faction_id: string;
          turn_number: number;
        };
        order_text: string;
        updated_at: string;
      };
    }
    case "save_order_draft": {
      const key = draftKey(
        String(args?.database_path ?? ""),
        String(args?.project_id ?? ""),
        String(args?.faction_id ?? ""),
        Number(args?.turn_number ?? 0)
      );
      const payload: OrderDraftPayload & {
        key: {
          project_id: string;
          faction_id: string;
          turn_number: number;
        };
      } = {
        key: {
          project_id: String(args?.project_id ?? ""),
          faction_id: String(args?.faction_id ?? ""),
          turn_number: Number(args?.turn_number ?? 0)
        },
        orderText: String(args?.order_text ?? ""),
        updatedAt: String(args?.updated_at ?? new Date().toISOString())
      };
      getDraftStorage().setItem(
        key,
        JSON.stringify({
          key: payload.key,
          order_text: payload.orderText,
          updated_at: payload.updatedAt
        })
      );
      return {
        key: payload.key,
        order_text: payload.orderText,
        updated_at: payload.updatedAt
      };
    }
    default:
      throw new Error(`unsupported browser command: ${command}`);
  }
}

export const tauriInvokeBridge: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
  const hasTauriRuntime =
    typeof window !== "undefined" && Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  if (!hasTauriRuntime) {
    return browserFallback(command, args) as T;
  }

  return invoke<T>(command, args);
};
