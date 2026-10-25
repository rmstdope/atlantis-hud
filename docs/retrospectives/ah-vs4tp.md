# ah-vs4tp — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-25
- **PR:** #1882

## An unverified claim about today's behaviour became agreed acceptance

**What happened.** The first build pass sent a question back to UX. It said the existing `unterminated-quote` error "makes `canExportOrders` false", so export is refused. UX built option C1 on that claim, and the acceptance reads "Case 2 stays the blocking error it already is today (... Export orders refused until fixed)". The claim is false. `canExportOrders` (packages/shared/src/orderEditor.ts) is called nowhere, and `AppShell.tsx` enables Export orders whenever a document exists. It came to light only when a smoke assertion that export was disabled failed, with the status reading "1 error".
**Why.** The question was written from reading a function's name and body, not its call sites, and nobody checked it before UX decided on it.
**Cost.** One smoke cycle and an investigation. An acceptance line is now wrong in the record. A scope bead (ah-koleq) was filed. The UX decision between A, B and C1 was argued partly on a premise ("turning a warning switch off would make the editor stricter") that rested on export blocking.
**Prevent by.** In produce-bead step 2 (*Sent back to the UX stage*), a claim in a park note about what the app does today names its evidence: a call site (`grep` for the function's callers) or an observed run. A function existing is not evidence.
**Seen before.** none found

## The plan put an advisory code where a project-wide test forbids it

**What happened.** The plan raised `name-cut-short` from `validate_turn`. `every_advisory_code_can_be_silenced` (semantics.rs) requires a fixture for every code in `codes::ALL`, run through `check_turn`, so the code had to be raised in `review_turn` as a `Finding` instead.
**Why.** The plan was written without reading how `codes::ALL` is tested.
**Cost.** About ten minutes of re-plumbing (`Finding.fix`, hex attribution) and a plan amendment.
**Prevent by.** `.cerebro/traps.md` could name the fact: every code in `codes::ALL` must come out of `review_turn`, and `every_advisory_code_can_be_silenced` enforces it.
**Seen before.** none found
