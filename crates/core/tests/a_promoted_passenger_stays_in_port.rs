//! A passenger whose fleet will not sail is judged in the hex it stays in (`ah-d8qy`,
//! `docs/ui/ah-d8qy-passenger-stays.html`).
//!
//! `neworigins-3.0.0-g5-f21-t24`, the bead's repro: Raft [235] in Lonthax (36,44), owner Drones
//! (10575), passenger Drones (10594). With `sail se ne`, `PROMOTE 10594`, `EVICT 10594` the new
//! owner sets no course: `rules/sail` sails a fleet "in the directions given" only for its owner,
//! and `rules/sequenceofevents` runs PROMOTE before movement, so nobody leaves Lonthax and
//! `rules/share` lends 10594 only what units "in the same region" have.

use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn review() -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let course = "sail se ne\n";
    assert_eq!(
        template.matches(course).count(),
        1,
        "the template sails Raft [235] once, by 10575"
    );
    let orders = template.replace(course, "sail se ne\nPROMOTE 10594\nEVICT 10594\n");
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn row_of<'a>(review: &'a TurnReview, unit_id: &str) -> &'a UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} is forecast"))
}

/// Each loan line on `row`, borrowed or lent, as `(cause, other, place)`.
fn loans(row: &UnitSilver) -> Vec<(SilverChangeCause, Option<String>, Option<String>)> {
    row.changes
        .iter()
        .filter(|change| {
            matches!(
                change.cause,
                SilverChangeCause::WasLent
                    | SilverChangeCause::WasLentForUpkeep
                    | SilverChangeCause::Lent
                    | SilverChangeCause::LentForUpkeep
            )
        })
        .map(|change| (change.cause, change.other.clone(), change.place.clone()))
        .collect()
}

/// The passenger's popup loses the loans from ocean (38,44): none of its lines names a place or
/// Drones (9508), and it is not marked as borrowing where its fleet lands.
#[test]
fn the_passenger_borrows_only_in_the_hex_it_stays_in() {
    let review = review();
    let passenger = row_of(&review, "10594");
    assert_eq!(passenger.borrowed_where_fleet_lands, None, "{passenger:?}");
    for (cause, other, place) in loans(passenger) {
        assert_eq!(place, None, "{cause:?} from {other:?}");
        assert_ne!(other.as_deref(), Some("Drones (9508)"), "{cause:?}");
    }
}

/// The landing hex's lender no longer lends to the passenger.
#[test]
fn the_landing_hexs_lender_no_longer_names_the_passenger() {
    let review = review();
    for (cause, other, _) in loans(row_of(&review, "9508")) {
        assert_ne!(other.as_deref(), Some("Drones (10594)"), "{cause:?}");
    }
}

/// The fleet's own "will not sail" finding is unchanged.
#[test]
fn the_fleet_still_will_not_sail() {
    let review = review();
    assert!(
        review.findings.iter().any(|finding| {
            finding.code == codes::SAIL_NOT_BY_OWNER
                && finding.unit_id.as_deref() == Some("10575")
                && finding.message.ends_with("so the ship will not sail.")
        }),
        "{:?}",
        review.findings
    );
}
