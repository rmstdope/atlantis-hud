//! `ah-jo6b.1`. A `GIVE` to a unit number the whole report never prints is assumed to land, and
//! both surfaces price the month from what is left.
//!
//! `rules/give`: *"A unit may only give items, including silver, to a unit which it is able to see,
//! unless the faction of the target unit has declared you Friendly or better."* No report carries
//! another faction's declaration toward us, so a number the report never prints may be a perfectly
//! good target. The projection follows the order through and says what it cannot establish - that
//! nothing in the report matches the number - as `give-target-not-here`.
//!
//! `data/carpenter`: a catapult [CATP] is made from *"250 wood [WOOD], 30 ironwood [IRWD], 80 furs
//! [FUR] and 3000 silver [SILV] at a rate of 1 per 4 man-months"* at carpenter level 4 - hence four
//! men, and hence `carpenter [CARP] 4`, not the `catapult [CATA]` of an older fixture, which is not
//! a skill the committed ruleset carries at all.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{ProductionCap, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The one fixture, and the whole of it.
///
/// `Unclaimed silver:` must sit between the title line and the first region block, or the `CLAIM`
/// earns nothing and the test passes for the wrong reason. The men are the first item on Tam's
/// line because `count_men` reads the headcount off `items.first()`.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "Unclaimed silver: 1000.",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Tam (2391), Foo (1), 4 orcs [ORC], 3800 silver [SILV], 250 wood [WOOD], \
         30 ironwood [IRWD], 80 furs [FUR]. Weight: 100. Capacity: 0/0/60/0. \
         Skills: carpenter [CARP] 4 (300).",
        "",
    ]
    .join("\n")
}

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

/// The whole bead on one row. Tam gives away 50 of the 250 wood a catapult needs, to a number the
/// report never prints. The gift is assumed to land, so the run is short of wood and makes nothing;
/// the silver is neither spent on it nor blanked; and the player is told that nothing in the report
/// matches unit 1.
#[test]
fn a_gift_to_an_unshown_number_lands_and_the_month_is_priced_from_what_is_left() {
    let text = report_text();
    let script = "unit 2391\nCLAIM 500\nGIVE 1 50 WOOD\nPRODUCE catapult\n";
    let review = review_of(&text, script);
    let tam = row_of(&review, "2391");

    assert_eq!(tam.doubt, None, "nothing is blanked: {tam:?}");
    assert_eq!(
        tam.at_month_end,
        Some(4300),
        "3,800 held plus the 500 claimed, and nothing for a catapult that cannot be made"
    );
    assert_eq!(tam.produced, 0);
    assert_eq!(
        tam.production_capped_by,
        Some(ProductionCap::Materials),
        "the 50 wood left, so 200 remain against a recipe wanting 250"
    );

    let (wood, uncounted) = preview_holding(&text, script, "2391", "WOOD");
    assert_eq!(wood, 200, "the ITEMS surface agrees the wood left");
    assert!(
        uncounted.is_empty(),
        "no ` + ?` on the ITEMS cell: {uncounted:?}"
    );

    let targets: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "give-target-not-here")
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(
        targets,
        vec!["unit 1 is not in this hex to be given to, and appears nowhere else in your report"]
    );
}

/// The control, so the fixture above is not passing for the wrong reason: with the `GIVE` removed
/// Tam has all 250 wood, makes the catapult, and pays `data/carpenter`'s 3,000 silver for it.
///
/// The cap is [`ProductionCap::Silver`] rather than `None`: 4,300 silver buys exactly one catapult
/// at 3,000 each, so money is what stops a second. What matters to this control is that it is *not*
/// `Materials` - that cap is the gift's doing, and it is gone with the gift.
#[test]
fn without_the_gift_the_same_unit_makes_its_catapult() {
    let text = report_text();
    let script = "unit 2391\nCLAIM 500\nPRODUCE catapult\n";
    let tam = row_of(&review_of(&text, script), "2391");

    assert_eq!(tam.produced, 1);
    assert_eq!(tam.production_capped_by, Some(ProductionCap::Silver));
    assert_eq!(tam.at_month_end, Some(1300), "3,800 + 500 - 3,000");

    let (wood, _) = preview_holding(&text, script, "2391", "WOOD");
    assert_eq!(wood, 0, "the whole 250 wood goes into the catapult");
}
