//! A cast is funded by the silver its unit holds **when spells resolve**, not by the silver the
//! report opened with, and not by whichever orders happened to be written above it (`ah-gdd3.1`).
//!
//! `rules/sequenceofevents` settles CLAIM, then GIVE/TAKE, then TAX, all before
//! *"Instant Magic ... Spells are CAST"*, and opens the market (*"SELL orders are processed. BUY
//! orders are processed."*) only afterwards. So a `CLAIM 200` funds a cast whichever line it was
//! written on, and a `GIVE` of the same silver stops one whichever line *it* was written on.
//!
//! `data/CRPA` prices Create Amulet of Protection at 200 silver and creates the caster's level in
//! amulets of protection at 100% per level, so the level-1 mage below makes exactly one.
//!
//! Both surfaces are read, per case, because they are independently computed and are held to each
//! other: the SILVER column through `review_turn`, and the ITEMS column through
//! `preview_orders_for_remembered_report`.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::ProductionCap;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, a level-1 CRPA mage holding `silver`, and a neighbour to give to.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`. `Unclaimed silver:` sits between the title line and the first region block,
/// which is where `parse_header_of` reads a faction's unclaimed fund - and what makes `CLAIM`
/// priceable on both surfaces.
fn report(silver: i64) -> String {
    let mage = if silver > 0 {
        format!(
            "* Mages (900), Foo (1), behind, orc [ORC], {silver} silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0. Skills: create amulet of protection [CRPA] 1 (30)."
        )
    } else {
        "* Mages (900), Foo (1), behind, orc [ORC]. Weight: 10. Capacity: 0/0/15/0. \
         Skills: create amulet of protection [CRPA] 1 (30)."
            .to_string()
    };
    [
        "Foo (1) Report",
        "",
        "Unclaimed silver: 1000.",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        &mage,
        "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "",
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

/// Mage holding, the orders in the order they are written, and what the turn must say.
struct Case {
    holds: i64,
    script: &'static str,
    cast_made: i64,
    capped_by: Option<ProductionCap>,
    expense: Option<i64>,
    amulets: i64,
    warns: bool,
}

/// A mage that cannot afford even one amulet is still *charged* for one - `plan_cast` charges
/// `max(1, made)` whenever the level wants any, which is what raises `not-enough-silver`.
fn cases() -> Vec<Case> {
    vec![
        Case {
            holds: 0,
            script: "CLAIM 200\nCAST Create_Amulet_Of_Protection",
            cast_made: 1,
            capped_by: None,
            expense: Some(200),
            amulets: 1,
            warns: false,
        },
        Case {
            holds: 0,
            script: "CAST Create_Amulet_Of_Protection\nCLAIM 200",
            cast_made: 1,
            capped_by: None,
            expense: Some(200),
            amulets: 1,
            warns: false,
        },
        Case {
            holds: 200,
            script: "GIVE 901 200 SILV\nCAST Create_Amulet_Of_Protection",
            cast_made: 0,
            capped_by: Some(ProductionCap::Silver),
            expense: Some(400),
            amulets: 0,
            warns: true,
        },
        Case {
            holds: 200,
            script: "CAST Create_Amulet_Of_Protection\nGIVE 901 200 SILV",
            cast_made: 0,
            capped_by: Some(ProductionCap::Silver),
            expense: Some(400),
            amulets: 0,
            warns: true,
        },
    ]
}

/// A misplaced `Unclaimed silver:` line would make every `CLAIM` earn nothing and pass cases 3 and
/// 4 for the wrong reason, so the fixture says out loud that the fund is read.
#[test]
fn the_fixture_gives_the_faction_an_unclaimed_fund() {
    assert_eq!(
        parse_report_full(&report(0)).header.unclaimed_silver,
        Some(1000)
    );
}

#[test]
fn the_silver_column_prices_a_cast_from_the_silver_the_turn_leaves_it() {
    for (index, case) in cases().iter().enumerate() {
        let text = report(case.holds);
        let mut parsed = parse_report_full(&text);
        classify_units(&mut parsed, &ruleset());

        let review = review_turn(
            &parsed,
            &orders_for(case.holds, case.script),
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let silver = review
            .silver
            .iter()
            .find(|silver| silver.unit_id == "900")
            .unwrap_or_else(|| {
                panic!(
                    "case {}: the silver column has a row for the mage",
                    index + 1
                )
            });

        assert_eq!(
            silver.cast_made,
            case.cast_made,
            "case {}: amulets cast",
            index + 1
        );
        assert_eq!(
            silver.cast_capped_by,
            case.capped_by,
            "case {}: what capped the cast",
            index + 1
        );
        assert_eq!(
            silver.expense,
            case.expense,
            "case {}: silver spent",
            index + 1
        );
    }
}

#[test]
fn the_items_column_and_its_warning_agree_with_it() {
    for (index, case) in cases().iter().enumerate() {
        let preview = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            atlantis_hud_fixtures::RULESET_JSON,
            &report(case.holds),
            "[]",
            &orders_for(case.holds, case.script),
        )
        .expect("the ruleset loads");

        let previewed = preview
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == "900")
            .unwrap_or_else(|| panic!("case {}: the preview has the mage", index + 1));

        let amulets: i64 = previewed
            .created
            .iter()
            .filter(|created| created.tag == "AMPR")
            .map(|created| created.most)
            .sum();
        assert_eq!(amulets, case.amulets, "case {}: amulets created", index + 1);

        let text = report(case.holds);
        let mut parsed = parse_report_full(&text);
        classify_units(&mut parsed, &ruleset());
        let review = review_turn(
            &parsed,
            &orders_for(case.holds, case.script),
            Some(&ruleset()),
            CheckOptions::default(),
        );
        assert!(
            review.silver.iter().any(|silver| silver.unit_id == "900"),
            "case {}: the mage is priced at all",
            index + 1
        );
        let warned = review.findings.iter().any(|finding| {
            finding.unit_id.as_deref() == Some("900")
                && finding.code.as_str() == "not-enough-silver"
        });
        assert_eq!(warned, case.warns, "case {}: not-enough-silver", index + 1);
    }
}
