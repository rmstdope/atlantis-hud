# ah-eacd — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #601

## The plan's predictions about which existing tests would move were both wrong, in opposite directions

**What happened.** The plan's increment 9 named two existing tests
(`a_unit_consuming_only_its_own_food_does_not_draw_on_the_pool`,
`a_unit_consuming_nothing_pays_silver_beside_a_full_pool`) and stated they would "still pass as
written" because they "assert on `unit_upkeep` / `forecast_of`, which model steps 1-2 only". Both
went red: `forecast_of` calls `review_turn`, which runs the whole payment order, and both fixtures
gave their eater **no silver at all** — precisely the case this bead's step 6 now feeds. Separately,
the plan named `crates/core/tests/validate_real_orders.rs:641` under *Known traps* as a test that
"will go red and it is not a flake", with a paragraph of instruction on how to split it. It stayed
green: the committed turn's eleven `consuming faction's food` units all stand in hexes holding no
food at all, so steps 5 and 6 cannot reach them.

**Why.** The plan reasoned about what those tests *look like they assert* rather than running them
against a sketch of the change. `forecast_of` is a two-word helper name whose body is `review_turn`;
nothing about the call site says which steps of the payment order it covers.

**Cost.** About fifteen minutes: one red test run to discover the first prediction was wrong, plus
reading two fixtures closely enough to decide the honest fix (give each eater silver, so the tests
pin the flag's *ordering* effect, which is what they were always about). The second prediction cost
nothing but a moment's doubt about whether a green test meant the wiring had not taken.

**Prevent by.** A plan that names an existing test as "will pass" or "will go red" is making a
claim it can cheaply check — `plan-bead` could ask for the assertion to be traced to the function
that actually computes it (here, one `grep -n "fn forecast_of" -A5`) before writing the prediction
down, or to say "unverified" where it did not. An implementer reading "will still pass as written"
takes it as established and is slower to suspect the plan when the test goes red.

**Seen before.** None found.
