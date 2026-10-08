/**
 * Local builds and CI must compile with the same Rust release.
 *
 * With `channel = "stable"` the local gate ran whatever stable rustup last fetched while every CI
 * job installed the newest one, so a lint one release added let main merge green and then fail the
 * next implementer's local clippy (ah-4oz9's retrospective, ah-3kge). The release is now named once,
 * in `rust-toolchain.toml`, and every workflow installs the toolchain that file names - a Rust bump
 * is a one-line change both sides pick up together.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOWS = join(REPO, ".github", "workflows");

function workflows(): { file: string; text: string }[] {
  return readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => ({ file, text: readFileSync(join(WORKFLOWS, file), "utf8") }));
}

/** Every step named "Setup Rust", as the lines up to the next step or the end of the job. */
function setupRustSteps(): { file: string; body: string }[] {
  return workflows().flatMap(({ file, text }) =>
    [...text.matchAll(/^( *)- name: Setup Rust\n((?:\1 {2}.*\n|\s*\n)*)/gm)].map((match) => ({
      file,
      body: match[2]
    }))
  );
}

describe("one Rust release, named in rust-toolchain.toml", () => {
  it("rust-toolchain.toml pins an exact release", () => {
    const toml = readFileSync(join(REPO, "rust-toolchain.toml"), "utf8");
    expect(toml).toMatch(/^channel = "\d+\.\d+\.\d+"$/m);
  });

  // Without this the step regex could stop matching - a renamed step - and the checks below would
  // pass forever while checking nothing.
  it("there is at least one Setup Rust step to check", () => {
    expect(setupRustSteps().length).toBeGreaterThan(0);
  });

  it("no workflow installs Rust from an action's own channel", () => {
    const offenders = workflows().filter(({ text }) => /dtolnay\/rust-toolchain|toolchain:|@stable\b/.test(text));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("every Setup Rust step installs the toolchain rust-toolchain.toml names", () => {
    const offenders = setupRustSteps().filter(
      ({ body }) => !/^\s*rustup toolchain install\s*(#.*)?$/m.test(body)
    );
    expect(offenders.map(({ file, body }) => `${file}:\n${body}`)).toEqual([]);
  });

  it("the cached wasm module is keyed on the toolchain that built it", () => {
    const keys = workflows().flatMap(({ text }) =>
      [...text.matchAll(/key: wasm-module-.*$/gm)].map((match) => match[0])
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !key.includes("rust-toolchain.toml"))).toEqual([]);
  });
});
