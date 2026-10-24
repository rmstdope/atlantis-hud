//! Whether a unit this month's `FORM` creates is dissolved, held across **both** surfaces that
//! answer for it (`ah-l9d9`).
//!
//! `rules/form`: *"If no recruits are gained at all, the empty unit will be dissolved, and the
//! silver and any other items it was given will revert to the first unit you have in that
//! region."* The SILVER column answers for the silver and the ITEMS preview for everything else,
//! and each used to decide the dissolve on its own - so every rule about it was fixed once per
//! copy (`ah-ixq7`/`ah-09bu`, `ah-waes`, `ah-6sx5`). Since this bead one function in
//! `semantics.rs` decides it and both read the answer, so every case below asserts the two
//! together: a change to the rule moves both or neither.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreview};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::SilverChangeCause;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

/// One hex with a market selling humans, the first own unit `901` and the former `902`, which
/// holds the swords and the silver it gives its new unit.
fn report(region: &str) -> String {
    [
        "Foo (1) Report",
        "",
        region,
        "  For Sale: 5 humans [HUMN] at $38.",
        "",
        "* Receiver (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
        "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 1000 silver [SILV]. \
         Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

/// A region that names its peasants' race, so `BUY PEASANTS` can be read (`rules/buy`).
const NAMED: &str = "plain (1,1) in Nowhere, 1000 peasants (humans), $0.";
/// A region that names no race, so `rules/buy`'s "PEASANT or PEASANTS to recruit whichever race
/// is present in the region" cannot be read and the ledger leaves the `BUY` uncounted.
const UNNAMED: &str = "plain (1,1) in Nowhere, $0.";

/// What both surfaces say about one dissolve.
struct BothSurfaces {
    /// The silver the SILVER column reverts to the first unit.
    silver_reverted: i64,
    /// Whether the ITEMS preview draws the formed row as dissolving.
    items_dissolving: bool,
    /// The swords the ITEMS preview leaves on the first unit.
    swords_on_first: i64,
}

fn both_surfaces(text: &str, block: &str) -> BothSurfaces {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let script = format!("{template}\nunit 902\n{block}GIVE NEW 1 3 SWOR\nGIVE NEW 1 200 SILV\n");

    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let review = review_turn(&parsed, &script, Some(&ruleset), CheckOptions::default());
    let silver_reverted = review
        .silver
        .iter()
        .filter(|row| row.unit_id == "901")
        .flat_map(|row| row.changes.iter())
        .filter(|change| change.cause == SilverChangeCause::GiftReverted)
        .map(|change| change.amount)
        .sum();

    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &script,
    )
    .expect("the committed ruleset loads");
    let row = |unit_id: &str| -> &UnitPreview {
        preview
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == unit_id)
            .unwrap_or_else(|| panic!("the preview has a row for unit {unit_id}"))
    };
    BothSurfaces {
        silver_reverted,
        items_dissolving: row("new-1").dissolving,
        // An unchanged unit has no row of its own (`common::preview_row`).
        swords_on_first: common::preview_row(text, &preview, "901").map_or(0, |row| {
            row.unit
                .items
                .iter()
                .filter(|item| item.tag == "SWOR")
                .map(|item| item.amount)
                .sum()
        }),
    }
}

/// Nobody gained: both surfaces dissolve it and revert its goods to the first unit.
#[test]
fn a_form_that_gains_nobody_dissolves_on_both_surfaces() {
    let both = both_surfaces(&report(NAMED), "FORM 1\nEND\n");
    assert_eq!(both.silver_reverted, 200, "SILVER reverts the gift");
    assert!(both.items_dissolving, "ITEMS draws the row dissolving");
    assert_eq!(both.swords_on_first, 3, "ITEMS reverts the swords");
}

/// An uncounted `BUY` of men leaves "no recruits are gained at all" unestablished (`ah-waes`):
/// neither surface dissolves it, and nothing reverts.
#[test]
fn a_form_whose_buy_of_men_is_uncounted_dissolves_on_neither_surface() {
    let both = both_surfaces(&report(UNNAMED), "FORM 1\nBUY 1 PEASANTS\nEND\n");
    assert_eq!(both.silver_reverted, 0, "SILVER keeps the gift where it is");
    assert!(!both.items_dissolving, "ITEMS does not draw it dissolving");
    assert_eq!(
        both.swords_on_first, 0,
        "ITEMS keeps the swords where they are"
    );
}

/// `BUY PEASANTS` recruits the region's race where the report names it (`rules/buy`, `ah-6sx5`):
/// the unit gains a man, so neither surface dissolves it.
#[test]
fn a_form_that_recruits_dissolves_on_neither_surface() {
    let both = both_surfaces(&report(NAMED), "FORM 1\nBUY 1 PEASANTS\nEND\n");
    assert_eq!(both.silver_reverted, 0, "SILVER keeps the gift where it is");
    assert!(!both.items_dissolving, "ITEMS does not draw it dissolving");
    assert_eq!(
        both.swords_on_first, 0,
        "ITEMS keeps the swords where they are"
    );
}
