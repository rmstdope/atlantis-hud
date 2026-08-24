//! How a unit gets about.
//!
//! Nothing here is derived. A turn report prints, for every unit of your own, the weight it is
//! carrying and the four capacities the *server* worked out - `Weight: 60. Capacity: 0/70/85/0` -
//! in the order fly, ride, walk, swim. So the question "can this unit ride?" is read rather than
//! recomputed from item weights, which is both exact and immune to a drifting catalogue.
//!
//! A report states these for your own units only. A foreign unit's mobility is therefore not
//! unknown by oversight; it is genuinely absent, and saying so beats assuming it walks.

use crate::movement::fleet::OrderedUnits;
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

/// The heaviest load this unit could move at all: the best of the flying, riding and walking
/// allowances the server printed for it, whichever the game would end up choosing.
///
/// `mobility` asks which mode a unit uses and answers from the weight the report printed. An order
/// check has to ask a narrower question - is *this* load, after a month of orders, more than
/// anything the unit can manage - and a unit is overloaded exactly when its load beats all three,
/// which is to say the best of them. Swimming is left out for the reason `mobility` leaves it out.
///
/// `None` when the report did not state the capacities, which is every foreign unit.
#[must_use]
pub fn best_allowance(unit: &ReportUnit) -> Option<i64> {
    let capacity = unit.capacity.as_deref().and_then(parse_capacities)?;
    Some(capacity.fly.max(capacity.ride).max(capacity.walk))
}

// ---------------------------------------------------------------- fleets

/// Where this unit stands: after its own ENTER/LEAVE when a view of the orders is in hand, and as
/// the report found it when it is not.
///
/// The `Option` is not a behavioural switch - an empty view would answer identically - but a
/// caller that deliberately answers from the report alone has to say so at its call site rather
/// than passing something that merely looks like orders. See `movement::plan`.
fn aboard_structure<'a>(
    unit: &'a ReportUnit,
    ordered: Option<&'a OrderedUnits>,
) -> Option<&'a str> {
    ordered.map_or_else(
        || unit.structure_id.as_deref(),
        |ordered| ordered.structure_of(unit),
    )
}

/// The structure `unit.structure_id` names, when its kind names a hull or a fleet.
///
/// Whether a kind actually names a hull is a question for [`parse_fleet_kind`] to answer
/// syntactically; whether that hull is one the ruleset (or the server's own words) can price is a
/// separate question for [`sailing_requirement`] and [`fleet_speed`], answered afterwards. A
/// structure whose kind neither form recognises - an ordinary building - is not a fleet at all.
#[must_use]
pub fn fleet_of<'a>(
    unit: &ReportUnit,
    hex: &'a KnownHex,
    ordered: Option<&OrderedUnits>,
) -> Option<&'a Structure> {
    let structure_id = aboard_structure(unit, ordered)?;
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

/// `"Load: 110/150"` states current and capacity; this reads the second number, the weight the
/// fleet can carry.
fn stated_cargo_capacity(description: &str) -> Option<i64> {
    let (_have, need) = stated_field(description, "Load:")?.split_once('/')?;
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
/// source can say - an unknown hull, a stated field that will not parse, or no ruleset and nothing
/// stated - which callers must treat as "cannot be priced" rather than a guess.
#[must_use]
pub fn sailing_requirement(fleet: &Structure, ruleset: Option<&Ruleset>) -> Option<i64> {
    if let Some(needed) = fleet
        .description
        .as_deref()
        .and_then(stated_sailing_requirement)
    {
        return Some(needed);
    }

    let ruleset = ruleset?;
    let hulls = parse_fleet_kind(&fleet.kind)?;
    let mut total = 0_i64;
    for (name, count) in &hulls {
        let item = ruleset.find_item(name)?;
        total += item.sailing_skill? * i64::from(*count);
    }
    Some(total)
}

/// How much weight a fleet can carry. Stated `Load: H/N` first; else the ruleset's `cargoCapacity`
/// per hull, times the count; `None` when neither can say - an unknown hull, no ruleset - which
/// callers treat as "cannot be priced" rather than a guess.
#[must_use]
pub fn cargo_capacity(fleet: &Structure, ruleset: Option<&Ruleset>) -> Option<i64> {
    if let Some(capacity) = fleet.description.as_deref().and_then(stated_cargo_capacity) {
        return Some(capacity);
    }

    let ruleset = ruleset?;
    let hulls = parse_fleet_kind(&fleet.kind)?;
    let mut total = 0_i64;
    for (name, count) in &hulls {
        let item = ruleset.find_item(name)?;
        total += item.cargo_capacity? * i64::from(*count);
    }
    Some(total)
}

/// How a fleet is named to the player: `Longship [329]` for one hull, `Fleet [988] (8 Corsairs)`
/// for several - the kind after `Fleet, `, verbatim.
#[must_use]
pub fn fleet_label(fleet: &Structure) -> String {
    match fleet
        .kind
        .trim()
        .trim_end_matches('.')
        .strip_prefix("Fleet,")
    {
        Some(rest) => format!("Fleet [{}] ({})", fleet.structure_id, rest.trim()),
        None => format!("{} [{}]", fleet.kind.trim(), fleet.structure_id),
    }
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
    ordered: Option<&OrderedUnits>,
) -> Option<(i64, i64, u32)> {
    let required = sailing_requirement(fleet, Some(ruleset))?;
    let speed = fleet_speed(fleet, ruleset)?;
    let available = crew_sailing_levels(&origin_hex.units, &fleet.structure_id, ordered);
    Some((required, available, speed))
}

/// Sum of `SAIL` skill levels over the faction's own units aboard one structure in a hex.
///
/// The requirement side of "can the crew sail this fleet", reckoned from the units themselves
/// rather than trusted to agree with whatever `"Sailors: H/N"` states, because `H` is the server's
/// own count of the same thing and comparing it against an independently-summed figure is what
/// would catch either one being wrong.
///
/// A level is held by each of a unit's men, not by the unit once - "The sailors are the number of
/// skill levels of the Sailing skill that must be aboard the ship" - so a skill's contribution is
/// `level * men`, not `level`.
#[must_use]
pub fn crew_sailing_levels(
    units_in_hex: &[ReportUnit],
    structure_id: &str,
    ordered: Option<&OrderedUnits>,
) -> i64 {
    units_in_hex
        .iter()
        .filter(|unit| unit.own && aboard_structure(unit, ordered) == Some(structure_id))
        .flat_map(|unit| {
            unit.skills
                .iter()
                .filter(|skill| skill.tag.eq_ignore_ascii_case("SAIL"))
                .map(move |skill| i64::from(skill.level) * unit.men)
        })
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

    // ------------------------------------------------------------ best_allowance

    fn with_capacity(capacity: &str) -> ReportUnit {
        ReportUnit {
            capacity: Some(capacity.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn the_walk_allowance_is_the_best_of_a_ground_unit() {
        assert_eq!(best_allowance(&with_capacity("0/0/150/0")), Some(150));
    }

    #[test]
    fn the_best_of_the_three_allowances_wins() {
        assert_eq!(best_allowance(&with_capacity("0/70/85/0")), Some(85)); // walk beats ride
        assert_eq!(best_allowance(&with_capacity("10/0/0/0")), Some(10)); // fly is the only one
    }

    #[test]
    fn a_capacity_that_does_not_parse_is_not_judged() {
        assert_eq!(best_allowance(&with_capacity("nonsense")), None);
    }

    #[test]
    fn a_unit_with_no_stated_capacity_is_not_judged() {
        assert_eq!(best_allowance(&ReportUnit::default()), None);
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
            ..Default::default()
        };

        assert_eq!(sailing_requirement(&fleet, Some(&ruleset())), Some(4));
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
            ..Default::default()
        };

        assert_eq!(sailing_requirement(&fleet, Some(&ruleset())), Some(4));
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
            ..Default::default()
        };

        assert_eq!(sailing_requirement(&fleet, Some(&ruleset())), Some(30));
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
            ..Default::default()
        };

        assert_eq!(sailing_requirement(&fleet, Some(&ruleset())), None);
        assert_eq!(fleet_speed(&fleet, &ruleset()), None);
    }

    /// Without a ruleset, a stated number still counts - only ruleset arithmetic needs one.
    #[test]
    fn sailing_requirement_reads_the_stated_number_without_a_ruleset() {
        let fleet = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: Some("Load: 110/150; Sailors: 4/4; MaxSpeed: 4.".to_string()),
            needs: None,
            ..Default::default()
        };

        assert_eq!(sailing_requirement(&fleet, None), Some(4));
    }

    /// Without a ruleset and without a stated number, neither source can say.
    #[test]
    fn sailing_requirement_is_none_without_a_ruleset_or_a_stated_number() {
        let fleet = Structure {
            structure_id: "1".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: None,
            needs: None,
            ..Default::default()
        };

        assert_eq!(sailing_requirement(&fleet, None), None);
    }

    /// "Load: 110/150" states have and need; the second number is what the hull can carry.
    #[test]
    fn cargo_capacity_reads_the_stated_load() {
        let fleet = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: Some("Load: 110/150; Sailors: 4/4; MaxSpeed: 4.".to_string()),
            needs: None,
            ..Default::default()
        };

        assert_eq!(cargo_capacity(&fleet, Some(&ruleset())), Some(150));
    }

    /// No stated Load falls back to the ruleset's cargoCapacity per hull, summed across the fleet.
    #[test]
    fn cargo_capacity_falls_back_to_the_ruleset() {
        let fleet = Structure {
            structure_id: "1121".to_string(),
            name: "Ship".to_string(),
            kind: "Fleet, 2 Galleons".to_string(),
            description: None,
            needs: None,
            ..Default::default()
        };

        assert_eq!(cargo_capacity(&fleet, Some(&ruleset())), Some(5400));
    }

    /// A hull neither the report nor the ruleset can price is `None`, never a guess.
    #[test]
    fn cargo_capacity_is_none_for_an_unpriceable_fleet() {
        let fleet = Structure {
            structure_id: "1".to_string(),
            name: "Ship".to_string(),
            kind: "Fleet, 2 Barges".to_string(),
            description: None,
            needs: None,
            ..Default::default()
        };

        assert_eq!(cargo_capacity(&fleet, Some(&ruleset())), None);
        assert_eq!(
            cargo_capacity(
                &Structure {
                    structure_id: "1".to_string(),
                    name: "Ship".to_string(),
                    kind: "Longship".to_string(),
                    description: None,
                    needs: None,
                    ..Default::default()
                },
                None
            ),
            None
        );
    }

    /// A single hull is named `Hull [id]`.
    #[test]
    fn fleet_label_names_a_bare_hull() {
        let fleet = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: None,
            needs: None,
            ..Default::default()
        };

        assert_eq!(fleet_label(&fleet), "Longship [329]");
    }

    /// Several hulls are named `Fleet [id] (kind after "Fleet, ")`, verbatim.
    #[test]
    fn fleet_label_names_a_fleet_of_several_hulls() {
        let fleet = Structure {
            structure_id: "988".to_string(),
            name: "Fleet".to_string(),
            kind: "Fleet, 8 Corsairs".to_string(),
            description: None,
            needs: None,
            ..Default::default()
        };

        assert_eq!(fleet_label(&fleet), "Fleet [988] (8 Corsairs)");
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
        assert_eq!(crew_sailing_levels(&units, "329", None), 4);
    }

    /// Atlantis counts a level per man, not per unit: "The sailors are the number of skill levels
    /// of the Sailing skill that must be aboard the ship" (`neworigins-rules.html:3747-3752`), and
    /// a unit's skill level is held by each of its men. A 2-gnoll unit at sailing 1 supplies 2
    /// levels, not 1 - the false positive from `ah-j0e`'s verification failure, PR #341.
    #[test]
    fn crew_levels_are_reckoned_per_man_not_per_unit() {
        let mut two_gnolls = sample_unit("9508", Some("218"));
        two_gnolls.men = 2;
        two_gnolls.skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 1,
            points: 30,
        }];

        let units = vec![two_gnolls];
        assert_eq!(crew_sailing_levels(&units, "218", None), 2);
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
            ..Default::default()
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

        let found = fleet_of(&unit, &hex, None).expect("the unit is aboard the longship");
        assert_eq!(found.structure_id, "329");

        let not_aboard = sample_unit("11126", None);
        assert!(fleet_of(&not_aboard, &hex, None).is_none());
    }

    /// A sailor who boards this month is aboard when the fleet sails, so it counts - the
    /// disagreement ah-ssd was filed for.
    #[test]
    fn a_sailor_that_boards_this_month_counts_towards_the_crew() {
        let skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 2,
            points: 90,
        }];
        let mut a = sample_unit("11125", Some("329"));
        a.skills = skills.clone();
        let mut boarding = sample_unit("12590", None);
        boarding.skills = skills;

        let units = vec![a, boarding];
        let ordered =
            crate::movement::fleet::OrderedUnits::from_document("unit 12590\nENTER 329\n");
        assert_eq!(crew_sailing_levels(&units, "329", Some(&ordered)), 4);
    }

    #[test]
    fn a_sailor_that_leaves_this_month_does_not_count() {
        let skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 2,
            points: 90,
        }];
        let mut a = sample_unit("11125", Some("329"));
        a.skills = skills.clone();
        let mut leaving = sample_unit("12590", Some("329"));
        leaving.skills = skills;

        let units = vec![a, leaving];
        let ordered = crate::movement::fleet::OrderedUnits::from_document("unit 12590\nLEAVE\n");
        assert_eq!(crew_sailing_levels(&units, "329", Some(&ordered)), 2);
    }

    /// The planner passes `None` on purpose and must keep reading the report alone; this test
    /// exists so making the parameter a plain reference fails.
    #[test]
    fn passing_no_orders_counts_the_crew_the_report_found() {
        let skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 2,
            points: 90,
        }];
        let mut a = sample_unit("11125", Some("329"));
        a.skills = skills.clone();
        let mut b = sample_unit("12590", Some("329"));
        b.skills = skills;

        let units = vec![a, b];
        assert_eq!(crew_sailing_levels(&units, "329", None), 4);
    }

    #[test]
    fn fleet_of_follows_this_months_enter() {
        let structure = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: None,
            needs: None,
            ..Default::default()
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
        let ashore = sample_unit("11126", None);
        let ordered =
            crate::movement::fleet::OrderedUnits::from_document("unit 11126\nENTER 329\n");

        assert!(
            fleet_of(&ashore, &hex, None).is_none(),
            "the report has it ashore"
        );
        assert_eq!(
            fleet_of(&ashore, &hex, Some(&ordered))
                .expect("it boards the longship this month")
                .structure_id,
            "329"
        );
    }
}
