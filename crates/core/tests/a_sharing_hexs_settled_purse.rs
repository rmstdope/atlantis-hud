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
//! **What this file is, and what it is not.** It is the real-turn guard that the settlement
//! reaches a whole turn's ledger at all. It is *not* this bead's headline evidence: on this hex
//! the settlement is worth $423 against a purse of $228,271, because the hex's units hold
//! **$160,180 in silver actually in hand** (count the `N silver [SILV]` amounts in
//! `tests/fixtures/reports/neworigins-3.0.0-g5-f21-t39.rep:1246-1330`) and the whole gnoll line
//! costs `389 * 66 = $25,674`. The bead's real proof is the constructed scenes in
//! `crates/core/src/orders/semantics.rs`'s `mod tests`
//! (`a_market_purse_lends_a_contended_sharers_settled_tax` and its neighbours), where the
//! settlement is the whole of the difference.
//!
//! **The quantity does not fall here, and that is the agreed design.** Consequence 1 of the
//! family's agreed record asks that the quantity and every money figure come from the *same* pool,
//! not that the quantity fall; consequence 2 says in terms that the buying unit keeps its red
//! month-end figure. What reconciles unit 9498's row is `ah-3c2t.2`'s `was lent` line, merged.
//! `bought == 389` is therefore asserted deliberately, so the next reader does not re-raise it —
//! cutting it would mean reopening rejected option A (*only silver already in hand counts*), which
//! the designer refused.
//!
//! The turn's own orders document has unit 9498 studying rather than buying, so this test adds the
//! `BUY ALL` the measurement was taken with - one line, into the real document, so every other
//! unit's orders (and so the hex's tax settlement) are the turn's own.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::BuyAllCap;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// What this very test measured on `origin/main` before this bead: the hopeful purse, carrying
/// every sharer's whole tax base whether or not its own faction-mates will take it instead.
///
/// Measured by checking `crates/core/src/orders/{semantics,silver}.rs` out at `origin/main` in
/// this worktree, running this test with the assertion replaced by a `println!`, and reading
/// `MEASURED silver_available=228271 bought=389 capped_by=Market` off the output. Not taken from
/// any bead's prose: the parent bead's `$232,238` was measured with a hand-written orders document
/// rather than with the turn's own template, and the two figures do not meet.
const PURSE_BEFORE_THE_SETTLEMENT: i64 = 228_271;

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
        shown.silver_available < PURSE_BEFORE_THE_SETTLEMENT,
        "the purse is settled, not hopeful: {} is not below the {PURSE_BEFORE_THE_SETTLEMENT} \
         this hex lent before the settlement",
        shown.silver_available
    );

    // Deliberate, and not an oversight: the hex holds $160,180 in hand against a $25,674 line, so
    // no rule for building the pool cuts this count. The row is reconciled by `ah-3c2t.2`'s
    // `was lent` line instead. See the module doc.
    assert_eq!(
        shown.bought, 389,
        "the whole gnoll line is still affordable"
    );
    assert_eq!(
        shown.capped_by,
        BuyAllCap::Market,
        "the line, not the silver, is still what bounds this BUY"
    );
}
