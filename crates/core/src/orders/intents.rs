//! What each unit's orders are *trying to do*, as opposed to whether they are spelled correctly.
//!
//! [`super::parser`] answers "is this a legal line". This answers "what would happen if the server
//! ran it", which is the question every semantic check needs and none of them should have to ask
//! the text directly. One walk of the document produces one [`UnitIntents`] per unit block, and the
//! checks in [`super::semantics`] are then plain functions over report data and these.
//!
//! Deliberately tolerant, and deliberately lossy. A line whose shape is wrong yields no intent at
//! all: the syntax checker has already said so, and guessing at what a malformed order meant would
//! feed a wrong premise into every check downstream. Orders that no check reads are not modelled.

use super::forms::{self, Amount, Party, Selector};
use super::lexer::{Token, TokenKind};
use super::walk::{self, Depth, Event};
use crate::movement::orders::MoveStep;

/// One thing a unit's orders would do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent {
    Give {
        to: Party,
        what: Selector,
        amount: Amount,
    },
    /// `TAKE FROM`, which is a GIVE written from the other end.
    Take {
        from: Party,
        what: Selector,
        amount: Amount,
    },
    Buy {
        amount: Amount,
        item: String,
    },
    Sell {
        amount: Amount,
        item: String,
    },
    Study {
        skill: String,
    },
    Teach {
        students: Vec<Party>,
    },
    /// `GUARD 1` or `GUARD 0`.
    Guard(bool),
    /// `CLAIM`, which draws on the faction's unclaimed silver.
    Claim(i64),
    Tax,
    Pillage,
    Work,
    Entertain,
    /// `WITHDRAW`, whose price the ruleset does not carry. Recorded so a check can decline to
    /// judge a unit that spends money we cannot count.
    Withdraw,
    /// An order that takes the whole month and that no check reads any further.
    ///
    /// Occupying the month is the whole of what these say, and it is enough: a unit already
    /// spending its month cannot be offered as somebody's spare teacher. Carries the keyword so a
    /// message can name it.
    MonthLong(&'static str),
    /// `CAST <spell> [arguments…]`. The month is spoken for (as `MonthLong` says), and the spell
    /// may consume what the ruleset says it costs; the arguments are kept for the one spell whose
    /// cost depends on them (transmutation names its output, and optionally a number).
    Cast {
        spell: String,
        arguments: Vec<String>,
    },
    Move {
        steps: Vec<MoveStep>,
    },
    /// `FORM n` at this month's depth: the unit is asking for a new unit under alias `n`. Recorded
    /// on the forming unit (the enclosing `unit` block), nested FORMs included, so a check can see
    /// every alias a hex hands out this month. A FORM inside a TURN block is next month's and is
    /// not recorded.
    Form {
        alias: String,
    },
    /// `SAIL`, with or without a route: the fleet this unit stands in is being told to move. Bare
    /// SAIL - the turn 71 template's form - has no steps.
    Sail {
        steps: Vec<MoveStep>,
    },
    /// `ENTER n`: the unit boards structure `n` this month, before anything moves.
    Enter {
        structure: String,
    },
    /// `LEAVE`: the unit steps out of whatever it is in, before anything moves.
    Leave,
    /// `BUILD`, in whichever of the rules' forms it was written.
    ///
    /// `BUILD [name]` founds a structure of that type, so it names nothing that exists yet;
    /// everything else works on a structure that is already there - the one this unit stands in, or
    /// the one the helped unit stands in. `COMPLETE` is not recorded: it says when the work should
    /// finish, and no check reads it.
    Build {
        /// `BUILD [name]`: the type being founded.
        founding: Option<String>,
        /// `BUILD HELP [unit]`: whose structure is being worked on, when it is not this unit's.
        helping: Option<Party>,
    },
}

/// One intent, and where on the page it was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlacedIntent {
    pub intent: Intent,
    pub line: usize,
    /// The span of the order's keyword, counted as [`super::lexer::Token`] counts.
    pub column_start: usize,
    pub column_end: usize,
}

/// One unit's block, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnitIntents {
    pub unit_id: String,
    /// The `unit NNNN` line that opened the block.
    pub line: usize,
    pub intents: Vec<PlacedIntent>,
    /// Order lines in this block that yielded no intent, and `TURN` blocks that were skipped.
    ///
    /// The app models about twenty of Atlantis's orders; the grammar knows a hundred. A line this
    /// reader could not turn into an intent is not an absence of work - `ASSASSINATE 4021` spends
    /// the month as surely as `WORK` does - so a check that asks "is this unit doing anything"
    /// must be able to tell "nothing" from "nothing I understand". Carries line numbers so a
    /// message could name one; nothing does yet.
    pub unread: Vec<usize>,
}

impl UnitIntents {
    /// The first intent of a kind the predicate accepts.
    pub fn find(&self, mut predicate: impl FnMut(&Intent) -> bool) -> Option<&PlacedIntent> {
        self.intents.iter().find(|placed| predicate(&placed.intent))
    }

    /// Whether the block carries an intent the predicate accepts.
    pub fn any(&self, predicate: impl FnMut(&Intent) -> bool) -> bool {
        self.find(predicate).is_some()
    }
}

/// Reads a whole orders document into one entry per unit block.
///
/// Lines before the first `unit` line belong to no unit and are dropped: they are the `#atlantis`
/// header, and a fragment being edited before a block is opened.
///
/// Two kinds of nesting are skipped rather than read. A `TURN` block holds *next* month's orders,
/// and a `FORM` block holds the orders of a unit that does not exist yet and has no number to file
/// them under. Reading either as though it were the surrounding unit's would charge that unit for
/// work it is not doing and move it out of a hex it is still standing in.
#[must_use]
pub fn read_intents(source: &str) -> Vec<UnitIntents> {
    let mut units: Vec<UnitIntents> = Vec::new();

    walk::walk(source, |event| match event {
        // A unit line ends the previous block, nesting and all: the walk abandons whatever was
        // still open before this event, so an unclosed TURN cannot swallow the next unit's orders.
        Event::Unit(line) => {
            if let Some(id) = line
                .arguments
                .first()
                .filter(|id| id.kind == TokenKind::Number)
            {
                units.push(UnitIntents {
                    unit_id: id.text.clone(),
                    line: line.number,
                    intents: Vec::new(),
                    unread: Vec::new(),
                });
            }
        }
        // A TURN block holds next month's orders and a FORM block a unit that does not exist yet
        // (see `read_intents`'s own doc); an order inside either is not this reading's business.
        Event::Order { line, depth } if depth == Depth::default() => {
            if let Some(unit) = units.last_mut() {
                if let Some(intent) = read_order(line.command, line.arguments) {
                    unit.intents.push(PlacedIntent {
                        intent,
                        line: line.number,
                        column_start: line.command.column_start,
                        column_end: line.command.column_end,
                    });
                } else {
                    unit.unread.push(line.number);
                }
            }
        }
        // A TURN block holds next month's orders, which this reader deliberately skips - so a unit
        // whose block contains one is not a unit we have fully read.
        Event::Open {
            line,
            kind: walk::BlockKind::Turn,
            depth,
        } if depth == Depth::default() => {
            if let Some(unit) = units.last_mut() {
                unit.unread.push(line.number);
            }
        }
        Event::Open {
            line,
            kind: walk::BlockKind::Form,
            depth,
        } if depth.turn == 0 => {
            if let (Some(unit), Some(alias)) = (
                units.last_mut(),
                line.arguments
                    .first()
                    .filter(|alias| alias.kind == TokenKind::Number),
            ) {
                unit.intents.push(PlacedIntent {
                    intent: Intent::Form {
                        alias: alias.text.clone(),
                    },
                    line: line.number,
                    column_start: line.command.column_start,
                    column_end: line.command.column_end,
                });
            }
        }
        _ => {}
    });

    units
}

/// One order line, as an intent - or nothing, for an order no check reads and for one whose shape
/// is wrong. The two are deliberately indistinguishable here: the syntax checker owns the second.
fn read_order(command: &Token, arguments: &[Token]) -> Option<Intent> {
    let name = command.text.to_ascii_uppercase();

    match name.as_str() {
        "GIVE" => {
            let (to, rest) = forms::read_party(arguments)?;
            let (what, amount) = forms::read_transfer(rest)?;
            Some(Intent::Give { to, what, amount })
        }
        "TAKE" => {
            let rest = arguments.split_first().filter(|(kw, _)| kw.is("FROM"))?.1;
            let (from, rest) = forms::read_party(rest)?;
            let (what, amount) = forms::read_transfer(rest)?;
            Some(Intent::Take { from, what, amount })
        }
        "BUY" | "SELL" => {
            let (amount, rest) = forms::read_amount(arguments)?;
            let item = rest.first().filter(|_| rest.len() == 1)?.text.clone();
            if name == "BUY" {
                Some(Intent::Buy { amount, item })
            } else {
                Some(Intent::Sell { amount, item })
            }
        }
        // "STUDY [skill]" and "STUDY [skill] [level]". The level says how far to go, not what a
        // month costs, so it changes nothing any check reads.
        "STUDY" => {
            let skill = arguments.first()?;
            let trailing = arguments.get(1);
            if arguments.len() > 2 || trailing.is_some_and(|token| token.kind != TokenKind::Number)
            {
                return None;
            }
            Some(Intent::Study {
                skill: skill.text.clone(),
            })
        }
        "TEACH" => {
            let mut students = Vec::new();
            let mut rest = arguments;
            while !rest.is_empty() {
                let (student, remaining) = forms::read_party(rest)?;
                students.push(student);
                rest = remaining;
            }
            if students.is_empty() {
                return None;
            }
            Some(Intent::Teach { students })
        }
        "GUARD" => Some(Intent::Guard(forms::read_flag(arguments)?)),
        "CLAIM" => Some(Intent::Claim(forms::read_only_number(arguments)?)),
        "TAX" if arguments.is_empty() => Some(Intent::Tax),
        "PILLAGE" if arguments.is_empty() => Some(Intent::Pillage),
        "WORK" if arguments.is_empty() => Some(Intent::Work),
        "ENTERTAIN" if arguments.is_empty() => Some(Intent::Entertain),
        "WITHDRAW" => Some(Intent::Withdraw),
        // "This is a full month order." Nothing here reads them further; what matters is that the
        // unit's month is spoken for.
        "PRODUCE" => Some(Intent::MonthLong("PRODUCE")),
        // The grammar's own forms (`grammar.rs`'s BUILD entry): `HELP [unit] COMPLETE`,
        // `HELP [unit]`, `COMPLETE`, `[name] COMPLETE`, `[name]`, and nothing at all. Read
        // strictly - a token this reader does not account for makes the order unreadable, the
        // same as everywhere else in this module, rather than being silently dropped.
        "BUILD" => match arguments {
            [] => Some(Intent::Build {
                founding: None,
                helping: None,
            }),
            [complete] if complete.is("COMPLETE") => Some(Intent::Build {
                founding: None,
                helping: None,
            }),
            [help, rest @ ..] if help.is("HELP") => {
                let (helping, rest) = forms::read_party(rest)?;
                match rest {
                    [] => Some(Intent::Build {
                        founding: None,
                        helping: Some(helping),
                    }),
                    [complete] if complete.is("COMPLETE") => Some(Intent::Build {
                        founding: None,
                        helping: Some(helping),
                    }),
                    _ => None,
                }
            }
            [name] => Some(Intent::Build {
                founding: Some(name.text.clone()),
                helping: None,
            }),
            [name, complete] if complete.is("COMPLETE") => Some(Intent::Build {
                founding: Some(name.text.clone()),
                helping: None,
            }),
            _ => None,
        },
        // A bare SAIL - the form the turn 71 template uses - spends the month but names no step
        // this reader can follow. With a route it is read below.
        "SAIL" if arguments.is_empty() => Some(Intent::Sail { steps: Vec::new() }),
        "SAIL" => Some(Intent::Sail {
            steps: forms::read_move_line(command, arguments)?,
        }),
        "ENTER" => Some(Intent::Enter {
            structure: forms::read_only_number(arguments)?.to_string(),
        }),
        "LEAVE" if arguments.is_empty() => Some(Intent::Leave),
        // Not every spell takes a month, but the rules make no promise about which, and a mage
        // offered as somebody's spare teacher is worse than one left alone. The arguments are kept
        // rather than discarded like BUILD/PRODUCE's, since transmutation's cost reads them. A
        // bare CAST names no spell - the syntax checker already says so - but still falls back to
        // MonthLong rather than yielding no intent at all: a dropped intent would leave the unit
        // looking free for the month, reintroducing the "spare teacher" problem MonthLong exists
        // to avoid.
        "CAST" => match arguments.first() {
            Some(spell) => Some(Intent::Cast {
                spell: spell.text.clone(),
                arguments: arguments[1..]
                    .iter()
                    .map(|token| token.text.clone())
                    .collect(),
            }),
            None => Some(Intent::MonthLong("CAST")),
        },
        word if crate::movement::orders::is_movement_command(word) => Some(Intent::Move {
            steps: forms::read_move_line(command, arguments)?,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn only_unit(source: &str) -> UnitIntents {
        let mut units = read_intents(source);
        assert_eq!(units.len(), 1, "expected one unit block: {units:?}");
        units.remove(0)
    }

    fn intents(source: &str) -> Vec<Intent> {
        only_unit(source)
            .intents
            .into_iter()
            .map(|placed| placed.intent)
            .collect()
    }

    // --- the document's own shape ---------------------------------------------------------

    #[test]
    fn an_order_we_do_not_model_is_recorded_as_unread() {
        let unit = only_unit("unit 5\nASSASSINATE 4021\n");
        assert!(unit.intents.is_empty(), "{unit:?}");
        assert_eq!(unit.unread, vec![2]);
    }

    #[test]
    fn a_turn_block_is_recorded_as_unread() {
        let unit = only_unit("unit 5\nWORK\nTURN\nWORK\nENDTURN\n");
        assert_eq!(unit.unread, vec![3]);
    }

    #[test]
    fn a_form_block_is_not_unread() {
        let unit = only_unit("unit 5\nFORM 1\nWORK\nEND\n");
        assert!(unit.unread.is_empty(), "{unit:?}");
        assert!(unit
            .intents
            .iter()
            .any(|placed| matches!(placed.intent, Intent::Form { .. })));
    }

    #[test]
    fn each_unit_block_is_read_under_its_own_number() {
        let units = read_intents(concat!(
            "#atlantis 95 \"secret\"\n",
            "unit 18642\n",
            "@work\n",
            "unit 13401\n",
            "TAX\n",
            "#end\n",
        ));

        assert_eq!(
            units
                .iter()
                .map(|unit| (unit.unit_id.as_str(), unit.line))
                .collect::<Vec<_>>(),
            vec![("18642", 2), ("13401", 4)]
        );
        assert_eq!(units[0].intents.len(), 1);
        assert_eq!(units[1].intents[0].intent, Intent::Tax);
    }

    /// The `#atlantis` line belongs to the faction, not to any unit, and orders typed before a
    /// block is opened belong to nobody yet.
    #[test]
    fn orders_outside_a_unit_block_belong_to_no_unit() {
        assert_eq!(read_intents("#atlantis 95\nWORK\n#end\n"), vec![]);
    }

    #[test]
    fn an_intent_remembers_the_line_and_the_span_of_its_keyword() {
        let unit = only_unit("unit 5\n  @study combat\n");
        let placed = &unit.intents[0];

        assert_eq!(placed.line, 2);
        // The `@` is part of the line but not of the keyword.
        assert_eq!((placed.column_start, placed.column_end), (3, 8));
    }

    /// A repeating order is still an order; the `@` says when, not what.
    #[test]
    fn a_repeating_order_carries_the_same_intent() {
        assert_eq!(intents("unit 5\n@tax\n"), vec![Intent::Tax]);
    }

    /// Everything the syntax checker rejects, this drops. Guessing at a malformed order would put
    /// a wrong premise under every check that reads these.
    #[test]
    fn a_line_that_does_not_parse_yields_no_intent() {
        assert_eq!(intents("unit 5\nGIVE 42 swords\n"), vec![]);
        assert_eq!(intents("unit 5\nFLY 1 2\n"), vec![]);
        assert_eq!(intents("unit 5\nSTUDY\n"), vec![]);
    }

    #[test]
    fn comments_and_blank_lines_yield_nothing() {
        assert_eq!(
            intents("unit 5\n;a comment\n\n   \nWORK\n"),
            vec![Intent::Work]
        );
    }

    /// Orders nobody checks are not modelled, and must not be mistaken for ones that are.
    #[test]
    fn an_order_no_check_reads_yields_no_intent() {
        assert_eq!(
            intents("unit 5\nAVOID 1\nBEHIND 0\nNAME UNIT \"Guards\"\n"),
            vec![]
        );
    }

    // --- transfers --------------------------------------------------------------------------

    #[test]
    fn a_give_names_its_recipient_its_item_and_its_quantity() {
        assert_eq!(
            intents("unit 5\nGIVE 4573 100 SILV\n"),
            vec![Intent::Give {
                to: Party::Unit("4573".to_string()),
                what: Selector::Item("SILV".to_string()),
                amount: Amount::Exact(100),
            }]
        );
    }

    #[test]
    fn giving_all_of_something_is_not_a_quantity() {
        assert_eq!(
            intents("unit 5\nGIVE 4573 ALL swords\n"),
            vec![Intent::Give {
                to: Party::Unit("4573".to_string()),
                what: Selector::Item("swords".to_string()),
                amount: Amount::All { except: 0 },
            }]
        );
    }

    #[test]
    fn an_except_clause_is_the_reserve_kept_back() {
        assert_eq!(
            intents("unit 5\nGIVE 4573 ALL swords EXCEPT 10\n"),
            vec![Intent::Give {
                to: Party::Unit("4573".to_string()),
                what: Selector::Item("swords".to_string()),
                amount: Amount::All { except: 10 },
            }]
        );
    }

    #[test]
    fn a_whole_class_of_items_is_kept_apart_from_one_named_item() {
        assert_eq!(
            intents("unit 5\nGIVE 4573 ALL ITEMS\n"),
            vec![Intent::Give {
                to: Party::Unit("4573".to_string()),
                what: Selector::Class("ITEMS".to_string()),
                amount: Amount::All { except: 0 },
            }]
        );
    }

    #[test]
    fn giving_the_unit_itself_is_its_own_thing() {
        assert_eq!(
            intents("unit 5\nGIVE 75 UNIT\n"),
            vec![Intent::Give {
                to: Party::Unit("75".to_string()),
                what: Selector::WholeUnit,
                amount: Amount::All { except: 0 },
            }]
        );
    }

    /// "GIVE 0" destroys what is given. The turn 71 template does exactly this with spears.
    #[test]
    fn giving_to_unit_zero_is_discarding() {
        assert_eq!(
            intents("unit 5\n@give 0 all spea\n"),
            vec![Intent::Give {
                to: Party::Discard,
                what: Selector::Item("spea".to_string()),
                amount: Amount::All { except: 0 },
            }]
        );
    }

    #[test]
    fn a_recipient_may_be_a_new_unit_of_ours_or_of_another_faction() {
        assert_eq!(
            intents("unit 5\nGIVE NEW 1 1000 silver\n"),
            vec![Intent::Give {
                to: Party::New("1".to_string()),
                what: Selector::Item("silver".to_string()),
                amount: Amount::Exact(1000),
            }]
        );
        assert_eq!(
            intents("unit 5\nGIVE FACTION 14 NEW 2 5 \"Chain armor\"\n"),
            vec![Intent::Give {
                to: Party::Foreign {
                    faction: "14".to_string(),
                    alias: "2".to_string(),
                },
                what: Selector::Item("Chain armor".to_string()),
                amount: Amount::Exact(5),
            }]
        );
    }

    /// TAKE is a GIVE written from the other end, and moves silver just as surely.
    #[test]
    fn a_take_is_read_as_the_transfer_it_is() {
        assert_eq!(
            intents("unit 5\nTAKE FROM 4573 10 swords\n"),
            vec![Intent::Take {
                from: Party::Unit("4573".to_string()),
                what: Selector::Item("swords".to_string()),
                amount: Amount::Exact(10),
            }]
        );
    }

    // --- the market -------------------------------------------------------------------------

    #[test]
    fn buying_and_selling_carry_their_quantity_and_item() {
        assert_eq!(
            intents("unit 5\nBUY 5 Plainsmen\nSELL 10 furs\n"),
            vec![
                Intent::Buy {
                    amount: Amount::Exact(5),
                    item: "Plainsmen".to_string(),
                },
                Intent::Sell {
                    amount: Amount::Exact(10),
                    item: "furs".to_string(),
                },
            ]
        );
    }

    #[test]
    fn buying_all_of_what_is_offered_is_not_a_quantity() {
        assert_eq!(
            intents("unit 5\nBUY ALL grain\n"),
            vec![Intent::Buy {
                amount: Amount::All { except: 0 },
                item: "grain".to_string(),
            }]
        );
    }

    // --- learning ---------------------------------------------------------------------------

    #[test]
    fn studying_carries_the_skill_as_written() {
        assert_eq!(
            intents("unit 5\n@study obse\n"),
            vec![Intent::Study {
                skill: "obse".to_string()
            }]
        );
    }

    /// "STUDY [skill] [level]" is the form that studies towards a level. The level changes nothing
    /// about the cost, which is per month, so only the skill is kept.
    #[test]
    fn a_study_order_with_a_target_level_is_still_a_study_of_that_skill() {
        assert_eq!(
            intents("unit 5\nSTUDY COMBAT 3\n"),
            vec![Intent::Study {
                skill: "COMBAT".to_string()
            }]
        );
    }

    #[test]
    fn teaching_carries_every_student_named() {
        assert_eq!(
            intents("unit 5\nTEACH 18642 13401 NEW 2\n"),
            vec![Intent::Teach {
                students: vec![
                    Party::Unit("18642".to_string()),
                    Party::Unit("13401".to_string()),
                    Party::New("2".to_string()),
                ]
            }]
        );
    }

    // --- flags, money and movement ----------------------------------------------------------

    #[test]
    fn guard_carries_which_way_it_was_set() {
        assert_eq!(intents("unit 5\nGUARD 1\n"), vec![Intent::Guard(true)]);
        assert_eq!(intents("unit 5\nGUARD 0\n"), vec![Intent::Guard(false)]);
    }

    #[test]
    fn claiming_carries_the_silver_it_draws() {
        assert_eq!(intents("unit 5\n@claim 50\n"), vec![Intent::Claim(50)]);
    }

    #[test]
    fn the_orders_that_earn_are_each_their_own_intent() {
        assert_eq!(
            intents("unit 5\nTAX\n"),
            vec![Intent::Tax],
            "TAX takes no arguments"
        );
        assert_eq!(intents("unit 5\nPILLAGE\n"), vec![Intent::Pillage]);
        assert_eq!(intents("unit 5\nWORK\n"), vec![Intent::Work]);
        assert_eq!(intents("unit 5\nENTERTAIN\n"), vec![Intent::Entertain]);
    }

    /// The ruleset carries no withdrawal prices, so this is recorded as spending that cannot be
    /// counted rather than as spending of nothing.
    #[test]
    fn a_withdrawal_is_recorded_even_though_its_price_is_unknown() {
        assert_eq!(
            intents("unit 5\nWITHDRAW 10 grain\n"),
            vec![Intent::Withdraw]
        );
    }

    #[test]
    fn a_move_carries_the_steps_the_planner_already_understands() {
        assert_eq!(
            intents("unit 5\nMOVE N NE\n"),
            vec![Intent::Move {
                steps: crate::movement::orders::parse_move("MOVE N NE")
                    .expect("the planner reads this")
            }]
        );
    }

    /// ADVANCE is MOVE that attacks whatever bars the way; it leaves the hex just the same, which
    /// is all the guard check cares about.
    #[test]
    fn an_advance_moves_the_unit_as_a_move_does() {
        assert_eq!(
            intents("unit 5\nADVANCE N\n"),
            vec![Intent::Move {
                steps: crate::movement::orders::parse_move("ADVANCE N")
                    .expect("the planner reads this")
            }]
        );
    }

    /// SAIL with a route is its own intent, not a plain Move - the sailing check
    /// (`semantics::check_sailing`) needs to tell a fleet order from a unit walking off.
    #[test]
    fn a_sail_with_a_route_is_its_own_intent() {
        assert_eq!(
            intents("unit 5\nSAIL N\n"),
            vec![Intent::Sail {
                steps: crate::movement::orders::parse_move("SAIL N")
                    .expect("the planner reads this")
            }]
        );
    }

    /// A bare SAIL - the form the turn 71 template uses - names no step this reader can follow, and
    /// still spends the whole month.
    #[test]
    fn a_bare_sail_still_spends_the_month() {
        assert_eq!(
            intents("unit 5\nSAIL\n"),
            vec![Intent::Sail { steps: Vec::new() }]
        );
    }

    /// `ENTER n` records which structure the unit boards this month, before anything moves.
    #[test]
    fn an_enter_names_its_structure() {
        assert_eq!(
            intents("unit 5\nENTER 329\n"),
            vec![Intent::Enter {
                structure: "329".to_string()
            }]
        );
    }

    /// `LEAVE` records that the unit steps out of whatever it is in this month.
    #[test]
    fn a_leave_is_recorded() {
        assert_eq!(intents("unit 5\nLEAVE\n"), vec![Intent::Leave]);
    }

    /// `CAST` keeps the spell and its arguments, since transmutation's cost depends on them - and
    /// still spends the whole month, the reason it used to be `MonthLong`.
    #[test]
    fn cast_keeps_the_spell_and_its_arguments() {
        assert_eq!(
            intents("unit 5\nCAST Transmutation 4 rootstone\n"),
            vec![Intent::Cast {
                spell: "Transmutation".to_string(),
                arguments: vec!["4".to_string(), "rootstone".to_string()],
            }]
        );
    }

    /// A bare `CAST` names no spell - the syntax checker already says so
    /// (`missing-arguments`) - but it still spends the whole month exactly as any other `CAST`
    /// does, so it is read as `MonthLong` rather than dropped. A dropped intent would leave the
    /// unit looking free, and reintroduce the "spare teacher" problem `MonthLong` existed to
    /// avoid in the first place.
    #[test]
    fn a_bare_cast_still_spends_the_month() {
        assert_eq!(intents("unit 5\nCAST\n"), vec![Intent::MonthLong("CAST")]);
    }

    /// A bare BUILD carries on with whatever structure the unit already stands in - it names
    /// nothing.
    #[test]
    fn a_bare_build_names_nothing() {
        assert_eq!(
            intents("unit 5\nBUILD\n"),
            vec![Intent::Build {
                founding: None,
                helping: None
            }]
        );
    }

    /// `BUILD [name]` founds a structure of that type.
    #[test]
    fn building_a_type_is_founding() {
        assert_eq!(
            intents("unit 5\nBUILD Tower\n"),
            vec![Intent::Build {
                founding: Some("Tower".to_string()),
                helping: None
            }]
        );
    }

    /// `COMPLETE` says when the work should finish, not what to build - it must not be read as a
    /// structure name.
    #[test]
    fn building_to_completion_is_not_a_name() {
        assert_eq!(
            intents("unit 5\nBUILD COMPLETE\n"),
            vec![Intent::Build {
                founding: None,
                helping: None
            }]
        );
    }

    /// `BUILD HELP [unit]` works on the structure the helped unit stands in.
    #[test]
    fn building_help_names_the_unit_helped() {
        assert_eq!(
            intents("unit 5\nBUILD HELP 4021\n"),
            vec![Intent::Build {
                founding: None,
                helping: Some(Party::Unit("4021".to_string()))
            }]
        );
    }

    /// `BUILD HELP [unit] COMPLETE` is the same as without `COMPLETE`.
    #[test]
    fn building_help_to_completion() {
        assert_eq!(
            intents("unit 5\nBUILD HELP 4021 COMPLETE\n"),
            vec![Intent::Build {
                founding: None,
                helping: Some(Party::Unit("4021".to_string()))
            }]
        );
    }

    /// `BUILD HELP [new unit]` helps a unit formed this turn - not on the report, so the check
    /// cannot resolve which structure that is, but the order is still readable.
    #[test]
    fn building_help_names_a_new_unit() {
        assert_eq!(
            intents("unit 5\nBUILD HELP NEW 2\n"),
            vec![Intent::Build {
                founding: None,
                helping: Some(Party::New("2".to_string()))
            }]
        );
    }

    /// A token this reader does not account for makes the order unreadable, the same as every
    /// other order here - a trailing word must not be silently dropped.
    #[test]
    fn a_build_with_a_trailing_word_is_unreadable() {
        assert_eq!(intents("unit 5\nBUILD COMPLETE foo\n"), vec![]);
        assert_eq!(intents("unit 5\nBUILD HELP 4021 foo\n"), vec![]);
        assert_eq!(intents("unit 5\nBUILD Tower foo\n"), vec![]);
    }

    /// A TURN block's contents are next month's orders, not this month's. Reading them as though
    /// they were would charge a unit twice and move it out of a hex it is still standing in.
    #[test]
    fn orders_inside_a_turn_block_are_not_this_month() {
        assert_eq!(
            intents(concat!(
                "unit 5\n",
                "WORK\n",
                "TURN\n",
                "MOVE N\n",
                "ENDTURN\n",
            )),
            vec![Intent::Work]
        );
    }

    /// Each closer closes its own kind of block, as in the syntax checker (#95).
    ///
    /// `END` closes a FORM and `ENDTURN` closes a TURN. Counting depth without minding which is
    /// which let a stray `END` close a TURN block, and everything after it - next month's orders -
    /// would have been recorded as this month's.
    #[test]
    fn end_does_not_close_a_turn_block() {
        assert_eq!(
            intents(concat!(
                "unit 5\n",
                "TURN\n",
                "END\n",
                "WORK\n",
                "ENDTURN\n",
            )),
            vec![],
            "everything here is next month's"
        );
    }

    /// And the other way about, so this is a pairing rather than one blunt rule.
    #[test]
    fn endturn_does_not_close_a_form_block() {
        assert_eq!(
            intents(concat!(
                "unit 5\n",
                "FORM 1\n",
                "ENDTURN\n",
                "WORK\n",
                "END\n",
            )),
            vec![Intent::Form {
                alias: "1".to_string()
            }],
            "the FORM itself belongs to the forming unit; everything else here belongs to the unit being formed"
        );
    }

    /// `FORM n` at this month's depth is recorded on the forming unit, so a check can see every
    /// alias a hex hands out this month - the BUY inside the block is still not the unit's own,
    /// which `orders_inside_a_form_block_belong_to_the_unit_being_formed` already pins.
    #[test]
    fn a_form_at_this_months_depth_is_recorded_on_the_forming_unit() {
        let unit = only_unit("unit 5\nFORM 1\nBUY 5 Plainsmen\nEND\n");

        assert_eq!(
            unit.intents
                .iter()
                .map(|placed| placed.intent.clone())
                .collect::<Vec<_>>(),
            vec![Intent::Form {
                alias: "1".to_string()
            }]
        );
        assert_eq!(unit.intents[0].line, 2);
    }

    /// A FORM inside a TURN block is next month's, like everything else in a TURN block.
    #[test]
    fn a_form_inside_a_turn_block_is_not_recorded() {
        assert_eq!(intents("unit 5\nTURN\nFORM 1\nEND\nENDTURN\n"), vec![]);
    }

    /// FORMs nest, and each one hands out its own alias this month.
    #[test]
    fn a_nested_form_is_recorded_too() {
        assert_eq!(
            intents("unit 5\nFORM 1\nFORM 2\nEND\nEND\n"),
            vec![
                Intent::Form {
                    alias: "1".to_string()
                },
                Intent::Form {
                    alias: "2".to_string()
                },
            ]
        );
    }

    /// A FORM block is a different unit's orders, nested inside this one's block. Attributing them
    /// to the forming unit would charge it for what the new unit does.
    #[test]
    fn orders_inside_a_form_block_belong_to_the_unit_being_formed() {
        let units = read_intents(concat!(
            "unit 5\n",
            "WORK\n",
            "FORM 1\n",
            "BUY 5 Plainsmen\n",
            "END\n",
            "TAX\n",
        ));

        assert_eq!(
            units.len(),
            1,
            "the formed unit has no number yet: {units:?}"
        );
        assert_eq!(
            units[0]
                .intents
                .iter()
                .map(|placed| placed.intent.clone())
                .collect::<Vec<_>>(),
            vec![
                Intent::Work,
                Intent::Form {
                    alias: "1".to_string()
                },
                Intent::Tax
            ],
            "the FORM itself belongs to the forming unit; the BUY inside it does not"
        );
    }
}
