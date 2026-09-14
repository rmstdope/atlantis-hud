//! Acceptance tests for tracing a unit's written MOVE order.
//!
//! This is the planner's mirror: instead of picking a destination and asking for an order, the
//! player already wrote the order and the map shows where it goes. The real cases come from the
//! committed turn 71 report; anything a single report cannot express - long orders, remembered
//! ground - is driven the same way the planner's acceptance tests drive it.

mod comments;
mod isthmus;
mod new_units;
mod passages;
mod sailing_step;
mod support;
mod swimming;
mod written_moves;
