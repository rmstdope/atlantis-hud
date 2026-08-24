//! Folding an ally's report into what a faction has already seen.
//!
//! A game holds as many factions as its reports name, and each keeps its own map: sightings are
//! stored under `(game, faction, region)` and read back for one faction at a time. That is right
//! for two players sharing a game and wrong for one player holding two factions, or for allies who
//! swap reports - neither can pool what they saw, and the hexes one of them walked never appear on
//! the other's map at all.
//!
//! Merging is what issue #53 asks for: the ally's regions are written under *the viewer's* faction
//! id, so the map reads them back with no change to the read path whatsoever. Only reports from the
//! same turn can be merged, and that restriction is what makes the whole thing tractable - two
//! reports for one turn describe the same moment, so neither is staler than the other and there is
//! nothing to arbitrate by age.
//!
//! Where the two reports overlap, the viewer's own account wins and the ally's fills the gaps. That
//! is not timidity: a report states weights, capacities, skills and exact inventories for its own
//! units only, so the viewer's record of a hex the viewer stood in is strictly the better one. What
//! the ally contributes is what the viewer could not see - hexes out of reach, and units standing
//! in hexes the viewer never entered.
//!
//! Like [`super::sighting`], the rule lives here rather than in either storage adapter, so a hex
//! merged on the desktop and the same hex merged in the browser cannot come out different.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::report::model::{ReportRegion, ReportUnit};
use crate::report::sighting::RegionSighting;
use crate::report::ParsedReport;

/// What merging a report into a stored map produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    /// Only the rows that changed, ready to be written under the viewer's faction.
    pub sightings: Vec<RegionSighting>,
    /// Regions the incoming report contributed.
    pub merged_region_count: usize,
    /// Of those, the hexes the viewer had never seen at all.
    pub new_region_count: usize,
    /// Regions declined because the viewer already knows the hex from a later turn.
    pub skipped_region_count: usize,
}

/// One region, made safe to store under somebody else's faction.
///
/// `own` is the report's own `*`/`-` marker, and it is therefore relative to whoever wrote the
/// report. Carrying an ally's units across without this would put units the viewer does not control
/// into the viewer's map as their own: the orders panel would offer to command them, and the
/// planner would stop counting them as strength on the board. Everything else the ally's report
/// revealed - the faction, the flags, the full inventory, the skills - is kept, because knowing
/// more about a unit you cannot order is exactly the point of merging.
#[must_use]
pub fn as_foreign_sighting(region: &ReportRegion) -> ReportRegion {
    let mut region = region.clone();
    for unit in &mut region.units {
        unit.own = false;
    }
    region
}

/// One hex as two factions saw it in the same turn.
///
/// `existing` is the viewer's account and wins every disagreement; `incoming` is only ever read for
/// what the viewer does not have. The lists are unioned rather than replaced, and their order is
/// fixed - the viewer's entries first, then the ally's additions in report order - because the
/// result is serialized into a stored payload and merging the same pair twice has to produce the
/// same bytes.
#[must_use]
pub fn merge_regions(existing: &ReportRegion, incoming: &ReportRegion) -> ReportRegion {
    ReportRegion {
        // The key. Two regions that disagree here are not the same hex and should never have met.
        region_id: existing.region_id.clone(),
        coordinate: existing.coordinate,
        terrain: prefer_text(&existing.terrain, &incoming.terrain),
        province: prefer_text(&existing.province, &incoming.province),
        settlement: existing
            .settlement
            .clone()
            .or_else(|| incoming.settlement.clone()),
        population: existing.population.or(incoming.population),
        race: existing.race.clone().or_else(|| incoming.race.clone()),
        tax_base: existing.tax_base.or(incoming.tax_base),
        wages: existing.wages.clone().or_else(|| incoming.wages.clone()),
        max_wages: existing.max_wages.or(incoming.max_wages),
        entertainment: existing.entertainment.or(incoming.entertainment),
        // A market is read whole or not at all: a unit that could see the region saw all of it, so
        // a shorter list is a different observation rather than a subset of the longer one. Taking
        // the ally's only when the viewer has none avoids inventing a market that was never printed.
        products: prefer_list(&existing.products, &incoming.products),
        wanted: prefer_list(&existing.wanted, &incoming.wanted),
        for_sale: prefer_list(&existing.for_sale, &incoming.for_sale),
        // Exits and structures are geography: they can only be gained, never contradicted.
        exits: union_by(&existing.exits, &incoming.exits, |exit| {
            exit.direction.clone()
        }),
        structures: union_by(&existing.structures, &incoming.structures, |structure| {
            structure.structure_id.clone()
        }),
        units: merge_units(&existing.units, &incoming.units),
    }
}

/// What a merge needs to know about a hex the viewer already has.
///
/// Narrower than [`RegionSighting`] on purpose. A sighting also carries the coordinate, terrain,
/// province and label, but those are derived from the payload so a store can list hexes without
/// reading it - a merge re-derives them from the merged region and never reads the stored ones.
/// Saying so in the type means the browser, whose store keeps only these three, can hand over
/// exactly what it holds instead of inventing columns to fill a shape it does not have.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSighting {
    pub region_id: String,
    pub last_seen_turn: u32,
    pub payload_json: String,
}

impl From<&RegionSighting> for StoredSighting {
    fn from(sighting: &RegionSighting) -> Self {
        Self {
            region_id: sighting.region_id.clone(),
            last_seen_turn: sighting.last_seen_turn,
            payload_json: sighting.payload_json.clone(),
        }
    }
}

/// Folds a report for the viewer's own turn into the sightings the viewer already has.
///
/// Returns only the rows that changed, so the write stays small and the counts the workspace
/// reports are honest about what the merge actually did.
#[must_use]
pub fn merge_report_into_sightings(
    existing: &[StoredSighting],
    incoming: &ParsedReport,
    turn_number: u32,
) -> MergeOutcome {
    let stored: HashMap<&str, &StoredSighting> = existing
        .iter()
        .map(|sighting| (sighting.region_id.as_str(), sighting))
        .collect();

    let mut outcome = MergeOutcome {
        sightings: Vec::new(),
        merged_region_count: 0,
        new_region_count: 0,
        skipped_region_count: 0,
    };

    for region in &incoming.regions {
        let contribution = as_foreign_sighting(region);
        let previous = stored.get(region.region_id.as_str()).copied();

        // A hex the viewer already knows from a later turn is left alone. Neither store refuses
        // this any more (see `import_writes`, which decides the same thing for an import) - the
        // rule lives here so a hex merged on the desktop and the same hex merged in the browser
        // cannot come out different.
        if previous.is_some_and(|sighting| sighting.last_seen_turn > turn_number) {
            outcome.skipped_region_count += 1;
            continue;
        }

        // A payload written by an older build may not parse. Rebuilding the hex from the ally's
        // account beats losing it, which is the same trade the read path already makes.
        let merged = match previous.and_then(stored_region) {
            Some(stored_region) => merge_regions(&stored_region, &contribution),
            None => contribution,
        };

        if previous.is_none() {
            outcome.new_region_count += 1;
        }
        outcome.merged_region_count += 1;
        outcome.sightings.push(sighting_for(&merged, turn_number));
    }

    outcome
}

/// The region inside a stored sighting, or `None` when the payload will not parse.
fn stored_region(sighting: &StoredSighting) -> Option<ReportRegion> {
    serde_json::from_str(&sighting.payload_json).ok()
}

/// A sighting carrying the merged region, with its queryable columns re-derived from it.
///
/// Derived rather than copied from either side, so the columns a store lists hexes by and the
/// payload it hands back cannot drift apart.
fn sighting_for(region: &ReportRegion, turn_number: u32) -> RegionSighting {
    RegionSighting {
        region_id: region.region_id.clone(),
        x: region.coordinate.x,
        y: region.coordinate.y,
        z: region.coordinate.z,
        terrain: region.terrain.clone(),
        province: region.province.clone(),
        label: region.label(),
        last_seen_turn: turn_number,
        payload_json: serde_json::to_string(region).unwrap_or_else(|_| "null".to_owned()),
    }
}

/// The viewer's text, unless the viewer has none.
fn prefer_text(existing: &str, incoming: &str) -> String {
    if existing.is_empty() {
        incoming.to_owned()
    } else {
        existing.to_owned()
    }
}

/// The viewer's list, unless the viewer has none.
fn prefer_list<T: Clone>(existing: &[T], incoming: &[T]) -> Vec<T> {
    if existing.is_empty() {
        incoming.to_vec()
    } else {
        existing.to_vec()
    }
}

/// The viewer's entries, then whichever of the ally's the viewer did not already have.
fn union_by<T: Clone, K: Eq + std::hash::Hash>(
    existing: &[T],
    incoming: &[T],
    key: impl Fn(&T) -> K,
) -> Vec<T> {
    let seen: std::collections::HashSet<K> = existing.iter().map(&key).collect();
    existing
        .iter()
        .cloned()
        .chain(
            incoming
                .iter()
                .filter(|entry| !seen.contains(&key(entry)))
                .cloned(),
        )
        .collect()
}

/// Units of one hex as two reports described them.
///
/// A unit both reports name is kept once, and the account that owns it wins: only its own faction's
/// report states its weight, capacity, skills and full inventory. Everything else keeps the viewer's
/// account, so nothing the viewer knew can be lost by merging.
fn merge_units(existing: &[ReportUnit], incoming: &[ReportUnit]) -> Vec<ReportUnit> {
    let mut merged: Vec<ReportUnit> = existing.to_vec();
    let mut position: HashMap<String, usize> = existing
        .iter()
        .enumerate()
        .map(|(index, unit)| (unit.unit_id.clone(), index))
        .collect();

    for unit in incoming {
        match position.get(&unit.unit_id) {
            Some(&index) => {
                if unit.own && !merged[index].own {
                    merged[index] = unit.clone();
                }
            }
            None => {
                position.insert(unit.unit_id.clone(), merged.len());
                merged.push(unit.clone());
            }
        }
    }

    merged
}

/// One allied report folded into a faction's map for one turn.
///
/// A merge writes the ally's regions under the viewer's own faction and stores no turn of the
/// ally's, so this row is the only thing that remembers it happened. `faction_id` is the map that
/// grew; `merged_faction_id` is whose report grew it.
///
/// Lives here rather than in the desktop's store because the browser has one too, and the order
/// they are listed in is one rule (`order_merged_reports`, `ah-8z4y.3.2`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedReportRecord {
    pub game_id: String,
    pub faction_id: String,
    pub turn_number: u32,
    pub merged_faction_id: String,
    pub merged_faction_name: String,
    pub merged_at: String,
}

/// Merged reports oldest first, then by faction id: the order both platforms list them in.
///
/// The panel lists them in the order they happened, and a list that reorders itself between
/// platforms is two applications.
///
/// The desktop's `ORDER BY merged_at ASC, merged_faction_id ASC`
/// (`core-persistence/src/lib.rs:1543`) implements this and keeps doing so, because a sort a
/// database can do with an index is worth having. **This is the definition it implements**, and
/// `the_sql_orders_merged_reports_the_way_the_core_says` is the test that they still agree
/// (`ah-8z4y.3.2`). Deleting either one leaves the rule stated in one place and applied in the
/// other.
pub fn order_merged_reports(records: &mut [MergedReportRecord]) {
    records.sort_by(|left, right| {
        left.merged_at
            .cmp(&right.merged_at)
            .then_with(|| left.merged_faction_id.cmp(&right.merged_faction_id))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::{Coordinate, ItemAmount, MarketItem, Skill, Structure};

    fn coordinate() -> Coordinate {
        Coordinate { x: 10, y: 50, z: 1 }
    }

    fn region() -> ReportRegion {
        ReportRegion {
            region_id: coordinate().id(),
            coordinate: coordinate(),
            terrain: "swamp".to_owned(),
            province: "Cebo".to_owned(),
            ..Default::default()
        }
    }

    fn unit(unit_id: &str, own: bool) -> ReportUnit {
        ReportUnit {
            unit_id: unit_id.to_owned(),
            name: format!("Unit ({unit_id})"),
            region_id: coordinate().id(),
            own,
            men: 1,
            ..Default::default()
        }
    }

    fn item(name: &str) -> ItemAmount {
        ItemAmount {
            amount: 1,
            name: name.to_owned(),
            tag: name.to_uppercase(),
        }
    }

    fn market(name: &str) -> MarketItem {
        MarketItem {
            amount: 1,
            name: name.to_owned(),
            tag: name.to_uppercase(),
            price: 10,
        }
    }

    fn exit(direction: &str, terrain: &str) -> crate::report::model::Exit {
        crate::report::model::Exit {
            direction: direction.to_owned(),
            terrain: terrain.to_owned(),
            coordinate: coordinate(),
            province: "Cebo".to_owned(),
            settlement: None,
        }
    }

    fn structure(structure_id: &str, kind: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_owned(),
            name: format!("Structure [{structure_id}]"),
            kind: kind.to_owned(),
            description: None,
            needs: None,
            ..Default::default()
        }
    }

    fn sighting_of(region: &ReportRegion, last_seen_turn: u32) -> StoredSighting {
        StoredSighting::from(&super::sighting_for(region, last_seen_turn))
    }

    fn as_stored(sightings: &[RegionSighting]) -> Vec<StoredSighting> {
        sightings.iter().map(StoredSighting::from).collect()
    }

    fn report_of(regions: Vec<ReportRegion>) -> ParsedReport {
        ParsedReport {
            header: crate::report::header::ReportHeader {
                faction_id: Some("73".to_owned()),
                faction_name: Some("Borg".to_owned()),
                month: Some("December".to_owned()),
                year: Some(6),
                turn_number: Some(71),
                ..Default::default()
            },
            regions,
            battles: Vec::new(),
            orders_template: None,
            unreadable_lines: Vec::new(),
        }
    }

    #[test]
    fn the_viewers_figures_win_where_it_has_them() {
        let mut mine = region();
        mine.population = Some(2018);
        mine.wages = Some("12.6".to_owned());
        mine.entertainment = Some(75);
        let mut theirs = region();
        theirs.population = Some(1980);
        theirs.wages = Some("9.0".to_owned());
        theirs.entertainment = Some(40);

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.population, Some(2018));
        assert_eq!(merged.wages.as_deref(), Some("12.6"));
        assert_eq!(merged.entertainment, Some(75));
    }

    #[test]
    fn the_allys_figures_fill_only_what_the_viewer_lacked() {
        let mine = region();
        let mut theirs = region();
        theirs.population = Some(1980);
        theirs.race = Some("lizardmen".to_owned());
        theirs.tax_base = Some(1010);
        theirs.max_wages = Some(436);

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.population, Some(1980));
        assert_eq!(merged.race.as_deref(), Some("lizardmen"));
        assert_eq!(merged.tax_base, Some(1010));
        assert_eq!(merged.max_wages, Some(436));
    }

    #[test]
    fn exits_are_unioned_by_direction_and_the_viewers_exit_wins() {
        let mut mine = region();
        mine.exits = vec![exit("North", "ocean")];
        let mut theirs = region();
        theirs.exits = vec![exit("North", "plain"), exit("Southwest", "jungle")];

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.exits.len(), 2);
        assert_eq!(merged.exits[0].direction, "North");
        assert_eq!(merged.exits[0].terrain, "ocean");
        assert_eq!(merged.exits[1].direction, "Southwest");
    }

    #[test]
    fn structures_are_unioned_by_id_and_the_viewers_wins() {
        let mut mine = region();
        mine.structures = vec![structure("21", "Tower")];
        let mut theirs = region();
        theirs.structures = vec![structure("21", "Fort"), structure("22", "Longship")];

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.structures.len(), 2);
        assert_eq!(merged.structures[0].kind, "Tower");
        assert_eq!(merged.structures[1].structure_id, "22");
    }

    #[test]
    fn a_market_the_viewer_could_not_see_comes_from_the_ally() {
        let mine = region();
        let mut theirs = region();
        theirs.for_sale = vec![market("pearls")];
        theirs.products = vec![item("grain")];

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.for_sale.len(), 1);
        assert_eq!(merged.products.len(), 1);
    }

    #[test]
    fn a_market_the_viewer_saw_is_left_alone() {
        let mut mine = region();
        mine.for_sale = vec![market("lizardmen")];
        let mut theirs = region();
        theirs.for_sale = vec![market("pearls"), market("leaders")];

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.for_sale.len(), 1);
        assert_eq!(merged.for_sale[0].name, "lizardmen");
    }

    #[test]
    fn an_own_unit_survives_the_ally_seeing_it_as_a_stranger() {
        let mut mine = region();
        let mut drone = unit("13432", true);
        drone.skills = vec![Skill {
            name: "combat".to_owned(),
            tag: "COMB".to_owned(),
            level: 3,
            points: 180,
        }];
        mine.units = vec![drone];
        let mut theirs = region();
        theirs.units = vec![unit("13432", false)];

        let merged = merge_regions(&mine, &theirs);

        assert_eq!(merged.units.len(), 1);
        assert!(merged.units[0].own);
        assert_eq!(merged.units[0].skills.len(), 1);
    }

    #[test]
    fn units_the_ally_contributes_arrive_as_strangers_with_their_detail() {
        let mut mine = region();
        mine.units = vec![unit("13432", true)];
        let mut theirs = region();
        let mut watch = unit("2001", true);
        watch.items = vec![item("lizardman")];
        watch.faction_id = Some("73".to_owned());
        theirs.units = vec![watch];

        let merged = merge_regions(&mine, &as_foreign_sighting(&theirs));

        assert_eq!(merged.units.len(), 2);
        let contributed = &merged.units[1];
        assert_eq!(contributed.unit_id, "2001");
        assert!(!contributed.own);
        assert_eq!(contributed.items.len(), 1);
        assert_eq!(contributed.faction_id.as_deref(), Some("73"));
    }

    #[test]
    fn a_hex_only_the_ally_saw_carries_no_units_of_yours() {
        let mut theirs = region();
        theirs.units = vec![unit("2001", true), unit("2002", true)];

        let contributed = as_foreign_sighting(&theirs);

        assert!(contributed.units.iter().all(|unit| !unit.own));
    }

    #[test]
    fn merging_twice_changes_nothing() {
        let mut mine = region();
        mine.units = vec![unit("13432", true)];
        mine.population = Some(2018);
        let stored = vec![sighting_of(&mine, 71)];
        let mut theirs = region();
        theirs.units = vec![unit("2001", true)];
        theirs.population = Some(1980);
        let report = report_of(vec![theirs]);

        let once = merge_report_into_sightings(&stored, &report, 71);
        let twice = merge_report_into_sightings(&as_stored(&once.sightings), &report, 71);

        assert_eq!(once.sightings, twice.sightings);
        assert_eq!(twice.new_region_count, 0);
    }

    #[test]
    fn a_hex_the_viewer_knows_from_a_later_turn_is_left_alone() {
        let mine = region();
        let stored = vec![sighting_of(&mine, 72)];
        let report = report_of(vec![region()]);

        let outcome = merge_report_into_sightings(&stored, &report, 71);

        assert_eq!(outcome.skipped_region_count, 1);
        assert_eq!(outcome.merged_region_count, 0);
        assert!(outcome.sightings.is_empty());
    }

    #[test]
    fn the_merged_row_carries_the_turn_that_was_merged() {
        let report = report_of(vec![region()]);

        let outcome = merge_report_into_sightings(&[], &report, 71);

        assert_eq!(outcome.new_region_count, 1);
        assert_eq!(outcome.merged_region_count, 1);
        assert_eq!(outcome.sightings[0].last_seen_turn, 71);
        assert_eq!(outcome.sightings[0].label, "swamp (10,50) in Cebo");
    }

    #[test]
    fn an_unreadable_stored_payload_is_replaced_rather_than_losing_the_hex() {
        let mut unreadable = sighting_of(&region(), 71);
        unreadable.payload_json = "{ this is not a region".to_owned();
        let mut theirs = region();
        theirs.population = Some(1980);
        let report = report_of(vec![theirs]);

        let outcome = merge_report_into_sightings(&[unreadable], &report, 71);

        assert_eq!(outcome.merged_region_count, 1);
        let restored: ReportRegion =
            serde_json::from_str(&outcome.sightings[0].payload_json).expect("a region");
        assert_eq!(restored.population, Some(1980));
    }

    fn merge_of(merged_faction_id: &str, merged_at: &str) -> MergedReportRecord {
        MergedReportRecord {
            game_id: "alpha".to_owned(),
            faction_id: "95".to_owned(),
            turn_number: 71,
            merged_faction_id: merged_faction_id.to_owned(),
            merged_faction_name: format!("Ally {merged_faction_id}"),
            merged_at: merged_at.to_owned(),
        }
    }

    #[test]
    fn merged_reports_are_oldest_first() {
        let mut records = vec![
            merge_of("12", "2026-08-01T12:00:00Z"),
            merge_of("13", "2026-08-01T09:00:00Z"),
        ];

        order_merged_reports(&mut records);

        assert_eq!(
            records
                .iter()
                .map(|record| record.merged_faction_id.as_str())
                .collect::<Vec<_>>(),
            ["13", "12"]
        );
    }

    #[test]
    fn two_merges_at_the_same_instant_are_ordered_by_faction() {
        let mut records = vec![
            merge_of("9", "2026-08-01T09:00:00Z"),
            merge_of("13", "2026-08-01T09:00:00Z"),
            merge_of("12", "2026-08-01T09:00:00Z"),
        ];

        order_merged_reports(&mut records);

        assert_eq!(
            records
                .iter()
                .map(|record| record.merged_faction_id.as_str())
                .collect::<Vec<_>>(),
            ["12", "13", "9"]
        );
    }
}
