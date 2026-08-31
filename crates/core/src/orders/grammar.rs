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

use super::lexer::{lex_line, Token, TokenKind};
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
    /// One or more of the argument this points at; every remaining token must match, or the whole
    /// form does. Used for the movement forms, where a bad route step is a mistake worth naming
    /// rather than a place to stop reading.
    Rest(&'static Arg),
    /// One or more of the argument this points at, like [`Arg::Rest`], but stopping at the first
    /// token that does not match rather than failing the form: `EVICT 415 698 note` reads two
    /// units and leaves `note` as trailing text. The first value is still required.
    Repeat(&'static Arg),
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
        forms: &[&[Arg::Repeat(&Arg::Unit)]],
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
        forms: &[&[Arg::Repeat(&Arg::Unit)]],
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
        // FIND is in the engine's sequence of events but has no entry in the Order Summary, so
        // there is no documented shape to hold it to. The engine observation on ah-86vk is that it
        // consumes one faction number and ignores whatever follows.
        name: "FIND",
        forms: &[&[Arg::Faction]],
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
        forms: &[&[Arg::Repeat(&Arg::Unit)]],
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

/// The order the caret is inside, and every argument that may stand at the caret across its forms.
///
/// `line_prefix` is one order line from its first character up to the caret, the caret's own
/// half-typed word included: the position is worked out from the complete words before it, and the
/// half-typed word is what the shell filters the answer by.
///
/// `None` in the command position, inside a comment or an unclosed quote, or for an order the table
/// does not have. The `Arg`s are de-duplicated in form order: several forms often agree on what may
/// stand next, and each is worth answering only once.
pub(super) fn arguments_at_caret(line_prefix: &str) -> Option<(&'static Order, Vec<&'static Arg>)> {
    match caret_at(line_prefix).shape {
        CaretShape::InOrder(order, offered) => Some((order, offered)),
        _ => None,
    }
}

/// Which position one order line's caret is in.
pub(super) enum CaretShape {
    /// Inside a comment or an unterminated quote, or after a command the table does not have.
    Nowhere,
    /// The first word of the line, behind any indentation and an optional `@`.
    Command,
    /// After the command, with every argument that may stand at the caret across its forms.
    InOrder(&'static Order, Vec<&'static Arg>),
}

/// Where the caret is, and the word being typed there if one is.
pub(super) struct Caret {
    pub shape: CaretShape,
    /// The token the caret is inside. `None` when the prefix ends in whitespace or a closing `"`:
    /// unlike a bare word, `"` is unambiguous, so the token it ends is complete and the caret is
    /// already in the next position.
    pub word: Option<Token>,
}

/// Where the caret is in one order line, and what the grammar allows there - from **one** lexing,
/// because everything asked about a caret is asked on the same keystroke (ah-vfq).
///
/// `line_prefix` is one order line from its first character up to the caret, the caret's own
/// half-typed word included: the position is worked out from the complete words before it, and the
/// half-typed word is what the shell filters the answer by.
pub(super) fn caret_at(line_prefix: &str) -> Caret {
    let lexed = lex_line(line_prefix);
    if lexed.comment.is_some() || lexed.unterminated_quote.is_some() {
        return Caret {
            shape: CaretShape::Nowhere,
            word: None,
        };
    }

    let mut tokens = lexed.tokens;
    // The last token is still being typed. A half-typed word says nothing about which position
    // the caret is in, so it is dropped before counting the position. A closing quote is not
    // this case, for the reason `Caret::word` gives.
    let typing = !line_prefix.ends_with(char::is_whitespace) && !line_prefix.ends_with('"');
    let word = if typing { tokens.pop() } else { None };

    // Nothing typed yet: the caret is in the command position, which `order_commands` answers.
    let Some((command, arguments)) = tokens.split_first() else {
        return Caret {
            shape: CaretShape::Command,
            word,
        };
    };
    let Some(order) = find_order(&command.text) else {
        return Caret {
            shape: CaretShape::Nowhere,
            word,
        };
    };

    let mut offered: Vec<&'static Arg> = Vec::new();
    for form in order.forms {
        if let Some(argument) = next_argument(form, arguments) {
            if !offered.contains(&argument) {
                offered.push(argument);
            }
        }
    }

    Caret {
        shape: CaretShape::InOrder(order, offered),
        word,
    }
}

/// The argument that may stand where the caret is, for one form; `None` when the typed words do not
/// match this form, or when the form is already finished.
fn next_argument(form: &'static [Arg], arguments: &[Token]) -> Option<&'static Arg> {
    // `match_arg` collects unrecognised item names for the checker's warnings; nothing here wants
    // them, and with no ruleset it never fills this.
    let mut unknown = Vec::new();
    let mut at = 0;

    for (index, argument) in form.iter().enumerate() {
        match argument {
            // Consumes the whole rest of the line, whatever it is. There is no position after it,
            // and nothing to say about the one it swallows.
            Arg::Tail => return None,
            // `inner` binds as `&&'static Arg` - the field is already a reference and the match is
            // through one - so both uses below dereference it. `Arg` is `Copy`, so that is free.
            Arg::Rest(inner) | Arg::Repeat(inner) => {
                debug_assert_eq!(
                    index,
                    form.len() - 1,
                    "Rest/Repeat is a form's last argument"
                );
                loop {
                    if at == arguments.len() {
                        return Some(*inner);
                    }
                    at = match_arg(inner, arguments, at, None, &mut unknown).ok()?;
                }
            }
            _ => {
                if at == arguments.len() {
                    return Some(argument);
                }
                at = match_arg(argument, arguments, at, None, &mut unknown).ok()?;
            }
        }
    }

    // Every argument matched and the form has no more positions: `TAX` takes nothing, and
    // `DECLARE 15 ALLY` is finished.
    None
}

/// The words one argument allows, in the order they should be offered; empty for an open one.
pub(super) fn keywords(argument: &Arg) -> Vec<&'static str> {
    match argument {
        Arg::Kw(keyword) => vec![*keyword],
        Arg::OneOf(list) => list.to_vec(),
        Arg::ItemClass => {
            // The one ordering exception (Q9): 22 unfamiliar words is past the point where a list
            // in the rules page's own order can be scanned.
            let mut classes = ITEM_CLASSES.to_vec();
            classes.sort_unstable();
            classes
        }
        Arg::MoveStep => {
            let mut steps: Vec<&'static str> = Direction::ALL
                .iter()
                .map(|direction| direction.abbreviation())
                .collect();
            steps.push("IN");
            steps.push("OUT");
            steps
        }
        Arg::Unit
        | Arg::Faction
        | Arg::Object
        | Arg::Number
        | Arg::Flag
        | Arg::Item
        | Arg::Skill
        | Arg::Name
        | Arg::Tail
        | Arg::Rest(_)
        | Arg::Repeat(_) => Vec::new(),
    }
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

/// What a form matched: how far into the arguments it read, and what it noticed along the way.
///
/// `consumed` is an index into the arguments, not a count of forms or tokens beyond it - so
/// `arguments[..consumed]` is exactly what this form read, and anything after it is trailing text
/// the engine also ignores (`ah-86vk`). Every caller downstream of validation - `intents`,
/// `effects` - reads that same prefix rather than the whole line, through [`consumed_arguments`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MatchedOrder {
    pub unknown_items: Vec<UnknownItem>,
    pub consumed: usize,
}

/// The arguments this order actually consumes, trimmed of whatever trailing text the engine would
/// ignore - the one seam every reader downstream of validation reads through, so a line accepted
/// here cannot be read differently by a preview or an intent.
///
/// `None` for an unknown command or one whose required arguments are missing or malformed; those
/// stay errors; a caller with nothing to read gets nothing back. No ruleset is passed to
/// `match_order` here: an item name the catalogue does not recognise is a warning for the syntax
/// checker to raise, not a reason for a reader to see fewer tokens than it otherwise would.
#[must_use]
pub(super) fn consumed_arguments<'a>(
    command: &Token,
    arguments: &'a [Token],
) -> Option<&'a [Token]> {
    let order = find_order(&command.text)?;
    let matched = match_order(order, arguments, None).ok()?;
    Some(&arguments[..matched.consumed])
}

/// Matches an order's arguments against every form it has.
///
/// `arguments` excludes the command itself. Every form is tried, because a fixed form that
/// consumed only its own arguments and a longer form that read farther before failing must be
/// compared to decide which is closer to what the player meant: the best success is the form that
/// consumed the most tokens, and it loses only to a failure that got strictly farther still - a tie
/// is decided for the success, since a complete reading beats an incomplete one that reached the
/// same place. This is what lets `STUDY COMB note` succeed through the short `[Skill]` form while
/// `GIVE 17 ALL SWOR EXCEPT x` still reports what the longer `EXCEPT` form was missing.
pub(super) fn match_order(
    order: &Order,
    arguments: &[Token],
    ruleset: Option<&Ruleset>,
) -> Result<MatchedOrder, Mismatch> {
    let mut best: Option<MatchedOrder> = None;
    let mut furthest: Vec<Mismatch> = Vec::new();

    for form in order.forms {
        match match_form(form, arguments, ruleset) {
            Ok(matched) => {
                if best
                    .as_ref()
                    .is_none_or(|current| matched.consumed > current.consumed)
                {
                    best = Some(matched);
                }
            }
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

    if let Some(mismatch) = furthest.first() {
        let beaten = best
            .as_ref()
            .is_none_or(|matched| mismatch.at > matched.consumed);
        if beaten {
            return Err(merge(furthest));
        }
    }

    best.ok_or_else(|| merge(furthest))
}

/// Folds the equally-close mismatches into one complaint naming every way forward.
fn merge(mismatches: Vec<Mismatch>) -> Mismatch {
    mismatches
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
        .expect("every order has at least one form")
}

fn match_form(
    form: &[Arg],
    arguments: &[Token],
    ruleset: Option<&Ruleset>,
) -> Result<MatchedOrder, Mismatch> {
    let mut unknown = Vec::new();
    let mut at = 0;

    for argument in form {
        at = match_arg(argument, arguments, at, ruleset, &mut unknown)?;
    }

    // A form that reads its own arguments has matched, whatever tokens are left after it: the
    // engine stops reading once a form is satisfied, and so does this checker (`ah-86vk`).
    Ok(MatchedOrder {
        unknown_items: unknown,
        consumed: at,
    })
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

    // Like `Rest`, but a token that stops matching ends the repetition rather than the form: the
    // first value is still required, and anything after the last one that matched is trailing text
    // the caller now owns (`ah-86vk`). `EVICT 415 note` reads one unit and leaves `note`; `EVICT
    // note` still has no first unit to read.
    if let Arg::Repeat(inner) = argument {
        let mut next = match_arg(inner, arguments, at, ruleset, unknown)?;
        while let Ok(after) = match_arg(inner, arguments, next, ruleset, unknown) {
            next = after;
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
        Arg::ItemClass => usize::from(super::forms::is_item_class(&token.text)),
        Arg::Unit => match_unit(arguments, at),
        Arg::Faction | Arg::Object | Arg::Number => usize::from(token.kind == TokenKind::Number),
        Arg::Flag => usize::from(super::forms::flag_value(token).is_some()),
        Arg::MoveStep => usize::from(
            Direction::parse(&token.text).is_some()
                || token.is("in")
                || token.is("out")
                || token.kind == TokenKind::Number,
        ),
        Arg::Item => {
            if let Some(ruleset) = ruleset {
                // A name the catalogue does not have is a **warning**, never an error: the
                // catalogue is scraped from the game being played and may be stale, absent, or
                // simply missing an entry, and none of that is grounds for telling a player their
                // order is wrong.
                if ruleset.find_item(&token.text).is_none() {
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
        Arg::Tail | Arg::Rest(_) | Arg::Repeat(_) => unreachable!("handled above"),
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
    // The reader's own answer, so the shape checker and the readers cannot part company about
    // what a unit reference is. `match_arg` has already established that `at` is in range.
    //
    // Zero means "these tokens are not a unit", which the caller turns into a mismatch *at* this
    // position rather than a missing argument - the form-ranking heuristic keys off that position.
    super::forms::unit_token_count(&arguments[at..])
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
        Arg::Rest(inner) | Arg::Repeat(inner) => describe(inner),
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

    // The `order_argument_completions` tests that used to live here moved to
    // `completion.rs`'s own test module when the wire type widened (ah-bai.2): they now go
    // through `arguments_at_caret` the same as everything else, with the three new arguments as
    // `None`.

    #[test]
    fn every_form_keeps_its_rest_or_repeat_last() {
        for order in GRAMMAR {
            for form in order.forms {
                for (index, argument) in form.iter().enumerate() {
                    if matches!(argument, Arg::Rest(_) | Arg::Repeat(_)) {
                        assert_eq!(
                            index,
                            form.len() - 1,
                            "{}: Rest/Repeat is not this form's last argument",
                            order.name
                        );
                    }
                }
            }
        }
    }

    /// One token of a lexed line, for building the argument slices these tests match against.
    fn arguments(line: &str) -> (Token, Vec<Token>) {
        let mut tokens = lex_line(line).tokens;
        let command = tokens.remove(0);
        (command, tokens)
    }

    // --- consumed prefixes and the best-success-versus-furthest-failure rule (ah-86vk) --------

    #[test]
    fn fixed_forms_report_the_consumed_prefix_and_ignore_the_suffix() {
        // Zero arguments: LEAVE takes none, so the whole line is trailing text.
        let (command, args) = arguments("LEAVE note");
        let order = find_order(&command.text).expect("LEAVE is an order");
        let matched = match_order(order, &args, None).expect("trailing text is not an error");
        assert_eq!(matched.consumed, 0);

        // One argument: CLAIM takes a number, and stops there.
        let (command, args) = arguments("CLAIM 100 note");
        let order = find_order(&command.text).expect("CLAIM is an order");
        let matched = match_order(order, &args, None).expect("trailing text is not an error");
        assert_eq!(matched.consumed, 1);

        // Multiple arguments: STEAL takes a unit and an item.
        let (command, args) = arguments("STEAL 123 SILV note");
        let order = find_order(&command.text).expect("STEAL is an order");
        let matched = match_order(order, &args, None).expect("trailing text is not an error");
        assert_eq!(matched.consumed, 2);
    }

    #[test]
    fn a_farther_malformed_form_beats_a_shorter_success() {
        // GIVE's `[unit] ALL [item]` form is satisfied after three tokens and would ignore
        // `EXCEPT` as trailing text; the `EXCEPT [number]` form reaches one token farther before
        // finding nothing where a reserve belongs, so its complaint is the one that must surface.
        let (command, args) = arguments("GIVE 17 ALL SWOR EXCEPT x");
        let order = find_order(&command.text).expect("GIVE is an order");
        let mismatch =
            match_order(order, &args, None).expect_err("a malformed reserve is still an error");
        assert_eq!(mismatch.at, 4);
        assert!(!mismatch.missing, "x is the wrong kind, not a missing one");

        // The complete shorter form still wins when nothing reaches farther than it did.
        let (command, args) = arguments("STUDY COMB note");
        let order = find_order(&command.text).expect("STUDY is an order");
        let matched = match_order(order, &args, None).expect("the short form is complete");
        assert_eq!(matched.consumed, 1);
    }

    #[test]
    fn repeated_unit_forms_stop_after_the_last_unit() {
        let (command, args) = arguments("EVICT 415 698 note");
        let order = find_order(&command.text).expect("EVICT is an order");
        let matched = match_order(order, &args, None).expect("two units, then trailing text");
        assert_eq!(matched.consumed, 2);

        // The first unit is still required.
        let (command, args) = arguments("EVICT note");
        let order = find_order(&command.text).expect("EVICT is an order");
        let mismatch = match_order(order, &args, None).expect_err("no unit to read at all");
        assert_eq!(mismatch.at, 0);
    }

    #[test]
    fn movement_rest_still_rejects_a_bad_step() {
        // `Rest` is strict where `Repeat` is not: every remaining token must match, so a bad
        // route element is still the player's mistake to fix rather than a place to stop reading.
        let (command, args) = arguments("MOVE N nowhere");
        let order = find_order(&command.text).expect("MOVE is an order");
        let mismatch =
            match_order(order, &args, None).expect_err("a bad route step is still an error");
        assert_eq!(mismatch.at, 1);

        // `Tail` keeps consuming everything, unaffected by this change.
        let (command, args) = arguments("CAST Fire_Shield a whole spell line");
        let order = find_order(&command.text).expect("CAST is an order");
        let matched = match_order(order, &args, None).expect("Tail accepts anything");
        assert_eq!(matched.consumed, args.len());
    }
}
