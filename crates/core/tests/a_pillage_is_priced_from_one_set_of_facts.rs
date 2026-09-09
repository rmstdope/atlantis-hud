//! `ah-jo6b.5`. A `PILLAGE` is priced from one set of facts, so the SILVER column and the ITEMS
//! ledger cannot read the same unit differently.
//!
//! The bead was filed expecting the two surfaces to diverge - the column reused the late,
//! phase-aware `UnitFacts` that `forecast_hex` built by hand, while the ledger's `PILLAGE` arm
//! built a fresh one through `unit_facts` with no phases. They never could: `silver::readiness` is
//! the only thing either surface derives combat readiness from, and it reads neither `receipts` nor
//! `phases` - the only two fields the two constructions differed in. So these are characterisation
//! tests: green before the change that makes `forecast_hex` call `unit_facts`, and green after.
//!
//! `rules/economy_taxingpillaging`: pillaging *"requires the faction to have enough combat ready
//! men in the region to tax half of the available money in the region"*, *"Each taxing character
//! can collect $50"*, and *"The amount of money collected is equal to twice the available tax
//! money"*. Ten men at $50 each collect $500, which is half of the region's $1,000; the take is
//! therefore twice $1,000, and one pillager takes all of it. `rules/economy_taxingpillaging` also
//! fixes the skill: *"A unit may TAX if it has Combat skill of at least level 1"*.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverDoubt, UnitSilver};
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

/// How many of `tag` the ITEMS preview leaves `unit_id` holding, and what it admitted as uncounted.
fn preview_holding(text: &str, script: &str, unit_id: &str, tag: &str) -> (i64, Vec<String>) {
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
    let unit = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the preview has unit {unit_id}"));
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

const REGION: &str = "plain (1,1) in Nowhere, 1000 peasants (orcs), $1000.";
const MARKET: &[&str] = &["For Sale: 100 grain [GRAI] at $1."];
const SCRIPT: &str = "unit 900\nPILLAGE\nBUY ALL grain\n";

/// Ten men whose combat skill the report states, so `readiness` can count them. The unit holds no
/// silver at all: the only money that can pay for the grain is the pillage, so the ITEMS ledger
/// buys the line if and only if it priced the pillage exactly as the column did.
#[test]
fn a_countable_pillager_is_priced_the_same_by_both_surfaces() {
    let text = report(
        REGION,
        MARKET,
        &["* Raiders (900), Foo (1), 10 orcs [ORC]. Weight: 100. \
           Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30)."],
    );
    let review = review_of(&text, SCRIPT);
    let row = row_of(&review, "900");

    assert_eq!(row.doubt, None, "the column can count these men");
    assert_eq!(row.income, Some(2000), "twice the region's $1,000");
    assert_eq!(row.expense, Some(100), "a hundred grain at $1");
    assert_eq!(row.at_month_end, Some(1900));
    assert!(
        !review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "pillage-without-men"),
        "these men are countable: {:?}",
        review.findings
    );

    assert_eq!(
        preview_holding(&text, SCRIPT, "900", "GRAI"),
        (100, vec![]),
        "the ITEMS ledger sized the BUY ALL against a balance that includes the pillage"
    );
}

/// The same unit, plus an item tag the committed ruleset does not carry. `classify_unit` leaves
/// such a unit's `men_estimated` true, `readiness` answers `None`, and both surfaces stop together:
/// the column blanks the month and the ledger throws the whole `BUY ALL` settlement away, telling
/// the player which line it could not count.
#[test]
fn a_pillager_whose_men_cannot_be_counted_is_doubted_on_both_surfaces() {
    let text = report(
        REGION,
        MARKET,
        &[
            "* Raiders (900), Foo (1), 10 orcs [ORC], 3 gribbles [GRBL]. Weight: 100. \
           Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30).",
        ],
    );
    let review = review_of(&text, SCRIPT);
    let row = row_of(&review, "900");

    assert_eq!(row.doubt, Some(SilverDoubt::UnknownCombatReady));
    assert_eq!(row.income, None);
    assert_eq!(row.at_month_end, None, "the column blanks the month");

    let (grain, uncounted) = preview_holding(&text, SCRIPT, "900", "GRAI");
    assert_eq!(grain, 0, "the ledger bought nothing");
    assert!(
        !uncounted.is_empty(),
        "the player is told which line was not counted"
    );
}
