import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandParameters,
  commandRenames,
  lockstep,
  registeredCommands,
  splitTopLevel,
  wasmExports,
  wasmModuleMembers
} from "./tauriCommands";
import { SWEEP } from "../tests/native/sweep";
import { TAURI_COMMANDS } from "../packages/core-client/src/tauriCommands";

const ROOT = join(__dirname, "..");

/**
 * The lockstep the native suite already runs (`tests/native/binding.spec.ts`), pulled out so it
 * runs on every machine instead of only on the Linux/WebKitGTK CI job — see ah-ga6. The native
 * suite keeps the per-command IPC binding tests; this file keeps the bookkeeping honest between
 * `main.rs`'s handler list, the sweep table and the adapter that calls it.
 */
describe("registeredCommands", () => {
  it("reads the commands out of a single generate_handler! list", () => {
    const mainRs = `
      .invoke_handler(tauri::generate_handler![
          get_engine_info,
          create_game,
          delete_game
      ])
    `;

    expect(registeredCommands(mainRs)).toEqual(["get_engine_info", "create_game", "delete_game"]);
  });

  it("throws when there is no invoke_handler(generate_handler![...]) block", () => {
    expect(() => registeredCommands("fn main() {}")).toThrow();
  });

  it("throws when there is more than one, so a second builder cannot shadow the real one unseen", () => {
    const mainRs = `
      .invoke_handler(tauri::generate_handler![a])
      .invoke_handler(tauri::generate_handler![b])
    `;

    expect(() => registeredCommands(mainRs)).toThrow();
  });

  it("reads a path-registered command by its bare name", () => {
    const mainRs = `
      .invoke_handler(tauri::generate_handler![
          get_engine_info,
          atlantis_hud_core_tauri::command_parse_report
      ])
    `;

    expect(registeredCommands(mainRs)).toEqual(["get_engine_info", "parse_report"]);
  });
});

describe("commandRenames", () => {
  it("maps each renamed command to the function it sits on", () => {
    const coreTauriLibRs = `
      #[cfg_attr(feature = "tauri", tauri::command(rename_all = "snake_case", rename = "parse_report"))]
      pub fn command_parse_report(raw_report: &str) -> ReportParseResultWire {

      #[must_use]
      #[cfg_attr(feature = "tauri", tauri::command(rename_all = "snake_case", rename = "get_engine_info"))]
      pub fn command_get_engine_info() -> EngineInfo {
    `;

    expect(commandRenames(coreTauriLibRs)).toEqual(
      new Map([
        ["command_parse_report", "parse_report"],
        ["command_get_engine_info", "get_engine_info"]
      ])
    );
  });

  it("ignores a rename further than 200 characters from its function", () => {
    const filler = "x".repeat(250);
    const coreTauriLibRs = `
      #[cfg_attr(feature = "tauri", tauri::command(rename_all = "snake_case", rename = "parse_report"))]
      // ${filler}
      pub fn command_parse_report(raw_report: &str) -> ReportParseResultWire {
    `;

    expect(commandRenames(coreTauriLibRs)).toEqual(new Map());
  });
});

describe("splitTopLevel", () => {
  it("splits on commas at nesting depth zero, ignoring commas inside <> () [] {}", () => {
    expect(splitTopLevel("a: Option<&str>, b: HashMap<K, V>, c")).toEqual([
      "a: Option<&str>",
      "b: HashMap<K, V>",
      "c"
    ]);
  });

  it("drops empty entries, so a trailing comma or an empty string yields none", () => {
    expect(splitTopLevel("")).toEqual([]);
    expect(splitTopLevel("a,")).toEqual(["a"]);
  });
});

describe("commandParameters", () => {
  it("reads a main.rs wrapper's parameters, dropping the app handle", () => {
    const mainRs = `
      #[tauri::command(rename_all = "snake_case")]
      fn open_game(
          app: tauri::AppHandle,
          game_id: String,
          opened_at: String,
      ) -> Result<OpenedGameDto, String> {
    `;

    expect(commandParameters(mainRs, "")).toEqual({
      open_game: [
        { name: "game_id", required: true },
        { name: "opened_at", required: true }
      ]
    });
  });

  it("reads a renamed core-tauri command's parameters under its wire name", () => {
    const coreTauriLibRs = `
      #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "parse_report_classified")
      )]
      pub fn command_parse_report_classified(raw_report: &str, ruleset_json: &str) -> ParsedReport {
    `;

    expect(commandParameters("", coreTauriLibRs)).toEqual({
      parse_report_classified: [
        { name: "raw_report", required: true },
        { name: "ruleset_json", required: true }
      ]
    });
  });

  it("reads whether each parameter may be omitted", () => {
    const coreTauriLibRs = `
      #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "order_vocabulary")
      )]
      pub fn command_order_vocabulary(ruleset_json: Option<&str>) -> Vocabulary {
    `;
    const mainRs = `
      #[tauri::command(rename_all = "snake_case")]
      fn set_game_map(app: tauri::AppHandle, game_id: String, map_json: String) -> Result<(), String> {
    `;

    expect(commandParameters(mainRs, coreTauriLibRs)).toEqual({
      order_vocabulary: [{ name: "ruleset_json", required: false }],
      set_game_map: [
        { name: "game_id", required: true },
        { name: "map_json", required: true }
      ]
    });
  });

  it("keeps a required parameter whose type contains a top-level-safe comma", () => {
    const coreTauriLibRs = `
      #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "validate_orders")
      )]
      pub fn command_validate_orders(raw: &str, disabled_codes: Option<Vec<String>>) -> Report {
    `;

    expect(commandParameters("", coreTauriLibRs)).toEqual({
      validate_orders: [
        { name: "raw", required: true },
        { name: "disabled_codes", required: false }
      ]
    });
  });

  it("does not read the return type when deciding requiredness", () => {
    const coreTauriLibRs = `
      #[cfg_attr(
        feature = "tauri",
        tauri::command(rename_all = "snake_case", rename = "load_order_draft")
      )]
      pub fn command_load_order_draft(game_id: &str) -> Result<Option<OrderDraftRecordDto>, String> {
    `;

    expect(commandParameters("", coreTauriLibRs)).toEqual({
      load_order_draft: [{ name: "game_id", required: true }]
    });
  });

  it("throws when a wire name is declared by both main.rs and core-tauri", () => {
    const mainRs = `
      #[tauri::command(rename_all = "snake_case")]
      fn open_game(app: tauri::AppHandle, game_id: String) -> Result<OpenedGameDto, String> {
    `;
    const coreTauriLibRs = `
      #[cfg_attr(feature = "tauri", tauri::command(rename_all = "snake_case", rename = "open_game"))]
      pub fn command_open_game(game_id: &str) -> Result<OpenedGameDto, String> {
    `;

    expect(() => commandParameters(mainRs, coreTauriLibRs)).toThrow();
  });
});

describe("wasmExports", () => {
  it("counts a two-parameter export", () => {
    const coreWasmLibRs = `
      #[wasm_bindgen]
      pub fn diff_imported_turn_state(existing: JsValue, candidate: JsValue) -> Result<JsValue, JsValue> {
    `;

    expect(wasmExports(coreWasmLibRs)).toEqual({ diff_imported_turn_state: 2 });
  });
});

describe("wasmModuleMembers", () => {
  it("counts a member whose parameters span lines", () => {
    const webCoreAdapterTs = `
      export type CoreWasmModule = {
        plan_route_state(
          rulesetJson: string,
          rawReport: string,
          rememberedJson: string,
          unitId: string,
          destination: string
        ): RoutePlanResponse;
};
    `;

    expect(wasmModuleMembers(webCoreAdapterTs)).toEqual({ plan_route_state: 5 });
  });
});

describe("lockstep", () => {
  it("reports nothing when both sides agree", () => {
    expect(lockstep(["a", "b"], ["b", "a"])).toEqual({
      registeredButNotSwept: [],
      sweptButNotRegistered: []
    });
  });

  it("reports a command registered but never swept", () => {
    expect(lockstep(["a", "b"], ["a"])).toEqual({
      registeredButNotSwept: ["b"],
      sweptButNotRegistered: []
    });
  });

  it("reports a command swept but no longer registered", () => {
    expect(lockstep(["a"], ["a", "b"])).toEqual({
      registeredButNotSwept: [],
      sweptButNotRegistered: ["b"]
    });
  });
});

/**
 * The two-way check against `main.rs`, plus the one-way check that everything the adapter
 * invokes is registered (the class of bug this repository has separately paid for: a command
 * that exists in core-tauri but is never registered in the handler) — and, since ah-wxk.3, that
 * `TAURI_COMMANDS`'s keys are the Rust parameter names in order, that every `SWEEP` payload names
 * only a real parameter, and that the wasm boundary agrees on exports and arity both ways.
 */
describe("the live Tauri command lockstep", () => {
  it("agrees main.rs, the sweep table and core-client's adapter all name the same commands", () => {
    const mainRs = readFileSync(
      join(ROOT, "apps", "desktop", "src-tauri", "src", "main.rs"),
      "utf8"
    );
    const coreTauriLibRs = readFileSync(
      join(ROOT, "crates", "core-tauri", "src", "lib.rs"),
      "utf8"
    );
    const coreWasmLibRs = readFileSync(join(ROOT, "crates", "core-wasm", "src", "lib.rs"), "utf8");
    const webCoreAdapterTs = readFileSync(
      join(ROOT, "packages", "browser-core", "src", "webCoreAdapter.ts"),
      "utf8"
    );

    const registered = registeredCommands(mainRs);
    const swept = SWEEP.map((entry) => entry.command);
    const table = Object.fromEntries(
      Object.values(TAURI_COMMANDS).map(([command, ...keys]) => [command, keys])
    );
    const renames = commandRenames(coreTauriLibRs);
    const parameters = commandParameters(mainRs, coreTauriLibRs);

    expect(lockstep(registered, swept)).toEqual({
      registeredButNotSwept: [],
      sweptButNotRegistered: []
    });
    // Names: what main.rs registers, what the sweep drives and what the adapter invokes are one list.
    expect(Object.keys(table).sort()).toEqual([...registered].sort());

    // Every rename says what the function name says, and every renamed command is registered.
    // A 27th command that forgets the attribute, or one that forgets to be registered, is what
    // the pinned count catches — update it in the same commit that adds a path-registered command.
    for (const [fn, wire] of renames) {
      expect(wire, `${fn} renames to`).toBe(fn.slice("command_".length));
      expect(registered, `${fn} is registered`).toContain(wire);
    }
    expect(renames.size).toBe(28);

    // Keys: every row's keys are the Rust parameter names, in order.
    for (const [command, keys] of Object.entries(table)) {
      expect(keys, command).toEqual(parameters[command].map((parameter) => parameter.name));
    }

    // Both directions of the sweep's arguments, in one pass over each entry's args().
    //
    // The sweep names only real parameters (it may omit an Option; it may not invent one), and it
    // supplies every required one — omitting a required parameter is `missing required key <name>`
    // in CI's Linux-only native job 25 minutes later (ah-0w7w), and this is what makes it a local
    // failure in seconds instead. The `Object.keys(table)`/`registered` equality above, together
    // with `lockstep`, is what guarantees `parameters` has a row for every swept command, so
    // indexing it unguarded here is deliberate: a missing row must throw, not silently skip.
    for (const entry of SWEEP) {
      const declared = parameters[entry.command];
      expect(declared, `${entry.command} is declared`).toBeDefined();
      const supplied = new Set(Object.keys(entry.args()));
      const names = declared.map((parameter) => parameter.name);
      for (const key of supplied) {
        expect(names, `${entry.command}.${key}`).toContain(key);
      }
      for (const parameter of declared) {
        if (parameter.required) {
          expect(supplied.has(parameter.name), `${entry.command}.${parameter.name}`).toBe(true);
        }
      }
    }

    // The required/optional split is not vacuous. The counts are pinned near their live values
    // rather than merely above zero, so a rule that misclassified most of one side would fail
    // here too — a loose threshold is how a corpus assertion stayed vacuously true for 758 of
    // 1,392 units for a year (ah-ycuj). One command with a mixed signature is then pinned in
    // full, which catches an inverted or partial rule by name rather than by count.
    const allParameters = Object.values(parameters).flat();
    expect(allParameters.filter((parameter) => parameter.required).length).toBeGreaterThan(80);
    expect(allParameters.filter((parameter) => !parameter.required).length).toBeGreaterThan(10);
    expect(parameters["validate_orders"], "validate_orders is declared").toEqual([
      { name: "raw_orders", required: true },
      { name: "ruleset_json", required: false },
      { name: "raw_report", required: false },
      { name: "disabled_codes", required: false }
    ]);

    // The wasm boundary: same exports, same arity, both ways.
    expect(wasmModuleMembers(webCoreAdapterTs)).toEqual(wasmExports(coreWasmLibRs));
  });
});
