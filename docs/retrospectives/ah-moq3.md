# ah-moq3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #671

## `check:generated` stays red until the regenerated bindings are committed — third sighting

**What happened.** Adding one field to `UnitSilver` in Rust made `cargo test` rewrite
`packages/core-client/src/generated/UnitSilver.ts`. `pnpm run check:fast` then failed its
`generated` leg. `git add`ing the file did not clear it: `checkGenerated.ts` reads
`git status --porcelain`, which reports a staged change as `M ` just as loudly as an unstaged one,
so the leg only went green after the commit.
**Why.** Established, and it is written down in the wrong place: `scripts/checkGenerated.ts`'s own
doc comment ends *"Fails with the list of files, so the fix is `git add`."* That is the one
instruction a reader reaches for at exactly this moment, and it does not work.
**Cost.** Two extra fast-gate runs, about three minutes. Small each time — and this is the third
implementer to pay it.
**Prevent by.** Correct that doc comment in `scripts/checkGenerated.ts` to say the fix is to
**commit** the regenerated files, not stage them. It is a one-line change to the file every reader
of this failure is already looking at, and it would have ended this at the first sighting.
**Seen before.** `ah-1wcw.3` (first sighting) and `ah-gdfe` (recorded as the second). Three
implementers, one unchanged sentence.
