//! `ah-jo6b.4`. The game refuses a mage's recruiting, and both surfaces say so: the ITEMS ledger
//! already buys nobody, and the SILVER column now charges nothing for them.
//!
//! `rules/magic`: *"Only one man units, with the man being a leader, are permitted to study these
//! skills... In addition, mages may not GIVE men at all; once a unit becomes a mage (by studying
//! one of the Foundations), the unit number is fixed."* The rules page states the GIVE half; the
//! refusal of a mage's BUY of men is the navigator's New Origins ruling, recorded in `ah-ndp9` and
//! resting on the fixed unit number.
//!
//! `data/items`: `orc [ORC]` and `leader [LEAD]` both carry `kind: man`, and `force [FORC]` is a
//! Foundation - so the fixture's lone leader with `force [FORC] 1` is a mage the game could
//! actually produce.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The fixture. The men are the first item on the unit's line because `count_men` reads the
/// headcount off `items.first()`; the region pays `$0`, so no wage moves and the figures below are
/// the purchase and nothing else.
fn report_text(skills: &str) -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "",
        "  For Sale: 20 orcs [ORC] at $38.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        &format!(
            "* Rhia (2390), Foo (1), 1 leaders [LEAD], 1000 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0. Skills: {skills}."
        ),
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

/// How many of `tag` the ITEMS preview leaves `unit_id` holding, and what it admitted as
/// uncounted - or `None` where the preview carries no row for the unit at all, which is what it
/// says about a month whose orders change nothing.
fn preview_holding(
    text: &str,
    script: &str,
    unit_id: &str,
    tag: &str,
) -> Option<(i64, Vec<String>)> {
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
        .find(|unit| unit.unit.unit_id == unit_id)?;
    Some((
        unit.unit
            .items
            .iter()
            .filter(|item| item.tag == tag)
            .map(|item| item.amount)
            .sum(),
        unit.uncounted.clone(),
    ))
}

const SCRIPT: &str = "unit 2390\nBUY 5 orcs\n";

/// The whole bead. The mage is charged nothing for the five orcs the game will not hand it, and
/// nothing is doubted: the refusal is certain, and the ledger's existing finding says why.
#[test]
fn a_mage_is_charged_nothing_for_the_recruits_the_game_refuses() {
    let text = report_text("force [FORC] 1 (30)");
    let review = review_of(&text, SCRIPT);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(0), "nothing is charged: {rhia:?}");
    assert_eq!(rhia.at_month_end, Some(1000), "the purse is untouched");
    assert_eq!(rhia.doubt, None, "a refusal is certain, not doubtful");
    assert!(
        !rhia
            .changes
            .iter()
            .any(|change| change.cause == SilverChangeCause::Bought),
        "no purchase is booked on the hover: {:?}",
        rhia.changes
    );

    let refusals: Vec<(&str, Option<&str>)> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "men-sent-into-a-mage")
        .map(|finding| (finding.message.as_str(), finding.unit_id.as_deref()))
        .collect();
    assert_eq!(
        refusals,
        vec![(
            "this unit is a mage and cannot recruit, so this order buys nobody",
            Some("2390")
        )]
    );

    // The preview carries a row only for a unit whose month changes something, so a refusal that
    // buys nobody and spends nothing leaves no row at all: the ITEMS surface hands the mage no
    // orcs, and admits nothing as uncounted either.
    assert_eq!(preview_holding(&text, SCRIPT, "2390", "ORC"), None);
}

/// The control, so the refusal is not widened to every buyer of men: the same leader without a
/// Foundation recruits and pays `data/items`' market price for it.
#[test]
fn a_leader_who_is_no_mage_still_recruits_and_pays() {
    let text = report_text("combat [COMB] 1 (30)");
    let review = review_of(&text, SCRIPT);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(190), "five orcs at $38");
    assert_eq!(rhia.at_month_end, Some(810));
    let bought: Vec<i64> = rhia
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Bought)
        .map(|change| change.amount)
        .collect();
    assert_eq!(bought, vec![-190]);
    assert!(
        !review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "men-sent-into-a-mage"),
        "a mundane leader is refused nothing"
    );

    let (orcs, uncounted) = preview_holding(&text, SCRIPT, "2390", "ORC")
        .expect("a leader that recruits has a preview row");
    assert_eq!(orcs, 5);
    assert!(
        uncounted.is_empty(),
        "no ` + ?` on the ITEMS cell: {uncounted:?}"
    );
}
