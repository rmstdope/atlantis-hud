# ah-yphv — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-01
- **PR:** #1354

## The tooling suite timed out only in the aggregate fast gate

**What happened.** The second `pnpm run check:fast` attempt passed lint, typecheck, generated bindings, formatting and clippy, but its test leg failed with eight timeouts across tooling tests in `scripts/beadsExport.test.ts`, `scripts/cargoTargetDir.test.ts`, `scripts/ciDocsGate.test.ts`, `scripts/gateLock.test.ts`, `scripts/gateWorkload.test.ts` and `scripts/runGate.test.ts`. Running `pnpm run test:tooling` alone passed 353 tests with two skipped, and the following full `pnpm run check:fast` passed all six legs.

**Why.** Not established. The timeouts disappeared in the isolated run, but no bottleneck was measured.

**Cost.** One isolated tooling-suite rerun and one additional full gate before opening the PR.

**Prevent by.** The gate-level options recorded in ah-qled.10.1 remain for the navigator to decide: give process-heavy tooling specs more time, or avoid overlapping the tooling suite with cargo on a cold target directory. This run confirms the symptom recurred but does not establish which change is right.

**Seen before.** ah-qled.10.1 — tooling subprocess tests timed out only inside check:fast and passed alone; the cause was not established.
