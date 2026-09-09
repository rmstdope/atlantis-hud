//! A `CAST` by a unit whose share of a contended regional tax pool is smaller than the pool is
//! capped by that **settled share**, on both surfaces, from one figure (`ah-ud89.1`).
//!
//! `rules/economy_taxingpillaging`: *"Each taxing character can collect $50, though if the number
//! of taxers would tax more than the available tax income, the tax income is split evenly among
//! all taxers."* Two ten-orc taxers each want `10 * 50 = $500`, so any pool below $1000 is
//! oversubscribed and each collects half of it.
//!
//! `data/CRPA` prices Create Amulet of Protection at 200 silver and creates the caster's level in
//! amulets at 100% per level, so the level-1 mage below makes exactly one if it can pay.
//!
//! Before this bead both silver caps read the region's **whole** pool while the Silver column
//! showed only the settled share, so the mage was told it made an amulet the game would refuse.
//!
//! Both surfaces are read per row, because they are independently computed and are held to each
//! other: the SILVER column through `review_turn`, the ITEMS column through
//! `preview_orders_for_remembered_report`.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::ProductionCap;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex whose region states a tax base of `pool`, unit 900 a level-1 CRPA mage of ten orcs and
/// - unless `alone` - unit 901 a second ten-orc taxer contending for the same pool.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn report(pool: i64, alone: bool) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        format!("plain (1,1) in Nowhere, 10 peasants (orcs), ${pool}."),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        "* Mages (900), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
         Skills: create amulet of protection [CRPA] 1 (30), combat [COMB] 1 (30)."
            .to_string(),
    ];
    if !alone {
        lines.push(
            "* Guards (901), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: combat [COMB] 1 (30)."
                .to_string(),
        );
    }
    lines.push(String::new());
    lines.join("\n")
}

fn orders_for(pool: i64, alone: bool) -> String {
    let text = report(pool, alone);
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let second = if alone { "" } else { "unit 901\nTAX\n" };
    format!("{template}\nunit 900\nTAX\nCAST Create_Amulet_Of_Protection\n{second}")
}

/// One row of the table in `ah-ud89.1`'s test plan.
struct Row {
    pool: i64,
    alone: bool,
    income: i64,
    cast_made: i64,
    capped_by: Option<ProductionCap>,
    expense: i64,
    at_month_end: i64,
    amulets: i64,
}

fn rows() -> Vec<Row> {
    vec![
        Row {
            pool: 300,
            alone: false,
            income: 150,
            cast_made: 0,
            capped_by: Some(ProductionCap::Silver),
            expense: 0,
            at_month_end: 150,
            amulets: 0,
        },
        Row {
            pool: 200,
            alone: false,
            income: 100,
            cast_made: 0,
            capped_by: Some(ProductionCap::Silver),
            expense: 0,
            at_month_end: 100,
            amulets: 0,
        },
        // The one row the tax split did **not** cause: even the hopeful purse - the whole $100
        // pool - buys no $200 amulet, so `ah-ofpb.4`'s floor still charges for one and the shipped
        // `not-enough-silver` warning still fires. Unchanged from what Psylocke measured
        // (`castMade=0`, `cappedBy=Silver`, `monthEnd=-150`), and what the parent `ah-ud89`'s
        // *Agreed with the navigator* says must stay that way.
        Row {
            pool: 100,
            alone: false,
            income: 50,
            cast_made: 0,
            capped_by: Some(ProductionCap::Silver),
            expense: 200,
            at_month_end: -150,
            amulets: 0,
        },
        // The control: one taxer at pool $200 is uncontended, so nothing moved for it.
        Row {
            pool: 200,
            alone: true,
            income: 200,
            cast_made: 1,
            capped_by: None,
            expense: 200,
            at_month_end: 0,
            amulets: 1,
        },
    ]
}

fn label(row: &Row) -> String {
    format!(
        "pool ${}, {} taxer(s)",
        row.pool,
        if row.alone { "one" } else { "two" }
    )
}

#[test]
fn a_contended_taxers_cast_is_capped_by_its_share_of_the_pool() {
    for row in rows() {
        let text = report(row.pool, row.alone);
        let mut parsed = parse_report_full(&text);
        classify_units(&mut parsed, &ruleset());
        let review = review_turn(
            &parsed,
            &orders_for(row.pool, row.alone),
            Some(&ruleset()),
            CheckOptions::default(),
        );
        let silver = review
            .silver
            .iter()
            .find(|silver| silver.unit_id == "900")
            .unwrap_or_else(|| panic!("{}: the silver column has a row for the mage", label(&row)));

        let name = label(&row);
        assert_eq!(silver.income, Some(row.income), "{name}: settled income");
        assert_eq!(silver.cast_made, row.cast_made, "{name}: amulets cast");
        assert_eq!(
            silver.cast_capped_by, row.capped_by,
            "{name}: what capped the cast"
        );
        assert_eq!(silver.expense, Some(row.expense), "{name}: silver spent");
        assert_eq!(
            silver.at_month_end,
            Some(row.at_month_end),
            "{name}: at month end"
        );

        let preview = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            atlantis_hud_fixtures::RULESET_JSON,
            &text,
            "[]",
            &orders_for(row.pool, row.alone),
        )
        .expect("the ruleset loads");
        // A unit the preview has nothing to say about does not appear in it at all, so a mage
        // that now creates nothing is absent rather than present with a zero - which is itself the
        // ITEMS surface no longer carrying an amulet the game would refuse.
        let amulets: i64 = preview
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .filter(|unit| unit.unit.unit_id == "900")
            .flat_map(|unit| unit.created.iter())
            .filter(|created| created.tag == "AMPR")
            .map(|created| created.most)
            .sum();
        assert_eq!(amulets, row.amulets, "{name}: amulets created");
        assert_eq!(
            silver.cast_made, amulets,
            "{name}: the two surfaces agree about the count"
        );
    }
}

/// The positive anchor under the rows above: `amulets == 0` is also what a fixture that stopped
/// parsing, a renamed unit or a broken preview would produce, and a contended mage that creates
/// nothing is *absent* from the preview rather than present with a zero - so the preview cannot be
/// asserted non-empty on those rows. This gives the mage silver of its own, so the same two-taxer
/// fixture, the same orders and the same preview call *do* reach it and *do* make the amulet.
#[test]
fn the_same_contended_fixture_does_reach_the_preview_when_the_mage_can_pay() {
    let text = report(300, false).replace(
        "* Mages (900), Foo (1), 10 orcs [ORC].",
        "* Mages (900), Foo (1), 10 orcs [ORC], 200 silver [SILV].",
    );
    assert!(
        text.contains("200 silver [SILV]"),
        "the fixture was rewritten"
    );

    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders =
        format!("{template}\nunit 900\nTAX\nCAST Create_Amulet_Of_Protection\nunit 901\nTAX\n");

    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &orders,
    )
    .expect("the ruleset loads");
    let amulets: i64 = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.unit.unit_id == "900")
        .flat_map(|unit| unit.created.iter())
        .filter(|created| created.tag == "AMPR")
        .map(|created| created.most)
        .sum();

    assert_eq!(
        amulets, 1,
        "$150 of settled tax plus $200 held pays for one amulet"
    );
}

fn findings_for(pool: i64) -> Vec<String> {
    let text = report(pool, false);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());
    review_turn(
        &parsed,
        &orders_for(pool, false),
        Some(&ruleset()),
        CheckOptions::default(),
    )
    .findings
    .iter()
    .filter(|finding| finding.unit_id.is_none() || finding.unit_id.as_deref() == Some("900"))
    .map(|finding| finding.code.as_str().to_string())
    .collect()
}

/// A mage that could not have paid even out of the region's whole pool keeps its charge **and its
/// warning** - `ah-ofpb.4`'s floor, which the parent `ah-ud89`'s *Agreed with the navigator* says
/// in as many words must not move. At pool $100 the hopeful purse is $100 and the amulet is $200,
/// so nothing about this row is the tax split's doing.
#[test]
fn a_mage_that_could_never_pay_is_still_warned() {
    assert!(
        findings_for(100)
            .iter()
            .any(|code| code == "not-enough-silver"),
        "the pool-$100 mage keeps the warning it has always had"
    );
}

/// No finding appears or disappears: the ledger keeps the hopeful balance everywhere else, so the
/// hex still reports its oversubscribed pool and the mage is still not warned about its silver.
#[test]
fn no_finding_moves_when_the_tax_split_caps_a_cast() {
    let text = report(200, false);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());
    let review = review_turn(
        &parsed,
        &orders_for(200, false),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    assert!(
        review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "region-pool-oversubscribed"),
        "the hex still reports its oversubscribed pool"
    );
    assert!(
        !review.findings.iter().any(|finding| {
            finding.unit_id.as_deref() == Some("900")
                && finding.code.as_str() == "not-enough-silver"
        }),
        "the mage is not warned: against the hopeful purse it could have paid"
    );
}
