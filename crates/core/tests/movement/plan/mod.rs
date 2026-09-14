//! Acceptance tests for planning a route.
//!
//! Most cases come from the committed turn 71 report of faction 95. Note what a single report
//! cannot show: every hex the faction visited has neighbours it only knows by name, and a hex
//! known by name has no exits of its own, so a report with few, scattered regions stops at its
//! fringe - which is faction 95's case. A bigger report does not: turn 42 of faction 42 (game 3)
//! has contiguous visited ground and supports routes of many steps on its own.
//!
//! What memory adds, and what a single report - however big - cannot show on its own, is reaching
//! ground the current report does not describe: a hex named only in passing, with no exits of its
//! own, until an earlier turn that stood in it is remembered alongside the current one. That case
//! lives in its own section below, built from game 3's faction 42 across turns 40, 41 and 42.

mod canals;
mod flying_fleet;
mod from_the_report;
mod isthmus;
mod lakes;
mod memory;
mod overloaded_fleet;
mod sailing_step;
mod sea_routes;
mod support;
mod swimming;
mod synthetic_map;
