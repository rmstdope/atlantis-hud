# ah-o7td — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-29
- **PR:** #802

## A new advisory check fired on eleven fixtures written for other checks, in four shared helpers

**What happened.** Every increment the plan named was built and green in order. The moment
`check_two_month_long_orders` was registered in `review_turn`, eleven unrelated `orders::semantics`
tests failed: `a_unit_with_two_study_orders_is_counted_once`, `the_finding_sits_on_the_study_line`,
`the_warning_lands_on_the_first_produce_in_the_document`,
`a_unit_building_is_not_offered_as_a_spare_teacher`, `wages_still_cannot_pay_for_an_order` and six
more. Each gives one unit two month-long orders — `WORK` above a `STUDY`, two `STUDY` lines, a
`TEACH` beside a `BUILD` — because that is the smallest way to exercise what the test is actually
about. The new check was right about every one of them.

The plan was thorough about the *code* — it named all four `PlacedIntent` literal sites, the
hard-coded `codes::ALL` length, the generated TypeScript, the `WARNING_GROUPS` entry and the
`every_advisory_code_can_be_silenced` `Case`. It said nothing about the module's own fixtures.

**Why.** An advisory check that fires on a common, incidental order shape collides with every
fixture that used that shape as scenery. This module's house answer is already established — the
shared `check` helper disables `unit-does-nothing`, and `check_ignoring_transfer_targets` disables
`give-target-not-here`, both with comments saying why — but a plan that does not name it leaves the
implementer to rediscover both the collision and the idiom mid-increment. Four helpers needed the
new code disabled here (`check`, `quartermasters`, `check_trade`, `check_ignoring_empty_builds`),
and the check's own fixtures needed a fifth helper that leaves it on.

**Cost.** About fifteen minutes and three full `cargo test --lib` rounds, entirely local. Notably
cheaper than the two earlier sightings below, which each cost CI cycles: this check is Rust-only
with no new UI, so `check:fast` caught the whole collision before the PR opened. Nothing reached CI.

**Prevent by.** A plan that adds a **default-on advisory check** should carry an explicit increment
for the existing fixtures it will fire on, before the increment that registers it — naming the
shared test helpers in `crates/core/src/orders/semantics.rs`'s `mod tests` that will need the new
code added to their `disabling_all` list, and the dedicated helper the new check's own fixtures will
use. `plan-bead`'s *Files to change* section is where that belongs, beside the `codes::ALL` length
and the generated TypeScript it already names. A cheap way for a planner to size it without reading
every fixture: grep the module's tests for the order shapes the new check fires on.

**Seen before.** `ah-dwk6` — "A new default-on check broke thirty-odd fixtures the plan did not
name, in two suites" (`unit-does-nothing`, 26 unit tests plus 9 smoke specs, two CI cycles).
`ah-vkut` — "A new advisory check fired on six fixtures written for other checks"
(`build-outside-structure` / `build-help-not-building`, six unit tests). This is the third sighting,
and the first caught entirely before CI.
