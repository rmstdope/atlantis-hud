//! One call that answers everything the interface needs about a proposed move.
//!
//! The adapters are deliberately thin over this: both the Tauri command and the wasm binding call
//! straight into it, so the desktop and the browser cannot drift into planning differently.
//!
//! The report arrives as text rather than as a parsed model. The core parses it in milliseconds,
//! and keeping the call stateless means there is no session to invalidate when a new turn is
//! imported.

use serde::{Deserialize, Serialize};

/// Everything the planner has to say about one proposed move.
///
/// Carries either a route or the reason there is none, never both. The two are separate fields
/// rather than a tagged union because the wire contract is consumed by TypeScript, where a plain
/// optional reads more naturally than a discriminated one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlanResponse {
    /// The route, when one was found.
    pub plan: Option<crate::movement::plan::RoutePlan>,
    /// Why there is none, when there is not.
    pub problem: Option<crate::movement::plan::RouteProblem>,
    /// What stands along it. Present only alongside a route.
    pub risk: Option<crate::movement::risk::RouteRisk>,
    /// Whether the ruleset describes movement completely.
    ///
    /// False while a gap is open - weather, today - which makes the cost a lower bound. Carried so
    /// a caller can say so; whether it does is the caller's business.
    pub fully_modelled: bool,
}

/// Plans a route for one unit, against a ruleset the caller supplies.
///
/// The report arrives as text rather than as a parsed model: the core parses it in milliseconds,
/// and keeping the command stateless means no session to invalidate when a new turn is imported.
///
/// # Errors
///
/// Returns an error only when the ruleset itself cannot be used. A route that cannot be planned is
/// a successful answer carrying a reason, not a failure.
pub fn plan_for_report(
    ruleset_json: &str,
    raw_report: &str,
    unit_id: &str,
    destination: &str,
) -> Result<RoutePlanResponse, String> {
    use crate::movement::graph::MapKnowledge;
    use crate::movement::plan::{plan_route, RouteProblem};
    use crate::movement::risk::assess_route;
    use crate::movement::rules::Ruleset;
    use crate::report::{classify_units, parse_report_full};

    let ruleset = Ruleset::from_json(ruleset_json).map_err(|error| error.to_string())?;
    let destination = parse_hex_id(destination)
        .ok_or_else(|| format!("{destination} is not a hex identifier such as 1:7,53"))?;

    // Classified first, because the risk heuristic weighs men and a unit's men are only exact once
    // the catalogue has been consulted.
    let mut report = parse_report_full(raw_report);
    classify_units(&mut report, &ruleset);
    let map = MapKnowledge::from_report(&report);

    let Some(unit) = report.units().find(|unit| unit.unit_id == unit_id).cloned() else {
        return Ok(RoutePlanResponse {
            plan: None,
            problem: Some(RouteProblem::OriginUnknown),
            risk: None,
            fully_modelled: ruleset.is_fully_modelled(),
        });
    };

    Ok(match plan_route(&map, &ruleset, &unit, destination) {
        Ok(plan) => {
            let hexes: Vec<_> = plan.steps.iter().map(|step| step.to).collect();
            let risk = assess_route(&map, &ruleset, &hexes, &unit);
            RoutePlanResponse {
                plan: Some(plan),
                problem: None,
                risk: Some(risk),
                fully_modelled: ruleset.is_fully_modelled(),
            }
        }
        Err(problem) => RoutePlanResponse {
            plan: None,
            problem: Some(problem),
            risk: None,
            fully_modelled: ruleset.is_fully_modelled(),
        },
    })
}

/// Reads `1:7,53`, the way the game writes a hex and the way a region id is stored.
fn parse_hex_id(text: &str) -> Option<crate::report::model::Coordinate> {
    let (level, rest) = text.split_once(':')?;
    let (x, y) = rest.split_once(',')?;
    Some(crate::report::model::Coordinate {
        x: x.trim().parse().ok()?,
        y: y.trim().parse().ok()?,
        z: level.trim().parse().ok()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TURN_71: &str =
        include_str!("../../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");
    const RULESET: &str = include_str!("../../../../config/ruleset.json");

    #[test]
    fn plans_a_route_and_assesses_what_stands_along_it() {
        // "* Seven of Eight (18642)" walks north from the mountain at (7,53) to the one at (7,51).
        let response =
            plan_for_report(RULESET, TURN_71, "18642", "1:7,51").expect("the ruleset loads");

        let plan = response.plan.expect("a route");
        assert_eq!(plan.total_cost, 2);
        assert_eq!(plan.months.len(), 1);
        assert!(response.problem.is_none());

        let risk = response.risk.expect("an assessment");
        assert_eq!(risk.hexes.len(), 1, "one hex entered, one hex weighed");
    }

    /// A route that cannot be planned is a successful answer carrying a reason, not a failure. The
    /// caller has something to show either way.
    #[test]
    fn a_refusal_comes_back_as_an_answer_rather_than_an_error() {
        // "  Northeast : ocean (8,52)" - not walkable.
        let response =
            plan_for_report(RULESET, TURN_71, "18642", "1:8,52").expect("the ruleset loads");

        assert!(response.plan.is_none());
        assert!(response.risk.is_none());
        assert!(matches!(
            response.problem,
            Some(crate::movement::plan::RouteProblem::OceanNeedsShip { .. })
        ));
    }

    #[test]
    fn a_unit_the_report_does_not_carry_is_reported_rather_than_panicking() {
        let response =
            plan_for_report(RULESET, TURN_71, "no-such-unit", "1:7,51").expect("still answers");

        assert!(response.plan.is_none());
        assert!(response.problem.is_some());
    }

    /// The one genuine error: a ruleset the core cannot use at all. Everything else is an answer.
    #[test]
    fn an_unusable_ruleset_is_an_error() {
        let error = plan_for_report("{}", TURN_71, "18642", "1:7,51").expect_err("should fail");
        assert!(error.contains("ruleset"), "message was: {error}");
    }

    #[test]
    fn a_destination_that_is_not_a_hex_identifier_is_refused_by_name() {
        let error =
            plan_for_report(RULESET, TURN_71, "18642", "over there").expect_err("should fail");
        assert!(error.contains("hex identifier"), "message was: {error}");
    }

    /// The weather gap travels with the answer, so a caller can qualify the total if it chooses.
    #[test]
    fn the_answer_says_whether_the_ruleset_describes_movement_completely() {
        let response =
            plan_for_report(RULESET, TURN_71, "18642", "1:7,51").expect("the ruleset loads");

        assert!(
            !response.fully_modelled,
            "weather is unmodelled, so the cost is a lower bound"
        );
    }

    #[test]
    fn reads_a_hex_identifier_the_way_the_game_writes_one() {
        assert_eq!(
            parse_hex_id("1:7,53"),
            Some(crate::report::model::Coordinate { x: 7, y: 53, z: 1 })
        );
        assert_eq!(
            parse_hex_id("2:-3,4"),
            Some(crate::report::model::Coordinate { x: -3, y: 4, z: 2 })
        );
        for bad in ["", "7,53", "1:7", "x:7,53", "1:7,53,9"] {
            assert_eq!(parse_hex_id(bad), None, "{bad} should be refused");
        }
    }
}
