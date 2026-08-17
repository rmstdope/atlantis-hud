# ah-4k3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #402

## `gh pr create` was unusable for ten minutes while the REST API was healthy throughout

**What happened.** `gh pr create` failed nine times over about six minutes with
`HTTP 503: No server is currently available to service your request` from
`api.github.com/graphql`. Retrying did not help — every attempt hit the same GraphQL
outage. `gh api repos/rmstdope/atlantis-hud/pulls --jq ...` run in the same minute
answered normally, so the outage was GraphQL-only. Creating the PR through REST
instead succeeded on the first try:

```bash
gh api repos/<owner>/<repo>/pulls -X POST \
  -f title="..." -f head=<branch> -f base=main -F body=@/tmp/body.md \
  --jq '.number,.html_url'
```

The same held for the CI wait: `gh pr checks 402` 503'd while
`gh api repos/<owner>/<repo>/commits/<sha>/check-runs` returned the full set of
fourteen check runs. `gh pr edit --add-reviewer @copilot` has no REST equivalent that
is worth the trouble and did eventually succeed on a retry, so retrying is still the
answer for that one.

**Why.** A GitHub-side GraphQL incident. Most of `gh`'s porcelain (`pr create`,
`pr view --json`, `pr checks`, `pr edit`) is GraphQL; `gh api repos/...` is REST and
was unaffected. Established by observing both succeed and fail in the same minute,
not inferred.

**Cost.** About twelve minutes, and it would have been the whole twenty-minute review
budget had the fallback not been tried — three earlier retrospectives (below) all
describe waiting the outage out, which is the expensive option when only half the API
is down.

**Prevent by.** `implement-bead`'s *Waiting, without ending your run* should say that
a GraphQL 503 is not an outage of GitHub, only of `gh`'s porcelain, and name the two
REST fallbacks that cover the blocking steps of a bead: `gh api repos/<o>/<r>/pulls
-X POST` to open the PR, and `gh api repos/<o>/<r>/commits/<sha>/check-runs` to wait
on CI. Retry only where no REST route exists.

**Seen before.** ah-4ue, ah-60m, ah-e4v — all three record the same 503s, all three
absorbed them by retrying, and none of them noticed REST was up. That is the third
sighting of the symptom and the first of the workaround.
