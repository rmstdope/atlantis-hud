//! The movement panel and the overload check agree on what a unit carries once this month's
//! transfers have run, and on what it can carry.
//!
//! Both read `movement::mode::carrying_after_transfers`; each supplies its own input - the preview
//! walker's item list (`orders::effects`) and the hex ledger's `StatePhase::Movement` holdings
//! (`orders::semantics`). The rule used to be written twice, and the check was corrected in its copy
//! three times while the panel beside it showed the right answer (`ah-titf`, `ah-0wpn`, `ah-o6qy`;
//! consolidated by `ah-2xw5`). This runs one document through both and asserts one answer, so a
//! drift in either input fails here rather than shipping.

use super::effects::preview_orders_for_remembered_report;
use super::semantics::carrying_for_tests;
use crate::cache::ReportCache;
use crate::movement::rules::Ruleset;
use crate::report::{classify_units, parse_report_full};

const RULESET: &str = atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON;

/// The Discord case (`ah-o6qy`): Riders (2871), three humans printed `Capacity: 0/0/45/0`, forms
/// two scouts and gives each one man, and Tamers (2442) gives it four horses. `newage trident
/// rules/sequenceofevents` runs GIVE before movement, so it steps off as one human and four horses.
/// `data/HUMN` weighs 10 and walks 5; `data/HORS` weighs 50 and rides and walks 20, carrying itself;
/// `data/STON` weighs 50.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (humans), $5.",
        "",
        "Exits:",
        "  North : plain (1,0) in Nowhere.",
        "",
        "* Riders (2871), Foo (1), 3 humans [HUMN]. Weight: 30. Capacity: 0/0/45/0.",
        "* Tamers (2442), Foo (1), human [HUMN], 4 horses [HORS]. Weight: 210. \
         Capacity: 0/280/295/0.",
        "* Quarry (3000), Foo (1), human [HUMN], 4 stone [STON]. Weight: 210. \
         Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

const RIDERS: &str = "unit 2442\nGIVE 2871 4 HORS\n\
                      unit 2871\nFORM 1\nEND\nFORM 2\nEND\n\
                      GIVE NEW 1 1 HUMN\nGIVE NEW 2 1 HUMN\nMOVE N\n";

/// `(weight, ride, walk)` as the unit panel shows Riders.
fn by_panel(orders: &str) -> (i64, i64, i64) {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        &report_text(),
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    let movement = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "2871")
        .and_then(|unit| unit.unit.movement)
        .expect("the panel shows Riders' movement");
    (movement.load, movement.ride, movement.walk)
}

/// `(weight, ride, walk)` as the overload check reads Riders.
fn by_check(orders: &str) -> (i64, i64, i64) {
    let ruleset = Ruleset::from_json(RULESET).expect("the ruleset loads");
    let mut report = parse_report_full(&report_text());
    classify_units(&mut report, &ruleset);
    let carrying = carrying_for_tests(&report, orders, Some(&ruleset))
        .into_iter()
        .find(|(unit_id, _)| unit_id == "2871")
        .map(|(_, carrying)| carrying)
        .expect("Riders is an own unit");
    let capacities = carrying.capacities.expect("every tag is priced");
    (
        carrying.weight.expect("the report weighs Riders"),
        capacities.ride,
        capacities.walk,
    )
}

#[test]
fn the_panel_and_the_overload_check_agree_on_the_ah_o6qy_riders() {
    // weight 30 - 2 x 10 + 4 x 50 = 210; ride 4 x 70 = 280; walk 15 + 4 x 70 = 295
    assert_eq!(by_check(RIDERS), (210, 280, 295));
    assert_eq!(by_panel(RIDERS), by_check(RIDERS));
}

#[test]
fn the_panel_and_the_overload_check_agree_when_the_riders_are_really_overloaded() {
    let orders = format!("unit 3000\nGIVE 2871 4 STON\n{RIDERS}");
    // 210 + 4 x 50 = 410 against the same 295
    assert_eq!(by_check(&orders), (410, 280, 295));
    assert_eq!(by_panel(&orders), by_check(&orders));
}
