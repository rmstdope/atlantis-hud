//! How a unit gets about.
//!
//! Nothing here is derived. A turn report prints, for every unit of your own, the weight it is
//! carrying and the four capacities the *server* worked out - `Weight: 60. Capacity: 0/70/85/0` -
//! in the order fly, ride, walk, swim. So the question "can this unit ride?" is read rather than
//! recomputed from item weights, which is both exact and immune to a drifting catalogue.
//!
//! A report states these for your own units only. A foreign unit's mobility is therefore not
//! unknown by oversight; it is genuinely absent, and saying so beats assuming it walks.

use crate::movement::graph::KnownHex;
use crate::movement::rules::{MovementMode, Ruleset};
use crate::report::model::{ReportUnit, Structure};

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

// ---------------------------------------------------------------- fleets

/// The structure `unit.structure_id` names, when its kind names a hull or a fleet.
///
/// Whether a kind actually names a hull is a question for [`parse_fleet_kind`] to answer
/// syntactically; whether that hull is one the ruleset (or the server's own words) can price is a
/// separate question for [`sailing_requirement`] and [`fleet_speed`], answered afterwards. A
/// structure whose kind neither form recognises - an ordinary building - is not a fleet at all.
#[must_use]
pub fn fleet_of<'a>(unit: &ReportUnit, hex: &'a KnownHex) -> Option<&'a Structure> {
    let structure_id = unit.structure_id.as_deref()?;
    hex.structures
        .iter()
        .find(|structure| structure.structure_id == structure_id)
        .filter(|structure| parse_fleet_kind(&structure.kind).is_some())
}

/// Reads a structure's `kind` as one or more ship hulls and how many of each.
///
/// A report writes a fleet's kind two ways: a single ship states its own hull bare - `"Longship"` -
/// and a fleet of more than one states `"Fleet, <count> <hull>[, <count> <hull>...]"` - `"Fleet, 8
/// Corsairs"`, `"Fleet, 2 Galleons"`, `"Fleet, 4 Galleons, 1 Balloon"`. Both come back as hull name
/// and count pairs; a bare hull is one pair of count 1.
///
/// Hull names come back exactly as the report spells them, plural included - the same
/// [`Ruleset::find_item`] that already strips a trailing `s` or `es` for an order's item argument
/// is what resolves them against the catalogue, so there is no second plural rule to keep in step
/// with the first.
#[must_use]
pub fn parse_fleet_kind(kind: &str) -> Option<Vec<(String, u32)>> {
    let trimmed = kind.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("Fleet,") {
        let hulls: Vec<(String, u32)> = rest
            .split(',')
            .filter_map(|part| {
                let (count, name) = part.trim().split_once(' ')?;
                Some((name.trim().to_string(), count.trim().parse::<u32>().ok()?))
            })
            .collect();
        return if hulls.is_empty() { None } else { Some(hulls) };
    }

    Some(vec![(trimmed.to_string(), 1)])
}

/// The value after a `label: ` mark in a structure's description, up to the next `;` or `.`.
fn stated_field<'a>(description: &'a str, label: &str) -> Option<&'a str> {
    let after = description.split(label).nth(1)?;
    Some(after.split([';', '.']).next()?.trim())
}

/// `"Sailors: 4/4"` states have and need; this reads the second number, the levels a fleet needs.
fn stated_sailing_requirement(description: &str) -> Option<i64> {
    let (_have, need) = stated_field(description, "Sailors:")?.split_once('/')?;
    need.trim().parse().ok()
}

/// `"MaxSpeed: 4"` states the fleet's speed directly.
fn stated_max_speed(description: &str) -> Option<u32> {
    stated_field(description, "MaxSpeed:")?.trim().parse().ok()
}

/// Levels of sailing skill a fleet's crew must hold between them to sail it.
///
/// Prefers the server's own words - a structure's description states them directly, as `"Sailors:
/// 4/4"` (have/need) - over ruleset arithmetic, because the report is exact for this particular
/// fleet where the ruleset only knows the ordinary requirement for a hull. `None` when neither
/// source can say - an unknown hull, or a stated field that will not parse - which callers must
/// treat as "cannot be priced" rather than a guess.
#[must_use]
pub fn sailing_requirement(fleet: &Structure, ruleset: &Ruleset) -> Option<i64> {
    if let Some(needed) = fleet
        .description
        .as_deref()
        .and_then(stated_sailing_requirement)
    {
        return Some(needed);
    }

    let hulls = parse_fleet_kind(&fleet.kind)?;
    let mut total = 0_i64;
    for (name, count) in &hulls {
        let item = ruleset.find_item(name)?;
        total += item.sailing_skill? * i64::from(*count);
    }
    Some(total)
}

/// How many hexes a fleet sails in a month.
///
/// Prefers the server's own `"MaxSpeed: 4"` over ruleset arithmetic for the same reason
/// [`sailing_requirement`] does. The ruleset fallback takes the slowest hull, because a fleet
/// cannot sail faster than its slowest ship.
#[must_use]
pub fn fleet_speed(fleet: &Structure, ruleset: &Ruleset) -> Option<u32> {
    if let Some(speed) = fleet.description.as_deref().and_then(stated_max_speed) {
        return Some(speed);
    }

    let hulls = parse_fleet_kind(&fleet.kind)?;
    hulls
        .iter()
        .map(|(name, _)| ruleset.find_item(name).map(|item| item.moves))
        .collect::<Option<Vec<u32>>>()?
        .into_iter()
        .min()
}

/// A fleet's sailing numbers, when every one of them can be priced: the crew levels it needs, the
/// crew levels actually aboard, and how many hexes it covers a month.
///
/// `None` when the hull is unknown to both the server's stated numbers and the ruleset - the one
/// case nothing here may guess at. Shared by the planner, which turns a shortfall into
/// [`crate::movement::plan::RouteProblem::CrewCannotSail`], and the order tracer, which draws the
/// fleet's speed without ruling on whether the crew is enough.
#[must_use]
pub fn fleet_sailing(
    ruleset: &Ruleset,
    origin_hex: &KnownHex,
    fleet: &Structure,
) -> Option<(i64, i64, u32)> {
    let required = sailing_requirement(fleet, ruleset)?;
    let speed = fleet_speed(fleet, ruleset)?;
    let available = crew_sailing_levels(&origin_hex.units, &fleet.structure_id);
    Some((required, available, speed))
}

/// Sum of `SAIL` skill levels over the faction's own units aboard one structure in a hex.
///
/// The requirement side of "can the crew sail this fleet", reckoned from the units themselves
/// rather than trusted to agree with whatever `"Sailors: H/N"` states, because `H` is the server's
/// own count of the same thing and comparing it against an independently-summed figure is what
/// would catch either one being wrong.
#[must_use]
pub fn crew_sailing_levels(units_in_hex: &[ReportUnit], structure_id: &str) -> i64 {
    units_in_hex
        .iter()
        .filter(|unit| unit.own && unit.structure_id.as_deref() == Some(structure_id))
        .flat_map(|unit| unit.skills.iter())
        .filter(|skill| skill.tag.eq_ignore_ascii_case("SAIL"))
        .map(|skill| i64::from(skill.level))
        .sum()
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

    // ------------------------------------------------------------ fleets

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset loads")
    }

    /// "+ Ship [329] : Longship; Load: 110/150; Sailors: 4/4; MaxSpeed: 4." - a bare hull, one pair.
    #[test]
    fn a_bare_hull_is_one_pair_at_count_one() {
        assert_eq!(
            parse_fleet_kind("Longship"),
            Some(vec![("Longship".to_string(), 1)])
        );
    }

    /// "+ Ship [1121] : Fleet, 2 Galleons." (g3-f42-t82.rep:5885)
    #[test]
    fn a_fleet_of_one_hull_names_it_and_its_count() {
        assert_eq!(
            parse_fleet_kind("Fleet, 2 Galleons"),
            Some(vec![("Galleons".to_string(), 2)])
        );
    }

    /// "+ Fleet [988] : Fleet, 8 Corsairs." and a mixed fleet from the same fixture set.
    #[test]
    fn a_mixed_fleet_names_every_hull() {
        assert_eq!(
            parse_fleet_kind("Fleet, 8 Corsairs"),
            Some(vec![("Corsairs".to_string(), 8)])
        );
        assert_eq!(
            parse_fleet_kind("Fleet, 4 Galleons, 1 Balloon"),
            Some(vec![
                ("Galleons".to_string(), 4),
                ("Balloon".to_string(), 1)
            ])
        );
    }

    #[test]
    fn a_building_kind_is_not_a_fleet_shape_the_parser_refuses() {
        assert_eq!(parse_fleet_kind(""), None);
        assert_eq!(parse_fleet_kind("Fleet,"), None);
    }

    /// "Sailors: 4/4; MaxSpeed: 4." states its own numbers, which win over ruleset arithmetic.
    #[test]
    fn the_stated_sailors_and_speed_are_preferred_over_the_ruleset() {
        let fleet = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: Some("Load: 110/150; Sailors: 4/4; MaxSpeed: 4.".to_string()),
            needs: None,
        };

        assert_eq!(sailing_requirement(&fleet, &ruleset()), Some(4));
        assert_eq!(fleet_speed(&fleet, &ruleset()), Some(4));
    }

    /// No description at all - a report only states one for a hex the faction stood in and knows
    /// the structure well - falls back to what the ruleset says a longship needs and manages.
    #[test]
    fn without_a_stated_description_the_ruleset_supplies_the_numbers() {
        let fleet = Structure {
            structure_id: "1".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: None,
            needs: None,
        };

        assert_eq!(sailing_requirement(&fleet, &ruleset()), Some(4));
        assert_eq!(fleet_speed(&fleet, &ruleset()), Some(4));
    }

    /// "Fleet, 2 Galleons": 2 * 15 sailing skill, and the slowest (only) hull's speed.
    #[test]
    fn a_multi_hull_fleet_sums_skill_and_takes_the_slowest_speed() {
        let fleet = Structure {
            structure_id: "1121".to_string(),
            name: "Ship".to_string(),
            kind: "Fleet, 2 Galleons".to_string(),
            description: None,
            needs: None,
        };

        assert_eq!(sailing_requirement(&fleet, &ruleset()), Some(30));
        assert_eq!(fleet_speed(&fleet, &ruleset()), Some(4));
    }

    /// A hull the ruleset has never heard of, with no server-stated numbers either, must never be
    /// guessed at - the known trap this bead names explicitly.
    #[test]
    fn an_unknown_hull_with_nothing_stated_prices_as_nothing() {
        let fleet = Structure {
            structure_id: "1".to_string(),
            name: "Ship".to_string(),
            kind: "Skiff".to_string(),
            description: None,
            needs: None,
        };

        assert_eq!(sailing_requirement(&fleet, &ruleset()), None);
        assert_eq!(fleet_speed(&fleet, &ruleset()), None);
    }

    /// Two crew each holding sailing 2, exactly the fixture's boundary case for a longship needing
    /// 4 - see `g3-f42-t40.rep`'s two `Sailors` units aboard Ship [329].
    #[test]
    fn crew_levels_are_summed_from_the_units_own_skills() {
        let mut a = sample_unit("11125", Some("329"));
        a.skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 2,
            points: 90,
        }];
        let mut b = sample_unit("12590", Some("329"));
        b.skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 2,
            points: 90,
        }];
        // A unit aboard a different structure, and a foreign unit aboard the same one, must not
        // count.
        let mut elsewhere = sample_unit("99", Some("1"));
        elsewhere.skills = a.skills.clone();
        let mut foreign = sample_unit("100", Some("329"));
        foreign.own = false;
        foreign.skills = a.skills.clone();

        let units = vec![a, b, elsewhere, foreign];
        assert_eq!(crew_sailing_levels(&units, "329"), 4);
    }

    fn sample_unit(id: &str, structure_id: Option<&str>) -> ReportUnit {
        ReportUnit {
            unit_id: id.to_string(),
            name: "Sailors".to_string(),
            region_id: "1:1,1".to_string(),
            faction_id: Some("42".to_string()),
            faction_name: Some("The Disinherited Knights".to_string()),
            own: true,
            men: 1,
            weight: Some(50),
            capacity: Some("0/70/70/0".to_string()),
            structure_id: structure_id.map(str::to_string),
            ..Default::default()
        }
    }

    /// `fleet_of` finds the aboard structure only when its kind actually parses as a fleet shape.
    #[test]
    fn fleet_of_finds_the_aboard_structure_by_id() {
        let structure = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: None,
            needs: None,
        };
        let hex = KnownHex {
            coordinate: crate::report::model::Coordinate { x: 1, y: 1, z: 1 },
            terrain: "ocean".to_string(),
            province: "Sea".to_string(),
            visited: true,
            roads: Vec::new(),
            structures: vec![structure],
            units: Vec::new(),
            last_seen_turn: Some(40),
        };
        let unit = sample_unit("11125", Some("329"));

        let found = fleet_of(&unit, &hex).expect("the unit is aboard the longship");
        assert_eq!(found.structure_id, "329");

        let not_aboard = sample_unit("11126", None);
        assert!(fleet_of(&not_aboard, &hex).is_none());
    }
}
