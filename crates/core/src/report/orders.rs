//! Extracts the orders template a report carries for the coming turn.
//!
//! ```text
//! Orders Template (Long Format):
//!
//! #atlantis 95 "password"
//!
//! ;*** mountain (7,53) in Inhead ***
//!
//! unit 18642
//! ;Seven of Eight (18642), avoiding, behind, leader [LEAD].
//! @claim 50
//! @study obse
//!
//! #end
//! ```
//!
//! The template is the document of record for the turn's orders: importing a report seeds the draft
//! from it verbatim, and the editor scopes to one `unit` block at a time. The `#atlantis` line
//! carries the faction password, so the text is preserved exactly and must never be logged.

use serde::{Deserialize, Serialize};

/// One unit's slice of the orders document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitOrders {
    pub unit_id: String,
    /// Lines between this `unit` line and the next, comments included, verbatim.
    pub lines: Vec<String>,
    /// Line number of the `unit` line within the extracted template, counting from 1.
    pub line_start: usize,
}

impl UnitOrders {
    /// The orders themselves, with the game's descriptive comments removed.
    #[must_use]
    pub fn commands(&self) -> Vec<String> {
        self.lines
            .iter()
            .filter(|line| !line.trim_start().starts_with(';'))
            .filter(|line| !line.trim().is_empty())
            .cloned()
            .collect()
    }
}

/// The orders template as found in a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdersTemplate {
    /// The template verbatim, from `#atlantis` through `#end`.
    pub text: String,
    /// Faction the template is addressed to.
    pub faction_id: Option<String>,
    pub units: Vec<UnitOrders>,
}

/// Finds the orders template in a report.
///
/// Returns `None` when the report carries none, which is the case for a report generated without
/// the long-format template.
#[must_use]
pub fn extract_orders_template(source: &str) -> Option<OrdersTemplate> {
    let lines: Vec<&str> = source.lines().collect();

    let start = lines
        .iter()
        .position(|line| line.trim_start().starts_with("#atlantis"))?;
    let end = lines
        .iter()
        .skip(start)
        .position(|line| line.trim() == "#end")
        .map(|offset| start + offset)?;

    let slice = &lines[start..=end];
    let text = slice.join("\n");

    let faction_id = slice
        .first()
        .and_then(|line| line.split_whitespace().nth(1))
        .map(str::to_string);

    let mut units: Vec<UnitOrders> = Vec::new();
    for (offset, line) in slice.iter().enumerate() {
        if let Some(rest) = line.strip_prefix("unit ") {
            let unit_id = rest.trim().to_string();
            if unit_id.is_empty() {
                continue;
            }
            units.push(UnitOrders {
                unit_id,
                lines: Vec::new(),
                line_start: offset + 1,
            });
        } else if let Some(current) = units.last_mut() {
            // `#end` closes the document rather than belonging to the last unit.
            if line.trim() != "#end" {
                current.lines.push((*line).to_string());
            }
        }
    }

    // Trailing blank lines belong to the document, not to the unit before them.
    for unit in &mut units {
        while unit.lines.last().is_some_and(|line| line.trim().is_empty()) {
            unit.lines.pop();
        }
    }

    Some(OrdersTemplate {
        text,
        faction_id,
        units,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPLATE: &str = concat!(
        "Orders Template (Long Format):\n",
        "\n",
        "#atlantis 95 \"secret\"\n",
        "\n",
        ";*** mountain (7,53) in Inhead ***\n",
        "\n",
        "unit 18642\n",
        ";Seven of Eight (18642), avoiding, behind, leader [LEAD].\n",
        "@claim 50\n",
        "@study obse\n",
        "\n",
        "unit 13401\n",
        ";Drone (13401), behind.\n",
        "\n",
        "#end\n",
    );

    #[test]
    fn extracts_the_template_verbatim() {
        let template = extract_orders_template(TEMPLATE).expect("template");

        assert!(template.text.starts_with("#atlantis 95 \"secret\""));
        assert!(template.text.ends_with("#end"));
        // The preamble line is not part of the document.
        assert!(!template.text.contains("Orders Template"));
    }

    #[test]
    fn records_the_faction_the_template_addresses() {
        let template = extract_orders_template(TEMPLATE).expect("template");
        assert_eq!(template.faction_id.as_deref(), Some("95"));
    }

    #[test]
    fn splits_the_document_into_unit_blocks() {
        let template = extract_orders_template(TEMPLATE).expect("template");

        assert_eq!(template.units.len(), 2);
        assert_eq!(template.units[0].unit_id, "18642");
        assert_eq!(template.units[1].unit_id, "13401");
    }

    #[test]
    fn separates_orders_from_the_descriptive_comments() {
        let template = extract_orders_template(TEMPLATE).expect("template");

        assert_eq!(
            template.units[0].commands(),
            vec!["@claim 50".to_string(), "@study obse".to_string()]
        );
        // A unit with only a comment has no orders yet.
        assert!(template.units[1].commands().is_empty());
    }

    #[test]
    fn keeps_the_comments_in_the_block_so_the_document_round_trips() {
        let template = extract_orders_template(TEMPLATE).expect("template");
        assert!(template.units[0]
            .lines
            .iter()
            .any(|line| line.starts_with(";Seven of Eight")));
    }

    #[test]
    fn returns_nothing_when_a_report_carries_no_template() {
        assert_eq!(
            extract_orders_template("mountain (7,53) in Inhead.\n"),
            None
        );
    }
}
