//! NAME and DESCRIBE text the game will cut short (`ah-vs4tp`).
//!
//! `rules/orders`: "when supplying names containing spaces, the name must be surrounded by double
//! quotes, or else underscore characters must be used in place of spaces in the name". The engine
//! reads the text of every NAME and DESCRIBE form as one token (`ProcessNameOrder`,
//! `ProcessDescribeOrder`, ../Atlantis `parseorders.cpp`), so two failures follow:
//!
//! 1. Several unquoted words: only the first is kept ([`cut_short`], the advisory
//!    [`codes::NAME_CUT_SHORT`]).
//! 2. A quote opening the text that is never closed: `AString::gettoken` (../Atlantis
//!    `astring.cpp`) returns no token at all, so a DESCRIBE clears the description
//!    (`rules/describe`: "If no description is given, the description will be cleared out") and a
//!    NAME changes nothing ([`unclosed`], which re-words the parser's blocking
//!    `unterminated-quote` error rather than adding a second mark).
//!
//! Both read only the text, and each carries the one-press rewrite that removes it.

use std::collections::BTreeMap;

use crate::movement::rules::Ruleset;
use crate::orders::grammar::{Keyword, DESCRIBABLE, NAMEABLE};
use crate::orders::lexer::{byte_offset, lex_line, utf16_column, Token, TokenKind};
use crate::orders::semantics::{codes, Finding};
use crate::orders::walk::{self, Event};
use crate::report::ParsedReport;
use crate::OrderFix;

/// Which of the two orders the line is, as the messages name its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextKind {
    Name,
    Description,
}

impl TextKind {
    fn noun(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Description => "description",
        }
    }
}

/// Whether `command subject` is a NAME or DESCRIBE form whose remaining tokens are its text. A
/// subject the grammar does not list is already a shape error, and gets nothing more.
fn text_kind(command: &Token, subject: &Token) -> Option<TextKind> {
    let (kind, subjects): (TextKind, &[Keyword]) = if command.is("NAME") {
        (TextKind::Name, NAMEABLE)
    } else if command.is("DESCRIBE") {
        (TextKind::Description, DESCRIBABLE)
    } else {
        return None;
    };
    subjects
        .iter()
        .any(|keyword| subject.is(keyword.word))
        .then_some(kind)
}

/// One NAME or DESCRIBE line whose unquoted text has several words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CutShort {
    /// 1-based line number.
    pub line: usize,
    /// The dropped words, from the second word to the end of the text (UTF-16 columns).
    pub column_start: usize,
    pub column_end: usize,
    pub message: String,
    /// "Add quotes", or `None` when the text already holds a quoted token.
    pub fix: Option<OrderFix>,
}

/// Every NAME or DESCRIBE line of `source` whose text the game cuts to its first word.
pub(crate) fn cut_short(source: &str, ruleset: Option<&Ruleset>) -> Vec<CutShort> {
    let mut found = Vec::new();
    walk::walk(source, ruleset, |event| {
        let Event::Order { line, .. } = event else {
            return;
        };
        let Some((subject, text)) = line.arguments.split_first() else {
            return;
        };
        let Some(kind) = text_kind(line.command, subject) else {
            return;
        };
        // One token is kept whole, and a quoted first token is the whole text the player meant.
        let ([first, second, .., last] | [first, second @ last]) = text else {
            return;
        };
        if first.kind == TokenKind::Quoted {
            return;
        }
        let fix = text
            .iter()
            .all(|token| token.kind != TokenKind::Quoted)
            .then(|| {
                let replaced = slice(line.text, first.column_start, last.column_end);
                OrderFix {
                    label: "Add quotes".to_string(),
                    column_start: first.column_start,
                    column_end: last.column_end,
                    insert: format!("\"{replaced}\""),
                    replaced,
                }
            });
        found.push(CutShort {
            line: line.number,
            column_start: second.column_start,
            column_end: last.column_end,
            message: format!(
                "only “{}” will be kept: a {} of more than one word needs double quotes",
                first.text,
                kind.noun()
            ),
            fix,
        });
    });
    found
}

/// `line[start..end]`, the columns counted in UTF-16 code units.
fn slice(line: &str, start: usize, end: usize) -> String {
    line[byte_offset(line, start)..byte_offset(line, end)].to_string()
}

/// Raises [`codes::NAME_CUT_SHORT`] for [`super::semantics::review_turn`]. Each finding belongs to
/// the hex of the `unit` block its line sits in - a NAME in a FORM block is written by the unit
/// that opened it - and a line in no block the report shows has no hex to belong to.
///
/// `unit_id` stays `None`, as on the parser's own diagnostics: this is about the text, so a unit
/// whose report entry could not be read must not take the warning with it.
pub(crate) fn check(
    report: &ParsedReport,
    source: &str,
    ruleset: Option<&Ruleset>,
    findings: &mut Vec<Finding>,
) {
    let mut hex_of_unit: BTreeMap<&str, &str> = BTreeMap::new();
    for region in &report.regions {
        for unit in &region.units {
            hex_of_unit.insert(&unit.unit_id, &region.region_id);
        }
    }
    let found = cut_short(source, ruleset);
    if found.is_empty() {
        return;
    }
    // Which block each line sits in: the `unit` lines, in document order.
    let mut blocks: Vec<(usize, Option<&str>)> = Vec::new();
    walk::walk(source, ruleset, |event| {
        if let Event::Unit(line) = event {
            let hex = line
                .arguments
                .first()
                .and_then(|unit| hex_of_unit.get(unit.text.as_str()).copied());
            blocks.push((line.number, hex));
        }
    });
    for cut in found {
        let Some(&(_, Some(hex))) = blocks.iter().rev().find(|(number, _)| *number < cut.line)
        else {
            continue;
        };
        findings.push(Finding {
            code: codes::NAME_CUT_SHORT,
            message: cut.message,
            region_id: hex.to_string(),
            unit_id: None,
            line: Some(cut.line),
            column_start: Some(cut.column_start),
            column_end: Some(cut.column_end),
            formed: None,
            counted_in: None,
            problems_in: None,
            fix: cut.fix,
        });
    }
}

/// The unterminated-quote error as a NAME or DESCRIBE line words it, when the quote opens the text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Unclosed {
    pub message: String,
    /// From the opening quote to the end of the order's text, before any comment.
    pub column_start: usize,
    pub column_end: usize,
    /// "Close the quote".
    pub fix: OrderFix,
}

/// What the parser's `unterminated-quote` error says on `text`, whose unclosed quote starts at
/// `span.0`; `None` keeps today's wording ("a quotation mark is never closed").
pub(crate) fn unclosed(
    text: &str,
    span: (usize, usize),
    ruleset: Option<&Ruleset>,
) -> Option<Unclosed> {
    let lexed = lex_line(text, ruleset);
    // The quote must open the text: `NAME UNIT Robin "Hood` keeps "Robin", so neither consequence
    // sentence would be true of it.
    let [command, subject] = lexed.tokens.as_slice() else {
        return None;
    };
    let kind = text_kind(command, subject)?;
    let quote = byte_offset(text, span.0);
    let rest = &text[quote + 1..];
    // The order ends where a comment would start were the quote not there, under the world's own
    // semicolon rule; the engine itself reads a semicolon inside a quote as an ordinary character,
    // but the closing quote belongs before the player's note, not after it.
    let rest_end = lex_line(rest, ruleset)
        .comment
        .map_or(rest.len(), |(start, _)| byte_offset(rest, start));
    let end = quote + 1 + rest[..rest_end].trim_end_matches([' ', '\t', '\r']).len();
    let replaced = text[quote..end].to_string();
    let (column_start, column_end) = (span.0, utf16_column(text, end));
    let consequence = match kind {
        TextKind::Description => "the description will be cleared",
        TextKind::Name => "the name will not change",
    };
    Some(Unclosed {
        message: format!("the closing double quote is missing, so {consequence}"),
        column_start,
        column_end,
        fix: OrderFix {
            label: "Close the quote".to_string(),
            column_start,
            column_end,
            insert: format!("{replaced}\""),
            replaced,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn only(source: &str) -> CutShort {
        let mut found = cut_short(source, None);
        assert_eq!(found.len(), 1, "expected one: {found:?}");
        found.remove(0)
    }

    fn quiet(source: &str) {
        assert_eq!(cut_short(source, None), [], "{source}");
    }

    /// The columns of `part` within `line`, in UTF-16 code units.
    fn columns_of(line: &str, part: &str) -> (usize, usize) {
        let at = line.find(part).expect("part is on the line");
        (utf16_column(line, at), utf16_column(line, at + part.len()))
    }

    #[test]
    fn an_unquoted_multi_word_description_keeps_only_its_first_word() {
        let line = "DESCRIBE UNIT Outlaw of Sherwood";
        let found = only(line);
        assert_eq!(found.line, 1);
        assert_eq!(
            found.message,
            "only “Outlaw” will be kept: a description of more than one word needs double quotes"
        );
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "of Sherwood")
        );
    }

    #[test]
    fn an_unquoted_multi_word_name_keeps_only_its_first_word() {
        let line = "NAME UNIT Robin of Locksley";
        let found = only(line);
        assert_eq!(
            found.message,
            "only “Robin” will be kept: a name of more than one word needs double quotes"
        );
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "of Locksley")
        );
    }

    #[test]
    fn text_the_game_keeps_whole_is_not_warned_about() {
        quiet("DESCRIBE UNIT \"Outlaw of Sherwood\"");
        quiet("DESCRIBE UNIT Outlaw");
        quiet("DESCRIBE UNIT Outlaw_of_Sherwood");
        quiet("DESCRIBE UNIT");
        quiet("DESCRIBE UNIT Outlaw ; my note");
        quiet("NAME FACTION \"Merry Men\"");
    }

    #[test]
    fn a_comment_after_several_words_is_not_underlined() {
        let line = "DESCRIBE UNIT Outlaw of Sherwood ; my note";
        let found = only(line);
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "of Sherwood")
        );
        let fix = found.fix.expect("a fix");
        assert_eq!(fix.replaced, "Outlaw of Sherwood");
        assert_eq!(fix.insert, "\"Outlaw of Sherwood\"");
        assert_eq!(
            (fix.column_start, fix.column_end),
            columns_of(line, "Outlaw of Sherwood")
        );
    }

    #[test]
    fn add_quotes_wraps_the_whole_text_and_keeps_a_leading_at() {
        let line = "  @describe unit Outlaw of Sherwood";
        let found = only(line);
        let fix = found.fix.expect("a fix");
        assert_eq!(fix.label, "Add quotes");
        assert_eq!(
            (fix.column_start, fix.column_end),
            columns_of(line, "Outlaw of Sherwood")
        );
        assert_eq!(fix.insert, "\"Outlaw of Sherwood\"");
    }

    #[test]
    fn quoted_words_after_an_unquoted_first_word_are_warned_without_a_fix() {
        let line = "DESCRIBE UNIT Outlaw \"of Sherwood\"";
        let found = only(line);
        assert!(found.message.starts_with("only “Outlaw” will be kept"));
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "\"of Sherwood\"")
        );
        assert_eq!(found.fix, None);
    }

    #[test]
    fn every_name_and_describe_form_is_read_the_same_way() {
        for subject in [
            "UNIT",
            "FACTION",
            "OBJECT",
            "CITY",
            "SHIP",
            "BUILDING",
            "STRUCTURE",
            "TOWN",
            "VILLAGE",
        ] {
            let found = only(&format!("NAME {subject} Sherwood Forest"));
            assert!(found.message.contains("a name of"), "{subject}");
        }
        for subject in ["UNIT", "SHIP", "BUILDING", "OBJECT", "STRUCTURE"] {
            let found = only(&format!("describe {subject} Sherwood Forest"));
            assert!(found.message.contains("a description of"), "{subject}");
        }
    }

    #[test]
    fn a_subject_the_order_does_not_take_gets_no_warning() {
        quiet("DESCRIBE FACTION Merry Men");
        quiet("NAME Robin Hood");
        quiet("GIVE 12 Robin Hood");
    }

    #[test]
    fn lines_in_turn_and_form_blocks_are_read_too() {
        let source =
            "unit 12\nTURN\nNAME UNIT Little John\nENDTURN\nFORM 1\nNAME UNIT Will Scarlet\nEND\n";
        let lines: Vec<usize> = cut_short(source, None)
            .iter()
            .map(|found| found.line)
            .collect();
        assert_eq!(lines, [3, 6]);
    }

    #[test]
    fn the_message_quotes_the_kept_word_as_typed_and_columns_count_utf16() {
        let line = "NAME UNIT Mörk av Skogen";
        let found = only(line);
        assert!(found.message.starts_with("only “Mörk” will be kept"));
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "av Skogen")
        );
        let fix = found.fix.expect("a fix");
        assert_eq!(
            (fix.column_start, fix.column_end),
            columns_of(line, "Mörk av Skogen")
        );
    }

    // --- an unclosed quote ------------------------------------------------------------------

    fn unclosed_on(line: &str) -> Option<Unclosed> {
        let span = lex_line(line, None)
            .unterminated_quote
            .expect("the line has an unclosed quote");
        unclosed(line, span, None)
    }

    #[test]
    fn an_unclosed_description_will_be_cleared() {
        let line = "DESCRIBE UNIT \"Outlaw of Sherwood";
        let found = unclosed_on(line).expect("re-worded");
        assert_eq!(
            found.message,
            "the closing double quote is missing, so the description will be cleared"
        );
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "\"Outlaw of Sherwood")
        );
        assert_eq!(found.fix.label, "Close the quote");
        assert_eq!(found.fix.replaced, "\"Outlaw of Sherwood");
        assert_eq!(found.fix.insert, "\"Outlaw of Sherwood\"");
        assert_eq!(
            (found.fix.column_start, found.fix.column_end),
            (found.column_start, found.column_end)
        );
    }

    #[test]
    fn an_unclosed_name_will_not_change() {
        let found = unclosed_on("@name unit \"Robin of Locksley").expect("re-worded");
        assert_eq!(
            found.message,
            "the closing double quote is missing, so the name will not change"
        );
    }

    #[test]
    fn the_quote_is_closed_before_a_trailing_comment() {
        let line = "DESCRIBE UNIT \"Outlaw of Sherwood  ; my note";
        let found = unclosed_on(line).expect("re-worded");
        assert_eq!(
            (found.column_start, found.column_end),
            columns_of(line, "\"Outlaw of Sherwood")
        );
        assert_eq!(found.fix.insert, "\"Outlaw of Sherwood\"");
    }

    #[test]
    fn an_unclosed_quote_anywhere_else_keeps_todays_words() {
        // The game keeps "Outlaw" here, so neither consequence sentence would be true.
        assert_eq!(unclosed_on("DESCRIBE UNIT Outlaw \"of Sherwood"), None);
        assert_eq!(unclosed_on("CLAIM \"12"), None);
        assert_eq!(unclosed_on("DESCRIBE FACTION \"Merry Men"), None);
    }
}
