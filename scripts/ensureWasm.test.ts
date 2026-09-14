/**
 * `scripts/ensure-wasm.mjs` is imported by both dev servers as well as run by CI, so its logic is
 * exported and pinned here against temporary roots. Nothing here spawns `wasm-pack` or `cargo`.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));

import { wasmModuleIsCurrent, wasmSourceFingerprint } from "./ensure-wasm.mjs";

let root: string;

function write(relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const WASM_DIR = join("packages", "browser-core", "src", "wasm");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ensure-wasm-"));
  write("Cargo.toml", "[workspace]\n");
  write("Cargo.lock", "# lock\n");
  write("crates/a/Cargo.toml", "[package]\n");
  write("crates/a/src/lib.rs", "pub fn a() {}\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("wasmSourceFingerprint", () => {
  it("gives the same fingerprint for the same sources and a different one when a .rs file changes", () => {
    const first = wasmSourceFingerprint(root);
    expect(wasmSourceFingerprint(root)).toBe(first);
    write("crates/a/src/lib.rs", "pub fn a() { let _ = 1; }\n");
    expect(wasmSourceFingerprint(root)).not.toBe(first);
  });

  it("ignores files under a target directory", () => {
    const first = wasmSourceFingerprint(root);
    write("crates/a/target/x.rs", "fn generated() {}\n");
    expect(wasmSourceFingerprint(root)).toBe(first);
  });

  it("changes the fingerprint when a file moves between crates", () => {
    const first = wasmSourceFingerprint(root);
    mkdirSync(join(root, "crates/b/src"), { recursive: true });
    renameSync(join(root, "crates/a/src/lib.rs"), join(root, "crates/b/src/lib.rs"));
    expect(wasmSourceFingerprint(root)).not.toBe(first);
  });
});

describe("wasmModuleIsCurrent", () => {
  it("reports the module stale when the .wasm file is missing", () => {
    write(join(WASM_DIR, ".source-fingerprint"), `${wasmSourceFingerprint(root)}\n`);
    expect(wasmModuleIsCurrent(root)).toBe(false);
  });

  it("reports the module stale when the stamp does not match the sources", () => {
    write(join(WASM_DIR, "atlantis_core_bg.wasm"), "wasm");
    write(join(WASM_DIR, ".source-fingerprint"), "0".repeat(64));
    expect(wasmModuleIsCurrent(root)).toBe(false);
  });

  it("reports the module current when the stamp matches", () => {
    write(join(WASM_DIR, "atlantis_core_bg.wasm"), "wasm");
    write(join(WASM_DIR, ".source-fingerprint"), `${wasmSourceFingerprint(root)}\n`);
    expect(wasmModuleIsCurrent(root)).toBe(true);
  });
});

describe("importing ensure-wasm.mjs", () => {
  it("does not run the build when imported", async () => {
    const childProcess = await import("node:child_process");
    vi.mocked(childProcess.spawn).mockClear();
    vi.mocked(childProcess.spawnSync).mockClear();
    vi.resetModules();
    await import("./ensure-wasm.mjs");
    const mocked = await import("node:child_process");
    expect(mocked.spawn).not.toHaveBeenCalled();
    expect(mocked.spawnSync).not.toHaveBeenCalled();
  });
});
