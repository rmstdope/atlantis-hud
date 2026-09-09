# ah-6m7b.4 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1117

## The plan used a universally-quantified claim to waive a test guard, and the claim was false

**What happened.** The plan's Increment 1 specified a corpus-wide invariant test and then wrote:
"**No unit in the corpus is doubted** — `silver_agrees_with_the_warning.rs` asserts exactly that, by
name — so this test never meets the emptied `changes` list and needs no guard for it." The claim is
false. `cargo test -p atlantis-hud-core --test silver_totals_are_its_movements` failed on
`G3_F42_T82 683: income is its movements summed, left: 1200, right: 0` — Ivanhoe (683) casts
phantasmal entertainment for 1200 with `expense = None`, so the doubt gate empties its change list
while `income` stays a number. The cited test asserts something narrower than the sentence claims.

The failure surfaced only *after* the increment's real fix landed, because `assert_eq!` stops the
walk at the first failing unit and unit 3493 was ahead of it. So the plan's predicted RED was
observed, correctly, and a second unrelated falsehood sat behind it. For a few minutes it read as
the "second missing record" the plan told me to find and fix rather than as an exempt case.

**Why.** The plan's second pass re-read every line number on `0abe3f07` — and this claim is not a
line number. It is a statement about all 26 fixtures, cited to a test that does not make it, and
nothing in the re-read pass covered that class.

**Cost.** About fifteen minutes: one debug test to dump the unit's totals and change list, and a
reading of the cited assertion to establish which of the two sentences was true.

**Prevent by.** `plan-bead`'s *Known traps* already requires a plan's line numbers to be re-read. A
plan that waives a guard on a claim about **every** row of a corpus should be held to the same bar:
name the command that demonstrates the claim, not the test file believed to contain it. Concretely,
this claim was checkable in one line before the plan shipped — a filter for `doubt.is_some()` over
`review_turn`'s output across `atlantis_hud_fixtures::ALL`.

**Seen before.** `docs/retrospectives/ah-6m7b.2.md` — "The plan named four tests as moving; eleven
had to move", a sibling in this same family and the same shape: a plan's count of what it had
surveyed was smaller than the tree's. `docs/retrospectives/ah-gdd3.1.md` — a plan's parenthetical
about current behaviour was false and was followed into a regression; that one is cited *in this
bead's own plan* as a trap, which is what makes a second falsehood in the same plan worth recording.

## The plan's replacement for a deleted running total dropped one of its terms

**What happened.** The plan gave the `opening` market fallback as
`spendable_so_far(held, &moves)`, which made `a_study_does_not_shrink_what_an_exact_buy_can_afford`
report `expense = Some(90)` against `Some(110)`. The deleted `running` total it replaced
deliberately excluded the month-long spends: `rules/sequenceofevents` processes STUDY and
manufacturing PRODUCE in its last block, after the market closes, so neither fee shrinks what a
`BUY` can afford (`ah-a5ci`). The correct replacement adds the `Studied` and `ProductionSpent`
movements back. The review then found a second divergence in the same expression — `.max(0)`
applied before those terms rather than after, which is different arithmetic for a negative sum.

**Why.** The plan wrote the two *cap* fallbacks out in full, under a heading of their own, and
checked them term by term. `opening` is a third fallback on the same deleted total, and it was not
in that section at all — so the one expression nobody wrote out was the one that lost a term.

**Cost.** About ten minutes to diagnose, plus one review round for the clamp ordering.

**Prevent by.** Where a plan deletes a running total with more than one reader, it should enumerate
**every** reader in one place and give the replacement for each, rather than writing out the two
that share a heading. The algebra is worth doing in the plan: cancelling `running`'s two
`cast_expense` terms against each other is what shows it is
`held + income - expense + month_long_expense - late`, and that identity is what makes the missing
term obvious.

**Seen before.** None found for this shape.
