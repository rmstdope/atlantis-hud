# ah-awcm — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #670

## The plan's verbatim user-facing string carried a `$` the shipped code does not use

**What happened.** The plan states *"Every string above is final and is quoted verbatim"* and gives
the new hover sentence as `Includes $100 taken from Workers (6567) in this hex.`, with an increment-5
test asserting it beside the shipped gift sentence as `Includes $25 given by ArmorerA (5671) in this
hex.` The shipped sentence in `packages/shared/src/unitTooltip.ts:588` has no `$` — it reads
`Includes ${silver.received} given by …` and its test at `unitTooltip.test.ts:723` pins
`"Includes 200 given by Paymaster (2390) in this hex."`. The plan also forbids touching the gift
sentence, so writing the plan's string verbatim would have shipped two adjacent lines that disagree
about money formatting, and increment 5's own quoted block would have been unassertable as written.

**Why.** The mockup (`docs/ui/ah-awcm-take-hover.html`) renders `$` on *both* sentences, including
the shipped one it did not change — so the `$` is the mockup's money styling rather than a wording
decision the navigator took. The plan transcribed the strings out of the mockup without checking
them against what the sibling sentence ships.

**Cost.** About ten minutes: reading the shipped sentence, its tests and the mockup to establish
that the `$` was styling, and one judgement call on a user-facing string an implementer is
otherwise told not to make. No CI cycles; caught before the first TypeScript test was written.

**Prevent by.** When `plan-bead` quotes a new string that will sit beside an existing one, quote the
existing one **from the code** — file and line — in the same section, so a mismatch is visible in
the plan rather than discovered at the keyboard. A mockup is evidence of layout and wording, not of
punctuation the surrounding shipped strings already settle.

**Seen before.** none found.
