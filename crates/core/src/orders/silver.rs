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
use crate::orders::intents::{Intent, PlacedIntent};

/// "Each taxing character collects $50."
const TAX_PER_MAN: i64 = 50;

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
}

/// Everything about the region that the arithmetic needs, lifted out so the function takes values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RegionWages {
    pub tax_base: Option<i64>,
    /// The region's wage rate in hundredths of a silver, parsed from `ReportRegion::wages`.
    pub wage_centis: Option<i64>,
    pub max_wages: Option<i64>,
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
/// `intents` is the unit's orders exactly as [`super::semantics`] already holds them, so the slice
/// is passed straight through with no clone on a path that runs per keystroke. `held`, `men` and
/// `men_estimated` come straight off the report unit; `held` is 0 for a unit carrying no `SILV`
/// item.
///
/// `income` and `expense` are doubted independently, so the hover can show `?` against the side
/// that is actually unknown; `at_month_end` is `None` when either is. When more than one term is
/// doubted, `doubt` reports the first match in order of increasing scope - [`SilverDoubt::EstimatedMen`]
/// first, which short-circuits, because nothing per-man can be multiplied out.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn forecast_unit(
    unit_id: &str,
    region_id: &str,
    held: i64,
    men: i64,
    men_estimated: bool,
    region: RegionWages,
    intents: &[PlacedIntent],
    ruleset: Option<&Ruleset>,
) -> UnitSilver {
    // A headcount that is a guess cannot multiply anything out, so it short-circuits both sides
    // before any rule below is read - exactly as `semantics::study` refuses to price one.
    if men_estimated && intents.iter().any(moves_silver) {
        return UnitSilver {
            unit_id: unit_id.to_string(),
            region_id: region_id.to_string(),
            held,
            income: None,
            expense: None,
            at_month_end: None,
            doubt: Some(SilverDoubt::EstimatedMen),
        };
    }

    let mut income = 0i64;
    let mut expense = 0i64;
    let mut income_doubt = None;
    let mut expense_doubt = None;

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
            Intent::Study { skill } => {
                let cost = ruleset
                    .and_then(|ruleset| ruleset.find_skill(skill))
                    .and_then(|skill| skill.cost);
                match cost {
                    Some(cost) => expense = expense.saturating_add(cost.saturating_mul(men)),
                    None => expense_doubt = expense_doubt.or(Some(SilverDoubt::UnpricedSkill)),
                }
            }
            _ => {}
        }
    }

    let income = income_doubt.is_none().then_some(income);
    let expense = expense_doubt.is_none().then_some(expense);
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
        doubt: income_doubt.or(expense_doubt),
    }
}

/// Whether an intent is one [`forecast_unit`] prices at all.
///
/// Only these make a guessed headcount matter: a unit ordered to do nothing that moves silver has
/// a month that costs nothing, whether or not we know how many people are in it.
fn moves_silver(placed: &PlacedIntent) -> bool {
    matches!(
        placed.intent,
        Intent::Tax | Intent::Work | Intent::Study { .. }
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

    fn forecast(men: i64, region: RegionWages, intents: &[PlacedIntent]) -> UnitSilver {
        forecast_unit(
            "1234",
            "mountain (7,53)",
            0,
            men,
            false,
            region,
            intents,
            None,
        )
    }

    fn taxable(tax_base: Option<i64>) -> RegionWages {
        RegionWages {
            tax_base,
            ..RegionWages::default()
        }
    }

    fn paying(wage: &str, max_wages: Option<i64>) -> RegionWages {
        RegionWages {
            tax_base: None,
            wage_centis: parse_wage_centis(Some(wage)),
            max_wages,
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
        let unit = forecast_unit(
            "1234",
            "mountain (7,53)",
            600,
            6,
            false,
            RegionWages::default(),
            &[placed(Intent::Study {
                skill: "combat".to_string(),
            })],
            Some(&ruleset),
        );
        assert_eq!(unit.expense, Some(60));
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, Some(540));
    }

    #[test]
    fn a_studying_unit_the_ruleset_cannot_price_is_doubted() {
        let ruleset = ruleset();
        let unit = forecast_unit(
            "1234",
            "mountain (7,53)",
            600,
            6,
            false,
            RegionWages::default(),
            &[placed(Intent::Study {
                skill: "annihilation".to_string(),
            })],
            Some(&ruleset),
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::UnpricedSkill));
        assert_eq!(unit.expense, None);
        assert_eq!(unit.income, Some(0));
        assert_eq!(unit.at_month_end, None);
    }

    #[test]
    fn a_unit_whose_headcount_is_a_guess_is_doubted() {
        let unit = forecast_unit(
            "1234",
            "mountain (7,53)",
            600,
            8,
            true,
            taxable(Some(100_000)),
            &[placed(Intent::Tax)],
            None,
        );
        assert_eq!(unit.doubt, Some(SilverDoubt::EstimatedMen));
        assert_eq!(unit.income, None);
        assert_eq!(unit.expense, None);
        assert_eq!(unit.at_month_end, None);
    }

    #[test]
    fn a_unit_with_no_orders_ends_the_month_holding_what_it_started_with() {
        let unit = forecast_unit(
            "1234",
            "mountain (7,53)",
            600,
            8,
            false,
            taxable(Some(100_000)),
            &[],
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
}
