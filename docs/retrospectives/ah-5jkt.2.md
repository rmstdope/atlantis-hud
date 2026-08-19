# ah-5jkt.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-20
- **PR:** #474

## I destroyed an existing test file because the plan said it was new

**What happened.** The plan's test table listed `packages/shared/src/workspace/primitives.test.tsx`
as `(new)`. It was not: it already held fifteen tests for `SeverityMark`, `ProblemWho` and
`ProblemMessage`. I wrote my new tests with `cat > …` and lost all of them. `git diff --stat`
showed `192 ++-----` on that file, which is the only reason I noticed; the suite still passed,
because what I had written was green and what I had deleted was simply gone.
**Why.** The plan is careful about which files exist — it marks `UnitPanel.test.tsx (new)` and
`RegionPanel.test.tsx` correctly — so I took `(new)` as checked rather than checking it. A
truncating redirect then made the mistake unrecoverable except through git.
**Cost.** Small, about five minutes, only because the stat line happened to catch my eye. Had the
deleted tests been in a file I touched less visibly, the loss would have merged.
**Prevent by.** Never create a file named by a plan with `cat > <path>`. `implement-bead`'s
*Building* section should say so directly: `test -e <path>` first, or use `cat >>` and let an
existing file grow. A plan's `(new)` marks intent, not fact — the filesystem is the fact.
**Seen before.** none found.

## The disk floor blocked the bead before it started, and nothing inside the repository could clear it

**What happened.** `scripts/diskPreflight.ts` reported 5.8 GB against an 8 GB floor.
`prune-worktrees.sh` reclaimed nothing at all: every one of the four trees holding the 5.7 GB
belonged to a live agent — two implementers in `ci`, and Psylocke mid-verification. The space came
from outside the repository entirely (`~/Library/Caches/Mozilla.sccache`, 3.4 GB), which is not a
call an implementer can take alone, so it cost a question to the navigator.
**Why.** The floor is per-machine and the fleet is not: three or four concurrent agents each hold a
~2 GB `target/`, and that is the steady state rather than the exception. Pruning is defined to
reclaim only what is safe, and with a busy fleet the safe set is empty.
**Cost.** About ten minutes, one `asking` round-trip with the navigator.
**Prevent by.** The existing retrospectives all end at "something reclaimed space this time". What
none of them can do is share one `target/` between worktrees. `CARGO_TARGET_DIR` pointing at a
single directory under the main checkout would make the fleet's Rust build cost one 2 GB tree
rather than one per agent — worth the navigator's consideration as a change to
`scripts/prepare-worktree`, since the floor is now tripped most times the fleet is full.
**Seen before.** ah-87he, ah-9r0, ah-9lv, ah-l2i.1, ah-58n.1, ah-8m0.2, ah-vfq, ah-kdgc, ah-1znc,
ah-vkut — ten files, and this is the eleventh.

## `a folded panel shrinks to its title bar` failed in CI and passed locally, for the fourth time

**What happened.** `smoke (desktop-shell, 2, 2)` failed on `strip.y` vs `open.y` at
`workspace.spec.ts:1448`. Locally the same test passed three times out of three with
`--repeat-each=3`, on the desktop-shell project. One `gh run rerun --failed` was green.
**Why.** Not established, and three prior implementers did not establish it either. It is a
sub-pixel geometry assertion at `precision: 0` that only ever fails on the desktop-shell project in
CI.
**Cost.** One CI cycle, about eight minutes, plus the local reproduction the flake cap requires.
**Prevent by.** Four sightings is enough to stop treating it as noise: the assertion wants either a
tolerance that admits a pixel of rounding, or a wait on the fold transition settling. That is a
change to a test outside this bead, so it is the navigator's to schedule — but it is now costing
roughly one CI cycle per bead that touches these panes.
**Seen before.** ah-l9mp, ah-l2i.3, ah-bwly.2.
