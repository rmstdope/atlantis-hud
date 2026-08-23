# ah-fvzu — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #638

## A sibling bead merged mid-build and would have paid one unit twice, and only the conflict markers said so

**What happened.** `ah-gjq4` ("an idle unit works by default and earns the region's wage") merged
onto main while this bead was in review. Both beads answer the same question — *does this unit
spend its month?* — and neither plan knew about the other: `ah-fvzu`'s was written on 2026-08-23,
`ah-gjq4` landed the day after. The rebase conflicted in four files, but every conflict was
textually trivial (two new `UnitSilver` fields landing on the same line, two new hover branches
landing in the same `if` chain), and resolving each by keeping both sides compiled, passed the
whole gate, and was **wrong**: `works_by_default(intents)` reads the orders alone, so a unit taxing
by its flag — which has no orders at all — was both credited its tax and set to work for the
region's wage. One unit, two months' pay. Caught by reading what the incoming side actually did
rather than by any test; fixed with `is_set_to_work(flags, intents)` and
`a_flagged_taxer_is_not_also_set_to_work`.

**Why.** Established. Both beads added a "this unit's month is decided by something other than a
line in its orders" rule, and each was tested against fixtures that did not carry the other's
trigger. No corpus unit carries the taxing flag *and* an empty order block in a wage-paying
region, so `silver_agrees_with_the_warning` and `validate_real_orders` were both green over the
double credit. A green gate after a conflicted rebase is evidence about text, not about meaning.

**Cost.** About twenty minutes, one extra CI cycle, and one force-push. No damage — it did not
reach main.

**Prevent by.** `implement-bead`'s *Merging* section tells you what to do when `update-branch`
returns 422 and how to resolve conflicts, but says nothing about reading them. It should: **when a
rebase conflicts inside a function your bead changed, name the incoming bead and say in the PR body
what its rule does to yours** — the conflicting hunk is the fleet's only signal that two beads
touched one decision. A planner-side half exists too: `ah-fvzu`'s plan quoted `silver.rs:495` and
`semantics.rs:529` as line numbers that had already drifted by six hundred lines when I read them,
which is the same staleness in a quieter form.

**Seen before.** `docs/retrospectives/ah-gjq4.md` is the other side of this pair and does not
mention it. None found for the general case.
