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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/MovementMode.ts")
)]
#[serde(rename_all = "camelCase")]
pub enum MovementMode {
    Fly,
    Ride,
    Sail,
    Walk,
}

/// Movement points a unit gets per month, by mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/MovementPoints.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementPoints {
    pub walk: u32,
    pub ride: u32,
    pub fly: u32,
}

/// What entering a region costs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/TerrainCosts.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/RoadRule.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoadRule {
    pub divisor: u32,
    pub minimum_cost: u32,
}

/// The water rule, including the terrain name it is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/OceanRule.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/SailingRule.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/Provenance.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    pub movement_points: String,
    pub terrain_costs: String,
    pub road: String,
    pub ocean: String,
    pub sailing: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/MovementRules.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/ItemKind.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/ItemCapacity.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemCapacity {
    pub walk: i64,
    pub ride: i64,
    pub fly: i64,
    pub swim: i64,
}

/// Which modes an item can carry itself in, whether or not it has spare capacity to carry more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/SelfMobility.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfMobility {
    pub walk: bool,
    pub ride: bool,
    pub fly: bool,
    pub swim: bool,
}

/// A monster's fighting numbers, which is all the risk heuristic weighs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/MonsterCombat.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonsterCombat {
    pub skill: i64,
    pub attacks_per_round: i64,
    pub hits_to_kill: i64,
    pub damage_per_attack: i64,
}

/// What wielding a weapon needs, as the data page's wield clause states it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/Weapon.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Weapon {
    /// The skill tag needed to wield it, or `None` where the page says none is needed.
    #[serde(default)]
    pub needs: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/ItemEntry.ts")
)]
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
    #[cfg_attr(test, ts(optional))]
    pub combat: Option<MonsterCombat>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub cargo_capacity: Option<i64>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub capacity_condition: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub sailing_skill: Option<i64>,
    /// What WITHDRAW costs per unit of this item, in silver. `None` for an item the page prices
    /// nowhere - anything that is not a basic item - and for a ruleset cached before `ah-1wcw.6`.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub withdraw_cost: Option<i64>,
    /// Present only for weapons - an item whose page description states how it is wielded. `None`
    /// for everything else, and for a ruleset cached before `ah-1ad6.1`.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub weapon: Option<Weapon>,
    /// What the data page says about it, after the preamble of name, tag, weight and capacity the
    /// fields above already carry. `None` for an entry that is nothing but that preamble, and for
    /// a ruleset cached before ah-3cj4.2, which carried no prose at all.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub description: Option<String>,
}

/// Thresholds for the risk heuristic. Ours, not the game's, which is why they carry `scraped`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/RiskThresholds.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiskThresholds {
    pub scraped: bool,
    pub note: String,
    pub medium_ratio: f64,
    pub high_ratio: f64,
}

/// Where the ruleset came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/RulesetSource.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/Gap.ts")
)]
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
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/Gaps.ts")
)]
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
/// `s` removed. The suffix is matched without regard to case, so `ORCS` strips to `ORC` exactly as
/// `orcs` strips to `orc`. **The order matters and is the caller's to honour**: every spelling must be tried
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
    /// The text without `suffix`, matched without regard to case - [`Ruleset::find_item`] is
    /// case-insensitive everywhere else, and a player writing `ALL ORCS` in the case the report
    /// prints tags in must reach the same item as one writing `all orcs` (`ah-qct4`).
    fn without<'a>(written: &'a str, suffix: &str) -> Option<&'a str> {
        let cut = written.len().checked_sub(suffix.len())?;
        written
            .is_char_boundary(cut)
            .then(|| &written[..cut])
            .filter(|_| written[cut..].eq_ignore_ascii_case(suffix))
    }

    [
        Some(written),
        without(written, "es"),
        without(written, "s"),
    ]
}

/// One thing a cast consumes: an item tag (`SILV` for silver) and how many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/CastInput.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CastInput {
    pub tag: String,
    pub amount: i64,
}

/// One thing a CAST creates, as the skill's own level paragraph states it.
///
/// The data page states a creation in four shapes and this records all four as one number, because
/// one arithmetic covers them: `percent_per_level` times the caster's level is a total in percent,
/// of which every whole hundred is an item the cast makes for certain and the remainder is the
/// chance of one more. `may create 5 times their level in mithril swords [MSWO]` is `500`, so a
/// level 3 mage makes 1500 percent - fifteen swords and nothing left over. `has a 20 percent times
/// their level chance to create a ring of invisibility [RING]` is `20`, so a level 3 mage makes 60
/// percent - no ring for certain and a 60 percent chance of one. Create runesword is `90`, so a
/// level 5 mage makes 450 - four runeswords and a 50 percent chance of a fifth.
///
/// Nothing here is charged or shown; `ah-ofpb.4` charges against it and `ah-ofpb.5` renders it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/CastOutput.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CastOutput {
    /// The item tag one cast creates.
    pub tag: String,
    /// The lowest skill level whose paragraph states this creation, and so the lowest level at
    /// which a cast makes it at all. `1` for every creation on the page but transmutation's later
    /// outputs - `IRWD` at 2, `FLOA` at 3, `YEW` at 4, `WING` and `ADMT` at 5 - and bird lore's
    /// eagles, at 3.
    pub level: u32,
    /// How much of `tag` one cast creates, in percent per level of the caster's skill. See this
    /// type's own documentation for what a total past 100 means.
    pub percent_per_level: i64,
    /// Added to the caster's skill level before `percent_per_level` is applied. `-2` for bird
    /// lore, whose prose states its eagles as "100 percent times his skill level minus 2" while
    /// its normalised sentence says "their level"; the navigator chose the prose (2026-08-26).
    /// `0` for every other creation the page states.
    pub level_offset: i64,
    /// Set when the skill's own paragraph words the number as an average rather than a count.
    /// Four skills on the page say it and no others: `data/WOLF` "averaging", `data/BIRD` "an
    /// average of", `data/SUSK` and `data/RAIS` "at an average rate of". What it means for the
    /// count is [`super::super::orders::silver::plan_cast`]'s business.
    #[serde(default)]
    pub averaged: bool,
    /// Set when the skill's paragraph calls the creation a summoning rather than a making. Nine
    /// skills on the page say it. It decides one word in the interface and nothing else.
    #[serde(default)]
    pub summoned: bool,
    /// How many of `tag` a mage may control at once, as the skill's own paragraph states it.
    /// `None` for a skill that states no cap, which is five of the nine summons and every
    /// non-summon creation.
    #[serde(default)]
    pub control: Option<ControlCap>,
}

/// A cap on how many of a summoned creature one mage may control, as
/// `multiplier * max(0, level + offset).pow(exponent)`.
///
/// Three numbers rather than one, because the four skills that state a cap state it in four
/// different shapes and there is no fifth on the page:
/// `data/WOLF` "control a total number of his skill level squared times 4 wolves" is
/// `{4, 0, 2}`; `data/BIRD` "may control a number equal to his skill level minus 2, squared,
/// times two" is `{2, -2, 2}`; `data/DRAG` "the total number of dragons that a mage may control
/// at one time is equal to his skill level" is `{1, 0, 1}`; and `data/SUBA` "may only summon a
/// balrog if one is not already under his control" is `{1, 0, 0}`, a flat one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/ControlCap.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlCap {
    pub multiplier: i64,
    pub offset: i64,
    pub exponent: u32,
}

/// What CASTing a skill consumes, as the data page states it and as ah-dbb.2 charges it: `costs`
/// once per cast, and for transmutation the output tag -> the source tag it is made from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/CastCost.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CastCost {
    pub costs: Vec<CastInput>,
    pub transmute: BTreeMap<String, String>,
    /// What the cast creates. Empty for a spell that creates nothing an item catalogue can carry -
    /// construct gate makes a Gate, which is a region feature - and for a ruleset generated before
    /// creations were scraped.
    #[serde(default)]
    pub creates: Vec<CastOutput>,
}

/// One thing a production recipe consumes: an item tag (`SILV` for silver) and how many.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(
        export,
        export_to = "../../../ruleset/src/generated/ProductionInput.ts"
    )
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductionInput {
    pub tag: String,
    pub amount: i64,
}

/// One thing a skill can make, the level at which it can first be made, and what it takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/Production.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Production {
    pub tag: String,
    pub level: u32,
    /// What one output consumes. Empty for a recipe that takes nothing but labour - every raw
    /// resource - and for a ruleset generated before inputs were scraped.
    #[serde(default)]
    pub inputs: Vec<ProductionInput>,
    /// Whether `inputs` are alternatives rather than requirements - cooking's "any of" alone today.
    #[serde(default)]
    pub inputs_are_alternatives: bool,
    /// Man-months per `outputs`. Absent for a ruleset generated before the rate was scraped;
    /// `None`, never 1, so a consumer can tell "not scraped" from "one a month" - and so no
    /// default of 0 waits as a division by zero in `ah-19l2.2`.
    #[serde(default)]
    pub man_months: Option<u32>,
    /// How many the recipe makes per `man_months`. `None` both for a ruleset generated before this
    /// was scraped and for cooking, whose output the page states as a formula.
    #[serde(default)]
    pub outputs: Option<u32>,
}

/// A skill a unit must already have, at a level, before it may begin to study another.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(
        export,
        export_to = "../../../ruleset/src/generated/SkillRequirement.ts"
    )
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillRequirement {
    pub tag: String,
    pub level: u32,
}

/// A skill, and what a month of studying it costs.
///
/// Separate from the item catalogue rather than merged into it, because ten tags mean one thing as
/// a skill and another as an item: FISH is fishing and also fish, HERB is herb lore and also herbs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/SkillEntry.ts")
)]
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
    /// Whether this is one of the magic skills, which the data page marks nowhere and the scraper
    /// therefore reads from the skill's own description. `false` for a skill scraped before this
    /// was added, and for `annihilation`, whose description names no magic and which cannot be
    /// studied by ordinary means anyway.
    #[serde(default)]
    pub magic: bool,
    /// Whether casting this skill damages enemies, which is one of the four ways the rules let a
    /// unit TAX - and so one of the ways its men count toward `PILLAGE`'s threshold. The data page
    /// marks it nowhere and the scraper reads it from the skill's own description, exactly as
    /// `magic` is read. `false` for a ruleset scraped before this was added, which under-counts
    /// rather than over-counts - a missing warning rather than a false one.
    #[serde(default)]
    pub damages_enemies: bool,
    /// What a unit must already have before it may begin this skill, as the data page's `This
    /// skill requires force [FORC] 1 to begin to study.` states it. Empty for a skill with no
    /// prerequisites, and for a ruleset cached before they were scraped.
    #[serde(default)]
    pub requires: Vec<SkillRequirement>,
    /// What the page says at each level, in level order, with the levels it fills with `No skill
    /// report.` left out. Empty for a ruleset cached before ah-3cj4.2.
    #[serde(default)]
    // The scraper omits this rather than writing `[]` for a skill that says nothing anywhere, so
    // TypeScript must see it as optional; `serde(default)` already accepts the absence in Rust.
    #[cfg_attr(test, ts(as = "Option<Vec<SkillLevel>>", optional))]
    pub levels: Vec<SkillLevel>,
}

/// What a skill's page says at one level, once the placeholders are dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/SkillLevel.ts")
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillLevel {
    pub level: u32,
    pub description: String,
}

/// A building the game's data page describes, and how many mages may study in it.
///
/// Unlike its neighbours this does not `deny_unknown_fields`: a ruleset cached before ah-9js
/// carries a `name` and a single `material` string, and refusing those would turn an old cache
/// into a failed load rather than a ruleset that knows a little less.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/BuildingEntry.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct BuildingEntry {
    /// The description the data page gives it, verbatim and whitespace-collapsed. Empty for a
    /// ruleset cached before ah-3cj4.1, which carried no prose at all.
    #[serde(default)]
    pub description: String,
    /// What a trade structure increases the supply of, in the page's own word - `iron`, `yew`.
    /// `None` for anything that is not one.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub produces: Option<String>,
    /// Men the structure protects. `None` for a Mine, a road or a lair, which state no defence
    /// because they give none - an absence, not a zero, which would claim the page had said so.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub size: Option<i64>,
    /// What building it costs. `None` for anything no skill can build.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub cost: Option<i64>,
    /// What it is built from, in the page's own order - a list because a structure can offer
    /// alternatives (`an Inn from 10 wood or stone`). `None` for anything no skill can build, and
    /// for a ruleset cached before ah-9js, which wrote a single `material` string this no longer
    /// reads.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub materials: Option<Vec<String>>,
    /// The tag of the skill that builds it - `BUIL`, `MINI`. `None` for a structure no skill's
    /// entry names, and for a ruleset cached before ah-bwly.1: the catalogue not saying, never
    /// "no skill needed".
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub build_skill: Option<String>,
    /// The lowest level of `build_skill` that can build it. `None` exactly when `build_skill` is.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub build_level: Option<i64>,
    /// How many mages the building provides study facilities for. **Zero for a Tower**, which is
    /// the ruleset's own answer and not an oversight: a mage studying in one gets half a month.
    pub mages: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../../ruleset/src/generated/Ruleset.ts")
)]
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
    /// Empty for a ruleset generated before buildings were scraped. Empty means nothing can be
    /// said about a structure, not that no structure seats a mage.
    #[serde(default)]
    pub buildings: BTreeMap<String, BuildingEntry>,
    /// Which item tags belong to each class `GIVE [unit] ALL [item class]` accepts, for the
    /// classes this catalogue can read off the data page.
    ///
    /// **A class the page never states is absent, and the absence is the answer**: `ADVANCED`,
    /// `MAGIC` and `SPECIAL` are never printed by the engine in any form, so a caller must tell
    /// "this catalogue cannot say" from "this class is empty here", and a missing key is how.
    /// `ITEM`/`ITEMS` is absent too, for the opposite reason - `rules/give` defines it as
    /// everything the holder has, so it needs no catalogue.
    ///
    /// Keys are `ItemClass::key`. An unrecognised key is ignored rather than refused, in the same
    /// spirit as `ItemKind::Unknown`: a later scraper that learns a sixteenth class should not
    /// make this build refuse the file. Empty for a ruleset generated before `ah-3sp7.1`, which
    /// reads as "no class can be resolved" and is exactly today's behaviour.
    #[serde(default)]
    pub item_classes: BTreeMap<String, Vec<String>>,
    /// The item tags the data page says may not change hands: `This item cannot be given to
    /// other units.` 51 monsters and the imprisoned entity carry it, so `GIVE ... ALL MONSTERS`
    /// selects sixty items and can move nine.
    ///
    /// Sorted. Empty for a ruleset generated before `ah-3sp7.1`, which reads as "nothing is known
    /// to be ungiveable" - the permissive direction, and the one that matches a page which states
    /// the restriction and is silent otherwise.
    #[serde(default)]
    pub ungiveable_items: Vec<String>,
}

/// One of the classes `GIVE [unit] ALL [item class]` accepts, as `rules/give` enumerates them.
///
/// The engine holds these as bit flags, so an item is routinely in several at once - a pick is
/// NORMAL, WEAPON and TOOL - which is why membership is a set per class rather than a second
/// single-valued field beside `ItemKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemClass {
    Normal,
    Advanced,
    Trade,
    Man,
    Monster,
    Magic,
    Weapon,
    Armor,
    Mount,
    Battle,
    Special,
    Tool,
    Food,
    Ship,
    Item,
}

impl ItemClass {
    /// The class an order's word names, singular or plural, in any case.
    ///
    /// `rules/give` gives a plural to some and not to others, and the engine rejects "armors"
    /// (`items.cpp`, `parse_item_category`). This mirrors that table exactly rather than
    /// stripping a trailing `s`. Case-insensitive; anything else is `None`.
    #[must_use]
    pub fn parse(word: &str) -> Option<Self> {
        let upper = word.to_ascii_uppercase();
        Some(match upper.as_str() {
            "NORMAL" => Self::Normal,
            "ADVANCED" => Self::Advanced,
            "TRADE" => Self::Trade,
            "MAN" | "MEN" => Self::Man,
            "MONSTER" | "MONSTERS" => Self::Monster,
            "MAGIC" => Self::Magic,
            "WEAPON" | "WEAPONS" => Self::Weapon,
            "ARMOR" => Self::Armor,
            "MOUNT" | "MOUNTS" => Self::Mount,
            "BATTLE" => Self::Battle,
            "SPECIAL" => Self::Special,
            "TOOL" | "TOOLS" => Self::Tool,
            "FOOD" => Self::Food,
            "SHIP" | "SHIPS" => Self::Ship,
            "ITEM" | "ITEMS" => Self::Item,
            _ => return None,
        })
    }

    /// The key this class is written under in `config/public/ruleset.json`: the singular,
    /// upper-case form.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Normal => "NORMAL",
            Self::Advanced => "ADVANCED",
            Self::Trade => "TRADE",
            Self::Man => "MAN",
            Self::Monster => "MONSTER",
            Self::Magic => "MAGIC",
            Self::Weapon => "WEAPON",
            Self::Armor => "ARMOR",
            Self::Mount => "MOUNT",
            Self::Battle => "BATTLE",
            Self::Special => "SPECIAL",
            Self::Tool => "TOOL",
            Self::Food => "FOOD",
            Self::Ship => "SHIP",
            Self::Item => "ITEM",
        }
    }
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

    /// The tags in one class, or `None` where this catalogue cannot say which items those are.
    ///
    /// `None` for `ADVANCED`, `MAGIC` and `SPECIAL`, which the data page never states; for
    /// `ITEM`/`ITEMS`, which is everything and is the caller's to answer without a catalogue; for
    /// a word that is not a class at all; and for a ruleset generated before this field existed.
    /// A caller that must not guess treats `None` as "cannot say" and never as "no such items".
    #[must_use]
    pub fn class_members(&self, class: &str) -> Option<&[String]> {
        let class = ItemClass::parse(class)?;
        self.item_classes.get(class.key()).map(Vec::as_slice)
    }

    /// Whether an item may be handed to another unit, as far as the catalogue knows.
    ///
    /// True for a tag the catalogue does not carry: the page says a thing *cannot* be given and
    /// is silent otherwise, so silence and ignorance look the same and the permissive reading is
    /// the one that matches the page.
    #[must_use]
    pub fn can_be_given(&self, tag: &str) -> bool {
        !self.ungiveable_items.iter().any(|item| item == tag)
    }

    /// Whether the game will carry this item by `TRANSPORT`, as far as the catalogue knows.
    ///
    /// `rules/economy_transport` refuses five kinds: men (leaders included), summoned creatures
    /// (illusionary ones included), ships, mounts, war machines, and items created using artifact
    /// lore. Four of those are classes the data page states, so `item_classes` answers them.
    ///
    /// The fifth it never states, and the navigator's rule settles it: **anything a `create ...`
    /// spell can make is an artefact.** Twenty-one skills are named that way; eighteen name an
    /// item that exists and every one of those eighteen requires artifact lore, and the three
    /// that name no item make an aura and two kinds of phantasm - and phantasms are already
    /// refused as summoned creatures. Five items are reached by no rule at all (`PORT`, `MWAG`,
    /// `GLID`, `HPOT`, `IENT`) and stay transportable: a hand-written list of them would not be
    /// supported by the game's own data and would rot silently if the game changed.
    ///
    /// True for a tag the catalogue cannot place, in the same spirit as [`Ruleset::can_be_given`]:
    /// the pages state a restriction and are silent otherwise, so silence and ignorance look the
    /// same and the permissive reading is the one that matches them.
    #[must_use]
    pub fn can_be_transported(&self, tag: &str) -> bool {
        if self.is_man(tag) {
            return false;
        }
        if self.items.get(tag).is_some_and(|item| {
            matches!(
                item.kind,
                ItemKind::Mount | ItemKind::Monster | ItemKind::Ship
            )
        }) {
            return false;
        }
        for class in ["MAN", "MONSTER", "MOUNT", "SHIP"] {
            if self
                .class_members(class)
                .is_some_and(|tags| tags.iter().any(|t| t.eq_ignore_ascii_case(tag)))
            {
                return false;
            }
        }
        if self.made_by_a_create_spell(tag) {
            return false;
        }
        true
    }

    /// Whether some skill's name reads `create ...` and the remainder resolves, through
    /// [`Ruleset::find_item`], to this tag - the navigator's rule for what counts as an artefact.
    fn made_by_a_create_spell(&self, tag: &str) -> bool {
        self.skills.values().any(|skill| {
            skill
                .name
                .to_ascii_lowercase()
                .strip_prefix("create ")
                .and_then(|remainder| self.find_item(remainder))
                .is_some_and(|entry| entry.tag.eq_ignore_ascii_case(tag))
        })
    }

    /// Whether a skill tag names one of the magic skills.
    ///
    /// The catalogue settles it when it was scraped with this known; a skill it does not carry, or
    /// a ruleset generated before the flag existed, answers `false`, and a caller that must not
    /// guess should treat that as "cannot say" rather than as "mundane".
    #[must_use]
    pub fn is_magic(&self, tag: &str) -> bool {
        self.skills.get(tag).is_some_and(|skill| skill.magic)
    }

    /// How many mages may study unhindered in a structure of this kind, when the catalogue knows
    /// the kind at all.
    ///
    /// `None` for a structure the data page does not name - a ship - and for a ruleset scraped
    /// before buildings were. Since ah-3cj4.1 the page's every building is carried, so a Mine, an
    /// Inn and a road now answer `Some(0)`: the page states a capacity wherever there is one, and
    /// silence is its way of saying none. The one caller reads
    /// `is_some_and(|seats| seats >= 1)`, which is false for `None` and `Some(0)` alike.
    #[must_use]
    pub fn mage_capacity(&self, kind: &str) -> Option<i64> {
        self.buildings
            .get(&kind.to_ascii_uppercase())
            .map(|building| building.mages)
    }

    /// The skill tag and level a structure of this kind must be built with, or `None` when the
    /// catalogue does not say.
    ///
    /// `None` covers three different silences, and every one of them means the same thing to a
    /// caller: a ruleset scraped before ah-bwly.1, a kind the page never names (a ship), and one
    /// of the 22 buildings of 58 the page names without a requirement. None of them is a claim
    /// that anybody may build it, so no caller may read `None` as "no skill needed".
    ///
    /// Keyed upper-cased, as [`Ruleset::mage_capacity`] already is: a report writes `Mine`, the
    /// catalogue holds `MINE`.
    #[must_use]
    pub fn build_requirement(&self, kind: &str) -> Option<(&str, i64)> {
        let building = self.buildings.get(&kind.to_ascii_uppercase())?;
        // Both halves or neither. ah-bwly.1 writes them together, so a half-filled entry can only
        // come from something having gone wrong - and reading that as no requirement stays quiet
        // rather than warning about every unit in the game.
        Some((building.build_skill.as_deref()?, building.build_level?))
    }

    /// What a structure costs in work and material, and which materials may be spent on it.
    ///
    /// `None` when the catalogue states neither - 22 of the data page's 58 structures (a Shaft, a
    /// Lair, a Gateway), every ship, and anything the player has misspelt. That is the catalogue
    /// declining to say, and this column marks such a build rather than guessing (`ah-ofpb.2`).
    ///
    /// The materials are the page's own **lower-case display names** - `["wood", "stone"]`, not
    /// tags - because that is what the scraper writes (`packages/ruleset/src/data.ts:817`).
    /// Resolve each through [`Ruleset::find_item`] before it touches an item list.
    #[must_use]
    pub fn build_recipe(&self, kind: &str) -> Option<(i64, &[String])> {
        let building = self.buildings.get(&kind.to_ascii_uppercase())?;
        let materials = building
            .materials
            .as_deref()
            .filter(|list| !list.is_empty())?;
        Some((building.cost?, materials))
    }

    /// Whether this ruleset carries the buildings table at all.
    ///
    /// [`Ruleset::mage_capacity`] answers `None` both for a kind the table does not name and for a
    /// ruleset cached before the table was scraped - a Mine really has no mage seats, but a
    /// ruleset that knows no buildings knows nothing about any of them, and a check that cannot
    /// tell those apart would warn about every mage in the game.
    #[must_use]
    pub fn knows_buildings(&self) -> bool {
        !self.buildings.is_empty()
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

    // `ItemEntry` carries `deny_unknown_fields`, so a new field must be optional in both
    // directions: absent from a ruleset cached before it existed, and present in one scraped
    // after (`ah-1ad6.1`).
    #[test]
    fn a_ruleset_without_weapons_still_loads() {
        let json = r#"{
            "tag": "GRAI", "name": "grain", "kind": "equipment", "weight": 5,
            "capacity": {"walk": 0, "ride": 0, "fly": 0, "swim": 0},
            "selfMobile": {"walk": false, "ride": false, "fly": false, "swim": false},
            "moves": 0
        }"#;

        let entry: ItemEntry = serde_json::from_str(json).expect("an entry with no weapon loads");

        assert_eq!(entry.weapon, None);
    }

    #[test]
    fn a_weapon_needing_no_skill_round_trips() {
        let entry: ItemEntry = serde_json::from_str(
            r#"{
            "tag": "SWOR", "name": "sword", "kind": "equipment", "weight": 1,
            "capacity": {"walk": 0, "ride": 0, "fly": 0, "swim": 0},
            "selfMobile": {"walk": false, "ride": false, "fly": false, "swim": false},
            "moves": 0, "weapon": {"needs": null}
        }"#,
        )
        .expect("a weapon needing no skill loads");

        assert_eq!(entry.weapon, Some(Weapon { needs: None }));
    }

    #[test]
    fn a_class_word_is_read_singular_or_plural_where_the_rules_give_one() {
        assert_eq!(ItemClass::parse("MEN"), Some(ItemClass::Man));
        assert_eq!(ItemClass::parse("men"), Some(ItemClass::Man));
        assert_eq!(ItemClass::parse("MAN"), Some(ItemClass::Man));
        assert_eq!(ItemClass::parse("TOOLS"), Some(ItemClass::Tool));

        // The case that proves the table was copied rather than an `s` stripped: the engine
        // accepts ARMOR but rejects ARMORS, unlike TOOL/TOOLS above.
        assert_eq!(ItemClass::parse("ARMOR"), Some(ItemClass::Armor));
        assert_eq!(ItemClass::parse("ARMORS"), None);

        assert_eq!(ItemClass::parse("FRUIT"), None);
    }

    #[test]
    fn the_catalogue_refuses_to_transport_men_mounts_ships_and_war_machines() {
        let ruleset = ruleset();

        assert!(!ruleset.can_be_transported("LEAD"), "a man");
        assert!(!ruleset.can_be_transported("HORS"), "a mount");
        assert!(!ruleset.can_be_transported("COG"), "a ship");
        // A war machine: `kind` is `equipment`, only the MONSTER class catches it.
        assert!(!ruleset.can_be_transported("CATP"), "a war machine");
    }

    #[test]
    fn an_item_a_create_spell_makes_is_an_artefact_and_stays_put() {
        let ruleset = ruleset();

        // The navigator's rule: anything a `create ...` spell can make is an artefact.
        assert!(!ruleset.can_be_transported("RING"), "ring of invisibility");
        assert!(!ruleset.can_be_transported("CARP"), "magic carpet");
        assert!(!ruleset.can_be_transported("RUNE"), "runesword");
        assert!(!ruleset.can_be_transported("AEGS"), "aegis");
    }

    #[test]
    fn ordinary_goods_and_the_items_no_rule_reaches_may_be_transported() {
        let ruleset = ruleset();

        assert!(ruleset.can_be_transported("STON"));
        assert!(ruleset.can_be_transported("FUR"));
        assert!(ruleset.can_be_transported("SILV"));

        // No rule reaches these five; the navigator's decision leaves them transportable.
        assert!(ruleset.can_be_transported("PORT"), "portal");
        assert!(ruleset.can_be_transported("MWAG"), "magic wagon");
        assert!(ruleset.can_be_transported("GLID"), "glider");
        assert!(ruleset.can_be_transported("HPOT"), "healing potion");
        assert!(ruleset.can_be_transported("IENT"), "imprisoned entity");
    }

    #[test]
    fn the_transport_refusal_covers_exactly_a_hundred_and_five_of_the_catalogue() {
        let ruleset = ruleset();

        let refused = ruleset
            .items
            .keys()
            .filter(|tag| !ruleset.can_be_transported(tag))
            .count();

        assert_eq!(refused, 105);
    }

    #[test]
    fn a_buildings_build_requirement_survives_a_round_trip() {
        let ruleset = ruleset();
        let mine = ruleset
            .buildings
            .get("MINE")
            .expect("the committed ruleset names a Mine");

        assert_eq!(mine.build_skill.as_deref(), Some("MINI"));
        assert_eq!(mine.build_level, Some(3));

        // A structure no skill's entry names states neither half - an absence, not a claim that
        // anyone can build it.
        let lair = ruleset
            .buildings
            .get("LAIR")
            .expect("the committed ruleset names a Lair");
        assert_eq!(lair.build_skill, None);
        assert_eq!(lair.build_level, None);
    }

    #[test]
    fn the_build_requirement_is_read_out_by_kind_however_it_is_written() {
        let ruleset = ruleset();

        // The report writes a structure's kind as the page prints it; the map is keyed
        // upper-cased, as `mage_capacity` already assumes.
        assert_eq!(ruleset.build_requirement("Mine"), Some(("MINI", 3)));
        assert_eq!(ruleset.build_requirement("MINE"), Some(("MINI", 3)));
        assert_eq!(ruleset.build_requirement("Tower"), Some(("BUIL", 1)));

        // A structure the page names but gives no requirement for is not a structure anyone can
        // be told they may build: the catalogue simply does not say.
        assert_eq!(ruleset.build_requirement("Lair"), None);
        // Nor is a kind the catalogue has never heard of - a ship.
        assert_eq!(ruleset.build_requirement("Longship"), None);
    }

    #[test]
    fn a_building_states_its_cost_and_its_materials() {
        let ruleset = ruleset();

        assert_eq!(
            ruleset.build_recipe("Stockade"),
            Some((60, ["wood".to_string()].as_slice()))
        );
        assert_eq!(
            ruleset.build_recipe("Mine"),
            Some((10, ["wood".to_string(), "stone".to_string()].as_slice()))
        );
        // The map is keyed upper-case, as `build_requirement` already assumes.
        assert_eq!(
            ruleset.build_recipe("mine"),
            Some((10, ["wood".to_string(), "stone".to_string()].as_slice()))
        );
        // A structure no skill's entry names states neither half.
        assert_eq!(ruleset.build_recipe("Shaft"), None);
        // Nor does a kind the catalogue has never heard of.
        assert_eq!(ruleset.build_recipe("Barn"), None);
    }

    /// Half an entry is not a state ah-bwly.1 can produce, but reading it as "no requirement" is
    /// the safe way round if one ever appears.
    #[test]
    fn half_a_build_requirement_is_no_requirement() {
        let mut ruleset = ruleset();
        let mine = ruleset
            .buildings
            .get_mut("MINE")
            .expect("the committed ruleset names a Mine");
        mine.build_level = None;

        assert_eq!(ruleset.build_requirement("Mine"), None);
    }

    #[test]
    fn a_ruleset_cached_before_build_requirements_still_loads() {
        // The case both `Option`s exist for: JSON written before ah-bwly.1 carries neither field.
        let entry: BuildingEntry =
            serde_json::from_str(r#"{"description":"This is a building.","mages":0,"cost":10}"#)
                .expect("a building entry without a build requirement should still load");

        assert_eq!(entry.build_skill, None);
        assert_eq!(entry.build_level, None);
    }

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

    /// A ruleset cached before `ah-1wcw.6` carries no withdrawal prices at all, and must still
    /// load - which is what `#[serde(default)]` on `withdraw_cost` is for.
    #[test]
    fn a_ruleset_without_withdrawal_prices_still_loads() {
        let json = r#"{
            "tag": "GRAI",
            "name": "grain",
            "kind": "equipment",
            "weight": 5,
            "capacity": { "walk": 0, "ride": 0, "fly": 0, "swim": 0 },
            "selfMobile": { "walk": false, "ride": false, "fly": false, "swim": false },
            "moves": 0
        }"#;
        let entry: ItemEntry =
            serde_json::from_str(json).expect("an entry missing withdrawCost should still parse");
        assert_eq!(entry.withdraw_cost, None);
    }

    /// A ruleset cached before `ah-19l2.1` carries a bare `{tag, level}` production, and must still
    /// load: `deny_unknown_fields` is about keys the struct has never heard of, and
    /// `#[serde(default)]` is what covers keys the JSON has not got yet.
    #[test]
    fn a_ruleset_without_production_inputs_still_loads() {
        let json = r#"{ "tag": "CATP", "level": 4 }"#;
        let production: Production =
            serde_json::from_str(json).expect("a production missing inputs should still parse");
        assert_eq!(production.inputs, Vec::new());
        assert!(!production.inputs_are_alternatives);
        assert_eq!(production.man_months, None);
        assert_eq!(production.outputs, None);
    }

    /// A ruleset cached before `ah-ofpb.3` carries a `cast` with `costs` and `transmute` and no
    /// `creates`, and must still load: `deny_unknown_fields` is about keys the struct has never
    /// heard of, and `#[serde(default)]` is what covers keys the JSON has not got yet.
    #[test]
    fn a_ruleset_without_cast_creations_still_loads() {
        let json = r#"{
            "costs": [{ "tag": "SILV", "amount": 200 }],
            "transmute": {}
        }"#;
        let cast: CastCost =
            serde_json::from_str(json).expect("a cast missing creates should still parse");
        assert_eq!(cast.creates, Vec::new());
    }

    /// A ruleset cached before `ah-ofpb.5` carries a `CastOutput` with no `averaged`, `summoned` or
    /// `control`, and must still load: `deny_unknown_fields` is about keys the struct has never
    /// heard of, and `#[serde(default)]` is what covers keys the JSON has not got yet.
    #[test]
    fn a_ruleset_without_control_caps_still_loads() {
        let json = r#"{
            "tag": "MSWO",
            "level": 1,
            "percentPerLevel": 500,
            "levelOffset": 0
        }"#;
        let output: CastOutput = serde_json::from_str(json)
            .expect("a CastOutput missing control caps should still parse");
        assert!(!output.averaged);
        assert!(!output.summoned);
        assert_eq!(output.control, None);
    }

    /// force, pattern, spirit, necromancy, teleportation and illusion are magic; mining, lumberjack,
    /// combat, sailing and building are not - the acceptance criteria for `ah-a2k.1`, checked
    /// against the committed ruleset rather than trusted from the doc comment alone.
    #[test]
    fn a_magic_skill_is_known_from_the_catalogue() {
        let ruleset = ruleset();
        for magic in ["FORC", "PATT", "SPIR", "NECR", "TELE", "ILLU"] {
            assert!(ruleset.is_magic(magic), "{magic} should be magic");
        }
        for mundane in ["MINI", "LUMB", "COMB", "SAIL", "BUIL"] {
            assert!(!ruleset.is_magic(mundane), "{mundane} should not be magic");
        }
        // A tag the catalogue has never heard of cannot say "magic" any more than "mundane" - see
        // `is_magic`'s own doc comment.
        assert!(!ruleset.is_magic("NOPE"));
    }

    /// Mirrors `a_ruleset_written_before_this_field_existed_still_loads` above, for the skill
    /// catalogue: `#[serde(default)]` is what lets `Ruleset::from_json` keep working on a ruleset
    /// generated before this field existed, exactly as `cast` and `produces` already do.
    #[test]
    fn a_ruleset_without_the_magic_flag_still_parses() {
        let json = r#"{
            "tag": "MINI",
            "name": "mining",
            "cost": 10,
            "maxLevel": 5
        }"#;
        let entry: SkillEntry =
            serde_json::from_str(json).expect("a skill entry missing magic should still parse");
        assert!(!entry.magic);
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

    /// The report prints tags in upper case (`8 orcs [ORC]`), so a player writing `ALL ORCS` in
    /// that voice must reach the same item as one writing `all orcs` (`ah-qct4`).
    #[test]
    fn an_upper_case_plural_strips_the_same_as_a_lower_case_one() {
        assert_eq!(item_spellings("ORCS")[2], Some("ORC"));
        assert_eq!(item_spellings("LEADERS")[2], Some("LEADER"));
        assert_eq!(item_spellings("BOXES")[1], Some("BOX"));
        assert_eq!(item_spellings("SpiceS")[2], Some("Spice"));

        // The text as written stays first, whatever its case.
        assert_eq!(item_spellings("ORCS")[0], Some("ORCS"));
        assert_eq!(item_spellings("BOXES")[0], Some("BOXES"));
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

    /// ah-a2k.3: the buildings table backs `ah-a2k.2`'s "no facilities here" warning, and a Tower
    /// seating zero mages is the case that makes the check worth building - it must not be
    /// mistaken for "unknown".
    #[test]
    fn a_buildings_mage_capacity_is_known() {
        let ruleset = ruleset();
        assert_eq!(ruleset.mage_capacity("Tower"), Some(0));
        assert_eq!(ruleset.mage_capacity("Citadel"), Some(3));
        // Case-insensitive, the same way `is_man` looks items up by their uppercase tag.
        assert_eq!(ruleset.mage_capacity("tower"), Some(0));
        // A road is a building the page describes, and since ah-3cj4.1 the catalogue carries it.
        // It seats nobody, which is what the page's silence about mages says. It must still not
        // resolve to another entry by prefix or by stripping the direction.
        assert_eq!(ruleset.mage_capacity("Road SE"), Some(0));
    }

    /// The distinction between "no facilities" (`Some(0)`) and "the catalogue cannot say" (`None`)
    /// is the whole reason the return type is an `Option` rather than a plain integer defaulting
    /// to zero. Since ah-3cj4.1 a Mine is on the near side of it - the page describes it, and its
    /// silence about mages means none - so the `None` case is now a structure the data page never
    /// calls a building at all, such as a ship.
    #[test]
    fn a_structure_the_page_does_not_describe_is_unknown_not_zero() {
        let ruleset = ruleset();
        assert_eq!(ruleset.mage_capacity("Longship"), None);
        assert_eq!(ruleset.mage_capacity("Mine"), Some(0));
    }

    /// `#[serde(default)]` on `buildings` is what lets a ruleset cached before this bead keep
    /// loading; this pins that a ruleset missing the key entirely still parses and answers `None`
    /// rather than failing to load at all.
    #[test]
    fn a_ruleset_without_buildings_still_parses() {
        let json: serde_json::Value = serde_json::from_str(RULESET).unwrap();
        let mut json = json;
        json.as_object_mut()
            .expect("ruleset is a JSON object")
            .remove("buildings");
        let text = serde_json::to_string(&json).unwrap();

        let ruleset = Ruleset::from_json(&text).expect("a ruleset without buildings still parses");
        assert_eq!(ruleset.mage_capacity("Tower"), None);
    }

    /// ah-a2k.2: a check that warns about a mage outside a building must be able to tell "this
    /// kind seats nobody" from "this ruleset knows no buildings at all" - both read as `None` from
    /// `mage_capacity`, and only the second means stay silent.
    #[test]
    fn a_ruleset_without_a_buildings_table_knows_no_buildings() {
        assert!(ruleset().knows_buildings());

        let mut json: serde_json::Value = serde_json::from_str(RULESET).unwrap();
        json.as_object_mut()
            .expect("ruleset is a JSON object")
            .remove("buildings");
        let text = serde_json::to_string(&json).unwrap();
        let bare = Ruleset::from_json(&text).expect("a ruleset without buildings still parses");
        assert!(!bare.knows_buildings());
    }
}
