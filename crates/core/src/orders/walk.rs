//! The one walk over an orders document's block structure.
//!
//! Every reader of an orders document has to know which lines are inside a `TURN…ENDTURN` block
//! (next month's orders) or a `FORM…END` block (a unit that does not exist yet), that the two nest,
//! that `END` closes only a FORM and `ENDTURN` only a TURN, and that a `unit` line or a `#`
//! directive abandons whatever is still open. Four readers used to keep that walk each; one defect
//! had to be fixed in three of them at once (c6ee017), and they had drifted apart again by ah-nc7.
//! This module walks once and reports what it passes; what to do about it is each reader's.

use super::lexer::{lex_line, LexedLine, Token};

/// Which kind of block a line opens or closes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Turn,
    Form,
}

impl BlockKind {
    /// The keyword that opens it, as the messages spell it.
    #[must_use]
    pub fn opener(self) -> &'static str {
        match self {
            BlockKind::Turn => "TURN",
            BlockKind::Form => "FORM",
        }
    }

    /// The keyword that closes it.
    #[must_use]
    pub fn terminator(self) -> &'static str {
        match self {
            BlockKind::Turn => "ENDTURN",
            BlockKind::Form => "END",
        }
    }
}

/// Where a block was opened, for a message about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Opened {
    pub kind: BlockKind,
    pub number: usize,
    pub column_start: usize,
    pub column_end: usize,
}

/// One line, lexed, with its first token split off. `arguments` is everything after `command`.
#[derive(Debug)]
pub struct Line<'a> {
    /// 1-based line number.
    pub number: usize,
    pub text: &'a str,
    pub lexed: &'a LexedLine,
    pub command: &'a Token,
    pub arguments: &'a [Token],
}

/// How deep a line sits: `turn` open TURN blocks, `form` open FORM blocks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Depth {
    pub turn: usize,
    pub form: usize,
}

/// One thing the walk passes, in document order.
pub enum Event<'a> {
    /// A line the lexer could not finish: an unterminated quote. Nothing about it is classified and
    /// it changes no block. `span` is the quote's `(start, end)`.
    Broken {
        number: usize,
        text: &'a str,
        span: (usize, usize),
    },
    /// A `#…` line. Every open block was abandoned first - the `Abandoned` events for them precede
    /// this one.
    Directive(Line<'a>),
    /// A `unit …` line. Likewise preceded by `Abandoned` for every block still open.
    Unit(Line<'a>),
    /// `TURN` or `FORM`. `depth` is the depth *before* it opens.
    Open {
        line: Line<'a>,
        kind: BlockKind,
        depth: Depth,
    },
    /// `ENDTURN` or `END` closing the innermost open block, which was of its kind. `depth` is the
    /// depth *after* closing.
    Close {
        line: Line<'a>,
        kind: BlockKind,
        depth: Depth,
    },
    /// `ENDTURN` or `END` that closes nothing: no block open, or the innermost is of the other
    /// kind. The stack is unchanged.
    Stray {
        line: Line<'a>,
        expected: Option<Opened>,
        depth: Depth,
    },
    /// A block still open when a `unit` line, a `#` directive or the end of the document arrived.
    Abandoned(Opened),
    /// Any other line with a command: an order.
    Order { line: Line<'a>, depth: Depth },
}

fn depth_of(stack: &[Opened]) -> Depth {
    let mut depth = Depth::default();
    for opened in stack {
        match opened.kind {
            BlockKind::Turn => depth.turn += 1,
            BlockKind::Form => depth.form += 1,
        }
    }
    depth
}

/// Abandons every block still open, outermost first - the order `close_open_blocks` always
/// reported, since `Vec` push order is outermost-to-innermost.
fn abandon_all(stack: &mut Vec<Opened>, mut visit: impl FnMut(Event<'_>)) {
    for opened in stack.drain(..) {
        visit(Event::Abandoned(opened));
    }
}

/// Walks `source` and calls `visit` once per event, in document order. Blank lines and
/// comment-only lines produce no event. Every reader in this crate goes through here.
pub fn walk(source: &str, mut visit: impl FnMut(Event<'_>)) {
    let mut stack: Vec<Opened> = Vec::new();

    for (index, text) in source.lines().enumerate() {
        let number = index + 1;
        let lexed = lex_line(text);

        if let Some(span) = lexed.unterminated_quote {
            visit(Event::Broken { number, text, span });
            continue;
        }

        let Some((command, arguments)) = lexed.tokens.split_first() else {
            continue;
        };

        if command.text.starts_with('#') {
            abandon_all(&mut stack, &mut visit);
            visit(Event::Directive(Line {
                number,
                text,
                lexed: &lexed,
                command,
                arguments,
            }));
            continue;
        }

        if command.is("unit") {
            abandon_all(&mut stack, &mut visit);
            visit(Event::Unit(Line {
                number,
                text,
                lexed: &lexed,
                command,
                arguments,
            }));
            continue;
        }

        let kind = if command.is("TURN") {
            Some(BlockKind::Turn)
        } else if command.is("FORM") {
            Some(BlockKind::Form)
        } else {
            None
        };

        if let Some(kind) = kind {
            let depth = depth_of(&stack);
            let line = Line {
                number,
                text,
                lexed: &lexed,
                command,
                arguments,
            };
            visit(Event::Open { line, kind, depth });
            stack.push(Opened {
                kind,
                number,
                column_start: command.column_start,
                column_end: command.column_end,
            });
            continue;
        }

        let closes = if command.is("ENDTURN") {
            Some(BlockKind::Turn)
        } else if command.is("END") {
            Some(BlockKind::Form)
        } else {
            None
        };

        if let Some(kind) = closes {
            let line = Line {
                number,
                text,
                lexed: &lexed,
                command,
                arguments,
            };
            if stack.last().is_some_and(|opened| opened.kind == kind) {
                stack.pop();
                let depth = depth_of(&stack);
                visit(Event::Close { line, kind, depth });
            } else {
                let expected = stack.last().copied();
                let depth = depth_of(&stack);
                visit(Event::Stray {
                    line,
                    expected,
                    depth,
                });
            }
            continue;
        }

        let depth = depth_of(&stack);
        visit(Event::Order {
            line: Line {
                number,
                text,
                lexed: &lexed,
                command,
                arguments,
            },
            depth,
        });
    }

    abandon_all(&mut stack, &mut visit);
}

/// The last line number in `source` (0 for an empty document).
#[must_use]
pub fn last_line_number(source: &str) -> usize {
    source.lines().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summarize(source: &str) -> Vec<String> {
        let mut lines = Vec::new();
        walk(source, |event| {
            lines.push(match event {
                Event::Broken { number, .. } => format!("broken @{number}"),
                Event::Directive(line) => format!("directive @{}", line.number),
                Event::Unit(line) => format!("unit @{}", line.number),
                Event::Open { line, kind, depth } => format!(
                    "open {} @{} t{}f{}",
                    kind.opener(),
                    line.number,
                    depth.turn,
                    depth.form
                ),
                Event::Close { line, kind, depth } => format!(
                    "close {} @{} t{}f{}",
                    kind.opener(),
                    line.number,
                    depth.turn,
                    depth.form
                ),
                Event::Stray { line, expected, .. } => format!(
                    "stray {} @{} expects {}",
                    line.command.text,
                    line.number,
                    match expected {
                        Some(opened) => format!("{}@{}", opened.kind.terminator(), opened.number),
                        None => "nothing".to_string(),
                    }
                ),
                Event::Abandoned(opened) => {
                    format!("abandoned {}@{}", opened.kind.opener(), opened.number)
                }
                Event::Order { line, depth } => {
                    format!("order @{} t{}f{}", line.number, depth.turn, depth.form)
                }
            });
        });
        lines
    }

    #[test]
    fn a_turn_block_is_next_month() {
        assert_eq!(
            summarize("TURN\nWORK\nENDTURN\n"),
            vec!["open TURN @1 t0f0", "order @2 t1f0", "close TURN @3 t0f0"]
        );
    }

    #[test]
    fn a_form_block_nests_inside_a_turn() {
        assert_eq!(
            summarize("TURN\nFORM 1\nWORK\nEND\nENDTURN\n"),
            vec![
                "open TURN @1 t0f0",
                "open FORM @2 t1f0",
                "order @3 t1f1",
                "close FORM @4 t1f0",
                "close TURN @5 t0f0",
            ]
        );
    }

    #[test]
    fn end_does_not_close_a_turn_block() {
        assert_eq!(
            summarize("TURN\nEND\nWORK\nENDTURN\n"),
            vec![
                "open TURN @1 t0f0",
                "stray END @2 expects ENDTURN@1",
                "order @3 t1f0",
                "close TURN @4 t0f0",
            ]
        );
    }

    #[test]
    fn endturn_does_not_close_a_form_block() {
        assert_eq!(
            summarize("FORM 1\nENDTURN\nWORK\nEND\n"),
            vec![
                "open FORM @1 t0f0",
                "stray ENDTURN @2 expects END@1",
                "order @3 t0f1",
                "close FORM @4 t0f0",
            ]
        );
    }

    #[test]
    fn a_unit_line_abandons_every_open_block() {
        assert_eq!(
            summarize("TURN\nFORM 1\nunit 5\n"),
            vec![
                "open TURN @1 t0f0",
                "open FORM @2 t1f0",
                "abandoned TURN@1",
                "abandoned FORM@2",
                "unit @3",
            ]
        );
    }

    #[test]
    fn a_directive_abandons_every_open_block() {
        assert_eq!(
            summarize("TURN\n#end\n"),
            vec!["open TURN @1 t0f0", "abandoned TURN@1", "directive @2"]
        );
    }

    #[test]
    fn the_end_of_the_document_abandons_open_blocks() {
        assert_eq!(
            summarize("TURN\nFORM 1\n"),
            vec![
                "open TURN @1 t0f0",
                "open FORM @2 t1f0",
                "abandoned TURN@1",
                "abandoned FORM@2",
            ]
        );
    }

    #[test]
    fn a_repeat_prefix_and_case_do_not_matter() {
        assert_eq!(
            summarize("@turn\nWORK\nEndturn\n"),
            vec!["open TURN @1 t0f0", "order @2 t1f0", "close TURN @3 t0f0"]
        );
    }

    #[test]
    fn an_unterminated_quote_is_broken_and_changes_no_block() {
        assert_eq!(
            summarize("TURN\nNAME UNIT \"Merlin\n"),
            vec!["open TURN @1 t0f0", "broken @2", "abandoned TURN@1"],
            "the quote itself changes no block; the TURN is abandoned like any left open at the end"
        );
    }

    #[test]
    fn blank_and_comment_lines_produce_no_event() {
        assert_eq!(summarize("\n   \n;a comment\n"), Vec::<String>::new());
    }
}
