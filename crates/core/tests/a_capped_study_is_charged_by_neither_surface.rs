//! A study that cannot raise the level is charged by neither the ledger nor the SILVER column, and
//! the two read the same post-recruit unit to decide it (`ah-jzs9`).
//!
//! `data/GNOL`: "This race may study horse training [HORS], hunting [HUNT], combat [COMB], armorer
//! [ARMO], carpenter [CARP] and cooking [COOK] to level 5". `rules/skills_limitations`: the ceiling
//! is the least common denominator across the unit's races. So a unit of gnolls at combat 5 cannot
//! be taught anything by a month of `STUDY COMB`.
//!
//! The unit here also recruits gnolls from the hex's own market, because the two surfaces read the
//! composition from different places - the ledger from `Ordered::men_by_race_after_orders`, the
//! column from `UnitFacts::men_by_race_after_arrivals` - and those must be the same post-recruit
//! picture. `review_turn`'s own `silver_records_agree` debug assertion is the other half of that:
//! it panics if the ledger and the column book different `Studied` movements, so this test
//! reaching its assertions at all is the two surfaces having agreed.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex selling gnolls, and two units of gnolls at combat 5 holding 900 silver each: one that
/// recruits this month and one that does not.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (36,44) in Blarnfashire, 1000 peasants (gnolls), $500.",
        "  For Sale: 20 gnolls [GNOL] at $40.",
        "",
        "Exits:",
        "  Southeast : plain (37,45) in Blarnfashire.",
        "",
        "* Drones (8573), Foo (1), 60 gnolls [GNOL], 900 silver [SILV]. Weight: 600. \
         Capacity: 0/0/900/0. Skills: combat [COMB] 5 (450).",
        "* Veterans (8574), Foo (1), 60 gnolls [GNOL], 900 silver [SILV]. Weight: 600. \
         Capacity: 0/0/900/0. Skills: combat [COMB] 5 (450).",
        "",
    ]
    .join("\n")
}

fn silver_for(text: &str, script: &str, unit_id: &str) -> UnitSilver {
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset());
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\n{script}");

    review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default())
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the silver column has a row for unit {unit_id}"))
}

/// The recruiter and the unit beside it are told apart only by this month's `BUY`, so a surface
/// reading a *pre*-recruit picture would have to give them the same answer. They must not get one.
#[test]
fn the_two_surfaces_read_the_same_post_recruit_unit() {
    let script = "unit 8573\nBUY 5 GNOL\nSTUDY COMB\nunit 8574\nSTUDY COMB\n";
    let text = report();

    // `rules/skills_studying` counts a skill's points per man, so five recruits spread 450 points
    // across 65 men and the unit is no longer at combat 5 - it may study, and it is charged.
    let recruited = silver_for(&text, script, "8573");
    assert_eq!(
        recruited.no_study_fee, None,
        "the recruits took this unit back below its ceiling: {recruited:?}"
    );
    assert_eq!(
        recruited.expense,
        Some(850),
        "$200 of recruits and 65 men studying at $10"
    );

    // Its neighbour, identical but for the `BUY`, is still at the ceiling and owes nothing.
    let steady = silver_for(&text, script, "8574");
    let reason = steady
        .no_study_fee
        .as_ref()
        .unwrap_or_else(|| panic!("the month teaches this unit nothing: {steady:?}"));
    assert_eq!(reason.skill_name, "combat");
    assert_eq!(reason.ceiling_level, 5);
    assert_eq!(
        reason.limiting_races,
        Vec::new(),
        "`data/GNOL` allows combat to 5 and that is combat's own maximum, so no race is blamed"
    );
    assert_eq!(steady.expense, Some(0), "nothing is spent at all");
    assert_eq!(steady.at_month_end, Some(900), "and nothing leaves the purse");
    assert_eq!(steady.doubt, None, "nothing here is uncertain");
}

/// A unit one level short of the ceiling is charged exactly as it always was.
#[test]
fn a_unit_below_the_ceiling_is_still_charged() {
    let text = report().replace("combat [COMB] 5 (450)", "combat [COMB] 4 (300)");
    let silver = silver_for(&text, "unit 8574\nSTUDY COMB\n", "8574");

    assert_eq!(silver.no_study_fee, None);
    assert_eq!(silver.expense, Some(600), "60 men at combat's $10 a month");
}
