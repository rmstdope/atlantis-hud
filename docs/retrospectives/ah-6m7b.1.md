# ah-6m7b.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-08
- **PR:** #1072

## The plan's third increment named a fixture that cannot exist, and nothing said so until it was built

**What happened.** Increment 3's failing test was to be a `BUY ALL grain` written above a
`PRODUCE catapult`, with the plan predicting the SILVER column would make one catapult and the ITEMS
column none. Built exactly as specified, both surfaces answered *zero* and neither reached the cap
the increment was about. `cargo test -p atlantis-hud-core --test silver_for_a_production` said only
that the control row failed, which reads like an arithmetic mistake in the fixture; five rounds of
probing found the real cause. `recruited_people` (`semantics.rs:3167-3178`) returns `None` for
**any** `Intent::Buy { amount: Amount::All, .. }` — not only a buy of men — so the unit's skills
become `Unknowable`, `production_skills_unknown` is set, and the `PRODUCE` arm `continue`s at
`silver.rs:1848` **before** any silver cap is read. I then tried the plan's other two disagreement
classes as substitutes; both need a `TAX`, which is a full-month order and cannot sit beside a
month-long `PRODUCE`, so a taxing unit's `PRODUCE` earns nothing to be capped against. There is no
reachable case today in which that cap's two figures differ.

**Why.** The plan established, carefully and correctly, that the two *surfaces* disagree in three
named classes. It did not check that any of those classes can reach the *line* the increment
changes. Those are different claims, and the second is the one an increment's RED test depends on: a
guard several hundred lines above the cap decides whether the cap is ever consulted, and no amount of
care about the cap itself surfaces it.

**Cost.** About forty minutes of probe-and-revert against a fixture that could never go green, plus a
question to the navigator and a scope decision they had to take mid-run.

**Prevent by.** When a plan's increment names two orders that must appear in one unit's block, its
*Increments* section should state which phase-class each order is (`rules/sequenceofevents`:
full-month, month-long, or instant) and name every doubt guard between the top of that order's arm
and the line being changed — `production_skills_unknown` and the `uncertain_after_gifts` guards in
`silver.rs` are the ones this file has. Reading the arm from its first line to the changed line, not
just around the change, is what the *Known traps* re-reading step should cover. This plan already
required re-reading every *ordering* claim before its increment; the same discipline applied to
*reachability* would have caught it before a line was written.

**Seen before.** `docs/retrospectives/ah-gdd3.1.md` — a plan's parenthetical about current behaviour
in this same function was false and was followed into a regression. Same family, same file, same
shape: a confident claim about how the existing code behaves, taken on trust because the plan was
detailed everywhere else.
