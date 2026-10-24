//! The case `ah-5p8y` was filed from: `desert (41,35)` of Arcanum faction 5's turn 84, where
//! `GIVE 4008 14 IRON` from 4686 and `GIVE 4840 14 IRON` from 4008 looked as if 4008's own GIVE
//! were dropped.
//!
//! The engine settles the Give phase unit by unit in the order the region's objects hold them -
//! the report's order - each unit's GIVEs as written (`Game::DoGiveOrders`, ../Atlantis
//! `runorders.cpp`; `rules/sequenceofevents` says only that GIVE and TAKE are processed in the Give
//! phase). So 4008, listed first and holding no iron, gives before it is given anything. But
//! `Game::DoGiveOrder` asks `Unit::GetSharedNum`, which counts every sharing faction-mate in the
//! region, and draws through `Unit::ConsumeShared` (`unit.cpp`) - and every unit of that hex
//! shares (`rules/share`), 4686 with 60 iron. So 4008's GIVE goes through, funded by 4686, and no
//! warning is due.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, ItemChangeCause, UnitPreview,
};
use atlantis_hud_core::orders::semantics::{check_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::{expect_preview_row, ruleset};

const ORDERS: &str = "unit 4686\nGIVE 4008 14 IRON\nunit 4008\nGIVE 4840 14 IRON\n";

fn the_report() -> String {
    atlantis_hud_fixtures::NEWAGE_ARCANUM_F5_T84
        .text
        .to_string()
}

fn iron(unit: &UnitPreview) -> i64 {
    unit.unit
        .items
        .iter()
        .filter(|item| item.tag == "IRON")
        .map(|item| item.amount)
        .sum()
}

/// `(cause, delta, other unit)` for each IRON change on the row.
fn iron_changes(unit: &UnitPreview) -> Vec<(ItemChangeCause, i64, Option<String>)> {
    unit.item_changes
        .iter()
        .filter(|change| change.tag == "IRON")
        .map(|change| {
            (
                change.cause,
                change.delta,
                change.other.as_ref().map(|other| other.unit_id.clone()),
            )
        })
        .collect()
}

#[test]
fn the_listed_first_giver_passes_on_iron_its_sharing_faction_mate_lends() {
    let report = the_report();
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report,
        "[]",
        ORDERS,
    )
    .expect("the ruleset loads");

    let first = expect_preview_row(&report, &response, "4008");
    let lender = expect_preview_row(&report, &response, "4686");
    let last = expect_preview_row(&report, &response, "4840");

    assert_eq!(
        iron_changes(last),
        [(ItemChangeCause::WasGiven, 14, Some("4008".to_string()))],
        "4008's GIVE runs first and reaches 4840"
    );
    assert_eq!(iron(last), 14);
    assert_eq!(
        iron_changes(lender),
        [
            (ItemChangeCause::LentForGive, -14, Some("4840".to_string())),
            (ItemChangeCause::GivenAway, -14, Some("4008".to_string())),
        ],
        "4686 lends to 4008's GIVE first, then gives its own"
    );
    // The loan names whose GIVE it paid for, so the hover never says 4686 gave to 4840 itself
    // (`ah-49is`).
    let borrowers: Vec<_> = lender
        .item_changes
        .iter()
        .filter(|change| change.tag == "IRON")
        .map(|change| change.borrower.as_ref().map(|party| party.unit_id.clone()))
        .collect();
    assert_eq!(borrowers, [Some("4008".to_string()), None]);
    assert_eq!(iron(lender), 60 - 28);
    assert_eq!(iron(first), 14, "4008 keeps what 4686 gives it afterwards");
}

#[test]
fn a_give_a_sharer_funds_is_not_called_short() {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(&the_report());
    classify_units(&mut parsed, &ruleset);
    let findings = check_turn(&parsed, ORDERS, Some(&ruleset), CheckOptions::default());

    let on_the_gives: Vec<_> = findings
        .iter()
        .filter(|finding| {
            matches!(finding.unit_id.as_deref(), Some("4008" | "4686"))
                && matches!(
                    finding.code.as_str(),
                    "not-enough-items" | "part-of-hex-shortfall"
                )
        })
        .collect();
    assert!(on_the_gives.is_empty(), "{on_the_gives:?}");
}

/// The same orders with 4686's `SHARE 0` - an instant order, before the Give phase
/// (`rules/sequenceofevents`) - leave no sharer holding iron when 4008's GIVE runs, so the engine
/// says "Not enough." and it moves nothing; and the line says so, although 4008 ends the phase
/// holding the 14 iron it ordered away.
#[test]
fn without_the_lender_the_listed_first_give_is_warned_on_its_line() {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(&the_report());
    classify_units(&mut parsed, &ruleset);
    let orders = "unit 4686\nSHARE 0\nGIVE 4008 14 IRON\nunit 4008\nGIVE 4840 14 IRON\n";
    let findings = check_turn(&parsed, orders, Some(&ruleset), CheckOptions::default());

    let short: Vec<_> = findings
        .iter()
        .filter(|finding| finding.code.as_str() == "not-enough-items")
        .collect();
    assert_eq!(short.len(), 1, "{findings:?}");
    assert_eq!(short[0].unit_id.as_deref(), Some("4008"));
    assert_eq!(short[0].line, Some(5), "on 4008's GIVE");
    assert!(
        short[0]
            .message
            .ends_with("later in the Give phase comes too late"),
        "{}",
        short[0].message
    );
}
