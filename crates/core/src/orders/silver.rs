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

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::movement::rules::{CastCost, CastOutput, ItemKind, Production, Ruleset, SkillEntry};
use crate::orders::forms::{Amount, Party, Selector};
use crate::orders::intents::{works_by_default, Intent, PlacedIntent};
use crate::orders::semantics::{counted_with_singular, FormedSubject, Plurals};
use crate::orders::targets::{give_outcome, give_target_label, GiveOutcome, GiveReach};
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

/// One kind of food a unit or hex holds, priced by the ruleset for maintenance.
///
/// The rules page (`rules/economy_maintenance`) says one food substitutes for each 50 silver of
/// maintenance owed, while `data/GRAI`, `data/LIVE`, `data/FISH` and `data/MEAL` each state 30.
/// Generation resolves the disagreement with the rules/economy_maintenance value of 50 while
/// preserving each item's source description. Every food carries its generated value from
/// `ItemEntry::maintenance_value`, and an item the catalogue does not price is not food.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoodAmount {
    pub tag: String,
    pub amount: i64,
    pub maintenance_value: i64,
}

/// What consuming food off a stock paid, and what it cost in items.
///
/// Built by [`consume_food`], which removes the consumed items from the stock it is handed. The
/// silver covered and the item counts are read straight off this rather than re-derived from a
/// value, so the two can never drift.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct FoodUse {
    /// Silver of maintenance the eaten food paid, never more than the debt it was set against.
    covered: i64,
    /// The items eaten, per tag, in the order they were consumed.
    consumed: Vec<FoodAmount>,
}

impl FoodUse {
    /// How many items were eaten in all.
    fn items(&self) -> i64 {
        self.consumed.iter().map(|entry| entry.amount).sum()
    }

    /// The tag of the eaten food when it was all one kind; `None` when several kinds were eaten,
    /// because the hover cannot then name a single food.
    fn lone_tag(&self) -> Option<String> {
        let mut eaten = self.consumed.iter().filter(|entry| entry.amount > 0);
        let first = eaten.next()?;
        eaten
            .all(|entry| entry.tag == first.tag)
            .then(|| first.tag.clone())
    }
}

/// Builds a food stock from a unit's inventory, keeping only what the ruleset prices for
/// maintenance.
///
/// A missing ruleset, an unknown tag, an absent `maintenance_value`, or a value of zero or less is
/// not food and contributes nothing: the conservative reading is that an item the catalogue cannot
/// price as food does not feed a unit, so its maintenance stays owed in full and known.
fn food_stock(items: &[ItemAmount], ruleset: Option<&Ruleset>) -> Vec<FoodAmount> {
    let Some(ruleset) = ruleset else {
        return Vec::new();
    };
    items
        .iter()
        .filter(|item| item.amount > 0)
        .filter_map(|item| {
            let entry = ruleset.items.get(&item.tag.to_ascii_uppercase())?;
            let value = entry.maintenance_value?;
            (value > 0).then(|| FoodAmount {
                tag: item.tag.to_ascii_uppercase(),
                amount: item.amount,
                maintenance_value: value,
            })
        })
        .collect()
}

/// Spends food off `stock` against `owed` silver of maintenance, returning what it paid and cost.
///
/// The one place maintenance food arithmetic lives - steps 1, 2, 5 and 6 of the payment order all
/// go through here. Food is eaten least valuable first (`maintenance_value` then `tag`): where a
/// future ruleset gives foods different values but does not say which the engine eats, spending the
/// cheapest first is the conservative direction - it eats more items for the same relief and so
/// cannot overstate the maintenance a hex can pay. A fractional maintenance cost still consumes a
/// whole unit of food, so each entry rounds its need up; the covered silver is capped at the
/// remaining debt, and all arithmetic saturates so an absurd headcount cannot overflow it.
fn consume_food(stock: &mut Vec<FoodAmount>, owed: i64) -> FoodUse {
    stock.sort_by(|a, b| {
        a.maintenance_value
            .cmp(&b.maintenance_value)
            .then_with(|| a.tag.cmp(&b.tag))
    });

    let mut remaining = owed.max(0);
    let mut use_ = FoodUse::default();
    for entry in stock.iter_mut() {
        if remaining <= 0 {
            break;
        }
        if entry.maintenance_value <= 0 || entry.amount <= 0 {
            continue;
        }
        let needed =
            remaining.saturating_add(entry.maintenance_value - 1) / entry.maintenance_value;
        let used = entry.amount.min(needed);
        if used <= 0 {
            continue;
        }
        let gain = used.saturating_mul(entry.maintenance_value).min(remaining);
        remaining -= gain;
        entry.amount -= used;
        use_.covered = use_.covered.saturating_add(gain);
        use_.consumed.push(FoodAmount {
            tag: entry.tag.clone(),
            amount: used,
            maintenance_value: entry.maintenance_value,
        });
    }
    stock.retain(|entry| entry.amount > 0);
    use_
}

/// The part of a unit's own food a hex still holds, per tag, for step 5's cap.
///
/// Step 2 pools every unit's spare food, so a unit's larder at step 5 is only what survived the
/// pool. Matching per tag - not by total count - is what the pool remainder makes possible: it
/// names exactly which foods are left, so a unit whose grain the pool ate cannot spend it again.
fn own_available(own: &[FoodAmount], remaining: &[FoodAmount]) -> Vec<FoodAmount> {
    own.iter()
        .filter_map(|food| {
            let held = remaining
                .iter()
                .find(|entry| entry.tag == food.tag)
                .map_or(0, |entry| entry.amount);
            let amount = food.amount.min(held);
            (amount > 0).then(|| FoodAmount {
                tag: food.tag.clone(),
                amount,
                maintenance_value: food.maintenance_value,
            })
        })
        .collect()
}

/// Removes the items a unit's own food consumed at step 5 from the shared hex remainder, so step 6
/// draws only on what is genuinely left.
fn remove_from_stock(stock: &mut Vec<FoodAmount>, consumed: &[FoodAmount]) {
    for eaten in consumed {
        if let Some(entry) = stock.iter_mut().find(|entry| entry.tag == eaten.tag) {
            entry.amount = (entry.amount - eaten.amount).max(0);
        }
    }
    stock.retain(|entry| entry.amount > 0);
}

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
    /// `max(0, expense - (held + income + shared_silver_for_orders - late_income))`. `Some(0)`
    /// means its orders are affordable; anything positive means the game will refuse something,
    /// however healthy `at_month_end` looks.
    ///
    /// **Counts the hex's shared purse.** `ah-1wcw.1` decided the opposite - this unit alone, with
    /// the purse left to the advisory check - and the navigator reversed that on seeing what it
    /// looks like on the screen: a unit whose neighbour is lending it the money is not short, and
    /// saying so on the one column a player reads is wrong (`ah-moq3`). Do not restore it.
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
    /// Silver counted into `income` because this unit's own `TAKE` orders pull it from units the
    /// report shows in this hex.
    pub taken: i64,
    /// Those sources, as `<name> (<id>)`, so the hover can name them.
    pub taken_from: Vec<String>,
    /// Silver counted into `income` because this unit's own `TAKE` orders pull it from units the
    /// report does **not** show in this hex (`ah-awcm`).
    pub taken_unshown: i64,
    /// Those sources, as `unit <id>`: a unit the report does not show has no name to give.
    pub taken_unshown_from: Vec<String>,
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
    /// What a faction-mate's `SHARE` lends this unit for its orders, at the hex's discretionary
    /// purse. `0` for every unit nothing lent to, and `0`, deliberately, for every unit in a hex
    /// whose purse could not cover every claimant - where which unit was fed cannot be told and
    /// the figure stays pessimistic, exactly as `shared_silver_covered` does for maintenance
    /// (`ah-moq3`).
    ///
    /// Discretionary, unlike its maintenance twin above: the `SHARE` flag is what opens this
    /// purse, and `semantics::sharing_purse` settles it - the same computation the
    /// `not-enough-silver` warning is judged against, so the two surfaces cannot disagree.
    pub shared_silver_for_orders: i64,
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
    /// How many fewer men work this unit's `PRODUCE` this month than its report showed, because
    /// `GIVE` and `TAKE` resolve before either PRODUCE phase (`rules/sequenceofevents`).
    ///
    /// `0` for a unit with no priceable `PRODUCE` order, exactly as [`UnitSilver::produced`] is,
    /// and `0` for one that *gained* men - which produces more and needs no sentence (`ah-qct4`).
    pub production_men_left: i64,
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
    /// The region's own word for what this unit is producing, from its `Products` line - `iron`,
    /// `horses`, `floater hides` - for the one sentence that says it.
    ///
    /// The region's word and **not** the catalogue's, which is the singular: the `Products` line
    /// writes `horses`, `herbs` and `floater hides` where the catalogue writes `horse`, `herb` and
    /// `floater hide`, and this sentence needs a bare noun rather than a counted one.
    ///
    /// `None` unless [`UnitSilver::production_capped_by`] is [`ProductionCap::Region`].
    pub production_region_name: Option<String>,
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
    /// How many of the item its `CAST` order creates this unit will make. `0` for a unit with no
    /// such order, and for a mage whose level makes none of the thing (`ah-ofpb.4`).
    pub cast_made: i64,
    /// `cast_made`, named and counted the way a finding names an item - "2 amulets of protection".
    /// The interface cannot do this itself: the unit does not hold the thing yet, so there is
    /// nothing in its inventory to read a plural off, and 84 of the 114 items this corpus shows
    /// with a count above one pluralise irregularly (`counted_with_singular`). `None` for a unit
    /// with no priceable cast, and for a spell that creates nothing an item catalogue can carry -
    /// construct gate makes a Gate.
    pub cast_made_named: Option<String>,
    /// How many its level alone would make. Equal to `cast_made` unless `cast_capped_by` says
    /// something stopped it.
    pub cast_wanted: i64,
    /// What stopped it making `cast_wanted`, or `None` when nothing did. Drives the hover's note
    /// and nothing else - the figures above are already the capped ones.
    pub cast_capped_by: Option<ProductionCap>,
    /// Whether this unit's `CAST` order summons rather than makes, which decides one word in the
    /// cap sentence: "not the 12 its level could **summon**" against "could **make**"
    /// (`ah-ofpb.5`). `false` for a unit with no priceable cast.
    pub cast_summons: bool,
    /// Set when this unit is not one the report shows but one this month's `FORM` orders create -
    /// see [`FormedSubject`]. The interface names the unit by its alias and sends a click to
    /// `formed_by`, since a unit that does not exist cannot be selected.
    pub formed: Option<FormedSubject>,
    /// This unit's `BUY ALL` orders, settled, in document order. Empty for the overwhelming
    /// majority of units, and empty for a unit whose sums are doubted - the deferred pass does
    /// not run at all then, exactly as it does not today.
    pub buy_all: Vec<BuyAllShown>,
}

/// One `BUY ALL` on one unit, as the ITEMS and SILVER hovers say it.
///
/// A `Vec` on [`UnitSilver`] rather than a set of flat fields: a unit may write several `BUY ALL`
/// lines and each gets its own sentence (the navigator's Q4), and every field here is meaningless
/// without the others.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct BuyAllShown {
    /// `"19 grain"`, `"1 sword"`, `"8 nomads"`, `"no grain"` - counted and pluralised **by the
    /// core**, because the unit does not hold these goods yet and TS cannot pluralise what it was
    /// never given. The same reason `castMadeNamed` is pre-counted (`ah-ofpb.4`).
    pub bought_named: String,
    /// The whole line, named the same way, for the `Shared` sentence.
    pub market_named: String,
    pub bought: i64,
    pub affordable: i64,
    pub available: i64,
    pub market_has: i64,
    /// How many of these goods this unit's own earlier `BUY` lines already took out of
    /// `available`. Zero for the first such line, which is what keeps every shipped sentence
    /// unchanged (`ah-lauy`).
    pub already_bought: i64,
    /// What the unit holds when this line is reached, for the "cannot afford one" sentence.
    pub silver_available: i64,
    /// The line's unit price, for the same sentence.
    pub price: i64,
    pub capped_by: BuyAllCap,
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
    /// Silver the order spends. Never negative. An order does not both earn and spend, but the
    /// field is separate rather than a signed `earns` so a caller that tracks the two totals apart
    /// - which [`forecast_unit`] does, as `income` and `expense` - needs no sign convention.
    pub spends: i64,
    /// Why it could not be priced, or `None`. A doubt and a non-zero figure never occur together.
    pub doubt: Option<SilverDoubt>,
}

/// What shape of transfer a `GIVE` names, once the selector and the amount are read.
///
/// The two surfaces price a transfer from different information - the column has no running
/// balance and the ledger does - so what they must agree on is not the number but *which* of these
/// three cases they are in. A new [`Selector`] variant lands here once instead of in two arms that
/// would silently disagree (`ah-lu0f`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferShape {
    /// A whole class of goods, or the unit itself. What leaves depends on classifying everything
    /// the unit holds, which neither surface models: the column doubts, the ledger doubts.
    Unpriceable,
    /// A stated quantity of one item. The one shape both surfaces price identically.
    Exact(i64),
    /// `ALL`, less a reserve. Each surface resolves it against its own notion of what the unit
    /// has: the column defers to its running total ([`Deferred::GiveAllSilver`]), the ledger reads
    /// its balance. Deliberately *not* resolved here, and deliberately not clamped - there is no
    /// holding here to clamp against, so each caller keeps its own `.max(0)`.
    All { except: i64 },
}

/// Reads a transfer's selector and amount into the shape both surfaces must agree about.
#[must_use]
pub fn transfer_shape(what: &Selector, amount: &Amount) -> TransferShape {
    match what {
        Selector::Class(_) | Selector::WholeUnit => TransferShape::Unpriceable,
        Selector::Item(_) => match amount {
            Amount::Exact(count) => TransferShape::Exact(*count),
            Amount::All { except } => TransferShape::All { except: *except },
        },
    }
}

/// Why a unit's month could not be priced. One variant per sentence the interface shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum SilverDoubt {
    /// `TAX` where the report stated no tax base for the region.
    UnknownTaxBase,
    /// `TAKE ... ALL SILV` from another unit: what that unit will have left to give depends on its
    /// own month, which this per-unit pass has not run. Not the same as a source the report never
    /// shows - that is not counted at all and raises no doubt (`ah-awcm`).
    TakesAllFromAnother,
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
    /// The faction's combat ready men in this hex cannot be added up, so the pillage threshold
    /// cannot be tested. Distinct from [`SilverDoubt::EstimatedMen`]: this unit's own headcount
    /// may be exact, and usually is - what is missing belongs to the hex.
    UnknownCombatReady,
    /// This month's arrivals cannot be merged into the unit's skills, so PRODUCE is uncountable.
    UnknownSkillsAfterArrivals,
    /// `GIVE` of silver to a target the report cannot settle: `rules/give` lets a unit we cannot
    /// see receive it once its faction has declared us Friendly, and no report carries that
    /// declaration - so whether the silver leaves cannot be said (`ah-66yi`).
    GiveTargetUncertain,
    /// A later order prices goods an earlier `GIVE` may or may not have taken away, so what this
    /// unit earns or spends afterwards cannot be said (`ah-66yi`).
    GiveConsequencesUncertain,
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
///
/// TAX is priced before the market opens, so it reads `facts.men`, the early picture; WORK and
/// ENTERTAIN are priced after it, so they read `facts.late().men` instead
/// (`rules/sequenceofevents`, `ah-dxfd.2`).
#[must_use]
pub fn pool_wants(
    facts: &UnitFacts<'_>,
    region: RegionWages,
    ruleset: Option<&Ruleset>,
) -> PoolWants {
    let mut wants = PoolWants::default();
    // A unit-level term, like the tax term in [`forecast_unit`]: a unit taxes by its flag with no
    // `TAX` order at all, and a flagged taxer contends for the region's base like any other - or
    // every other taxer's share comes out too large (`ah-fvzu`, `ah-t2pn.1`).
    if taxes(facts.flags, facts.intents) {
        wants.tax = taxing_men(facts, ruleset).saturating_mul(TAX_PER_MAN);
    }
    let late = facts.late();
    for placed in facts.intents {
        match &placed.intent {
            Intent::Tax => {}
            Intent::Work => {
                wants.wages = late.men.saturating_mul(region.wage_centis.unwrap_or(0)) / 100;
            }
            Intent::Entertain => {
                wants.entertainment = late
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
        wants.wages = late.men.saturating_mul(region.wage_centis.unwrap_or(0)) / 100;
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
    /// What the region leaves this unit of the goods a `PRODUCE` names, once its faction-mates in
    /// the same hex have been settled against the hex's `Products` line (`ah-256d`).
    pub region_share: &'a dyn Fn(&str) -> RegionShare,
    /// The region's own word for the goods a `PRODUCE` names, from its `Products` line. `None`
    /// where the region lists none of them, which is also when nothing is produced at all.
    pub region_product_name: &'a dyn Fn(&str) -> Option<String>,
    /// A count of an item, named and pluralised the way every finding names one. Here for the same
    /// reason `item_name` is: what a cast is about to create is not in the unit's inventory, so
    /// the interface cannot pluralise it (`ah-ofpb.4`).
    pub counted_item: &'a dyn Fn(i64, &str) -> String,
    /// `"19 grain"`, `"no grain"` - [`Lookups::counted_item`] with zero written as a word.
    ///
    /// A separate lookup rather than a rule TS applies: pluralisation lives in the core's
    /// `Plurals` map, and a sentence that states an absence reads "buys no grain", never
    /// "buys 0 grain". `counted_item` itself is left alone - every other caller states a
    /// quantity rather than an absence.
    pub counted_or_none: &'a dyn Fn(i64, &str) -> String,
    /// Whether `GIVE ... ALL <class>` carries the holder's silver out with it, or `None` where the
    /// catalogue cannot say which items that class holds. See `semantics::class_carries_silver`,
    /// which is the one implementation - the column and the ledger must not answer this two ways.
    pub class_carries_silver: &'a dyn Fn(&str) -> Option<bool>,
    /// Where a `GIVE`'s target stands. A closure for the same reason `item_tag` is one - resolving
    /// a party against a hex is `super::semantics`' business, and this module holds no hex types.
    ///
    /// [`GiveReach::Nowhere`] is a unit number the report shows elsewhere, a `NEW` alias no `FORM`
    /// here creates, and a unit giving to itself: the server refuses all three, so the order costs
    /// this unit nothing (`ah-vcp8.2`). The arm applies [`give_outcome`] to the actual silver tag
    /// for the rest, so a visible foreign gift of silver is still an expense and one aimed at a
    /// unit the report never prints is a doubt (`rules/give`, `ah-66yi`).
    pub give_reach: &'a dyn Fn(&Party) -> GiveReach,
    /// The target a `GIVE` this month left uncertain named, for an upper-case item tag, or `None`
    /// where this unit's holding of that tag survives its gifts intact (`ah-66yi`).
    pub uncertain_after_gifts: &'a dyn Fn(&str) -> Option<String>,
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
    /// Silver this unit's own `TAKE` orders pull from units the report shows in this hex.
    pub taken: i64,
    /// Those sources, as `<name> (<id>)`, so the hover can name them. In document order.
    pub taken_from: Vec<String>,
    /// Silver this unit's own `TAKE` orders pull from units the report does **not** show in this
    /// hex. Counted, because the ledger counts it: `shared_silver_covered` and `upkeep` are
    /// ledger-derived, so a take the column ignored would still move what the column displays
    /// (`ah-awcm`).
    pub taken_unshown: i64,
    /// Those sources, as `unit <id>` - the report gives no name for a unit it does not show. In
    /// document order.
    pub taken_unshown_from: Vec<String>,
    /// Whether a `TAKE ... ALL SILV` could not be priced, which silences the unit's whole figure.
    ///
    /// A bool rather than the source's name, because the sentence the interface shows names the
    /// rule rather than the unit (`ah-awcm`).
    pub take_all_unpriceable: bool,
}

/// Everything about one unit that the arithmetic needs, so the call site reads as a description of
/// the unit rather than as eleven positional arguments.
#[derive(Debug, Clone, Copy)]
pub struct UnitFacts<'a> {
    pub unit_id: &'a str,
    pub region_id: &'a str,
    /// Silver the unit holds now. 0 for a unit carrying no `SILV` item.
    pub held: i64,
    /// The unit's headcount as the turn's early phases see it - the report's own figure, with
    /// this month's `GIVE`/`TAKE` orders applied where `super::semantics` could follow them
    /// (`ah-dxfd.2`). `rules/sequenceofevents` settles TAX, PILLAGE and `Spells are CAST` before
    /// the market opens, so this is what those terms read; a term settled after the market reads
    /// [`UnitFacts::late`] instead.
    pub men: i64,
    /// The unit's headcount as the *report* printed it, before any of this month's orders.
    ///
    /// The only term that reads it is the production sentence, which has to say that men left this
    /// unit this month; every other term wants `men` (the early picture) or `late().men`. Kept
    /// here rather than derived, because by the time [`forecast_unit`] runs there is nothing left
    /// that remembers what the report said (`ah-qct4`).
    pub men_reported: i64,
    pub men_estimated: bool,
    /// `men`'s breakdown by race, which is what tells a leader from an ordinary character. Empty
    /// where the report did not break the unit down, which means *all ordinary characters* - the
    /// report saying nothing is not evidence of leaders. The early picture, exactly as `men` is.
    pub men_by_race: &'a [ItemAmount],
    /// Everything the unit carries, read here only for the food that pays maintenance. The early
    /// picture, exactly as `men` is - see `late` for the picture maintenance actually reads.
    pub items: &'a [ItemAmount],
    /// The unit's report flags, read here only for the two `consuming ...` ones.
    pub flags: &'a [String],
    /// The unit's own skills, which price entertaining and Phantasmal Entertainment.
    pub skills: &'a [Skill],
    pub intents: &'a [PlacedIntent],
    pub receipts: &'a Receipts,
    /// Set when this unit is not one the report shows but one this month's `FORM` orders create.
    pub formed: Option<&'a FormedSubject>,
    /// Set when a transfer this month cannot be followed for this unit - a class the catalogue
    /// cannot classify (`ah-3sp7`), or a `TAKE ALL` from a unit this hex does not show.
    ///
    /// Distinct from `men_estimated`, which is about the *report*: this unit's reported figures
    /// may be exact and still not survive its own orders. **Consulted by [`readiness`] and by
    /// nothing else** - every other term falls back to the report's figures, which is what it did
    /// before this bead, and the unit already carries an existing doubt for the order that caused
    /// this.
    pub after_gifts_unknown: bool,
    /// Set when arrivals cannot be merged into the unit's skills.
    pub skills_unknown: bool,
    /// Whether a `GIVE` this month left any tag this unit holds unresolved (`ah-66yi`).
    ///
    /// Read by the `CAST` arm, which prices its materials from the whole of `items` rather than
    /// from one named tag - so an uncertain tag anywhere in that list is enough to stop it. Every
    /// other term asks [`Lookups::uncertain_after_gifts`] about the tag it actually reads, which is
    /// what keeps unrelated earnings and spending exact.
    pub gifts_uncertain: bool,
    /// Whether any of that is food this unit could have eaten.
    ///
    /// Maintenance is settled from the whole food stock rather than from a tag an order names, so
    /// [`unit_upkeep`], [`food_claim`] and the column all charge nothing rather than a guess - the
    /// same answer an estimated headcount gets. Separate from `gifts_uncertain` so an uncertain
    /// gift of stone leaves this unit's maintenance exactly as it was (`ah-66yi`).
    pub food_uncertain: bool,
    /// The unit's skills once this month's recruits have merged on top of its gifts - the picture
    /// `rules/buy` says a `BUY` dilutes, read only by the PRODUCE arm below. Every other arm
    /// keeps reading `skills`, the pre-market view, because `rules/sequenceofevents` prices STUDY,
    /// ENTERTAIN and maintenance against a phase that has not seen the market yet (`ah-40c9`).
    pub production_skills: &'a [Skill],
    /// Set when arrivals - gifts or recruits - cannot be merged into the unit's skills, so the
    /// PRODUCE arm must go silent rather than price a run against a guess.
    pub production_skills_unknown: bool,
    /// The same unit once the market, the withdrawals and this month's production have run.
    ///
    /// `rules/sequenceofevents` settles STUDY, PRODUCE, ENTERTAIN, WORK and maintenance after the
    /// market and PILLAGE, TAX and `Spells are CAST` before it, so the two pictures are genuinely
    /// different and every term below says which it takes. `None` for a caller with no ledger to
    /// read one from - `semantics::pillagers_in` is the only one, and it consults nothing late.
    /// Read it through [`UnitFacts::late`], never directly.
    pub late: Option<LateFacts<'a>>,
}

/// One unit as the turn's late phases see it - the market, the withdrawals and this month's
/// production already applied.
///
/// **There is no late `skills`, deliberately.** Skills change this month only by gifts of men;
/// `rules/sequenceofevents` puts STUDY in the month-long phase and its result reaches next turn's
/// report, so one skills list serves both pictures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LateFacts<'a> {
    pub men: i64,
    pub men_by_race: &'a [ItemAmount],
    pub items: &'a [ItemAmount],
}

impl<'a> UnitFacts<'a> {
    /// The unit as the late phases see it, falling back to the early picture for a caller that has
    /// no ledger to read a late picture from.
    #[must_use]
    pub fn late(&self) -> LateFacts<'a> {
        self.late.unwrap_or(LateFacts {
            men: self.men,
            men_by_race: self.men_by_race,
            items: self.items,
        })
    }
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
    /// The combat ready men of the units in this hex that *ordered* `PILLAGE`, and whether any of
    /// them could not be counted - decision G1 (`ah-q6bt`). A unit standing by having ordered
    /// nothing is not counted, and so cannot silence the answer either, which is what the
    /// hex-wide count this replaced did before `ah-q6bt`.
    ///
    /// `None` for a caller with no hex to walk - the defaulted `RegionWages` of a test, and
    /// nothing in the shipped path, where `semantics::pillagers_in` always answers.
    ///
    /// Like `pillaged` above, this is not a property of the region as the report prints it. It
    /// belongs here for the same reason that field does: it is exactly what the `PILLAGE` arm
    /// needs, and nothing else in this module has a view of the hex (`ah-1ad6.2`).
    pub pillagers: Option<Pillagers>,
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
pub fn late_income(
    facts: &UnitFacts<'_>,
    region: RegionWages,
    shares: PoolShares,
    ruleset: Option<&Ruleset>,
) -> i64 {
    let wants = pool_wants(facts, region, ruleset);
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
    shared_for_orders: i64,
    lookups: Lookups<'_>,
    ruleset: Option<&Ruleset>,
) -> UnitSilver {
    let sale = lookups.sale;
    let own_food = own_food_pass(&facts, ruleset);
    // Kept before the destructure below, which does not name the field.
    let unit_flags = facts.flags;
    let formed = facts.formed.cloned();
    let upkeep = own_food.as_ref().map(|pass| pass.owed_after_own_food);
    let own_food_covered = own_food.as_ref().map_or(0, |pass| pass.own_food_covered);
    // This unit's own combat ready men, which is its weight in the pillage share (`ah-q6bt`, D1).
    // `None` where they cannot be counted at all, which `price_pillage` doubts rather than reading
    // as a zero. Taken before the destructure below, which does not name every field.
    let mine = readiness(&facts, ruleset).map(|read| read.ready);
    let UnitFacts {
        unit_id,
        region_id,
        held,
        men: _,
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
            taken: 0,
            taken_from: Vec::new(),
            taken_unshown: 0,
            taken_unshown_from: Vec::new(),
            faction_food_covered: 0,
            shared_silver_covered: 0,
            shared_silver_for_orders: 0,
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
            production_men_left: 0,
            produced_name: None,
            production_wanted: 0,
            production_capped_by: None,
            production_region_name: None,
            works_by_default: is_set_to_work(unit_flags, intents),
            taxes_by_flag: false,
            cast_made: 0,
            cast_made_named: None,
            cast_wanted: 0,
            cast_capped_by: None,
            cast_summons: false,
            formed,
            buy_all: Vec::new(),
        };
    }

    // A gift is in the giver's block, so it arrives already gathered. It is income whatever the
    // unit itself is ordered to do, including nothing.
    let mut income = receipts
        .silver
        .saturating_add(receipts.taken)
        .saturating_add(receipts.taken_unshown);
    let mut expense = 0i64;
    // A `TAKE ... ALL SILV` is in this unit's own block, but what it will yield depends on the
    // source unit's month, which this per-unit pass has not run (`ah-awcm`).
    let mut income_doubt = receipts
        .take_all_unpriceable
        .then_some(SilverDoubt::TakesAllFromAnother);
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
    // How many fewer men work this month than the report showed, for the unit's `PRODUCE` order.
    // `0` for a unit with no priceable one, and for one that gained men (`ah-qct4`).
    let mut production_men_left: i64 = 0;
    // The region's own word for what a `PRODUCE` order makes, for the one sentence that says the
    // hex's yield is what limited it. Set only where it did (`ah-256d`).
    let mut production_region_name: Option<String> = None;
    // What a `CAST` order will make, for the four `cast_*` fields the hover reads. Filled by the
    // arm below; a unit with no such order, or none the ruleset prices, leaves it at nothing.
    let mut cast: Option<CastPlan> = None;
    // What this unit's earlier `SELL` lines have already moved, per canonical tag. A block may name
    // the same goods twice, and the second line can only move what the first left - of the stock
    // and of the settled share alike (`ah-vw8e`).
    let mut sold: BTreeMap<String, i64> = BTreeMap::new();
    // What this unit's earlier `BUY` lines have already taken out of its settled share, per
    // canonical tag. A block may name the same goods twice, and the second line can only buy what
    // the first left - of the market line and of this unit's share of it alike (`ah-lauy`).
    let mut bought: BTreeMap<String, i64> = BTreeMap::new();
    // `BUY ALL` and `GIVE ... ALL SILV` spend what is left after every other term, so they cannot
    // be priced inside this pass. Collected in document order and applied below.
    let mut deferred: Vec<Deferred> = Vec::new();
    // What each `BUY ALL` in `deferred` settled to, for the hover - filled by the deferred pass
    // below, in document order.
    let mut buy_all: Vec<BuyAllShown> = Vec::new();

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
        let priced = price_tax(
            taxing_men(&facts, ruleset),
            region.tax_base,
            region.pillaged,
            shares.tax,
        );
        income = income.saturating_add(priced.earns);
        income_doubt = income_doubt.or(priced.doubt);
    }

    for placed in intents {
        // An earlier `GIVE` may or may not have taken these goods away (`rules/give` wants the
        // target faction's declaration toward us and no report carries it), so nothing priced from
        // what the unit still holds of that tag can be stated. The `GIVE` itself is exempt: it is
        // what raised the doubt, and its own arm below decides whether any *silver* moved
        // (`ah-66yi`).
        let reads_a_holding = match &placed.intent {
            Intent::Sell { item, .. } | Intent::Produce { item } => Some(item.as_str()),
            _ => None,
        };
        if let Some(item) = reads_a_holding {
            if (lookups.item_tag)(item)
                .is_some_and(|tag| (lookups.uncertain_after_gifts)(&tag).is_some())
            {
                income_doubt = income_doubt.or(Some(SilverDoubt::GiveConsequencesUncertain));
                expense_doubt = expense_doubt.or(Some(SilverDoubt::GiveConsequencesUncertain));
                continue;
            }
        }
        match &placed.intent {
            Intent::Claim(amount) => {
                // Capped at what the faction actually holds, and never divided between units that
                // claim in the same turn - unlike the regional pools, which `ah-t2pn` settles
                // between own units. The purse is faction-wide and `ah-bumi` settled it
                // deliberately the other way; `claims-exceed-unclaimed` (`ah-wur4`) is what carries
                // the overrun. A purse the report does not state leaves only the limit unknown, not
                // the amount, so the stated figure is counted and nothing is doubted.
                income = income.saturating_add(price_claim(*amount, purse.unclaimed).earns);
            }
            // Priced once above, as a unit-level term rather than per line: a unit may tax by
            // its flag with no `TAX` order at all, and one with both must be counted once
            // (`ah-fvzu`).
            Intent::Tax => {}
            // "The amount of money collected is equal to twice the available tax money." Both
            // surfaces call `price_pillage`, so the rule that two surfaces reading one order must
            // not price it two ways is enforced by the code rather than by a comment asking
            // somebody to remember it (`ah-lu0f`).
            //
            // The gate is the combat ready men of the units that *ordered* PILLAGE, and the take
            // is divided between them in proportion to those men - decisions G1 and D1 of
            // `ah-q6bt`, both deliberate departures from `rules/economy_taxingpillaging`, which
            // gates on the faction's men in the region and shares the take out per unit.
            Intent::Pillage => {
                let priced = price_pillage(region.tax_base, region.pillagers, mine);
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
                    // What this hex's other own sellers left of the line, or the line itself
                    // where nothing was settled (`ah-t2pn.3`).
                    let allowed =
                        (lookups.market_share)(item, MarketSide::Selling).unwrap_or(market_takes);
                    // Keyed by the canonical tag, which is the key the settlement itself uses, so
                    // two spellings of one item share one total. A tag nothing resolves is
                    // untracked and cannot double-count: `resolve_item` walks the unit's own
                    // inventory, so a `None` here means the unit holds none of these goods and
                    // every such line sells nothing whether tracked or not.
                    let key = (lookups.item_tag)(item);
                    let already = key
                        .as_ref()
                        .and_then(|tag| sold.get(tag))
                        .copied()
                        .unwrap_or(0);
                    let line = price_sale_line(
                        amount,
                        (unit_holds - already).max(0),
                        (allowed - already).max(0),
                        price,
                    );
                    income = income.saturating_add(line.earns);
                    if let Some(tag) = key {
                        *sold.entry(tag).or_default() += line.quantity;
                    }
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
                if facts.production_skills_unknown {
                    expense_doubt = expense_doubt.or(Some(SilverDoubt::UnknownSkillsAfterArrivals));
                    doubt_subject = doubt_subject.or(Some(item.to_lowercase()));
                    continue;
                }
                // PRODUCE is priced after the market opens (`rules/sequenceofevents`), so its
                // man-months capacity reads the late headcount - men this month's `BUY`/`GIVE`
                // bring, not only what the report printed (`ah-dxfd.2`).
                //
                // **Materials stay the early picture, deliberately.** `semantics::produce` prices
                // this same order a second time from the ledger's own balance to build the ITEMS
                // column, and charges the materials it plans against that balance - so reading the
                // late picture's `items` here would price this order against a balance its own
                // ledger twin has already spent, silently halving what the unit can make. Pending
                // a way to read a mid-month balance rather than the ledger's own end state.
                //
                // The level and the tools enter through `workforce_for`, which the ITEMS ledger
                // also calls - one builder, so the two surfaces cannot be given different
                // workforces (`ah-vtwn`). The tag is carried alongside because `workforce_for`
                // needs it to find the tools, and `(lookups.item_tag)` allocates.
                let found = (lookups.item_tag)(item).and_then(|tag| {
                    producing_skill(ruleset, &tag, Some(facts.production_skills))
                        .map(|(skill, recipe)| (tag, skill, recipe))
                });
                let work = found
                    .as_ref()
                    .map_or(Workforce::default(), |(tag, skill, _)| {
                        workforce_for(
                            ruleset,
                            skill,
                            tag,
                            facts.late().men,
                            facts.production_skills,
                            facts.items,
                        )
                    });
                let recipe = found.as_ref().map(|(_, _, recipe)| *recipe);
                // What this hex's `Products` line leaves this unit, once its faction-mates
                // producing the same goods here are settled against it - the same settlement the
                // ITEMS ledger reads, through the same function (`ah-256d`, `ah-ycuj`).
                let region = (lookups.region_share)(item);
                let (priced, plan) = price_production(recipe, work, facts.items, region);
                match plan.zip(recipe) {
                    Some((plan, recipe)) => {
                        expense = expense.saturating_add(priced.spends);
                        if priced.spends > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Produce));
                        }
                        let capped_by = plan.capped_by;
                        production = Some(((lookups.item_name)(&recipe.tag), plan));
                        // `rules/sequenceofevents` settles GIVE and TAKE before either PRODUCE
                        // phase, so a unit that parts with men produces less than its report
                        // suggests - and nothing else on the row says so. Clamped at zero: a unit
                        // that *gains* men produces more, which needs no sentence (`ah-qct4`).
                        // Set here rather than before the `match`, so it stays `0` for a unit
                        // whose PRODUCE the ruleset cannot price, exactly as `produced` does.
                        production_men_left = (facts.men_reported - facts.late().men).max(0);
                        // Only when the region is what bound, so the value and the sentence it
                        // feeds cannot disagree. `None` for a unit whose `PRODUCE` the ruleset
                        // cannot price, exactly as `produced` and `production_men_left` are.
                        production_region_name = capped_by
                            .filter(|cap| matches!(cap, ProductionCap::Region))
                            .and_then(|_| (lookups.region_product_name)(item));
                    }
                    None => {
                        expense_doubt = expense_doubt.or(priced.doubt);
                        // The order's own text: the pricing function never sees it.
                        doubt_subject = doubt_subject.or(Some(item.to_lowercase()));
                    }
                }
            }
            Intent::Study { skill } => {
                // STUDY is priced after the market opens too, so the fee is per man this month
                // actually has, not only per man the report printed (`ah-dxfd.2`).
                let cost = ruleset
                    .and_then(|ruleset| ruleset.find_skill(skill))
                    .and_then(|skill| skill.cost);
                let priced = price_study(cost, facts.late().men);
                expense = expense.saturating_add(priced.spends);
                if priced.spends > 0 {
                    spent_on = spent_on.or(Some(SilverSpender::Study));
                }
                expense_doubt = expense_doubt.or(priced.doubt);
            }
            // `CAST` prices its materials from the whole of `items`, not from a tag the order
            // names, so any uncertain tag stops it (`ah-66yi`).
            Intent::Cast { .. } if facts.gifts_uncertain => {
                income_doubt = income_doubt.or(Some(SilverDoubt::GiveConsequencesUncertain));
                expense_doubt = expense_doubt.or(Some(SilverDoubt::GiveConsequencesUncertain));
            }
            Intent::Cast { spell, arguments } => {
                // Resolved once: this runs per keystroke, and `find_skill` walks the catalogue.
                let resolved = ruleset.and_then(|ruleset| ruleset.find_skill(spell));

                // A transmutation only when the spell actually transmutes something and the order
                // names a material this pass can resolve - the same gate `semantics::cast` applies
                // before building the same struct, so both surfaces agree about which casts are
                // transmutations at all (`ah-ofpb.4`).
                let transmute_tag = resolved
                    .and_then(|skill| skill.cast.as_ref())
                    .filter(|cost| !cost.transmute.is_empty())
                    .and_then(|_| transmute_argument(arguments))
                    .and_then(|(number, material)| {
                        (lookups.item_tag)(material).map(|tag| (number, tag))
                    });
                let transmuting = transmute_tag.as_ref().map(|(number, tag)| Transmuting {
                    output_tag: tag.as_str(),
                    number: *number,
                });

                let caster = Caster {
                    skills: facts.skills,
                    held: facts.items,
                    // `rules/sequence` puts `GIVE` and `TAKE` two phases before `Spells are CAST`,
                    // so silver on its way in counts; wages and anything produced after do not
                    // (`ah-ofpb.4`, R4).
                    silver_available: held
                        .saturating_add(receipts.silver)
                        .saturating_add(receipts.taken)
                        .saturating_add(receipts.taken_unshown),
                    transmuting,
                };
                let (priced, plan) = price_cast(resolved, &caster, region);
                income = income.saturating_add(priced.earns);
                expense = expense.saturating_add(priced.spends);
                if priced.spends > 0 {
                    spent_on = spent_on.or(Some(SilverSpender::Cast));
                }
                cast = cast.or(plan);
            }
            Intent::Buy { amount, item } => match (lookups.purchase)(item) {
                PurchaseAnswer::ForSale { price, market_has } => match amount {
                    Amount::Exact(count) => {
                        let tag = (lookups.item_tag)(item);
                        let already = tag
                            .as_ref()
                            .and_then(|tag| bought.get(tag))
                            .copied()
                            .unwrap_or(0);
                        // The settled figure is already capped by what the market has, so this
                        // also stops a lone unit being charged for goods that do not exist - the
                        // navigator's decision, recorded in the bead's plan (`ah-t2pn.3`). Less
                        // what this unit's own earlier lines already took (`ah-lauy`).
                        //
                        // The running total comes off the *settled share* only. Where nothing was
                        // settled the arm falls back to what the unit asked for, which is not a
                        // quantity of goods at all, so there is nothing there to spend down.
                        let allowed = match (lookups.market_share)(item, MarketSide::Buying) {
                            Some(share) => (share - already).max(0),
                            None => *count,
                        };
                        let charged = price_purchase(*count, price, allowed).spends;
                        expense = expense.saturating_add(charged);
                        if charged > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Buy));
                        }
                        if let Some(tag) = tag {
                            *bought.entry(tag).or_default() += quantity_bought(*count, allowed);
                        }
                    }
                    // What a unit can afford depends on everything else this month does, so this
                    // waits for the running total below.
                    // The share is captured here, where the `Lookups` are, rather than in the
                    // deferred pass - which runs after the settlement and knows nothing of it.
                    // A `BUY ALL` whose item resolves to no tag cannot reach here: the `purchase`
                    // closure would have answered `NotSold` and the arm above doubts before the
                    // amount is read.
                    Amount::All { .. } => deferred.push(Deferred::BuyAll {
                        price,
                        share: (lookups.market_share)(item, MarketSide::Buying),
                        market_has,
                        tag: (lookups.item_tag)(item).unwrap_or_default(),
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
                // A target the order cannot reach costs this unit nothing. Before the class branch
                // below, which defers `GIVE ... ALL ITEMS` against the running total (`ah-vcp8.2`).
                let reach = (lookups.give_reach)(to);
                if reach == GiveReach::Nowhere {
                    continue;
                }
                // `rules/give` exempts silver from the factional rule outright, so a target we can
                // see takes it definitely. A number the report never prints is the other case: it
                // may be a unit we cannot see whose faction has declared us Friendly, and no report
                // says which (`ah-66yi`).
                let silver_uncertain =
                    give_outcome(reach, SILVER_TAG, None) == GiveOutcome::Uncertain;
                if let Selector::Class(name) = what {
                    if *amount == (Amount::All { except: 0 }) {
                        match (lookups.class_carries_silver)(name) {
                            // The class is resolved and holds no silver: nothing of this unit's
                            // money moves, and there is nothing left to doubt.
                            Some(false) => continue,
                            // Every one of the unit's coins leaves, exactly as `GIVE ... ALL SILV`
                            // does - and deferred for the same reason, so it spends against the
                            // running total rather than the report's opening figure.
                            Some(true) if silver_uncertain => {
                                expense_doubt =
                                    expense_doubt.or(Some(SilverDoubt::GiveTargetUncertain));
                                doubt_subject = doubt_subject.or(Some(give_target_label(to)));
                                continue;
                            }
                            Some(true) => {
                                deferred.push(Deferred::GiveAllSilver {
                                    except: 0,
                                    to_nobody: matches!(to, Party::Discard),
                                });
                                spent_on = spent_on.or(Some(SilverSpender::Give));
                                continue;
                            }
                            None => {}
                        }
                    }
                    // Unresolvable, or an amount shape `rules/give` does not define: today's
                    // doubt, now naming the class.
                    expense_doubt = expense_doubt.or(Some(SilverDoubt::GivesAWholeClass));
                    doubt_subject = doubt_subject.or(Some(name.to_ascii_uppercase()));
                    continue;
                }
                // The shape is read before the tag is, so a gift of the unit itself doubts even
                // where no tag was ever resolved - and `semantics::transfer` reads the same
                // shape, so the two surfaces cannot classify one order two ways (`ah-lu0f`).
                let shape = transfer_shape(what, amount);
                if shape == TransferShape::Unpriceable {
                    expense_doubt = expense_doubt.or(Some(SilverDoubt::GivesAWholeClass));
                    continue;
                }
                let Selector::Item(text) = what else {
                    continue;
                };
                if !(lookups.item_tag)(text).is_some_and(|tag| tag.eq_ignore_ascii_case(SILVER_TAG))
                {
                    continue;
                }
                if silver_uncertain {
                    expense_doubt = expense_doubt.or(Some(SilverDoubt::GiveTargetUncertain));
                    doubt_subject = doubt_subject.or(Some(give_target_label(to)));
                    continue;
                }
                let to_nobody = matches!(to, Party::Discard);
                match shape {
                    TransferShape::Unpriceable => {}
                    TransferShape::Exact(count) => {
                        expense = expense.saturating_add(count);
                        if count > 0 {
                            spent_on = spent_on.or(Some(SilverSpender::Give));
                        }
                        if to_nobody {
                            given_to_nobody = given_to_nobody.saturating_add(count);
                        }
                    }
                    TransferShape::All { except } => {
                        deferred.push(Deferred::GiveAllSilver { except, to_nobody })
                    }
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

    let late = late_income(&facts, region, shares, ruleset);
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
                Deferred::BuyAll {
                    price,
                    share,
                    market_has,
                    tag,
                } => {
                    let already = bought.get(tag).copied().unwrap_or(0);
                    // Unlike the exact arm, the running total comes off the fallback too:
                    // `market_has` is a real quantity of goods, so a unit that has already bought
                    // the line cannot buy it again whether a share was settled or not.
                    let available = share.unwrap_or(*market_has);
                    let (priced, plan) =
                        price_buy_all(running, *price, available, *market_has, already);
                    buy_all.push(BuyAllShown {
                        bought_named: (lookups.counted_or_none)(plan.bought, tag),
                        market_named: (lookups.counted_or_none)(plan.market_has, tag),
                        bought: plan.bought,
                        affordable: plan.affordable,
                        available: plan.available,
                        market_has: plan.market_has,
                        already_bought: plan.already_bought,
                        silver_available: running,
                        price: *price,
                        capped_by: plan.capped_by,
                    });
                    *bought.entry(tag.clone()).or_default() += plan.bought;
                    priced.spends
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
    // What the hex's `SHARE` purse actually lends this unit: never more than it is short of, so an
    // allowance settled from the ledger cannot inflate a figure here (`ah-moq3`).
    let short_before_sharing = match (income, expense) {
        (Some(income), Some(expense)) => Some(
            expense
                .saturating_sub(held.saturating_add(income).saturating_sub(late))
                .max(0),
        ),
        _ => None,
    };
    let shared = short_before_sharing.map_or(0, |short| shared_for_orders.clamp(0, short));
    let at_month_end = match (income, expense) {
        (Some(income), Some(expense)) => Some(
            held.saturating_add(income)
                .saturating_add(shared)
                .saturating_sub(expense),
        ),
        _ => None,
    };
    let short_for_orders = short_before_sharing.map(|short| short.saturating_sub(shared));

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
                    | Some(SilverDoubt::GivesAWholeClass)
                    | Some(SilverDoubt::GiveTargetUncertain)
            )
        }),
        received: receipts.silver,
        givers: receipts.givers.clone(),
        taken: receipts.taken,
        taken_from: receipts.taken_from.clone(),
        taken_unshown: receipts.taken_unshown,
        taken_unshown_from: receipts.taken_unshown_from.clone(),
        faction_food_covered: 0,
        shared_silver_covered: 0,
        shared_silver_for_orders: shared,
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
        production_men_left,
        produced_name: production.as_ref().map(|(name, _)| name.clone()),
        production_wanted: production.as_ref().map_or(0, |(_, plan)| plan.wanted),
        production_capped_by: production.as_ref().and_then(|(_, plan)| plan.capped_by),
        production_region_name,
        works_by_default: is_set_to_work(unit_flags, intents),
        taxes_by_flag: taxes(unit_flags, intents)
            && !intents
                .iter()
                .any(|placed| matches!(placed.intent, Intent::Tax)),
        cast_made: cast.as_ref().map_or(0, |plan| plan.made),
        cast_made_named: cast.as_ref().and_then(|plan| {
            plan.tag
                .as_ref()
                .map(|tag| (lookups.counted_item)(plan.made, tag))
        }),
        cast_wanted: cast.as_ref().map_or(0, |plan| plan.wanted),
        cast_capped_by: cast.as_ref().and_then(|plan| plan.capped_by),
        cast_summons: cast.as_ref().is_some_and(|plan| plan.summons),
        formed,
        buy_all,
    }
}

/// A term that spends whatever is left after every other one, kept until the running total exists.
#[derive(Debug, Clone)]
enum Deferred {
    /// `BUY ALL`: as many as the unit can afford, and no more than its settled share of the line.
    BuyAll {
        price: i64,
        /// This unit's settled share of the line. `None` where nothing was settled, and the
        /// deferred pass then falls back to the whole line, exactly as this arm did inline before
        /// (`ah-t2pn.3`).
        share: Option<i64>,
        /// The whole line.
        market_has: i64,
        /// The canonical tag, or empty for one nothing could identify - unreachable in practice,
        /// see the call site.
        tag: String,
    },
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
pub fn unit_upkeep(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> Option<i64> {
    own_food_pass(facts, ruleset).map(|pass| pass.owed_after_own_food)
}

/// What step 1 of the payment order did to one unit: what it still owes, and what food it has left.
struct OwnFoodPass {
    owed_after_own_food: i64,
    /// The food the unit still holds after step 1, as a stock, for its faction pool and step 5.
    spare_food: Vec<FoodAmount>,
    /// What the unit's own food paid off, in silver. Recorded where step 1 actually happens, so
    /// nothing re-derives it from `items` and a food value and drifts from this.
    own_food_covered: i64,
}

/// Step 1 of the maintenance payment order - the unit's own food - and what it leaves behind.
///
/// Maintenance is assessed after the market, the withdrawals and this month's production have run
/// (`rules/sequenceofevents`), so this reads `facts.late()` throughout (`ah-dxfd.2`).
///
/// `None` for a headcount that is itself a guess: charge nothing rather than a guess.
fn own_food_pass(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> Option<OwnFoodPass> {
    // `food_uncertain`: a `GIVE` this month may or may not have taken the food this unit would eat,
    // so charge nothing rather than a guess - exactly what an estimated headcount gets (`ah-66yi`).
    if facts.men_estimated || facts.food_uncertain {
        return None;
    }
    let late = facts.late();

    let leaders = late
        .men_by_race
        .iter()
        .filter(|entry| entry.tag.eq_ignore_ascii_case(LEADER_TAG))
        .map(|entry| entry.amount)
        .sum::<i64>();
    // A unit the report never broke down is all ordinary characters, and a breakdown that names
    // more leaders than men is not a reason to charge a negative headcount.
    let leaders = leaders.clamp(0, late.men);
    let characters = late.men - leaders;

    let owed = leaders
        .saturating_mul(UPKEEP_PER_LEADER)
        .saturating_add(characters.saturating_mul(UPKEEP_PER_CHARACTER))
        .max(0);

    let mut stock = food_stock(late.items, ruleset);

    if owed <= 0 || !is_consuming(facts.flags) {
        // Steps 3 before 5: a unit not set to consume spends its silver before its own food, and
        // this column is about silver. Its food is untouched, and so is spare for its faction.
        return Some(OwnFoodPass {
            owed_after_own_food: owed,
            spare_food: stock,
            own_food_covered: 0,
        });
    }

    let use_ = consume_food(&mut stock, owed);

    Some(OwnFoodPass {
        owed_after_own_food: owed - use_.covered,
        spare_food: stock,
        own_food_covered: use_.covered,
    })
}

/// What one unit brings to, and takes from, its hex's faction-food pool.
///
/// Built after every unit has fed itself at step 1, so `spare_food` is genuinely spare: the same
/// item can never feed its owner and a neighbour.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoodClaim {
    pub unit_id: String,
    /// Food items still held once this unit has paid what it could of its own upkeep, as a stock
    /// so a hex whose foods carry different maintenance values pools them exactly.
    pub spare_food: Vec<FoodAmount>,
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
pub fn food_claim(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> FoodClaim {
    let pass = own_food_pass(facts, ruleset);
    FoodClaim {
        unit_id: facts.unit_id.to_string(),
        owed_after_own_food: pass.as_ref().map_or(0, |pass| pass.owed_after_own_food),
        spare_food: pass.map_or_else(Vec::new, |pass| pass.spare_food),
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
    /// Food the hex still holds once step 2 has run, as a stock for steps 5 and 6 to draw on.
    /// `None` when step 2 was contended: what it ate cannot be told, so what is left cannot be
    /// either.
    pub pool_left: Option<Vec<FoodAmount>>,
}

/// Step 2 of the maintenance payment order, across one hex.
///
/// Returns the upkeep each unit is left with. `Some(0)` for a unit the pool feeds; `None` for one
/// of *several* contending for a pool too small to feed them all, where which unit eats is
/// genuinely undeterminable and no number is invented. Two cases that look short are not
/// ambiguous at all and are answered exactly: an empty pool, where nobody eats, and a lone
/// claimant, which simply eats every item it can use. A unit that does not draw on the pool is
/// absent from the result and keeps whatever step 1 left it.
#[must_use]
pub fn feed_from_faction_food(claims: &[FoodClaim]) -> FactionFoodPass {
    // Every own unit in the hex contributes its spare food, drawing on the pool or not: a
    // quartermaster paying its own upkeep in silver still hands its grain to its faction-mates.
    // Foods are pooled by tag so a mixed hex is one stock the consume helper can sort and spend.
    let mut pool: Vec<FoodAmount> = Vec::new();
    for claim in claims {
        for food in &claim.spare_food {
            if food.amount <= 0 || food.maintenance_value <= 0 {
                continue;
            }
            match pool.iter_mut().find(|entry| entry.tag == food.tag) {
                Some(entry) => entry.amount = entry.amount.saturating_add(food.amount),
                None => pool.push(food.clone()),
            }
        }
    }

    let claimants: Vec<&FoodClaim> = claims
        .iter()
        .filter(|claim| claim.draws_on_pool && claim.owed_after_own_food > 0)
        .collect();

    let pool_total: i64 = pool.iter().map(|entry| entry.amount).sum();

    // A hex with no food at all is not ambiguous: nobody eats, so every claimant keeps exactly
    // what step 1 left it. `None` is reserved for a pool that holds food but not enough - the case
    // where which unit eats genuinely cannot be told, and the navigator settled it that way on
    // 2026-08-23 after the committed turn showed exactly-known figures being doubted by an empty
    // hex.
    if pool_total == 0 {
        return FactionFoodPass {
            settled: BTreeMap::new(),
            pool_left: Some(Vec::new()),
        };
    }

    if claimants.is_empty() {
        return FactionFoodPass {
            settled: BTreeMap::new(),
            pool_left: Some(pool),
        };
    }

    // Contention needs two contenders: a lone claimant eats every item it can use and owes the
    // rest, with nothing to decide. Settled with the navigator on 2026-08-23, by the same
    // reasoning that made an empty pool exact.
    if let [only] = claimants.as_slice() {
        let mut stock = pool;
        let use_ = consume_food(&mut stock, only.owed_after_own_food);
        return FactionFoodPass {
            settled: [(
                only.unit_id.clone(),
                Some(only.owed_after_own_food - use_.covered),
            )]
            .into(),
            pool_left: Some(stock),
        };
    }

    // Several claimants: dry-run them in document order against one cloned stock. Each takes the
    // cheapest food first, so the order is what makes the outcome deterministic. If the pool feeds
    // them all, commit that stock and those settlements.
    let mut stock = pool;
    let mut settlements: Vec<(String, i64)> = Vec::with_capacity(claimants.len());
    let mut all_fed = true;
    for claim in &claimants {
        let use_ = consume_food(&mut stock, claim.owed_after_own_food);
        let left = claim.owed_after_own_food - use_.covered;
        if left > 0 {
            all_fed = false;
        }
        settlements.push((claim.unit_id.clone(), left));
    }
    if all_fed {
        return FactionFoodPass {
            settled: settlements
                .into_iter()
                .map(|(id, left)| (id, Some(left)))
                .collect(),
            pool_left: Some(stock),
        };
    }

    // Short, with several contending: the rules waste food, so the total genuinely differs by who
    // eats and there is no correct number to share out. Every contender is doubted and the
    // remainder cannot be told.
    FactionFoodPass {
        settled: claimants
            .iter()
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

/// Divides `total` between claimants in proportion to `weights`, truncating.
///
/// **Deliberately not [`split_pool`]**, which returns the claims unchanged whenever they sum to no
/// more than the pool - correct there, where a claim and the pool are both silver, and wrong here,
/// where the weights are *men* and the pool is *silver*. Handed `[300, 1]` and `45308`,
/// `split_pool` answers `[300, 1]`.
///
/// Truncating, so the shares never sum above `total` - the same invariant [`split_pool`] states and
/// tests. The remainder, at most one silver per claimant, is not distributed.
///
/// `weights` summing to zero answers all zeros: nobody combat ready means nobody takes a share, and
/// the threshold will have refused the pillage anyway.
#[must_use]
pub fn split_in_proportion(weights: &[i64], total: i64) -> Vec<i64> {
    let clamped: Vec<i64> = weights.iter().map(|weight| (*weight).max(0)).collect();
    let total = total.max(0);
    let sum: i128 = clamped.iter().map(|weight| i128::from(*weight)).sum();
    if sum <= 0 {
        return vec![0; clamped.len()];
    }
    clamped
        .iter()
        .map(|weight| {
            i64::try_from(i128::from(total) * i128::from(*weight) / sum).unwrap_or(i64::MAX)
        })
        .collect()
}

#[cfg(test)]
mod split_in_proportion_tests {
    use super::*;

    /// The navigator's own hex: City Guards' 445 men and Transporter's one, against $45,308.
    /// Written with the plan's 300 and 1 so the arithmetic is checkable by hand.
    #[test]
    fn divides_in_proportion_to_the_men() {
        assert_eq!(split_in_proportion(&[300, 1], 45308), vec![45157, 150]);
    }

    #[test]
    fn never_promises_more_than_the_total() {
        let shares = split_in_proportion(&[300, 1], 45308);
        assert!(
            shares.iter().sum::<i64>() <= 45308,
            "the take is never promised twice: {shares:?}"
        );
    }

    #[test]
    fn answers_zeros_when_no_one_is_ready() {
        assert_eq!(split_in_proportion(&[0, 0], 45308), vec![0, 0]);
        assert_eq!(split_in_proportion(&[], 45308), Vec::<i64>::new());
        assert_eq!(split_in_proportion(&[300, 1], 0), vec![0, 0]);
        assert_eq!(split_in_proportion(&[300, 1], -10), vec![0, 0]);
        assert_eq!(split_in_proportion(&[-5, 1], 100), vec![0, 100]);
    }

    /// The trap, pinned as a test on purpose: the two functions must never be "simplified" into
    /// one. `split_pool` divides nothing at all here, because the *men* happen to sum to less than
    /// the *silver*.
    #[test]
    fn is_not_split_pool() {
        assert_eq!(split_pool(&[300, 1], 45308), vec![300, 1]);
        assert_ne!(
            split_in_proportion(&[300, 1], 45308),
            split_pool(&[300, 1], 45308)
        );
    }
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

    fn food(tag: &str, amount: i64, value: i64) -> FoodAmount {
        FoodAmount {
            tag: tag.to_string(),
            amount,
            maintenance_value: value,
        }
    }

    /// A claim whose own remaining food is `own_food` grain of `tag`, each worth 30 silver.
    fn claim(id: &str, short: i64, own_food: i64, tag: Option<&str>) -> LateFoodClaim {
        let own = match (own_food > 0, tag) {
            (true, Some(tag)) => vec![food(tag, own_food, 30)],
            _ => Vec::new(),
        };
        LateFoodClaim {
            unit_id: id.to_string(),
            short,
            own_food: own,
        }
    }

    /// A hex remainder of `n` grain, each worth 30 silver.
    fn pool(n: i64) -> Option<Vec<FoodAmount>> {
        Some(if n > 0 {
            vec![food("GRAI", n, 30)]
        } else {
            Vec::new()
        })
    }

    #[test]
    fn a_unit_with_no_flag_eats_its_own_food_when_silver_runs_out() {
        let claims = [claim("a", 60, 2, Some("GRAI"))];
        let relief = feed_after_silver(&claims, pool(2));
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
        let relief = feed_after_silver(&claims, pool(1));
        let a = relief.get("a").expect("a is fed");
        // One grain worth 30 against 200 owed leaves 170.
        assert_eq!(a.own_covered, 30);
        assert_eq!(a.own_items, 1);
        assert_eq!(a.faction_covered, 0);
    }

    #[test]
    fn a_unit_that_owes_nothing_eats_nothing() {
        let claims = [claim("a", 0, 3, Some("GRAI"))];
        let relief = feed_after_silver(&claims, pool(3));
        assert!(relief
            .get("a")
            .is_none_or(|r| r == &LateFoodRelief::default()));
    }

    #[test]
    fn the_remaining_pool_feeds_every_claimant_it_can() {
        let claims = [claim("a", 40, 0, None), claim("b", 40, 0, None)];
        // Four grain at 30 feed two units owing 40 apiece, two items each.
        let relief = feed_after_silver(&claims, pool(4));
        for id in ["a", "b"] {
            let unit = relief.get(id).expect("fed");
            assert_eq!(unit.faction_covered, 40);
            assert_eq!(unit.faction_items, 2);
            assert!(!unit.contended);
        }
    }

    #[test]
    fn a_lone_claimant_eats_the_whole_remainder() {
        let claims = [claim("a", 200, 0, None)];
        let relief = feed_after_silver(&claims, pool(1));
        let a = relief.get("a").expect("fed");
        // One grain worth 30.
        assert_eq!(a.faction_covered, 30);
        assert_eq!(a.faction_items, 1);
    }

    #[test]
    fn a_short_remainder_among_several_feeds_nobody_and_warns_nobody() {
        let claims = [claim("a", 60, 0, None), claim("b", 80, 0, None)];
        let relief = feed_after_silver(&claims, pool(1));
        for id in ["a", "b"] {
            let unit = relief.get(id).expect("claimant");
            assert_eq!(unit.faction_covered, 0);
            assert!(unit.contended);
        }
    }

    #[test]
    fn an_empty_remainder_is_not_contention() {
        let claims = [claim("a", 60, 0, None), claim("b", 80, 0, None)];
        let relief = feed_after_silver(&claims, pool(0));
        for id in ["a", "b"] {
            let unit = relief.get(id).cloned().unwrap_or_default();
            assert_eq!(unit.faction_covered, 0);
            assert!(!unit.contended);
        }
    }

    /// Step 5 spends the least valuable food first and the item count comes from the entries eaten,
    /// not from a silver total divided by a constant: a unit owing 60 with a 20-silver meal and two
    /// 30-silver grain eats the meal and two grain (covering 60 with three items).
    #[test]
    fn own_food_is_spent_least_valuable_first_and_counted_by_entry() {
        let claims = [LateFoodClaim {
            unit_id: "a".to_string(),
            short: 60,
            own_food: vec![food("GRAI", 2, 30), food("MEAL", 1, 20)],
        }];
        let pool_left = Some(vec![food("GRAI", 2, 30), food("MEAL", 1, 20)]);
        let relief = feed_after_silver(&claims, pool_left);
        let a = relief.get("a").expect("a is fed");
        assert_eq!(a.own_covered, 60);
        assert_eq!(a.own_items, 3);
        // Two kinds were eaten, so the hover cannot name a single food.
        assert_eq!(a.own_tag, None);
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

#[cfg(test)]
mod consume_food_tests {
    use super::*;

    fn food(tag: &str, amount: i64, value: i64) -> FoodAmount {
        FoodAmount {
            tag: tag.to_string(),
            amount,
            maintenance_value: value,
        }
    }

    /// The core of the whole bead: food is eaten least valuable first, each entry rounds its need
    /// up, and covered silver is capped at the debt. A unit owing 50 with a 20-silver stock and a
    /// 40-silver stock eats the 20s first - two of them cover 40, and a single 40 covers the last
    /// 10, capped. Three items eaten, 50 covered.
    #[test]
    fn spends_the_least_valuable_food_first() {
        let mut stock = vec![food("BIG", 5, 40), food("SML", 2, 20)];
        let use_ = consume_food(&mut stock, 50);
        assert_eq!(use_.covered, 50);
        assert_eq!(use_.items(), 3);
        assert_eq!(
            use_.consumed,
            vec![food("SML", 2, 20), food("BIG", 1, 40)],
            "two cheap then one dear"
        );
        // The stock is drawn down by exactly what was eaten.
        assert_eq!(stock, vec![food("BIG", 4, 40)]);
    }

    /// A stock too small pays what it can and no more; the debt survives.
    #[test]
    fn covers_only_what_the_stock_can() {
        let mut stock = vec![food("GRAI", 1, 30)];
        let use_ = consume_food(&mut stock, 200);
        assert_eq!(use_.covered, 30);
        assert_eq!(use_.items(), 1);
        assert!(stock.is_empty());
    }

    /// Zero-value and non-positive stock is not food and pays nothing, whatever its count.
    #[test]
    fn worthless_stock_pays_nothing() {
        let mut stock = vec![food("ZERO", 9, 0)];
        let use_ = consume_food(&mut stock, 100);
        assert_eq!(use_, FoodUse::default());
    }

    /// One kind eaten names itself; several kinds cannot.
    #[test]
    fn the_lone_tag_is_the_eaten_food_when_it_is_one_kind() {
        let mut one = vec![food("GRAI", 3, 30)];
        assert_eq!(
            consume_food(&mut one, 60).lone_tag().as_deref(),
            Some("GRAI")
        );

        let mut several = vec![food("GRAI", 1, 30), food("FISH", 1, 30)];
        assert_eq!(consume_food(&mut several, 60).lone_tag(), None);
    }
}

/// One unit's unpayable maintenance and its remaining larder, for steps 5 and 6.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LateFoodClaim {
    pub unit_id: String,
    /// Maintenance this unit's silver cannot cover, after steps 1-4. Exactly `UpkeepClaim.short`.
    pub short: i64,
    /// Food this unit still holds itself, after step 1 - `OwnFoodPass::spare_food`. A stock, so
    /// step 5 spends it at each food's own value and the hover can name what was eaten.
    pub own_food: Vec<FoodAmount>,
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
    pool_left: Option<Vec<FoodAmount>>,
) -> BTreeMap<String, LateFoodRelief> {
    let mut relief: BTreeMap<String, LateFoodRelief> = BTreeMap::new();

    // Step 2 was contended, so what it ate cannot be told and neither can what is left. Nothing is
    // claimed and nobody is warned - the pool might yet have fed any of them.
    let Some(mut remaining) = pool_left else {
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

    let mut owed: BTreeMap<String, i64> = BTreeMap::new();

    // Step 5, in document order. A unit's own food is capped by what the hex still holds: step 2
    // pooled every unit's spare food, so a unit's own larder may already have been eaten by the
    // pool, and it can only spend food still present - per tag, since the pool remainder names
    // exactly which foods survived. The cap can charge a unit for food it still holds, never the
    // reverse, which is the safe direction for a column whose false warnings this bead removes.
    for claim in claims.iter().filter(|claim| claim.short > 0) {
        let mut available = own_available(&claim.own_food, &remaining);
        let use_ = consume_food(&mut available, claim.short);
        remove_from_stock(&mut remaining, &use_.consumed);
        owed.insert(claim.unit_id.clone(), claim.short - use_.covered);
        relief.insert(
            claim.unit_id.clone(),
            LateFoodRelief {
                own_covered: use_.covered,
                own_items: use_.items(),
                own_tag: use_.lone_tag(),
                ..LateFoodRelief::default()
            },
        );
    }

    // Step 6, over what the hex still holds, mirroring `feed_from_faction_food`'s own case
    // analysis.
    let claimants: Vec<(&String, i64)> = claims
        .iter()
        .filter_map(|claim| {
            owed.get(&claim.unit_id)
                .filter(|left| **left > 0)
                .map(|left| (&claim.unit_id, *left))
        })
        .collect();

    let pool_total: i64 = remaining.iter().map(|entry| entry.amount).sum();

    // An empty remainder is not contention: with nothing left, nobody could have been fed.
    if pool_total == 0 || claimants.is_empty() {
        return relief;
    }

    if let [(id, left)] = claimants.as_slice() {
        // Contention needs two contenders: a lone claimant simply eats every item it can use.
        let use_ = consume_food(&mut remaining, *left);
        let entry = relief.entry((*id).clone()).or_default();
        entry.faction_covered = use_.covered;
        entry.faction_items = use_.items();
        return relief;
    }

    // Several claimants: dry-run in document order against one cloned stock, cheapest food first.
    let mut stock = remaining.clone();
    let mut uses: Vec<(&String, FoodUse)> = Vec::with_capacity(claimants.len());
    let mut all_fed = true;
    for (id, left) in &claimants {
        let use_ = consume_food(&mut stock, *left);
        if use_.covered < *left {
            all_fed = false;
        }
        uses.push((id, use_));
    }
    if all_fed {
        for (id, use_) in uses {
            let entry = relief.entry((*id).clone()).or_default();
            entry.faction_covered = use_.covered;
            entry.faction_items = use_.items();
        }
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

/// The riding skill and level a mount's description says it needs to be ridden in combat.
///
/// Every mount's page carries one fixed sentence - *"This mount requires riding [RIDI] of at least
/// level N to ride in combat"* - and **there is no structured field for N**: `WING` needs 3 where
/// `HORS`, `CAME` and `TURT` need 1, so assuming 1 would over-count a unit with winged horses and
/// Riding 1 (`ah-cw75`). The skill tag is read from the sentence too rather than assumed to be
/// `RIDI`.
///
/// `None` for a description that does not carry the sentence, and such a mount then counts for
/// nobody - under-counting, which is the safe direction for a warning.
fn required_riding(description: &str) -> Option<(&str, i64)> {
    let (_, rest) = description.split_once("requires riding [")?;
    let (skill, rest) = rest.split_once("] of at least level ")?;
    let (level, rest) = rest.split_once(' ')?;
    if !rest.starts_with("to ride in combat") {
        return None;
    }
    Some((skill, level.parse().ok()?))
}

/// The combat ready men of the units that ordered `PILLAGE`, and whether any of them could not be
/// counted.
///
/// **Only the units that issued the order** - decision G1 (`docs/ui/ah-q6bt-r1-model.html`). The
/// rules gate on the faction's combat ready men in the region; the navigator's rule is that a unit
/// standing by having ordered nothing does not help, so a bystander is not counted here and cannot
/// silence anything either.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Pillagers {
    /// The combat ready men of every unit that ordered `PILLAGE` and could be counted.
    pub ready: i64,
    /// True when at least one unit that ordered `PILLAGE` could not be counted at all - an
    /// estimated headcount, or a transfer this month that cannot be followed ([`readiness`]
    /// returned `None`).
    ///
    /// **Not an `Option<i64>` over the whole total, which is what the count this replaced was.** The
    /// old shape let one uncountable unit erase the answer for the hex; this one keeps the number that
    /// *is* known and records that it is a floor, which is what decision U1 needs to say
    /// (`ah-q6bt`).
    pub incomplete: bool,
}

/// How many of a unit's men are combat ready, alongside its headcount.
///
/// [`combat_ready`] answers the number and nothing else, which is all `PILLAGE`'s threshold needs -
/// but a player told `0` about a unit visibly holding nineteen men needs to be told why, and that
/// sentence needs the headcount beside the count (`ah-cw75`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Readiness {
    /// The unit's headcount, for the sentence.
    pub men: i64,
    /// What `PILLAGE` counts.
    pub ready: i64,
    /// The cheapest thing standing between this unit and taxing, where it holds one.
    ///
    /// `None` for a unit whose men already count, and for one holding nothing that could ever have
    /// counted - which is the fallback the sentence has to cover (`ah-deo5`).
    pub nearest_miss: Option<NearMiss>,
}

/// An item the unit holds that would have counted but for a skill it lacks - the cheapest thing
/// standing between this unit and being able to tax.
///
/// "Cheapest" is the lowest required level, ties broken by the largest holding: the advice that
/// costs the player least (`ah-deo5`, the navigator's choice).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NearMiss {
    /// The item tag, for `counted_item`.
    pub item: String,
    /// How many the unit holds.
    pub count: i64,
    /// The skill tag it needs - **not** the item's own: `DBOW` is wielded with `LBOW`.
    pub skill: String,
    /// The level it needs.
    pub level: i64,
    /// The unit's own level in that skill - `0` where it has none. The sentence's second clause
    /// mirrors the shipped `has carpenter 2` (`ah-deo5`).
    pub held: i64,
}

impl NearMiss {
    /// Whether `self` is cheaper advice than `other`: the lower level, then the larger holding.
    fn beats(&self, other: &Self) -> bool {
        (self.level, -self.count) < (other.level, -other.count)
    }
}

/// How many of one unit's men are combat ready, and its headcount alongside.
///
/// The rules page never defines the phrase directly, but it defines the thing: the pillage
/// threshold needs *"enough combat ready men in the region to tax half of the available money"*,
/// and the taxing test just above it reads - *"A unit may TAX if it has **Combat skill of at least
/// level 1**, has **a weapon and the appropriate skill to use it**, has **a mount and sufficient
/// skill to ride it in combat** or is **a mage who knows a spell which damages enemies**."* So
/// combat ready men are the taxing characters.
///
/// - **Combat 1 makes every man count**, because a skill is held by the unit.
/// - **So does knowing a spell that damages enemies**, at any level: the rules ask whether the
///   mage knows the spell, not how well ([`SkillEntry::damages_enemies`], `ah-v585`).
/// - otherwise `min(men, wieldable weapons + ridable mounts)` - a man either wields something or
///   rides something, so the two add up. A weapon needing a skill counts only for a unit holding
///   that skill at level 1 or better; a mount counts only for a unit holding the riding level its
///   description names ([`required_riding`]).
///
/// A spell that states no damage - `FEAR`, `SSTO` - does not count, deliberately: that under-counts,
/// which costs a missing warning and never a false one.
///
/// **`avoiding` is not consulted.** `ah-1ad6.2` had it zero a unit's ready men; the navigator
/// reversed that at `ah-cw75`'s verification, and the rules' taxing test does not mention the flag.
/// `behind` is not consulted either: a unit in the back rank still fights.
///
/// `None` when the headcount is estimated - a guessed headcount cannot be compared against a
/// threshold - and when there is no ruleset, since nothing says which items are weapons. The order
/// of those two checks is deliberate and matches what `combat_ready` has always done.
#[must_use]
pub fn readiness(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> Option<Readiness> {
    if facts.men_estimated {
        return None;
    }
    if facts.skills_unknown {
        return None;
    }
    // A transfer this month cannot be followed, so the weapons and men this unit will actually
    // hold are not knowable. Answering from the report instead would count goods the unit may
    // have given away - the wrong direction, since it is the *pillage threshold* being tested.
    if facts.after_gifts_unknown {
        return None;
    }
    let ruleset = ruleset?;
    let men = facts.men.max(0);
    // The rules' fourth taxing character: "or is a mage who knows a spell which damages enemies"
    // (`ah-v585`). Any level will do - the rules ask whether the mage knows the spell, not how
    // well, unlike Combat's explicit "of at least level 1".
    let knows_a_damaging_spell = facts.skills.iter().any(|held| {
        held.level >= 1
            && ruleset
                .skills
                .get(&held.tag.to_uppercase())
                .is_some_and(|entry| entry.damages_enemies)
    });
    if skill_level(facts.skills, "COMB") >= 1 || knows_a_damaging_spell {
        return Some(Readiness {
            men,
            ready: men,
            nearest_miss: None,
        });
    }
    let mut mounted_or_armed = 0i64;
    // The cheapest item the unit holds that a skill would have made count (`ah-deo5`). The loop
    // below already rejects each item for a reason and used to forget why.
    let mut nearest_miss: Option<NearMiss> = None;
    for held in facts.items {
        let Some(entry) = ruleset.items.get(&held.tag.to_uppercase()) else {
            continue;
        };
        // The skill this item would have needed, where it is a thing a skill could make count at
        // all. A weapon needing nothing counts outright; a sack of grain never could have.
        let wanted: Option<(&str, i64)> = if let Some(weapon) = entry.weapon.as_ref() {
            // `needs` is a *skill* tag, not the item's own: `DBOW` is wielded with `LBOW`.
            weapon.needs.as_deref().map(|skill| (skill, 1))
        } else if entry.kind == ItemKind::Mount {
            entry.description.as_deref().and_then(required_riding)
        } else {
            None
        };
        let counts = match wanted {
            Some((skill, level)) => skill_level(facts.skills, skill) >= level,
            // A weapon with no requirement counts; anything that is neither weapon nor mount does
            // not, and is no near miss either.
            None => entry.weapon.is_some(),
        };
        if counts {
            mounted_or_armed = mounted_or_armed.saturating_add(held.amount.max(0));
        } else if let Some((skill, level)) = wanted {
            let candidate = NearMiss {
                item: held.tag.to_uppercase(),
                count: held.amount.max(0),
                skill: skill.to_string(),
                level,
                held: skill_level(facts.skills, skill),
            };
            if nearest_miss
                .as_ref()
                .is_none_or(|best| candidate.beats(best))
            {
                nearest_miss = Some(candidate);
            }
        }
    }
    Some(Readiness {
        men,
        ready: men.min(mounted_or_armed),
        nearest_miss,
    })
}

/// How many of one unit's men are combat ready, in the sense `PILLAGE` needs.
///
/// The number alone, which is all the threshold needs; [`readiness`] is the same answer with the
/// headcount attached, and this is a one-line delegate to it so there is only ever one count.
#[must_use]
pub fn combat_ready(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> Option<i64> {
    readiness(facts, ruleset).map(|readiness| readiness.ready)
}

/// Why this unit's men do not count, as the tail of the pillage warning, or `""` when they do.
///
/// Empty for a unit whose men are counted: the region is simply short, nothing about this unit is
/// wrong, and an explanation would be noise (`ah-cw75`). Empty too for a unit with no men at all -
/// "its 0 men hold no weapons" explains nothing, and a unit with no men has a different problem
/// than this warning is about.
///
/// **Keyed off `ready`, never off a weapon count.** A unit can now be combat ready with no weapon
/// at all - by Combat skill, or by a mount - and one with Combat 1 must not be told it holds no
/// weapons while its men are being counted.
#[must_use]
pub fn readiness_reason(
    readiness: &Readiness,
    ruleset: Option<&Ruleset>,
    plurals: &Plurals,
) -> Option<String> {
    if readiness.men <= 0 || readiness.ready > 0 {
        return None;
    }
    let Some(miss) = readiness.nearest_miss.as_ref() else {
        return Some(
            "it has no combat skill, no weapon it can wield, no mount it can ride and no damaging \
             spell"
                .to_string(),
        );
    };
    let goods = counted_with_singular(
        miss.count,
        &miss.item,
        &ruleset
            .and_then(|ruleset| ruleset.find_item(&miss.item))
            .map_or_else(|| miss.item.clone(), |entry| entry.name.clone()),
        plurals,
    );
    // The messages print skill *names*, never tags: "needs building 1", never "needs BUIL 1".
    let skill = ruleset
        .and_then(|ruleset| ruleset.find_skill(&miss.skill))
        .map_or_else(|| miss.skill.to_lowercase(), |entry| entry.name.clone());
    let verb = if miss.count == 1 { "needs" } else { "need" };
    let held = miss.held;
    let has = if held > 0 {
        format!("has {skill} {held}")
    } else {
        format!("has no {skill}")
    };
    let level = miss.level;
    Some(format!("its {goods} {verb} {skill} {level}, and it {has}"))
}

/// Why this unit's men do not count, as the tail of the pillage warning.
#[must_use]
pub fn because_clause(
    readiness: &Readiness,
    ruleset: Option<&Ruleset>,
    plurals: &Plurals,
) -> String {
    readiness_reason(readiness, ruleset, plurals)
        .map_or_else(String::new, |reason| format!(" — {reason}"))
}

/// How many men this unit contributes to TAX.
///
/// A certainly zero readiness is the one known failure: it contributes no taxing men. Unknown
/// readiness and every positive count preserve the optimistic full-headcount policy.
#[must_use]
pub fn taxing_men(facts: &UnitFacts<'_>, ruleset: Option<&Ruleset>) -> i64 {
    match readiness(facts, ruleset) {
        Some(Readiness { ready: 0, .. }) => 0,
        _ => facts.men,
    }
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
        return Priced::default();
    }
    match share {
        // A unit nobody contends with, exactly as it was before the settlement existed.
        PoolShare::Uncontended => match tax_base {
            Some(base) => Priced {
                earns: men.saturating_mul(TAX_PER_MAN).min(base),
                ..Priced::default()
            },
            None => Priced {
                doubt: Some(SilverDoubt::UnknownTaxBase),
                ..Priced::default()
            },
        },
        // Already capped by the settlement, and already no larger than this unit's ask. Drawn
        // once however many times the block says `TAX`, because this term runs once per unit:
        // the settlement counted the unit's men once, so drawing per line would promise the
        // region's pool twice over - the very thing the split exists to stop.
        PoolShare::Share(share) => Priced {
            earns: share,
            ..Priced::default()
        },
        // Only income is doubted: this unit's own men are known, so what it spends is still
        // exactly priceable - which separates this from `EstimatedMen`.
        PoolShare::Unknowable => Priced {
            doubt: Some(SilverDoubt::ContestedRegionPool),
            ..Priced::default()
        },
    }
}

/// What a `PILLAGE` earns: this unit's share of twice the region's available tax money.
///
/// The take is `2 * tax_base` - *"the amount of money collected is equal to twice the available tax
/// money"* (`rules/economy_taxingpillaging`) - and it is divided between the pillaging units **in
/// proportion to their combat ready men** (decision D1, `ah-q6bt`). `mine` is this unit's combat
/// ready men and `pillagers` the total across every unit that ordered `PILLAGE`; the threshold is
/// tested against `pillagers`, and the share taken from `mine / pillagers.ready`.
///
/// `mine` is `None` when *this* unit's own men cannot be counted - an estimated headcount, or a
/// transfer this month that cannot be followed. The plan did not say what to price such a unit at,
/// and a certain zero is the one answer it must not be: the share is genuinely unknown, so it is
/// doubted. This is the column's half of decision U1, whose other half is the warning's
/// *"may not be able to pillage here"*.
///
/// Both surfaces call this - [`forecast_unit`] and `semantics::apply` - because two surfaces
/// reading one order must not price it two ways (`ah-abwx`, and the reason `ah-ycuj` exists).
#[must_use]
pub fn price_pillage(
    tax_base: Option<i64>,
    pillagers: Option<Pillagers>,
    mine: Option<i64>,
) -> Priced {
    // No tax base: what the region holds is unknown before the question of who may take it arises,
    // so the older doubt wins.
    let Some(base) = tax_base else {
        return Priced {
            doubt: Some(SilverDoubt::UnknownTaxBase),
            ..Priced::default()
        };
    };
    let doubted = Priced {
        doubt: Some(SilverDoubt::UnknownCombatReady),
        ..Priced::default()
    };
    // No hex was walked at all, so the threshold cannot be tested.
    let Some(pillagers) = pillagers else {
        return doubted;
    };
    // This unit's own men are unknown, so its share is unknown even where the gate is settled.
    let Some(mine) = mine else {
        return doubted;
    };
    let needed = pillage_threshold(base);
    if pillagers.ready >= needed {
        // A floor already at or over the threshold settles the gate - more countable men cannot
        // un-pass it - so this arm fires even when `incomplete` is set.
        let take = base.saturating_mul(2);
        // Through [`split_in_proportion`] rather than `take * mine / ready` written out here, so
        // the truncation and the never-promise-more-than-the-take invariant live in one place and
        // are tested once. The second weight is everybody else's men.
        let mine_and_the_rest = [mine, pillagers.ready.saturating_sub(mine)];
        return Priced {
            earns: split_in_proportion(&mine_and_the_rest, take)[0],
            ..Priced::default()
        };
    }
    if pillagers.incomplete {
        // Short only as far as the countable men go, and more may yet be countable: the threshold
        // cannot be settled either way.
        return doubted;
    }
    // Short of the threshold, and every pillager was counted: the order earns nothing, exactly - a
    // certain zero, so the unit is not doubted.
    Priced::default()
}

/// How many of the goods a `BUY` actually takes: what was asked, capped by what the settlement
/// leaves this unit of the market's line.
///
/// `allowed` is the settled share, or the asked count where the hex could not be settled - which is
/// what [`Lookups::market_share`] returning `None` means, and is the behaviour before `ah-t2pn.3`.
#[must_use]
pub fn quantity_bought(count: i64, allowed: i64) -> i64 {
    count.min(allowed).max(0)
}

/// What a `BUY` costs.
///
/// Both surfaces call this - [`forecast_unit`] and `semantics::buy` - because two surfaces reading
/// one order must not price it two ways (`ah-lu0f.2`).
#[must_use]
pub fn price_purchase(count: i64, price: i64, allowed: i64) -> Priced {
    Priced {
        spends: quantity_bought(count, allowed).saturating_mul(price),
        ..Priced::default()
    }
}

/// Which limit settled a `BUY ALL`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum BuyAllCap {
    /// The unit's silver ran out before the market's line did. Also the exact tie, and a unit
    /// that cannot afford even one - see [`price_buy_all`] for why both live here.
    Silver,
    /// The line ran out, and no other own unit contended for it.
    Market,
    /// The line was split with this faction's own units in the hex, so this unit's share is
    /// smaller than the line - a different fact from the line being small, and the one the
    /// player can do something about.
    Shared,
    /// This unit's own earlier `BUY` lines had already taken these goods, wholly or in part
    /// (`ah-lauy`). Wins over `Silver`, `Market` and `Shared` whenever it applies: it is the one
    /// cause the player can fix by deleting a line.
    AlreadyBought,
}

/// What one `BUY ALL` takes, and what stopped it taking more.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuyAllPlan {
    /// How many it actually buys.
    pub bought: i64,
    /// How many its silver alone would pay for, market aside.
    pub affordable: i64,
    /// This unit's settled share of the line - what it could have had were it rich enough, and
    /// **not** reduced by its own earlier lines. `already_bought` carries that separately, because
    /// the sentence has to name the share the unit started with rather than what is left of it.
    pub available: i64,
    /// The whole line, so a `Shared` sentence can say what was split.
    pub market_has: i64,
    /// How many of these goods this unit's own earlier `BUY` lines already took out of `available`
    /// this month (`ah-lauy`).
    pub already_bought: i64,
    pub capped_by: BuyAllCap,
}

/// What a `BUY ALL` takes and what it costs.
///
/// The unbounded counterpart of [`price_purchase`], and called by **both** surfaces -
/// `forecast_unit`'s deferred pass and `semantics::settle_buy_all` - because two surfaces reading
/// one order must not price it two ways (`ah-lu0f.2`).
///
/// `silver_available` is what the unit holds when this line is reached, which is *not* its report
/// holding: `rules/sequenceofevents` settles TAX, PILLAGE and SELL before the market opens, so a
/// unit taxes and sells before it buys. Each caller supplies that from its own running figure.
#[must_use]
pub fn price_buy_all(
    silver_available: i64,
    price: i64,
    available: i64,
    market_has: i64,
    // How many of these goods this unit's own earlier `BUY` lines have already taken out of
    // `available` this month (`ah-lauy`).
    already_bought: i64,
) -> (Priced, BuyAllPlan) {
    // A price of zero or less cannot come off a real `For Sale` line - every one is printed
    // `at $N` - so this is a guard rather than a case, and it matches what the shipped deferred
    // pass already does.
    let affordable = if price <= 0 {
        0
    } else {
        (silver_available / price).max(0)
    };
    let available = available.max(0);
    // What is left of this unit's share once its own earlier lines have had theirs.
    let left = (available - already_bought).max(0);
    let bought = affordable.min(left);
    let capped_by = if already_bought > 0 && (left == 0 || bought < affordable) {
        // The unit's own earlier line is what bit - either it emptied the share outright, or the
        // remainder stopped this line short of what its silver would have paid for. It wins even
        // the case where the purse is empty too (the navigator's round-2 Q3): "it holds 0 silver"
        // is true of every spent-up `BUY ALL` and hides the duplicate line, which is the one thing
        // the player can act on.
        BuyAllCap::AlreadyBought
    } else if bought < affordable {
        if available < market_has {
            BuyAllCap::Shared
        } else {
            BuyAllCap::Market
        }
    } else {
        // Silver is the narrator whenever the market did not bite - which includes the exact tie
        // (the navigator's decision: a `BUY ALL` means "as many as it can afford", so silver is
        // its natural voice, and the two equal numbers make the dead heat visible) and a unit
        // that can afford none, where `affordable` and `bought` are both zero.
        BuyAllCap::Silver
    };
    (
        Priced {
            spends: bought.saturating_mul(price),
            ..Priced::default()
        },
        BuyAllPlan {
            bought,
            affordable,
            available,
            market_has,
            already_bought,
            capped_by,
        },
    )
}

/// How many of the goods a `SELL` actually moves: what was asked, capped by the settled share and
/// by what the unit holds. The three caps are applied in this order and the `max(0)` last, because
/// `Amount::All { except }` can make `asked` negative.
#[must_use]
pub fn quantity_sold(asked: i64, unit_holds: i64, allowed: i64) -> i64 {
    asked.min(allowed).min(unit_holds).max(0)
}

/// One `SELL` line's outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SoldLine {
    /// How many the order asks for, once `ALL … EXCEPT` is resolved against what is left.
    pub asked: i64,
    /// How many actually move.
    pub quantity: i64,
    /// What that earns.
    pub earns: i64,
}

/// What one `SELL` line of a block does, priced against what the lines above it already took.
///
/// A unit's `SELL` lines draw on one stock and on one settled share of one market line, so a second
/// line for the same goods can only move what the first left - of both. Both surfaces call this,
/// the ledger through `super::semantics::sell` and the Silver column through [`forecast_unit`], so
/// one block cannot be priced two ways (`ah-vw8e`, and the drift `ah-ycuj`'s corpus test guards).
#[must_use]
pub fn price_sale_line(
    amount: &Amount,
    // What the unit still holds of these goods when this line runs.
    remaining_holding: i64,
    // What is still left of this unit's settled share of the market line.
    remaining_allowed: i64,
    price: i64,
) -> SoldLine {
    let asked = match amount {
        Amount::Exact(count) => *count,
        Amount::All { except } => remaining_holding - except,
    };
    let quantity = quantity_sold(asked, remaining_holding, remaining_allowed);
    SoldLine {
        asked,
        quantity,
        earns: quantity.saturating_mul(price),
    }
}

/// What a `CLAIM` earns.
///
/// `unclaimed` is the caller's policy about the faction purse, and the two surfaces differ on
/// purpose. The Silver column passes `purse.unclaimed`, because it shows what the unit will actually
/// have. The ledger passes `None`: the overrun has its own finding, `claims-exceed-unclaimed`
/// (`ah-wur4`), computed faction-wide, and warning twice about one mistake is worse than once
/// (`ah-bumi` settled the purse the other way from the regional pools). A purse the report does not
/// state also arrives as `None`, and means the same thing here - the limit is unknown, the stated
/// figure is counted, nothing is doubted.
#[must_use]
pub fn price_claim(amount: i64, unclaimed: Option<i64>) -> Priced {
    Priced {
        earns: match unclaimed {
            Some(available) => amount.min(available),
            None => amount,
        },
        ..Priced::default()
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

    works_by_default(intents) && flagged_to_tax(flags)
}

/// Whether the unit's report flags say it taxes every turn without an order.
///
/// The flag half of [`taxes`], on its own: `taxes` also asks whether the month is free, and
/// `two-month-long-orders` needs the flag alone - a flagged unit whose month is spoken for is
/// exactly the case it reports.
#[must_use]
pub fn flagged_to_tax(flags: &[String]) -> bool {
    flags.iter().any(|flag| {
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

/// What a `STUDY` costs: the ruleset's price for the skill, once per man.
///
/// `cost` is `None` where the ruleset prices the skill nowhere - or where there is no ruleset, or
/// where the headcount is a guess and nothing per-man can be multiplied out. Resolving which of
/// those is the caller's, because the two surfaces reach the ruleset differently; what they must
/// not do twice is the arithmetic and the doubt.
#[must_use]
pub fn price_study(cost: Option<i64>, men: i64) -> Priced {
    match cost {
        Some(cost) => Priced {
            spends: cost.saturating_mul(men),
            ..Priced::default()
        },
        None => Priced {
            doubt: Some(SilverDoubt::UnpricedSkill),
            ..Priced::default()
        },
    }
}

/// What a `PRODUCE` costs, and the run it describes.
///
/// Returns the plan as well as the price because the two surfaces need different parts of it: the
/// ledger charges `plan.materials` tag by tag, and the column names what is made. `None` for the
/// plan means the ruleset prices it nowhere - an unknown item, an item no skill makes, a recipe of
/// alternatives rather than requirements - which is a doubt on both surfaces.
///
/// The caller resolves the item to a recipe, because the column has a `Lookups` closure and the
/// ledger has the hex; [`plan_production`] is the shared part and stays the only recipe reader.
#[must_use]
pub fn price_production(
    recipe: Option<&Production>,
    work: Workforce,
    held: &[ItemAmount],
    region: RegionShare,
) -> (Priced, Option<ProductionPlan>) {
    match recipe.and_then(|recipe| plan_production(recipe, work, held, region)) {
        Some(plan) => (
            Priced {
                spends: plan.silver,
                ..Priced::default()
            },
            Some(plan),
        ),
        None => (
            Priced {
                doubt: Some(SilverDoubt::UnpricedProduction),
                ..Priced::default()
            },
            None,
        ),
    }
}

/// What a `CAST` earns and costs, and the run it describes.
///
/// Returns the plan as well as the price for the same reason [`price_production`] does: the ledger
/// charges `plan.materials` tag by tag, and the column names what is made.
///
/// **Two spells earn**, and both arrive in time to be spent: `CAST` resolves before every spend
/// order, so neither is [`late_income`]'s business. Phantasmal Entertainment pays
/// `level x PHANTASMAL_PER_LEVEL`, capped by what the region's entertainment pool holds; Earth Lore
/// pays `level x EARTH_LORE_PER_LEVEL_PER_WAGE x W`, where W is the region's wage - carried in
/// hundredths, so the multiplication comes before the division by 100 and a fractional wage is not
/// lost. A hex stating no wage pays nothing and raises no doubt, exactly as `WORK` treats one.
///
/// **Every spell may cost, charged for every item it will make** (`ah-ofpb.4`). Only the `SILV`
/// entries of the cast cost move silver here; item costs and the whole `transmute` map are the item
/// ledger's business and are not this function's - `spends` is `plan.silver` alone.
///
/// A spell the ruleset does not know, or knows no cost for, earns nothing, costs nothing and doubts
/// nothing - which is the truth about most spells. Returns `(Priced::default(), None)` for either.
#[must_use]
pub fn price_cast(
    spell: Option<&SkillEntry>,
    caster: &Caster<'_>,
    region: RegionWages,
) -> (Priced, Option<CastPlan>) {
    let level = skill_level(caster.skills, spell.map_or("", |spell| spell.tag.as_str()));

    let earns = match spell.map(|spell| spell.tag.to_ascii_uppercase()) {
        Some(tag) if tag == PHANTASMAL_TAG => level
            .saturating_mul(PHANTASMAL_PER_LEVEL)
            .min(region.entertainment.unwrap_or(0)),
        Some(tag) if tag == EARTH_LORE_TAG => {
            level
                .saturating_mul(EARTH_LORE_PER_LEVEL_PER_WAGE)
                .saturating_mul(region.wage_centis.unwrap_or(0))
                / 100
        }
        _ => 0,
    };

    let Some(cost) = spell.and_then(|spell| spell.cast.as_ref()) else {
        return (
            Priced {
                earns,
                ..Priced::default()
            },
            None,
        );
    };

    let plan = plan_cast(cost, caster, level);

    (
        Priced {
            earns,
            spends: plan.silver,
            doubt: None,
        },
        Some(plan),
    )
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

/// The skill that makes an item tag, and the recipe by which it makes it.
///
/// Shared by all three readers - the SILVER column, the ITEMS ledger and
/// `check_produce_orders`'s `produce-without-skill` - for the same reason [`plan_production`] is:
/// they must find the same recipe, or they price and describe the same order differently.
///
/// Which skill, when more than one produces the same tag: the one the unit already has, if any
/// does; otherwise the one needing the lowest level; ties broken alphabetically by tag, which the
/// `BTreeMap`'s own order gives. Deterministic on purpose - a message that changed with map
/// iteration order would flake a test months later.
///
/// `skills` distinguishes `None` (nothing is known about the unit's skills) from an empty list (it
/// is known to have none), which `check_produce_orders` relies on.
#[must_use]
pub fn producing_skill<'a>(
    ruleset: Option<&'a Ruleset>,
    tag: &str,
    skills: Option<&[Skill]>,
) -> Option<(&'a SkillEntry, &'a Production)> {
    let candidates: Vec<(&SkillEntry, &Production)> = ruleset?
        .skills
        .values()
        .flat_map(|skill| {
            skill
                .produces
                .iter()
                .filter(|recipe| recipe.tag.eq_ignore_ascii_case(tag))
                .map(move |recipe| (skill, recipe))
        })
        .collect();

    candidates
        .iter()
        .find(|(skill, _)| skills.is_some_and(|held| skill_level(held, &skill.tag) > 0))
        .or_else(|| candidates.iter().min_by_key(|(_, recipe)| recipe.level))
        .copied()
}

/// What a unit brings to one month of one recipe.
///
/// A struct rather than four more positional arguments, for the reason [`UnitFacts`] is one: the
/// call site should read as a description of the unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Workforce {
    /// The headcount, as the calling surface reads it. The two surfaces read different ones and
    /// that is deliberate - see the module's known traps - so this is the caller's to supply.
    pub men: i64,
    /// The unit's level in the skill that makes the recipe. `0` for a skill it has not got.
    pub level: i64,
    /// The per-man bonus of the tool the unit holds for this item. `0` where it holds none.
    pub tool_bonus: i64,
    /// How many of that tool the unit holds. `0` where it holds none.
    pub tools: i64,
}

impl Workforce {
    /// `men * level + min(men, tools) * tool_bonus`.
    ///
    /// The level term is the rules': "five men at skill level one are exactly equivalent to one
    /// man at skill level 5 in terms of base output" (`rules/tableiteminfo`). The `min` is not -
    /// the same page states each tool's bonus and never says how many men one tool serves, so
    /// one tool to one man, spare tools idle, is the navigator's reading of the game, recorded in
    /// `docs/ui/ah-vtwn-production-at-skill-level.html`. Do not "correct" it to `men * (level +
    /// tool_bonus)`: that was one of the two readings it was chosen over.
    #[must_use]
    pub fn man_months(self) -> i64 {
        self.men
            .saturating_mul(self.level)
            .saturating_add(self.men.min(self.tools).saturating_mul(self.tool_bonus))
            .max(0)
    }
}

/// The workforce a unit brings to one recipe, built the one way both production surfaces must
/// build it.
///
/// `men` is the caller's because the two surfaces read different headcounts; everything else is
/// computed here exactly once, so the level and the tools cannot drift between them.
#[must_use]
pub fn workforce_for(
    ruleset: Option<&Ruleset>,
    skill: &SkillEntry,
    tag: &str,
    men: i64,
    skills: &[Skill],
    held: &[ItemAmount],
) -> Workforce {
    let (tool_bonus, tools) = tools_for(ruleset, tag, held);
    Workforce {
        men,
        level: skill_level(skills, &skill.tag),
        tool_bonus,
        tools,
    }
}

/// The tool a unit holds that best helps it produce `tag`, as `(per-man bonus, how many held)`.
///
/// `(0, 0)` where the unit holds no such tool, where there is no ruleset, and where nothing in the
/// catalogue boosts that tag - which is most items. The highest bonus wins; ties go to the lower
/// item tag, which [`Ruleset::items`]' own `BTreeMap` order gives. Deterministic on purpose, and
/// unobservable in this ruleset: no item in it is boosted by two different tools.
#[must_use]
pub fn tools_for(ruleset: Option<&Ruleset>, tag: &str, held: &[ItemAmount]) -> (i64, i64) {
    let Some(ruleset) = ruleset else {
        return (0, 0);
    };
    ruleset
        .items
        .values()
        .filter_map(|item| {
            let count = held
                .iter()
                .find(|owned| owned.tag.eq_ignore_ascii_case(&item.tag))
                .map_or(0, |owned| owned.amount);
            if count <= 0 {
                return None;
            }
            let bonus = production_bonuses(item.description.as_deref().unwrap_or_default())
                .into_iter()
                .find(|(boosted, _)| boosted.eq_ignore_ascii_case(tag))
                .map(|(_, bonus)| bonus)?;
            (bonus > 0).then_some((bonus, count))
        })
        // `min_by_key` over the reversed bonus rather than `max_by_key`, which returns the *last*
        // of several equal maxima: the doc above promises the first, which in a `BTreeMap`'s own
        // order is the lower item tag.
        .min_by_key(|(bonus, _)| Reverse(*bonus))
        .unwrap_or((0, 0))
}

/// The marker sentence every tool's data-page description carries.
const PRODUCTION_BONUS_MARKER: &str = "This item increases the production of ";

/// The per-item production bonuses one item's data-page description states.
///
/// Every `[TAG] by <n>` in the sentence beginning "This item increases the production of", in the
/// order written; empty for a description without that sentence, which is every item that is not
/// a tool.
///
/// Reads the prose rather than a scraped field for the same reason [`required_riding`] does: the
/// ruleset carries each item's description whole, nothing else in it states this, and adding a
/// scraped field would drag `packages/ruleset` and a regenerated `config/public/ruleset.json` into
/// a P0.
///
/// Scans for the brackets rather than splitting on `", "` and `" and "`: the two separators are
/// mixed, and the Oxford comma appears in some entries and not others.
fn production_bonuses(description: &str) -> Vec<(String, i64)> {
    let Some((_, sentence)) = description.split_once(PRODUCTION_BONUS_MARKER) else {
        return Vec::new();
    };
    let sentence = sentence.split_once(". ").map_or(sentence, |(head, _)| head);

    let mut bonuses = Vec::new();
    let mut rest = sentence;
    while let Some((_, after)) = rest.split_once('[') {
        let Some((item, after)) = after.split_once(']') else {
            break;
        };
        rest = after;
        let Some(amount) = after.strip_prefix(" by ") else {
            continue;
        };
        let digits: String = amount.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(bonus) = digits.parse::<i64>() {
            bonuses.push((item.to_string(), bonus));
        }
    }
    bonuses
}

/// Which limit decided how many a unit produces, when it is not its men - or, for a `CAST` that
/// summons, how many it may control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum ProductionCap {
    /// The unit holds less silver than the recipe wants for that many.
    Silver,
    /// The unit holds too little of at least one material input.
    Materials,
    /// The mage already controls as many of the creature as its level allows, so the summon was
    /// clamped (`ah-ofpb.5`). Only ever set for a summon, and only for the four skills that state
    /// a cap.
    Room,
    /// The region yields less of the item than the unit's men could make of it, once the hex's own
    /// units have been settled against its `Products` line (`ah-256d`). Only ever set for a
    /// *primary* `PRODUCE` - one whose recipe takes no materials - and never for a summon.
    Region,
}

/// What the region a unit produces in leaves that unit's `PRODUCE` order.
///
/// Three answers rather than an `Option<i64>`, because "no pool applies to this recipe at all" and
/// "the hex yields none of this" are opposite facts that must not be spelled the same way: the
/// first leaves the run untouched, the second makes it nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RegionShare {
    /// No regional pool applies. `rules/sequenceofevents` runs "Manufacturing PRODUCE orders
    /// (those that produce items from other items...)" in a phase of their own, ahead of the
    /// primary ones: a sword is made from iron the unit carries rather than from the hex, so
    /// nothing limits it but the unit's own holdings. Also what a caller with no region to consult
    /// supplies, which is what keeps this module's own tests reading as they did.
    #[default]
    Unlimited,
    /// The region's `Products` line names none of it, so nothing is produced here at all.
    NothingHere,
    /// The region yields it, and the settlement leaves this unit this much of it.
    Share(i64),
}

/// What one `PRODUCE` order makes, and what it takes to make it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProductionPlan {
    /// How many the unit will actually make.
    pub made: i64,
    /// How many its men alone would make - the unit's man-months over the recipe's, rounded down,
    /// where its man-months are `men * level + min(men, tools) * tool_bonus` ([`Workforce`]).
    /// Equal to `made` unless something capped it.
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
/// `men` and `held` are the caller's to supply, and the cap is taken against `held` rather than
/// against a running balance. That is a decision, not an oversight: the ledger keeps a running
/// balance and `forecast_unit` does not, so capping against one would give the two surfaces
/// different answers for the same order - which is exactly the drift `ah-ycuj`'s corpus test
/// exists to catch.
///
/// **Both callers supply the post-gift picture** (`ah-qct4`): `rules/sequenceofevents` settles
/// "Give orders. GIVE and TAKE orders are processed." nine phases before either PRODUCE phase, so
/// the men who work and the materials they work with are the ones this month's transfers leave
/// behind. The two still differ for men bought or sold this month - the ledger cannot see the
/// market during its own intent loop - which is pre-existing and documented at the `PRODUCE` arm
/// of [`forecast_unit`]. The figures remain imprecise in the other direction too: a unit that BUYs
/// wood first makes more than this says.
///
/// `None` when the recipe cannot be applied at all: a recipe stating no man-months or no outputs
/// (a ruleset scraped before `ah-19l2.1`, or cooking, whose page states a formula), or one whose
/// inputs are alternatives rather than requirements - cooking's "any of grain, livestock and
/// fish" consumes *one* of the three, and reading it as three requirements would debit all three.
/// Each of those is a `?` in the column rather than an invented number.
#[must_use]
pub fn plan_production(
    recipe: &Production,
    work: Workforce,
    held: &[ItemAmount],
    region: RegionShare,
) -> Option<ProductionPlan> {
    if recipe.inputs_are_alternatives {
        return None;
    }
    let man_months = i64::from(recipe.man_months.filter(|months| *months > 0)?);
    let outputs = i64::from(recipe.outputs.filter(|made| *made > 0)?);

    // A unit below the recipe's minimum level makes nothing at all, whatever its headcount:
    // `rules/tableiteminfo` states a minimum level for every recipe. Returned as an empty plan
    // rather than `None`, because the recipe *is* priceable - this unit simply makes none of it,
    // and `None` would put a `?` in the column where a 0 belongs.
    if work.level < i64::from(recipe.level) {
        return Some(ProductionPlan::default());
    }

    // The hex yields none of it, so nothing is produced here whatever the unit's men could do.
    // An empty plan rather than a cap, and that is the navigator's decision (2026-08-29): the
    // Problems panel's `produce-not-here` already says why, immediately beside this, and two
    // copies of one sentence are two things to keep in step. The same shape - and the same
    // reasoning - as the minimum-level gate directly above.
    if matches!(region, RegionShare::NothingHere) {
        return Some(ProductionPlan::default());
    }

    let wanted = (work.man_months() / man_months) * outputs;
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

    let by_region = match region {
        RegionShare::Unlimited => i64::MAX,
        // Answered by the guard above; kept exhaustive rather than caught by a wildcard.
        RegionShare::NothingHere => 0,
        RegionShare::Share(share) => share.max(0),
    };

    let made = wanted.min(by_silver).min(by_materials).min(by_region);
    // The region is named first when it ties, because it is the only one of the three the unit
    // cannot fix by carrying more - "buy more iron" is wasted advice about a hex that has none
    // left. In this ruleset it can never tie: every recipe drawing on a pool has no inputs at all,
    // so `by_silver` and `by_materials` are both `i64::MAX` whenever `by_region` is not. The order
    // is stated so that a ruleset which changed that would still be deterministic. Silver is then
    // named before materials when those two bind, because the column this feeds is about silver.
    let capped_by = if made == wanted {
        None
    } else if by_region <= by_silver && by_region <= by_materials {
        Some(ProductionCap::Region)
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

/// What the caster brings to a cast.
///
/// A struct rather than four more positional arguments, for the reason [`UnitFacts`] is one: the
/// call site should read as a description of the mage.
#[derive(Debug, Clone, Copy)]
pub struct Caster<'a> {
    /// The unit's own skills, which give it its level in the spell.
    pub skills: &'a [Skill],
    /// Everything the unit holds, for the material inputs a cast consumes.
    pub held: &'a [ItemAmount],
    /// Silver the unit can have before the spell resolves: what the report shows it holding plus
    /// every gift and take this month's orders bring it. `rules/sequence` puts `GIVE` and `TAKE`
    /// two phases before `Spells are CAST`, and wages, takings from entertaining and anything the
    /// unit produces after it - so those are not counted, and neither is `late_income`.
    pub silver_available: i64,
    /// `CAST Transmutation [number] <material>`, resolved by the caller because only it can turn
    /// the order's text into a tag. `None` for every other spell.
    pub transmuting: Option<Transmuting<'a>>,
}

/// The output a transmutation names, and how many of it the order asked for.
#[derive(Debug, Clone, Copy)]
pub struct Transmuting<'a> {
    /// The canonical, upper-cased tag of the item the order names - transmutation names its
    /// *output*, "the resource you wish to create" (`data/TRNS`).
    pub output_tag: &'a str,
    /// `None` for an unnumbered cast, which makes as many as the level allows: "Should you wish to
    /// create fewer than maximum, you may CAST Transmutation [number] <material> instead"
    /// (`data/TRNS`).
    pub number: Option<i64>,
}

/// What one `CAST` makes, and what it takes to make it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CastPlan {
    /// How many the cast will actually make, capped by what the mage can pay for.
    pub made: i64,
    /// The fewest the cast may actually bring. Equal to `made` for every certain creation, and for
    /// a chance spell at a level whose percentage total lands on a whole hundred - a level 5 ring
    /// maker is 20 x 5 = 100%, exactly one ring, and shows no range. `0` for a spell that creates
    /// nothing an item catalogue can carry.
    pub made_certain: i64,
    /// How many the mage's level alone would make. Every whole hundred percent is an item, and any
    /// remainder is rounded **up** to one more - the navigator's choice, `ah-ofpb.4`, 2026-08-26.
    /// `made_certain` above is the floor beside this ceiling, added by `ah-ofpb.5`. `1` for a spell
    /// that creates nothing an item catalogue can carry, which the page prices per attempt.
    pub wanted: i64,
    /// How many the ledger is charged for: `made`, but never fewer than one when `wanted` is more
    /// than none. A mage that cannot afford even one is charged for one and is warned that it is
    /// short; a mage whose level makes none of the thing at all is charged nothing.
    pub charged: i64,
    /// The tag of the item created, upper-cased. `None` for a spell that creates nothing an item
    /// catalogue can carry - `data/CGAT` makes a Gate, which is a region feature.
    pub tag: Option<String>,
    /// Silver the cast spends: `charged` times the `SILV` entry of the per-item cost.
    pub silver: i64,
    /// Everything else it spends, `charged` times each per-item amount. `name` is the tag, exactly
    /// as `plan_production` leaves it - the caller names the item.
    pub materials: Vec<ItemAmount>,
    /// What stopped it making `wanted`, or `None` when nothing did. Silver is named first when both
    /// bind, for the same reason `plan_production` names it first: the column this feeds is about
    /// silver.
    pub capped_by: Option<ProductionCap>,
    /// Whether the skill's paragraph calls this creation a summoning, which decides one word in
    /// the ITEMS hover and one in the cap sentence. `false` for a spell that creates nothing.
    pub summons: bool,
}

/// `CAST Transmutation [number] <material>` split into how many and what.
///
/// `None` for arguments of neither shape, including a count that will not parse or is not positive
/// - which is what `cast()` does with one today.
#[must_use]
pub fn transmute_argument(arguments: &[String]) -> Option<(Option<i64>, &str)> {
    match arguments {
        [count, material] => match count.parse::<i64>() {
            Ok(count) if count > 0 => Some((Some(count), material.as_str())),
            _ => None,
        },
        [material] => Some((None, material.as_str())),
        _ => None,
    }
}

/// What one cast makes and what it costs, from the ruleset's own numbers.
///
/// Modelled on [`plan_production`] deliberately and closely: a cast is capped by silver and
/// materials exactly as a production run is. The one difference is silver: it is divided out of
/// `caster.silver_available` rather than out of the unit's own `SILV` holding, because a gift that
/// arrives before `Spells are CAST` funds the cast (`ah-ofpb.4`, R4).
#[must_use]
pub fn plan_cast(cost: &CastCost, caster: &Caster<'_>, level: i64) -> CastPlan {
    // 1. Which creation this cast makes.
    let output: Option<&CastOutput> = match &caster.transmuting {
        Some(transmuting) => cost
            .creates
            .iter()
            .find(|output| output.tag.eq_ignore_ascii_case(transmuting.output_tag)),
        None => match cost.creates.as_slice() {
            [only] => Some(only),
            _ => None,
        },
    };

    // The fewest and the most this level can bring. Two arithmetics: a percentage total, whose
    // whole hundreds are certain and whose remainder is the chance of one more; and the four
    // skills the page words as an average, where the engine takes the whole-hundred count and
    // then flips two coins per item, keeping a floor of one. The second is the navigator's,
    // from the game engine, 2026-08-26 - it is on neither committed page and is not a lookup.
    let (capacity_fewest, capacity) = output.map_or((0, 0), |output| {
        let output_level = i64::from(output.level);
        if level < output_level {
            return (0, 0);
        }
        let effective_level = (level + output.level_offset).max(0);
        let total_percent = output.percent_per_level.saturating_mul(effective_level);
        if output.averaged {
            // `num = (level * percent + rand(0..99)) / 100`. Every `percent_per_level` the page
            // states as an average is a whole multiple of 100, so the random part never carries
            // and `num` is exact. Then `2 * num` coin tosses, at least one when `num > 0`.
            let num = total_percent / 100;
            (i64::from(num > 0), num.saturating_mul(2))
        } else {
            // Rounded up, deliberately, as `ah-ofpb.4` Q2 decided: a remainder chance is charged
            // as though it landed. The floor beside it is what this bead added.
            (total_percent / 100, (total_percent + 99) / 100)
        }
    });

    // 2. `wanted`.
    let wanted = match output {
        None => 1,
        Some(_) => match caster.transmuting.as_ref().and_then(|t| t.number) {
            Some(number) if number > 0 => number.min(capacity),
            Some(_) => 0,
            None => capacity,
        },
    };

    // 3. The per-item cost.
    let (silver_each, materials_each): (i64, Vec<(String, i64)>) = match caster.transmuting.as_ref()
    {
        Some(transmuting) => {
            let source = cost
                .transmute
                .get(&transmuting.output_tag.to_ascii_uppercase());
            (
                0,
                source
                    .map(|source_tag| vec![(source_tag.clone(), 1)])
                    .unwrap_or_default(),
            )
        }
        None => {
            let silver_each = cost
                .costs
                .iter()
                .find(|input| input.tag.eq_ignore_ascii_case(SILVER_TAG))
                .map_or(0, |input| input.amount);
            let materials_each = cost
                .costs
                .iter()
                .filter(|input| !input.tag.eq_ignore_ascii_case(SILVER_TAG))
                .map(|input| (input.tag.clone(), input.amount))
                .collect();
            (silver_each, materials_each)
        }
    };

    // 4. The caps, exactly as `plan_production` computes them, with one difference: silver is
    // divided out of `caster.silver_available` rather than out of the unit's own `SILV` holding.
    let holding = |tag: &str| -> i64 {
        caster
            .held
            .iter()
            .find(|item| item.tag.eq_ignore_ascii_case(tag))
            .map_or(0, |item| item.amount)
    };

    let by_silver = if silver_each > 0 {
        caster.silver_available.max(0) / silver_each
    } else {
        i64::MAX
    };
    let by_materials = materials_each
        .iter()
        .filter(|(_, amount)| *amount > 0)
        .map(|(tag, amount)| holding(tag) / amount)
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

    // What the mage may still control, for the four skills that state a cap. `wanted` is left
    // alone: the hover says "not the 12 its level could summon", which is the level's figure.
    let room = output.and_then(|output| {
        output.control.as_ref().map(|cap| {
            let base = (level + cap.offset).max(0);
            let ceiling = cap
                .multiplier
                .saturating_mul(base.saturating_pow(cap.exponent));
            (ceiling - holding(&output.tag)).max(0)
        })
    });
    let (made, capped_by) = match room {
        Some(room) if room < made => (room, Some(ProductionCap::Room)),
        _ => (made, capped_by),
    };

    // 5. `charged` is `0` when `wanted` is `0` (Q3: a mage whose level makes none of the thing is
    // charged nothing), and `max(1, made)` otherwise (R2: a mage that cannot afford even one is
    // still charged for one, so the shipped warnings still fire). The control-cap clamp above must
    // not move this: all four capped skills have `costs: []`, so `charged` times anything is
    // nothing (`ah-ofpb.5`, Known traps).
    let charged = if wanted == 0 { 0 } else { made.max(1) };

    CastPlan {
        made,
        made_certain: capacity_fewest.min(made),
        wanted,
        charged,
        tag: output.map(|output| output.tag.to_ascii_uppercase()),
        silver: charged.saturating_mul(silver_each),
        materials: if charged > 0 {
            materials_each
                .iter()
                .map(|(tag, amount)| ItemAmount {
                    amount: charged * amount,
                    name: tag.clone(),
                    tag: tag.clone(),
                })
                .collect()
        } else {
            Vec::new()
        },
        capped_by,
        summons: output.is_some_and(|output| output.summoned),
    }
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

    /// Ten carpenters at the catapult's own minimum level bring forty man-months, and a catapult
    /// is four of them - so the whole run is ten, and its silver and materials are ten times one.
    #[test]
    fn ten_carpenters_at_level_four_make_ten_catapults() {
        let plan = plan_production(
            &catapult(),
            Workforce {
                men: 10,
                level: 4,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[
                ("SILV", 100_000),
                ("WOOD", 9999),
                ("IRWD", 999),
                ("FUR", 999),
            ]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 10);
        assert_eq!(plan.made, 10);
        assert_eq!(plan.silver, 30_000);
        assert_eq!(
            plan.materials
                .iter()
                .map(|item| (item.tag.as_str(), item.amount))
                .collect::<Vec<_>>(),
            vec![("WOOD", 2500), ("IRWD", 300), ("FUR", 800)]
        );
        assert_eq!(plan.capped_by, None);
    }

    /// The committed ruleset, for the lookups that read the real catalogue.
    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    #[test]
    fn a_tool_lifts_the_rate_by_one_per_man_that_holds_one() {
        let work = Workforce {
            men: 8,
            level: 5,
            tool_bonus: 1,
            tools: 3,
        };
        assert_eq!(work.man_months(), 43);
    }

    #[test]
    fn only_as_many_tools_as_men_can_be_used() {
        let work = Workforce {
            men: 8,
            level: 5,
            tool_bonus: 1,
            tools: 20,
        };
        assert_eq!(work.man_months(), 48);
    }

    /// The pick's own description in the committed data page, verbatim.
    #[test]
    fn a_picks_bonuses_are_read_from_its_description() {
        let bonuses = production_bonuses(
            "This is a tool. This item increases the production of iron [IRON] by 1, stone [STON] \
             by 1, mithril [MITH] by 1, rootstone [ROOT] by 1, and admantium [ADMT] by 1.",
        );
        assert_eq!(
            bonuses,
            vec![
                ("IRON".to_string(), 1),
                ("STON".to_string(), 1),
                ("MITH".to_string(), 1),
                ("ROOT".to_string(), 1),
                ("ADMT".to_string(), 1),
            ]
        );
    }

    /// The net's, whose grammar is "A and B" rather than "A, B, and C" - and whose bonus is 2.
    #[test]
    fn a_nets_bonuses_are_read_from_its_description() {
        let bonuses = production_bonuses(
            "This is a tool. This item increases the production of fish [FISH] by 2 and giant \
             turtle [TURT] by 1.",
        );
        assert_eq!(
            bonuses,
            vec![("FISH".to_string(), 2), ("TURT".to_string(), 1)]
        );
    }

    /// Every other item in the game says nothing of the kind.
    #[test]
    fn an_item_that_is_not_a_tool_states_no_bonuses() {
        assert_eq!(
            production_bonuses("This is a piercing weapon and each attack deals 1 damage."),
            Vec::new()
        );
    }

    /// `tools_for` against the real catalogue: a pick boosts iron and says nothing about swords.
    #[test]
    fn a_unit_holding_picks_mines_more_iron() {
        let ruleset = ruleset();
        let picks = held(&[("PICK", 3)]);
        assert_eq!(tools_for(Some(&ruleset), "IRON", &picks), (1, 3));
        assert_eq!(tools_for(Some(&ruleset), "SWOR", &picks), (0, 0));
        assert_eq!(tools_for(None, "IRON", &picks), (0, 0));
        assert_eq!(tools_for(Some(&ruleset), "IRON", &held(&[])), (0, 0));
    }

    /// Plate armor, stated exactly as `config/public/ruleset.json`'s `skills.ARMO.produces` entry
    /// does: three iron and three man-months for one, first makeable at armorer 3.
    fn plate_armor() -> Production {
        Production {
            tag: "PARM".to_string(),
            level: 3,
            inputs: vec![input("IRON", 3)],
            inputs_are_alternatives: false,
            man_months: Some(3),
            outputs: Some(1),
        }
    }

    /// Plate armor states `armorer (3)` in `rules/tableiteminfo`, so nine armorer-1 men make none
    /// of it - not the three their nine man-months over its three would otherwise suggest.
    #[test]
    fn a_unit_below_the_recipes_level_makes_none() {
        let plan = plan_production(
            &plate_armor(),
            Workforce {
                men: 9,
                level: 1,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[("IRON", 99)]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 0);
        assert_eq!(plan.made, 0);
        assert_eq!(plan.capped_by, None);
    }

    /// The boundary, so the gate cannot be written as `<=`: at exactly the recipe's level the unit
    /// produces, and its twenty-seven man-months over three are nine.
    #[test]
    fn a_unit_exactly_at_the_recipes_level_produces() {
        let plan = plan_production(
            &plate_armor(),
            Workforce {
                men: 9,
                level: 3,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[("IRON", 99)]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 9);
        assert_eq!(plan.made, 9);
    }

    /// Iron, stated exactly as `config/public/ruleset.json`'s `skills.MINI.produces` entry does:
    /// no material input at all, one man-month for one, first makeable at mining 1. A *primary*
    /// recipe, which is what makes it draw on the region's own yield.
    fn iron() -> Production {
        Production {
            tag: "IRON".to_string(),
            level: 1,
            inputs: Vec::new(),
            inputs_are_alternatives: false,
            man_months: Some(1),
            outputs: Some(1),
        }
    }

    /// MinersA (5105) of the committed turn 42: 8 orcs at mining 5, so 40 man-months of iron, in a
    /// hex whose `Products` line states 36 iron shared with a second mining unit. Its settled share
    /// is 20, and the report's own `Produces` line says 20.
    #[test]
    fn a_share_of_the_regions_yield_caps_the_run() {
        let plan = plan_production(
            &iron(),
            Workforce {
                men: 8,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[]),
            RegionShare::Share(20),
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 40);
        assert_eq!(plan.made, 20);
        assert_eq!(plan.capped_by, Some(ProductionCap::Region));
    }

    /// Farmers (3493)'s row: a pool that covers what the unit asked divides nothing, and there is
    /// no cap to name.
    #[test]
    fn a_share_that_covers_the_run_names_no_cap() {
        let plan = plan_production(
            &iron(),
            Workforce {
                men: 8,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[]),
            RegionShare::Share(40),
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 40);
        assert_eq!(plan.made, 40);
        assert_eq!(plan.capped_by, None);
    }

    /// A hex whose `Products` line names none of it yields none of it. An empty plan rather than a
    /// cap, and that is the navigator's decision (2026-08-29): `wanted` is 0 rather than 40 and
    /// `capped_by` is `None` rather than `Some(Region)`, which is what keeps the hover silent -
    /// `produce-not-here` already says why, immediately beside it.
    #[test]
    fn a_region_that_yields_none_of_it_makes_none() {
        let plan = plan_production(
            &iron(),
            Workforce {
                men: 8,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[]),
            RegionShare::NothingHere,
        )
        .expect("a priceable recipe");
        assert_eq!(plan, ProductionPlan::default());
        assert_eq!(plan.wanted, 0);
        assert_eq!(plan.made, 0);
        assert_eq!(plan.capped_by, None);
    }

    /// `rules/tableiteminfo`: "five men at skill level one are exactly equivalent to one man at
    /// skill level 5". Ten carpenters at level 5 bring 50 man-months, and a catapult is four.
    #[test]
    fn ten_carpenters_at_level_five_make_twelve_catapults() {
        let plan = plan_production(
            &catapult(),
            Workforce {
                men: 10,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[
                ("SILV", 100_000),
                ("WOOD", 9999),
                ("IRWD", 999),
                ("FUR", 999),
            ]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 12);
        assert_eq!(plan.made, 12);
    }

    #[test]
    fn prices_a_study_and_a_production() {
        assert_eq!(
            price_study(Some(30), 10),
            Priced {
                spends: 300,
                ..Priced::default()
            }
        );
        assert_eq!(
            price_study(None, 10),
            Priced {
                doubt: Some(SilverDoubt::UnpricedSkill),
                ..Priced::default()
            }
        );

        let (priced, plan) =
            price_production(None, Workforce::default(), &[], RegionShare::Unlimited);
        assert_eq!(
            priced,
            Priced {
                doubt: Some(SilverDoubt::UnpricedProduction),
                ..Priced::default()
            }
        );
        assert!(plan.is_none());

        let recipe = catapult();
        let (priced, plan) = price_production(
            Some(&recipe),
            Workforce {
                men: 10,
                level: 4,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[
                ("SILV", 100_000),
                ("WOOD", 9999),
                ("IRWD", 999),
                ("FUR", 999),
            ]),
            RegionShare::Unlimited,
        );
        assert_eq!(
            priced,
            Priced {
                spends: 30_000,
                ..Priced::default()
            }
        );
        assert_eq!(plan.expect("a priceable recipe").made, 10);
    }

    /// The `wanted <= 0` branch, which the ledger can reach for real: `ah-qct4` settles GIVE nine
    /// phases before production, so a unit that parted with all its men this month brings no
    /// man-months at all, whatever its level.
    #[test]
    fn a_unit_with_no_men_left_makes_none() {
        let plan = plan_production(
            &catapult(),
            Workforce {
                men: 0,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[("SILV", 100_000)]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 0);
        assert_eq!(plan.made, 0);
        assert_eq!(plan.silver, 0);
        assert_eq!(plan.materials, Vec::new());
        assert_eq!(plan.capped_by, None);
    }

    /// Unit 12881 `Carpenters` as the committed turn has it: ten men at carpenter 5, so twelve
    /// man-months' worth of catapults wanted - and silver for one.
    #[test]
    fn silver_caps_what_a_unit_produces() {
        let plan = plan_production(
            &catapult(),
            Workforce {
                men: 10,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[("SILV", 3000), ("WOOD", 9999), ("IRWD", 999), ("FUR", 999)]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.wanted, 12);
        assert_eq!(plan.made, 1);
        assert_eq!(plan.silver, 3000);
        assert_eq!(plan.capped_by, Some(ProductionCap::Silver));
    }

    #[test]
    fn materials_cap_what_a_unit_produces() {
        let plan = plan_production(
            &catapult(),
            Workforce {
                men: 10,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[
                ("SILV", 100_000),
                ("WOOD", 250),
                ("IRWD", 999),
                ("FUR", 999),
            ]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
        assert_eq!(plan.made, 1);
        assert_eq!(plan.capped_by, Some(ProductionCap::Materials));
    }

    #[test]
    fn silver_is_named_first_when_both_bind() {
        let plan = plan_production(
            &catapult(),
            Workforce {
                men: 10,
                level: 5,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[("SILV", 3000), ("WOOD", 250), ("IRWD", 999), ("FUR", 999)]),
            RegionShare::Unlimited,
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
        let plan = plan_production(
            &sword,
            Workforce {
                men: 5,
                level: 1,
                tool_bonus: 0,
                tools: 0,
            },
            &held(&[("IRON", 2)]),
            RegionShare::Unlimited,
        )
        .expect("a priceable recipe");
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
        assert_eq!(
            plan_production(
                &meals,
                Workforce {
                    men: 5,
                    level: 1,
                    tool_bonus: 0,
                    tools: 0,
                },
                &held(&[("GRAI", 99)]),
                RegionShare::Unlimited,
            ),
            None
        );
    }

    /// A ruleset scraped before `ah-19l2.1` states neither rate nor output, and a default of 1
    /// there would invent one.
    #[test]
    fn a_recipe_with_no_stated_rate_is_not_priced() {
        let mut unscraped = catapult();
        unscraped.man_months = None;
        let ten_carpenters = Workforce {
            men: 10,
            level: 4,
            tool_bonus: 0,
            tools: 0,
        };
        assert_eq!(
            plan_production(
                &unscraped,
                ten_carpenters,
                &held(&[]),
                RegionShare::Unlimited
            ),
            None
        );
        let mut no_output = catapult();
        no_output.outputs = None;
        assert_eq!(
            plan_production(
                &no_output,
                ten_carpenters,
                &held(&[]),
                RegionShare::Unlimited
            ),
            None
        );
    }
}

/// `plan_cast`, against the committed NewOrigins ruleset - `ah-ofpb.3` landed the multiplier this
/// arithmetic spends, and its plan's *The one arithmetic* is the formula worked through below.
#[cfg(test)]
mod cast_tests {
    use super::*;

    /// The committed ruleset, which is what `ah-ofpb.3` taught the multiplier from.
    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    fn cast_cost(tag: &str) -> CastCost {
        ruleset()
            .find_skill(tag)
            .and_then(|skill| skill.cast.clone())
            .unwrap_or_else(|| panic!("{tag} should carry a cast cost in the committed ruleset"))
    }

    /// A caster with no cap at all, so only the level arithmetic (step 2) is exercised.
    fn unlimited() -> Caster<'static> {
        Caster {
            skills: &[],
            held: &[],
            silver_available: i64::MAX,
            transmuting: None,
        }
    }

    #[test]
    fn plan_cast_counts_what_the_level_makes() {
        assert_eq!(plan_cast(&cast_cost("ESWO"), &unlimited(), 3).wanted, 15);
        assert_eq!(plan_cast(&cast_cost("CRPA"), &unlimited(), 3).wanted, 3);
        assert_eq!(plan_cast(&cast_cost("CRRI"), &unlimited(), 3).wanted, 1);
        assert_eq!(plan_cast(&cast_cost("CRRU"), &unlimited(), 3).wanted, 3);
        assert_eq!(plan_cast(&cast_cost("CRRU"), &unlimited(), 5).wanted, 5);
        assert_eq!(plan_cast(&cast_cost("SWIN"), &unlimited(), 2).wanted, 0);
        assert_eq!(plan_cast(&cast_cost("SWIN"), &unlimited(), 5).wanted, 1);
        assert_eq!(plan_cast(&cast_cost("BIRD"), &unlimited(), 2).wanted, 0);
        // `BIRD` is one of the four skills the page words as an average (`ah-ofpb.5`), so its
        // ceiling is now the coin-flip arithmetic rather than the plain percentage: a level 3
        // eagle-tamer is `num = 1`, so `2 * num = 2` rather than the `1` a bare percentage ceiling
        // would give.
        assert_eq!(plan_cast(&cast_cost("BIRD"), &unlimited(), 3).wanted, 2);

        let gate = plan_cast(&cast_cost("CGAT"), &unlimited(), 3);
        assert_eq!(gate.wanted, 1);
        assert_eq!(gate.tag, None);
    }

    fn holding(items: &[(&str, i64)]) -> Vec<ItemAmount> {
        items
            .iter()
            .map(|(tag, amount)| ItemAmount {
                amount: *amount,
                name: tag.to_lowercase(),
                tag: (*tag).to_string(),
            })
            .collect()
    }

    #[test]
    fn plan_cast_is_capped_by_what_the_mage_holds() {
        let amulets = plan_cast(
            &cast_cost("CRPA"),
            &Caster {
                skills: &[],
                held: &[],
                silver_available: 400,
                transmuting: None,
            },
            3,
        );
        assert_eq!(amulets.made, 2);
        assert_eq!(amulets.wanted, 3);
        assert_eq!(amulets.capped_by, Some(ProductionCap::Silver));
        assert_eq!(amulets.charged, 2);
        assert_eq!(amulets.silver, 400);

        let swords = plan_cast(
            &cast_cost("ESWO"),
            &Caster {
                skills: &[],
                held: &holding(&[("SWOR", 4)]),
                silver_available: 0,
                transmuting: None,
            },
            3,
        );
        assert_eq!(swords.made, 4);
        assert_eq!(swords.capped_by, Some(ProductionCap::Materials));
        assert_eq!(
            swords
                .materials
                .iter()
                .map(|item| (item.tag.as_str(), item.amount))
                .collect::<Vec<_>>(),
            vec![("SWOR", 4)]
        );

        let broke = plan_cast(
            &cast_cost("CRPA"),
            &Caster {
                skills: &[],
                held: &[],
                silver_available: 100,
                transmuting: None,
            },
            3,
        );
        assert_eq!(broke.made, 0);
        assert_eq!(broke.charged, 1);
        assert_eq!(broke.silver, 200);
        assert_eq!(broke.capped_by, Some(ProductionCap::Silver));

        let too_low_level = plan_cast(
            &cast_cost("SWIN"),
            &Caster {
                skills: &[],
                held: &holding(&[("FLOA", 10_000), ("IRWD", 10_000)]),
                silver_available: 0,
                transmuting: None,
            },
            2,
        );
        assert_eq!(too_low_level.wanted, 0);
        assert_eq!(too_low_level.charged, 0);
        assert_eq!(too_low_level.capped_by, None);
        assert_eq!(too_low_level.materials, Vec::new());

        let short_on_two_materials = plan_cast(
            &cast_cost("SWIN"),
            &Caster {
                skills: &[],
                held: &holding(&[("FLOA", 80), ("IRWD", 40)]),
                silver_available: 0,
                transmuting: None,
            },
            5,
        );
        assert_eq!(short_on_two_materials.made, 0);
        assert_eq!(short_on_two_materials.charged, 1);
        assert_eq!(
            short_on_two_materials.capped_by,
            Some(ProductionCap::Materials)
        );
    }

    /// The navigator's Q2: a remainder chance is rounded up to a whole item and charged, so a
    /// level 3 ring maker's cast moves the Silver column even though nothing is certain, and a
    /// level 3 runesmith's is charged for all three it might make.
    #[test]
    fn plan_cast_rounds_a_chance_up_to_a_whole_item() {
        assert_eq!(plan_cast(&cast_cost("CRRI"), &unlimited(), 3).wanted, 1);
        assert_eq!(plan_cast(&cast_cost("CRRU"), &unlimited(), 3).wanted, 3);
    }

    /// A level 3 create-runesword mage is 90 x 3 = 270 percent: two runeswords certain and a 70
    /// percent chance of a third (`ah-ofpb.5`, settled with the navigator before this bead).
    #[test]
    fn plan_cast_names_the_fewest_a_chance_brings() {
        let plan = plan_cast(&cast_cost("CRRU"), &unlimited(), 3);
        assert_eq!(plan.made_certain, 2);
        assert_eq!(plan.made, 3);
    }

    /// A level 5 ring maker is 20 x 5 = 100 percent, exactly one ring: no chance is left over, so
    /// the floor and the ceiling agree and the column shows no range.
    #[test]
    fn plan_cast_leaves_no_range_when_the_chance_lands_exactly() {
        let plan = plan_cast(&cast_cost("CRRI"), &unlimited(), 5);
        assert_eq!(plan.made_certain, 1);
        assert_eq!(plan.made, 1);
    }

    /// The navigator's own arithmetic from the game engine, cited throughout as their decision and
    /// on neither committed page: `num = (level * percent + rand(0..99)) / 100`, then `2 * num`
    /// coin tosses with a floor of one when `num > 0`. A level 3 wolf master is `num = 6`, so
    /// `made == 12` and `made_certain == 1`; a level 3 eagle-tamer (`data/BIRD`, `levelOffset -2`)
    /// is `num = 1`, so `made == 2` and `made_certain == 1`.
    #[test]
    fn plan_cast_spreads_an_averaged_summon() {
        let wolf = plan_cast(&cast_cost("WOLF"), &unlimited(), 3);
        assert_eq!(wolf.made, 12);
        assert_eq!(wolf.made_certain, 1);

        let bird = plan_cast(&cast_cost("BIRD"), &unlimited(), 3);
        assert_eq!(bird.made, 2);
        assert_eq!(bird.made_certain, 1);
    }

    /// `data/WOLF`: "control a total number of his skill level squared times 4 wolves" - a level 3
    /// mage may control `4 * 3^2 = 36`. Holding 30 already, only 6 more fit, clamping the summon
    /// that the level alone would bring (12) down to what there is room for.
    #[test]
    fn plan_cast_is_clamped_by_what_the_mage_may_control() {
        let clamped = plan_cast(
            &cast_cost("WOLF"),
            &Caster {
                skills: &[],
                held: &holding(&[("WOLF", 30)]),
                silver_available: 0,
                transmuting: None,
            },
            3,
        );
        assert_eq!(clamped.made, 6);
        assert_eq!(clamped.wanted, 12);
        assert_eq!(clamped.capped_by, Some(ProductionCap::Room));
    }

    /// A mage already at its control cap summons none: 36 wolves is `4 * 3^2`, so a level 3 mage
    /// holding 36 has no room left. `data/SUBA`'s cap is a flat one - a mage already holding a
    /// balrog may control no more, whatever its level.
    #[test]
    fn a_mage_at_its_control_cap_summons_none() {
        let full_wolves = plan_cast(
            &cast_cost("WOLF"),
            &Caster {
                skills: &[],
                held: &holding(&[("WOLF", 36)]),
                silver_available: 0,
                transmuting: None,
            },
            3,
        );
        assert_eq!(full_wolves.made, 0);
        assert_eq!(full_wolves.capped_by, Some(ProductionCap::Room));

        let full_balrog = plan_cast(
            &cast_cost("SUBA"),
            &Caster {
                skills: &[],
                held: &holding(&[("BALR", 1)]),
                silver_available: 0,
                transmuting: None,
            },
            3,
        );
        assert_eq!(full_balrog.made, 0);
        assert_eq!(full_balrog.capped_by, Some(ProductionCap::Room));
    }

    /// The clamp must not move a shipped warning: all four capped skills cost nothing, so a
    /// control-clamped summon still charges no silver and consumes no materials - the guard this
    /// bead's Known traps names first, and it must be written before `cast()` itself is touched.
    #[test]
    fn a_clamped_summon_still_charges_what_it_always_did() {
        let clamped = plan_cast(
            &cast_cost("WOLF"),
            &Caster {
                skills: &[],
                held: &holding(&[("WOLF", 30)]),
                silver_available: 0,
                transmuting: None,
            },
            3,
        );
        assert_eq!(clamped.silver, 0);
        assert_eq!(clamped.materials, Vec::new());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_shape_of_a_transfer() {
        assert_eq!(
            transfer_shape(&Selector::WholeUnit, &Amount::Exact(5)),
            TransferShape::Unpriceable
        );
        assert_eq!(
            transfer_shape(
                &Selector::Class("men".to_string()),
                &Amount::All { except: 0 }
            ),
            TransferShape::Unpriceable
        );
        assert_eq!(
            transfer_shape(&Selector::Item("SILV".to_string()), &Amount::Exact(100)),
            TransferShape::Exact(100)
        );
        assert_eq!(
            transfer_shape(
                &Selector::Item("SILV".to_string()),
                &Amount::All { except: 20 }
            ),
            TransferShape::All { except: 20 }
        );
    }

    #[test]
    fn prices_a_units_tax_once_and_leaves_the_pool_policy_to_the_caller() {
        assert_eq!(
            price_tax(10, Some(8963), false, PoolShare::Uncontended),
            Priced {
                earns: 500,
                ..Priced::default()
            }
        );
        // capped by the base
        assert_eq!(
            price_tax(10, Some(200), false, PoolShare::Uncontended),
            Priced {
                earns: 200,
                ..Priced::default()
            }
        );
        // a pillaged hex is a certain zero even with no stated base (`ah-cxxa`)
        assert_eq!(
            price_tax(10, None, true, PoolShare::Uncontended),
            Priced {
                earns: 0,
                ..Priced::default()
            }
        );
        // no base, not pillaged
        assert_eq!(
            price_tax(10, None, false, PoolShare::Uncontended),
            Priced {
                doubt: Some(SilverDoubt::UnknownTaxBase),
                ..Priced::default()
            }
        );
        // the settlement wins where the caller passes one
        assert_eq!(
            price_tax(10, Some(8963), false, PoolShare::Share(120)),
            Priced {
                earns: 120,
                ..Priced::default()
            }
        );
        assert_eq!(
            price_tax(10, Some(8963), false, PoolShare::Unknowable),
            Priced {
                doubt: Some(SilverDoubt::ContestedRegionPool),
                ..Priced::default()
            }
        );
    }

    #[test]
    fn prices_a_purchase_a_sale_and_a_claim() {
        // a lone over-buyer is charged only for goods that exist (`ah-t2pn.3`)
        assert_eq!(
            price_purchase(200, 5, 100),
            Priced {
                spends: 500,
                ..Priced::default()
            }
        );
        assert_eq!(
            price_purchase(50, 5, 100),
            Priced {
                spends: 250,
                ..Priced::default()
            }
        );
        // `Amount::All { except }` can ask for a negative amount
        assert_eq!(quantity_sold(-5, 10, 100), 0);
        assert_eq!(quantity_bought(-5, 100), 0);
        // the claim policy is the caller's
        assert_eq!(
            price_claim(500, Some(120)),
            Priced {
                earns: 120,
                ..Priced::default()
            }
        );
        assert_eq!(
            price_claim(500, None),
            Priced {
                earns: 500,
                ..Priced::default()
            }
        );
    }

    /// `ah-vw8e`, increment 1. `price_sale_line` replaces `price_sale`: it resolves `Amount::All`
    /// against what is left as well as pricing the result, so the two remainders exist once.
    #[test]
    fn price_sale_line_resolves_all_against_what_is_left() {
        // ported from `price_sale`: a sale is capped by the share and by what the unit holds
        assert_eq!(
            price_sale_line(&Amount::Exact(100), 100, 20, 3),
            SoldLine {
                asked: 100,
                quantity: 20,
                earns: 60,
            }
        );
        assert_eq!(
            price_sale_line(&Amount::Exact(100), 10, 100, 3),
            SoldLine {
                asked: 100,
                quantity: 10,
                earns: 30,
            }
        );
        // `Amount::All { except }` resolves against what is left of the holding
        assert_eq!(
            price_sale_line(&Amount::All { except: 3 }, 10, 100, 42),
            SoldLine {
                asked: 7,
                quantity: 7,
                earns: 294,
            }
        );
        // and can ask for a negative amount, which `quantity_sold`'s `max(0)` catches
        assert_eq!(
            price_sale_line(&Amount::All { except: 3 }, 0, 100, 42),
            SoldLine {
                asked: -3,
                quantity: 0,
                earns: 0,
            }
        );
    }

    /// The pillagers of a hex, all of them counted.
    fn counted(ready: i64) -> Option<Pillagers> {
        Some(Pillagers {
            ready,
            incomplete: false,
        })
    }

    /// The pillagers of a hex where at least one of them could not be counted at all - so `ready`
    /// is a floor rather than the answer (`ah-q6bt`, U1).
    fn a_floor_of(ready: i64) -> Option<Pillagers> {
        Some(Pillagers {
            ready,
            incomplete: true,
        })
    }

    #[test]
    fn prices_a_pillage_from_the_base_and_the_threshold() {
        assert_eq!(
            price_pillage(None, counted(100), Some(100)),
            Priced {
                doubt: Some(SilverDoubt::UnknownTaxBase),
                ..Priced::default()
            }
        );
        assert_eq!(
            price_pillage(Some(8963), None, Some(90)),
            Priced {
                doubt: Some(SilverDoubt::UnknownCombatReady),
                ..Priced::default()
            }
        );
        assert_eq!(
            price_pillage(Some(100), counted(0), Some(0)),
            Priced {
                earns: 0,
                ..Priced::default()
            }
        );
        let base = 100;
        let needed = pillage_threshold(base);
        assert_eq!(
            price_pillage(Some(base), counted(needed), Some(needed)),
            Priced {
                earns: 200,
                ..Priced::default()
            }
        );
    }

    /// Decision **D1** (`ah-q6bt`): the take is divided between the pillaging units in proportion
    /// to their combat ready men, so the faction total is the take and not a multiple of it. The
    /// navigator's own hex, rounded to 300 and 1 men so the arithmetic is checkable by hand.
    #[test]
    fn prices_a_pillage_as_this_units_share_of_the_take() {
        let base = 22654;
        let pillagers = counted(301);
        assert_eq!(price_pillage(Some(base), pillagers, Some(300)).earns, 45157);
        assert_eq!(price_pillage(Some(base), pillagers, Some(1)).earns, 150);
        assert!(
            price_pillage(Some(base), pillagers, Some(300)).earns
                + price_pillage(Some(base), pillagers, Some(1)).earns
                <= base * 2,
            "the take is never promised twice"
        );
    }

    /// The gate cannot be settled: more men may yet be countable, so the threshold is unanswerable
    /// in the direction that matters.
    #[test]
    fn doubts_a_pillage_whose_pillagers_cannot_all_be_counted() {
        assert_eq!(
            price_pillage(Some(8963), a_floor_of(89), Some(89)),
            Priced {
                doubt: Some(SilverDoubt::UnknownCombatReady),
                ..Priced::default()
            }
        );
    }

    /// A floor already at the threshold settles it: more countable men cannot un-pass a gate, so
    /// this earns a real share rather than a doubt.
    #[test]
    fn settles_a_pillage_whose_known_men_already_pass() {
        assert_eq!(
            price_pillage(Some(8963), a_floor_of(90), Some(90)),
            Priced {
                earns: 17_926,
                ..Priced::default()
            }
        );
    }

    /// This unit's own men are the unknown ones, and its share is unknown with them - even where
    /// the gate is settled by everybody else's. A certain zero is the one answer it must not be.
    #[test]
    fn doubts_a_pillager_whose_own_men_cannot_be_counted() {
        assert_eq!(
            price_pillage(Some(8963), a_floor_of(90), None),
            Priced {
                doubt: Some(SilverDoubt::UnknownCombatReady),
                ..Priced::default()
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
            keyword: "",
        }
    }

    /// A unit with nothing but a headcount: no skills, no gifts, no market.
    fn facts<'a>(men: i64, intents: &'a [PlacedIntent], receipts: &'a Receipts) -> UnitFacts<'a> {
        UnitFacts {
            unit_id: "1234",
            region_id: "mountain (7,53)",
            held: 0,
            men,
            // No transfers in these tests, so the report's headcount is the early one (`ah-qct4`).
            men_reported: men,
            men_estimated: false,
            men_by_race: &[],
            items: &[],
            flags: &[],
            skills: &[],
            intents,
            receipts,
            formed: None,
            after_gifts_unknown: false,
            gifts_uncertain: false,
            food_uncertain: false,
            skills_unknown: false,
            production_skills: &[],
            production_skills_unknown: false,
            late: None,
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

    /// "The catalogue cannot say" - the answer that keeps every test's behaviour exactly as it was
    /// before `class_carries_silver` existed.
    fn no_class_members(_class: &str) -> Option<bool> {
        None
    }

    /// `true` for every target - what the column did before `ah-vcp8.2`, so no existing assertion
    /// moves for a reason unrelated to what it tests.
    /// Every target is one of ours, standing here - the reading these arithmetic tests had before
    /// `ah-66yi` split reach into five answers, so their expectations are unchanged.
    fn every_target_is_ours(_party: &Party) -> GiveReach {
        GiveReach::Ours
    }

    /// No gift left anything uncertain, so every later order prices exactly as it always did.
    fn nothing_uncertain(_tag: &str) -> Option<String> {
        None
    }

    /// No region to consult, so no regional pool applies - which is what keeps this module's own
    /// tests reading exactly as they did before `ah-256d` (`RegionShare::Unlimited`).
    fn no_region_pool(_item: &str) -> RegionShare {
        RegionShare::Unlimited
    }

    /// [`Lookups::region_product_name`]'s twin for a test with no region: the hex names nothing.
    fn no_region_product(_item: &str) -> Option<String> {
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
            region_share: &no_region_pool,
            region_product_name: &no_region_product,
            counted_item: &verbatim_counted,
            counted_or_none: &verbatim_counted_or_none,
            class_carries_silver: &no_class_members,
            give_reach: &every_target_is_ours,
            uncertain_after_gifts: &nothing_uncertain,
        }
    }

    /// [`Lookups::counted_item`]'s twin for a test with no catalogue: names the tag verbatim, the
    /// same way [`verbatim_name`] does.
    fn verbatim_counted(count: i64, tag: &str) -> String {
        format!("{count} {}", tag.to_lowercase())
    }

    /// [`Lookups::counted_or_none`]'s twin for a test with no catalogue: names the tag verbatim,
    /// writing zero as a word the same way the shipped closure does.
    fn verbatim_counted_or_none(count: i64, tag: &str) -> String {
        if count == 0 {
            format!("no {}", tag.to_lowercase())
        } else {
            verbatim_counted(count, tag)
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
            0,
            no_market(),
            None,
        )
    }

    #[test]
    fn produce_with_unknown_arrival_skills_reports_a_doubt() {
        let receipts = Receipts::default();
        let intents = [placed(Intent::Produce {
            item: "SWOR".to_string(),
        })];
        let mut facts = facts(8, &intents, &receipts);
        facts.production_skills_unknown = true;

        let unit = forecast_unit(
            facts,
            paying("$12.0", None),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            Some(&ruleset()),
        );

        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownSkillsAfterArrivals));
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

    /// A region whose tax base is stated and whose *pillaging* units have men enough to take it -
    /// the threshold exactly, and all of them this unit's own, so its share of the take is the
    /// whole of it (decision G1, `ah-q6bt`). What the `PILLAGE` arm needs before it credits
    /// anything (`ah-1ad6.2`).
    fn pillageable(tax_base: i64) -> RegionWages {
        RegionWages {
            tax_base: Some(tax_base),
            pillagers: Some(Pillagers {
                ready: pillage_threshold(tax_base),
                incomplete: false,
            }),
            ..RegionWages::default()
        }
    }

    /// Combat 1, which makes every man of a unit a taxer whatever it wields
    /// (`rules/economy_taxingpillaging`) - so a test unit's combat ready men are simply its men.
    fn combat_one() -> Skill {
        Skill {
            name: "combat".to_string(),
            tag: "COMB".to_string(),
            level: 1,
            points: 30,
        }
    }

    /// [`forecast`] for a unit that can actually pillage: `men` men, every one of them combat
    /// ready, priced against the committed ruleset. `forecast` itself passes no ruleset, and
    /// without one [`readiness`] answers `None` for every unit - which is a doubt, not a share
    /// (`ah-q6bt`).
    fn forecast_pillaging(men: i64, region: RegionWages, intents: &[PlacedIntent]) -> UnitSilver {
        let receipts = Receipts::default();
        let skills = [combat_one()];
        forecast_unit(
            UnitFacts {
                skills: &skills,
                ..facts(men, intents, &receipts)
            },
            region,
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            Some(&ruleset()),
        )
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

    /// `ah-qct4`. `rules/sequenceofevents` settles GIVE and TAKE before either PRODUCE phase, so
    /// a unit that parts with men produces less than its report suggests - and nothing else on the
    /// row says so, which is what `production_men_left` is for.
    ///
    /// The committed ruleset's sword recipe is weaponsmith, one iron a sword, one man-month a
    /// sword, one output - so three weaponsmith-1 men with twenty iron make three and nothing caps
    /// them. The skill is stated because the rate counts it (`ah-vtwn`); at level 0 the unit would
    /// make none.
    #[test]
    fn a_unit_that_parted_with_men_reports_how_many_left() {
        let receipts = Receipts::default();
        let intents = [placed(Intent::Produce {
            item: "SWOR".to_string(),
        })];
        let items = [ItemAmount {
            amount: 20,
            name: "iron".into(),
            tag: "IRON".into(),
        }];
        let smith = [skill("WEAP", 1)];
        let unit = forecast_unit(
            UnitFacts {
                men_reported: 8,
                items: &items,
                skills: &smith,
                production_skills: &smith,
                late: Some(LateFacts {
                    men: 3,
                    men_by_race: &[],
                    items: &items,
                }),
                ..facts(3, &intents, &receipts)
            },
            paying("$12.0", None),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            Some(&ruleset()),
        );

        assert_eq!(unit.production_men_left, 5);
        assert_eq!(unit.produced, 3);
    }

    /// Clamped at zero: a unit that *gains* men produces more, which needs no sentence.
    #[test]
    fn a_unit_that_gained_men_reports_none_left() {
        let receipts = Receipts::default();
        let intents = [placed(Intent::Produce {
            item: "SWOR".to_string(),
        })];
        let items = [ItemAmount {
            amount: 20,
            name: "iron".into(),
            tag: "IRON".into(),
        }];
        let smith = [skill("WEAP", 1)];
        let unit = forecast_unit(
            UnitFacts {
                men_reported: 3,
                items: &items,
                skills: &smith,
                production_skills: &smith,
                late: Some(LateFacts {
                    men: 8,
                    men_by_race: &[],
                    items: &items,
                }),
                ..facts(8, &intents, &receipts)
            },
            paying("$12.0", None),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            Some(&ruleset()),
        );

        assert_eq!(unit.production_men_left, 0);
        assert_eq!(unit.produced, 8);
    }

    /// `0` for a unit with no `PRODUCE` at all, exactly as `produced` is - the field says how many
    /// fewer men work *this unit's production*, and a unit producing nothing has none.
    #[test]
    fn a_unit_with_no_production_reports_none_left() {
        let receipts = Receipts::default();
        let items = [ItemAmount {
            amount: 20,
            name: "iron".into(),
            tag: "IRON".into(),
        }];
        let unit = forecast_unit(
            UnitFacts {
                men_reported: 8,
                items: &items,
                late: Some(LateFacts {
                    men: 3,
                    men_by_race: &[],
                    items: &items,
                }),
                ..facts(3, &[], &receipts)
            },
            paying("$12.0", None),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            Some(&ruleset()),
        );

        assert_eq!(unit.production_men_left, 0);
    }

    /// Flags as the report prints them, for the taxing-flag rules.
    fn flags(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    use crate::movement::rules::{CastCost, CastInput};

    /// A spell entry as the catalogue would carry one, with an optional `SILV` cast cost.
    fn spell(tag: &str, silver: Option<i64>) -> SkillEntry {
        SkillEntry {
            tag: tag.to_string(),
            name: tag.to_lowercase(),
            cost: None,
            max_level: 5,
            cast: silver.map(|amount| CastCost {
                costs: vec![CastInput {
                    tag: SILVER_TAG.to_string(),
                    amount,
                }],
                transmute: BTreeMap::new(),
                creates: Vec::new(),
            }),
            produces: Vec::new(),
            magic: true,
            damages_enemies: false,
            requires: Vec::new(),
            levels: Vec::new(),
        }
    }

    #[test]
    fn prices_a_cast_that_earns_and_one_that_costs() {
        let phantasmal = spell(PHANTASMAL_TAG, None);
        let earth_lore = spell(EARTH_LORE_TAG, None);
        let skills = [skill(PHANTASMAL_TAG, 3), skill(EARTH_LORE_TAG, 2)];
        let caster = Caster {
            skills: &skills,
            held: &[],
            silver_available: 0,
            transmuting: None,
        };

        // Level 3 wants 1800; the region's pool holds 500, so 500 is what it earns.
        assert_eq!(
            price_cast(
                Some(&phantasmal),
                &caster,
                RegionWages {
                    entertainment: Some(500),
                    ..RegionWages::default()
                }
            )
            .0,
            Priced {
                earns: 500,
                ..Priced::default()
            }
        );

        // A hex stating no entertainment pool pays nothing, and doubts nothing.
        assert_eq!(
            price_cast(Some(&phantasmal), &caster, RegionWages::default()),
            (Priced::default(), None)
        );

        // Earth Lore at level 2 with a wage of 13.5: 2 x 2 x 1350 / 100 = 54. Multiplied out
        // before the divide, so the fractional wage is not lost - 2 x 2 x 13 would be 52.
        assert_eq!(
            price_cast(
                Some(&earth_lore),
                &caster,
                RegionWages {
                    wage_centis: Some(1350),
                    ..RegionWages::default()
                }
            )
            .0,
            Priced {
                earns: 54,
                ..Priced::default()
            }
        );

        // A spell that costs silver to cast, and earns nothing. It creates nothing an item
        // catalogue can carry, so the page prices the attempt: `wanted` 1, and a mage that cannot
        // afford it is still charged for the one attempt (`ah-ofpb.4`, R2).
        assert_eq!(
            price_cast(
                Some(&spell("FIRE", Some(60))),
                &caster,
                RegionWages::default()
            )
            .0,
            Priced {
                spends: 60,
                ..Priced::default()
            }
        );

        // A spell the ruleset does not know earns nothing, costs nothing and doubts nothing.
        assert_eq!(
            price_cast(None, &caster, RegionWages::default()),
            (Priced::default(), None)
        );
    }

    /// `ah-ofpb.4`: a level 3 amulet maker with enough silver spends for every item it makes, not
    /// for one - `$200` once was the shipped reading `price_cast`'s own doc comment named as the
    /// defect this bead fixes.
    #[test]
    fn prices_a_cast_for_every_item_it_makes() {
        let ruleset = ruleset();
        let skills = [skill("CRPA", 3)];
        let caster = Caster {
            skills: &skills,
            held: &[],
            silver_available: 600,
            transmuting: None,
        };

        let (priced, plan) =
            price_cast(ruleset.find_skill("CRPA"), &caster, RegionWages::default());
        assert_eq!(priced.spends, 600);
        assert_eq!(plan.expect("a priceable cast").made, 3);
    }

    /// `ah-ofpb.4`: the four `cast_*` fields `forecast_unit` fills, both capped and at full rate.
    /// `cast_made_named` is whatever this module's test `Lookups` produce, **not** English -
    /// `no_market()` names items with `verbatim_counted`, so it reads "2 ampr" rather than "2
    /// amulets of protection"; the real English is `a_capped_cast_names_what_it_will_make` in
    /// `semantics.rs`, the one test that runs through the naming closure `forecast_hex` actually
    /// builds.
    #[test]
    fn a_capped_cast_says_what_it_will_make() {
        let ruleset = ruleset();
        let receipts = Receipts::default();
        let intents = [placed(Intent::Cast {
            spell: "Create_Amulet_Of_Protection".to_string(),
            arguments: Vec::new(),
        })];
        let skills = [skill("CRPA", 3)];
        let cast = |held: i64| {
            forecast_unit(
                UnitFacts {
                    held,
                    skills: &skills,
                    ..facts(1, &intents, &receipts)
                },
                RegionWages::default(),
                PoolShares::default(),
                FactionPurse::default(),
                0,
                no_market(),
                Some(&ruleset),
            )
        };

        let capped = cast(400);
        assert_eq!(capped.expense, Some(400));
        assert_eq!(capped.cast_made, 2);
        assert_eq!(capped.cast_made_named.as_deref(), Some("2 ampr"));
        assert_eq!(capped.cast_wanted, 3);
        assert_eq!(capped.cast_capped_by, Some(ProductionCap::Silver));

        let full_rate = cast(600);
        assert_eq!(full_rate.expense, Some(600));
        assert_eq!(full_rate.cast_made, 3);
        assert_eq!(full_rate.cast_capped_by, None);
    }

    /// The navigator's R4: silver a gift brings in time funds the cast, unlike `PRODUCE`'s cap
    /// against the unit's own holding alone. Under the rejected reading (judging the cap on what
    /// the mage holds now, as `PRODUCE` does) this mage would make none and spend $200.
    #[test]
    fn a_cast_counts_the_silver_a_gift_brings_it() {
        let ruleset = ruleset();
        let receipts = Receipts {
            silver: 600,
            ..Receipts::default()
        };
        let intents = [placed(Intent::Cast {
            spell: "Create_Amulet_Of_Protection".to_string(),
            arguments: Vec::new(),
        })];
        let skills = [skill("CRPA", 3)];

        let unit = forecast_unit(
            UnitFacts {
                held: 0,
                skills: &skills,
                ..facts(1, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            Some(&ruleset),
        );

        assert_eq!(unit.cast_made, 3);
        assert_eq!(unit.expense, Some(600));
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
            0,
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
                0,
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
        let unit = forecast_pillaging(
            pillage_threshold(2500),
            pillageable(2500),
            &[placed(Intent::Pillage)],
        );
        assert_eq!(unit.income, Some(5000));
        assert_eq!(unit.at_month_end, Some(5000));
        assert_eq!(unit.doubt, None);
    }

    /// A silent zero is the defect being removed, so `income` is asserted `None` and not merely
    /// the doubt: a column that showed nothing would pass a test that only read the doubt.
    #[test]
    fn a_pillaging_unit_with_no_stated_tax_base_is_doubted() {
        let unit = forecast_pillaging(1, taxable(None), &[placed(Intent::Pillage)]);
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
        let receipts = Receipts::default();
        let skills = [combat_one()];
        let ruleset = ruleset();
        let unit = forecast_unit(
            UnitFacts {
                skills: &skills,
                ..facts(pillage_threshold(2500), &intents, &receipts)
            },
            pillageable(2500),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            Lookups {
                purchase: &sells(12, 40),
                ..no_market()
            },
            Some(&ruleset),
        );
        assert_eq!(unit.income, Some(5000));
        assert_eq!(unit.expense, Some(480));
        assert_eq!(unit.at_month_end, Some(4520));
    }

    /// The reported defect (`ah-1ad6.2`): *The Lost One (683)*, one leader in a hex whose tax base
    /// is 8,963, was credited the full 17,926. The pillagers need 90 combat ready men between them.
    #[test]
    fn pillagers_without_the_men_earn_nothing() {
        let region = RegionWages {
            tax_base: Some(8963),
            pillagers: counted(1),
            ..RegionWages::default()
        };
        let unit = forecast_pillaging(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, Some(0));
        assert_eq!(unit.doubt, None);
    }

    /// No regression on `ah-abwx`: the sole pillager, having the men, is credited the whole take.
    #[test]
    fn the_only_pillager_with_the_men_is_credited_in_full() {
        let region = RegionWages {
            tax_base: Some(8963),
            pillagers: counted(90),
            ..RegionWages::default()
        };
        let unit = forecast_pillaging(90, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(17_926));
        assert_eq!(unit.doubt, None);
    }

    /// A guessed headcount among the *pillagers* leaves the threshold unanswerable in the
    /// direction that matters: the estimate might be what carries them over it. A guess anywhere
    /// else in the hex no longer says anything at all, which is decision G1 (`ah-q6bt`).
    #[test]
    fn a_guessed_headcount_among_the_pillagers_doubts_the_pillage() {
        let region = RegionWages {
            tax_base: Some(8963),
            pillagers: a_floor_of(1),
            ..RegionWages::default()
        };
        let unit = forecast_pillaging(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownCombatReady));
        assert_eq!(unit.income, None);
    }

    /// Decision **G1** and **D1** together (`ah-q6bt`), and the reversal of what shipped before:
    /// a lone leader ordering `PILLAGE` beside eighty-nine armed faction-mates who also ordered it
    /// takes its *share*, one ninetieth, and not the whole take. Before this bead the column
    /// credited it all 17,926 - and credited the army the same 17,926 again, so the faction total
    /// was a multiple of a take the region only holds once.
    #[test]
    fn the_men_are_counted_across_the_pillagers_and_the_take_divided_between_them() {
        let region = RegionWages {
            tax_base: Some(8963),
            pillagers: counted(90),
            ..RegionWages::default()
        };
        let unit = forecast_pillaging(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.income, Some(199), "17_926 / 90, truncated");
        assert_eq!(unit.doubt, None);
    }

    /// The older doubt wins: what the region holds is unknown before the question of who may take
    /// it arises.
    #[test]
    fn an_unknown_tax_base_outranks_an_unknown_headcount() {
        let region = RegionWages {
            tax_base: None,
            pillagers: None,
            ..RegionWages::default()
        };
        let unit = forecast_pillaging(1, region, &[placed(Intent::Pillage)]);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnknownTaxBase));
    }

    /// Guards against the arm being folded into `Tax`'s match rather than written beside it: a
    /// pillaging unit earns twice the base and nothing per man.
    #[test]
    fn pillaging_does_not_also_tax() {
        let unit = forecast_pillaging(
            pillage_threshold(1000),
            pillageable(1000),
            &[placed(Intent::Pillage)],
        );
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
            0,
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
            0,
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
            0,
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
            0,
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
            0,
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
            0,
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

    /// `ah-vw8e`, increment 2. A block naming the same goods twice can only move what the first
    /// line left of the unit's stock, so the second earns nothing rather than pricing itself
    /// against the whole holding a second time.
    #[test]
    fn a_second_sell_all_of_the_same_goods_earns_nothing() {
        let unit = sold(
            &[
                selling("furs", Amount::All { except: 0 }),
                selling("furs", Amount::All { except: 0 }),
            ],
            &wanted(42, 100, 10),
        );
        assert_eq!(unit.income, Some(420));
    }

    /// [`sold`], for a hex whose market line has been settled between the faction's own units.
    fn sold_with_share(
        intents: &[PlacedIntent],
        sale: &dyn Fn(&str) -> SaleAnswer,
        share: &dyn Fn(&str, MarketSide) -> Option<i64>,
    ) -> UnitSilver {
        let receipts = Receipts::default();
        forecast_unit(
            facts(1, intents, &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            Lookups {
                sale,
                market_share: share,
                ..no_market()
            },
            None,
        )
    }

    /// `ah-vw8e`, increment 3. The settled share is spent down the same way the holding is: a
    /// second `SELL ALL` of the same goods finds the share already spent by the first.
    #[test]
    fn two_sell_lines_never_earn_more_than_the_settled_share() {
        let unit = sold_with_share(
            &[
                selling("furs", Amount::All { except: 0 }),
                selling("furs", Amount::All { except: 0 }),
            ],
            &wanted(42, 100, 10),
            &|_item, _side| Some(3),
        );
        assert_eq!(unit.income, Some(126));
    }

    #[test]
    fn selling_more_than_the_unit_holds_sells_only_what_it_holds() {
        let unit = sold(&[selling("furs", Amount::Exact(40))], &wanted(24, 40, 12));
        assert_eq!(unit.income, Some(288));
    }

    /// `ah-q7jd`. `unit_holds` is the market-phase holding `forecast_hex`'s sale closure now
    /// reads from `Ordered::early_holding` rather than the report's own figure - a unit whose
    /// earlier gift has already moved everything away sells nothing, whatever the report shows.
    #[test]
    fn selling_all_of_goods_this_months_gift_moved_away_earns_nothing() {
        let unit = sold(
            &[selling("furs", Amount::All { except: 0 })],
            &wanted(24, 40, 0),
        );
        assert_eq!(unit.income, Some(0));
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
            0,
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
            0,
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
            0,
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
            0,
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
            ..Receipts::default()
        };
        let unit = forecast_unit(
            facts(5, &[], &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            None,
        );
        assert_eq!(unit.income, Some(200));
        assert_eq!(unit.received, 200);
        assert_eq!(unit.givers, vec!["Paymaster (2390)".to_string()]);
        assert_eq!(unit.doubt, None);
    }

    /// `ah-awcm`: silver a unit takes from a neighbour is income, and the hover can name where it
    /// came from.
    #[test]
    fn a_taker_counts_what_it_takes() {
        let receipts = Receipts {
            taken: 100,
            taken_from: vec!["Workers (6567)".to_string()],
            ..Receipts::default()
        };
        let unit = forecast_unit(
            facts(5, &[], &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            None,
        );
        assert_eq!(unit.income, Some(100));
        assert_eq!(unit.taken, 100);
        assert_eq!(unit.taken_from, vec!["Workers (6567)".to_string()]);
        assert_eq!(unit.doubt, None);
    }

    /// `ah-awcm`: silver taken from a unit the report does not show here is income too - the
    /// ledger credits it, and a column that did not would contradict the figures it displays.
    #[test]
    fn a_taker_counts_what_it_takes_from_a_source_the_report_does_not_show() {
        let receipts = Receipts {
            taken_unshown: 100,
            taken_unshown_from: vec!["unit 999".to_string()],
            ..Receipts::default()
        };
        let unit = forecast_unit(
            facts(5, &[], &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            None,
        );
        assert_eq!(unit.income, Some(100));
        assert_eq!(unit.taken_unshown, 100);
        assert_eq!(unit.taken_unshown_from, vec!["unit 999".to_string()]);
        assert_eq!(unit.taken, 0);
        assert_eq!(unit.doubt, None);
    }

    /// `ah-awcm`: what the source will have left to give depends on its own month, so the taker's
    /// whole figure goes unsaid.
    #[test]
    fn a_take_of_all_silver_doubts_the_unit() {
        let receipts = Receipts {
            take_all_unpriceable: true,
            ..Receipts::default()
        };
        let unit = forecast_unit(
            facts(5, &[], &receipts),
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
            None,
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::TakesAllFromAnother));
        assert_eq!(unit.income, None);
        assert_eq!(unit.at_month_end, None);
    }

    #[test]
    fn a_gift_is_income_on_top_of_what_the_unit_earns_itself() {
        let receipts = Receipts {
            silver: 200,
            givers: vec!["Paymaster (2390)".to_string()],
            ..Receipts::default()
        };
        let intents = [placed(Intent::Tax)];
        let unit = forecast_unit(
            facts(8, &intents, &receipts),
            taxable(Some(100_000)),
            PoolShares::default(),
            FactionPurse::default(),
            0,
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
            0,
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
            0,
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
            0,
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

    /// `ah-lauy`, increment 2. A second `BUY ALL` of the same goods buys nothing: the fallback
    /// (`no_market`'s `market_share` answers `None` for everything) subtracts the running total
    /// from the line itself, not only from a settled share.
    #[test]
    fn a_second_buy_all_of_the_same_goods_buys_nothing() {
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
        // 100 buys five at 12 up to the market's 5, leaving 40; the second finds the line already
        // spent by the first and buys nothing more.
        let unit = spending(100, &intents, RegionWages::default(), &sells(12, 5), None);
        assert_eq!(unit.expense, Some(60));
        assert_eq!(unit.at_month_end, Some(40));
    }

    /// `ah-lauy`, increment 2. The settled-share path: a `market_share` stub answers a share
    /// smaller than the line, and the second `BUY ALL` finds that share already spent.
    #[test]
    fn a_second_buy_all_cannot_take_its_share_twice() {
        let buy_all = placed(Intent::Buy {
            amount: Amount::All { except: 0 },
            item: "grain".to_string(),
        });
        let unit = spending_with_share(10_000, &[buy_all.clone(), buy_all], &sells(12, 20), 3);
        assert_eq!(unit.expense, Some(36));
    }

    /// [`spending`], for a unit whose share of the line the hex has settled - the shape
    /// `forecast_hex` always produces for a `For Sale` line, and the one `no_market`'s
    /// `market_share` cannot express.
    fn spending_with_share(
        held: i64,
        intents: &[PlacedIntent],
        purchase: &dyn Fn(&str) -> PurchaseAnswer,
        share: i64,
    ) -> UnitSilver {
        let receipts = Receipts::default();
        let market_share = move |_item: &str, side: MarketSide| {
            matches!(side, MarketSide::Buying).then_some(share)
        };
        forecast_unit(
            UnitFacts {
                held,
                ..facts(1, intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            Lookups {
                purchase,
                market_share: &market_share,
                ..no_market()
            },
            None,
        )
    }

    /// `ah-lauy`, increment 3. The exact form's running total, against a settled share.
    #[test]
    fn two_exact_buys_of_the_same_goods_share_one_settled_share() {
        let intents = vec![
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending_with_share(10_000, &intents, &sells(12, 20), 5);
        assert_eq!(unit.expense, Some(60));
    }

    /// `ah-lauy`, increment 3. With no settled share at all, the exact arm's fallback is what the
    /// unit asked for - not a quantity of goods - so there is nothing there for an earlier line to
    /// have spent down.
    #[test]
    fn an_exact_buy_with_no_settled_share_is_uncapped() {
        let intents = vec![
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
            placed(Intent::Buy {
                amount: Amount::Exact(5),
                item: "grain".to_string(),
            }),
        ];
        let unit = spending(
            10_000,
            &intents,
            RegionWages::default(),
            &sells(12, 20),
            None,
        );
        assert_eq!(unit.expense, Some(120));
    }

    // --- ah-jown: price_buy_all --------------------------------------------------------------

    #[test]
    fn a_buy_all_is_capped_by_silver_when_it_runs_out_first() {
        let (priced, plan) = price_buy_all(356, 18, 30, 30, 0);
        assert_eq!(priced.spends, 342);
        assert_eq!(plan.bought, 19);
        assert_eq!(plan.affordable, 19);
        assert_eq!(plan.capped_by, BuyAllCap::Silver);
    }

    #[test]
    fn a_buy_all_capped_by_a_small_market_names_the_market() {
        let (_, plan) = price_buy_all(356, 18, 5, 5, 0);
        assert_eq!(plan.bought, 5);
        assert_eq!(plan.capped_by, BuyAllCap::Market);
    }

    #[test]
    fn a_buy_all_whose_share_is_short_of_the_line_names_the_split() {
        let (_, plan) = price_buy_all(356, 18, 5, 10, 0);
        assert_eq!(plan.bought, 5);
        assert_eq!(plan.capped_by, BuyAllCap::Shared);
    }

    #[test]
    fn an_exact_tie_is_told_as_silver() {
        let (_, plan) = price_buy_all(342, 18, 19, 19, 0);
        assert_eq!(plan.bought, 19);
        assert_eq!(plan.capped_by, BuyAllCap::Silver);
    }

    #[test]
    fn a_unit_that_cannot_afford_one_buys_none_and_blames_its_silver() {
        let (_, plan) = price_buy_all(10, 18, 30, 30, 0);
        assert_eq!(plan.bought, 0);
        assert_eq!(plan.affordable, 0);
        assert_eq!(plan.capped_by, BuyAllCap::Silver);
    }

    #[test]
    fn a_line_priced_at_nothing_buys_nothing() {
        let (priced, plan) = price_buy_all(356, 0, 30, 30, 0);
        assert_eq!(priced.spends, 0);
        assert_eq!(plan.bought, 0);
    }

    // --- ah-lauy: price_buy_all learns the earlier lines -------------------------------------

    #[test]
    fn a_buy_all_whose_own_earlier_line_emptied_the_share_says_so() {
        let (_, plan) = price_buy_all(360, 12, 5, 5, 5);
        assert_eq!(plan.bought, 0);
        assert_eq!(plan.capped_by, BuyAllCap::AlreadyBought);

        let (_, plan) = price_buy_all(360, 12, 5, 5, 3);
        assert_eq!(plan.bought, 2);
        assert_eq!(plan.capped_by, BuyAllCap::AlreadyBought);
    }

    /// Round-2 Q3: the unit's own earlier line wins the sentence even when the purse is also
    /// empty - "it holds 0 silver" is true of every spent-up `BUY ALL` and would hide the one
    /// thing the player can act on.
    #[test]
    fn a_buy_all_capped_by_its_own_line_beats_an_empty_purse() {
        let (_, plan) = price_buy_all(0, 12, 5, 5, 5);
        assert_eq!(plan.bought, 0);
        assert_eq!(plan.capped_by, BuyAllCap::AlreadyBought);
    }

    #[test]
    fn a_buy_all_says_what_it_bought_and_what_stopped_it() {
        let intents = vec![placed(Intent::Buy {
            amount: Amount::All { except: 0 },
            item: "grain".to_string(),
        })];
        let unit = spending(356, &intents, RegionWages::default(), &sells(18, 30), None);
        assert_eq!(unit.expense, Some(342));
        assert_eq!(unit.buy_all.len(), 1);
        let bought = &unit.buy_all[0];
        assert_eq!(bought.bought, 19);
        assert_eq!(bought.capped_by, BuyAllCap::Silver);
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

    /// `GIVE 901 UNIT` names no class at all, so it reaches the untouched body below and keeps
    /// today's sentence - no subject, which is what the hover's fallback depends on.
    #[test]
    fn giving_away_a_whole_class_of_goods_is_doubted() {
        let intents = vec![placed(Intent::Give {
            to: Party::Unit("1235".to_string()),
            what: Selector::WholeUnit,
            amount: Amount::All { except: 0 },
        })];
        let unit = spending(500, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, None);
        assert_eq!(unit.doubt, Some(SilverDoubt::GivesAWholeClass));
        assert_eq!(unit.doubt_subject, None);
    }

    /// Reads whether a class carries silver against the real, committed ruleset - unlike
    /// `no_market()`'s own lookup, which always answers "cannot say" and exists for the tests
    /// above that are not about class resolution at all.
    fn class_carries_silver_against(rules: &Ruleset) -> impl Fn(&str) -> Option<bool> + '_ {
        move |class: &str| {
            if class.eq_ignore_ascii_case("ITEM") || class.eq_ignore_ascii_case("ITEMS") {
                return Some(true);
            }
            rules
                .class_members(class)
                .map(|tags| tags.iter().any(|tag| tag == SILVER_TAG))
        }
    }

    /// `ah-3sp7.1` taught the catalogue `NORMAL`'s members, and `SILV` is one of them - so
    /// `GIVE ... ALL NORMAL` now hands over the unit's silver exactly as `GIVE ... ALL SILV` does.
    #[test]
    fn giving_all_normal_hands_over_the_silver() {
        let rules = ruleset();
        let carries_silver = class_carries_silver_against(&rules);
        let intents = vec![placed(Intent::Give {
            to: Party::Unit("1235".to_string()),
            what: Selector::Class("NORMAL".to_string()),
            amount: Amount::All { except: 0 },
        })];
        let receipts = Receipts::default();
        let unit = forecast_unit(
            UnitFacts {
                held: 500,
                ..facts(1, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            Lookups {
                class_carries_silver: &carries_silver,
                ..no_market()
            },
            Some(&rules),
        );
        assert_eq!(unit.doubt, None);
        assert_eq!(unit.expense, Some(500));
        assert_eq!(unit.at_month_end, Some(0));
    }

    /// `MOUNT` is resolved by the catalogue and carries no silver - the `Some(false)` branch,
    /// which must produce neither an expense nor a doubt: nothing of this unit's money is even in
    /// question, unlike `MAGIC` below, which the catalogue cannot read at all.
    #[test]
    fn giving_a_resolvable_class_with_no_silver_neither_spends_nor_doubts() {
        let rules = ruleset();
        let carries_silver = class_carries_silver_against(&rules);
        let intents = vec![placed(Intent::Give {
            to: Party::Unit("1235".to_string()),
            what: Selector::Class("MOUNT".to_string()),
            amount: Amount::All { except: 0 },
        })];
        let receipts = Receipts::default();
        let unit = forecast_unit(
            UnitFacts {
                held: 500,
                ..facts(1, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            Lookups {
                class_carries_silver: &carries_silver,
                ..no_market()
            },
            Some(&rules),
        );
        assert_eq!(unit.doubt, None);
        assert_eq!(unit.expense, Some(0));
        assert_eq!(unit.at_month_end, Some(500));
    }

    /// `MAGIC` is one of the three classes the data page never states the members of, so the
    /// catalogue cannot say whether it carries silver - the unit is doubted, and named.
    #[test]
    fn giving_a_class_the_catalogue_cannot_read_names_it() {
        let rules = ruleset();
        let carries_silver = class_carries_silver_against(&rules);
        let intents = vec![placed(Intent::Give {
            to: Party::Unit("1235".to_string()),
            what: Selector::Class("magic".to_string()),
            amount: Amount::All { except: 0 },
        })];
        let receipts = Receipts::default();
        let unit = forecast_unit(
            UnitFacts {
                held: 500,
                ..facts(1, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            Lookups {
                class_carries_silver: &carries_silver,
                ..no_market()
            },
            Some(&rules),
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::GivesAWholeClass));
        assert_eq!(unit.doubt_subject, Some("MAGIC".to_string()));
    }

    /// `spending` gives the unit no skills at all, and a mage with no skill in the spell now
    /// creates nothing and is charged nothing (Q3, `ah-ofpb.4`) - so this needs a level, unlike
    /// the two tests beside it, to still exercise the `SILV` charge it is named for.
    #[test]
    fn a_cast_that_consumes_silver_is_charged_for_it() {
        let ruleset = ruleset();
        let receipts = Receipts::default();
        let intents = [placed(Intent::Cast {
            spell: "create amulet of protection".to_string(),
            arguments: Vec::new(),
        })];
        let skills = [skill("CRPA", 1)];
        let unit = forecast_unit(
            UnitFacts {
                held: 500,
                skills: &skills,
                ..facts(1, &intents, &receipts)
            },
            RegionWages::default(),
            PoolShares::default(),
            FactionPurse::default(),
            0,
            no_market(),
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
            // No transfers in these tests, so the report's headcount is the early one (`ah-qct4`).
            men_reported: men,
            men_estimated: false,
            men_by_race,
            items,
            flags,
            skills: &[],
            intents: &[],
            receipts: no_receipts(),
            formed: None,
            after_gifts_unknown: false,
            gifts_uncertain: false,
            food_uncertain: false,
            skills_unknown: false,
            production_skills: &[],
            production_skills_unknown: false,
            late: None,
        }
    }

    fn consuming() -> Vec<String> {
        vec!["Consuming Unit's Food".to_string()]
    }

    /// The committed ruleset applies the rules/economy_maintenance New Origins override.
    fn upkeep(facts: &UnitFacts<'_>) -> Option<i64> {
        unit_upkeep(facts, Some(&ruleset()))
    }

    #[test]
    fn a_unit_of_ordinary_characters_owes_ten_each() {
        let men = [item(6, "MAN")];
        assert_eq!(upkeep(&made_of(6, &men, &[], &[])), Some(60));
    }

    #[test]
    fn a_leader_owes_fifty() {
        let men = [item(1, "LEAD")];
        assert_eq!(upkeep(&made_of(1, &men, &[], &[])), Some(50));
    }

    #[test]
    fn a_mixed_unit_owes_both() {
        let men = [item(2, "LEAD"), item(5, "MAN")];
        assert_eq!(upkeep(&made_of(7, &men, &[], &[])), Some(150));
    }

    #[test]
    fn a_unit_with_no_breakdown_is_all_ordinary_characters() {
        assert_eq!(upkeep(&made_of(4, &[], &[], &[])), Some(40));
    }

    #[test]
    fn a_unit_whose_headcount_is_a_guess_has_no_upkeep() {
        let mut facts = made_of(4, &[], &[], &[]);
        facts.men_estimated = true;
        assert_eq!(upkeep(&facts), None);
    }

    #[test]
    fn one_grain_pays_a_leaders_fifty_silver_fee() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "GRAI")];
        let flags = consuming();
        assert_eq!(upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    /// A leader's 50-silver fee is covered by one current-catalogue food.
    #[test]
    fn a_fifty_silver_leader_is_covered_by_two_thirty_silver_foods() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "GRAI")];
        let flags = consuming();
        assert_eq!(upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    #[test]
    fn a_unit_that_is_not_consuming_pays_silver_even_holding_food() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "GRAI")];
        assert_eq!(upkeep(&made_of(1, &men, &food, &[])), Some(50));
    }

    #[test]
    fn food_covers_its_data_value_rounding_up() {
        let men = [item(1, "MAN")];
        let food = [item(1, "GRAI")];
        let flags = consuming();
        // A character owes 10; one grain worth 30 covers the whole of it, the fraction wasted.
        assert_eq!(upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    #[test]
    fn food_runs_out_and_the_rest_is_silver() {
        let men = [item(16, "LEAD")];
        let food = [item(5, "GRAI")];
        let flags = consuming();
        // 16 leaders owe 800; five grain at 50 cover 250, leaving 550.
        assert_eq!(upkeep(&made_of(16, &men, &food, &flags)), Some(550));
    }

    #[test]
    fn only_items_the_catalogue_prices_as_food_count() {
        let men = [item(1, "LEAD")];
        let not_food = [item(9, "IRON")];
        let flags = consuming();
        assert_eq!(upkeep(&made_of(1, &men, &not_food, &flags)), Some(50));
    }

    /// A unit whose larder is several kinds of food spends all of them: a leader owing 50 with one
    /// grain and one fish eats both for 60, capped at the fee, and owes nothing.
    #[test]
    fn mixed_food_tags_are_all_counted() {
        let men = [item(1, "LEAD")];
        let food = [item(1, "GRAI"), item(1, "FISH")];
        let flags = consuming();
        assert_eq!(upkeep(&made_of(1, &men, &food, &flags)), Some(0));
    }

    /// Unit 1660 of the committed turn-17 report: 32 humans set to consume, holding livestock. The
    /// Seven livestock cover 320 silver at the current 50-silver value; 30 would leave 110 unpaid.
    #[test]
    fn thirty_two_humans_consume_seven_livestock_at_fifty_each() {
        let men = [item(32, "HUMN")];
        let food = [item(7, "LIVE")];
        let flags = vec!["consuming faction's food".to_string()];
        // 32 humans owe 320; seven livestock at 50 cover 350, so nothing is left owing.
        assert_eq!(upkeep(&made_of(32, &men, &food, &flags)), Some(0));
        assert_eq!((320 + 50 - 1) / 50, 7);
    }

    /// With no ruleset the catalogue cannot price any item as food, so nothing is eaten and the
    /// full fee is charged - known, never doubted.
    #[test]
    fn without_a_ruleset_no_item_is_food() {
        let men = [item(1, "LEAD")];
        let food = [item(2, "GRAI")];
        let flags = consuming();
        assert_eq!(
            unit_upkeep(&made_of(1, &men, &food, &flags), None),
            Some(50)
        );
    }

    #[test]
    fn a_faction_food_consumer_spends_its_own_food_too() {
        let men = [item(1, "LEAD")];
        let food = [item(2, "MEAL")];
        let flags = vec!["consuming faction's food".to_string()];
        assert_eq!(upkeep(&made_of(1, &men, &food, &flags)), Some(0));
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
            0,
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
            0,
            no_market(),
            Some(&ruleset()),
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

    fn food(tag: &str, amount: i64, value: i64) -> FoodAmount {
        FoodAmount {
            tag: tag.to_string(),
            amount,
            maintenance_value: value,
        }
    }

    /// A claim whose spare food is `spare_food` grain, each worth the data page's 30 silver.
    fn claim(id: &str, spare_food: i64, owed: i64, draws: bool) -> FoodClaim {
        let spare = if spare_food > 0 {
            vec![food("GRAI", spare_food, 30)]
        } else {
            Vec::new()
        };
        FoodClaim {
            unit_id: id.to_string(),
            spare_food: spare,
            owed_after_own_food: owed,
            draws_on_pool: draws,
        }
    }

    /// The total items a pass says the hex still holds, for the assertions that pin the remainder.
    fn pool_count(pass: &FactionFoodPass) -> Option<i64> {
        pass.pool_left
            .as_ref()
            .map(|stock| stock.iter().map(|entry| entry.amount).sum())
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
        let claims = [claim("fed", 0, 0, true), claim("a", 1, 30, true)];
        let fed = feed_from_faction_food(&claims).settled;
        assert_eq!(fed.get("fed"), None);
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }

    #[test]
    fn a_pool_of_exactly_enough_feeds_everybody() {
        // Four grain at 30 cover two units owing 60 apiece, exactly.
        let claims = [
            claim("quartermaster", 4, 0, false),
            claim("a", 0, 60, true),
            claim("b", 0, 60, true),
        ];
        let pass = feed_from_faction_food(&claims);
        assert_eq!(pass.settled.get("a"), Some(&Some(0)));
        assert_eq!(pass.settled.get("b"), Some(&Some(0)));
        assert_eq!(pool_count(&pass), Some(0));
    }

    /// A hex whose pool is several kinds of food spends the least valuable first: a lone claimant
    /// owing 40 against one 20-silver meal and two 40-silver grain eats the meal then one grain,
    /// leaving the dearer grain behind. The values are synthetic (real foods share one value today),
    /// which is exactly why this must be pinned before a ruleset gives them different ones
    /// (`ah-773o`).
    #[test]
    fn a_mixed_value_pool_is_spent_least_valuable_first() {
        let quartermaster = FoodClaim {
            unit_id: "quartermaster".to_string(),
            spare_food: vec![food("MEAL", 1, 20), food("GRAI", 2, 40)],
            owed_after_own_food: 0,
            draws_on_pool: false,
        };
        let claims = [quartermaster, claim("a", 0, 40, true)];
        let pass = feed_from_faction_food(&claims);
        assert_eq!(pass.settled.get("a"), Some(&Some(0)));
        // `a` eats the 20 meal (covers 20) then one 40 grain (covers the last 20), so one grain of
        // the dearer stock is left and the cheap meal is gone.
        let left = pass.pool_left.expect("a lone claimant is not contended");
        assert_eq!(left, vec![food("GRAI", 1, 40)]);
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

    /// Contention needs two contenders. A lone claimant simply eats what it can, so its figure is
    /// exact however short the hex is - settled with the navigator on 2026-08-23, by the same
    /// reasoning that made an empty pool exact.
    #[test]
    fn a_lone_claimant_eats_what_there_is_rather_than_being_doubted() {
        let claims = [claim("quartermaster", 1, 0, false), claim("a", 0, 60, true)];
        let fed = feed_from_faction_food(&claims).settled;
        // One grain worth 30 leaves the 60 owed at 30.
        assert_eq!(fed.get("a"), Some(&Some(30)));
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
        // `a` eats 2 grain, `b` eats 2 (40 owed rounds up to two 30s), leaving 1 of the 5.
        assert_eq!(pool_count(&pass), Some(1));
    }

    #[test]
    fn an_empty_pool_leaves_nothing() {
        let claims = [claim("a", 0, 60, true)];
        assert_eq!(pool_count(&feed_from_faction_food(&claims)), Some(0));
    }

    #[test]
    fn a_lone_short_claimant_eats_what_there_is() {
        let claims = [
            claim("quartermaster", 1, 0, false),
            claim("a", 0, 200, true),
        ];
        let pass = feed_from_faction_food(&claims);
        // One grain worth 30 against 200 owed leaves 170.
        assert_eq!(pass.settled.get("a"), Some(&Some(170)));
        assert_eq!(pool_count(&pass), Some(0));
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

    /// One item is worth a whole 30 even against a smaller debt, and a lone claimant cannot be
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

    fn mount_description(tag: &str) -> &'static str {
        Box::leak(
            ruleset()
                .items
                .get(tag)
                .and_then(|entry| entry.description.clone())
                .expect("the committed ruleset should describe every mount")
                .into_boxed_str(),
        )
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
            // No transfers in these tests, so the report's headcount is the early one (`ah-qct4`).
            men_reported: men,
            men_estimated: false,
            men_by_race: &[],
            items,
            flags,
            skills,
            intents: &[],
            receipts,
            formed: None,
            after_gifts_unknown: false,
            gifts_uncertain: false,
            food_uncertain: false,
            skills_unknown: false,
            production_skills: skills,
            production_skills_unknown: false,
            late: None,
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

    /// Reversed at `ah-cw75`'s verification: `avoiding` is not in the rules' taxing test at all,
    /// so it no longer zeroes anybody.
    #[test]
    fn avoiding_no_longer_zeroes_anyone() {
        assert_eq!(count(50, &[item("SWOR", 50)], &["avoiding"], &[]), Some(50));
    }

    /// "A unit may TAX if it has Combat skill of at least level 1" - and a skill is held by the
    /// unit, so every man in it counts.
    #[test]
    fn combat_skill_makes_every_man_a_taxer() {
        assert_eq!(count(10, &[], &[], &[skill("COMB", 1)]), Some(10));
    }

    /// A man either wields something or rides something, so the two add up.
    #[test]
    fn weapons_and_mounts_add_up() {
        assert_eq!(
            count(
                10,
                &[item("SWOR", 3), item("HORS", 4)],
                &[],
                &[skill("RIDI", 1)]
            ),
            Some(7)
        );
    }

    /// A winged horse needs riding 3; assuming 1 would over-count.
    #[test]
    fn a_mount_needing_a_higher_riding_level_does_not_count() {
        assert_eq!(
            count(10, &[item("WING", 10)], &[], &[skill("RIDI", 1)]),
            Some(0)
        );
        assert_eq!(
            count(10, &[item("WING", 10)], &[], &[skill("RIDI", 3)]),
            Some(10)
        );
    }

    /// Without the riding skill at all, a mount carries nobody into combat.
    #[test]
    fn a_mount_without_the_riding_skill_counts_for_nobody() {
        assert_eq!(count(10, &[item("HORS", 10)], &[], &[]), Some(0));
    }

    #[test]
    fn the_required_riding_level_is_read_out_of_the_description() {
        for tag in ["HORS", "CAME", "TURT"] {
            assert_eq!(required_riding(mount_description(tag)), Some(("RIDI", 1)));
        }
        assert_eq!(
            required_riding(mount_description("WING")),
            Some(("RIDI", 3))
        );
    }

    /// A description not carrying the sentence counts for nobody - under-counting, which is the
    /// safe direction here.
    #[test]
    fn a_description_without_the_sentence_names_no_level() {
        assert_eq!(required_riding("This is a mount."), None);
        assert_eq!(
            required_riding("This mount requires riding [RIDI] of at least level 3 to eat hay."),
            None
        );
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

    fn read(men: i64, items: &[ItemAmount], flags: &[&str], skills: &[Skill]) -> Option<Readiness> {
        let receipts = Receipts::default();
        let flags: Vec<String> = flags.iter().map(|flag| (*flag).to_string()).collect();
        readiness(
            &unit(men, items, &flags, skills, &receipts),
            Some(&ruleset()),
        )
    }

    /// The rules' fourth taxing character: "or is a mage who knows a spell which damages enemies".
    /// A mage carrying no weapon at all still has every one of its men counted (`ah-v585`).
    #[test]
    fn a_mage_who_knows_a_damaging_spell_makes_every_man_count() {
        let read = read(3, &[], &[], &[skill("FIRE", 1)]).expect("countable");
        assert_eq!(read.men, 3);
        assert_eq!(read.ready, 3);
    }

    /// The discriminator has to bite at the point of use, not only in the scraper: a shield spell
    /// damages nobody, so its mage taxes on no account of it.
    #[test]
    fn a_mage_with_only_a_shield_spell_does_not() {
        let read = read(3, &[], &[], &[skill("FSHI", 1)]).expect("countable");
        assert_eq!(read.ready, 0);
    }

    #[test]
    fn readiness_reports_the_headcount_alongside_the_count() {
        let read = read(19, &[item("SWOR", 10)], &[], &[]).expect("countable");
        assert_eq!(read.men, 19);
        assert_eq!(read.ready, 10);
    }

    #[test]
    fn an_unarmed_unit_is_not_ready() {
        let read = read(19, &[], &[], &[]).expect("countable");
        assert_eq!(read.ready, 0);
    }

    /// `men_estimated` is checked before the ruleset, as `combat_ready` always has.
    #[test]
    fn an_estimated_headcount_answers_nothing() {
        let receipts = Receipts::default();
        let items = [item("SWOR", 50)];
        let facts = UnitFacts {
            men_estimated: true,
            ..unit(50, &items, &[], &[], &receipts)
        };
        assert_eq!(readiness(&facts, Some(&ruleset())), None);
        assert_eq!(readiness(&facts, None), None);
    }

    #[test]
    fn no_ruleset_answers_nothing() {
        let receipts = Receipts::default();
        let items = [item("SWOR", 50)];
        assert_eq!(
            readiness(&unit(50, &items, &[], &[], &receipts), None),
            None
        );
    }

    fn plurals() -> Plurals {
        let mut plurals = Plurals::new();
        plurals.insert("HORS".to_string(), "horses".to_string());
        plurals.insert("DBOW".to_string(), "double bows".to_string());
        plurals.insert("WING".to_string(), "winged horses".to_string());
        plurals
    }

    fn clause_for(read: &Readiness) -> String {
        because_clause(read, Some(&ruleset()), &plurals())
    }

    fn clause(men: i64, ready: i64) -> String {
        clause_for(&Readiness {
            men,
            ready,
            nearest_miss: None,
        })
    }

    /// The fallback, for a unit holding nothing a skill could have made count: the one case where
    /// the reader genuinely does not know which of the four routes to take (`ah-deo5`).
    #[test]
    fn a_unit_with_no_near_miss_is_told_about_all_four_routes() {
        assert_eq!(
            clause(19, 0),
            " — it has no combat skill, no weapon it can wield, no mount it can ride and no damaging spell"
        );
    }

    #[test]
    fn a_unit_whose_men_count_explains_nothing() {
        assert_eq!(clause(19, 19), "");
        assert_eq!(clause(19, 1), "");
    }

    #[test]
    fn a_unit_with_no_men_explains_nothing() {
        assert_eq!(clause(0, 0), "");
    }

    #[test]
    fn a_single_man_with_nothing_gets_the_same_fallback() {
        assert_eq!(
            clause(1, 0),
            " — it has no combat skill, no weapon it can wield, no mount it can ride and no damaging spell"
        );
    }

    #[test]
    fn a_mount_it_cannot_ride_is_named_in_the_tail() {
        let read = read(19, &[item("HORS", 3)], &[], &[]).expect("countable");
        assert_eq!(
            clause_for(&read),
            " — its 3 horses need riding 1, and it has no riding"
        );
    }

    #[test]
    fn a_weapon_it_cannot_wield_is_named_in_the_tail() {
        let read = read(19, &[item("DBOW", 10)], &[], &[]).expect("countable");
        assert_eq!(
            clause_for(&read),
            " — its 10 double bows need longbow 1, and it has no longbow"
        );
    }

    /// What pins `counted_item` rather than an invented `-s` (`ah-rsdz`), and the verb with it.
    #[test]
    fn a_single_mount_reads_in_the_singular() {
        let read = read(19, &[item("HORS", 1)], &[], &[]).expect("countable");
        assert_eq!(
            clause_for(&read),
            " — its 1 horse needs riding 1, and it has no riding"
        );
    }

    /// Mirrors the shipped `has carpenter 2`: a unit part of the way there is told how far.
    #[test]
    fn a_unit_partway_to_the_skill_is_told_what_it_has() {
        let read = read(19, &[item("WING", 2)], &[], &[skill("RIDI", 1)]).expect("countable");
        assert_eq!(
            clause_for(&read),
            " — its 2 winged horses need riding 3, and it has riding 1"
        );
    }

    /// The trap named in the plan: a unit with Combat 1 and no weapons is combat ready, and must
    /// not be told it holds no weapons. The clause keys off `ready`, never off any weapon count.
    #[test]
    fn a_unit_with_combat_skill_and_no_weapons_is_not_told_it_holds_no_weapons() {
        let read = read(10, &[], &[], &[skill("COMB", 1)]).expect("countable");
        assert_eq!(read.ready, 10);
        assert_eq!(clause_for(&read), "");
    }

    // --- the nearest miss (`ah-deo5`) ---------------------------------------------------------

    #[test]
    fn a_mount_the_unit_cannot_ride_is_the_nearest_miss() {
        let read = read(19, &[item("HORS", 3)], &[], &[]).expect("countable");
        assert_eq!(read.ready, 0);
        assert_eq!(
            read.nearest_miss,
            Some(NearMiss {
                item: "HORS".to_string(),
                count: 3,
                skill: "RIDI".to_string(),
                level: 1,
                held: 0,
            })
        );
    }

    /// The skill a weapon needs is not the weapon's own tag: `DBOW` is wielded with `LBOW`.
    #[test]
    fn a_weapon_the_unit_cannot_wield_is_a_near_miss() {
        let read = read(19, &[item("DBOW", 10)], &[], &[]).expect("countable");
        assert_eq!(read.ready, 0);
        assert_eq!(
            read.nearest_miss,
            Some(NearMiss {
                item: "DBOW".to_string(),
                count: 10,
                skill: "LBOW".to_string(),
                level: 1,
                held: 0,
            })
        );
    }

    /// The cheapest advice wins: a winged horse needs Riding 3, a double bow Longbow 1.
    #[test]
    fn the_lowest_level_wins() {
        let read = read(19, &[item("WING", 5), item("DBOW", 2)], &[], &[]).expect("countable");
        let miss = read.nearest_miss.expect("a miss");
        assert_eq!(miss.item, "DBOW");
        assert_eq!(miss.level, 1);
    }

    #[test]
    fn a_tie_goes_to_the_larger_holding() {
        let read = read(19, &[item("HORS", 3), item("DBOW", 10)], &[], &[]).expect("countable");
        let miss = read.nearest_miss.expect("a miss");
        assert_eq!(miss.item, "DBOW");
        assert_eq!(miss.count, 10);
    }

    /// A sack of grain is not something the unit failed to qualify with.
    #[test]
    fn a_unit_holding_nothing_has_no_near_miss() {
        let read = read(19, &[item("GRAI", 40)], &[], &[]).expect("countable");
        assert_eq!(read.ready, 0);
        assert_eq!(read.nearest_miss, None);
    }

    #[test]
    fn a_unit_that_already_counts_has_no_near_miss() {
        let read = read(10, &[item("HORS", 3)], &[], &[skill("COMB", 1)]).expect("countable");
        assert_eq!(read.ready, 10);
        assert_eq!(read.nearest_miss, None);
    }
}
