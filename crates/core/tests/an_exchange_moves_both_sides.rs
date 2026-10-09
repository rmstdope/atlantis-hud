//! `ah-mw1r.2`. A matched `EXCHANGE` between two of our units moves both sides' goods.
//!
//! `rules/exchange`: *"The orders given by the two units must be complementary. If either unit
//! involved does not have the items it is offering, or if the exchange orders given are not
//! complementary, the exchange is aborted. Men may not be exchanged."* `rules/sequenceofevents`
//! runs *"EXCHANGE orders are processed"* in the Give orders, after GIVE, TAKE and JOIN. The
//! navigator settled (2026-10-09, on `ah-mw1r`) that a foreign partner moves nothing and the line
//! is listed as uncounted, since we cannot see the partner's orders.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex: Smith (2391) with swords and a little silver, Buyer (2392) with silver, and a foreign
/// unit Mark (7001) both can see.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Smith (2391), Foo (1), orc [ORC], 100 silver [SILV], 5 swords [SWOR]. Weight: 15. \
         Capacity: 0/0/15/0.",
        "* Buyer (2392), Foo (1), orc [ORC], 80 silver [SILV]. Weight: 10. Capacity: 0/0/15/0.",
        "- Mark (7001), Bar (2), 5 orcs [ORC], 900 silver [SILV], 4 swords [SWOR].",
        "",
    ]
    .join("\n")
}

fn script_for(smith: &str, buyer: &str) -> String {
    let text = report_text();
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 2391\n{smith}\nunit 2392\n{buyer}\n")
}

fn review_of(smith: &str, buyer: &str) -> TurnReview {
    let ruleset = ruleset();
    let text = report_text();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(smith, buyer),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn silver_row(smith: &str, buyer: &str, unit_id: &str) -> UnitSilver {
    review_of(smith, buyer)
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .expect("the column has a row for the unit")
        .clone()
}

/// What the SILVER column's change list says `cause` moved for `unit_id`, summed.
fn silver_moved(smith: &str, buyer: &str, unit_id: &str, cause: SilverChangeCause) -> i64 {
    silver_row(smith, buyer, unit_id)
        .changes
        .iter()
        .filter(|change| change.cause == cause)
        .map(|change| change.amount)
        .sum()
}

/// What the ITEMS preview leaves `unit_id` holding of `tag`, and what it admitted as uncounted.
///
/// No row at all means the orders changed nothing the preview shows, so the report's own holding
/// (`unchanged`) stands and nothing is admitted.
fn preview_of(
    smith: &str,
    buyer: &str,
    unit_id: &str,
    tag: &str,
    unchanged: i64,
) -> (i64, Vec<String>) {
    let text = report_text();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &script_for(smith, buyer),
    )
    .expect("the committed ruleset loads");
    let Some(unit) = common::preview_row(&text, &preview, unit_id) else {
        return (unchanged, Vec::new());
    };
    (
        unit.unit
            .items
            .iter()
            .filter(|item| item.tag == tag)
            .map(|item| item.amount)
            .sum(),
        unit.uncounted.clone(),
    )
}

const SMITH_OFFERS: &str = "EXCHANGE 2392 5 SWOR 50 SILV";
const BUYER_ANSWERS: &str = "EXCHANGE 2391 50 SILV 5 SWOR";

#[test]
fn matching_lines_move_both_items_on_the_items_preview() {
    assert_eq!(
        preview_of(SMITH_OFFERS, BUYER_ANSWERS, "2391", "SWOR", 5).0,
        0,
        "the smith's swords leave"
    );
    assert_eq!(
        preview_of(SMITH_OFFERS, BUYER_ANSWERS, "2391", "SILV", 100).0,
        150,
        "the smith is paid"
    );
    assert_eq!(
        preview_of(SMITH_OFFERS, BUYER_ANSWERS, "2392", "SWOR", 0).0,
        5,
        "the buyer gets the swords"
    );
    assert_eq!(
        preview_of(SMITH_OFFERS, BUYER_ANSWERS, "2392", "SILV", 80).0,
        30,
        "the buyer pays"
    );
}

#[test]
fn matching_lines_move_the_silver_on_the_silver_column() {
    assert_eq!(
        silver_moved(
            SMITH_OFFERS,
            BUYER_ANSWERS,
            "2391",
            SilverChangeCause::WasGiven
        ),
        50
    );
    assert_eq!(
        silver_moved(
            SMITH_OFFERS,
            BUYER_ANSWERS,
            "2392",
            SilverChangeCause::GaveAway
        ),
        -50
    );
    let smith = silver_row(SMITH_OFFERS, BUYER_ANSWERS, "2391");
    let buyer = silver_row(SMITH_OFFERS, BUYER_ANSWERS, "2392");
    let (smith_before, buyer_before) = (silver_row("", "", "2391"), silver_row("", "", "2392"));
    assert_eq!(
        smith
            .at_month_end
            .zip(smith_before.at_month_end)
            .map(|(a, b)| a - b),
        Some(50),
        "{smith:?}"
    );
    assert_eq!(
        buyer
            .at_month_end
            .zip(buyer_before.at_month_end)
            .map(|(a, b)| a - b),
        Some(-50),
        "{buyer:?}"
    );
}

/// `rules/sequenceofevents` runs EXCHANGE after GIVE: silver the buyer is given this month pays
/// for the swords, though it holds none of it on the report.
#[test]
fn an_exchange_is_funded_by_this_months_gifts() {
    let smith = format!("{SMITH_OFFERS}\nGIVE 2392 100 SILV");
    let buyer = "EXCHANGE 2391 50 SILV 5 SWOR\nGIVE 2391 80 SILV";
    // The buyer gives its own 80 away and is handed the smith's 100, so holds 100 at the exchange.
    assert_eq!(preview_of(&smith, buyer, "2392", "SWOR", 0).0, 5);
    assert_eq!(preview_of(&smith, buyer, "2392", "SILV", 80).0, 50);
    assert_eq!(preview_of(&smith, buyer, "2391", "SILV", 100).0, 130);
}

#[test]
fn mismatched_lines_move_nothing() {
    let buyer = "EXCHANGE 2391 50 SILV 6 SWOR";
    assert_eq!(preview_of(SMITH_OFFERS, buyer, "2391", "SWOR", 5).0, 5);
    assert_eq!(preview_of(SMITH_OFFERS, buyer, "2392", "SWOR", 0).0, 0);
    assert_eq!(preview_of(SMITH_OFFERS, buyer, "2392", "SILV", 80).0, 80);
    assert_eq!(
        silver_moved(SMITH_OFFERS, buyer, "2392", SilverChangeCause::GaveAway),
        0
    );
}

#[test]
fn an_offer_the_unit_cannot_cover_moves_nothing() {
    let smith = "EXCHANGE 2392 5 SWOR 90 SILV";
    let buyer = "EXCHANGE 2391 90 SILV 5 SWOR";
    assert_eq!(preview_of(smith, buyer, "2391", "SWOR", 5).0, 5);
    assert_eq!(preview_of(smith, buyer, "2392", "SILV", 80).0, 80);
    assert_eq!(
        silver_moved(smith, buyer, "2391", SilverChangeCause::WasGiven),
        0
    );
}

#[test]
fn a_foreign_partner_moves_nothing_and_is_listed_uncounted() {
    let smith = "EXCHANGE 7001 5 SWOR 50 SILV";
    let (swords, uncounted) = preview_of(smith, "", "2391", "SWOR", 5);
    assert_eq!(swords, 5);
    assert_eq!(uncounted, vec![smith.to_string()]);
}

/// The control: matched lines are not uncounted, so the foreign case is not passing on a
/// fixture that is uncountable for some other reason.
#[test]
fn a_matched_exchange_is_counted() {
    let (_, uncounted) = preview_of(SMITH_OFFERS, BUYER_ANSWERS, "2391", "SWOR", 5);
    assert!(uncounted.is_empty(), "{uncounted:?}");
}
