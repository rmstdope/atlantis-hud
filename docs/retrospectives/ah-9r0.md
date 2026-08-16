# ah-9r0 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** #324

## The disk-preflight floor was tripped mid-bead by a cache the documented reclaim doesn't cover

**What happened.** `pnpm run check:fast` failed in `scripts/diskPreflight.test.ts` with the disk at
3.2 GB free, under the 5 GB floor — not at the start of the run (the initial `diskPreflight.ts` call
during *Workspace* setup had reported 7.8 GB free), but partway through, after three implementer
worktrees' builds (this one plus two others running concurrently) had each grown their own
`target/` directory. `target/debug/incremental` across the three worktrees only accounted for
~2.2 GB; the far larger reclaim was `~/Library/Caches/Mozilla.sccache` at 8.4 GB — a machine-wide
Rust compiler cache outside any single worktree, not named by the existing trap note ("the safe
large reclaim is `target/debug/incremental`").
**Why.** Several implementers building Rust crates concurrently on one machine each grow `target/`
and all share one `sccache` cache; nothing sweeps either, and the disk is a shared, finite resource
across the whole fleet, not per-worktree.
**Cost.** About 10 minutes: diagnosing free space, confirming what was reclaimable, and clearing it
before `check:fast` could pass.
**Prevent by.** Clearing `~/Library/Caches/Mozilla.sccache` is safe (compiler cache, rebuilds
automatically on a miss) and, on this run, freed roughly 4x what `target/debug/incremental` did.
Worth adding to the `implement-bead` skill's disk-space guidance alongside the existing
`target/debug/incremental` note, since with several implementers running Rust builds at once it is
often the bigger and safer reclaim.
**Seen before.** None found in `docs/retrospectives/`.
