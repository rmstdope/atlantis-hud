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
}
