# ah-9ess — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #518

## Three `workspace.spec.ts` specs fail locally on an unmodified tree and pass in CI

**What happened.** The plan required `pnpm run test:smoke` to pass twice in full before opening the
PR, since the bead is about a flaky smoke spec. The first full run was clean (473 passed). The
second reported `3 failed, 4 flaky` — `workspace.spec.ts:3819` "the faction view uses the window
before it scrolls" and `workspace.spec.ts:1675` "folding the unit panel hides the grip", both on
`expect(locator).toBeInViewport()`, plus `workspace.spec.ts:2283`. None of them is reachable from
this diff. `git stash -u` and re-running the same spec on the **unmodified** tree reproduced the
same two failures, and CI ran all five smoke shards green on the same commit.
**Why.** Not established. It is local to this machine — a viewport or display-scaling difference
against the CI container is the obvious suspect, but I did not prove it. What is established is
that the failures do not depend on the diff.
**Cost.** About 15 minutes: one targeted re-run and one stash-and-run on the base tree to establish
the failures were pre-existing rather than mine.
**Prevent by.** `implement-bead`'s *Red CI* section tells you how to decide whether a **CI** failure
is a flake; there is no equivalent for a **local** failure in a spec the diff cannot reach, and the
answer there is different — the cheap decider is `git stash -u`, run that one spec, `git stash pop`,
which is two minutes and settles it. Worth a line in that section. A plan that asks for a full local
smoke run (as this one rightly did) should expect to meet this and say so.
**Seen before.** None found — the smoke-flake retrospectives already here (ah-dlao, ah-f9q9,
ah-3pr9, and the "right-click centres the view" family) are all CI-fails-locally-passes, which is
the opposite direction.
