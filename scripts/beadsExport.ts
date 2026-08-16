/**
 * Keeps the committed bead export honest, at the one moment it matters: a release.
 *
 * `.beads/issues.jsonl` is generated from the bead database and committed so the backlog is diffable
 * in the repo. Refreshing it used to be owed on every commit: bd's own auto-export wrote it from the
 * pre-commit hook, and the beads-workflow skill asked for an explicit `bd export` at the end of a
 * session. That is both more often than anyone needs it and less reliable than it sounds - the
 * auto-export is throttled to once a minute and has committed a snapshot holding a bead that had
 * already been deleted.
 *
 * The obligation then moved to a pre-push hook, narrowed to main - but a hook cannot amend or extend
 * the commits being pushed, so a stale export had to be committed on its own and the push aborted
 * with a message asking to push again. Five fixes on that seam in three days (ah-cgk) settled it
 * differently: only two things ever push main from a machine - the release script and the
 * navigator's own hand-pushes - so the export is refreshed here, by the release script, as an
 * ordinary commit before the version bump. No hook, no abort, no retry.
 *
 * Why main alone: the export is a snapshot of the whole database, which every agent on this machine
 * shares, rather than of the branch that happens to carry it. Two feature branches pushed minutes
 * apart each held a complete backlog from a different instant, so whichever merged last reverted
 * every close, claim, label and plan recorded in between - and because each side had rewritten a
 * different subset of the one-line-per-bead file, git usually did not even call it a conflict.
 * `refreshBeadsExport` itself does not check the branch - the release script has already refused to
 * run off main, and the `pnpm run beads:export` CLI below refuses on its own.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the export lives, relative to the repository root. */
const EXPORT_PATH = join(".beads", "issues.jsonl");

const REFRESH_MESSAGE = "chore(beads): refresh the issues export";

/** The one branch that carries the export - see the reasoning above. Checked only by the CLI. */
const MAIN_BRANCH = "main";

/**
 * Fields that describe who holds a claim this minute, not what the backlog is.
 *
 * A claim's lease is renewed by a heartbeat roughly once a minute, so with any other agent holding a
 * bead the export churns purely from liveness data - which made every push to main during someone
 * else's claim meet a refresh. `bd export` is explicitly not a backup (`bd backup` is), and claim
 * state travels between agents by `bd dolt push` rather than through this file, so nothing reads
 * these fields from the committed export.
 */
const VOLATILE_FIELDS = ["heartbeat_at", "lease_expires_at"] as const;

/**
 * The export with the volatile lease fields removed from every record, so two exports that differ
 * only in who is holding a claim this minute compare equal.
 *
 * Must never throw - a line that will not parse is passed through untouched rather than dropped, so
 * a corrupt export is never silently rewritten into a shorter one.
 */
export function stableExport(text: string): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.length === 0 ? [] : text.split("\n").filter((_, index, all) => {
    // Drop the empty segment `split` produces after a trailing newline; every other line, including
    // a genuinely empty one in the middle of the file, is kept.
    return !(hadTrailingNewline && index === all.length - 1);
  });

  const normalized = lines.map((line) => {
    if (line === "") {
      return line;
    }
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      for (const field of VOLATILE_FIELDS) {
        delete record[field];
      }
      return JSON.stringify(record);
    } catch {
      return line;
    }
  });

  if (normalized.length === 0) {
    return "";
  }

  return normalized.join("\n") + (hadTrailingNewline ? "\n" : "");
}

export type ExportInput = {
  bdAvailable: boolean;
  beadsPresent: boolean;
  /** A fresh export of the database, or nothing when one could not be taken. */
  freshExport: string | null;
  /** What the repository currently has, or nothing when the file does not exist. */
  committedExport: string | null;
};

export type ExportDecision =
  | { kind: "unchanged" }
  | { kind: "refresh"; text: string }
  | { kind: "skipped"; reason: "no-bd" | "no-beads" | "export-failed" };

/**
 * What to do about the export, given what could be found out about it.
 *
 * Kept apart from the doing so the cases can be read at a glance.
 */
export function decideExport(input: ExportInput): ExportDecision {
  if (!input.bdAvailable) {
    return { kind: "skipped", reason: "no-bd" };
  }
  if (!input.beadsPresent) {
    return { kind: "skipped", reason: "no-beads" };
  }
  if (input.freshExport === null) {
    return { kind: "skipped", reason: "export-failed" };
  }
  // Normalized on both sides, not only the fresh one: bd's own serialization and Node's
  // `JSON.stringify` need not agree byte for byte, and normalizing only one side would compare
  // Node's spelling against bd's and differ permanently from the very first run.
  const stableFresh = stableExport(input.freshExport);
  const stableCommitted = stableExport(input.committedExport ?? "");
  if (stableFresh === stableCommitted) {
    return { kind: "unchanged" };
  }

  return { kind: "refresh", text: stableFresh };
}

/** Everything the decision needs, gathered from the repository this is run in. */
function inspect(root: string): ExportInput {
  const beadsPresent = existsSync(join(root, ".beads"));
  const committed = join(root, EXPORT_PATH);
  const committedExport = existsSync(committed) ? readFileSync(committed, "utf8") : null;
  const nothingToDo = { bdAvailable: true, beadsPresent, committedExport };

  // Nothing to export from, so bd is not worth starting.
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

export type ExportOutcome =
  | { kind: "unchanged" }
  | { kind: "refreshed"; committed: boolean }
  | { kind: "skipped"; reason: "no-bd" | "no-beads" | "export-failed" };

/**
 * Refreshes `.beads/issues.jsonl` from the database and commits it as
 * "chore(beads): refresh the issues export" when it changed.
 *
 * Run by the release script before the version bump (ah-cgk); never from a hook. The caller decides
 * which branch this runs on - `release.ts` has already refused a non-main branch by the time this is
 * called.
 */
export function refreshBeadsExport(root: string): ExportOutcome {
  const decision = decideExport(inspect(root));

  if (decision.kind !== "refresh") {
    return decision;
  }

  writeFileSync(join(root, EXPORT_PATH), decision.text);

  // The comparison was against the working tree, which can hold a stale copy of a file HEAD already
  // has right. Writing the fresh export has just put that back, and there is nothing to commit.
  const differsFromHead = spawnSync("git", ["diff", "--quiet", "HEAD", "--", EXPORT_PATH], {
    cwd: root
  }).status;
  if (differsFromHead === 0) {
    return { kind: "refreshed", committed: false };
  }

  // git has its own reasons to refuse - a locked index, a rebase in progress, an unresolved merge -
  // and none of them are worth this throwing over. The export is left fresh in the working tree, and
  // the caller decides what an uncommitted refresh means.
  try {
    execFileSync("git", ["add", "--", EXPORT_PATH], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "--no-verify", "-m", REFRESH_MESSAGE, "--", EXPORT_PATH], {
      cwd: root,
      stdio: "pipe"
    });
  } catch {
    return { kind: "refreshed", committed: false };
  }

  return { kind: "refreshed", committed: true };
}

/** The branch HEAD is on, or nothing when HEAD is detached. */
function currentBranch(root: string): string | null {
  const name = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim();

  return name === "HEAD" ? null : name;
}

/** The repository this was called in, which is where the CLI runs from. */
function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function describeOutcome(outcome: ExportOutcome): string {
  switch (outcome.kind) {
    case "unchanged":
      return "beads: the export is already up to date.";
    case "refreshed":
      return outcome.committed
        ? `beads: refreshed and committed as "${REFRESH_MESSAGE}".`
        : "beads: the export was rewritten but not committed - nothing had changed since HEAD.";
    case "skipped":
      return `beads: export skipped (${outcome.reason}).`;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // `pnpm run beads:export` - the navigator's own hand run, for anyone who wants a fresh export
  // without cutting a release. Off main this is refused up front: the library itself does not check
  // the branch, since the release script has already settled that question by the time it calls in.
  try {
    const root = repositoryRoot();
    const branch = currentBranch(root);
    if (branch !== MAIN_BRANCH) {
      process.stderr.write(
        `beads: refusing to export on ${branch ?? "a detached HEAD"} - only ${MAIN_BRANCH} carries the export.\n`
      );
      process.exit(1);
    }

    console.log(describeOutcome(refreshBeadsExport(root)));
  } catch (error) {
    process.stderr.write(`beads: the export could not run: ${describe(error)}\n`);
    process.exit(1);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
