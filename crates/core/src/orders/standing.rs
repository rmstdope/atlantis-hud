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
    fn could_captain_differs_from_standing_after_for_enter_then_leave() {
        // The unit ends the month back outside 4, and could still be the one that sailed it: the
        // server reads the SAIL line before running the LEAVE.
        let block = [Boarding::Enter("4"), Boarding::Leave];
        assert_eq!(standing_after(None, boardings(&block)), Some("4"));
        assert!(could_captain(None, "4", boardings(&block)));

        let ashore = [Boarding::Leave];
        assert_eq!(standing_after(Some("4"), boardings(&ashore)), None);
        assert!(could_captain(Some("4"), "4", boardings(&ashore)));
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
