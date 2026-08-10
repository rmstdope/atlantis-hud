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
 * Nothing irreversible happens before every check has passed. The commit, the tag and the two
 * pushes are the last four things it does, in that order, and `--dry-run` stops short of all of
 * them while still doing the reading and the arithmetic.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repoFile("."), encoding: "utf8" }).trim();

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

if (dryRun) {
  console.log("release: --dry-run, so nothing was written, committed, tagged or pushed.");
  process.exit(0);
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
git("push", "origin", `HEAD:${branch}`);
console.log(`release: pushed the version commit to ${branch}`);

// Last, and separately. The workflow triggers on the tag and checks it out, so the commit it names
// has to be on the remote before the tag that points at it arrives.
git("tag", tag);
git("push", "origin", tag);
console.log(`release: pushed ${tag}. The Release workflow builds it from here.`);
