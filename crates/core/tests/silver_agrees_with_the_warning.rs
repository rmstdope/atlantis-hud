//! The Silver column and the `not-enough-silver` warning, held to each other over the whole corpus.
//!
//! The economy is computed twice from the same orders by two pieces of code that share nothing but
//! their inputs: `forecast_unit` (`orders/silver.rs`) produces the Silver column, one entry per own
//! unit counting that unit alone, and the ledger (`orders/semantics.rs`) produces the
//! `not-enough-silver` finding, a hex-wide balance with sharing pooled across the hex. They have
//! separate arms per order and they have already drifted apart once: `PILLAGE` was credited by the
//! ledger and absent from the forecast, so a pillager could be shown red by one surface and silent
//! by the other (fixed by `ah-abwx`, `54dd0824`).
//!
//! Both sides are heavily unit-tested and nothing compared the two. This file does, on 26 real
//! turns, so the next divergence fails a test by name with the unit and both numbers in the message
//! rather than reaching a player as two surfaces contradicting each other.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};
use std::collections::{BTreeMap, BTreeSet};

mod common;
use common::ruleset;

/// One own unit of one fixture, with both surfaces' answers about it side by side.
struct Compared {
    fixture: &'static str,
    silver: UnitSilver,
    warned: bool,
    /// Whether any own unit in this unit's hex carries the `sharing` flag.
    shared_hex: bool,
}

/// Every own unit of every committed fixture, judged by both surfaces in one `review_turn` call.
///
/// A fixture without an orders template is **not skipped**: it is run with an empty orders
/// document, because a unit with no orders still holds silver and still owes maintenance, and that
/// is exactly the case where the two surfaces are simplest and most likely to be assumed rather
/// than checked. One of the 26 fixtures is in that position.
fn compare_the_corpus() -> Vec<Compared> {
    let ruleset = ruleset();
    let mut compared = Vec::new();

    for report in atlantis_hud_fixtures::ALL {
        let mut parsed = parse_report_full(report.text);
        classify_units(&mut parsed, &ruleset);
        let orders = extract_orders_template(report.text)
            .map(|template| template.text)
            .unwrap_or_default();

        let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());

        // A hex-level finding carries no unit, so filter on a present `unit_id` as well as the code
        // (`Finding::unit_id` is `Option<String>`).
        let warned: BTreeSet<&str> = review
            .findings
            .iter()
            .filter(|finding| finding.code.as_str() == "not-enough-silver")
            .filter_map(|finding| finding.unit_id.as_deref())
            .collect();

        // The hexes judged as one purse: `report_shortfalls` pools a hex where any own unit shares
        // (`Ordered::shares`), while the column counts every unit alone by decision (`ah-1wcw.1`).
        let sharing_hexes: BTreeSet<&str> = parsed
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .filter(|unit| unit.own)
            .filter(|unit| {
                unit.flags
                    .iter()
                    .any(|flag| flag.eq_ignore_ascii_case("sharing"))
            })
            .map(|unit| unit.region_id.as_str())
            .collect();

        for silver in review.silver {
            compared.push(Compared {
                fixture: report.name,
                warned: warned.contains(silver.unit_id.as_str()),
                shared_hex: sharing_hexes.contains(silver.region_id.as_str()),
                silver,
            });
        }
    }

    compared
}

/// Guards the guard: a predicate that is never exercised asserts nothing, and a refactor that
/// stopped producing `UnitSilver` entries would make the walks above pass by walking nothing.
///
/// Every bound here is a **floor with room under the measurement**, not the measurement itself, so
/// that adding a fixture never renegotiates this test. At the time of writing the corpus gives
/// 1,392 own units, 21 of them warned, 1 exempt as `Doubted` and 246 hexes exempt as `SharedHex`.
/// The two "at least one" floors are deliberately as weak as a floor can be: `Doubted` is a single
/// unit in the whole corpus, and a floor that tracked it would fail the day that fixture's owner
/// fixed their orders.
#[test]
fn the_corpus_actually_exercises_the_agreement() {
    let compared = compare_the_corpus();

    let warned = compared.iter().filter(|case| case.warned).count();
    let doubted = compared
        .iter()
        .filter(|case| exemption(case) == Some(Exempt::Doubted))
        .count();
    let shared_hexes: BTreeSet<(&str, &str)> = compared
        .iter()
        .filter(|case| exemption(case) == Some(Exempt::SharedHex))
        .map(|case| (case.fixture, case.silver.region_id.as_str()))
        .collect();

    assert!(
        compared.len() > 500,
        "only {} own units were compared",
        compared.len()
    );
    assert!(
        warned > 0,
        "no unit in the corpus is warned, so the equality never sees a `true`"
    );
    assert!(
        doubted > 0,
        "no unit in the corpus is doubted, so that exemption is never exercised"
    );
    assert!(
        !shared_hexes.is_empty(),
        "no hex in the corpus shares, so the hex-level assertion is never exercised"
    );
}

/// The ledger's balance before maintenance, reconstructed from the column.
///
/// `B = held + income - late_income - expense`. The ledger credits `TAX` but never `WORK` or
/// `ENTERTAIN` (`semantics.rs`: wages and takings from entertaining are paid in the turn's last
/// phase, so they can fund nothing this month) - which is exactly what `late_income` names, and
/// why it is subtracted here.
fn balance_before_maintenance(silver: &UnitSilver) -> Option<i64> {
    Some(silver.held + silver.income? - silver.late_income? - silver.expense?)
}

/// What maintenance actually draws off silver: `max(0, upkeep - late_income)`, which is
/// `charge_upkeep`'s own arithmetic.
///
/// `upkeep` here is already net of every relief - step 2's faction food and step 7's unclaimed
/// fund are both subtracted before it reaches the column - so adding `faction_food_covered` or
/// `unclaimed_covered` back in would double-count them.
///
/// A `None` upkeep (`SilverDoubt::ContestedFactionFood`) is `0`, not a skip: the ledger charges
/// such a unit nothing at all (`charge_upkeep`'s `Some(None) => continue`).
fn upkeep_drawn_from_silver(silver: &UnitSilver) -> i64 {
    let late = silver.late_income.unwrap_or(0);
    (silver.upkeep.unwrap_or(0) - late).max(0)
}

/// Why one unit is exempt from the per-unit equality, and what is asserted about it instead.
///
/// A rule, never a unit id: a list of ids rots the moment a fixture is added, and it hides a real
/// divergence behind "that one was already failing".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Exempt {
    /// The column cannot be reconstructed at all: a term of it is `None` because something in the
    /// unit's month could not be priced. The check does not judge such a unit either
    /// (`Ledger.doubted`), so the assertion becomes "and it is not warned".
    Doubted,
    /// Some own unit in this hex carries the `sharing` flag, so `report_shortfalls` judges the hex
    /// as one purse (`Ordered::shares`) while the column counts each unit alone by decision
    /// (`ah-1wcw.1`). The assertion becomes a hex-level one - see
    /// `the_column_and_the_warning_agree_on_every_sharing_hex_in_the_corpus`.
    SharedHex,
    // A third row belongs here once `ah-eacd` lands: `ContendedFood`, for `food_contended` - a
    // remaining food pool too small to feed every claimant, where that bead chose to leave the
    // figure pessimistic and suppress the warning, so the two disagree by design. As of this
    // commit `ah-eacd` has merged only its mockup (`0dbba707`) and `UnitSilver` carries no
    // `food_contended` field, so the row would assert about something that does not exist. The
    // omission is dated rather than missed: the row will read
    // `ContendedFood is silver.food_contended`, and its assertion is `!warned`.
}

/// Which exemption, if any, applies to one compared unit. `None` means the equality applies.
///
/// `Doubted` is tested first: a doubted unit is silenced by the ledger whatever else is true of its
/// hex, so it is the stronger statement of the two.
fn exemption(case: &Compared) -> Option<Exempt> {
    if balance_before_maintenance(&case.silver).is_none() {
        Some(Exempt::Doubted)
    } else if case.shared_hex {
        Some(Exempt::SharedHex)
    } else {
        None
    }
}

#[test]
fn the_column_and_the_warning_agree_on_every_unit_in_the_corpus() {
    for case in compare_the_corpus() {
        let silver = &case.silver;
        match exemption(&case) {
            Some(Exempt::Doubted) => assert!(
                !case.warned,
                "{} unit {} in {}: the column is doubted ({:?}) and the ledger judges no doubted \
                 unit, yet the warning fires",
                case.fixture, silver.unit_id, silver.region_id, silver.doubt,
            ),
            // Judged by the hex, in the test below.
            Some(Exempt::SharedHex) => {}
            None => {
                let balance = balance_before_maintenance(silver)
                    .expect("not doubted, so every term is known");
                let drawn = upkeep_drawn_from_silver(silver);
                let left = balance - drawn;

                // Two identities a reader will want to check by hand:
                //   when `upkeep >= late_income`, `left` is exactly `at_month_end - upkeep`;
                //   when `upkeep <  late_income`, `left` is exactly `balance`, and `balance < 0` is
                //   exactly `short_for_orders > 0` - which is `short_for_orders`'s own definition.
                assert_eq!(
                    case.warned,
                    left < 0,
                    "{} unit {} in {}: the column says {left} left (held {} + income {:?} \
                     - late {:?} - expense {:?} - upkeep-drawn {drawn}) and the warning {}",
                    case.fixture,
                    silver.unit_id,
                    silver.region_id,
                    silver.held,
                    silver.income,
                    silver.late_income,
                    silver.expense,
                    if case.warned {
                        "fires"
                    } else {
                        "does not fire"
                    },
                );
            }
        }
    }
}

/// The strongest statement that survives pooling, for the hexes the per-unit equality exempts.
///
/// Pooling loses per-unit information by design - the check asks whether the hex's shared purse
/// covers the hex, and the column never answers that question about anything but one unit - so a
/// per-unit equality is not merely unproven here, it is false: 758 of the corpus's units diverge
/// this way, and every single divergence the corpus contains is one of them.
///
/// What is left is the hex-level statement: if any unit in the hex is warned, the hex's units are
/// collectively in trouble - the sum of the balance-after-maintenance over its non-doubted units is
/// negative. The converse the plan also asks for, "if that sum is `>= 0`, no unit in the hex is
/// warned", is the contrapositive of exactly this and is the same assertion written the other way
/// round, so it is asserted once rather than twice.
#[test]
fn the_column_and_the_warning_agree_on_every_sharing_hex_in_the_corpus() {
    // Keyed by fixture and hex, because two fixtures of the same game carry the same region ids.
    let mut hexes: BTreeMap<(&'static str, String), (i64, bool, Vec<String>)> = BTreeMap::new();

    for case in compare_the_corpus() {
        if exemption(&case) != Some(Exempt::SharedHex) {
            continue;
        }
        let silver = &case.silver;
        let left = balance_before_maintenance(silver).expect("SharedHex is not Doubted")
            - upkeep_drawn_from_silver(silver);
        let entry = hexes
            .entry((case.fixture, silver.region_id.clone()))
            .or_insert((0, false, Vec::new()));
        entry.0 += left;
        entry.1 |= case.warned;
        entry.2.push(format!("{} ({left})", silver.unit_id));
    }

    for ((fixture, region_id), (sum, any_warned, units)) in hexes {
        assert!(
            !any_warned || sum < 0,
            "{fixture} hex {region_id}: a unit is warned, but the hex's shared purse comes to \
             {sum} across {} units, which is not short - {}",
            units.len(),
            units.join(", "),
        );
    }
}
