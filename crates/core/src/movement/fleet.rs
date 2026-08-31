//! Which movement order a unit actually travels by.
//!
//! A unit standing aboard a ship writes no order of its own: the unit sailing the hull writes
//! `SAIL`, and everyone aboard goes with it. Every reader that wants to know where a unit ends the
//! month therefore has the same two-part question to answer, and this module answers it once so a
//! second reader cannot answer it differently - which is exactly the disagreement ah-p1p, ah-l2i
//! and ah-048 were each filed for.

use std::collections::{BTreeMap, BTreeSet};

use crate::movement::orders::MoveStep;
use crate::orders::standing::{self, standing_after, Boarding, BoardingOrder};
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
    sailers: BTreeSet<String>,
    /// Each unit's ENTER and LEAVE orders, in the order they were written. A unit that wrote
    /// neither is absent, and the report's own answer stands for it.
    ///
    /// The orders themselves are kept rather than the answer, because two different questions are
    /// asked of them - see [`crate::orders::standing`], which holds both and says why they differ.
    boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>>,
}

impl OrderedUnits {
    /// Reads every unit's block out of one orders document.
    #[must_use]
    pub fn from_document(orders_document: &str) -> Self {
        use crate::orders::walk::{walk, Depth, Event};

        let mut by_unit: BTreeMap<String, Vec<MoveStep>> = BTreeMap::new();
        let mut boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>> = BTreeMap::new();
        let mut sailers = BTreeSet::new();
        let mut current: Option<String> = None;

        walk(orders_document, |event| match event {
            Event::Unit(line) => {
                current = line.arguments.first().map(|id| id.text.to_string());
            }
            Event::Order { line, depth } if depth == Depth::default() => {
                if let (Some(unit_id), Some(steps)) = (
                    current.as_ref(),
                    crate::movement::orders::parse_move(
                        &std::iter::once(line.command.text.as_str())
                            .chain(line.arguments.iter().map(|token| token.text.as_str()))
                            .collect::<Vec<_>>()
                            .join(" "),
                    ),
                ) {
                    by_unit.insert(unit_id.clone(), steps);
                }
                if let Some(unit_id) = current.as_ref() {
                    if line.command.is("sail")
                        && (line.arguments.is_empty()
                            || crate::movement::orders::parse_move(
                                &std::iter::once(line.command.text.as_str())
                                    .chain(line.arguments.iter().map(|token| token.text.as_str()))
                                    .collect::<Vec<_>>()
                                    .join(" "),
                            )
                            .is_some())
                    {
                        sailers.insert(unit_id.clone());
                    }
                    // Read exactly as `orders::intents` reads them, through the same
                    // `read_only_number`: an ENTER with anything but one numeric argument, or a
                    // LEAVE with any argument at all, is an order the game does not have, and a
                    // reader that acted on it would move a unit the server leaves alone. What the
                    // orders then mean is `orders::standing`'s to say, not this walk's.
                    if line.command.is("enter") {
                        if let Some(structure) =
                            crate::orders::forms::read_only_number(line.arguments)
                        {
                            boardings_by_unit
                                .entry(unit_id.clone())
                                .or_default()
                                .push(BoardingOrder::Enter(structure.to_string()));
                        }
                    } else if line.command.is("leave") && line.arguments.is_empty() {
                        boardings_by_unit
                            .entry(unit_id.clone())
                            .or_default()
                            .push(BoardingOrder::Leave);
                    }
                }
            }
            _ => {}
        });

        Self {
            by_unit,
            sailers,
            boardings_by_unit,
        }
    }

    /// The unit's own movement steps, if it wrote any.
    #[must_use]
    pub fn steps_for(&self, unit_id: &str) -> Option<&[MoveStep]> {
        self.by_unit.get(unit_id).map(Vec::as_slice)
    }

    #[must_use]
    pub(crate) fn issues_sail(&self, unit_id: &str) -> bool {
        self.sailers.contains(unit_id)
    }

    /// The structure this unit is in once this month's ENTER/LEAVE orders have run.
    ///
    /// ENTER and LEAVE both run before anything moves, so every reader that asks "what is this
    /// unit standing in when its orders happen" wants this rather than `unit.structure_id`, which
    /// is only where the report found it. The rule is [`crate::orders::standing::standing_after`]'s
    /// and is stated only there; this is the adapter that reads it out of an orders document.
    ///
    /// This is where a unit *ends up*. For "could this unit be the one sailing the hull" the
    /// question is different and [`Self::could_captain`] answers it.
    #[must_use]
    pub fn structure_of<'a>(&'a self, unit: &'a ReportUnit) -> Option<&'a str> {
        standing_after(
            unit.structure_id.as_deref(),
            self.boardings_of(&unit.unit_id),
        )
    }

    /// One unit's boardings as the rule reads them.
    fn boardings_of(&self, unit_id: &str) -> impl Iterator<Item = Boarding<'_>> + '_ {
        self.boardings_by_unit
            .get(unit_id)
            .into_iter()
            .flatten()
            .map(BoardingOrder::as_boarding)
    }
}

impl OrderedUnits {
    /// Whether this unit could be the one giving the hull's movement order: standing in it per the
    /// report, or boarding it this month.
    ///
    /// Deliberately not [`Self::structure_of`], for the reason
    /// [`crate::orders::standing::could_captain`] gives, which is where the rule lives.
    #[must_use]
    pub fn could_captain(&self, unit: &ReportUnit, structure_id: &str) -> bool {
        standing::could_captain(
            unit.structure_id.as_deref(),
            structure_id,
            self.boardings_of(&unit.unit_id),
        )
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
/// the ruleset. [`crate::movement::mode::hulls_named_in`] is not that test - it is syntactic and
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

    let structure_id = ordered.structure_of(unit)?;
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
            ordered.could_captain(aboard, structure_id) && aboard.unit_id != unit.unit_id
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

    fn structure_after(orders: &str, unit_id: &str) -> Option<String> {
        let mut cache = ReportCache::new();
        let report = cache.classified(TURN_24, RULESET);
        let ordered = OrderedUnits::from_document(orders);
        let unit = report
            .units()
            .find(|unit| unit.unit_id == unit_id)
            .expect("the fixture carries the unit")
            .clone();
        ordered.structure_of(&unit).map(str::to_string)
    }

    #[test]
    fn a_unit_that_enters_this_month_is_in_the_structure_it_entered() {
        // Drones (1297) stands ashore in the report's own answer.
        assert_eq!(structure_after("", "1297"), None, "ashore in the report");
        assert_eq!(
            structure_after("unit 1297\nENTER 235\n", "1297"),
            Some("235".to_string())
        );
    }

    #[test]
    fn a_unit_that_leaves_this_month_is_in_nothing() {
        assert_eq!(structure_after("unit 10594\nLEAVE\n", "10594"), None);
    }

    #[test]
    fn a_unit_that_wrote_neither_keeps_the_reports_answer() {
        assert_eq!(
            structure_after("unit 10594\nwork\n", "10594"),
            Some("235".to_string()),
            "the report's own answer stands for a unit that wrote no ENTER or LEAVE"
        );
    }

    /// Every LEAVE runs before any ENTER, so an ENTER in the block wins whichever way round they
    /// were typed - the rule `orders::semantics::structure_after_orders` states, confirmed by the
    /// navigator on 2026-08-18 after a verification failed on exactly it (ah-mjy). Among ENTERs
    /// the last one wins, which is document order.
    #[test]
    fn an_enter_wins_over_a_leave_in_the_same_block() {
        assert_eq!(
            structure_after("unit 1297\nENTER 235\nLEAVE\n", "1297"),
            Some("235".to_string()),
            "the LEAVE ran first and the unit walked back in"
        );
        assert_eq!(
            structure_after("unit 10594\nLEAVE\nENTER 235\n", "10594"),
            Some("235".to_string())
        );
    }

    #[test]
    fn the_last_of_several_enters_wins() {
        assert_eq!(
            structure_after("unit 1297\nENTER 3\nENTER 235\n", "1297"),
            Some("235".to_string())
        );
    }

    #[test]
    fn an_enter_inside_a_turn_block_is_next_months_business() {
        assert_eq!(
            structure_after("unit 1297\nTURN\nENTER 235\nENDTURN\n", "1297"),
            None,
            "a TURN block is next month's orders"
        );
    }

    #[test]
    fn a_passenger_that_boards_this_month_follows_the_fleet() {
        assert_eq!(
            followed("unit 10575\nsail se\nunit 1297\nENTER 235\n", "1297"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "1297 boards the raft 10575 is sailing"
        );
    }

    #[test]
    fn a_passenger_that_leaves_this_month_follows_nothing() {
        assert_eq!(
            followed("unit 10575\nsail se\nunit 10594\nLEAVE\n", "10594"),
            None,
            "10594 steps ashore before the raft goes"
        );
    }

    /// A FORM block's orders belong to the unit being formed, not to the unit whose block holds
    /// it - the same guard movement already relies on.
    #[test]
    fn an_enter_inside_a_form_block_belongs_to_the_formed_unit() {
        assert_eq!(
            structure_after("unit 1297\nFORM 1\nENTER 235\nEND\n", "1297"),
            None,
            "the ENTER is the new unit's, not 1297's"
        );
    }

    /// The game's own parser is case-insensitive, and so is `Token::is`.
    #[test]
    fn the_orders_are_read_whatever_their_case() {
        assert_eq!(
            structure_after("unit 1297\nenter 235\n", "1297"),
            Some("235".to_string())
        );
        assert_eq!(structure_after("unit 10594\nLeAvE\n", "10594"), None);
    }

    /// Read exactly as `orders::intents` reads them: an ENTER with anything but one numeric
    /// argument, or a LEAVE with any argument, is not an order the game has, and moves nobody.
    #[test]
    fn an_unreadable_enter_or_leave_leaves_the_unit_where_the_report_found_it() {
        assert_eq!(structure_after("unit 1297\nENTER 235 X\n", "1297"), None);
        assert_eq!(structure_after("unit 1297\nENTER shed\n", "1297"), None);
        assert_eq!(
            structure_after("unit 10594\nLEAVE 3\n", "10594"),
            Some("235".to_string())
        );
    }

    /// **`ah-8myf`, the failed verification of 2026-08-25.** Frozen Tomb [194] in barren (32,50)
    /// is written `Galley, 40 Galleons, 11 Galleys, 10 Balloons` and states no `MaxSpeed:`, so
    /// whether it is a priceable hull falls to ruleset arithmetic - and the whole clause read as
    /// one hull name matched no item, so only 13401, which wrote the SAIL, was projected as
    /// moving. Everyone else aboard stood still on screen.
    #[test]
    fn a_passenger_on_a_fleet_that_names_its_class_follows_it() {
        let mut cache = ReportCache::new();
        let report = cache.classified(atlantis_hud_fixtures::G7_F95_T72.text, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let ordered = OrderedUnits::from_document("unit 13401\nsail sw\n");
        let passenger = report
            .units()
            .find(|unit| unit.unit_id == "13848")
            .expect("13848 is aboard Frozen Tomb [194]")
            .clone();

        assert_eq!(
            steps_followed_by(&report, &ruleset, &ordered, &passenger),
            Some(&[MoveStep::Go(crate::movement::graph::Direction::Southwest)][..]),
            "13848 wrote nothing and stands in the vessel 13401 is sailing"
        );
    }

    /// A unit that writes SAIL and then LEAVE still gave the order - the server reads the SAIL
    /// line before running the LEAVE - so its passengers must still be carried. Asking where the
    /// captain *ends up* would strand them, which is why `could_captain` is a second predicate.
    #[test]
    fn a_captain_that_also_leaves_still_carries_its_passengers() {
        assert_eq!(
            followed("unit 10575\nsail se\nLEAVE\n", "10594"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )])
        );
    }
}
