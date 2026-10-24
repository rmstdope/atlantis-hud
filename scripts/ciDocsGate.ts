/**
 * The prose-only fast path for CI.
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

/** The one job scoped on a second gate output, beyond the shared `code` one. */
export const NATIVE_JOB = "native";

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
 * Whether a job block is conditioned on the gate's `code` output, at the job level (4-space
 * indent, alongside `runs-on:` and `needs:`) rather than nested inside a single step - a job-level
 * `if:` skips the whole job; a step-level one would silently skip only that step.
 */
export function isGatedOnChanges(jobBlock: string): boolean {
  return /^ {4}if:\s*needs\.changes\.outputs\.code\s*==\s*'true'\s*$/mu.test(jobBlock);
}

/**
 * Whether a job block is conditioned on both the gate's `code` output and its `native` one - the
 * shape only `NATIVE_JOB` uses, since the native (Linux Tauri) job also needs the diff to be
 * native-shaped, not merely non-prose.
 */
export function isGatedOnCodeAndNative(jobBlock: string): boolean {
  return /^ {4}if:\s*needs\.changes\.outputs\.code\s*==\s*'true'\s*&&\s*needs\.changes\.outputs\.native\s*==\s*'true'\s*$/mu.test(
    jobBlock
  );
}

/** Whether a job block declares the gate job as a dependency, which `needs.changes.*` requires. */
export function dependsOnChanges(jobBlock: string): boolean {
  const needsLine = jobBlock.match(/^ {4}needs:.*$/mu);
  return needsLine !== null && /\bchanges\b/u.test(needsLine[0]);
}

/**
 * Every step block within a job's `steps:` list, keyed by its `name:`.
 *
 * Steps sit at six-space indent (`      - name: Checkout`); everything belonging to a step is
 * indented further, and a line back at six spaces starting with `- name:` starts the next one.
 */
export function stepBlocks(jobBlock: string): Map<string, string> {
  const lines = jobBlock.split("\n");
  const blocks = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of lines) {
    const match = line.match(/^ {6}- name:\s*(.+)\s*$/u);
    if (match) {
      current = match[1].trim();
      blocks.set(current, [line]);
      continue;
    }
    if (current) {
      blocks.get(current)!.push(line);
    }
  }

  return new Map([...blocks].map(([id, body]) => [id, body.join("\n")]));
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

/**
 * The shell condition the gate decides on - everything between `if ` and `; then` - which answers
 * "does this diff touch anything besides the prose trees?".
 *
 * Returned as shell text so a test can run the real thing rather than restating the matching in
 * JavaScript, where it would pin its own translation instead of what CI executes. The whole
 * condition rather than a single pattern, because the decision is not one match: POSIX ERE has no
 * negative lookahead, so exempting `.github/` while keeping `.github/workflows/` covered takes a
 * second `grep` ahead of the first.
 *
 * Pass whatever comes back through `isSafeGateCondition` before executing it.
 */
export function gateCondition(yaml: string): string {
  return gateConditions(yaml)[0] ?? "";
}

/**
 * The `native` twin of {@link gateCondition}: the second `if [ -z "$FILES" ] ...; then` block in
 * the gate step, which answers "does this diff touch anything native-shaped?" (the Rust core, its
 * Tauri wrappers, the desktop shell, the native suite, or a manifest/lockfile/workflow that changes
 * what the native job installs or runs).
 */
export function nativeGateCondition(yaml: string): string {
  return gateConditions(yaml)[1] ?? "";
}

/**
 * Every `if [ -z "$FILES" ] ...; then` block in the gate step, in source order - `code` first,
 * `native` second. Returned as shell text so a test can run the real thing rather than restating
 * the matching in JavaScript; see {@link isSafeGateCondition} before executing any of them.
 */
function gateConditions(yaml: string): string[] {
  // Joined across the shell's `\` line continuations first, so each condition reads as one line
  // however it is wrapped in the YAML. The whitespace on both sides of the continuation collapses
  // to the single space that separates the operands, or the join leaves a double space where the
  // wrap was and the shape check below rejects its own workflow.
  const joined = yaml.replace(/[^\S\n]*\\\n\s*/gu, " ");
  const matches = [...joined.matchAll(/^\s*if (\[ -z "\$FILES" \].*?); then\s*$/gmu)];
  return matches.map((match) => match[1].trim());
}

/**
 * The only shape a gate condition is allowed to have: the empty-list test, then one or more
 * `grep`s over the file list, joined by `||`. Flags are letters; the pattern is single-quoted, so
 * it can hold no expansion and no substitution.
 */
const SAFE_CONDITION =
  /^\[ -z "\$FILES" \](?: \|\| echo "\$FILES" \| grep -[a-zA-Z]+ '[^']*')+$/u;

/**
 * Whether a condition is one a test may execute.
 *
 * A test that runs the gate's own shell is the only way to assert what CI will decide rather than a
 * JavaScript restatement of it - but it does mean `ci.yml` chooses what `pnpm test:tooling` runs on
 * a developer's machine. That is a small surface, since CI executes the same file on every push and
 * a hostile `ci.yml` would have far worse available to it there. It is not nothing, though, and it
 * costs one regex to close: a condition outside the shape above is refused rather than run, so a
 * `$(...)`, a backtick, a `;` or a redirection reaching this file fails the suite instead of
 * executing. Raised by review on PR #172.
 */
export function isSafeGateCondition(condition: string): boolean {
  return SAFE_CONDITION.test(condition);
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

/**
 * The smoke contexts the main branch ruleset requires (ruleset `main`, required status checks).
 * The ruleset names every shard, so this list, the `smoke` job's matrix in `ci.yml` and the
 * ruleset change together or a required check never reports and every merge blocks; the tooling
 * suite pins the first two, and the ruleset is edited on GitHub in the same change (ah-5qndx).
 */
export const SMOKE_CONTEXTS: readonly string[] = [
  "smoke (web, 1, 4)",
  "smoke (web, 2, 4)",
  "smoke (web, 3, 4)",
  "smoke (web, 4, 4)",
  "smoke (desktop-shell, 1, 1)"
];

/**
 * The check contexts the `smoke` job's matrix reports, one per `include:` entry written as
 * `- { project: <p>, shardIndex: <i>, shardTotal: <t> }`, in the order they appear.
 *
 * Throws on any other line in the `matrix:` block (comments and blank lines aside) - a block-form
 * entry or a cross-product key beside `include:` changes what GitHub runs, and skipping it would
 * hide a context from the comparison with SMOKE_CONTEXTS.
 */
export function smokeMatrixContexts(jobBlock: string): string[] {
  const lines = jobBlock.split("\n");
  const start = lines.findIndex((line) => /^ {6}matrix:\s*$/u.test(line));
  if (start === -1) {
    return [];
  }

  const entry = /^ {10}- \{\s*project:\s*([a-z-]+),\s*shardIndex:\s*(\d+),\s*shardTotal:\s*(\d+)\s*\}\s*$/u;
  const contexts: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/u.test(line)) {
      continue;
    }
    if (!/^ {8}/u.test(line)) {
      break;
    }
    const match = line.match(entry);
    if (match !== null) {
      contexts.push(`smoke (${match[1]}, ${match[2]}, ${match[3]})`);
    } else if (!/^ {8}include:\s*$/u.test(line)) {
      throw new Error(`smoke matrix line not in the one-entry-per-line flow form: ${line.trim()}`);
    }
  }
  return contexts;
}

/**
 * Throws unless, for every project, the contexts carry one shardTotal and the indexes 1..shardTotal
 * exactly once - a gap is a slice of the suite no runner walks, a duplicate one walked twice.
 */
export function assertShardsCover(contexts: readonly string[]): void {
  const byProject = new Map<string, { totals: Set<number>; indexes: number[] }>();
  for (const context of contexts) {
    const match = context.match(/^smoke \(([a-z-]+), (\d+), (\d+)\)$/u);
    if (match === null) {
      throw new Error(`not a smoke context: ${context}`);
    }
    const [, project, index, total] = match;
    const shards = byProject.get(project) ?? { totals: new Set<number>(), indexes: [] };
    shards.totals.add(Number(total));
    shards.indexes.push(Number(index));
    byProject.set(project, shards);
  }

  for (const [project, { totals, indexes }] of byProject) {
    const [total] = [...totals];
    const expected = Array.from({ length: total }, (_, i) => i + 1);
    const actual = [...indexes].sort((a, b) => a - b);
    if (totals.size !== 1 || actual.join(",") !== expected.join(",")) {
      throw new Error(`${project}: shards ${actual.join(",")} of ${[...totals].join("/")} do not cover 1..${total} once`);
    }
  }
}
