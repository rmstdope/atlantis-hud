//! Splitting one line of an orders document into tokens.
//!
//! The rules page states the lexical grammar outright, and this module implements exactly that
//! sentence and no more:
//!
//! > Each type of order is designated by giving a keyword as the first non-blank item on a line.
//! > Parameters are given after this, separated by spaces or tabs. Blank lines are permitted, as are
//! > comments; anything after a semicolon is treated as a comment (provided the semicolon is not in
//! > the middle of a word). The parser is not case sensitive [...] when supplying names containing
//! > spaces, the name must be surrounded by double quotes, or else underscore characters must be
//! > used in place of spaces in the name.
//!
//! Hand written rather than regex based, for the reason [`crate::report::scan`] gives: the crate has
//! no regex dependency and is not about to acquire one for this.

/// What a token is, as far as splitting the line can tell.
///
/// Deliberately not what the token *means*: whether `95` is a faction or a quantity is the grammar's
/// business, and a lexer that guessed would have to be told the command first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// Bare text: a keyword, an item tag, an underscored name, anything unquoted.
    Word,
    /// Nothing but ASCII digits.
    Number,
    /// Was written inside double quotes. The quotes are not part of [`Token::text`].
    Quoted,
}

/// One token, and where on the line it was written.
///
/// The columns are byte offsets into the *original* line, indentation and the `@` included, so a
/// diagnostic points at what the player typed rather than at some normalised copy of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    pub column_start: usize,
    pub column_end: usize,
}

impl Token {
    /// Whether the token is this keyword, ignoring case as the game's own parser does.
    #[must_use]
    pub fn is(&self, keyword: &str) -> bool {
        self.text.eq_ignore_ascii_case(keyword)
    }
}

/// A half-open byte range within a line.
pub type Span = (usize, usize);

/// One line, split.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LexedLine {
    /// Whether the line was written with a leading `@`, which repeats the order every turn.
    pub repeat: bool,
    pub tokens: Vec<Token>,
    /// The comment, from its semicolon to the end of the line.
    pub comment: Option<Span>,
    /// A quote that was opened and never closed, from the quote to the end of the line.
    ///
    /// The tokens up to that point are still returned: an order is not worth abandoning over its
    /// last argument.
    pub unterminated_quote: Option<Span>,
}

impl LexedLine {
    /// Whether the line carries no order at all - blank, or nothing but a comment.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }
}

/// Splits one line into tokens.
#[must_use]
pub fn lex_line(line: &str) -> LexedLine {
    let bytes = line.as_bytes();
    let end = bytes.len();
    let mut lexed = LexedLine::default();
    let mut at = skip_blanks(bytes, 0);

    if bytes.get(at) == Some(&b'@') {
        lexed.repeat = true;
        at = skip_blanks(bytes, at + 1);
    }

    while at < end {
        at = skip_blanks(bytes, at);
        if at >= end {
            break;
        }

        match bytes[at] {
            b';' => {
                lexed.comment = Some((at, end));
                return lexed;
            }
            b'"' => {
                let Some(closing) = find_byte(bytes, at + 1, b'"') else {
                    lexed.unterminated_quote = Some((at, end));
                    return lexed;
                };
                lexed.tokens.push(Token {
                    kind: TokenKind::Quoted,
                    text: line[at + 1..closing].to_string(),
                    column_start: at,
                    column_end: closing + 1,
                });
                at = closing + 1;
            }
            _ => {
                let (word_end, comment_starts) = scan_word(bytes, at);
                let text = &line[at..word_end];
                lexed.tokens.push(Token {
                    kind: if is_number(text) {
                        TokenKind::Number
                    } else {
                        TokenKind::Word
                    },
                    text: text.to_string(),
                    column_start: at,
                    column_end: word_end,
                });
                if comment_starts {
                    lexed.comment = Some((word_end, end));
                    return lexed;
                }
                at = word_end;
            }
        }
    }

    lexed
}

fn skip_blanks(bytes: &[u8], from: usize) -> usize {
    let mut at = from;
    while matches!(bytes.get(at), Some(b' ' | b'\t' | b'\r')) {
        at += 1;
    }
    at
}

fn find_byte(bytes: &[u8], from: usize, wanted: u8) -> Option<usize> {
    (from..bytes.len()).find(|&at| bytes[at] == wanted)
}

/// Reads a bare word, and says whether a comment starts where it ended.
///
/// The semicolon rule is the fiddly one. A semicolon only opens a comment when it is *not* in the
/// middle of a word, so what decides it is what comes after: `friendly; Squirrels` ends the word and
/// comments the rest, while `friend;ly` is one word with a semicolon in it. The first form appears in
/// the committed turn 71 report, so reading it as part of the word would invent an error on real
/// orders.
fn scan_word(bytes: &[u8], from: usize) -> (usize, bool) {
    let mut at = from;
    while at < bytes.len() {
        match bytes[at] {
            b' ' | b'\t' | b'\r' => return (at, false),
            b';' if at + 1 >= bytes.len() || matches!(bytes[at + 1], b' ' | b'\t' | b'\r') => {
                return (at, true)
            }
            _ => at += 1,
        }
    }
    (at, false)
}

fn is_number(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(line: &str) -> Vec<String> {
        lex_line(line)
            .tokens
            .into_iter()
            .map(|token| token.text)
            .collect()
    }

    #[test]
    fn splits_a_keyword_from_its_parameters() {
        assert_eq!(
            texts("GIVE 4573 10 swords"),
            ["GIVE", "4573", "10", "swords"]
        );
    }

    #[test]
    fn separates_on_tabs_as_well_as_spaces() {
        // "Parameters are given after this, separated by spaces or tabs."
        assert_eq!(
            texts("GIVE\t4573\t 10\tswords"),
            ["GIVE", "4573", "10", "swords"]
        );
    }

    #[test]
    fn columns_are_byte_offsets_into_the_line_as_written() {
        let lexed = lex_line("  @give 0 all spea");
        let columns: Vec<(usize, usize)> = lexed
            .tokens
            .iter()
            .map(|token| (token.column_start, token.column_end))
            .collect();

        assert_eq!(columns, [(3, 7), (8, 9), (10, 13), (14, 18)]);
        assert_eq!(&"  @give 0 all spea"[14..18], "spea");
    }

    #[test]
    fn a_leading_at_sign_marks_a_repeating_order_and_is_not_a_token() {
        let lexed = lex_line("@study obse");

        assert!(lexed.repeat);
        assert_eq!(texts("@study obse"), ["study", "obse"]);
        assert_eq!(
            lexed.tokens[0].column_start, 1,
            "the @ is not part of the word"
        );
    }

    #[test]
    fn a_line_without_an_at_sign_does_not_repeat() {
        assert!(!lex_line("study obse").repeat);
    }

    #[test]
    fn a_semicolon_at_the_start_of_a_token_begins_a_comment() {
        let lexed = lex_line(";Seven of Eight (18642), avoiding.");

        assert!(lexed.tokens.is_empty());
        assert_eq!(
            lexed.comment,
            Some((0, ";Seven of Eight (18642), avoiding.".len()))
        );
    }

    #[test]
    fn a_repeating_comment_is_still_a_comment() {
        // Real reports carry "@;" lines.
        let lexed = lex_line("@;keep the caravan moving");

        assert!(lexed.repeat);
        assert!(lexed.tokens.is_empty());
        assert_eq!(lexed.comment, Some((1, 25)));
    }

    /// This exact line is in the committed turn 71 report, so it is not a hypothetical.
    #[test]
    fn a_semicolon_ending_a_word_begins_a_comment() {
        let lexed = lex_line("@declare 43 friendly; Squirrels");

        assert_eq!(
            texts("@declare 43 friendly; Squirrels"),
            ["declare", "43", "friendly"]
        );
        assert_eq!(lexed.comment, Some((20, 31)));
    }

    #[test]
    fn a_semicolon_in_the_middle_of_a_word_belongs_to_the_word() {
        // "provided the semicolon is not in the middle of a word" - so this one is not a comment.
        assert_eq!(
            texts("declare 43 friend;ly"),
            ["declare", "43", "friend;ly"]
        );
        assert_eq!(lex_line("declare 43 friend;ly").comment, None);
    }

    #[test]
    fn a_quoted_name_is_one_token_without_its_quotes() {
        let lexed = lex_line("NAME UNIT \"Merlin's Guards\"");

        assert_eq!(
            texts("NAME UNIT \"Merlin's Guards\""),
            ["NAME", "UNIT", "Merlin's Guards"]
        );
        assert_eq!(lexed.tokens[2].kind, TokenKind::Quoted);
        // The span covers the quotes, because that is what the player would see underlined.
        assert_eq!(
            (lexed.tokens[2].column_start, lexed.tokens[2].column_end),
            (10, 27)
        );
    }

    #[test]
    fn a_semicolon_inside_quotes_is_not_a_comment() {
        assert_eq!(
            texts("NAME UNIT \"Odd; Name\""),
            ["NAME", "UNIT", "Odd; Name"]
        );
        assert_eq!(lex_line("NAME UNIT \"Odd; Name\"").comment, None);
    }

    #[test]
    fn a_quote_that_is_never_closed_is_reported_and_the_rest_kept() {
        let lexed = lex_line("NAME UNIT \"Merlin");

        assert_eq!(lexed.unterminated_quote, Some((10, 17)));
        assert_eq!(
            lexed
                .tokens
                .iter()
                .map(|t| t.text.as_str())
                .collect::<Vec<_>>(),
            ["NAME", "UNIT"],
            "what was readable before the quote survives"
        );
    }

    #[test]
    fn digits_alone_are_a_number_and_anything_else_is_a_word() {
        let lexed = lex_line("GIVE 0 10x LBOW");
        let kinds: Vec<TokenKind> = lexed.tokens.iter().map(|token| token.kind).collect();

        assert_eq!(
            kinds,
            [
                TokenKind::Word,
                TokenKind::Number,
                TokenKind::Word,
                TokenKind::Word
            ]
        );
    }

    #[test]
    fn a_quoted_number_is_still_quoted() {
        // QUIT "foobar" takes a password, which may look like anything at all.
        assert_eq!(lex_line("QUIT \"1234\"").tokens[1].kind, TokenKind::Quoted);
    }

    #[test]
    fn a_blank_line_carries_nothing() {
        assert!(lex_line("").is_empty());
        assert!(lex_line("   \t ").is_empty());
        assert_eq!(lex_line("   ").comment, None);
    }

    #[test]
    fn underscores_are_left_alone_for_the_grammar_to_deal_with() {
        assert_eq!(texts("BUY 1 Plate_Armor"), ["BUY", "1", "Plate_Armor"]);
    }

    #[test]
    fn keyword_comparison_ignores_case() {
        let lexed = lex_line("@STUDY PATT");
        assert!(lexed.tokens[0].is("study"));
        assert!(!lexed.tokens[0].is("work"));
    }
}
