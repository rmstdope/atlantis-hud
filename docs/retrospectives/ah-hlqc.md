# ah-hlqc — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #645

## The plan's live defect did not exist on main

**What happened.** The plan named a concrete user-visible defect — `parse_unit("* Scout (100),
Wanderers :( (29), 10 humans [HUMN].", …)` losing the unit's men, because the field walk derails on
the faction's stray bracket — and specified an integration test in `unit.rs` whose `men == 10`
assertion "is the line that fails on `main`". It does not fail. I stashed the whole branch and ran
the assertion on a clean tree: green. The faction is reached through the already-hardened
`split_leading_id`, never through `next_top_level_field`.
**Why.** The plan reasoned from the call graph (`unit.rs:150`'s loop walks text still containing the
faction) without running the case. The two unit-level red bars it predicted for
`next_top_level_field` and `split_top_level` were real; only the end-to-end claim was not.
**Cost.** About 20 minutes: a mutation check that stayed green, a stash-and-probe against main, a
rewritten PR section and an in-file comment relabelling the test as characterisation.
**Prevent by.** A plan that asserts a *live* defect should carry the exact command and its actual
output on main, run at planning time — `plan-bead`'s increments section already asks for the failing
test, and the same rule should apply to the end-to-end claim that motivates the bead. Where the
planner has not run it, the implementer's first action on such a claim is to probe main before
building around it.
**Seen before.** None found.

## Forty-five minutes waiting for the disk floor with three implementers running

**What happened.** `disk-preflight` refused to start the bead at 5.1 GB free against its 8 GB floor.
Every reclaim it names — `~/.cargo/registry/src`, `target/debug/incremental`, the sccache — plus
`~/.cache/uv`, `~/.cache/gh` and the main checkout's `target/debug/incremental` together bought
2.8 GB and still left me at 7.6 GB, because two peer implementers were actively growing their build
trees faster than I could reclaim. I waited ~45 minutes; the floor cleared only when Storm's ah-3ddq
worktree merged and was pruned.
**Why.** 7 GB of the disk sits in per-worktree `target/` directories (2.8 GB for one worktree), and
the fleet runs three implementers against a machine with ~13 GB of headroom. Three concurrent
worktrees plus the main checkout cannot all hold a full `target/`.
**Cost.** ~45 minutes of a claimed bead, spent blocking before any code was written.
**Prevent by.** Either a shared `CARGO_TARGET_DIR` per fleet (one build cache instead of one per
worktree, which is what the 2.8 GB figure is), or a fleet-size cap derived from free disk in the
launcher's preflight so the third implementer is never started into a wait it cannot resolve. This
is the navigator's call; recording only.
**Seen before.** `docs/retrospectives/ah-y3j1.md`, `ah-udff.md`, `ah-9r0.md`, `ah-tdsi.md`,
`ah-cxxa.md` — the same floor, five previous sightings.
