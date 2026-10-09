//! `ah-m24v`. A `CREATE VILLAGE` the 3-hex rule refuses founds nothing.
//!
//! `newage trident rules/create_village`: *"Requirements: the region must have no existing
//! settlement, must not be ocean, lake, volcano, or barren terrain, and must be at least 3 hexes
//! away from any other settlement."* So a settlement one or two hexes away refuses the order, and
//! the founders and wagons stay. Where the map known from the reports cannot rule such a
//! settlement out, the navigator decided on the bead (2026-10-09) that the founders are consumed
//! and the order carries a warning.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::graph::RememberedRegion;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::parse_report_full;
use atlantis_hud_core::OrderValidationResult;

mod common;

const CREATE: &str = "CREATE VILLAGE \"New Hope\"";
const CODE: &str = "village-near-a-settlement";

/// Settlers (900) with 1005 orcs and 102 wagons in plain (10,10), and the region's exits as given.
fn report_with(exits: &[String], more: &[String]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (10,10) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
        "Exits:".to_string(),
    ];
    lines.extend(exits.iter().cloned());
    lines.extend([
        String::new(),
        "* Settlers (900), Foo (1), 1005 orcs [ORC], 102 wagons [WAGO], 20000 silver [SILV]. \
         Weight: 10000. Capacity: 0/0/15000/0."
            .to_string(),
        String::new(),
    ]);
    lines.extend(more.iter().cloned());
    lines.join("\n")
}

/// The six directions and the step each takes, `x + y` keeping its parity.
const DIRECTIONS: [(&str, i32, i32); 6] = [
    ("North", 0, -2),
    ("Northeast", 1, -1),
    ("Southeast", 1, 1),
    ("South", 0, 2),
    ("Southwest", -1, 1),
    ("Northwest", -1, -1),
];

fn exit(direction: &str, x: i32, y: i32, settlement: Option<&str>) -> String {
    match settlement {
        Some(name) => format!("  {direction} : plain ({x},{y}) in Nowhere, contains {name}."),
        None => format!("  {direction} : plain ({x},{y}) in Nowhere."),
    }
}

/// Every exit of (`x`,`y`), none of them settled.
fn all_exits(x: i32, y: i32) -> Vec<String> {
    DIRECTIONS
        .iter()
        .map(|(direction, dx, dy)| exit(direction, x + dx, y + dy, None))
        .collect()
}

/// A region block of its own, with every exit named and none settled - an unpeopled neighbour the
/// report describes.
fn neighbour(x: i32, y: i32) -> Vec<String> {
    let mut block = vec![
        format!("plain ({x},{y}) in Nowhere, 10 peasants (orcs), $5."),
        String::new(),
        "Exits:".to_string(),
    ];
    block.extend(all_exits(x, y));
    block.push(String::new());
    block
}

/// The report with every hex within two of (10,10) described, and none of them settled.
fn fully_known_report() -> String {
    let more: Vec<String> = DIRECTIONS
        .iter()
        .flat_map(|(_, dx, dy)| neighbour(10 + dx, 10 + dy))
        .collect();
    report_with(&all_exits(10, 10), &more)
}

fn script(text: &str) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let template = common::without_standing_month_orders(&template, &["900"]);
    format!("{template}\nunit 900\n{CREATE}\n")
}

fn held(text: &str, remembered: &str, tag: &str, unchanged: i64) -> i64 {
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        text,
        remembered,
        &script(text),
    )
    .expect("the Trident ruleset loads");
    common::preview_row(text, &preview, "900")
        .map_or(unchanged, |unit| common::held_before_upkeep(unit, tag))
}

fn validate(text: &str, remembered: &str) -> OrderValidationResult {
    validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: script(text),
            ruleset_json: Some(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON.to_string()),
            raw_report: Some(text.to_string()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some(remembered.to_string()),
        },
    )
}

fn warnings(result: &OrderValidationResult) -> Vec<String> {
    result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == CODE)
        .map(|diagnostic| diagnostic.message.clone())
        .collect()
}

fn upkeep(result: &OrderValidationResult) -> Option<i64> {
    result
        .silver
        .iter()
        .find(|row| row.unit_id == "900")
        .expect("the column has a row for the unit")
        .upkeep
}

/// A village at (10,6), North twice from (10,10), remembered from an earlier turn's report. The
/// current report shows (10,6) only as an exit of (10,8), which names no settlement there.
fn remembered_village_two_hexes_north() -> String {
    let text = [
        "Foo (1) Report",
        "",
        "plain (10,6) in Nowhere, contains Oldtown [village], 100 peasants (orcs), $50.",
        "",
        "Exits:",
        "  South : plain (10,8) in Nowhere.",
        "",
    ]
    .join("\n");
    let region = parse_report_full(&text)
        .regions
        .into_iter()
        .next()
        .expect("the block is read");
    serde_json::to_string(&[RememberedRegion {
        region,
        last_seen_turn: 1,
    }])
    .expect("serialises")
}

#[test]
fn a_settlement_next_door_refuses_the_founding() {
    let mut exits = all_exits(10, 10);
    exits[2] = exit("Southeast", 11, 11, Some("Oldtown [village]"));
    let text = report_with(&exits, &[]);

    assert_eq!(
        held(&text, "[]", "ORC", 1005),
        1005,
        "nobody founds anything"
    );
    assert_eq!(held(&text, "[]", "WAGO", 102), 102, "the wagons stay");

    let result = validate(&text, "[]");
    assert_eq!(
        warnings(&result),
        vec![
            "CREATE VILLAGE will be refused: Oldtown [village] at (11,11) is within 2 hexes, and a \
             village must be at least 3 hexes from any other settlement"
                .to_string()
        ]
    );
    assert_eq!(upkeep(&result), Some(10050), "every founder is still fed");
}

#[test]
fn a_remembered_settlement_two_hexes_away_refuses_the_founding() {
    let text = fully_known_report();
    let remembered = remembered_village_two_hexes_north();

    assert_eq!(held(&text, &remembered, "ORC", 1005), 1005);
    assert_eq!(held(&text, &remembered, "WAGO", 102), 102);

    let result = validate(&text, &remembered);
    assert_eq!(
        warnings(&result),
        vec![
            "CREATE VILLAGE will be refused: Oldtown [village] at (10,6) is within 2 hexes, and a \
             village must be at least 3 hexes from any other settlement"
                .to_string()
        ]
    );
    assert_eq!(upkeep(&result), Some(10050));
}

#[test]
fn a_neighbourhood_known_to_be_empty_founds_without_a_warning() {
    let text = fully_known_report();

    assert_eq!(held(&text, "[]", "ORC", 1005), 5, "1000 orcs found it");
    assert_eq!(held(&text, "[]", "WAGO", 102), 2);

    let result = validate(&text, "[]");
    assert_eq!(warnings(&result), Vec::<String>::new());
    assert_eq!(upkeep(&result), Some(50));
}

#[test]
fn a_neighbourhood_the_reports_do_not_show_founds_with_a_warning() {
    // (10,10)'s own exits are known; the ring two hexes out is not.
    let text = report_with(&all_exits(10, 10), &[]);

    assert_eq!(
        held(&text, "[]", "ORC", 1005),
        5,
        "the founders are consumed"
    );
    assert_eq!(held(&text, "[]", "WAGO", 102), 2);

    let result = validate(&text, "[]");
    assert_eq!(
        warnings(&result),
        vec![
            "a settlement within 2 hexes may not be visible on the known map; CREATE VILLAGE is \
             refused if there is one"
                .to_string()
        ]
    );
    assert_eq!(upkeep(&result), Some(50));
}

/// Settlers form a unit, hand it the founders and the wagons, and the new unit founds.
fn form_script(text: &str) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let template = common::without_standing_month_orders(&template, &["900"]);
    format!(
        "{template}\nunit 900\nFORM 1\n{CREATE}\nEND\nGIVE NEW 1 1000 ORC\nGIVE NEW 1 100 WAGO\n"
    )
}

/// A unit formed this month is a founder like any other: its own CREATE is judged against the
/// settlement next door (review finding 1 on PR #1487).
#[test]
fn a_founder_formed_this_month_is_refused_next_to_a_settlement() {
    let mut exits = all_exits(10, 10);
    exits[2] = exit("Southeast", 11, 11, Some("Oldtown [village]"));
    let text = report_with(&exits, &[]);

    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        &form_script(&text),
    )
    .expect("the Trident ruleset loads");
    let formed = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.formed)
        .expect("the formed unit has a row");
    assert_eq!(
        common::held_before_upkeep(formed, "ORC"),
        1000,
        "nobody founds anything"
    );
    assert_eq!(common::held_before_upkeep(formed, "WAGO"), 100);

    let result = validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: form_script(&text),
            ruleset_json: Some(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON.to_string()),
            raw_report: Some(text.clone()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    );
    assert_eq!(
        warnings(&result),
        vec![
            "CREATE VILLAGE will be refused: Oldtown [village] at (11,11) is within 2 hexes, and a \
             village must be at least 3 hexes from any other settlement"
                .to_string()
        ]
    );
}
