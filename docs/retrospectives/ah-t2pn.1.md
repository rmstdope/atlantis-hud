# ah-t2pn.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #616

## CI never triggered on the PR's first push, and reopening the PR did not trigger it either

**What happened.** `git push -u origin ah-t2pn.1-split-tax-base` followed by `gh pr create`
produced a PR with no CI run at all: `gh pr checks 616` answered "no checks reported" for eighteen
consecutive polls over nine minutes, and `gh run list --branch ah-t2pn.1-split-tax-base` showed
only the Copilot review run — no `ci.yml` `pull_request` run. Other PRs opened in the same window
(#617, #618, `ah-19l2.2`) all got their CI runs normally, so it was not an Actions outage.
`gh pr close 616 && gh pr reopen 616`, which delivers a fresh `pull_request` event, produced no run
either over ten further polls.

**Why.** Not established. GitHub accepted the push and the PR, and `ci.yml` is triggered on a bare
`pull_request:`, so the event should have matched. `ah-6uo` recorded the same symptom in the
cerebro repository and resolved it with a later push; the reopen result here says the missing piece
is the *push* event, not the pull-request one.

**Cost.** About twenty minutes of polling plus a close/reopen cycle, and a merge that could not
proceed until another commit was pushed. No wasted CI cycles, since none ran.

**Prevent by.** `implement-bead`'s CI wait should treat "no checks reported" as a distinct state
from "checks pending" and bound it: if no run has appeared within about five minutes of the PR
opening, push again (an empty commit, or the retrospective commit if one is due) rather than
continuing to poll, and do not spend a close/reopen cycle on it — that is now known not to work.
The skill's wait loop as written cannot tell the two states apart and will poll indefinitely.

**Seen before.** `ah-6uo` — same symptom in the cerebro repository, also resolved by a later push.
