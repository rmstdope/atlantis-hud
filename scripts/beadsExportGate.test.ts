import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideGate } from "./beadsExportGate";

/**
 * The pre-push gate that keeps the committed bead export honest.
 *
 * The decision is a pure function, so the cases can be stated plainly; the shell exercise below is
 * what proves the hook works when git itself calls it, which no unit test can.
 */
describe("decideGate", () => {
  it("lets the push through when the committed export already matches a fresh one", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: "main",
        freshExport: ONE_BEAD,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "proceed", reason: "up-to-date" });
  });

  it("refreshes when the committed export is stale", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: "main",
        freshExport: TWO_BEADS,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "refresh", text: TWO_BEADS });
  });

  it("refreshes when there is no committed export at all", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: "main",
        freshExport: ONE_BEAD,
        committedExport: null
      })
    ).toEqual({ kind: "refresh", text: ONE_BEAD });
  });

  // The three ways the gate can be asked to do a job it cannot. A convenience must never be the
  // reason a push fails, so each of these proceeds, and names why for anyone watching.
  it("lets the push through when bd is not installed", () => {
    expect(
      decideGate({
        bdAvailable: false,
        beadsPresent: true,
        branch: "main",
        freshExport: null,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "proceed", reason: "no-bd" });
  });

  it("lets the push through in a clone with no .beads directory", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: false,
        branch: "main",
        freshExport: null,
        committedExport: null
      })
    ).toEqual({ kind: "proceed", reason: "no-beads" });
  });

  it("lets the push through on a detached HEAD, where a commit would belong to nothing", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: null,
        freshExport: TWO_BEADS,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "proceed", reason: "detached-head" });
  });

  /**
   * The export is a snapshot of the whole shared database, not of the branch that carries it.
   *
   * Every agent works against one database, so two branches pushed minutes apart each hold a
   * complete backlog taken at a different instant, and whichever merges last silently reverts every
   * close, claim, label and plan recorded in between - usually without git so much as reporting a
   * conflict, because each side rewrote a different subset of the lines. The obligation is main's
   * alone; a feature branch has no business carrying the backlog at all.
   */
  it("lets the push through on a feature branch, whose export would overwrite the backlog", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: "ah-6xq.1-export-gate-main-only",
        freshExport: TWO_BEADS,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "proceed", reason: "off-main" });
  });

  /** A name main is a prefix of, so a `startsWith` where an equality belongs is caught. */
  it("lets the push through on a branch merely named after main", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: "mainline-experiment",
        freshExport: TWO_BEADS,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "proceed", reason: "off-main" });
  });

  it("lets the push through when the export itself fails", () => {
    expect(
      decideGate({
        bdAvailable: true,
        beadsPresent: true,
        branch: "main",
        freshExport: null,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "proceed", reason: "export-failed" });
  });
});

/**
 * The gate as git runs it: a throwaway repository, a bare remote, and a stub `bd` whose export is
 * deliberately one bead ahead of what was committed.
 *
 * Two things are proved here and nowhere else. That the refresh arrives as a commit rather than as a
 * dirty working tree - a hook cannot amend the push it is part of, so a commit of its own is the
 * only honest answer. And that the retry then goes through carrying it, which is what makes an
 * aborted push a nuisance rather than a wall.
 */
describe("the gate as a pre-push hook", () => {
  it("aborts the first push with the refresh committed, and passes the second", () => {
    const repo = setUpRepository();

    const first = push(repo);
    expect(first.status).not.toBe(0);
    expect(first.output).toContain("refresh the issues export");
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["log", "-1", "--pretty=%s"])).toBe("chore(beads): refresh the issues export");
    expect(git(repo, ["show", "HEAD:.beads/issues.jsonl"])).toBe(TWO_BEADS.trimEnd());

    const second = push(repo);
    expect(second.status).toBe(0);
    expect(git(repo, ["show", "origin/main:.beads/issues.jsonl"])).toBe(TWO_BEADS.trimEnd());
  });

  it("says nothing and passes first time when the committed export is already fresh", () => {
    const repo = setUpRepository(TWO_BEADS);

    const only = push(repo);
    expect(only.status).toBe(0);
    expect(only.output).not.toContain("refresh the issues export");
    expect(git(repo, ["log", "--pretty=%s"])).toBe("seed");
  });

  /**
   * The case the gate exists to avoid causing: a feature branch carrying a backlog snapshot.
   *
   * The database is one bead ahead of what this branch committed, exactly as it is whenever another
   * agent has closed or claimed something. Before, the gate would commit that snapshot here and the
   * merge would impose it on main, undoing whatever landed in between.
   */
  it("commits nothing on a feature branch, and lets the push through", () => {
    const repo = setUpRepository();
    git(repo, ["checkout", "-b", "ah-1-some-work"]);

    const only = pushBranch(repo, "ah-1-some-work");
    expect(only.status).toBe(0);
    expect(only.output).not.toContain("refresh the issues export");
    expect(git(repo, ["log", "--pretty=%s"])).toBe("seed");
    // Nothing written, not merely nothing committed: an implementation that put the fresh export in
    // the working tree before consulting the decision would leave the branch dirty here.
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    // And bd was never asked to export at all. Off main there is nothing to compare or write, and
    // the export is the slowest thing the hook does - on every push of every branch, in worktrees
    // where `.beads/` is committed but the database beneath it is not.
    expect(existsSync(join(repo, "..", "bd-was-run"))).toBe(false);
  });

  it("commits nothing on a detached HEAD, and lets the push through", () => {
    const repo = setUpRepository();
    git(repo, ["checkout", "--detach"]);

    const only = push(repo);
    expect(only.status).toBe(0);
    expect(git(repo, ["log", "--pretty=%s"])).toBe("seed");
  });

  /**
   * A working tree holding a stale copy of a file HEAD already has right.
   *
   * The comparison is against the working tree, so this looks like staleness until the fresh export
   * is written - and then there is nothing to commit. Committing anyway fails, and a hook that dies
   * on its own git error would block the push over a file it had just put back.
   */
  it("puts a dirty export back without committing, and lets the push through", () => {
    const repo = setUpRepository(TWO_BEADS);
    writeFileSync(join(repo, ".beads", "issues.jsonl"), ONE_BEAD);

    const only = push(repo);
    expect(only.status).toBe(0);
    expect(git(repo, ["log", "--pretty=%s"])).toBe("seed");
    expect(git(repo, ["status", "--porcelain"])).toBe("");
  });

  /**
   * The gate itself failing, here because it was run somewhere that is not a repository at all.
   *
   * Every case above is one the gate anticipated. This one stands for the ones it did not: an
   * unreadable export, a temp directory it cannot make, a git that will not answer. The promise is
   * about all of them, so it is kept at the entry point rather than case by case.
   */
  it("lets the push through when the gate itself fails unexpectedly", () => {
    const outside = mkdtempSync(join(tmpdir(), "beads-gate-nowhere-"));

    const run = spawnSync(TSX, [GATE], { cwd: outside, encoding: "utf8" });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("export gate could not run");
  });

  /**
   * A git that will not commit, here because the index is locked.
   *
   * Standing between the player and their remote is worse than an export that lands a push later, so
   * the refusal is reported and the push goes on.
   */
  it("lets the push through when git refuses the commit", () => {
    const repo = setUpRepository();
    writeFileSync(join(repo, ".git", "index.lock"), "");

    const only = push(repo);
    expect(only.status).toBe(0);
    expect(only.output).toContain("would not commit");
    expect(git(repo, ["log", "--pretty=%s"])).toBe("seed");
  });

  /** A repository whose committed export is what `committed` says, against a two-bead database. */
  function setUpRepository(committed: string = ONE_BEAD): string {
    const root = mkdtempSync(join(tmpdir(), "beads-gate-"));
    const work = join(root, "work");
    const remote = join(root, "remote.git");

    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "--initial-branch=main", work]);
    git(work, ["config", "user.email", "gate@example.com"]);
    git(work, ["config", "user.name", "Gate Test"]);
    git(work, ["remote", "add", "origin", remote]);

    mkdirSync(join(work, ".beads"));
    writeFileSync(join(work, ".beads", "issues.jsonl"), committed);
    git(work, ["add", "."]);
    git(work, ["commit", "-m", "seed"]);

    installStubBd(root);
    installHook(work, root);

    return work;
  }

  /** A `bd` that writes the two-bead export wherever `bd export -o <path>` points it. */
  function installStubBd(root: string): void {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const stub = join(bin, "bd");
    writeFileSync(
      stub,
      [
        "#!/usr/bin/env sh",
        // A footprint, so a test can assert the gate did not even ask for an export.
        `: > "${join(root, "bd-was-run")}"`,
        'if [ "$1" = "export" ]; then',
        `  printf '%s' '${TWO_BEADS}' > "$3"`,
        "fi",
        ""
      ].join("\n")
    );
    chmodSync(stub, 0o755);
  }

  /**
   * The one line the real `.beads/hooks/pre-push` carries below the beads markers.
   *
   * The hook lives outside the work tree, so that "nothing was left uncommitted" can be asserted
   * about the whole repository rather than about a list of the test's own leftovers.
   */
  function installHook(work: string, root: string): void {
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    const hook = join(hooks, "pre-push");
    writeFileSync(
      hook,
      [
        "#!/usr/bin/env sh",
        `PATH="${join(root, "bin")}:$PATH" exec "${TSX}" "${GATE}"`,
        ""
      ].join("\n")
    );
    chmodSync(hook, 0o755);
    git(work, ["config", "core.hooksPath", hooks]);
  }

  /**
   * A push, with everything it and the hook said.
   *
   * Both streams, and on the way out of a success as well as a failure: the gate talks on stderr, and
   * a helper that only kept stdout would leave every "it said nothing" assertion here true by
   * construction.
   */
  function push(work: string): { status: number; output: string } {
    return pushBranch(work, "main");
  }

  function pushBranch(work: string, branch: string): { status: number; output: string } {
    const run = spawnSync("git", ["push", "origin", branch], { cwd: work, encoding: "utf8" });

    return { status: run.status ?? 1, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
  }
});

const ONE_BEAD = '{"_type":"issue","id":"ah-1"}\n';
const TWO_BEADS = '{"_type":"issue","id":"ah-1"}\n{"_type":"issue","id":"ah-2"}\n';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "beadsExportGate.ts");
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");

function git(work: string, args: string[]): string {
  return execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
}
