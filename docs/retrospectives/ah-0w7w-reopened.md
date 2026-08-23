# ah-0w7w (reopened) — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #574

*Filed under a suffixed name because `docs/retrospectives/ah-0w7w.md` already holds the original
run's retrospective, and the format says a retrospective is never rewritten. A bead can now be
reopened by verification and built twice, so the one-file-per-bead naming has no room for the second
run. Worth a rule; not mine to make.*

## File edits landed in the shared main checkout instead of my worktree

**What happened.** Two test files were written with relative paths (`cat >> packages/...`,
`cat >> tests/...`) in a shell I believed was in my worktree. `pwd` printed the worktree, but
`git -C <main> status` showed both files modified in the **main checkout** — the one the navigator
and every other session share. Recovered with `git diff > patch`, `git checkout --`, and
`git apply` inside the worktree; a first recovery attempt re-applied the patch to main again,
because the recovery command itself was chained after a `cd` whose effect I had assumed rather than
checked.

**Why.** Not fully established. The shell's reported `pwd` and the directory a tool call actually
ran in disagreed at least once. The cause does not matter much to the prevention: a relative path is
only as safe as an assumption about cwd, and this repository's whole worktree discipline exists
because the main checkout is shared.

**Cost.** About ten minutes, two recovery rounds, and a window in which another session pulling or
committing in the main checkout would have picked up my half-written tests.

**Prevent by.** `implement-bead`'s *Workspace* section says to check `pwd` before any **git**
command. That is too narrow — the damage here was done by `cat`, not by git. It should say: address
files by absolute path, or `git -C <worktree>`, for **every** write, and verify with
`git -C <main repo> status --short` (expected: empty) at least once before the first commit. That
one command would have caught it immediately rather than four commands later.

**Seen before.** `ah-qled.5.2.md` and `ah-1znc.md` record the sibling of this — commands run from a
worktree reaching the wrong root (`bd` finding no database). Same class: a command whose target
depends on cwd, in a repository where cwd is not what it looks like.

## A debugging assertion was left inside an unrelated test, and no gate could see it

**What happened.** While diagnosing, I inserted a temporary assertion before
`page.getByTestId("settings-close").click()` with a scripted edit that replaced the **first**
occurrence — which was in `test("the settings dialog closes from its close button")`, a test with
nothing to do with this bead. `pnpm run check:fast` passed, twice, because the browser suites are
not in the fast gate. It was found by the independent REFACTOR-phase reviewer, not by any check I
ran.

**Why.** A first-occurrence text replacement in a 400-line file with several similar walks, plus a
fast gate that by design does not run the suite the edit was in.

**Cost.** None, in the end — the reviewer caught it before the PR opened. It would have cost a full
red CI cycle and a confusing failure in an unrelated test.

**Prevent by.** After any scripted edit to a spec file, `git diff -- <that file>` and read it; and
when a change touches a browser spec at all, run that whole spec file locally before committing
(`pnpm exec playwright test --project=web <file>`), not only the `-g` filtered walk being worked on.
The filtered run is what hid this: it never executed the test that was damaged.

**Seen before.** None found.

## The navigator verified the feature by a route the plan never named

**What happened.** The plan's *Validation* asked for a movement planned east from the last column
into unexplored country. The navigator instead scrolled the map east and found it did not wrap —
which the feature never claimed to do, and which turned out to be a medium unbuilt feature
(`MapCanvas` has never been given a `MapShape`). That was the headline of the failed verification
and roughly half the reopened bead's apparent scope; it is now `ah-brgo`.

**Why.** The bead's title is *"A movement into unexplored country is drawn wrong at the map's wrap
seam"*, but the setting a player sees is called **"Wraps east to west"**. A control with that name
sets an expectation about the map, and the plan's validation steps were the only place that
expectation was narrowed — in a document the person verifying does not read.

**Cost.** A failed verification, a reopened P0, this second run, and a new bead. The two real
regressions in it were small; the disagreement about scope was most of it.

**Prevent by.** When a plan adds a user-visible control whose name promises more than the increment
delivers, say so **where the player sees it** — a line in the settings fieldset, or a narrower
label — and name the limitation in the bead's acceptance criteria, not only in validation steps.
`plan-bead`'s user-facing-decisions section is where that belongs.

**Seen before.** None found.
