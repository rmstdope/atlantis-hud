# ah-u4e.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-16
- **PR:** #313

## The plan named `mergeTurn`'s consumers, but missed one of the two call sites

**What happened.** The plan's "Files to change" section walked every place `mergeTurn`'s signature
change (`viewerRawReport`, a new required trailing parameter) needed to land, and listed only
`AppShell.tsx`'s `mergeReport` callback. `packages/shared/src/batchImport.ts`'s `walkBatch` also
calls `mergeTurn`, once per merge step in a batch import - the plan's "Files to change" section
never mentions `batchImport.ts` at all, even though it grep-shows up under `mergeTurn` alongside
`AppShell.tsx`. I found it at compile time (`tsc` reporting "Expected 8 arguments, but got 7") and
had to decide on my own what to pass: `walkBatch` discards `mergeTurn`'s whole return value in this
loop, so there is no "viewer's report on screen" worth resolving the known map against mid-batch. I
passed an empty string with a comment explaining why. The Copilot review then caught a sharper
version of the same gap: calling the full `mergeTurn` there was not just wasteful (an unneeded
`loadRegionSightings`/`knownMapFor` round trip per merged step) but a latent bug - `loadRegionSightings`
inside `mergeTurn` is not wrapped in try/catch, so a readback failure after a merge that itself
succeeded would have marked a landed step as failed.
**Why.** The plan's file-and-reuse section was built by reading `mergeTurn`'s call sites at
plan time, and `batchImport.ts` was missed - possibly because the epic's earlier slices never
touched it, so it was outside the set of files the planner had reason to open for this bead.
**Cost.** One extra review round-trip and CI cycle (a fixup commit after the review, ~10 minutes of
CI) to replace the discarded `mergeTurn` call with a direct `client.mergeReport` call. Not large,
but avoidable: `grep -rn "mergeTurn(" packages/shared/src` at plan time would have found both
call sites in one command.
**Prevent by.** When a plan changes an existing function's signature, its "Files to change" section
should say it was produced by grepping the function's own name for every call site, not just
reasoned about from the files the bead's description already points at - `mergeTurn(` here would
have surfaced `batchImport.ts` immediately.
**Seen before.** None found.
