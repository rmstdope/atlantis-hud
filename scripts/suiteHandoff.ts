/**
 * The seam between `runSuites.ts` and `runGate.ts`.
 *
 * A red `test` leg used to say only `test FAIL`, leaving which of the three suites broke on the
 * suite runner's own line thousands of lines up the combined output - so the first move after a red
 * gate was to re-run `pnpm run test` by hand to find out (ah-oac2, about fifteen minutes).
 *
 * The gate cannot simply read that line: `runLeg` spawns with `stdio: "inherit"` so the leg's
 * output goes straight to the terminal and is never captured, and capturing it to parse would
 * either swallow a suite's live output or need teeing back. So the verdict travels through a file
 * whose path the gate names in the child's environment.
 *
 * The path is per-run rather than fixed inside the repository: several worktrees on this machine
 * run the gate at once, and a shared path would have one gate reporting another's verdict.
 *
 * Nothing here may fail loudly. A broken handoff is a missing sentence, never a red run.
 */

import { readFileSync, writeFileSync } from "node:fs";

import type { LegResult } from "./summarizeLegs";

/** The environment variable the gate uses to ask `runSuites.ts` for a machine-readable verdict. */
export const SUITE_RESULTS_ENV = "ATLANTIS_SUITE_RESULTS_FILE";

/** The path the gate asked for, or undefined when nobody asked - an empty value is nobody. */
export function handoffPathFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[SUITE_RESULTS_ENV];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** The verdict as it goes on disk: name and pass only, one JSON array. */
export function encodeSuiteResults(results: readonly LegResult[]): string {
  return JSON.stringify(results.map((result) => ({ name: result.name, passed: result.passed })));
}

/** The verdict back, or undefined for anything that is not exactly that shape. Never throws. */
export function decodeSuiteResults(text: string): readonly LegResult[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!Array.isArray(value)) return undefined;

  const results: LegResult[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const { name, passed } = entry as { name?: unknown; passed?: unknown };
    if (typeof name !== "string" || typeof passed !== "boolean") return undefined;
    results.push({ name, passed });
  }

  return results;
}

/**
 * "suites: packages PASS tooling FAIL cargo PASS", single-spaced.
 *
 * Single spaces against the two the gate's own top-level line uses: this nests inside one set of
 * parentheses, where tight reads better and keeps the line shorter.
 */
export function describeSuiteResults(results: readonly LegResult[]): string {
  if (results.length === 0) return "suites: none ran";

  return `suites: ${results
    .map((result) => `${result.name} ${result.passed ? "PASS" : "FAIL"}`)
    .join(" ")}`;
}

/** Writes the verdict, and reports to stderr rather than throwing if it cannot. */
export function writeSuiteResults(path: string, results: readonly LegResult[]): void {
  try {
    writeFileSync(path, encodeSuiteResults(results), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`runSuites: could not write the suite results to ${path}: ${message}\n`);
  }
}

/**
 * What the gate puts in parentheses. Always a string; never throws.
 *
 * "suites: not reported" is information rather than a shrug: it says the suite runner never reached
 * a verdict at all - an ENOENT on `tsx`, a crash before `summarize`, a kill signal - which is a
 * different thing from one of the suites having failed.
 */
export function readSuiteDetail(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "suites: not reported";
  }

  const results = decodeSuiteResults(text);
  return results === undefined ? "suites: not reported" : describeSuiteResults(results);
}
