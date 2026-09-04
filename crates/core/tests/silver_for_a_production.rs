//! A manufacturing `PRODUCE` is funded by the silver its unit has when manufacturing runs, on both
//! surfaces at once (`ah-gdd3.2`).
//!
//! `rules/sequenceofevents` runs *"Manufacturing PRODUCE orders (those that produce items from
//! other items, such as using the weaponsmith skill to make swords out of iron) are processed"*
//! after almost everything a unit can do with silver: CLAIM is in the first instant batch, then
//! *"Give orders. GIVE and TAKE orders are processed."*, then PILLAGE/TAX, then *"Spells are
//! CAST"*, then the market. Both computations used to cap such a run by the `SILV` line of the
//! report's own item list instead, so a `CLAIM` did not fund one and a `GIVE` did not stop one.
//!
//! `config/public/ruleset.json` prices a catapult (`skills/CARP/produces`, `CATP`, level 4) at 250
//! `WOOD`, 30 `IRWD`, 80 `FUR` and 3000 `SILV`, four man-months, one output. It and the steed are
//! the only two recipes in the whole ruleset with a `SILV` input, and no committed fixture orders
//! either - which is why this bead needs a fixture of its own.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::ProductionCap;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, a carpenter with exactly one catapult's materials, and a neighbour to give to.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`. Four leaders at `carpenter [CARP] 4` bring sixteen man-months, and a catapult
/// is four of them with one output - so the order wants four and the materials cap it at one.
///
/// `Unclaimed silver:` between the title line and the first region block is how `parse_header_of`
/// reads a faction fund, which is what makes `CLAIM` priceable on both surfaces.
///
/// Every case carries 400 silver of headroom over the sum it is testing: `rules/economy_maintenance`
/// charges "50 silver for a leader", so this hex owes 4 x 50 + 50 = 250 a month, and without the
/// headroom every case would raise `not-enough-silver` for maintenance instead.
fn report(silver: i64) -> String {
    [
        "Foo (1) Report".to_string(),
        String::new(),
        "Unclaimed silver: 3000.".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        format!(
            "* Carpenters (900), Foo (1), behind, 4 leaders [LEAD], {silver} silver [SILV], 250 wood [WOOD], \
             30 ironwood [IRWD], 80 furs [FUR]. Weight: 2900. Capacity: 0/0/0/0. \
             Skills: carpenter [CARP] 4 (300)."
        ),
        "* Hands (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
        String::new(),
    ]
    .join("\n")
}

fn orders_for(silver: i64, script: &str) -> String {
    let text = report(silver);
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 900\n{script}\n")
}

/// The ITEMS column's answer: how many `CATP` unit 900's `PRODUCE` makes this month.
fn items_column_produced(silver: i64, script: &str) -> i64 {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report(silver),
        "[]",
        &orders_for(silver, script),
    )
    .expect("the ruleset loads");

    let unit = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
        .expect("unit 900 is on the ITEMS surface");

    unit.produced
        .iter()
        .filter(|produced| produced.tag == "CATP")
        .map(|produced| produced.amount)
        .sum()
}

/// The SILVER column's answer for unit 900, and every finding the same review raised for its hex.
fn silver_column(
    silver: i64,
    script: &str,
) -> (i64, Option<ProductionCap>, Option<i64>, Vec<String>) {
    let text = report(silver);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let review = review_turn(
        &parsed,
        &orders_for(silver, script),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let unit = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .expect("unit 900 is on the SILVER surface");
    let codes = review
        .findings
        .iter()
        .filter(|finding| finding.unit_id.as_deref() == Some("900"))
        .map(|finding| finding.code.as_str().to_string())
        .collect();

    (
        unit.produced,
        unit.production_capped_by,
        unit.expense,
        codes,
    )
}

/// The bead's own three cases: the silver a case holds, its orders, and what one month should make.
///
/// Case 1 is the claim the report cannot see; case 2 the gift it cannot see - and the *absence* of
/// `not-enough-silver` there is the false shortfall this bead removes. Case 3 is the control that
/// must not move: a unit that simply holds the silver was funded before and is funded after, so a
/// change that merely zeroed the cap fails here.
const CASES: [(i64, &str, i64, Option<i64>); 3] = [
    (400, "CLAIM 3000\nPRODUCE catapult", 1, Some(3000)),
    (3400, "GIVE 901 3000 SILV\nPRODUCE catapult", 0, Some(3000)),
    (3400, "PRODUCE catapult", 1, Some(3000)),
];

/// A misplaced `Unclaimed silver:` line would silently make every `CLAIM` earn nothing, and case 1
/// would then fail for a reason that has nothing to do with the cap.
#[test]
fn the_fixture_states_a_faction_fund() {
    assert_eq!(
        parse_report_full(&report(400)).header.unclaimed_silver,
        Some(3000)
    );
}

#[test]
fn the_silver_column_funds_a_production_from_the_month_it_has() {
    for (silver, script, made, expense) in CASES {
        let (produced, capped_by, spent, _) = silver_column(silver, script);

        assert_eq!(produced, made, "produced, holding {silver}: {script}");
        assert_eq!(
            capped_by,
            Some(ProductionCap::Silver),
            "capped_by, holding {silver}: {script}"
        );
        assert_eq!(spent, expense, "expense, holding {silver}: {script}");
    }
}

#[test]
fn the_items_column_and_its_warning_agree_with_it() {
    for (silver, script, made, _) in CASES {
        let items = items_column_produced(silver, script);
        let (_, _, _, codes) = silver_column(silver, script);

        assert_eq!(items, made, "CATP made, holding {silver}: {script}");
        assert!(
            !codes.iter().any(|code| code == "not-enough-silver"),
            "no shortfall, holding {silver}: {script} raised {codes:?}"
        );
    }
}

// --- the two columns in a hex that shares (`ah-728m.2.2`) ---------------------------------------

/// `ah-728m.2.2` made the ITEMS ledger pool a hex's `SHARE`d materials for manufacturing PRODUCE.
/// The SILVER column prices the same order and must reach the same figure, or its hover contradicts
/// the cell beside it - which is exactly what happened while this file had no sharing case:
/// "Includes 36 SWOR this unit will produce" over "This unit has materials for 16 swords".
///
/// The committed turn 42 already carries the case, so it is asserted against a real hex rather than
/// a fixture written to pass. `mountain (36,4)` shares, and `Smiths (2964)` - 14 orcs at
/// `weaponsmith [WEAP] 2` with 11 hammers - carries 16 iron of its own beside `MinersA (5105)`'s
/// 20, which `rules/share` lends it and `rules/sequenceofevents` runs manufacturing PRODUCE early
/// enough to use.
///
/// **The orders are the report's own template with the smith's block appended**, which is what the
/// application actually prices: the rest of the hex keeps its template orders, and one of them is
/// the `GIVE` of iron that makes up the difference between the twenty the miners share and the
/// thirty-six the smith forges. A bare block for one unit prices a different month.
///
/// The seam that carries the pool between the two columns is keyed by unit *and line*, and that is
/// a guard rather than a case reachable here: `settle_effective_month_intents` leaves a unit one
/// month-long order, so a manufacturing and a primary PRODUCE in one block never both run.
/// `orders::silver::tests::shared_materials::each_produce_line_reads_the_pool_its_own_order_was_priced_against`
/// is what pins the guard.
mod a_hex_that_shares {
    use super::*;

    const SMITH: &str = "2964";

    fn columns(script: &str) -> (i64, i64, Option<ProductionCap>, i64) {
        let text = atlantis_hud_fixtures::G3_F42_T42.text;
        let template = extract_orders_template(text)
            .map(|template| template.text)
            .unwrap_or_default();
        let orders = format!("{template}\nunit {SMITH}\n{script}\n");

        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            atlantis_hud_fixtures::RULESET_JSON,
            text,
            "[]",
            &orders,
        )
        .expect("the ruleset loads");
        let items: i64 = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == SMITH)
            .expect("the smith is on the ITEMS surface")
            .produced
            .iter()
            .filter(|produced| produced.tag == "SWOR")
            .map(|produced| produced.amount)
            .sum();

        let mut parsed = parse_report_full(text);
        classify_units(&mut parsed, &ruleset());
        let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
        let unit = review
            .silver
            .iter()
            .find(|silver| silver.unit_id == SMITH)
            .expect("the smith is on the SILVER surface");

        (
            items,
            unit.produced,
            unit.production_capped_by,
            unit.production_wanted,
        )
    }

    #[test]
    fn both_columns_price_one_produce_against_the_hexs_shared_materials() {
        let (items, silver, capped_by, wanted) = columns("PRODUCE sword");
        assert_eq!(items, 36, "the ITEMS ledger forges from the hex's iron");
        assert_eq!(silver, items, "and the SILVER column says the same number");
        assert_eq!(capped_by, Some(ProductionCap::Materials));
        assert_eq!(wanted, 39, "what its skill and tools alone could make");
    }
}

// --- a gift of the whole purse precedes the manufacture (`ah-m7su`) ----------------------------

/// `rules/sequenceofevents` runs *Give orders* second and "Manufacturing PRODUCE orders ... are
/// processed" in the turn's last block, so a `GIVE ... ALL SILV` hands over the whole purse and the
/// catapult is then unfunded - on both surfaces, in either document order.
const GIVES_EVERYTHING: [&str; 2] = [
    "GIVE 901 ALL SILV\nPRODUCE catapult",
    "PRODUCE catapult\nGIVE 901 ALL SILV",
];

#[test]
fn the_silver_column_gives_the_whole_purse_and_builds_nothing() {
    for script in GIVES_EVERYTHING {
        let (produced, capped_by, spent, _) = silver_column(3000, script);
        assert_eq!(produced, 0, "{script:?}: nothing is left to build with");
        assert_eq!(capped_by, Some(ProductionCap::Silver), "{script:?}");
        assert_eq!(
            spent,
            Some(3000),
            "{script:?}: the gift, and nothing for a catapult never made"
        );
    }
}

#[test]
fn the_items_column_agrees_that_no_catapult_is_made() {
    for script in GIVES_EVERYTHING {
        assert_eq!(items_column_produced(3000, script), 0, "{script:?}");
    }
}
