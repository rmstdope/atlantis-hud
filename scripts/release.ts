/**
 * Cuts a release: bumps the version, commits it, and pushes the tag that starts `release.yml`.
 *
 *     pnpm run release maintenance
 *     pnpm run release minor
 *     pnpm run release major
 *
 * Two files carry the version and both have to move together. `package.json` is the source — it is
 * what `APP_VERSION` is substituted from — and `tauri.conf.json` is the copy Tauri stamps into the
 * bundle. They are asserted equal on every pull request by `packages/shared/src/appVersion.test.ts`
 * and again on the tag by the release workflow, which means a bump that touches only one of them
 * fails eight minutes into a compile rather than here. This script is the reason that never
 * happens: it reads both, refuses to continue if they already disagree, and writes both.
 *
 * Nothing is written before every check has passed - the state checks on the tree, and then the
 * same local quality gate CI runs: lint, typecheck, the unit tests, and the Rust suite. A release
 * that would fail those checks eight minutes into the workflow fails here instead, with the
 * manifests untouched. The bead export is refreshed next (ah-cgk), then the commit, the tag and the
 * two pushes - the last four things it does, in that order. `--dry-run` stops short of all of them
 * while still doing the reading, the arithmetic and the checks - a dry run is a rehearsal, and the
 * checks are most of the show.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { refreshBeadsExport } from "./beadsExport";
import { describeGitFailure, finishRelease } from "./releaseSupport";

const BUMPS = ["major", "minor", "maintenance"] as const;
type Bump = (typeof BUMPS)[number];

/** The branch a release is cut from. `--allow-any-branch` is the escape hatch. */
const RELEASE_BRANCH = "main";

const repoFile = (relative: string): string =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url));

/** The two files that carry the version, in the order they are reported when they disagree. */
const MANIFESTS = ["package.json", "apps/desktop/src-tauri/tauri.conf.json"] as const;

const fail = (message: string): never => {
  console.error(`release: ${message}`);
  process.exit(1);
};

/**
 * git, with a failure that says what happened.
 *
 * `execFileSync` throws an error whose message is "Command failed" and whose streams are buffers
 * nobody reads - which is how the export gate's "run the push again" explanation was lost, and why
 * a stranded release looked like an unexplained crash.
 */
const git = (...args: string[]): string => {
  try {
    return execFileSync("git", args, { cwd: repoFile("."), encoding: "utf8" }).trim();
  } catch (error) {
    return fail(describeGitFailure(args, error));
  }
};

/**
 * git, without dying on a failure - what `finishRelease` needs, since `git` above exits the process
 * on the first refusal and `finishRelease` has to be able to report a failed push with recovery
 * advice instead.
 */
const tryGit = (...args: string[]): { ok: boolean; output: string } => {
  try {
    execFileSync("git", args, { cwd: repoFile("."), encoding: "utf8" });
    return { ok: true, output: "" };
  } catch (error) {
    return { ok: false, output: describeGitFailure(args, error) };
  }
};

// --- Arguments ---------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const allowAnyBranch = argv.includes("--allow-any-branch");
const positional = argv.filter((argument) => !argument.startsWith("--"));

if (positional.length !== 1 || !BUMPS.includes(positional[0] as Bump)) {
  fail(
    `usage: pnpm run release <${BUMPS.join("|")}> [--dry-run] [--allow-any-branch]`,
  );
}
const bump = positional[0] as Bump;

// --- The versions the release is cut from ------------------------------------------------------

/**
 * The version is edited in place rather than through `JSON.parse` and `JSON.stringify`, because a
 * round trip through those reformats the whole file — `tauri.conf.json` keeps `"targets"` on one
 * line and its icon list on several, and a release commit should show one changed line, not thirty.
 *
 * Reading is still done with `JSON.parse`, so a malformed file is caught before anything is
 * written, and the write asserts that the version it is replacing occurs exactly once.
 */
const readVersion = (relative: string): string => {
  const parsed: unknown = JSON.parse(readFileSync(repoFile(relative), "utf8"));
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string") {
    return fail(`${relative} has no "version" string.`);
  }
  return version;
};

const versions = MANIFESTS.map(readVersion);
const [rootVersion] = versions;

if (new Set(versions).size !== 1) {
  fail(
    `the manifests disagree about the current version, so there is nothing to bump from:\n` +
      MANIFESTS.map((file, index) => `  ${file}: ${versions[index]}`).join("\n"),
  );
}

const parts =
  /^(\d+)\.(\d+)\.(\d+)$/.exec(rootVersion) ??
  fail(`the current version ${rootVersion} is not major.minor.patch, so it cannot be bumped.`);
const [major, minor, patch] = parts.slice(1).map(Number);

const nextVersion = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  maintenance: `${major}.${minor}.${patch + 1}`,
}[bump];
const tag = `v${nextVersion}`;

// --- The state the release is cut in -----------------------------------------------------------

// A release commit that sweeps up unrelated edits is the failure this prevents; the two manifests
// are staged by path below, but a dirty tree means the tag points at a working copy nobody reviewed.
if (git("status", "--porcelain") !== "") {
  fail("the working tree has uncommitted changes. Commit or stash them first.");
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== RELEASE_BRANCH && !allowAnyBranch) {
  fail(
    `on ${branch}, not ${RELEASE_BRANCH}. A tag cut from a branch that never merges points at ` +
      `a commit nobody else has. Pass --allow-any-branch if that is what you mean.`,
  );
}

// Locally and on the remote both: a tag that exists on the remote cannot be pushed again, and
// finding that out after the release commit has already gone out leaves the two out of step.
if (git("tag", "--list", tag) !== "") {
  fail(`the tag ${tag} already exists locally.`);
}
if (git("ls-remote", "--tags", "origin", tag) !== "") {
  fail(`the tag ${tag} already exists on origin.`);
}

console.log(`release: ${rootVersion} -> ${nextVersion} (${bump}) on ${branch}`);

// --- The local quality gate --------------------------------------------------------------------

/**
 * The same gate CI's `checks` and `rust` jobs run, in the same order, cheap to dear. The browser
 * suites (smoke, pwa, native) are deliberately not here: they need built bundles and free ports,
 * and they run against the release commit in CI either way - this gate exists to catch what would
 * otherwise fail the workflow minutes after the tag is already out.
 */
const CHECKS: ReadonlyArray<{ label: string; command: string; args: string[] }> = [
  { label: "lint", command: "pnpm", args: ["run", "lint"] },
  { label: "typecheck", command: "pnpm", args: ["run", "typecheck"] },
  { label: "unit tests", command: "pnpm", args: ["-r", "run", "test"] },
  { label: "rustfmt", command: "cargo", args: ["fmt", "--check"] },
  {
    label: "clippy",
    command: "cargo",
    args: ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]
  },
  { label: "rust tests", command: "cargo", args: ["test", "--workspace"] }
];

for (const check of CHECKS) {
  console.log(`release: ${check.label}...`);
  try {
    execFileSync(check.command, check.args, { cwd: repoFile("."), stdio: "inherit" });
  } catch {
    fail(`${check.label} failed, so the version was not touched. Fix it and release again.`);
  }
}
console.log("release: every local check passed.");

if (dryRun) {
  console.log("release: --dry-run, so nothing was written, committed, tagged or pushed.");
  process.exit(0);
}

// --- Refreshing the bead export ------------------------------------------------------------------

/**
 * The bead export, refreshed here on purpose, while nothing is at stake (ah-cgk).
 *
 * A release runs straight after bead work, so the export is stale on essentially every release.
 * Refreshing and pushing it before the bump keeps the release commit and its tag adjacent to each
 * other rather than to a `chore(beads)` commit made afterwards - and it means the release's own push
 * below meets nothing unexpected, since nothing else pushes main between here and there.
 */
const exported = ((): ReturnType<typeof refreshBeadsExport> => {
  try {
    return refreshBeadsExport(repoFile("."));
  } catch (error) {
    return fail(
      `the bead export could not be refreshed: ${error instanceof Error ? error.message : String(error)}\n` +
        "Nothing was written. Settle .beads/issues.jsonl and release again."
    );
  }
})();
if (exported.kind === "refreshed") {
  if (!exported.committed) {
    fail(
      "the bead export changed but could not be committed - a locked index or a rebase in progress.\n" +
        "Nothing else was written. Resolve that and release again."
    );
  }
  console.log("release: refreshed the bead export; pushing it before the bump.");
  const pushed = tryGit("push", "origin", `HEAD:${branch}`);
  if (!pushed.ok) {
    fail(pushed.output);
  }
} else if (exported.kind === "skipped") {
  console.log(`release: bead export skipped: ${exported.reason}.`);
}

// --- The bump ----------------------------------------------------------------------------------

for (const relative of MANIFESTS) {
  const path = repoFile(relative);
  const before = readFileSync(path, "utf8");
  const needle = `"version": "${rootVersion}"`;

  if (before.split(needle).length !== 2) {
    fail(`${relative} does not contain exactly one ${needle}, so it cannot be edited in place.`);
  }

  writeFileSync(path, before.replace(needle, `"version": "${nextVersion}"`));
  console.log(`release: wrote ${relative}`);
}

git("add", ...MANIFESTS);
git("commit", "-m", `Release ${tag}`);

// The SHA is pinned before either push runs, inside `finishRelease`: `git tag <name>` with no second
// argument tags HEAD, and HEAD is not guaranteed to still be the release commit by the time the tag
// is made.
const finished = finishRelease(
  {
    headCommit: () => git("rev-parse", "HEAD"),
    pushBranch: () => tryGit("push", "origin", `HEAD:${branch}`),
    pushTag: () => tryGit("push", "origin", tag),
    createTag: (name, commit) => tryGit("tag", name, commit)
  },
  { tag, branch }
);

if (!finished.ok) {
  fail(`${finished.output}\n\nFinish it by hand:\n${finished.advice.map((line) => `  ${line}`).join("\n")}`);
}
console.log(`release: pushed the version commit and ${tag}. The Release workflow builds it from here.`);
