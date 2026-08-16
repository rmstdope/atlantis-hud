//! Parses the report preamble: who the faction is, when the turn is, and what happened to it.
//!
//! ```text
//! Atlantis Report For:
//! Borg TNG (95) (Magic 5)
//! December, Year 6
//!
//! Atlantis Engine Version: 5.2.5 (beta)
//! NewOrigins, Version: 3.0.0 (beta)
//! ```

use serde::{Deserialize, Serialize};

use super::scan::{is_none_list, parse_money, split_top_level, split_trailing_id};
use super::unwrap::LogicalLine;

/// Months in the order the game advances through them.
const MONTHS: &[&str] = &[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// The preamble of a turn report.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "ReportHeaderInfo", export_to = "ReportHeaderInfo.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct ReportHeader {
    pub faction_id: Option<String>,
    pub faction_name: Option<String>,
    /// Faction type declarations, such as `Magic 5`.
    pub faction_types: Vec<String>,
    pub month: Option<String>,
    pub year: Option<u32>,
    /// Turn number derived from the date; see [`turn_number_for`].
    pub turn_number: Option<u32>,
    pub engine_version: Option<String>,
    pub ruleset: Option<String>,
    pub ruleset_version: Option<String>,
    pub unclaimed_silver: Option<i64>,
    pub errors: Vec<String>,
    pub events: Vec<String>,
    pub faction_status: FactionStatus,
    pub attitudes: DeclaredAttitudes,
}

/// The `Faction Status:` block: allowances the faction has used, of its maximum.
///
/// Key-agnostic: NewOrigins prints `Regions`, standard Atlantis prints `Tax Regions` and
/// `Trade Regions`. The label is whatever the ruleset printed.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionStatus {
    pub entries: Vec<FactionStatusEntry>,
    /// A status line that was not `Label: n (m)` shaped, carried rather than dropped.
    pub unparsed: Vec<String>,
}

/// One line of the `Faction Status:` block, such as `Regions: 3 (10)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionStatusEntry {
    pub label: String,
    pub used: i64,
    pub maximum: i64,
}

/// The `Declared Attitudes:` block.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DeclaredAttitudes {
    pub default_attitude: Option<String>,
    /// One entry per printed level, in the order the report prints them.
    pub levels: Vec<AttitudeLevel>,
}

/// One attitude level, such as `Hostile`, and the factions declared at it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AttitudeLevel {
    pub attitude: String,
    pub factions: Vec<FactionRef>,
}

/// A faction named in a `Declared Attitudes:` list, such as `Creatures (2)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FactionRef {
    pub name: String,
    pub id: String,
}

/// Converts a printed date into the game's turn number.
///
/// A game begins in February of Year 1, which is turn 1, and advances one month per turn. Verified
/// against three real reports: February Year 1 is turn 1, March Year 1 is turn 2, and December
/// Year 6 is turn 71.
#[must_use]
pub fn turn_number_for(month: &str, year: u32) -> Option<u32> {
    let index = MONTHS
        .iter()
        .position(|candidate| candidate.eq_ignore_ascii_case(month.trim()))?;
    let month_number = u32::try_from(index).ok()? + 1;

    (year.checked_sub(1)?)
        .checked_mul(12)?
        .checked_add(month_number)?
        .checked_sub(1)
}

/// Reads `December, Year 6`.
fn parse_date(body: &str) -> Option<(String, u32)> {
    let (month, year_part) = body.trim().trim_end_matches('.').split_once(',')?;
    let year = year_part
        .trim()
        .strip_prefix("Year ")?
        .trim()
        .parse()
        .ok()?;
    let month = month.trim().to_string();
    MONTHS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(&month))
        .then_some((month, year))
}

/// Reads `Borg TNG (95) (Magic 5)`, where the trailing parenthetical lists faction types.
fn parse_faction(body: &str) -> Option<(String, String, Vec<String>)> {
    let trimmed = body.trim().trim_end_matches('.');

    // The type list, when present, is the final parenthetical and is not a number.
    let (head, types) = match trimmed.rfind('(') {
        Some(open) if trimmed.ends_with(')') => {
            let inner = &trimmed[open + 1..trimmed.len() - 1];
            if inner.chars().all(|c| c.is_ascii_digit()) {
                (trimmed, Vec::new())
            } else {
                (
                    trimmed[..open].trim(),
                    split_top_level(inner, ',')
                        .into_iter()
                        .filter(|entry| !entry.is_empty())
                        .collect(),
                )
            }
        }
        _ => (trimmed, Vec::new()),
    };

    let (name, id) = split_trailing_id(head)?;
    Some((name, id, types))
}

/// Which preamble list a line currently belongs to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Section {
    None,
    Errors,
    Events,
    FactionStatus,
    Attitudes,
}

/// Reads `Declared Attitudes (default Unfriendly):`, returning the default attitude.
fn parse_attitudes_header(body: &str) -> Option<String> {
    let trimmed = body.trim_end_matches(':');
    let inner = trimmed
        .strip_prefix("Declared Attitudes (default ")?
        .strip_suffix(')')?;
    Some(inner.trim().to_string())
}

/// Reads one `Faction Status:` line, such as `Regions: 3 (10)`.
fn parse_faction_status_entry(body: &str) -> Option<FactionStatusEntry> {
    let (label, rest) = body.split_once(':')?;
    let (used_text, max_text) = rest.trim().split_once('(')?;
    let used = used_text.trim().parse::<i64>().ok()?;
    let maximum = max_text.trim().trim_end_matches(')').parse::<i64>().ok()?;

    Some(FactionStatusEntry {
        label: label.trim().to_string(),
        used,
        maximum,
    })
}

/// Reads one `Declared Attitudes:` line, such as `Hostile : Creatures (2), ... .` or
/// `Unfriendly : none.`.
///
/// A comma is only top level between entries, as elsewhere in this module (see [`parse_faction`]),
/// so a faction name that itself contained a top-level comma would be split — no such name has been
/// seen in a real report. An entry that does not end in `Name (id)` is dropped tolerantly rather
/// than failing the whole line, matching this parser's general contract.
fn parse_attitude_level(body: &str) -> Option<AttitudeLevel> {
    let (attitude, rest) = body.split_once(':')?;
    let rest = rest.trim();

    let factions = if is_none_list(rest) {
        Vec::new()
    } else {
        split_top_level(rest.trim_end_matches('.'), ',')
            .into_iter()
            .filter_map(|entry| split_trailing_id(&entry))
            .map(|(name, id)| FactionRef { name, id })
            .collect()
    };

    Some(AttitudeLevel {
        attitude: attitude.trim().to_string(),
        factions,
    })
}

/// Parses the preamble of a report.
///
/// Everything is optional. A report missing a section simply leaves those fields empty rather than
/// failing, in keeping with the parser's tolerant contract.
#[must_use]
pub fn parse_header(lines: &[LogicalLine]) -> ReportHeader {
    let mut header = ReportHeader::default();
    let mut section = Section::None;
    let mut expecting_faction = false;

    // The caller passes only the lines before the first region block, so there is no need to guess
    // where the preamble ends. Marked lines do appear here: battle rosters list units.
    for line in lines {
        let body = line.body();

        if let Some(default_attitude) = parse_attitudes_header(body) {
            header.attitudes.default_attitude = Some(default_attitude);
            section = Section::Attitudes;
            continue;
        }

        match body.trim_end_matches(':') {
            "Atlantis Report For" => {
                expecting_faction = true;
                section = Section::None;
                continue;
            }
            "Errors during turn" => {
                section = Section::Errors;
                continue;
            }
            "Events during turn" => {
                section = Section::Events;
                continue;
            }
            "Faction Status" => {
                section = Section::FactionStatus;
                continue;
            }
            "Battles during turn" | "Skill reports" | "Item reports" => {
                section = Section::None;
                continue;
            }
            _ => {}
        }

        if expecting_faction {
            if let Some((name, id, types)) = parse_faction(body) {
                header.faction_name = Some(name);
                header.faction_id = Some(id);
                header.faction_types = types;
                expecting_faction = false;
                continue;
            }
        }

        if header.month.is_none() {
            if let Some((month, year)) = parse_date(body) {
                header.turn_number = turn_number_for(&month, year);
                header.month = Some(month);
                header.year = Some(year);
                continue;
            }
        }

        if let Some(value) = body.strip_prefix("Atlantis Engine Version:") {
            header.engine_version = Some(value.trim().to_string());
            section = Section::None;
            continue;
        }

        if let Some((ruleset, version)) = body.split_once(", Version:") {
            if header.ruleset.is_none() && !ruleset.contains(' ') {
                header.ruleset = Some(ruleset.trim().to_string());
                header.ruleset_version = Some(version.trim().to_string());
                section = Section::None;
                continue;
            }
        }

        if let Some(value) = body.strip_prefix("Unclaimed silver:") {
            header.unclaimed_silver = parse_money(value);
            section = Section::None;
            continue;
        }

        match section {
            Section::Errors => header.errors.push(body.to_string()),
            Section::Events => header.events.push(body.to_string()),
            Section::FactionStatus => match parse_faction_status_entry(body) {
                Some(entry) => header.faction_status.entries.push(entry),
                None => header.faction_status.unparsed.push(body.to_string()),
            },
            Section::Attitudes => {
                if let Some(level) = parse_attitude_level(body) {
                    header.attitudes.levels.push(level);
                }
            }
            Section::None => {}
        }
    }

    header
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::unwrap::unwrap_lines;

    #[test]
    fn derives_the_turn_number_from_the_printed_date() {
        // A game starts in February of Year 1.
        assert_eq!(turn_number_for("February", 1), Some(1));
        assert_eq!(turn_number_for("March", 1), Some(2));
        assert_eq!(turn_number_for("December", 6), Some(71));
        assert_eq!(turn_number_for("Nonesuch", 6), None);
    }

    #[test]
    fn reads_the_faction_and_date() {
        let header = parse_header(&unwrap_lines(concat!(
            "Atlantis Report For:\n",
            "Borg TNG (95) (Magic 5)\n",
            "December, Year 6\n",
            "\n",
            "Atlantis Engine Version: 5.2.5 (beta)\n",
            "NewOrigins, Version: 3.0.0 (beta)\n",
        )));

        assert_eq!(header.faction_name.as_deref(), Some("Borg TNG"));
        assert_eq!(header.faction_id.as_deref(), Some("95"));
        assert_eq!(header.faction_types, vec!["Magic 5"]);
        assert_eq!(header.month.as_deref(), Some("December"));
        assert_eq!(header.year, Some(6));
        assert_eq!(header.turn_number, Some(71));
        assert_eq!(header.engine_version.as_deref(), Some("5.2.5 (beta)"));
        assert_eq!(header.ruleset.as_deref(), Some("NewOrigins"));
        assert_eq!(header.ruleset_version.as_deref(), Some("3.0.0 (beta)"));
    }

    #[test]
    fn reads_multiple_faction_types() {
        let header = parse_header(&unwrap_lines(concat!(
            "Atlantis Report For:\n",
            "Borg (73) (Martial 1, Magic 1)\n",
            "February, Year 1\n",
        )));

        assert_eq!(header.faction_types, vec!["Martial 1", "Magic 1"]);
        assert_eq!(header.turn_number, Some(1));
    }

    #[test]
    fn collects_errors_and_events_separately() {
        let header = parse_header(&unwrap_lines(concat!(
            "Errors during turn:\n",
            "Unit (1387): BUY: Unit attempted to buy more than it could afford.\n",
            "Unit (1387): STUDY: Not enough funds.\n",
            "\n",
            "Events during turn:\n",
            "Times reward of 200 silver.\n",
            "\n",
            "Unclaimed silver: 4935.\n",
        )));

        assert_eq!(header.errors.len(), 2);
        assert_eq!(header.events.len(), 1);
        assert_eq!(header.unclaimed_silver, Some(4935));
    }

    #[test]
    fn joins_a_wrapped_attitude_line() {
        // Real text from the f95 fixture: the Hostile line wraps across three physical lines, and
        // the wrapping is the fact under test, not an assumption — see unwrap.rs.
        let lines = unwrap_lines(concat!(
            "Declared Attitudes (default Unfriendly):\n",
            "Hostile : Creatures (2), The Guardsmen (1), Dark League (28),\n",
            "  Gyperboreya (42), Truth Seekers (44), Thousand Masks (49), Ennead\n",
            "  (52), Surveyors (55), Restless Nomads (58), MMF (79), Heirs of the\n",
            "  Sun (90).\n",
            "Unfriendly : none.\n",
        ));

        let hostile = lines
            .iter()
            .find(|line| line.body().starts_with("Hostile"))
            .expect("a single logical Hostile line");
        assert!(hostile.text.contains("Heirs of the Sun (90)"));
    }

    #[test]
    fn reads_the_declared_attitudes() {
        let header = parse_header(&unwrap_lines(concat!(
            "Declared Attitudes (default Neutral):\n",
            "Hostile : Creatures (2).\n",
            "Unfriendly : none.\n",
            "Neutral : none.\n",
            "Friendly : none.\n",
            "Ally : Borg TNG (95).\n",
        )));

        assert_eq!(
            header.attitudes.default_attitude.as_deref(),
            Some("Neutral")
        );
        assert_eq!(header.attitudes.levels.len(), 5);
        assert_eq!(header.attitudes.levels[0].attitude, "Hostile");
        assert_eq!(
            header.attitudes.levels[0].factions,
            vec![FactionRef {
                name: "Creatures".to_string(),
                id: "2".to_string()
            }]
        );
        assert_eq!(header.attitudes.levels[4].attitude, "Ally");
        assert_eq!(
            header.attitudes.levels[4].factions,
            vec![FactionRef {
                name: "Borg TNG".to_string(),
                id: "95".to_string()
            }]
        );
    }

    #[test]
    fn reads_an_attitude_level_of_none_as_an_empty_list() {
        let header = parse_header(&unwrap_lines(concat!(
            "Declared Attitudes (default Unfriendly):\n",
            "Hostile : none.\n",
        )));

        assert_eq!(header.attitudes.levels.len(), 1);
        assert_eq!(header.attitudes.levels[0].attitude, "Hostile");
        assert!(header.attitudes.levels[0].factions.is_empty());
    }

    #[test]
    fn reads_the_faction_status_as_used_of_maximum() {
        let header = parse_header(&unwrap_lines(concat!(
            "Faction Status:\n",
            "Regions: 3 (10)\n",
            "Quartermasters: 0 (0)\n",
            "Mages: 6 (6)\n",
            "Apprentices: 0 (15)\n",
        )));

        assert_eq!(header.faction_status.entries.len(), 4);
        assert_eq!(
            header.faction_status.entries[0],
            FactionStatusEntry {
                label: "Regions".to_string(),
                used: 3,
                maximum: 10
            }
        );
        assert_eq!(
            header.faction_status.entries[3],
            FactionStatusEntry {
                label: "Apprentices".to_string(),
                used: 0,
                maximum: 15
            }
        );
        assert!(header.faction_status.unparsed.is_empty());
    }

    #[test]
    fn does_not_care_what_the_status_keys_are_called() {
        let header = parse_header(&unwrap_lines(concat!(
            "Faction Status:\n",
            "Tax Regions: 3 (10)\n",
            "Trade Regions: 1 (4)\n",
        )));

        assert_eq!(header.faction_status.entries[0].label, "Tax Regions");
        assert_eq!(header.faction_status.entries[1].label, "Trade Regions");
    }

    #[test]
    fn keeps_a_status_line_it_does_not_understand() {
        let header = parse_header(&unwrap_lines(concat!(
            "Faction Status:\n",
            "Regions: 3 (10)\n",
            "A line the parser has never seen before.\n",
            "Mages: 6 (6)\n",
        )));

        assert_eq!(header.faction_status.entries.len(), 2);
        assert_eq!(
            header.faction_status.unparsed,
            vec!["A line the parser has never seen before.".to_string()]
        );
    }

    #[test]
    fn parses_a_report_with_neither_block() {
        let header = parse_header(&unwrap_lines(concat!(
            "Atlantis Report For:\n",
            "Borg TNG (95) (Magic 5)\n",
            "December, Year 6\n",
        )));

        assert!(header.faction_status.entries.is_empty());
        assert!(header.faction_status.unparsed.is_empty());
        assert!(header.attitudes.default_attitude.is_none());
        assert!(header.attitudes.levels.is_empty());
        assert_eq!(header.faction_name.as_deref(), Some("Borg TNG"));
    }

    #[test]
    fn does_not_swallow_the_unclaimed_silver_line() {
        let header = parse_header(&unwrap_lines(concat!(
            "Faction Status:\n",
            "Regions: 3 (10)\n",
            "Unclaimed silver: 6038.\n",
        )));

        assert_eq!(header.unclaimed_silver, Some(6038));
        assert!(header
            .faction_status
            .entries
            .iter()
            .all(|entry| entry.label != "Unclaimed silver"));
        assert!(header
            .faction_status
            .unparsed
            .iter()
            .all(|line| !line.starts_with("Unclaimed silver")));
    }
}
