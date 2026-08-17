# ah-do8.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #384

## The disk floor was tripped mid-bead and the documented reclaim could free nothing

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the run (11.3 GB
free). By the time `pnpm run check:fast` ran, `scripts/diskPreflight.test.ts` failed — the preflight
itself reported "7.9 GB free, below the 8 GB floor needed to build", so the gate went red for a
reason unrelated to the diff. The remedy the message names,
`.claude/cerebro/scripts/prune-worktrees.sh`, reclaimed **nothing**: all four worktrees were live
(two holding unmerged work, one touched in the last 30 minutes, one Psylocke's), and their four
`target/` trees held 8.6 GB between them. The next `check:fast`, a minute later, passed on its own as
a sibling's build freed space.

**Why.** Four concurrent worktrees each carry a 1.7–2.6 GB cargo `target/`, and the floor is 8 GB.
With the fleet at four, the machine sits within one build of the floor at all times, and the pruner
is by design forbidden from touching any tree that could lose work — which, when every implementer is
busy, is every tree.

**Cost.** One failed gate run and about five minutes. No CI cycle: the failure was local.

**Prevent by.** The pruner is not the lever here — it correctly declines. What would help is either a
shared cargo target directory across worktrees (`CARGO_TARGET_DIR`, one tree instead of four) or a
floor that scales with the number of running implementers rather than being a flat 8 GB. Both are
navigator decisions about the fleet, not something a bead can change.

**Seen before.** ah-9lv, ah-8m0.2, ah-9r0, ah-mi7, ah-s0m — five prior files describe the same floor
being crossed mid-bead. This is the first to record that the documented reclaim had nothing it was
allowed to take.
