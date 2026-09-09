//! Unit 9498's `BUY ALL` in a sharing hex is sized by a purse the hex can actually produce
//! (`ah-3c2t.1`).
//!
//! `rules/share`: *"a unit with a supply of silver could automatically provide silver if any of
//! your other units in the same region does not have enough to perform an action, such as
//! studying, buying or producing."* The pool is real; what was wrong was which money was in it.
//!
//! `rules/buy`: *"If the unit can't afford as many as [quantity], it will attempt to buy as many as
//! it can."* So the cap has to be right, or a player is shown goods the game will refuse.
//!
//! The defect this pins was measured on a real turn: in `plain (36,44)` in Blarnfashire, unit
//! `9498` "Drones" holds $0, shares, and was shown buying the whole line of 389 gnolls against a
//! purse of $232,238 - a figure carrying every sharer's *hopeful* tax, most of which its own
//! faction-mates will take instead. It finished the month at about -$21,707.
//!
//! The turn's own orders document has unit 9498 studying rather than buying, so this test adds the
//! `BUY ALL` the measurement was taken with - one line, into the real document, so every other
//! unit's orders (and so the hex's tax settlement) are the turn's own.
//!
//! Deliberately asserted as inequalities rather than as an exact quantity: the settled figure
//! depends on how many of that hex's sharers tax, and pinning it would make this test a
//! restatement of the implementation rather than of the defect.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// What the ledger reported for unit 9498 before this bead.
const HOPEFUL_PURSE: i64 = 232_238;
#[test]
fn unit_9498_buys_against_a_settled_purse() {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G5_F21_T39.text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(atlantis_hud_fixtures::G5_F21_T39.text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let orders = template.replace("unit 9498\n", "unit 9498\nbuy all gnol\n");
    assert_ne!(orders, template, "the BUY ALL reached unit 9498's orders");

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());

    let row = review
        .silver
        .iter()
        .find(|row| row.unit_id == "9498")
        .expect("unit 9498 is forecast");
    let shown = row
        .buy_all
        .first()
        .expect("unit 9498's BUY ALL line is shown");

    assert!(
        shown.silver_available < HOPEFUL_PURSE,
        "the purse is settled, not hopeful: {} is still the whole hex's tax base",
        shown.silver_available
    );
}
