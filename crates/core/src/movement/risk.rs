//! How dangerous a hex is to walk into.
//!
//! Deliberately a heuristic. #8 rules out a combat simulator, and this is nowhere near one: it
//! counts bodies, weighs a monster by how much killing it takes, and compares the total to the
//! unit doing the walking. What it is for is answering "should I look at this more closely",
//! which a rough number does perfectly well.
//!
//! Two things it refuses to do. It does not treat an unassessable hex as a safe one - a hex nobody
//! has described, or one known only by name, has an unknown garrison rather than no garrison, and
//! reporting that as low risk is the single answer that could get a unit killed. And it does not
//! average a route: a route is as dangerous as its worst hex, because averaging lets one lethal
//! step hide behind a string of quiet ones.

use serde::{Deserialize, Serialize};

use crate::movement::graph::MapKnowledge;
use crate::movement::rules::{ItemKind, Ruleset};
use crate::report::model::{Coordinate, ReportUnit};

/// How worried to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

/// What is standing in one hex, and what that means for the unit walking into it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HexRisk {
    pub coordinate: Coordinate,
    pub level: RiskLevel,
    /// Men, plus each monster counted for the hits it takes to kill.
    pub hostile_strength: i64,
    /// The moving unit's own men, for scale.
    pub own_strength: i64,
    pub foreign_units: usize,
    /// How many monsters are present, counted as creatures rather than as strength.
    pub monsters: i64,
    /// Foreign units on guard, which can forbid passage outright.
    pub guards: usize,
    /// Whether the hex could be assessed at all.
    pub unknown: bool,
    /// The turn the hex was last seen in, when that is known.
    pub last_seen_turn: Option<u32>,
    /// A sentence a person can act on.
    pub reason: String,
}

/// The risk a whole route runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteRisk {
    pub level: RiskLevel,
    /// The hex that set the level, when there is one.
    pub worst: Option<HexRisk>,
    pub hexes: Vec<HexRisk>,
}

/// How much killing this unit takes, in men-equivalents.
///
/// A man counts once. A monster counts for its hits to kill, which is the closest thing the data
/// page offers to "how many men is this worth" - a lion at four, a water elemental at twenty, a
/// balrog at two hundred and eighty. It is a proxy and nothing more, but it is a sourced one, and
/// it puts creatures on the same scale as the people they would be fighting.
fn strength_of(ruleset: &Ruleset, unit: &ReportUnit) -> i64 {
    let mut strength = unit.men;

    for item in &unit.items {
        let Some(entry) = ruleset.items.get(&item.tag) else {
            continue;
        };
        if entry.kind != ItemKind::Monster {
            continue;
        }
        // A monster with no stated combat numbers still counts as one body rather than none.
        let worth = entry.combat.map_or(1, |combat| combat.hits_to_kill.max(1));
        strength += item.amount * worth;
    }

    strength
}

/// How many monsters this unit is, counted as creatures.
fn monsters_in(ruleset: &Ruleset, unit: &ReportUnit) -> i64 {
    unit.items
        .iter()
        .filter(|item| {
            ruleset
                .items
                .get(&item.tag)
                .is_some_and(|entry| entry.kind == ItemKind::Monster)
        })
        .map(|item| item.amount)
        .sum()
}

/// Weighs what is standing in one hex against the unit walking into it.
#[must_use]
pub fn assess_hex(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    coordinate: Coordinate,
    mover: &ReportUnit,
) -> HexRisk {
    let own_strength = strength_of(ruleset, mover);

    let Some(hex) = map.hex(coordinate).filter(|hex| hex.visited) else {
        // Either nothing is known about this hex, or it is known only by name - and a hex whose
        // garrison is unknown is not an empty one. Medium says "look before you leap" without
        // claiming a danger nobody has seen.
        return HexRisk {
            coordinate,
            level: RiskLevel::Medium,
            hostile_strength: 0,
            own_strength,
            foreign_units: 0,
            monsters: 0,
            guards: 0,
            unknown: true,
            last_seen_turn: map.hex(coordinate).and_then(|hex| hex.last_seen_turn),
            reason: "Nothing is known about who is here; the hex has never been visited."
                .to_string(),
        };
    };

    let foreign: Vec<&ReportUnit> = hex.units.iter().filter(|unit| !unit.own).collect();
    let hostile_strength: i64 = foreign.iter().map(|unit| strength_of(ruleset, unit)).sum();
    let monsters: i64 = foreign.iter().map(|unit| monsters_in(ruleset, unit)).sum();
    let guards = foreign.iter().filter(|unit| unit.on_guard).count();

    let level = band(ruleset, hostile_strength, own_strength);
    let reason = describe(
        hostile_strength,
        own_strength,
        foreign.len(),
        monsters,
        guards,
    );

    HexRisk {
        coordinate,
        level,
        hostile_strength,
        own_strength,
        foreign_units: foreign.len(),
        monsters,
        guards,
        unknown: false,
        last_seen_turn: hex.last_seen_turn,
        reason,
    }
}

/// Where a strength falls against the ruleset's thresholds.
///
/// The thresholds are ours rather than the game's, which the ruleset says on its face. A unit with
/// nothing to fight is low whatever the ratios say, and a unit of nobody facing anybody is high.
fn band(ruleset: &Ruleset, hostile: i64, own: i64) -> RiskLevel {
    if hostile == 0 {
        return RiskLevel::Low;
    }
    if own <= 0 {
        return RiskLevel::High;
    }

    #[allow(clippy::cast_precision_loss)]
    let ratio = hostile as f64 / own as f64;

    if ratio >= ruleset.risk.high_ratio {
        RiskLevel::High
    } else if ratio >= ruleset.risk.medium_ratio {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    }
}

fn describe(hostile: i64, own: i64, units: usize, monsters: i64, guards: usize) -> String {
    if units == 0 {
        return "Nobody else is here.".to_string();
    }

    let mut reason = format!(
        "{units} unit{} not yours, worth about {hostile} against your {own}",
        if units == 1 { "" } else { "s" }
    );
    if monsters > 0 {
        reason.push_str(&format!(", including {monsters} monster"));
        if monsters != 1 {
            reason.push('s');
        }
    }
    if guards > 0 {
        reason.push_str(&format!(
            "; {guards} on guard, which can forbid passage outright"
        ));
    }
    reason.push('.');
    reason
}

/// Weighs every hex a route passes through.
///
/// The route takes the level of its worst hex rather than an average, so one lethal step cannot
/// hide behind a string of quiet ones.
#[must_use]
pub fn assess_route(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    hexes: &[Coordinate],
    mover: &ReportUnit,
) -> RouteRisk {
    let assessed: Vec<HexRisk> = hexes
        .iter()
        .map(|coordinate| assess_hex(map, ruleset, *coordinate, mover))
        .collect();

    let worst = assessed
        .iter()
        .max_by(|left, right| {
            left.level
                .cmp(&right.level)
                .then(left.hostile_strength.cmp(&right.hostile_strength))
        })
        .cloned();

    RouteRisk {
        level: worst.as_ref().map_or(RiskLevel::Low, |hex| hex.level),
        worst,
        hexes: assessed,
    }
}
