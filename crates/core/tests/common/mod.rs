//! Shared helpers for `crates/core`'s integration tests. Not every test file uses every helper
//! here, so an unused one is expected rather than a mistake (ah-v2l).
#![allow(dead_code)]

use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::report::model::Coordinate;

/// A map coordinate on the plane most fixtures live on.
pub fn at(x: i32, y: i32) -> Coordinate {
    Coordinate { x, y, z: 1 }
}

/// The shipped ruleset, parsed once per call.
pub fn ruleset() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON).expect("the committed ruleset loads")
}

/// The report's own orders template with the standing month-long orders of `units` dropped.
///
/// `rules/tax`, `rules/move` and `rules/study` each spend the unit's month, so a `PILLAGE`
/// written under a unit that still carries its template's `@tax`, `MOVE` or `@STUDY` never runs
/// and is told so instead (`ah-rzkm`). A player giving one of these units `PILLAGE` replaces its
/// standing month order; these fixtures say the same thing by dropping it.
///
/// Only a line at the start of its own block is dropped - an indented line inside a `@TURN`
/// block belongs to a later month.
pub fn without_standing_month_orders(template: &str, units: &[&str]) -> String {
    const MONTH_LONG: [&str; 11] = [
        "TAX",
        "MOVE",
        "ADVANCE",
        "STUDY",
        "PRODUCE",
        "BUILD",
        "SAIL",
        "TEACH",
        "WORK",
        "ENTERTAIN",
        "PILLAGE",
    ];
    let mut current: Option<String> = None;
    let mut kept: Vec<&str> = Vec::new();
    for line in template.lines() {
        if let Some(rest) = line.strip_prefix("unit ") {
            current = Some(rest.trim().to_string());
            kept.push(line);
            continue;
        }
        let ours = current.as_deref().is_some_and(|id| units.contains(&id));
        let bare = line.trim_start_matches('@');
        let indented = line.starts_with(' ') || line.starts_with('\t');
        let keyword = bare.split_whitespace().next().unwrap_or("");
        if ours
            && !indented
            && MONTH_LONG
                .iter()
                .any(|month| keyword.eq_ignore_ascii_case(month))
        {
            continue;
        }
        kept.push(line);
    }
    kept.join("\n")
}
