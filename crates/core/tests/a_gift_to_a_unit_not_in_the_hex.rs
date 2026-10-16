//! `ah-xaem`. A `GIVE` to a unit number nothing in the report matches gives nothing.
//!
//! The engine looks the target up in the giver's region first (`Game::DoGiveOrder`, ../Atlantis
//! `runorders.cpp`): `t = r->GetUnitId(o->target, ...)`, and with no such unit it errors
//! "Nonexistant target" and returns before a single item moves. `rules/give` adds that a unit
//! "may only give items, including silver, to a unit which it is able to see, unless the faction
//! of the target unit has declared you Friendly or better" - and our report never carries another
//! faction's declaration toward us. The navigator decided on 2026-10-16 that a target the report
//! never shows counts as not given, following the game, and that the `give-target-not-here`
//! warning stays on the line.
//!
//! The case is the one the bead was found on: Brian de Bois-Guilbert (1159), sharing, in
//! `mountain (36,4)` of the committed turn 42, told to `GIVE 99999 100 SILV`.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

const BRIAN: &str = "1159";

/// The report's own orders template, with `extra` written straight under Brian's `unit` line.
fn orders_with(extra: &str) -> String {
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let mut out = Vec::new();
    let mut placed = false;
    for line in template.lines() {
        out.push(line.to_string());
        if line.trim() == format!("unit {BRIAN}") {
            out.push(extra.to_string());
            placed = true;
        }
    }
    assert!(placed, "the template has a block for unit {BRIAN}");
    out.join("\n")
}

fn review_under(orders: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
}

fn brian(review: &TurnReview) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == BRIAN)
        .expect("Brian has a Silver row")
        .clone()
}

#[test]
fn silver_given_to_a_unit_nowhere_in_the_report_stays_with_the_giver() {
    let with_gift = review_under(&orders_with("GIVE 99999 100 SILV"));
    let without = review_under(&orders_with(""));
    let (given, plain) = (brian(&with_gift), brian(&without));

    let gifts: Vec<_> = given
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::GaveAway)
        .collect();
    assert!(
        gifts.is_empty(),
        "the hover lists no gift to unit 99999: {gifts:?}"
    );
    assert_eq!(given.expense, plain.expense, "nothing is spent on the gift");
    assert_eq!(given.at_month_end, plain.at_month_end);
    assert_eq!(
        given.shared_silver_for_orders, plain.shared_silver_for_orders,
        "no extra silver is borrowed from the sharers to fund it"
    );
    assert_eq!(given.borrowed_for_orders, plain.borrowed_for_orders);

    let warnings: Vec<&str> = with_gift
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "give-target-not-here")
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(
        warnings,
        vec![
            "unit 99999 is not in this hex to be given to, and appears nowhere else in your report"
        ],
        "the warning on the GIVE line remains"
    );
}
