# ah-3pr9 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #501

## The walk-buttons smoke spec failed in CI again on a diff that cannot reach it

**What happened.** `smoke (web, 1, 2)` failed on
`tests/smoke/shortcuts.spec.ts:458 › the walk buttons step to the next problem and back, and wrap at
the end`. Both the first attempt and Playwright's own retry timed out at 15s: the first on
`expect(unitPane).toHaveText(first)` resolving 34 times to the previous unit's text, the retry on
`expect(unitPane).not.toHaveText(first)` where expected and received were byte-identical — the pane
never changed. 110 tests passed alongside it. This bead's diff is two files under
`mapThemes/`, touching ship classification and a vessel count; it cannot reach the unit panel or the
order validator. Running the spec locally with `CI=1` passed 2/2 in 8.8s. One job re-run went green.

**Why.** Not established here, and matching ah-f9q9's shape exactly, which in turn matched ah-dlao's:
the assertion waits on state that only lands after the debounced validation, and there is no barrier
in the spec that means "validation has landed". The line number has moved (358 → 458) but it is the
same test.

**Cost.** One CI cycle plus a local wasm build and smoke run to disprove it — about 15 minutes.

**Prevent by.** ah-dlao already named the fix: this spec should wait on the header's `problems-chip`
showing a non-zero count before clicking a walk button. It has now cost three separate implementers
a cycle each, which is the argument for doing it rather than re-running it a fourth time. That is a
bead for the navigator to rank, not a change an implementer makes inside an unrelated plan.

**Seen before.** ah-f9q9 (same test, same job, same 15s timeout); ah-dlao (same root cause, found
while writing the buttons).
