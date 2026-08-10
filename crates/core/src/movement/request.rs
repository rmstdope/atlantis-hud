//! One call that answers everything the interface needs about a proposed move.
//!
//! The adapters are deliberately thin over this: both the Tauri command and the wasm binding call
//! straight into it, so the desktop and the browser cannot drift into planning differently.
//!
//! The report arrives as text rather than as a parsed model, which is what keeps the calls
//! stateless: there is no session to open and none to invalidate when a new turn is imported. The
//! text is also the key the [`ReportCache`] the caller passes in remembers its last answer under,
//! so asking the same question twice costs the parse once. See [`crate::cache`].

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::cache::ReportCache;

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

/// Plans over the current report alone.
///
/// Kept for callers that genuinely have no memory to offer - tests, mostly. Anything with a game
/// behind it should use [`plan_for_remembered_report`], because a single report cannot support a
/// route longer than one step.
///
/// # Errors
///
/// Returns an error only when the ruleset itself cannot be used. A route that cannot be planned is
/// a successful answer carrying a reason, not a failure.
pub fn plan_for_report(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    unit_id: &str,
    destination: &str,
) -> Result<RoutePlanResponse, String> {
    plan_for_remembered_report(cache, ruleset_json, raw_report, "[]", unit_id, destination)
}

/// The same, over a map accumulated across turns.
///
/// `remembered_json` is a JSON array of regions the faction saw in earlier turns, each with the
/// turn it was seen in. They bring their own exits, which is what lets a route be longer than one
/// step: a single report describes its neighbours but not *their* neighbours, so the graph
/// otherwise stops at the fringe.
///
/// # Errors
///
/// As [`plan_for_report`], plus an error when the remembered regions cannot be read.
pub fn plan_for_remembered_report(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    unit_id: &str,
    destination: &str,
) -> Result<RoutePlanResponse, String> {
    use crate::movement::graph::MapKnowledge;
    use crate::movement::plan::{plan_route, RouteProblem};
    use crate::movement::risk::assess_route;

    let ruleset = cache
        .ruleset(ruleset_json)
        .map_err(|error| error.to_string())?;
    let destination = parse_hex_id(destination)
        .ok_or_else(|| format!("{destination} is not a hex identifier such as 1:7,53"))?;

    // Classified first, because the risk heuristic weighs men and a unit's men are only exact once
    // the catalogue has been consulted.
    let remembered: Vec<crate::movement::graph::RememberedRegion> =
        serde_json::from_str(remembered_json)
            .map_err(|error| format!("remembered regions could not be read: {error}"))?;

    let report = cache.classified(raw_report, ruleset_json);
    let map = MapKnowledge::from_remembered(&report, &remembered);

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

/// Where a unit's written MOVE order takes it, or nothing when it has none.
///
/// Nothing here is a refusal by design: an order that cannot be traced is an absent path, not a
/// problem to describe, because the map simply draws nothing. Contrast [`RoutePlanResponse`],
/// where the player asked a question and deserves the reason there is no answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveOrderTraceResponse {
    /// The traced path, absent when the unit has no readable movement order, is unknown to the
    /// report, or stands in a hex the map has never heard of.
    pub path: Option<crate::movement::trace::TracedPath>,
}

/// Traces the MOVE or ADVANCE order in a unit's written orders across the remembered map.
///
/// `orders` is the unit's own order block as the editor holds it. The last readable movement line
/// wins, because a later order replaces an earlier one when the game executes them - but only
/// among the lines that are this unit's own for this turn. A `TURN` block holds orders for the
/// turn after this one, and a `FORM` block's orders belong to the unit being formed, so movement
/// inside either says nothing about where this unit goes next.
///
/// # Errors
///
/// As [`plan_for_remembered_report`]: only an unusable ruleset or unreadable memory is an error.
/// An order that cannot be traced is a successful answer carrying no path.
pub fn trace_orders_for_remembered_report(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    unit_id: &str,
    orders: &str,
) -> Result<MoveOrderTraceResponse, String> {
    use crate::movement::graph::MapKnowledge;
    use crate::movement::trace::trace_move;

    let ruleset = cache
        .ruleset(ruleset_json)
        .map_err(|error| error.to_string())?;
    let remembered: Vec<crate::movement::graph::RememberedRegion> =
        serde_json::from_str(remembered_json)
            .map_err(|error| format!("remembered regions could not be read: {error}"))?;

    let report = cache.classified(raw_report, ruleset_json);

    let Some(steps) = last_top_level_move(orders) else {
        return Ok(MoveOrderTraceResponse { path: None });
    };
    let Some(unit) = report.units().find(|unit| unit.unit_id == unit_id).cloned() else {
        return Ok(MoveOrderTraceResponse { path: None });
    };

    let map = MapKnowledge::from_remembered(&report, &remembered);
    Ok(MoveOrderTraceResponse {
        path: trace_move(&map, &ruleset, &unit, &steps),
    })
}

/// The last readable MOVE or ADVANCE among the lines that are this unit's own for this turn.
///
/// Lines inside `TURN…ENDTURN` and `FORM…ENDFORM` are skipped: the former belong to the turn
/// after this one, the latter to the unit being formed. The blocks nest - a FORM inside a TURN is
/// legal - so a depth counter rather than a flag. An unmatched opener swallows the rest of the
/// block, which errs on drawing nothing rather than drawing someone else's order.
fn last_top_level_move(orders: &str) -> Option<Vec<crate::movement::orders::MoveStep>> {
    use crate::movement::orders::parse_move;

    let mut depth = 0_usize;
    let mut last = None;

    for line in orders.lines() {
        let trimmed = line.trim();
        // A repeating order is still the order it repeats, `@TURN` included.
        let command = trimmed
            .strip_prefix('@')
            .unwrap_or(trimmed)
            .split_whitespace()
            .next()
            .unwrap_or("");

        if command.eq_ignore_ascii_case("turn") || command.eq_ignore_ascii_case("form") {
            depth += 1;
        } else if command.eq_ignore_ascii_case("endturn") || command.eq_ignore_ascii_case("endform")
        {
            depth = depth.saturating_sub(1);
        } else if depth == 0 {
            if let Some(steps) = parse_move(line) {
                last = Some(steps);
            }
        }
    }

    last
}

/// Parses a report and counts each unit's men against the catalogue.
///
/// The plain parser cannot do this: telling men from equipment needs an item reference, and a
/// report carries none. Without it every unit reads as an estimate, including the great majority
/// holding a single race where the leading-group figure is exactly right.
///
/// An empty or unusable ruleset leaves the report exactly as parsed, estimates and all. Refusing to
/// show a report because a ruleset would not load would trade something that works for something
/// that does not.
///
/// The answer is shared rather than owned, because the planner reads the same model on the very
/// next gesture and copying four hundred and fifty units to hand it over would cost more than the
/// search it feeds.
#[must_use]
pub fn parse_and_classify(
    cache: &mut ReportCache,
    raw_report: &str,
    ruleset_json: &str,
) -> Arc<crate::report::ParsedReport> {
    cache.classified(raw_report, ruleset_json)
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
    const RULESET: &str = include_str!("../../../../config/public/ruleset.json");

    #[test]
    fn plans_a_route_and_assesses_what_stands_along_it() {
        // "* Seven of Eight (18642)" walks north from the mountain at (7,53) to the one at (7,51).
        let response =
            plan_for_report(&mut ReportCache::new(), RULESET, TURN_71, "18642", "1:7,51")
                .expect("the ruleset loads");

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
            plan_for_report(&mut ReportCache::new(), RULESET, TURN_71, "18642", "1:8,52")
                .expect("the ruleset loads");

        assert!(response.plan.is_none());
        assert!(response.risk.is_none());
        assert!(matches!(
            response.problem,
            Some(crate::movement::plan::RouteProblem::OceanNeedsShip { .. })
        ));
    }

    #[test]
    fn a_unit_the_report_does_not_carry_is_reported_rather_than_panicking() {
        let response = plan_for_report(
            &mut ReportCache::new(),
            RULESET,
            TURN_71,
            "no-such-unit",
            "1:7,51",
        )
        .expect("still answers");

        assert!(response.plan.is_none());
        assert!(response.problem.is_some());
    }

    /// The one genuine error: a ruleset the core cannot use at all. Everything else is an answer.
    #[test]
    fn an_unusable_ruleset_is_an_error() {
        let error = plan_for_report(&mut ReportCache::new(), "{}", TURN_71, "18642", "1:7,51")
            .expect_err("should fail");
        assert!(error.contains("ruleset"), "message was: {error}");
    }

    #[test]
    fn a_destination_that_is_not_a_hex_identifier_is_refused_by_name() {
        let error = plan_for_report(
            &mut ReportCache::new(),
            RULESET,
            TURN_71,
            "18642",
            "over there",
        )
        .expect_err("should fail");
        assert!(error.contains("hex identifier"), "message was: {error}");
    }

    /// The weather gap travels with the answer, so a caller can qualify the total if it chooses.
    #[test]
    fn the_answer_says_whether_the_ruleset_describes_movement_completely() {
        let response =
            plan_for_report(&mut ReportCache::new(), RULESET, TURN_71, "18642", "1:7,51")
                .expect("the ruleset loads");

        assert!(
            !response.fully_modelled,
            "weather is unmodelled, so the cost is a lower bound"
        );
    }

    /// The parse the file-open made has to be the parse the planner searches over.
    ///
    /// This is the whole point of #28: planning took the report as text and re-parsed four
    /// thousand lines before every search, on a user gesture. The search itself is microseconds
    /// over 57 hexes.
    ///
    /// Note what this can and cannot show. `parses()` counts what the cache was asked to read, so
    /// it pins that the planner did not make the cache parse twice - but a planner that ignored the
    /// cache entirely and parsed the text itself would leave the count at one and pass here. That
    /// case is what `a_second_route_over_the_same_turn_parses_nothing` exists to catch, by
    /// asserting the planner asked the cache at all.
    #[test]
    fn planning_does_not_make_the_cache_read_the_report_twice() {
        let mut cache = ReportCache::new();

        let shown = parse_and_classify(&mut cache, TURN_71, RULESET);
        let response = plan_for_report(&mut cache, RULESET, TURN_71, "18642", "1:7,51")
            .expect("the ruleset loads");

        assert!(response.plan.is_some(), "and it still plans the route");
        assert!(shown.units().any(|unit| !unit.men_estimated));
        assert_eq!(
            cache.parses(),
            1,
            "the planner made the cache re-read the report"
        );
    }

    /// Picking a second destination is the same turn asked a different question.
    ///
    /// The first assertion is the one that catches a planner which stopped consulting the cache:
    /// nothing else in the suite notices, because parsing the same text again produces an
    /// identical model and no answer changes.
    #[test]
    fn a_second_route_over_the_same_turn_parses_nothing() {
        let mut cache = ReportCache::new();

        plan_for_report(&mut cache, RULESET, TURN_71, "18642", "1:7,51")
            .expect("the ruleset loads");
        plan_for_report(&mut cache, RULESET, TURN_71, "18642", "1:8,52")
            .expect("the ruleset loads");

        assert_ne!(
            cache.parses(),
            0,
            "the planner never asked the cache for the report"
        );
        assert_eq!(cache.parses(), 1, "the second route re-read the report");
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

#[cfg(test)]
mod remembered_tests {
    use super::*;

    const RULESET: &str = include_str!("../../../../config/public/ruleset.json");
    const TURN_71: &str =
        include_str!("../../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");

    /// The payoff for remembering the map: a route with more than one step in it.
    ///
    /// One report describes a hex and names its neighbours, but the neighbours describe nothing, so
    /// every route is a single step. Three turns of memory make a corridor a unit can actually walk.
    #[test]
    fn a_remembered_map_carries_a_route_a_single_report_could_not() {
        let region = |terrain: &str, x: i32, y: i32, exits: &str| {
            format!("{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\nExits:\n{exits}\n")
        };

        // The turn the unit is standing in.
        let current = format!(
            "Foo (1) Report\n\n{}\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n",
            region("plain", 1, 1, "  Southeast : plain (2,2) in Nowhere.")
        );

        // Two hexes remembered from earlier turns, each bringing its own exits.
        let remembered = format!(
            "[{{\"region\":{},\"lastSeenTurn\":40}},{{\"region\":{},\"lastSeenTurn\":41}}]",
            serde_json::to_string(
                &crate::report::parse_report_full(&format!(
                    "Foo (1) Report\n\n{}",
                    region(
                        "plain",
                        2,
                        2,
                        "  Northwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,3) in Nowhere."
                    )
                ))
                .regions[0]
            )
            .expect("serializes"),
            serde_json::to_string(
                &crate::report::parse_report_full(&format!(
                    "Foo (1) Report\n\n{}",
                    region("plain", 3, 3, "  Northwest : plain (2,2) in Nowhere.")
                ))
                .regions[0]
            )
            .expect("serializes")
        );

        // Without memory, the far end is a name with no way through to it.
        let alone = plan_for_report(&mut ReportCache::new(), RULESET, &current, "900", "1:3,3")
            .expect("the ruleset loads");
        assert!(alone.plan.is_none(), "one report cannot reach that far");

        let together = plan_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &current,
            &remembered,
            "900",
            "1:3,3",
        )
        .expect("the ruleset loads");
        let plan = together.plan.expect("a route across remembered ground");
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.total_cost, 2);
        assert_eq!(plan.months.len(), 1, "two plains at two points a month");
    }

    /// Unreadable memory is an error rather than a silently smaller map: a route planned over half
    /// a map, presented as though it were the whole one, is exactly the wrong kind of answer.
    #[test]
    fn memory_that_cannot_be_read_is_refused_rather_than_ignored() {
        let error = plan_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            "Foo (1) Report\n",
            "not json",
            "900",
            "1:1,1",
        )
        .expect_err("should refuse");

        assert!(error.contains("remembered regions"), "message was: {error}");
    }

    #[test]
    fn no_memory_at_all_is_simply_one_report() {
        let response = plan_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            TURN_71,
            "[]",
            "18642",
            "1:7,51",
        )
        .expect("the ruleset loads");

        assert_eq!(response.plan.expect("a route").total_cost, 2);
    }
}

#[cfg(test)]
mod reaches_the_planner_tests {
    use super::*;

    const RULESET: &str = include_str!("../../../../config/public/ruleset.json");

    /// The defect this pins: the command that the interface calls must plan over the remembered map,
    /// not over the current report alone.
    ///
    /// Both adapters delegate here, and this hardcoded an empty memory for a while, so importing a
    /// second turn grew the drawn map and left the planner's graph exactly as it was. Every route
    /// stayed one step long however many turns were imported.
    #[test]
    fn the_command_plans_over_the_memory_it_is_given() {
        let corridor = |terrain: &str, x: i32, y: i32, exits: &str| {
            format!("{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\nExits:\n{exits}\n")
        };

        let current = format!(
            "Foo (1) Report\n\n{}\n* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n",
            corridor("plain", 1, 1, "  Southeast : plain (2,2) in Nowhere.")
        );

        let far_side = crate::report::parse_report_full(&format!(
            "Foo (1) Report\n\n{}",
            corridor(
                "plain",
                2,
                2,
                "  Northwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,3) in Nowhere."
            )
        ));
        let remembered = format!(
            "[{{\"region\":{},\"lastSeenTurn\":40}}]",
            serde_json::to_string(&far_side.regions[0]).expect("serializes")
        );

        // With nothing remembered the far hex is unreachable, which is the single-report ceiling.
        let alone = plan_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &current,
            "[]",
            "900",
            "1:3,3",
        )
        .expect("the ruleset loads");
        assert!(alone.plan.is_none(), "one report cannot reach that far");

        // With the memory the interface actually holds, it is reachable.
        let together = plan_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &current,
            &remembered,
            "900",
            "1:3,3",
        )
        .expect("the ruleset loads");
        let plan = together.plan.expect("a route across remembered ground");
        assert_eq!(plan.steps.len(), 2);
    }
}
