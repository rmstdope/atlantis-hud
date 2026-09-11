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

pub mod blocks;
pub mod completion;
pub mod effects;
#[cfg(test)]
mod form_agreement;
pub mod forms;
pub mod grammar;
pub mod intents;
pub mod items;
pub mod lexer;
/// Core-internal: who may become a mage, and who already is one.
mod magic;
pub mod parser;
/// Core-internal: the one `rules/sequenceofevents` phase order both `semantics` and `silver` read.
mod phases;
pub mod semantics;
pub mod silver;
pub mod standing;
#[cfg(test)]
mod standing_agreement;
/// Core-internal: the one race-aware study ceiling both `semantics` and `completion` read.
mod study;
pub mod targets;
#[cfg(test)]
mod transfer_agreement;
/// Core-internal: the one Give-phase transfer record and report order both `effects` and
/// `semantics` read.
mod transfers;
pub mod vocabulary;
pub mod walk;

pub use completion::{
    completions_at_caret, order_argument_completions, CaretCompletions, CaretPosition,
    OrderCompletion,
};
pub use grammar::{order_commands, order_commands_with_ruleset};
pub use vocabulary::order_vocabulary;

use std::collections::HashSet;

use crate::movement::rules::Ruleset;
use crate::report::model::UnitRead;
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

        // Advice derived from a unit whose line the parser could not read is advice derived from
        // nothing: "no men" on a unit whose men were simply never read would appear every turn and
        // have to be dismissed by hand. It goes altogether rather than rule by rule, because which
        // rule read the unit's contents is a judgement nothing on screen would explain.
        //
        // `unit_id` is set only by the semantic checker - both syntax pushes set it to `None` on
        // purpose (`parser.rs`) - so the player's own typo inside such a unit's block is still
        // reported, which is right: that fault is in the orders, not in the report. A finding
        // carrying `formed` is kept for the same reason in reverse: its `unit_id` is a `NEW n`
        // alias for a unit this month's orders create, and the two id spaces can collide.
        let unread: HashSet<&str> = report
            .units()
            .filter(|unit| unit.read != UnitRead::Complete)
            .map(|unit| unit.unit_id.as_str())
            .collect();
        if !unread.is_empty() {
            diagnostics.retain(|diagnostic| {
                diagnostic.formed.is_some()
                    || !diagnostic
                        .unit_id
                        .as_deref()
                        .is_some_and(|id| unread.contains(id))
            });
        }
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
        formed: finding.formed,
        severity: OrderDiagnosticSeverity::Warning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::UnitRead;

    #[test]
    fn advice_about_a_unit_that_was_not_read_is_withheld() {
        let base = crate::report::parse_report_full(atlantis_hud_fixtures::G7_F95_T71.text);
        // Two units the checker actually has something to say about, taken from a first pass over
        // empty orders rather than assumed: which units draw advice is the fixture's business.
        let probe = validate_turn("", None, Some(&base), semantics::CheckOptions::default());
        let ids: Vec<String> = {
            let mut seen: Vec<String> = probe
                .diagnostics
                .iter()
                .filter_map(|diagnostic| diagnostic.unit_id.clone())
                .collect();
            seen.dedup();
            seen
        };
        assert!(
            ids.len() >= 2,
            "the fixture must draw advice against at least two units, or the test proves nothing"
        );
        let (unread_id, read_id) = (ids[0].clone(), ids[1].clone());
        // A malformed order inside the unread unit's own block. `AVOID` takes 0 or 1, so `AVOID 7`
        // is the player's typo - and it neither spends the month nor stops the checker having
        // something to say about the unit, which is what makes it the negative control here.
        let source = format!("unit {unread_id}\nAVOID 7\n");

        let before = validate_turn(
            &source,
            None,
            Some(&base),
            semantics::CheckOptions::default(),
        );
        let names = |result: &OrderValidationResult, id: &str| {
            result
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.unit_id.as_deref() == Some(id))
                .count()
        };
        assert!(
            names(&before, &unread_id) > 0 && names(&before, &read_id) > 0,
            "the orders must provoke advice against both units, or the test proves nothing"
        );
        let syntax_before = before
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == OrderDiagnosticSeverity::Error)
            .count();
        assert!(syntax_before > 0, "`AVOID 7` must be a syntax error");

        let mut report = base.clone();
        for region in &mut report.regions {
            for unit in &mut region.units {
                if unit.unit_id == unread_id {
                    unit.read = UnitRead::Nothing;
                }
            }
        }

        let after = validate_turn(
            &source,
            None,
            Some(&report),
            semantics::CheckOptions::default(),
        );
        assert_eq!(
            names(&after, &unread_id),
            0,
            "nothing derived from a unit that was never read should be said about it"
        );
        assert_eq!(
            names(&after, &read_id),
            names(&before, &read_id),
            "a unit the report carried whole is advised on exactly as before"
        );
        assert_eq!(
            after
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == OrderDiagnosticSeverity::Error)
                .count(),
            syntax_before,
            "the player's own typo is still theirs to fix, wherever it sits"
        );
    }
}
