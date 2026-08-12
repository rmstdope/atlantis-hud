/**
 * Keeps the committed bead export honest, at the one moment it matters.
 *
 * `.beads/issues.jsonl` is generated from the bead database and committed so the backlog is diffable
 * in the repo. Refreshing it used to be owed on every commit: bd's own auto-export wrote it from the
 * pre-commit hook, and the beads-workflow skill asked for an explicit `bd export` at the end of a
 * session. That is both more often than anyone needs it and less reliable than it sounds - the
 * auto-export is throttled to once a minute and has committed a snapshot holding a bead that had
 * already been deleted.
 *
 * So the obligation moved here, to the push. Once per branch, and nothing stale can leave the
 * machine. A pre-push hook cannot amend or extend the commits being pushed - git has already worked
 * out the refs - so a stale export is committed on its own and the push is aborted with a message
 * saying to push again. Nothing is ever rewritten and no `--force` is ever needed.
 *
 * The gate is a convenience, and a convenience must never be the reason a push fails. No `bd`, no
 * `.beads`, a detached HEAD, an export that fails, or a git that refuses the commit: each of them
 * lets the push through instead of standing in front of it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the export lives, relative to the repository root. */
const EXPORT_PATH = join(".beads", "issues.jsonl");

const REFRESH_MESSAGE = "chore(beads): refresh the issues export";

export type GateInput = {
  bdAvailable: boolean;
  beadsPresent: boolean;
  /** Whether HEAD is on a branch. A commit made on a detached HEAD belongs to nothing. */
  onBranch: boolean;
  /** A fresh export of the database, or nothing when one could not be taken. */
  freshExport: string | null;
  /** What the repository currently has, or nothing when the file does not exist. */
  committedExport: string | null;
};

export type GateDecision =
  | {
      kind: "proceed";
      reason: "no-bd" | "no-beads" | "detached-head" | "export-failed" | "up-to-date";
    }
  | { kind: "refresh"; text: string };

/**
 * What to do about the export, given what could be found out about it.
 *
 * Kept apart from the doing so the cases can be read at a glance, and so the three that cannot
 * work are as plainly stated as the two that can.
 */
export function decideGate(input: GateInput): GateDecision {
  if (!input.bdAvailable) {
    return { kind: "proceed", reason: "no-bd" };
  }
  if (!input.beadsPresent) {
    return { kind: "proceed", reason: "no-beads" };
  }
  // A detached HEAD is nobody's branch, so a commit made on it would be reachable from nothing the
  // moment the player checks something else out. Leave the export to the branch that owns it.
  if (!input.onBranch) {
    return { kind: "proceed", reason: "detached-head" };
  }
  if (input.freshExport === null) {
    return { kind: "proceed", reason: "export-failed" };
  }
  if (input.freshExport === input.committedExport) {
    return { kind: "proceed", reason: "up-to-date" };
  }

  return { kind: "refresh", text: input.freshExport };
}

/** Everything the decision needs, gathered from the repository the hook is running in. */
function inspect(root: string): GateInput {
  const beadsPresent = existsSync(join(root, ".beads"));
  const onBranch = currentBranch(root) !== null;
  const committed = join(root, EXPORT_PATH);
  const committedExport = existsSync(committed) ? readFileSync(committed, "utf8") : null;
  const nothingToDo = { bdAvailable: true, beadsPresent, onBranch, committedExport };

  // Nothing to export from, so bd is not worth starting. Every other case is the decision's to make,
  // including the detached HEAD - one place decides, or a test can pass against the wrong guard.
  if (!beadsPresent) {
    return { ...nothingToDo, freshExport: null };
  }

  const scratchDirectory = mkdtempSync(join(tmpdir(), "beads-export-"));
  const scratch = join(scratchDirectory, "issues.jsonl");
  try {
    const run = spawnSync("bd", ["export", "-o", scratch], { cwd: root, encoding: "utf8" });

    // An absent bd is the ordinary case in a clone that does not track beads, not an error.
    if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...nothingToDo, bdAvailable: false, freshExport: null };
    }

    const wrote = run.status === 0 && existsSync(scratch);

    return { ...nothingToDo, freshExport: wrote ? readFileSync(scratch, "utf8") : null };
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}

/** The branch HEAD is on, or nothing when HEAD is detached. */
function currentBranch(root: string): string | null {
  const name = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim();

  return name === "HEAD" ? null : name;
}

/**
 * The gate as the hook runs it. Returns the exit code: nonzero aborts the push.
 *
 * The commit names the one file it carries, so a working tree with other changes staged in it comes
 * out of a push with those changes still staged and unmentioned.
 */
export function runGate(root: string): number {
  const decision = decideGate(inspect(root));

  if (decision.kind === "proceed") {
    return 0;
  }

  writeFileSync(join(root, EXPORT_PATH), decision.text);

  // The comparison was against the working tree, which can hold a stale copy of a file HEAD already
  // has right. Writing the fresh export has just put that back, and there is nothing to commit.
  const differsFromHead = spawnSync("git", ["diff", "--quiet", "HEAD", "--", EXPORT_PATH], {
    cwd: root
  }).status;
  if (differsFromHead === 0) {
    return 0;
  }

  // git has its own reasons to refuse - a locked index, a rebase in progress, an unresolved merge -
  // and none of them are worth blocking a push over. The export is left fresh in the working tree,
  // and the next push takes it.
  try {
    execFileSync("git", ["add", "--", EXPORT_PATH], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "--no-verify", "-m", REFRESH_MESSAGE, "--", EXPORT_PATH], {
      cwd: root,
      stdio: "pipe"
    });
  } catch {
    process.stderr.write(
      `beads: ${EXPORT_PATH} was out of date and has been rewritten, but git would not commit it.\n`
    );
    return 0;
  }

  process.stderr.write(
    [
      `beads: ${EXPORT_PATH} was out of date and has been committed as "${REFRESH_MESSAGE}".`,
      "beads: nothing was pushed - run the push again to send it along.",
      ""
    ].join("\n")
  );

  return 1;
}

/** The repository the hook was called in, which is where git runs its hooks. */
function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exit(runGate(repositoryRoot()));
}
