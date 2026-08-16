# ah-6uo — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-16
- **PR:** #35 (cerebro repo, rmstdope/cerebro)

## The cerebro repo's CI workflow did not trigger on the PR's first push

**What happened.** `git push -u origin ah-6uo-redraw-one-tick` followed immediately by
`gh pr create` opened PR #35. The `Copilot` review workflow ran within seconds, but the `CI`
workflow (`.github/workflows/ci.yml`, triggered on `pull_request`) never appeared in
`gh run list` or `gh pr view --json statusCheckRollup` — not queued, not skipped, simply absent —
for the fifteen-plus minutes it took to get the review and answer its comments.
`gh workflow run ci.yml --ref ah-6uo-redraw-one-tick` (manual `workflow_dispatch`) ran it
successfully. Later, a `git push --force-with-lease` after a rebase triggered the normal
`pull_request` run within about twenty seconds, with no manual intervention.
**Why.** Not established. A plausible cause is a race between the branch push and the PR-open
event on a *brand new* branch pushed and turned into a PR in the same breath, which some
GitHub Actions accounts describe as missing the initial `pull_request` check-suite association —
but I did not confirm this against GitHub's status or docs, and the same repo's ah-mi7 PR (created
the same way, minutes earlier) *did* get its CI run on the first push, so it is not consistent.
**Cost.** About ten minutes of investigation plus one `workflow_dispatch` to unblock the wait for
CI; no bead impact since the manual run substituted cleanly and the later force-push confirmed the
normal path still works.
**Prevent by.** After requesting the Copilot review on a PR against the cerebro repo, also check
`gh pr view <n> --json statusCheckRollup` once early (not just late) — if it is empty after a
couple of minutes while the Copilot review has already landed, `gh workflow run ci.yml --ref
<branch>` rather than waiting on a run that never queued.
**Seen before.** None found.
