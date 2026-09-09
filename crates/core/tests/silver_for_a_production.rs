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

// --- a market opens before the manufacture (`ah-6m7b.6`) ---------------------------------------

/// `rules/sequenceofevents` runs *"BUY orders are processed"* eleven entries before *"Manufacturing
/// PRODUCE orders ... are processed"*, so a purchase is one of the few things that can shrink the
/// purse a catapult is built from - and this file had no market case at all, no `For Sale:` line
/// anywhere in it.
///
/// Both surfaces price a `PRODUCE` through one function, `silver::price_production` ->
/// `silver::plan_production`, and both hand it a purse read out of the ledger's own `PhaseState`:
/// the ITEMS side through `balance_at(phase, who, SILVER)`, the SILVER side through
/// `PhaseSilver::as_manufacturing_opens`, which is `after[StatePhase::Study]` filled in from that
/// same array. Nothing between Study and Manufacturing moves silver, so the two purses are equal by
/// construction - and nothing in the suite said so until this module.
///
/// The report is the file's own carpenter hex with a `For Sale:` line added; the outer `report` is
/// deliberately left alone, so a market does not appear in the hex of every other case in the file.
mod a_market_before_the_manufacture {
    use super::*;

    /// The file's own carpenter hex with a `For Sale:` line added, and nothing else changed. The
    /// `Unclaimed silver:` line stays even though no case here claims, so the one difference from
    /// the outer builder does not become two.
    fn report_with_market(silver: i64, for_sale: &str) -> String {
        [
            "Foo (1) Report".to_string(),
            String::new(),
            "Unclaimed silver: 3000.".to_string(),
            String::new(),
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
            format!("  For Sale: {for_sale}"),
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

    /// Both surfaces' answers for unit 900, from one report and one script.
    #[derive(Debug)]
    struct Columns {
        /// `CATP` the ITEMS ledger creates.
        items_catapults: i64,
        /// `GRAI` the ITEMS ledger moves into the unit.
        items_grain: i64,
        silver_produced: i64,
        capped_by: Option<ProductionCap>,
        wanted: i64,
        expense: Option<i64>,
        at_month_end: Option<i64>,
        /// Every finding code raised for unit 900, in the order `review_turn` returns them.
        codes: Vec<String>,
    }

    fn columns(silver: i64, for_sale: &str, script: &str) -> Columns {
        let text = report_with_market(silver, for_sale);
        let template = extract_orders_template(&text)
            .map(|template| template.text)
            .unwrap_or_default();
        let orders = format!("{template}\nunit 900\n{script}\n");

        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            atlantis_hud_fixtures::RULESET_JSON,
            &text,
            "[]",
            &orders,
        )
        .expect("the ruleset loads");
        let unit = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == "900")
            .expect("unit 900 is on the ITEMS surface");
        let items_catapults = unit
            .produced
            .iter()
            .filter(|produced| produced.tag == "CATP")
            .map(|produced| produced.amount)
            .sum();
        let items_grain = unit
            .item_changes
            .iter()
            .filter(|change| change.tag == "GRAI")
            .map(|change| change.delta)
            .sum();

        let mut parsed = parse_report_full(&text);
        classify_units(&mut parsed, &ruleset());
        let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
        let silver_row = review
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

        Columns {
            items_catapults,
            items_grain,
            silver_produced: silver_row.produced,
            capped_by: silver_row.production_capped_by,
            wanted: silver_row.production_wanted,
            expense: silver_row.expense,
            at_month_end: silver_row.at_month_end,
            codes,
        }
    }

    /// The market has 20 of the 40 asked for, so 400 silver leaves and 3000 remains - exactly the
    /// recipe's silver, and both columns make the catapult. `region-pool-oversubscribed` is the
    /// market line being asked for more than it sells; asserting the whole vector is what keeps a
    /// spurious `not-enough-silver` from creeping in beside a correct number.
    #[test]
    fn a_market_cut_buy_leaves_both_columns_making_the_catapult() {
        for (silver, at_month_end) in [(3400, 0), (3800, 400)] {
            let got = columns(
                silver,
                "20 grain [GRAI] at $20.",
                "BUY 40 grain\nPRODUCE catapult",
            );

            assert_eq!(got.items_catapults, 1, "ITEMS catapults, holding {silver}");
            assert_eq!(got.items_grain, 20, "ITEMS grain, holding {silver}");
            assert_eq!(got.silver_produced, 1, "SILVER produced, holding {silver}");
            assert_eq!(got.capped_by, Some(ProductionCap::Silver), "{silver}");
            assert_eq!(got.wanted, 4, "wanted, holding {silver}");
            assert_eq!(got.expense, Some(3400), "expense, holding {silver}");
            assert_eq!(got.at_month_end, Some(at_month_end), "{silver}");
            assert_eq!(got.codes, ["region-pool-oversubscribed"], "{silver}");
        }
    }

    /// The whole ask is bought, for 800, and the catapult is short - on both columns, with no
    /// finding raised. This is where the report's own figures would have gone had the market
    /// carried what the order asked for.
    #[test]
    fn a_full_price_buy_unfunds_the_catapult_on_both_columns() {
        let got = columns(
            3400,
            "40 grain [GRAI] at $20.",
            "BUY 40 grain\nPRODUCE catapult",
        );

        assert_eq!(got.items_catapults, 0, "the ITEMS ledger makes nothing");
        assert_eq!(got.items_grain, 40, "and buys the whole ask");
        assert_eq!(got.silver_produced, 0, "the SILVER column says the same");
        assert_eq!(got.capped_by, Some(ProductionCap::Silver));
        assert_eq!(got.wanted, 4);
        assert_eq!(got.expense, Some(800));
        assert_eq!(got.at_month_end, Some(2600));
        assert!(got.codes.is_empty(), "raised {:?}", got.codes);
    }

    /// `plan_production` divides, so a purse equal to the price funds a run: 3800 - 800 is exactly
    /// the recipe's 3000 `SILV`. 3400 in the test above and 3800 here are the two sides of that
    /// division, one apart in outcome and 400 apart in silver.
    #[test]
    fn the_boundary_where_the_purse_is_exactly_the_recipes_silver() {
        for (silver, at_month_end) in [(3800, 0), (6000, 2200)] {
            let got = columns(
                silver,
                "40 grain [GRAI] at $20.",
                "BUY 40 grain\nPRODUCE catapult",
            );

            assert_eq!(got.items_catapults, 1, "ITEMS catapults, holding {silver}");
            assert_eq!(got.items_grain, 40, "ITEMS grain, holding {silver}");
            assert_eq!(got.silver_produced, 1, "SILVER produced, holding {silver}");
            assert_eq!(got.capped_by, Some(ProductionCap::Silver), "{silver}");
            assert_eq!(got.wanted, 4, "wanted, holding {silver}");
            assert_eq!(got.expense, Some(3800), "expense, holding {silver}");
            assert_eq!(got.at_month_end, Some(at_month_end), "{silver}");
            assert!(got.codes.is_empty(), "holding {silver}: {:?}", got.codes);
        }
    }

    /// The turn's phase order decides this, not the order the lines were typed in - the same
    /// property `GIVES_EVERYTHING` asserts for a gift.
    #[test]
    fn the_document_order_of_the_buy_and_the_produce_changes_nothing() {
        let got = columns(
            3400,
            "20 grain [GRAI] at $20.",
            "PRODUCE catapult\nBUY 40 grain",
        );

        assert_eq!(got.items_catapults, 1);
        assert_eq!(got.items_grain, 20);
        assert_eq!(got.silver_produced, 1);
        assert_eq!(got.capped_by, Some(ProductionCap::Silver));
        assert_eq!(got.wanted, 4);
        assert_eq!(got.expense, Some(3400));
        assert_eq!(got.at_month_end, Some(0));
        assert_eq!(got.codes, ["region-pool-oversubscribed"]);
    }
}
