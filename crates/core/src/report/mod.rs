//! Parsing of Atlantis turn reports.
//!
//! Target ruleset is NewOrigins 3.0.0 on Atlantis Engine 5.2.5. Parsing is tolerant by contract:
//! input the parser does not recognise produces a structured warning and partial results, never a
//! hard failure, because a player would rather see most of a turn than none of it.

pub mod unwrap;
