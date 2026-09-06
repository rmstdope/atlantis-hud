# ah-rgkk.2.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-06
- **PR:** #1008

## A plan can name a pluralisation trap and then walk into it two paragraphs later

**What happened.** The plan's *Known traps* names the catalogue-singular hazard explicitly ("Item
names are the catalogue's singular in one place and the report's plural in another … never pass one
through a pluraliser meant for the other"), and one of its *Decided by me* entries deliberately
words the race-ceiling sentence to need no plural, saying in as many words that `hill dwarf` does
not pluralise by appending `s`. A different decision in the same document then specifies
`count(m.amount, m.name)` for the recruit sentence and argues it is safe from the one race that
happens to be regular (`count(6, "human")` → `6 humans`). It is not safe for `HDWA` or `HELF`:
`6 hill dwarfs` ships. The review caught it; I could not fix it, because the exact string is one of
the plan's *User-facing decisions*, so it went back to the planner as a declined finding.

**Why.** Established. The plan reasoned about the trap once per sentence rather than once per
document, and the sentence it checked (`human`) is the one race for which the bug is invisible.

**Cost.** No rework — the review round would have happened anyway — but the family ships a wrong
plural until a planner rules on it, and the fix will be a second PR.

**Prevent by.** Where a plan's *Known traps* names a hazard, `plan-bead` could ask that each
sentence the plan specifies byte-for-byte be checked against the *worst* instance the data page
holds rather than a convenient one — `data/HDWA`, not `data/HUMN`. The same document had already
done exactly that for one sentence, so this is about applying the check to all of them.

**Seen before.** `ah-wbr9` (plan required `hexes` from a helper that appends a bare `s`),
`ah-jpcj.2` (plan required `catapults` while also forbidding pluralisation in Rust), `ah-szye`
(fixture pluralisation reverted too widely). Third sighting of the same class in this repository,
and the first where the plan itself had already written the warning down.

## A plan rule that reads as total can leave its own example uncovered

**What happened.** The plan's `chainFor` rule emits the first (`reported`) step "only when
`hasReport` **and** `before !== after`". Its own increment-4 test then expects a chain of
`[none, projected]` for a studied skill the unit has never held — where `before` and `after` are
both `none`, so the stated rule emits nothing and `steps` is never set. Building the rule as
written would have failed the plan's own named test.

**Why.** Established. The rule was written for the two-figure case and the projection was added to
it afterwards; the interaction of "no reported step" with "a projection exists" was never walked.

**Cost.** About five minutes, at the point of writing the first failing test — cheap only because
the plan supplied the expected value, which is what exposed the contradiction.

**Prevent by.** Nothing new in the instructions. This is `implement-bead`'s *When the plan is
wrong* working as intended: the deviation (emit the reported step when a study reaches the tag too)
is recorded in the PR body. Worth noting for planners that a plan naming both a rule and its
expected outputs is self-checking, and that this one was caught only because it named both.

**Seen before.** None found.
