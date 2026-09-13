# ah-sooy — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-14
- **PR:** #1241

## The fast gate ran the whole Rust test workspace for a TypeScript-only diff

**What happened.** The diff touched only `packages/shared/src` and `build-workload --classify` said
`non-rust`. `CARGO_TARGET_DIR=<shared>/target pnpm run check:fast` still ran `cargo test --workspace`,
one integration binary at a time, and took about 30 minutes end to end. Three `Bash` calls hit the
600s limit and were moved to the background while it ran.
**Why.** `check:fast`'s `test` leg runs the cargo suite unconditionally; the workload classification
only chooses the target directory, not which legs run.
**Cost.** About 30 minutes of wall clock before the PR could open, plus three stalled wait loops.
**Prevent by.** `check:fast` (or `.cerebro/project.conf` `gate_fast`) skipping the cargo test leg
when the diff classifies as `non-rust`, leaving it to CI's `rust` job, which already gates on paths.
**Seen before.** None found.

## The plan listed four test files; the behaviour change broke two more

**What happened.** The plan's *Test plan* named `teachingPermission`, `studySchedule`,
`StudySchedule`, `studyTeaching` and `studyCell` tests. `studyMagePane.test.ts` also pinned
"unknown suppresses the doubling" and failed the fast gate. `studyOrders.test.ts` looped a
synthetic unknown cell with `taughtBy: null` and still passed; only the Copilot review noticed that
the order comment for an assumed month had changed without a test.
**Why.** The plan traced the two doubling paths but not every consumer of `taughtBy`.
**Cost.** One extra gate diagnosis and one extra commit and CI cycle after review.
**Prevent by.** `plan-bead`'s test-plan step: grep the tests for every literal value whose meaning
changes (here `"unknown"`) and list each hit as changed or deliberately unchanged.
**Seen before.** None found.

## The skill and the project disagree on who reviews

**What happened.** `implement-bead` says to spawn a `reviewer` sub-agent and request nothing from
GitHub; the project's `CLAUDE.md` *Four eye Principle* says a Copilot review requested on PR open is
the second pair of eyes. The skill says the project's document governs, so I requested Copilot.
**Why.** The skill was updated after `CLAUDE.md`, or the other way round; not established.
**Cost.** A few minutes deciding; the risk is two implementers choosing differently.
**Prevent by.** Aligning `CLAUDE.md`'s *Four eye Principle* with `implement-bead`'s *The review
loop*, whichever the navigator intends.
**Seen before.** None found.
