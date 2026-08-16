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

use crate::report::model::region_label;
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

/// Rebuilds a sighting from a stored payload, as a backup carries one. Reads only what a sighting
/// needs (`regionId`, `coordinate.{x,y,z}`, `terrain`, `province`) through a small private serde
/// struct - NOT `ReportRegion`, whose other fields a payload written by an older build may lack -
/// and refuses a payload whose `regionId` is not `region_id`. The label is `region_label(...)`,
/// the same string `region_sightings` writes, so a restored hex and an imported hex read alike.
///
/// # Errors
///
/// Returns the reason as a bare string (no prefix); the caller adds one.
pub fn sighting_from_payload(
    region_id: &str,
    last_seen_turn: u32,
    payload_json: &str,
) -> Result<RegionSighting, String> {
    let region: serde_json::Value = serde_json::from_str(payload_json)
        .map_err(|_| format!("remembered region {region_id} is missing regionId in its payload"))?;

    let payload_region_id = region
        .get("regionId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            format!("remembered region {region_id} is missing regionId in its payload")
        })?;
    if payload_region_id != region_id {
        return Err(format!(
            "remembered region {region_id} does not match its payload id {payload_region_id}"
        ));
    }

    let coordinate = region
        .get("coordinate")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| format!("remembered region {region_id} is missing its coordinate"))?;
    let x = coordinate
        .get("x")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| format!("remembered region {region_id} is missing coordinate x"))?;
    let y = coordinate
        .get("y")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| format!("remembered region {region_id} is missing coordinate y"))?;
    let z = coordinate
        .get("z")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| format!("remembered region {region_id} is missing coordinate z"))?;
    let terrain = region
        .get("terrain")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("remembered region {region_id} is missing its terrain"))?;
    let province = region
        .get("province")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("remembered region {region_id} is missing its province"))?;

    #[allow(clippy::cast_possible_truncation)]
    let x = x as i32;
    #[allow(clippy::cast_possible_truncation)]
    let y = y as i32;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let z = z as u32;

    Ok(RegionSighting {
        region_id: region_id.to_string(),
        x,
        y,
        z,
        label: region_label(terrain, x, y, province),
        terrain: terrain.to_string(),
        province: province.to_string(),
        last_seen_turn,
        payload_json: payload_json.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::parse_report_full;

    const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

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

    #[test]
    fn a_sighting_rebuilt_from_its_payload_reads_like_one_built_from_the_report() {
        let report = parse_report_full(TURN_71);
        let built = &region_sightings(&report, 71)[0];

        let rebuilt =
            sighting_from_payload(&built.region_id, 71, &built.payload_json).expect("rebuilds");

        assert_eq!(&rebuilt, built);
    }

    #[test]
    fn a_payload_naming_another_region_is_refused() {
        let payload = serde_json::json!({
            "regionId": "9:9,9",
            "coordinate": { "x": 9, "y": 9, "z": 9 },
            "terrain": "plain",
            "province": "P"
        })
        .to_string();

        let error = sighting_from_payload("1:7,53", 71, &payload).unwrap_err();

        assert!(error.contains("does not match its payload id"));
    }

    #[test]
    fn a_payload_missing_its_coordinate_is_refused() {
        let payload = serde_json::json!({
            "regionId": "1:7,53",
            "terrain": "plain",
            "province": "P"
        })
        .to_string();

        let error = sighting_from_payload("1:7,53", 71, &payload).unwrap_err();

        assert!(error.contains("is missing its coordinate"));
    }
}
