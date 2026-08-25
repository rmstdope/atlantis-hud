//! The pillage warning on the report `ah-cw75` was filed from, asserted in full.
//!
//! The navigator gave `PILLAGE` to `Taxers (10116)` in forest (36,0) of Reprau and was told
//! *"needs 24 combat ready men, this faction has 0"* about a unit visibly holding 19 high elves.
//! Two things were wrong: the count said `faction` where it counts a region, and the count itself
//! was wrong - the unit holds **combat [COMB] 1**, and the rules' taxing test makes every man of
//! such a unit a taxer whatever it wields.
//!
//! Unit tests pin both halves in isolation. This pins the sentence a player actually reads, on the
//! real report, because that is the thing the bead exists for and no isolated fixture proves it.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

#[test]
fn the_reported_pillage_warning_names_the_region_and_counts_a_combat_skilled_unit() {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G3_F42_T82.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{orders}\nunit 10116\nPILLAGE\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    let told: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "pillage-without-men")
        .map(|finding| finding.message.as_str())
        .collect();

    assert_eq!(
        told,
        vec!["cannot pillage here: needs 24 combat ready men, this region has 19"],
        "the warning the bead was filed from"
    );
}
