use crate::common::{at, ruleset, trident_ruleset};
use atlantis_hud_core::movement::graph::MapKnowledge;
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

/// The same corridor, with a Trident unit whose items decide what it can do in the water.
///
/// `items` goes verbatim into the unit's line, and `capacity` is the four-number line the report
/// would have printed for it - the inventory is what actually decides (`swim_ability` prefers it),
/// and the printed numbers are kept in step so the fixture does not contradict itself. A lizardman
/// is weight 10, walking capacity 5, swimming capacity 5 (`newage trident data/lizardman`); a
/// giant turtle weight 50, walking 20, riding 20, swimming 20 (`newage trident data/giant turtle`).
fn swimmer_corridor(terrains: &[&str], items: &str, weight: i64, capacity: &str) -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    for (index, terrain) in terrains.iter().enumerate() {
        let x = 1 + index as i32;
        let y = 1 + index as i32;
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
            text.push_str(&format!(
                "* Swimmer (900), Foo (1), {items}. Weight: {weight}. Capacity: {capacity}.\n\n"
            ));
        }
    }
    parse_report_full(&text)
}

/// [`plan`], for a world other than New Origins.
fn plan_in(
    report: &ParsedReport,
    ruleset: &atlantis_hud_core::movement::rules::Ruleset,
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

/// `newage trident rules/movement_normal`: "Swimming units are restricted to coastal ocean regions
/// and lakes." The strait is coastal at both ends, so the lizardman simply swims it.
#[test]
fn a_lizardman_swims_across_the_coastal_strait() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "lizardman [LIZA]",
        10,
        "0/0/15/15",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("a swimmer swims");

    assert_eq!(route.mode, MovementMode::Walk, "swimming is not a speed");
    assert_eq!(route.steps.len(), 2);
    assert_eq!(route.steps[0].terrain, "ocean");
    assert!(route.steps[0].over_water);
    assert!(!route.steps[1].over_water);
}

#[test]
fn a_lizardman_may_stop_in_the_coastal_water() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "lizardman [LIZA]",
        10,
        "0/0/15/15",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(2, 2))
        .expect("a swimmer may end its month in the water");

    assert_eq!(route.steps.len(), 1);
    assert!(route.steps[0].over_water);
}

/// A leader has a swimming capacity of 0 (`newage trident data/leader`), so nothing changes for it.
#[test]
fn a_leader_is_still_told_it_needs_a_ship() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD]",
        10,
        "0/0/15/0",
    );
    let problem =
        plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect_err("a leader cannot swim");

    assert!(
        matches!(problem, RouteProblem::OceanNeedsShip { ref terrain, .. } if terrain == "ocean"),
        "{problem:?}"
    );
}

/// A leader with a giant turtle and four wood: weight 10 + 50 + 20 = 80, and a swimming capacity of
/// 0 + 70 = 70. It can swim, but not carrying this much, and a ship is not what it needs.
#[test]
fn a_swimmer_carrying_too_much_is_told_the_numbers() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD], giant turtle [TURT], 4 wood [WOOD]",
        80,
        "0/70/85/70",
    );
    let problem = plan_in(&report, &trident_ruleset(), "900", at(3, 3))
        .expect_err("it cannot swim at that weight");

    assert_eq!(
        problem,
        RouteProblem::SwimLoadTooHeavy {
            coordinate: at(2, 2),
            terrain: "ocean".to_string(),
            capacity: 70,
            load: 80,
            destination: false,
        }
    );
}

#[test]
fn the_destination_half_names_the_hex_the_player_clicked() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD], giant turtle [TURT], 4 wood [WOOD]",
        80,
        "0/70/85/70",
    );
    let problem = plan_in(&report, &trident_ruleset(), "900", at(2, 2))
        .expect_err("it cannot swim at that weight");

    assert_eq!(
        problem,
        RouteProblem::SwimLoadTooHeavy {
            coordinate: at(2, 2),
            terrain: "ocean".to_string(),
            capacity: 70,
            load: 80,
            destination: true,
        }
    );
}

/// The rule names lakes as open whatever their depth, and the Trident ruleset's `unrestricted`
/// says so.
#[test]
fn a_lake_is_open_to_a_swimmer_whatever_its_depth() {
    let report = swimmer_corridor(
        &["plain", "lake", "plain"],
        "lizardman [LIZA]",
        10,
        "0/0/15/15",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("a lake is open");

    assert_eq!(route.steps.len(), 2);
    assert!(route.steps[0].over_water);
}

/// New Origins carries no swimming paragraph at all, so its swimmers are refused as before.
#[test]
fn new_origins_still_refuses_every_swimmer() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD]",
        10,
        "0/0/15/15",
    );
    let problem = plan_in(&report, &ruleset(), "900", at(3, 3))
        .expect_err("New Origins has no swimming rule");

    assert!(
        matches!(problem, RouteProblem::OceanNeedsShip { .. }),
        "{problem:?}"
    );
}

/// The sea and the shore: `(2,2)` coastal, `(3,3)` deep - its six neighbours are all water - and
/// `(4,4)` water of a depth nothing can tell, naming only `(3,3)` and `(5,5)` of its six
/// directions. `(5,5)` itself is named but undescribed here; a test that needs it described
/// appends a region of its own to [`sea_and_shore_text`].
fn sea_and_shore(items: &str, weight: i64, capacity: &str) -> ParsedReport {
    parse_report_full(&sea_and_shore_text(items, weight, capacity))
}

/// The same report as text, so a test that needs another region can append one.
fn sea_and_shore_text(items: &str, weight: i64, capacity: &str) -> String {
    format!(
        "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : ocean (2,2) in Atlantis Ocean.\n\n\
         * Swimmer (900), Foo (1), {items}. Weight: {weight}. Capacity: {capacity}.\n\n\
         ocean (2,2) in Atlantis Ocean.\n\n\
         Exits:\n  \
         Northwest : plain (1,1) in Nowhere.\n  \
         North : ocean (2,0) in Atlantis Ocean.\n  \
         Northeast : ocean (3,1) in Atlantis Ocean.\n  \
         Southeast : ocean (3,3) in Atlantis Ocean.\n  \
         South : ocean (2,4) in Atlantis Ocean.\n  \
         Southwest : ocean (1,3) in Atlantis Ocean.\n\n\
         ocean (3,3) in Atlantis Ocean.\n\n\
         Exits:\n  \
         North : ocean (3,1) in Atlantis Ocean.\n  \
         Northeast : ocean (4,2) in Atlantis Ocean.\n  \
         Southeast : ocean (4,4) in Atlantis Ocean.\n  \
         South : ocean (3,5) in Atlantis Ocean.\n  \
         Southwest : ocean (2,4) in Atlantis Ocean.\n  \
         Northwest : ocean (2,2) in Atlantis Ocean.\n\n\
         ocean (4,4) in Atlantis Ocean.\n\n\
         Exits:\n  \
         Northwest : ocean (3,3) in Atlantis Ocean.\n  \
         Southeast : ocean (5,5) in Atlantis Ocean.\n"
    )
}

#[test]
fn deep_water_refuses_a_swimmer_with_no_sea_creatures() {
    let report = sea_and_shore("lizardman [LIZA]", 10, "0/0/15/15");
    let problem = plan_in(&report, &trident_ruleset(), "900", at(3, 3))
        .expect_err("deep water is closed to it");

    assert_eq!(
        problem,
        RouteProblem::DeepWaterNeedsSeaCreatures {
            coordinate: at(3, 3),
            terrain: "ocean".to_string(),
            borne: 0,
            load: 10,
            destination: true,
        }
    );
}

/// Three lizardmen and a turtle weigh 80; the turtle bears 70 of it, which is not the whole.
#[test]
fn sea_creatures_that_fall_short_are_named() {
    let report = sea_and_shore("3 lizardman [LIZA], giant turtle [TURT]", 80, "0/70/85/115");
    let problem = plan_in(&report, &trident_ruleset(), "900", at(3, 3))
        .expect_err("its creatures cannot bear it entire");

    assert_eq!(
        problem,
        RouteProblem::DeepWaterNeedsSeaCreatures {
            coordinate: at(3, 3),
            terrain: "ocean".to_string(),
            borne: 70,
            load: 80,
            destination: true,
        }
    );
}

/// "a unit carried by sea creatures able to bear its whole weight rides out into deep water
/// safely" - exactly its whole weight is enough.
#[test]
fn sea_creatures_bearing_exactly_the_whole_weight_ride_out() {
    let report = sea_and_shore("2 lizardman [LIZA], giant turtle [TURT]", 70, "0/70/80/100");
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("it rides out");

    assert_eq!(route.steps.len(), 2);
    assert!(route.steps[1].over_water);
}

#[test]
fn sea_creatures_bearing_more_than_enough_ride_out() {
    let report = sea_and_shore("lizardman [LIZA], giant turtle [TURT]", 60, "0/70/75/85");
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("it rides out");

    assert_eq!(route.steps.len(), 2);
}

/// Deep water *in the way* rather than clicked on: the destination is the unknown-depth hex beyond
/// it, so the refusal arrives through the mid-route probe and carries `destination: false`. The
/// deep hex is named, not the one the player asked for, because the deep hex is what stops it.
#[test]
fn deep_water_in_the_way_is_named_rather_than_the_hex_beyond_it() {
    // (5,5) is coastal - its own exits name the plain at (6,6) - so the destination guard passes
    // it, and the deep hex at (3,3) is met in the middle of the search instead.
    let report = parse_report_full(&format!(
        "{}\n\
         ocean (5,5) in Atlantis Ocean.\n\n\
         Exits:\n  \
         Northwest : ocean (4,4) in Atlantis Ocean.\n  \
         Southeast : plain (6,6) in Nowhere.\n",
        sea_and_shore_text("lizardman [LIZA]", 10, "0/0/15/15")
    ));
    let problem = plan_in(&report, &trident_ruleset(), "900", at(5, 5))
        .expect_err("the deep hex is in the way");

    assert_eq!(
        problem,
        RouteProblem::DeepWaterNeedsSeaCreatures {
            coordinate: at(3, 3),
            terrain: "ocean".to_string(),
            borne: 0,
            load: 10,
            destination: false,
        }
    );
}

/// `(4,4)` states two of its six directions, so four are unaccounted for and nothing can say
/// whether it is deep. Refused rather than guessed at.
#[test]
fn water_of_unknown_depth_is_refused_rather_than_guessed() {
    let report = sea_and_shore("lizardman [LIZA]", 10, "0/0/15/15");
    let problem = plan_in(&report, &trident_ruleset(), "900", at(4, 4))
        .expect_err("nothing can say how deep it is");

    assert_eq!(
        problem,
        RouteProblem::WaterDepthUnknown {
            coordinate: at(4, 4),
            terrain: "ocean".to_string(),
        }
    );
}
