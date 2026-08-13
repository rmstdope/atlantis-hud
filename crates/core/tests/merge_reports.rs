//! Merging two real reports for one turn.
//!
//! The unit tests in `report::merge` build regions by hand, one rule at a time. This asserts the
//! same rules against text the parser actually has to read, because the thing most likely to go
//! wrong is not the merge but the assumption that two reports agree on what a hex is called.
//!
//! The two fixtures are chosen against each other. Faction 95 stands in the swamp at (10,50), knows
//! the jungle at (9,51) only from that swamp's south-west exit, and has never heard of (9,53).
//! Faction 73 stands in all three. So one hex exercises the deep merge, one is promoted from a name
//! to a sighting, and one is new outright.

use atlantis_hud_core::report::merge::{merge_report_into_sightings, StoredSighting};
use atlantis_hud_core::report::model::{ReportRegion, ReportUnit};
use atlantis_hud_core::report::parse_report_full;
use atlantis_hud_core::report::sighting::{region_sightings, RegionSighting};

const VIEWER: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");
const ALLY: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g8-f73-t71.rep");
const SWAMP: &str = "1:10,50";

/// Faction 95's stored map, exactly as importing its turn 71 would have written it.
fn viewer_sightings() -> Vec<RegionSighting> {
    region_sightings(&parse_report_full(VIEWER), 71)
}

/// The same map as the merge reads it: the key, the turn and the payload, and nothing else.
fn viewer_map() -> Vec<StoredSighting> {
    viewer_sightings()
        .iter()
        .map(StoredSighting::from)
        .collect()
}

fn region_of(sighting: &RegionSighting) -> ReportRegion {
    serde_json::from_str(&sighting.payload_json).expect("a stored sighting holds a region")
}

fn unit<'a>(region: &'a ReportRegion, unit_id: &str) -> Option<&'a ReportUnit> {
    region.units.iter().find(|unit| unit.unit_id == unit_id)
}

fn merged() -> Vec<RegionSighting> {
    merge_report_into_sightings(&viewer_map(), &parse_report_full(ALLY), 71).sightings
}

#[test]
fn both_fixtures_describe_turn_71() {
    assert_eq!(parse_report_full(VIEWER).header.turn_number, Some(71));
    assert_eq!(parse_report_full(ALLY).header.turn_number, Some(71));
    assert_eq!(
        parse_report_full(ALLY).header.faction_id.as_deref(),
        Some("73")
    );
}

#[test]
fn the_ally_contributes_every_hex_it_saw_and_two_the_viewer_had_not() {
    let outcome = merge_report_into_sightings(&viewer_map(), &parse_report_full(ALLY), 71);

    assert_eq!(outcome.merged_region_count, 3);
    assert_eq!(
        outcome.new_region_count, 2,
        "the jungle was only a name and the plain was nothing at all"
    );
    assert_eq!(outcome.skipped_region_count, 0);
}

#[test]
fn a_hex_both_factions_stood_in_holds_both_accounts_of_it() {
    let sightings = merged();
    let swamp = region_of(
        sightings
            .iter()
            .find(|sighting| sighting.region_id == SWAMP)
            .expect("the shared hex was merged"),
    );

    assert!(
        unit(&swamp, "13432").is_some(),
        "the viewer's own unit is still there"
    );
    assert!(
        unit(&swamp, "2001").is_some(),
        "and so is one only the ally reported"
    );
}

#[test]
fn nothing_the_ally_reported_arrives_as_a_unit_the_viewer_can_order() {
    let viewers_own: Vec<String> = viewer_sightings()
        .iter()
        .flat_map(|sighting| region_of(sighting).units)
        .filter(|unit| unit.own)
        .map(|unit| unit.unit_id)
        .collect();

    for sighting in merged() {
        for unit in region_of(&sighting).units {
            assert!(
                !unit.own || viewers_own.contains(&unit.unit_id),
                "unit {} became the viewer's own by being merged",
                unit.unit_id
            );
        }
    }
}

#[test]
fn the_shared_hex_keeps_the_viewers_own_figures() {
    let sightings = merged();
    let swamp = region_of(
        sightings
            .iter()
            .find(|sighting| sighting.region_id == SWAMP)
            .expect("the shared hex was merged"),
    );

    assert_eq!(swamp.population, Some(2018), "the viewer's count, not 1980");
    assert_eq!(swamp.wages.as_deref(), Some("$12.6"), "not the ally's $9.0");
    assert_eq!(
        swamp.for_sale.len(),
        2,
        "the viewer's market, not the ally's shorter one"
    );
}

/// The tie-break, on a unit neither faction owns: the viewer's account of it stands.
#[test]
fn a_stranger_both_factions_saw_keeps_the_viewers_description() {
    let sightings = merged();
    let swamp = region_of(
        sightings
            .iter()
            .find(|sighting| sighting.region_id == SWAMP)
            .expect("the shared hex was merged"),
    );
    let ferns = unit(&swamp, "12694").expect("both reports name this unit");

    assert!(!ferns.own);
    assert_eq!(
        ferns.items.len(),
        1,
        "the viewer saw three lizardmen and no axes; the ally's richer look does not overwrite it"
    );
}

#[test]
fn a_hex_the_viewer_only_knew_by_name_becomes_a_sighting_of_its_own() {
    let jungle = merged()
        .into_iter()
        .find(|sighting| sighting.region_id == "1:9,51")
        .map(|sighting| region_of(&sighting))
        .expect("the jungle is now remembered");

    assert_eq!(jungle.terrain, "jungle");
    assert_eq!(jungle.province, "Maput");
    assert_eq!(jungle.population, Some(640));
    assert!(unit(&jungle, "2003").is_some());
}

#[test]
fn a_hex_the_viewer_had_never_heard_of_arrives_whole() {
    let plain = merged()
        .into_iter()
        .find(|sighting| sighting.region_id == "1:9,53")
        .map(|sighting| region_of(&sighting))
        .expect("the plain is new to the map");

    assert_eq!(plain.label(), "plain (9,53) in Maput");
    assert_eq!(plain.exits.len(), 6);
}
