# ah-9lv — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-16
- **PR:** #288

## The shared `target/` build tree crossed the disk floor mid-bead, again

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the bead
(8.1 GB free). After building the WASM package once and running `cargo test --workspace`,
`pnpm run test:tooling`'s `diskPreflight.test.ts` failed — the disk had dropped to 3.8 GB, under the
5 GB floor. `target/release` (1.4 GB) had not been touched since 2026-08-09 - no local build in this
repository produces a release binary as part of the normal `check`/`check:fast` flow, so it was
purely accumulated dead weight rather than anything a running build needed. Removing only
`target/release` (not a full `cargo clean`) brought the disk back to 5.2-5.7 GB, enough to clear the
floor, without forcing every other concurrently-building worktree to recompile `target/debug` from
scratch.

**Why.** Same root cause `ah-s0m`'s retrospective already names: `target/` is shared by every
worktree and nothing prunes it as builds accumulate. This is the second sighting in as many days.

**Cost.** About 15 minutes: diagnosing the failure as infrastructure, confirming `target/release` was
stale rather than in use, and removing it.

**Prevent by.** `ah-s0m`'s retrospective already proposes re-running the preflight before each local
gate, or a periodic reclaim sweep; this sighting adds one more option worth weighing when that is
built - reclaim `target/release` first; it is never touched by `check`/`check:fast` and needs no
`cargo clean` (which forces a full `target/debug` rebuild for every worktree mid-build) to free real
space. Not fixed here - recording only, per this bead's own scope.

**Seen before.** `ah-s0m` - same shared directory, same floor, one day earlier.
