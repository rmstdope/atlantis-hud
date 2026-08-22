//! Reading an Atlantis orders document, and saying what is wrong with it.
//!
//! This is a syntax checker and nothing else. Whether a unit can afford what it has been told to do,
//! whether anyone is left guarding the hex, whether a teacher has students - none of that is here,
//! because none of it can be decided from the text alone.
//!
//! The governing policy is **accept on doubt**. A false error costs the player their confidence in
//! every other diagnostic on the screen, so where the rules leave an argument open the parser leaves
//! it alone. The regression bar for that is a real report: the orders template committed as
//! `atlantis_hud_fixtures::G7_F95_T71` must validate with nothing to say.

pub mod completion;
pub mod effects;
pub mod forms;
pub mod grammar;
pub mod intents;
pub mod lexer;
pub mod parser;
pub mod semantics;
pub mod silver;
pub mod standing;
#[cfg(test)]
mod standing_agreement;
pub mod vocabulary;
pub mod walk;

pub use completion::{
    completions_at_caret, order_argument_completions, CaretCompletions, CaretPosition,
    OrderCompletion,
};
pub use grammar::order_commands;
pub use vocabulary::order_vocabulary;

use crate::movement::rules::Ruleset;
use crate::report::ParsedReport;
use crate::{OrderDiagnostic, OrderDiagnosticSeverity, OrderValidationResult};

/// Checks one orders document and reports everything wrong with its syntax.
///
/// `ruleset_json` is the ruleset the game is played under, when the shell has fetched it. It is
/// optional because the answer is useful without it: only the item catalogue needs it, and only to
/// raise warnings.
#[must_use]
pub fn validate_orders(source: &str, ruleset_json: Option<&str>) -> OrderValidationResult {
    parser::validate(source, ruleset_json)
}

/// Checks one orders document against the turn it was written for.
///
/// Syntax and semantics in one list, because the panel showing them has one place to look and one
/// count to show. Without a report the answer is exactly [`validate_orders`]: the pane validates
/// whatever the player has typed, and long before a report is imported that is still worth doing.
///
/// The report and ruleset arrive parsed rather than as text, so the caller may hold them across
/// calls. Validation runs on every keystroke once the typing settles, and re-parsing four hundred
/// units each time to answer the same question would be a poor way to spend the interval.
#[must_use]
pub fn validate_turn(
    source: &str,
    ruleset: Option<&Ruleset>,
    report: Option<&ParsedReport>,
    options: semantics::CheckOptions,
) -> OrderValidationResult {
    let mut diagnostics = parser::validate_against(source, ruleset).diagnostics;
    let mut silver = Vec::new();

    if let Some(report) = report {
        let review = semantics::review_turn(report, source, ruleset, options);
        silver = review.silver;
        diagnostics.extend(review.findings.into_iter().map(into_diagnostic));
    }

    // Line order across the whole document, as the panel has always shown them. What belongs to a
    // hex rather than to a line goes last, where it cannot push a line diagnostic out of place.
    diagnostics.sort_by_key(|diagnostic| (diagnostic.line_start.is_none(), diagnostic.line_start));

    OrderValidationResult {
        diagnostics,
        silver,
    }
}

/// Every semantic finding is a warning: see [`semantics`] for why blocking is reserved for syntax.
fn into_diagnostic(finding: semantics::Finding) -> OrderDiagnostic {
    OrderDiagnostic {
        code: finding.code.to_string(),
        message: finding.message,
        line_start: finding.line,
        line_end: finding.line,
        column_start: finding.column_start,
        column_end: finding.column_end,
        region_id: Some(finding.region_id),
        unit_id: finding.unit_id,
        severity: OrderDiagnosticSeverity::Warning,
    }
}
