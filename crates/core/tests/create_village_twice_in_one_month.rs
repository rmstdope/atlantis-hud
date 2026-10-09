//! `ah-flx2`. Of two `CREATE VILLAGE`s this month within two hexes of each other, only the one the
//! engine runs first founds its village.
//!
//! `newage trident rules/create_village`: *"Requirements: the region must have no existing
//! settlement, ... and must be at least 3 hexes away from any other settlement."* The rule is read
//! as the order runs, so the village the first founding makes refuses every later one within two
//! hexes, in its own region too.
//!
//! Which runs first is the engine's (`atlantis-newage` `monthorders.cpp`): `RunMonthOrders` walks
//! `regions` in list order, and `RunProduceOrders` runs `Run1CreateOrder` for each unit of each
//! object of the region in turn - so within a region, the month-long walk's order. The region list
//! is made row by row, `y` outer and `x` inner (`neworigins/map.cpp` `MakeRegions`), and is written
//! and read back in that order, so of two regions on one level the one with the lower `y`, then
//! the lower `x`, runs first.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::OrderValidationResult;

mod common;

const CREATE: &str = "CREATE VILLAGE \"New Hope\"";
const CODE: &str = "village-near-a-settlement";

/// The six directions and the step each takes, `x + y` keeping its parity.
const DIRECTIONS: [(&str, i32, i32); 6] = [
    ("North", 0, -2),
    ("Northeast", 1, -1),
    ("Southeast", 1, 1),
    ("South", 0, 2),
    ("Southwest", -1, 1),
    ("Northwest", -1, -1),
];

/// A settler with `orcs` orcs and 102 wagons.
fn settler(id: u32, orcs: i64) -> String {
    format!(
        "* Settlers ({id}), Foo (1), {orcs} orcs [ORC], 102 wagons [WAGO], 20000 silver [SILV]. \
         Weight: 10000. Capacity: 0/0/15000/0."
    )
}

/// A report describing every plain hex of x and y in 4..=18, none settled, so every founding's
/// neighbourhood is known to be empty, with `settlers` standing at the hexes named. Each settler
/// holds 1005 orcs and 102 wagons: enough to found, five orcs and two wagons over.
fn report(settlers: &[(i32, i32, u32)]) -> String {
    let settlers: Vec<(i32, i32, u32, i64)> = settlers
        .iter()
        .map(|&(x, y, id)| (x, y, id, 1005))
        .collect();
    report_with_orcs(&settlers)
}

/// [`report`], with each settler's orcs given.
fn report_with_orcs(settlers: &[(i32, i32, u32, i64)]) -> String {
    let mut lines = vec!["Foo (1) Report".to_string(), String::new()];
    for y in 4..=18 {
        for x in 4..=18 {
            if (x + y) % 2 != 0 {
                continue;
            }
            lines.push(format!(
                "plain ({x},{y}) in Nowhere, 10 peasants (orcs), $5."
            ));
            lines.push(String::new());
            lines.push("Exits:".to_string());
            for (direction, dx, dy) in DIRECTIONS {
                lines.push(format!(
                    "  {direction} : plain ({},{}) in Nowhere.",
                    x + dx,
                    y + dy
                ));
            }
            lines.push(String::new());
            for &(_, _, id, orcs) in settlers
                .iter()
                .filter(|&&(sx, sy, _, _)| (sx, sy) == (x, y))
            {
                lines.push(settler(id, orcs));
                lines.push(String::new());
            }
        }
    }
    lines.join("\n")
}

fn script(text: &str, founders: &[u32]) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let ids: Vec<String> = founders.iter().map(ToString::to_string).collect();
    let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
    let mut script = common::without_standing_month_orders(&template, &ids);
    for id in founders {
        script.push_str(&format!("\nunit {id}\n{CREATE}\n"));
    }
    script
}

/// What each founder holds of `tag` (`ORC` or `WAGO`) once its orders have run, upkeep aside.
fn held(text: &str, founders: &[u32], tag: &str) -> Vec<i64> {
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        text,
        "[]",
        &script(text, founders),
    )
    .expect("the Trident ruleset loads");
    founders
        .iter()
        .map(|id| {
            // A founder whose orders change nothing has no row: it holds what the report shows.
            common::preview_row(text, &preview, &id.to_string())
                .map_or(if tag == "WAGO" { 102 } else { 1005 }, |unit| {
                    common::held_before_upkeep(unit, tag)
                })
        })
        .collect()
}

fn validate(text: &str, founders: &[u32]) -> OrderValidationResult {
    validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: script(text, founders),
            ruleset_json: Some(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON.to_string()),
            raw_report: Some(text.to_string()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    )
}

/// Each warning of the code, with the unit it is on.
fn warnings(result: &OrderValidationResult) -> Vec<(String, String)> {
    result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == CODE)
        .map(|diagnostic| {
            (
                diagnostic.unit_id.clone().unwrap_or_default(),
                diagnostic.message.clone(),
            )
        })
        .collect()
}

fn refused_by(founder: &str, at: (i32, i32)) -> String {
    format!(
        "CREATE VILLAGE will be refused: {founder} founds a village at ({},{}) first this month, \
         within 2 hexes, and a village must be at least 3 hexes from any other settlement",
        at.0, at.1
    )
}

#[test]
fn of_two_founders_in_one_region_only_the_first_listed_founds() {
    let text = report(&[(10, 10, 900), (10, 10, 901)]);

    assert_eq!(held(&text, &[900, 901], "ORC"), vec![5, 1005]);
    assert_eq!(held(&text, &[900, 901], "WAGO"), vec![2, 102]);
    assert_eq!(
        warnings(&validate(&text, &[900, 901])),
        vec![("901".to_string(), refused_by("Settlers (900)", (10, 10)))]
    );
}

#[test]
fn of_two_founders_a_hex_apart_the_lower_row_founds() {
    // (11,9) is a row above (10,10), so the engine reaches it first although the report lists
    // (10,10)'s founder first.
    let text = report(&[(10, 10, 900), (11, 9, 901)]);

    assert_eq!(held(&text, &[900, 901], "ORC"), vec![1005, 5]);
    assert_eq!(held(&text, &[900, 901], "WAGO"), vec![102, 2]);
    assert_eq!(
        warnings(&validate(&text, &[900, 901])),
        vec![("900".to_string(), refused_by("Settlers (901)", (11, 9)))]
    );
}

#[test]
fn of_two_founders_two_hexes_apart_in_one_row_the_lower_column_founds() {
    let text = report(&[(12, 10, 900), (10, 10, 901)]);

    assert_eq!(held(&text, &[900, 901], "ORC"), vec![1005, 5]);
    assert_eq!(
        warnings(&validate(&text, &[900, 901])),
        vec![("900".to_string(), refused_by("Settlers (901)", (10, 10)))]
    );
}

#[test]
fn founders_three_hexes_apart_both_found() {
    let text = report(&[(10, 10, 900), (10, 16, 901)]);

    assert_eq!(held(&text, &[900, 901], "ORC"), vec![5, 5]);
    assert_eq!(warnings(&validate(&text, &[900, 901])), vec![]);
}

#[test]
fn a_refused_founding_refuses_nobody_else() {
    // (10,8) founds first; (10,10) is refused by it; (10,14) is three hexes from (10,8) and only
    // two from the refused (10,10), so it founds.
    let text = report(&[(10, 8, 900), (10, 10, 901), (10, 14, 902)]);

    assert_eq!(held(&text, &[900, 901, 902], "ORC"), vec![5, 1005, 5]);
    assert_eq!(
        warnings(&validate(&text, &[900, 901, 902])),
        vec![("901".to_string(), refused_by("Settlers (900)", (10, 8)))]
    );
}

#[test]
fn a_founding_that_may_not_happen_leaves_the_later_one_admitted() {
    // Men given to a unit no report shows may or may not leave (`rules/give`, `ah-66yi`), so
    // (10,8)'s founding is admitted rather than counted, and whether (10,10)'s is refused cannot be
    // said either.
    let text = report(&[(10, 8, 900), (10, 10, 901)]);
    let orders = script(&text, &[900, 901]).replace(
        &format!("unit 900\n{CREATE}\n"),
        &format!("unit 900\n{CREATE}\nGIVE 9999 10 ORC\n"),
    );
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        &orders,
    )
    .expect("the Trident ruleset loads");
    let later = common::preview_row(&text, &preview, "901").expect("the line is admitted");
    assert_eq!(
        common::held_before_upkeep(later, "ORC"),
        1005,
        "nothing is counted as consumed"
    );
    assert_eq!(later.uncounted, vec![CREATE.to_string()]);

    let result = validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: orders,
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
        vec![(
            "901".to_string(),
            "CREATE VILLAGE may be refused: Settlers (900) may found a village at (10,8) first \
             this month, within 2 hexes, and a village must be at least 3 hexes from any other \
             settlement"
                .to_string()
        )]
    );
}

/// Review finding 1 on PR #1489: a founder short of people founds nothing, so it casts no doubt on
/// a later founding, even when an earlier founding may refuse it.
#[test]
fn a_founder_short_of_people_refuses_nobody() {
    // (10,8) may found (men given to a unit no report shows); (10,10) has 500 orcs and never
    // founds (`newage trident rules/create_village`: "at least 1000 people"); (10,14) is three
    // hexes from (10,8) and two from (10,10), so it founds.
    let text = report_with_orcs(&[(10, 8, 900, 1005), (10, 10, 901, 500), (10, 14, 902, 1005)]);
    let orders = script(&text, &[900, 901, 902]).replace(
        &format!("unit 900\n{CREATE}\n"),
        &format!("unit 900\n{CREATE}\nGIVE 9999 10 ORC\n"),
    );
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        &orders,
    )
    .expect("the Trident ruleset loads");
    let last = common::preview_row(&text, &preview, "902").expect("902 founds");
    assert_eq!(common::held_before_upkeep(last, "ORC"), 5);
    assert_eq!(last.uncounted, Vec::<String>::new());
}

/// Review finding 2 on PR #1489: an earlier founding whose own neighbourhood the known map does
/// not show may itself be refused, so the later one is only "may be refused", and admitted.
#[test]
fn an_earlier_founding_on_an_unsure_site_only_may_refuse() {
    // (5,5)'s ring two hexes out reaches (5,1), which the report does not describe; (6,8) is two
    // hexes from it, and its own neighbourhood is described in full.
    let text = report(&[(5, 5, 900), (6, 8, 901)]);

    assert_eq!(held(&text, &[900, 901], "ORC"), vec![5, 1005]);
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        &script(&text, &[900, 901]),
    )
    .expect("the Trident ruleset loads");
    let later = common::preview_row(&text, &preview, "901").expect("the line is admitted");
    assert_eq!(later.uncounted, vec![CREATE.to_string()]);
    assert_eq!(
        warnings(&validate(&text, &[900, 901])),
        vec![
            (
                "900".to_string(),
                "a settlement within 2 hexes may not be visible on the known map; CREATE VILLAGE \
                 is refused if there is one"
                    .to_string()
            ),
            (
                "901".to_string(),
                "CREATE VILLAGE may be refused: Settlers (900) may found a village at (5,5) first \
                 this month, within 2 hexes, and a village must be at least 3 hexes from any \
                 other settlement"
                    .to_string()
            )
        ]
    );
}
