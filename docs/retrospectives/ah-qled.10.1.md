# ah-qled.10.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-22
- **PR:** #543 (pointer bump), rmstdope/cerebro#85 (the work)

## Two tooling specs time out at 5000ms inside `check:fast`, and pass alone in six seconds

**What happened.** `pnpm run check:fast` reported `tooling FAIL` on a diff that was nothing but a
submodule gitlink bump. Both failures were `Error: Test timed out in 5000ms` —
`scripts/beadsExport.test.ts > writes and commits a refresh when the committed export is stale` and
`scripts/ciDocsGate.test.ts > takes the fast path for a diff that is only prose`. Re-running exactly
those two files on their own (`pnpm vitest run scripts/beadsExport.test.ts scripts/ciDocsGate.test.ts`)
gave 40 passed in 6.3s, each of the two specs well under a second.
**Why.** Not established beyond the shape of it: both specs shell out to `git` against a temporary
repository, and the gate runs its legs concurrently with a cold `cargo` build (`Finished dev profile
in 2m 13s` in the same log). A 5s wall-clock timeout on a subprocess-heavy spec is what gives way
first when the machine is saturated. I did not prove the cargo leg is the specific cause.
**Cost.** About fifteen minutes: one full gate run to see the failure, one targeted re-run to
establish it was not the diff, plus the reasoning in between about whether a gitlink bump could
possibly have caused it.
**Prevent by.** Giving the git-shelling specs in `scripts/*.test.ts` an explicit `testTimeout`
generous enough to survive a loaded machine (they are subprocess tests, not unit tests), or having
`check:fast` not overlap the cargo leg with the tooling leg on a cold target directory. Either is a
change to the project's gate and belongs to the navigator, not to this bead.
**Seen before.** None found — `grep -rl "5000ms\|beadsExport.test\|ciDocsGate.test" docs/retrospectives/`
returned nothing.
