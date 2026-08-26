# ah-dxfd.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #714

## The plan's own description of an existing test's fixture did not match the fixture

**What happened.** The plan's test plan said `doubt_carries_to_the_next_unit_along`
(`semantics.rs`) "must pass unchanged" and explained why: it "takes from 999, a unit this hex does
not show, and still doubts the taker." The actual fixture included `unit("999")` in the region -
own, visible, just holding no `HUMN`. Implementing the plan's `apply_gifts_of_men` restructuring
exactly as written (resolve the TAKE's source via `resolve_give_target`, doubt only on
`GiveTarget::Nowhere`) made this specific TAKE resolve successfully (999 was found), move zero men
(it had none of the tag), and the doubt chain the test exists to prove stopped propagating - the
test failed.
**Why.** The plan's own rationale ("a unit this hex does not show") only holds if 999 is absent
from the region. It was not, in the fixture as written before this bead. Most likely the planner
traced the intended new behaviour correctly but did not verify it against the literal fixture
content, or conflated it with one of several other "999" unshown-source fixtures elsewhere in the
same file that behave the way described.
**Cost.** About fifteen minutes: writing the restructured `apply_gifts_of_men`, running the four
increment-6 tests, tracing by hand why this one broke, and confirming the fix (removing `unit("999")`
from the region) restores both the letter of the plan's rationale and the test's assertion.
**Prevent by.** When a plan names an existing test that "must pass unchanged" and gives a reason
tied to specific fixture content, run that test against the fixture as it exists on `main` before
trusting the description - a planner writing a large restructuring plan by hand is exactly where
this kind of drift between "what I traced" and "what the code says" can slip in.
**Seen before.** None found.

## A correctness bug the plan's own reasoning did not anticipate, caught by the Copilot review

**What happened.** `settle_headcounts`'s design (as specified in the plan) assumed every unseen
increase in a unit's man-tagged items was a bought recruit, safe to dilute skills to zero for. The
Copilot review on PR #714 pointed out `TAKE FROM <unit this hex does not show> <exact quantity>
<race>`: the ledger optimistically credits that item movement (`ah-agbm`'s `taken_unshown` path,
`semantics.rs`'s `Intent::Take` arm) even though `Working::take` itself returns early (the source
isn't resolvable in this hex), so the arriving men landed in `settle_headcounts` as an "unseen
increase" and were diluted to zero skill - while the checks side (`apply_gifts_of_men`) correctly
marks the same unit `Unknowable` rather than guessing. The two surfaces disagreed.
**Why.** The plan's "why the delta is exactly the recruits" reasoning assumed a TAKE's item
movement (ledger) and men movement (`Working::take`) always land as a matched pair that cancels in
the delta. That holds when the source is resolvable in the hex; it does not when the source is
unshown, because the ledger credits the item unconditionally for a named quantity while the walker
declines to move anything at all.
**Cost.** One Copilot review round-trip: a RED test reproducing the dilution, a fix (exclude the
`taken_unshown` portion of a man-tag increase from the "assume bought" merge), a second green full
suite and `check:fast` run, and a second CI cycle. Roughly 20 minutes plus the CI wait.
**Prevent by.** When a plan's design reasons "the delta must be exactly X because A and B cancel",
check the claim against every route that can produce an unseen item increase, not just the common
one (`BUY`/`SELL`/`WITHDRAW`) - `taken_unshown` is an existing, documented seam (`ah-agbm`) that a
plan touching item-effects-to-headcount derivation should cross-check explicitly.
**Seen before.** None found.
