//! Shared domain core for Atlantis HUD.

pub mod cache;
pub mod movement;
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderDiagnostic {
    pub code: String,
    pub message: String,
    pub line_start: usize,
    pub line_end: usize,
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

/// Order commands the NewOrigins ruleset accepts.
///
/// Only the command name is checked. Argument shapes vary widely between orders and depend on game
/// state the parser does not have, so inventing arity rules would reject valid orders — worse for a
/// player than letting the server have the last word.
pub const ORDER_COMMANDS: &[&str] = &[
    "ADDRESS",
    "ADVANCE",
    "ANNIHILATE",
    "ARMOR",
    "ASSASSINATE",
    "ATTACK",
    "AUTOTAX",
    "AVOID",
    "BEHIND",
    "BUILD",
    "BUY",
    "CAST",
    "CLAIM",
    "COMBAT",
    "CONSUME",
    "DECLARE",
    "DESCRIBE",
    "DESTROY",
    "ENDFORM",
    "ENDTURN",
    "ENTER",
    "ENTERTAIN",
    "EVICT",
    "EXCHANGE",
    "FACTION",
    "FIND",
    "FORGET",
    "FORM",
    "GIVE",
    "GUARD",
    "HOLD",
    "IDLE",
    "JOIN",
    "LEAVE",
    "MOVE",
    "NAME",
    "NOAID",
    "NOCROSS",
    "NOSPOILS",
    "OPTION",
    "PASSWORD",
    "PILLAGE",
    "PREPARE",
    "PRODUCE",
    "PROMOTE",
    "QUIT",
    "RESTART",
    "REVEAL",
    "SAIL",
    "SELL",
    "SHARE",
    "SHOW",
    "SPOILS",
    "STEAL",
    "STUDY",
    "SWEAR",
    "TAKE",
    "TAX",
    "TEACH",
    "TRANSPORT",
    "TURN",
    "WEAPON",
    "WISHDRAW",
    "WITHDRAW",
    "WORK",
];

/// Validates one order document, line by line.
///
/// Tolerant by design: it rejects commands the ruleset has no such thing as, and otherwise leaves
/// judgement to the server, which alone knows the game state an order depends on.
#[must_use]
pub fn validate_orders(source: &str) -> OrderValidationResult {
    let mut diagnostics = Vec::new();

    for (index, line) in source.lines().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim();

        // Blank lines, comments, and the document's own directives carry no orders.
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        // A leading `@` marks a repeating order; it does not change which command this is. A
        // repeating comment, `@;`, is still only a comment.
        let without_repeat = trimmed.strip_prefix('@').unwrap_or(trimmed);
        if without_repeat.starts_with(';') {
            continue;
        }
        let Some(command) = without_repeat.split_whitespace().next() else {
            continue;
        };

        // `unit 1234` opens a unit's block in an orders document rather than ordering anything.
        if command.eq_ignore_ascii_case("unit") {
            continue;
        }

        if !ORDER_COMMANDS
            .iter()
            .any(|known| known.eq_ignore_ascii_case(command))
        {
            diagnostics.push(OrderDiagnostic {
                code: "unknown-command".to_string(),
                message: format!("unknown order command: {command}"),
                line_start: line_number,
                line_end: line_number,
                severity: OrderDiagnosticSeverity::Error,
            });
            continue;
        }

        let args = without_repeat.split_whitespace().skip(1).count();
        if command.eq_ignore_ascii_case("move") && args == 0 {
            diagnostics.push(OrderDiagnostic {
                code: "missing-arguments".to_string(),
                message: "MOVE needs at least one direction".to_string(),
                line_start: line_number,
                line_end: line_number,
                severity: OrderDiagnosticSeverity::Error,
            });
        }
    }

    OrderValidationResult { diagnostics }
}

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
        include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");

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

    #[test]
    fn validate_orders_accepts_the_neworigins_vocabulary() {
        let result = validate_orders(concat!(
            "@study obse\n",
            "@claim 50\n",
            "give 242 100 SILV\n",
            "MOVE n n\n",
            "sail se\n",
            "work\n",
        ));

        assert!(
            result.diagnostics.is_empty(),
            "unexpected diagnostics: {:?}",
            result.diagnostics
        );
    }

    #[test]
    fn validate_orders_ignores_document_structure_and_comments() {
        // An orders document seeded from a report carries all of this verbatim.
        let result = validate_orders(concat!(
            "#atlantis 95 \"secret\"\n",
            ";*** mountain (7,53) in Inhead ***\n",
            "unit 18642\n",
            ";Seven of Eight (18642), avoiding, behind.\n",
            "@work\n",
            "#end\n",
        ));

        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn validate_orders_treats_a_repeating_comment_as_a_comment() {
        // Real reports carry "@;" lines. Stripping the "@" and reading ";" as a command turned
        // every one of them into an error.
        let result = validate_orders("@;keep the caravan moving\n@study obse");
        assert!(
            result.diagnostics.is_empty(),
            "unexpected diagnostics: {:?}",
            result.diagnostics
        );
    }

    #[test]
    fn validate_orders_reports_an_unknown_command() {
        let result = validate_orders("FLY 1 2");

        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "unknown-command");
        assert!(result.diagnostics[0].message.contains("FLY"));
        assert!(result.is_blocking());
    }

    #[test]
    fn validate_orders_requires_a_direction_for_move() {
        let result = validate_orders("MOVE");

        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "missing-arguments");
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
