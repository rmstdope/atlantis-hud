//! The one `rules/sequenceofevents` phase order both [`super::semantics`] and [`super::silver`]
//! read.
//!
//! The order a player writes their orders in does not change the order the game runs them in:
//! `rules/sequenceofevents` fixes that, and both of this crate's economy computations have to walk
//! a unit's block in it rather than in document order. One enum and one sort, so the two readers
//! cannot drift apart (`ah-gdd3.1`).

use super::intents::{Intent, PlacedIntent};

/// Where one order settles in `rules/sequenceofevents`.
///
/// Declaration order **is** the turn's order: `Ord` is derived from it and `phase as usize` indexes
/// [`super::semantics`]'s per-phase balance arrays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(usize)]
pub(crate) enum StatePhase {
    Instant,
    /// CLAIM is in the same batch of instant orders as AVOID and GUARD 0, and so is not really a
    /// phase of its own: it is separated out only so that it is unambiguously ordered ahead of
    /// `Give`, which is the whole of what any silver answer turns on.
    Claim,
    Give,
    Tax,
    Cast,
    Market,
    Withdraw,
    Movement,
    Study,
    Manufacturing,
    Build,
    /// Primary PRODUCE - a recipe taking no item inputs, which draws on the region's resources
    /// rather than on goods. `rules/sequenceofevents` runs it *after* BUILD, which is the whole
    /// reason it is a phase of its own: an output credited here is invisible to BUILD, while one
    /// credited at [`StatePhase::Manufacturing`] is not (`ah-728m.2.2`).
    ///
    /// [`phase_of`] never answers it, because classifying a PRODUCE needs the recipe and this
    /// module has no ruleset. [`super::semantics`] classifies it where it has one.
    PrimaryProduction,
    Wages,
    Maintenance,
}

impl StatePhase {
    pub(crate) const COUNT: usize = 14;
}

/// Every phase an order can settle in, in the turn's order.
///
/// [`StatePhase::Maintenance`] is absent: it carries no order, only the upkeep charge assessed
/// after every order has run. So is [`StatePhase::PrimaryProduction`]: [`phase_of`] cannot answer
/// it without a ruleset, and [`super::semantics`] runs both PRODUCE passes outside this walk
/// anyway (`ah-728m.2.2`).
pub(crate) const ORDER: [StatePhase; 12] = [
    StatePhase::Instant,
    StatePhase::Claim,
    StatePhase::Give,
    StatePhase::Tax,
    StatePhase::Cast,
    StatePhase::Market,
    StatePhase::Withdraw,
    StatePhase::Movement,
    StatePhase::Study,
    StatePhase::Manufacturing,
    StatePhase::Build,
    StatePhase::Wages,
];

/// The phase one order settles in, per `rules/sequenceofevents`.
///
/// No `_` arm on purpose: a variant added to [`Intent`] later fails to compile here rather than
/// silently settling in the wrong phase.
pub(crate) fn phase_of(intent: &Intent) -> StatePhase {
    match intent {
        // "Instant orders": FORM, then the batch holding AVOID and GUARD 0, then LEAVE and ENTER.
        Intent::Form { .. }
        | Intent::Guard(_)
        | Intent::Avoid(_)
        | Intent::Share(_)
        | Intent::Enter { .. }
        | Intent::Leave => StatePhase::Instant,
        // CLAIM is in that same first batch, and so ahead of GIVE.
        Intent::Claim(_) => StatePhase::Claim,
        // "Give orders. GIVE and TAKE orders are processed."
        Intent::Give { .. } | Intent::Take { .. } => StatePhase::Give,
        // "Tax orders. ... PILLAGE ... TAX ... are processed."
        Intent::Tax | Intent::Pillage => StatePhase::Tax,
        // "Instant Magic ... Spells are CAST".
        Intent::Cast { .. } => StatePhase::Cast,
        // "Market orders. SELL orders are processed. BUY orders are processed." One phase for both:
        // no silver answer turns on the split today, and sharing it keeps the document order these
        // two have within the market block.
        Intent::Sell { .. } | Intent::Buy { .. } => StatePhase::Market,
        // WITHDRAW follows BUY in the market block.
        Intent::Withdraw { .. } => StatePhase::Withdraw,
        // "Movement orders. ADVANCE, MOVE and SAIL orders are processed phase by phase".
        Intent::Move { .. } | Intent::Sail { .. } => StatePhase::Movement,
        // "Month long orders. TEACH orders are processed. STUDY orders are processed."
        Intent::Study { .. } | Intent::Teach { .. } => StatePhase::Study,
        // Manufacturing PRODUCE opens the month-long spends. Primary PRODUCE settles after BUILD,
        // but only a manufacturing recipe has a silver input, so nothing here can tell them apart
        // by cash. An unrecognised month-long keyword settles nothing and belongs in the same block.
        Intent::Produce { .. } | Intent::MonthLong(_) => StatePhase::Manufacturing,
        // "BUILD orders are processed", after manufacturing.
        Intent::Build { .. } => StatePhase::Build,
        // "ENTERTAIN orders are processed. WORK orders are processed." - the last earners.
        Intent::Work | Intent::Entertain => StatePhase::Wages,
    }
}

/// One unit's orders in the turn's order, ties broken by the line they were written on.
///
/// A stable sort, so orders sharing a phase keep the order they were written in.
pub(crate) fn in_phase_order(intents: &[PlacedIntent]) -> Vec<&PlacedIntent> {
    let mut ordered: Vec<&PlacedIntent> = intents.iter().collect();
    ordered.sort_by_key(|placed| phase_of(&placed.intent));
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orders::forms::{Amount, Party, Selector};

    fn placed(intent: Intent, line: usize) -> PlacedIntent {
        PlacedIntent {
            intent,
            line,
            column_start: 0,
            column_end: 0,
            keyword: "",
        }
    }

    fn cast() -> Intent {
        Intent::Cast {
            spell: "create_amulet_of_protection".into(),
            arguments: Vec::new(),
        }
    }

    fn sell() -> Intent {
        Intent::Sell {
            amount: Amount::Exact(1),
            item: "grain".into(),
        }
    }

    #[test]
    fn every_intent_lands_in_its_rules_phase() {
        let cases: Vec<(Intent, StatePhase)> = vec![
            (Intent::Form { alias: "1".into() }, StatePhase::Instant),
            (Intent::Guard(true), StatePhase::Instant),
            (Intent::Avoid(true), StatePhase::Instant),
            (Intent::Share(true), StatePhase::Instant),
            (
                Intent::Enter {
                    structure: "1".into(),
                },
                StatePhase::Instant,
            ),
            (Intent::Leave, StatePhase::Instant),
            (Intent::Claim(200), StatePhase::Claim),
            (
                Intent::Give {
                    to: Party::Unit("901".into()),
                    what: Selector::Item("SILV".into()),
                    amount: Amount::Exact(1),
                },
                StatePhase::Give,
            ),
            (
                Intent::Take {
                    from: Party::Unit("901".into()),
                    what: Selector::Item("SILV".into()),
                    amount: Amount::Exact(1),
                },
                StatePhase::Give,
            ),
            (Intent::Tax, StatePhase::Tax),
            (Intent::Pillage, StatePhase::Tax),
            (cast(), StatePhase::Cast),
            (sell(), StatePhase::Market),
            (
                Intent::Buy {
                    amount: Amount::Exact(1),
                    item: "grain".into(),
                },
                StatePhase::Market,
            ),
            (
                Intent::Withdraw {
                    count: 1,
                    item: "grain".into(),
                },
                StatePhase::Withdraw,
            ),
            (Intent::Move { steps: Vec::new() }, StatePhase::Movement),
            (Intent::Sail { steps: Vec::new() }, StatePhase::Movement),
            (
                Intent::Study {
                    skill: "combat".into(),
                },
                StatePhase::Study,
            ),
            (
                Intent::Teach {
                    students: Vec::new(),
                },
                StatePhase::Study,
            ),
            (
                Intent::Produce {
                    requested: None,
                    item: "sword".into(),
                },
                StatePhase::Manufacturing,
            ),
            (Intent::MonthLong("MOVE"), StatePhase::Manufacturing),
            (
                Intent::Build {
                    founding: None,
                    helping: None,
                },
                StatePhase::Build,
            ),
            (Intent::Work, StatePhase::Wages),
            (Intent::Entertain, StatePhase::Wages),
        ];
        assert_eq!(cases.len(), 24, "every Intent variant is covered");
        for (intent, want) in cases {
            assert_eq!(phase_of(&intent), want, "{intent:?}");
        }
    }

    #[test]
    fn a_claim_written_after_a_cast_sorts_before_it() {
        let intents = vec![placed(cast(), 1), placed(Intent::Claim(200), 2)];
        let ordered = in_phase_order(&intents);
        assert_eq!(ordered[0].intent, Intent::Claim(200));
        assert_eq!(ordered[1].intent, cast());
    }

    #[test]
    fn two_orders_in_one_phase_keep_the_order_they_were_written_in() {
        let first = placed(sell(), 1);
        let second = placed(
            Intent::Sell {
                amount: Amount::Exact(2),
                item: "wood".into(),
            },
            2,
        );
        let forwards = vec![first.clone(), second.clone()];
        let ordered = in_phase_order(&forwards);
        assert_eq!([ordered[0].line, ordered[1].line], [1, 2]);

        let backwards = vec![second, first];
        let ordered = in_phase_order(&backwards);
        assert_eq!([ordered[0].line, ordered[1].line], [2, 1]);
    }
}
