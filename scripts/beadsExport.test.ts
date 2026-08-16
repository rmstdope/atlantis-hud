import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideExport, refreshBeadsExport, stableExport } from "./beadsExport";

/**
 * The exporter that keeps the committed bead export honest, run by the release script before the
 * version bump (ah-cgk) rather than by a pre-push hook.
 *
 * The decision is a pure function, so the cases can be stated plainly; the shell exercise below is
 * what proves the commit lands the way `refreshBeadsExport` promises, against real git.
 */
describe("stableExport", () => {
  it("strips the lease fields and leaves everything else", () => {
    const record = {
      _type: "issue",
      id: "ah-r2e",
      status: "in_progress",
      assignee: "Henrik Kurelid",
      heartbeat_at: "2026-08-13T11:14:48Z",
      lease_expires_at: "2026-08-13T11:19:48Z",
      updated_at: "2026-08-13T09:44:11Z"
    };

    const result = stableExport(`${JSON.stringify(record)}\n`);

    expect(JSON.parse(result.trimEnd())).toEqual({
      _type: "issue",
      id: "ah-r2e",
      status: "in_progress",
      assignee: "Henrik Kurelid",
      updated_at: "2026-08-13T09:44:11Z"
    });
  });

  it("leaves a line it cannot parse alone", () => {
    const broken = '{"_type":"issue","id":"ah-1"\n';

    expect(stableExport(broken)).toBe(broken);
  });

  it("handles an empty export and a file with no trailing newline", () => {
    expect(stableExport("")).toBe("");

    const noTrailingNewline = '{"_type":"issue","id":"ah-1"}';
    expect(stableExport(noTrailingNewline)).toBe(noTrailingNewline);
  });
});

describe("decideExport", () => {
  it("says nothing changed when the committed export already matches a fresh one", () => {
    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: true,
        freshExport: ONE_BEAD,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "unchanged" });
  });

  it("refreshes when the committed export is stale", () => {
    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: true,
        freshExport: TWO_BEADS,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "refresh", text: TWO_BEADS });
  });

  it("refreshes when there is no committed export at all", () => {
    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: true,
        freshExport: ONE_BEAD,
        committedExport: null
      })
    ).toEqual({ kind: "refresh", text: ONE_BEAD });
  });

  // The three ways the exporter can be asked to do a job it cannot. Each is skipped and names why,
  // rather than throwing - a release run should decide what a skip means, not catch an exception.
  it("skips when bd is not installed", () => {
    expect(
      decideExport({
        bdAvailable: false,
        beadsPresent: true,
        freshExport: null,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "skipped", reason: "no-bd" });
  });

  it("skips in a clone with no .beads directory", () => {
    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: false,
        freshExport: null,
        committedExport: null
      })
    ).toEqual({ kind: "skipped", reason: "no-beads" });
  });

  it("skips when the export itself fails", () => {
    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: true,
        freshExport: null,
        committedExport: ONE_BEAD
      })
    ).toEqual({ kind: "skipped", reason: "export-failed" });
  });

  /**
   * The regression the export gate was originally named for: a heartbeat from any other agent
   * holding a claim moves `heartbeat_at` and `lease_expires_at` every minute, and that alone must
   * not read as staleness.
   */
  it("says nothing changed when only the lease fields moved", () => {
    const before =
      '{"_type":"issue","id":"ah-1","heartbeat_at":"2026-08-13T11:13:42Z","lease_expires_at":"2026-08-13T11:18:42Z"}\n';
    const after =
      '{"_type":"issue","id":"ah-1","heartbeat_at":"2026-08-13T11:14:48Z","lease_expires_at":"2026-08-13T11:19:48Z"}\n';

    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: true,
        freshExport: after,
        committedExport: before
      })
    ).toEqual({ kind: "unchanged" });
  });

  /** Without this, "compare nothing" would also satisfy the case above. */
  it("still refreshes when a bead actually changed alongside the lease fields", () => {
    const before =
      '{"_type":"issue","id":"ah-1","status":"open","heartbeat_at":"2026-08-13T11:13:42Z","lease_expires_at":"2026-08-13T11:18:42Z"}\n';
    const after =
      '{"_type":"issue","id":"ah-1","status":"in_progress","heartbeat_at":"2026-08-13T11:14:48Z","lease_expires_at":"2026-08-13T11:19:48Z"}\n';

    // What lands in the file is the normalized text - so what the next comparison expects is what
    // was just written, and the lease fields the refresh itself strips are not part of it.
    expect(
      decideExport({
        bdAvailable: true,
        beadsPresent: true,
        freshExport: after,
        committedExport: before
      })
    ).toEqual({ kind: "refresh", text: stableExport(after) });
  });
});

/**
 * `refreshBeadsExport` against a real git repository and a stub `bd`, run directly rather than
 * through a hook - the release script calls it as an ordinary step, not as something standing in
 * front of a push.
 */
describe("refreshBeadsExport", () => {
  it("writes and commits a refresh when the committed export is stale", () => {
    const repo = setUpRepository();

    const outcome = withStubBd(repo, TWO_BEADS, () => refreshBeadsExport(repo.work));

    expect(outcome).toEqual({ kind: "refreshed", committed: true });
    expect(git(repo.work, ["status", "--porcelain"])).toBe("");
    expect(git(repo.work, ["log", "-1", "--pretty=%s"])).toBe("chore(beads): refresh the issues export");
    expect(readFileSync(join(repo.work, ".beads", "issues.jsonl"), "utf8")).toBe(TWO_BEADS);
  });

  it("commits nothing when the committed export is already fresh", () => {
    const repo = setUpRepository(TWO_BEADS);

    const outcome = withStubBd(repo, TWO_BEADS, () => refreshBeadsExport(repo.work));

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(git(repo.work, ["log", "--pretty=%s"])).toBe("seed");
  });

  /**
   * The regression itself, proved against a real repository: a heartbeat from another agent moved
   * the two lease fields, and nothing else, since the export was committed.
   */
  it("commits nothing when only a heartbeat moved", () => {
    const repo = setUpRepository(WITH_HEARTBEAT_BEFORE);

    const outcome = withStubBd(repo, WITH_HEARTBEAT_AFTER, () => refreshBeadsExport(repo.work));

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(git(repo.work, ["log", "--pretty=%s"])).toBe("seed");
  });

  it("skips without touching git when there is no .beads directory", () => {
    const outside = mkdtempSync(join(tmpdir(), "beads-export-nowhere-"));
    execFileSync("git", ["init", "--initial-branch=main", outside]);

    const outcome = refreshBeadsExport(outside);

    expect(outcome).toEqual({ kind: "skipped", reason: "no-beads" });
  });

  /**
   * A working tree holding a stale copy of a file HEAD already has right - the fresh export gets
   * written back but there is nothing new to commit.
   */
  it("writes a dirty export back without committing when it already matches HEAD", () => {
    const repo = setUpRepository(TWO_BEADS);
    writeFileSync(join(repo.work, ".beads", "issues.jsonl"), ONE_BEAD);

    const outcome = withStubBd(repo, TWO_BEADS, () => refreshBeadsExport(repo.work));

    expect(outcome).toEqual({ kind: "refreshed", committed: false });
    expect(git(repo.work, ["log", "--pretty=%s"])).toBe("seed");
    expect(git(repo.work, ["status", "--porcelain"])).toBe("");
  });

  /**
   * A git that will not commit, here because the index is locked. Reported rather than thrown, so a
   * caller decides what a stuck commit means instead of catching an exception.
   */
  it("reports committed: false when git refuses the commit", () => {
    const repo = setUpRepository();
    writeFileSync(join(repo.work, ".git", "index.lock"), "");

    const outcome = withStubBd(repo, TWO_BEADS, () => refreshBeadsExport(repo.work));

    expect(outcome).toEqual({ kind: "refreshed", committed: false });
    expect(git(repo.work, ["log", "--pretty=%s"])).toBe("seed");
  });

  /** A repository whose committed export is `committed`. */
  function setUpRepository(committed: string = ONE_BEAD): { work: string; root: string } {
    const root = mkdtempSync(join(tmpdir(), "beads-export-"));
    const work = join(root, "work");

    execFileSync("git", ["init", "--initial-branch=main", work]);
    git(work, ["config", "user.email", "export@example.com"]);
    git(work, ["config", "user.name", "Export Test"]);

    mkdirSync(join(work, ".beads"));
    writeFileSync(join(work, ".beads", "issues.jsonl"), committed);
    git(work, ["add", "."]);
    git(work, ["commit", "-m", "seed"]);

    return { work, root };
  }

  /** Runs `fn` with a stub `bd` on PATH whose export is `fresh`, then restores PATH. */
  function withStubBd<T>(repo: { work: string; root: string }, fresh: string, fn: () => T): T {
    const bin = join(repo.root, "bin");
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, "bd");
    writeFileSync(
      stub,
      ["#!/usr/bin/env sh", 'if [ "$1" = "export" ]; then', `  printf '%s' '${fresh}' > "$3"`, "fi", ""].join(
        "\n"
      )
    );
    chmodSync(stub, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    try {
      return fn();
    } finally {
      process.env.PATH = previousPath;
    }
  }

  function git(work: string, args: string[]): string {
    return execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  }
});

const ONE_BEAD = '{"_type":"issue","id":"ah-1"}\n';
const TWO_BEADS = '{"_type":"issue","id":"ah-1"}\n{"_type":"issue","id":"ah-2"}\n';

const WITH_HEARTBEAT_BEFORE =
  '{"_type":"issue","id":"ah-1","heartbeat_at":"2026-08-13T11:13:42Z","lease_expires_at":"2026-08-13T11:18:42Z"}\n';
const WITH_HEARTBEAT_AFTER =
  '{"_type":"issue","id":"ah-1","heartbeat_at":"2026-08-13T11:14:48Z","lease_expires_at":"2026-08-13T11:19:48Z"}\n';
