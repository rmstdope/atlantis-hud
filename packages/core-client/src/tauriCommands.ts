/**
 * The desktop transport, declared once.
 *
 * One row per `CoreAdapter` method: the Tauri command it invokes and the argument keys, in the
 * method's parameter order — snake_case, exactly as the `#[tauri::command(rename_all = "snake_case")]`
 * function names its parameters (core-tauri's `command_*` for most, `main.rs`'s wrappers for the
 * eight games-root commands). The type holds every row to its method's arity, and
 * `scripts/tauriCommands.test.ts` holds every key to the Rust parameter names and every command to
 * `main.rs` and the native sweep, on every machine.
 */
import type { CoreAdapter } from "./index";

/** `invoke` from `@tauri-apps/api/core`, as the desktop shell hands it in. */
export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** One string per parameter of `F`, as a tuple of the same length. */
type ArgKeys<F> = F extends (...args: infer A) => unknown ? { readonly [I in keyof A]: string } : never;

type CommandTable = {
  readonly [K in keyof CoreAdapter]: readonly [command: string, ...keys: ArgKeys<CoreAdapter[K]>];
};

export const TAURI_COMMANDS = {
  getEngineInfo: ["get_engine_info"],
  listGames: ["list_games"],
  createGame: ["create_game", "manifest"],
  openGame: ["open_game", "game_id", "opened_at"],
  deleteGame: ["delete_game", "game_id"],
  exportGame: ["export_game", "game_id", "exported_at"],
  importGame: ["import_game", "backup_json", "opened_at"],
  setGameRuleset: ["set_game_ruleset", "game_id", "ruleset_id"],
  setGameName: ["set_game_name", "game_id", "game_name"],
  parseReport: ["parse_report", "raw_report"],
  parseReportFull: ["parse_report_full", "raw_report"],
  parseReportClassified: ["parse_report_classified", "raw_report", "ruleset_json"],
  previewReportImport: ["preview_report_import", "database_path", "game_id", "confirmed_faction_id", "raw_report"],
  commitReportImport: [
    "commit_report_import",
    "database_path",
    "game_id",
    "confirmed_faction_id",
    "raw_report",
    "ruleset_json",
    "allow_overwrite",
    "imported_at"
  ],
  validateOrders: ["validate_orders", "raw_orders", "ruleset_json", "raw_report", "disabled_codes"],
  orderCommands: ["order_commands"],
  orderArgumentCompletions: ["order_argument_completions", "line_prefix"],
  planRoute: ["plan_route", "ruleset_json", "raw_report", "remembered_json", "unit_id", "destination"],
  traceMoveOrders: ["trace_move_orders", "ruleset_json", "raw_report", "remembered_json", "unit_id", "orders"],
  exportMap: ["export_map", "raw_report", "remembered_json", "request_json"],
  knownMap: ["known_map", "raw_report", "ruleset_json", "remembered_json"],
  previewOrders: ["preview_orders", "ruleset_json", "raw_report", "remembered_json", "orders_document"],
  loadRegionSightings: ["load_region_sightings", "database_path", "game_id", "faction_id"],
  mergeReport: [
    "merge_report",
    "database_path",
    "game_id",
    "viewer_faction_id",
    "viewer_turn_number",
    "raw_report",
    "ruleset_json",
    "merged_at"
  ],
  loadMergedReports: ["load_merged_reports", "database_path", "game_id", "faction_id", "turn_number"],
  loadImportedTurn: ["load_imported_turn", "database_path", "game_id", "faction_id", "turn_number"],
  loadLatestImportedTurn: ["load_latest_imported_turn", "database_path", "game_id"],
  listImportedTurns: ["list_imported_turns", "database_path", "game_id"],
  loadOrderDraft: ["load_order_draft", "database_path", "game_id", "faction_id", "turn_number"],
  saveOrderDraft: [
    "save_order_draft",
    "database_path",
    "game_id",
    "faction_id",
    "turn_number",
    "order_text",
    "updated_at"
  ],
  listHexNotes: ["list_hex_notes", "database_path", "game_id"],
  saveHexNote: ["save_hex_note", "database_path", "note"],
  deleteHexNote: ["delete_hex_note", "database_path", "game_id", "note_id"]
} as const satisfies CommandTable;

/**
 * Every `CoreAdapter` method invokes its row: the command, with the arguments keyed by the row.
 * Whatever Tauri resolves is the answer — the types are what the core serializes (`ah-wxk.2`).
 */
export function createTauriAdapter(invoke: TauriInvoke): CoreAdapter {
  const adapter: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [method, [command, ...keys]] of Object.entries(TAURI_COMMANDS)) {
    adapter[method] = (...args) =>
      invoke(command, Object.fromEntries(keys.map((key, index) => [key, args[index]])));
  }
  return adapter as unknown as CoreAdapter;
}
