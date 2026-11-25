/**
 * Installs the locked packages when node_modules is older than pnpm-lock.yaml (ah-20awr).
 *
 * Cargo rebuilds against a moved Cargo.lock by itself; nothing did the same for the JavaScript
 * side. After #1999 bumped tauri-plugin-http to 2.9.0 in both lockfiles, a checkout that had not
 * run `pnpm install` built the 2.9.0 crate under the 2.5.9 npm package - two halves of one plugin
 * speaking different IPC - and every HTTP request the desktop shell made was rejected, which the
 * New Age dialogs report as "Could not reach atlantis-newage.com".
 *
 * pnpm 9 writes a byte-identical copy of the lockfile to node_modules/.pnpm/lock.yaml after every
 * install, so "installed as locked" is one comparison. When it fails this runs
 * `pnpm install --frozen-lockfile`, which installs exactly what the lockfile says and never
 * rewrites it. In step, it costs two file reads. Dependency-free `.mjs` for the reason
 * ensure-wasm.mjs gives: it runs before anything is installed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function read(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

/** true when the last install under `root` installed the lockfile as it now stands. */
export function installedPackagesAreCurrent(root) {
  const installed = read(join(root, "node_modules", ".pnpm", "lock.yaml"));
  const wanted = read(join(root, "pnpm-lock.yaml"));
  return installed !== null && wanted !== null && installed.equals(wanted);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (!installedPackagesAreCurrent(root)) {
    console.log("node_modules is older than pnpm-lock.yaml; installing the locked packages first");
    const result = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    process.exit(result.status ?? 1);
  }
}
