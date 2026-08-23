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

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::movement::rules::Ruleset;
use crate::orders::forms::{Amount, Party, Selector};
use crate::orders::intents::{Intent, PlacedIntent};
use crate::report::model::{ItemAmount, Skill};

/// "Each taxing character collects $50."
const TAX_PER_MAN: i64 = 50;

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

/// Earth Lore earns "an amount of money based on his level, and the economy of the region" - no
/// rate, no arithmetic, and a `null` `cast` entry. Doubted rather than guessed at: `ah-1wcw.1`'s
/// rule is never a number that might be wrong.
const EARTH_LORE_TAG: &str = "EART";

/// "This fee is generally 10 silver for a normal character, and 50 silver for a leader."
const UPKEEP_PER_CHARACTER: i64 = 10;
const UPKEEP_PER_LEADER: i64 = 50;

/// "Units may substitute one unit of grain, livestock, fish or meals for each 50 silver (or
/// fraction thereof) of maintenance owed. Food value for a fractional maintenance cost still
/// consumes the entire unit of food."
const SILVER_PER_FOOD: i64 = 50;

/// The food items the rules name, by tag.
const FOOD_TAGS: [&str; 4] = ["GRAI", "LIVE", "FISH", "MEAL"];

/// The tag a leader carries in `men_by_race`.
const LEADER_TAG: &str = "LEAD";

/// The flag that says a unit eats faction food held by other units in its region - step 2 of the
/// payment order, and the only one of the two that reaches beyond the unit itself.
const CONSUMING_FACTION_FLAG: &str = "consuming faction's food";

/// The two flags that say a unit is set to spend its food before its silver.
const CONSUMING_FLAGS: [&str; 2] = ["consuming unit's food", CONSUMING_FACTION_FLAG];

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
    /// spending order in the unit's block. `None` when `short_for_orders` is `Some(0)` or `None`.
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
    /// Silver of this unit's upkeep paid by food it holds itself, at step 1 of the payment order.
    /// `0` when the unit is not set to consume, holds no food, or owes nothing.
    ///
    /// Carried separately from `faction_food_covered` only so the hover can say which fed it: both
    /// leave `upkeep` at the same number, and a zero there reads as a defect until something says
    /// why (`ah-7cdt`, `ah-p9z5`).
    pub own_food_covered: i64,
    /// Silver this unit is ordered to give to nobody - `GIVE 0 ... SILV`, which destroys it. Part
    /// of `expense` like any other gift; carried separately only so the hover can say so.
    pub given_to_nobody: i64,
}

/// The kind of order a shortfall bites on, so the hover can name it (`ah-uwa3`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum SilverSpender {
    Buy,
    Cast,
    Study,
    Give,
    Withdraw,
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
    /// `CAST` of a spell the ruleset describes as earning but prices nowhere - Earth Lore, whose
    /// rules text gives no arithmetic at all.
    UnpricedSpell,
    /// `BUY` of goods this region's `For Sale` list does not carry, so the purchase has no price.
    MarketDoesNotSell,
    /// `WITHDRAW` of an item the ruleset carries no withdrawal price for - anything that is not a
    /// basic item, and every item at all for a ruleset cached before `ah-1wcw.6`.
    UnpricedWithdrawal,
    /// `GIVE` of a whole class of goods, or of the unit itself: what leaves depends on classifying
    /// everything the unit holds, which is not modelled.
    GivesAWholeClass,
    /// More units are set to eat the hex's faction food than that food can feed, so which of them
    /// eats - and therefore what each pays - cannot be determined.
    ContestedFactionFood,
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

/// What a unit's orders earn it in the turn's last phase - wages, entertaining, and Phantasmal
/// Entertainment.
///
/// The one place that decides which earnings arrive too late to be spent. [`forecast_unit`] and
/// `semantics::charge_upkeep` both read it, because two copies of this rule is exactly the drift
/// that `ah-uwa3` was filed to remove.
///
/// Takes the ruleset because Phantasmal Entertainment is recognised by its catalogue tag, exactly
/// as [`forecast_unit`] recognises it; a caller with no ruleset simply prices no spell.
#[must_use]
pub fn late_income(facts: &UnitFacts<'_>, region: RegionWages, ruleset: Option<&Ruleset>) -> i64 {
    let mut late = 0i64;
    for placed in facts.intents {
        match &placed.intent {
            Intent::Work => {
                let earned = facts.men.saturating_mul(region.wage_centis.unwrap_or(0)) / 100;
                late = late.saturating_add(earned.min(region.max_wages.unwrap_or(i64::MAX)));
            }
            Intent::Entertain => {
                let earned = facts
                    .men
                    .saturating_mul(skill_level(facts.skills, ENTERTAIN_TAG))
                    .saturating_mul(ENTERTAIN_PER_MAN_PER_LEVEL);
                late = late.saturating_add(earned.min(region.entertainment.unwrap_or(0)));
            }
            Intent::Cast { spell, .. } => {
                let tag = ruleset
                    .and_then(|ruleset| ruleset.find_skill(spell))
                    .map(|skill| skill.tag.to_ascii_uppercase());
                if tag.as_deref() == Some(PHANTASMAL_TAG) {
                    let earned = skill_level(facts.skills, PHANTASMAL_TAG)
                        .saturating_mul(PHANTASMAL_PER_LEVEL);
                    late = late.saturating_add(earned.min(region.entertainment.unwrap_or(0)));
                }
            }
            _ => {}
        }
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
    purse: FactionPurse,
    lookups: Lookups<'_>,
    ruleset: Option<&Ruleset>,
) -> UnitSilver {
    let sale = lookups.sale;
    let own_food = own_food_pass(&facts);
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
    if men_estimated && intents.iter().any(moves_silver_per_man) {
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
            own_food_covered: 0,
            given_to_nobody: 0,
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
    // `BUY ALL` and `GIVE ... ALL SILV` spend what is left after every other term, so they cannot
    // be priced inside this pass. Collected in document order and applied below.
    let mut deferred: Vec<Deferred> = Vec::new();

    for placed in intents {
        match &placed.intent {
            Intent::Claim(amount) => {
                // Capped at what the faction actually holds, and never divided between units that
                // claim in the same turn - exactly as `WORK` and `ENTERTAIN` treat their regional
                // pools. A purse the report does not state leaves only the limit unknown, not the
                // amount, so the stated figure is counted and nothing is doubted.
                income = income.saturating_add(match purse.unclaimed {
                    Some(available) => (*amount).min(available),
                    None => *amount,
                });
            }
            Intent::Tax => match region.tax_base {
                Some(base) => {
                    income = income.saturating_add(men.saturating_mul(TAX_PER_MAN).min(base))
                }
                None => income_doubt = income_doubt.or(Some(SilverDoubt::UnknownTaxBase)),
            },
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
                    let sold = asked.min(market_takes).min(unit_holds).max(0);
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
            Intent::Study { skill } => {
                let cost = ruleset
                    .and_then(|ruleset| ruleset.find_skill(skill))
                    .and_then(|skill| skill.cost);
                match cost {
                    Some(cost) => expense = expense.saturating_add(cost.saturating_mul(men)),
                    None => expense_doubt = expense_doubt.or(Some(SilverDoubt::UnpricedSkill)),
                }
            }
            Intent::Cast { spell, .. } => {
                // Resolved once: this runs per keystroke, and `find_skill` walks the catalogue.
                let spell = ruleset.and_then(|ruleset| ruleset.find_skill(spell));

                match spell.map(|skill| skill.tag.to_ascii_uppercase()) {
                    // Phantasmal Entertainment earns late, like the two orders above, so
                    // [`late_income`] prices it; what the cast *costs* is still charged below.
                    Some(tag) if tag == PHANTASMAL_TAG => {}
                    Some(tag) if tag == EARTH_LORE_TAG => {
                        income_doubt = income_doubt.or(Some(SilverDoubt::UnpricedSpell))
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
                        if input.tag.eq_ignore_ascii_case(SILVER_TAG) {
                            expense = expense.saturating_add(input.amount);
                        }
                    }
                }
            }
            Intent::Buy { amount, item } => match (lookups.purchase)(item) {
                PurchaseAnswer::ForSale { price, market_has } => match amount {
                    Amount::Exact(count) => {
                        expense = expense.saturating_add(count.saturating_mul(price));
                    }
                    // What a unit can afford depends on everything else this month does, so this
                    // waits for the running total below.
                    Amount::All { .. } => deferred.push(Deferred::BuyAll { price, market_has }),
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
            Intent::Withdraw { count, item } => {
                let cost = (lookups.item_tag)(item)
                    .and_then(|tag| ruleset?.items.get(&tag)?.withdraw_cost);
                match cost {
                    Some(cost) => expense = expense.saturating_add(count.saturating_mul(cost)),
                    None => expense_doubt = expense_doubt.or(Some(SilverDoubt::UnpricedWithdrawal)),
                }
            }
            _ => {}
        }
    }

    // The three earnings that arrive in the turn's last phase, priced in one place so this
    // function and the upkeep charge can never disagree about them (`ah-uwa3`).
    let late = late_income(&facts, region, ruleset);
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
    // The first order in the block that spends anything, which is what the hover names. Read off
    // the intents rather than tracked through the arithmetic: the shortfall is one number about
    // the whole month, so no single term "owns" it, and the first spender is the one a reader
    // looking down the block reaches first.
    let short_on = intents.iter().find_map(|placed| match &placed.intent {
        Intent::Buy { .. } => Some(SilverSpender::Buy),
        Intent::Study { .. } => Some(SilverSpender::Study),
        Intent::Withdraw { .. } => Some(SilverSpender::Withdraw),
        Intent::Give { .. } => Some(SilverSpender::Give),
        Intent::Cast { .. } => Some(SilverSpender::Cast),
        _ => None,
    });
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
        short_on: short_on.filter(|_| short_for_orders.is_some_and(|short| short > 0)),
        upkeep,
        doubt,
        doubt_subject: doubt_subject.filter(|_| {
            matches!(
                doubt,
                Some(SilverDoubt::UnknownGoods) | Some(SilverDoubt::MarketDoesNotSell)
            )
        }),
        received: receipts.silver,
        givers: receipts.givers.clone(),
        faction_food_covered: 0,
        own_food_covered,
        given_to_nobody,
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

/// Step 2 of the maintenance payment order, across one hex.
///
/// Returns the upkeep each unit is left with. `Some(0)` for a unit the pool feeds; `None` for one
/// of *several* contending for a pool too small to feed them all, where which unit eats is
/// genuinely undeterminable and no number is invented. Two cases that look short are not
/// ambiguous at all and are answered exactly: an empty pool, where nobody eats, and a lone
/// claimant, which simply eats every item there is. A unit that does not draw on the pool is
/// absent from the result and keeps whatever step 1 left it.
#[must_use]
pub fn feed_from_faction_food(claims: &[FoodClaim]) -> BTreeMap<String, Option<i64>> {
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
        return BTreeMap::new();
    }

    if total_needed <= pool {
        // The pool feeds everybody, and a unit it feeds at all it feeds entirely: one item is
        // worth a whole 50, so a unit owing 60 takes 2 and 2 cover 100.
        return claimants
            .map(|claim| (claim.unit_id.clone(), Some(0)))
            .collect();
    }

    // Short, and contention needs two contenders: a lone claimant eats every item there is and
    // owes the rest, with nothing to decide. Settled with the navigator on 2026-08-23, by the same
    // reasoning that made an empty pool exact.
    if let (Some(only), 1) = (claimants.clone().next(), claimants.clone().count()) {
        let covered = pool
            .saturating_mul(SILVER_PER_FOOD)
            .min(only.owed_after_own_food);
        return [(
            only.unit_id.clone(),
            Some(only.owed_after_own_food - covered),
        )]
        .into();
    }

    // All or nothing among the rest: the rules waste food, so the total genuinely differs by who
    // eats - two units owing 60 and 80 against a pool of 3 total 30 or 10 depending on which one
    // is fed - and there is no correct number to share out.
    claimants
        .map(|claim| (claim.unit_id.clone(), None))
        .collect()
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
        Intent::Tax | Intent::Work | Intent::Study { .. } | Intent::Entertain
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// The lookups for a unit that neither buys nor sells.
    fn no_market() -> Lookups<'static> {
        Lookups {
            sale: &no_sales,
            purchase: &no_purchases,
            item_tag: &verbatim_tag,
        }
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
    fn phantasmal_entertainment_earns_late() {
        let ruleset = ruleset();
        let receipts = Receipts::default();
        let intents = [placed(Intent::Cast {
            spell: "phantasmal entertainment".to_string(),
            arguments: Vec::new(),
        })];
        let skills = [skill("PHEN", 2)];
        let unit = forecast_unit(
            UnitFacts {
                skills: &skills,
                ..facts(1, &intents, &receipts)
            },
            RegionWages {
                entertainment: Some(10_000),
                ..RegionWages::default()
            },
            no_market(),
            Some(&ruleset),
        );
        assert_eq!(unit.income, Some(1200));
        assert_eq!(unit.late_income, Some(1200));
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

    #[test]
    fn a_mage_casting_earth_lore_is_doubted() {
        let unit = casting("Earth_Lore", "EART", 3, Some(5000));
        assert_eq!(unit.doubt, Some(SilverDoubt::UnpricedSpell));
        assert_eq!(unit.income, None);
        assert_eq!(unit.at_month_end, None);
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
        // being priced - unlike TAX, WORK, STUDY and ENTERTAIN.
        let receipts = Receipts::default();
        let intents = [selling("furs", Amount::Exact(10))];
        let unit = forecast_unit(
            UnitFacts {
                men_estimated: true,
                ..facts(8, &intents, &receipts)
            },
            RegionWages::default(),
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

    #[test]
    fn a_withdrawing_unit_pays_the_rulesets_price() {
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
        assert_eq!(unit.expense, Some(375));
    }

    #[test]
    fn a_withdrawal_the_ruleset_cannot_price_is_doubted() {
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
        assert_eq!(unit.expense, None);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnpricedWithdrawal));
    }

    #[test]
    fn a_withdrawal_with_no_ruleset_at_all_is_doubted() {
        let intents = vec![placed(Intent::Withdraw {
            count: 1,
            item: "STON".to_string(),
        })];
        let unit = spending(500, &intents, RegionWages::default(), &no_purchases, None);
        assert_eq!(unit.expense, None);
        assert_eq!(unit.doubt, Some(SilverDoubt::UnpricedWithdrawal));
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
        let fed = feed_from_faction_food(&claims);
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
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("a"), Some(&None));
        assert_eq!(fed.get("b"), Some(&None));
    }

    #[test]
    fn a_unit_that_does_not_draw_on_the_pool_is_untouched() {
        let claims = [
            claim("quartermaster", 6, 50, false),
            claim("a", 0, 60, true),
        ];
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("quartermaster"), None);
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }

    #[test]
    fn food_held_by_a_unit_that_is_not_consuming_still_fills_the_pool() {
        let claims = [
            claim("quartermaster", 2, 50, false),
            claim("a", 0, 60, true),
        ];
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }

    #[test]
    fn a_unit_owing_nothing_after_its_own_food_claims_nothing() {
        let claims = [claim("fed", 0, 0, true), claim("a", 1, 50, true)];
        let fed = feed_from_faction_food(&claims);
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
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("a"), Some(&Some(0)));
        assert_eq!(fed.get("b"), Some(&Some(0)));
    }

    /// An empty pool is exact, not doubtful: with no food in the hex nobody eats, so every unit
    /// keeps what step 1 left it. Settled with the navigator on 2026-08-23 - the plan doubted this
    /// case, which put `?` on eleven exactly-known figures in the committed turn.
    #[test]
    fn an_empty_hex_pool_leaves_every_claimant_exactly_where_it_was() {
        let claims = [claim("a", 0, 60, true)];
        let fed = feed_from_faction_food(&claims);
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
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("a"), Some(&None));
        assert_eq!(fed.get("b"), Some(&None));
    }

    /// Contention needs two contenders. A lone claimant simply eats what there is, so its figure
    /// is exact however short the hex is - settled with the navigator on 2026-08-23, by the same
    /// reasoning that made an empty pool exact.
    #[test]
    fn a_lone_claimant_eats_what_there_is_rather_than_being_doubted() {
        let claims = [claim("quartermaster", 1, 0, false), claim("a", 0, 60, true)];
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("a"), Some(&Some(10)));
    }

    /// One item is worth a whole 50 even against a smaller debt, and a lone claimant cannot be
    /// left owing less than nothing.
    #[test]
    fn a_lone_claimant_owes_nothing_once_the_pool_covers_it() {
        let claims = [claim("quartermaster", 1, 0, false), claim("a", 0, 30, true)];
        let fed = feed_from_faction_food(&claims);
        assert_eq!(fed.get("a"), Some(&Some(0)));
    }
}
