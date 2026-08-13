/**
 * The docs-only fast path for CI.
 *
 * GitHub only accepts a required check that *reports* - skipped counts, a workflow that never
 * triggered at all (via `paths-ignore`) leaves its checks Pending forever and blocks the merge.
 * So `.github/workflows/ci.yml` must keep triggering on every pull request, and it is the jobs
 * inside it that are conditional on a `changes` job's output. These helpers read the workflow as
 * text and check that invariant holds, rather than parsing it as YAML - the file is uniformly
 * two-space indented and job ids sit at exactly two spaces, which is enough to anchor on.
 */

/** The job ids every required status check maps to, per the `main` ruleset. */
export const REQUIRED_JOBS = ["wasm", "checks", "rust", "smoke", "pwa", "desktop-shell", "native"];

/** The gate job whose output every required job above must be conditioned on. */
export const GATE_JOB = "changes";

/**
 * The twin of `smoke` that reports its four matrix check names when the real job is skipped.
 * A job skipped by a job-level `if:` never expands its matrix, so without this the four
 * `smoke (<project>, <shardIndex>, <shardTotal>)` required contexts would stay Pending forever
 * on a docs-only PR - confirmed on a throwaway trial PR before this was added.
 */
export const SMOKE_SKIP_JOB = "smoke-skip";

/**
 * Every top-level job block in the workflow, keyed by job id.
 *
 * Job ids sit at exactly two-space indent (`  wasm:`); everything belonging to a job - its steps,
 * its `with:`, its `strategy:` - is indented further. A line back at two spaces starts the next job.
 */
export function jobBlocks(yaml: string): Map<string, string> {
  const lines = yaml.split("\n");
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  const scanned = jobsStart === -1 ? [] : lines.slice(jobsStart + 1);

  const blocks = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of scanned) {
    const match = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/u);
    if (match) {
      current = match[1];
      blocks.set(current, []);
      continue;
    }
    if (current) {
      blocks.get(current)!.push(line);
    }
  }

  return new Map([...blocks].map(([id, body]) => [id, body.join("\n")]));
}

/**
 * Whether a job block is conditioned on the docs gate's `code` output, at the job level (4-space
 * indent, alongside `runs-on:` and `needs:`) rather than nested inside a single step - a job-level
 * `if:` skips the whole job; a step-level one would silently skip only that step.
 */
export function isGatedOnChanges(jobBlock: string): boolean {
  return /^ {4}if:\s*needs\.changes\.outputs\.code\s*==\s*'true'\s*$/mu.test(jobBlock);
}

/** Whether a job block declares the gate job as a dependency, which `needs.changes.*` requires. */
export function dependsOnChanges(jobBlock: string): boolean {
  const needsLine = jobBlock.match(/^ {4}needs:.*$/mu);
  return needsLine !== null && /\bchanges\b/u.test(needsLine[0]);
}

/** The `strategy.matrix` body of a job block, so two jobs' matrices can be compared for equality. */
export function matrixOf(jobBlock: string): string | null {
  const lines = jobBlock.split("\n");
  const start = lines.findIndex((line) => /^ {4}matrix:\s*$/u.test(line));
  if (start === -1) {
    return null;
  }

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*$/u.test(lines[i]) || /^ {8,}/u.test(lines[i])) {
      body.push(lines[i]);
      continue;
    }
    break;
  }

  return body.join("\n").trim();
}

/** The text of the `on:` trigger block, so it can be checked for a path filter. */
export function onTriggerBlock(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^on:\s*$/u.test(line));
  if (start === -1) {
    return "";
  }

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/u.test(lines[i])) {
      break;
    }
    body.push(lines[i]);
  }

  return body.join("\n");
}
