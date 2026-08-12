/**
 * Whether there is room to build, asked before the work starts rather than during it.
 *
 * Running out of disk mid-build does not announce itself. The failure lands in the linker or the
 * code generator and reads like a fault in the code being compiled, so an agent will go and try to
 * fix code that was never wrong. This is written from experience: the disk reached 100% capacity
 * with 2.0 GiB free, while three worktrees each kept a build tree of their own.
 *
 * The remedy for the cause is `.cargo/config.toml`, which gives every worktree one shared build
 * directory. This is the guard for what remains - the tree still grows, and a machine can fill up
 * for reasons that have nothing to do with this repository.
 */

import { statfsSync } from "node:fs";

/**
 * The least free space worth starting a bead with, in gigabytes.
 *
 * Set from measurement rather than from caution. Once every worktree shares one build tree, a whole
 * extra worktree costs about 34 MB - its own crates, keyed by path - because the dependencies, which
 * are the bulk of the ten gigabytes, are built once and reused. A full
 * `cargo clippy --workspace --all-targets` is the biggest thing the gate runs, and it needs room to
 * move rather than room for a second copy of everything.
 *
 * Five, then: comfortably above the two gigabytes at which builds actually started dying here, and
 * low enough that it does not refuse a machine that is merely well used. A floor of twenty, which is
 * what the per-worktree arithmetic suggested, would have blocked every agent on this disk the day it
 * was written.
 */
export const FREE_SPACE_FLOOR_GB = 5;

/** Whether a disk with this many gigabytes free has room to build in. */
export function hasHeadroom(freeGb: number): boolean {
  return freeGb > FREE_SPACE_FLOOR_GB;
}

/** What to say about it, in the terms someone would need to act. */
export function describeSpace(freeGb: number): string {
  const free = Number(freeGb.toFixed(1));

  return hasHeadroom(freeGb)
    ? `disk: ${free} GB free, above the ${FREE_SPACE_FLOOR_GB} GB floor.`
    : [
        `disk: ${free} GB free, below the ${FREE_SPACE_FLOOR_GB} GB floor needed to build.`,
        "A build that runs out of space fails inside the linker and reads like a code error.",
        "The build tree is target/ at the repository root, shared by every worktree:",
        "`cargo clean` empties it, and `rm -rf target/debug/incremental` is the cheap reclaim."
      ].join("\n");
}

/** Free gigabytes on the filesystem holding a path. */
export function freeGbAt(path: string): number {
  const { bavail, bsize } = statfsSync(path);

  return (bavail * bsize) / 1024 ** 3;
}
