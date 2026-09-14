use atlantis_hud_core::movement::mode::{mobility, unit_movement, Mobility};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::model::{ReportUnit, UnitMovementMode, UnitMovementStatus};
use atlantis_hud_core::report::parse_report_full;

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

/// The report states each unit's four capacities as the server computed them, so how a unit travels
/// is read rather than derived. The order is fly/ride/walk/swim, confirmed against three units.
#[test]
fn a_unit_takes_the_fastest_mode_its_weight_allows() {
    let report = parse_report_full(TURN_71);
    let unit_by = |id: &str| {
        report
            .units()
            .find(|unit| unit.unit_id == id)
            .expect("the report should carry that unit")
            .clone()
    };

    // "Six of Seven (881) ... Weight: 773. Capacity: 901/901/916/0."
    assert_eq!(
        mobility(&unit_by("881")),
        Mobility::Moves(MovementMode::Fly),
        "flight is available and fastest"
    );

    // "Drone (13432) ... hill dwarf, horse. Weight: 60. Capacity: 0/70/85/0."
    assert_eq!(
        mobility(&unit_by("13432")),
        Mobility::Moves(MovementMode::Ride),
        "the horse can carry the unit"
    );

    // "Drones (14451) ... 50 lizardmen, 7500 silver. Weight: 500. Capacity: 0/0/750/750."
    assert_eq!(
        mobility(&unit_by("14451")),
        Mobility::Moves(MovementMode::Walk)
    );
}

/// The fixture's own example of a unit that cannot move at all: its weight exceeds every one of its
/// capacities, so the game will not let it issue a MOVE order.
#[test]
fn a_unit_heavier_than_all_its_capacities_cannot_move() {
    let report = parse_report_full(TURN_71);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == "13972")
        .expect("the report should carry that unit");

    // "Thirteen of Eight (13972) ... Weight: 17. Capacity: 0/0/15/0."
    assert_eq!(mobility(unit), Mobility::Overloaded);
}

#[test]
fn report_units_expose_the_complete_movement_presentation() {
    let report = parse_report_full(TURN_71);
    let movement = |id: &str| {
        report
            .units()
            .find(|unit| unit.unit_id == id)
            .and_then(unit_movement)
            .expect("the report states movement")
    };

    let overloaded = movement("13972");
    assert_eq!(overloaded.status, UnitMovementStatus::Overloaded);
    assert_eq!(overloaded.capacity_mode, UnitMovementMode::Walk);
    assert_eq!((overloaded.load, overloaded.walk), (17, 15));

    let walking = movement("14451");
    assert_eq!(walking.status, UnitMovementStatus::Walk);
    assert_eq!(walking.capacity_mode, UnitMovementMode::Walk);
    assert_eq!((walking.load, walking.walk), (500, 750));

    let riding = movement("13432");
    assert_eq!(riding.status, UnitMovementStatus::Ride);
    assert_eq!(riding.capacity_mode, UnitMovementMode::Ride);
    assert_eq!((riding.load, riding.ride, riding.walk), (60, 70, 85));

    let flying = movement("881");
    assert_eq!(flying.status, UnitMovementStatus::Fly);
    assert_eq!(flying.capacity_mode, UnitMovementMode::Fly);
    assert_eq!((flying.load, flying.fly), (773, 901));
}

#[test]
fn exact_capacity_is_mobile_and_foreign_units_without_it_are_unstated() {
    let exact = ReportUnit {
        weight: Some(15),
        capacity: Some("0/0/15/0".to_string()),
        ..Default::default()
    };
    assert_eq!(
        unit_movement(&exact).map(|movement| movement.status),
        Some(UnitMovementStatus::Walk)
    );

    let report = parse_report_full(TURN_71);
    let foreign = report
        .units()
        .find(|unit| !unit.own && unit.weight.is_none())
        .expect("the report has foreign units");
    assert_eq!(foreign.movement, None);
}

/// A report prints weight and capacity only for your own units, so a foreign unit's mobility is not
/// unknown by accident - it is genuinely not in the report, and saying so beats assuming it walks.
#[test]
fn a_foreign_unit_has_no_stated_mobility() {
    let report = parse_report_full(TURN_71);
    let foreign = report
        .units()
        .find(|unit| !unit.own && unit.weight.is_none())
        .expect("the report is full of foreign units");

    assert_eq!(mobility(foreign), Mobility::Unstated);
}
