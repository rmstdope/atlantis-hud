//! Every order the NewOrigins ruleset accepts, and the shapes its arguments may take.
//!
//! Written by hand from the rules page's own Order Summary rather than scraped from it, which is a
//! deliberate departure from how movement costs and the item catalogue are obtained. Those are
//! *game* data: two servers running different games disagree about them, so a table compiled into
//! the source would be confidently wrong. Order syntax is *engine* data - it changes when the engine
//! changes, which is to say rarely - and the Order Summary is prose interleaved with worked
//! examples, so scraping it reliably costs more than it saves.
//!
//! Where the rules leave an argument open, so does this table. [`Arg::Tail`] means "the rules do not
//! say", and it accepts anything, including nothing. That is the accept-on-doubt policy made
//! concrete: a `CAST` whose arguments depend on the spell must not be guessed at.

use super::items::is_known_item;
use super::lexer::{Token, TokenKind};
use crate::movement::graph::Direction;
use crate::movement::rules::Ruleset;

/// One argument position in an order's signature.
///
/// A single `Arg` may consume more than one token: `[unit]` alone can be written `17`, `NEW 2`, or
/// `FACTION 15 NEW 2`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arg {
    /// This literal keyword, case-insensitively.
    Kw(&'static str),
    /// Any one of these keywords.
    OneOf(&'static [&'static str]),
    /// A unit: a number, `NEW [alias]`, or `FACTION [faction] NEW [alias]`.
    Unit,
    /// A faction number.
    Faction,
    /// An object number - a building or a fleet.
    Object,
    /// A plain number: a quantity, an amount, a level, an alias.
    Number,
    /// `0` or `1`, which is what the rules mean by `[flag]`.
    Flag,
    /// An item, by tag or by name. Checked against the catalogue when there is one, as a warning.
    Item,
    /// One of the classes the rules enumerate for `GIVE [unit] ALL [item class]`.
    ItemClass,
    /// A skill or spell name. Shape only - the ruleset carries no skill catalogue.
    Skill,
    /// One step of a MOVE: a direction, `IN`, `OUT`, or a structure number.
    MoveStep,
    /// A single-token name.
    Name,
    /// Everything left on the line, whatever it is, including nothing at all.
    Tail,
    /// One or more of the argument this points at.
    Rest(&'static Arg),
}

/// An order and every form the rules give for it.
#[derive(Debug, Clone, Copy)]
pub struct Order {
    pub name: &'static str,
    pub forms: &'static [&'static [Arg]],
}

/// The classes `GIVE [unit] ALL [item class]` accepts, enumerated by the rules page.
pub const ITEM_CLASSES: &[&str] = &[
    "NORMAL", "ADVANCED", "TRADE", "MAN", "MEN", "MONSTER", "MONSTERS", "MAGIC", "WEAPON",
    "WEAPONS", "ARMOR", "MOUNT", "MOUNTS", "BATTLE", "SPECIAL", "TOOL", "TOOLS", "FOOD", "SHIP",
    "SHIPS", "ITEM", "ITEMS",
];

/// The attitudes a faction may declare. "Ally, Friendly, Neutral, Unfriendly or Hostile."
const ATTITUDES: &[&str] = &["ALLY", "FRIENDLY", "NEUTRAL", "UNFRIENDLY", "HOSTILE"];

/// "The valid values for type are 'NONE', 'WALK', 'RIDE', 'FLY', 'SWIM', 'SAIL' or 'ALL'."
const SPOILS: &[&str] = &["NONE", "WALK", "RIDE", "FLY", "SWIM", "SAIL", "ALL"];

/// What `DESCRIBE` may describe.
const DESCRIBABLE: &[&str] = &["UNIT", "SHIP", "BUILDING", "OBJECT", "STRUCTURE"];

/// What `NAME` may rename.
const NAMEABLE: &[&str] = &["UNIT", "FACTION", "OBJECT", "CITY"];

/// The orders, in the order the rules page lists them.
///
/// Four names that this table does *not* carry were in the vocabulary it replaces: `ENDFORM`,
/// `SWEAR`, `NOSPOILS` and `WISHDRAW`. None of them appears anywhere in the NewOrigins rules. Two
/// that it gains were missing: `END`, which closes a `FORM` block - so every correct `FORM` was
/// being reported as an unknown command - and `DISTRIBUTE`, which the rules say is `TRANSPORT` under
/// another name "for historical reasons".
pub const GRAMMAR: &[Order] = &[
    Order {
        name: "ADDRESS",
        forms: &[&[Arg::Name, Arg::Tail]],
    },
    Order {
        name: "ADVANCE",
        forms: &[&[Arg::Rest(&Arg::MoveStep)]],
    },
    Order {
        name: "ANNIHILATE",
        forms: &[
            &[Arg::Kw("REGION"), Arg::Number, Arg::Number, Arg::Number],
            &[Arg::Kw("REGION"), Arg::Number, Arg::Number],
        ],
    },
    Order {
        name: "ARMOR",
        forms: &[&[Arg::Rest(&Arg::Item)], &[]],
    },
    Order {
        name: "ASSASSINATE",
        forms: &[&[Arg::Unit]],
    },
    Order {
        name: "ATTACK",
        forms: &[&[Arg::Rest(&Arg::Unit)]],
    },
    Order {
        name: "AUTOTAX",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "AVOID",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "BEHIND",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "BUILD",
        forms: &[
            &[Arg::Kw("HELP"), Arg::Unit, Arg::Kw("COMPLETE")],
            &[Arg::Kw("HELP"), Arg::Unit],
            &[Arg::Kw("COMPLETE")],
            &[Arg::Name, Arg::Kw("COMPLETE")],
            &[Arg::Name],
            &[],
        ],
    },
    Order {
        name: "BUY",
        forms: &[&[Arg::Kw("ALL"), Arg::Item], &[Arg::Number, Arg::Item]],
    },
    Order {
        name: "CAST",
        forms: &[&[Arg::Skill, Arg::Tail]],
    },
    Order {
        name: "CLAIM",
        forms: &[&[Arg::Number]],
    },
    Order {
        name: "COMBAT",
        forms: &[&[Arg::Skill], &[]],
    },
    Order {
        name: "CONSUME",
        forms: &[&[Arg::OneOf(&["UNIT", "FACTION"])], &[]],
    },
    Order {
        name: "DECLARE",
        forms: &[
            &[Arg::Kw("DEFAULT"), Arg::OneOf(ATTITUDES)],
            &[Arg::Faction, Arg::OneOf(ATTITUDES)],
            &[Arg::Faction],
        ],
    },
    Order {
        name: "DESCRIBE",
        forms: &[&[Arg::OneOf(DESCRIBABLE), Arg::Tail]],
    },
    Order {
        name: "DESTROY",
        forms: &[&[]],
    },
    Order {
        name: "DISTRIBUTE",
        forms: TRANSPORT_FORMS,
    },
    Order {
        name: "END",
        forms: &[&[]],
    },
    Order {
        name: "ENDTURN",
        forms: &[&[]],
    },
    Order {
        name: "ENTER",
        forms: &[&[Arg::Object]],
    },
    Order {
        name: "ENTERTAIN",
        forms: &[&[]],
    },
    Order {
        name: "EVICT",
        forms: &[&[Arg::Rest(&Arg::Unit)]],
    },
    Order {
        name: "EXCHANGE",
        forms: &[&[Arg::Unit, Arg::Number, Arg::Item, Arg::Number, Arg::Item]],
    },
    Order {
        // "FACTION [type] [points] ..." - the pairs repeat, and which types exist is a game setting.
        name: "FACTION",
        forms: &[&[Arg::Name, Arg::Number, Arg::Tail]],
    },
    Order {
        // FIND is in the engine's sequence of events but has no entry in the Order Summary, so there
        // is no documented shape to hold it to.
        name: "FIND",
        forms: &[&[Arg::Tail]],
    },
    Order {
        name: "FORGET",
        forms: &[&[Arg::Skill]],
    },
    Order {
        name: "FORM",
        forms: &[&[Arg::Number]],
    },
    Order {
        name: "GIVE",
        forms: &[
            &[Arg::Unit, Arg::Kw("UNIT")],
            &[
                Arg::Unit,
                Arg::Kw("ALL"),
                Arg::Item,
                Arg::Kw("EXCEPT"),
                Arg::Number,
            ],
            &[Arg::Unit, Arg::Kw("ALL"), Arg::ItemClass],
            &[Arg::Unit, Arg::Kw("ALL"), Arg::Item],
            &[Arg::Unit, Arg::Number, Arg::Item],
        ],
    },
    Order {
        name: "GUARD",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "HOLD",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "IDLE",
        forms: &[&[]],
    },
    Order {
        name: "JOIN",
        forms: &[
            &[Arg::Unit, Arg::OneOf(&["NOOVERLOAD", "MERGE"])],
            &[Arg::Unit],
        ],
    },
    Order {
        name: "LEAVE",
        forms: &[&[]],
    },
    Order {
        name: "MOVE",
        forms: &[&[Arg::Rest(&Arg::MoveStep)]],
    },
    Order {
        name: "NAME",
        forms: &[&[Arg::OneOf(NAMEABLE), Arg::Tail]],
    },
    Order {
        name: "NOAID",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "NOCROSS",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "OPTION",
        forms: &[
            &[
                Arg::Kw("TEMPLATE"),
                Arg::OneOf(&["OFF", "SHORT", "LONG", "MAP"]),
            ],
            &[Arg::OneOf(&[
                "TIMES",
                "NOTIMES",
                "SHOWATTITUDES",
                "DONTSHOWATTITUDES",
            ])],
        ],
    },
    Order {
        name: "PASSWORD",
        forms: &[&[Arg::Name], &[]],
    },
    Order {
        name: "PILLAGE",
        forms: &[&[]],
    },
    Order {
        name: "PREPARE",
        forms: &[&[Arg::Item]],
    },
    Order {
        name: "PRODUCE",
        forms: &[&[Arg::Number, Arg::Item], &[Arg::Item]],
    },
    Order {
        name: "PROMOTE",
        forms: &[&[Arg::Unit]],
    },
    Order {
        name: "QUIT",
        forms: &[&[Arg::Name]],
    },
    Order {
        name: "RESTART",
        forms: &[&[Arg::Name]],
    },
    Order {
        name: "REVEAL",
        forms: &[&[Arg::OneOf(&["UNIT", "FACTION"])], &[]],
    },
    Order {
        name: "SACRIFICE",
        forms: &[&[Arg::Number, Arg::Item]],
    },
    Order {
        // "SAIL" with no direction is a form of its own, and the turn 71 template uses it.
        name: "SAIL",
        forms: &[&[Arg::Rest(&Arg::MoveStep)], &[]],
    },
    Order {
        name: "SELL",
        forms: &[&[Arg::Kw("ALL"), Arg::Item], &[Arg::Number, Arg::Item]],
    },
    Order {
        name: "SHARE",
        forms: &[&[Arg::Flag]],
    },
    Order {
        name: "SHOW",
        forms: &[
            &[Arg::Kw("SKILL"), Arg::Skill, Arg::Number],
            &[Arg::Kw("ITEM"), Arg::Item],
            &[Arg::Kw("OBJECT"), Arg::Name],
        ],
    },
    Order {
        name: "SPOILS",
        forms: &[&[Arg::OneOf(SPOILS)], &[]],
    },
    Order {
        name: "STEAL",
        forms: &[&[Arg::Unit, Arg::Item]],
    },
    Order {
        name: "STUDY",
        forms: &[&[Arg::Skill, Arg::Number], &[Arg::Skill]],
    },
    Order {
        name: "TAKE",
        forms: &[
            &[
                Arg::Kw("FROM"),
                Arg::Unit,
                Arg::Kw("ALL"),
                Arg::Item,
                Arg::Kw("EXCEPT"),
                Arg::Number,
            ],
            &[Arg::Kw("FROM"), Arg::Unit, Arg::Kw("ALL"), Arg::ItemClass],
            &[Arg::Kw("FROM"), Arg::Unit, Arg::Kw("ALL"), Arg::Item],
            &[Arg::Kw("FROM"), Arg::Unit, Arg::Number, Arg::Item],
        ],
    },
    Order {
        name: "TAX",
        forms: &[&[]],
    },
    Order {
        name: "TEACH",
        forms: &[&[Arg::Rest(&Arg::Unit)]],
    },
    Order {
        name: "TRANSPORT",
        forms: TRANSPORT_FORMS,
    },
    Order {
        name: "TURN",
        forms: &[&[]],
    },
    Order {
        name: "WEAPON",
        forms: &[&[Arg::Rest(&Arg::Item)], &[]],
    },
    Order {
        name: "WITHDRAW",
        forms: &[&[Arg::Number, Arg::Item], &[Arg::Item]],
    },
    Order {
        name: "WORK",
        forms: &[&[]],
    },
];

/// Shared by TRANSPORT and DISTRIBUTE, which "has the same meaning and syntax".
const TRANSPORT_FORMS: &[&[Arg]] = &[
    &[
        Arg::Unit,
        Arg::Kw("ALL"),
        Arg::Item,
        Arg::Kw("EXCEPT"),
        Arg::Number,
    ],
    &[Arg::Unit, Arg::Kw("ALL"), Arg::Item],
    &[Arg::Unit, Arg::Number, Arg::Item],
];

/// Every order name, for callers that only need the vocabulary.
#[must_use]
pub fn order_commands() -> Vec<&'static str> {
    GRAMMAR.iter().map(|order| order.name).collect()
}

/// The order this keyword names, if the ruleset has one.
#[must_use]
pub fn find_order(command: &str) -> Option<&'static Order> {
    GRAMMAR
        .iter()
        .find(|order| order.name.eq_ignore_ascii_case(command))
}

/// An item argument the catalogue did not recognise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownItem {
    pub text: String,
    pub column_start: usize,
    pub column_end: usize,
}

/// Why a form did not match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mismatch {
    /// Index into the argument tokens where the match ran out. Higher is a closer match.
    pub at: usize,
    /// What was wanted there, phrased for a player.
    pub expected: String,
    /// Whether the line simply ended, as opposed to carrying the wrong thing.
    pub missing: bool,
}

/// Matches an order's arguments against every form it has.
///
/// `arguments` excludes the command itself. On success, returns the item arguments the catalogue did
/// not recognise - a warning, not a refusal. On failure, returns the mismatch from the form that got
/// furthest, because that is the form the player was most plausibly trying to write.
pub fn match_order(
    order: &Order,
    arguments: &[Token],
    ruleset: Option<&Ruleset>,
) -> Result<Vec<UnknownItem>, Mismatch> {
    let mut furthest: Vec<Mismatch> = Vec::new();

    for form in order.forms {
        match match_form(form, arguments, ruleset) {
            Ok(unknown) => return Ok(unknown),
            Err(mismatch) => {
                // The forms that consumed the most tokens before failing are the ones the player was
                // most plausibly writing, so theirs are the complaints worth showing. Several forms
                // often die in the same place wanting different things - `GIVE 4573 ...` may go on
                // with `UNIT`, `ALL` or a quantity - and naming all three beats picking one and
                // sending the player to look up the other two.
                let best = furthest.first().map_or(0, |best| best.at);
                if furthest.is_empty() || mismatch.at > best {
                    furthest.clear();
                    furthest.push(mismatch);
                } else if mismatch.at == best {
                    furthest.push(mismatch);
                }
            }
        }
    }

    Err(merge(furthest))
}

/// Folds the equally-close mismatches into one complaint naming every way forward.
fn merge(mismatches: Vec<Mismatch>) -> Mismatch {
    let mut merged = mismatches
        .into_iter()
        .reduce(|mut left, right| {
            if !left
                .expected
                .split(" or ")
                .any(|part| part == right.expected)
            {
                left.expected = format!("{} or {}", left.expected, right.expected);
            }
            // Running out of line is running out of line whichever form noticed first.
            left.missing = left.missing && right.missing;
            left
        })
        .expect("every order has at least one form");

    // "no more arguments" is not an alternative to anything; when some other form wanted a real
    // argument in the same place, that is the useful half of the message.
    if merged.expected.contains(" or ") {
        let parts: Vec<&str> = merged
            .expected
            .split(" or ")
            .filter(|part| *part != "no more arguments")
            .collect();
        if !parts.is_empty() {
            merged.expected = parts.join(" or ");
        }
    }

    merged
}

fn match_form(
    form: &[Arg],
    arguments: &[Token],
    ruleset: Option<&Ruleset>,
) -> Result<Vec<UnknownItem>, Mismatch> {
    let mut unknown = Vec::new();
    let mut at = 0;

    for argument in form {
        at = match_arg(argument, arguments, at, ruleset, &mut unknown)?;
    }

    if at < arguments.len() {
        return Err(Mismatch {
            at,
            expected: "no more arguments".to_string(),
            missing: false,
        });
    }

    Ok(unknown)
}

/// Matches one argument, returning where the next one starts.
fn match_arg(
    argument: &Arg,
    arguments: &[Token],
    at: usize,
    ruleset: Option<&Ruleset>,
    unknown: &mut Vec<UnknownItem>,
) -> Result<usize, Mismatch> {
    // Consumes everything left, and is content with nothing left.
    if matches!(argument, Arg::Tail) {
        return Ok(arguments.len());
    }

    if let Arg::Rest(inner) = argument {
        let mut next = match_arg(inner, arguments, at, ruleset, unknown)?;
        while next < arguments.len() {
            next = match_arg(inner, arguments, next, ruleset, unknown)?;
        }
        return Ok(next);
    }

    let Some(token) = arguments.get(at) else {
        return Err(Mismatch {
            at,
            expected: describe(argument),
            missing: true,
        });
    };

    let consumed = match argument {
        Arg::Kw(keyword) => usize::from(token.is(keyword)),
        Arg::OneOf(keywords) => usize::from(keywords.iter().any(|keyword| token.is(keyword))),
        Arg::ItemClass => usize::from(ITEM_CLASSES.iter().any(|class| token.is(class))),
        Arg::Unit => match_unit(arguments, at),
        Arg::Faction | Arg::Object | Arg::Number => usize::from(token.kind == TokenKind::Number),
        Arg::Flag => usize::from(token.text == "0" || token.text == "1"),
        Arg::MoveStep => usize::from(
            Direction::parse(&token.text).is_some()
                || token.is("in")
                || token.is("out")
                || token.kind == TokenKind::Number,
        ),
        Arg::Item => {
            if let Some(ruleset) = ruleset {
                if !is_known_item(&token.text, ruleset) {
                    unknown.push(UnknownItem {
                        text: token.text.clone(),
                        column_start: token.column_start,
                        column_end: token.column_end,
                    });
                }
            }
            1
        }
        // A skill or a name is whatever single token the player wrote; nothing here can tell a real
        // one from a typo, and guessing would reject spells this parser has never heard of.
        Arg::Skill | Arg::Name => 1,
        Arg::Tail | Arg::Rest(_) => unreachable!("handled above"),
    };

    if consumed == 0 {
        return Err(Mismatch {
            at,
            expected: describe(argument),
            missing: false,
        });
    }

    Ok(at + consumed)
}

/// How many tokens a unit reference takes, or zero when this is not one.
///
/// "To specify a [unit], use the unit number. If specifying a unit that will be created this turn,
/// use the form `NEW #` if the unit belongs to your faction, or `FACTION # NEW #` if the unit belongs
/// to a different faction."
fn match_unit(arguments: &[Token], at: usize) -> usize {
    let token = &arguments[at];

    if token.is("faction") {
        let is_foreign_alias = arguments
            .get(at + 1)
            .is_some_and(|faction| faction.kind == TokenKind::Number)
            && arguments.get(at + 2).is_some_and(|new| new.is("new"))
            && arguments
                .get(at + 3)
                .is_some_and(|alias| alias.kind == TokenKind::Number);
        return if is_foreign_alias { 4 } else { 0 };
    }

    if token.is("new") {
        let has_alias = arguments
            .get(at + 1)
            .is_some_and(|alias| alias.kind == TokenKind::Number);
        return if has_alias { 2 } else { 0 };
    }

    // Unit 0 is the game's own, which is how an order discards items.
    usize::from(token.kind == TokenKind::Number)
}

/// What to call an argument when telling a player it is missing or wrong.
fn describe(argument: &Arg) -> String {
    match argument {
        Arg::Kw(keyword) => (*keyword).to_string(),
        Arg::OneOf(keywords) => keywords.join(", "),
        // Not the list: twenty-two class names across a diagnostic drowns the message they are
        // attached to, and this expectation only ever appears beside "an item" anyway.
        Arg::ItemClass => "an item class".to_string(),
        Arg::Unit => "a unit number".to_string(),
        Arg::Faction => "a faction number".to_string(),
        Arg::Object => "an object number".to_string(),
        Arg::Number => "a number".to_string(),
        Arg::Flag => "0 or 1".to_string(),
        Arg::Item => "an item".to_string(),
        Arg::Skill => "a skill".to_string(),
        Arg::MoveStep => "a direction, IN, OUT or a structure number".to_string(),
        Arg::Name => "a name".to_string(),
        Arg::Tail => "anything".to_string(),
        Arg::Rest(inner) => describe(inner),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_names_each_order_once() {
        let mut names: Vec<&str> = order_commands();
        names.sort_unstable();
        let mut deduplicated = names.clone();
        deduplicated.dedup();
        assert_eq!(names, deduplicated, "an order is listed twice");
    }

    #[test]
    fn the_table_is_alphabetical_so_it_can_be_read_against_the_rules_page() {
        let names = order_commands();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
    }

    #[test]
    fn every_order_has_at_least_one_form() {
        for order in GRAMMAR {
            assert!(!order.forms.is_empty(), "{} has no forms", order.name);
        }
    }

    /// The vocabulary this table replaces carried four orders the ruleset has no such thing as, and
    /// was missing two it does.
    #[test]
    fn the_vocabulary_is_corrected() {
        for invented in ["ENDFORM", "SWEAR", "NOSPOILS", "WISHDRAW"] {
            assert!(find_order(invented).is_none(), "{invented} is not an order");
        }
        for real in ["END", "DISTRIBUTE"] {
            assert!(find_order(real).is_some(), "{real} is an order");
        }
    }

    #[test]
    fn an_order_is_found_whatever_its_case() {
        assert_eq!(find_order("give").map(|order| order.name), Some("GIVE"));
        assert_eq!(find_order("Give").map(|order| order.name), Some("GIVE"));
        assert!(find_order("fly").is_none());
    }
}
