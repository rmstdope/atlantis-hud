/**
 * Runs every test suite the repository has, and reports on every one of them.
 *
 * `pnpm -r run test && pnpm run test:tooling && cargo test --workspace` used to be an `&&` chain,
 * so a spurious failure in the tooling suite - the one ah-vek fixes - meant `cargo test
 * --workspace` never ran at all. An agent reading the failure as "unrelated tooling test" moved
 * on having silently skipped the entire 576-test Rust suite while believing the gate covered it.
 *
 * Sequential rather than parallel, so cargo and vitest do not contend for the machine and the
 * output stays readable; exhaustive rather than short-circuiting, so a broken leg can no longer
 * hide whether the others ran. The accepted cost is a slower local run when something is already
 * broken - the trade this module makes on purpose.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SuiteResult = { name: string; passed: boolean };

type Suite = { name: string; command: string; args: string[] };

/** CI runs `test:tooling`, `test:smoke` and the rest as their own steps; this list is `pnpm test` alone. */
const SUITES: readonly Suite[] = [
  { name: "packages", command: "pnpm", args: ["-r", "run", "test"] },
  { name: "tooling", command: "pnpm", args: ["run", "test:tooling"] },
  { name: "cargo", command: "cargo", args: ["test", "--workspace"] }
];

/** What to print and exit with, once every suite has already run. Pure, so the cases are plain. */
export function summarize(results: readonly SuiteResult[]): { exitCode: number; text: string } {
  const line = `suites: ${results
    .map((result) => `${result.name} ${result.passed ? "PASS" : "FAIL"}`)
    .join("  ")}`;
  const failed = results.filter((result) => !result.passed);

  if (failed.length === 0) {
    return { exitCode: 0, text: line };
  }

  const names = failed.map((result) => result.name).join(", ");
  return {
    exitCode: 1,
    text: `${line}\n${failed.length} of ${results.length} suites failed: ${names}`
  };
}

/** Runs one suite with its output going straight to the terminal, and says whether it passed. */
function runSuite(suite: Suite): SuiteResult {
  const run = spawnSync(suite.command, suite.args, { stdio: "inherit" });

  return { name: suite.name, passed: run.status === 0 };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const results = SUITES.map(runSuite);
  const { exitCode, text } = summarize(results);
  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}
