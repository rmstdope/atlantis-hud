# ah-8z4y.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #662

## A plan that adds a wasm export said "the existing web tests pass unedited", and three of them failed on `not a function`

**What happened.** The plan's test plan and validation both said the existing `webCoreAdapter` reset
tests "must pass unedited" — that being the assertion that the storage sequence was untouched. After
wiring `resetGame` to the new `wasm.reset_game_manifest_state`, `pnpm --filter @atlantis/browser-core
exec vitest run` failed three tests with `TypeError: wasm.reset_game_manifest_state is not a
function`. The cause is not the reset logic at all: `webCoreAdapter.test.ts` routes through a
hand-written `fakeWasm` stand-in that enumerates every `CoreWasmModule` member it supports, and a new
export has to be added to it (in two places in that file) exactly as `report_import_writes_state`
already is.

**Why.** Established. A plan that moves a rule into core *behind a new wasm export* necessarily makes
the adapter call a function the stand-in does not have. The stand-in is a test double, so extending
it is not "editing a reset test" — but the plan's wording gave no way to tell those apart, which cost
a judgement call about whether this was a deviation to hand back or to record.

**Cost.** Small — about ten minutes and one local suite run, no CI cycle. Recorded because it is
structural rather than incidental: `ah-8z4y.3` is planned against the same file and will hit it
again, as will every future bead that moves one of the seven remaining `webCoreAdapter` rules into
core.

**Prevent by.** A plan that adds a member to `CoreWasmModule` should name the `fakeWasm` stand-in in
`packages/browser-core/src/webCoreAdapter.test.ts` as a file to change, with a line saying the echo
stub is part of the increment and not an edit to the assertion. `grep -n "report_import_writes_state"
packages/browser-core/src/webCoreAdapter.test.ts` finds every place it must be added, and the fast
gate will not tell you until the adapter is already wired.

**Seen before.** `ah-uwa3` records the same shape from the other end — a plan whose validation said
"`EXPECTED` unedited" while the change broke two other places pinning the same data — and names
`ah-1wcw.4` and `ah-djq` as its own prior sightings. The recurring lesson across all four is that
*"the existing tests pass unedited"* is a claim about **assertions**, and a plan that makes it should
also list the **fixtures and doubles** the change necessarily updates.
