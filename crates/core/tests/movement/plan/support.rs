use crate::common::{at, ruleset};
use atlantis_hud_core::movement::graph::{Direction, MapKnowledge, RememberedRegion};
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const F42_T40: &str = atlantis_hud_fixtures::G3_F42_T40.text;

pub(super) fn turn_71() -> ParsedReport {
    parse_report_full(TURN_71)
}

/// Plans for one of the faction's own units, by id.
pub(super) fn plan(
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    plan_against(&ruleset(), report, unit_id, destination)
}

/// Plans as `plan` does, against a world's own ruleset rather than the shipped one.
pub(super) fn plan_against(
    ruleset: &Ruleset,
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let map = MapKnowledge::from_report(report);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(&map, ruleset, unit, destination)
}

/// A chain of hexes, each naming the next, so a route can be longer than one step.
///
/// `terrains` runs west to east along a row; the unit starts in the first.
pub(super) fn corridor(terrains: &[&str]) -> ParsedReport {
    corridor_with(terrains, "0/0/15/0")
}

/// The same corridor, with the unit's capacity chosen so its mode of travel can be varied.
pub(super) fn corridor_with(terrains: &[&str], capacity: &str) -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    for (index, terrain) in terrains.iter().enumerate() {
        let x = 1 + index as i32;
        let y = 1 + index as i32; // each step is southeast: (+1,+1)
        text.push_str(&format!(
            "{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\n"
        ));
        text.push_str("Exits:\n");
        if index > 0 {
            let previous = terrains[index - 1];
            text.push_str(&format!(
                "  Northwest : {previous} ({},{}) in Nowhere.\n",
                x - 1,
                y - 1
            ));
        }
        if index + 1 < terrains.len() {
            let next = terrains[index + 1];
            text.push_str(&format!(
                "  Southeast : {next} ({},{}) in Nowhere.\n",
                x + 1,
                y + 1
            ));
        }
        text.push('\n');
        if index == 0 {
            // "Weight: 10. Capacity: 0/0/15/0." is the fixture's own leader-sized walker; the
            // caller varies the capacity to change how the unit travels.
            text.push_str(&format!(
                "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: {capacity}.\n\n"
            ));
        }
    }
    parse_report_full(&text)
}

/// Game 3, faction 42 ("The Disinherited Knights"): three consecutive real turns, committed by
/// ah-dyi. t42 is current; t40 and t41 are remembered.
pub(super) fn f42_t40() -> ParsedReport {
    parse_report_full(F42_T40)
}

/// Turns t40 and t41 into the remembered regions `from_remembered` expects, built straight from
/// `report.regions` - the same shortcut `movement/request.rs` already takes for a test.
pub(super) fn remembered(reports: &[(&ParsedReport, u32)]) -> Vec<RememberedRegion> {
    reports
        .iter()
        .flat_map(|(report, turn)| {
            report.regions.iter().map(move |region| RememberedRegion {
                region: region.clone(),
                last_seen_turn: *turn,
            })
        })
        .collect()
}

/// A Longship crewed by two Sailors of SAIL 2 - exactly the four levels the hull needs.
pub(super) fn longship() -> String {
    let mut text =
        String::from("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n\n",
    );
    text
}

pub(super) fn trident() -> atlantis_hud_core::movement::rules::Ruleset {
    atlantis_hud_core::movement::rules::Ruleset::from_json(
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
    )
    .expect("the committed Trident ruleset parses and validates")
}

/// Plans with a ruleset of the caller's choosing, which `plan` above does not - it is hardwired to
/// New Origins, where a lake is genuinely dry land.
pub(super) fn plan_ruleset(
    ruleset: &atlantis_hud_core::movement::rules::Ruleset,
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let map = MapKnowledge::from_report(report);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(&map, ruleset, unit, destination)
}

/// The mockup's corridor: `ocean (1,1)` —SE→ `plain (2,2)` —`leaving`→ an ocean hex beyond, which
/// touches nothing else. Every hex states the exits that name its neighbours, since a stated exit
/// is the only adjacency the search reads between two described hexes - so the corridor is the
/// whole map and there is no way round.
///
/// `structure` is dropped into the plain's own block: `""` for a bare neck, `"+ The Cut [3] :
/// Canal.\n"` for one with a canal standing in it.
pub(super) fn neck(leaving: Direction, structure: &str) -> ParsedReport {
    parse_report_full(&neck_text(leaving, structure))
}

/// [`neck`]'s report as text, so a test can rewrite the fleet's speed before parsing it.
pub(super) fn neck_text(leaving: Direction, structure: &str) -> String {
    let (dx, dy) = leaving.offset();
    let far = at(2 + dx, 2 + dy);
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(&longship());
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(&format!(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  {} : ocean ({},{}) in Sea.\n\n",
        leaving.label(),
        far.x,
        far.y
    ));
    text.push_str(structure);
    if !structure.is_empty() {
        text.push('\n');
    }
    text.push_str(&format!("ocean ({},{}) in Sea.\n\n", far.x, far.y));
    text.push_str(&format!(
        "Exits:\n  {} : plain (2,2) in Coast.\n",
        leaving.opposite().label()
    ));
    text
}

/// Where the corridor above puts the ocean beyond the neck, for a given leaving side.
pub(super) fn beyond(leaving: Direction) -> Coordinate {
    let (dx, dy) = leaving.offset();
    at(2 + dx, 2 + dy)
}
