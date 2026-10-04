/**
 * Two builds of the WebAssembly core into the same directory must not overlap (ah-x65u).
 *
 * wasm-pack 0.15 reads a `package.json` it finds in its out-dir as a map of strings, so a build
 * that finds the one a concurrent build just wrote - whose `"files": [` sits at line 5, column
 * 11 - fails with "invalid type: sequence, expected a string at line 5 column 11". That stopped
 * the release gate when its typecheck rebuilt the core while another build was writing it.
 *
 * The fake `wasm-pack` put on PATH here does what the real one does to the out-dir, slowly enough
 * for two builds to overlap: clears the old `package.json`, works, then fails if a `package.json`
 * has appeared meanwhile, and otherwise writes its own.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWasm, wasmModuleIsCurrent } from "./ensure-wasm.mjs";

const FAKE_WASM_PACK = `#!/bin/sh
out="$6"
mkdir -p "$out"
rm -f "$out/package.json"
echo build >> "$out/../builds.log"
sleep 0.5
if [ -f "$out/package.json" ]; then
  echo "Error: invalid type: sequence, expected a string at line 5 column 11" >&2
  exit 1
fi
printf '{\\n  "files": []\\n}\\n' > "$out/package.json"
printf wasm > "$out/atlantis_core_bg.wasm"
`;

let root: string;
let bin: string;
let savedPath: string | undefined;

function write(relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** The case that failed: a second build starting while the first is already under way. */
async function overlappingBuilds(): Promise<void[]> {
  const first = buildWasm(root);
  await new Promise((resolve) => setTimeout(resolve, 200));
  return Promise.all([first, buildWasm(root)]);
}

function buildsRun(): number {
  const log = join(root, "packages", "browser-core", "src", "builds.log");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ensure-wasm-lock-"));
  write("Cargo.toml", "[workspace]\n");
  write("Cargo.lock", "# lock\n");
  write("crates/a/Cargo.toml", "[package]\n");
  write("crates/a/src/lib.rs", "pub fn a() {}\n");
  bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "wasm-pack"), FAKE_WASM_PACK);
  chmodSync(join(bin, "wasm-pack"), 0o755);
  savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath ?? ""}`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(root, { recursive: true, force: true });
});

describe("buildWasm, called while another build of the same root is running", () => {
  it("succeeds instead of failing on the package.json the other build wrote", async () => {
    await expect(overlappingBuilds()).resolves.toBeDefined();
    expect(wasmModuleIsCurrent(root)).toBe(true);
  });

  it("does not build a second time when the first build has already made the core current", async () => {
    await overlappingBuilds();
    expect(buildsRun()).toBe(1);
  });

  it("waits while a live process holds the lock, and builds once it is released", async () => {
    // This test's own process is certainly alive, so it stands in for another build in flight.
    write("target/.wasm-build.lock", `${process.pid}\n`);
    const build = buildWasm(root);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(buildsRun()).toBe(0);
    rmSync(join(root, "target", ".wasm-build.lock"));
    await expect(build).resolves.toBeUndefined();
    expect(buildsRun()).toBe(1);
  });

  it("rebuilds a current core when forced, as build:wasm always has", async () => {
    await buildWasm(root);
    await buildWasm(root, { force: true });
    expect(buildsRun()).toBe(2);
  });

  it("is not held up by a lock left behind by a process that no longer exists", async () => {
    // A pid far above any real one: the process that held this lock is gone.
    write("target/.wasm-build.lock", "2147483646\n");
    await expect(buildWasm(root)).resolves.toBeUndefined();
    expect(wasmModuleIsCurrent(root)).toBe(true);
  });
});

describe("every wasm-pack build of the core", () => {
  it("goes through ensure-wasm, so it takes the build lock", () => {
    const repo = dirname(dirname(fileURLToPath(import.meta.url)));
    const manifest = JSON.parse(readFileSync(join(repo, "packages", "browser-core", "package.json"), "utf8"));
    const buildWasmScript: string = manifest.scripts["build:wasm"];
    expect(buildWasmScript).not.toContain("wasm-pack");
    expect(buildWasmScript).toContain("scripts/ensure-wasm.mjs --force");
  });
});
