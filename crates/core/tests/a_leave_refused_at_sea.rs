//! `ah-djst`. A LEAVE the game refuses at sea moves nobody, so every surface keeps the unit aboard.
//!
//! `rules/leave`: *"If a unit is capable of swimming or flying then this order is usable to leave a
//! boat while at sea."* The engine's `Do1EnterOrder` refuses it in an ocean region when the unit
//! cannot swim (`Unit::CanSwim` also admits a unit that can fly) **or** won't cross water
//! (`rules/nocross`), reports "LEAVE: Can't leave a ship in the ocean." and returns before
//! `MoveUnit`. `rules/sequenceofevents` runs NOCROSS before LEAVE, so a NOCROSS written in the same
//! month is the flag the LEAVE meets.
//!
//! The preview (`orders::effects`) and the checks (`orders::semantics`) both ask the shared standing
//! rule where a unit stands, and before this bead that rule walked the leaver ashore.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, OrdersPreviewResponse, UnitPreview,
};
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::OrderValidationResult;

const UNDERCREWED: &str = "fleet-undercrewed";

/// A Longship [329] in `terrain` (1,1), crewed by Sea Rovers (900, the owner) and Deckhands (901),
/// two sailing-2 centaurs who can neither swim nor fly, with Marines (902) aboard. `extra` adds
/// lines under the hull.
fn report(terrain: &str, extra: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        format!("{terrain} (1,1) in Sea."),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : ocean (2,2) in Sea.".to_string(),
        String::new(),
        "+ Longship [329] : Longship; Load: 150/150; Sailors: 4/4; MaxSpeed: 4.".to_string(),
        "  * Sea Rovers (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90)."
            .to_string(),
        "  * Deckhands (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. Capacity: 0/70/70/0. \
         Skills: sailing [SAIL] 2 (90)."
            .to_string(),
        "  * Marines (902), Foo (1), sharing, centaur [CTAU]. Weight: 50. Capacity: 0/70/70/0."
            .to_string(),
    ];
    lines.extend(extra.iter().map(|line| (*line).to_string()));
    lines.extend([
        String::new(),
        "ocean (2,2) in Sea.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Northwest : ocean (1,1) in Sea.".to_string(),
        String::new(),
    ]);
    lines.join("\n")
}

fn at_sea() -> String {
    report("ocean", &[])
}

fn validate(report: &str, orders: &str) -> OrderValidationResult {
    validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: orders.to_string(),
            ruleset_json: Some(atlantis_hud_fixtures::RULESET_JSON.to_string()),
            raw_report: Some(report.to_string()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    )
}

fn preview(report: &str, orders: &str) -> OrdersPreviewResponse {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        report,
        "[]",
        orders,
    )
    .expect("the ruleset loads")
}

/// The preview's rows for `unit`, wherever it ends up.
fn rows<'r>(response: &'r OrdersPreviewResponse, unit: &str) -> Vec<&'r UnitPreview> {
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|row| row.unit.unit_id == unit)
        .collect()
}

fn undercrewed(result: &OrderValidationResult) -> usize {
    result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == UNDERCREWED)
        .count()
}

/// The bead's own case: the owner writes SAIL SE and LEAVE in an ocean hex. The game refuses the
/// LEAVE, so the owner stays aboard and sails the whole hull SE with everybody on it.
const OWNER_LEAVES_AT_SEA: &str =
    "#atlantis 1\nunit 900\nSAIL SE\nLEAVE\nunit 901\nSAIL SE\n#end\n";

#[test]
fn the_preview_keeps_an_owner_whose_leave_is_refused_aboard() {
    let response = preview(&at_sea(), OWNER_LEAVES_AT_SEA);

    for unit in ["900", "901", "902"] {
        let found = rows(&response, unit);
        assert!(!found.is_empty(), "{unit} has a row: {response:#?}");
        for row in found {
            assert_eq!(
                row.unit.structure_id.as_deref(),
                Some("329"),
                "{unit} is still aboard the Longship: {row:#?}"
            );
        }
    }
}

#[test]
fn the_checks_count_an_owner_whose_leave_is_refused_among_the_crew() {
    let result = validate(&at_sea(), OWNER_LEAVES_AT_SEA);

    assert_eq!(undercrewed(&result), 0, "{:#?}", result.diagnostics);
}

/// On a coast nothing refuses the LEAVE, so the same orders do put the owner ashore - which is what
/// makes the two tests above about the sea and not about LEAVE.
#[test]
fn on_a_coast_the_same_leave_runs() {
    let coast = report("plain", &[]);

    let response = preview(&coast, OWNER_LEAVES_AT_SEA);
    let owner = rows(&response, "900");
    assert!(!owner.is_empty(), "{response:#?}");
    assert!(
        owner.iter().all(|row| row.unit.structure_id.is_none()),
        "900 went ashore: {owner:#?}"
    );
    assert_eq!(undercrewed(&validate(&coast, OWNER_LEAVES_AT_SEA)), 1);
}

/// A unit that can swim its own weight, and does not refuse to cross water, may leave at sea.
#[test]
fn a_swimmer_leaves_at_sea() {
    let swimmer = "  * Swimmer (903), Foo (1), sharing, merfolk [MERF]. Weight: 10. \
                   Capacity: 0/0/15/15.";
    let response = preview(
        &report("ocean", &[swimmer]),
        "#atlantis 1\nunit 903\nLEAVE\n#end\n",
    );

    let found = rows(&response, "903");
    assert!(!found.is_empty(), "{response:#?}");
    assert!(
        found.iter().all(|row| row.unit.structure_id.is_none()),
        "903 swam off: {found:#?}"
    );
}

/// The same swimmer refuses to cross water when it says so, on the report or in this month's
/// NOCROSS - which runs before LEAVE whatever line it is written on.
#[test]
fn a_swimmer_that_wont_cross_water_stays_aboard() {
    let swimmer = "  * Swimmer (903), Foo (1), sharing, merfolk [MERF]. Weight: 10. \
                   Capacity: 0/0/15/15.";
    let flagged = "  * Swimmer (903), Foo (1), sharing, won't cross water, merfolk [MERF]. \
                   Weight: 10. Capacity: 0/0/15/15.";

    for (scene, orders) in [
        (
            report("ocean", &[flagged]),
            "#atlantis 1\nunit 903\nLEAVE\nNAME UNIT Stays\n#end\n",
        ),
        (
            report("ocean", &[swimmer]),
            "#atlantis 1\nunit 903\nLEAVE\nNOCROSS 1\n#end\n",
        ),
    ] {
        let response = preview(&scene, orders);
        let found = rows(&response, "903");
        assert!(!found.is_empty(), "{orders}: {response:#?}");
        assert!(
            found
                .iter()
                .all(|row| row.unit.structure_id.as_deref() == Some("329")),
            "{orders}: 903 stayed aboard: {found:#?}"
        );
    }
}

// `ah-z6zt`. The refused LEAVE is warned on its own line, so the player learns it from the order
// rather than from the turn report.

const REFUSED: &str = "leave-refused-at-sea";

/// `(message, 1-based line)` of each finding under [`REFUSED`].
fn refusals(result: &OrderValidationResult) -> Vec<(String, Option<usize>)> {
    result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == REFUSED)
        .map(|diagnostic| (diagnostic.message.clone(), diagnostic.line_start))
        .collect()
}

/// The verification's case: a centaur that can neither swim nor fly writes SAIL SE and LEAVE.
#[test]
fn a_leave_by_a_unit_that_cannot_swim_or_fly_is_warned_on_its_line() {
    let result = validate(&at_sea(), OWNER_LEAVES_AT_SEA);

    let found = refusals(&result);
    assert_eq!(found.len(), 1, "{:#?}", result.diagnostics);
    let (message, line) = &found[0];
    assert_eq!(*line, Some(4), "on the LEAVE line");
    assert!(
        message.contains("cannot swim or fly"),
        "names why: {message}"
    );
}

#[test]
fn a_leave_by_a_unit_that_wont_cross_water_is_warned_naming_that() {
    let swimmer = "  * Swimmer (903), Foo (1), sharing, merfolk [MERF]. Weight: 10. \
                   Capacity: 0/0/15/15.";
    let result = validate(
        &report("ocean", &[swimmer]),
        "#atlantis 1\nunit 903\nNOCROSS 1\nLEAVE\n#end\n",
    );

    let found = refusals(&result);
    assert_eq!(found.len(), 1, "{:#?}", result.diagnostics);
    let (message, line) = &found[0];
    assert_eq!(*line, Some(4), "on the LEAVE line");
    assert!(
        message.contains("won't cross water"),
        "names why: {message}"
    );
}

#[test]
fn a_leave_on_a_coast_is_not_warned() {
    let result = validate(&report("plain", &[]), OWNER_LEAVES_AT_SEA);

    assert!(refusals(&result).is_empty(), "{:#?}", result.diagnostics);
}

#[test]
fn a_leave_by_a_swimmer_at_sea_is_not_warned() {
    let swimmer = "  * Swimmer (903), Foo (1), sharing, merfolk [MERF]. Weight: 10. \
                   Capacity: 0/0/15/15.";
    let result = validate(
        &report("ocean", &[swimmer]),
        "#atlantis 1\nunit 903\nLEAVE\n#end\n",
    );

    assert!(refusals(&result).is_empty(), "{:#?}", result.diagnostics);
}

/// An ENTER anywhere in the block replaces the LEAVE: the engine's `ProcessLeaveOrder` sets the
/// leave only when no ENTER is pending and `ProcessEnterOrder` always overwrites it, so
/// `Do1EnterOrder` never reaches "Can't leave a ship in the ocean." - nothing is refused to warn of.
#[test]
fn a_leave_beside_an_enter_at_sea_is_not_warned() {
    let other = "+ Cog [330] : Longship; Load: 0/150; Sailors: 0/4; MaxSpeed: 4.";
    for orders in [
        "#atlantis 1\nunit 902\nLEAVE\nENTER 330\n#end\n",
        "#atlantis 1\nunit 902\nENTER 330\nLEAVE\n#end\n",
    ] {
        let result = validate(&report("ocean", &[other]), orders);
        assert!(
            refusals(&result).is_empty(),
            "{orders}: {:#?}",
            result.diagnostics
        );
    }
}

/// `rules/leave`: swimming **or flying** lets a unit leave a boat at sea.
#[test]
fn a_leave_by_a_flyer_at_sea_is_not_warned() {
    let flyer = "  * Flyer (903), Foo (1), sharing, eagle [EAGL]. Weight: 10. Capacity: 15/0/15/0.";
    let result = validate(
        &report("ocean", &[flyer]),
        "#atlantis 1\nunit 903\nLEAVE\n#end\n",
    );

    assert!(refusals(&result).is_empty(), "{:#?}", result.diagnostics);
}

/// With no Capacity on the report the HUD keeps the unit aboard, but does not know it cannot swim
/// or fly, so the warning says only what the report shows.
#[test]
fn a_leave_by_a_unit_with_no_stated_movement_says_nothing_shows_it_can_swim_or_fly() {
    let unknown = "  * Unknown (903), Foo (1), sharing, centaur [CTAU].";
    let result = validate(
        &report("ocean", &[unknown]),
        "#atlantis 1\nunit 903\nLEAVE\n#end\n",
    );

    let found = refusals(&result);
    assert_eq!(found.len(), 1, "{:#?}", result.diagnostics);
    assert!(
        found[0]
            .0
            .contains("nothing on the report shows the unit can swim or fly"),
        "{}",
        found[0].0
    );
}
