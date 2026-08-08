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

use super::scan::{parse_money, split_top_level, split_trailing_id};
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
            "Faction Status" | "Battles during turn" | "Skill reports" | "Item reports" => {
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
}
