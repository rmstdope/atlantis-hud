//! A `SELL` of goods the region's `Wanted` list does not carry, read across **both** walks that
//! answer for one unit's month (`ah-jo6b.3`).
//!
//! `rules/sell`: *"Attempt to sell the amount given of the item given. ... If more of the item are
//! on sale (by all the units in the region) than are wanted by the region, the number sold per
//! unit will be split up in proportion..."* - a region buys what it wants and nothing else, so a
//! `SELL` of goods it does not want sells none and earns nothing. That is a followed order whose
//! answer is zero, not a sum the ledger could not follow.
//!
//! `rules/buy`: *"If the second form is specified, the unit will attempt to buy as many as it can
//! afford."*

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, an optional market line, and whatever own units the caller names.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn report(region: &str, market: &[&str], units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        region.to_string(),
    ];
    lines.extend(market.iter().map(|line| format!("  {line}")));
    lines.extend([
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ]);
    lines.extend(units.iter().map(|unit| (*unit).to_string()));
    lines.push(String::new());
    lines.join("\n")
}

/// The whole review for one order script, so a test can read the column and the findings from one
/// pass - they are computed together and must agree.
fn review_of(text: &str, script: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    review_turn(
        &parsed,
        &format!("{template}\n{script}"),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn row_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the column has a row for unit {unit_id}"))
        .clone()
}

/// How many of `tag` the ITEMS preview leaves `unit_id` holding.
fn preview_holding(text: &str, script: &str, unit_id: &str, tag: &str) -> i64 {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &format!("{template}\n{script}"),
    )
    .expect("the committed ruleset loads");
    preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the preview has unit {unit_id}"))
        .unit
        .items
        .iter()
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum()
}

/// A quiet region: nothing to tax, nothing to pillage, no wages worth having.
const QUIET: &str = "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.";

/// A `SELL` the market refuses used to mark the unit `doubted`, and `settle_buy_all` drops a
/// doubted unit's whole deferred purchase (`semantics.rs`, `settle_buy_all`). With the doubt gone
/// the purchase settles again, and both surfaces describe one month (`ah-jo6b.3`).
#[test]
fn a_refused_sale_no_longer_deletes_the_buy_all() {
    let text = report(
        QUIET,
        &["Wanted: 100 grain [GRAI] at $10.", "For Sale: 10 iron [IRON] at $5."],
        &["* Traders (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 10 furs [FUR]. Weight: 130. Capacity: 0/0/150/0."],
    );
    let script = "unit 900\nSELL 10 fur\nBUY ALL iron\n";

    assert_eq!(
        preview_holding(&text, script, "900", "IRON"),
        10,
        "the deferred purchase settles again"
    );
    assert_eq!(
        preview_holding(&text, script, "900", "FUR"),
        10,
        "the refused sale moved no goods"
    );

    // The spend is the SILVER column's to state, not the ITEMS cell's: the ITEMS preview shows
    // silver unmoved for every unit that BUYs (`effects.rs`, the FORM case that says so in as
    // many words). So the 50 the iron cost is read off the column, which is also where a doubt
    // would have blanked it.
    assert_eq!(
        preview_holding(&text, script, "900", "SILV"),
        100,
        "a purchase's spend is not an ITEMS movement"
    );
    let row = row_of(&review_of(&text, script), "900");
    assert_eq!(row.doubt, None, "and the SILVER column never doubted it");
    assert_eq!(
        row.expense,
        Some(50),
        "the ten iron at $5 are priced, which a doubted unit's dropped BUY ALL never was"
    );
}

/// `ah-jo6b`'s case 4 - a `GIVE` of a class the catalogue resolves and says holds no silver - is
/// already closed: `class_tags` expands exactly the classes `class_carries_silver` can answer for,
/// so the ledger counts the gift where the column continues. Pinned here across both surfaces so
/// it cannot reopen (`ah-jo6b.3`).
#[test]
fn a_gift_of_a_class_that_holds_no_silver_is_counted_on_both_surfaces() {
    assert!(
        ruleset().class_members("WEAPON").is_some(),
        "the committed catalogue must state WEAPON's members, or this test pins nothing"
    );

    let text = report(
        QUIET,
        &[],
        &[
            "* Givers (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 5 swords [SWOR]. Weight: 130. Capacity: 0/0/150/0.",
            "* Hands (901), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        ],
    );
    let script = "unit 900\nGIVE 901 ALL WEAPONS\n";

    assert_eq!(row_of(&review_of(&text, script), "900").doubt, None);
    assert_eq!(preview_holding(&text, script, "900", "SWOR"), 0);
    assert_eq!(preview_holding(&text, script, "901", "SWOR"), 5);
    assert_eq!(
        preview_holding(&text, script, "900", "SILV"),
        100,
        "a weapons class carries no silver out"
    );
}
