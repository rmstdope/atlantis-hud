# ah-k6i.5 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** #285

## Three CI jobs sat "in_progress" for 20+ minutes, stuck on an apt-get step

**What happened.** After the second rebase (main had moved twice while this PR was open), CI ran
and every job finished in under a minute or two except `smoke (web, 1, 2)`, `smoke (web, 2, 2)` and
`native`, which stayed `in_progress` for over 21 minutes. `gh api .../jobs/<id>` on each showed the
same shape: every earlier step completed in seconds, then `Install Playwright system dependencies`
(the two smoke jobs) or `Install system dependencies` (`native`) sat `in_progress` with no
`completed_at`, and every step after it was still `pending`. The identical prior run of this same PR
had those same steps complete in seconds. Not a test failure and not related to this bead's diff -
`packages`, `tooling`, `cargo`, `desktop-shell` smoke, `pwa`, `wasm`, `rust` and `checks` had all
already passed on the same commit.

**Why.** Not established beyond "the GitHub-hosted runner or its package mirror stalled" - nothing
in the job's own logs (unavailable while `in_progress`) pointed at anything this repository
controls.

**Cost.** About 20 minutes of wall-clock waiting before cancelling (`gh run cancel`) and re-running
the whole workflow (`gh run rerun`), which then passed cleanly in under 5 minutes. One CI cycle, no
code changes.

**Prevent by.** Nothing to change here - the "suspected flake gets the job re-run, capped at two
re-runs" rule already covers exactly this, and re-running fixed it. Worth naming as a pattern to
recognise faster next time: three jobs stuck on the same *kind* of step (a system package install)
while every other job on the identical commit passed is the signature to look for before spending
more time watching a `pending` status than the job itself would take to just re-run.

**Seen before.** None found (searched `docs/retrospectives/` for "Install Playwright system
dependencies", "runner hung", "stuck on", "apt-get").
