# ah-bn6.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #413

## A cancelled CI run cannot be re-run, so the recovery from a hung job is a push, not `gh run rerun`

**What happened.** `smoke (web, 2, 2)` sat `in_progress` for ~40 minutes on
`Install Playwright system dependencies` while every other job on the same commit passed in
minutes — the signature `ah-k6i.5` already describes. Following that retrospective I cancelled the
run (`gh run cancel 32068466410`) and then tried to re-run it. Both forms refused:
`gh run rerun <id> --failed` answered `This workflow is already running` while the cancellation was
still settling, and once the run read `completed` it answered
`run 32068466410 cannot be rerun; This workflow run cannot be retried`. GitHub does not offer a
retry on a run whose jobs were cancelled rather than failed, so there was nothing left to re-run
and the PR had no green head.

**Why.** Established for the mechanism, not for the hang: a cancelled run is terminal on GitHub's
side, so `rerun` has no failed job to retry. The hang itself is the same unexplained runner/package
stall as `ah-k6i.5`.

**Cost.** About 45 minutes of wall-clock, and one CI cycle wasted. The recovery was free only
because this retrospective was itself a commit — pushing it started a fresh run.

**Prevent by.** `implement-bead`'s *Red CI* says a suspected flake "gets the job re-run", which
`ah-k6i.5` read as cancel-then-`gh run rerun`; that worked there and does not in general. Two
concrete changes for the navigator to weigh: prefer re-running the single stuck job
(`gh run rerun --job <job-id>`) or pushing an empty commit
(`git commit --allow-empty`) over cancelling the whole run, and — if a cancel has already
happened — recover with a push, since `gh run rerun` will refuse. Worth a sentence in *Red CI*
naming that a cancelled run is not retryable.

**Seen before.** `ah-k6i.5` — same step, same signature, and the source of the cancel-then-rerun
recipe that failed here. Second sighting.
