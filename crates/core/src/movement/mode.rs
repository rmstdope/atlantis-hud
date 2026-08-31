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
use crate::movement::rules::{ItemKind, MovementMode, Ruleset};
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

    mobility_for_capacities(weight, capacity)
}

fn mobility_for_capacities(weight: i64, capacity: Capacities) -> Mobility {
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

/// What a bag of items can carry, per movement mode.
///
/// A self-mobile item carries **itself**, so its own weight joins its capacity - which is what
/// `SelfMobility` means ("which modes an item can carry itself in"). A horse walking contributes
/// its 20 of capacity plus the 50 it no longer makes anybody else carry; a man contributes 5 plus
/// his own 10; a sack of grain contributes nothing and must be carried.
///
/// Derived rather than read off the report's `Capacity:` line because that line is printed before
/// this month's orders run, so a unit that buys pack animals is judged against a capacity it has
/// already outgrown (`ah-titf`, GitHub #677).
///
/// Reproduces the server's own line: 1 wood elf + 1 horse gives `walk 85, ride 70`, which is what
/// `neworigins-3.0.0-g3-f42-t82.rep` prints for WoodsmenY (15189).
///
/// `None` if any tag is absent from the ruleset: a partial sum understates capacity, and
/// understating capacity is exactly what produces a false overload warning.
#[must_use]
pub fn capacities_from_items(items: &[(&str, i64)], ruleset: &Ruleset) -> Option<Capacities> {
    let mut total = Capacities {
        fly: 0,
        ride: 0,
        walk: 0,
        swim: 0,
    };

    let mut hitches = items.iter().try_fold(0_i64, |hitches, (tag, count)| {
        let item = ruleset.find_item(tag)?;
        Some(
            hitches
                + if item.kind == ItemKind::Mount && item.tag.eq_ignore_ascii_case("HORS") {
                    (*count).max(0)
                } else {
                    0
                },
        )
    })?;

    for (tag, count) in items {
        let item = ruleset.find_item(tag)?;
        let matched = if item.capacity_condition.as_deref() == Some("when hitched to a horse") {
            let matched = (*count).max(0).min(hitches);
            hitches -= matched;
            matched
        } else if item.capacity_condition.is_some() {
            return None;
        } else {
            *count
        };
        let contribution = |capacity: i64, self_mobile: bool| {
            matched * (capacity + if self_mobile { item.weight } else { 0 })
        };
        total.fly += contribution(item.capacity.fly, item.self_mobile.fly);
        total.ride += contribution(item.capacity.ride, item.self_mobile.ride);
        total.walk += contribution(item.capacity.walk, item.self_mobile.walk);
        total.swim += contribution(item.capacity.swim, item.self_mobile.swim);
    }

    Some(total)
}

/// Derives mobility from a complete inventory, falling back to the report when it is incomplete.
#[must_use]
pub fn mobility_with_ruleset(unit: &ReportUnit, ruleset: &Ruleset) -> Mobility {
    let mut items = Vec::with_capacity(unit.items.len());
    let mut men = 0_i64;
    let mut has_conditional_capacity = false;
    for amount in &unit.items {
        let Some(item) = ruleset.find_item(&amount.tag) else {
            return mobility(unit);
        };
        has_conditional_capacity |= item.capacity_condition.is_some();
        if item.kind == ItemKind::Man {
            men += amount.amount.max(0);
        }
        items.push((amount.tag.as_str(), amount.amount));
    }
    if !has_conditional_capacity || men < unit.men {
        return mobility(unit);
    }
    let Some(capacities) = capacities_from_items(&items, ruleset) else {
        return mobility(unit);
    };
    let Some(weight) = unit.weight else {
        return mobility(unit);
    };
    mobility_for_capacities(weight, capacities)
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
/// Whether a kind actually names a hull is a question for [`hulls_named_in`] to answer
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
        .filter(|structure| hulls_named_in(&structure.kind).is_some())
}

/// Reads a structure's `kind` as one or more ship hulls and how many of each.
///
/// **This is a parser, not a classifier.** It reads a string and has no idea what a ship is. Any
/// non-empty capitalised word with nothing after it comes back as one hull of that name, so
/// `hulls_named_in("Fort")` is `Some([("Fort", 1)])`, and `"Lair"` and `"Tower"` answer the same
/// way. The question "is this structure a vessel at all" is [`is_vessel`]; reaching for this one
/// instead is a mistake `ah-048` and `ah-jk9h` have each already paid a RED cycle for, and each
/// was caught only by a trap test.
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
pub fn hulls_named_in(kind: &str) -> Option<Vec<(String, u32)>> {
    let trimmed = kind.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }

    let mut clauses = trimmed.split(',');
    let lead = clauses.next().unwrap_or_default().trim();

    // Every clause after the lead, as `report::region::split_kind` reads vessels: a hull carries a
    // count (`40 Galleons`) or is an item name, which Atlantis always capitalises (`Longboat`); a
    // state clause is prose in lower case (`closed to player units`) and names no hull.
    let mut hulls: Vec<(String, u32)> = clauses.filter_map(hull_clause).collect();

    // The lead clause names the fleet's class rather than a hull of its own, and the report proves
    // it: `Cloudship, 1 Balloon, 1 Cloudship` would read `2 Cloudships` if the leading word were a
    // second ship, and `Galley, 2 Galleys, 3 Galleons` would read `3 Galleys` (`ah-8myf`, Copilot
    // on #687). So it counts only where nothing follows it, which is how a lone hull is written -
    // and `Fleet` is the class word itself, never a hull.
    //
    // A lead that carries a count is a hull like any other: a report writes `4 Balloons` with no
    // class word at all.
    if hulls.is_empty() && lead != "Fleet" {
        hulls.extend(hull_clause(lead));
    }

    if hulls.is_empty() {
        None
    } else {
        Some(hulls)
    }
}

/// One clause of a kind read as a hull and how many of it, or `None` where it names no hull.
fn hull_clause(clause: &str) -> Option<(String, u32)> {
    let clause = clause.trim();
    match clause.split_once(' ') {
        Some((count, name)) if !count.is_empty() && count.chars().all(|c| c.is_ascii_digit()) => {
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some((name.to_string(), count.parse::<u32>().ok()?))
        }
        _ => clause
            .chars()
            .next()
            .is_some_and(char::is_uppercase)
            .then(|| (clause.to_string(), 1)),
    }
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
    let hulls = hulls_named_in(&fleet.kind)?;
    let mut total = 0_i64;
    for (name, count) in &hulls {
        let item = ruleset.find_item(name)?;
        total += item.sailing_skill? * i64::from(*count);
    }
    Some(total)
}

/// Whether this structure is a vessel at all, rather than an ordinary building.
///
/// A vessel is one whose sailing numbers *some* source can price: the server's own `"Sailors: H/N"`
/// in the structure's description, or a hull the ruleset knows. That is exactly
/// [`sailing_requirement`] answering, so this is a name for the question rather than a second way
/// of answering it, and the two can never disagree.
///
/// **This is the test to reach for whenever the question is "is this a ship".**
/// [`hulls_named_in`] is not it - it is syntactic, and reads `Fort` as a fleet of one Fort. Two
/// beads used it as the vessel test and both shipped a bug that only a trap test caught
/// (`ah-048`, `ah-jk9h`).
///
/// `false` when nothing can price it - no ruleset and nothing stated, or a hull the catalogue does
/// not carry - which is the safe direction: callers fall back to the ordinary land movement
/// question rather than inventing a number.
///
/// [`crate::movement::fleet::steps_followed_by`] deliberately asks a narrower question and keeps
/// [`fleet_speed`] rather than this: a hull whose *speed* cannot be priced carries its occupants
/// nowhere, whatever its crew requirement.
#[must_use]
pub fn is_vessel(structure: &Structure, ruleset: Option<&Ruleset>) -> bool {
    sailing_requirement(structure, ruleset).is_some()
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
    let hulls = hulls_named_in(&fleet.kind)?;
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

    let hulls = hulls_named_in(&fleet.kind)?;
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
        .filter(|unit| {
            unit.own
                && aboard_structure(unit, ordered) == Some(structure_id)
                && ordered.is_none_or(|orders| orders.issues_sail(&unit.unit_id))
        })
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

    // ------------------------------------------------------------ capacities_from_items

    /// The rule against the server's own printed line, the reporter's figures, and an item the
    /// catalogue cannot price.
    #[test]
    fn derives_the_capacity_the_server_prints() {
        // 1 wood elf + 1 horse - what neworigins-3.0.0-g3-f42-t82.rep prints for WoodsmenY (15189)
        let c = capacities_from_items(&[("WELF", 1), ("HORS", 1)], &ruleset()).expect("priced");
        assert_eq!((c.walk, c.ride), (85, 70));

        // the reporter's own unit (GitHub #677): grain is cargo - weight, no capacity, not mobile
        let c = capacities_from_items(&[("LEAD", 1), ("HORS", 17), ("GRAI", 15)], &ruleset())
            .expect("priced");
        assert_eq!(c.walk, 1205);

        // an item the catalogue does not carry gives no answer at all, because a partial sum
        // understates capacity and understating it is what produces a false overload warning
        assert!(capacities_from_items(&[("HORS", 1), ("ZZZZ", 1)], &ruleset()).is_none());
    }

    #[test]
    fn conditional_wagon_capacity_is_limited_by_horses() {
        for (horses, wagons, expected) in [(0, 2, 0), (1, 2, 250), (2, 2, 500), (3, 2, 500)] {
            let capacity = capacities_from_items(
                &[("LEAD", 1), ("HORS", horses), ("WAGO", wagons)],
                &ruleset(),
            )
            .expect("priced");
            assert_eq!(capacity.walk, 15 + horses * 70 + expected);
        }
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
            hulls_named_in("Longship"),
            Some(vec![("Longship".to_string(), 1)])
        );
    }

    /// "+ Ship [1121] : Fleet, 2 Galleons." (g3-f42-t82.rep:5885)
    #[test]
    fn a_fleet_of_one_hull_names_it_and_its_count() {
        assert_eq!(
            hulls_named_in("Fleet, 2 Galleons"),
            Some(vec![("Galleons".to_string(), 2)])
        );
    }

    /// "+ Fleet [988] : Fleet, 8 Corsairs." and a mixed fleet from the same fixture set.
    #[test]
    fn a_mixed_fleet_names_every_hull() {
        assert_eq!(
            hulls_named_in("Fleet, 8 Corsairs"),
            Some(vec![("Corsairs".to_string(), 8)])
        );
        assert_eq!(
            hulls_named_in("Fleet, 4 Galleons, 1 Balloon"),
            Some(vec![
                ("Galleons".to_string(), 4),
                ("Balloon".to_string(), 1)
            ])
        );
    }

    /// "+ Frozen Tomb [194] : Galley, 40 Galleons, 11 Galleys, 10 Balloons."
    /// (neworigins-3.0.0-g7-f95-t72.rep:6211) - a fleet that names its class instead of the word
    /// `Fleet`, so the hulls follow a class word rather than a prefix. Read as one whole string it
    /// matched no item, which is what left every unit aboard it unpriced (`ah-8myf`).
    #[test]
    fn a_fleet_that_names_its_class_instead_of_the_word_fleet_names_every_hull() {
        assert_eq!(
            hulls_named_in("Galley, 40 Galleons, 11 Galleys, 10 Balloons"),
            Some(vec![
                ("Galleons".to_string(), 40),
                ("Galleys".to_string(), 11),
                ("Balloons".to_string(), 10)
            ])
        );
    }

    /// The class word is a label, not a hull, and the report proves it: Atlantis aggregates ships
    /// of a type into one count, so a leading `Cloudship` that were also a ship would make this
    /// read `2 Cloudships`. Counting it would over-price every such fleet by one hull.
    #[test]
    fn the_class_word_a_fleet_leads_with_is_not_a_hull_of_its_own() {
        assert_eq!(
            hulls_named_in("Cloudship, 1 Balloon, 1 Cloudship"),
            Some(vec![
                ("Balloon".to_string(), 1),
                ("Cloudship".to_string(), 1)
            ])
        );
        assert_eq!(
            hulls_named_in("Galley, 2 Galleys, 3 Galleons, 8 Corsairs"),
            Some(vec![
                ("Galleys".to_string(), 2),
                ("Galleons".to_string(), 3),
                ("Corsairs".to_string(), 8)
            ])
        );
    }

    /// "+ Fleet [1069] : 4 Balloons." - some fleets state their manifest with no class word at
    /// all, so a counted lead is a hull like any other.
    #[test]
    fn a_manifest_with_no_class_word_is_read_from_its_lead() {
        assert_eq!(
            hulls_named_in("4 Balloons"),
            Some(vec![("Balloons".to_string(), 4)])
        );
    }

    /// A state clause is prose in lower case and names no hull - the same rule `split_kind` reads
    /// vessels by. Nothing follows the lead as a hull, so `Lair` is read as the lone hull it looks
    /// like syntactically, and the ruleset is what refuses to price it.
    #[test]
    fn a_lower_case_state_clause_is_not_a_hull() {
        assert_eq!(
            hulls_named_in("Lair, closed to player units"),
            Some(vec![("Lair".to_string(), 1)])
        );
    }

    #[test]
    fn a_building_kind_is_not_a_fleet_shape_the_parser_refuses() {
        assert_eq!(hulls_named_in(""), None);
        assert_eq!(hulls_named_in("Fleet,"), None);
    }

    /// The trap `ah-048` and `ah-jk9h` both fell into: the parser reads a Fort as one hull, and the
    /// question they were actually asking is this one.
    #[test]
    fn a_fort_is_not_a_vessel_though_its_kind_parses_as_one_hull() {
        let fort = Structure {
            structure_id: "329".to_string(),
            name: "Fort".to_string(),
            kind: "Fort".to_string(),
            ..Default::default()
        };
        assert_eq!(
            hulls_named_in(&fort.kind),
            Some(vec![("Fort".to_string(), 1)]),
            "the parser is syntactic and always has been"
        );
        assert!(!is_vessel(&fort, Some(&ruleset())));
    }

    /// A hull the catalogue prices is a vessel with no stated numbers at all - `Longship` carries
    /// `sailingSkill: 4` in `config/public/ruleset.json`.
    #[test]
    fn a_hull_the_ruleset_prices_is_a_vessel() {
        let ship = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            ..Default::default()
        };
        assert!(is_vessel(&ship, Some(&ruleset())));
    }

    /// The server's own words answer with no ruleset in hand.
    #[test]
    fn a_stated_sailors_line_makes_it_a_vessel_without_a_ruleset() {
        let ship = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Nosuchhull".to_string(),
            description: Some("Load: 110/150; Sailors: 4/4; MaxSpeed: 4.".to_string()),
            ..Default::default()
        };
        assert!(is_vessel(&ship, None));
    }

    /// Nothing stated and no hull the catalogue carries: "not a vessel" is the safe answer, because a
    /// caller that believed otherwise would go on to invent a speed.
    #[test]
    fn a_hull_nothing_can_price_is_not_a_vessel() {
        let ship = Structure {
            structure_id: "329".to_string(),
            name: "Ship".to_string(),
            kind: "Nosuchhull".to_string(),
            ..Default::default()
        };
        assert!(!is_vessel(&ship, Some(&ruleset())));
        assert!(!is_vessel(&ship, None));
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
        let ordered = crate::movement::fleet::OrderedUnits::from_document(
            "unit 11125\nSAIL N\nunit 12590\nENTER 329\nSAIL N\n",
        );
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
        let ordered = crate::movement::fleet::OrderedUnits::from_document(
            "unit 11125\nSAIL N\nunit 12590\nSAIL N\nLEAVE\n",
        );
        assert_eq!(crew_sailing_levels(&units, "329", Some(&ordered)), 2);
    }

    #[test]
    fn only_units_issuing_sail_contribute_when_orders_are_available() {
        let captain = sample_unit("11125", Some("329"));
        let mut passenger = sample_unit("12590", Some("329"));
        passenger.skills = vec![crate::report::model::Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level: 4,
            points: 90,
        }];
        let units = vec![captain, passenger];

        let work = crate::movement::fleet::OrderedUnits::from_document(
            "unit 11125\nSAIL N\nunit 12590\nWORK\n",
        );
        assert_eq!(crew_sailing_levels(&units, "329", Some(&work)), 0);

        let sail = crate::movement::fleet::OrderedUnits::from_document(
            "unit 11125\nSAIL N\nunit 12590\nSAIL\n",
        );
        assert_eq!(crew_sailing_levels(&units, "329", Some(&sail)), 4);
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
