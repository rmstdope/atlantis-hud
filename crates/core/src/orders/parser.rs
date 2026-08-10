//! Walking a whole orders document and collecting everything wrong with it.
//!
//! The document has a shape of its own, above the orders in it: `#atlantis` opens it, `unit` lines
//! divide it, `#end` closes it, and `TURN`/`ENDTURN` and `FORM`/`END` nest inside a unit's block. The
//! rules say the first two follow the same lexical rules as orders do, and the server rejects the
//! whole file when any of it is wrong - which is exactly the kind of mistake a per-line check cannot
//! see.

use super::grammar::{find_order, match_order, Mismatch};
use super::lexer::{lex_line, utf16_column, Token, TokenKind};
use crate::movement::rules::Ruleset;
use crate::{OrderDiagnostic, OrderDiagnosticSeverity, OrderValidationResult};

/// Checks one orders document.
///
/// `ruleset_json` is the served ruleset, when the shell has it. Without one the shapes of orders are
/// still checked; only the item catalogue goes unconsulted. A ruleset that cannot be used is treated
/// as no ruleset at all rather than as a reason to refuse the document: the player's orders are not
/// at fault for a bad config file.
#[must_use]
pub fn validate(source: &str, ruleset_json: Option<&str>) -> OrderValidationResult {
    let ruleset = ruleset_json.and_then(|json| Ruleset::from_json(json).ok());
    let mut document = Document::default();

    for (index, line) in source.lines().enumerate() {
        document.read_line(index + 1, line, ruleset.as_ref());
    }
    document.finish(source);

    let mut diagnostics = document.diagnostics;
    // An unclosed block is only discovered at the line that had to close it, and is then filed
    // against the line that opened it - so the list is not built in line order. The panel counts on
    // that order, and so does anyone reading it.
    diagnostics.sort_by_key(|diagnostic| diagnostic.line_start);

    OrderValidationResult { diagnostics }
}

/// A block waiting for its terminator.
struct OpenBlock {
    /// The keyword that opened it, for the message.
    opener: &'static str,
    /// The keyword that has to close it.
    terminator: &'static str,
    line: usize,
    /// Where the opening keyword sits on that line.
    column_start: usize,
    column_end: usize,
}

/// The state a document accumulates as it is read.
#[derive(Default)]
struct Document {
    diagnostics: Vec<OrderDiagnostic>,
    blocks: Vec<OpenBlock>,
    /// Whether the document declared itself with `#atlantis`. Only then is `#end` expected: the
    /// pane validates whatever the player has typed, and a fragment is not a malformed document.
    opened: bool,
    closed: bool,
    last_line: usize,
}

impl Document {
    fn read_line(&mut self, number: usize, line: &str, ruleset: Option<&Ruleset>) {
        self.last_line = number;
        let lexed = lex_line(line);

        if let Some((start, end)) = lexed.unterminated_quote {
            // The rest of the line cannot be read, so nothing else about it is worth saying.
            self.error(
                number,
                start,
                end,
                "unterminated-quote",
                "a quotation mark is never closed".to_string(),
            );
            return;
        }

        let Some((command, arguments)) = lexed.tokens.split_first() else {
            return;
        };

        if command.text.starts_with('#') {
            self.read_directive(number, command, arguments);
        } else if command.is("unit") {
            self.read_unit_line(number, command, arguments);
        } else {
            self.read_order(number, line, command, arguments, ruleset);
        }
    }

    /// `#atlantis` opens the document and `#end` closes it; the rules give it no other directives.
    fn read_directive(&mut self, number: usize, command: &Token, arguments: &[Token]) {
        if command.is("#atlantis") {
            self.opened = true;
            // Everything after the faction number is the faction's password. It is never read, and
            // never repeated in a message.
            if !arguments
                .first()
                .is_some_and(|faction| faction.kind == TokenKind::Number)
            {
                self.error(
                    number,
                    command.column_start,
                    command.column_end,
                    "missing-faction",
                    "#atlantis needs a faction number".to_string(),
                );
            }
        } else if command.is("#end") {
            self.close_open_blocks();
            self.closed = true;
        } else {
            self.error(
                number,
                command.column_start,
                command.column_end,
                "unknown-directive",
                format!("the document has no directive {}", command.text),
            );
        }
    }

    fn read_unit_line(&mut self, number: usize, command: &Token, arguments: &[Token]) {
        // A unit's orders end where the next unit's begin, so anything still open was left open.
        self.close_open_blocks();

        if !arguments
            .first()
            .is_some_and(|unit| unit.kind == TokenKind::Number)
        {
            self.error(
                number,
                command.column_start,
                command.column_end,
                "missing-unit-id",
                "unit needs a unit number".to_string(),
            );
        }
    }

    fn read_order(
        &mut self,
        number: usize,
        line: &str,
        command: &Token,
        arguments: &[Token],
        ruleset: Option<&Ruleset>,
    ) {
        let Some(order) = find_order(&command.text) else {
            self.error(
                number,
                command.column_start,
                command.column_end,
                "unknown-command",
                format!("unknown order command: {}", command.text),
            );
            return;
        };

        self.track_block(number, command, order.name);

        match match_order(order, arguments, ruleset) {
            Ok(unknown) => {
                for item in unknown {
                    self.warning(
                        number,
                        item.column_start,
                        item.column_end,
                        "unknown-item",
                        format!("no item \"{}\" in the catalogue", item.text),
                    );
                }
            }
            Err(mismatch) => {
                self.report_mismatch(number, line, command, arguments, order.name, &mismatch)
            }
        }
    }

    fn track_block(&mut self, number: usize, command: &Token, name: &'static str) {
        match name {
            "TURN" => self.blocks.push(OpenBlock {
                opener: "TURN",
                terminator: "ENDTURN",
                line: number,
                column_start: command.column_start,
                column_end: command.column_end,
            }),
            "FORM" => self.blocks.push(OpenBlock {
                opener: "FORM",
                terminator: "END",
                line: number,
                column_start: command.column_start,
                column_end: command.column_end,
            }),
            "ENDTURN" | "END" => {
                if self
                    .blocks
                    .last()
                    .is_some_and(|block| block.terminator == name)
                {
                    self.blocks.pop();
                } else {
                    self.error(
                        number,
                        command.column_start,
                        command.column_end,
                        "unexpected-block-end",
                        match self.blocks.last() {
                            Some(block) => format!(
                                "{name} closes nothing here; the {} block opened on line {} is closed by {}",
                                block.opener, block.line, block.terminator
                            ),
                            None => format!("{name} closes nothing here"),
                        },
                    );
                }
            }
            _ => {}
        }
    }

    fn report_mismatch(
        &mut self,
        number: usize,
        line: &str,
        command: &Token,
        arguments: &[Token],
        name: &'static str,
        mismatch: &Mismatch,
    ) {
        if mismatch.missing {
            self.error(
                number,
                command.column_start,
                utf16_column(line, line.len()),
                "missing-arguments",
                format!("{name} needs {}", mismatch.expected),
            );
            return;
        }

        let found = &arguments[mismatch.at];
        let (code, message) = if mismatch.expected == "no more arguments" {
            (
                "extra-arguments",
                format!("{name} takes no more arguments, found \"{}\"", found.text),
            )
        } else {
            (
                "bad-argument",
                format!("expected {}, found \"{}\"", mismatch.expected, found.text),
            )
        };

        self.error(number, found.column_start, found.column_end, code, message);
    }

    /// Complains about every block still open, and forgets them so one mistake is reported once.
    ///
    /// Filed against the line that *opened* the block rather than the line that discovered it. The
    /// discovering line is the next `unit` line or `#end`, which is outside the block of the unit
    /// whose orders are wrong - and the panel takes a unit's problems by line, so a diagnostic left
    /// there was shown to nobody and the offending unit reported no errors at all.
    fn close_open_blocks(&mut self) {
        for block in std::mem::take(&mut self.blocks) {
            self.diagnostics.push(OrderDiagnostic {
                code: "unclosed-block".to_string(),
                message: format!(
                    "this {} block is never closed by {}",
                    block.opener, block.terminator
                ),
                line_start: block.line,
                line_end: block.line,
                column_start: block.column_start,
                column_end: block.column_end,
                severity: OrderDiagnosticSeverity::Error,
            });
        }
    }

    fn finish(&mut self, source: &str) {
        let last = source.lines().last().unwrap_or_default();
        let number = self.last_line.max(1);

        self.close_open_blocks();

        if self.opened && !self.closed {
            self.error(
                number,
                0,
                utf16_column(last, last.len()),
                "missing-document-end",
                "the document opens with #atlantis and never ends with #end".to_string(),
            );
        }
    }

    fn error(&mut self, line: usize, start: usize, end: usize, code: &str, message: String) {
        self.push(
            line,
            start,
            end,
            code,
            message,
            OrderDiagnosticSeverity::Error,
        );
    }

    fn warning(&mut self, line: usize, start: usize, end: usize, code: &str, message: String) {
        self.push(
            line,
            start,
            end,
            code,
            message,
            OrderDiagnosticSeverity::Warning,
        );
    }

    fn push(
        &mut self,
        line: usize,
        column_start: usize,
        column_end: usize,
        code: &str,
        message: String,
        severity: OrderDiagnosticSeverity,
    ) {
        self.diagnostics.push(OrderDiagnostic {
            code: code.to_string(),
            message,
            line_start: line,
            line_end: line,
            column_start,
            column_end,
            severity,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::super::validate_orders;
    use crate::{OrderDiagnostic, OrderDiagnosticSeverity};

    const RULESET: &str = include_str!("../../../../config/public/ruleset.json");

    fn diagnose(source: &str) -> Vec<OrderDiagnostic> {
        validate_orders(source, None).diagnostics
    }

    fn codes(source: &str) -> Vec<String> {
        diagnose(source)
            .into_iter()
            .map(|diagnostic| diagnostic.code)
            .collect()
    }

    fn only(source: &str) -> OrderDiagnostic {
        let mut diagnostics = diagnose(source);
        assert_eq!(
            diagnostics.len(),
            1,
            "expected one diagnostic: {diagnostics:?}"
        );
        diagnostics.remove(0)
    }

    fn clean(source: &str) {
        assert_eq!(
            diagnose(source),
            vec![],
            "expected no diagnostics for: {source}"
        );
    }

    // --- the vocabulary -------------------------------------------------------------------

    #[test]
    fn the_neworigins_vocabulary_is_accepted() {
        clean(concat!(
            "@study obse\n",
            "@claim 50\n",
            "give 242 100 SILV\n",
            "MOVE n n\n",
            "sail se\n",
            "work\n",
        ));
    }

    #[test]
    fn an_unknown_command_is_an_error_naming_it() {
        let diagnostic = only("FLY 1 2");

        assert_eq!(diagnostic.code, "unknown-command");
        assert!(diagnostic.message.contains("FLY"));
        assert_eq!(diagnostic.severity, OrderDiagnosticSeverity::Error);
        assert_eq!((diagnostic.column_start, diagnostic.column_end), (0, 3));
    }

    /// The list this parser replaces was missing END, so every correct FORM block reported an error.
    #[test]
    fn end_closes_a_form_block_and_is_not_an_unknown_command() {
        clean(concat!(
            "FORM 1\n",
            "NAME UNIT \"Merlin's Guards\"\n",
            "BUY 5 Plainsmen\n",
            "STUDY COMBAT\n",
            "END\n",
        ));
    }

    // --- argument shapes ------------------------------------------------------------------

    #[test]
    fn an_argument_of_the_wrong_kind_is_an_error_pointing_at_it() {
        let diagnostic = only("GIVE 4573 swords");

        assert_eq!(diagnostic.code, "bad-argument");
        assert!(
            diagnostic.message.contains("swords"),
            "the message quotes what was found: {}",
            diagnostic.message
        );
        assert_eq!(
            (diagnostic.column_start, diagnostic.column_end),
            (10, 16),
            "the span covers the offending token"
        );
    }

    /// The span has to be usable by the thing that uses it, which is a browser slicing a string.
    ///
    /// A unit may be named anything, so a line with an accent on it is ordinary rather than exotic.
    /// Counted in bytes this span would be (12, 13), and the panel would quote the empty string.
    #[test]
    fn a_span_on_a_line_with_an_accent_still_covers_the_offending_word() {
        let line = "STUDY Mörk x";
        let diagnostic = only(line);

        assert_eq!(diagnostic.code, "bad-argument");
        assert_eq!((diagnostic.column_start, diagnostic.column_end), (11, 12));

        // Sliced the way JavaScript slices, which is what these numbers are for.
        let utf16: Vec<u16> = line.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&utf16[diagnostic.column_start..diagnostic.column_end])
                .expect("valid"),
            "x"
        );
    }

    #[test]
    fn an_order_that_ran_out_of_arguments_says_what_is_missing() {
        let diagnostic = only("MOVE");

        assert_eq!(diagnostic.code, "missing-arguments");
        assert!(diagnostic.message.to_lowercase().contains("move"));
    }

    #[test]
    fn arguments_beyond_what_an_order_takes_are_an_error() {
        let diagnostic = only("WORK hard");
        assert_eq!(diagnostic.code, "extra-arguments");
    }

    #[test]
    fn every_form_the_rules_give_for_give_is_accepted() {
        clean(concat!(
            "GIVE 4573 10 swords\n",
            "GIVE 4573 ALL swords\n",
            "GIVE 4573 ALL swords EXCEPT 10\n",
            "GIVE 4573 ALL ITEMS\n",
            "GIVE 75 UNIT\n",
            "GIVE FACTION 14 NEW 2 5 \"Chain armor\"\n",
            "GIVE NEW 1 1000 silver\n",
        ));
    }

    #[test]
    fn the_form_that_got_furthest_decides_the_message() {
        // Four of GIVE's five forms die on the second argument; the EXCEPT form gets to the fifth,
        // so that is the mistake worth reporting.
        let diagnostic = only("GIVE 4573 ALL swords EXCEPT");

        assert_eq!(diagnostic.code, "missing-arguments");
        assert!(
            diagnostic.message.contains("quantity") || diagnostic.message.contains("number"),
            "{}",
            diagnostic.message
        );
    }

    #[test]
    fn a_flag_must_be_zero_or_one() {
        clean("AVOID 1\nBEHIND 0\nGUARD 1\n");
        assert_eq!(codes("AVOID yes"), ["bad-argument"]);
    }

    #[test]
    fn a_move_takes_directions_structures_and_in_and_out() {
        clean("MOVE N NE\nADVANCE N 1 IN SE\nMOVE OUT S\nMOVE NORTH\n");
        assert_eq!(codes("MOVE N EAST"), ["bad-argument"]);
    }

    #[test]
    fn sail_with_no_direction_is_a_form_of_its_own() {
        // The turn 71 template carries a bare "@sail".
        clean("@sail\n@sail n nw\n");
    }

    #[test]
    fn an_open_ended_order_has_its_head_checked_and_its_tail_left_alone() {
        clean(concat!(
            "CAST Super_Magic 4\n",
            "CAST earm\n",
            "NAME UNIT \"Merlin's Guards\"\n",
            "ADDRESS atlantis@rahul.net\n",
            "DESCRIBE UNIT wearing dirty overalls\n",
        ));

        assert_eq!(codes("CAST"), ["missing-arguments"]);
        assert_eq!(codes("NAME \"Guards\""), ["bad-argument"]);
    }

    #[test]
    fn a_unit_may_be_a_number_an_alias_or_another_factions_alias() {
        clean(concat!(
            "TEACH NEW 2 510\n",
            "ASSASSINATE 177\n",
            "ATTACK 17 431 985\n",
            "TAKE FROM 4573 10 swords\n",
        ));
    }

    #[test]
    fn a_trailing_comment_does_not_change_the_order() {
        // Straight out of the committed turn 71 template.
        clean("@declare 43 friendly; Squirrels\n@declare 10 ally ;Red Skulls\n");
    }

    #[test]
    fn a_quote_that_is_never_closed_is_an_error() {
        let diagnostic = only("NAME UNIT \"Merlin");
        assert_eq!(diagnostic.code, "unterminated-quote");
    }

    // --- blocks ---------------------------------------------------------------------------

    #[test]
    fn a_balanced_turn_block_is_accepted() {
        clean(concat!(
            "STUDY COMB\n",
            "TURN\n",
            "MOVE N\n",
            "ENDTURN\n",
            "@TURN\n",
            "PILLAGE\n",
            "ADVANCE N\n",
            "ENDTURN\n",
        ));
    }

    /// Reported against the line that opened the block, not the line that had to close it.
    ///
    /// The closing point is the *next* unit's line, or `#end` - both outside the block of the unit
    /// whose orders are actually wrong. The panel shows one unit at a time and takes its problems by
    /// line, so a diagnostic filed there belonged to nobody: the unit carrying the mistake read
    /// "0 errors". It also sent the player to the wrong line, when `TURN` is what they have to fix.
    #[test]
    fn a_turn_block_left_open_at_the_next_unit_is_an_error() {
        let diagnostics = diagnose(concat!(
            "unit 13401\n",
            "TURN\n",
            "MOVE N\n",
            "unit 999\n",
            "WORK\n",
        ));

        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        assert_eq!(diagnostics[0].code, "unclosed-block");
        assert_eq!(diagnostics[0].line_start, 2, "the line that opened it");
        assert_eq!(
            (diagnostics[0].column_start, diagnostics[0].column_end),
            (0, 4),
            "the span covers the TURN keyword itself"
        );
    }

    /// The report that found this: typed into the pane, it showed nothing wrong at all.
    #[test]
    fn an_unclosed_turn_is_reported_against_the_unit_that_wrote_it() {
        let diagnostics = diagnose(concat!(
            "#atlantis 95 \"x\"\n",
            "unit 18642\n",
            "turn\n",
            "study illu\n",
            "\n",
            "unit 13401\n",
            "@work\n",
            "#end\n",
        ));

        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        assert_eq!(diagnostics[0].code, "unclosed-block");
        assert_eq!(
            diagnostics[0].line_start, 3,
            "inside unit 18642's block, which is the only place the panel will show it"
        );
    }

    #[test]
    fn every_block_left_open_is_reported_against_its_own_opening_line() {
        let diagnostics = diagnose("TURN\nFORM 1\nWORK\n");

        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.line_start)
                .collect::<Vec<_>>(),
            vec![1, 2],
            "both, each at its own opener: {diagnostics:?}"
        );
    }

    #[test]
    fn a_block_left_open_at_the_end_of_the_document_is_an_error() {
        assert_eq!(codes("FORM 1\nBUY 5 Plainsmen\n"), ["unclosed-block"]);
    }

    #[test]
    fn a_block_terminator_with_nothing_open_is_an_error() {
        assert_eq!(codes("WORK\nENDTURN\n"), ["unexpected-block-end"]);
        assert_eq!(codes("WORK\nEND\n"), ["unexpected-block-end"]);
    }

    #[test]
    fn a_terminator_that_closes_the_wrong_kind_of_block_is_an_error() {
        assert_eq!(codes("FORM 1\nENDTURN\nEND\n"), ["unexpected-block-end"]);
    }

    #[test]
    fn blocks_nest() {
        clean("TURN\nFORM 1\nWORK\nEND\nMOVE N\nENDTURN\n");
    }

    // --- the document itself --------------------------------------------------------------

    #[test]
    fn a_whole_document_is_accepted() {
        clean(concat!(
            "#atlantis 95 \"secret\"\n",
            ";*** mountain (7,53) in Inhead ***\n",
            "unit 18642\n",
            ";Seven of Eight (18642), avoiding, behind.\n",
            "@work\n",
            "#end\n",
        ));
    }

    #[test]
    fn the_atlantis_line_needs_a_faction_number() {
        let diagnostic = only("#atlantis\n#end\n");

        assert_eq!(diagnostic.code, "missing-faction");
        assert!(
            !diagnostic.message.contains("secret"),
            "the password is never quoted back"
        );
    }

    #[test]
    fn the_password_on_the_atlantis_line_is_never_repeated_in_a_message() {
        let diagnostics = diagnose("#atlantis 95 \"hunter2\" spare\n#end\n");
        for diagnostic in &diagnostics {
            assert!(!diagnostic.message.contains("hunter2"), "{diagnostic:?}");
        }
    }

    #[test]
    fn a_unit_line_needs_a_unit_number() {
        assert_eq!(codes("#atlantis 95\nunit\n#end\n"), ["missing-unit-id"]);
    }

    #[test]
    fn a_directive_the_document_has_no_such_thing_as_is_an_error() {
        assert_eq!(codes("#atlantis 95\n#hello\n#end\n"), ["unknown-directive"]);
    }

    #[test]
    fn a_document_that_opens_but_never_ends_is_an_error() {
        assert_eq!(
            codes("#atlantis 95\nunit 5\nWORK\n"),
            ["missing-document-end"]
        );
    }

    /// The pane validates whatever the player has typed, which early on is not a whole document.
    #[test]
    fn a_fragment_with_no_document_lines_is_not_asked_for_them() {
        clean("WORK\nMOVE N\n");
    }

    #[test]
    fn comments_and_blank_lines_carry_nothing_to_complain_about() {
        clean(";a comment\n\n   \n@;a repeating comment\n");
    }

    // --- the item catalogue ---------------------------------------------------------------

    #[test]
    fn an_item_the_catalogue_does_not_know_is_a_warning_that_does_not_block() {
        let result = validate_orders("GIVE 45 10 swordz", Some(RULESET));

        assert_eq!(result.diagnostics.len(), 1, "{:?}", result.diagnostics);
        assert_eq!(result.diagnostics[0].code, "unknown-item");
        assert_eq!(
            result.diagnostics[0].severity,
            OrderDiagnosticSeverity::Warning
        );
        assert!(!result.is_blocking(), "a warning must not block export");
        assert_eq!(
            (
                result.diagnostics[0].column_start,
                result.diagnostics[0].column_end
            ),
            (11, 17)
        );
    }

    #[test]
    fn items_the_catalogue_knows_pass_by_tag_name_or_plural() {
        let result = validate_orders(
            concat!(
                "GIVE 45 10 SWOR\n",
                "GIVE 45 10 swords\n",
                "BUY 1 \"Plate Armor\"\n",
                "BUY 1 Plate_Armor\n",
                "@give 0 all spea\n",
            ),
            Some(RULESET),
        );

        assert_eq!(result.diagnostics, vec![], "{:?}", result.diagnostics);
    }

    #[test]
    fn without_a_ruleset_the_shape_is_still_checked_but_no_item_is_doubted() {
        assert_eq!(codes("GIVE 45 10 swordz"), Vec::<String>::new());
        assert_eq!(codes("GIVE 45 swordz"), ["bad-argument"]);
    }

    #[test]
    fn a_ruleset_that_cannot_be_used_is_treated_as_no_ruleset() {
        let result = validate_orders("GIVE 45 10 swordz", Some("{\"not\": \"a ruleset\"}"));
        assert_eq!(result.diagnostics, vec![], "{:?}", result.diagnostics);
    }

    // --- ordering -------------------------------------------------------------------------

    #[test]
    fn diagnostics_come_back_in_the_order_the_lines_are_written() {
        let diagnostics = diagnose("FLY\nWORK\nSWIM\n");
        let lines: Vec<usize> = diagnostics
            .iter()
            .map(|diagnostic| diagnostic.line_start)
            .collect();

        assert_eq!(lines, [1, 3]);
    }

    /// An unclosed block is noticed long after the line it is reported against, so the list is no
    /// longer built in line order and has to be put back into it.
    #[test]
    fn a_problem_found_late_is_still_listed_where_its_line_falls() {
        let diagnostics = diagnose("TURN\nFLY\n");

        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| (diagnostic.line_start, diagnostic.code.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "unclosed-block"), (2, "unknown-command")]
        );
    }
}
