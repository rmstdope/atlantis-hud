//! The movement ruleset, as scraped from a game's own rules and data pages.
//!
//! Reads `config/public/ruleset.json`, which `packages/ruleset` writes; every struct here refuses a
//! key it does not know, so a field the scraper adds without a home here fails
//! `tests/movement_ruleset.rs`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// How a unit is getting about, in the order the game prefers.
///
/// There is deliberately no `Swim`. The rules page names exactly three modes of travel on foot or
/// mount - "There are three modes of travel: walking, riding and flying" - and never gives
/// swimming an allowance, so a `movement_points(Swim)` could only ever return an invented number.
/// A unit's swim capacity still matters, but as a legality question rather than a speed one, and
/// this ruleset's water rule exempts only flight from needing a ship.
///
/// `Sail` is the exception to "no invented number": a fleet's speed comes from the fleet itself -
/// the server's stated `MaxSpeed`, or the slowest hull's `moves` - never from this ruleset's
/// per-mode table, which is why [`Ruleset::movement_points`] refuses to answer for it. Its terrain
/// cost is likewise its own rule (see [`SailingRule`]) rather than another entry doubled for a
/// mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MovementMode {
    Fly,
    Ride,
    Sail,
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
    /// The modes of travel the premium applies to.
    ///
    /// Scraped rather than assumed: the sentence reads "take two movement points **for riding or
    /// walking units** to enter", and flight is absent from it, so difficult ground costs a flier
    /// nothing extra. Charging one anyway is a wrong number presented as fact.
    pub doubled_for: Vec<MovementMode>,
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

/// What a fleet pays to enter a region, and where it may go.
///
/// A fleet's own rule rather than another entry on the terrain premium: "For a fleet to enter any
/// region only costs one movement point; the cost of two movement points for entering, say, a
/// forest coastal region, does not apply."
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SailingRule {
    /// Movement points a fleet spends entering any region, whatever the terrain.
    pub flat_cost: u32,
    /// Whether a fleet may only enter a land region through a coastal one - "a non-ocean region
    /// with at least one adjacent ocean region."
    pub land_needs_coast: bool,
    /// The terrain a fleet sails freely across, lower-cased. Mirrors [`OceanRule::terrain`].
    pub terrain: String,
}

/// The sentence each scraped value came from, kept so a reader can check the scraper's work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    pub movement_points: String,
    pub terrain_costs: String,
    pub road: String,
    pub ocean: String,
    pub sailing: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementRules {
    pub movement_points: MovementPoints,
    pub terrain_costs: TerrainCosts,
    pub road: RoadRule,
    pub ocean: OceanRule,
    pub sailing: SailingRule,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemCapacity {
    pub walk: i64,
    pub ride: i64,
    pub fly: i64,
    pub swim: i64,
}

/// Which modes an item can carry itself in, whether or not it has spare capacity to carry more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfMobility {
    pub walk: bool,
    pub ride: bool,
    pub fly: bool,
    pub swim: bool,
}

/// A monster's fighting numbers, which is all the risk heuristic weighs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonsterCombat {
    pub skill: i64,
    pub attacks_per_round: i64,
    pub hits_to_kill: i64,
    pub damage_per_attack: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    #[serde(default)]
    pub sailing_skill: Option<i64>,
}

/// Thresholds for the risk heuristic. Ours, not the game's, which is why they carry `scraped`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiskThresholds {
    pub scraped: bool,
    pub note: String,
    pub medium_ratio: f64,
    pub high_ratio: f64,
}

/// Where the ruleset came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

/// Every spelling an order's item argument stands for, in the order they must be tried.
///
/// The rules let a player write an item three ways - by tag (`SWOR`), by name (`sword`), or by the
/// plural the examples themselves use (`GIVE 4573 10 swords`) - and a name containing spaces comes
/// quoted or underscored, which the caller normalises before asking.
///
/// The plural rule is crude on purpose: the text as written first, then with a trailing `es` or
/// `s` removed. **The order matters and is the caller's to honour**: every spelling must be tried
/// across the whole catalogue before the next one is, or an entry whose own name ends in `s` -
/// `pearls`, `spices`, `figurines` - could be beaten by some other entry matching its stripped
/// form. Nothing in the committed ruleset collides that way today, which is precisely why the
/// rule is stated here rather than left to each caller's loop to imply.
///
/// Returned as a fixed array of options rather than a `Vec`: there are at most three, and two of
/// them borrow from the caller's own normalised string.
#[must_use]
pub fn item_spellings(written: &str) -> [Option<&str>; 3] {
    if written.is_empty() {
        return [None, None, None];
    }
    [
        Some(written),
        written.strip_suffix("es"),
        written.strip_suffix('s'),
    ]
}

/// One thing a cast consumes: an item tag (`SILV` for silver) and how many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CastInput {
    pub tag: String,
    pub amount: i64,
}

/// What CASTing a skill consumes, as the data page states it and as ah-dbb.2 charges it: `costs`
/// once per cast, and for transmutation the output tag -> the source tag it is made from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CastCost {
    pub costs: Vec<CastInput>,
    pub transmute: BTreeMap<String, String>,
}

/// One thing a skill can make, and the level at which it can first be made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Production {
    pub tag: String,
    pub level: u32,
}

/// A skill, and what a month of studying it costs.
///
/// Separate from the item catalogue rather than merged into it, because ten tags mean one thing as
/// a skill and another as an item: FISH is fishing and also fish, HERB is herb lore and also herbs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillEntry {
    pub tag: String,
    pub name: String,
    /// Silver per man per month. Absent for a skill the data page prices nowhere, which is its way
    /// of saying the skill cannot be studied by ordinary means.
    pub cost: Option<i64>,
    /// How far the page says the skill goes.
    pub max_level: u32,
    /// What CASTing this skill consumes. Absent for a ruleset generated before casting costs were
    /// scraped, and for the (large majority of) skills the page states no cost for.
    #[serde(default)]
    pub cast: Option<CastCost>,
    /// What a unit with this skill may PRODUCE, and the level at which each becomes available.
    /// Empty for a skill that makes nothing, and for a ruleset generated before production was
    /// scraped.
    #[serde(default)]
    pub produces: Vec<Production>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ruleset {
    pub source: RulesetSource,
    pub movement: MovementRules,
    pub risk: RiskThresholds,
    pub gaps: Gaps,
    pub items: BTreeMap<String, ItemEntry>,
    /// Empty for a ruleset generated before study costs were scraped. A missing catalogue means
    /// nothing can be priced, not that everything is free.
    #[serde(default)]
    pub skills: BTreeMap<String, SkillEntry>,
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

        if self.movement.sailing.flat_cost == 0 {
            return Err(RulesetError::Unusable(
                "the fleet entry cost is zero, which would make a sea route free".to_string(),
            ));
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
    ///
    /// The premium applies only to the modes the ruleset names, which for this game is riding and
    /// walking. A flier crosses a mountain as cheaply as a plain.
    #[must_use]
    pub fn terrain_cost(&self, terrain: &str, mode: MovementMode) -> u32 {
        let costs = &self.movement.terrain_costs;
        let difficult = costs
            .doubled
            .iter()
            .any(|listed| listed.eq_ignore_ascii_case(terrain));

        if difficult && costs.doubled_for.contains(&mode) {
            costs.doubled_cost
        } else {
            costs.normal
        }
    }

    /// Whether crossing water needs a ship, for a unit that cannot fly.
    #[must_use]
    pub fn water_needs_a_ship(&self) -> bool {
        self.movement.ocean.requires_ship_unless_flying
    }

    /// Whether a flier that ends a month over water drowns.
    #[must_use]
    pub fn flight_must_end_on_land(&self) -> bool {
        self.movement.ocean.flying_must_end_on_land
    }

    /// What a fleet pays to enter any region, whatever the terrain.
    #[must_use]
    pub fn sailing_flat_cost(&self) -> u32 {
        self.movement.sailing.flat_cost
    }

    /// Whether a fleet may only enter a land region through a coastal one.
    #[must_use]
    pub fn sailing_land_needs_coast(&self) -> bool {
        self.movement.sailing.land_needs_coast
    }

    /// Movement points per month for a mode.
    ///
    /// # Panics
    ///
    /// Panics for [`MovementMode::Sail`]: a fleet's speed comes from the fleet itself - the
    /// server's stated `MaxSpeed`, or the slowest hull's `moves` - never from this per-mode table,
    /// so answering here would be inventing a number. Callers resolve a fleet's speed via
    /// [`crate::movement::mode::fleet_speed`] before reaching this far.
    #[must_use]
    pub fn movement_points(&self, mode: MovementMode) -> u32 {
        let points = &self.movement.movement_points;
        match mode {
            MovementMode::Fly => points.fly,
            MovementMode::Ride => points.ride,
            MovementMode::Walk => points.walk,
            MovementMode::Sail => unreachable!(
                "a fleet's speed is not in the ruleset's per-mode table; resolve it via \
                 fleet_speed before calling movement_points"
            ),
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

    /// The item an order names, written as a tag, a name, or the plural the rules' own examples
    /// use.
    ///
    /// Spelling-major, for the reason [`item_spellings`] gives.
    #[must_use]
    pub fn find_item(&self, text: &str) -> Option<&ItemEntry> {
        let written = text.replace('_', " ");
        let found = item_spellings(&written)
            .into_iter()
            .flatten()
            .find_map(|spelling| {
                self.items.values().find(|item| {
                    item.tag.eq_ignore_ascii_case(spelling)
                        || item.name.eq_ignore_ascii_case(spelling)
                })
            });
        found
    }

    /// The skill an order names, written as a tag or as a name.
    ///
    /// A player writes it whichever way is shortest: `STUDY obse` uses the tag, `STUDY COMBAT` the
    /// name, and a name with a space in it arrives underscored or (quotes already stripped by the
    /// lexer) with the space intact. There is no plural rule here, unlike items - nobody studies
    /// "combats".
    ///
    /// Tags are tried before names because ten of them are shared with an item and one skill's tag
    /// could otherwise be read as another skill's name.
    #[must_use]
    pub fn find_skill(&self, text: &str) -> Option<&SkillEntry> {
        if text.is_empty() {
            return None;
        }
        let written = text.replace('_', " ");

        self.skills
            .values()
            .find(|skill| skill.tag.eq_ignore_ascii_case(&written))
            .or_else(|| {
                self.skills
                    .values()
                    .find(|skill| skill.name.eq_ignore_ascii_case(&written))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
    }

    // How an order may name an item. These moved here from `orders/items.rs` when the rule they
    // cover became `item_spellings`, shared by the catalogue search, the orders preview and the
    // semantic checks. They were the only coverage the rule had anywhere.
    //
    // Failing to recognise a name is a **warning** wherever it is asked, never an error: the
    // catalogue is scraped from the game being played and may be stale, absent, or simply missing
    // an entry, and none of that is grounds for telling a player their order is wrong.

    #[test]
    fn a_tag_is_recognised_whatever_its_case() {
        let ruleset = ruleset();
        assert!(ruleset.find_item("SWOR").is_some());
        // Real orders carry lower-cased tags: the turn 71 template has "@give 0 all spea".
        assert!(ruleset.find_item("spea").is_some());
    }

    #[test]
    fn a_singular_name_is_recognised() {
        assert!(ruleset().find_item("sword").is_some());
    }

    #[test]
    fn the_plural_the_rules_own_examples_use_is_recognised() {
        let ruleset = ruleset();
        // "GIVE 4573 10 swords" and "SELL 10 furs" are both examples on the rules page.
        assert!(ruleset.find_item("swords").is_some());
        assert!(ruleset.find_item("furs").is_some());
        assert!(ruleset.find_item("crossbows").is_some());
    }

    #[test]
    fn a_name_that_is_already_plural_survives_the_plural_rule() {
        // Stripping first would look for "pearl", which the catalogue does not have.
        let ruleset = ruleset();
        assert_eq!(
            ruleset.find_item("pearls").map(|item| item.name.as_str()),
            Some("pearls")
        );
        assert_eq!(
            ruleset.find_item("spices").map(|item| item.name.as_str()),
            Some("spices")
        );
    }

    #[test]
    fn a_name_with_spaces_is_recognised_quoted_or_underscored() {
        let ruleset = ruleset();
        // The lexer has already removed the quotes by the time this is asked.
        assert!(ruleset.find_item("Plate Armor").is_some());
        assert!(ruleset.find_item("Plate_Armor").is_some());
    }

    #[test]
    fn a_name_the_catalogue_does_not_have_is_not_recognised() {
        let ruleset = ruleset();
        assert!(ruleset.find_item("swordz").is_none());
        assert!(ruleset.find_item("").is_none());
    }

    /// "For a fleet to enter any region only costs one movement point" and "A coastal region is
    /// defined as a non-ocean region with at least one adjacent ocean region." Sail planning
    /// (ah-2vy.2) needs both to cost and to legalise a sea route.
    #[test]
    fn reads_the_fleet_movement_rule_from_the_committed_ruleset() {
        let ruleset = ruleset();
        assert_eq!(ruleset.sailing_flat_cost(), 1);
        assert!(ruleset.sailing_land_needs_coast());
        assert_eq!(ruleset.movement.sailing.terrain, "ocean");
    }

    /// A zero flat cost would make every sea region free to enter, so it is refused like every
    /// other free-step case `validate` already guards.
    #[test]
    fn a_zero_fleet_entry_cost_is_refused() {
        let mut json: serde_json::Value = serde_json::from_str(RULESET).unwrap();
        json["movement"]["sailing"]["flatCost"] = serde_json::json!(0);
        let text = serde_json::to_string(&json).unwrap();

        assert!(matches!(
            Ruleset::from_json(&text),
            Err(RulesetError::Unusable(_))
        ));
    }

    /// A longship needs 4 levels of sailing skill between its crew, per the data page. Sail
    /// planning (ah-2vy.2) cannot refuse "the crew cannot sail this ship" without this.
    #[test]
    fn reads_the_sailing_skill_from_the_committed_ruleset() {
        let ruleset = ruleset();
        let longship = ruleset
            .find_item("LONG")
            .expect("the committed ruleset has a longship");
        assert_eq!(longship.sailing_skill, Some(4));
    }

    /// `serde` already gives an `Option<T>` field a default of `None` when its key is absent, with
    /// or without `#[serde(default)]` here - kept anyway for consistency with the sibling optional
    /// fields and to say explicitly, rather than leave it to that implicit rule, that a ruleset
    /// written before this field existed must still load whole. This test pins that contract: a
    /// later change that made the field required (dropping the `Option`, say) would fail it.
    #[test]
    fn a_ruleset_written_before_this_field_existed_still_loads() {
        let json = r#"{
            "tag": "LONG",
            "name": "Longship",
            "kind": "ship",
            "weight": 0,
            "capacity": { "walk": 0, "ride": 0, "fly": 0, "swim": 0 },
            "selfMobile": { "walk": false, "ride": false, "fly": false, "swim": false },
            "moves": 4
        }"#;
        let entry: ItemEntry =
            serde_json::from_str(json).expect("an entry missing sailingSkill should still parse");
        assert_eq!(entry.sailing_skill, None);
    }

    /// The spellings come back in the order they must be tried, and an empty text names nothing.
    #[test]
    fn the_spellings_are_the_written_form_first() {
        assert_eq!(
            item_spellings("swords"),
            [Some("swords"), None, Some("sword")]
        );
        assert_eq!(
            item_spellings("spices"),
            [Some("spices"), Some("spic"), Some("spice")]
        );
        assert_eq!(item_spellings("sword"), [Some("sword"), None, None]);
        assert_eq!(item_spellings(""), [None, None, None]);
    }

    /// What the spelling-major order protects, asserted rather than left to a doc comment.
    ///
    /// No entry can be beaten by another matching its stripped form, because no two entries
    /// collide that way. A future scraped ruleset could, and then the loops honouring the order
    /// would be the only thing keeping `pearls` resolving to pearls.
    #[test]
    fn no_two_catalogue_entries_collide_across_the_plural_rule() {
        let ruleset = ruleset();

        for item in ruleset.items.values() {
            // A stripped form matching the entry's *own* other spelling is no collision at all -
            // `spices [SPIC]` strips to exactly its own tag. Only another entry answering to it
            // could change which item a name resolves to, so entries are compared by tag.
            for spelling in [item.tag.as_str(), item.name.as_str()] {
                for stripped in [spelling.strip_suffix("es"), spelling.strip_suffix('s')]
                    .into_iter()
                    .flatten()
                {
                    let other = ruleset.items.values().find(|candidate| {
                        candidate.tag != item.tag
                            && (candidate.tag.eq_ignore_ascii_case(stripped)
                                || candidate.name.eq_ignore_ascii_case(stripped))
                    });
                    assert!(
                        other.is_none(),
                        "{spelling} strips to {stripped}, which {} also answers to",
                        other.expect("just checked").tag
                    );
                }
            }
        }
    }
}
