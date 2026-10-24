//! A `SELL` of more than the unit can draw on, read off the two real reports where exploratory
//! testing met it (`ah-q51d`), and on a small report of its own for the part-held case.
//!
//! `rules/sell`: *"If the unit does not have as many of the item as it is trying to sell, it will
//! attempt to sell all that it has."* The engine says so in the turn report too
//! (`../Atlantis/runorders.cpp`, `Game::DoSell`: "SELL: Unit attempted to sell more than it had."),
//! so the player is warned before sending the orders - and the month's figures stay what the game
//! will actually do: it sells what there is.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding, TurnReview};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

fn review_of(text: &str, orders: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
}

fn orders(faction: &str, unit: &str, line: &str) -> String {
    format!("#atlantis {faction} \"<password>\"\n\nunit {unit}\n{line}\n")
}

/// The `not-enough-items` findings on the order's one `SELL` line (line 4 of [`orders`]).
fn oversold(review: &TurnReview, unit: &str) -> Vec<Finding> {
    oversold_on(review, unit, 4)
}

/// The `not-enough-items` findings `unit` carries on order line `line`.
fn oversold_on(review: &TurnReview, unit: &str, line: usize) -> Vec<Finding> {
    review
        .findings
        .iter()
        .filter(|finding| {
            finding.code.as_str() == "not-enough-items"
                && finding.unit_id.as_deref() == Some(unit)
                && finding.line == Some(line)
        })
        .cloned()
        .collect()
}

fn row_of(review: &TurnReview, unit: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit)
        .unwrap_or_else(|| panic!("the column has a row for unit {unit}"))
        .clone()
}

/// Case 1: `Seven of Eight (18642)` in Inholm `(7,53)` holds no leather armor and no faction-mate
/// stands in the hex to lend any, while the market wants it.
#[test]
fn selling_goods_the_unit_does_not_hold_is_warned() {
    let text = atlantis_hud_fixtures::G7_F95_T71.text;
    let review = review_of(text, &orders("95", "18642", "SELL 5 LARM"));

    let found = oversold(&review, "18642");
    assert_eq!(
        found.len(),
        1,
        "one warning on the SELL line: {:#?}",
        review.findings
    );
    assert_eq!(
        found[0].message,
        "short 5 leather armor: this unit can have 0 and this order sells 5"
    );

    // Selling what is not there earns nothing: the silver row is the one an empty month gives.
    let quiet = review_of(text, &orders("95", "18642", ""));
    assert_eq!(row_of(&review, "18642"), row_of(&quiet, "18642"));
}

/// Case 2 as reported: `Transporter (2418)` in Aportheo `(36,4)` holds 36 livestock and is ordered
/// to sell 50 - but sharing faction-mates in the hex hold more, and `Game::DoSell` cuts the line to
/// `Unit::GetSharedNum`, which counts every sharer's stock (`../Atlantis/unit.cpp`; `rules/share`).
/// The game sells all 50 and reports nothing, so neither does this (`ah-q51d`, navigator's answer).
#[test]
fn selling_more_than_held_is_not_warned_where_sharers_cover_it() {
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let review = review_of(text, &orders("42", "2418", "SELL 50 LIVE"));
    assert!(
        oversold(&review, "2418").is_empty(),
        "{:#?}",
        oversold(&review, "2418")
    );
}

/// One hex whose market wants furs, and the units the caller names. The men must be the first item
/// on each unit's line: `count_men` reads the headcount off `items.first()`.
fn fur_market(units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.".to_string(),
        "  Wanted: 100 furs [FUR] at $10.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ];
    lines.extend(units.iter().map(|unit| (*unit).to_string()));
    lines.push(String::new());
    lines.join("\n")
}

/// The part-held case the report meant: 36 furs, nobody to lend more, `SELL 50`.
#[test]
fn selling_more_than_the_unit_holds_is_warned() {
    let text = fur_market(&[
        "* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 36 furs [FUR]. Weight: 136. Capacity: 0/0/150/0.",
    ]);
    let review = review_of(&text, &orders("1", "900", "SELL 50 FUR"));

    let found = oversold(&review, "900");
    assert_eq!(
        found.len(),
        1,
        "one warning on the SELL line: {:#?}",
        review.findings
    );
    assert_eq!(
        found[0].message,
        "short 14 furs: this unit can have 36 and this order sells 50"
    );

    // The game sells what there is, so the month reads exactly as `SELL 36` would.
    let all_of_it = review_of(&text, &orders("1", "900", "SELL 36 FUR"));
    assert_eq!(row_of(&review, "900"), row_of(&all_of_it, "900"));
    assert!(
        oversold(&all_of_it, "900").is_empty(),
        "selling exactly what is held is not warned"
    );
}

/// A sharer's stock counts toward what the seller can have, exactly as the engine counts it.
#[test]
fn a_sharer_lends_toward_what_the_seller_can_have() {
    let text = fur_market(&[
        "* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 36 furs [FUR]. Weight: 136. Capacity: 0/0/150/0.",
        "* Keepers (901), Foo (1), sharing, 10 orcs [ORC], 10 furs [FUR]. Weight: 110. Capacity: 0/0/150/0.",
    ]);
    let covered = review_of(&text, &orders("1", "900", "SELL 46 FUR"));
    assert!(
        oversold(&covered, "900").is_empty(),
        "{:#?}",
        oversold(&covered, "900")
    );

    let beyond = review_of(&text, &orders("1", "900", "SELL 50 FUR"));
    let found = oversold(&beyond, "900");
    assert_eq!(found.len(), 1, "{:#?}", beyond.findings);
    assert_eq!(
        found[0].message,
        "short 4 furs: this unit can have 46 and this order sells 50"
    );
}

/// `SELL ALL` sells whatever there is, so it can never ask for more than the unit holds.
#[test]
fn selling_all_is_never_warned() {
    let text = fur_market(&[
        "* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 36 furs [FUR]. Weight: 136. Capacity: 0/0/150/0.",
    ]);
    let review = review_of(&text, &orders("1", "900", "SELL ALL FUR"));
    assert!(oversold(&review, "900").is_empty());
}

/// `Game::GetSellAmount` cuts every line to what the market wants before `Game::DoSell` compares it
/// with what the unit can draw on (`../Atlantis/runorders.cpp`), so a line the market alone caps
/// is not an error (review of PR #1661, finding 1).
#[test]
fn a_line_the_market_caps_is_measured_after_the_cap() {
    let text = fur_market(&[
        "* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 120 furs [FUR]. Weight: 220. Capacity: 0/0/150/0.",
    ]);
    let review = review_of(&text, &orders("1", "900", "SELL 150 FUR"));
    assert!(
        oversold(&review, "900").is_empty(),
        "{:#?}",
        oversold(&review, "900")
    );

    let short = fur_market(&[
        "* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 36 furs [FUR]. Weight: 136. Capacity: 0/0/150/0.",
    ]);
    let review = review_of(&short, &orders("1", "900", "SELL 150 FUR"));
    let found = oversold(&review, "900");
    assert_eq!(found.len(), 1, "{:#?}", review.findings);
    assert_eq!(
        found[0].message,
        "short 64 furs: this unit can have 36 and this order sells 100 - the most this market takes"
    );
}

/// A sharer whose stock cannot be read lends an unknown amount, so what the seller can have is not
/// established and nothing is claimed about it - the posture the cut `GIVE` already takes
/// (`a_doubted_sharer_silences_the_stock_it_shares`; review of PR #1661, finding 2).
#[test]
fn a_doubted_sharer_silences_the_warning() {
    let text = fur_market(&[
        // The sharer first: the walk follows the report, so its doubt is in place when 900 sells.
        "* Keepers (901), Foo (1), sharing, 10 orcs [ORC], 10 furs [FUR]. Weight: 110. Capacity: 0/0/150/0.",
        "* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 36 furs [FUR]. Weight: 136. Capacity: 0/0/150/0.",
    ]);
    let script = "#atlantis 1 \"<password>\"\n\nunit 901\nSELL 1 FOOBAR\nunit 900\nSELL 40 FUR\n";
    let review = review_of(&text, script);
    let warned: Vec<&Finding> = review
        .findings
        .iter()
        .filter(|finding| {
            finding.code.as_str() == "not-enough-items" && finding.unit_id.as_deref() == Some("900")
        })
        .collect();
    assert!(warned.is_empty(), "{warned:#?}");

    // The same month with the sharer readable is covered, and silent, for the ordinary reason.
    let readable = "#atlantis 1 \"<password>\"\n\nunit 901\n\nunit 900\nSELL 40 FUR\n";
    assert!(oversold_on(&review_of(&text, readable), "900", 6).is_empty());
}
