import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invokedCommands, lockstep, registeredCommands } from "./tauriCommands";
import { SWEEP } from "../tests/native/sweep";

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
});

describe("invokedCommands", () => {
  it("finds every command name invoke's first argument names, typed or not", () => {
    const source = `
      function a() { return invoke<EngineInfo>("get_engine_info"); }
      function b() { return invoke<void>("delete_game", { game_id: id }); }
    `;

    expect(invokedCommands(source)).toEqual(["get_engine_info", "delete_game"]);
  });

  it("deduplicates a command invoked more than once", () => {
    const source = `
      invoke<A>("create_game");
      invoke<B>("create_game", { manifest });
    `;

    expect(invokedCommands(source)).toEqual(["create_game"]);
  });

  it("ignores a string that is not invoke's first argument", () => {
    const source = `
      logger.warn("create_game", err);
      invoke<A>("open_game", { game_id: "create_game" });
    `;

    expect(invokedCommands(source)).toEqual(["open_game"]);
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
 * that exists in core-tauri but is never registered in the handler).
 */
describe("the live Tauri command lockstep", () => {
  it("agrees main.rs, the sweep table and core-client's adapter all name the same commands", () => {
    const mainRs = readFileSync(
      join(ROOT, "apps", "desktop", "src-tauri", "src", "main.rs"),
      "utf8"
    );
    const coreClientIndex = readFileSync(
      join(ROOT, "packages", "core-client", "src", "index.ts"),
      "utf8"
    );

    const registered = registeredCommands(mainRs);
    const swept = SWEEP.map((entry) => entry.command);
    const invoked = invokedCommands(coreClientIndex);

    expect(lockstep(registered, swept)).toEqual({
      registeredButNotSwept: [],
      sweptButNotRegistered: []
    });
    expect(invoked.filter((command) => !registered.includes(command))).toEqual([]);
  });
});
