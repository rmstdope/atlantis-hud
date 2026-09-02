# ah-dhga — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-02
- **PR:** #878

## A smoke spec passed locally and failed in CI because main had moved under the branch

**What happened.** This bead dissolves an empty formed unit, so the Silver-column smoke spec
(`tests/smoke/workspace.spec.ts`, "the silver column forecasts our own units and sorts on the
figure") went red in CI: it formed an empty unit and asserted its row. I staffed the formed unit with
`GIVE NEW 1 1 LEAD`, ran `pnpm exec playwright test --project=web tests/smoke/workspace.spec.ts -g
"the silver column"` and then the whole `--shard=2/2` locally — 163 passed — pushed, and CI failed
again on the same assertion. The cause was not the spec: `ah-t8ei` ("mages keep their men through a
GIVE") had merged into main after this branch opened, unit 18642 has studied a Foundation, and CI
tests the merge with main while my worktree was still on the older base. The fixture's staffing order
was silently refused there and nowhere else.

**Why.** CI runs a `pull_request` merge commit; a worktree branched before a semantic change on main
does not. A local suite can therefore be green on a rule the merged tree no longer allows.

**Cost.** Two CI cycles and about 25 minutes, most of it a full local shard run that could not
reproduce the failure by construction.

**Prevent by.** `implement-bead`'s *Red CI* says to read the failure before believing it. Add to that
first diagnostic step: when a CI-only failure cannot be reproduced locally, run `git log --oneline
origin/main` and rebase **before** changing anything. A branch open across another bead's merge is
testing a different tree from CI, and every local run is evidence about a tree that will never exist.

**Seen before.** `ah-k6i.5` records main moving twice under an open PR, but for stalled runners
rather than a semantic conflict; none found for this shape.
