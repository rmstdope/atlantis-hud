//! The `FORM`-block bookkeeping every reader of an orders document repeats.
//!
//! Three readers walk one orders document and must agree on which unit each order line belongs to:
//! the preview ledger's [`super::effects::Working`], the intent reader's
//! [`super::intents::FormReader`] and the movement tracer's
//! [`crate::movement::fleet::OrderedUnits`]. Each used to carry its own copy of the nesting rules,
//! and they drifted five times. The rules live here once instead.
//!
//! [`FormStack`] is generic over the reader's own handle for a formed unit, because the three
//! readers name one differently on purpose - per `(region, alias)` in the preview, globally as
//! `new-<alias>` on the map. Passing `None` to [`FormStack::open`] is how a reader says "I could
//! not take this `FORM` up", so both the unreadable-alias case and the taken-alias case stay each
//! reader's own decision while the nesting rules stay here.

/// Who an order line at this month's depth belongs to.
#[derive(Debug, PartialEq, Eq)]
pub enum Owner<'a, T> {
    /// No `FORM` is open: the order is the enclosing `unit` block's own, and whose that is stays
    /// the reader's business.
    Block,
    /// The innermost open `FORM`'s unit, as this reader names it.
    Formed(&'a T),
    /// Inside a `FORM` this reader could not take up. The order changes nothing, and must not fall
    /// through to the block outside it.
    Nobody,
}

/// The `FORM` blocks open at this point in the document, innermost last.
#[derive(Debug)]
pub struct FormStack<T> {
    open: Vec<Option<T>>,
}

// Written by hand rather than derived: `#[derive(Default)]` on a generic struct adds a
// `T: Default` bound that none of the callers need.
impl<T> Default for FormStack<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> FormStack<T> {
    /// A walk that has opened no `FORM` yet.
    #[must_use]
    pub fn new() -> Self {
        Self { open: Vec::new() }
    }

    /// A `unit` line or a `#` directive: the walk has abandoned every open block.
    pub fn reset(&mut self) {
        self.open.clear();
    }

    /// A `FORM` at this month's depth. `unit` is this reader's own handle for the unit it creates,
    /// or `None` for a `FORM` this reader could not take up.
    pub fn open(&mut self, unit: Option<T>) {
        self.open.push(unit);
    }

    /// An `END` closing a `FORM` at this month's depth. Closing with nothing open changes nothing.
    pub fn close(&mut self) {
        self.open.pop();
    }

    /// Who the next order belongs to.
    #[must_use]
    pub fn owner(&self) -> Owner<'_, T> {
        match self.open.last() {
            None => Owner::Block,
            Some(Some(unit)) => Owner::Formed(unit),
            Some(None) => Owner::Nobody,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FormStack, Owner};

    #[test]
    fn an_unreadable_form_swallows_its_orders_rather_than_letting_them_fall_through() {
        let mut stack = FormStack::<&str>::new();
        stack.open(None);
        assert_eq!(stack.owner(), Owner::Nobody);
        stack.close();
        assert_eq!(stack.owner(), Owner::Block);
    }

    #[test]
    fn the_innermost_open_form_owns_the_order() {
        let mut stack = FormStack::new();
        stack.open(Some("new-1"));
        stack.open(Some("new-2"));
        assert_eq!(stack.owner(), Owner::Formed(&"new-2"));
        stack.close();
        assert_eq!(stack.owner(), Owner::Formed(&"new-1"));
    }

    #[test]
    fn a_unit_line_abandons_every_open_form() {
        let mut stack = FormStack::new();
        stack.open(Some("new-1"));
        stack.open(Some("new-2"));
        stack.reset();
        assert_eq!(stack.owner(), Owner::Block);
    }

    #[test]
    fn closing_with_nothing_open_changes_nothing() {
        let mut stack = FormStack::<&str>::new();
        stack.close();
        assert_eq!(stack.owner(), Owner::Block);
    }

    #[test]
    fn a_form_inside_an_unreadable_one_still_owns_its_own_orders() {
        let mut stack = FormStack::new();
        stack.open(None);
        stack.open(Some("new-2"));
        assert_eq!(stack.owner(), Owner::Formed(&"new-2"));
    }
}
