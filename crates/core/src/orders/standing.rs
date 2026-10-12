//! Where a unit stands once this month's ENTER and LEAVE orders have run.
//!
//! One reader, because there used to be three and they were corrected one at a time over five beads
//! (ah-f03z): ah-mjy fixed this rule twice in one function - the second time only because a
//! navigator verification failed on it - and ah-ssd's own plan copied the rule out of the one file
//! still describing it wrongly. Cross-referencing doc comments was the previous answer, and
//! cross-references are what failed.
//!
//! The three layers that ask hold different things - parsed intents, the raw orders document, and
//! the preview walker's working state - so the seam is the *input*: each supplies the block's
//! boardings in the order they were written, and the rule lives here alone.

use std::collections::{BTreeMap, BTreeSet};

use crate::movement::orders::MoveStep;
use crate::movement::rules::Ruleset;
use crate::report::model::{ReportRegion, SwimCapacity, UnitMovement};
use crate::report::ParsedReport;

/// A unit's ENTER and LEAVE orders, in the order they were written.
///
/// Only orders the game actually has belong here: an ENTER whose argument is not a single number,
/// or a LEAVE with any argument at all, is not an order, and a reader that recorded one would move
/// a unit the server leaves alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Boarding<'a> {
    Enter(&'a str),
    Leave,
}

/// [`Boarding`] for a caller that must keep the block's boardings around rather than borrow them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoardingOrder {
    Enter(String),
    Leave,
}

impl BoardingOrder {
    /// This order as the rule reads it.
    #[must_use]
    pub fn as_boarding(&self) -> Boarding<'_> {
        match self {
            Self::Enter(structure) => Boarding::Enter(structure.as_str()),
            Self::Leave => Boarding::Leave,
        }
    }
}

/// Where the unit ends the month's boarding orders, given where the report found it.
///
/// **Every LEAVE runs before any ENTER**, whatever order the lines were typed in - the engine's own
/// order, confirmed by the navigator on 2026-08-18 after a verification failed on exactly this. So
/// a block holding any ENTER ends inside the last one entered, a block holding only LEAVEs ends in
/// nothing, and a block holding neither stays where the report found it. Document order matters
/// only among ENTERs; between an ENTER and a LEAVE it means nothing.
///
/// Both run before anything else a block can ask for, so every check that asks "what is this unit
/// standing in when its orders happen" wants this rather than the report's own answer, which is
/// only where the unit was found.
///
/// This is where a unit *ends up*. For "could this unit be the one sailing the hull" the question is
/// different, and [`could_captain`] answers it.
pub fn standing_after<'a>(
    reported: Option<&'a str>,
    boardings: impl IntoIterator<Item = Boarding<'a>>,
) -> Option<&'a str> {
    let mut entered: Option<&'a str> = None;
    let mut left = false;
    for boarding in boardings {
        match boarding {
            Boarding::Enter(structure) => entered = Some(structure),
            Boarding::Leave => left = true,
        }
    }
    match (entered, left) {
        // An ENTER always wins: the LEAVE ran first, and the unit walked back in.
        (Some(structure), _) => Some(structure),
        (None, true) => None,
        (None, false) => reported,
    }
}

/// [`standing_after`] in a hex whose structures are known, where `has` says whether the hex has a
/// structure by that number, and `leave_refused` whether the game refuses this unit's LEAVE where
/// it stands ([`leave_refused_at_sea`]).
///
/// An ENTER of a structure the hex does not have is refused, and the refusal moves nothing: the
/// engine's `Do1EnterOrder` finds no object, reports "ENTER: Can't enter that." and returns before
/// `MoveUnit`, so the unit stays where the report found it - not even out of the structure it was
/// in (`ah-5maa`; `newage trident rules/enter`, which only lets a unit into an object that is
/// there to enter). `rules/sequenceofevents` runs ENTER orders before any movement, so a fleet
/// sailing in later that month is not there yet either.
///
/// A refused LEAVE moves nothing either: the same `Do1EnterOrder` reports "LEAVE: Can't leave a
/// ship in the ocean." and returns before `MoveUnit`, so the unit stays aboard (`ah-djst`). An
/// ENTER in the same block still runs.
pub fn standing_after_in<'a>(
    reported: Option<&'a str>,
    boardings: impl IntoIterator<Item = Boarding<'a>>,
    has: impl Fn(&str) -> bool,
    leave_refused: bool,
) -> Option<&'a str> {
    let standing = standing_after(reported, that_run(boardings, leave_refused));
    if refused(reported, standing, has) {
        reported
    } else {
        standing
    }
}

/// Whether the block's boarding orders are refused outright, for the reason
/// [`standing_after_in`] gives: they would end the unit in a structure the hex does not have. A
/// refused block moves the unit nowhere, so it is not walked as a move either (`ah-5maa`).
pub fn enter_refused<'a>(
    reported: Option<&'a str>,
    boardings: impl IntoIterator<Item = Boarding<'a>>,
    has: impl Fn(&str) -> bool,
) -> bool {
    refused(reported, standing_after(reported, boardings), has)
}

/// Whether any of the block's boarding orders moves the unit at all: one that runs, in a block
/// [`enter_refused`] does not refuse. A LEAVE refused at sea is not one (`ah-djst`); an ENTER or
/// LEAVE landing the unit where it started still is, since the engine's `Unit::MoveUnit` always
/// removes and appends.
pub fn boarding_moves<'a>(
    reported: Option<&'a str>,
    boardings: impl IntoIterator<Item = Boarding<'a>>,
    has: impl Fn(&str) -> bool,
    leave_refused: bool,
) -> bool {
    let running: Vec<Boarding<'a>> = that_run(boardings, leave_refused).collect();
    !running.is_empty() && !enter_refused(reported, running, has)
}

/// Whether the game refuses a LEAVE from this unit where it stands.
///
/// `Do1EnterOrder` refuses one in an ocean region when the unit cannot swim **or** won't cross
/// water ("LEAVE: Can't leave a ship in the ocean."; `rules/leave`: "If a unit is capable of
/// swimming or flying then this order is usable to leave a boat while at sea"; `rules/nocross`),
/// and `Unit::CanSwim` also admits a unit that can fly. `rules/sequenceofevents` runs NOCROSS
/// before LEAVE, so `wont_cross_water` is the flag once this month's NOCROSS has run. A unit whose
/// movement nothing states is taken as unable: the engine keeps it aboard unless it can carry its
/// weight swimming or flying, and nothing in hand says it can.
#[must_use]
pub fn leave_refused_at_sea(
    at_sea: bool,
    wont_cross_water: bool,
    movement: Option<&UnitMovement>,
) -> bool {
    if !at_sea {
        return false;
    }
    if wont_cross_water {
        return true;
    }
    let Some(movement) = movement else {
        return true;
    };
    let swims = matches!(
        movement.swim,
        SwimCapacity::Stated { capacity } if capacity > 0 && capacity >= movement.load
    );
    let flies = movement.fly > 0 && movement.fly >= movement.load;
    !(swims || flies)
}

/// What the standing rule knows about one hex, read once from the report and the ruleset.
///
/// The one place a per-hex fact the rule needs is gathered (`ah-6udn`): ah-5maa needed the hex's
/// structures and ah-djst whether it is water, and each was threaded by hand through all three
/// readers of where a unit stands. Each reader now holds this value and supplies only what is its
/// own - the unit's boardings, and its [`Leaver`] - so the next fact is a field here, read in
/// [`Self::of`] and used by the methods below, and no reader changes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HexStanding {
    /// Every structure number the report shows in the hex; `None` for a hex the report does not
    /// describe, where every ENTER is taken as written.
    structures: Option<BTreeSet<String>>,
    /// Whether the hex's terrain is water in this world, where a LEAVE can be refused
    /// ([`leave_refused_at_sea`]). `false` without a ruleset to say so: then every LEAVE runs.
    water: bool,
}

/// What the unit itself brings to whether its LEAVE runs where it stands
/// ([`leave_refused_at_sea`]).
#[derive(Debug, Clone, Copy)]
pub struct Leaver<'a> {
    /// The unit's NOCROSS flag once this month's NOCROSS orders have run: `rules/sequenceofevents`
    /// runs NOCROSS before LEAVE.
    pub wont_cross_water: bool,
    /// The movement the report states for the unit; `None` when nothing states it.
    pub movement: Option<&'a UnitMovement>,
}

impl HexStanding {
    /// A hex the report does not describe: every ENTER is taken as written, and no LEAVE refused.
    pub const UNDESCRIBED: HexStanding = HexStanding {
        structures: None,
        water: false,
    };

    /// What the rule knows about `region`, with `ruleset` to say whether its terrain is water.
    #[must_use]
    pub fn of(region: &ReportRegion, ruleset: Option<&Ruleset>) -> Self {
        Self {
            structures: Some(
                region
                    .structures
                    .iter()
                    .map(|structure| structure.structure_id.clone())
                    .collect(),
            ),
            water: ruleset.is_some_and(|rules| rules.is_water(&region.terrain)),
        }
    }

    fn has(&self, structure: &str) -> bool {
        self.structures
            .as_ref()
            .is_none_or(|known| known.contains(structure))
    }

    /// Whether the game refuses this unit's LEAVE in this hex ([`leave_refused_at_sea`]).
    #[must_use]
    pub fn leave_refused(&self, leaver: Leaver<'_>) -> bool {
        leave_refused_at_sea(self.water, leaver.wont_cross_water, leaver.movement)
    }

    /// [`standing_after_in`] in this hex.
    pub fn standing_after<'a>(
        &self,
        reported: Option<&'a str>,
        boardings: impl IntoIterator<Item = Boarding<'a>>,
        leaver: Leaver<'_>,
    ) -> Option<&'a str> {
        standing_after_in(
            reported,
            boardings,
            |structure| self.has(structure),
            self.leave_refused(leaver),
        )
    }

    /// [`enter_refused`] in this hex.
    pub fn enter_refused<'a>(
        &self,
        reported: Option<&'a str>,
        boardings: impl IntoIterator<Item = Boarding<'a>>,
    ) -> bool {
        enter_refused(reported, boardings, |structure| self.has(structure))
    }

    /// [`boarding_moves`] in this hex.
    pub fn boarding_moves<'a>(
        &self,
        reported: Option<&'a str>,
        boardings: impl IntoIterator<Item = Boarding<'a>>,
        leaver: Leaver<'_>,
    ) -> bool {
        boarding_moves(
            reported,
            boardings,
            |structure| self.has(structure),
            self.leave_refused(leaver),
        )
    }
}

/// Every region's [`HexStanding`], read once from the report, keyed by region id.
#[derive(Debug, Clone, Default)]
pub struct HexStandings(BTreeMap<String, HexStanding>);

impl HexStandings {
    /// Every region the report shows, with `ruleset` to say which are water.
    #[must_use]
    pub fn of(report: &ParsedReport, ruleset: Option<&Ruleset>) -> Self {
        Self(
            report
                .regions
                .iter()
                .map(|region| (region.region_id.clone(), HexStanding::of(region, ruleset)))
                .collect(),
        )
    }

    /// The hex a unit in `region_id` stands in; [`HexStanding::UNDESCRIBED`] for a region the
    /// report does not show.
    #[must_use]
    pub fn of_region(&self, region_id: &str) -> &HexStanding {
        self.0.get(region_id).unwrap_or(&HexStanding::UNDESCRIBED)
    }
}

/// The block's boardings less any LEAVE the game refuses.
fn that_run<'a>(
    boardings: impl IntoIterator<Item = Boarding<'a>>,
    leave_refused: bool,
) -> impl Iterator<Item = Boarding<'a>> {
    boardings
        .into_iter()
        .filter(move |boarding| !(leave_refused && *boarding == Boarding::Leave))
}

fn refused(reported: Option<&str>, standing: Option<&str>, has: impl Fn(&str) -> bool) -> bool {
    standing.is_some_and(|structure| Some(structure) != reported && !has(structure))
}

/// Whether this unit could be the one giving `structure_id` its SAIL order: standing in it per the
/// report, or boarding it this month.
///
/// Deliberately *not* `standing_after(..) == Some(structure_id)`, and it lives here so the
/// difference is read as a pair rather than discovered. A unit that also LEAVEs is not excluded:
/// it still wrote a SAIL for this hull, and the checks that judge a written SAIL - the crew it
/// lends, a course only the owner may set - must see it. Where the hull actually goes is a
/// different question, answered by who is aboard when it moves: every LEAVE that runs does so
/// before movement (`Game::RunEnterOrders` ahead of `RunMovementOrders`), so a captain that leaves
/// carries nobody - unless the LEAVE is refused at sea, where it keeps its hull
/// ([`leave_refused_at_sea`], applied by `movement::fleet::OrderedUnits::structure_of`; `ah-877p`,
/// `ah-djst`).
pub fn could_captain<'a>(
    reported: Option<&str>,
    structure_id: &str,
    boardings: impl IntoIterator<Item = Boarding<'a>>,
) -> bool {
    reported == Some(structure_id)
        || boardings
            .into_iter()
            .any(|boarding| boarding == Boarding::Enter(structure_id))
}

/// Where a movement order leaves a unit on each side of the hex it started the month in.
///
/// A MOVE's boardings are composed *on top of* the ENTER/LEAVE answer rather than mixed into it:
/// `rules/sequenceofevents` runs "LEAVE orders", then "ENTER orders", and only much later
/// "ADVANCE, MOVE and SAIL orders are processed phase by phase".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoveStanding {
    /// The structure it is standing in while still in its starting hex.
    pub origin: Option<String>,
    /// The step that last set `origin`, when a step of this order set it; `None` when the order
    /// left the starting hex's answer alone.
    pub origin_cause: Option<MoveStep>,
    /// The structure it is standing in when the order ends, in whatever hex that is.
    pub destination: Option<String>,
    /// The step that last set `destination`. `None` means nothing entered or left anything after
    /// the unit crossed out of its starting hex - it is simply outdoors where it arrived.
    pub destination_cause: Option<MoveStep>,
}

/// Folds a movement order's steps over the answer the ENTER and LEAVE orders already gave.
///
/// `Go` and `In` both cross out of the region the unit was standing in - a hex boundary for the
/// first, and for the second "an inner passage in the structure that the unit is currently in"
/// (`rules/move`, 4) - so both fix the starting hex's answer and then clear it.
#[must_use]
pub fn standing_through_move(before: Option<&str>, steps: &[MoveStep]) -> MoveStanding {
    let mut current = before.map(str::to_string);
    let mut cause: Option<MoveStep> = None;
    let mut origin: Option<(Option<String>, Option<MoveStep>)> = None;

    for step in steps {
        match step {
            MoveStep::Out => {
                current = None;
                cause = Some(MoveStep::Out);
            }
            MoveStep::Enter(id) => {
                current = Some(id.clone());
                cause = Some(step.clone());
            }
            MoveStep::Go(_) | MoveStep::In => {
                if origin.is_none() {
                    origin = Some((current.clone(), cause.clone()));
                }
                current = None;
                cause = None;
            }
        }
    }

    let (origin, origin_cause) = origin.unwrap_or_else(|| (current.clone(), cause.clone()));
    MoveStanding {
        origin,
        origin_cause,
        destination: current,
        destination_cause: cause,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boardings<'a>(orders: &[Boarding<'a>]) -> Vec<Boarding<'a>> {
        orders.to_vec()
    }

    #[test]
    fn an_enter_wins_over_a_leave_typed_after_it() {
        assert_eq!(
            standing_after(None, boardings(&[Boarding::Enter("5"), Boarding::Leave])),
            Some("5")
        );
    }

    #[test]
    fn an_enter_wins_over_a_leave_typed_before_it() {
        assert_eq!(
            standing_after(None, boardings(&[Boarding::Leave, Boarding::Enter("5")])),
            Some("5")
        );
    }

    #[test]
    fn a_leave_alone_ends_in_nothing() {
        assert_eq!(
            standing_after(Some("4"), boardings(&[Boarding::Leave])),
            None
        );
    }

    #[test]
    fn the_last_enter_wins() {
        assert_eq!(
            standing_after(
                None,
                boardings(&[Boarding::Enter("4"), Boarding::Enter("5")])
            ),
            Some("5")
        );
    }

    #[test]
    fn a_leave_either_side_of_an_enter_still_ends_inside() {
        assert_eq!(
            standing_after(
                Some("9"),
                boardings(&[Boarding::Leave, Boarding::Enter("4"), Boarding::Leave])
            ),
            Some("4")
        );
    }

    #[test]
    fn no_boarding_orders_leaves_the_reports_answer() {
        assert_eq!(standing_after(Some("4"), boardings(&[])), Some("4"));
        assert_eq!(standing_after(None, boardings(&[])), None);
    }

    #[test]
    fn could_captain_says_yes_where_standing_after_says_nothing() {
        // The divergence that matters: a unit reported aboard 4 that writes LEAVE ends the month
        // ashore, and could still be the one that sailed 4 - the server reads its SAIL line before
        // running the LEAVE. Collapsing could_captain into `standing_after(..) == Some(id)` would
        // strand every passenger aboard.
        let ashore = [Boarding::Leave];
        assert_eq!(standing_after(Some("4"), boardings(&ashore)), None);
        assert!(could_captain(Some("4"), "4", boardings(&ashore)));

        // A unit that boards 4 and then writes LEAVE is aboard by both answers, since every LEAVE
        // runs before any ENTER.
        let block = [Boarding::Enter("4"), Boarding::Leave];
        assert_eq!(standing_after(None, boardings(&block)), Some("4"));
        assert!(could_captain(None, "4", boardings(&block)));
    }

    #[test]
    fn could_captain_is_false_for_a_structure_neither_reported_nor_entered() {
        assert!(!could_captain(
            Some("9"),
            "4",
            boardings(&[Boarding::Enter("5")])
        ));
    }
}

#[cfg(test)]
mod move_tests {
    use super::*;
    use crate::movement::graph::Direction;

    #[test]
    fn a_move_out_leaves_the_structure_in_the_starting_hex() {
        let standing = standing_through_move(Some("12"), &[MoveStep::Out]);

        assert_eq!(standing.origin, None);
        assert_eq!(standing.origin_cause, Some(MoveStep::Out));
        assert_eq!(standing.destination, None);
        assert_eq!(standing.destination_cause, Some(MoveStep::Out));
    }

    #[test]
    fn a_move_into_a_number_enters_it_before_the_unit_walks() {
        let standing = standing_through_move(
            None,
            &[
                MoveStep::Enter("12".to_string()),
                MoveStep::Go(Direction::North),
            ],
        );

        assert_eq!(standing.origin.as_deref(), Some("12"));
        assert_eq!(
            standing.origin_cause,
            Some(MoveStep::Enter("12".to_string()))
        );
        assert_eq!(standing.destination, None);
        assert_eq!(standing.destination_cause, None);
    }

    #[test]
    fn a_structure_entered_after_a_step_belongs_to_the_hex_it_arrives_in() {
        let standing = standing_through_move(
            None,
            &[
                MoveStep::Go(Direction::North),
                MoveStep::Enter("12".to_string()),
            ],
        );

        assert_eq!(standing.origin, None);
        assert_eq!(standing.origin_cause, None);
        assert_eq!(standing.destination.as_deref(), Some("12"));
        assert_eq!(
            standing.destination_cause,
            Some(MoveStep::Enter("12".to_string()))
        );
    }

    #[test]
    fn crossing_a_hex_boundary_takes_the_unit_out_of_its_building() {
        let standing = standing_through_move(Some("12"), &[MoveStep::Go(Direction::North)]);

        assert_eq!(standing.origin.as_deref(), Some("12"));
        assert_eq!(standing.origin_cause, None);
        assert_eq!(standing.destination, None);
        assert_eq!(standing.destination_cause, None);
    }

    #[test]
    fn an_inner_passage_counts_as_leaving_the_hex() {
        let standing = standing_through_move(Some("12"), &[MoveStep::In]);

        assert_eq!(standing.origin.as_deref(), Some("12"));
        assert_eq!(standing.origin_cause, None);
        assert_eq!(standing.destination, None);
        assert_eq!(standing.destination_cause, None);
    }

    fn movement(fly: i64, swim: SwimCapacity, load: i64) -> UnitMovement {
        UnitMovement {
            status: crate::report::model::UnitMovementStatus::Walk,
            load,
            fly,
            ride: 0,
            walk: 0,
            capacity_mode: crate::report::model::UnitMovementMode::Walk,
            swim,
        }
    }

    /// `rules/leave`: a unit "capable of swimming or flying" may leave a boat at sea; the engine's
    /// `Do1EnterOrder` also refuses one that won't cross water (`rules/nocross`), and one whose
    /// movement nothing states is taken as unable (`ah-djst`).
    #[test]
    fn a_leave_is_refused_at_sea_unless_the_unit_can_swim_or_fly_and_will_cross_water() {
        let walker = movement(0, SwimCapacity::Stated { capacity: 0 }, 50);
        let swimmer = movement(0, SwimCapacity::Stated { capacity: 60 }, 50);
        let flier = movement(70, SwimCapacity::Absent, 50);
        let overloaded = movement(0, SwimCapacity::Stated { capacity: 40 }, 50);

        assert!(
            !leave_refused_at_sea(false, true, None),
            "ashore nothing refuses it"
        );
        assert!(leave_refused_at_sea(true, false, Some(&walker)));
        assert!(leave_refused_at_sea(true, false, Some(&overloaded)));
        assert!(leave_refused_at_sea(true, false, None));
        assert!(!leave_refused_at_sea(true, false, Some(&swimmer)));
        assert!(!leave_refused_at_sea(true, false, Some(&flier)));
        assert!(leave_refused_at_sea(true, true, Some(&swimmer)));
    }

    #[test]
    fn a_refused_leave_keeps_the_unit_where_it_stood_and_moves_nobody() {
        let has = |_: &str| true;
        assert_eq!(
            standing_after_in(Some("4"), [Boarding::Leave], has, true),
            Some("4")
        );
        assert!(!boarding_moves(Some("4"), [Boarding::Leave], has, true));
        assert_eq!(
            standing_after_in(Some("4"), [Boarding::Leave], has, false),
            None
        );
        assert!(boarding_moves(Some("4"), [Boarding::Leave], has, false));
    }

    /// The refusal is the LEAVE's alone: an ENTER in the same block still runs.
    #[test]
    fn an_enter_beside_a_refused_leave_still_runs() {
        let has = |_: &str| true;
        let block = [Boarding::Leave, Boarding::Enter("5")];
        assert_eq!(standing_after_in(Some("4"), block, has, true), Some("5"));
        assert!(boarding_moves(Some("4"), block, has, true));
    }
}

#[cfg(test)]
mod hex_tests {
    use super::*;
    use crate::movement::rules::Ruleset;
    use crate::report::model::{ReportRegion, Structure, UnitMovementMode, UnitMovementStatus};
    use crate::report::ParsedReport;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON).expect("the ruleset loads")
    }

    fn region(region_id: &str, terrain: &str, structures: &[&str]) -> ReportRegion {
        ReportRegion {
            region_id: region_id.to_string(),
            terrain: terrain.to_string(),
            structures: structures
                .iter()
                .map(|id| Structure {
                    structure_id: (*id).to_string(),
                    ..Structure::default()
                })
                .collect(),
            ..ReportRegion::default()
        }
    }

    const WALKER: Leaver<'static> = Leaver {
        wont_cross_water: false,
        movement: None,
    };

    #[test]
    fn hex_standing_reads_structures_and_water_from_the_region() {
        let rules = ruleset();
        let sea = HexStanding::of(&region("1", "ocean", &["4"]), Some(&rules));
        let land = HexStanding::of(&region("2", "plain", &["4"]), Some(&rules));

        // An ENTER of a structure the hex does not have moves nobody (`ah-5maa`).
        assert_eq!(sea.standing_after(None, [Boarding::Enter("77")], WALKER), None);
        assert_eq!(
            land.standing_after(None, [Boarding::Enter("4")], WALKER),
            Some("4")
        );
        assert!(sea.enter_refused(None, [Boarding::Enter("77")]));
        // A LEAVE at sea is refused for a unit nothing shows can swim or fly (`ah-djst`).
        assert_eq!(
            sea.standing_after(Some("4"), [Boarding::Leave], WALKER),
            Some("4")
        );
        assert!(!sea.boarding_moves(Some("4"), [Boarding::Leave], WALKER));
        assert_eq!(land.standing_after(Some("4"), [Boarding::Leave], WALKER), None);
        assert!(land.boarding_moves(Some("4"), [Boarding::Leave], WALKER));
    }

    #[test]
    fn without_a_ruleset_no_hex_is_known_to_be_water() {
        let sea = HexStanding::of(&region("1", "ocean", &["4"]), None);
        assert!(!sea.leave_refused(WALKER));
    }

    #[test]
    fn a_hex_refuses_a_leave_only_to_a_unit_that_cannot_swim_fly_or_will_not_cross() {
        let sea = HexStanding::of(&region("1", "ocean", &[]), Some(&ruleset()));
        let flier = UnitMovement {
            status: UnitMovementStatus::Walk,
            load: 10,
            fly: 20,
            ride: 0,
            walk: 0,
            capacity_mode: UnitMovementMode::Walk,
            swim: SwimCapacity::Absent,
        };
        let flies = Leaver {
            wont_cross_water: false,
            movement: Some(&flier),
        };
        assert!(sea.leave_refused(WALKER));
        assert!(!sea.leave_refused(flies));
        assert!(sea.leave_refused(Leaver {
            wont_cross_water: true,
            ..flies
        }));
    }

    #[test]
    fn an_undescribed_region_takes_every_enter_as_written_and_refuses_no_leave() {
        let report = ParsedReport {
            regions: vec![region("1", "ocean", &["4"])],
            ..ParsedReport::default()
        };
        let hexes = HexStandings::of(&report, Some(&ruleset()));

        assert!(hexes.of_region("1").leave_refused(WALKER));
        let elsewhere = hexes.of_region("not in the report");
        assert_eq!(elsewhere, &HexStanding::UNDESCRIBED);
        assert_eq!(
            elsewhere.standing_after(None, [Boarding::Enter("77")], WALKER),
            Some("77")
        );
        assert!(!elsewhere.leave_refused(WALKER));
    }
}
