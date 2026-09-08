# ah-3xt1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-08
- **PR:** rmstdope/cerebro#340 (and this pointer bump)

## A regression test for a failure path passed against the defect it was written for

**What happened.** The review's first round found that a failed `bd show` on a parent was
`|| true`-ed and read as "there is no parent" — the chain skipped, the push still run, exit 0. I
fixed the script and added `a-failed-parent-show-stops-the-run` for it. That case set the test
stub's `exit.show`, which the stub applies to *every* `show` call, so the **bead's own** show failed
first and the new first-show guard exited before the parent walk was ever reached: the case passed
by the wrong code path. The next review round proved it by reverting only the parent guard back to
`|| true` and watching the suite stay 19/19 green. The fix was a per-call `exit.show.N` in the stub,
plus an assertion that `argv.show` names the parent at all.

**Why.** The stub already numbered its `stdout.show.N` per call — that extension was in the plan,
because the parent walk calls `show` repeatedly — but its `exit.<sub>` stayed whole-run. A test that
selects *which call* fails needs the same per-call granularity as one that selects what each call
returns, and only half of the stub had it.

**Cost.** One extra review round and one extra CI cycle, about ten minutes. Cheap only because the
reviewer ran the mutation check rather than reading the diff.

**Prevent by.** Mutation-check every test written for a failure path before pushing it: revert the
one guard it targets, confirm the case goes red, restore. `implement-bead`'s *The review loop* says
a fix answering a finding is exactly where the next defect goes; this is the cheap check that
catches the specific case where the fix is fine and its test is inert. Whenever a fixture stub gains
per-call *output*, give it per-call *exit status* in the same change — the two are the same
question asked from either side.

**Seen before.** `ah-cklr` (three of six focused tests passed against the unfixed code, and only the
reviewer caught it), `ah-19l2.2` (a negative fixture was inert for a reason the plan did not
anticipate), `ah-58n.1` (the plan's own RED test passed against the unchanged code). On its fourth
sighting, and the first three were all caught by somebody other than the author.
