//! `ah-e97l`. Every `CREATE VILLAGE` the preview judges will not found says so in Problems.
//!
//! `newage trident rules/create_village`: *"The unit must have at least 1000 people (men or
//! leaders) and 100 wagons"* and *"Requirements: the region must have no existing settlement, must
//! not be ocean, lake, volcano, or barren terrain, and must be at least 3 hexes away from any other
//! settlement."* Only the distance refusals carried a finding (`village-near-a-settlement`,
//! `ah-m24v`, `ah-flx2`); a founding refused for the region itself or for the unit's own people
//! and wagons kept its founders in ITEMS and said nothing, which is what the navigator met with
//! Unit (751) in Nazgar city.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::OrderValidationResult;

mod common;

const CODE: &str = "create-village-refused";
const NEAR: &str = "village-near-a-settlement";

/// Settlers (900) in `region`, holding `holdings`.
fn report(region: &str, holdings: &str) -> String {
    [
        "Foo (1) Report".to_string(),
        String::new(),
        region.to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        format!(
            "* Settlers (900), Foo (1), {holdings}, 20000 silver [SILV]. Weight: 10000. Capacity: \
             0/0/15000/0."
        ),
        String::new(),
    ]
    .join("\n")
}

const PLAIN: &str = "plain (1,1) in Nowhere, 10 peasants (orcs), $5.";
const ENOUGH: &str = "1005 orcs [ORC], 102 wagons [WAGO]";

fn script(text: &str, more: &str) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let template = common::without_standing_month_orders(&template, &["900"]);
    format!("{template}\nunit 900\nCREATE VILLAGE \"New Hope\"\n{more}")
}

fn validate(text: &str) -> OrderValidationResult {
    validate_with(text, "")
}

/// The orders validated, with `more` written for Settlers after its CREATE.
fn validate_with(text: &str, more: &str) -> OrderValidationResult {
    validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: script(text, more),
            ruleset_json: Some(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON.to_string()),
            raw_report: Some(text.to_string()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    )
}

/// The messages under `code`, each with the line it sits on.
fn findings(result: &OrderValidationResult, code: &str) -> Vec<String> {
    result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == code)
        .map(|diagnostic| diagnostic.message.clone())
        .collect()
}

/// Every refusal sits on the script's CREATE VILLAGE line, so it is shown on the order rather
/// than on the unit.
fn on_the_create_line(text: &str, result: &OrderValidationResult) {
    let create = script(text, "")
        .lines()
        .position(|line| line.starts_with("CREATE VILLAGE"))
        .expect("the script writes the CREATE")
        + 1; // diagnostics count lines from 1
    let refusals: Vec<_> = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == CODE)
        .collect();
    assert!(!refusals.is_empty());
    for diagnostic in refusals {
        assert_eq!(
            diagnostic.line_start,
            Some(create),
            "the refusal sits on the CREATE VILLAGE order: {diagnostic:?}"
        );
    }
}

#[test]
fn a_region_with_a_settlement_refuses_the_founding() {
    let text = report(
        "plain (1,1) in Nowhere, contains Bigtown [city], 10 peasants (orcs), $5.",
        ENOUGH,
    );
    let result = validate(&text);
    assert_eq!(
        findings(&result, CODE),
        vec![
            "CREATE VILLAGE will be refused: this region already has a settlement, Bigtown [city]"
                .to_string()
        ]
    );
    on_the_create_line(&text, &result);
    assert_eq!(findings(&result, NEAR), Vec::<String>::new());
}

#[test]
fn refused_terrain_refuses_the_founding() {
    for terrain in ["ocean", "lake", "volcano", "barren"] {
        let text = report(
            &format!("{terrain} (1,1) in Nowhere, 10 peasants (orcs), $5."),
            ENOUGH,
        );
        let result = validate(&text);
        assert_eq!(
            findings(&result, CODE),
            vec![format!(
                "CREATE VILLAGE will be refused: no village can be founded in {terrain} terrain"
            )],
            "{terrain}"
        );
        on_the_create_line(&text, &result);
        assert_eq!(findings(&result, NEAR), Vec::<String>::new());
    }
}

#[test]
fn a_unit_short_of_people_is_refused() {
    let text = report(PLAIN, "999 orcs [ORC], 100 wagons [WAGO]");
    let result = validate(&text);
    assert_eq!(
        findings(&result, CODE),
        vec![
            "CREATE VILLAGE will be refused: Settlers (900) will have 999 people and 100 wagons, \
             and founding a village takes 1000 people and 100 wagons"
                .to_string()
        ]
    );
    on_the_create_line(&text, &result);
    assert_eq!(
        findings(&result, NEAR),
        Vec::<String>::new(),
        "a founding certainly refused is not also only possibly refused"
    );
}

#[test]
fn a_unit_short_of_wagons_is_refused() {
    let text = report(PLAIN, "1300 orcs [ORC], 99 wagons [WAGO]");
    let result = validate(&text);
    assert_eq!(
        findings(&result, CODE),
        vec![
            "CREATE VILLAGE will be refused: Settlers (900) will have 1300 people and 99 wagons, \
             and founding a village takes 1000 people and 100 wagons"
                .to_string()
        ]
    );
    on_the_create_line(&text, &result);
    assert_eq!(findings(&result, NEAR), Vec::<String>::new());
}

#[test]
fn a_founding_with_everything_it_needs_is_not_refused() {
    let text = report(PLAIN, ENOUGH);
    let result = validate(&text);
    assert_eq!(findings(&result, CODE), Vec::<String>::new());
    // The neighbourhood is unknown, so the distance warning still stands.
    assert_eq!(findings(&result, NEAR).len(), 1);
}

/// The founders are counted as they stand when CREATE runs, after the month's GIVEs
/// (`newage trident rules/sequenceofevents`), so a unit that gives men away is judged on the rest.
#[test]
fn a_unit_that_gives_founders_away_is_judged_on_what_it_keeps() {
    let text = report(PLAIN, ENOUGH);
    let result = validate_with(&text, "GIVE 0 10 ORC\n");
    assert_eq!(
        findings(&result, CODE),
        vec![
            "CREATE VILLAGE will be refused: Settlers (900) will have 995 people and 102 wagons, \
             and founding a village takes 1000 people and 100 wagons"
                .to_string()
        ]
    );
    on_the_create_line(&text, &result);
}

/// Wagons given to another faction's unit may or may not leave (`rules/give`: a target outside
/// our faction needs a Friendly declaration no report carries), so how many wagons stay is not
/// known: the founding is admitted rather than called short. Not a number the report never prints:
/// that receives nothing at all (`ah-xaem`), which would leave this test passing on a founding
/// that has every wagon it needs.
#[test]
fn a_founder_left_uncertain_by_a_give_is_not_called_short() {
    let text = report(PLAIN, ENOUGH).replace(
        "* Settlers (900), ",
        "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n* Settlers (900), ",
    );
    let result = validate_with(&text, "GIVE 7001 10 WAGO\n");
    assert_eq!(findings(&result, CODE), Vec::<String>::new());
}
