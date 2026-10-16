/**
 * Where this repository mounts cerebro, and the one way the consumer reaches its scripts (ah-r5hr).
 *
 * The mount used to be spelled out at every caller. When cerebro last moved, to
 * `.cerebro/cerebro`, the consumer's own callers were missed: check:fast's disk preflight and its
 * workload classifier both spawned scripts that were no longer there, and `pnpm run sightings` ran
 * nothing. Moving the submodule again is now this constant plus `.gitmodules`, and
 * `scripts/cerebro.test.ts` fails if the two disagree or a caller spells the mount itself.
 *
 * Run directly, it runs one of cerebro's scripts - which is how package.json reaches them:
 *
 *     tsx scripts/cerebro.ts <script> [args...]
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The submodule's path from the repository root; `.gitmodules` must say the same. */
export const CEREBRO_MOUNT = ".cerebro/cerebro";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** The absolute path of one of cerebro's scripts in this checkout. */
export function cerebroScript(name: string): string {
  return join(REPO, CEREBRO_MOUNT, "scripts", name);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [name, ...args] = process.argv.slice(2);
  if (name === undefined) {
    process.stderr.write("usage: tsx scripts/cerebro.ts <script> [args...]\n");
    process.exit(2);
  }
  const run = spawnSync(cerebroScript(name), args, { stdio: "inherit" });
  if (run.error) {
    // The usual cause is a clone made without the submodule, where the mount is an empty directory.
    process.stderr.write(
      `cerebro: ${name} could not start: ${run.error.message}\n` +
        "If the submodule is empty, run: git submodule update --init --recursive\n"
    );
    process.exit(127);
  }
  process.exit(run.status ?? 1);
}
