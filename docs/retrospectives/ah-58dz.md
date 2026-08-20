# ah-58dz — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-19
- **PR:** #441

## The smoke jobs hung 85 minutes in "Install Playwright system dependencies"

**What happened.** After the review fix was pushed, `checks`, `rust`, `wasm`, `desktop-shell` and
`changes` all passed in under 90 seconds, while `pwa` and the four `smoke` shards sat queued and
then `in_progress` with no output. `gh api .../jobs` showed both running shards stuck on the step
**Install Playwright system dependencies** — 85 minutes on an apt step that normally takes seconds.
Nothing in the bead's diff touches the browser suites. `gh run cancel` followed, once the run
reached `completed`, by `gh run rerun <id> --failed` requeued exactly the five browser jobs, and
`pwa` then passed in 59 seconds with the smoke shards following.
**Why.** Not established beyond "infrastructure": the apt step, not the tests. Repo-wide runner
contention was visible at the same time (8–9 workflow runs in flight, five of my jobs queued ~50
minutes before any started), so a saturated pool is a plausible aggravator but was not proved to be
the cause.
**Cost.** About two hours of wall-clock on a bead whose code work took twenty minutes, plus one
full CI cycle for the re-run.
**Prevent by.** Nothing in this repository's control appears to fix the apt step itself. What would
help is `implement-bead`'s *Red CI* section saying explicitly that a job **hung** on a setup step is
infrastructure and is recovered by `gh run cancel` + `gh run rerun --failed` without waiting for a
timeout — this is now the fourth bead to discover that independently, and each one waited a long
time first because the section only describes a *failing* job.
**Seen before.** ah-k6i.5 (same apt step, 20+ minutes), ah-mjy (same step, `pwa`, 25 minutes,
cancel + `rerun --failed` recovered it), ah-bn6.1 (same recovery attempted). Worth noting for
whoever reads these: **ah-bn6.1 records that a cancelled run cannot be re-run and the recovery is a
push.** That did not hold here — `gh run rerun <id> --failed` worked once the run had finished
cancelling, as ah-mjy also found. The trap is only that it must be *completed* first; running it
too early answers "This workflow is already running", which is probably what ah-bn6.1 hit.
