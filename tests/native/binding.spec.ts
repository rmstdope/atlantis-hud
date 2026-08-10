import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@wdio/globals";
import { invokeNative } from "./helpers";

/**
 * Invokes every registered Tauri command over real IPC, with the argument names `main.rs`
 * declares.
 *
 * This sweep exists because of an afternoon in which all of the shell's commands failed at once:
 * Tauri 2 looks arguments up in camelCase by default, the adapter sends snake_case, and nothing
 * in any suite ever crossed the bridge to notice. A command here passes if it either resolves or
 * fails like a command — a domain error means the arguments bound and the implementation ran.
 * What fails the sweep is precisely what reached the navigator's machine: an argument that does
 * not bind, or a command that is not registered at all.
 */

const ROOT = join(__dirname, "..", "..");

const REPORT = readFileSync(
  join(ROOT, "tests", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);
/** Another faction, same turn: the one shape `merge_report` accepts. */
const ALLY_REPORT = readFileSync(
  join(ROOT, "tests", "fixtures", "reports", "neworigins-3.0.0-f73-t71.rep"),
  "utf8"
);
const RULESET = readFileSync(join(ROOT, "config", "public", "ruleset.json"), "utf8");

/** The shell owns no clock; every timestamp crosses IPC from the frontend. */
const ISO = "2026-08-10T12:00:00Z";
const GAME_ID = "native-binding-sweep";

/**
 * The failures this sweep is about. Tauri phrases an unregistered command as "Command X not
 * found" and a binding miss as "invalid args `name` for command X"; anything else a command
 * throws is its own business.
 */
const BINDING_FAILURE = /invalid args|not found|unknown/iu;

/**
 * Filled in when `create_game` — deliberately the first entry — returns its `OpenedGameDto`.
 * The defaults keep a broken `create_game` from cascading into false binding failures: a path
 * to nowhere still binds, and the database-scoped commands then fail as commands, loudly but
 * accurately.
 */
const context = {
  databasePath: join("/nonexistent", "game.sqlite")
};

interface SweepEntry {
  command: string;
  args: () => Record<string, unknown>;
}

/**
 * One entry per registered command, in an order that lets the sweep feed itself: `create_game`
 * first to mint the database every scoped command needs, `delete_game` last to leave nothing
 * behind. The lockstep test below holds this table equal to the registration list in `main.rs`.
 */
const SWEEP: SweepEntry[] = [
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
  { command: "set_game_ruleset", args: () => ({ game_id: GAME_ID, ruleset_id: "neworigins" }) },
  { command: "parse_report", args: () => ({ raw_report: REPORT }) },
  { command: "parse_report_full", args: () => ({ raw_report: REPORT }) },
  {
    command: "parse_report_classified",
    args: () => ({ raw_report: REPORT, ruleset_json: RULESET })
  },
  { command: "validate_orders", args: () => ({ raw_orders: "unit 18642\n@work" }) },
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
  { command: "delete_game", args: () => ({ game_id: GAME_ID }) }
];

describe("tauri command binding", () => {
  /**
   * Holds this file and `generate_handler!` equal, in both directions, so a command cannot be
   * added, removed or renamed without this suite noticing. The same in-repo cross-check the
   * version test makes between `vite.config.ts` and `tauri.conf.json`.
   */
  it("sweeps exactly the commands the invoke handler registers", () => {
    const source = readFileSync(
      join(ROOT, "apps", "desktop", "src-tauri", "src", "main.rs"),
      "utf8"
    );
    const block = source.match(/generate_handler!\[([\s\S]*?)\]/u);
    if (!block) {
      throw new Error("no generate_handler! registration found in main.rs");
    }
    const registered = block[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const swept = SWEEP.map((entry) => entry.command);
    const missing = registered.filter((command) => !swept.includes(command));
    const stale = swept.filter((command) => !registered.includes(command));

    expect({ registeredButNotSwept: missing, sweptButNotRegistered: stale }).toEqual({
      registeredButNotSwept: [],
      sweptButNotRegistered: []
    });
  });

  for (const entry of SWEEP) {
    it(`${entry.command} binds its arguments over real IPC`, async () => {
      const result = await invokeNative(entry.command, entry.args());

      if (entry.command === "create_game" && result.ok) {
        context.databasePath = (result.value as { databasePath: string }).databasePath;
      }

      if (!result.ok) {
        expect(result.error).not.toMatch(BINDING_FAILURE);
      }
    });
  }
});
