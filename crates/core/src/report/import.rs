//! What one report import writes, given what the store already holds.
//!
//! Two rules about what a report import writes were, until this module, spelled once in SQL and
//! once in TypeScript: an older sighting never overwrites a newer one, and re-importing a turn
//! moves `updated_at` but leaves `imported_at` where it was. Like [`super::merge`], the rule lives
//! here rather than in either storage adapter, so a hex imported on the desktop and the same hex
//! imported in the browser cannot come out different: the store hands over what it has, and writes
//! back exactly what comes out of this function.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::report::sighting::{region_sightings, RegionSighting};
use crate::report::ParsedReport;

/// What an import needs to know about a hex the faction already remembers: how recently it was
/// seen. Narrower than [`super::merge::StoredSighting`] on purpose - an import never reads the
/// stored payload, so the browser need not serialise thousands of them to ask.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeenRegion {
    pub region_id: String,
    pub last_seen_turn: u32,
}

impl From<&RegionSighting> for SeenRegion {
    fn from(sighting: &RegionSighting) -> Self {
        Self {
            region_id: sighting.region_id.clone(),
            last_seen_turn: sighting.last_seen_turn,
        }
    }
}

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
/// of the same `(faction, turn)`, if the store has one; `seen` is every hex the store holds for
/// the faction (order irrelevant; the last entry wins for a duplicated `region_id`).
#[must_use]
pub fn import_writes(
    report: &ParsedReport,
    turn_number: u32,
    existing_imported_at: Option<&str>,
    seen: &[SeenRegion],
    at: &str,
) -> ImportWrites {
    let last_seen: HashMap<&str, u32> = seen
        .iter()
        .map(|region| (region.region_id.as_str(), region.last_seen_turn))
        .collect();

    let region_sightings = region_sightings(report, turn_number)
        .into_iter()
        .filter(|sighting| {
            last_seen
                .get(sighting.region_id.as_str())
                .is_none_or(|&last_seen_turn| turn_number >= last_seen_turn)
        })
        .collect();

    ImportWrites {
        imported_at: existing_imported_at.unwrap_or(at).to_owned(),
        updated_at: at.to_owned(),
        region_sightings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::parse_report_full;

    const TURN_70: &str = atlantis_hud_fixtures::G7_F95_T70.text;
    const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

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
        let seen = vec![SeenRegion {
            region_id: "1:10,50".to_owned(),
            last_seen_turn: 71,
        }];

        let writes = import_writes(&report, 70, None, &seen, "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 0);
    }

    #[test]
    fn a_hex_remembered_from_the_same_turn_is_refreshed() {
        let report = parse_report_full(TURN_70);
        let seen = vec![SeenRegion {
            region_id: "1:10,50".to_owned(),
            last_seen_turn: 70,
        }];

        let writes = import_writes(&report, 70, None, &seen, "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 1);
    }

    #[test]
    fn the_guard_is_per_hex_not_per_report() {
        let report = parse_report_full(TURN_71);
        let seen = vec![SeenRegion {
            region_id: "1:10,50".to_owned(),
            last_seen_turn: 74,
        }];

        let writes = import_writes(&report, 71, None, &seen, "2026-08-01T10:00:00Z");

        assert_eq!(writes.region_sightings.len(), 10);
        assert!(writes
            .region_sightings
            .iter()
            .all(|sighting| sighting.region_id != "1:10,50"));
    }

    #[test]
    fn a_seen_region_is_read_off_a_stored_sighting() {
        let report = parse_report_full(TURN_71);
        let sighting = &region_sightings(&report, 71)[0];

        let seen = SeenRegion::from(sighting);

        assert_eq!(seen.region_id, sighting.region_id);
        assert_eq!(seen.last_seen_turn, 71);
    }
}
