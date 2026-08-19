# ah-3cj4.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #452

## The `native` job hung 30 minutes in "Install system dependencies" and was cancelled

**What happened.** After the branch was caught up with main, every check went green except
`native`, which sat pending and then reported `fail` at 30m25s. The job's steps show
`Install system dependencies: cancelled` and every later step skipped — no test ever ran.
`gh run rerun 32259572024 --failed` recovered it: the second attempt was green in about six
minutes.
**Why.** Not established here, and not this bead's code — the failure is upstream of any
compilation. It is the same apt-install step three earlier retrospectives describe hanging for
the Playwright suites.
**Cost.** About 45 minutes of the run: 30 minutes of a hung job plus a re-run, spread over four
blocking CI waits.
**Prevent by.** This is the **fourth** recorded sighting of an install step hanging on a CI
runner (ah-mjy, ah-58dz, ah-vw63, this one), and the first on `native` rather than a browser
job — so it is not Playwright-specific. A step timeout on the install steps in the workflow would
turn a 30-minute hang into a fast failure that `--failed` re-runs cheaply; that is a change to
CI and therefore the navigator's, not this bead's.
**Seen before.** ah-mjy, ah-58dz, ah-vw63, ah-k6i.5 — all the same install step, all recovered
by a re-run.
