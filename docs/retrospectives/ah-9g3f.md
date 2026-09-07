# ah-9g3f — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-07
- **PR:** #1043

## The plan's own regression assertion contradicted the layout the plan chose

**What happened.** The plan's increment 3 asked the smoke test to prove the last `Knows` row lies
inside the mage pane's bounding box at a 620px viewport. It fails on the *fixed* code: the plan's
own chosen variant (C2) gives the pane `overflow-y-auto`, so with sixteen skills the content
legitimately overshoots the pane's box by 5.5px — `Expected: <= 558, Received: 563.5`. Raising the
viewport until it fitted (660px) made the test pass against the *unfixed* view too, so it proved
nothing either way. I replaced the assertion with two that mean something (`Knows`'s `scrollHeight`
equals its `clientHeight`; the pane itself is what scrolls), but the first replacement I reached for
— `scrollIntoViewIfNeeded` then the box comparison — could not fail at all, and the review caught it.

**Why.** The plan wrote its validation before its layout decision was final, and nobody re-read the
assertion against C2. The plan also anticipated the wrong failure: it said "if this passes at 720,
shrink the viewport", which assumes only the *old* code's fit is in question, never the new code's.

**Cost.** About 50 minutes — five smoke runs at 620/660/620, plus a review round.

**Prevent by.** `plan-bead`'s *Validation* section: an assertion that depends on the layout the plan
chooses should name which of the chosen variant's properties makes it true. Here, "the last row is
inside the pane's box" is only true under a variant where the pane does *not* scroll, and C2 was
chosen precisely because it does.

**Seen before.** `ah-lyg6.3`, `ah-77j1.4`, `ah-ty3s.3` — all three record a test or branch that
could not fail. This is the fourth.

## Reverting to prove a test red must use the branch point, not `origin/main`

**What happened.** To re-prove the new smoke test red after committing the fix, I ran
`git checkout -- <the view files>` — which restores the *committed* (fixed) version, so the test
passed and I briefly believed the regression check was worthless. `git checkout origin/main -- …`
then failed to build: another bead had merged meanwhile and `origin/main`'s `StudySchedule.tsx`
imports a symbol my branch point does not have (`vite build` → "Build failed in 400ms", with the
real cause four lines up in a rollup stack). `git checkout HEAD~1 -- …` is what actually works.

**Why.** With several implementers merging, `origin/main` is not this branch's base and its files do
not necessarily compile against this worktree.

**Cost.** Three wasted smoke runs, about 15 minutes.

**Prevent by.** When re-proving a test red after the fix is committed, revert with
`git checkout <branch point> -- <files>` — `HEAD~1` for a single-commit branch, or
`git merge-base HEAD origin/main` — never `git checkout --` (which is a no-op) and never
`origin/main` (which may have moved).

**Seen before.** None found — `grep -rln "git checkout --" docs/retrospectives/` matches five files,
none about reverting to re-prove a test.
