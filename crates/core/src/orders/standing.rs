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

use crate::movement::orders::MoveStep;

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

/// Whether this unit could be the one giving `structure_id` its SAIL order: standing in it per the
/// report, or boarding it this month.
///
/// Deliberately *not* `standing_after(..) == Some(structure_id)`, and it lives here so the
/// difference is read as a pair rather than discovered. A unit that also LEAVEs is not excluded:
/// the server would still read its SAIL line before running the LEAVE, and asking where the captain
/// *ends up* would quietly strand every passenger aboard.
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
}
