/**
 * Do the generated TypeScript bindings in the working tree match what the Rust types produce?
 *
 * Asked by regenerating them into a temporary directory and comparing, rather than by reading git.
 * This used to run `git status` over the generated directories, which made a correct-but-uncommitted
 * binding indistinguishable from a stale one: the leg could not go green until `git commit` had run,
 * inverting the gate-then-commit order for every bead touching a `#[ts(export)]` type. Three
 * implementers paid for that (ah-1wcw.3, ah-gdfe, ah-moq3), and the doc comment that stood here told
 * them the fix was `git add`, which never worked - `git status --porcelain` reports a staged file as
 * `M ` just as loudly as an unstaged one.
 *
 * Uncommitted bindings are now reported and never fatal, the trade `runGate.ts` makes for the disk
 * preflight: git dirtiness is a fact about the checkout, staleness is a fact about the code. The
 * committed files are still checked, on a clean checkout, by ci.yml's `rust` job - which is where
 * that question can actually be answered.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATED_DIRS = [
  "packages/core-client/src/generated",
  "packages/ruleset/src/generated"
];

/** Where `.cargo/config.toml` points `TS_RS_EXPORT_DIR`. Every `export_to` resolves against it. */
export const EXPORT_DIR = "packages/core-client/src/generated";

/** What the failure message tells the reader to run, and what `exportCommand` actually runs. */
export const REGENERATE = "cargo test -p atlantis-hud-core --lib export_bindings_";

export type Divergence = {
  readonly path: string;
  /** `differs`: both trees have it, contents differ. `missing`: only the fresh export has it.
   *  `unexpected`: only the working tree has it — a binding for a Rust type that no longer exists. */
  readonly reason: "differs" | "missing" | "unexpected";
};

/**
 * Divergences between a fresh export and the working tree, sorted by path.
 *
 * Walks the union of both key sets, so a file only one side has is named rather than skipped.
 * `unexpected` is as fatal as the others: a leftover binding for a deleted Rust type still
 * typechecks and still gets imported, which is exactly the wrong shape to leave lying about.
 */
export function compareTrees(
  fresh: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>
): Divergence[] {
  const paths = [...new Set([...fresh.keys(), ...actual.keys()])].sort();
  const divergences: Divergence[] = [];

  for (const path of paths) {
    const expected = fresh.get(path);
    const found = actual.get(path);

    if (expected === undefined) {
      divergences.push({ path, reason: "unexpected" });
    } else if (found === undefined) {
      divergences.push({ path, reason: "missing" });
    } else if (expected !== found) {
      divergences.push({ path, reason: "differs" });
    }
  }

  return divergences;
}

/**
 * Every `*.ts` directly under each of `dirs` within `root`, keyed by its repository-relative path.
 *
 * The keys are built from the `dir` string itself rather than with `join`, so two trees read from
 * different roots compare on the path and not on the platform's separator. Non-recursive and
 * `.ts`-only: both generated directories are flat and hold nothing but ts-rs output. A directory
 * that is not there contributes nothing rather than throwing, so the first run after a new
 * `export_to` directory is added reports its files as `missing` instead of crashing.
 */
export function readTree(root: string, dirs: readonly string[]): Map<string, string> {
  const tree = new Map<string, string>();

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      continue;
    }

    for (const entry of entries.filter((name) => name.endsWith(".ts")).sort()) {
      tree.set(`${dir}/${entry}`, readFileSync(join(root, dir, entry), "utf8"));
    }
  }

  return tree;
}

/**
 * The cargo invocation that writes every `#[ts(export)]` binding under `into`.
 *
 * Pure, and it returns only the *added* environment - the caller merges it over `process.env`.
 * That split is what makes the load-bearing fact testable without running cargo: the temporary
 * export directory must mirror the real one's depth, because the ruleset types' `export_to` climbs
 * three levels out of it and is resolved against `TS_RS_EXPORT_DIR` at run time.
 *
 * The caller's value wins over `.cargo/config.toml`'s only because that entry carries no
 * `force = true`; see the comment on it there, and the test below that keeps it that way.
 */
export function exportCommand(into: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: "cargo",
    args: ["test", "-p", "atlantis-hud-core", "--lib", "export_bindings_"],
    env: { TS_RS_EXPORT_DIR: join(into, EXPORT_DIR) }
  };
}

/** The stderr text for a failing comparison. Never called with an empty list. */
export function describeDivergence(divergences: readonly Divergence[]): string {
  const listed = divergences.map(({ path, reason }) => `  ${path} (${reason})`).join("\n");

  return `generated TypeScript bindings differ from the Rust types:\n${listed}\nregenerate them with:\n  ${REGENERATE}\n`;
}

/**
 * The stderr note for a passing comparison, or `""` when nothing is uncommitted.
 *
 * Never fatal: the bindings are correct, and git dirtiness is a fact about the checkout rather than
 * a verdict on the code. The committed files are CI's question, which is why the note says so.
 */
export function describeUncommitted(files: readonly string[]): string {
  if (files.length === 0) {
    return "";
  }

  const count = files.length === 1 ? "1 is" : `${files.length} are`;
  const them = files.length === 1 ? "it" : "them";
  const listed = files.map((file) => `  ${file}`).join("\n");

  return `generated bindings match the Rust types.\n\n${count} not committed yet:\n${listed}\ncommit ${them} before opening the PR - CI checks the committed files, and will fail if you do not.\n`;
}

/**
 * The generated files `git status --porcelain` names as changed, added or untracked.
 *
 * Renames (`R  old -> new`) and quoted paths with spaces are deliberately not handled: ts-rs writes
 * flat PascalCase `.ts` names and never renames one, so there is nothing here to handle.
 */
export function uncommittedFiles(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3));
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * The whole check, as an exit code rather than a `process.exit` call.
 *
 * It returns rather than exits so the caller's `finally` actually runs: `process.exit` terminates
 * the process where it stands and unwinds nothing, so a `finally` wrapped around a body that exits
 * never fires and the temporary export tree survives every failure path. Not exported - it is I/O,
 * and this repository leaves the CLI blocks of `runGate.ts` and `runSuites.ts` uncovered too.
 */
function checkGenerated(root: string, into: string): number {
  const { command, args, env } = exportCommand(into);
  // Piped rather than inherited: on success the 82 test lines are noise, and on failure they are
  // the whole diagnosis. Do not copy `stdio: "inherit"` from runGate.ts - those legs *are* the
  // output; this one is not.
  const run = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });

  // A command that could not start, or one killed by a signal, both leave `status` null - which
  // reads identically to one that ran and failed unless it is said out loud. And a Rust file that
  // does not compile is a different failure from a stale binding: reporting it as "the bindings
  // differ" would send the reader to the wrong file.
  if (run.error || run.signal || run.status !== 0) {
    const why = run.error
      ? run.error.message
      : run.signal
        ? `killed by signal ${run.signal}`
        : `exit ${String(run.status)}`;
    process.stderr.write(
      `could not regenerate the TypeScript bindings; the export run failed: ${why}\n${run.stdout ?? ""}${run.stderr ?? ""}`
    );
    return 1;
  }

  const fresh = readTree(into, GENERATED_DIRS);
  // The export "succeeded" and wrote nothing, so the wiring is broken - most likely `force = true`
  // on `.cargo/config.toml`'s TS_RS_EXPORT_DIR. Without this guard that case reports every
  // working-tree binding as `unexpected`, which is loud but points at the wrong thing.
  if (fresh.size === 0) {
    process.stderr.write(
      "the export run produced no bindings at all; TS_RS_EXPORT_DIR did not reach ts-rs.\n"
    );
    return 1;
  }

  const divergences = compareTrees(fresh, readTree(root, GENERATED_DIRS));
  if (divergences.length > 0) {
    process.stderr.write(describeDivergence(divergences));
    return 1;
  }

  // The correctness check has passed; git is advisory from here, so a git that will not run is
  // reported and never fatal.
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--", ...GENERATED_DIRS], {
      cwd: root,
      encoding: "utf8"
    });
    const note = describeUncommitted(uncommittedFiles(status));
    if (note !== "") {
      process.stderr.write(note);
    }
  } catch (error) {
    process.stderr.write(
      `could not ask git which bindings are committed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  return 0;
}

if (invokedDirectly) {
  // From this file, never through `repositoryRoot()` in scripts/cargoTargetDir.ts: that one answers
  // the *main checkout's* root from inside a worktree, on purpose (ah-gdp), which would compare the
  // main checkout's bindings against this worktree's Rust types. Every worktree has its own
  // `scripts/`, so this is always the tree being gated.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const into = mkdtempSync(join(tmpdir(), "atlantis-generated-"));
  let code: number;

  try {
    code = checkGenerated(root, into);
  } finally {
    rmSync(into, { recursive: true, force: true });
  }

  process.exit(code);
}
