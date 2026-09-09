# ah-jzs9 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** #1152

## Scripted anchor-insertion split a doc comment from the thing it documented — three times in one bead

**What happened.** I inserted new code by `python3` `str.replace` on a text anchor three separate
times, and all three landed *between* a doc comment and the item it documented, leaving the
comment attached to my new code and the original item undocumented:

- `pub no_study_fee` went between `/// Why a term could not be priced…` and `pub doubt` — and
  because `UnitSilver` is a ts-rs export, the wrong doc block **shipped** in the generated
  `packages/core-client/src/generated/UnitSilver.ts`.
- `noStudyFeeSentence` went between `silverBody`'s long doc comment and `silverBody`.
- The `if charged_a_study` clear went between `// Stable, so entries sharing a phase keep the
  document order…` and the `moves.sort_by_key` it describes — and this one was written in the very
  commit that fixed the first two.

Every anchor matched, every `assert old in s` passed, and the fast gate was green on all three.
Only the review sub-agent found them.

**Why.** Established. A code anchor and a *documentation* anchor look identical to `str.replace`,
and the natural anchor for "insert before X" is the first line of X's body or signature — which is
below its doc comment, not above it. The gate cannot see it: `rustfmt`, `clippy` and `eslint` all
consider a comment correctly placed wherever it sits.

**Cost.** Two extra review rounds and two CI cycles, about 35 minutes, plus a wrong doc block that
would have shipped on a public wire type.

**Prevent by.** When inserting a new item before an existing one, anchor on the existing item's
**doc comment opening** (`/**`, `///`) rather than on its signature — and read the four lines above
the insertion point before committing. This is the fourth distinct sighting of scripted anchor
editing going wrong in this repository, and the first where the *anchor matched correctly* and the
result was still wrong: the family is wider than "the replace silently did nothing".

**Seen before.** `ah-1zca.5`, `ah-ndp9`, `ah-npab`, `ah-8l9a` — all four are unchecked or
mis-anchored scripted `str.replace`. `ah-npab` is the closest: anchored on the wrong line of a doc
comment. Fifth sighting of the family.

## A regression test asserted on the wrong surface and passed against the unfixed code

**What happened.** A review finding said the ledger's new early return fired before the
`men_estimated` doubt, so a capped unit with an estimated headcount no longer reached
`ledger.doubted`. I fixed it and wrote
`a_capped_study_by_a_unit_of_estimated_men_is_doubted_as_it_always_was`, asserting on the SILVER
column's `doubt == Some(SilverDoubt::EstimatedMen)`. The next review round reverted my fix in place
and ran the test: **it passed.** The column short-circuits an estimated unit before any arm runs, so
it can never observe what the ledger did. The test was green, looked like a regression test, and
guarded nothing.

**Why.** Established. The finding was about one surface (`ledger.doubted`) and I reached for the
seam I had been using all bead (the column's `UnitSilver`), which happens to produce the same
*symptom* for an unrelated reason. Two surfaces agreeing about a unit is exactly what this bead was
about, which made the wrong seam feel right.

**Cost.** One review round and one CI cycle, about 20 minutes.

**Prevent by.** A test written to answer a review finding should be **demonstrated red against the
unfixed code** before it is offered as the answer — mutate the fix back out, run it, put it back.
`implement-bead`'s *Answering it, and going on* asks for a change or a reasoned reply per finding,
but says nothing about proving that a change is actually under test; the second review round did
this by hand and is the only reason it was caught. Worth considering as a line in that section.

**Seen before.** None found — no retrospective here records a test that passed against the code it
was meant to catch, though `implement-bead`'s own preamble names one as a past incident.
