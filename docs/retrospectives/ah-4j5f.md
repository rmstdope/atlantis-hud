# ah-4j5f — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-17
- **PR:** #1687

## The bead's bug claim did not hold on the report it named

**What happened.** The bead said a BUY the shared pool could not fully fund was not cut. With the
committed turn 42 template plus City Guards `SHARE 0`, Reginald's `BUY 51 CHOC` was affordable:
his `@CAST PHEN` earns $1200 before the market, and other sharers lend the rest. The navigator's
figures (-100, "100 short of what its purchase costs") came back only after the cast was removed
and two more lenders were taken out of the purse. In that state the game buys all 51 and refuses
the STUDY. So the defect was which order the hover named, not the BUY's size, and it took a
question to the navigator to change the bead's direction.
**Why.** The bead recorded the edit the navigator thought mattered (`SHARE 0`) but not the full
order set the figures came from.
**Cost.** About forty minutes of reconstruction probes before the reproduction, and one navigator
question.
**Prevent by.** For a bug found in exploratory testing, the bead's Scope should carry every order
edited from the report's template (or the saved orders file), not only the one suspected. A line
for that in `write-bead`'s guidance on bug beads would do it.
**Seen before.** none found.

## A doc-comment change on `UnitSilver` turned CI's rust job red after a green local gate

**What happened.** Answering a review finding, I edited the `UnitSilver::short_on` doc comment and
pushed after running only fmt, clippy and the one test file. ts-rs carries doc comments into
`packages/core-client/src/generated/UnitSilver.ts`, so CI's rust job failed with "cargo test
rewrote the generated TypeScript bindings".
**Why.** The fast gate had run before the review fix and not after it. A doc comment does not look
like an interface change, but on a ts-rs type it is one.
**Cost.** One CI cycle (about ten minutes) and one fix attempt.
**Prevent by.** Re-run `pnpm run check:fast` after any review fix that touches a `#[derive(TS)]`
type's comments, before pushing. Better still, have `implement-bead`/`produce-bead`'s review loop
say "a post-review change to `crates/` re-runs the fast gate", which would have caught it.
**Seen before.** `ah-moq3`, `ah-jzs9`, `ah-l80z` (regenerated `UnitSilver.ts` caught late).
