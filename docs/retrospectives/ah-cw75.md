# ah-cw75 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-25
- **PR:** #688

## A plan revised in place kept a Validation section written against the rule the revision reversed

**What happened.** The bead was reopened by a failed verification and the plan was amended in place,
which the plan's own header says: the `avoiding` rule is reversed, the count becomes the rules'
taxing test, and two of the four warning clauses are deleted. The *Validation* section further down
was not touched, and still names the exact sentence the implementer must see by eye on the reported
report:

    cannot pillage here: needs 24 combat ready men, this region has 0 — this unit is avoiding combat, and its 19 men hold no weapons they can wield

Under the revised rule that sentence cannot occur. `Taxers (10116)` holds **combat [COMB] 1**, so all
19 of its men count and the warning reads `this region has 19` with no clause at all — the opposite
number, and no clause where the section demands one. An implementer taking the acceptance check at
face value would have concluded its correct output was a regression, and could plausibly have
"fixed" the count back toward the reversed rule to satisfy it.

**Why.** *Revise the plan in place* is the right instruction — the wording half had shipped and
should not have been rebuilt — but the revision was written as a header note plus struck-through
edits in *Files to change*, *Increments*, *User-facing decisions* and *Known traps*. *Validation* is
the one section that states a **concrete expected output**, and it is therefore the section most
certain to be invalidated by a rule change and the one that was left alone.

**Cost.** About ten minutes: the discrepancy was caught by reading the fixture for the unit's skills
before trusting the section, and it cost a paragraph in the PR body rather than a wrong
implementation. It is recorded because the failure mode it was one step away from is expensive: a
reopened P0 shipped a second time against the rule its own verification reversed.

**Prevent by.** `plan-bead`'s in-place-revision instructions should name *Validation* as a section
that must be rewritten or struck through whenever the revision changes a rule, since it is the only
section carrying a literal expected output. And `implement-bead`'s *A reopened bead* section should
say that where the plan's revision header and a later section disagree, the header governs and the
disagreement is worth stating in the PR — which is what happened here, but by judgement rather than
by instruction.

**Seen before.** `ah-19l2.2` — the plan's *Validation* section asserted a fixture fact that was not
true, and it was the bead's whole point. Same section, same class: an expected output stated in the
plan that the code was right to contradict.
