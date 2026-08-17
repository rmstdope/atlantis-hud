# ah-mjy — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-18
- **PR:** #418

## The `pwa` job hung 25 minutes in "Install Playwright system dependencies" and was cancelled — but `gh run rerun --failed` did recover it

**What happened.** Every other job on run 32078418725 passed within six minutes. `pwa` sat in
*Install Playwright system dependencies* for 25m42s and ended `cancelled` (`gh api
.../actions/jobs/<id> --jq '.steps[]'` shows that step cancelled and every later step skipped, so no
test ever ran). `gh run rerun 32078418725 --failed` re-queued it and it passed in **47 seconds**.

**Why.** Not established for the hang itself; the apt/Playwright dependency install on the runner
stalls. The signature is the third recorded sighting — `ah-k6i.5` and `ah-bn6.1` both describe it.

**Cost.** About 30 minutes of wall-clock and one CI cycle. No code change.

**Prevent by.** Two things, both for the navigator to weigh rather than for an implementer to do:

1. **`ah-bn6.1`'s conclusion needs qualifying.** It records that a cancelled run cannot be re-run and
   that the recovery is a fresh push. Here `gh run rerun --failed` re-ran a cancelled job and it
   passed, so the rule is narrower than stated — a run whose *jobs* were cancelled individually is
   still retryable, and pushing an empty commit is a more expensive recovery than it needs to be.
   Reading that retrospective and pushing instead would have cost a full second CI cycle.
2. **A step timeout on the Playwright install** in the `pwa` job would turn a 25-minute stall into a
   two-minute failure, which is retryable immediately instead of after most of a review window.

**Seen before.** ah-k6i.5 and ah-bn6.1 — same job, same step, same stall.
