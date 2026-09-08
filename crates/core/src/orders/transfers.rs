//! The one Give-phase transfer record and report order both [`super::effects`] and
//! [`super::semantics`] read.
//!
//! `rules/sequenceofevents` settles GIVE and TAKE together in one Give phase and orders the units
//! inside it: "Where there is no other basis for deciding in which order units will be processed
//! within a phase, units that appear higher on the report get precedence." Both the preview and the
//! economy walk have to obey that, and each held its own copy of the record and the sort
//! (`ah-1zca.4`).

use std::borrow::Cow;

use crate::movement::rules::Ruleset;
use crate::report::model::ItemAmount;

use super::forms::{Amount, Party, Selector};
use super::items::{is_unfinished_ship, item_named, unfinished_ship_named};

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

/// One tag a transfer's selector names, with what the holder has of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Selected {
    /// The item's printed name, as the holder's own list spells it.
    pub(crate) name: String,
    /// The item's tag, as the holder's own list keys it.
    pub(crate) tag: String,
    /// What the holder has of it, before this transfer.
    pub(crate) held: i64,
}

/// Which of a holder's tags one `GIVE`/`TAKE` selector names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Selection {
    /// The tags named, **in the order the holdings iterator yielded them** - never sorted, because
    /// the preview's rows and the walk's refusal lists are both shown in that order.
    Tags(Vec<Selected>),
    /// This holder's answer cannot be established: an item argument that resolves to nothing, or
    /// to something the holder does not have, or to an unfinished ship; a class the catalogue
    /// cannot state the members of (`ADVANCED`, `MAGIC`, `SPECIAL`); a word that is not a class;
    /// or a class carrying `EXCEPT` or a stated quantity, which `rules/give` does not define.
    ///
    /// Each caller keeps its own reading of that: the preview moves nothing, and the headcount
    /// walk marks the unit unknowable.
    Unresolved,
}

/// Which of a holder's tags a `GIVE`/`TAKE` selector names, and how much of each is held.
///
/// The one answer to that question. Three surfaces each had their own (`ah-1zca.5`).
///
/// `held` is a closure rather than a slice because each caller holds a different shape - a report
/// unit's item list, or the running `BTreeMap` the headcount walk keeps - and it follows
/// [`item_named`]'s own convention for the same reason. Each call walks the holdings, and the
/// named-item arms make one per candidate spelling `item_named` tries, plus one for the entry.
pub(crate) fn selected<'a, I: Iterator<Item = &'a ItemAmount>>(
    ruleset: &Ruleset,
    what: &Selector,
    amount: &Amount,
    held: impl Fn() -> I,
) -> Selection {
    fn one(item: &ItemAmount) -> Selected {
        Selected {
            name: item.name.clone(),
            tag: item.tag.clone(),
            held: item.amount,
        }
    }
    let entry_for = |tag: &str| held().find(|item| item.tag.eq_ignore_ascii_case(tag));

    match what {
        // `rules/give`: it "gives the entire unit to the specified unit's faction" - a change of
        // ownership, and nobody's holdings move.
        Selector::WholeUnit => Selection::Tags(Vec::new()),
        // The catalogue *and* the holder's own list, through the one resolver every surface uses:
        // the catalogue cannot strip the report's `wood elves` down to its own `wood elf`, and a
        // transfer it could not name fell back to the report's own headcount (`ah-vcp8.1`).
        Selector::Item(text) => {
            let Some(tag) = item_named(Some(ruleset), text, &held) else {
                return Selection::Unresolved;
            };
            entry_for(&tag)
                .filter(|item| !is_unfinished_ship(item, Some(ruleset)))
                .map_or(Selection::Unresolved, |item| {
                    Selection::Tags(vec![one(item)])
                })
        }
        Selector::UnfinishedShip(text) => {
            let Some(tag) = unfinished_ship_named(Some(ruleset), text, &held) else {
                return Selection::Unresolved;
            };
            entry_for(&tag).map_or(Selection::Unresolved, |item| {
                Selection::Tags(vec![one(item)])
            })
        }
        Selector::Class(name) => {
            if !class_amount_is_defined(amount) {
                return Selection::Unresolved;
            }
            let Some(members) = class_members(ruleset, name) else {
                return Selection::Unresolved;
            };
            Selection::Tags(
                held()
                    .filter(|item| !is_unfinished_ship(item, Some(ruleset)))
                    .filter(|item| members.names(ruleset, &item.tag))
                    .map(one)
                    .collect(),
            )
        }
    }
}

/// Which tags one class names, for a catalogue that can say.
///
/// `None` where it cannot: `ADVANCED`, `MAGIC` and `SPECIAL`, whose members the data page never
/// states, and a word that is not a class at all. A caller that must not guess treats `None` as
/// "cannot say" and never as "no such items" - [`Ruleset::class_members`]' own rule.
pub(crate) enum ClassMembers<'a> {
    /// `MAN`/`MEN`: `Ruleset::is_man`, the walker's headcount rule (`ah-dxfd.1`).
    Men,
    /// `ITEM`/`ITEMS`: `rules/give` calls it "the combination of all of the previous categories" -
    /// everything the holder has, silver included - so it needs no catalogue.
    Everything,
    /// Every other class the data page states (`ah-3sp7.1`).
    Listed(&'a [String]),
}

/// [`Ruleset::class_members`]' three-way split, written once.
///
/// The name is passed through unchanged: `ItemClass::parse` does its own case folding, and the
/// three sites this replaced disagreed only cosmetically about upper-casing first.
pub(crate) fn class_members<'a>(ruleset: &'a Ruleset, class: &str) -> Option<ClassMembers<'a>> {
    if class.eq_ignore_ascii_case("MAN") || class.eq_ignore_ascii_case("MEN") {
        return Some(ClassMembers::Men);
    }
    if class.eq_ignore_ascii_case("ITEM") || class.eq_ignore_ascii_case("ITEMS") {
        return Some(ClassMembers::Everything);
    }
    ruleset.class_members(class).map(ClassMembers::Listed)
}

impl ClassMembers<'_> {
    /// Whether this class names `tag`.
    ///
    /// The `Listed` comparison is case-**sensitive**, as all three sites this replaced were: the
    /// catalogue and the reports both carry upper-case tags.
    pub(crate) fn names(&self, ruleset: &Ruleset, tag: &str) -> bool {
        match self {
            ClassMembers::Men => ruleset.is_man(tag),
            ClassMembers::Everything => true,
            ClassMembers::Listed(tags) => tags.iter().any(|member| member == tag),
        }
    }
}

/// How much of a held stock one `Amount` moves.
///
/// `rules/give`: `ALL` less any `EXCEPT` reserve, or the stated count - never more than the holder
/// has. Written twice before this (`ah-1zca.5`); the hex ledger's own quantity is deliberately not
/// this rule - its `TransferShape::Exact` arm does not clamp to the source's stock at all, which
/// is its uncertainty model rather than a duplicated rule.
pub(crate) fn quantity_moved(amount: &Amount, held: i64) -> i64 {
    quantity_requested(amount, held).clamp(0, held)
}

/// How much of a held stock one `Amount` *asks* for, before the holder's stock clamps it.
///
/// Split from [`quantity_moved`] because the headcount walk needs both: a man tag whose gift was
/// clamped marks the receiver `men_clamped`, and that test is `moved < requested`.
pub(crate) fn quantity_requested(amount: &Amount, held: i64) -> i64 {
    match amount {
        Amount::All { except } => held.saturating_sub(*except),
        Amount::Exact(count) => *count,
    }
}

/// Whether `rules/give` defines a class form carrying this amount.
///
/// `EXCEPT` and a stated quantity belong to the named-item forms alone; the class form is
/// `GIVE [unit] ALL [item class]` and nothing else, so a class arriving with either is a shape the
/// rules do not define and every surface leaves it alone.
pub(crate) fn class_amount_is_defined(amount: &Amount) -> bool {
    *amount == Amount::All { except: 0 }
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
    fn the_actor_outranks_the_line_when_the_two_disagree() {
        // Neither key alone orders these three: sorting on the line alone would put `(1, 2)`
        // first, and sorting on the actor alone would leave `(1, 9)` ahead of `(1, 2)`.
        let mut transfers = vec![owned(1, 9), owned(0, 4), owned(1, 2)];
        in_report_order(&mut transfers);
        let keys: Vec<(usize, usize)> = transfers
            .iter()
            .map(|transfer| (transfer.actor, transfer.line))
            .collect();
        assert_eq!(keys, vec![(0, 4), (1, 2), (1, 9)]);
    }

    #[test]
    fn a_transfer_moves_no_more_than_the_holder_has() {
        assert_eq!(quantity_moved(&Amount::Exact(15), 20), 15);
        assert_eq!(quantity_moved(&Amount::Exact(30), 20), 20);
        assert_eq!(quantity_moved(&Amount::All { except: 0 }, 20), 20);
        assert_eq!(quantity_moved(&Amount::All { except: 5 }, 20), 15);
        assert_eq!(quantity_moved(&Amount::All { except: 50 }, 20), 0);
        assert_eq!(quantity_moved(&Amount::Exact(-1), 20), 0);

        // The unclamped ask, which the headcount walk compares `moved` against.
        assert_eq!(quantity_requested(&Amount::Exact(30), 20), 30);
        assert_eq!(quantity_requested(&Amount::All { except: 5 }, 20), 15);
        // The ask is a plain subtraction and may be negative: an `EXCEPT` reserve larger than
        // the stock asks for less than nothing, and it is the clamp in `quantity_moved` alone
        // that floors it at zero.
        assert_eq!(quantity_requested(&Amount::All { except: 50 }, 20), -30);
    }

    #[test]
    fn the_class_form_takes_no_reserve_and_no_count() {
        assert!(class_amount_is_defined(&Amount::All { except: 0 }));
        assert!(!class_amount_is_defined(&Amount::All { except: 1 }));
        assert!(!class_amount_is_defined(&Amount::Exact(5)));
    }

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON).expect("the committed ruleset")
    }

    #[test]
    fn a_class_names_the_tags_the_catalogue_states() {
        let r = ruleset();

        let men = class_members(&r, "MEN").expect("MEN is a class");
        assert!(matches!(men, ClassMembers::Men));
        assert!(men.names(&r, "HUMN"));
        assert!(!men.names(&r, "SWOR"));

        let everything = class_members(&r, "items").expect("ITEMS is a class");
        assert!(matches!(everything, ClassMembers::Everything));
        assert!(everything.names(&r, "SWOR"));
        assert!(everything.names(&r, "SILV"));

        let weapons = class_members(&r, "WEAPON").expect("WEAPON is a stated class");
        assert!(matches!(weapons, ClassMembers::Listed(_)));
        assert!(weapons.names(&r, "SWOR"));
        assert!(!weapons.names(&r, "HUMN"));

        // The data page never states these three, and a word that is not a class at all.
        for unstated in ["ADVANCED", "MAGIC", "SPECIAL", "NOT_A_CLASS"] {
            assert!(
                class_members(&r, unstated).is_none(),
                "{unstated} should not be statable"
            );
        }
    }

    fn holdings() -> Vec<ItemAmount> {
        vec![
            ItemAmount {
                amount: 20,
                name: "iron".to_string(),
                tag: "IRON".to_string(),
            },
            ItemAmount {
                amount: 8,
                name: "orcs".to_string(),
                tag: "ORC".to_string(),
            },
            ItemAmount {
                amount: 3,
                name: "swords".to_string(),
                tag: "SWOR".to_string(),
            },
            ItemAmount {
                amount: 1,
                name: "unfinished Longship".to_string(),
                tag: "LONG".to_string(),
            },
        ]
    }

    fn tags_of(selection: &Selection) -> Vec<&str> {
        match selection {
            Selection::Tags(tags) => tags.iter().map(|item| item.tag.as_str()).collect(),
            Selection::Unresolved => panic!("expected tags, got Unresolved"),
        }
    }

    #[test]
    fn one_selector_names_one_holders_tags() {
        let r = ruleset();
        let held = holdings();
        let all = Amount::All { except: 0 };
        let pick = |what: &Selector, amount: &Amount| selected(&r, what, amount, || held.iter());

        let iron = pick(&Selector::Item("iron".to_string()), &all);
        assert_eq!(
            iron,
            Selection::Tags(vec![Selected {
                name: "iron".to_string(),
                tag: "IRON".to_string(),
                held: 20,
            }])
        );

        // The catalogue knows HORS; this holder has none.
        assert_eq!(
            pick(&Selector::Item("horse".to_string()), &all),
            Selection::Unresolved
        );
        // Resolved off the catalogue, then rejected by the unfinished-ship exclusion.
        assert_eq!(
            pick(&Selector::Item("Longship".to_string()), &all),
            Selection::Unresolved
        );
        assert_eq!(
            pick(&Selector::UnfinishedShip("Longship".to_string()), &all),
            Selection::Tags(vec![Selected {
                name: "unfinished Longship".to_string(),
                tag: "LONG".to_string(),
                held: 1,
            }])
        );

        assert_eq!(
            tags_of(&pick(&Selector::Class("MEN".to_string()), &all)),
            ["ORC"]
        );
        // In the holder's own order, and the unfinished hull excluded.
        assert_eq!(
            tags_of(&pick(&Selector::Class("ITEMS".to_string()), &all)),
            ["IRON", "ORC", "SWOR"]
        );
        assert_eq!(
            tags_of(&pick(&Selector::Class("WEAPONS".to_string()), &all)),
            ["SWOR"]
        );
        assert_eq!(
            pick(&Selector::Class("MAGIC".to_string()), &all),
            Selection::Unresolved
        );
        assert_eq!(
            pick(
                &Selector::Class("ITEMS".to_string()),
                &Amount::All { except: 2 }
            ),
            Selection::Unresolved
        );

        // A change of ownership: nobody's holdings move, and that is knowable.
        assert_eq!(
            pick(&Selector::WholeUnit, &all),
            Selection::Tags(Vec::new())
        );
    }

    #[test]
    fn one_actors_lines_settle_in_the_order_written() {
        let mut transfers = vec![owned(3, 7), owned(3, 2), owned(3, 5)];
        in_report_order(&mut transfers);
        let lines: Vec<usize> = transfers.iter().map(|transfer| transfer.line).collect();
        assert_eq!(lines, vec![2, 5, 7]);
    }
}
