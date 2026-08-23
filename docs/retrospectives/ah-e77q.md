# ah-e77q — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #596

## "Remove the term from `late_income`", followed literally, would have deleted the income

**What happened.** The plan's instruction for Phantasmal Entertainment was *"Remove the Phantasmal
Entertainment term from it"* — `it` being `late_income` — and said nothing about where the earning
should go instead. But `forecast_unit` folds `late` into `income`
(`income = income.saturating_add(late)`), and the `Cast` arm's `PHEN` branch was an empty `{}`
deferring to `late_income`. Removing the term alone would have made the spell earn nothing at all
rather than earn in time, which is the opposite of the decision the bead exists to implement. The
move into the `Cast` arm had to be inferred from increment 4's test expectation
(`income Some(1200)`, `late_income Some(0)`).

**Why.** The plan described the change as a deletion because that is how it looks in `late_income`,
without stating the invariant that a term deleted there is a term that stops being counted anywhere.

**Cost.** Small — perhaps ten minutes of reading `forecast_unit`'s income assembly before writing
anything, and the deviation had to be argued in the PR body. A second, related surprise came from
the same change: retiring `SilverDoubt::UnpricedSpell` and moving `PHEN` left the `ruleset`
parameter dead in both `late_income` and `semantics::charge_upkeep`, which `-D warnings` fails on;
the plan called that increment "the compiler is the test" but did not anticipate the parameter
cascade. That cost one failed `check:fast` run, about five minutes.

**Prevent by.** A plan that moves a calculation between two places should name **both** ends —
"remove from X, add to Y" — rather than only the end it is leaving, whenever the two are summed
into the same figure. Concretely, in `plan-bead`'s *Files to change* guidance: where an increment
removes a term from a function whose result is added into another total, say what the term becomes,
not only that it goes.

**Seen before.** none found.
