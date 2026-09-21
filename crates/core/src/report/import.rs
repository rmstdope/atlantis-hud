//! What one report import writes, given what the store already holds.
//!
//! Two rules about what a report import writes were, until this module, spelled once in SQL and
//! once in TypeScript: an older sighting never overwrites a newer one, and re-importing a turn
//! moves `updated_at` but leaves `imported_at` where it was. Like [`super::merge`], the rule lives
//! here rather than in either storage adapter, so a hex imported on the desktop and the same hex
//! imported in the browser cannot come out different: the store hands over what it has, and writes
//! back exactly what comes out of this function.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::report::merge::StoredSighting;
use crate::report::model::ReportRegion;
use crate::report::sighting::{region_sightings, RegionSighting};
use crate::report::ParsedReport;

/// Everything one import writes beyond the turn's own payload: the two stamps of the imported
/// turn, and the sightings to remember.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWrites {
    /// When the turn first arrived: the earlier import's stamp when there is one, else `at`.
    /// An earlier import that carries no stamp (a browser record written before stamps existed)
    /// counts as none.
    pub imported_at: String,
    /// `at`, always - a first import and a re-import both move it.
    pub updated_at: String,
    /// The report's regions as sightings in `turn_number`, in report order, **minus** every hex
    /// the faction already remembers from a later turn. A hex remembered from the same turn is
    /// included (a re-import refreshes it); a hex nothing is stored for is always included.
    pub region_sightings: Vec<RegionSighting>,
}

/// The rows and stamps one import writes. `existing_imported_at` is the stamp of an earlier import
/// of the same `(faction, turn)`, if the store has one; `stored` is every hex the store holds for
/// the faction (order irrelevant; the last entry wins for a duplicated `region_id`).
#[must_use]
pub fn import_writes(
    report: &ParsedReport,
    turn_number: u32,
    existing_imported_at: Option<&str>,
    stored: &[StoredSighting],
    at: &str,
) -> ImportWrites {
    let last_seen: HashMap<&str, u32> = stored
        .iter()
        .map(|region| (region.region_id.as_str(), region.last_seen_turn))
        .collect();

    let mut region_sightings: Vec<_> = region_sightings(report, turn_number)
        .into_iter()
        .filter(|sighting| {
            last_seen
                .get(sighting.region_id.as_str())
                .is_none_or(|&last_seen_turn| turn_number >= last_seen_turn)
        })
        .collect();
    region_sightings.extend(reconciled_retained_sightings(report, stored));

    ImportWrites {
        imported_at: existing_imported_at.unwrap_or(at).to_owned(),
        updated_at: at.to_owned(),
        region_sightings,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UnitTransfer {
    unit_id: String,
    faction_id: String,
    faction_name: String,
}

fn unit_transfer(event: &str) -> Option<UnitTransfer> {
    let (donor, recipient) = event.split_once("): Gives unit to ")?;
    let (name, unit_id) = donor.rsplit_once(" (")?;
    let (faction_name, faction_id) = recipient.rsplit_once(" (")?;
    (!name.is_empty() && !faction_name.is_empty())
        .then_some(())
        .and_then(|()| {
            faction_id
                .strip_suffix(").")
                .map(|faction_id| (unit_id, faction_id))
        })
        .and_then(|(unit_id, faction_id)| {
            (unit_id.parse::<u32>().is_ok() && faction_id.parse::<u32>().is_ok()).then(|| {
                UnitTransfer {
                    unit_id: unit_id.to_owned(),
                    faction_id: faction_id.to_owned(),
                    faction_name: faction_name.to_owned(),
                }
            })
        })
}

fn reconciled_retained_sightings(
    report: &ParsedReport,
    stored: &[StoredSighting],
) -> Vec<RegionSighting> {
    let transfers: HashMap<_, _> = report
        .header
        .events
        .iter()
        .filter_map(|event| unit_transfer(event))
        .map(|transfer| (transfer.unit_id.clone(), transfer))
        .collect();
    if transfers.is_empty() {
        return Vec::new();
    }

    let current_regions: HashSet<_> = report
        .regions
        .iter()
        .map(|region| region.region_id.as_str())
        .collect();
    let current_units: HashSet<_> = report
        .regions
        .iter()
        .flat_map(|region| region.units.iter().map(|unit| unit.unit_id.as_str()))
        .collect();

    stored
        .iter()
        .filter(|sighting| !current_regions.contains(sighting.region_id.as_str()))
        .filter_map(|sighting| {
            let mut region: ReportRegion = serde_json::from_str(&sighting.payload_json).ok()?;
            let mut changed = false;
            for unit in &mut region.units {
                let Some(transfer) = transfers.get(unit.unit_id.as_str()) else {
                    continue;
                };
                if current_units.contains(unit.unit_id.as_str()) {
                    continue;
                }
                unit.faction_id = Some(transfer.faction_id.clone());
                unit.faction_name = Some(transfer.faction_name.clone());
                unit.own = false;
                changed = true;
            }
            changed.then(|| sighting_for(&region, sighting.last_seen_turn))
        })
        .collect()
}

fn sighting_for(region: &ReportRegion, last_seen_turn: u32) -> RegionSighting {
    RegionSighting {
        region_id: region.region_id.clone(),
        x: region.coordinate.x,
        y: region.coordinate.y,
        z: region.coordinate.z,
        terrain: region.terrain.clone(),
        province: region.province.clone(),
        label: region.label(),
        last_seen_turn,
        payload_json: serde_json::to_string(region).unwrap_or_else(|_| "null".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::parse_report_full;

    const TURN_70: &str = atlantis_hud_fixtures::G7_F95_T70.text;
    const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
    const BORG_TURN_17: &str = atlantis_hud_fixtures::G7_F62_T17.text;
    const BORG_TURN_18: &str = atlantis_hud_fixtures::G7_F62_T18.text;

    #[test]
    fn a_first_import_is_stamped_with_the_callers_clock_twice() {
        let report = parse_report_full(TURN_71);

        let writes = import_writes(&report, 71, None, &[], "2026-08-01T10:00:00Z");

        assert_eq!(writes.imported_at, "2026-08-01T10:00:00Z");
        assert_eq!(writes.updated_at, "2026-08-01T10:00:00Z");
    }

    #[test]
    fn a_re_import_keeps_when_the_turn_first_arrived() {
        let report = parse_report_full(TURN_71);

        let writes = import_writes(
            &report,
            71,
            Some("2026-08-01T10:00:00Z"),
            &[],
            "2026-08-02T10:00:00Z",
        );

        assert_eq!(writes.imported_at, "2026-08-01T10:00:00Z");
        assert_eq!(writes.updated_at, "2026-08-02T10:00:00Z");
    }

    #[test]
    fn every_region_of_a_report_is_written_when_nothing_is_remembered() {
        let report = parse_report_full(TURN_71);

        let writes = import_writes(&report, 71, None, &[], "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 11);
        assert!(writes
            .region_sightings
            .iter()
            .all(|sighting| sighting.last_seen_turn == 71));
        assert_eq!(
            writes.region_sightings[0].region_id,
            region_sightings(&report, 71)[0].region_id
        );
    }

    #[test]
    fn a_hex_remembered_from_a_later_turn_is_left_alone() {
        let report = parse_report_full(TURN_70);
        let seen = vec![StoredSighting {
            region_id: "1:10,50".to_owned(),
            last_seen_turn: 71,
            payload_json: "null".to_owned(),
        }];

        let writes = import_writes(&report, 70, None, &seen, "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 0);
    }

    #[test]
    fn a_hex_remembered_from_the_same_turn_is_refreshed() {
        let report = parse_report_full(TURN_70);
        let seen = vec![StoredSighting {
            region_id: "1:10,50".to_owned(),
            last_seen_turn: 70,
            payload_json: "null".to_owned(),
        }];

        let writes = import_writes(&report, 70, None, &seen, "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 1);
    }

    #[test]
    fn the_guard_is_per_hex_not_per_report() {
        let report = parse_report_full(TURN_71);
        let seen = vec![StoredSighting {
            region_id: "1:10,50".to_owned(),
            last_seen_turn: 74,
            payload_json: "null".to_owned(),
        }];

        let writes = import_writes(&report, 71, None, &seen, "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 10);
        assert!(writes
            .region_sightings
            .iter()
            .all(|sighting| sighting.region_id != "1:10,50"));
    }

    #[test]
    fn a_stored_sighting_preserves_its_region_and_turn() {
        let report = parse_report_full(TURN_71);
        let sighting = &region_sightings(&report, 71)[0];

        let stored = StoredSighting::from(sighting);

        assert_eq!(stored.region_id, sighting.region_id);
        assert_eq!(stored.last_seen_turn, 71);
    }

    #[test]
    fn a_unit_transfer_updates_a_retained_units_identity() {
        // rules/give: `GIVE [unit] UNIT` transfers the entire unit to the receiving faction.
        let first = parse_report_full(BORG_TURN_17);
        let second = parse_report_full(BORG_TURN_18);
        let seen: Vec<StoredSighting> = region_sightings(&first, 17)
            .iter()
            .map(StoredSighting::from)
            .collect();

        let writes = import_writes(&second, 18, None, &seen, "2026-08-01T10:00:00Z");
        let retained = writes
            .region_sightings
            .iter()
            .find(|sighting| sighting.region_id == "1:42,80")
            .expect("the transferred unit's retained hex is rewritten");

        assert_eq!(retained.last_seen_turn, 17);
        let region: crate::report::model::ReportRegion =
            serde_json::from_str(&retained.payload_json).expect("retained payload parses");
        let unit = region
            .units
            .iter()
            .find(|unit| unit.unit_id == "7124")
            .expect("Drones remain a remembered unit");
        assert_eq!(unit.faction_id.as_deref(), Some("34"));
        assert_eq!(unit.faction_name.as_deref(), Some("Queen XOT"));
        assert!(!unit.own);
    }
}
