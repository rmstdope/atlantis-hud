//! The movement ruleset, as scraped from a game's own rules and data pages.
//!
//! Mirrors `config/ruleset.json`, which `packages/ruleset` writes. The shell loads that file and
//! hands the text in; nothing here reads a file, so this still compiles to wasm.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// How a unit is getting about, in the order the game prefers.
///
/// There is deliberately no `Swim`. The rules page names exactly three modes of travel - "There
/// are three modes of travel: walking, riding and flying" - and never gives swimming an allowance,
/// so a `movement_points(Swim)` could only ever return an invented number. A unit's swim capacity
/// still matters, but as a legality question rather than a speed one, and this ruleset's water rule
/// exempts only flight from needing a ship.
///
/// There is no `Sail` either: fleet movement is out of scope for #8, and it has its own speed and
/// its own flat terrain cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MovementMode {
    Fly,
    Ride,
    Walk,
}

/// Movement points a unit gets per month, by mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementPoints {
    pub walk: u32,
    pub ride: u32,
    pub fly: u32,
}

/// What entering a region costs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerrainCosts {
    pub normal: u32,
    pub doubled_cost: u32,
    /// Lower-cased terrain names that cost `doubled_cost` rather than `normal`.
    pub doubled: Vec<String>,
}

/// What a connected road does to a cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoadRule {
    pub divisor: u32,
    pub minimum_cost: u32,
}

/// The water rule, including the terrain name it is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OceanRule {
    pub requires_ship_unless_flying: bool,
    pub flying_must_end_on_land: bool,
    /// Lower-cased, and taken from the rule's own sentence rather than assumed to be `ocean`.
    pub terrain: String,
}

/// The sentence each scraped value came from, kept so a reader can check the scraper's work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub movement_points: String,
    pub terrain_costs: String,
    pub road: String,
    pub ocean: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementRules {
    pub movement_points: MovementPoints,
    pub terrain_costs: TerrainCosts,
    pub road: RoadRule,
    pub ocean: OceanRule,
    pub provenance: Provenance,
}

/// What an item is, which is how a unit line is split into men and equipment.
///
/// Deliberately tolerant, unlike the movement rules. What an item is has no bearing on what a hex
/// costs, so a ruleset that invents a sixth kind should cost the same routes as before rather than
/// refuse to plan at all. `is_man` only needs to know that an unknown kind is not a race.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Man,
    Mount,
    Monster,
    Ship,
    Equipment,
    /// A kind this build has never heard of.
    Unknown,
}

impl<'de> Deserialize<'de> for ItemKind {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Hand-written because serde's `#[serde(other)]` is only allowed on tagged enums, and a
        // derived enum would make one unrecognised item fatal to the whole ruleset.
        Ok(match String::deserialize(deserializer)?.as_str() {
            "man" => Self::Man,
            "mount" => Self::Mount,
            "monster" => Self::Monster,
            "ship" => Self::Ship,
            "equipment" => Self::Equipment,
            _ => Self::Unknown,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCapacity {
    pub walk: i64,
    pub ride: i64,
    pub fly: i64,
    pub swim: i64,
}

/// Which modes an item can carry itself in, whether or not it has spare capacity to carry more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfMobility {
    pub walk: bool,
    pub ride: bool,
    pub fly: bool,
    pub swim: bool,
}

/// A monster's fighting numbers, which is all the risk heuristic weighs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonsterCombat {
    pub skill: i64,
    pub attacks_per_round: i64,
    pub hits_to_kill: i64,
    pub damage_per_attack: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemEntry {
    pub tag: String,
    pub name: String,
    pub kind: ItemKind,
    pub weight: i64,
    pub capacity: ItemCapacity,
    pub self_mobile: SelfMobility,
    pub moves: u32,
    #[serde(default)]
    pub combat: Option<MonsterCombat>,
    #[serde(default)]
    pub cargo_capacity: Option<i64>,
    #[serde(default)]
    pub capacity_condition: Option<String>,
}

/// Thresholds for the risk heuristic. Ours, not the game's, which is why they carry `scraped`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskThresholds {
    pub scraped: bool,
    pub note: String,
    pub medium_ratio: f64,
    pub high_ratio: f64,
}

/// Where the ruleset came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesetSource {
    pub rules_url: String,
    pub data_url: String,
    pub fetched_at: String,
    pub note: String,
}

/// Something the game does that the ruleset cannot describe.
///
/// Carried rather than dropped so the planner can say so. A gap that is known and stated is a
/// caveat; the same gap unstated is a wrong answer presented as a right one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gap {
    pub modelled: bool,
    pub note: String,
    /// What goes wrong while it is unmodelled, in the direction it goes wrong.
    pub consequence: String,
    /// The page's own words, so the claim can be checked rather than taken on trust.
    pub evidence: String,
}

/// Every gap the ruleset knows about itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Gaps {
    /// Winter raises movement costs by an amount the rules page never states.
    pub weather: Gap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ruleset {
    pub source: RulesetSource,
    pub movement: MovementRules,
    pub risk: RiskThresholds,
    pub gaps: Gaps,
    pub items: BTreeMap<String, ItemEntry>,
}

/// Why a ruleset could not be used.
#[derive(Debug)]
pub enum RulesetError {
    /// The text was not the shape a ruleset has. Carries serde's own message, which names the field.
    Malformed(String),
    /// The text parsed but says something a route cannot be costed against.
    Unusable(String),
}

impl std::fmt::Display for RulesetError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(detail) => write!(formatter, "malformed ruleset: {detail}"),
            Self::Unusable(detail) => write!(formatter, "unusable ruleset: {detail}"),
        }
    }
}

impl std::error::Error for RulesetError {}

impl Ruleset {
    /// Parses and validates a ruleset.
    ///
    /// Validation goes beyond what serde checks. A ruleset can be perfectly well-formed and still
    /// be one no route could be costed against - a zero walking allowance parses, then makes every
    /// journey take forever - so those are refused here rather than surfacing later as a route
    /// nobody can explain.
    ///
    /// # Errors
    ///
    /// Returns [`RulesetError::Malformed`] when the text is not a ruleset, and
    /// [`RulesetError::Unusable`] when it is one but says something unusable.
    pub fn from_json(json: &str) -> Result<Self, RulesetError> {
        let ruleset: Self = serde_json::from_str(json)
            .map_err(|error| RulesetError::Malformed(error.to_string()))?;
        ruleset.validate()?;
        Ok(ruleset)
    }

    fn validate(&self) -> Result<(), RulesetError> {
        let points = &self.movement.movement_points;
        for (name, value) in [
            ("walk", points.walk),
            ("ride", points.ride),
            ("fly", points.fly),
        ] {
            if value == 0 {
                return Err(RulesetError::Unusable(format!(
                    "{name} movement allowance is zero, so no unit could ever move that way"
                )));
            }
        }

        let terrain = &self.movement.terrain_costs;
        if terrain.normal == 0 || terrain.doubled_cost == 0 {
            return Err(RulesetError::Unusable(
                "a terrain cost is zero, which would make a route free".to_string(),
            ));
        }

        if terrain.doubled_cost < terrain.normal {
            return Err(RulesetError::Unusable(format!(
                "difficult terrain costs {} but ordinary terrain costs {}, which reads the rule \
                 backwards",
                terrain.doubled_cost, terrain.normal
            )));
        }

        let road = &self.movement.road;
        if road.divisor == 0 {
            return Err(RulesetError::Unusable(
                "the road divisor is zero, which cannot divide a cost".to_string(),
            ));
        }

        // The last remaining way to a free step. Everything else about cost is guarded above, and a
        // graph with zero-cost edges marches a unit across a continent inside one month.
        if road.minimum_cost == 0 {
            return Err(RulesetError::Unusable(
                "the road floor is zero, so a road step would cost nothing".to_string(),
            ));
        }

        if road.minimum_cost > terrain.normal {
            return Err(RulesetError::Unusable(format!(
                "the road floor of {} is above the ordinary terrain cost of {}, so a road would \
                 make a step more expensive",
                road.minimum_cost, terrain.normal
            )));
        }

        let water = self.movement.ocean.terrain.trim();
        if water.is_empty() {
            return Err(RulesetError::Unusable(
                "the water rule names no terrain, so no hex could be recognised as water"
                    .to_string(),
            ));
        }

        // The scraper captures the water terrain with a bare word match, so a reworded page can put
        // any word here. A terrain that also charges a walking premium is the tell-tale of a
        // mis-capture: nothing walks into water, so no ruleset prices it as difficult going.
        if terrain
            .doubled
            .iter()
            .any(|listed| listed.eq_ignore_ascii_case(water))
        {
            return Err(RulesetError::Unusable(format!(
                "{water} is named as water and also as difficult going, so the water rule was \
                 probably misread"
            )));
        }

        if self.risk.medium_ratio < 0.0 || self.risk.high_ratio < 0.0 {
            return Err(RulesetError::Unusable(
                "a risk threshold is negative, which would make every hex dangerous".to_string(),
            ));
        }

        if self.risk.high_ratio <= self.risk.medium_ratio {
            return Err(RulesetError::Unusable(format!(
                "risk thresholds are the wrong way round: high {} is not above medium {}",
                self.risk.high_ratio, self.risk.medium_ratio
            )));
        }

        if !self.items.values().any(|item| item.kind == ItemKind::Man) {
            return Err(RulesetError::Unusable(
                "the catalogue names no races, so men cannot be told from equipment".to_string(),
            ));
        }

        Ok(())
    }

    /// What it costs to enter a region of this terrain, before any road.
    ///
    /// Terrain the ruleset does not list costs the normal amount. The rules page is explicit that
    /// its list is not closed - "there may be other types of terrain to be discovered as the game
    /// progresses" - so an unknown name is ordinary going rather than an error.
    #[must_use]
    pub fn terrain_cost(&self, terrain: &str) -> u32 {
        let costs = &self.movement.terrain_costs;
        if costs
            .doubled
            .iter()
            .any(|listed| listed.eq_ignore_ascii_case(terrain))
        {
            costs.doubled_cost
        } else {
            costs.normal
        }
    }

    /// Movement points per month for a mode.
    #[must_use]
    pub fn movement_points(&self, mode: MovementMode) -> u32 {
        let points = &self.movement.movement_points;
        match mode {
            MovementMode::Fly => points.fly,
            MovementMode::Ride => points.ride,
            MovementMode::Walk => points.walk,
        }
    }

    /// The cost of a step taken along a connected road.
    ///
    /// Rounds down, which the rules page does not settle: "half cost to a minimum of 1 movement
    /// point" says nothing about an odd number. It makes no difference to this ruleset, whose only
    /// costs are 1 and 2 and whose divisor is 2, so the choice is pinned by a test rather than
    /// argued for. A cost of 3 would make it matter - see the weather gap in
    /// `docs/ruleset-contract.md`.
    #[must_use]
    pub fn road_cost(&self, base_cost: u32) -> u32 {
        let road = &self.movement.road;
        // `validate` has already refused a zero divisor, so this cannot divide by zero.
        (base_cost / road.divisor).max(road.minimum_cost)
    }

    /// Whether this terrain is the water the ocean rule speaks of.
    #[must_use]
    pub fn is_water(&self, terrain: &str) -> bool {
        self.movement.ocean.terrain.eq_ignore_ascii_case(terrain)
    }

    /// Whether the ruleset describes movement completely.
    ///
    /// False while any gap is open, which today means weather. A route costed under an open gap is
    /// a lower bound, and whatever presents it should say so rather than offer a total as fact.
    #[must_use]
    pub fn is_fully_modelled(&self) -> bool {
        self.gaps.weather.modelled
    }

    /// Whether an item tag names people rather than equipment.
    ///
    /// A centaur counts, being both a race and a mount; the catalogue settles that when it is
    /// scraped, so nothing here has to take a view.
    #[must_use]
    pub fn is_man(&self, tag: &str) -> bool {
        self.items
            .get(tag)
            .is_some_and(|item| item.kind == ItemKind::Man)
    }
}
