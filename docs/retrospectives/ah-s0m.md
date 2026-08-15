# ah-s0m — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** rmstdope/atlantis-hud#286, rmstdope/atlantis-hud#289, rmstdope/cerebro#28

## The shared `target/` build tree crossed the disk floor mid-bead, after the initial preflight had already passed

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the bead
(8.2 GB free). By the time the third worktree's `pnpm run check:fast` ran, `scripts/diskPreflight.test.ts`
failed inside `pnpm run test:tooling` — the disk had dropped to 4.9 GB, just under the 5 GB floor.
`target/debug/deps` alone had grown to 8.3 GB (`target` total 9.6 GB) — stale `.rlib`s from many
compiles across this and other implementers' worktrees, none of them ever reclaimed. `cargo clean`
freed 15.3 GB and the check passed cleanly afterwards.

**Why.** `target/` is one directory shared by every worktree — `.claude/skills/implement-bead/SKILL.md`'s
*Workspace* section says worktrees must stay under `.claude/worktrees/`, and cargo/bd both find the
same repository root by walking up from there, so every worktree's cargo build lands in the one
`target/` at that root. Nothing prunes it as builds accumulate — `diskPreflight.ts` is only ever run
once, at a bead's start (`implement-bead`'s *Workspace* section), not before each later local build.
With several implementers building concurrently across separate worktrees, the shared tree can cross
the floor well after a bead's own preflight passed, and the first symptom is an unrelated test
(`diskPreflight.test.ts`) failing rather than anything that names the cause plainly.

**Cost.** About 10 minutes: diagnosing that the failure was infrastructure rather than a defect in
this bead's diff, then `cargo clean` and a re-run of `check:fast`.

**Prevent by.** Either re-run `diskPreflight.ts` before each worktree's local gate (not only once at
bead start), or have `prune-worktrees.sh`'s periodic sweep (or a new one) reclaim `target/` on a
schedule rather than leaving it to whichever implementer happens to hit the floor. Not fixed here —
recording only, per this bead's own scope.

**Seen before.** None found (`grep -rl "diskPreflight\|cargo clean\|below the 5 GB" docs/retrospectives/`
returned nothing else).
