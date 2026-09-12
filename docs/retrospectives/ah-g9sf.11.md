# ah-g9sf.11 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-12
- **PR:** #1181

## "No checks reported" was a merge conflict, and the PR said so all along

**What happened.** `gh pr checks 1181` answered "no checks reported on the branch" for sixteen
consecutive polls over eight minutes, across two pushes. `gh run list --branch …` showed no run,
and `gh api repos/…/commits/<sha>/check-runs` answered `total_count: 0` for both heads. Other PRs
opened in the same window got their runs normally, so it was not an Actions incident. The cause was
visible in one command I did not run until after eight minutes of polling:

    gh pr view 1181 --json mergeable,mergeStateStatus
    {"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING"}

`ah-g9sf.3` had merged while the PR was in review and conflicted with it. Rebasing onto `origin/main`
and force-pushing scheduled a full run within seconds, and every check went green.

**Why.** Established, and this is the part worth recording: GitHub does not schedule a `pull_request`
workflow for a head it cannot compute a merge ref for. `ah-64wm` recorded the same correlation and
left it at "not established"; this run confirms it, with the conflict verdict read directly off the
PR while the checks were silent.

**Cost.** About eight minutes of polling, plus one review round's worth of confusion about whether
the gate had run at all. Nothing was wasted beyond the wait — no CI cycles were spent, since none
ran.

**Prevent by.** `implement-bead`'s *Merging* section already carries the `mergeable`/
`mergeStateStatus` check, but places it **before waiting on CI after a push that could have raced
main** — a rebase, an `update-branch`, a fix onto a head that sat through a review. It is not asked
for after the PR first opens, which is exactly where this bit. The cheap fix is to make that check
the first thing the CI wait does, every time, not only after a racing push: one `gh pr view` call
distinguishes "checks pending" from "checks will never run", and `CONFLICTING DIRTY` is already the
one state the section says not to enter the CI wait on. That also gives `ah-t2pn.1`'s open question —
"treat 'no checks reported' as a distinct state and bound it" — a diagnosis rather than a timeout.

**Seen before.** `ah-64wm` (same symptom, same `CONFLICTING` correlation, cause left unproven),
`ah-t2pn.1` (same symptom, cause not found, asked for a bound on the wait), `ah-wwyr` (same symptom
from an actual Actions incident — the one case where the conflict check would come back clean),
`ah-6uo` (cerebro repository).
