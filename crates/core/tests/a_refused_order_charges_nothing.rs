//! A STUDY the game refuses for want of funds takes nothing (`monthorders.cpp`: `Do1StudyOrder`,
//! "STUDY: Not enough funds."), so the SILVER column shows what the game leaves rather than the
//! fee: the refused order is carried on its own, struck through by the interface (`ah-rjz2`).
//!
//! The scene the navigator found it in: Borg TNG (95), turn 72. In swamp (10,50) Cebo, Drone
//! (13432) holds 24 silver, is sharing and is alone for its faction, so nobody can lend. Ordered
//! `STUDY STEA`, which costs 50 (`data/STEA`), it is refused; the refused study is still its
//! month's order, so it does not work either, and it ends the month at 24 less its upkeep.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{RefusedSpend, SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::{ruleset, without_standing_month_orders};

/// Turn 72's own orders, with `extra` written under Drone.
fn review(extra: &str) -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G7_F95_T72.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let template = without_standing_month_orders(&template, &["13432"]);
    assert_eq!(template.matches("unit 13432\n").count(), 1);
    let orders = template.replace("unit 13432\n", &format!("unit 13432\n{extra}"));
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn drone(review: &TurnReview) -> &UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == "13432")
        .expect("Drone is forecast")
}

#[test]
fn a_refused_study_is_handed_back_to_the_column() {
    let review = review("STUDY STEA\n");
    let drone = drone(&review);
    assert_eq!(drone.held, 24, "{drone:?}");
    assert_eq!(
        drone.at_month_end,
        Some(24),
        "no fee is taken, and a refused study works nothing either: {drone:?}"
    );
    // The cell the navigator agreed is 24 → 14: the month's end less this upkeep.
    assert_eq!(drone.upkeep, Some(10), "{drone:?}");
    assert_eq!(drone.short_for_orders, Some(0), "{drone:?}");
    assert_eq!(drone.short_on, None, "{drone:?}");
    assert!(
        drone
            .changes
            .iter()
            .all(|change| change.cause != SilverChangeCause::Studied
                && change.cause != SilverChangeCause::Worked),
        "{:?}",
        drone.changes
    );
    assert_eq!(
        drone.refused,
        vec![RefusedSpend {
            cause: SilverChangeCause::Studied,
            line: drone.refused.first().and_then(|spend| spend.line),
            cost: 50,
            available: 24,
            after_spending: false,
        }]
    );
    assert!(drone.refused[0].line.is_some(), "{:?}", drone.refused);
    // The warnings still read the refusal exactly as before (`ah-wr2w`).
    assert!(
        review
            .findings
            .iter()
            .any(|finding| finding.unit_id.as_deref() == Some("13432")
                && finding.message.contains("this STUDY is refused")),
        "{:#?}",
        review.findings
    );
}

#[test]
fn a_study_that_goes_ahead_is_charged_as_before() {
    let review = review("CLAIM 100\nSTUDY STEA\n");
    let drone = drone(&review);
    assert!(drone.refused.is_empty(), "{drone:?}");
    assert!(
        drone
            .changes
            .iter()
            .any(|change| change.cause == SilverChangeCause::Studied && change.amount == -50),
        "{:?}",
        drone.changes
    );
}
