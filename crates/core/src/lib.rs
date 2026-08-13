//! Shared domain core for Atlantis HUD.

pub mod cache;
pub mod movement;
pub mod orders;
pub mod report;

use serde::{Deserialize, Serialize};

/// Canonical cross-platform metadata about the Atlantis engine itself.
///
/// This describes the *engine* a report comes from, not a game the player has created. The two
/// were both called `GameInfo` until games became a first-class thing the player names and picks
/// between, at which point one name for two unrelated ideas stopped being tolerable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineInfo {
    /// Stable identifier used by platform adapters and clients.
    pub id: String,
    /// Display name for the engine.
    pub name: String,
    /// Semantic version for the currently supported ruleset.
    pub ruleset_version: String,
    /// Maximum number of factions supported by the engine.
    pub max_faction_count: u16,
}

/// Returns default engine metadata shared across all platform adapters.
#[must_use]
pub fn engine_info() -> EngineInfo {
    EngineInfo {
        id: "atlantis".to_string(),
        name: "Atlantis PBEM".to_string(),
        ruleset_version: "4.0".to_string(),
        max_faction_count: 128,
    }
}

/// Severity for order validation diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderDiagnosticSeverity {
    Warning,
    Error,
}

/// Structured diagnostic emitted by the order validator.
///
/// Every anchor is optional, and each for its own reason. A misspelled keyword belongs to a line
/// and to no hex; a unit that cannot pay for its orders belongs to a line, a unit and a hex; a hex
/// that nobody is left guarding belongs to a hex and to nothing else. Filling the missing ones in
/// with a plausible value - line 0, or the first unit in the region - would send the player to a
/// place where nothing is wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDiagnostic {
    pub code: String,
    pub message: String,
    /// The line it sits on, or `None` when it belongs to a hex rather than to any one order.
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
    /// Where the offending text starts within its line, counted from 0 in **UTF-16 code units**.
    ///
    /// The parser knows which *token* is wrong, not merely which line, and throwing that away would
    /// have to be recovered later: the editor this feeds is to gain inline underlines in #6. A
    /// diagnostic about a whole line spans the whole line.
    ///
    /// UTF-16 rather than bytes because this is a wire type: it crosses into JavaScript, which
    /// indexes strings by UTF-16 code unit, and a consumer slicing with byte offsets would quote the
    /// wrong characters on any line carrying an accent. See [`orders::lexer::Token`].
    pub column_start: Option<usize>,
    /// One past the end of it, on the same counting, so the consumer can slice `[start..end]`.
    pub column_end: Option<usize>,
    /// The hex it concerns, for the checks that read the report. Never set by the syntax checker,
    /// which knows nothing of the map.
    #[serde(default)]
    pub region_id: Option<String>,
    /// The unit at fault, where one unit is at fault.
    #[serde(default)]
    pub unit_id: Option<String>,
    pub severity: OrderDiagnosticSeverity,
}

/// Validation result for one draft of Atlantis orders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderValidationResult {
    pub diagnostics: Vec<OrderDiagnostic>,
}

impl OrderValidationResult {
    #[must_use]
    pub fn error_count(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|diagnostic| matches!(diagnostic.severity, OrderDiagnosticSeverity::Error))
            .count()
    }

    #[must_use]
    pub fn warning_count(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|diagnostic| matches!(diagnostic.severity, OrderDiagnosticSeverity::Warning))
            .count()
    }

    #[must_use]
    pub fn is_blocking(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|diagnostic| matches!(diagnostic.severity, OrderDiagnosticSeverity::Error))
    }
}

/// The order vocabulary and the syntax checker, which live in [`orders`].
///
/// Re-exported here because the adapters and the wire contract have always reached for them at the
/// crate root. What changed underneath is that a command name is no longer all that is checked: see
/// [`orders`] for the lexer and grammar that replaced the list this used to be.
pub use orders::semantics::CheckOptions as OrderCheckOptions;
pub use orders::{order_commands, validate_orders, validate_turn};

/// Severity level emitted by the tolerant report parser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WarningSeverity {
    Warning,
    Error,
}

/// Structured warning emitted while parsing a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseWarning {
    pub code: String,
    pub section: String,
    pub message: String,
    pub line_start: usize,
    pub line_end: usize,
    pub severity: WarningSeverity,
}

/// Canonical turn header extracted from a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnHeader {
    pub turn_number: u32,
    pub season: String,
}

/// Faction identity candidate extracted from a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactionInfo {
    pub faction_id: String,
    pub name: String,
}

/// Region summary extracted from a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegionSummary {
    pub region_id: String,
    pub name: String,
}

/// Unit summary extracted from a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnitSummary {
    pub unit_id: String,
    pub name: String,
    pub region_id: String,
}

/// Inventory item extracted from a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventoryItem {
    pub unit_id: String,
    pub item: String,
    pub quantity: i32,
}

/// Parsed order or message summary from a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageSummary {
    pub kind: String,
    pub source: String,
    pub text: String,
}

/// Tolerant parser output for one report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportParseResult {
    pub turn_header: Option<TurnHeader>,
    pub detected_factions: Vec<FactionInfo>,
    pub regions: Vec<RegionSummary>,
    pub units: Vec<UnitSummary>,
    pub inventories: Vec<InventoryItem>,
    pub message_summaries: Vec<MessageSummary>,
    pub warnings: Vec<ParseWarning>,
}

impl ReportParseResult {
    /// Returns whether parsed data meets minimum import viability.
    #[must_use]
    pub fn meets_minimum_import_threshold(&self) -> bool {
        self.turn_header.is_some()
            && !self.detected_factions.is_empty()
            && (!self.regions.is_empty() || !self.units.is_empty())
    }
}

/// Parses a single Atlantis report using tolerant semantics.
///
/// This is the flat summary the wire contract has always exposed. It is now derived from the real
/// NewOrigins parser in [`report`], so the same input drives both this and the richer model that
/// [`report::parse_report_full`] returns.
#[must_use]
pub fn parse_report(source: &str) -> ReportParseResult {
    summarize(&report::parse_report_full(source))
}

/// The same flat summary, from a report that has already been parsed.
///
/// Split out from [`parse_report`] so that an import can have both shapes for one parse: the
/// summary is what gets stored and what the import rules are decided against, while the regions
/// that get remembered one by one come from the full model beside it.
#[must_use]
pub fn summarize(parsed: &report::ParsedReport) -> ReportParseResult {
    let turn_header = parsed
        .header
        .turn_number
        .zip(parsed.header.month.clone())
        .map(|(turn_number, season)| TurnHeader {
            turn_number,
            season,
        });

    // Only the reporting faction. This list is what `reject_import` treats as acceptable values for
    // the confirmed faction, so it must never include the foreign factions a report merely makes
    // visible: confirming under one of those would file the turn under someone else's faction.
    // Foreign factions are still available, on the units that belong to them.
    let detected_factions: Vec<FactionInfo> = match (
        parsed.header.faction_id.clone(),
        parsed.header.faction_name.clone(),
    ) {
        (Some(faction_id), Some(name)) => vec![FactionInfo { faction_id, name }],
        _ => Vec::new(),
    };

    let mut units = Vec::new();
    let mut inventories = Vec::new();
    for unit in parsed.units() {
        units.push(UnitSummary {
            unit_id: unit.unit_id.clone(),
            name: unit.name.clone(),
            region_id: unit.region_id.clone(),
        });

        for item in &unit.items {
            inventories.push(InventoryItem {
                unit_id: unit.unit_id.clone(),
                item: item.name.clone(),
                quantity: i32::try_from(item.amount).unwrap_or(i32::MAX),
            });
        }
    }

    let regions = parsed
        .regions
        .iter()
        .map(|region| RegionSummary {
            region_id: region.region_id.clone(),
            name: region.label(),
        })
        .collect();

    let message_summaries = parsed
        .header
        .errors
        .iter()
        .map(|text| MessageSummary {
            kind: "error".to_string(),
            source: "turn".to_string(),
            text: text.clone(),
        })
        .chain(parsed.header.events.iter().map(|text| MessageSummary {
            kind: "event".to_string(),
            source: "turn".to_string(),
            text: text.clone(),
        }))
        .collect();

    let mut warnings = Vec::new();
    if turn_header.is_none() {
        warnings.push(ParseWarning {
            code: "turn-header-missing".to_string(),
            section: "header".to_string(),
            message: "report has no recognisable turn date".to_string(),
            line_start: 1,
            line_end: 1,
            severity: WarningSeverity::Warning,
        });
    }

    ReportParseResult {
        turn_header,
        detected_factions,
        regions,
        units,
        inventories,
        message_summaries,
        warnings,
    }
}

/// Checks whether a parsed report may be imported under the confirmed faction.
///
/// Returns `None` when the import is admissible, and otherwise the reason to refuse it. Keeping
/// this here rather than in each adapter is what stops the desktop and the browser from accepting
/// different reports; the messages are part of the contract, so both platforms report the same
/// refusal for the same input.
#[must_use]
pub fn reject_import(parsed: &ReportParseResult, confirmed_faction_id: &str) -> Option<String> {
    if !parsed.meets_minimum_import_threshold() {
        return Some("parsed report did not meet minimum import threshold".to_string());
    }

    let faction_is_detected = parsed
        .detected_factions
        .iter()
        .any(|faction| faction.faction_id == confirmed_faction_id);
    if !faction_is_detected {
        return Some("confirmed faction does not exist in parsed report candidates".to_string());
    }

    if parsed.turn_header.is_none() {
        return Some("turn header missing from parsed report".to_string());
    }

    None
}

/// Checks whether a parsed report may be merged into the turn the viewer has open.
///
/// Deliberately not [`reject_import`]. That asks whether a report may be *filed under* a faction,
/// and it answers by looking in `detected_factions` - which holds only the reporting faction, on
/// purpose. An ally's report is never filed under the viewer, so asking `reject_import` about it
/// would refuse every merge there is. What matters here is different: that the report is worth
/// reading at all, that it says whose it is, and that it describes the same turn the viewer is
/// looking at. Same turn, because two reports for one turn describe the same moment and neither is
/// staler than the other - which is the whole reason a merge needs no arbitration by age.
///
/// A report that clears the threshold has already been found to name its faction, so the caller
/// can read the faction off it without checking again.
#[must_use]
pub fn reject_merge(parsed: &ReportParseResult, viewer_turn_number: u32) -> Option<String> {
    if !parsed.meets_minimum_import_threshold() {
        return Some("parsed report did not meet minimum import threshold".to_string());
    }

    let Some(turn_header) = parsed.turn_header.as_ref() else {
        return Some("turn header missing from parsed report".to_string());
    };

    if turn_header.turn_number != viewer_turn_number {
        return Some(format!(
            "a report from turn {} cannot be merged into turn {viewer_turn_number}",
            turn_header.turn_number
        ));
    }

    None
}

/// The parts of a stored turn import that decide whether re-importing changes anything.
///
/// Deliberately free of any storage concern so both the desktop SQLite layer and the browser
/// storage adapter can reach the same verdict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTurnSnapshot {
    pub raw_report: String,
    pub parsed_payload_json: String,
    pub warnings_payload_json: String,
}

/// How a candidate import compares against what is already stored for the same key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTurnDiff {
    pub exists: bool,
    pub raw_changed: bool,
    pub parsed_changed: bool,
    pub warnings_changed: bool,
}

/// Borrowed view of a snapshot, so callers holding the payloads already need not copy them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportedTurnSnapshotRef<'a> {
    pub raw_report: &'a str,
    pub parsed_payload_json: &'a str,
    pub warnings_payload_json: &'a str,
}

impl ImportedTurnSnapshot {
    #[must_use]
    pub fn as_ref(&self) -> ImportedTurnSnapshotRef<'_> {
        ImportedTurnSnapshotRef {
            raw_report: &self.raw_report,
            parsed_payload_json: &self.parsed_payload_json,
            warnings_payload_json: &self.warnings_payload_json,
        }
    }
}

/// Compares a candidate import against the stored one, if any.
///
/// A candidate with no stored counterpart reports `exists: false` and no changes, because there is
/// nothing to overwrite. This is what drives the overwrite confirmation, so desktop and web must
/// never disagree about it.
#[must_use]
pub fn diff_imported_turn(
    existing: Option<&ImportedTurnSnapshot>,
    candidate: &ImportedTurnSnapshot,
) -> ImportedTurnDiff {
    diff_imported_turn_fields(
        existing.map(ImportedTurnSnapshot::as_ref),
        candidate.as_ref(),
    )
}

/// Borrowing form of [`diff_imported_turn`], for callers that already hold the payloads.
#[must_use]
pub fn diff_imported_turn_fields(
    existing: Option<ImportedTurnSnapshotRef<'_>>,
    candidate: ImportedTurnSnapshotRef<'_>,
) -> ImportedTurnDiff {
    let Some(existing) = existing else {
        return ImportedTurnDiff {
            exists: false,
            raw_changed: false,
            parsed_changed: false,
            warnings_changed: false,
        };
    };

    ImportedTurnDiff {
        exists: true,
        raw_changed: existing.raw_report != candidate.raw_report,
        parsed_changed: existing.parsed_payload_json != candidate.parsed_payload_json,
        warnings_changed: existing.warnings_payload_json != candidate.warnings_payload_json,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TURN_71: &str =
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");

    // --- the widened validation contract ----------------------------------------------------

    const MINI_ORDERS_REPORT: &str = concat!(
        "Atlantis Report For:\n",
        "Crimson Tide (17) (Magic 5)\n",
        "March, Year 1\n",
        "\n",
        "plain (12,34) in Coast of Dawn, 1200 peasants (humans), $500.\n",
        "------------------------------------------------------------\n",
        "  Wages: $12.0 (Max: $300).\n",
        "\n",
        "* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN], 40 silver [SILV].\n",
    );

    fn turn(orders: &str) -> OrderValidationResult {
        let parsed = report::parse_report_full(MINI_ORDERS_REPORT);
        validate_turn(orders, None, Some(&parsed), OrderCheckOptions::default())
    }

    /// The whole point of widening the call: one list, syntax and semantics together, so the panel
    /// has one place to look and one count to show.
    #[test]
    fn one_call_returns_both_the_syntax_and_the_semantic_problems() {
        let result = turn("unit 100\nFLY 1 2\nGIVE 7 100 SILV\n");

        assert_eq!(
            result
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.as_str())
                .collect::<Vec<_>>(),
            vec!["unknown-command", "not-enough-silver"]
        );
    }

    #[test]
    fn a_semantic_finding_is_a_warning_and_never_blocks_the_export() {
        let result = turn("unit 100\nGIVE 7 100 SILV\n");

        assert_eq!(result.diagnostics.len(), 1, "{:?}", result.diagnostics);
        assert_eq!(
            result.diagnostics[0].severity,
            OrderDiagnosticSeverity::Warning
        );
        assert!(
            !result.is_blocking(),
            "a bad turn is still an exportable one"
        );
    }

    /// A syntax error still blocks, because the server refuses the file over it. That is the whole
    /// distinction the severity carries.
    #[test]
    fn a_syntax_error_still_blocks_the_export() {
        assert!(turn("unit 100\nFLY 1 2\n").is_blocking());
    }

    #[test]
    fn a_semantic_finding_carries_the_hex_and_the_unit_it_belongs_to() {
        let diagnostic = turn("unit 100\nGIVE 7 100 SILV\n").diagnostics.remove(0);

        assert_eq!(diagnostic.region_id.as_deref(), Some("1:12,34"));
        assert_eq!(diagnostic.unit_id.as_deref(), Some("100"));
        assert_eq!(diagnostic.line_start, Some(2));
    }

    /// "Nobody is guarding this hex" is the hex's problem and sits on no line at all, which is why
    /// the anchors had to become optional rather than be faked.
    #[test]
    fn a_finding_that_belongs_to_no_line_carries_none_rather_than_a_pretend_one() {
        let options = OrderCheckOptions {
            warn_on_unguarded_hex: true,
        };
        let parsed = report::parse_report_full(MINI_ORDERS_REPORT);
        let result = validate_turn("unit 100\n@work\n", None, Some(&parsed), options);

        assert_eq!(
            result
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.as_str())
                .collect::<Vec<_>>(),
            vec!["hex-unguarded"]
        );
        assert_eq!(result.diagnostics[0].line_start, None);
        assert_eq!(result.diagnostics[0].column_start, None);
        assert_eq!(result.diagnostics[0].unit_id, None);
        assert_eq!(result.diagnostics[0].region_id.as_deref(), Some("1:12,34"));
    }

    /// A syntax diagnostic knows its line and always did; widening the type must not have quietly
    /// cost it that.
    #[test]
    fn a_syntax_diagnostic_still_knows_exactly_where_it_is() {
        let diagnostic = turn("unit 100\nGIVE 4573 swords\n").diagnostics.remove(0);

        assert_eq!(diagnostic.code, "bad-argument");
        assert_eq!(diagnostic.line_start, Some(2));
        assert_eq!(
            (diagnostic.column_start, diagnostic.column_end),
            (Some(10), Some(16))
        );
        assert_eq!(
            diagnostic.region_id, None,
            "a misspelling belongs to no hex"
        );
    }

    /// Before a report is imported the panel still validates what is being typed. Without one, the
    /// answer must be exactly what it was before this feature existed.
    #[test]
    fn without_a_report_validation_is_the_syntax_check_it_always_was() {
        let with_none = validate_turn(
            "unit 100\nFLY 1 2\nGIVE 7 100 SILV\n",
            None,
            None,
            OrderCheckOptions::default(),
        );

        assert_eq!(
            with_none,
            validate_orders("unit 100\nFLY 1 2\nGIVE 7 100 SILV\n", None)
        );
    }

    /// A report the parser could make nothing of holds no regions, so there is nothing to check
    /// against and nothing is said. The player's orders are not at fault for a bad file.
    #[test]
    fn a_report_with_nothing_in_it_produces_no_semantic_findings() {
        let parsed = report::parse_report_full("no report here at all");
        let result = validate_turn(
            "unit 100\nGIVE 7 100 SILV\n",
            None,
            Some(&parsed),
            OrderCheckOptions::default(),
        );

        assert_eq!(result.diagnostics, vec![]);
    }

    /// What the summary carries, asserted against the report rather than against itself.
    ///
    /// Comparing `summarize(&parse_report_full(x))` with `parse_report(x)` would prove nothing:
    /// the second is now defined as the first, so the two sides are the same expression and the
    /// parser being deterministic is all it could ever show.
    #[test]
    fn the_summary_carries_the_turn_the_faction_and_what_it_saw() {
        let summary = summarize(&report::parse_report_full(TURN_71));

        assert_eq!(
            summary.turn_header,
            Some(TurnHeader {
                turn_number: 71,
                season: "December".to_string(),
            })
        );
        assert_eq!(summary.detected_factions.len(), 1, "only the reporting one");
        assert_eq!(summary.detected_factions[0].faction_id, "95");
        assert_eq!(summary.regions.len(), 11);
        assert!(summary.units.len() > 400);
        assert!(summary.meets_minimum_import_threshold());
    }

    /// The warning branch, which a report that parses cleanly never reaches.
    #[test]
    fn a_report_with_no_turn_header_is_summarized_as_one_and_says_so() {
        let summary = summarize(&report::parse_report_full("Lonely (1) Report\n"));

        assert_eq!(summary.turn_header, None);
        assert!(
            summary
                .warnings
                .iter()
                .any(|warning| warning.code == "turn-header-missing"),
            "warnings were: {:?}",
            summary.warnings
        );
        assert!(!summary.meets_minimum_import_threshold());
    }

    fn snapshot(raw: &str, parsed: &str, warnings: &str) -> ImportedTurnSnapshot {
        ImportedTurnSnapshot {
            raw_report: raw.to_string(),
            parsed_payload_json: parsed.to_string(),
            warnings_payload_json: warnings.to_string(),
        }
    }

    /// These structs cross the WebAssembly boundary into TypeScript, which expects camelCase.
    /// A nested struct does not inherit its parent's `rename_all`, so the casing is pinned here:
    /// getting it wrong silently hands the browser fields it cannot read.
    #[test]
    fn wire_shapes_are_camel_case() {
        let snapshot = serde_json::to_string(&snapshot("raw", "parsed", "warnings"))
            .expect("snapshot should serialize");
        assert_eq!(
            snapshot,
            r#"{"rawReport":"raw","parsedPayloadJson":"parsed","warningsPayloadJson":"warnings"}"#
        );

        let diff = serde_json::to_string(&diff_imported_turn(None, &snapshot_default()))
            .expect("diff should serialize");
        assert_eq!(
            diff,
            r#"{"exists":false,"rawChanged":false,"parsedChanged":false,"warningsChanged":false}"#
        );
    }

    fn snapshot_default() -> ImportedTurnSnapshot {
        snapshot("raw", "parsed", "warnings")
    }

    /// A small but genuine NewOrigins report, used wherever a test needs one inline.
    const MINI_REPORT: &str = concat!(
        "Atlantis Report For:\n",
        "Crimson Tide (17) (Magic 5)\n",
        "March, Year 1\n",
        "\n",
        "Atlantis Engine Version: 5.2.5 (beta)\n",
        "NewOrigins, Version: 3.0.0 (beta)\n",
        "\n",
        "Errors during turn:\n",
        "Unit (100): STUDY: Not enough funds.\n",
        "\n",
        "Unclaimed silver: 40.\n",
        "\n",
        "plain (12,34) in Coast of Dawn, contains Dawnhaven [town], 1200 peasants (humans), $500.\n",
        "------------------------------------------------------------\n",
        "  Wages: $12.0 (Max: $300).\n",
        "  Products: 10 grain [GRAI].\n",
        "\n",
        "Exits:\n",
        "  North : forest (12,32) in Forest of Whispers.\n",
        "\n",
        "* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN].\n",
        "\n",
        "forest (12,32) in Forest of Whispers, 800 peasants (humans), $200.\n",
        "------------------------------------------------------------\n",
        "  Wages: $10.0 (Max: $200).\n",
        "\n",
        "* Ranger Squad (200), Crimson Tide (17), behind, 5 humans [HUMN].\n",
    );

    #[test]
    fn admissible_import_is_not_rejected() {
        assert_eq!(reject_import(&parse_report(MINI_REPORT), "17"), None);
    }

    #[test]
    fn import_below_the_viability_threshold_is_rejected() {
        let rejection = reject_import(&parse_report("no report here at all"), "17");
        assert_eq!(
            rejection.as_deref(),
            Some("parsed report did not meet minimum import threshold")
        );
    }

    #[test]
    fn a_faction_that_merely_appears_in_the_report_is_not_a_candidate() {
        // A report shows foreign units, and their factions are visible on those units. Confirming
        // an import under one of them would file the turn under someone else's faction, so only the
        // reporting faction is ever a candidate.
        let with_neighbour = MINI_REPORT.replace(
            "* Ranger Squad (200), Crimson Tide (17), behind, 5 humans [HUMN].",
            "- Watcher (900), Distant Drummer (15), avoiding, behind, 1 human [HUMN].",
        );

        let parsed = parse_report(&with_neighbour);
        assert_eq!(
            parsed
                .detected_factions
                .iter()
                .map(|faction| faction.faction_id.as_str())
                .collect::<Vec<_>>(),
            vec!["17"],
            "the neighbour is visible but is not a candidate"
        );

        // The neighbour is still reachable, on the unit that belongs to it.
        assert!(parsed.units.iter().any(|unit| unit.unit_id == "900"));

        assert_eq!(
            reject_import(&parsed, "15").as_deref(),
            Some("confirmed faction does not exist in parsed report candidates")
        );
    }

    #[test]
    fn import_under_an_undetected_faction_is_rejected() {
        let rejection = reject_import(&parse_report(MINI_REPORT), "99");
        assert_eq!(
            rejection.as_deref(),
            Some("confirmed faction does not exist in parsed report candidates")
        );
    }

    /// The mini report is March, Year 1, which the header module numbers turn 2.
    #[test]
    fn a_report_for_the_turn_on_screen_may_be_merged() {
        assert_eq!(reject_merge(&parse_report(MINI_REPORT), 2), None);
    }

    #[test]
    fn a_report_from_another_turn_cannot_be_merged() {
        let rejection = reject_merge(&parse_report(MINI_REPORT), 71);
        assert_eq!(
            rejection.as_deref(),
            Some("a report from turn 2 cannot be merged into turn 71"),
            "the refusal names both turns, because the player has to know which file to find"
        );
    }

    #[test]
    fn a_merge_below_the_viability_threshold_is_rejected() {
        let rejection = reject_merge(&parse_report("no report here at all"), 2);
        assert_eq!(
            rejection.as_deref(),
            Some("parsed report did not meet minimum import threshold")
        );
    }

    /// The trap this function exists to avoid: `detected_factions` holds only the reporting
    /// faction, so deciding a merge with [`reject_import`] would refuse every ally there is.
    #[test]
    fn a_merge_is_not_refused_for_belonging_to_the_wrong_faction() {
        let parsed = parse_report(MINI_REPORT);

        assert_eq!(reject_merge(&parsed, 2), None);
        assert!(
            reject_import(&parsed, "95").is_some(),
            "the same report filed under the viewer would be refused"
        );
    }

    #[test]
    fn diff_reports_no_conflict_when_nothing_is_stored() {
        let candidate = snapshot("raw", "parsed", "warnings");

        assert_eq!(
            diff_imported_turn(None, &candidate),
            ImportedTurnDiff {
                exists: false,
                raw_changed: false,
                parsed_changed: false,
                warnings_changed: false,
            }
        );
    }

    #[test]
    fn diff_reports_existing_but_unchanged_for_an_identical_reimport() {
        let stored = snapshot("raw", "parsed", "warnings");
        let candidate = stored.clone();

        assert_eq!(
            diff_imported_turn(Some(&stored), &candidate),
            ImportedTurnDiff {
                exists: true,
                raw_changed: false,
                parsed_changed: false,
                warnings_changed: false,
            }
        );
    }

    #[test]
    fn diff_flags_each_payload_independently() {
        let stored = snapshot("raw", "parsed", "warnings");

        let raw_only = diff_imported_turn(Some(&stored), &snapshot("other", "parsed", "warnings"));
        assert!(raw_only.raw_changed && !raw_only.parsed_changed && !raw_only.warnings_changed);

        let parsed_only = diff_imported_turn(Some(&stored), &snapshot("raw", "other", "warnings"));
        assert!(!parsed_only.raw_changed && parsed_only.parsed_changed);

        let warnings_only = diff_imported_turn(Some(&stored), &snapshot("raw", "parsed", "other"));
        assert!(!warnings_only.parsed_changed && warnings_only.warnings_changed);
    }

    #[test]
    fn engine_info_uses_stable_identifier() {
        assert_eq!(engine_info().id, "atlantis");
    }

    #[test]
    fn engine_info_exposes_expected_metadata() {
        assert_eq!(
            engine_info(),
            EngineInfo {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }

    #[test]
    fn parse_report_extracts_major_sections_from_valid_report() {
        let parsed = parse_report(MINI_REPORT);

        assert_eq!(
            parsed.turn_header,
            Some(TurnHeader {
                turn_number: 2,
                season: "March".to_string(),
            })
        );
        assert_eq!(
            parsed.detected_factions,
            vec![FactionInfo {
                faction_id: "17".to_string(),
                name: "Crimson Tide".to_string(),
            }]
        );
        assert_eq!(
            parsed.regions,
            vec![
                RegionSummary {
                    region_id: "1:12,34".to_string(),
                    name: "plain (12,34) in Coast of Dawn".to_string(),
                },
                RegionSummary {
                    region_id: "1:12,32".to_string(),
                    name: "forest (12,32) in Forest of Whispers".to_string(),
                },
            ]
        );
        assert_eq!(
            parsed.units,
            vec![
                UnitSummary {
                    unit_id: "100".to_string(),
                    name: "Guard Patrol".to_string(),
                    region_id: "1:12,34".to_string(),
                },
                UnitSummary {
                    unit_id: "200".to_string(),
                    name: "Ranger Squad".to_string(),
                    region_id: "1:12,32".to_string(),
                },
            ]
        );
        assert_eq!(
            parsed.inventories,
            vec![
                InventoryItem {
                    unit_id: "100".to_string(),
                    item: "humans".to_string(),
                    quantity: 10,
                },
                InventoryItem {
                    unit_id: "200".to_string(),
                    item: "humans".to_string(),
                    quantity: 5,
                },
            ]
        );
        assert_eq!(parsed.message_summaries.len(), 1, "one turn error");
        assert_eq!(parsed.message_summaries[0].kind, "error");
        assert!(parsed.warnings.is_empty());
        assert!(parsed.meets_minimum_import_threshold());
    }

    #[test]
    fn parse_report_warns_but_keeps_partial_results_when_the_date_is_unreadable() {
        // The preamble is damaged, but the region blocks are intact and must survive.
        let damaged = MINI_REPORT.replace("March, Year 1", "Sometime, Whenever");
        let parsed = parse_report(&damaged);

        assert_eq!(parsed.turn_header, None);
        assert_eq!(
            parsed
                .warnings
                .iter()
                .map(|w| w.code.as_str())
                .collect::<Vec<_>>(),
            vec!["turn-header-missing"]
        );
        assert_eq!(parsed.regions.len(), 2, "regions still parse");
        assert_eq!(parsed.units.len(), 2, "units still parse");
        // Without a turn the import is not viable, which is the tolerant contract working.
        assert!(!parsed.meets_minimum_import_threshold());
    }
}
