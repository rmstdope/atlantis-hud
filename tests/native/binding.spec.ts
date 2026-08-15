import { expect } from "@wdio/globals";
import { invokeNative } from "./helpers";
import { context, SWEEP } from "./sweep";

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
 *
 * The table (`SWEEP`) and its fixtures live in `./sweep`, a plain module with no WebDriver
 * globals, so the lockstep against `main.rs` and `core-client`'s adapter can also run as a
 * tooling unit test on every machine (`scripts/tauriCommands.test.ts`) rather than only here, on
 * the Linux/WebKitGTK CI job — ah-ga6. That lockstep used to live in this file as its own `it`;
 * it is gone from here because the whole point was for it to run without WebKitGTK.
 */

/**
 * The failures this sweep is about, anchored to the exact shapes Tauri 2 produces: a binding
 * miss is "invalid args `name` for command `x`: ...", an unregistered command is "Command x not
 * found", and a capability miss is "Command x not allowed by ACL". Anchored rather than loose,
 * because a domain error is a pass here and domain text is free to contain words like "not
 * found" without tripping the sweep.
 */
const BINDING_FAILURE = /invalid args `|^Command .+ not (found|allowed)/u;

describe("tauri command binding", () => {
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
