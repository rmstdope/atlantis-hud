/**
 * Which legs of the fast gate a diff actually needs (ah-ckzw).
 *
 * `check:fast` ran `cargo test --workspace`, `cargo fmt --check` and `cargo clippy` for every diff,
 * so a TypeScript-only bead waited about thirty minutes on a Rust suite its change could not affect
 * (docs/retrospectives/ah-sooy.md). The gate now classifies its own diff through cerebro's
 * `build-workload` - never a second copy of `rust_paths` - and skips the Rust legs when no changed
 * path matches. CI's rust job still runs them for every code PR, so it stays the authority.
 *
 * Anything uncertain runs every leg: a skipped Rust suite on a Rust diff is the expensive error,
 * a slow gate the cheap one.
 *
 * Imports nothing from `./runGate` or `./runSuites`: both import this module.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Workload = "rust" | "non-rust";
export type WorkloadDecision = { workload: Workload; reason: string };

/** Set by the gate for its `test` leg; read by runSuites. A caller may set it to "rust" to force every leg. */
export const GATE_WORKLOAD_ENV = "ATLANTIS_GATE_WORKLOAD";

/** The ref the diff is taken against: the merge-base of HEAD and this. */
export const BASE_REF = "origin/main";

/** A leg or suite that only matters when Rust changed. */
export type RustTagged = { name: string; rust?: boolean };

function gitLines(cwd: string, args: string[]): string[] {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * Changed repository-relative paths: `git diff --name-only <merge-base>` (committed, staged and
 * unstaged, deletions included) plus untracked files, de-duplicated and sorted. Undefined when any
 * git call fails, including a missing BASE_REF.
 *
 * Not `origin/main...HEAD`: implementers run the gate before they commit, and three dots would miss
 * exactly the change being gated.
 */
export function changedPaths(cwd: string): readonly string[] | undefined {
  try {
    const [base] = gitLines(cwd, ["merge-base", "HEAD", BASE_REF]);
    if (base === undefined) return undefined;
    const paths = [
      ...gitLines(cwd, ["diff", "--name-only", base]),
      ...gitLines(cwd, ["ls-files", "--others", "--exclude-standard"])
    ];
    return [...new Set(paths)].sort();
  } catch {
    return undefined;
  }
}

/** Pure: what a finished `build-workload --classify` run means. */
export function interpretClassifier(run: { status: number | null; stdout: string }): WorkloadDecision {
  const said = run.stdout.trim();
  if (run.status === 0 && said === "non-rust") {
    return { workload: "non-rust", reason: "no changed path matches rust_paths" };
  }
  if (run.status === 0 && said === "rust") {
    return { workload: "rust", reason: "a changed path matches rust_paths" };
  }
  return { workload: "rust", reason: `build-workload could not classify (exit ${String(run.status)})` };
}

/**
 * Spawns build-workload once with every path as argv (no shell). Output is piped, never inherited:
 * the script writes a diagnostic line per path to stderr, which would bury the gate's first line.
 */
export function classifyPaths(paths: readonly string[], cwd: string): WorkloadDecision {
  const here = dirname(fileURLToPath(import.meta.url));
  const run = spawnSync(
    resolve(here, "..", ".claude", "cerebro", "scripts", "build-workload"),
    ["--classify", ...paths],
    { cwd, encoding: "utf8" }
  );
  if (run.error) {
    return { workload: "rust", reason: `build-workload could not start: ${run.error.message}` };
  }
  return interpretClassifier({ status: run.status, stdout: run.stdout ?? "" });
}

/**
 * Forced by env, else the diff, classified. Fails closed to "rust". A caller's "non-rust" is
 * ignored here - the gate never trusts a claim it can check.
 */
export function decideWorkload(env: NodeJS.ProcessEnv, cwd: string): WorkloadDecision {
  if (env[GATE_WORKLOAD_ENV] === "rust") {
    return { workload: "rust", reason: `forced by ${GATE_WORKLOAD_ENV}=rust` };
  }
  const paths = changedPaths(cwd);
  if (paths === undefined) {
    return { workload: "rust", reason: `could not list the changed paths against ${BASE_REF}` };
  }
  if (paths.length === 0) {
    return { workload: "rust", reason: `no changed paths against ${BASE_REF}` };
  }
  return classifyPaths(paths, cwd);
}

/** Pure: every leg in its original order, each marked skip exactly when rust-tagged and the workload is non-rust. */
export function planLegs<T extends RustTagged>(
  legs: readonly T[],
  workload: Workload
): readonly { leg: T; skip: boolean }[] {
  return legs.map((leg) => ({ leg, skip: workload === "non-rust" && leg.rust === true }));
}

/** Pure: the one line the gate prints before any leg runs. */
export function describeWorkload(decision: WorkloadDecision, skippedLegNames: readonly string[]): string {
  if (decision.workload === "rust") {
    return `workload: rust (${decision.reason}) - every leg runs.`;
  }
  return `workload: non-rust (${decision.reason}) - skipping ${skippedLegNames.join(", ")}, and the cargo suite inside test; CI's rust job runs them.`;
}
