//! A sharing captain that sails in and pays a passenger's STUDY where its fleet lands names the
//! passenger and that hex, as the passenger's own line names the captain (`ah-mqbu`,
//! `docs/ui/ah-mqbu-captain-lent.html`).
//!
//! `neworigins-3.0.0-g5-f21-t24`, the bead's repro: the template orders plus `SHARE 0` on
//! Drones (9508) and Drones (9579) in ocean (38,44). Raft [235]'s captain Drones (10575), sharing
//! with 2180 silver, sails se ne from Lonthax (36,44) carrying Drones (10594), who orders STUDY
//! FISH. `rules/sequenceofevents` processes "ADVANCE, MOVE and SAIL orders" before "STUDY
//! orders", and `rules/share` lends to units "in the same region", so 10575 pays the fee in ocean
//! (38,44), where its fleet lands.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

fn review() -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let mut orders = String::new();
    for line in template.lines() {
        orders.push_str(line);
        orders.push('\n');
        let line = line.trim().to_lowercase();
        if line == "unit 9508" || line == "unit 9579" {
            orders.push_str("SHARE 0\n");
        }
    }
    assert_eq!(
        orders.matches("SHARE 0\n").count(),
        2,
        "both units take SHARE 0"
    );
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn row_of<'a>(review: &'a TurnReview, unit_id: &str) -> &'a UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} is forecast"))
}

type Line = (Option<String>, Option<String>, Option<String>, i64);

/// Each `cause` line of `row`, as `(other, place, lands, amount)`.
fn lines(row: &UnitSilver, cause: SilverChangeCause) -> Vec<Line> {
    row.changes
        .iter()
        .filter(|change| change.cause == cause)
        .map(|change| {
            (
                change.other.clone(),
                change.place.clone(),
                change.lands.clone(),
                change.amount,
            )
        })
        .collect()
}

fn some(text: &str) -> Option<String> {
    Some(text.to_string())
}

/// The captain's side: "lent -200 · to Drones (10594), where its fleet lands in ocean (38,44)".
#[test]
fn the_captains_line_names_its_passenger_where_its_fleet_lands() {
    assert_eq!(
        lines(row_of(&review(), "10575"), SilverChangeCause::Lent),
        vec![(some("Drones (10594)"), None, some("ocean (38,44)"), -200)]
    );
}

/// The passenger's side is unchanged: "was lent +200 · by Drones (10575), where its fleet lands
/// in ocean (38,44)".
#[test]
fn the_passengers_line_still_names_the_captain() {
    assert_eq!(
        lines(row_of(&review(), "10594"), SilverChangeCause::WasLent),
        vec![(some("Drones (10575)"), some("ocean (38,44)"), None, 200)]
    );
}

/// A resident lender keeps the `ah-kjq5` wording: Drones (9506) pays Drones (10599), arriving by
/// fleet from Lonthax (36,44).
#[test]
fn a_resident_lender_still_names_the_hex_its_passenger_sails_from() {
    assert_eq!(
        lines(row_of(&review(), "9506"), SilverChangeCause::Lent),
        vec![(some("Drones (10599)"), some("Lonthax (36,44)"), None, -200)]
    );
}
