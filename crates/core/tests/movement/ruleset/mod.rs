//! Acceptance tests for the movement ruleset, against the committed `config/ruleset.json`.
//!
//! The figures asserted here are the ones the scraper read out of the game's own rules page, so a
//! disagreement means either the core stopped understanding the file or the file stopped saying
//! what the game says. Both are worth a failing test.

mod committed_ruleset;
mod new_age;
mod skills;
mod world_rules;
