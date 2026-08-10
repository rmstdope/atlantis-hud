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
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const wasmDir = join(root, "packages", "browser-core", "src", "wasm");
const stampFile = join(wasmDir, ".source-fingerprint");

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
const fingerprint = hash.digest("hex");

const moduleExists = existsSync(join(wasmDir, "atlantis_core_bg.wasm"));
const stamp = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : null;

if (moduleExists && stamp === fingerprint) {
  console.log("wasm module is current, skipping the build");
  process.exit(0);
}

const build = spawnSync(
  "wasm-pack",
  ["build", "crates/core-wasm", "--target", "web", "--out-dir", wasmDir, "--out-name", "atlantis_core"],
  { cwd: root, stdio: "inherit" }
);
if (build.status !== 0) process.exit(build.status ?? 1);

writeFileSync(stampFile, `${fingerprint}\n`);
