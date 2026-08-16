import { join } from "node:path";
import { readReport, readRuleset } from "@atlantis/fixtures";

/**
 * One table, two readers: `tests/native/binding.spec.ts` drives every entry over real Tauri IPC
 * (WebDriver + WebKitGTK, Linux-only, CI-only), and `scripts/tauriCommands.test.ts` holds it equal
 * to `main.rs`'s `generate_handler!` list and to what `core-client`'s adapter invokes — a check
 * that runs on every machine, not only in the native CI job (ah-ga6).
 *
 * Deliberately plain: no `@wdio/globals`, no `./helpers`, nothing that needs the native runtime —
 * only `@atlantis/fixtures`, itself only `node:fs`/`node:path`. Keep it that way, or the tooling
 * suite that imports this file stops being able to.
 *
 * The ordering rule the sweep itself relies on: `create_game` first, to mint the database every
 * scoped command needs; `delete_game` last, to leave nothing behind.
 */

const REPORT = readReport("g7f95t71");
/** Another faction, same turn: the one shape `merge_report` accepts. */
const ALLY_REPORT = readReport("g8f73t71");
const RULESET = readRuleset();

/** The shell owns no clock; every timestamp crosses IPC from the frontend. */
export const ISO = "2026-08-10T12:00:00Z";
export const GAME_ID = "native-binding-sweep";

/**
 * Filled in when `create_game` — deliberately the first entry — returns its `OpenedGameDto`.
 * The defaults keep a broken `create_game` from cascading into false binding failures: a path
 * to nowhere still binds, and the database-scoped commands then fail as commands, loudly but
 * accurately.
 *
 * Exported as the object itself, not a copy: the native spec's `create_game` case mutates
 * `context.databasePath` in place, and every scoped command after it reads the same object —
 * a copy would leave those commands still pointing at the nonexistent default path.
 */
export const context = {
  databasePath: join("/nonexistent", "game.sqlite")
};

export interface SweepEntry {
  command: string;
  args: () => Record<string, unknown>;
}

/**
 * One entry per registered command, in an order that lets the sweep feed itself: `create_game`
 * first to mint the database every scoped command needs, `delete_game` last to leave nothing
 * behind.
 */
export const SWEEP: SweepEntry[] = [
  {
    command: "create_game",
    args: () => ({
      manifest: {
        manifestVersion: 1,
        metadata: { gameId: GAME_ID, gameName: "Binding sweep", rulesetId: "neworigins" },
        reportSources: [],
        createdAt: ISO,
        lastOpenedAt: ISO
      }
    })
  },
  { command: "get_engine_info", args: () => ({}) },
  { command: "list_games", args: () => ({}) },
  { command: "open_game", args: () => ({ game_id: GAME_ID, opened_at: ISO }) },
  { command: "export_game", args: () => ({ game_id: GAME_ID, exported_at: ISO }) },
  // A backup no game can have: importing refuses an existing id, and a domain refusal is
  // exactly as good a binding proof as a success.
  { command: "import_game", args: () => ({ backup_json: "{}", opened_at: ISO }) },
  { command: "set_game_ruleset", args: () => ({ game_id: GAME_ID, ruleset_id: "neworigins" }) },
  { command: "set_game_name", args: () => ({ game_id: GAME_ID, game_name: "Binding sweep" }) },
  { command: "parse_report", args: () => ({ raw_report: REPORT }) },
  { command: "parse_report_full", args: () => ({ raw_report: REPORT }) },
  {
    command: "parse_report_classified",
    args: () => ({ raw_report: REPORT, ruleset_json: RULESET })
  },
  {
    command: "validate_orders",
    // The ruleset is what lets an item name be checked against the catalogue, and it crosses as its
    // own argument: a name this side does not match deserializes to `None` over there without an
    // error, and every item would silently go unchecked.
    args: () => ({ raw_orders: "unit 18642\n@work", ruleset_json: RULESET })
  },
  { command: "order_commands", args: () => ({}) },
  { command: "order_argument_completions", args: () => ({ line_prefix: "NAME U" }) },
  {
    command: "plan_route",
    args: () => ({
      ruleset_json: RULESET,
      raw_report: REPORT,
      remembered_json: "[]",
      unit_id: "18642",
      destination: "1:9,53"
    })
  },
  {
    command: "trace_move_orders",
    args: () => ({
      ruleset_json: RULESET,
      raw_report: REPORT,
      remembered_json: "[]",
      unit_id: "18642",
      orders: "MOVE N"
    })
  },
  {
    command: "export_map",
    // The request crosses as text of its own: a key this side the core does not know deserializes
    // to a refusal naming the request rather than the key, so only real IPC proves the three
    // arguments arrive.
    args: () => ({
      raw_report: REPORT,
      remembered_json: "[]",
      request_json: JSON.stringify({
        level: 1,
        fromX: 0,
        fromY: 0,
        toX: 20,
        toY: 60,
        content: { structures: true, units: true, advancedResources: true }
      })
    })
  },
  {
    command: "known_map",
    args: () => ({
      raw_report: REPORT,
      ruleset_json: null,
      remembered_json: "[]"
    })
  },
  {
    command: "preview_orders",
    args: () => ({
      ruleset_json: RULESET,
      raw_report: REPORT,
      remembered_json: "[]",
      orders_document: "unit 18642\nGUARD 1"
    })
  },
  {
    command: "preview_report_import",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      confirmed_faction_id: "95",
      raw_report: REPORT
    })
  },
  {
    command: "commit_report_import",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      confirmed_faction_id: "95",
      raw_report: REPORT,
      allow_overwrite: true,
      imported_at: ISO
    })
  },
  {
    command: "load_imported_turn",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      faction_id: "95",
      turn_number: 71
    })
  },
  {
    command: "load_latest_imported_turn",
    args: () => ({ database_path: context.databasePath, game_id: GAME_ID })
  },
  {
    command: "list_imported_turns",
    args: () => ({ database_path: context.databasePath, game_id: GAME_ID })
  },
  {
    command: "save_order_draft",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      faction_id: "95",
      turn_number: 71,
      order_text: "@work",
      updated_at: ISO
    })
  },
  {
    command: "load_order_draft",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      faction_id: "95",
      turn_number: 71
    })
  },
  {
    command: "load_region_sightings",
    args: () => ({ database_path: context.databasePath, game_id: GAME_ID, faction_id: "95" })
  },
  {
    command: "merge_report",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      viewer_faction_id: "95",
      viewer_turn_number: 71,
      raw_report: ALLY_REPORT,
      merged_at: ISO
    })
  },
  {
    command: "load_merged_reports",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      faction_id: "95",
      turn_number: 71
    })
  },
  {
    command: "list_hex_notes",
    args: () => ({ database_path: context.databasePath, game_id: GAME_ID })
  },
  {
    command: "save_hex_note",
    args: () => ({
      database_path: context.databasePath,
      note: {
        id: "binding-sweep-note",
        gameId: GAME_ID,
        regionId: "1:7,53",
        text: "binding sweep",
        onMap: true,
        turn: 71,
        createdAt: ISO,
        updatedAt: ISO
      }
    })
  },
  {
    command: "delete_hex_note",
    args: () => ({
      database_path: context.databasePath,
      game_id: GAME_ID,
      note_id: "binding-sweep-note"
    })
  },
  { command: "delete_game", args: () => ({ game_id: GAME_ID }) }
];
