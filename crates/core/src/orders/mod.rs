//! Reading an Atlantis orders document, and saying what is wrong with it.
//!
//! This is a syntax checker and nothing else. Whether a unit can afford what it has been told to do,
//! whether anyone is left guarding the hex, whether a teacher has students - none of that is here,
//! because none of it can be decided from the text alone.
//!
//! The governing policy is **accept on doubt**. A false error costs the player their confidence in
//! every other diagnostic on the screen, so where the rules leave an argument open the parser leaves
//! it alone. The regression bar for that is a real report: the orders template committed at
//! `tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep` must validate with nothing to say.

pub mod effects;
pub mod grammar;
pub mod items;
pub mod lexer;
pub mod parser;

pub use grammar::order_commands;

use crate::OrderValidationResult;

/// Checks one orders document and reports everything wrong with its syntax.
///
/// `ruleset_json` is the ruleset the game is played under, when the shell has fetched it. It is
/// optional because the answer is useful without it: only the item catalogue needs it, and only to
/// raise warnings.
#[must_use]
pub fn validate_orders(source: &str, ruleset_json: Option<&str>) -> OrderValidationResult {
    parser::validate(source, ruleset_json)
}
