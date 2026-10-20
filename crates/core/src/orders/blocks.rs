//! The `FORM`-block bookkeeping every reader of an orders document repeats.
//!
//! Three readers walk one orders document and must agree on which unit each order line belongs to:
//! the preview ledger's [`super::effects::Working`], the intent reader's
//! [`super::intents::FormReader`] and the movement tracer's
//! [`crate::movement::fleet::OrderedUnits`]. Each used to carry its own copy of the nesting rules,
//! and they drifted five times. The rules live here once instead.
//!
//! What a `FORM` creates is decided here once too. [`FormBlocks`] rides each reader's walk and
//! records every formed unit as a [`FormedUnit`]: its alias, its former, its hex, the flag orders
//! it inherits and its NOCROSS. Each of the three readers used to build that record itself, and one
//! rule about it had to be written and fixed in all three (`ah-e529`, `ah-78rd`, `ah-0vc6`). The
//! readers take the record and the [`Owner`] of each order from it, and it is the one place they
//! read a flag line.
//!
//! [`FormStack`] holds only the nesting: `None` is how [`FormBlocks`] says it could not take a
//! `FORM` up.

use super::walk::Event;
use crate::movement::rules::Ruleset;
use crate::report::flags::FlagChange;

/// The unit a block of an orders document speaks for: one the report shows, by its number, or one
/// this month's `FORM` creates, by the 1-based line of that `FORM`.
///
/// The line rather than `new-<alias>`: an alias is unique only inside its hex (`rules/form`), and
/// the document readers see no regions. One type for both, so a per-unit map or set holds both in
/// one field and a rule written over it reaches a formed unit without a second change - before it,
/// every such rule was written for shown units first and for formed ones in a later fix
/// (`ah-0x6x` then `ah-r3rv`; `ah-74y9`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum OrderedUnitKey {
    /// A unit the report shows, by its unit number.
    Shown(String),
    /// A unit this month's `FORM` creates, by the 1-based line of that `FORM`.
    Formed(usize),
}

impl OrderedUnitKey {
    /// The key of a unit the report shows.
    #[must_use]
    pub fn shown(unit_id: &str) -> Self {
        Self::Shown(unit_id.to_string())
    }
}

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

/// What one `FORM` creates, recorded once by [`FormBlocks`] for every reader of the document.
///
/// Before it the preview, the intent reader and the movement reader each built their own record
/// of a formed unit, and a rule about one - the alias, the inherited flags - had to be written and
/// fixed in all three (`ah-e529`, `ah-78rd`, `ah-0vc6`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormedUnit {
    /// The 1-based line of the `FORM`.
    pub form_line: usize,
    /// The `NEW n` alias, as the orders write it - `1` in `FORM 1` ([`super::forms::read_alias`]).
    pub alias: String,
    /// The unit whose orders the `FORM` line sits among: the block's own unit, or the formed unit
    /// of the `FORM` it is nested in.
    pub former: OrderedUnitKey,
    /// The `unit` whose block the outermost `FORM` stands in: a nested `FORM`'s former stands in
    /// the same hex and the same object, so whatever the report says of where, it says of this one.
    pub block_unit: String,
    /// The hex whose alias numbering this `FORM` belongs to (`rules/form`), or `None` for a reader
    /// that knows no hexes ([`Hexes::Unknown`]).
    pub region_id: Option<String>,
    /// The flag orders the former wrote above the `FORM` line, in the order written, to be applied
    /// over the former's starting flags: the report's for a shown unit, the set it was formed with
    /// for a formed one. The engine applies a flag order as it parses it and a `FORM` copies its
    /// former's flags at that moment (`Game::ProcessFormOrder`, `Unit::CopyFlags`; `ah-78rd`).
    pub inherited_flag_changes: Vec<FlagChange>,
    /// The flag orders written inside this `FORM` block. An inner `FORM`'s belong to the inner unit.
    pub flag_changes: Vec<FlagChange>,
    /// The NOCROSS the unit holds as it is formed, where this month's orders set it.
    nocross_at_form: Option<bool>,
}

impl FormedUnit {
    /// `new-<alias>`, as an order names the unit.
    #[must_use]
    pub fn unit_id(&self) -> String {
        format!("new-{}", self.alias)
    }

    /// The unit's NOCROSS once its own orders have run (`rules/sequenceofevents` runs NOCROSS
    /// before LEAVE): its own last NOCROSS, else what it was formed with. `Unit::CopyFlags` copies
    /// `flags` whole, NOCROSS among them (`../Atlantis/unit.cpp`). `None` where no order this month
    /// set it, so the report's flag on [`Self::block_unit`] stands.
    #[must_use]
    pub fn nocross(&self) -> Option<bool> {
        last_nocross(&self.flag_changes).or(self.nocross_at_form)
    }
}

fn last_nocross(changes: &[FlagChange]) -> Option<bool> {
    changes.iter().rev().find_map(|change| match change {
        FlagChange::Toggle {
            setting: crate::report::flags::Setting::NoCross,
            on,
        } => Some(*on),
        _ => None,
    })
}

/// How a reader knows which hex a `unit` block stands in.
#[derive(Clone, Copy)]
pub enum Hexes<'a> {
    /// The reader sees no report. Every `FORM` with a readable alias under a `unit` line forms,
    /// and no alias is taken.
    Unknown,
    /// The hex of each unit whose block can `FORM`; `None` for one that cannot, which forms nobody.
    Of(&'a dyn Fn(&str) -> Option<String>),
}

/// What [`FormBlocks::visit`] made of one event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Nothing a reader needs beyond the event itself.
    Other,
    /// This `FORM` created [`FormBlocks::formed`]`[index]`, which now owns the orders below it.
    Formed(usize),
    /// An order this month, with the flag order it is, if it is one. Its owner is
    /// [`FormBlocks::owner`].
    Order { flag: Option<FlagChange> },
}

/// The one reader of what this month's `FORM` blocks create, driven by each reader's own walk.
///
/// It holds the rules about a formed unit once: only orders outside every `TURN` block count; the
/// alias is a number of at least 1; a taken alias in the same hex, a former nobody can name, or an
/// unreadable `FORM` swallows its block; the former's flag orders above the `FORM` line are
/// inherited. It is also where those readers read a flag line, so a flag order means one thing to
/// all of them.
#[derive(Debug, Default)]
pub struct FormBlocks {
    /// The `unit` whose block the walk is in.
    current: Option<String>,
    /// Indices into `formed`.
    stack: FormStack<usize>,
    formed: Vec<FormedUnit>,
    /// `(hex, alias)` of every `FORM` taken up so far.
    taken: std::collections::BTreeSet<(String, String)>,
    /// Each block unit's own flag orders so far.
    shown_flag_changes: std::collections::BTreeMap<String, Vec<FlagChange>>,
}

impl FormBlocks {
    /// A walk that has passed nothing yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Folds one event of [`super::walk::walk`] in. Call it for every event, before acting on the
    /// event yourself, so [`Self::owner`] answers for it.
    pub fn visit(
        &mut self,
        event: &Event<'_>,
        ruleset: Option<&Ruleset>,
        hexes: Hexes<'_>,
    ) -> Step {
        use super::walk::BlockKind;

        match event {
            Event::Unit(line) => {
                self.stack.reset();
                self.current = line.arguments.first().map(|id| id.text.clone());
                Step::Other
            }
            Event::Directive(_) => {
                self.stack.reset();
                self.current = None;
                Step::Other
            }
            Event::Open {
                line,
                kind: BlockKind::Form,
                depth,
            } if depth.turn == 0 => match self.open(line.number, line.arguments, hexes) {
                Some(index) => Step::Formed(index),
                None => Step::Other,
            },
            Event::Close {
                kind: BlockKind::Form,
                depth,
                ..
            } if depth.turn == 0 => {
                self.stack.close();
                Step::Other
            }
            Event::Order { line, depth } if depth.turn == 0 => {
                let flag = super::effects::read_flag_line(line.command, line.arguments, ruleset);
                if let Some(change) = flag {
                    match self.stack.owner() {
                        Owner::Block => {
                            if let Some(unit) = &self.current {
                                self.shown_flag_changes
                                    .entry(unit.clone())
                                    .or_default()
                                    .push(change);
                            }
                        }
                        Owner::Formed(index) => {
                            let index = *index;
                            self.formed[index].flag_changes.push(change);
                        }
                        Owner::Nobody => {}
                    }
                }
                Step::Order { flag }
            }
            _ => Step::Other,
        }
    }

    fn open(
        &mut self,
        form_line: usize,
        arguments: &[super::lexer::Token],
        hexes: Hexes<'_>,
    ) -> Option<usize> {
        let index = self.formed_unit(form_line, arguments, hexes);
        self.stack.open(index);
        index
    }

    /// The unit this `FORM` creates and records, or `None` for one that creates nobody. A `None`
    /// still opens a block, so its orders do not fall through to the unit outside it.
    fn formed_unit(
        &mut self,
        form_line: usize,
        arguments: &[super::lexer::Token],
        hexes: Hexes<'_>,
    ) -> Option<usize> {
        // `rules/form`: the alias "must be at least 1", and `NEW n` is the only way to name it.
        let alias = super::forms::read_alias(arguments.first()?)?.to_string();
        let block_unit = self.current.clone()?;
        let (former, inherited_flag_changes, former_nocross) = match self.stack.owner() {
            Owner::Block => {
                let changes = self
                    .shown_flag_changes
                    .get(&block_unit)
                    .cloned()
                    .unwrap_or_default();
                (OrderedUnitKey::Shown(block_unit.clone()), changes, None)
            }
            Owner::Formed(index) => {
                let outer = &self.formed[*index];
                (
                    OrderedUnitKey::Formed(outer.form_line),
                    outer.flag_changes.clone(),
                    outer.nocross_at_form,
                )
            }
            Owner::Nobody => return None,
        };
        let region_id = match hexes {
            Hexes::Unknown => None,
            Hexes::Of(hex_of) => {
                let region = hex_of(&block_unit)?;
                // `rules/form`: an alias is the hex's; a second `FORM` of it would be refused.
                if !self.taken.insert((region.clone(), alias.clone())) {
                    return None;
                }
                Some(region)
            }
        };
        let nocross_at_form = last_nocross(&inherited_flag_changes).or(former_nocross);
        self.formed.push(FormedUnit {
            form_line,
            alias,
            former,
            block_unit,
            region_id,
            inherited_flag_changes,
            flag_changes: Vec::new(),
            nocross_at_form,
        });
        Some(self.formed.len() - 1)
    }

    /// Who the next order belongs to; a formed unit by its index in [`Self::formed`].
    #[must_use]
    pub fn owner(&self) -> Owner<'_, usize> {
        self.stack.owner()
    }

    /// The `unit` whose block the walk is in.
    #[must_use]
    pub fn current(&self) -> Option<&str> {
        self.current.as_deref()
    }

    /// Every unit formed so far, in document order.
    #[must_use]
    pub fn formed(&self) -> &[FormedUnit] {
        &self.formed
    }

    /// Every unit the walk formed, in document order.
    #[must_use]
    pub fn into_formed(self) -> Vec<FormedUnit> {
        self.formed
    }
}

#[cfg(test)]
mod tests {
    use super::{FormStack, Owner};

    use super::{FormBlocks, FormedUnit, Hexes, OrderedUnitKey};
    use crate::report::flags::{FlagChange, Setting};

    /// Every unit `source` forms, read by `FormBlocks` alone over the shared walk.
    fn formed(source: &str, hexes: Hexes<'_>) -> Vec<FormedUnit> {
        let mut blocks = FormBlocks::new();
        crate::orders::walk::walk(source, None, |event| {
            blocks.visit(&event, None, hexes);
        });
        blocks.into_formed()
    }

    fn toggle(setting: Setting, on: bool) -> FlagChange {
        FlagChange::Toggle { setting, on }
    }

    /// Units 1 and 2 stand in hex `a`, unit 3 in hex `b`; nobody else is known.
    fn two_hexes(unit: &str) -> Option<String> {
        match unit {
            "1" | "2" => Some("a".to_string()),
            "3" => Some("b".to_string()),
            _ => None,
        }
    }

    #[test]
    fn form_blocks_records_alias_former_and_block_unit() {
        let units = formed("unit 1\nFORM 7\nEND\n", Hexes::Of(&two_hexes));
        assert_eq!(units.len(), 1);
        let unit = &units[0];
        assert_eq!(unit.form_line, 2);
        assert_eq!(unit.alias, "7");
        assert_eq!(unit.unit_id(), "new-7");
        assert_eq!(unit.former, OrderedUnitKey::shown("1"));
        assert_eq!(unit.block_unit, "1");
        assert_eq!(unit.region_id.as_deref(), Some("a"));
    }

    /// `rules/form`: the alias "must be at least 1", and `NEW n` names a number.
    #[test]
    fn form_blocks_swallows_an_unreadable_alias() {
        let source = "unit 1\nFORM 0\nFORM 2\nEND\nEND\nFORM a\nEND\n";
        let units = formed(source, Hexes::Of(&two_hexes));
        assert!(
            units.is_empty(),
            "a FORM nested in a refused one has no former: {units:?}"
        );
    }

    #[test]
    fn form_blocks_swallows_a_form_nested_in_an_unreadable_one() {
        let units = formed("unit 1\nFORM 0\nFORM 2\nEND\nEND\n", Hexes::Unknown);
        assert!(units.is_empty(), "{units:?}");
    }

    /// `rules/form`: "you should not create two units in the same region in the same month, with
    /// the same alias numbers" - and an alias is scoped to its region.
    #[test]
    fn form_blocks_swallows_a_taken_alias_in_the_same_hex_only() {
        let source = "unit 1\nFORM 1\nEND\nunit 2\nFORM 1\nEND\nunit 3\nFORM 1\nEND\n";
        let units = formed(source, Hexes::Of(&two_hexes));
        let lines: Vec<usize> = units.iter().map(|unit| unit.form_line).collect();
        assert_eq!(lines, vec![2, 8]);
    }

    #[test]
    fn form_blocks_swallows_a_form_whose_block_unit_has_no_hex() {
        let units = formed("unit 9\nFORM 1\nEND\n", Hexes::Of(&two_hexes));
        assert!(units.is_empty(), "{units:?}");
    }

    #[test]
    fn form_blocks_does_not_check_aliases_without_hexes() {
        let source = "unit 1\nFORM 1\nEND\nunit 2\nFORM 1\nEND\n";
        let units = formed(source, Hexes::Unknown);
        assert_eq!(units.len(), 2);
        assert_eq!(units[1].region_id, None);
    }

    #[test]
    fn form_blocks_ignores_a_form_inside_a_turn_block() {
        let units = formed("unit 1\nTURN\nFORM 1\nEND\nENDTURN\n", Hexes::Unknown);
        assert!(units.is_empty(), "{units:?}");
    }

    /// The engine applies a flag order as it parses it, and `FORM` copies the former's flags then
    /// (`Unit::CopyFlags`, `ah-78rd`): what the former writes above the FORM line is inherited,
    /// what it writes below is not.
    #[test]
    fn form_blocks_inherits_the_flag_orders_written_above_the_form_line() {
        let source = "unit 1\nSHARE 1\nFORM 1\nBEHIND 1\nEND\nAVOID 1\n";
        let units = formed(source, Hexes::Unknown);
        assert_eq!(
            units[0].inherited_flag_changes,
            vec![toggle(Setting::Sharing, true)]
        );
        assert_eq!(units[0].flag_changes, vec![toggle(Setting::Behind, true)]);
    }

    /// Read through the grammar's consumed prefix, as every reader must (`ah-e529` finding 1).
    #[test]
    fn form_blocks_reads_a_flag_line_through_the_grammar() {
        let source = "unit 1\nSHARE 0 note\nREVEAL FACTON\nFORM 1\nEND\n";
        let units = formed(source, Hexes::Unknown);
        assert_eq!(
            units[0].inherited_flag_changes,
            vec![toggle(Setting::Sharing, false)]
        );
    }

    #[test]
    fn form_blocks_nested_former_is_the_outer_formed_unit_and_inherits_its_own_orders() {
        let source = "unit 1\nSHARE 1\nFORM 1\nHOLD 1\nFORM 2\nEND\nEND\n";
        let units = formed(source, Hexes::Of(&two_hexes));
        assert_eq!(units.len(), 2);
        assert_eq!(units[1].former, OrderedUnitKey::Formed(3));
        assert_eq!(units[1].block_unit, "1");
        assert_eq!(units[1].region_id.as_deref(), Some("a"));
        assert_eq!(
            units[1].inherited_flag_changes,
            vec![toggle(Setting::Holding, true)],
            "the outer unit's starting flags already hold what it inherited"
        );
    }

    /// `Unit::CopyFlags` copies `flags` whole, NOCROSS among them (`../Atlantis/unit.cpp`).
    #[test]
    fn form_blocks_nocross_is_inherited_at_the_form_line_and_overridden_by_its_own() {
        let source = "unit 1\nNOCROSS 1\nFORM 1\nFORM 2\nEND\nFORM 3\nNOCROSS 0\nEND\nEND\nNOCROSS 0\nFORM 4\nEND\nunit 2\nFORM 5\nEND\n";
        let units = formed(source, Hexes::Unknown);
        let nocross: Vec<(String, Option<bool>)> = units
            .iter()
            .map(|unit| (unit.alias.clone(), unit.nocross()))
            .collect();
        assert_eq!(
            nocross,
            vec![
                ("1".to_string(), Some(true)),
                ("2".to_string(), Some(true)),
                ("3".to_string(), Some(false)),
                ("4".to_string(), Some(false)),
                ("5".to_string(), None),
            ]
        );
    }

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
