//! The one Give-phase transfer record and report order both [`super::effects`] and
//! [`super::semantics`] read.
//!
//! `rules/sequenceofevents` settles GIVE and TAKE together in one Give phase and orders the units
//! inside it: "Where there is no other basis for deciding in which order units will be processed
//! within a phase, units that appear higher on the report get precedence." Both the preview and the
//! economy walk have to obey that, and each held its own copy of the record and the sort
//! (`ah-1zca.4`).

use std::borrow::Cow;

use super::forms::{Amount, Party, Selector};

/// One `GIVE` or `TAKE`, held until the whole document has been read so the Give phase can be
/// settled in report order (`ah-3mwm`).
///
/// The payload is [`Cow`] because the two readers come by it differently and neither should pay for
/// the other: [`super::effects`] parses owned values out of the document's tokens and holds
/// [`Cow::Owned`], while [`super::semantics`] reads settled intents and holds [`Cow::Borrowed`].
/// Nothing is cloned at run time on either side.
pub(crate) struct PendingTransfer<'a> {
    /// The unit whose block the order is in - its position in the walk's own unit list, which is
    /// report order for reported units and, after them, the order the `FORM` blocks created them
    /// in.
    pub(crate) actor: usize,
    /// The document line, the secondary key: report order chooses between actors, and this still
    /// chooses between several transfers one actor wrote.
    pub(crate) line: usize,
    /// The other end. For a `GIVE` this is the receiver; for a `TAKE`, `rules/take` reverses the
    /// direction and it is the source.
    pub(crate) party: Cow<'a, Party>,
    pub(crate) what: Cow<'a, Selector>,
    pub(crate) amount: Cow<'a, Amount>,
    pub(crate) is_give: bool,
}

/// Sorts this hex's queued transfers into the order the Give phase settles them in.
///
/// `actor` is the report order the rules quoted above call for; the line is the secondary key
/// alone, so one actor's own transfers still settle in the order it wrote them. `sort_by_key` is
/// stable, so equal keys - which cannot occur, one order per line - would keep document order
/// anyway.
pub(crate) fn in_report_order(transfers: &mut [PendingTransfer<'_>]) {
    transfers.sort_by_key(|transfer| (transfer.actor, transfer.line));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(actor: usize, line: usize) -> PendingTransfer<'static> {
        PendingTransfer {
            actor,
            line,
            party: Cow::Owned(Party::Unit("1".to_string())),
            what: Cow::Owned(Selector::Item("SILV".to_string())),
            amount: Cow::Owned(Amount::Exact(1)),
            is_give: true,
        }
    }

    #[test]
    fn report_order_puts_the_higher_actor_first() {
        let mut transfers = vec![owned(2, 1), owned(0, 9), owned(1, 4)];
        in_report_order(&mut transfers);
        let actors: Vec<usize> = transfers.iter().map(|transfer| transfer.actor).collect();
        assert_eq!(actors, vec![0, 1, 2]);
    }

    #[test]
    fn one_actors_lines_settle_in_the_order_written() {
        let mut transfers = vec![owned(3, 7), owned(3, 2), owned(3, 5)];
        in_report_order(&mut transfers);
        let lines: Vec<usize> = transfers.iter().map(|transfer| transfer.line).collect();
        assert_eq!(lines, vec![2, 5, 7]);
    }
}
