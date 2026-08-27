/**
 * Keeps `.github/workflows/ci.yml`'s generated-TypeScript-bindings check honest about
 * `GENERATED_DIRS` in `scripts/checkGenerated.ts`. `cargo test` rewrites both directories via
 * ts-rs, but the `rust` job has no Node and so cannot import that list — it restates it in shell
 * instead. This module reads the workflow as text, the same way `scripts/ciDocsGate.ts` reads it,
 * so the restatement can be checked against the real list rather than trusted to stay in step.
 */

import { jobBlocks, stepBlocks } from "./ciDocsGate";

/** The CI job that runs `cargo test`, and so the only job in which the bindings can be stale. */
export const RUST_JOB = "rust";

/** The step's `name:`, which is how it is found. Changing it in ci.yml means changing it here. */
export const BINDINGS_STEP = "Generated TypeScript bindings are committed";

/** The step's body, or `null` when the job or the step is not there under those names. */
export function bindingsStep(yaml: string): string | null {
  const job = jobBlocks(yaml).get(RUST_JOB);
  if (job === undefined) {
    return null;
  }
  return stepBlocks(job).get(BINDINGS_STEP) ?? null;
}

/** The directories the step's `GENERATED="..."` assignment names, in source order. */
export function declaredDirs(step: string): string[] {
  const match = step.match(/^\s*GENERATED="([^"]*)"\s*$/mu);
  return match === null ? [] : match[1].split(/\s+/u).filter((dir) => dir.length > 0);
}

/** The pathspec text handed to each `git status --porcelain --` in the step, in source order. */
export function statusPathspecs(step: string): string[] {
  return [...step.matchAll(/git status --porcelain --\s+([^)\n]*)/gu)].map((m) => m[1].trim());
}
