//! The shapes an order's arguments come in, read once for everyone who reads them.
//!
//! Three modules in this directory ask the same questions of the same tokens. [`super::grammar`]
//! asks "is this a legal unit reference" to check a line's shape; [`super::intents`] asks "which
//! unit is it" to record what a player asked for; [`super::effects`] asks the same to work out
//! what next month's rows look like. They used to answer separately, which meant the
//! unit-reference grammar was written out three times and the `GIVE` forms twice, and a fix to
//! either could land in one place and be complete in none - with no test anywhere to say so.
//!
//! So the answers live here. What stays with each caller is what it does with them: `grammar`
//! counts tokens, `intents` records, `effects` resolves and applies.
//!
//! These readers are **strict**: an order that does not consume its arguments exactly is
//! unreadable, and unreadable means nothing at all rather than a best guess. That is the same
//! answer the syntax checker gives, which is the point - a line the editor is underlining in red
//! should not also be quietly previewed as though the server would run it.

use super::lexer::{Token, TokenKind};
use crate::movement::orders::{parse_move, MoveStep};

/// How much of something an order names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Amount {
    /// A plain count: `GIVE 42 100 SILV`.
    Exact(i64),
    /// `ALL`, less an `EXCEPT` reserve where one is written.
    All { except: i64 },
}

/// What a transfer moves: one named item, or a whole class of them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selector {
    /// An item as the order wrote it - a tag, a name, or a plural. Resolving it needs a catalogue.
    Item(String),
    /// One of the classes the rules enumerate, as in `GIVE 42 ALL ITEMS`.
    Class(String),
    /// `GIVE 42 UNIT`, which hands over the unit itself rather than anything it holds.
    WholeUnit,
}

/// Who an order names on its other side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Party {
    /// An existing unit, by number.
    Unit(String),
    /// A unit formed this turn, by alias. Its contents are not known from the report.
    New(String),
    /// Another faction's new unit.
    Foreign { faction: String, alias: String },
    /// Unit zero, which is the game's way of destroying something.
    Discard,
}

/// A unit as an order names it: `17`, `NEW 2`, or `FACTION 15 NEW 2`. Returns what is left.
pub(super) fn read_party(tokens: &[Token]) -> Option<(Party, &[Token])> {
    let (first, rest) = tokens.split_first()?;

    if first.is("FACTION") {
        let (faction, rest) = rest
            .split_first()
            .filter(|(f, _)| f.kind == TokenKind::Number)?;
        let rest = rest.split_first().filter(|(kw, _)| kw.is("NEW"))?.1;
        let (alias, rest) = rest
            .split_first()
            .filter(|(a, _)| a.kind == TokenKind::Number)?;
        return Some((
            Party::Foreign {
                faction: faction.text.clone(),
                alias: alias.text.clone(),
            },
            rest,
        ));
    }

    if first.is("NEW") {
        let (alias, rest) = rest
            .split_first()
            .filter(|(a, _)| a.kind == TokenKind::Number)?;
        return Some((Party::New(alias.text.clone()), rest));
    }

    if first.kind != TokenKind::Number {
        return None;
    }
    // "GIVE 0" destroys what is given rather than handing it to a unit numbered zero. Any way of
    // writing zero counts, because the lexer will hand over whatever the player typed.
    if first.text.trim_start_matches('0').is_empty() {
        return Some((Party::Discard, rest));
    }
    Some((Party::Unit(first.text.clone()), rest))
}

/// How many tokens a unit reference occupies, or zero when the tokens do not make one.
///
/// The shape checker's view of [`read_party`]. Deriving it rather than spelling the shapes out a
/// second time is what stops the validator accepting a form the readers silently drop.
pub(super) fn unit_token_count(tokens: &[Token]) -> usize {
    read_party(tokens).map_or(0, |(_, rest)| tokens.len() - rest.len())
}

/// The `[quantity] [item]` half of a transfer, in all the forms the rules give it.
pub(super) fn read_transfer(tokens: &[Token]) -> Option<(Selector, Amount)> {
    // `GIVE 75 UNIT` hands over the unit itself.
    if tokens.len() == 1 && tokens[0].is("UNIT") {
        return Some((Selector::WholeUnit, Amount::All { except: 0 }));
    }

    let (amount, rest) = read_amount(tokens)?;
    let (item, rest) = rest.split_first()?;

    // `ALL [item] EXCEPT [n]` keeps a reserve back. Only the ALL form takes one.
    let amount = match (amount, rest) {
        (Amount::All { .. }, [keyword, reserve]) if keyword.is("EXCEPT") => Amount::All {
            except: read_number(reserve)?,
        },
        (amount, []) => amount,
        _ => return None,
    };

    let selector = if is_item_class(&item.text) {
        Selector::Class(item.text.clone())
    } else {
        Selector::Item(item.text.clone())
    };
    Some((selector, amount))
}

/// `ALL`, or a plain count. Returns what is left.
pub(super) fn read_amount(tokens: &[Token]) -> Option<(Amount, &[Token])> {
    let (first, rest) = tokens.split_first()?;
    if first.is("ALL") {
        return Some((Amount::All { except: 0 }, rest));
    }
    Some((Amount::Exact(read_number(first)?), rest))
}

/// A count, which the lexer calls a number only when it is all digits.
///
/// So `-1` and `+2` are words, and an order carrying one is unreadable rather than being handed to
/// `parse` - which would accept both and, after `EXCEPT -1`, keep back minus one sword.
fn read_number(token: &Token) -> Option<i64> {
    (token.kind == TokenKind::Number)
        .then(|| token.text.parse().ok())
        .flatten()
}

pub(super) fn read_only_number(tokens: &[Token]) -> Option<i64> {
    match tokens {
        [only] => read_number(only),
        _ => None,
    }
}

/// The `0` or `1` of a `[flag]` argument, read from one token.
///
/// Literally those two, not "any number that parses to them": `GUARD 01` is an order the game does
/// not have, and reading it as `GUARD 1` would apply a flag the server refuses to set.
pub(super) fn flag_value(token: &Token) -> Option<bool> {
    match token.text.as_str() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

pub(super) fn read_flag(tokens: &[Token]) -> Option<bool> {
    match tokens {
        [only] => flag_value(only),
        _ => None,
    }
}

/// The route a `MOVE` or `ADVANCE` order describes.
///
/// Rebuilt from the lexed tokens rather than read from the raw line, so a trailing comment cannot
/// make the order unreadable - which would quietly preview a unit as staying put.
pub(super) fn read_move_line(command: &Token, arguments: &[Token]) -> Option<Vec<MoveStep>> {
    let line = std::iter::once(command)
        .chain(arguments)
        .map(|token| token.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    parse_move(&line)
}

/// Whether a transfer names a whole class of items rather than one of them.
///
/// Checked against the rules page's own list rather than against the item catalogue: a class is
/// engine vocabulary and is there whether or not a ruleset has been loaded.
pub(super) fn is_item_class(text: &str) -> bool {
    super::grammar::ITEM_CLASSES
        .iter()
        .any(|class| class.eq_ignore_ascii_case(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orders::lexer::lex_line;

    /// The arguments of one order line, which is what every reader here takes.
    fn arguments(line: &str) -> Vec<Token> {
        lex_line(line)
            .tokens
            .split_first()
            .expect("a command")
            .1
            .to_vec()
    }

    /// How many tokens a unit reference occupies, which is the answer the shape checker uses.
    ///
    /// Tested here rather than only through `grammar`, because the counts are what the whole
    /// form-ranking heuristic is built on: a form that consumes four tokens where it should
    /// consume none gets ranked as having got further than one that really did.
    #[test]
    fn a_unit_reference_is_counted_by_the_form_it_takes() {
        assert_eq!(unit_token_count(&arguments("GIVE 17 1 SWOR")), 1);
        assert_eq!(unit_token_count(&arguments("GIVE NEW 2 1 SWOR")), 2);
        assert_eq!(
            unit_token_count(&arguments("GIVE FACTION 15 NEW 2 1 SWOR")),
            4
        );
        // Unit zero is still one token; what it *means* is the reader's business, not the count's.
        assert_eq!(unit_token_count(&arguments("GIVE 0 ALL SWOR")), 1);
    }

    /// Zero, not a partial count, for every shape that is not a unit reference.
    ///
    /// This is the case the validator's message depends on: zero becomes a mismatch *at* this
    /// argument, and a partial count would move the mismatch along and change which form the
    /// parser decides got furthest.
    #[test]
    fn tokens_that_are_not_a_unit_reference_count_as_none() {
        assert_eq!(unit_token_count(&arguments("GIVE swords")), 0);
        assert_eq!(
            unit_token_count(&arguments("GIVE NEW")),
            0,
            "an alias is required"
        );
        assert_eq!(
            unit_token_count(&arguments("GIVE NEW x")),
            0,
            "and it is a number"
        );
        assert_eq!(unit_token_count(&arguments("GIVE FACTION 14 NEW")), 0);
        assert_eq!(unit_token_count(&arguments("GIVE FACTION 14 NEW x")), 0);
        assert_eq!(unit_token_count(&arguments("GIVE FACTION x NEW 2")), 0);
        assert_eq!(unit_token_count(&[]), 0);
    }

    #[test]
    fn every_way_of_writing_unit_zero_is_a_discard() {
        for written in ["0", "00", "000"] {
            let line = format!("GIVE {written} 1 SWOR");
            assert_eq!(
                read_party(&arguments(&line)).map(|(party, _)| party),
                Some(Party::Discard),
                "{line}"
            );
        }
    }

    #[test]
    fn a_transfer_reads_every_form_the_rules_give_it() {
        let read = |line: &str| read_transfer(&arguments(line)[1..]);

        assert_eq!(
            read("GIVE 17 10 SWOR"),
            Some((Selector::Item("SWOR".to_string()), Amount::Exact(10)))
        );
        assert_eq!(
            read("GIVE 17 ALL SWOR"),
            Some((
                Selector::Item("SWOR".to_string()),
                Amount::All { except: 0 }
            ))
        );
        assert_eq!(
            read("GIVE 17 ALL SWOR EXCEPT 2"),
            Some((
                Selector::Item("SWOR".to_string()),
                Amount::All { except: 2 }
            ))
        );
        assert_eq!(
            read("GIVE 17 ALL ITEMS"),
            Some((
                Selector::Class("ITEMS".to_string()),
                Amount::All { except: 0 }
            ))
        );
        assert_eq!(
            read("GIVE 17 UNIT"),
            Some((Selector::WholeUnit, Amount::All { except: 0 }))
        );
    }

    /// The strictness the whole module exists to make uniform: an order that does not consume its
    /// arguments exactly is unreadable, and so is one whose numbers the lexer did not call numbers.
    #[test]
    fn a_transfer_that_does_not_consume_its_arguments_is_unreadable() {
        let read = |line: &str| read_transfer(&arguments(line)[1..]);

        assert_eq!(read("GIVE 17 10 SWOR junk"), None, "a trailing token");
        assert_eq!(
            read("GIVE 17 10 SWOR EXCEPT 1"),
            None,
            "EXCEPT belongs to ALL"
        );
        assert_eq!(read("GIVE 17 ALL SWOR EXCEPT 1 junk"), None);
        assert_eq!(
            read("GIVE 17 ALL SWOR EXCEPT x"),
            None,
            "a reserve that is not a number"
        );
        assert_eq!(
            read("GIVE 17 ALL SWOR EXCEPT -1"),
            None,
            "nor a negative one"
        );
        assert_eq!(read("GIVE 17 SWOR"), None, "a quantity is required");
    }

    #[test]
    fn a_flag_is_the_literal_zero_or_one() {
        assert_eq!(read_flag(&arguments("GUARD 1")), Some(true));
        assert_eq!(read_flag(&arguments("GUARD 0")), Some(false));
        assert_eq!(
            read_flag(&arguments("GUARD 01")),
            None,
            "not a number that parses to one"
        );
        assert_eq!(read_flag(&arguments("GUARD 2")), None);
        assert_eq!(read_flag(&arguments("GUARD 1 junk")), None);
        assert_eq!(read_flag(&arguments("GUARD")), None);
    }

    /// A trailing comment must not make a movement order unreadable, which is the whole reason the
    /// line is rebuilt from the lexed tokens rather than read raw.
    #[test]
    fn a_move_reads_through_its_comment() {
        let lexed = lex_line("MOVE N NE ;to the coast");
        let (command, rest) = lexed.tokens.split_first().expect("a command");

        assert_eq!(
            read_move_line(command, rest),
            crate::movement::orders::parse_move("MOVE N NE")
        );
        assert!(read_move_line(command, rest).is_some());
    }
}
