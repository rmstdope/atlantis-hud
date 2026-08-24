# ah-3ddq — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #644

## A submodule pointer bump rode along in a Rust-only bead's commits

**What happened.** This bead touches one file, `crates/core/src/orders/semantics.rs`. Running
`git diff --stat origin/main` before opening the PR showed two entries: that file, and
`.claude/cerebro | 2 +-`. The worktree's `.claude/cerebro` checkout was at `5d2cdae`, main's tracked
pointer at `6019b4d`, and every `git add -A` I made during the increments staged the difference. Had
I not read the `--stat`, the PR would have carried an unrelated, unreviewed submodule bump into main
under a `refactor(ah-3ddq)` subject.

**Why.** `.claude/cerebro` is a submodule whose checkout in the shared clone had moved ahead of the
pointer main records — the two are updated by different acts (a `chore: bump cerebro` commit on main
versus a `git submodule update` in any session), so they drift. `prepare-worktree` initialises the
submodule in the new tree from the parent clone's state, so the new tree starts with the drift
already in it, and `git add -A` — which the TDD loop uses on every commit — picks it up silently.

**Cost.** About ten minutes: noticing the entry, confirming the direction of the drift, and two
attempts at reverting it (`git checkout origin/main -- .claude/cerebro` appeared not to take, because
the submodule's *working tree* stays at the newer commit while the index is corrected — so the
next `git diff origin/main` still shows it and reads like a failed revert; `git diff origin/main HEAD`
is the comparison that answers the actual question).

**Prevent by.** `implement-bead`'s *Building* section should say to check `git diff origin/main HEAD --stat`
against the plan's *Files to change* before opening the PR, and to name the submodule pointer as the
thing most likely to appear there uninvited. A stronger fix, which is the navigator's to make and not
mine: have `prepare-worktree` check the submodule out at the pointer `origin/main` records rather than
at whatever the parent clone happens to hold, so a bead cannot pick up a bump it did not mean.

**Seen before.** None found for an unintended pointer bump. Nine retrospectives name submodule
trouble in a fresh worktree (`ah-x7gr`, `ah-4ao`, `ah-u3i`, `ah-qled.9`, `ah-rnz`, among others) and
`ah-60w` names a stale pin serving old skill text, but all of those are about a submodule that is
missing or behind, never one whose extra commits ride into a PR.
