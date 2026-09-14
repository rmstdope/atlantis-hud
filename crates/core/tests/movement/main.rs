//! Integration tests for movement: the map, how a unit gets about, the ruleset, reading and
//! writing MOVE orders, planning a route, tracing a written one, passages and risk.
//!
//! One file per rule or scenario, so that two changes to different rules touch different files.
//! A new rule gets a new file in its area's directory, and one `mod` line in that directory's
//! `mod.rs`, where `cargo fmt` keeps the lines sorted. Do not append a new rule's tests to the
//! end of an existing file. A helper used by one file lives in that file; a helper used by two or
//! more lives in the area's `support.rs`. An area that is still a single file (`orders.rs`,
//! `passages.rs`, `risk.rs`) becomes a directory the first time it gains a second topic.

#[path = "../common/mod.rs"]
mod common;

mod graph;
mod orders;
mod passages;
mod risk;
mod ruleset;
