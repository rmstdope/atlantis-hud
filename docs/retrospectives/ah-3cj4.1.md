# ah-3cj4.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #449

## `diskPreflight.test.ts` failed mid-bead again — the seventh sighting

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the bead
(9.9 GB free, above the 8 GB floor). By the first `pnpm run check:fast`, after cargo had built the
workspace in a fresh worktree, the disk was at 7 GB and
`scripts/diskPreflight.test.ts > says what it found, and succeeds while this disk has room` failed —
the only red in the whole gate, and nothing to do with this bead's diff.
`.claude/cerebro/scripts/prune-worktrees.sh` freed nothing: all four worktrees were live or held
unmerged work.

**Why.** Established. This bead's own first cargo build is what crossed the floor: my worktree's
`target/` reached 2.0 GB, of which 877 MB was `target/debug/incremental`. Four sibling worktrees
were each holding 1.8–2.0 GB of `target/`, so the fleet's steady-state cargo footprint is ~8 GB and
one fresh worktree's first build is enough to tip it.

**Cost.** About ten minutes: one failed gate run, a prune that reclaimed nothing, a `du` hunt, and a
second full gate run.

**Prevent by.** `rm -rf target/debug/incremental` in one's own worktree recovers ~900 MB and the gate
goes green — incremental artefacts are pure cache and a fleet worktree is discarded after one bead
anyway. `implement-bead`'s *Workspace* section tells you to run the preflight but says nothing about
what to do when it later fails; naming this one-line recovery there would turn each of these seven
sightings into thirty seconds. The structural version — not writing incremental artefacts in a
worktree at all, via `CARGO_INCREMENTAL=0` in `scripts/prepare-worktree` — is the navigator's call,
not a planned bead's.

**Seen before.** ah-vfq, ah-9lv, ah-8m0.2, ah-l2i.2, ah-l2i.3, ah-do8.2 — the last of which called
itself the sixth sighting.
