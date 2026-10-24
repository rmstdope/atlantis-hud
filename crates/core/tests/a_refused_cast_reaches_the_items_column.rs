//! A create-artifact `CAST` the game refuses reaches the ITEMS column as a fact of its own: what it
//! would have made and what it is short of, so the cell can end the short material red and the
//! hover strike the product through (`ah-44at`). A cast that goes ahead carries nothing of the
//! kind.
//!
//! `data/SWIN` level 3: "a 20 percent times their level chance to create a Cloudship [CLOU] via
//! magic at a cost of 75 floater hides [FLOA] and 75 ironwood [IRWD]", so a level 3 mage's
//! would-be yield is 0-1. `data/CRPA` level 1: "create their level in amulets of protection
//! [AMPR] via magic at a cost of 200 silver [SILV]", so a level 1 mage makes exactly one.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, RefusedCast, RefusedProduct, ShortMaterial,
};
use atlantis_hud_core::report::orders::extract_orders_template;

use crate::common;

/// One hex and one mage, Ivanhoe (683), whose line carries `items` after its men and `skill`.
fn report(items: &str, skill: &str) -> String {
    report_beside(items, skill, "")
}

/// The same, with `neighbour` - a whole unit line - standing beside him.
fn report_beside(items: &str, skill: &str, neighbour: &str) -> String {
    let mage = format!(
        "* Ivanhoe (683), Foo (1), behind, orc [ORC]{items}. Weight: 10. Capacity: 0/0/15/0. \
         Skills: {skill}."
    );
    [
        "Foo (1) Report",
        "",
        "desert (0,48) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : desert (1,49) in Nowhere.",
        "",
        &mage,
        neighbour,
        "",
    ]
    .join("\n")
}

/// What the ITEMS column is told about Ivanhoe's refused casts, given his report line and orders.
fn refused_casts(items: &str, skill: &str, script: &str) -> Vec<RefusedCast> {
    refused_casts_in(&report(items, skill), script)
}

fn refused_casts_in(report_text: &str, script: &str) -> Vec<RefusedCast> {
    let report_text = report_text.to_string();
    let template = extract_orders_template(&report_text)
        .map(|template| template.text)
        .unwrap_or_default();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report_text,
        "[]",
        &format!("{template}\nunit 683\n{script}\n"),
    )
    .expect("the ruleset loads");
    let orders = format!("{template}\nunit 683\n{script}\n");
    // The line the CAST is written on, wherever the template leaves it (`ah-rjz2`).
    let cast_line = orders
        .lines()
        .position(|line| line.starts_with("CAST"))
        .map_or(0, |index| index as i64 + 1);
    let mut casts = common::expect_preview_row(&report_text, &preview, "683")
        .refused_casts
        .clone();
    for cast in &mut casts {
        assert_eq!(cast.line, cast_line, "{cast:?}");
        cast.line = 0;
    }
    casts
}

const WIND: &str = "summon wind [SWIN] 3 (180)";

#[test]
fn a_refused_cast_short_of_a_material_reaches_the_preview() {
    assert_eq!(
        refused_casts(", 75 ironwood [IRWD]", WIND, "CAST Summon_Wind"),
        [RefusedCast {
            line: 0,
            product: Some(RefusedProduct {
                tag: "CLOU".to_string(),
                name: "Cloudship".to_string(),
                fewest: 0,
                most: 1,
            }),
            silver_short: 0,
            short: vec![ShortMaterial {
                tag: "FLOA".to_string(),
                name: "floater hide".to_string(),
                // Nobody in this report holds more than one, so there is no plural to read.
                plural: "floater hide".to_string(),
                amount: 75,
            }],
        }]
    );
}

#[test]
fn a_refused_cast_short_of_silver_reaches_the_preview() {
    let refused = refused_casts(
        "",
        "create amulet of protection [CRPA] 1 (30)",
        "CAST Create_Amulet_Of_Protection",
    );
    assert_eq!(refused.len(), 1, "{refused:?}");
    assert_eq!(refused[0].silver_short, 200, "{refused:?}");
    assert!(refused[0].short.is_empty(), "{refused:?}");
    assert_eq!(
        refused[0].product.as_ref().map(|product| (
            product.tag.as_str(),
            product.fewest,
            product.most
        )),
        Some(("AMPR", 1, 1)),
        "{refused:?}"
    );
}

#[test]
fn a_cast_that_goes_ahead_carries_no_refused_cast() {
    assert_eq!(
        refused_casts(
            ", 75 ironwood [IRWD], 75 floater hides [FLOA]",
            WIND,
            "CAST Summon_Wind"
        ),
        []
    );
}

/// Brian (1159) holds the hides and is not sharing: the cast is still refused, and the shortfall
/// carries the report's own plural, `floater hides`, for a sentence that counts more than one
/// (`counted_item`, `ah-rsdz`).
#[test]
fn a_refused_casts_shortfall_takes_the_reports_plural() {
    let report_text = report_beside(
        ", 75 ironwood [IRWD]",
        WIND,
        "- Brian (1159), Bar (2), orc [ORC], 75 floater hides [FLOA]. Weight: 85.",
    );
    let refused = refused_casts_in(&report_text, "CAST Summon_Wind");
    assert_eq!(
        refused
            .iter()
            .flat_map(|cast| cast.short.iter())
            .map(|short| (short.name.as_str(), short.plural.as_str(), short.amount))
            .collect::<Vec<_>>(),
        [("floater hide", "floater hides", 75)]
    );
}
