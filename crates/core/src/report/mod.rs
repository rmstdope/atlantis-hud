//! Parsing of Atlantis turn reports.
//!
//! Target ruleset is NewOrigins 3.0.0 on Atlantis Engine 5.2.5. Parsing is tolerant by contract:
//! input the parser does not recognise produces a structured warning and partial results, never a
//! hard failure, because a player would rather see most of a turn than none of it.

pub mod battle;
pub mod composition;
pub mod export;
pub mod header;
pub mod import;
pub mod level;
pub mod merge;
pub mod model;
pub mod orders;
pub mod region;
pub mod scan;
pub mod sighting;
pub mod unit;
pub mod unwrap;
pub mod write;

pub use battle::Battle;
pub use composition::{classify_units, Classification};

use battle::parse_battles;
use header::{parse_header, ReportHeader};
use model::{LostBlock, ReportRegion, UnreadableKind, UnreadableLine};
use orders::{extract_orders_template, OrdersTemplate};
use region::{parse_region_block, parse_region_header};
use unwrap::{unwrap_lines, LogicalLine};

/// Everything the parser recovers from one turn report.
///
/// `battles` sits here rather than on `ReportHeader`: a battle is an event, not a fact about the
/// faction, and `ReportHeader` is the type mirrored by hand in TypeScript. It is also deliberately
/// absent from `ReportParseResult` (`crates/core/src/lib.rs`), which *is* persisted per turn - see
/// the module doc on `battle.rs` for why keeping the round statistics as text is safe here but
/// would roughly double a stored turn there.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ParsedReport {
    pub header: ReportHeader,
    pub regions: Vec<ReportRegion>,
    pub battles: Vec<Battle>,
    /// The orders document for the coming turn, when the report carries one.
    pub orders_template: Option<OrdersTemplate>,
    /// Every record the parser could not read, in file order. Empty for a healthy report.
    pub unreadable_lines: Vec<UnreadableLine>,
}

impl ParsedReport {
    /// Every unit across every region.
    pub fn units(&self) -> impl Iterator<Item = &model::ReportUnit> {
        self.regions.iter().flat_map(|region| region.units.iter())
    }

    /// Units belonging to the reporting faction.
    pub fn own_units(&self) -> impl Iterator<Item = &model::ReportUnit> {
        self.units().filter(|unit| unit.own)
    }
}

/// A region header sits at the outer indent, carries no marker, and opens with a lowercase terrain
/// followed by a coordinate.
///
/// The terrain check matters: `Errors during turn:` and other section headers also sit at the outer
/// indent, and an events line can mention a coordinate without opening a region.
pub(crate) fn opens_a_region(line: &LogicalLine) -> bool {
    if line.indent != 0 || line.marker().is_some() {
        return false;
    }

    let body = line.body();
    let Some(first) = body.split_whitespace().next() else {
        return false;
    };
    if !first.chars().all(|c| c.is_ascii_lowercase()) {
        return false;
    }

    parse_region_header(body).is_some()
}

/// Parses a turn report.
///
/// Sections the parser does not model yet are simply not region headers, so they fall away without
/// producing warnings or stopping the parse.
#[must_use]
pub fn parse_report_full(source: &str) -> ParsedReport {
    let lines = unwrap_lines(source);
    let starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| opens_a_region(line))
        .map(|(index, _)| index)
        .collect();

    let mut regions = Vec::new();
    let mut unreadable: Vec<UnreadableLine> = Vec::new();
    for (position, &start) in starts.iter().enumerate() {
        let end = starts.get(position + 1).copied().unwrap_or(lines.len());
        match parse_region_block(&lines[start], &lines[start + 1..end], &mut unreadable) {
            Some(region) => regions.push(region),
            // Defensive: `opens_a_region` already requires `parse_region_header` to succeed, so a
            // block that starts is a block that parses. Kept - and tested via `lost_region` - so a
            // future loosening of either side cannot lose a whole hex silently.
            None => unreadable.push(lost_region(&lines[start], &lines[start + 1..end])),
        }
    }

    // The preamble is everything before the first region block.
    let preamble_end = starts.first().copied().unwrap_or(lines.len());

    let header = parse_header(&lines[..preamble_end], &mut unreadable);
    // A second, independent pass over the same preamble slice - see the note on `ParsedReport`.
    let battles = parse_battles(&lines[..preamble_end], &mut unreadable);

    // File order: the preamble is parsed after the regions, so the records arrive out of sequence.
    unreadable.sort_by_key(|entry| (entry.line_start, entry.line_end));

    ParsedReport {
        header,
        regions,
        battles,
        orders_template: extract_orders_template(source),
        unreadable_lines: unreadable,
    }
}

/// The record for a region block the parser rejected outright, and what went down with it.
fn lost_region(header: &LogicalLine, block: &[LogicalLine]) -> UnreadableLine {
    UnreadableLine {
        kind: UnreadableKind::Region,
        line_start: header.line_start,
        line_end: header.line_end,
        text: header.text.clone(),
        lost: Some(LostBlock {
            further_lines: block
                .last()
                .map_or(0, |line| line.line_end.saturating_sub(header.line_end)),
            units: block
                .iter()
                .filter(|line| matches!(line.marker(), Some('*' | '-')))
                .count(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use unwrap::unwrap_lines;

    #[test]
    fn an_unreadable_line_carries_its_range_kind_and_text() {
        let lines = unwrap_lines(concat!(
            "mountain (7,53) in Inhead, contains Tinsel [town]\n",
            "  Wages: $12.\n",
            "* Scout (1234), Borg (73), 1 leader.\n",
            "- Someone (99), 1 man.\n",
        ));

        let entry = lost_region(&lines[0], &lines[1..]);

        assert_eq!(entry.kind, UnreadableKind::Region);
        assert_eq!(entry.line_start, 1);
        assert_eq!(entry.line_end, 1);
        assert_eq!(
            entry.text,
            "mountain (7,53) in Inhead, contains Tinsel [town]"
        );
        assert_eq!(
            entry.lost,
            Some(LostBlock {
                further_lines: 3,
                units: 2,
            })
        );
    }

    #[test]
    fn lists_unreadable_records_in_file_order() {
        let mut source = String::from("Declared Attitudes (default Neutral):\n");
        source.push_str("Friendly : a faction whose name lost its number.\n");
        // Pad the preamble so the region's bad unit sits well below the attitude line.
        for _ in 0..20 {
            source.push('\n');
        }
        source.push_str("mountain (7,53) in Inhead.\n");
        source.push_str("* Nameless scout, 1 leader [LEAD].\n");

        let parsed = parse_report_full(&source);

        let kinds: Vec<UnreadableKind> = parsed
            .unreadable_lines
            .iter()
            .map(|entry| entry.kind)
            .collect();
        assert_eq!(kinds, vec![UnreadableKind::Attitude, UnreadableKind::Unit]);
        assert!(parsed.unreadable_lines[0].line_start < parsed.unreadable_lines[1].line_start);
    }

    #[test]
    fn a_healthy_report_reports_nothing_unreadable() {
        let parsed = parse_report_full(concat!(
            "mountain (7,53) in Inhead, contains Tinsel [town]\n",
            "  Wages: $12.\n",
        ));

        assert!(parsed.unreadable_lines.is_empty());
    }

    #[test]
    fn a_name_with_an_unclosed_bracket_is_no_longer_unreadable() {
        let parsed = parse_report_full(concat!(
            "mountain (7,53) in Inhead, contains Tinsel [town]\n",
            "  Wages: $12.\n",
            "* Smiley :( (100), Wanderers (29), 10 humans [HUMN].\n",
        ));

        let names: Vec<&str> = parsed
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .map(|unit| unit.name.as_str())
            .collect();
        assert_eq!(names, vec!["Smiley :("]);
        assert!(parsed.unreadable_lines.is_empty());
    }
}
