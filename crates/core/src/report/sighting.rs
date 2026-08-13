//! What a faction saw, region by region, and when.
//!
//! A turn is stored whole, but its regions are also stored one by one, each carrying the turn it
//! was seen in. Without that the map only ever knows the latest report: a report describes the
//! hexes the faction stood in and names their neighbours, but not *their* neighbours, so the map
//! stops at the fringe and no route can be longer than one step.
//!
//! Both platforms build these rows from the same function so that a hex remembered on the desktop
//! and the same hex remembered in the browser cannot come out different. The desktop writes them
//! into SQLite; the browser writes them into IndexedDB.

use serde::{Deserialize, Serialize};

use crate::report::ParsedReport;

/// One region as it was seen in one turn.
///
/// The coordinate, terrain, province and label are carried alongside the payload rather than only
/// inside it, so a store can key and list sightings without reading every payload back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSighting {
    pub region_id: String,
    pub x: i32,
    pub y: i32,
    pub z: u32,
    pub terrain: String,
    pub province: String,
    pub label: String,
    pub last_seen_turn: u32,
    /// The whole region, as the map will want it back.
    pub payload_json: String,
}

/// Every region in a parsed report, as sightings in the given turn.
///
/// Takes the report already parsed rather than the text it came from: the callers have one to hand
/// by the time they need this, and parsing it again is the cost #28 exists to remove.
#[must_use]
pub fn region_sightings(report: &ParsedReport, turn_number: u32) -> Vec<RegionSighting> {
    report
        .regions
        .iter()
        .map(|region| RegionSighting {
            region_id: region.region_id.clone(),
            x: region.coordinate.x,
            y: region.coordinate.y,
            z: region.coordinate.z,
            terrain: region.terrain.clone(),
            province: region.province.clone(),
            label: region.label(),
            last_seen_turn: turn_number,
            // A region that will not serialize is stored as `null` rather than dropped, so the
            // hex is still remembered as seen and the reader that cannot use it says so.
            payload_json: serde_json::to_string(region).unwrap_or_else(|_| "null".to_owned()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::parse_report_full;

    const TURN_71: &str =
        include_str!("../../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");

    #[test]
    fn every_region_in_the_report_is_a_sighting_in_the_turn_it_was_seen() {
        let report = parse_report_full(TURN_71);

        let sightings = region_sightings(&report, 71);

        assert_eq!(sightings.len(), report.regions.len());
        assert_eq!(sightings.len(), 11);
        assert!(sightings
            .iter()
            .all(|sighting| sighting.last_seen_turn == 71));
    }

    #[test]
    fn a_sighting_carries_the_region_it_was_made_of() {
        let report = parse_report_full(TURN_71);
        let region = &report.regions[0];

        let sightings = region_sightings(&report, 71);
        let first = &sightings[0];

        assert_eq!(first.region_id, region.region_id);
        assert_eq!(first.x, region.coordinate.x);
        assert_eq!(first.y, region.coordinate.y);
        assert_eq!(first.z, region.coordinate.z);
        assert_eq!(first.terrain, region.terrain);
        assert_eq!(first.province, region.province);
        assert_eq!(first.label, region.label());
    }

    /// The payload is what the map reads back, so it has to be the region and not a summary of it.
    #[test]
    fn the_payload_is_the_whole_region() {
        let report = parse_report_full(TURN_71);

        let sightings = region_sightings(&report, 71);
        let restored: crate::report::model::ReportRegion =
            serde_json::from_str(&sightings[0].payload_json).expect("the payload is a region");

        assert_eq!(restored, report.regions[0]);
    }

    #[test]
    fn a_report_with_no_regions_is_no_sightings_rather_than_an_error() {
        let report = parse_report_full("Lonely (1) Report\n");

        assert!(region_sightings(&report, 71).is_empty());
    }
}
