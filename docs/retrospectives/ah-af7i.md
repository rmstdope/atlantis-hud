# ah-af7i — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-07
- **PR:** #1039

## A plan that enumerates the readers of a field will miss the web adapter

**What happened.** The plan added an optional `live` field to `StudyGoal` and listed, under *Known
traps*, "there are exactly two such readers" of the teach variant's `students`, naming both. It did
not name `withGoals` in `packages/browser-core/src/webCoreAdapter.ts:294`, which rebuilds every
stored goal **field by field** on every `listStudyPlans` call and therefore drops any field it does
not mention. A live teach goal — stored as `{students: [], live: true}` — came back as
`{students: [], live: undefined}`, which the projection reads as a *frozen, empty* list: after a
reload on the web build the teacher taught nobody and the month was spent. The cold review found it;
`pnpm run check:fast` was green over it, because no test in `packages/browser-core` exercised that
function for the teach variant.

**Why.** Established. `withGoals` exists to stamp a discriminant onto goals written before
`ah-lyg6.3`, and its own comment says it is "built field by field rather than spread-minus-the-legacy-ones".
That construction is deliberate and correct for its purpose, and it is also a silent forward-compatibility
hazard for every field added to `StudyGoal` afterwards. Nothing in the type system catches it: the
literal it builds is a valid `StudyGoal` because the new field is optional, which is exactly what
makes the Rust `#[serde(default)]` side safe and the TypeScript side unsafe.

**Cost.** One review round and one CI cycle, about twenty minutes. It would have cost a failed
verification and a reopened P0 had the review not caught it.

**Prevent by.** A plan that adds a field to a type crossing the persistence boundary should name
`withGoals` (or grep for the hand-rolled reader) among its *Files to change*, and its test plan
should require a `packages/browser-core` save/list round trip for the new field. The general form:
`grep -rn "<the type name>" packages/browser-core/src` before writing the *Files to change* section,
because that package rebuilds stored records rather than passing them through.

**Seen before.** None found — `ah-vw8e`, `ah-6qp` and `ah-djq` each record something "silently
dropped", but none is a persistence reader.

## `check:fast`'s typecheck leg failed once and passed on a re-run with no change

**What happened.** `pnpm run check:fast` reported `typecheck FAIL` while `pnpm run typecheck` run on
its own, immediately afterwards and with no edit in between, printed no error and exited zero. A
second `check:fast` was fully green.

**Why.** Not established. `packages/browser-core` has a `pretypecheck` step that builds the wasm
bundle, and the gate runs its legs in parallel, so a leg racing that build is the obvious suspect —
but nothing was captured that proves it.

**Cost.** About three minutes and one wasted gate run.

**Prevent by.** Nothing yet; this is a first sighting recorded so a second one is recognisable. If it
recurs, the gate's typecheck leg should print the failing `tsc` output rather than only `FAIL`, which
is what made this one unattributable.

**Seen before.** None found.
