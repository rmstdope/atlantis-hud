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
