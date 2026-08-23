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

use serde::{Deserialize, Serialize};

use crate::movement::rules::Ruleset;
use crate::orders::forms::{Amount, Party, Selector};
use crate::orders::intents::{Intent, PlacedIntent};
use crate::report::model::Skill;

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
    /// What this month's orders are expected to spend. `None` when a term could not be priced.
    pub expense: Option<i64>,
    /// `held + income - expense`, or `None` when either side is `None`.
    pub at_month_end: Option<i64>,
    /// Why a term could not be priced, for the hover to explain. `None` when nothing was doubted.
    pub doubt: Option<SilverDoubt>,
    /// What the doubt is *about*, where its sentence names something - the goods of an
    /// unidentifiable `SELL`, as the order itself wrote them. `None` for every other doubt.
    pub doubt_subject: Option<String>,
    /// Silver counted into `income` because other units in this hex are ordered to give it.
    pub received: i64,
    /// Those givers, as `<name> (<id>)`, so the hover can name them.
    pub givers: Vec<String>,
    /// Silver this unit is ordered to give to nobody - `GIVE 0 ... SILV`, which destroys it. Part
    /// of `expense` like any other gift; carried separately only so the hover can say so.
    pub given_to_nobody: i64,
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
    lookups: Lookups<'_>,
    ruleset: Option<&Ruleset>,
) -> UnitSilver {
    let sale = lookups.sale;
    let UnitFacts {
        unit_id,
        region_id,
        held,
        men,
        men_estimated,
        skills,
        intents,
        receipts,
    } = facts;

    // A headcount that is a guess cannot multiply anything out, so it short-circuits both sides
    // before any rule below is read - exactly as `semantics::study` refuses to price one.
    if men_estimated && intents.iter().any(moves_silver_per_man) {
        return UnitSilver {
            unit_id: unit_id.to_string(),
            region_id: region_id.to_string(),
            held,
            income: None,
            expense: None,
            at_month_end: None,
            doubt: Some(SilverDoubt::EstimatedMen),
            doubt_subject: None,
            received: 0,
            givers: Vec::new(),
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
            Intent::Tax => match region.tax_base {
                Some(base) => {
                    income = income.saturating_add(men.saturating_mul(TAX_PER_MAN).min(base))
                }
                None => income_doubt = income_doubt.or(Some(SilverDoubt::UnknownTaxBase)),
            },
            Intent::Work => {
                // Rounded down: a forecast that overstates income is the dangerous direction. The
                // cap is the region's whole pool, contended by factions we cannot see - capping one
                // unit at it is honest, dividing it between them is not.
                let earned = men.saturating_mul(region.wage_centis.unwrap_or(0)) / 100;
                income = income.saturating_add(earned.min(region.max_wages.unwrap_or(i64::MAX)));
            }
            Intent::Entertain => {
                // Capped at the region's whole demand and never divided, exactly as `WORK` treats
                // `max_wages`; a region that states no demand pays entertainers nothing, exactly as
                // one that states no wage pays workers nothing.
                let earned = men
                    .saturating_mul(skill_level(skills, ENTERTAIN_TAG))
                    .saturating_mul(ENTERTAIN_PER_MAN_PER_LEVEL);
                income = income.saturating_add(earned.min(region.entertainment.unwrap_or(0)));
            }
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
                    Some(tag) if tag == PHANTASMAL_TAG => {
                        // Capped by the region's demand, but it does not *draw* on it: a hex with
                        // an entertainer and a phantasmal entertainer may forecast more than the
                        // region states in total, which is the decision rather than an oversight.
                        let earned = skill_level(skills, PHANTASMAL_TAG)
                            .saturating_mul(PHANTASMAL_PER_LEVEL);
                        income =
                            income.saturating_add(earned.min(region.entertainment.unwrap_or(0)));
                    }
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

    // Everything that spends what is *left*, in document order, against a running total that
    // already carries every other term. Skipped where a side is doubted: the total it would spend
    // against is not a number, and the side it feeds is `None` either way.
    if income_doubt.is_none() && expense_doubt.is_none() {
        let mut running = held.saturating_add(income).saturating_sub(expense);
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
    let expense = expense_doubt.is_none().then_some(expense);
    let doubt = income_doubt.or(expense_doubt);
    let at_month_end = match (income, expense) {
        (Some(income), Some(expense)) => Some(held.saturating_add(income).saturating_sub(expense)),
        _ => None,
    };

    UnitSilver {
        unit_id: unit_id.to_string(),
        region_id: region_id.to_string(),
        held,
        income,
        expense,
        at_month_end,
        doubt,
        doubt_subject: doubt_subject.filter(|_| {
            matches!(
                doubt,
                Some(SilverDoubt::UnknownGoods) | Some(SilverDoubt::MarketDoesNotSell)
            )
        }),
        received: receipts.silver,
        givers: receipts.givers.clone(),
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
        let receipts = Receipts::default();
        forecast_unit(facts(men, intents, &receipts), region, no_market(), None)
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
}
