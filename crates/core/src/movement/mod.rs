//! Movement planning: what a route costs, whether it is legal, and what stands in the way.
//!
//! The rules a route is costed against are not written here. They are scraped from the game's own
//! rules page into `config/ruleset.json`, which the application shell loads and hands in. That is
//! what keeps this crate free of file I/O and therefore still able to compile to wasm, and it is
//! why a value can be corrected without a rebuild.

pub mod graph;
pub mod mode;
pub mod plan;
pub mod risk;
pub mod rules;
