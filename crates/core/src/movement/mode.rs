//! How a unit gets about.
//!
//! Nothing here is derived. A turn report prints, for every unit of your own, the weight it is
//! carrying and the four capacities the *server* worked out - `Weight: 60. Capacity: 0/70/85/0` -
//! in the order fly, ride, walk, swim. So the question "can this unit ride?" is read rather than
//! recomputed from item weights, which is both exact and immune to a drifting catalogue.
//!
//! A report states these for your own units only. A foreign unit's mobility is therefore not
//! unknown by oversight; it is genuinely absent, and saying so beats assuming it walks.

use crate::movement::rules::MovementMode;
use crate::report::model::ReportUnit;

/// The four capacities a report prints, in the order it prints them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capacities {
    pub fly: i64,
    pub ride: i64,
    pub walk: i64,
    pub swim: i64,
}

/// What a unit can do about moving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mobility {
    /// It travels this way: the fastest mode its weight allows.
    Moves(MovementMode),
    /// Its weight exceeds every one of its capacities, so the game will refuse it a MOVE order.
    Overloaded,
    /// The report did not say, which is the normal case for a unit that is not yours.
    Unstated,
}

/// Reads `0/70/85/0` into the four capacities.
///
/// Anything that is not four numbers is refused rather than partially believed: a capacity read
/// wrongly would decide whether a unit may cross water.
#[must_use]
pub fn parse_capacities(text: &str) -> Option<Capacities> {
    let numbers: Vec<i64> = text
        .trim()
        .trim_end_matches('.')
        .split('/')
        .map(|part| part.trim().parse::<i64>())
        .collect::<Result<_, _>>()
        .ok()?;

    match numbers[..] {
        [fly, ride, walk, swim] => Some(Capacities {
            fly,
            ride,
            walk,
            swim,
        }),
        _ => None,
    }
}

/// How this unit travels, according to the report.
///
/// The game gives a unit the fastest mode it can manage, so the capacities are tried in that
/// order. Swimming is not among them: it decides whether water is passable, not how fast the unit
/// goes, and this ruleset gives it no allowance of its own.
#[must_use]
pub fn mobility(unit: &ReportUnit) -> Mobility {
    let (Some(weight), Some(capacity)) = (
        unit.weight,
        unit.capacity.as_deref().and_then(parse_capacities),
    ) else {
        return Mobility::Unstated;
    };

    for (mode, allowance) in [
        (MovementMode::Fly, capacity.fly),
        (MovementMode::Ride, capacity.ride),
        (MovementMode::Walk, capacity.walk),
    ] {
        if allowance >= weight {
            return Mobility::Moves(mode);
        }
    }

    Mobility::Overloaded
}

/// Whether this unit could cross water under its own power.
///
/// # Examples
///
/// A unit of lizardmen carries its own swim capacity, so a coastline does not stop it:
///
/// ```
/// # use atlantis_hud_core::movement::mode::parse_capacities;
/// // "Weight: 500. Capacity: 0/0/750/750." - fly, ride, walk, swim.
/// let capacities = parse_capacities("0/0/750/750").expect("four numbers");
/// assert_eq!(capacities.swim, 750);
/// ```
///
/// Separate from [`mobility`] because it is a different question: a swimming unit is not faster,
/// it is merely not stopped by a coastline. Whether that is enough is the water rule's business.
#[must_use]
pub fn can_swim(unit: &ReportUnit) -> bool {
    match (
        unit.weight,
        unit.capacity.as_deref().and_then(parse_capacities),
    ) {
        (Some(weight), Some(capacity)) => capacity.swim >= weight,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_four_numbers_a_report_prints() {
        assert_eq!(
            parse_capacities("0/70/85/0"),
            Some(Capacities {
                fly: 0,
                ride: 70,
                walk: 85,
                swim: 0
            })
        );
    }

    #[test]
    fn tolerates_the_trailing_stop_a_report_line_ends_with() {
        assert!(parse_capacities("0/0/15/0.").is_some());
    }

    /// Refused rather than partly believed: a capacity read wrongly decides whether a unit drowns.
    #[test]
    fn refuses_anything_that_is_not_four_numbers() {
        for text in ["", "0/0/15", "0/0/15/0/0", "0/0/x/0", "fifteen"] {
            assert_eq!(parse_capacities(text), None, "{text} should be refused");
        }
    }

    /// Negative numbers are not a shape a report produces, but reading one as a capacity would let
    /// a unit of any weight "fit", so they are read as the numbers they are and simply never match.
    #[test]
    fn a_negative_capacity_carries_nothing() {
        let capacities = parse_capacities("-1/-1/-1/-1").expect("still four numbers");
        assert_eq!(capacities.fly, -1);
    }
}
