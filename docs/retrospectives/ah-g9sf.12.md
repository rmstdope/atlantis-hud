# ah-g9sf.12 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-12
- **PR:** #1180

## A known machine-local flaky spec flaked in CI, and cost a cycle to clear

**What happened.** `smoke (desktop-shell, 2, 2)` failed on a green-everything-else head with
`selecting a passenger draws the fleet's voyage`: `expect(page.getByTestId("route-line-solid"))
.toHaveAttribute("points", …)` timed out on a two-point polyline where three were expected
(`tests/smoke/workspace.spec.ts:2658`). It failed on the first attempt and on Playwright's own
retry1, in the same job. A bare `gh run rerun <id> --failed` was green.

**Why.** Not established. The third point had not rendered inside 15s on a loaded runner; the spec
asserts an exact `points` string rather than waiting for the leg count, so a partially drawn route
is indistinguishable from a wrong one.

**Cost.** About 12 minutes — reading the log, proving the diff could not reach it
(`git diff --name-only origin/main...HEAD | xargs grep -ln "route-line\|voyage\|polyline"` → none,
and main was green on the two commits it had gained, both docs-only), one re-run, and the wait.

**Prevent by.** `docs/retrospectives/ah-2a96.md` lists this exact spec among five
`workspace.spec.ts` geometry specs that fail on a developer Mac, and concluded "CI on the same
commits was fully green: all four smoke shards passed". **That is no longer true** — this is the
first recorded sighting of one of those five flaking in CI, twice in one job. If it recurs, the spec
wants a `toHaveCount`-style wait on the finished route before the exact-`points` assertion, rather
than a second re-run budget spent per bead. That is a change to a smoke spec, outside a planned
bead, so it is the navigator's to decide.

**Seen before.** `docs/retrospectives/ah-2a96.md` — same spec, same file, but local-only and
explicitly green in CI at the time.
