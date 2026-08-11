//! Undoes the hard wrapping in an Atlantis turn report.
//!
//! Reports are wrapped to a fixed column, and a wrapped fragment carries no marker saying so. Every
//! later stage of the parser wants whole logical lines, so this runs first.
//!
//! Detecting a continuation by how it *looks* does not work. Fragments routinely begin with a
//! capitalised label and a colon, exactly like a genuine new field:
//!
//! ```text
//! * Unit (1382), Borg (73), behind, revealing faction, leader [LEAD].
//!   Weight: 10. Capacity: 0/0/15/0. Skills: force [FORC] 1 (60).
//! ```
//!
//! So instead this asks *why* the wrapper broke the line: a fragment is a continuation when its
//! first word could not have fitted on the previous line. That is exact rather than heuristic, and
//! it keeps genuinely short lines — `Exits:`, `Wages: $24.1 (Max: $6796).` — separate even though
//! the lines beneath them are more deeply indented.

/// Column the game wraps report body lines at.
///
/// Measured from real reports rather than assumed: no body line exceeds 70. The only 71-column
/// lines are the `;` comments in the orders template, where the marker is prepended after wrapping.
pub(crate) const WRAP_COLUMN: usize = 70;

/// One logical line, with the physical lines it was reassembled from.
///
/// The line span is retained so diagnostics can point at the original report rather than at
/// something the parser invented.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicalLine {
    pub text: String,
    pub indent: usize,
    pub line_start: usize,
    pub line_end: usize,
}

impl LogicalLine {
    /// Content with the leading indent removed.
    #[must_use]
    pub fn body(&self) -> &str {
        self.text.trim_start()
    }

    /// Whether this line opens a unit, a structure, or another marked item.
    #[must_use]
    pub fn marker(&self) -> Option<char> {
        marker_of(self.body())
    }
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// `*` is an own unit, `-` a foreign one, `+` a structure. The space matters: a name may begin with
/// a hyphen, as `-= 0 =- (7323)` does in a real report.
pub(crate) fn marker_of(body: &str) -> Option<char> {
    let mut chars = body.chars();
    match (chars.next(), chars.next()) {
        (Some(marker @ ('*' | '-' | '+')), Some(' ')) => Some(marker),
        _ => None,
    }
}

pub(crate) fn first_word_len(body: &str) -> usize {
    body.split_whitespace().next().map_or(0, str::len)
}

/// Reassembles wrapped fragments into logical lines.
///
/// Blank lines are dropped, but they still terminate the line before them, so a fragment can never
/// be joined across a paragraph break.
#[must_use]
pub fn unwrap_lines(source: &str) -> Vec<LogicalLine> {
    let mut logical: Vec<LogicalLine> = Vec::new();
    // Width of the last physical line folded into the current logical line, which is what decides
    // whether the next fragment could have fitted.
    let mut last_physical_width = 0usize;
    let mut open = false;

    for (index, physical) in source.lines().enumerate() {
        let line_number = index + 1;
        let trimmed_end = physical.trim_end();

        if trimmed_end.trim().is_empty() {
            open = false;
            continue;
        }

        let indent = indent_of(trimmed_end);
        let body = trimmed_end.trim_start();

        let continues = open
            && logical.last().is_some_and(|previous| {
                indent > previous.indent
                    && marker_of(body).is_none()
                    && last_physical_width + 1 + first_word_len(body) > WRAP_COLUMN
            });

        if continues {
            let previous = logical
                .last_mut()
                .expect("continues is only true when a previous line exists");
            previous.text.push(' ');
            previous.text.push_str(body);
            previous.line_end = line_number;
        } else {
            logical.push(LogicalLine {
                text: trimmed_end.to_string(),
                indent,
                line_start: line_number,
                line_end: line_number,
            });
        }

        last_physical_width = trimmed_end.len();
        open = true;
    }

    logical
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(source: &str) -> Vec<String> {
        unwrap_lines(source)
            .into_iter()
            .map(|line| line.text)
            .collect()
    }

    #[test]
    fn joins_a_fragment_whose_first_word_could_not_have_fitted() {
        // The header is 65 columns; "(hill" would have pushed it to 71, past the wrap column.
        let source = concat!(
            "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants\n",
            "  (hill dwarves), $33983.\n"
        );

        assert_eq!(
            texts(source),
            vec![
                "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants (hill dwarves), $33983."
            ]
        );
    }

    #[test]
    fn keeps_a_short_line_separate_from_the_indented_block_beneath_it() {
        // "Exits:" is six columns, so the direction below it was never wrapped off the end.
        let source = concat!(
            "Exits:\n",
            "  North : ocean (13,61) in Atlantis Ocean.\n",
            "  Northeast : ocean (14,62) in Atlantis Ocean.\n"
        );

        assert_eq!(
            texts(source),
            vec![
                "Exits:",
                "  North : ocean (13,61) in Atlantis Ocean.",
                "  Northeast : ocean (14,62) in Atlantis Ocean.",
            ]
        );
    }

    #[test]
    fn joins_a_fragment_that_begins_with_a_label_and_colon() {
        // The trap: "Capacity:" and "Skills:" look exactly like new fields but are continuations.
        let source = concat!(
            "* Drones (14451), avoiding, behind, sharing, swimming battle spoils, 50\n",
            "  lizardmen [LIZA], 7500 silver [SILV]. Weight: 500. Capacity:\n",
            "  0/0/750/750. Skills: observation [OBSE] 2 (90).\n"
        );

        let lines = unwrap_lines(source);
        assert_eq!(lines.len(), 1);
        assert!(lines[0]
            .text
            .contains("Weight: 500. Capacity: 0/0/750/750."));
        assert_eq!(lines[0].line_start, 1);
        assert_eq!(lines[0].line_end, 3);
    }

    #[test]
    fn treats_a_nested_marker_as_a_new_line_even_when_its_parent_was_wrapped() {
        // The structure description is 68 columns, so "corrals," is a continuation, but the unit
        // beneath it starts with a marker and must not be swallowed.
        let source = concat!(
            "+ Ent Trade Emporium [2] : Caravanserai; A collection of tents, camel\n",
            "  corrals, and warehouses containing mysteries.\n",
            "  - Trade Factor (6186), Elder Tree Forests (32), avoiding, behind.\n"
        );

        let lines = unwrap_lines(source);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].text.starts_with("+ Ent Trade Emporium"));
        assert!(lines[0].text.contains("corrals, and warehouses"));
        assert_eq!(lines[1].marker(), Some('-'));
    }

    #[test]
    fn does_not_join_across_a_blank_line() {
        let source = concat!(
            "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants\n",
            "\n",
            "  (hill dwarves), $33983.\n"
        );

        assert_eq!(texts(source).len(), 2);
    }

    #[test]
    fn recognises_ownership_markers_without_mistaking_a_hyphenated_name() {
        let lines = unwrap_lines(concat!(
            "* Seven of Eight (18642), Borg TNG (95), avoiding.\n",
            "- -= 0 =- (7323), The Lord of Drama (29), avoiding, high elf [HELF].\n",
            "+ Frozen Tomb [194] : Galley.\n",
            "Unclaimed silver: 6038.\n"
        ));

        let markers: Vec<Option<char>> = lines.iter().map(LogicalLine::marker).collect();
        assert_eq!(markers, vec![Some('*'), Some('-'), Some('+'), None]);
        // The foreign unit's own name starts with a hyphen; only the marker is consumed.
        assert!(lines[1].text.contains("-= 0 =- (7323)"));
    }

    #[test]
    fn records_the_indent_so_nesting_can_be_recovered() {
        let lines = unwrap_lines(concat!(
            "+ Cartographers HQ [1] : Fort.\n",
            "  - Eastern Watch (14353), on guard, Elder Tree Forests (32).\n"
        ));

        assert_eq!(lines[0].indent, 0);
        assert_eq!(lines[1].indent, 2);
    }
}
