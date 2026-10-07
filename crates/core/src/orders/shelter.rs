//! How many mages a finished structure seats - the one answer the magic-study check and the study
//! planner both read (ah-29p5).
//!
//! `rules/magic_skills`: study into a magic skill above level 2 outside a building with facilities
//! for mages has its rate "cut in half". The buildings table carries each building's seats; a ship
//! carries its own on its item entry - `data/Galleon`: "This ship will allow one mage to study above
//! level 2" - and `rules/economy_ships` has fleets "contain one or more ships, and may be entered
//! like other buildings", so a fleet seats what its ships seat between them (ah-yw4p).
//!
//! `None` is **not known**, never none: a structure whose seats the catalogue cannot state. The
//! magic-study check reads it as no shelter, the planner as an unknown it must not halve on; the
//! difference is theirs, the count is this module's.

use serde::{Deserialize, Serialize};

use crate::movement::mode::hulls_named_in;
use crate::movement::rules::{ItemKind, Ruleset};
use crate::report::model::Structure;
use crate::report::ParsedReport;

/// One structure the report shows, and how many mages it seats.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "ShelterSeat.ts"))]
pub struct ShelterSeat {
    pub region_id: String,
    /// The structure's number, unique only within its own region.
    pub structure_id: String,
    /// `null` where the catalogue cannot say; a number, zero included, is a fact.
    pub seats: Option<i64>,
}

/// How many mages may study above level 2 in this structure, or `None` where the catalogue cannot
/// say.
///
/// - Unfinished seats nobody: `rules/buildings` is silent, and the navigator settled (2026-08-17)
///   that an unfinished building shelters no one.
/// - A ruleset scraped before buildings were ([`Ruleset::knows_buildings`]) can say nothing.
/// - A building is its table entry, looked up by the kind's base word - the text before the first
///   comma - so `Tower, contains an inner location` is a Tower.
/// - Anything else is read as a ship or a fleet of ships ([`hulls_named_in`]); a hull the catalogue
///   does not carry, or that is not a ship, leaves the structure uncounted.
#[must_use]
pub fn structure_mage_seats(structure: &Structure, ruleset: &Ruleset) -> Option<i64> {
    if structure.needs.is_some() {
        return Some(0);
    }
    if !ruleset.knows_buildings() {
        return None;
    }
    let base = structure.kind.split(',').next().unwrap_or_default().trim();
    if let Some(seats) = ruleset.mage_capacity(base) {
        return Some(seats);
    }
    let mut seats = 0;
    for (name, count) in hulls_named_in(&structure.kind)? {
        let item = ruleset.find_item(&name)?;
        if item.kind != ItemKind::Ship {
            return None;
        }
        seats += i64::from(count) * item.mages.unwrap_or(0);
    }
    Some(seats)
}

/// Every structure the report shows, in report order, with the mages it seats.
#[must_use]
pub fn shelter_seats(report: &ParsedReport, ruleset: &Ruleset) -> Vec<ShelterSeat> {
    report
        .regions
        .iter()
        .flat_map(|region| {
            region.structures.iter().map(|structure| ShelterSeat {
                region_id: region.region_id.clone(),
                structure_id: structure.structure_id.clone(),
                seats: structure_mage_seats(structure, ruleset),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::ReportRegion;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    fn finished(kind: &str) -> Structure {
        Structure {
            structure_id: "1".to_string(),
            name: "Building".to_string(),
            kind: kind.to_string(),
            needs: None,
            ..Default::default()
        }
    }

    fn seats(kind: &str) -> Option<i64> {
        structure_mage_seats(&finished(kind), &ruleset())
    }

    #[test]
    fn a_building_seats_what_its_table_entry_says() {
        assert_eq!(seats("Citadel"), Some(3));
        assert_eq!(seats("Tower"), Some(0));
    }

    #[test]
    fn a_building_with_a_qualifier_reads_its_base_word() {
        assert_eq!(seats("Citadel, contains an inner location"), Some(3));
    }

    #[test]
    fn an_unfinished_structure_seats_nobody() {
        let structure = Structure {
            needs: Some(20),
            ..finished("Citadel")
        };
        assert_eq!(structure_mage_seats(&structure, &ruleset()), Some(0));
    }

    /// `data/Galleon`: "This ship will allow one mage to study above level 2".
    #[test]
    fn a_lone_galleon_seats_one() {
        assert_eq!(seats("Galleon"), Some(1));
    }

    #[test]
    fn a_ship_whose_entry_seats_none_seats_zero() {
        assert_eq!(seats("Longship"), Some(0));
    }

    /// `rules/economy_ships`: "Fleets may contain one or more ships".
    #[test]
    fn a_fleet_seats_what_its_ships_seat_between_them() {
        assert_eq!(seats("Fleet, 2 Galleons, 1 Longship"), Some(2));
    }

    #[test]
    fn a_fleet_holding_an_unknown_hull_is_unknown() {
        assert_eq!(seats("Fleet, 2 Galleons, 1 Starship"), None);
    }

    #[test]
    fn a_kind_neither_table_names_is_unknown() {
        assert_eq!(seats("Spaceport"), None);
    }

    #[test]
    fn a_hull_that_is_not_a_ship_is_unknown() {
        assert_eq!(seats("Fleet, 2 Horses"), None);
    }

    #[test]
    fn a_ruleset_without_buildings_knows_no_seats() {
        let mut json: serde_json::Value =
            serde_json::from_str(atlantis_hud_fixtures::RULESET_JSON).expect("ruleset is JSON");
        json.as_object_mut()
            .expect("ruleset is a JSON object")
            .remove("buildings");
        let ruleset = Ruleset::from_json(&json.to_string()).expect("still parses");
        assert_eq!(structure_mage_seats(&finished("Galleon"), &ruleset), None);
    }

    #[test]
    fn shelter_seats_keys_every_structure_by_region() {
        let report = ParsedReport {
            regions: vec![
                ReportRegion {
                    region_id: "a".to_string(),
                    structures: vec![
                        finished("Citadel"),
                        Structure {
                            structure_id: "2".to_string(),
                            ..finished("Spaceport")
                        },
                    ],
                    ..Default::default()
                },
                ReportRegion {
                    region_id: "b".to_string(),
                    structures: vec![finished("Galleon")],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let seat = |region: &str, structure: &str, seats: Option<i64>| ShelterSeat {
            region_id: region.to_string(),
            structure_id: structure.to_string(),
            seats,
        };
        assert_eq!(
            shelter_seats(&report, &ruleset()),
            vec![
                seat("a", "1", Some(3)),
                seat("a", "2", None),
                seat("b", "1", Some(1)),
            ]
        );
    }
}
