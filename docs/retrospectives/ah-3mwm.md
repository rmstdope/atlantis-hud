# ah-3mwm — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-02
- **PR:** #879

## The plan said "User-facing decisions: None" for a change that had one

**What happened.** The plan prescribed the mechanism in as many words — "Use the `moved` quantity
already clamped in `apply_transfers`; never recompute a requested amount for receipts" — and
separately declared *User-facing decisions: None*. Those two cannot both hold. `moved` is clamped
against `seed_working`'s `held`, seeded from the **report's** holdings, so the moment the source is
reported holding less than it gives, the new derivation and the old one disagree about a figure the
SILVER column displays. The common shape is a tax collector: `unit 1922` reported at $0 ordering
`@TAX` then `GIVE 1923 100 SILV` credited the recipient $100 on main and $0 on the branch. I found
it only because the review round probed for it; I had taken the section at its word and had instead
read the three existing tests that broke as under-specified fixtures, which they also were.

**Why.** Established. The plan reasoned about the mechanism from the *contested* case it was filed
for — two transfers exhausting one finite stock — where clamping is plainly right, and never asked
what the same mechanism does to the *uncontested overdraw* case, where it is a visible change of
answer. A section asserting "no user-facing decisions" is a claim about every input, but it was
written from the inputs in the discrepancy report.

**Cost.** About 35 minutes: one review round to find it, a probe built and run against both heads to
confirm it was real and not a fixture artefact, a rules lookup to establish which answer is correct,
and a navigator question. Not wasted — the navigator chose the strict answer knowingly, which is a
better outcome than either shipping it silently or reverting it — but it was found by the review
rather than by the plan.

**Prevent by.** In `plan-bead`'s *User-facing decisions*, a plan that changes **how a displayed
figure is derived** should not answer "None" without naming the inputs where the old and new
derivations differ, and saying what the figure does for those. Here one line would have done it: "a
giver holding less than it gives is credited what moved, not what was asked — the recipient's
column figure drops". That is a decision to put to the navigator at planning time, not a detail for
the implementer.

**Seen before.** None with this shape. `ah-vw8e` and `ah-cw75` both record *User-facing decisions*
sections that were wrong about game syntax or stale after a revision; this is the section being
wrong about its own scope, which is a different failure.

## I twice claimed existing tests covered something without running the mutation

**What happened.** Answering the review, I wrote that "this bead's TAKE tests fail if [the mage
guard] is applied to a take". The next round mutated it: removing `is_give &&` left all 1988 tests
passing, because the only TAKE-of-men test uses a source that is not a mage and never reaches the
predicate. The behavioural decision my rebase had carried was asserted nowhere. Earlier in the same
review I had also inserted a test between `a_mage_cannot_discard_men`'s doc comment and its body,
silently reassigning that comment to my test — again found by the reviewer, not by me.

**Why.** Established, and it is the same root both times: I described what I believed the code and
the suite did instead of executing something that would tell me. Reading a test's name and fixture
is not the same as removing the guard and watching the suite.

**Cost.** Two extra review rounds, roughly 15 minutes. Cheap here only because the rounds happened;
an ungated `is_give` shipped silently would have changed what a mage's men do under TAKE with
nothing to catch it.

**Prevent by.** In `implement-bead`'s *Answering it, and going on*: an answer of the form "existing
tests already cover this" is a claim to verify before posting, by the same mutation a reviewer would
use — break the thing, watch a named test fail, restore. If the mutation leaves the suite green, the
answer is "not covered, adding a test", not a reasoned decline. Cheap to run and it is the exact
check the next round will perform anyway.

**Seen before.** `ah-ycuj` and `ah-qled.4` — both "the assertion was vacuous and only the reviewer
caught it". Same family, one step earlier: those are about writing a test that does not bite, this
is about *claiming* a test bites without checking.
