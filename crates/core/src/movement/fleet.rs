//! Which movement order a unit actually travels by.
//!
//! A unit standing aboard a ship writes no order of its own: the unit sailing the hull writes
//! `SAIL`, and everyone aboard goes with it. Every reader that wants to know where a unit ends the
//! month therefore has the same two-part question to answer, and this module answers it once so a
//! second reader cannot answer it differently - which is exactly the disagreement ah-p1p, ah-l2i
//! and ah-048 were each filed for.

use std::collections::BTreeMap;

use crate::movement::orders::MoveStep;
use crate::report::model::ReportUnit;
use crate::report::ParsedReport;

/// The last top-level movement order each unit wrote, read once from the whole orders document.
///
/// Only lines that are a unit's own for this turn count: a `TURN` block holds orders for the turn
/// after this one and a `FORM` block's orders belong to the unit being formed, so movement inside
/// either says nothing about where the unit whose block it is goes next. The last readable
/// movement line wins, because a later order replaces an earlier one when the game executes them.
#[derive(Debug, Default, Clone)]
pub struct OrderedUnits {
    by_unit: BTreeMap<String, Vec<MoveStep>>,
}

impl OrderedUnits {
    /// Reads every unit's block out of one orders document.
    #[must_use]
    pub fn from_document(orders_document: &str) -> Self {
        use crate::orders::walk::{walk, Depth, Event};

        let mut by_unit: BTreeMap<String, Vec<MoveStep>> = BTreeMap::new();
        let mut current: Option<String> = None;

        walk(orders_document, |event| match event {
            Event::Unit(line) => {
                current = line.arguments.first().map(|id| id.text.to_string());
            }
            Event::Order { line, depth } if depth == Depth::default() => {
                if let (Some(unit_id), Some(steps)) = (
                    current.as_ref(),
                    crate::movement::orders::parse_move(line.text),
                ) {
                    by_unit.insert(unit_id.clone(), steps);
                }
            }
            _ => {}
        });

        Self { by_unit }
    }

    /// The unit's own movement steps, if it wrote any.
    #[must_use]
    pub fn steps_for(&self, unit_id: &str) -> Option<&[MoveStep]> {
        self.by_unit.get(unit_id).map(Vec::as_slice)
    }
}

/// The movement steps a unit travels by: its own, or those of whoever is sailing the fleet it
/// stands in.
///
/// A passenger writes no order and goes where the hull goes - the same rule the units-in-hex
/// preview applies (`orders::effects`, ah-l2i.2), stated once so a second reader cannot answer
/// differently. `None` for a unit with no order of its own that is not aboard a departing fleet.
///
/// The fleet's own order is found by structure, not by asking who the "captain" is: the game has no
/// such role, and the unit that writes `SAIL` is simply one of the units aboard. When more than one
/// unit aboard wrote a movement order, the **last in report order** wins - the same one the
/// preview's `sailing` map is left holding, so the two readers cannot name different destinations
/// for one passenger.
///
/// "Is a fleet" is the same test [`crate::movement::trace::trace_move`] applies before it draws a
/// unit sailing: a hull whose speed can be *priced*, from the server's own stated numbers or from
/// the ruleset. [`crate::movement::mode::parse_fleet_kind`] is not that test - it is syntactic and
/// reads any single-word kind, `Fort` included, as a hull - and using it here would have every
/// garrison follow whoever in the building wrote a MOVE.
#[must_use]
pub fn steps_followed_by<'a>(
    report: &ParsedReport,
    ruleset: &crate::movement::rules::Ruleset,
    ordered: &'a OrderedUnits,
    unit: &ReportUnit,
) -> Option<&'a [MoveStep]> {
    if let Some(own) = ordered.steps_for(&unit.unit_id) {
        return Some(own);
    }

    let structure_id = unit.structure_id.as_deref()?;
    let region = report
        .regions
        .iter()
        .find(|region| region.region_id == unit.region_id)?;
    // A unit in a Fort follows nobody: only a priceable hull carries its occupants away.
    region
        .structures
        .iter()
        .find(|structure| structure.structure_id == structure_id)
        .filter(|structure| crate::movement::mode::fleet_speed(structure, ruleset).is_some())?;

    region
        .units
        .iter()
        .filter(|aboard| {
            aboard.structure_id.as_deref() == Some(structure_id) && aboard.unit_id != unit.unit_id
        })
        .filter_map(|aboard| ordered.steps_for(&aboard.unit_id))
        .next_back()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::ReportCache;
    use crate::movement::orders::MoveStep;

    const TURN_24: &str = atlantis_hud_fixtures::G5_F21_T24.text;
    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    /// Raft [235] in the plain at (36,44) carries Drones (10575), which can sail, and Drones
    /// (10594), which writes nothing.
    fn followed(orders: &str, unit_id: &str) -> Option<Vec<MoveStep>> {
        let mut cache = ReportCache::new();
        let report = cache.classified(TURN_24, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let ordered = OrderedUnits::from_document(orders);
        let unit = report
            .units()
            .find(|unit| unit.unit_id == unit_id)
            .expect("the fixture carries the unit")
            .clone();
        steps_followed_by(&report, &ruleset, &ordered, &unit).map(<[MoveStep]>::to_vec)
    }

    #[test]
    fn a_unit_follows_its_own_order() {
        assert_eq!(
            followed("unit 10575\nsail se\n", "10575"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )])
        );
    }

    #[test]
    fn a_passenger_follows_the_fleet_it_stands_in() {
        assert_eq!(
            followed("unit 10575\nsail se\n", "10594"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "10594 wrote nothing and stands in the raft 10575 is sailing"
        );
    }

    #[test]
    fn a_unit_ashore_follows_nothing() {
        // "* One of Three (1293)" stands in Building [3], and nobody in it wrote anything.
        assert_eq!(followed("unit 10575\nsail se\n", "1293"), None);
    }

    #[test]
    fn a_unit_in_a_building_follows_nothing() {
        // Drones (5983) and Five of Three (775) both stand in Building [2], a Fort. A Fort is not a
        // hull, so an order written by one carries nobody: a garrison is not cargo.
        let orders = "unit 5983\nmove n\n";
        assert_eq!(
            followed(orders, "5983"),
            Some(vec![MoveStep::Go(crate::movement::graph::Direction::North)]),
            "the unit that wrote it still follows it"
        );
        assert_eq!(
            followed(orders, "775"),
            None,
            "a Fort is not a fleet, so its other occupant follows nobody"
        );
    }

    #[test]
    fn the_last_order_aboard_wins() {
        // Both units aboard Raft [235] write a movement order; the passenger question does not
        // arise, but the rule must still name one answer - the last in report order, which is what
        // the preview's map is left holding.
        let orders = "unit 10575\nsail se\nunit 10594\nmove n\n";
        let mut cache = ReportCache::new();
        let report = cache.classified(TURN_24, RULESET);
        let aboard: Vec<String> = report
            .units()
            .filter(|unit| {
                unit.region_id == "1:36,44" && unit.structure_id.as_deref() == Some("235")
            })
            .map(|unit| unit.unit_id.clone())
            .collect();
        assert_eq!(aboard, vec!["10575".to_string(), "10594".to_string()]);
        assert_eq!(
            followed(orders, "10594"),
            Some(vec![MoveStep::Go(crate::movement::graph::Direction::North)]),
            "its own order still wins over the hull's"
        );
    }
}
