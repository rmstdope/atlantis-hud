//! `ah-nneu`. The Production window's facts: every region this month's orders use a tax or trade
//! slot in, what its tax collects, and how much of each raw resource it offers is produced.
//!
//! Rules each figure below rests on:
//! - `rules/tablefactionpoints`: Martial points cap the regions a faction may tax and trade in.
//! - `rules/economy_taxingpillaging`: "Each taxing character can collect $50, though if the number
//!   of taxers would tax more than the available tax income, the tax income is split evenly among
//!   all taxers"; and for PILLAGE "The amount of money collected is equal to twice the available
//!   tax money". "A unit may TAX if it has Combat skill of at least level 1".
//! - `rules/autotax`: the taxing flag "causes the unit to attempt to tax every turn (without
//!   requiring the TAX order)".
//! - `rules/produce`: `PRODUCE [item]` produces "as much as possible".

use atlantis_hud_core::orders::production_overview::{
    RegionLimits, SlotOrder, SlotOrderKind, WorkedResource,
};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// A report header, an optional `Faction Status:` block, then the given region blocks.
fn report(status: &[&str], hexes: &[String]) -> String {
    let mut lines: Vec<String> = ["Atlantis Report For:", "Foo (1)", "February, Year 1", ""]
        .iter()
        .map(ToString::to_string)
        .collect();
    if !status.is_empty() {
        lines.push("Faction Status:".to_string());
        lines.extend(status.iter().map(ToString::to_string));
        lines.push(String::new());
    }
    lines.extend(hexes.iter().cloned());
    lines.join("\n")
}

/// One plain hex at `(x,1)` with the given tax base, `Products` line and own unit lines.
fn hex(x: i64, tax: i64, products: &str, units: &[&str]) -> String {
    let mut lines = vec![
        format!("plain ({x},1) in Nowhere, 1000 peasants (orcs), ${tax}."),
        "------------------------------------------------------------".to_string(),
        "  Wages: $13.5 (Max: $633).".to_string(),
        "  Wanted: none.".to_string(),
        "  For Sale: 100 grain [GRAI] at $1.".to_string(),
        "  Entertainment available: $0.".to_string(),
        format!("  Products: {products}."),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (9,9) in Nowhere.".to_string(),
        String::new(),
    ];
    lines.extend(units.iter().map(ToString::to_string));
    lines.push(String::new());
    lines.join("\n")
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

const TAXER: &str = "* Taxer (900), Foo (1), behind, 1 orc [ORC]. Weight: 10. Capacity: 0/0/15/0. \
                     Skills: combat [COMB] 1 (30).";
const RAIDERS: &str = "* Raiders (901), Foo (1), behind, 10 orcs [ORC]. Weight: 100. \
                       Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30).";
const FARMER: &str =
    "* Farmer (902), Foo (1), behind, 1 orc [ORC]. Weight: 10. Capacity: 0/0/15/0. \
                      Skills: farming [FARM] 1 (30).";
const SMITHS: &str =
    "* Smiths (903), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON], 2 swords [SWOR]. Weight: 182. \
                      Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).";

#[test]
fn a_pooled_report_states_its_regions_limit() {
    let review = review_of(
        &report(&["Regions: 0 (40)"], &[hex(1, 600, "none", &[])]),
        "",
    );
    assert_eq!(
        review.production.limits,
        RegionLimits {
            pooled: Some(40),
            tax: None,
            trade: None
        }
    );
}

#[test]
fn an_older_report_states_both_limits() {
    let review = review_of(
        &report(
            &["Tax Regions: 0 (15)", "Trade Regions: 0 (15)"],
            &[hex(1, 600, "none", &[])],
        ),
        "",
    );
    assert_eq!(
        review.production.limits,
        RegionLimits {
            pooled: None,
            tax: Some(15),
            trade: Some(15)
        }
    );
}

#[test]
fn a_report_without_region_limits_states_none() {
    let review = review_of(&report(&[], &[hex(1, 600, "none", &[])]), "");
    assert_eq!(review.production.limits, RegionLimits::default());
}

/// Three hexes: one taxed and farmed by two units, one pillaged, one only farmed.
#[test]
fn every_taxed_pillaged_and_producing_region_is_listed_once() {
    let farmer_two = FARMER.replace("(902)", "(904)");
    let text = report(
        &["Regions: 0 (40)"],
        &[
            hex(1, 600, "10 grain [GRAI]", &[TAXER, &farmer_two]),
            hex(2, 1000, "none", &[RAIDERS]),
            hex(3, 600, "10 grain [GRAI]", &[FARMER]),
        ],
    );
    let review = review_of(
        &text,
        "unit 900\nTAX\nunit 904\nPRODUCE grain\nunit 901\nPILLAGE\nunit 902\nPRODUCE grain\n",
    );
    let regions = &review.production.regions;
    assert_eq!(regions.len(), 3, "{regions:#?}");

    let kinds = |index: usize| -> Vec<SlotOrderKind> {
        regions[index]
            .orders
            .iter()
            .map(|order| order.kind)
            .collect()
    };
    assert_eq!(kinds(0), vec![SlotOrderKind::Tax, SlotOrderKind::Produce]);
    assert!(regions[0].uses_tax_slot && regions[0].uses_trade_slot);
    assert_eq!(kinds(1), vec![SlotOrderKind::Pillage]);
    assert!(regions[1].uses_tax_slot && !regions[1].uses_trade_slot);
    assert_eq!(kinds(2), vec![SlotOrderKind::Produce]);
    assert!(!regions[2].uses_tax_slot && regions[2].uses_trade_slot);
}

#[test]
fn a_unit_taxing_by_its_flag_is_listed_as_tax_by_flag() {
    let flagged = TAXER.replace("behind,", "behind, taxing,");
    let review = review_of(
        &report(&["Regions: 0 (40)"], &[hex(1, 600, "none", &[&flagged])]),
        "",
    );
    let regions = &review.production.regions;
    assert_eq!(regions.len(), 1, "{regions:#?}");
    assert_eq!(
        regions[0].orders,
        vec![SlotOrder {
            kind: SlotOrderKind::TaxByFlag,
            crafted: None
        }]
    );
    assert!(regions[0].tax.taxed);
}

#[test]
fn buy_sell_and_transport_list_no_region() {
    let trader =
        "* Trader (905), Foo (1), behind, 1 orc [ORC], 100 silver [SILV], 5 grain [GRAI]. \
                  Weight: 15. Capacity: 0/0/15/0. Skills: none.";
    let review = review_of(
        &report(&["Regions: 0 (40)"], &[hex(1, 600, "none", &[trader])]),
        "unit 905\nBUY 1 grain\nSELL 1 grain\nTRANSPORT 2 1 grain\n",
    );
    assert!(
        review.production.regions.is_empty(),
        "{:#?}",
        review.production.regions
    );
}

#[test]
fn a_crafting_unit_names_its_item_and_still_reports_the_raw_resources() {
    let review = review_of(
        &report(
            &["Regions: 0 (40)"],
            &[hex(1, 600, "20 iron [IRON]", &[SMITHS])],
        ),
        "unit 903\nPRODUCE swords\n",
    );
    let regions = &review.production.regions;
    assert_eq!(regions.len(), 1, "{regions:#?}");
    assert_eq!(regions[0].orders.len(), 1);
    assert_eq!(regions[0].orders[0].kind, SlotOrderKind::Produce);
    let crafted = regions[0].orders[0]
        .crafted
        .as_deref()
        .expect("a crafted item is named");
    assert_eq!(crafted, "swords");
    assert_eq!(
        regions[0].resources,
        vec![WorkedResource {
            name: "iron".to_string(),
            tag: "IRON".to_string(),
            produced: 0,
            available: Some(20),
        }]
    );
}

/// One man taxes $50 of a $600 base.
#[test]
fn a_region_taxed_short_of_its_base_reports_what_is_collected() {
    let review = review_of(
        &report(&["Regions: 0 (40)"], &[hex(1, 600, "none", &[TAXER])]),
        "unit 900\nTAX\n",
    );
    let tax = &review.production.regions[0].tax;
    assert!(tax.taxed);
    assert_eq!(tax.base, Some(600));
    assert_eq!(tax.collected, 50);
    assert_eq!(tax.pillaged, None);
    assert!(!tax.at_most);
}

/// Two units of twenty men ask for $2,000 of a $600 base; they split the $600 between them.
#[test]
fn several_taxers_never_collect_more_than_the_base() {
    let big = TAXER.replace("1 orc [ORC]", "20 orcs [ORC]");
    let other = big.replace("(900)", "(906)");
    let review = review_of(
        &report(
            &["Regions: 0 (40)"],
            &[hex(1, 600, "none", &[&big, &other])],
        ),
        "unit 900\nTAX\nunit 906\nTAX\n",
    );
    assert_eq!(review.production.regions[0].tax.collected, 600);
}

#[test]
fn a_producing_hex_nobody_taxes_is_reported_untaxed() {
    let review = review_of(
        &report(
            &["Regions: 0 (40)"],
            &[hex(1, 400, "10 grain [GRAI]", &[FARMER])],
        ),
        "unit 902\nPRODUCE grain\n",
    );
    let tax = &review.production.regions[0].tax;
    assert!(!tax.taxed);
    assert_eq!(tax.collected, 0);
    assert_eq!(tax.base, Some(400));
}

/// Ten men at $50 collect $500, half the $1,000 base, so the take is twice the base.
#[test]
fn a_pillaged_region_reports_the_take() {
    let review = review_of(
        &report(&["Regions: 0 (40)"], &[hex(1, 1000, "none", &[RAIDERS])]),
        "unit 901\nPILLAGE\n",
    );
    assert_eq!(review.production.regions[0].tax.pillaged, Some(2000));
}

#[test]
fn every_listed_product_is_reported_with_what_is_produced_of_it() {
    let review = review_of(
        &report(
            &["Regions: 0 (40)"],
            &[hex(1, 600, "24 grain [GRAI], 6 horses [HORS]", &[FARMER])],
        ),
        "unit 902\nPRODUCE grain\n",
    );
    let produced = review
        .silver
        .iter()
        .find(|row| row.unit_id == "902")
        .expect("the farmer has a row")
        .produced;
    assert!(produced > 0, "the farmer produces something");
    let resources = &review.production.regions[0].resources;
    assert_eq!(
        resources,
        &vec![
            WorkedResource {
                name: "grain".to_string(),
                tag: "GRAI".to_string(),
                produced,
                available: Some(24),
            },
            WorkedResource {
                name: "horses".to_string(),
                tag: "HORS".to_string(),
                produced: 0,
                available: Some(6),
            },
        ]
    );
}

/// The cut-short hex-mate of `a_hex_shared_with_an_unread_unit.rs`: unit 1288 taxes by its flag
/// beside a unit whose line lost its tail, so its share is a ceiling.
#[test]
fn a_taxers_share_beside_an_unread_unit_is_at_most() {
    let cut = atlantis_hud_fixtures::G5_F21_T39.text.replace(
        "* Drone (8537), Borg (21), avoiding, behind, revealing faction,",
        "* Drone (8537), Borg (21), avoiding, revealing faction,",
    );
    let ruleset = ruleset();
    let mut parsed = parse_report_full(&cut);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(&cut)
        .map(|template| template.text)
        .unwrap_or_default();
    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    let home = review
        .silver
        .iter()
        .find(|row| row.unit_id == "1288")
        .expect("unit 1288 has a row");
    assert!(
        home.income_in_time_at_most,
        "the cut still bounds the taxer"
    );
    let region = review
        .production
        .regions
        .iter()
        .find(|region| region.region_id == home.region_id)
        .expect("the taxer's region is listed");
    assert!(region.tax.at_most);
}

/// `UnitSilver::produced` is one figure per unit: a repeated `PRODUCE grain` line, or a second
/// PRODUCE for another resource, must not credit that figure twice.
#[test]
fn a_units_output_is_credited_once_to_the_resource_it_produces() {
    let text = report(
        &["Regions: 0 (40)"],
        &[hex(1, 600, "24 grain [GRAI], 6 horses [HORS]", &[FARMER])],
    );
    let once = review_of(&text, "unit 902\nPRODUCE grain\n");
    let produced = once.production.regions[0].resources[0].produced;
    assert!(produced > 0);

    let repeated = review_of(&text, "unit 902\nPRODUCE grain\nPRODUCE grain\n");
    assert_eq!(
        repeated.production.regions[0].resources[0].produced,
        produced
    );

    let both = review_of(&text, "unit 902\nPRODUCE grain\nPRODUCE horses\n");
    let resources = &both.production.regions[0].resources;
    assert_eq!(
        resources[0].produced + resources[1].produced,
        resources.iter().map(|r| r.produced).max().unwrap_or(0)
    );
}
