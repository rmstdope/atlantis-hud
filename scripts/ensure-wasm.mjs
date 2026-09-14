/**
 * Builds the WebAssembly core only when the Rust sources have changed since the last build.
 *
 * `pretypecheck` in browser-core used to run `wasm-pack` unconditionally, which kept a fresh clone
 * working but made every typecheck pay for a build whose inputs had not moved. This script keeps
 * both properties: a fingerprint of everything the module is built from is stored beside the
 * module, and the build runs when - and only when - the fingerprint no longer matches. CI leans on
 * the same idea from the other side: its cache key hashes the same inputs, so a restored cache
 * carries a matching stamp and the build becomes a no-op.
 *
 * The fingerprint covers `crates/**` rather than only the crates the module depends on: a change
 * in an unrelated crate costs one spare rebuild, a dependency this list forgot would cost a stale
 * module that typechecks cleanly and fails at runtime.
 *
 * Both dev servers import this module too (`scripts/wasmFreshness.ts`), and check the stamp on
 * every page load so a long-lived server never serves a core older than the sources beside it. So
 * the logic is exported, every function takes the repository root explicitly, and the build runs
 * on import only when the file is executed directly. It stays dependency-free `.mjs` because CI
 * runs it with plain `node` before any install.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function wasmDir(root) {
  return join(root, "packages", "browser-core", "src", "wasm");
}

function stampFile(root) {
  return join(wasmDir(root), ".source-fingerprint");
}

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "target" && entry.name !== "node_modules") files.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".rs") || entry.name === "Cargo.toml") {
      files.push(path);
    }
  }
  return files;
}

/** sha256 hex over the Rust inputs under `root`. CI's cache key and existing stamps depend on it. */
export function wasmSourceFingerprint(root) {
  const inputs = [
    join(root, "Cargo.toml"),
    join(root, "Cargo.lock"),
    ...sourceFiles(join(root, "crates")).sort()
  ];

  const hash = createHash("sha256");
  for (const file of inputs) {
    // Paths as well as contents: a file moving between crates changes what gets built.
    hash.update(relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/** true when the built module exists and the stamp beside it matches the current sources. */
export function wasmModuleIsCurrent(root) {
  if (!existsSync(join(wasmDir(root), "atlantis_core_bg.wasm"))) return false;
  const stamp = existsSync(stampFile(root)) ? readFileSync(stampFile(root), "utf8").trim() : null;
  return stamp === wasmSourceFingerprint(root);
}

export class WasmBuildError extends Error {
  constructor(exitCode) {
    super(`wasm-pack exited with status ${exitCode}`);
    this.name = "WasmBuildError";
    /** wasm-pack's exit status, or 1 when it had none */
    this.exitCode = exitCode;
  }
}

/**
 * Runs wasm-pack asynchronously, so a dev server's event loop is not frozen for the build. The
 * fingerprint is taken before the build starts: sources edited mid-build make the next check
 * rebuild again rather than stamping a core that does not match them.
 */
export function buildWasm(root) {
  const fingerprint = wasmSourceFingerprint(root);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "wasm-pack",
      ["build", "crates/core-wasm", "--target", "web", "--out-dir", wasmDir(root), "--out-name", "atlantis_core"],
      { cwd: root, stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new WasmBuildError(status ?? 1));
        return;
      }
      writeFileSync(stampFile(root), `${fingerprint}\n`);
      resolve();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (wasmModuleIsCurrent(root)) {
    console.log("wasm module is current, skipping the build");
    process.exit(0);
  }
  try {
    await buildWasm(root);
  } catch (error) {
    if (error instanceof WasmBuildError) process.exit(error.exitCode);
    // wasm-pack could not be started at all (not installed, say): exit 1 as spawnSync used to.
    if (error && typeof error === "object" && "syscall" in error) {
      console.error(`could not run wasm-pack: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
