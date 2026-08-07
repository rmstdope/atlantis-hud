//! Shared domain core for Atlantis HUD.

use serde::{Deserialize, Serialize};

/// Canonical cross-platform game metadata contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameInfo {
    /// Stable identifier used by platform adapters and clients.
    pub id: String,
    /// Display name for the game.
    pub name: String,
    /// Semantic version for the currently supported ruleset.
    pub ruleset_version: String,
    /// Maximum number of factions supported by the game.
    pub max_faction_count: u16,
}

/// Returns default game metadata shared across all platform adapters.
#[must_use]
pub fn game_info() -> GameInfo {
    GameInfo {
        id: "atlantis".to_string(),
        name: "Atlantis PBEM".to_string(),
        ruleset_version: "4.0".to_string(),
        max_faction_count: 128,
    }
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
#[must_use]
pub fn parse_report(_source: &str) -> ReportParseResult {
    let mut result = ReportParseResult {
        turn_header: None,
        detected_factions: Vec::new(),
        regions: Vec::new(),
        units: Vec::new(),
        inventories: Vec::new(),
        message_summaries: Vec::new(),
        warnings: Vec::new(),
    };

    for (index, line) in _source.lines().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("TURN:") {
            let parts = payload.split_whitespace().collect::<Vec<_>>();
            if parts.len() < 2 {
                push_warning(
                    &mut result.warnings,
                    "turn-malformed-line",
                    "turn",
                    "could not parse turn line",
                    line_number,
                );
                continue;
            }

            let parsed_turn_number = parts[0].parse::<u32>();
            match parsed_turn_number {
                Ok(turn_number) => {
                    result.turn_header = Some(TurnHeader {
                        turn_number,
                        season: parts[1].to_string(),
                    });
                }
                Err(_) => push_warning(
                    &mut result.warnings,
                    "turn-malformed-line",
                    "turn",
                    "could not parse turn line",
                    line_number,
                ),
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("FACTION:") {
            match split_fields(payload, 2) {
                Ok(fields) => result.detected_factions.push(FactionInfo {
                    faction_id: fields[0].to_string(),
                    name: fields[1].to_string(),
                }),
                Err(_) => push_warning(
                    &mut result.warnings,
                    "faction-malformed-line",
                    "faction",
                    "could not parse faction line",
                    line_number,
                ),
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("REGION:") {
            match split_fields(payload, 2) {
                Ok(fields) => result.regions.push(RegionSummary {
                    region_id: fields[0].to_string(),
                    name: fields[1].to_string(),
                }),
                Err(_) => push_warning(
                    &mut result.warnings,
                    "region-malformed-line",
                    "region",
                    "could not parse region line",
                    line_number,
                ),
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("UNIT:") {
            match split_fields(payload, 3) {
                Ok(fields) => result.units.push(UnitSummary {
                    unit_id: fields[0].to_string(),
                    name: fields[1].to_string(),
                    region_id: fields[2].to_string(),
                }),
                Err(_) => push_warning(
                    &mut result.warnings,
                    "unit-malformed-line",
                    "unit",
                    "could not parse unit line",
                    line_number,
                ),
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("ITEM:") {
            match split_fields(payload, 3) {
                Ok(fields) => match fields[2].parse::<i32>() {
                    Ok(quantity) => result.inventories.push(InventoryItem {
                        unit_id: fields[0].to_string(),
                        item: fields[1].to_string(),
                        quantity,
                    }),
                    Err(_) => push_warning(
                        &mut result.warnings,
                        "item-malformed-line",
                        "item",
                        "could not parse item line",
                        line_number,
                    ),
                },
                Err(_) => push_warning(
                    &mut result.warnings,
                    "item-malformed-line",
                    "item",
                    "could not parse item line",
                    line_number,
                ),
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("MESSAGE:") {
            match split_fields(payload, 3) {
                Ok(fields) => result.message_summaries.push(MessageSummary {
                    kind: fields[0].to_string(),
                    source: fields[1].to_string(),
                    text: fields[2].to_string(),
                }),
                Err(_) => push_warning(
                    &mut result.warnings,
                    "message-malformed-line",
                    "message",
                    "could not parse message line",
                    line_number,
                ),
            }
            continue;
        }
    }

    result
}

fn split_fields(input: &str, expected_len: usize) -> Result<Vec<&str>, ()> {
    let fields = input
        .split('|')
        .map(str::trim)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    if fields.len() == expected_len {
        Ok(fields)
    } else {
        Err(())
    }
}

fn push_warning(
    warnings: &mut Vec<ParseWarning>,
    code: &str,
    section: &str,
    message: &str,
    line_number: usize,
) {
    warnings.push(ParseWarning {
        code: code.to_string(),
        section: section.to_string(),
        message: message.to_string(),
        line_start: line_number,
        line_end: line_number,
        severity: WarningSeverity::Warning,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_info_uses_stable_identifier() {
        assert_eq!(game_info().id, "atlantis");
    }

    #[test]
    fn game_info_exposes_expected_metadata() {
        assert_eq!(
            game_info(),
            GameInfo {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }

    #[test]
    fn parse_report_extracts_major_sections_from_valid_report() {
        let source = "\
TURN: 12 Spring
FACTION: 17 | Crimson Tide
REGION: R1 | Coast of Dawn
UNIT: U100 | Guard Patrol | R1
ITEM: U100 | silver | 12
MESSAGE: order | U100 | MOVE R2";

        let parsed = parse_report(source);

        assert_eq!(
            parsed.turn_header,
            Some(TurnHeader {
                turn_number: 12,
                season: "Spring".to_string(),
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
            vec![RegionSummary {
                region_id: "R1".to_string(),
                name: "Coast of Dawn".to_string(),
            }]
        );
        assert_eq!(
            parsed.units,
            vec![UnitSummary {
                unit_id: "U100".to_string(),
                name: "Guard Patrol".to_string(),
                region_id: "R1".to_string(),
            }]
        );
        assert_eq!(
            parsed.inventories,
            vec![InventoryItem {
                unit_id: "U100".to_string(),
                item: "silver".to_string(),
                quantity: 12,
            }]
        );
        assert_eq!(
            parsed.message_summaries,
            vec![MessageSummary {
                kind: "order".to_string(),
                source: "U100".to_string(),
                text: "MOVE R2".to_string(),
            }]
        );
        assert!(parsed.warnings.is_empty());
        assert!(parsed.meets_minimum_import_threshold());
    }

    #[test]
    fn parse_report_emits_warning_but_keeps_partial_results_for_malformed_sections() {
        let source = "\
TURN: 12 Spring
FACTION: 17 | Crimson Tide
REGION: R1 | Coast of Dawn
UNIT: MALFORMED LINE
UNIT: U101 | Caravan | R1
MESSAGE: summary | R1 | Local unrest reported";

        let parsed = parse_report(source);

        assert_eq!(
            parsed.turn_header,
            Some(TurnHeader {
                turn_number: 12,
                season: "Spring".to_string(),
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
            parsed.units,
            vec![UnitSummary {
                unit_id: "U101".to_string(),
                name: "Caravan".to_string(),
                region_id: "R1".to_string(),
            }]
        );
        assert_eq!(
            parsed.warnings,
            vec![ParseWarning {
                code: "unit-malformed-line".to_string(),
                section: "unit".to_string(),
                message: "could not parse unit line".to_string(),
                line_start: 4,
                line_end: 4,
                severity: WarningSeverity::Warning,
            }]
        );
        assert!(parsed.meets_minimum_import_threshold());
    }
}
