//! Parsing of Atlantis turn reports.
//!
//! Target ruleset is NewOrigins 3.0.0 on Atlantis Engine 5.2.5. Parsing is tolerant by contract:
//! input the parser does not recognise produces a structured warning and partial results, never a
//! hard failure, because a player would rather see most of a turn than none of it.

pub mod composition;
pub mod header;
pub mod model;
pub mod orders;
pub mod region;
pub mod scan;
pub mod unit;
pub mod unwrap;

pub use composition::{classify_units, Classification};

use header::{parse_header, ReportHeader};
use model::ReportRegion;
use orders::{extract_orders_template, OrdersTemplate};
use region::{parse_region_block, parse_region_header};
use unwrap::{unwrap_lines, LogicalLine};

/// Everything the parser recovers from one turn report.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedReport {
    pub header: ReportHeader,
    pub regions: Vec<ReportRegion>,
    /// The orders document for the coming turn, when the report carries one.
    pub orders_template: Option<OrdersTemplate>,
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
fn opens_a_region(line: &LogicalLine) -> bool {
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
    for (position, &start) in starts.iter().enumerate() {
        let end = starts.get(position + 1).copied().unwrap_or(lines.len());
        if let Some(region) = parse_region_block(&lines[start], &lines[start + 1..end]) {
            regions.push(region);
        }
    }

    // The preamble is everything before the first region block.
    let preamble_end = starts.first().copied().unwrap_or(lines.len());

    ParsedReport {
        header: parse_header(&lines[..preamble_end]),
        regions,
        orders_template: extract_orders_template(source),
    }
}
