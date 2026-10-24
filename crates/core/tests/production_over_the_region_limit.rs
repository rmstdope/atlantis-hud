//! Over the faction's region limit, the refused region's production is not counted (`ah-gcrc`).
//!
//! `neworigins-3.0.0-g5-f21-t24` prints `Regions: 10 (10)` - New Origins pools taxing and trade into
//! one allowance (`rules/tablefactionpoints`: "max tax and trade regions"). Its template orders TAX
//! in eight regions and PRODUCE in three more: ocean (38,44), ocean (37,45) and swamp (35,47),
//! where Drones (11852) and (11853) produce floater hides and TRANSPORT them to Unit (8333).
//!
//! The engine records every taxed region first, in the tax phase (`../Atlantis` `runorders.cpp`,
//! `ActivityCheck(..., TAX)`), then walks the regions in its region list's order for the month's
//! production (`monthorders.cpp` `RunMonthOrders` -> `ValidProd`), refusing "PRODUCE: Faction can't
//! produce in that many regions." once the allowance is spent. The report lists regions in that
//! same order (`faction.cpp` `present_regions`), so swamp (35,47), listed after both oceans, is the
//! region refused - and the real turn 25 says exactly that, for 11852 and 11853 both.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

fn template(text: &str) -> String {
    extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template")
}

fn floa(row: &atlantis_hud_core::orders::effects::UnitPreview) -> i64 {
    row.unit
        .items
        .iter()
        .filter(|item| item.tag.eq_ignore_ascii_case("FLOA"))
        .map(|item| item.amount)
        .sum()
}

#[test]
fn the_refused_swamps_floater_hides_are_neither_produced_nor_shipped() {
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let orders = template(text);
    assert!(
        orders.contains("unit 11852\n") && orders.contains("@produce floa"),
        "the fixture still orders unit 11852 to PRODUCE FLOA"
    );
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &orders,
    )
    .expect("the committed ruleset loads");

    for producer in ["11852", "11853"] {
        // Its orders now change nothing the preview shows - no goods made, none sent - so the
        // producer has no preview row at all. Before the fix it had one, producing 3 FLOA.
        let row = common::preview_row(text, &preview, producer);
        assert!(
            row.is_none(),
            "{producer} produces nothing in the refused swamp: {:?}",
            row.map(|row| (&row.produced, floa(row)))
        );
    }
    let quartermaster = common::expect_preview_row(text, &preview, "8333");
    assert_eq!(
        floa(quartermaster),
        0,
        "nothing is shipped to 8333: {:?}",
        quartermaster.unit.items
    );
}

/// `(unit, line text, message)` of every region-limit warning `orders` draws, in reported order.
fn region_limit_warnings(orders: &str) -> Vec<(String, String, String)> {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let lines: Vec<&str> = orders.lines().collect();

    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code.as_str() == "too-many-trade-regions")
        .map(|finding| {
            let line = finding
                .line
                .map(|line| lines[line - 1].to_string())
                .unwrap_or_default();
            (finding.unit_id.unwrap_or_default(), line, finding.message)
        })
        .collect()
}

fn warning(unit: &str, line: &str, message: &str) -> (String, String, String) {
    (unit.to_string(), line.to_string(), message.to_string())
}

/// Each refused order is warned on its own line, and the faction-wide sentence sits on the first
/// refused order the game reaches - not on Drones (2404), whose TAX the limit lets through
/// (`ah-jhc2`). Units 9579 and 9557 fish from the oceans the swamp's production is walked after,
/// which the limit lets through too: only the swamp is refused.
#[test]
fn each_refused_order_is_warned_and_the_sentence_sits_on_the_first() {
    let short =
        "this faction may tax and trade in 10 regions and this one is past the limit, so this \
                 PRODUCE will be refused";
    let warnings = region_limit_warnings(&template(atlantis_hud_fixtures::G5_F21_T24.text));

    assert_eq!(
        warnings,
        [
            warning("11852", "@produce floa", short),
            warning(
                "11852",
                "@produce floa",
                "PRODUCE, TAX and PILLAGE orders in 11 regions; this faction may tax and trade in \
                 10, so 1 region's orders will be refused: swamp (35,47)"
            ),
            warning("11853", "@produce floa", short),
        ]
    );
    assert!(warnings.iter().all(|(unit, ..)| unit != "2404"));
}

/// Drone (9935) taxing the plain (34,50): with two more taxed regions ahead of it the tax walk
/// spends the limit before it reaches the plain, so its TAX is refused and warned on its own line.
#[test]
fn a_refused_tax_in_the_plain_is_warned_on_drone_9935() {
    let mut orders = template(atlantis_hud_fixtures::G5_F21_T24.text);
    for unit in ["9935", "8572", "9936"] {
        orders = orders.replace(&format!("unit {unit}\n"), &format!("unit {unit}\nTAX\n"));
    }

    let warnings = region_limit_warnings(&orders);
    let on_9935: Vec<_> = warnings
        .iter()
        .filter(|(unit, ..)| unit == "9935")
        .collect();

    assert_eq!(
        on_9935,
        [
            &warning(
                "9935",
                "TAX",
                "this faction may tax and trade in 10 regions and this one is past the limit, so \
                 this TAX will be refused"
            ),
            // The tax phase runs before any production, so the plain is the first refused region
            // the game reaches, and its TAX carries the sentence.
            &warning(
                "9935",
                "TAX",
                "PRODUCE, TAX and PILLAGE orders in 14 regions; this faction may tax and trade in \
                 10, so 4 regions' orders will be refused: plain (34,50), ocean (38,44), ocean \
                 (37,45), swamp (35,47)"
            ),
        ]
    );
    assert!(warnings.iter().all(|(unit, ..)| unit != "2404"));
}
