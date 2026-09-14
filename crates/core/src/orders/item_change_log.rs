//! Every item a month's orders move on one preview row, and whether any of them moved stock
//! (`ah-z9g8`).

use super::effects::ItemChange;

/// Whether recording a change actually added or removed stock on the row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Stock {
    Moved,
    /// A change that takes nothing away: a `CAST` charged at the ceiling for materials the
    /// mage does not hold (`ah-ofpb.5`).
    Untouched,
}

/// Every item this month's orders move into or out of one row, in the month's order, and
/// whether any of them moved stock.
///
/// **Appended to, never assigned**: each phase's writer adds its own, and the writers run in
/// the month's order - `apply_transfers` first (`ah-rgkk.3.2`'s seam), then
/// `apply_item_effects` with the ledger's already-sorted movements, then `apply_transports`
/// last (`ah-rgkk.3.1`).
#[derive(Debug, Clone, Default)]
pub(super) struct ItemChangeLog {
    changes: Vec<ItemChange>,
    /// Whether any of those changes actually moved stock on this row.
    ///
    /// Never on the wire, and not the same question as "is `changes` non-empty": a `CAST` is
    /// charged its materials at the ceiling whether or not the mage holds them (`ah-ofpb.5`), so a
    /// mage with none of the material records a change that takes nothing away. A row whose every
    /// change is one of those has nothing to show, and `preview_orders_on_map` skips it - the
    /// buy-then-sell month that nets to zero is the case the row is kept for (`ah-rgkk.3.1`).
    moved_stock: bool,
}

impl ItemChangeLog {
    /// Appends one change. `Stock::Moved` raises `moved_stock`; nothing lowers it.
    pub(super) fn record(&mut self, change: ItemChange, stock: Stock) {
        if stock == Stock::Moved {
            self.moved_stock = true;
        }
        self.changes.push(change);
    }

    /// The changes, in the order they were recorded.
    pub(super) fn changes(&self) -> &[ItemChange] {
        &self.changes
    }

    /// Whether any recorded change moved stock.
    pub(super) fn moved_stock(&self) -> bool {
        self.moved_stock
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orders::effects::{ItemChange, ItemChangeCause};

    fn change(cause: ItemChangeCause) -> ItemChange {
        ItemChange {
            tag: "SWOR".to_string(),
            name: "sword".to_string(),
            delta: -1,
            cause,
            line: None,
            unit_price: None,
            other: None,
            is_man: false,
        }
    }

    #[test]
    fn a_change_that_moved_nothing_leaves_the_log_unmoved() {
        let mut log = ItemChangeLog::default();
        log.record(change(ItemChangeCause::CastSpent), Stock::Untouched);
        assert_eq!(log.changes().len(), 1);
        assert!(!log.moved_stock());
    }

    #[test]
    fn one_change_that_moved_stock_marks_the_log_moved() {
        let mut log = ItemChangeLog::default();
        log.record(change(ItemChangeCause::CastSpent), Stock::Untouched);
        log.record(change(ItemChangeCause::CastSpent), Stock::Moved);
        log.record(change(ItemChangeCause::CastSpent), Stock::Untouched);
        assert!(log.moved_stock());
    }

    #[test]
    fn changes_keep_the_order_they_were_recorded_in() {
        let mut log = ItemChangeLog::default();
        for cause in [
            ItemChangeCause::WasGiven,
            ItemChangeCause::Sold,
            ItemChangeCause::TransportedOut,
        ] {
            log.record(change(cause), Stock::Moved);
        }
        let causes: Vec<_> = log.changes().iter().map(|change| change.cause).collect();
        assert_eq!(
            causes,
            [
                ItemChangeCause::WasGiven,
                ItemChangeCause::Sold,
                ItemChangeCause::TransportedOut
            ]
        );
    }
}
