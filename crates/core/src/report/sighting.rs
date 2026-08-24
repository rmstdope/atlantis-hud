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

use crate::report::merge::StoredSighting;
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
    let region: serde_json::Value = serde_json::from_str(payload_json).map_err(|_| {
        format!("remembered region {region_id} has a payload that is not valid JSON")
    })?;

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
    // `i32`/`u32::try_from` rather than `as`: a crafted payload with an out-of-range or negative
    // `z` must be refused, not silently truncated or wrapped into a different coordinate.
    let x = coordinate
        .get("x")
        .and_then(serde_json::Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| format!("remembered region {region_id} is missing coordinate x"))?;
    let y = coordinate
        .get("y")
        .and_then(serde_json::Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| format!("remembered region {region_id} is missing coordinate y"))?;
    let z = coordinate
        .get("z")
        .and_then(serde_json::Value::as_i64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| format!("remembered region {region_id} is missing coordinate z"))?;
    let terrain = region
        .get("terrain")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("remembered region {region_id} is missing its terrain"))?;
    let province = region
        .get("province")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("remembered region {region_id} is missing its province"))?;

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

/// One remembered region as a shell wants it back: the stored payload, back-filled, and its turn.
///
/// The payload stays `serde_json::Value` rather than becoming a
/// [`crate::movement::graph::RememberedRegion`], whose `region` is a typed `ReportRegion`. A payload
/// written by an older build may lack fields this one has, and `sighting_from_payload`'s comment
/// says why that must survive: a remembered hex crosses to a shell as its own JSON and is never
/// round-tripped through `ReportRegion`. Deserializing here would drop exactly the hexes this
/// function exists to keep.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedSighting {
    pub region: serde_json::Value,
    pub last_seen_turn: u32,
}

/// The remembered regions of one faction, in the order both platforms show them.
///
/// Drops a sighting whose payload will not parse, or whose payload is `null` - a stored `null` is
/// valid JSON (`region_sightings` writes one for a region that would not serialize) and would
/// otherwise become a region that is not one. **Dropping one remembered hex beats losing the whole
/// map**, which is the rule both stores were applying separately and by different tests: the
/// desktop filtered `null` explicitly, the browser relied on its hydrator throwing, and it does not
/// (`ah-8z4y.3.2`).
///
/// Back-fills each region's split structure fields (`ah-nmts`), so a hex stored last week reaches
/// the map as one stored today.
///
/// Ordered `last_seen_turn` descending then `region_id` ascending - the desktop's own `ORDER BY`
/// (`core-persistence`'s `load_region_sightings`), which the browser never applied at all. The SQL
/// keeps that clause because an index-backed sort is worth having; this is the definition it
/// implements, and a pre-sorted input is what a stable sort here wants.
#[must_use]
pub fn remembered_regions(stored: Vec<StoredSighting>) -> Vec<RememberedSighting> {
    let mut remembered: Vec<(String, RememberedSighting)> = stored
        .into_iter()
        .filter_map(|sighting| {
            let mut region = serde_json::from_str::<serde_json::Value>(&sighting.payload_json)
                .ok()
                .filter(|payload| !payload.is_null())?;
            crate::report::region::backfill_structure_kinds(&mut region);
            Some((
                sighting.region_id,
                RememberedSighting {
                    region,
                    last_seen_turn: sighting.last_seen_turn,
                },
            ))
        })
        .collect();

    remembered.sort_by(|(left_id, left), (right_id, right)| {
        right
            .last_seen_turn
            .cmp(&left.last_seen_turn)
            .then_with(|| left_id.cmp(right_id))
    });

    remembered.into_iter().map(|(_, hex)| hex).collect()
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

    fn stored(region_id: &str, last_seen_turn: u32, payload_json: &str) -> StoredSighting {
        StoredSighting {
            region_id: region_id.to_owned(),
            last_seen_turn,
            payload_json: payload_json.to_owned(),
        }
    }

    #[test]
    fn a_sighting_whose_payload_will_not_parse_is_dropped() {
        assert!(remembered_regions(vec![stored("1:7,53", 71, "{not json")]).is_empty());
    }

    /// The divergence this function exists to settle: a stored `null` is valid JSON, so the browser
    /// kept it and handed the map a region that is not one, while the desktop dropped it. The
    /// stricter behaviour wins (`ah-8z4y.3.2`).
    #[test]
    fn a_sighting_whose_payload_is_null_is_dropped() {
        assert!(remembered_regions(vec![stored("1:7,53", 71, "null")]).is_empty());
    }

    #[test]
    fn the_rest_of_the_map_survives_one_bad_hex() {
        let report = parse_report_full(TURN_71);
        let good = &region_sightings(&report, 71)[0];

        let remembered = remembered_regions(vec![
            stored("0:0,0", 71, "null"),
            stored(&good.region_id, 71, &good.payload_json),
        ]);

        assert_eq!(remembered.len(), 1);
        assert_eq!(remembered[0].region["regionId"], good.region_id.as_str());
    }

    #[test]
    fn hexes_come_back_newest_first_then_by_region_id() {
        let remembered = remembered_regions(vec![
            stored("1:9,9", 70, r#"{"regionId":"1:9,9"}"#),
            stored("1:1,1", 71, r#"{"regionId":"1:1,1"}"#),
            stored("1:0,0", 71, r#"{"regionId":"1:0,0"}"#),
        ]);

        let order: Vec<_> = remembered
            .iter()
            .map(|hex| hex.region["regionId"].as_str().expect("a region id"))
            .collect();

        assert_eq!(order, ["1:0,0", "1:1,1", "1:9,9"]);
    }

    #[test]
    fn a_hex_stored_before_the_structure_split_is_backfilled() {
        let payload = r#"{"regionId":"1:7,53","structures":[{"kind":"Mine"}]}"#;

        let remembered = remembered_regions(vec![stored("1:7,53", 71, payload)]);

        let structure = &remembered[0].region["structures"][0];
        assert_eq!(structure["baseKind"], "Mine");
        assert_eq!(structure["qualifiers"], serde_json::json!([]));
        assert_eq!(structure["vessels"], serde_json::json!([]));
    }
}
