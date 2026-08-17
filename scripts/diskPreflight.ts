/**
 * Whether there is room to build, asked before the work starts rather than during it.
 *
 * Running out of disk mid-build does not announce itself. The failure lands in the linker or the
 * code generator and reads like a fault in the code being compiled, so an agent will go and try to
 * fix code that was never wrong. This is written from experience: the disk reached 100% capacity
 * with 2.0 GiB free, while three worktrees each kept a build tree of their own.
 *
 * `.cargo/config.toml` is tracked, so every worktree builds into its own `target/` rather than a
 * shared one (see that file's own comment for why that is the deliberate choice). This is the guard
 * for what remains - each tree still grows, several exist at once, and a machine can fill up for
 * reasons that have nothing to do with this repository besides.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRoot } from "./cargoTargetDir";

/**
 * The least free space worth starting a bead with, in gigabytes.
 *
 * Set from measurement rather than from caution. Every worktree builds into its own `target/`
 * (ah-gdp: `.cargo/config.toml` is tracked, so each worktree's search for it stops at its own
 * root) - a fresh worktree's tree runs about 1.7 GB before the suites have run and 2.5-3.5 GB
 * after, and that is on top of whatever else the disk already carries. A bead that is about to
 * start needs room for that build, not for a fraction of a shared one.
 *
 * Eight, then: one fresh worktree's tree at its observed worst (~3.5 GB), the same again for the
 * build the bead will run, and a gigabyte of slack - against a floor that must still not refuse a
 * machine that is merely well used. Two gigabytes is the harder floor: builds actually started
 * dying here below that.
 */
export const FREE_SPACE_FLOOR_GB = 8;

/** Whether a disk with this many gigabytes free has room to build in. */
export function hasHeadroom(freeGb: number): boolean {
  return freeGb > FREE_SPACE_FLOOR_GB;
}

/** A `target/` directory found on disk, and how much of it there is. */
export interface BuildTree {
  path: string;
  sizeGb: number;
}

/**
 * What to say about it, in the terms someone would need to act.
 *
 * Truncated rather than rounded: 4.96 rounds to "5.0 GB free, below the 5 GB floor", which reads as
 * a contradiction at exactly the moment the message matters. A refusal must never overstate what is
 * there.
 *
 * `trees` is optional and additive: every existing call site keeps working, and the reclaimable
 * line - see `describeReclaimable` - is appended whether the verdict is a pass or a refusal. A
 * build tree is worth reclaiming either way; it does not stop being disk just because there was
 * enough of it this time.
 */
export function describeSpace(freeGb: number, trees: BuildTree[] = []): string {
  const free = Math.floor(freeGb * 10) / 10;
  const verdict = hasHeadroom(freeGb)
    ? `disk: ${free} GB free, above the ${FREE_SPACE_FLOOR_GB} GB floor.`
    : [
        `disk: ${free} GB free, below the ${FREE_SPACE_FLOOR_GB} GB floor needed to build.`,
        "A build that runs out of space fails inside the linker and reads like a code error."
      ].join("\n");

  const reclaimable = describeReclaimable(trees);

  return reclaimable === null ? verdict : `${verdict}\n${reclaimable}`;
}

/**
 * What could be reclaimed, and where the sweep that does it lives - or null when there is nothing
 * to report.
 *
 * Every worktree builds its own `target/` (ah-gdp), so what fills a nearly-full disk is usually
 * several of those trees rather than one shared one a `cargo clean` would empty. Naming the total
 * and the sweep turns a refusal into something actionable instead of just a number.
 */
export function describeReclaimable(trees: BuildTree[]): string | null {
  if (trees.length === 0) {
    return null;
  }

  // Truncated, like describeSpace's free-space figure: rounding 6.36 up to "6.4 GB" promises more
  // than is actually there, the same overstatement describeSpace's own comment already refuses to
  // make about free space.
  const totalGb = Math.floor(trees.reduce((sum, tree) => sum + tree.sizeGb, 0) * 10) / 10;
  const noun = trees.length === 1 ? "build tree" : "build trees";

  return `${totalGb} GB sits in ${trees.length} ${noun}; .claude/cerebro/scripts/prune-worktrees.sh reclaims what is safe.`;
}

/** Free gigabytes on the filesystem holding a path. */
export function freeGbAt(path: string): number {
  const { bavail, bsize } = statfsSync(path);

  return (bavail * bsize) / 1024 ** 3;
}

/**
 * Every directory that might hold a build tree of its own: the repository root, and each worktree
 * under `.cerebro/worktrees/` and `.claude/worktrees/` - the latter the pre-move location a sweep
 * must still reach (ah-gdp).
 */
function candidateDirs(repoRoot: string): string[] {
  const dirs = [repoRoot];

  for (const worktreesDir of [".cerebro/worktrees", ".claude/worktrees"]) {
    const parent = join(repoRoot, worktreesDir);
    if (!existsSync(parent)) {
      continue;
    }
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(join(parent, entry.name));
      }
    }
  }

  return dirs;
}

/** Gigabytes on disk under a directory, via `du` rather than a manual walk. */
function duGb(path: string): number {
  const output = execFileSync("du", ["-sk", path], { encoding: "utf8" });
  const kilobytes = Number.parseInt(output.split(/\s+/u)[0] ?? "0", 10);

  return kilobytes / 1024 ** 2;
}

/** Every `target/` directory found under the repository root or one of its worktrees. */
export function findBuildTrees(repoRoot: string): BuildTree[] {
  const trees: BuildTree[] = [];

  for (const dir of candidateDirs(repoRoot)) {
    const target = join(dir, "target");
    if (!existsSync(target)) {
      continue;
    }
    trees.push({ path: target, sizeGb: duGb(target) });
  }

  return trees;
}

/**
 * Run directly, this answers the question an agent actually asks: is there room to start?
 *
 * It says what it found either way and exits non-zero when there is not, so a caller can put it in
 * front of the work. Without this the file was importable but not runnable - `tsx diskPreflight.ts`
 * printed nothing and exited 0, and a silent success reads as headroom.
 */
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const cwd = process.cwd();
  const free = freeGbAt(cwd);
  // A repository is what this is ever run inside; a failure to resolve the root just means no
  // reclaimable-trees line, not a reason to fail the preflight itself.
  const trees = (() => {
    try {
      return findBuildTrees(repositoryRoot(cwd));
    } catch {
      return [];
    }
  })();
  process.stdout.write(`${describeSpace(free, trees)}\n`);
  process.exit(hasHeadroom(free) ? 0 : 1);
}
