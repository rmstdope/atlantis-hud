//! The one judgement of a sailing step, and the walker the Problems panel reads it through
//! (`ah-csb8`).
//!
//! The route planner's search, its "why no route" probe, the map tracer and the Problems panel all
//! ask whether the game refuses one step of a `SAIL`. Each used to answer it in its own way, and the
//! copies drifted; every one of them now calls [`judge_sail_step`].
//!
//! `rules/movement_sailing`: "A fleet can move from an ocean region to another ocean region, or
//! from a coastal region to an ocean region, or from an ocean region to a coastal region. Ships may
//! not sail through single hex land masses and must leave via the same side they entered or a side
//! adjacent to that one." `newage trident rules/economy_canals`: "When a Canal is present, ships
//! may sail through the region in any direction".

use crate::movement::graph::{Direction, MapKnowledge};
use crate::movement::orders::MoveStep;
use crate::movement::plan::{
    constrains_departure, leaving_land, refused_by_sailing_step, Isthmus, Journey, SailRule,
};
use crate::movement::rules::Ruleset;
use crate::report::model::Coordinate;

/// What the two sailing rules make of one step, judged once for every surface that asks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SailStepJudgement {
    /// Land at both ends of the step, under a journey whose sailing rule is enforced.
    pub(crate) land_to_land: bool,
    /// What the side restriction makes of leaving `here` by this side. Computed whatever
    /// `land_to_land` says: each caller keeps its own precedence between the two, and the tracer
    /// charges a canal premium even on a step the other rule refuses.
    pub(crate) isthmus: Isthmus,
}

impl SailStepJudgement {
    /// Whether the game refuses the step for either reason.
    pub(crate) fn refused(&self) -> bool {
        self.land_to_land || self.isthmus == Isthmus::Refused
    }
}

/// One step a fleet takes, as every judging site already holds it.
///
/// A struct rather than loose parameters: loose, [`judge_sail_step`] would take eight, and the gate
/// denies `clippy::too_many_arguments` above seven - the same reason [`Journey`] exists.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SailStep<'a> {
    pub(crate) here: Coordinate,
    pub(crate) here_terrain: &'a str,
    /// The side the fleet entered `here` by, or `None` where that side does not matter.
    pub(crate) entered_by: Option<Direction>,
    pub(crate) leaving_by: Direction,
    pub(crate) into_terrain: &'a str,
}

/// The one judgement of a sailing step.
pub(crate) fn judge_sail_step(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    step: SailStep<'_>,
) -> SailStepJudgement {
    SailStepJudgement {
        land_to_land: journey.sail_rule == SailRule::Enforced
            && refused_by_sailing_step(ruleset, journey, step.here_terrain, step.into_terrain),
        isthmus: leaving_land(
            map,
            ruleset,
            journey,
            step.here,
            step.here_terrain,
            step.entered_by,
            step.leaving_by,
        ),
    }
}

/// The side a fleet entered `into_terrain` by, when that side decides where it may go next.
/// `None` wherever [`constrains_departure`] says the side does not matter.
pub(crate) fn entered_by(
    ruleset: &Ruleset,
    journey: Journey,
    into_terrain: &str,
    direction: Direction,
) -> Option<Direction> {
    constrains_departure(ruleset, journey, into_terrain).then_some(direction)
}

/// A step with land at both ends. Coordinates and terrains are the map's own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LandToLandStep {
    pub(crate) direction: Direction,
    pub(crate) from: Coordinate,
    pub(crate) from_terrain: String,
    pub(crate) to: Coordinate,
    pub(crate) to_terrain: String,
}

/// A step leaving a land hex by a side the isthmus rule refuses, with no canal to lift it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NeckOfLandStep {
    pub(crate) entered: Direction,
    pub(crate) leaving: Direction,
    pub(crate) at: Coordinate,
    pub(crate) terrain: String,
}

/// The first step of each kind the map can show a written SAIL is refused.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RefusedSailSteps {
    pub(crate) land_to_land: Option<LandToLandStep>,
    pub(crate) neck_of_land: Option<NeckOfLandStep>,
}

/// Walks a written SAIL from `from` along the exits the map states, and never guesses.
///
/// **Stops silently at the first thing it cannot follow**: an exit the hex does not list, or a hex
/// known only by name, which states no exits of its own. That is the Problems panel's standing
/// "accept on doubt" policy - a false warning costs the player their confidence in every other line
/// on the screen - and it is why this does not borrow the tracer's arithmetic fallback.
///
/// A land-to-land step ends the walk: the fleet goes nowhere from there, and a step refused by both
/// rules is reported as land to land only. A neck does not end it, so a land-to-land step further
/// on is still found. The fleet's own hex was entered by no side - "Ships ending their movement in a
/// land hex may sail out along any side connecting to water" (`rules/movement_sailing`) - so its
/// first step is never a neck.
pub(crate) fn refused_sail_steps(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    from: Coordinate,
    steps: &[MoveStep],
) -> RefusedSailSteps {
    let mut refused = RefusedSailSteps::default();
    let Some(origin) = map.hex(from) else {
        return refused;
    };
    let mut position = from;
    let mut here_terrain = origin.terrain.clone();
    let mut entered: Option<Direction> = None;

    for step in steps {
        let MoveStep::Go(direction) = step else {
            continue;
        };
        let Some((_, into)) = map
            .neighbours(position)
            .find(|(heading, _)| heading == direction)
        else {
            break;
        };
        let Some(into_hex) = map.hex(into) else {
            break;
        };
        let judgement = judge_sail_step(
            map,
            ruleset,
            journey,
            SailStep {
                here: position,
                here_terrain: &here_terrain,
                entered_by: entered,
                leaving_by: *direction,
                into_terrain: &into_hex.terrain,
            },
        );
        if judgement.land_to_land {
            refused.land_to_land = Some(LandToLandStep {
                direction: *direction,
                from: position,
                from_terrain: here_terrain,
                to: into,
                to_terrain: into_hex.terrain.clone(),
            });
            break;
        }
        if judgement.isthmus == Isthmus::Refused && refused.neck_of_land.is_none() {
            // `leaving_land` answers `Free` for a hex entered by no side, so this always holds.
            if let Some(entered_side) = entered {
                refused.neck_of_land = Some(NeckOfLandStep {
                    entered: entered_side,
                    leaving: *direction,
                    at: position,
                    terrain: here_terrain.clone(),
                });
            }
        }
        entered = entered_by(ruleset, journey, &into_hex.terrain, *direction);
        position = into;
        here_terrain = into_hex.terrain.clone();
    }
    refused
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::plan::Hull;
    use crate::movement::rules::MovementMode;
    use crate::report::parse_report_full;

    fn at(x: i32, y: i32) -> Coordinate {
        Coordinate { x, y, z: 1 }
    }

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset loads")
    }

    fn enforced() -> Journey {
        Journey::enforced(MovementMode::Sail, Hull::Bound)
    }

    /// A chain of hexes running southeast from (1,1), each naming the next. `structure` stands in
    /// the second hex when given.
    fn corridor(terrains: &[&str], structure: &str) -> MapKnowledge {
        let mut text = String::from("Foo (1) Report\n\n");
        for (index, terrain) in terrains.iter().enumerate() {
            let x = 1 + index as i32;
            let y = 1 + index as i32;
            text.push_str(&format!(
                "{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\n"
            ));
            text.push_str("Exits:\n");
            if index > 0 {
                text.push_str(&format!(
                    "  Northwest : {} ({},{}) in Nowhere.\n",
                    terrains[index - 1],
                    x - 1,
                    y - 1
                ));
            }
            if index + 1 < terrains.len() {
                text.push_str(&format!(
                    "  Southeast : {} ({},{}) in Nowhere.\n",
                    terrains[index + 1],
                    x + 1,
                    y + 1
                ));
            }
            text.push('\n');
            if index == 1 && !structure.is_empty() {
                text.push_str(structure);
                text.push_str("\n\n");
            }
        }
        MapKnowledge::from_report(&parse_report_full(&text))
    }

    fn step<'a>(entered_by: Option<Direction>, into_terrain: &'a str) -> SailStep<'a> {
        SailStep {
            here: at(2, 2),
            here_terrain: "plain",
            entered_by,
            leaving_by: Direction::Southeast,
            into_terrain,
        }
    }

    #[test]
    fn a_lifted_sail_rule_is_never_land_to_land() {
        let map = corridor(&["ocean", "plain", "plain"], "");
        let lifted = Journey {
            sail_rule: SailRule::Lifted,
            ..enforced()
        };

        assert!(!judge_sail_step(&map, &ruleset(), lifted, step(None, "plain")).land_to_land);
        assert!(judge_sail_step(&map, &ruleset(), enforced(), step(None, "plain")).land_to_land);
    }

    #[test]
    fn a_flying_hull_is_judged_by_neither_rule() {
        let map = corridor(&["ocean", "plain", "ocean"], "");
        let flying = Journey::enforced(MovementMode::Sail, Hull::Unbound);

        let judgement = judge_sail_step(
            &map,
            &ruleset(),
            flying,
            step(Some(Direction::Southeast), "plain"),
        );
        assert!(!judgement.land_to_land);
        assert_eq!(judgement.isthmus, Isthmus::Free);
    }

    #[test]
    fn a_first_step_out_of_land_is_never_a_neck() {
        let map = corridor(&["ocean", "plain", "ocean"], "");

        for leaving_by in [
            Direction::North,
            Direction::Northeast,
            Direction::Southeast,
            Direction::South,
            Direction::Southwest,
            Direction::Northwest,
        ] {
            let judgement = judge_sail_step(
                &map,
                &ruleset(),
                enforced(),
                SailStep {
                    leaving_by,
                    ..step(None, "ocean")
                },
            );
            assert_eq!(
                judgement.isthmus,
                Isthmus::Free,
                "leaving by {leaving_by:?}"
            );
        }
        // And the side it would refuse, once the fleet has entered by the opposite one.
        assert!(judge_sail_step(
            &map,
            &ruleset(),
            enforced(),
            step(Some(Direction::Southeast), "ocean")
        )
        .refused());
    }

    #[test]
    fn entered_by_is_none_over_water() {
        assert_eq!(
            entered_by(&ruleset(), enforced(), "ocean", Direction::Southeast),
            None
        );
        assert_eq!(
            entered_by(&ruleset(), enforced(), "plain", Direction::Southeast),
            Some(Direction::Southeast)
        );
    }

    fn southeast(count: usize) -> Vec<MoveStep> {
        vec![MoveStep::Go(Direction::Southeast); count]
    }

    #[test]
    fn a_neck_does_not_end_the_search_for_a_land_to_land_step() {
        // Step 2 leaves the plain at (2,2) straight through, into water; step 4 is plain to plain.
        let map = corridor(&["ocean", "plain", "ocean", "plain", "plain"], "");

        let refused = refused_sail_steps(&map, &ruleset(), enforced(), at(1, 1), &southeast(4));

        assert_eq!(
            refused.neck_of_land,
            Some(NeckOfLandStep {
                entered: Direction::Southeast,
                leaving: Direction::Southeast,
                at: at(2, 2),
                terrain: "plain".to_string(),
            })
        );
        assert_eq!(
            refused.land_to_land.map(|step| step.from),
            Some(at(4, 4)),
            "the land-to-land step is the fourth"
        );
    }

    #[test]
    fn a_land_to_land_step_ends_the_walk_before_a_later_neck() {
        let map = corridor(&["plain", "plain", "ocean"], "");

        let refused = refused_sail_steps(&map, &ruleset(), enforced(), at(1, 1), &southeast(2));

        assert!(refused.land_to_land.is_some());
        assert_eq!(refused.neck_of_land, None);
    }

    #[test]
    fn a_step_refused_by_both_rules_is_land_to_land_only() {
        let map = corridor(&["ocean", "plain", "plain"], "");

        let refused = refused_sail_steps(&map, &ruleset(), enforced(), at(1, 1), &southeast(2));

        assert!(refused.land_to_land.is_some());
        assert_eq!(refused.neck_of_land, None);
    }

    #[test]
    fn a_canal_lifts_the_neck() {
        let trident = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
            .expect("the committed Trident ruleset loads");
        let neck = |structure: &str| {
            refused_sail_steps(
                &corridor(&["ocean", "plain", "ocean"], structure),
                &trident,
                enforced(),
                at(1, 1),
                &southeast(2),
            )
        };

        assert!(
            neck("").neck_of_land.is_some(),
            "Trident restricts the side"
        );
        assert_eq!(neck("+ The Cut [3] : Canal."), RefusedSailSteps::default());
    }

    #[test]
    fn doubt_stops_the_walk() {
        let rules = ruleset();
        let walk = |map: &MapKnowledge, from: Coordinate, steps: &[MoveStep]| {
            refused_sail_steps(map, &rules, enforced(), from, steps)
        };
        let corridor = corridor(&["ocean", "plain", "plain"], "");

        // a direction the hex lists no exit for
        assert_eq!(
            walk(&corridor, at(1, 1), &[MoveStep::Go(Direction::North)]),
            RefusedSailSteps::default()
        );
        // nothing to walk
        assert_eq!(walk(&corridor, at(1, 1), &[]), RefusedSailSteps::default());
        assert_eq!(
            walk(&corridor, at(1, 1), &[MoveStep::In]),
            RefusedSailSteps::default()
        );
        // an origin the map does not know
        assert_eq!(
            walk(&corridor, at(9, 9), &southeast(2)),
            RefusedSailSteps::default()
        );

        // a hex known only by name states no exits, so the step out of it - plain into the named
        // mountain, which would be land to land - is never judged
        let named = MapKnowledge::from_report(&parse_report_full(
            "Foo (1) Report\n\nocean (1,1) in Nowhere.\n\nExits:\n  \
             Southeast : plain (2,2) in Nowhere.\n\nmountain (3,3) in Nowhere.\n\nExits:\n  \
             Northwest : plain (2,2) in Nowhere.\n\n",
        ));
        assert_eq!(
            walk(&named, at(1, 1), &southeast(2)),
            RefusedSailSteps::default()
        );
    }

    #[test]
    fn the_first_land_to_land_step_names_the_maps_coordinates_and_terrains() {
        let map = corridor(&["ocean", "plain", "mountain"], "");

        let refused = refused_sail_steps(&map, &ruleset(), enforced(), at(1, 1), &southeast(2));

        assert_eq!(
            refused.land_to_land,
            Some(LandToLandStep {
                direction: Direction::Southeast,
                from: at(2, 2),
                from_terrain: "plain".to_string(),
                to: at(3, 3),
                to_terrain: "mountain".to_string(),
            })
        );
    }
}
