import { invoke } from "@tauri-apps/api/core";
import type { TauriInvoke } from "@atlantis/core-client";

type OrderDraftPayload = {
  orderText: string;
  updatedAt: string;
};

const inMemoryOrderDrafts = new Map<string, string>();
const gameInfo = {
  id: "atlantis",
  name: "Atlantis PBEM",
  rulesetVersion: "4.0",
  maxFactionCount: 128
};

function draftKey(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
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
