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

## `a folded panel shrinks to its title bar` was not flaky — main had been red for hours and nobody had noticed

**What happened.** `smoke (desktop-shell, 2, 2)` failed on my PR. Three prior retrospectives
(ah-l9mp, ah-l2i.3, ah-bwly.2) describe the same test failing in CI and passing locally, so I spent
both permitted re-runs on it as a flake. It failed again. `gh run list --branch main` then showed
that **main itself had been failing the same two tests since roughly #469–#471**, including
`f589c58b`, the commit my branch was cut from. My branch had inherited a red main.
**Why.** The header gains a row once the loaded report's counts render, and everything under it —
the map, and the panel column over it — drops by exactly that row, 36px. All three failing tests
read a panel's box straight after `selectHex`, before that lands on a slow runner, so the baseline
is a position nothing ever comes back to. `waitForStableHeight` already existed for precisely this
reason and these tests did not use it.
**Cost.** Roughly an hour: two wasted re-runs, one wrong fix of my own, and a question to the
navigator. The three earlier retrospectives cost their implementers a cycle each for the same
reason, and each concluded "flake, passed on re-run" — which is what a real defect looks like when
it only fires on a slow runner.
**Prevent by.** Two things. **A red main is not visible to an implementer**, and it should be: a
check of `gh run list --branch main --limit 3` before the first CI wait would have found this in
ten seconds and saved every minute above. Worth a line in `implement-bead`'s *Red CI* section —
*before treating a failure as yours or as a flake, look at whether main is green*. And **three
retrospectives naming one test as flaky is evidence it is not**; the re-run cap protects against
looping on a flake, but nothing currently escalates a symptom seen four times.
**Seen before.** ah-l9mp, ah-l2i.3, ah-bwly.2 — all three read it as a flake, as I did.

## A `<button>` inside prose is not a drop-in for the text it replaces

**What happened.** The first version of `GameDataLink` used a bare `<button>`. A button is
`inline-block` and `user-select: none` by default, so in panes made of sentences it changed the
line boxes around it and made the words unselectable — `a selection dragged out of a pane stays
inside it` failed in CI because a drag anchored on a linked name selected nothing.
**Why.** The plan specified `<button type="button">` for keyboard and screen-reader reasons, which
is right, and neither it nor I thought about what else a button's UA defaults bring with them.
**Cost.** One CI cycle. Confounded with the red-main failure above, which is what made it hard to
read.
**Prevent by.** `inline select-text align-baseline` is on `GAME_DATA_LINK_CLASS` with a comment
saying why. Any future plan calling for a button inside running text should name those three, or
say the affordance is a block.
**Seen before.** none found.
