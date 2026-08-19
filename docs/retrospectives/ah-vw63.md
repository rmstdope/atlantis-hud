# ah-vw63 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #440

## Two smoke shards hung an hour in "Install Playwright system dependencies", and the re-run then sat queued for another hour

**What happened.** On run 32226729274 every job passed within six minutes except
`smoke (web, 1, 2)` and `smoke (desktop-shell, 1, 2)`, which stayed `in_progress` for **55 minutes**;
`gh api .../actions/jobs/<id> --jq '.steps[]'` showed *Install Playwright system dependencies*
`in_progress` with every later step `pending` — the exact signature `ah-k6i.5`, `ah-bn6.1` and
`ah-mjy` already record, now on its fourth sighting. I cancelled the run and re-ran the failed jobs
(`gh run rerun --failed` refused with "This workflow is already running" but the re-run had in fact
started with fresh job ids — worth knowing, since `ah-bn6.1` records the opposite outcome for a
cancelled run). The two re-queued jobs then sat **`queued`, never started, for a further ~55
minutes**, and so did every other run in the repository: `gh run list` showed four branches queued
with nothing starting after 07:16, while githubstatus.com reported Actions fully operational. That
combination — repo-wide, all branches, GitHub healthy — reads as the account's Actions minutes or
spending limit rather than a runner hiccup, so I put it to the navigator rather than guessing. The
queue drained shortly afterwards and all eleven checks passed on the re-run.

**Why.** The apt hang: not established, and now recorded four times without a cause. The repo-wide
queue stall: not established either — it cleared during the exchange with the navigator, so whether
billing was touched or the queue simply drained is unknown.

**Cost.** About two hours of wall-clock on an otherwise uneventful bead, one cancelled run, one
re-run, and one question to the navigator. No CI cycle was spent on anything wrong with the diff.

**Prevent by.** Two separate things, and the second is the new one:

- The apt hang has four sightings and no fix. `.github/workflows/` installs Playwright's system
  dependencies on every smoke/pwa/native job; caching that layer, pinning the browser image, or
  adding a step `timeout-minutes` so a stalled install fails fast instead of holding a runner for an
  hour would each turn an hour of waiting into a two-minute retry. That is a change to CI, which is
  the navigator's to make — but at four sightings it is no longer a fluke.
- **`implement-bead`'s *Red CI* section has no answer for a queue that never starts.** Its three-fix
  and two-re-run caps are about jobs that run and fail; a job stuck at `queued` consumes neither and
  can block an implementer indefinitely. A sentence saying what to do — check `gh run list` for
  whether the whole repository is stalled, and treat repo-wide starvation as a navigator question
  rather than a CI failure — would have saved me deriving it.

**Seen before.** ah-k6i.5, ah-bn6.1, ah-mjy — all three describe the apt hang. None describes the
repo-wide queue stall.
