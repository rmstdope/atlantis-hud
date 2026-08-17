# ah-l2i.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #382

## The disk floor was crossed mid-bead again, and this time nothing in the repository could reclaim the space

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the bead
(8.1 GB free, reported against a 5 GB floor in the main checkout). The first `pnpm run check:fast`
in the worktree then failed on `scripts/diskPreflight.test.ts` inside `test:tooling`: 7.1 GB free,
below the **8 GB** floor the worktree's copy of the script enforces. `.claude/cerebro/scripts/prune-worktrees.sh`
freed nothing — it correctly kept all five worktrees (two with uncommitted work, one touched inside
30 minutes, one Psylocke's, one mine). Deleting `~/Library/Caches/Homebrew` (1.9 GB) took it to
9.1 GB and the gate passed.

**Why.** The shape of this has changed since the earlier sightings and the earlier remedy no longer
applies. `target/` is now **per worktree**, not shared: `ah-do8.1/target` 2.7 GB,
`ah-l2i.1/target` 2.4 GB, `psylocke/target` 2.6 GB, 7.6 GB in three trees. So the old fix —
`cargo clean` on one shared tree — reclaims only one implementer's own 2.5 GB, and only by throwing
away the build it is about to need. With three concurrent build trees each near 2.5 GB and a floor
raised to 8 GB, the fleet's steady state sits close to the floor with no in-repository lever to
lower it. The only space I could free was outside the repository entirely.

**Cost.** About 10 minutes, no CI cycles.

**Prevent by.** This is now a fleet-capacity question rather than a per-bead hygiene one, and it is
the navigator's to settle: either a shared cargo target (`CARGO_TARGET_DIR` at the repository root,
which is what the earlier retrospectives describe and which the per-worktree layout has undone), or
`sccache` reuse plus a cap on concurrent implementers, or simply more disk. `prune-worktrees.sh`
behaved correctly and cannot help here — every tree it kept was genuinely in use.

**Seen before.** ah-s0m, ah-9r0, ah-9lv, ah-8m0.2 — four prior files describe the same symptom
(`diskPreflight.test.ts` failing mid-bead after the opening preflight passed). This is the fifth,
and the first where no in-repository action could recover the space.
