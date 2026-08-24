//! What one unit's month is expected to do to its silver.
//!
//! Pure arithmetic over values, with no dependency on [`super::semantics`]'s private hex types, so
//! every rule here is unit-testable without building a report. `ah-1wcw.1` models three sources -
//! `TAX`, `WORK` and `STUDY` - and the epic's later children add terms to [`forecast_unit`] rather
//! than reshaping it.
//!
//! The governing posture is the module header's next door: **a number that might be wrong is worse
//! than no number**. Where a term cannot be priced the whole side goes `None` and the interface
//! shows `?`, and rounding is always downward, because a forecast that overstates income is the
//! dangerous direction for a column whose negatives are what a player acts on.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::movement::rules::{Production, Ruleset};
use crate::orders::forms::{Amount, Party, Selector};
use crate::orders::intents::{works_by_default, Intent, PlacedIntent};
use crate::report::model::{ItemAmount, Skill};

/// "Each taxing character collects $50."
pub(crate) const TAX_PER_MAN: i64 = 50;

/// "A unit with Entertainment level 1 will earn 30 silver per man by issuing the ENTERTAIN order.
/// Higher levels of Entertainment skill can earn more, so a character with Entertainment skill 2
/// can earn twice as much money as one with skill 1."
const ENTERTAIN_PER_MAN_PER_LEVEL: i64 = 30;

/// "Phantasmal Entertainment grants the mage Entertainment skill equal to 600 silver times his
/// Phantasmal Entertainment level." - the ruleset's own rules page, which prices this spell
/// exactly and prices no other.
const PHANTASMAL_PER_LEVEL: i64 = 600;

const ENTERTAIN_TAG: &str = "ENTE";

/// The item tag silver itself carries, both in a report's inventory and in a cast's costs.
const SILVER_TAG: &str = "SILV";

/// The two spells this ruleset describes as earning. Hard-coding them in the core is a real cost,
/// accepted knowingly: the ruleset carries no structured earning for any spell, so there is nothing
/// to drive this from. Kept beside each other, with the rules text above, so a second ruleset makes
/// the omission obvious rather than silent.
const PHANTASMAL_TAG: &str = "PHEN";

/// Earth Lore earns "an amount of money based on his level, and the economy of the region" - the
/// rules page gives no arithmetic at all, so [`EARTH_LORE_PER_LEVEL_PER_WAGE`] below is the only
/// statement of it in the tree.
const EARTH_LORE_TAG: &str = "EART";

/// "floor(2 x level x W)", where W is the region's wage rate - the navigator's figure, 2026-08-23.
/// The scraped ruleset prices this spell nowhere, so this is the only statement of it in the tree.
///
/// There is no `men` term, unlike `ENTERTAIN` above, and that is deliberate: a mage unit can hold
/// only one leader, so a casting unit is always exactly one man and per-unit and per-man are the
/// same number. Do not "fix" this by multiplying by `facts.men`.
const EARTH_LORE_PER_LEVEL_PER_WAGE: i64 = 2;

/// "This fee is generally 10 silver for a normal character, and 50 silver for a leader."
const UPKEEP_PER_CHARACTER: i64 = 10;
const UPKEEP_PER_LEADER: i64 = 50;

/// "Units may substitute one unit of grain, livestock, fish or meals for each 50 silver (or
/// fraction thereof) of maintenance owed. Food value for a fractional maintenance cost still
/// consumes the entire unit of food."
///
/// **The data page says 30, and it is stale** (`ah-j00u`, settled with the navigator 2026-08-23).
/// Every food item's entry there reads "can be eaten to provide 30 silver towards a unit's
/// maintenance cost", and that sentence is scraped verbatim into
/// `config/public/ruleset.json`'s `items.GRAI.description` and its three siblings - so a reader
/// who checks the catalogue rather than the rules will find 30 and think this constant wrong.
///
/// It is not. The rules page carries 50 in the *Maintenance Costs* section, which is the section
/// that describes the mechanic; the changelog records "Meals are now 50 silver each (was 30
/// silver)"; and the data page's 30 appears identically on all four food items, which is what a
/// generated string that was never regenerated looks like rather than a second opinion.
///
/// The report corpus was searched for a unit whose food fell between two turns and cannot settle
/// it: every candidate is a supply unit visibly trading food, and the rest hold too little to tell
/// `ceil(owed/50)` from `ceil(owed/30)`. `committed.test.ts`'s
/// `still records the data page's stale food value` fails when upstream fixes the page, which is
/// the signal to delete this note.
const SILVER_PER_FOOD: i64 = 50;

/// The food items the rules name, by tag.
///
/// Public because every surface that decides *which* items are food must decide it the same way:
/// `lone_food_tag` names the food a hover says will be eaten, `food_claim` counts what the
/// accounting spends, and a test asserts against both. Three copies of one literal are three things
/// to keep in step (`ah-eacd`).
pub const FOOD_TAGS: [&str; 4] = ["GRAI", "LIVE", "FISH", "MEAL"];

/// The tag a leader carries in `men_by_race`.
const LEADER_TAG: &str = "LEAD";

/// The flag that says a unit eats faction food held by other units in its region - step 2 of the
/// payment order, and the only one of the two that reaches beyond the unit itself.
const CONSUMING_FACTION_FLAG: &str = "consuming faction's food";

/// The two flags that say a unit is set to spend its food before its silver.
const CONSUMING_FLAGS: [&str; 2] = ["consuming unit's food", CONSUMING_FACTION_FLAG];

/// The flags the game prints for a unit that taxes every turn without an order.
///
/// Two spellings, both already in the report parser's `KNOWN_FLAGS`
/// (`crates/core/src/report/unit.rs`): reports print `taxing`, and `autotax` is the order's own
/// name. Match both, because the parser accepts both.
const TAXING_FLAGS: [&str; 2] = ["taxing", "autotax"];

/// What one unit's month is expected to do to its silver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UnitSilver {
    pub unit_id: String,
    pub region_id: String,
    /// Silver the unit holds now, from its `SILV` item. Always known.
    pub held: i64,
    /// What this month's orders are expected to earn. `None` when a term could not be priced.
    pub income: Option<i64>,
    /// The part of `income` that arrives in the turn's last phase - wages, takings from
    /// entertaining, and the Phantasmal Entertainment cast - and so can pay maintenance but
    /// nothing this month's orders spend.
    ///
    /// Always `Some` where `income` is: it is a subset of the same sum, computed in the same pass.
    pub late_income: Option<i64>,
    /// What this month's orders are expected to spend. `None` when a term could not be priced.
    pub expense: Option<i64>,
    /// `held + income - expense`, or `None` when either side is `None`.
    ///
    /// **Never includes `upkeep`**, deliberately: whether maintenance counts toward the figure a
    /// player sees is a setting (`ah-1wcw.4`), and computing both answers here means toggling it
    /// needs no round trip through the core.
    pub at_month_end: Option<i64>,
    /// What this unit's orders spend that no silver reaching it *in time* can cover.
    ///
    /// `max(0, expense - (held + income - late_income))`. `Some(0)` means its orders are
    /// affordable; anything positive means the game will refuse something, however healthy
    /// `at_month_end` looks. Counted for this unit alone, like every other figure in this column -
    /// the hex's shared purse is the advisory check's business (`ah-1wcw.1`).
    pub short_for_orders: Option<i64>,
    /// Which kind of order the shortfall bites on, for the sentence the hover shows - the first
    /// order in the unit's block that actually moves silver out. A `GIVE` of items and a costless
    /// `CAST` are not spending orders and are never named. `None` when `short_for_orders` is
    /// `Some(0)` or `None`.
    ///
    /// A tag rather than a word: how it is said is the interface's business, and the core has no
    /// opinion about English.
    pub short_on: Option<SilverSpender>,
    /// What this unit owes in maintenance this month, in silver, after any food it will spend on
    /// it. `None` when it cannot be priced - an estimated headcount, or a report that never said
    /// what the unit is made of.
    pub upkeep: Option<i64>,
    /// Why a term could not be priced, for the hover to explain. `None` when nothing was doubted.
    pub doubt: Option<SilverDoubt>,
    /// What the doubt is *about*, where its sentence names something - the goods of an
    /// unidentifiable `SELL`, as the order itself wrote them. `None` for every other doubt.
    pub doubt_subject: Option<String>,
    /// Silver counted into `income` because other units in this hex are ordered to give it.
    pub received: i64,
    /// Those givers, as `<name> (<id>)`, so the hover can name them.
    pub givers: Vec<String>,
    /// Silver that faction food held by *other* units in this hex paid off, at step 2 of the
    /// payment order (`ah-7cdt`). `0` for every unit the pool did not feed, which is most of them.
    pub faction_food_covered: i64,
    /// Silver of this unit's upkeep paid by other own units in the same hex, at step 4 of the
    /// payment order. `0` for every unit its neighbours did not feed - and `0`, deliberately, for
    /// every unit in a hex whose sharing fell short, where which unit was fed cannot be told and
    /// the figure stays pessimistic (`ah-e66j`).
    ///
    /// Automatic and unconditional: the `SHARE` flag governs discretionary spending only, so this
    /// is not the same thing as the `sharing` pool `report_shortfalls` uses.
    pub shared_silver_covered: i64,
    /// Silver of this unit's upkeep paid by food it holds itself, at step 1 of the payment order.
    /// `0` when the unit is not set to consume, holds no food, or owes nothing.
    ///
    /// Carried separately from `faction_food_covered` only so the hover can say which fed it: both
    /// leave `upkeep` at the same number, and a zero there reads as a defect until something says
    /// why (`ah-7cdt`, `ah-p9z5`).
    pub own_food_covered: i64,
    /// Food of this unit's own that step 5 makes it eat because its silver ran out, in items.
    ///
    /// Distinct from `own_food_covered`'s step-1 food, which the `CONSUME` flag *chose*: this is
    /// stock the game takes as a last resort, and the hover says so in a different sentence
    /// (`ah-eacd`). Its silver value is inside `own_food_covered` like any other food payment.
    pub forced_own_food: i64,
    /// That food's item tag, when this unit's larder holds one kind of food and only one. `None`
    /// when it holds several: which items the engine eats then cannot be told, so the hover counts
    /// them instead of naming them (`ah-eacd`).
    pub forced_own_food_tag: Option<String>,
    /// Faction food in this hex that step 6 eats on this unit's behalf, in items. Counted and never
    /// named: the pool is other units' inventory, and which items it gives up is not this unit's to
    /// say. Its silver value is inside `faction_food_covered`.
    pub forced_faction_food: i64,
    /// Whether a remaining pool too small to feed every claimant might have fed this unit at step
    /// 6. Suppresses the not-enough-silver warning and drives the hover's note, and **never changes
    /// a figure**: the `upkeep` on show is what step 5 left, pessimistically (`ah-eacd`).
    pub food_contended: bool,
    /// Silver of this unit's upkeep paid by the faction's unclaimed fund, at step 7 of the payment
    /// order. `0` for every unit the fund did not reach - which is every unit whenever the fund
    /// cannot reach them all, because then which one it fed cannot be told.
    ///
    /// Carried separately from the two food figures only so the hover can say which paid: all
    /// three leave `upkeep` at the same number, and a zero there reads as a defect until something
    /// says why (`ah-fjty`).
    pub unclaimed_covered: i64,
    /// Whether this unit owes maintenance it cannot pay and the faction's unclaimed fund cannot
    /// reach every unit in that position. Drives the hover's note and **never changes a figure**:
    /// the `upkeep` on show is this unit's whole remaining fee, pessimistically (`ah-fjty`).
    pub unclaimed_contended: bool,
    /// Silver this unit is ordered to give to nobody - `GIVE 0 ... SILV`, which destroys it. Part
    /// of `expense` like any other gift; carried separately only so the hover can say so.
    pub given_to_nobody: i64,
    /// Whether this unit is ordered to withdraw anything. The withdrawal costs the unit nothing -
    /// the faction's unclaimed fund pays (`ah-tdsi`) - so an `Out` of zero on a unit ordered to
    /// withdraw $369 of grain reads as a defect until the hover says why. Carried as a flag rather
    /// than a sum because the sum is not this unit's to show and may not be priceable at all.
    pub withdrawing: bool,
    /// How many of the item its `PRODUCE` order names this unit will make. `0` for a unit with no
    /// such order, and for one whose men cannot make even one (`ah-19l2.2`).
    pub produced: i64,
    /// The item's name, as the ruleset or the report calls it, for the hover to say. `None` only
    /// when the unit has no priceable `PRODUCE` order at all - **not** when a cap leaves it making
    /// none. Unit 12881 `Carpenters` in the committed turn holds no silver of its own and so makes
    /// zero of the two catapults its men could, and that is precisely the case the hover exists to
    /// speak about; nulling the name there would silence it.
    ///
    /// A name and not a tag, unlike every other `*_tag` field here, and deliberately: the unit
    /// does not hold the thing yet, so the interface cannot look its name up in the unit's own
    /// items the way `ah-eacd`'s `nameOfHeldItem` does - it would render `CATP`.
    pub produced_name: Option<String>,
    /// How many its men alone would have made. Equal to `produced` unless `production_capped_by`
    /// says something stopped it.
    pub production_wanted: i64,
    /// What stopped it making `production_wanted`, or `None` when nothing did. Drives the hover's
    /// note and nothing else - the figures above are already the capped ones (`ah-19l2.2`).
    pub production_capped_by: Option<ProductionCap>,
    /// Whether this unit has no month-long order and will therefore be set to work, earning the
    /// region's wage. `false` for every unit that spends its month on something (`ah-gjq4`).
    ///
    /// Carried so the hover can say where the silver came from: income arriving from an order
    /// nobody wrote reads as a defect until something says why - the same reason
    /// `own_food_covered` and `unclaimed_covered` are carried.
    pub works_by_default: bool,
    /// Whether this unit's tax income comes from its taxing flag rather than from a `TAX` order in
    /// this month's orders. Drives the hover's note and nothing else: the income is the same either
    /// way (`ah-fvzu`).
    ///
    /// `false` for a unit that also carries an explicit `TAX`, which has an order on screen that
    /// explains itself.
    pub taxes_by_flag: bool,
}

/// The kind of order a shortfall bites on, so the hover can name it (`ah-uwa3`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum SilverSpender {
    Buy,
    /// `PRODUCE` of something whose recipe costs silver (`ah-19l2.2`).
    Produce,
    Cast,
    Study,
    Give,
}

/// What one order does to a unit's silver this month, before either surface decides what to do
/// about it.
///
/// The two surfaces differ in how they *react* - the column shows a reason, the ledger stops
/// trusting the unit's sums - but never in the number. Adding a field here is how a new order kind
/// joins the seam (`ah-lu0f`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Priced {
    /// Silver the order earns. Never negative.
    pub earns: i64,
    /// Why it could not be priced, or `None`. A doubt and a non-zero `earns` never occur together.
    pub doubt: Option<SilverDoubt>,
}

/// Why a unit's month could not be priced. One variant per sentence the interface shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum SilverDoubt {
    /// `TAX` where the report stated no tax base for the region.
    UnknownTaxBase,
    /// A headcount that is itself a guess, so nothing per-man can be multiplied out.
    EstimatedMen,
    /// `STUDY` of a skill the ruleset prices nowhere, or no ruleset at all.
    UnpricedSkill,
    /// `SELL` of goods nothing in the report or the catalogue could identify. Not the same as
    /// goods the market does not want, which earn nothing and are not doubted: we do not know
    /// *what* is being sold, so we cannot say the market has no line for it.
    UnknownGoods,
    /// `BUY` of goods this region's `For Sale` list does not carry, so the purchase has no price.
    MarketDoesNotSell,
    /// `GIVE` of a whole class of goods, or of the unit itself: what leaves depends on classifying
    /// everything the unit holds, which is not modelled.
    GivesAWholeClass,
    /// `PRODUCE` of something the ruleset prices nowhere - an unknown item, an item no skill
    /// makes, a recipe stating alternatives rather than requirements, or no ruleset at all.
    UnpricedProduction,
    /// More units are set to eat the hex's faction food than that food can feed, so which of them
    /// eats - and therefore what each pays - cannot be determined.
    ContestedFactionFood,
    /// A regional pool this unit draws on is contended by a faction-mate whose headcount is itself
    /// a guess, so no unit's share of it can be worked out - including this one's, whose own count
    /// is exact. Distinct from [`SilverDoubt::EstimatedMen`], which is about the unit's own
    /// headcount.
    ContestedRegionPool,
}

/// What one unit may draw from one contended regional pool, once its faction-mates in the same hex
/// have been settled against it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PoolShare {
    /// Nothing to settle: this unit is the only one in the hex wanting the pool, or the region
    /// states no pool at all. The arithmetic falls back to [`RegionWages`] and behaves exactly as
    /// it does without contention.
    #[default]
    Uncontended,
    /// What [`split_pool`] gave this unit.
    Share(i64),
    /// The hex cannot be settled: some unit contending for this pool has a headcount that is
    /// itself a guess, so no unit's share is a number - including units whose own count is exact.
    Unknowable,
}

/// Which of a region's contended pools an order draws on.
///
/// One variant per pool the settlement divides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContendedPool {
    /// The region's tax base (`ah-t2pn.1`).
    Tax,
    /// The region's wage pool (`ah-t2pn.2`).
    Wages,
    /// What the region pays entertainers (`ah-t2pn.2`).
    Entertainment,
    /// One market line (`ah-t2pn.3`). It carries the goods and the side, because a hex has one
    /// such pool per item per side - the `Wanted` and `For Sale` lists are two different pools.
    Market { tag: String, side: MarketSide },
}

/// One pool that the hex's own units asked more of than it holds.
///
/// Produced by the settlement rather than recomputed by the check that reports it, so the sentence
/// a player reads and the shares their Silver column shows can never disagree about what was asked
/// for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolOverrun {
    pub pool: ContendedPool,
    /// What the hex's own units asked for between them, before any split.
    pub wanted: i64,
    /// What the pool holds.
    pub available: i64,
    /// Indices into `hex.units` of the units that asked, in `hex.units` order.
    pub claimants: Vec<usize>,
}

/// What one unit may draw from each of its region's contended pools.
///
/// One field per pool. `ah-t2pn.2` adds wages and entertainment, `ah-t2pn.3` the market
/// quantities; each is [`PoolShare::Uncontended`] until its own bead lands, which is exactly the
/// behaviour before any of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PoolShares {
    pub tax: PoolShare,
    /// This unit's share of the region's wage pool - the `Max:` figure on its `Wages:` line.
    pub wages: PoolShare,
    /// This unit's share of the region's entertainment demand.
    pub entertainment: PoolShare,
}

/// What one unit's orders ask of each of its region's contended pools, before any settlement.
///
/// The single place each want is derived, so [`late_income`] and the settlement in
/// `super::semantics` cannot disagree about what a unit asked for. A unit not ordered to draw on a
/// pool wants `0`, and a zero want is not a claim on it.
///
/// Counted once per unit however many times its block repeats an order: the pools are settled
/// against headcounts, and a block that says `WORK` twice has no more men for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PoolWants {
    pub tax: i64,
    pub wages: i64,
    pub entertainment: i64,
}

/// What this unit asks of each of its region's contended pools.
#[must_use]
pub fn pool_wants(facts: &UnitFacts<'_>, region: RegionWages) -> PoolWants {
    let mut wants = PoolWants::default();
    // A unit-level term, like the tax term in [`forecast_unit`]: a unit taxes by its flag with no
    // `TAX` order at all, and a flagged taxer contends for the region's base like any other - or
    // every other taxer's share comes out too large (`ah-fvzu`, `ah-t2pn.1`).
    if taxes(facts.flags, facts.intents) {
        wants.tax = facts.men.saturating_mul(TAX_PER_MAN);
    }
    for placed in facts.intents {
        match &placed.intent {
            Intent::Tax => {}
            Intent::Work => {
                wants.wages = facts.men.saturating_mul(region.wage_centis.unwrap_or(0)) / 100;
            }
            Intent::Entertain => {
                wants.entertainment = facts
                    .men
                    .saturating_mul(skill_level(facts.skills, ENTERTAIN_TAG))
                    .saturating_mul(ENTERTAIN_PER_MAN_PER_LEVEL);
            }
            _ => {}
        }
    }
    // A unit that spends its month on nothing is set to work, so it contends for the region's wage
    // pool exactly as an explicit `WORK` does (`ah-gjq4`, landing after `ah-t2pn.2`). Without this
    // every idle unit in a hex would be promised the whole pool.
    if is_set_to_work(facts.flags, facts.intents) {
        wants.wages = facts.men.saturating_mul(region.wage_centis.unwrap_or(0)) / 100;
    }
    wants
}

/// What this hex's market says about goods a unit is ordered to buy.
///
/// The mirror of [`SaleAnswer`], and shorter: a market that does not sell the goods cannot price
/// the purchase at all, so there is only one kind of no.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PurchaseAnswer {
    /// The market sells the goods: what each costs, and how many it has.
    ForSale { price: i64, market_has: i64 },
    /// This market has no `For Sale` line for the goods, named as well as anything could name
    /// them - the catalogue's name where there is one, the order's own text otherwise.
    NotSold { name: String },
}

/// Which side of the market an order is on, for [`Lookups::market_share`]. Buying and selling the
/// same goods draw on two separate pools - the `For Sale` and `Wanted` lines - so the side is part
/// of the question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MarketSide {
    Buying,
    Selling,
}

/// What [`forecast_unit`] must ask [`super::semantics`] rather than derive itself.
///
/// Resolving an item name against the catalogue and the hex's inventories is that module's
/// business, so the arithmetic here is handed closures rather than re-deriving any of it.
#[derive(Clone, Copy)]
pub struct Lookups<'a> {
    /// What the hex's `Wanted` list says about goods a `SELL` names.
    pub sale: &'a dyn Fn(&str) -> SaleAnswer,
    /// What the hex's `For Sale` list says about goods a `BUY` names.
    pub purchase: &'a dyn Fn(&str) -> PurchaseAnswer,
    /// The canonical tag for an item an order names, or `None` for one nothing could identify.
    pub item_tag: &'a dyn Fn(&str) -> Option<String>,
    /// The catalogue's name for a tag, for the one figure the interface cannot name itself: what
    /// a unit is about to produce is not yet in its inventory (`ah-19l2.2`).
    pub item_name: &'a dyn Fn(&str) -> String,
    /// How much of the goods an order names this unit may trade, once its faction-mates in the
    /// same hex have been settled against it (`ah-t2pn.3`).
    ///
    /// `None` means nothing was settled - the goods are not traded here, nothing could identify
    /// them, or the hex could not be settled at all - and the arm falls back to what the market
    /// line itself says, which is the behaviour before this bead.
    pub market_share: &'a dyn Fn(&str, MarketSide) -> Option<i64>,
}

/// What this hex's market says about goods a unit is ordered to sell.
///
/// Lifted out of [`super::semantics`] so this module stays arithmetic over values. The two kinds
/// of no are kept apart on purpose: one earns nothing, the other cannot be priced at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaleAnswer {
    /// The market wants the goods: what it pays each, the most it will take, and what the unit
    /// actually holds of them.
    Wanted {
        price: i64,
        market_takes: i64,
        unit_holds: i64,
    },
    /// The goods were identified and this market has no `wanted` line for them, so the sale earns
    /// nothing. Not a doubt: the order really will earn nothing.
    NotWanted,
    /// Nothing could say what the goods are.
    Unknown,
}

/// Silver this unit is given by others this month.
///
/// Gathered once per turn by [`super::semantics::review_turn`] rather than per unit: the giving
/// orders live all over the document, and re-scanning it per unit would be quadratic in the size
/// of a faction. A gift this pass cannot count - from another hex, from a foreign unit, or of an
/// `ALL` amount whose giver it cannot price - is silently absent rather than doubted, which
/// understates income and never overstates it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Receipts {
    /// Silver given by units whose orders we can read and whose hex matches. Already summed.
    pub silver: i64,
    /// The givers, as `<name> (<id>)`, for the hover to name them. In document order.
    pub givers: Vec<String>,
}

/// Everything about one unit that the arithmetic needs, so the call site reads as a description of
/// the unit rather than as eleven positional arguments.
#[derive(Debug, Clone, Copy)]
pub struct UnitFacts<'a> {
    pub unit_id: &'a str,
    pub region_id: &'a str,
    /// Silver the unit holds now. 0 for a unit carrying no `SILV` item.
    pub held: i64,
    pub men: i64,
    pub men_estimated: bool,
    /// The unit's people by race, which is what tells a leader from an ordinary character. Empty
    /// where the report did not break the unit down, which means *all ordinary characters* - the
    /// report saying nothing is not evidence of leaders.
    pub men_by_race: &'a [ItemAmount],
    /// Everything the unit carries, read here only for the food that pays maintenance.
    pub items: &'a [ItemAmount],
    /// The unit's report flags, read here only for the two `consuming ...` ones.
    pub flags: &'a [String],
    /// The unit's own skills, which price entertaining and Phantasmal Entertainment.
    pub skills: &'a [Skill],
    pub intents: &'a [PlacedIntent],
    pub receipts: &'a Receipts,
}

/// Everything about the region that the arithmetic needs, lifted out so the function takes values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RegionWages {
    pub tax_base: Option<i64>,
    /// The region's wage rate in hundredths of a silver, parsed from `ReportRegion::wages`.
    pub wage_centis: Option<i64>,
    pub max_wages: Option<i64>,
    /// The region's whole entertainment demand, contended by every faction exactly as `max_wages`
    /// is. `None` means the region prints no `Entertainment available` line and pays entertainers
    /// nothing, the same reading `WORK` gives a region with no wage.
    pub entertainment: Option<i64>,
    /// Whether an own unit in this hex is ordered to pillage it, which empties the tax base before
    /// any `TAX` order reaches it (`ah-cxxa`). This is not a property of the region as the report
    /// prints it; it is a property of the orders being written against it. It belongs here anyway,
    /// because it is exactly what the `TAX` arm needs and nothing else in this module has a view
    /// of the hex.
    pub pillaged: bool,
    /// Combat ready men this faction has in the hex, summed over its own units - or `None` when a
    /// headcount in the hex is a guess, or there is no ruleset to read weapons from.
    ///
    /// Like `pillaged` above, this is not a property of the region as the report prints it. It
    /// belongs here for the same reason that field does: it is exactly what the `PILLAGE` arm
    /// needs, and nothing else in this module has a view of the hex (`ah-1ad6.2`).
    pub combat_ready: Option<i64>,
}

/// What the faction holds that any of its units may draw on.
///
/// Faction-wide, unlike [`RegionWages`]: one purse for the whole report, not one per hex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FactionPurse {
    /// `Unclaimed silver: $N` from the report header, or `None` where the report does not say.
    pub unclaimed: Option<i64>,
}

/// The wage rate the report prints, as hundredths of a silver.
///
/// `ReportRegion::wages` is a *string* the parser stores verbatim - `"$24.1"`, `"$0"`, `"$12.0"` -
/// so it has to be read here rather than used. Hundredths rather than a float because the forecast
/// is compared against zero to decide whether a cell is red, and a float makes that comparison
/// depend on rounding.
///
/// Returns `None` for anything it cannot read, which the caller treats as "this region pays no
/// wages" rather than as doubt: a region with no wages line genuinely pays none.
#[must_use]
pub fn parse_wage_centis(wages: Option<&str>) -> Option<i64> {
    let text = wages?.trim().trim_start_matches('$').trim();
    if text.is_empty() {
        return None;
    }

    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (text, ""),
    };

    let whole: i64 = whole.parse().ok()?;
    if whole < 0 {
        return None;
    }

    // A report prints at most one decimal place, but read two so a `$24.15` would not silently
    // become 24.1 - anything longer, or anything that is not a digit, is not a wage line.
    let centis = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 10,
        2 => fraction.parse::<i64>().ok()?,
        _ => return None,
    };
    if fraction
        .chars()
        .any(|character| !character.is_ascii_digit())
    {
        return None;
    }

    Some(whole.saturating_mul(100).saturating_add(centis))
}

/// What a unit's orders earn it in the turn's last phase - wages and entertaining.
///
/// The one place that decides which earnings arrive too late to be spent. [`forecast_unit`] and
/// `semantics::charge_upkeep` both read it, because two copies of this rule is exactly the drift
/// that `ah-uwa3` was filed to remove.
///
/// **This is already `ah-lu0f`'s shared pricing seam for `WORK` and `ENTERTAIN`**, alongside
/// [`price_tax`] and [`price_pillage`]: the empty `Intent::Work | Intent::Entertain => {}` arms in
/// [`forecast_unit`] and in `semantics::apply` are that sharing rather than an omission, and
/// neither order needs moving onto anything.
///
/// **Neither earning spell is here**, and that is not an omission: `CAST` resolves before every
/// spend order, so a mage's takings can fund the same month's `BUY` (`ah-e77q`, correcting
/// `ah-uwa3`'s classification of Phantasmal Entertainment). [`forecast_unit`] prices both - which
/// is also why this no longer needs the ruleset: nothing late is recognised by a catalogue tag.
///
/// `shares` is what this unit may draw from each pool once its faction-mates in the same hex have
/// been settled against it (`ah-t2pn`). It is a parameter rather than something derived here
/// because the settlement needs the whole hex, and this function is deliberately per unit and
/// pure - and because [`forecast_unit`] and `semantics::charge_upkeep` must be handed **the same**
/// shares, for the reason this function exists at all.
#[must_use]
pub fn late_income(facts: &UnitFacts<'_>, region: RegionWages, shares: PoolShares) -> i64 {
    let wants = pool_wants(facts, region);
    let mut late = 0i64;
    let mut worked = false;
    let mut entertained = false;
    for placed in facts.intents {
        match &placed.intent {
            // Each pool is drawn once however many times the block repeats the order: the
            // settlement counted this unit's men once, so adding the share per line would promise
            // the region's pool twice over - the very thing the split exists to stop.
            Intent::Work if !worked => {
                worked = true;
                late = late.saturating_add(match shares.wages {
                    PoolShare::Uncontended => wants.wages.min(region.max_wages.unwrap_or(i64::MAX)),
                    PoolShare::Share(share) => share,
                    // Nowhere to put a doubt: this returns a plain number, and `forecast_unit`
                    // raises `ContestedRegionPool` separately. Zero is the pessimistic direction,
                    // and `semantics::charge_upkeep` - which has no doubt to raise at all - wants
                    // exactly that: the full fee charged against no wages.
                    PoolShare::Unknowable => 0,
                });
            }
            Intent::Entertain if !entertained => {
                entertained = true;
                late = late.saturating_add(match shares.entertainment {
                    PoolShare::Uncontended => {
                        wants.entertainment.min(region.entertainment.unwrap_or(0))
                    }
                    PoolShare::Share(share) => share,
                    PoolShare::Unknowable => 0,
                });
            }
            _ => {}
        }
    }
    // A unit that spends its month on nothing is set to work, and work pays the region's wage
    // exactly as an explicit `WORK` does (`ah-gjq4`). Priced here rather than beside the explicit
    // arm so it is unmistakably a default and not a second `Intent::Work`, and priced through this
    // function so `semantics::charge_upkeep` sees it too - wages arrive in the turn's last phase,
    // which is why they pay upkeep and cannot fund this month's orders.
    if is_set_to_work(facts.flags, facts.intents) {
        late = late.saturating_add(match shares.wages {
            PoolShare::Uncontended => wants.wages.min(region.max_wages.unwrap_or(i64::MAX)),
            PoolShare::Share(share) => share,
            PoolShare::Unknowable => 0,
        });
    }
    late
}

/// What one unit's month does to its silver.
///
/// `facts.intents` is the unit's orders exactly as [`super::semantics`] already holds them, so the
/// slice is passed straight through with no clone on a path that runs per keystroke.
///
/// `sale` answers what the hex's market says about goods the unit is ordered to sell. It is a
/// closure rather than a value because the answer depends on the item each `SELL` names, and
/// resolving an item name is [`super::semantics`]'s business - this module must not re-derive it.
///
/// `income` and `expense` are doubted independently, so the hover can show `?` against the side
/// that is actually unknown; `at_month_end` is `None` when either is. When more than one term is
/// doubted, `doubt` reports the first match in order of increasing scope - [`SilverDoubt::EstimatedMen`]
/// first, which short-circuits, because nothing per-man can be multiplied out.
#[must_use]
pub fn forecast_unit(
    facts: UnitFacts<'_>,
    region: RegionWages,
    shares: PoolShares,
    purse: FactionPurse,
    lookups: Lookups<'_>,
    ruleset: Option<&Ruleset>,
) -> UnitSilver {
    let sale = lookups.sale;
    let own_food = own_food_pass(&facts);
    // Kept before the destructure below, which does not name the field.
    let unit_flags = facts.flags;
    let upkeep = own_food.as_ref().map(|pass| pass.owed_after_own_food);
    let own_food_covered = own_food.as_ref().map_or(0, |pass| pass.own_food_covered);
    let UnitFacts {
        unit_id,
        region_id,
        held,
        men,
        men_estimated,
        intents,
        receipts,
        ..
    } = facts;

    // A headcount that is a guess cannot multiply anything out, so it short-circuits both sides
    // before any rule below is read - exactly as `semantics::study` refuses to price one.
    if men_estimated
        && (intents.iter().any(moves_silver_per_man) || is_set_to_work(unit_flags, intents))
    {
        return UnitSilver {
            unit_id: unit_id.to_string(),
            region_id: region_id.to_string(),
            held,
            income: None,
            late_income: None,
            expense: None,
            at_month_end: None,
            short_for_orders: None,
            short_on: None,
            upkeep,
            doubt: Some(SilverDoubt::EstimatedMen),
            doubt_subject: None,
            received: 0,
            givers: Vec::new(),
            faction_food_covered: 0,
            shared_silver_covered: 0,
            own_food_covered: 0,
            forced_own_food: 0,
            forced_own_food_tag: None,
            forced_faction_food: 0,
            food_contended: false,
            unclaimed_covered: 0,
            unclaimed_contended: false,
            given_to_nobody: 0,
            withdrawing: false,
            produced: 0,
            produced_name: None,
            production_wanted: 0,
            production_capped_by: None,
            works_by_default: is_set_to_work(unit_flags, intents),
            taxes_by_flag: false,
        };
    }

    // A gift is in the giver's block, so it arrives already gathered. It is income whatever the
    // unit itself is ordered to do, including nothing.
    let mut income = receipts.silver;
    let mut expense = 0i64;
    let mut income_doubt = None;
    let mut expense_doubt = None;
    let mut doubt_subject = None;
    let mut given_to_nobody = 0i64;
    let mut withdrawing = false;
    // The first order in the block that actually moves silver out, which is what the hover names.
    // Recorded where `expense` grows rather than read off the intents: a `GIVE` of items and a
    // costless `CAST` are orders, but they spend nothing, and naming one of those would point the
    // reader at an order the game will not refuse. A deferred `BUY ALL` or `GIVE ALL SILV` is
    // considered only if no direct spender was found, since it spends what the others leave.
    let mut spent_on: Option<SilverSpender> = None;
    // What a `PRODUCE` order will make, for the four fields the hover reads. Filled by the arm
    // below; a unit with no such order leaves it at nothing.
    let mut production: Option<(String, ProductionPlan)> = None;
    // `BUY ALL` and `GIVE ... ALL SILV` spend what is left after every other term, so they cannot
    // be priced inside this pass. Collected in document order and applied below.
    let mut deferred: Vec<Deferred> = Vec::new();

    // Whether this unit taxes at all is a property of the unit, not of one line in its block: the
    // taxing flag makes it tax every turn with no `TAX` order, and a unit with both the flag and an
    // order taxes once (`ah-fvzu`). Computed here, before the intent loop, so there is exactly one
    // tax term - two computations of one number is how this column and the warning drifted apart
    // before (`ah-abwx`, and the reason `ah-ycuj`'s corpus test exists).
    //
    // Placing it before the loop makes a tax doubt win over a later order's, whichever line the
    // player typed first. Deliberate, and tested.
    if taxes(unit_flags, intents) {
        // The settlement is what the column shows: this unit's actual take once its faction-mates
        // in the hex are settled against it. `semantics::credit_tax` passes `Uncontended` instead,
        // and that difference is deliberate - see [`price_tax`].
        let priced = price_tax(men, region.tax_base, region.pillaged, shares.tax);
        income = income.saturating_add(priced.earns);
        income_doubt = income_doubt.or(priced.doubt);
    }

    for placed in intents {
        match &placed.intent {
            Intent::Claim(amount) => {
                // Capped at what the faction actually holds, and never divided between units that
                // claim in the same turn - unlike the regional pools, which `ah-t2pn` settles
                // between own units. The purse is faction-wide and `ah-bumi` settled it
                // deliberately the other way; `claims-exceed-unclaimed` (`ah-wur4`) is what carries
                // the overrun. A purse the report does not state leaves only the limit unknown, not
                // the amount, so the stated figure is counted and nothing is doubted.
                income = income.saturating_add(match purse.unclaimed {
                    Some(available) => (*amount).min(available),
                    None => *amount,
                });
            }
            // Priced once above, as a unit-level term rather than per line: a unit may tax by
            // its flag with no `TAX` order at all, and one with both must be counted once
            // (`ah-fvzu`).
            Intent::Tax => {}
            // "The amount of money collected is equal to twice the available tax money." Mirrors
            // `semantics::apply`'s own arm exactly, down to the doubt: two surfaces reading one
            // order must not price it two ways (`ah-abwx`, and the reason `ah-ycuj` exists).
            //
            // "This requires the faction to have enough combat ready men in the region to tax half
            // of the available money in the region" - so a faction short of the threshold earns
            // nothing at all from the order (`ah-1ad6.2`).
            Intent::Pillage => {
                let priced = price_pillage(region.tax_base, region.combat_ready);
                income = income.saturating_add(priced.earns);
                income_doubt = income_doubt.or(priced.doubt);
            }
            // `WORK` and `ENTERTAIN` earn nothing but late income, so [`late_income`] prices them
            // both - once, for this function and for `semantics::charge_upkeep` alike.
            Intent::Work | Intent::Entertain => {}
            Intent::Sell { item, amount } => match sale(item) {
                SaleAnswer::Wanted {
                    price,
                    market_takes,
                    unit_holds,
                } => {
                    let asked = match amount {
                        Amount::Exact(count) => *count,
                        Amount::All { except } => (unit_holds - except).max(0),
                    };
                    // What this hex's other own sellers left of the line, or the line itself
                    // where nothing was settled (`ah-t2pn.3`).
                    let allowed =
                        (lookups.market_share)(item, MarketSide::Selling).unwrap_or(market_takes);
                    let sold = asked.min(allowed).min(unit_holds).max(0);
                    income = income.saturating_add(sold.saturating_mul(price));
                }
                // Goods this market does not want are unsellable, so the order earns nothing. That
                // is the answer rather than a guess, and the shipped `not-traded-here` finding is
                // what tells the player why. See the bead's plan.
                SaleAnswer::NotWanted => {}
                SaleAnswer::Unknown => {
                    if income_doubt.is_none() {
                        income_doubt = Some(SilverDoubt::UnknownGoods);
                        // The order's own text, because by definition nothing resolved it to a
                        // catalogue name - there is no other way to say which goods are meant.
                        doubt_subject = Some(item.to_lowercase());
                    }
                }
            },
            // `PRODUCE` is priced from the recipe the ruleset scraped, through the same
            // `plan_production` the ledger uses - one function, two callers, which is what keeps
            // this column and the `not-enough-silver` warning from drifting apart (`ah-ycuj`).
            Intent::Produce { item } => {
                let recipe = (lookups.item_tag)(item)
                    .and_then(|tag| recipe_for(ruleset, &tag))
                    .and_then(|recipe| {
                        plan_production(recipe, men, facts.items).map(|plan| (recipe, plan))
                    });
                match recipe {
                    Some((recipe, plan)) => {
                        expense = expense.saturating_add(plan.silver);
                        if plan.silver > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Produce));
                        }
                        production = Some(((lookups.item_name)(&recipe.tag), plan));
                    }
                    None => {
                        expense_doubt = expense_doubt.or(Some(SilverDoubt::UnpricedProduction));
                        doubt_subject = doubt_subject.or(Some(item.to_lowercase()));
                    }
                }
            }
            Intent::Study { skill } => {
                let cost = ruleset
                    .and_then(|ruleset| ruleset.find_skill(skill))
                    .and_then(|skill| skill.cost);
                match cost {
                    Some(cost) => {
                        let charged = cost.saturating_mul(men);
                        expense = expense.saturating_add(charged);
                        if charged > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Study));
                        }
                    }
                    None => expense_doubt = expense_doubt.or(Some(SilverDoubt::UnpricedSkill)),
                }
            }
            Intent::Cast { spell, .. } => {
                // Resolved once: this runs per keystroke, and `find_skill` walks the catalogue.
                let spell = ruleset.and_then(|ruleset| ruleset.find_skill(spell));

                match spell.map(|skill| skill.tag.to_ascii_uppercase()) {
                    // Both earning spells arrive in time to be spent: `CAST` resolves before every
                    // spend order, so neither is [`late_income`]'s business. What each cast
                    // *costs* is still charged below - the arm earns and falls through.
                    Some(tag) if tag == PHANTASMAL_TAG => {
                        let earned = skill_level(facts.skills, PHANTASMAL_TAG)
                            .saturating_mul(PHANTASMAL_PER_LEVEL);
                        income =
                            income.saturating_add(earned.min(region.entertainment.unwrap_or(0)));
                    }
                    Some(tag) if tag == EARTH_LORE_TAG => {
                        // W is the region's wage, which `RegionWages` carries in hundredths - so
                        // the division by 100 is the same shape `WORK` uses, and floors for the
                        // same reason. Multiplied out before dividing, so a fractional wage is not
                        // lost. A hex that states no wage pays nothing and raises no doubt, again
                        // exactly as `WORK` treats one: the formula multiplies by W, and W is
                        // nothing.
                        let earned = skill_level(facts.skills, EARTH_LORE_TAG)
                            .saturating_mul(EARTH_LORE_PER_LEVEL_PER_WAGE)
                            .saturating_mul(region.wage_centis.unwrap_or(0))
                            / 100;
                        income = income.saturating_add(earned);
                    }
                    // Every other spell earns nothing here; what it *costs* is charged below.
                    _ => {}
                }

                // A cast consumes what the ruleset says it consumes, and only its `SILV` entries
                // move silver: item costs and the whole `transmute` map are another ledger's
                // business. A spell the ruleset does not know, or knows no cost for, costs nothing
                // and doubts nothing - which is the truth about most spells.
                if let Some(cost) = spell.and_then(|skill| skill.cast.as_ref()) {
                    for input in &cost.costs {
                        if input.tag.eq_ignore_ascii_case(SILVER_TAG) && input.amount > 0 {
                            expense = expense.saturating_add(input.amount);
                            spent_on = spent_on.or(Some(SilverSpender::Cast));
                        }
                    }
                }
            }
            Intent::Buy { amount, item } => match (lookups.purchase)(item) {
                PurchaseAnswer::ForSale { price, market_has } => match amount {
                    Amount::Exact(count) => {
                        // The settled figure is already capped by what the market has, so this
                        // also stops a lone unit being charged for goods that do not exist - the
                        // navigator's decision, recorded in the bead's plan (`ah-t2pn.3`).
                        let allowed =
                            (lookups.market_share)(item, MarketSide::Buying).unwrap_or(*count);
                        let charged = (*count).min(allowed).max(0).saturating_mul(price);
                        expense = expense.saturating_add(charged);
                        if charged > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Buy));
                        }
                    }
                    // What a unit can afford depends on everything else this month does, so this
                    // waits for the running total below.
                    // The share is captured here, where the `Lookups` are, rather than in the
                    // deferred pass - which runs after the settlement and knows nothing of it.
                    Amount::All { .. } => deferred.push(Deferred::BuyAll {
                        price,
                        market_has: (lookups.market_share)(item, MarketSide::Buying)
                            .unwrap_or(market_has),
                    }),
                },
                PurchaseAnswer::NotSold { name } => {
                    if expense_doubt.is_none() {
                        expense_doubt = Some(SilverDoubt::MarketDoesNotSell);
                        doubt_subject = doubt_subject.or(Some(name));
                    }
                }
            },
            Intent::Give { to, what, amount } => {
                let tag = match what {
                    Selector::Item(text) => (lookups.item_tag)(text),
                    // A whole class of goods, or the unit itself: what leaves depends on
                    // classifying everything the unit holds, exactly as `semantics::transfer`
                    // declines to model.
                    Selector::Class(_) | Selector::WholeUnit => {
                        expense_doubt = expense_doubt.or(Some(SilverDoubt::GivesAWholeClass));
                        continue;
                    }
                };
                if !tag.is_some_and(|tag| tag.eq_ignore_ascii_case(SILVER_TAG)) {
                    continue;
                }
                let to_nobody = matches!(to, Party::Discard);
                match amount {
                    Amount::Exact(count) => {
                        expense = expense.saturating_add(*count);
                        if *count > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Give));
                        }
                        if to_nobody {
                            given_to_nobody = given_to_nobody.saturating_add(*count);
                        }
                    }
                    Amount::All { except } => deferred.push(Deferred::GiveAllSilver {
                        except: *except,
                        to_nobody,
                    }),
                }
            }
            // WITHDRAW draws on the faction's unclaimed fund, never the unit's own silver, so it is
            // not an expense of this unit's month at all - the fund is `check_claims`'s business
            // (`ah-tdsi`). The count is still reported, so the hover can say why `Out` is zero on a
            // unit ordered to withdraw.
            // A count of zero takes nothing from the fund, so it explains no `Out` and earns no
            // note - the plan's `{ .. }` would have set the flag for `WITHDRAW 0 grain` too.
            Intent::Withdraw { count, .. } => withdrawing = withdrawing || *count > 0,
            _ => {}
        }
    }

    // The two earnings that arrive in the turn's last phase - wages and entertaining - priced in
    // one place so this function and the upkeep charge can never disagree about them (`ah-uwa3`).
    // Neither earning spell is among them any more (`ah-e77q`): both are priced above, in time.
    // A pool this unit draws on may be contended by a faction-mate whose headcount is a guess, so
    // its share is not a number at all. `late_income` returned 0 for it; the figure the column
    // shows must say so rather than quietly understating (`ah-t2pn.2`).
    if is_set_to_work(unit_flags, intents) && shares.wages == PoolShare::Unknowable {
        income_doubt = income_doubt.or(Some(SilverDoubt::ContestedRegionPool));
    }
    for placed in intents {
        match &placed.intent {
            Intent::Work if shares.wages == PoolShare::Unknowable => {
                income_doubt = income_doubt.or(Some(SilverDoubt::ContestedRegionPool));
            }
            Intent::Entertain if shares.entertainment == PoolShare::Unknowable => {
                income_doubt = income_doubt.or(Some(SilverDoubt::ContestedRegionPool));
            }
            _ => {}
        }
    }

    let late = late_income(&facts, region, shares);
    income = income.saturating_add(late);

    // Everything that spends what is *left*, in document order, against a running total that
    // already carries every other term. Skipped where a side is doubted: the total it would spend
    // against is not a number, and the side it feeds is `None` either way.
    if income_doubt.is_none() && expense_doubt.is_none() {
        // What a deferred order can spend is what reaches the unit *in time* - `ah-1wcw.3` settled
        // that `BUY ALL` spends what the unit can afford, and wages it earns this month cannot pay
        // for anything this month's orders buy (`ah-uwa3`).
        let mut running = held
            .saturating_add(income)
            .saturating_sub(late)
            .saturating_sub(expense);
        for spend in &deferred {
            let spent = match spend {
                Deferred::BuyAll { price, market_has } => {
                    if *price <= 0 {
                        0
                    } else {
                        (running / price)
                            .max(0)
                            .min(*market_has)
                            .saturating_mul(*price)
                    }
                }
                Deferred::GiveAllSilver { except, to_nobody } => {
                    let spent = running.saturating_sub(*except).max(0);
                    if *to_nobody {
                        given_to_nobody = given_to_nobody.saturating_add(spent);
                    }
                    spent
                }
            };
            if spent > 0 {
                spent_on = spent_on.or(Some(match spend {
                    Deferred::BuyAll { .. } => SilverSpender::Buy,
                    Deferred::GiveAllSilver { .. } => SilverSpender::Give,
                }));
            }
            expense = expense.saturating_add(spent);
            running = running.saturating_sub(spent);
        }
    }

    let income = income_doubt.is_none().then_some(income);
    let late_income = income.map(|_| late);
    let expense = expense_doubt.is_none().then_some(expense);
    let doubt = income_doubt.or(expense_doubt);
    let at_month_end = match (income, expense) {
        (Some(income), Some(expense)) => Some(held.saturating_add(income).saturating_sub(expense)),
        _ => None,
    };
    let short_for_orders = match (income, expense) {
        (Some(income), Some(expense)) => Some(
            expense
                .saturating_sub(held.saturating_add(income).saturating_sub(late))
                .max(0),
        ),
        _ => None,
    };

    UnitSilver {
        unit_id: unit_id.to_string(),
        region_id: region_id.to_string(),
        held,
        income,
        late_income,
        expense,
        at_month_end,
        short_for_orders,
        short_on: spent_on.filter(|_| short_for_orders.is_some_and(|short| short > 0)),
        upkeep,
        doubt,
        doubt_subject: doubt_subject.filter(|_| {
            matches!(
                doubt,
                Some(SilverDoubt::UnknownGoods)
                    | Some(SilverDoubt::MarketDoesNotSell)
                    | Some(SilverDoubt::UnpricedProduction)
            )
        }),
        received: receipts.silver,
        givers: receipts.givers.clone(),
        faction_food_covered: 0,
        shared_silver_covered: 0,
        own_food_covered,
        forced_own_food: 0,
        forced_own_food_tag: None,
        forced_faction_food: 0,
        food_contended: false,
        unclaimed_covered: 0,
        unclaimed_contended: false,
        given_to_nobody,
        withdrawing,
        produced: production.as_ref().map_or(0, |(_, plan)| plan.made),
        produced_name: production.as_ref().map(|(name, _)| name.clone()),
        production_wanted: production.as_ref().map_or(0, |(_, plan)| plan.wanted),
        production_capped_by: production.as_ref().and_then(|(_, plan)| plan.capped_by),
        works_by_default: is_set_to_work(unit_flags, intents),
        taxes_by_flag: taxes(unit_flags, intents)
            && !intents
                .iter()
                .any(|placed| matches!(placed.intent, Intent::Tax)),
    }
}

/// A term that spends whatever is left after every other one, kept until the running total exists.
#[derive(Debug, Clone, Copy)]
enum Deferred {
    /// `BUY ALL`: as many as the unit can afford, and no more than the market has.
    BuyAll { price: i64, market_has: i64 },
    /// `GIVE ... ALL SILV`, less any `EXCEPT` reserve.
    GiveAllSilver { except: i64, to_nobody: bool },
}

/// What one unit owes in maintenance this month, after any food it will spend on it.
///
/// Charged in full, and the figure may go negative once it is subtracted from a forecast: a unit
/// that cannot pay its own upkeep is exactly what the column exists to show. Maintenance is pooled
/// regionally by the game itself, with no `sharing` flag involved, so a per-unit figure is a little
/// pessimistic - which is why the interface says a unit cannot pay *its own* upkeep rather than
/// claiming anybody starves.
///
/// Models steps 1 and 3 of the rules' payment order - the unit's own food, then its own silver.
/// Everything else in that order is regional or faction-wide, and `ah-1wcw.1` settled that this
/// column counts each unit alone.
///
/// `None` for a headcount that is itself a guess: charge nothing rather than a guess.
#[must_use]
pub fn unit_upkeep(facts: &UnitFacts<'_>) -> Option<i64> {
    own_food_pass(facts).map(|pass| pass.owed_after_own_food)
}

/// What step 1 of the payment order did to one unit: what it still owes, and what food it has left.
struct OwnFoodPass {
    owed_after_own_food: i64,
    spare_food: i64,
    /// What the unit's own food paid off, in silver. Recorded where step 1 actually happens, so
    /// nothing re-derives it from `items` and `SILVER_PER_FOOD` and drifts from this.
    own_food_covered: i64,
}

/// Step 1 of the maintenance payment order - the unit's own food - and what it leaves behind.
///
/// `None` for a headcount that is itself a guess: charge nothing rather than a guess.
fn own_food_pass(facts: &UnitFacts<'_>) -> Option<OwnFoodPass> {
    if facts.men_estimated {
        return None;
    }

    let leaders = facts
        .men_by_race
        .iter()
        .filter(|entry| entry.tag.eq_ignore_ascii_case(LEADER_TAG))
        .map(|entry| entry.amount)
        .sum::<i64>();
    // A unit the report never broke down is all ordinary characters, and a breakdown that names
    // more leaders than men is not a reason to charge a negative headcount.
    let leaders = leaders.clamp(0, facts.men);
    let characters = facts.men - leaders;

    let owed = leaders
        .saturating_mul(UPKEEP_PER_LEADER)
        .saturating_add(characters.saturating_mul(UPKEEP_PER_CHARACTER))
        .max(0);

    let held = facts
        .items
        .iter()
        .filter(|entry| {
            FOOD_TAGS
                .iter()
                .any(|tag| entry.tag.eq_ignore_ascii_case(tag))
        })
        .map(|entry| entry.amount.max(0))
        .sum::<i64>();

    if owed <= 0 || !is_consuming(facts.flags) {
        // Steps 3 before 5: a unit not set to consume spends its silver before its own food, and
        // this column is about silver. Its food is untouched, and so is spare for its faction.
        return Some(OwnFoodPass {
            owed_after_own_food: owed,
            spare_food: held,
            own_food_covered: 0,
        });
    }

    // A fractional maintenance cost still consumes a whole unit of food, so the need rounds up.
    let needed = (owed + SILVER_PER_FOOD - 1) / SILVER_PER_FOOD;
    let used = held.min(needed);
    let covered = used.saturating_mul(SILVER_PER_FOOD).min(owed);

    Some(OwnFoodPass {
        owed_after_own_food: owed - covered,
        spare_food: held - used,
        own_food_covered: covered,
    })
}

/// What one unit brings to, and takes from, its hex's faction-food pool.
///
/// Built after every unit has fed itself at step 1, so `spare_food` is genuinely spare: the same
/// item can never feed its owner and a neighbour.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoodClaim {
    pub unit_id: String,
    /// Food items still held once this unit has paid what it could of its own upkeep.
    pub spare_food: i64,
    /// Upkeep still owed after step 1, in silver.
    pub owed_after_own_food: i64,
    /// Whether the unit carries the `consuming faction's food` flag.
    pub draws_on_pool: bool,
}

/// What one unit brings to, and takes from, the pool, once it has fed itself at step 1.
///
/// A unit whose headcount is a guess brings nothing and claims nothing: what it ate of its own
/// food is unknown, so counting its holding into the pool would overstate what is spare.
#[must_use]
pub fn food_claim(facts: &UnitFacts<'_>) -> FoodClaim {
    let pass = own_food_pass(facts);
    FoodClaim {
        unit_id: facts.unit_id.to_string(),
        spare_food: pass.as_ref().map_or(0, |pass| pass.spare_food),
        owed_after_own_food: pass.as_ref().map_or(0, |pass| pass.owed_after_own_food),
        draws_on_pool: facts
            .flags
            .iter()
            .any(|flag| flag.eq_ignore_ascii_case(CONSUMING_FACTION_FLAG)),
    }
}

/// What step 2 left behind: who it fed, and what the hex's pool still holds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FactionFoodPass {
    /// `Some(0)` for a unit the pool feeds, `Some(n)` for a lone short claimant, `None` for one of
    /// several contending for a pool too small for them all. Absent for a unit that does not draw
    /// on the pool.
    pub settled: BTreeMap<String, Option<i64>>,
    /// Food items the hex still holds once step 2 has run, for steps 5 and 6 to draw on. `None`
    /// when step 2 was contended: what it ate cannot be told, so what is left cannot be either.
    pub pool_left: Option<i64>,
}

/// Step 2 of the maintenance payment order, across one hex.
///
/// Returns the upkeep each unit is left with. `Some(0)` for a unit the pool feeds; `None` for one
/// of *several* contending for a pool too small to feed them all, where which unit eats is
/// genuinely undeterminable and no number is invented. Two cases that look short are not
/// ambiguous at all and are answered exactly: an empty pool, where nobody eats, and a lone
/// claimant, which simply eats every item there is. A unit that does not draw on the pool is
/// absent from the result and keeps whatever step 1 left it.
#[must_use]
pub fn feed_from_faction_food(claims: &[FoodClaim]) -> FactionFoodPass {
    // Every own unit in the hex contributes, drawing on the pool or not: a quartermaster paying its
    // own upkeep in silver still hands its grain to its faction-mates.
    let pool = claims.iter().fold(0i64, |pool, claim| {
        pool.saturating_add(claim.spare_food.max(0))
    });

    let claimants = claims
        .iter()
        .filter(|claim| claim.draws_on_pool && claim.owed_after_own_food > 0);

    let total_needed = claimants.clone().fold(0i64, |total, claim| {
        // A fractional maintenance cost still consumes a whole unit of food, so this rounds up -
        // in integers, never floats, and saturating so an absurd headcount cannot overflow it.
        let needed = claim
            .owed_after_own_food
            .saturating_add(SILVER_PER_FOOD - 1)
            / SILVER_PER_FOOD;
        total.saturating_add(needed)
    });

    // A hex with no food at all is not ambiguous: nobody eats, so every claimant keeps exactly
    // what step 1 left it. `?` is for a pool that holds food but not enough - the case where which
    // unit eats genuinely cannot be told, and the navigator settled it that way on 2026-08-23
    // after the committed turn showed eleven exactly-known figures being doubted by an empty hex.
    if pool == 0 {
        return FactionFoodPass {
            settled: BTreeMap::new(),
            pool_left: Some(0),
        };
    }

    if total_needed <= pool {
        // The pool feeds everybody, and a unit it feeds at all it feeds entirely: one item is
        // worth a whole 50, so a unit owing 60 takes 2 and 2 cover 100.
        return FactionFoodPass {
            settled: claimants
                .map(|claim| (claim.unit_id.clone(), Some(0)))
                .collect(),
            pool_left: Some(pool - total_needed),
        };
    }

    // Short, and contention needs two contenders: a lone claimant eats every item there is and
    // owes the rest, with nothing to decide. Settled with the navigator on 2026-08-23, by the same
    // reasoning that made an empty pool exact.
    if let (Some(only), 1) = (claimants.clone().next(), claimants.clone().count()) {
        let covered = pool
            .saturating_mul(SILVER_PER_FOOD)
            .min(only.owed_after_own_food);
        // A lone claimant eats every item it can use, which is the whole pool unless its debt
        // needs less: `covered` is capped at the debt, but the items it ate are not.
        let needed = only.owed_after_own_food.saturating_add(SILVER_PER_FOOD - 1) / SILVER_PER_FOOD;
        let used = pool.min(needed);
        return FactionFoodPass {
            settled: [(
                only.unit_id.clone(),
                Some(only.owed_after_own_food - covered),
            )]
            .into(),
            pool_left: Some(pool - used),
        };
    }

    // All or nothing among the rest: the rules waste food, so the total genuinely differs by who
    // eats - two units owing 60 and 80 against a pool of 3 total 30 or 10 depending on which one
    // is fed - and there is no correct number to share out.
    FactionFoodPass {
        settled: claimants
            .map(|claim| (claim.unit_id.clone(), None))
            .collect(),
        pool_left: None,
    }
}

/// Splits a contended regional pool between the units that asked for it.
///
/// Returns one share per claim, **index-aligned with `wants`** - not keyed by unit id, for the
/// reason [`feed_from_faction_food`] gives: two units in one hex may carry the same id, and a map
/// would silently merge them.
///
/// When the pool covers every claim, each unit gets exactly what it asked for and nothing is
/// divided. When it does not, each gets `pool * wants[i] / total`, **rounded down** - so the
/// shares never add up to more than the pool, and up to `wants.len() - 1` silver of it goes
/// unpromised. Understating by a few silver is the safe direction for a figure whose negatives a
/// player acts on; the alternative is promising money the region does not have, which is the
/// defect this removes.
///
/// The rules state this split for markets outright ("in proportion to the amount each buyer
/// attempted to buy"). For `TAX` it is the same arithmetic as the rules' own "split evenly among
/// all taxers", read per man: a taxer's ask is `men * 50`, so proportional-to-ask *is*
/// proportional-to-men.
#[must_use]
pub fn split_pool(wants: &[i64], pool: i64) -> Vec<i64> {
    let clamped: Vec<i64> = wants.iter().map(|want| (*want).max(0)).collect();
    let pool = pool.max(0);
    let total: i128 = clamped.iter().map(|want| i128::from(*want)).sum();
    if total <= i128::from(pool) {
        // Nothing is contended, so nothing is divided - which is also what keeps a lone taxer,
        // and every hex the region can afford, reading exactly as it did before.
        return clamped;
    }
    clamped
        .iter()
        .map(|want| i64::try_from(i128::from(pool) * i128::from(*want) / total).unwrap_or(i64::MAX))
        .collect()
}

#[cfg(test)]
mod split_pool_tests {
    use super::*;

    #[test]
    fn a_pool_that_covers_every_claim_divides_nothing() {
        assert_eq!(split_pool(&[500, 1000], 2500), vec![500, 1000]);
    }

    #[test]
    fn a_short_pool_is_divided_in_proportion_to_what_each_asked() {
        let shares = split_pool(&[500, 2500], 2500);
        assert_eq!(shares, vec![416, 2083]);
        assert!(
            shares.iter().sum::<i64>() <= 2500,
            "the pool is never promised twice: {shares:?}"
        );
    }

    /// The behaviour table in the bead's plan, every row of it. The property that matters more
    /// than any single figure is the last assertion: the shares never add up to more than there
    /// is.
    #[test]
    fn a_pool_is_never_promised_twice() {
        let cases: &[(&[i64], i64, Vec<i64>)] = &[
            (&[], 2500, vec![]),
            (&[], 0, vec![]),
            (&[500, 2500], 0, vec![0, 0]),
            (&[500, 2500], -10, vec![0, 0]),
            (&[0, 0], 2500, vec![0, 0]),
            (&[-5, -5], 2500, vec![0, 0]),
            (&[500, 1000], 2500, vec![500, 1000]),
            (&[500, 2500], 2500, vec![416, 2083]),
            (&[2500], 2500, vec![2500]),
            (&[3000], 2500, vec![2500]),
        ];
        for (wants, pool, expected) in cases {
            let shares = split_pool(wants, *pool);
            assert_eq!(&shares, expected, "wants {wants:?} against {pool}");
            assert!(
                shares.iter().sum::<i64>() <= (*pool).max(0),
                "wants {wants:?} against {pool} promised {shares:?}"
            );
        }
    }
}

#[cfg(test)]
mod late_food_tests {
    use super::*;

    fn claim(id: &str, short: i64, own_food: i64, tag: Option<&str>) -> LateFoodClaim {
        LateFoodClaim {
            unit_id: id.to_string(),
            short,
            own_food,
            own_food_tag: tag.map(str::to_string),
        }
    }

    #[test]
    fn a_unit_with_no_flag_eats_its_own_food_when_silver_runs_out() {
        let claims = [claim("a", 60, 2, Some("GRAI"))];
        let relief = feed_after_silver(&claims, Some(2));
        let a = relief.get("a").expect("a is fed");
        assert_eq!(a.own_covered, 60);
        assert_eq!(a.own_items, 2);
        assert_eq!(a.own_tag.as_deref(), Some("GRAI"));
        assert_eq!(a.faction_covered, 0);
        assert!(!a.contended);
    }

    #[test]
    fn food_runs_out_and_the_rest_is_still_owed() {
        let claims = [claim("a", 200, 1, Some("GRAI"))];
        let relief = feed_after_silver(&claims, Some(1));
        let a = relief.get("a").expect("a is fed");
        assert_eq!(a.own_covered, 50);
        assert_eq!(a.own_items, 1);
        assert_eq!(a.faction_covered, 0);
    }

    #[test]
    fn a_unit_that_owes_nothing_eats_nothing() {
        let claims = [claim("a", 0, 3, Some("GRAI"))];
        let relief = feed_after_silver(&claims, Some(3));
        assert!(relief
            .get("a")
            .is_none_or(|r| r == &LateFoodRelief::default()));
    }

    #[test]
    fn the_remaining_pool_feeds_every_claimant_it_can() {
        let claims = [claim("a", 40, 0, None), claim("b", 40, 0, None)];
        let relief = feed_after_silver(&claims, Some(2));
        for id in ["a", "b"] {
            let unit = relief.get(id).expect("fed");
            assert_eq!(unit.faction_covered, 40);
            assert_eq!(unit.faction_items, 1);
            assert!(!unit.contended);
        }
    }

    #[test]
    fn a_lone_claimant_eats_the_whole_remainder() {
        let claims = [claim("a", 200, 0, None)];
        let relief = feed_after_silver(&claims, Some(1));
        let a = relief.get("a").expect("fed");
        assert_eq!(a.faction_covered, 50);
        assert_eq!(a.faction_items, 1);
    }

    #[test]
    fn a_short_remainder_among_several_feeds_nobody_and_warns_nobody() {
        let claims = [claim("a", 60, 0, None), claim("b", 80, 0, None)];
        let relief = feed_after_silver(&claims, Some(1));
        for id in ["a", "b"] {
            let unit = relief.get(id).expect("claimant");
            assert_eq!(unit.faction_covered, 0);
            assert!(unit.contended);
        }
    }

    #[test]
    fn an_empty_remainder_is_not_contention() {
        let claims = [claim("a", 60, 0, None), claim("b", 80, 0, None)];
        let relief = feed_after_silver(&claims, Some(0));
        for id in ["a", "b"] {
            let unit = relief.get(id).cloned().unwrap_or_default();
            assert_eq!(unit.faction_covered, 0);
            assert!(!unit.contended);
        }
    }

    #[test]
    fn a_contended_step_two_leaves_step_six_unable_to_say() {
        let claims = [claim("a", 60, 2, Some("GRAI")), claim("b", 80, 0, None)];
        let relief = feed_after_silver(&claims, None);
        for id in ["a", "b"] {
            let unit = relief.get(id).expect("claimant");
            assert!(unit.contended);
            assert_eq!(unit.own_covered, 0);
            assert_eq!(unit.faction_covered, 0);
        }
    }
}

/// One unit's unpayable maintenance and its remaining larder, for steps 5 and 6.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LateFoodClaim {
    pub unit_id: String,
    /// Maintenance this unit's silver cannot cover, after steps 1-4. Exactly `UpkeepClaim.short`.
    pub short: i64,
    /// Food items this unit still holds itself, after step 1 - `OwnFoodPass::spare_food`.
    pub own_food: i64,
    /// The tag of that food when the unit's larder holds one kind of food and only one; `None`
    /// when it holds several. Decided by the caller, which has the unit's `items`.
    pub own_food_tag: Option<String>,
}

/// What steps 5 and 6 pay for one unit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LateFoodRelief {
    /// Silver of maintenance the unit's own remaining food paid, at step 5. Always exact.
    pub own_covered: i64,
    /// Items of its own it eats to do that.
    pub own_items: i64,
    /// That food's tag, carried through from the claim, when there was one name for it.
    pub own_tag: Option<String>,
    /// Silver the hex's remaining faction food paid, at step 6. `0` when the remainder cannot feed
    /// every claimant - see `contended`.
    pub faction_covered: i64,
    /// Items the pool gives up to do that.
    pub faction_items: i64,
    /// Whether a remaining pool too small to feed every claimant might have fed this unit.
    /// Suppresses the not-enough-silver warning and drives the hover's note; **never changes a
    /// figure** - the same posture `unclaimed_contended` takes at step 7.
    pub contended: bool,
}

/// Steps 5 and 6 of the payment order, across one hex: food pays what silver could not, for every
/// unit, flag or no flag.
///
/// `claims` must be in the hex's document order (`hex.units`), which is what makes the step-5
/// allocation deterministic.
#[must_use]
pub fn feed_after_silver(
    claims: &[LateFoodClaim],
    pool_left: Option<i64>,
) -> BTreeMap<String, LateFoodRelief> {
    let mut relief: BTreeMap<String, LateFoodRelief> = BTreeMap::new();

    // Step 2 was contended, so what it ate cannot be told and neither can what is left. Nothing is
    // claimed and nobody is warned - the pool might yet have fed any of them.
    let Some(pool_left) = pool_left else {
        for claim in claims.iter().filter(|claim| claim.short > 0) {
            relief.insert(
                claim.unit_id.clone(),
                LateFoodRelief {
                    contended: true,
                    ..LateFoodRelief::default()
                },
            );
        }
        return relief;
    };

    let mut remaining = pool_left.max(0);
    let mut owed: BTreeMap<String, i64> = BTreeMap::new();

    // Step 5, in document order. `own_food` is capped by the hex remainder on purpose: step 2's
    // pool is not attributed to owners, so a unit's own spare food may already be gone. The cap can
    // therefore charge a unit for food it still holds - never the reverse, which is the safe
    // direction for a column whose false warnings are the defect this bead removes.
    for claim in claims.iter().filter(|claim| claim.short > 0) {
        let supply = claim.own_food.max(0).min(remaining);
        let needed = claim.short.saturating_add(SILVER_PER_FOOD - 1) / SILVER_PER_FOOD;
        let used = supply.min(needed);
        let own_covered = used.saturating_mul(SILVER_PER_FOOD).min(claim.short);
        remaining -= used;
        owed.insert(claim.unit_id.clone(), claim.short - own_covered);
        relief.insert(
            claim.unit_id.clone(),
            LateFoodRelief {
                own_covered,
                own_items: used,
                own_tag: if used > 0 {
                    claim.own_food_tag.clone()
                } else {
                    None
                },
                ..LateFoodRelief::default()
            },
        );
    }

    // Step 6, over what is left, mirroring `feed_from_faction_food`'s own case analysis.
    let claimants: Vec<(&String, i64)> = claims
        .iter()
        .filter_map(|claim| {
            owed.get(&claim.unit_id)
                .filter(|left| **left > 0)
                .map(|left| (&claim.unit_id, *left))
        })
        .collect();

    let needed_total = claimants.iter().fold(0i64, |total, (_, left)| {
        total.saturating_add(left.saturating_add(SILVER_PER_FOOD - 1) / SILVER_PER_FOOD)
    });

    // An empty remainder is not contention: with nothing left, nobody could have been fed.
    if remaining == 0 || claimants.is_empty() {
        return relief;
    }

    if needed_total <= remaining {
        for (id, left) in claimants {
            let entry = relief.entry(id.clone()).or_default();
            entry.faction_covered = left;
            entry.faction_items = left.saturating_add(SILVER_PER_FOOD - 1) / SILVER_PER_FOOD;
        }
        return relief;
    }

    if let [(id, left)] = claimants.as_slice() {
        // Contention needs two contenders: a lone claimant simply eats every item there is.
        let entry = relief.entry((*id).clone()).or_default();
        entry.faction_items = remaining;
        entry.faction_covered = remaining.saturating_mul(SILVER_PER_FOOD).min(*left);
        return relief;
    }

    for (id, _) in claimants {
        relief.entry(id.clone()).or_default().contended = true;
    }
    relief
}

/// One unit's unpayable maintenance, for the faction-wide settlement of step 7.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpkeepClaim {
    pub unit_id: String,
    /// Silver of this unit's *maintenance* that its own silver cannot cover, after every earlier
    /// step of the payment order has already been applied. Never more than the fee itself: what a
    /// unit overspends on its orders is its orders' fault and no business of the fund's.
    pub short: i64,
}

/// What the faction's unclaimed fund does about the units that cannot pay their maintenance.
///
/// Faction-wide, like the fund itself: one settlement for the whole report, never one per hex.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UpkeepSettlement {
    /// Per unit, the maintenance the fund paid. **Empty unless the fund reaches every claimant** -
    /// when it is short, which unit it fed is undeterminable, so it feeds none of them here.
    pub covered: BTreeMap<String, i64>,
    /// Every unit that owed maintenance it could not pay, whether or not the fund reached it.
    pub claimants: BTreeSet<String>,
    /// What the claimants owed between them.
    pub owed: i64,
    /// What the fund had for them, after this month's `CLAIM` orders took theirs. Never negative.
    pub available: i64,
    /// `owed - available`, floored at zero. `> 0` means the fund could not reach everybody.
    pub short: i64,
}

impl UpkeepSettlement {
    /// Whether the fund is in play at all. `false` leaves every surface exactly as it is today.
    #[must_use]
    pub fn active(&self) -> bool {
        self.available > 0 && self.owed > 0
    }
}

/// Settles step 7 of the maintenance payment order: "If you have silver in your unclaimed fund,
/// then that silver will be automatically claimed by units that would otherwise starve."
///
/// `available` is `None` where the report header states no `Unclaimed silver:` line, and `Some(n)`
/// where it does - already net of this month's `CLAIM` orders.
///
/// `None`, or `Some(n)` with `n <= 0`, returns [`UpkeepSettlement::default()`]: an inactive
/// settlement that changes nothing. That is a decision and not a guard - with no fund, or an
/// emptied one, every unit's shortfall is exactly its own, so today's per-unit message is the
/// right one and keeping it costs a broke faction none of its line-level marks (`ah-fjty`).
#[must_use]
pub fn settle_unclaimed(claims: &[UpkeepClaim], available: Option<i64>) -> UpkeepSettlement {
    let Some(available) = available.filter(|fund| *fund > 0) else {
        return UpkeepSettlement::default();
    };

    // A claim of nothing is not a claim: a unit that pays its own maintenance never draws on the
    // fund, and naming it among the claimants would blame it for a shortfall it takes no part in.
    let claiming = claims.iter().filter(|claim| claim.short > 0);

    let owed = claiming
        .clone()
        .fold(0i64, |owed, claim| owed.saturating_add(claim.short));

    // The fund reaches everybody, so say exactly what it paid each of them. When it cannot, which
    // unit it fed is undeterminable, so it feeds none of them here and every claimant is named
    // instead - the shape `claims-exceed-unclaimed` already uses (`ah-fjty`).
    let covered = if owed <= available {
        claiming
            .clone()
            .map(|claim| (claim.unit_id.clone(), claim.short))
            .collect()
    } else {
        BTreeMap::new()
    };

    UpkeepSettlement {
        covered,
        claimants: claiming.map(|claim| claim.unit_id.clone()).collect(),
        owed,
        available,
        short: (owed - available).max(0),
    }
}

/// Whether the unit is set to avoid combat, by its `avoiding` report flag.
fn is_avoiding(flags: &[String]) -> bool {
    flags
        .iter()
        .any(|flag| flag.eq_ignore_ascii_case("avoiding"))
}

/// How many of one unit's men are combat ready, in the sense `PILLAGE` needs.
///
/// The rules page never defines the phrase - it uses it three times and explains it nowhere - so
/// this is the navigator's reading, settled 2026-08-23 (`ah-1ad6.2`): **a man is combat ready when
/// he has a weapon he can wield**, and a unit set to avoid combat has none who are.
///
/// - `avoiding` in `flags` - zero, whatever the unit holds.
/// - otherwise `min(men, weapons the unit can wield)`, where a weapon needing a skill counts only
///   for a unit that has that skill at level 1 or better.
///
/// `behind` is not consulted: a unit in the back rank still fights.
///
/// `None` when the headcount is estimated - a guessed headcount cannot be compared against a
/// threshold - and when there is no ruleset, since nothing says which items are weapons.
#[must_use]
pub fn combat_ready(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> Option<i64> {
    if facts.men_estimated {
        return None;
    }
    if is_avoiding(facts.flags) {
        return Some(0);
    }
    let ruleset = ruleset?;
    let mut armed = 0i64;
    for held in facts.items {
        let Some(entry) = ruleset.items.get(&held.tag.to_uppercase()) else {
            continue;
        };
        let Some(weapon) = entry.weapon.as_ref() else {
            continue;
        };
        // `needs` is a *skill* tag, not the item's own: `DBOW` is wielded with `LBOW`.
        let wieldable = match weapon.needs.as_deref() {
            None => true,
            Some(skill) => skill_level(facts.skills, skill) >= 1,
        };
        if wieldable {
            armed = armed.saturating_add(held.amount.max(0));
        }
    }
    Some(facts.men.max(0).min(armed))
}

/// What a unit's taxing earns this month: `men * TAX_PER_MAN`, capped.
///
/// **A unit-level term, not a per-line one** - the taxing flag makes a unit tax with no `TAX` order
/// at all, and a unit carrying both taxes once (`ah-fvzu`). Call it once per unit, never inside an
/// intent loop.
///
/// `share` is the caller's policy about a contended regional pool, and it is a parameter precisely
/// because **the two surfaces disagree about it on purpose**:
///
/// - The Silver column passes the `ah-t2pn` settlement (`shares.tax`), because it is showing the
///   player what this unit will actually collect.
/// - The ledger passes [`PoolShare::Uncontended`], because `semantics`' policy is *accept on doubt*:
///   a shortfall is reported only when the unit is short even in the best case, and "no other own
///   unit competes" is that best case. Passing the settlement there would produce a false
///   `not-enough-silver` in every contended tax hex.
///
/// `pillaged` is a certain zero and never a doubt: a pillage empties the hex whatever the base was,
/// so this collects nothing even where the base itself is unknown (`ah-cxxa`). It is tested before
/// `share`, or a hex with no stated base would raise [`SilverDoubt::UnknownTaxBase`], and a
/// contended one [`SilverDoubt::ContestedRegionPool`], where the certain zero is the better answer.
#[must_use]
pub fn price_tax(men: i64, tax_base: Option<i64>, pillaged: bool, share: PoolShare) -> Priced {
    if pillaged {
        return Priced {
            earns: 0,
            doubt: None,
        };
    }
    match share {
        // A unit nobody contends with, exactly as it was before the settlement existed.
        PoolShare::Uncontended => match tax_base {
            Some(base) => Priced {
                earns: men.saturating_mul(TAX_PER_MAN).min(base),
                doubt: None,
            },
            None => Priced {
                earns: 0,
                doubt: Some(SilverDoubt::UnknownTaxBase),
            },
        },
        // Already capped by the settlement, and already no larger than this unit's ask. Drawn
        // once however many times the block says `TAX`, because this term runs once per unit:
        // the settlement counted the unit's men once, so drawing per line would promise the
        // region's pool twice over - the very thing the split exists to stop.
        PoolShare::Share(share) => Priced {
            earns: share,
            doubt: None,
        },
        // Only income is doubted: this unit's own men are known, so what it spends is still
        // exactly priceable - which separates this from `EstimatedMen`.
        PoolShare::Unknowable => Priced {
            earns: 0,
            doubt: Some(SilverDoubt::ContestedRegionPool),
        },
    }
}

/// What a `PILLAGE` earns: twice the region's available tax money, and nothing at all where the
/// faction is short of the combat-ready threshold.
///
/// "The amount of money collected is equal to twice the available tax money", and "this requires
/// the faction to have enough combat ready men in the region to tax half of the available money"
/// (`ah-1ad6.2`). Short of that the order earns a *certain* zero, so the unit is not doubted.
///
/// Both surfaces call this - [`forecast_unit`] and `semantics::apply` - because two surfaces
/// reading one order must not price it two ways (`ah-abwx`, and the reason `ah-ycuj` exists).
#[must_use]
pub fn price_pillage(tax_base: Option<i64>, combat_ready: Option<i64>) -> Priced {
    match (tax_base, combat_ready) {
        // No tax base: what the region holds is unknown before the question of who may take it
        // arises, so the older doubt wins.
        (None, _) => Priced {
            earns: 0,
            doubt: Some(SilverDoubt::UnknownTaxBase),
        },
        // A guessed headcount somewhere in the hex: the threshold cannot be tested at all.
        // `EstimatedMen` is reused rather than a variant added - its sentence stays true.
        (Some(_), None) => Priced {
            earns: 0,
            doubt: Some(SilverDoubt::EstimatedMen),
        },
        (Some(base), Some(ready)) if ready >= pillage_threshold(base) => Priced {
            earns: base.saturating_mul(2),
            doubt: None,
        },
        // Short of the threshold: the order earns nothing, exactly - a certain zero, so the unit
        // is not doubted.
        (Some(_), Some(_)) => Priced {
            earns: 0,
            doubt: None,
        },
    }
}

/// Combat ready men a faction needs in a region before it may pillage it.
///
/// "enough combat ready men in the region to tax half of the available money" - a taxer collects
/// [`TAX_PER_MAN`], so this is `ceil(tax_base / 2 / 50)`, computed as `ceil(tax_base / 100)` in
/// integers with no float anywhere.
#[must_use]
pub fn pillage_threshold(tax_base: i64) -> i64 {
    let per_man = TAX_PER_MAN * 2;
    (tax_base.max(0) + per_man - 1) / per_man
}

/// Whether this unit will be set to work by default - no month-long order, and not taxing.
///
/// [`works_by_default`] reads the orders alone, which is all `ah-gjq4` had to look at. A unit that
/// taxes by its flag has no order either and is emphatically not idle: it spends its month taxing,
/// and crediting it the region's wage on top of its tax would pay it twice for one month
/// (`ah-fvzu`). The same reasoning that exempts it from `unit-does-nothing`.
fn is_set_to_work(flags: &[String], intents: &[PlacedIntent]) -> bool {
    works_by_default(intents) && !taxes(flags, intents)
}

/// Whether this unit will tax this month - by an explicit `TAX` order, or because it carries the
/// taxing flag, which taxes every turn without one (`ah-fvzu`).
///
/// **A predicate, not a count.** A unit carrying the flag *and* given a `TAX` this turn still
/// taxes once, and this returns `true` for it exactly as for either alone.
///
/// **The flag only taxes a free month.** Taxing is itself a month-long order, and an explicit
/// month-long order takes precedence over the flag - so a flagged unit ordered `MOVE` or `STUDY`
/// taxes nowhere: not here, because it leaves, and not where it arrives, because the explicit
/// order spent its month (`ah-v8zh`). An explicit `TAX` is tested first and is unaffected: it is
/// itself a month-long order, so [`works_by_default`] is false for it.
#[must_use]
pub fn taxes(flags: &[String], intents: &[PlacedIntent]) -> bool {
    if intents
        .iter()
        .any(|placed| matches!(placed.intent, Intent::Tax))
    {
        return true;
    }

    works_by_default(intents)
        && flags.iter().any(|flag| {
            TAXING_FLAGS
                .iter()
                .any(|known| flag.eq_ignore_ascii_case(known))
        })
}

/// Whether the unit is set to spend food on its maintenance, by either `consuming ...` flag.
fn is_consuming(flags: &[String]) -> bool {
    flags.iter().any(|flag| {
        CONSUMING_FLAGS
            .iter()
            .any(|known| flag.eq_ignore_ascii_case(known))
    })
}

/// The level a unit has in one skill, by tag, or 0 for a skill it does not have.
fn skill_level(skills: &[Skill], tag: &str) -> i64 {
    skills
        .iter()
        .find(|skill| skill.tag.eq_ignore_ascii_case(tag))
        .map_or(0, |skill| i64::from(skill.level))
}

/// Whether an intent is one [`forecast_unit`] prices *per man*.
///
/// Only these make a guessed headcount matter. A sale, a gift or a cast is priced from the market,
/// the giver or the mage's own level, so a unit whose headcount is a guess can still be told
/// exactly what one of those does to its silver.
fn moves_silver_per_man(placed: &PlacedIntent) -> bool {
    matches!(
        placed.intent,
        Intent::Tax
            | Intent::Work
            | Intent::Study { .. }
            | Intent::Entertain
            // PRODUCE is priced per man too - how many a unit makes is its headcount divided by
            // the recipe's man-months - so a guessed headcount doubts it exactly as it doubts a
            // TAX (`ah-19l2.2`).
            | Intent::Produce { .. }
    )
}

/// The recipe that makes an item tag, from whichever skill produces it.
///
/// Shared by both surfaces for the same reason `plan_production` is: the column and the ledger
/// must find the same recipe, or they price the same order differently. The unit's own skill is
/// deliberately not consulted - a unit ordered to make what it cannot make is `ah-wbr9`'s business,
/// not this module's.
#[must_use]
pub fn recipe_for<'a>(ruleset: Option<&'a Ruleset>, tag: &str) -> Option<&'a Production> {
    ruleset?
        .skills
        .values()
        .flat_map(|skill| skill.produces.iter())
        .find(|recipe| recipe.tag.eq_ignore_ascii_case(tag))
}

/// Which limit decided how many a unit produces, when it is not its men.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum ProductionCap {
    /// The unit holds less silver than the recipe wants for that many.
    Silver,
    /// The unit holds too little of at least one material input.
    Materials,
}

/// What one `PRODUCE` order makes, and what it takes to make it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProductionPlan {
    /// How many the unit will actually make.
    pub made: i64,
    /// How many its men alone would make - `men / man_months`, rounded down. Equal to `made`
    /// unless something capped it.
    pub wanted: i64,
    /// Silver the whole run costs: `made * <the recipe's SILV input>`. `0` for the great majority
    /// of recipes, which take no silver.
    pub silver: i64,
    /// Every material the whole run consumes, silver excluded, in the recipe's own order.
    ///
    /// `name` carries the tag rather than a name: this module holds no catalogue, so whichever
    /// surface needs English resolves it (`semantics::item_name`), the same way the
    /// `not-enough-items` message already does.
    pub materials: Vec<ItemAmount>,
    /// What stopped it making `wanted`, or `None` when nothing did.
    pub capped_by: Option<ProductionCap>,
}

/// What a unit's `PRODUCE` order makes this month, from the recipe and what the unit holds.
///
/// `held` is the unit's inventory as the report shows it, and the cap is taken against **that**
/// rather than against a running balance. That is a decision, not an oversight: the ledger keeps a
/// running balance and `forecast_unit` does not, so capping against one would give the two
/// surfaces different answers for the same order - which is exactly the drift `ah-ycuj`'s corpus
/// test exists to catch. Holdings are imprecise in both directions (a unit that BUYs wood first
/// makes more than this says; one that spends its silver elsewhere makes fewer), they are the
/// figure the player can see in the report, and they need no assumption about the order in which
/// orders resolve.
///
/// `None` when the recipe cannot be applied at all: a recipe stating no man-months or no outputs
/// (a ruleset scraped before `ah-19l2.1`, or cooking, whose page states a formula), or one whose
/// inputs are alternatives rather than requirements - cooking's "any of grain, livestock and
/// fish" consumes *one* of the three, and reading it as three requirements would debit all three.
/// Each of those is a `?` in the column rather than an invented number.
#[must_use]
pub fn plan_production(
    recipe: &Production,
    men: i64,
    held: &[ItemAmount],
) -> Option<ProductionPlan> {
    if recipe.inputs_are_alternatives {
        return None;
    }
    let man_months = i64::from(recipe.man_months.filter(|months| *months > 0)?);
    let outputs = i64::from(recipe.outputs.filter(|made| *made > 0)?);

    let wanted = (men / man_months) * outputs;
    if wanted <= 0 {
        return Some(ProductionPlan::default());
    }

    let holding = |tag: &str| -> i64 {
        held.iter()
            .find(|item| item.tag.eq_ignore_ascii_case(tag))
            .map_or(0, |item| item.amount)
    };

    let silver_each = recipe
        .inputs
        .iter()
        .find(|input| input.tag.eq_ignore_ascii_case(SILVER_TAG))
        .map_or(0, |input| input.amount);
    let materials_each: Vec<&crate::movement::rules::ProductionInput> = recipe
        .inputs
        .iter()
        .filter(|input| !input.tag.eq_ignore_ascii_case(SILVER_TAG))
        .collect();

    let by_silver = if silver_each > 0 {
        holding(SILVER_TAG) / silver_each
    } else {
        i64::MAX
    };
    let by_materials = materials_each
        .iter()
        .filter(|input| input.amount > 0)
        .map(|input| holding(&input.tag) / input.amount)
        .min()
        .unwrap_or(i64::MAX);

    let made = wanted.min(by_silver).min(by_materials);
    // Silver is named first when both bind, because the column this feeds is about silver.
    let capped_by = if made == wanted {
        None
    } else if by_silver <= by_materials {
        Some(ProductionCap::Silver)
    } else {
        Some(ProductionCap::Materials)
    };

    Some(ProductionPlan {
        made,
        wanted,
        silver: made * silver_each,
        materials: materials_each
            .iter()
            .map(|input| ItemAmount {
                amount: made * input.amount,
                name: input.tag.clone(),
                tag: input.tag.clone(),
            })
            .collect(),
        capped_by,
    })
}

#[cfg(test)]
mod production_tests {
    use super::*;
    use crate::movement::rules::ProductionInput;

    fn input(tag: &str, amount: i64) -> ProductionInput {
        ProductionInput {
            tag: tag.to_string(),
            amount,
        }
    }

    fn held(items: &[(&str, i64)]) -> Vec<ItemAmount> {
        items
            .iter()
            .map(|(tag, amount)| ItemAmount {
                amount: *amount,
                name: tag.to_lowercase(),
                tag: (*tag).to_string(),
            })
            .collect()
    }

    /// The corpus's own recipe: a catapult is 3000 silver, 250 wood, 30 ironwood and 80 furs, one
    /// per four man-months.
    fn catapult() -> Production {
        Production {
            tag: "CATP".to_string(),
            level: 4,
            inputs: vec![
                input("SILV", 3000),
                input("WOOD", 250),
                input("IRWD", 30),
                input("FUR", 80),
            ],
            inputs_are_alternatives: false,
            man_months: Some(4),
            outputs: Some(1),
        }
    }

    #[test]
    fn ten_men_make_two_catapults_at_four_man_months() {
        let plan = plan_production(
            &catapult(),
            10,
            &held(&[
                ("SILV", 100_000),
                ("WOOD", 9999),
                ("IRWD", 999),
                ("FUR", 999),
            ]),
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 2);
        assert_eq!(plan.made, 2);
        assert_eq!(plan.silver, 6000);
        assert_eq!(
            plan.materials
                .iter()
                .map(|item| (item.tag.as_str(), item.amount))
                .collect::<Vec<_>>(),
            vec![("WOOD", 500), ("IRWD", 60), ("FUR", 160)]
        );
        assert_eq!(plan.capped_by, None);
    }

    #[test]
    fn a_unit_too_small_to_make_one_makes_none() {
        let plan = plan_production(&catapult(), 3, &held(&[("SILV", 100_000)]))
            .expect("a priceable recipe");
        assert_eq!(plan.wanted, 0);
        assert_eq!(plan.made, 0);
        assert_eq!(plan.silver, 0);
        assert_eq!(plan.materials, Vec::new());
        assert_eq!(plan.capped_by, None);
    }

    /// Unit 12881 `Carpenters` as the committed turn has it: ten men, materials for two, silver
    /// for one.
    #[test]
    fn silver_caps_what_a_unit_produces() {
        let plan = plan_production(
            &catapult(),
            10,
            &held(&[("SILV", 3000), ("WOOD", 9999), ("IRWD", 999), ("FUR", 999)]),
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 2);
        assert_eq!(plan.made, 1);
        assert_eq!(plan.silver, 3000);
        assert_eq!(plan.capped_by, Some(ProductionCap::Silver));
    }

    #[test]
    fn materials_cap_what_a_unit_produces() {
        let plan = plan_production(
            &catapult(),
            10,
            &held(&[
                ("SILV", 100_000),
                ("WOOD", 250),
                ("IRWD", 999),
                ("FUR", 999),
            ]),
        )
        .expect("a priceable recipe");
        assert_eq!(plan.made, 1);
        assert_eq!(plan.capped_by, Some(ProductionCap::Materials));
    }

    #[test]
    fn silver_is_named_first_when_both_bind() {
        let plan = plan_production(
            &catapult(),
            10,
            &held(&[("SILV", 3000), ("WOOD", 250), ("IRWD", 999), ("FUR", 999)]),
        )
        .expect("a priceable recipe");
        assert_eq!(plan.made, 1);
        assert_eq!(plan.capped_by, Some(ProductionCap::Silver));
    }

    #[test]
    fn a_recipe_that_costs_no_silver_is_capped_by_materials_alone() {
        let sword = Production {
            tag: "SWOR".to_string(),
            level: 1,
            inputs: vec![input("IRON", 1)],
            inputs_are_alternatives: false,
            man_months: Some(1),
            outputs: Some(1),
        };
        let plan = plan_production(&sword, 5, &held(&[("IRON", 2)])).expect("a priceable recipe");
        assert_eq!(plan.wanted, 5);
        assert_eq!(plan.made, 2);
        assert_eq!(plan.silver, 0);
        assert_eq!(plan.capped_by, Some(ProductionCap::Materials));
    }

    /// Cooking says "any of grain, livestock and fish", and which the engine takes cannot be told -
    /// so nothing is priced rather than all three being debited.
    #[test]
    fn a_recipe_of_alternatives_is_not_priced() {
        let meals = Production {
            tag: "MEAL".to_string(),
            level: 1,
            inputs: vec![input("GRAI", 1), input("LIVE", 1), input("FISH", 1)],
            inputs_are_alternatives: true,
            man_months: Some(1),
            outputs: Some(1),
        };
        assert_eq!(plan_production(&meals, 5, &held(&[("GRAI", 99)])), None);
    }

    /// A ruleset scraped before `ah-19l2.1` states neither rate nor output, and a default of 1
    /// there would invent one.
    #[test]
    fn a_recipe_with_no_stated_rate_is_not_priced() {
        let mut unscraped = catapult();
        unscraped.man_months = None;
        assert_eq!(plan_production(&unscraped, 10, &held(&[])), None);
        let mut no_output = catapult();
        no_output.outputs = None;
        assert_eq!(plan_production(&no_output, 10, &held(&[])), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prices_a_units_tax_once_and_leaves_the_pool_policy_to_the_caller() {
        assert_eq!(
            price_tax(10, Some(8963), false, PoolShare::Uncontended),
            Priced {
                earns: 500,
                doubt: None
            }
        );
        // capped by the base
        assert_eq!(
            price_tax(10, Some(200), false, PoolShare::Uncontended),
            Priced {
                earns: 200,
                doubt: None
            }
        );
        // a pillaged hex is a certain zero even with no stated base (`ah-cxxa`)
        assert_eq!(
            price_tax(10, None, true, PoolShare::Uncontended),
            Priced {
                earns: 0,
                doubt: None
            }
        );
        // no base, not pillaged
        assert_eq!(
            price_tax(10, None, false, PoolShare::Uncontended),
            Priced {
                earns: 0,
                doubt: Some(SilverDoubt::UnknownTaxBase)
            }
        );
        // the settlement wins where the caller passes one
        assert_eq!(
            price_tax(10, Some(8963), false, PoolShare::Share(120)),
            Priced {
                earns: 120,
                doubt: None
            }
        );
        assert_eq!(
            price_tax(10, Some(8963), false, PoolShare::Unknowable),
            Priced {
                earns: 0,
                doubt: Some(SilverDoubt::ContestedRegionPool)
            }
        );
    }

    #[test]
    fn prices_a_pillage_from_the_base_and_the_threshold() {
        assert_eq!(
            price_pillage(None, Some(100)),
            Priced {
                earns: 0,
                doubt: Some(SilverDoubt::UnknownTaxBase)
            }
        );
        assert_eq!(
            price_pillage(Some(8963), None),
            Priced {
                earns: 0,
                doubt: Some(SilverDoubt::EstimatedMen)
            }
        );
        assert_eq!(
            price_pillage(Some(100), Some(0)),
            Priced {
                earns: 0,
                doubt: None
            }
        );
        let base = 100;
        assert_eq!(
            price_pillage(Some(base), Some(pillage_threshold(base))),
            Priced {
                earns: 200,
                doubt: None
            }
        );
    }

    #[test]
    fn parses_the_wage_the_report_prints() {
        assert_eq!(parse_wage_centis(Some("$24.1")), Some(2410));
        assert_eq!(parse_wage_centis(Some("$0")), Some(0));
        assert_eq!(parse_wage_centis(Some("$12.0")), Some(1200));
        assert_eq!(parse_wage_centis(None), None);
        assert_eq!(parse_wage_centis(Some("")), None);
        assert_eq!(parse_wage_centis(Some("nonsense")), None);
    }

    fn placed(intent: Intent) -> PlacedIntent {
        PlacedIntent {
            intent,
            line: 1,
            column_start: 0,
            column_end: 1,
        }
    }

    /// A unit with nothing but a headcount: no skills, no gifts, no market.
    fn facts<'a>(men: i64, intents: &'a [PlacedIntent], receipts: &'a Receipts) -> UnitFacts<'a> {
        UnitFacts {
            unit_id: "1234",
            region_id: "mountain (7,53)",
            held: 0,
            men,
            men_estimated: false,
            men_by_race: &[],
            items: &[],
            flags: &[],
            skills: &[],
            intents,
            receipts,
        }
    }

    /// A market that wants nothing, for the rules that have no sale in them.
    fn no_sales(_item: &str) -> SaleAnswer {
        SaleAnswer::NotWanted
    }

    /// A market that sells nothing, for the rules that have no purchase in them.
    fn no_purchases(item: &str) -> PurchaseAnswer {
        PurchaseAnswer::NotSold {
            name: item.to_lowercase(),
        }
    }

    /// Items resolve to their own text, upper-cased - enough for the rules that only ask whether
    /// something is `SILV`.
    fn verbatim_tag(text: &str) -> Option<String> {
        Some(text.to_ascii_uppercase())
    }

    /// Nothing settled, so every arm falls back to what the market line itself says - which is
    /// this module's own behaviour, unit-tested here without `semantics`' settlement.
    fn unsettled_market(_item: &str, _side: MarketSide) -> Option<i64> {
        None
    }

    /// The lookups for a unit that neither buys nor sells.
    fn no_market() -> Lookups<'static> {
        Lookups {
            sale: &no_sales,
            purchase: &no_purchases,
            item_tag: &verbatim_tag,
            item_name: &verbatim_name,
            market_share: &unsettled_market,
        }
    }

    fn verbatim_name(tag: &str) -> String {
        tag.to_lowercase()
    }

    fn skill(tag: &str, level: u32) -> Skill {
        Skill {
            name: tag.to_string(),
            tag: tag.to_string(),
            level,
            points: 0,
        }
    }

    fn forecast(men: i64, region: RegionWages, intents: &[PlacedIntent]) -> UnitSilver {
        forecast_holding(men, region, FactionPurse::default(), intents)
    }

    /// The same as [`forecast`], with a faction purse for the `CLAIM` arm to be capped by.
    fn forecast_holding(
        men: i64,
        region: RegionWages,
        purse: FactionPurse,
        intents: &[PlacedIntent],
    ) -> UnitSilver {
        let receipts = Receipts::default();
        forecast_unit(
            facts(men, intents, &receipts),
            region,
            PoolShares::default(),
            purse,
            no_market(),
            None,
        )
    }

    fn purse(unclaimed: Option<i64>) -> FactionPurse {
        FactionPurse { unclaimed }
    }

    fn taxable(tax_base: Option<i64>) -> RegionWages {
        RegionWages {
            tax_base,
            ..RegionWages::default()
        }
    }

    /// A region whose tax base is stated and whose faction has men enough to pillage it, which is
    /// what the `PILLAGE` arm needs before it credits anything (`ah-1ad6.2`).
    fn pillageable(tax_base: i64) -> RegionWages {
        RegionWages {
            tax_base: Some(tax_base),
            combat_ready: Some(pillage_threshold(tax_base)),
            ..RegionWages::default()
        }
    }

    fn paying(wage: &str, max_wages: Option<i64>) -> RegionWages {
        RegionWages {
            wage_centis: parse_wage_centis(Some(wage)),
            max_wages,
            ..RegionWages::default()
        }
    }

    /// The committed ruleset, which prices `combat` at 10 a man and `annihilation` at nothing -
    /// the real catalogue rather than a fragment, so the test pins what the application would do.
    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    /// Flags as the report prints them, for the taxing-flag rules.
    fn flags(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn a_unit_with_a_tax_order_taxes() {
        assert!(taxes(&[], &[placed(Intent::Tax)]));
    }

    #[test]
    fn a_unit_with_the_taxing_flag_taxes() {
        assert!(taxes(&flags(&["taxing"]), &[]));
    }

    #[test]
    fn a_unit_with_the_autotax_spelling_taxes() {
        assert!(taxes(&flags(&["autotax"]), &[]));
        assert!(taxes(&flags(&["Taxing"]), &[]));
    }

    #[test]
    fn a_unit_with_both_taxes_once() {
        assert!(taxes(&flags(&["taxing"]), &[placed(Intent::Tax)]));
    }

    /// Taxing is itself a month-long order, and an explicit month-long order takes precedence over
    /// the flag: a flagged unit ordered `MOVE` or `STUDY` taxes nowhere - not the hex it leaves,
    /// and not the hex it arrives in, because the explicit order spent its month (`ah-v8zh`).
    #[test]
    fn a_flagged_unit_given_a_month_long_order_does_not_tax() {
        assert!(!taxes(
            &flags(&["taxing"]),
            &[placed(Intent::Move { steps: Vec::new() })]
        ));
        assert!(!taxes(
            &flags(&["autotax"]),
            &[placed(Intent::Study {
                skill: "COMB".to_string()
            })]
        ));

        // The flag still taxes a free month, in both spellings.
        assert!(taxes(&flags(&["taxing"]), &[]));
        assert!(taxes(&flags(&["autotax"]), &[]));

        // And an explicit TAX is unaffected, whatever else the unit carries.
        assert!(taxes(&[], &[placed(Intent::Tax)]));
        assert!(taxes(&flags(&["taxing"]), &[placed(Intent::Tax)]));
    }

    #[test]
    fn a_unit_with_neither_does_not() {
        assert!(!taxes(
            &flags(&["on guard", "sharing"]),
            &[placed(Intent::Work)]
        ));
    }

    /// A forecast for a unit with report flags, and a settled share of its region's pools.
    fn forecast_flagged(
        men: i64,
        region: RegionWages,
        shares: PoolShares,
        unit_flags: &[String],
        intents: &[PlacedIntent],
    ) -> UnitSilver {
        let receipts = Receipts::default();
        let mut unit_facts = facts(men, intents, &receipts);
        unit_facts.flags = unit_flags;
        forecast_unit(
            unit_facts,
            region,
            shares,
            FactionPurse::default(),
            no_market(),
            None,
        )
    }

    /// The reported defect: 800 men set to tax every turn, no `TAX` line, shown earning nothing
    /// (`ah-fvzu`).
    #[test]
    fn a_flagged_unit_earns_its_tax_without_an_order() {
        let unit = forecast_flagged(
            800,
            taxable(Some(40_000)),
            PoolShares::default(),
            &flags(&["taxing"]),
            &[],
        );
        assert_eq!(unit.income, Some(40_000));
    }

    /// The obvious wrong implementation - keep the intent arm, add a flag branch - doubles this.
    #[test]
    fn a_flagged_unit_with_a_tax_order_is_not_counted_twice() {
        let unit = forecast_flagged(
            800,
            taxable(Some(40_000)),
            PoolShares::default(),
            &flags(&["taxing"]),
            &[placed(Intent::Tax)],
        );
        assert_eq!(unit.income, Some(40_000));
    }

    #[test]
    fn a_flagged_unit_is_capped_by_the_tax_base() {
        let unit = forecast_flagged(
            8,
            taxable(Some(120)),
            PoolShares::default(),
            &flags(&["autotax"]),
            &[],
        );
        assert_eq!(unit.income, Some(120));
    }

    #[test]
    fn a_flagged_unit_in_a_pillaged_hex_earns_nothing() {
        let region = RegionWages {
            tax_base: Some(2500),
            pillaged: true,
            ..RegionWages::default()
        };
        let unit = forecast_flagged(30, region, PoolShares::default(), &flags(&["taxing"]), &[]);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_flagged_unit_contends_for_the_pool_like_any_other() {
        let shares = PoolShares {
            tax: PoolShare::Share(500),
            ..PoolShares::default()
        };
        let unit = forecast_flagged(30, taxable(Some(2500)), shares, &flags(&["taxing"]), &[]);
        assert_eq!(unit.income, Some(500));
    }

    /// Lifting tax out of the intent loop makes the tax doubt win over a later order's, whichever
    /// line the player typed first. Deliberate, and better than a sentence that depended on the
    /// order of the block (`ah-fvzu`).
    #[test]
    fn a_taxing_doubt_no_longer_depends_on_which_line_came_first() {
        let unknown_goods = |_item: &str| SaleAnswer::Unknown;
        let priced = |intents: &[PlacedIntent]| {
            let receipts = Receipts::default();
            forecast_unit(
                facts(8, intents, &receipts),
                taxable(None),
                PoolShares::default(),
                FactionPurse::default(),
                Lookups {
                    sale: &unknown_goods,
                    ..no_market()
                },
                None,
            )
            .doubt
        };
        let tax_first = priced(&[placed(Intent::Tax), selling("wibble", Amount::Exact(40))]);
        let sell_first = priced(&[selling("wibble", Amount::Exact(40)), placed(Intent::Tax)]);
        assert_eq!(tax_first, Some(SilverDoubt::UnknownTaxBase));
        assert_eq!(sell_first, tax_first);
    }

    #[test]
    fn a_flagged_unit_is_marked_as_taxing_by_its_flag() {
        let unit = forecast_flagged(
            8,
            taxable(Some(40_000)),
            PoolShares::default(),
            &flags(&["taxing"]),
            &[],
        );
        assert!(unit.taxes_by_flag);
    }

    /// A unit with a `TAX` on screen explains itself, flag or no flag (`ah-fvzu`).
    #[test]
    fn a_unit_with_a_tax_order_is_not_marked_as_taxing_by_its_flag() {
        let with_both = forecast_flagged(
            8,
            taxable(Some(40_000)),
            PoolShares::default(),
            &flags(&["taxing"]),
            &[placed(Intent::Tax)],
        );
        assert!(!with_both.taxes_by_flag);
        let ordered = forecast(8, taxable(Some(40_000)), &[placed(Intent::Tax)]);
        assert!(!ordered.taxes_by_flag);
    }

    /// A unit taxing by its flag spends its month taxing, so it is not also set to work - which
    /// would credit it the region's wage on top of its tax (`ah-fvzu` meeting `ah-gjq4`).
    #[test]
    fn a_flagged_taxer_is_not_also_set_to_work() {
        let region = RegionWages {
            tax_base: Some(40_000),
            wage_centis: Some(1200),
            max_wages: Some(10_000),
            ..RegionWages::default()
        };
        let unit = forecast_flagged(8, region, PoolShares::default(), &flags(&["taxing"]), &[]);
        assert!(!unit.works_by_default);
        assert_eq!(unit.income, Some(400));
        assert_eq!(unit.late_income, Some(0));
    }

    #[test]
    fn a_claiming_unit_counts_what_it_claims() {
        let unit = forecast_holding(
            1,
            RegionWages::default(),
            purse(Some(4935)),
            &[placed(Intent::Claim(500))],
        );
        assert_eq!(unit.income, Some(500));
        assert_eq!(unit.at_month_end, Some(500));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_claim_is_capped_by_what_the_faction_holds() {
        let unit = forecast_holding(
            1,
            RegionWages::default(),
            purse(Some(4935)),
            &[placed(Intent::Claim(9000))],
        );
        assert_eq!(unit.income, Some(4935));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_claim_with_no_stated_purse_counts_what_was_claimed() {
        let unit = forecast_holding(
            1,
            RegionWages::default(),
            purse(None),
            &[placed(Intent::Claim(500))],
        );
        assert_eq!(unit.income, Some(500));
        assert_eq!(unit.doubt, None);
    }

    /// The accepted overstatement, pinned deliberately: each unit is capped at the whole purse and
    /// the purse is never divided between them, exactly as `WORK` treats a region's wages. A
    /// warning about the total belongs to `ah-wur4` - do not "fix" this into contention modelling.
    #[test]
    fn two_units_claiming_are_each_capped_at_the_whole_purse() {
        let region = RegionWages::default();
        let first = forecast_holding(1, region, purse(Some(4935)), &[placed(Intent::Claim(4000))]);
        let second = forecast_holding(1, region, purse(Some(4935)), &[placed(Intent::Claim(4000))]);
        assert_eq!(first.income, Some(4000));
        assert_eq!(second.income, Some(4000));
    }

    #[test]
    fn a_claim_of_nothing_changes_nothing() {
        let unit = forecast_holding(
            1,
            RegionWages::default(),
            purse(Some(4935)),
            &[placed(Intent::Claim(0))],
        );
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, Some(0));
    }

    #[test]
    fn a_claim_alongside_other_income_adds_to_it() {
        let unit = forecast_holding(
            8,
            taxable(Some(100_000)),
            purse(Some(4935)),
            &[placed(Intent::Tax), placed(Intent::Claim(500))],
        );
        assert_eq!(unit.income, Some(900));
    }

    #[test]
    fn a_taxing_unit_earns_fifty_a_man() {
        let unit = forecast(8, taxable(Some(100_000)), &[placed(Intent::Tax)]);
        assert_eq!(unit.income, Some(400));
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, Some(400));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_taxing_unit_is_capped_by_the_regions_tax_base() {
        let unit = forecast(8, taxable(Some(120)), &[placed(Intent::Tax)]);
        assert_eq!(unit.income, Some(120));
    }

    #[test]
    fn a_taxing_unit_with_no_tax_base_is_doubted() {
        let unit = forecast(8, taxable(None), &[placed(Intent::Tax)]);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownTaxBase));
        assert_eq!(unit.income, None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, None);
    }

    /// "PILLAGE comes before TAX, so a unit performing TAX will collect no money in that region
    /// that month" - so an own unit pillaging this hex empties it for every other own taxer
    /// (`ah-cxxa`).
    #[test]
    fn a_taxer_in_a_pillaged_hex_collects_nothing() {
        let region = RegionWages {
            tax_base: Some(2500),
            pillaged: true,
            ..RegionWages::default()
        };
        let unit = forecast(30, region, &[placed(Intent::Tax)]);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, Some(0));
        assert_eq!(unit.doubt, None);
    }

    /// A certain zero, not a doubt: a pillage empties the hex whatever the base was, so the taxer
    /// collects nothing even where the base itself is unknown. Doubting it would hide a fact we
    /// know (`ah-cxxa`, the navigator's decision).
    #[test]
    fn a_taxer_in_a_pillaged_hex_with_no_stated_base_still_collects_nothing() {
        let region = RegionWages {
            tax_base: None,
            pillaged: true,
            ..RegionWages::default()
        };
        let unit = forecast(30, region, &[placed(Intent::Tax)]);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    /// "The amount of money collected is equal to twice the available tax money." The ledger
    /// (`semantics::apply`) has credited exactly this since it shipped; the column credited
    /// nothing at all, so the two surfaces priced one order two ways (`ah-abwx`).
    #[test]
    fn a_pillaging_unit_earns_twice_the_tax_base() {
        let unit = forecast(1, pillageable(2500), &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(5000));
        assert_eq!(unit.at_month_end, Some(5000));
        assert_eq!(unit.doubt, None);
    }

    /// A silent zero is the defect being removed, so `income` is asserted `None` and not merely
    /// the doubt: a column that showed nothing would pass a test that only read the doubt.
    #[test]
    fn a_pillaging_unit_with_no_stated_tax_base_is_doubted() {
        let unit = forecast(1, taxable(None), &[placed(Intent::Pillage)]);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownTaxBase));
        assert_eq!(unit.income, None);
        assert_eq!(unit.at_month_end, None);
    }

    /// Pillaging resolves before the market, so its silver funds this month's orders - which is
    /// what `BUY ALL` reads (`ah-1wcw.3`, `ah-uwa3`). This is the test that fails if the credit is
    /// ever routed through `late_income`.
    #[test]
    fn a_pillaging_unit_can_afford_what_it_pillaged_for() {
        let intents = vec![
            placed(Intent::Pillage),
            placed(Intent::Buy {
                amount: Amount::All { except: 0 },
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(0, &intents, pillageable(2500), &sells(12, 40), None);
        assert_eq!(unit.income, Some(5000));
        assert_eq!(unit.expense, Some(480));
        assert_eq!(unit.at_month_end, Some(4520));
    }

    /// The reported defect (`ah-1ad6.2`): *The Lost One (683)*, one leader in a hex whose tax base
    /// is 8,963, was credited the full 17,926. The hex needs 90 combat ready men.
    #[test]
    fn a_faction_without_the_men_earns_nothing_from_pillage() {
        let region = RegionWages {
            tax_base: Some(8963),
            combat_ready: Some(1),
            ..RegionWages::default()
        };
        let unit = forecast(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, Some(0));
        assert_eq!(unit.doubt, None);
    }

    /// No regression on `ah-abwx`: a faction that does have the men is credited in full.
    #[test]
    fn a_faction_with_the_men_is_credited_in_full() {
        let region = RegionWages {
            tax_base: Some(8963),
            combat_ready: Some(90),
            ..RegionWages::default()
        };
        let unit = forecast(90, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(17_926));
        assert_eq!(unit.doubt, None);
    }

    /// One guessed headcount anywhere in the hex makes the threshold unanswerable, and it is
    /// unanswerable in the direction that matters: the estimate might be what carries the faction
    /// over. `EstimatedMen` is reused rather than a variant added.
    #[test]
    fn a_guessed_headcount_in_the_hex_doubts_the_pillage() {
        let region = RegionWages {
            tax_base: Some(8963),
            combat_ready: None,
            ..RegionWages::default()
        };
        let unit = forecast(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.doubt, Some(SilverDoubt::EstimatedMen));
        assert_eq!(unit.income, None);
    }

    /// The navigator's decision: "the faction to have enough combat ready men in the region", so a
    /// lone leader ordering `PILLAGE` beside a faction-mate of 90 armed men qualifies, and the
    /// army need issue no order. The count is the hex's, never the pillaging unit's own.
    #[test]
    fn the_men_are_counted_across_the_hex_not_the_unit() {
        let region = RegionWages {
            tax_base: Some(8963),
            combat_ready: Some(90),
            ..RegionWages::default()
        };
        let unit = forecast(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(17_926));
        assert_eq!(unit.doubt, None);
    }

    /// The older doubt wins: what the region holds is unknown before the question of who may take
    /// it arises.
    #[test]
    fn an_unknown_tax_base_outranks_an_unknown_headcount() {
        let region = RegionWages {
            tax_base: None,
            combat_ready: None,
            ..RegionWages::default()
        };
        let unit = forecast(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownTaxBase));
    }

    /// Guards against the arm being folded into `Tax`'s match rather than written beside it: a
    /// pillaging unit earns twice the base and nothing per man.
    #[test]
    fn pillaging_does_not_also_tax() {
        let unit = forecast(8, pillageable(1000), &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(2000));
    }

    #[test]
    fn a_working_unit_earns_the_regions_wage() {
        let unit = forecast(12, paying("$12.0", None), &[placed(Intent::Work)]);
        assert_eq!(unit.income, Some(144));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_working_unit_is_capped_by_the_regions_maximum() {
        let unit = forecast(12, paying("$12.0", Some(90)), &[placed(Intent::Work)]);
        assert_eq!(unit.income, Some(90));
    }

    #[test]
    fn a_working_unit_in_a_hex_with_no_wages_earns_nothing() {
        let unit = forecast(12, RegionWages::default(), &[placed(Intent::Work)]);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    // --- the defaulted WORK (`ah-gjq4`) ---------------------------------------------------------

    /// A unit with no month-long order is set to work, and work pays the region's wage. The
    /// earning arrives in the turn's last phase exactly as an explicit `WORK` does.
    #[test]
    fn a_unit_with_no_month_long_order_works_by_default() {
        let unit = forecast(6, paying("$12.0", None), &[]);
        assert_eq!(unit.late_income, Some(72));
        assert_eq!(unit.income, Some(72));
        assert!(unit.works_by_default);
    }

    #[test]
    fn a_unit_that_spends_its_month_does_not_also_work() {
        let unit = forecast(
            6,
            paying("$12.0", None),
            &[placed(Intent::Study {
                skill: "combat".to_string(),
            })],
        );
        assert_eq!(unit.late_income, Some(0));
        assert!(!unit.works_by_default);
    }

    /// `GUARD` is a flag rather than a month's work, which `spends_the_month` already encodes - so
    /// a unit ordered only to guard still works.
    #[test]
    fn guarding_is_not_spending_the_month() {
        let unit = forecast(6, paying("$12.0", None), &[placed(Intent::Guard(true))]);
        assert_eq!(unit.late_income, Some(72));
        assert!(unit.works_by_default);
    }

    /// `CAST` leaves the month free, so a unit ordered only to cast works as well.
    #[test]
    fn a_unit_ordered_only_to_cast_still_works() {
        let unit = forecast(
            6,
            paying("$12.0", None),
            &[placed(Intent::Cast {
                spell: "Fire".to_string(),
                arguments: Vec::new(),
            })],
        );
        assert_eq!(unit.late_income, Some(72));
        assert!(unit.works_by_default);
    }

    /// A region with no wage line pays nothing, so the default invents no income.
    #[test]
    fn a_region_with_no_wage_line_pays_an_idle_unit_nothing() {
        let unit = forecast(6, RegionWages::default(), &[]);
        assert_eq!(unit.income, Some(0));
        assert!(unit.works_by_default);
    }

    /// Wages arrive in the turn's last phase, so a defaulted wage cannot fund this month's orders.
    /// A term added straight to `income` would pass the test above and fail this one.
    #[test]
    fn an_idle_units_wages_cannot_fund_its_purchases() {
        let receipts = Receipts::default();
        let intents: [PlacedIntent; 0] = [];
        let unit = forecast_unit(
            UnitFacts {
                held: 0,
                ..facts(6, &intents, &receipts)
            },
            paying("$12.0", None),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.income, Some(72));
        assert_eq!(unit.short_for_orders, Some(0));
        assert_eq!(unit.late_income, Some(72));
    }

    /// The estimated-headcount short-circuit is conditional on some intent moving silver per man,
    /// and an idle unit has no intents at all - so without the defaulted-work clause a guessed
    /// headcount would be multiplied out into a wage.
    #[test]
    fn an_idle_unit_with_an_estimated_headcount_is_doubted() {
        let receipts = Receipts::default();
        let intents: [PlacedIntent; 0] = [];
        let unit = forecast_unit(
            UnitFacts {
                held: 600,
                men_estimated: true,
                ..facts(8, &intents, &receipts)
            },
            paying("$12.0", None),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::EstimatedMen));
        assert_eq!(unit.income, None);
    }

    #[test]
    fn a_fractional_wage_rounds_down() {
        let unit = forecast(3, paying("$12.5", None), &[placed(Intent::Work)]);
        assert_eq!(unit.income, Some(37));
    }

    #[test]
    fn a_studying_unit_pays_the_rulesets_cost_per_man() {
        let ruleset = ruleset();
        let receipts = Receipts::default();
        let intents = [placed(Intent::Study {
            skill: "combat".to_string(),
        })];
        let unit = forecast_unit(
            UnitFacts {
                held: 600,
                ..facts(6, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            Some(&ruleset),
        );
        assert_eq!(unit.expense, Some(60));
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, Some(540));
    }

    #[test]
    fn a_studying_unit_the_ruleset_cannot_price_is_doubted() {
        let ruleset = ruleset();
        let receipts = Receipts::default();
        let intents = [placed(Intent::Study {
            skill: "annihilation".to_string(),
        })];
        let unit = forecast_unit(
            UnitFacts {
                held: 600,
                ..facts(6, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            Some(&ruleset),
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::UnpricedSkill));
        assert_eq!(unit.expense, None);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, None);
    }

    #[test]
    fn a_unit_whose_headcount_is_a_guess_is_doubted() {
        let receipts = Receipts::default();
        let intents = [placed(Intent::Tax)];
        let unit = forecast_unit(
            UnitFacts {
                held: 600,
                men_estimated: true,
                ..facts(8, &intents, &receipts)
            },
            taxable(Some(100_000)),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::EstimatedMen));
        assert_eq!(unit.income, None);
        assert_eq!(unit.expense, None);
        assert_eq!(unit.at_month_end, None);
    }

    // --- selling ------------------------------------------------------------------------------

    fn selling(item: &str, amount: Amount) -> PlacedIntent {
        placed(Intent::Sell {
            item: item.to_string(),
            amount,
        })
    }

    fn sold(intents: &[PlacedIntent], sale: &dyn Fn(&str) -> SaleAnswer) -> UnitSilver {
        let receipts = Receipts::default();
        forecast_unit(
            facts(1, intents, &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            Lookups {
                sale,
                ..no_market()
            },
            None,
        )
    }

    fn wanted(price: i64, market_takes: i64, unit_holds: i64) -> impl Fn(&str) -> SaleAnswer {
        move |_item: &str| SaleAnswer::Wanted {
            price,
            market_takes,
            unit_holds,
        }
    }

    #[test]
    fn a_selling_unit_earns_the_price_the_market_states() {
        let unit = sold(&[selling("furs", Amount::Exact(40))], &wanted(24, 40, 40));
        assert_eq!(unit.income, Some(960));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn selling_takes_no_more_than_the_market_will_take() {
        let unit = sold(
            &[selling("furs", Amount::All { except: 0 })],
            &wanted(24, 40, 200),
        );
        assert_eq!(unit.income, Some(960));
    }

    #[test]
    fn selling_more_than_the_unit_holds_sells_only_what_it_holds() {
        let unit = sold(&[selling("furs", Amount::Exact(40))], &wanted(24, 40, 12));
        assert_eq!(unit.income, Some(288));
    }

    #[test]
    fn selling_all_but_a_reserve_keeps_the_reserve() {
        let unit = sold(
            &[selling("furs", Amount::All { except: 10 })],
            &wanted(24, 40, 30),
        );
        assert_eq!(unit.income, Some(480));
    }

    #[test]
    fn selling_what_the_market_does_not_want_earns_nothing() {
        let unit = sold(&[selling("furs", Amount::Exact(40))], &|_| {
            SaleAnswer::NotWanted
        });
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn selling_goods_the_report_cannot_identify_is_doubted() {
        let unit = sold(&[selling("Wibble", Amount::Exact(40))], &|_| {
            SaleAnswer::Unknown
        });
        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownGoods));
        assert_eq!(unit.doubt_subject, Some("wibble".to_string()));
        assert_eq!(unit.income, None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, None);
    }

    // --- when the silver lands ------------------------------------------------------------------

    #[test]
    fn a_working_unit_earns_late() {
        let unit = forecast(10, paying("$12.0", None), &[placed(Intent::Work)]);
        assert_eq!(unit.income, Some(120));
        assert_eq!(unit.late_income, Some(120));
    }

    #[test]
    fn an_entertainer_earns_late() {
        let unit = entertaining(5, 2, Some(1000));
        assert_eq!(unit.income, Some(300));
        assert_eq!(unit.late_income, Some(300));
    }

    #[test]
    fn phantasmal_entertainment_is_not_late_income() {
        // `CAST` resolves before every spend order, so a mage's takings can fund a `BUY` in the
        // same month - which is why this spell left `late_income` (`ah-e77q` correcting `ah-uwa3`).
        let unit = casting("Phantasmal_Entertainment", "PHEN", 2, Some(10_000));
        assert_eq!(unit.income, Some(1200));
        assert_eq!(unit.late_income, Some(0));
    }

    #[test]
    fn earth_lore_is_not_late_income() {
        // The spell's 84 is spendable this month; the 14 the mage also earns working is not
        // (`ah-gjq4`), which is exactly the distinction this test exists to hold.
        let unit = casting_for_wages("Earth_Lore", "EART", 3, "$14.0");
        assert_eq!(unit.income, Some(98));
        assert_eq!(unit.late_income, Some(14));
    }

    #[test]
    fn wages_and_entertaining_are_still_late() {
        // The guard that moving the spells took neither of these with them.
        let working = forecast(10, paying("$12.0", None), &[placed(Intent::Work)]);
        assert_eq!(working.late_income, Some(120));
        let entertainer = entertaining(5, 2, Some(1000));
        assert_eq!(entertainer.late_income, Some(300));
    }

    #[test]
    fn taxing_earns_in_time() {
        let unit = forecast(8, taxable(Some(100_000)), &[placed(Intent::Tax)]);
        assert_eq!(unit.income, Some(400));
        assert_eq!(unit.late_income, Some(0));
    }

    #[test]
    fn selling_earns_in_time() {
        let receipts = Receipts::default();
        let intents = [placed(Intent::Sell {
            item: "grain".to_string(),
            amount: Amount::Exact(3),
        })];
        let sale = |_item: &str| SaleAnswer::Wanted {
            price: 10,
            market_takes: 100,
            unit_holds: 100,
        };
        let unit = forecast_unit(
            facts(1, &intents, &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            Lookups {
                sale: &sale,
                ..no_market()
            },
            None,
        );
        assert_eq!(unit.income, Some(30));
        assert_eq!(unit.late_income, Some(0));
    }

    // --- what the orders cannot cover ------------------------------------------------------------

    #[test]
    fn wages_cannot_pay_for_a_purchase() {
        let intents = vec![
            placed(Intent::Work),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(0, &intents, paying("$120.0", None), &sells(12, 40), None);
        assert_eq!(unit.at_month_end, Some(60));
        assert_eq!(unit.short_for_orders, Some(60));
    }

    #[test]
    fn silver_in_hand_pays_for_a_purchase() {
        let intents = vec![
            placed(Intent::Work),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(100, &intents, paying("$120.0", None), &sells(12, 40), None);
        assert_eq!(unit.at_month_end, Some(160));
        assert_eq!(unit.short_for_orders, Some(0));
    }

    #[test]
    fn buying_all_spends_only_what_arrives_in_time() {
        let intents = vec![
            placed(Intent::Work),
            placed(Intent::Buy {
                amount: Amount::All { except: 0 },
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(0, &intents, paying("$120.0", None), &sells(12, 40), None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.short_for_orders, Some(0));
    }

    #[test]
    fn a_shortfall_names_the_order_it_bites_on() {
        let intents = vec![
            placed(Intent::Work),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(0, &intents, paying("$120.0", None), &sells(12, 40), None);
        assert_eq!(unit.short_on, Some(SilverSpender::Buy));
    }

    /// A `GIVE` of items spends no silver, so it must not be blamed for a shortfall the later
    /// `BUY` causes (Copilot on PR #591).
    #[test]
    fn an_order_that_spends_no_silver_is_never_named() {
        let intents = vec![
            placed(Intent::Work),
            placed(Intent::Give {
                to: Party::Unit("7".to_string()),
                what: Selector::Item("horse".to_string()),
                amount: Amount::Exact(2),
            }),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(0, &intents, paying("$120.0", None), &sells(12, 40), None);
        assert_eq!(unit.short_for_orders, Some(60));
        assert_eq!(unit.short_on, Some(SilverSpender::Buy));
    }

    #[test]
    fn a_unit_that_can_pay_names_no_order() {
        let intents = vec![
            placed(Intent::Work),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(100, &intents, paying("$120.0", None), &sells(12, 40), None);
        assert_eq!(unit.short_on, None);
    }

    // --- entertaining -------------------------------------------------------------------------

    fn entertaining(men: i64, level: u32, entertainment: Option<i64>) -> UnitSilver {
        let receipts = Receipts::default();
        let intents = [placed(Intent::Entertain)];
        let skills = [skill("ENTE", level)];
        forecast_unit(
            UnitFacts {
                skills: if level == 0 { &[] } else { &skills },
                ..facts(men, &intents, &receipts)
            },
            RegionWages {
                entertainment,
                ..RegionWages::default()
            },
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        )
    }

    #[test]
    fn an_entertainer_earns_thirty_a_man_a_level() {
        let unit = entertaining(5, 2, Some(1000));
        assert_eq!(unit.income, Some(300));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn an_entertainer_is_capped_by_the_regions_demand() {
        let unit = entertaining(5, 2, Some(120));
        assert_eq!(unit.income, Some(120));
    }

    #[test]
    fn an_entertainer_with_no_skill_earns_nothing() {
        let unit = entertaining(5, 0, Some(1000));
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn an_entertainer_where_the_report_states_no_demand_earns_nothing() {
        let unit = entertaining(5, 2, None);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    // --- magic that earns ---------------------------------------------------------------------

    fn casting(spell: &str, tag: &str, level: u32, entertainment: Option<i64>) -> UnitSilver {
        let ruleset = ruleset();
        let receipts = Receipts::default();
        let intents = [placed(Intent::Cast {
            spell: spell.to_string(),
            arguments: Vec::new(),
        })];
        let skills = [skill(tag, level)];
        forecast_unit(
            UnitFacts {
                skills: if level == 0 { &[] } else { &skills },
                ..facts(1, &intents, &receipts)
            },
            RegionWages {
                entertainment,
                ..RegionWages::default()
            },
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            Some(&ruleset),
        )
    }

    #[test]
    fn a_mage_casting_phantasmal_entertainment_earns_six_hundred_a_level() {
        let unit = casting("Phantasmal_Entertainment", "PHEN", 2, Some(5000));
        assert_eq!(unit.income, Some(1200));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn phantasmal_entertainment_is_capped_by_the_regions_entertainment() {
        let unit = casting("Phantasmal_Entertainment", "PHEN", 2, Some(800));
        assert_eq!(unit.income, Some(800));
    }

    #[test]
    fn phantasmal_entertainment_does_not_reduce_what_an_entertainer_earns() {
        // One hex, one pool: each unit is capped at it, and neither draws it down for the other.
        let mage = casting("Phantasmal_Entertainment", "PHEN", 1, Some(1000));
        let entertainer = entertaining(5, 2, Some(1000));
        assert_eq!(mage.income, Some(600));
        assert_eq!(entertainer.income, Some(300));
    }

    #[test]
    fn a_mage_with_no_phantasmal_skill_earns_nothing() {
        let unit = casting("Phantasmal_Entertainment", "PHEN", 0, Some(5000));
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    /// A caster in a hex that states a wage, which is what Earth Lore is priced from.
    fn casting_for_wages(spell: &str, tag: &str, level: u32, wage: &str) -> UnitSilver {
        casting_in(spell, tag, level, paying(wage, None), None)
    }

    /// [`casting`] with the region and the ruleset both stated, for the two spells whose earnings
    /// depend on something other than the entertainment pool.
    fn casting_in(
        spell: &str,
        tag: &str,
        level: u32,
        region: RegionWages,
        ruleset_override: Option<&Ruleset>,
    ) -> UnitSilver {
        let committed = ruleset();
        let ruleset = ruleset_override.unwrap_or(&committed);
        let receipts = Receipts::default();
        let intents = [placed(Intent::Cast {
            spell: spell.to_string(),
            arguments: Vec::new(),
        })];
        let skills = [skill(tag, level)];
        forecast_unit(
            UnitFacts {
                skills: if level == 0 { &[] } else { &skills },
                ..facts(1, &intents, &receipts)
            },
            region,
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            Some(ruleset),
        )
    }

    #[test]
    fn a_mage_casting_earth_lore_earns_twice_the_wage_a_level() {
        // 84 from the spell, plus 14 the mage earns working: CAST leaves the month free, so the
        // unit is also set to work (`ah-gjq4`).
        let unit = casting_for_wages("Earth_Lore", "EART", 3, "$14.0");
        assert_eq!(unit.income, Some(98));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn earth_lore_in_a_hex_with_no_wage_earns_nothing() {
        // The formula multiplies by the wage, and a hex that states none pays none - the same
        // answer `WORK` already gives, and not a doubt.
        let unit = casting_in("Earth_Lore", "EART", 3, RegionWages::default(), None);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn earth_lore_rounds_down() {
        // floor(2 x 1 x 14.1) = floor(28.2) = 28. Rounding to nearest, or up, would say 29. Plus
        // the 14 the same mage earns working, since CAST leaves its month free (`ah-gjq4`).
        let unit = casting_for_wages("Earth_Lore", "EART", 1, "$14.1");
        assert_eq!(unit.income, Some(28 + 14));
    }

    #[test]
    fn earth_lore_does_not_lose_the_wage_s_fraction() {
        // 2 x 1 x 1450 / 100 = 29. Dividing the wage down to whole silver first would say 28,
        // which is what "multiply before dividing" buys. Plus the 14 the mage earns working
        // (`ah-gjq4`).
        let unit = casting_for_wages("Earth_Lore", "EART", 1, "$14.5");
        assert_eq!(unit.income, Some(29 + 14));
    }

    #[test]
    fn a_mage_with_no_earth_lore_skill_earns_nothing() {
        // Nothing from the spell; the 14 is the wage its free month earns (`ah-gjq4`).
        let unit = casting_for_wages("Earth_Lore", "EART", 0, "$14.0");
        assert_eq!(unit.income, Some(14));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn earth_lore_and_a_cast_cost_are_both_counted() {
        // The committed ruleset prices no Earth Lore cast, so the cost is added here: the arm has
        // to earn *and* fall through to the charge below, and nothing else notices if it does not.
        let ruleset = ruleset_pricing_an_earth_lore_cast(50);
        let unit = casting_in(
            "Earth_Lore",
            "EART",
            3,
            paying("$14.0", None),
            Some(&ruleset),
        );
        assert_eq!(unit.income, Some(98));
        assert_eq!(unit.expense, Some(50));
    }

    /// The committed ruleset with a silver cost put on Earth Lore's cast, which the real one
    /// leaves `null`.
    fn ruleset_pricing_an_earth_lore_cast(silver: i64) -> Ruleset {
        let mut json: serde_json::Value = serde_json::from_str(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be JSON");
        json["skills"]["EART"]["cast"] = serde_json::json!({
            "costs": [{ "tag": "SILV", "amount": silver }],
            "transmute": {},
        });
        Ruleset::from_json(&json.to_string()).expect("a priced Earth Lore should still parse")
    }

    #[test]
    fn a_spell_that_earns_nothing_leaves_the_month_alone() {
        let unit = casting("Gate_Lore", "GATE", 1, Some(5000));
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.doubt, None);
    }

    // --- receiving ----------------------------------------------------------------------------

    #[test]
    fn a_gift_counted_for_this_unit_is_income_it_can_name() {
        let receipts = Receipts {
            silver: 200,
            givers: vec!["Paymaster (2390)".to_string()],
        };
        let unit = forecast_unit(
            facts(5, &[], &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.income, Some(200));
        assert_eq!(unit.received, 200);
        assert_eq!(unit.givers, vec!["Paymaster (2390)".to_string()]);
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_gift_is_income_on_top_of_what_the_unit_earns_itself() {
        let receipts = Receipts {
            silver: 200,
            givers: vec!["Paymaster (2390)".to_string()],
        };
        let intents = [placed(Intent::Tax)];
        let unit = forecast_unit(
            facts(8, &intents, &receipts),
            taxable(Some(100_000)),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.income, Some(600));
    }

    #[test]
    fn a_unit_given_nothing_names_nobody() {
        let unit = forecast(5, RegionWages::default(), &[]);
        assert_eq!(unit.received, 0);
        assert!(unit.givers.is_empty());
    }

    #[test]
    fn a_sale_a_cast_and_a_guessed_headcount_are_still_priced() {
        // Neither a sale nor a cast is per-man, so a headcount that is a guess does not stop them
        // being priced - unlike TAX, WORK, STUDY and ENTERTAIN. The bare `SAIL` is what spends the
        // month: without it the unit would be set to work by default, and a defaulted wage *is*
        // per-man (`ah-gjq4`).
        let receipts = Receipts::default();
        let intents = [
            selling("furs", Amount::Exact(10)),
            placed(Intent::MonthLong("SAIL")),
        ];
        let unit = forecast_unit(
            UnitFacts {
                men_estimated: true,
                ..facts(8, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            Lookups {
                sale: &wanted(24, 40, 40),
                ..no_market()
            },
            None,
        );
        assert_eq!(unit.income, Some(240));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_unit_with_no_orders_ends_the_month_holding_what_it_started_with() {
        let receipts = Receipts::default();
        let unit = forecast_unit(
            UnitFacts {
                held: 600,
                ..facts(8, &[], &receipts)
            },
            taxable(Some(100_000)),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.held, 600);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, Some(600));
        assert_eq!(unit.doubt, None);
        assert_eq!(unit.unit_id, "1234");
        assert_eq!(unit.region_id, "mountain (7,53)");
    }

    // --- ah-1wcw.3: what a month spends ------------------------------------------------------

    /// A market selling one thing, for the purchase rules.
    fn sells(price: i64, market_has: i64) -> impl Fn(&str) -> PurchaseAnswer {
        move |_item: &str| PurchaseAnswer::ForSale { price, market_has }
    }

    /// One unit, one set of orders, against a market and a ruleset.
    fn spending(
        held: i64,
        intents: &[PlacedIntent],
        region: RegionWages,
        purchase: &dyn Fn(&str) -> PurchaseAnswer,
        ruleset: Option<&Ruleset>,
    ) -> UnitSilver {
        let receipts = Receipts::default();
        forecast_unit(
            UnitFacts {
                held,
                ..facts(1, intents, &receipts)
            },
            region,
            PoolShares::default(),
            FactionPurse::default(),
            Lookups {
                purchase,
                ..no_market()
            },
            ruleset,
        )
    }

    #[test]
    fn a_buying_unit_pays_the_price_the_market_states() {
        let intents = vec![placed(Intent::Buy {
            amount: Amount::Exact(5),
            item: "grain".to_string(),
        })];
        let unit = spending(0, &intents, RegionWages::default(), &sells(12, 40), None);
        assert_eq!(unit.expense, Some(60));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn buying_what_the_market_does_not_sell_is_doubted() {
        let intents = vec![placed(Intent::Buy {
            amount: Amount::Exact(5),
            item: "Horses".to_string(),
        })];
        let unit = spending(0, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, None);
        assert_eq!(unit.doubt, Some(SilverDoubt::MarketDoesNotSell));
        assert_eq!(unit.doubt_subject.as_deref(), Some("horses"));
    }

    #[test]
    fn buying_all_spends_what_the_unit_can_afford() {
        let intents = vec![placed(Intent::Buy {
            amount: Amount::All { except: 0 },
            item: "grain".to_string(),
        })];
        let unit = spending(500, &intents, RegionWages::default(), &sells(12, 40), None);
        assert_eq!(unit.expense, Some(480));
        assert_eq!(unit.at_month_end, Some(20));
    }

    #[test]
    fn buying_all_takes_no_more_than_the_market_has() {
        let intents = vec![placed(Intent::Buy {
            amount: Amount::All { except: 0 },
            item: "grain".to_string(),
        })];
        let unit = spending(500, &intents, RegionWages::default(), &sells(12, 4), None);
        assert_eq!(unit.expense, Some(48));
    }

    #[test]
    fn buying_all_is_afforded_out_of_what_this_month_earns() {
        let intents = vec![
            placed(Intent::Buy {
                amount: Amount::All { except: 0 },
                item: "grain".to_string(),
            }),
            placed(Intent::Tax),
        ];
        let region = RegionWages {
            tax_base: Some(1000),
            ..RegionWages::default()
        };
        // 50 taxed on top of 10 held buys five at 12, where the 10 alone would buy none.
        let unit = spending(10, &intents, region, &sells(12, 40), None);
        assert_eq!(unit.income, Some(50));
        assert_eq!(unit.expense, Some(60));
        assert_eq!(unit.at_month_end, Some(0));
    }

    #[test]
    fn two_buy_all_orders_spend_in_document_order() {
        let intents = vec![
            placed(Intent::Buy {
                amount: Amount::All { except: 0 },
                item: "grain".to_string(),
            }),
            placed(Intent::Buy {
                amount: Amount::All { except: 0 },
                item: "grain".to_string(),
            }),
        ];
        // 100 buys five at 12 up to the market's 5, leaving 40; the second buys three more.
        let unit = spending(100, &intents, RegionWages::default(), &sells(12, 5), None);
        assert_eq!(unit.expense, Some(96));
        assert_eq!(unit.at_month_end, Some(4));
    }

    #[test]
    fn a_unit_that_gives_silver_away_is_charged_for_it() {
        let intents = vec![placed(Intent::Give {
            to: Party::Unit("1235".to_string()),
            what: Selector::Item("SILV".to_string()),
            amount: Amount::Exact(300),
        })];
        let unit = spending(500, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, Some(300));
        assert_eq!(unit.given_to_nobody, 0);
        assert_eq!(unit.at_month_end, Some(200));
    }

    #[test]
    fn silver_given_to_nobody_is_still_spent() {
        let intents = vec![placed(Intent::Give {
            to: Party::Discard,
            what: Selector::Item("SILV".to_string()),
            amount: Amount::All { except: 0 },
        })];
        let unit = spending(300, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, Some(300));
        assert_eq!(unit.given_to_nobody, 300);
        assert_eq!(unit.at_month_end, Some(0));
    }

    #[test]
    fn giving_away_an_item_costs_no_silver() {
        let intents = vec![placed(Intent::Give {
            to: Party::Discard,
            what: Selector::Item("HORS".to_string()),
            amount: Amount::All { except: 0 },
        })];
        let unit = spending(300, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn giving_away_a_whole_class_of_goods_is_doubted() {
        let intents = vec![placed(Intent::Give {
            to: Party::Unit("1235".to_string()),
            what: Selector::Class("ITEMS".to_string()),
            amount: Amount::All { except: 0 },
        })];
        let unit = spending(500, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, None);
        assert_eq!(unit.doubt, Some(SilverDoubt::GivesAWholeClass));
    }

    #[test]
    fn a_cast_that_consumes_silver_is_charged_for_it() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Cast {
            spell: "create amulet of protection".to_string(),
            arguments: Vec::new(),
        })];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert_eq!(unit.expense, Some(200));
    }

    #[test]
    fn a_cast_that_consumes_items_costs_no_silver() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Cast {
            spell: "enchant armor".to_string(),
            arguments: Vec::new(),
        })];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.doubt, None);
    }

    #[test]
    fn a_spell_the_ruleset_does_not_price_costs_nothing() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Cast {
            spell: "no such spell".to_string(),
            arguments: Vec::new(),
        })];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.doubt, None);
    }

    /// `ah-tdsi`: the faction's unclaimed fund pays for a withdrawal, never the withdrawing
    /// unit's own silver, so the order costs this unit's month nothing at all.
    #[test]
    fn a_withdrawing_unit_pays_nothing_of_its_own() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Withdraw {
            count: 5,
            item: "STON".to_string(),
        })];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert_eq!(unit.expense, Some(0), "the fund pays, not the unit");
        assert_eq!(
            unit.at_month_end,
            Some(500),
            "so the unit keeps what it holds"
        );
        assert_eq!(
            unit.short_on, None,
            "and no shortfall can bite on a withdrawal"
        );
        assert!(
            unit.withdrawing,
            "the hover still needs to know it withdrew"
        );
    }

    /// A withdrawal the ruleset cannot price used to make the whole column unpriceable. It cost the
    /// unit nothing either way, so there is nothing left to doubt (`ah-tdsi`).
    #[test]
    fn a_withdrawal_the_ruleset_cannot_price_still_leaves_an_exact_column() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Withdraw {
            count: 1,
            item: "LEAD".to_string(),
        })];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert_eq!(unit.doubt, None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, Some(500));
        assert!(unit.withdrawing);
    }

    /// The same with no ruleset at all - the case a report cached before `ah-1wcw.6` presents.
    #[test]
    fn a_withdrawal_with_no_ruleset_at_all_still_leaves_an_exact_column() {
        let intents = vec![placed(Intent::Withdraw {
            count: 1,
            item: "STON".to_string(),
        })];
        let unit = spending(500, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.doubt, None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, Some(500));
        assert!(unit.withdrawing);
    }

    /// A withdrawal of nothing takes nothing from the fund, so there is no zero for the hover to
    /// explain and no note to earn (`ah-tdsi`).
    #[test]
    fn withdrawing_a_count_of_zero_leaves_the_flag_false() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Withdraw {
            count: 0,
            item: "STON".to_string(),
        })];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert!(!unit.withdrawing);
    }

    /// Guards a `withdrawing` set by anything other than a real `WITHDRAW` order.
    #[test]
    fn withdrawing_nothing_leaves_the_flag_false() {
        let ruleset = ruleset();
        let intents = vec![placed(Intent::Work)];
        let unit = spending(
            500,
            &intents,
            RegionWages::default(),
            &no_purchases,
            Some(&ruleset),
        );
        assert!(!unit.withdrawing);
    }

    /// One shared empty [`Receipts`], so the helpers below can hand out a `'static` borrow
    /// instead of every test declaring a local that has to outlive its facts.
    fn no_receipts() -> &'static Receipts {
        static NOTHING: std::sync::OnceLock<Receipts> = std::sync::OnceLock::new();
        NOTHING.get_or_init(Receipts::default)
    }

    fn item(amount: i64, tag: &str) -> ItemAmount {
        ItemAmount {
            amount,
            name: tag.to_lowercase(),
            tag: tag.to_string(),
        }
    }

    /// A unit described only by what it is made of, for the upkeep rules.
    fn made_of<'a>(
        men: i64,
        men_by_race: &'a [ItemAmount],
        items: &'a [ItemAmount],
        flags: &'a [String],
    ) -> UnitFacts<'a> {
        UnitFacts {
            unit_id: "1234",
            region_id: "mountain (7,53)",
            held: 0,
            men,
            men_estimated: false,
            men_by_race,
            items,
            flags,
            skills: &[],
            intents: &[],
            receipts: no_receipts(),
        }
    }

    fn consuming() -> Vec<String> {
        vec!["Consuming Unit's Food".to_string()]
    }

    #[test]
    fn a_unit_of_ordinary_characters_owes_ten_each() {
        let men = [item(6, "MAN")];
        assert_eq!(unit_upkeep(&made_of(6, &men, &[], &[])), Some(60));
    }

    #[test]
    fn a_leader_owes_fifty() {
        let men = [item(1, "LEAD")];
        assert_eq!(unit_upkeep(&made_of(1, &men, &[], &[])), Some(50));
    }

    #[test]
    fn a_mixed_unit_owes_both() {
        let men = [item(2, "LEAD"), item(5, "MAN")];
        assert_eq!(unit_upkeep(&made_of(7, &men, &[], &[])), Some(150));
    }

    #[test]
    fn a_unit_with_no_breakdown_is_all_ordinary_characters() {
        assert_eq!(unit_upkeep(&made_of(4, &[], &[], &[])), Some(40));
    }

    #[test]
    fn a_unit_whose_headcount_is_a_guess_has_no_upkeep() {
        let mut facts = made_of(4, &[], &[], &[]);
        facts.men_estimated = true;
        assert_eq!(unit_upkeep(&facts), None);
    }

    #[test]
    fn a_consuming_unit_pays_with_its_own_food_first() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "GRAI")];
        let flags = consuming();
        assert_eq!(unit_upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    #[test]
    fn a_unit_that_is_not_consuming_pays_silver_even_holding_food() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "GRAI")];
        assert_eq!(unit_upkeep(&made_of(1, &men, &food, &[])), Some(50));
    }

    #[test]
    fn food_covers_fifty_a_time_rounding_up() {
        let men = [item(1, "MAN")];
        let food = [item(1, "GRAI")];
        let flags = consuming();
        assert_eq!(unit_upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    #[test]
    fn food_runs_out_and_the_rest_is_silver() {
        let men = [item(16, "LEAD")];
        let food = [item(5, "GRAI")];
        let flags = consuming();
        assert_eq!(unit_upkeep(&made_of(16, &men, &food, &flags)), Some(550));
    }

    #[test]
    fn only_the_four_food_items_the_rules_name_count() {
        let men = [item(1, "LEAD")];
        let not_food = [item(9, "IRON")];
        let flags = consuming();
        assert_eq!(unit_upkeep(&made_of(1, &men, &not_food, &flags)), Some(50));
    }

    #[test]
    fn a_faction_food_consumer_spends_its_own_food_too() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "MEAL")];
        let flags = vec!["consuming faction's food".to_string()];
        assert_eq!(unit_upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    #[test]
    fn a_forecast_carries_upkeep_separately_from_expense() {
        let men = [item(1, "LEAD")];
        let mut facts = made_of(1, &men, &[], &[]);
        facts.held = 200;
        let unit = forecast_unit(
            facts,
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        );
        assert_eq!(unit.upkeep, Some(50));
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, Some(200));
    }

    fn forecast_of(facts: UnitFacts<'_>) -> UnitSilver {
        forecast_unit(
            facts,
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            no_market(),
            None,
        )
    }

    #[test]
    fn a_unit_fed_by_its_own_food_records_what_it_covered() {
        let men = [item(6, "MAN")];
        let food = [item(2, "GRAI")];
        let flags = consuming();
        let unit = forecast_of(made_of(6, &men, &food, &flags));
        assert_eq!(unit.own_food_covered, 60);
        assert_eq!(unit.faction_food_covered, 0);
        assert_eq!(unit.upkeep, Some(0));
    }

    #[test]
    fn a_unit_that_is_not_consuming_covers_nothing_with_food() {
        let men = [item(6, "MAN")];
        let food = [item(2, "GRAI")];
        let unit = forecast_of(made_of(6, &men, &food, &[]));
        assert_eq!(unit.own_food_covered, 0);
        assert_eq!(unit.upkeep, Some(60));
    }

    #[test]
    fn a_unit_owing_nothing_covers_nothing() {
        let food = [item(2, "GRAI")];
        let flags = consuming();
        let unit = forecast_of(made_of(0, &[], &food, &flags));
        assert_eq!(unit.own_food_covered, 0);
        assert_eq!(unit.upkeep, Some(0));
    }

    #[test]
    fn a_unit_with_no_food_covers_nothing() {
        let men = [item(6, "MAN")];
        let flags = consuming();
        let unit = forecast_of(made_of(6, &men, &[], &flags));
        assert_eq!(unit.own_food_covered, 0);
        assert_eq!(unit.upkeep, Some(60));
    }

    #[test]
    fn a_unit_whose_headcount_is_a_guess_covers_nothing() {
        let men = [item(6, "MAN")];
        let food = [item(2, "GRAI")];
        let flags = consuming();
        let mut facts = made_of(6, &men, &food, &flags);
        facts.men_estimated = true;
        let unit = forecast_of(facts);
        assert_eq!(unit.own_food_covered, 0);
    }
}

#[cfg(test)]
mod faction_food_tests {
    use super::*;

    fn claim(id: &str, spare_food: i64, owed: i64, draws: bool) -> FoodClaim {
        FoodClaim {
            unit_id: id.to_string(),
            spare_food,
            owed_after_own_food: owed,
            draws_on_pool: draws,
        }
    }

    #[test]
    fn faction_food_feeds_every_unit_that_needs_it() {
        let claims = [
            claim("quartermaster", 6, 0, false),
            claim("a", 0, 60, true),
            claim("b", 0, 80, true),
        ];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&Some(0)));
        assert_eq!(fed.get("b"), Some(&Some(0)));
    }

    #[test]
    fn a_pool_too_small_doubts_every_unit_that_contends() {
        let claims = [
            claim("quartermaster", 3, 0, false),
            claim("a", 0, 60, true),
            claim("b", 0, 80, true),
        ];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&None));
        assert_eq!(fed.get("b"), Some(&None));
    }

    #[test]
    fn a_unit_that_does_not_draw_on_the_pool_is_untouched() {
        let claims = [
            claim("quartermaster", 6, 50, false),
            claim("a", 0, 60, true),
        ];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("quartermaster"), None);
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }

    #[test]
    fn food_held_by_a_unit_that_is_not_consuming_still_fills_the_pool() {
        let claims = [
            claim("quartermaster", 2, 50, false),
            claim("a", 0, 60, true),
        ];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }

    #[test]
    fn a_unit_owing_nothing_after_its_own_food_claims_nothing() {
        let claims = [claim("fed", 0, 0, true), claim("a", 1, 50, true)];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("fed"), None);
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }

    #[test]
    fn a_pool_of_exactly_enough_feeds_everybody() {
        let claims = [
            claim("quartermaster", 4, 0, false),
            claim("a", 0, 60, true),
            claim("b", 0, 80, true),
        ];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&Some(0)));
        assert_eq!(fed.get("b"), Some(&Some(0)));
    }

    /// An empty pool is exact, not doubtful: with no food in the hex nobody eats, so every unit
    /// keeps what step 1 left it. Settled with the navigator on 2026-08-23 - the plan doubted this
    /// case, which put `?` on eleven exactly-known figures in the committed turn.
    #[test]
    fn an_empty_hex_pool_leaves_every_claimant_exactly_where_it_was() {
        let claims = [claim("a", 0, 60, true)];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), None);
    }

    /// The boundary the empty-pool rule must not swallow: one item is food, and short is short.
    #[test]
    fn a_pool_of_one_item_still_doubts_units_it_cannot_all_feed() {
        let claims = [
            claim("a", 1, 60, true),
            claim("b", 0, 60, true),
            claim("c", 0, 60, true),
        ];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&None));
        assert_eq!(fed.get("b"), Some(&None));
    }

    /// Contention needs two contenders. A lone claimant simply eats what there is, so its figure
    /// is exact however short the hex is - settled with the navigator on 2026-08-23, by the same
    /// reasoning that made an empty pool exact.
    #[test]
    fn a_lone_claimant_eats_what_there_is_rather_than_being_doubted() {
        let claims = [claim("quartermaster", 1, 0, false), claim("a", 0, 60, true)];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&Some(10)));
    }

    /// Steps 5 and 6 draw on the same hex pool, so step 2 must say what it left behind.
    #[test]
    fn a_pool_that_feeds_everybody_says_what_is_left() {
        let claims = [
            claim("quartermaster", 5, 0, false),
            claim("a", 0, 60, true),
            claim("b", 0, 40, true),
        ];
        let pass = feed_from_faction_food(&claims);
        assert_eq!(pass.settled.get("a"), Some(&Some(0)));
        assert_eq!(pass.settled.get("b"), Some(&Some(0)));
        assert_eq!(pass.pool_left, Some(2));
    }

    #[test]
    fn an_empty_pool_leaves_nothing() {
        let claims = [claim("a", 0, 60, true)];
        assert_eq!(feed_from_faction_food(&claims).pool_left, Some(0));
    }

    #[test]
    fn a_lone_short_claimant_eats_what_there_is() {
        let claims = [
            claim("quartermaster", 1, 0, false),
            claim("a", 0, 200, true),
        ];
        let pass = feed_from_faction_food(&claims);
        assert_eq!(pass.settled.get("a"), Some(&Some(150)));
        assert_eq!(pass.pool_left, Some(0));
    }

    #[test]
    fn a_contended_pool_cannot_say_what_is_left() {
        let claims = [
            claim("quartermaster", 1, 0, false),
            claim("a", 0, 60, true),
            claim("b", 0, 80, true),
        ];
        assert_eq!(feed_from_faction_food(&claims).pool_left, None);
    }

    /// One item is worth a whole 50 even against a smaller debt, and a lone claimant cannot be
    /// left owing less than nothing.
    #[test]
    fn a_lone_claimant_owes_nothing_once_the_pool_covers_it() {
        let claims = [claim("quartermaster", 1, 0, false), claim("a", 0, 30, true)];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }
}

#[cfg(test)]
mod unclaimed_fund_tests {
    use super::*;

    fn claim(id: &str, short: i64) -> UpkeepClaim {
        UpkeepClaim {
            unit_id: id.to_string(),
            short,
        }
    }

    #[test]
    fn the_fund_pays_every_unit_that_cannot_pay_its_own_upkeep() {
        let claims = [claim("a", 60), claim("b", 60), claim("c", 40)];
        let settled = settle_unclaimed(&claims, Some(8450));
        assert_eq!(settled.covered.get("a"), Some(&60));
        assert_eq!(settled.covered.get("b"), Some(&60));
        assert_eq!(settled.covered.get("c"), Some(&40));
        assert_eq!(settled.owed, 160);
        assert_eq!(settled.available, 8450);
        assert_eq!(settled.short, 0);
        assert!(settled.active());
    }

    #[test]
    fn the_fund_pays_nobody_when_it_cannot_pay_them_all() {
        let claims = [claim("a", 60), claim("b", 60), claim("c", 40)];
        let settled = settle_unclaimed(&claims, Some(100));
        assert!(settled.covered.is_empty());
        assert_eq!(settled.claimants.len(), 3);
        assert_eq!(settled.short, 60);
        assert!(settled.active());
    }

    #[test]
    fn a_fund_the_report_never_stated_settles_nothing() {
        let claims = [claim("a", 60)];
        let settled = settle_unclaimed(&claims, None);
        assert_eq!(settled, UpkeepSettlement::default());
        assert!(!settled.active());
    }

    #[test]
    fn a_fund_the_claims_emptied_settles_nothing() {
        let claims = [claim("a", 60)];
        let settled = settle_unclaimed(&claims, Some(0));
        assert_eq!(settled, UpkeepSettlement::default());
        assert!(!settled.active());
    }

    #[test]
    fn a_fund_nobody_claims_from_is_not_active() {
        let settled = settle_unclaimed(&[], Some(8450));
        assert_eq!(settled.available, 8450);
        assert_eq!(settled.owed, 0);
        assert!(settled.covered.is_empty());
        assert!(settled.claimants.is_empty());
        assert!(!settled.active());
    }

    #[test]
    fn a_unit_owing_nothing_is_no_claimant() {
        let claims = [claim("a", 0), claim("b", -20), claim("c", 40)];
        let settled = settle_unclaimed(&claims, Some(8450));
        assert_eq!(settled.claimants.len(), 1);
        assert!(settled.claimants.contains("c"));
        assert_eq!(settled.owed, 40);
        assert_eq!(settled.covered.get("a"), None);
        assert_eq!(settled.covered.get("b"), None);
    }
}

#[cfg(test)]
mod combat_ready_tests {
    use super::*;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    fn item(tag: &str, amount: i64) -> ItemAmount {
        ItemAmount {
            amount,
            name: tag.to_lowercase(),
            tag: tag.to_string(),
        }
    }

    fn skill(tag: &str, level: u32) -> Skill {
        Skill {
            name: tag.to_lowercase(),
            tag: tag.to_string(),
            level,
            points: 0,
        }
    }

    /// A unit with a headcount, whatever it holds and whatever flags it carries.
    fn unit<'a>(
        men: i64,
        items: &'a [ItemAmount],
        flags: &'a [String],
        skills: &'a [Skill],
        receipts: &'a Receipts,
    ) -> UnitFacts<'a> {
        UnitFacts {
            unit_id: "683",
            region_id: "mountain (36,4)",
            held: 0,
            men,
            men_estimated: false,
            men_by_race: &[],
            items,
            flags,
            skills,
            intents: &[],
            receipts,
        }
    }

    fn count(men: i64, items: &[ItemAmount], flags: &[&str], skills: &[Skill]) -> Option<i64> {
        let receipts = Receipts::default();
        let flags: Vec<String> = flags.iter().map(|flag| (*flag).to_string()).collect();
        combat_ready(
            &unit(men, items, &flags, skills, &receipts),
            Some(&ruleset()),
        )
    }

    /// "enough combat ready men in the region to tax half of the available money in the region" -
    /// a taxer collects `TAX_PER_MAN`, so half a base of 8,963 needs 90 men.
    #[test]
    fn a_region_needs_a_hundredth_of_its_tax_base_in_men() {
        assert_eq!(pillage_threshold(8963), 90);
        assert_eq!(pillage_threshold(100), 1);
        assert_eq!(pillage_threshold(101), 2);
        assert_eq!(pillage_threshold(0), 0);
    }

    #[test]
    fn a_unit_with_no_weapons_is_not_combat_ready() {
        assert_eq!(count(50, &[], &[], &[]), Some(0));
    }

    #[test]
    fn a_unit_counts_one_man_per_weapon() {
        assert_eq!(count(50, &[item("SWOR", 10)], &[], &[]), Some(10));
    }

    #[test]
    fn weapons_beyond_the_headcount_do_not_add_men() {
        assert_eq!(count(5, &[item("SWOR", 10)], &[], &[]), Some(5));
    }

    #[test]
    fn a_crossbow_counts_only_for_a_unit_that_can_use_it() {
        assert_eq!(count(10, &[item("XBOW", 10)], &[], &[]), Some(0));
        assert_eq!(
            count(10, &[item("XBOW", 10)], &[], &[skill("XBOW", 1)]),
            Some(10)
        );
    }

    /// `needs` is a *skill* tag, not the item's own: `DBOW` is wielded with `LBOW`. Reading it as
    /// the item's own tag looks right for `XBOW` by coincidence, and this is what separates them.
    #[test]
    fn a_double_bow_needs_longbow_not_its_own_tag() {
        assert_eq!(
            count(10, &[item("DBOW", 10)], &[], &[skill("LBOW", 1)]),
            Some(10)
        );
        assert_eq!(
            count(10, &[item("DBOW", 10)], &[], &[skill("XBOW", 1)]),
            Some(0)
        );
    }

    #[test]
    fn an_avoiding_unit_has_no_combat_ready_men() {
        assert_eq!(count(50, &[item("SWOR", 50)], &["avoiding"], &[]), Some(0));
    }

    /// `behind` is not consulted: a unit in the back rank still fights.
    #[test]
    fn a_behind_unit_still_counts() {
        assert_eq!(count(50, &[item("SWOR", 50)], &["behind"], &[]), Some(50));
    }

    /// `None`, not 0: a guessed headcount cannot be compared against a threshold, and the guess
    /// might be what carries the faction over it.
    #[test]
    fn a_guessed_headcount_cannot_be_counted() {
        let receipts = Receipts::default();
        let items = [item("SWOR", 50)];
        let facts = UnitFacts {
            men_estimated: true,
            ..unit(50, &items, &[], &[], &receipts)
        };
        assert_eq!(combat_ready(&facts, Some(&ruleset())), None);
    }

    /// Nothing can be told about weapons without the catalogue that says which items are weapons.
    #[test]
    fn without_a_ruleset_nothing_can_be_counted() {
        let receipts = Receipts::default();
        let items = [item("SWOR", 50)];
        assert_eq!(
            combat_ready(&unit(50, &items, &[], &[], &receipts), None),
            None
        );
    }
}
