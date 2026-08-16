# ah-8m0.3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-16
- **PR:** #337

## The plan's core-client section described functions that never existed in the tree

**What happened.** The plan's *Files to change* section for `packages/core-client/src/index.ts`
said to add `sortImportedTurnSummaries`/`sortHexNotes` "next to the normalizers (after
`normalizeImportedTurnSummary`, :1701-1724)" and to change `createCoreClient().listImportedTurns`
at specific line numbers. The actual file on the branch point (after ah-8m0.2's merge) was 596
lines, had no `normalizeImportedTurnSummary`/`normalizeHexNoteRecord` functions anywhere, and
`createCoreClient` simply spread the adapter's `listImportedTurns`/`listHexNotes` through
unchanged rather than calling any normalizer. The plan's cited test blocks
(`describe("listing imported turns")` at :957, `describe("hex notes")` at :1234, a
`createTauriAdapter(invoke)` pattern at :961-967) were likewise absent from `index.test.ts`.

**Why.** Not established with certainty, but the plan's own preamble warns "line numbers in this
plan predate ah-8m0.2's merge; search by symbol" — this was flagged as more than line drift,
because the referenced *symbols themselves* (whole functions, whole describe blocks) do not exist
in the current or apparently any prior committed version of the file that ah-8m0.2 would have
produced. The most likely explanation is the plan was written against an imagined or
aspirational shape of `core-client` rather than the file actually on disk at plan time.

**Cost.** No handback and no lost cycle - the actual file turned out to be simpler than the plan
described, so adapting cost roughly 10-15 minutes of extra reading to find the real
`createCoreClient`/`fakeAdapter` shape and write equivalent tests against it. Recorded because a
less careful implementer could have tried to edit code that doesn't exist, or built against the
wrong contract.

**Prevent by.** When planning a bead against a fast-moving shared file (`core-client/src/index.ts`
has been touched by two of the last three merged beads), the planner should paste the actual
current function signature/test block being modified into the plan rather than describing it from
memory or from an assumption about its shape - not just cite a line number, which this bead's own
preamble already anticipated going stale.

**Seen before.** None found (`grep -rl "core-client" docs/retrospectives/` before this bead
returned nothing about plan/tree mismatches of this kind, only line-number drift called out in
other beads' plans as an accepted risk).
