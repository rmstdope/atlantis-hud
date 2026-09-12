//! A unit's movement lines, chained into the one route the game runs.
//!
//! `rules/move`: "Multiple MOVE orders given by one unit will chain together." `rules/sail` gives
//! `SAIL N` / `SAIL NW` as one route. The segment rule is the one `orders::semantics::month_segments`
//! states for the month-long warning, restated here for readers that see one order at a time.

use crate::movement::orders::MoveStep;
use crate::orders::intents::{spends_the_month, Intent};

/// The route a unit's movement lines add up to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChainedRoute {
    pub(crate) steps: Vec<MoveStep>,
    /// Whether the chain is `SAIL` lines rather than `MOVE`/`ADVANCE` lines.
    pub(crate) sail: bool,
    /// The command word of the line that opened the chain, upper-cased: `MOVE`, `ADVANCE` or `SAIL`.
    pub(crate) command: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Open {
    Travelling,
    Sailing,
    Other,
}

/// Fed every readable order of one unit's own block, in the order written.
#[derive(Debug, Default, Clone)]
pub(crate) struct RouteChain {
    route: Option<ChainedRoute>,
    open: Option<Open>,
}

impl RouteChain {
    /// `command` is the order's keyword as written; `intent` is what
    /// `orders::intents::read_order_with_ruleset` read from that same line.
    ///
    /// An order that leaves the month free does not touch the chain. A month-long order other
    /// than MOVE/ADVANCE/SAIL ends it, and a movement line of a different kind replaces the route.
    /// A bare `SAIL` (no steps - `parse_move` refuses an empty MOVE) stores no route and erases
    /// none, but still ends a MOVE chain: without that, `steps_followed_by` would read an empty
    /// route instead of looking for the hull's.
    pub(crate) fn push(&mut self, command: &str, intent: &Intent) {
        if !spends_the_month(intent) {
            return;
        }
        let (kind, steps) = match intent {
            Intent::Move { steps } => (Open::Travelling, steps),
            Intent::Sail { steps } => (Open::Sailing, steps),
            _ => {
                self.open = Some(Open::Other);
                return;
            }
        };
        let sailing = kind == Open::Sailing;
        if steps.is_empty() {
            self.open = Some(kind);
            return;
        }
        match &mut self.route {
            // The open kind alone is not enough: in `MOVE N` / `SAIL` / `SAIL NW` the chain open
            // is a SAIL one while the stored route is still the MOVE, which must be replaced.
            Some(route) if self.open == Some(kind) && route.sail == sailing => {
                route.steps.extend(steps.iter().cloned());
            }
            _ => {
                self.route = Some(ChainedRoute {
                    steps: steps.clone(),
                    sail: sailing,
                    command: command.to_ascii_uppercase(),
                });
            }
        }
        self.open = Some(kind);
    }

    /// The route so far. Never `Some` with empty `steps`.
    pub(crate) fn route(&self) -> Option<&ChainedRoute> {
        self.route.as_ref()
    }

    pub(crate) fn into_route(self) -> Option<ChainedRoute> {
        self.route
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::graph::Direction::{North, Northeast, Northwest, South};
    use MoveStep::Go;

    fn mv(steps: &[MoveStep]) -> Intent {
        Intent::Move {
            steps: steps.to_vec(),
        }
    }
    fn sail(steps: &[MoveStep]) -> Intent {
        Intent::Sail {
            steps: steps.to_vec(),
        }
    }
    fn study() -> Intent {
        Intent::Study {
            skill: "COMB".to_string(),
        }
    }

    fn chained(orders: &[(&str, Intent)]) -> Option<ChainedRoute> {
        let mut chain = RouteChain::default();
        for (command, intent) in orders {
            chain.push(command, intent);
        }
        assert_eq!(chain.route().cloned(), chain.clone().into_route());
        chain.into_route()
    }

    fn steps(orders: &[(&str, Intent)]) -> Vec<MoveStep> {
        chained(orders).expect("a route").steps
    }

    #[test]
    fn two_move_lines_are_one_route() {
        let route = chained(&[("MOVE", mv(&[Go(North)])), ("move", mv(&[Go(Northeast)]))]).unwrap();
        assert_eq!(route.steps, vec![Go(North), Go(Northeast)]);
        assert!(!route.sail);
        assert_eq!(route.command, "MOVE");
    }

    #[test]
    fn advance_continues_a_move_and_keeps_the_opening_word() {
        let route = chained(&[
            ("MOVE", mv(&[Go(North)])),
            ("ADVANCE", mv(&[Go(Northeast)])),
        ])
        .unwrap();
        assert_eq!(route.steps, vec![Go(North), Go(Northeast)]);
        assert_eq!(route.command, "MOVE");
    }

    #[test]
    fn two_sail_lines_are_one_course() {
        let route = chained(&[
            ("SAIL", sail(&[Go(North)])),
            ("SAIL", sail(&[Go(Northwest)])),
        ])
        .unwrap();
        assert_eq!(route.steps, vec![Go(North), Go(Northwest)]);
        assert!(route.sail);
        assert_eq!(route.command, "SAIL");
    }

    #[test]
    fn a_sail_replaces_a_move() {
        let route =
            chained(&[("MOVE", mv(&[Go(North)])), ("SAIL", sail(&[Go(Northwest)]))]).unwrap();
        assert_eq!(route.steps, vec![Go(Northwest)]);
        assert!(route.sail);
    }

    #[test]
    fn an_order_that_leaves_the_month_free_does_not_break_the_chain() {
        assert_eq!(
            steps(&[
                ("MOVE", mv(&[Go(North)])),
                ("LEAVE", Intent::Leave),
                ("MOVE", mv(&[Go(South)]))
            ]),
            vec![Go(North), Go(South)]
        );
    }

    #[test]
    fn another_month_long_order_breaks_the_chain() {
        assert_eq!(
            steps(&[
                ("MOVE", mv(&[Go(North)])),
                ("STUDY", study()),
                ("MOVE", mv(&[Go(South)]))
            ]),
            vec![Go(South)]
        );
    }

    #[test]
    fn a_trailing_month_long_order_leaves_the_route_standing() {
        assert_eq!(
            steps(&[("MOVE", mv(&[Go(North)])), ("STUDY", study())]),
            vec![Go(North)]
        );
    }

    #[test]
    fn a_bare_sail_stores_no_route() {
        assert_eq!(chained(&[("SAIL", sail(&[]))]), None);
    }

    #[test]
    fn a_bare_sail_ends_a_move_chain_without_erasing_it() {
        let route = chained(&[("MOVE", mv(&[Go(North)])), ("SAIL", sail(&[]))]).unwrap();
        assert_eq!(route.steps, vec![Go(North)]);
        assert!(!route.sail);

        let route = chained(&[
            ("MOVE", mv(&[Go(North)])),
            ("SAIL", sail(&[])),
            ("SAIL", sail(&[Go(Northwest)])),
        ])
        .unwrap();
        assert_eq!(route.steps, vec![Go(Northwest)]);
        assert!(route.sail);

        assert_eq!(
            steps(&[
                ("MOVE", mv(&[Go(North)])),
                ("SAIL", sail(&[])),
                ("MOVE", mv(&[Go(South)]))
            ]),
            vec![Go(South)]
        );
    }

    #[test]
    fn a_bare_sail_inside_a_sail_chain_does_not_break_it() {
        assert_eq!(
            steps(&[
                ("SAIL", sail(&[Go(North)])),
                ("SAIL", sail(&[])),
                ("SAIL", sail(&[Go(Northwest)])),
            ]),
            vec![Go(North), Go(Northwest)]
        );
    }
}
