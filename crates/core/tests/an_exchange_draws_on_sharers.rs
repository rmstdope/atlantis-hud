//! `ah-80mj`. An `EXCHANGE` may offer what the unit's `SHARE` faction-mates in the hex hold.
//!
//! `rules/share`: a sharing unit "share[s] its possessions with any other unit of your faction that
//! needs them" for economic actions. The engine's `Game::DoExchangeOrder` (`runorders.cpp`) checks
//! an offer against `GetSharedNum` - the unit's own stock and its sharing faction-mates' - so an
//! exchange covered only by a sharer goes ahead, as a SELL covered by one does (`ah-0mch`).
//! `rules/exchange`: "If either unit involved does not have the items it is offering ... the
//! exchange is aborted."

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The orders of Smith, Buyer and Stash, in that order.
type Orders<'a> = (&'a str, &'a str, &'a str);

/// Smith (2391) holds 2 swords, Buyer (2392) 80 silver, and Stash (2393), sharing, 5 swords and
/// 100 silver; Mark (7001) is a foreign unit all three can see.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "  Wanted: 10 swords [SWOR] at $100.",
        "  For Sale: none.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Smith (2391), Foo (1), orc [ORC], 100 silver [SILV], 2 swords [SWOR]. Weight: 12. \
         Capacity: 0/0/15/0.",
        "* Buyer (2392), Foo (1), orc [ORC], 80 silver [SILV]. Weight: 10. Capacity: 0/0/15/0.",
        "* Stash (2393), Foo (1), sharing, orc [ORC], 100 silver [SILV], 5 swords [SWOR]. \
         Weight: 15. Capacity: 0/0/15/0.",
        "- Mark (7001), Bar (2), 5 orcs [ORC], 900 silver [SILV].",
        "",
    ]
    .join("\n")
}

fn script_for((smith, buyer, stash): Orders) -> String {
    let text = report_text();
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 2391\n{smith}\nunit 2392\n{buyer}\nunit 2393\n{stash}\n")
}

fn silver_row(orders: Orders, unit_id: &str) -> UnitSilver {
    let ruleset = ruleset();
    let text = report_text();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(orders),
        Some(&ruleset),
        CheckOptions::default(),
    )
    .silver
    .iter()
    .find(|row| row.unit_id == unit_id)
    .expect("the column has a row for the unit")
    .clone()
}

fn silver_moved(orders: Orders, unit_id: &str, cause: SilverChangeCause) -> i64 {
    silver_row(orders, unit_id)
        .changes
        .iter()
        .filter(|change| change.cause == cause)
        .map(|change| change.amount)
        .sum()
}

/// What the ITEMS preview leaves `unit_id` holding of `tag`; `unchanged` where it has no row.
fn holding(orders: Orders, unit_id: &str, tag: &str, unchanged: i64) -> i64 {
    preview_of(orders, unit_id, tag, unchanged).0
}

/// What the ITEMS preview leaves `unit_id` holding of `tag`, and the lines it admitted as
/// uncounted; `unchanged` and nothing where it has no row.
fn preview_of(orders: Orders, unit_id: &str, tag: &str, unchanged: i64) -> (i64, Vec<String>) {
    let text = report_text();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &script_for(orders),
    )
    .expect("the committed ruleset loads");
    common::preview_row(&text, &preview, unit_id).map_or((unchanged, Vec::new()), |unit| {
        (
            unit.unit
                .items
                .iter()
                .filter(|item| item.tag == tag)
                .map(|item| item.amount)
                .sum(),
            unit.uncounted.clone(),
        )
    })
}

/// The smith holds 2 of the 5 swords it offers; its sharing faction-mate holds the other 3.
#[test]
fn goods_a_sharer_covers_move_on_the_items_preview() {
    let smith = "EXCHANGE 2392 5 SWOR 50 SILV";
    let buyer = "EXCHANGE 2391 50 SILV 5 SWOR";
    assert_eq!(
        holding((smith, buyer, ""), "2392", "SWOR", 0),
        5,
        "the buyer gets all five"
    );
    assert_eq!(
        holding((smith, buyer, ""), "2391", "SWOR", 2),
        0,
        "the smith's own two go first"
    );
    assert_eq!(
        holding((smith, buyer, ""), "2393", "SWOR", 5),
        2,
        "the sharer lends the other three"
    );
    assert_eq!(
        holding((smith, buyer, ""), "2391", "SILV", 100),
        150,
        "the smith is paid"
    );
    assert_eq!(
        holding((smith, buyer, ""), "2392", "SILV", 80),
        30,
        "the buyer pays"
    );
    assert_eq!(
        silver_moved((smith, buyer, ""), "2391", SilverChangeCause::WasGiven),
        50,
        "the SILVER column books the payment"
    );
}

/// The buyer holds 80 of the 120 silver it offers; its sharing faction-mate covers the rest.
#[test]
fn silver_a_sharer_covers_moves_on_the_silver_column() {
    let smith = "EXCHANGE 2392 2 SWOR 120 SILV";
    let buyer = "EXCHANGE 2391 120 SILV 2 SWOR";
    assert_eq!(
        silver_moved((smith, buyer, ""), "2391", SilverChangeCause::WasGiven),
        120,
        "the smith is paid in full"
    );
    assert_eq!(
        silver_moved((smith, buyer, ""), "2392", SilverChangeCause::GaveAway),
        -120
    );
    let buyer_row = silver_row((smith, buyer, ""), "2392");
    assert_eq!(buyer_row.short_for_orders, Some(0), "{buyer_row:?}");
    assert_eq!(
        buyer_row.at_month_end,
        Some(0),
        "the buyer's own 80 go first"
    );
    let delta = |id: &str| {
        silver_row((smith, buyer, ""), id)
            .at_month_end
            .zip(silver_row(("", "", ""), id).at_month_end)
            .map(|(after, before)| after - before)
    };
    assert_eq!(delta("2393"), Some(-40), "the sharer lends the other 40");
    assert_eq!(
        holding((smith, buyer, ""), "2393", "SILV", 100),
        60,
        "the ITEMS preview shows the sharer's 40 gone too"
    );
    assert_eq!(holding((smith, buyer, ""), "2392", "SILV", 80), 0);
    assert_eq!(holding((smith, buyer, ""), "2391", "SILV", 100), 220);
    assert_eq!(
        holding((smith, buyer, ""), "2392", "SWOR", 0),
        2,
        "the buyer gets the swords"
    );
    assert_eq!(holding((smith, buyer, ""), "2391", "SWOR", 2), 0);
}

/// When what the sharer holds is in doubt - here after a gift of swords to a foreign unit whose
/// declaration toward us the report cannot show (`ah-66yi`) - whether the smith can cover its
/// offer is too: if Mark takes the 3, the smith has 2 + 2 and the exchange aborts; if he refuses
/// them, 2 + 5 and it goes ahead. Both lines are uncounted, as for a doubted holding of the
/// smith's own (`ah-mw1r.2`), and nothing is credited as certain.
#[test]
fn an_exchange_a_doubted_sharer_would_cover_is_uncounted_on_both_sides() {
    const SMITH: &str = "EXCHANGE 2392 5 SWOR 50 SILV";
    const BUYER: &str = "EXCHANGE 2391 50 SILV 5 SWOR";
    let buyer = format!("{BUYER}\nSELL 5 SWOR");
    let orders = (SMITH, buyer.as_str(), "GIVE 7001 3 SWOR");
    let (_, uncounted) = preview_of(orders, "2391", "SWOR", 2);
    assert!(uncounted.contains(&SMITH.to_string()), "{uncounted:?}");
    let (swords, uncounted) = preview_of(orders, "2392", "SWOR", 0);
    assert_eq!(swords, 0, "nothing is credited as certain");
    assert!(uncounted.contains(&BUYER.to_string()), "{uncounted:?}");
    // The transfer walk reaches the same verdict, so the buyer's SELL of swords it may never get
    // is doubted rather than counted.
    let row = silver_row(orders, "2392");
    assert!(row.doubt.is_some(), "{row:?}");
}

/// A smith whose own stock covers the offer borrows nothing, so a doubted sharer leaves the
/// exchange certain.
#[test]
fn a_doubted_sharer_does_not_doubt_an_offer_the_giver_covers_itself() {
    let orders = (
        "EXCHANGE 2392 2 SWOR 50 SILV",
        "EXCHANGE 2391 50 SILV 2 SWOR\nSELL 2 SWOR",
        "GIVE 7001 3 SWOR",
    );
    let (swords, uncounted) = preview_of(orders, "2392", "SWOR", 0);
    assert_eq!(swords, 0, "both arrive, and both are sold: {uncounted:?}");
    assert!(uncounted.is_empty(), "{uncounted:?}");
    assert_eq!(holding(orders, "2391", "SWOR", 2), 0);
    // The transfer walk agrees: the swords are there to sell.
    let row = silver_row(orders, "2392");
    assert_eq!(row.doubt, None, "{row:?}");
    assert_eq!(silver_moved(orders, "2392", SilverChangeCause::Sold), 200);
}

/// A sharer the ledger cannot add up - here after a TAKE from a unit nowhere in the hex - still
/// holds the swords the report shows: its silver is in doubt, not its swords, so the exchange it
/// covers goes ahead on both settlements.
#[test]
fn a_sharer_doubted_for_its_silver_still_covers_an_offer_of_goods() {
    let orders = (
        "EXCHANGE 2392 5 SWOR 50 SILV",
        "EXCHANGE 2391 50 SILV 5 SWOR\nSELL 5 SWOR",
        "TAKE FROM 999 ALL SILV",
    );
    let (swords, uncounted) = preview_of(orders, "2392", "SWOR", 0);
    assert_eq!(swords, 0, "all five are sold: {uncounted:?}");
    assert!(
        !uncounted.iter().any(|line| line.starts_with("EXCHANGE")),
        "{uncounted:?}"
    );
    assert_eq!(holding(orders, "2391", "SWOR", 2), 0);
    assert_eq!(holding(orders, "2393", "SWOR", 5), 2);
    assert_eq!(silver_moved(orders, "2392", SilverChangeCause::Sold), 500);
}
