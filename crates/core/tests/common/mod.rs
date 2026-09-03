//! Shared helpers for `crates/core`'s integration tests. Not every test file uses every helper
//! here, so an unused one is expected rather than a mistake (ah-v2l).
#![allow(dead_code)]

use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::intents::{read_intents, spends_the_month};
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
/// standing month order; these fixtures say the same thing by dropping every one of them.
///
/// The crate's own reader and predicate decide what goes, rather than a keyword list copied into
/// test code that nothing would fail to update: `read_intents` skips `TURN` blocks, whose orders
/// belong to a later month, so those lines survive.
pub fn without_standing_month_orders(template: &str, units: &[&str]) -> String {
    let dropped: std::collections::BTreeSet<usize> = read_intents(template)
        .iter()
        .filter(|block| units.contains(&block.unit_id.as_str()))
        .flat_map(|block| block.intents.iter())
        .filter(|placed| spends_the_month(&placed.intent))
        .map(|placed| placed.line)
        .collect();

    template
        .lines()
        .enumerate()
        .filter(|(index, _)| !dropped.contains(&(index + 1)))
        .map(|(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n")
}
