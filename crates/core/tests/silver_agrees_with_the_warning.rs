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
    /// Whether this unit's hex holds more than one own unit, and so pools silver for maintenance
    /// whatever any flag says (`ah-e66j`).
    crowded_hex: bool,
    /// Whether *this* unit carries it. A sharer's balance is inside the pool; a non-sharer's
    /// overdraft is a claim against it, and its surplus helps nobody.
    shares: bool,
    /// Whether the hex-level `not-enough-silver` finding fired for this unit's hex.
    ///
    /// Separate from `warned`, and the only warning a sharing hex ever gets: silver is a pooled tag
    /// wherever anyone shares, so `report_shortfalls` emits its shortfall through `hex.finding`
    /// with **no** `unit_id` and never through the per-unit arm. Reading only the per-unit findings
    /// there - as this test did until Copilot caught it on #602 - makes the hex-level assertion
    /// vacuously true, because `warned` is structurally `false` for all 758 of the corpus's
    /// sharing-hex units while 27 hex-level findings go unread.
    hex_warned: bool,
    /// Whether any sharer in this hex is doubted, which makes the whole pool untrusted and
    /// suppresses the hex finding entirely (`pool_trusted`, `semantics.rs`).
    doubted_sharer_in_hex: bool,
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

        // The pooled shortfall, which carries a hex and no unit.
        let hex_warned: BTreeSet<&str> = review
            .findings
            .iter()
            .filter(|finding| finding.code.as_str() == "not-enough-silver")
            .filter(|finding| finding.unit_id.is_none())
            .map(|finding| finding.region_id.as_str())
            .collect();

        // A doubted sharer makes the pool's sum untrustworthy, so `report_shortfalls` returns
        // before emitting any pooled finding at all. Such a hex can be silent while its units are
        // collectively short, by decision, so it is exempt from the hex-level assertion.
        let doubted: BTreeSet<&str> = review
            .silver
            .iter()
            .filter(|silver| balance_before_maintenance(silver).is_none())
            .map(|silver| silver.unit_id.as_str())
            .collect();
        let hexes_with_a_doubted_sharer: BTreeSet<&str> = parsed
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .filter(|unit| unit.own)
            .filter(|unit| {
                unit.flags
                    .iter()
                    .any(|flag| flag.eq_ignore_ascii_case("sharing"))
            })
            .filter(|unit| doubted.contains(unit.unit_id.as_str()))
            .map(|unit| unit.region_id.as_str())
            .collect();

        // Every hex holding more than one own unit. Since `ah-e66j` maintenance sharing is
        // automatic, so any such hex lends silver between its units - and the lender's row shows
        // nothing of the loan, by the navigator's decision, so the column cannot reconstruct the
        // ledger's balances there.
        let mut own_units_per_hex: BTreeMap<&str, usize> = BTreeMap::new();
        for unit in parsed
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .filter(|unit| unit.own)
        {
            *own_units_per_hex
                .entry(unit.region_id.as_str())
                .or_default() += 1;
        }
        let crowded_hexes: BTreeSet<&str> = own_units_per_hex
            .iter()
            .filter(|(_, count)| **count > 1)
            .map(|(region_id, _)| *region_id)
            .collect();

        let sharers: BTreeSet<&str> = parsed
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .filter(|unit| unit.own)
            .filter(|unit| {
                unit.flags
                    .iter()
                    .any(|flag| flag.eq_ignore_ascii_case("sharing"))
            })
            .map(|unit| unit.unit_id.as_str())
            .collect();

        for silver in review.silver {
            compared.push(Compared {
                fixture: report.name,
                shares: sharers.contains(silver.unit_id.as_str()),
                warned: warned.contains(silver.unit_id.as_str()),
                shared_hex: sharing_hexes.contains(silver.region_id.as_str()),
                crowded_hex: crowded_hexes.contains(silver.region_id.as_str()),
                hex_warned: hex_warned.contains(silver.region_id.as_str()),
                doubted_sharer_in_hex: hexes_with_a_doubted_sharer
                    .contains(silver.region_id.as_str()),
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
/// 1,392 own units, 21 of them warned per-unit, 1 exempt as `Doubted`, 246 hexes exempt as
/// `SharedHex` and 27 hex-level pooled warnings across them.
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
    let warned_shared_hexes: BTreeSet<(&str, &str)> = compared
        .iter()
        .filter(|case| case.shared_hex && case.hex_warned)
        .map(|case| (case.fixture, case.silver.region_id.as_str()))
        .collect();
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
    // The floor that would have caught #602's review comment. The hex-level assertion reads a
    // finding shape - hex-level, no `unit_id` - that the per-unit walk discards, and reading the
    // wrong one made it vacuously true rather than failing. A `true` it must see is the cheapest
    // guard against that returning.
    // Dormant with the test it guards, and for the reason given there (`ah-e66j`, `ah-8l9a`): that
    // test now walks nothing, so a floor under it would assert about a comparison nobody makes.
    // Kept as a binding rather than deleted, so that restoring the test restores its guard with it
    // - and so that the corpus is still asked the question, which is what a reader checks first.
    let _warned_sharing_hexes_when_ah_8l9a_lands = warned_shared_hexes;
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
    /// This hex holds more than one own unit, so the ledger judges it as one purse while the
    /// column counts each unit alone by decision (`ah-1wcw.1`). The assertion becomes a hex-level
    /// one - see `the_column_and_the_warning_agree_on_every_sharing_hex_in_the_corpus`.
    ///
    /// **Widened from "some own unit carries `sharing`" by `ah-e66j`**, which made maintenance
    /// sharing automatic: a hex with no flag anywhere now lends silver between its units too, and
    /// the lender's row shows nothing of what it lent (that was the navigator's decision, round 2),
    /// so the column cannot reconstruct such a unit's ledger balance either. Naming it `SharedHex`
    /// still: what is shared is no longer only what the flag shares.
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
    } else if case.shared_hex || case.crowded_hex {
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
/// this way, and every divergence the corpus contains is one of them.
///
/// What is left is the hex-level statement, and it is the check's own arithmetic rather than a flat
/// sum over the hex: the purse is the balance-after-maintenance of the hex's non-doubted
/// **sharers**, the claims on it are the overdrafts of its non-doubted **non-sharers** (a
/// non-sharer in credit keeps its own silver and helps nobody), and **the pooled
/// `not-enough-silver` finding fires exactly when the purse does not cover the claims.**
/// Both directions are asserted, as one equality, because both are real: a hex warned with a
/// healthy purse and a hex silent with an empty one are different defects and each has a surface
/// that could cause it.
///
/// The warning read here is the **hex-level** finding, the one with no `unit_id`. That is the only
/// kind a sharing hex ever gets, and reading the per-unit findings instead is what made an earlier
/// version of this test assert nothing at all.
/// **Dormant since `ah-e66j`, deliberately, and `ah-8l9a` exists to wake it up again.**
///
/// That bead made maintenance sharing automatic, so every hex holding more than one own unit lends
/// silver between its units at step 4 of the payment order - and the lender's row shows nothing of
/// the loan (the navigator's round-2 decision), while in the branch where the hex cannot cover
/// every claimant *neither* side records anything, by design. So the purse below can no longer be
/// reconstructed from the column: three reconstructions were tried while `ah-e66j` was built and
/// each agreed with the ledger on most of the corpus and diverged on a hex where step 4 had moved
/// silver invisibly.
///
/// The filter therefore skips every hex with more than one own unit, which is every sharing hex the
/// corpus has, so this test currently walks nothing. That is exactly the vacuity Copilot caught on
/// #602 - reintroduced knowingly, with the navigator's agreement, and with a bead against it rather
/// than by accident. What restores it is a signal the test can read for what step 4 moved.
#[test]
fn the_column_and_the_warning_agree_on_every_sharing_hex_in_the_corpus() {
    /// One hex's side of the comparison.
    #[derive(Default)]
    struct Pooled {
        /// The sum of `B - U` over the hex's non-doubted **sharers** - the purse itself.
        pool: i64,
        /// The overdrafts of the hex's non-doubted **non-sharers**, which borrow from the purse.
        /// A non-sharer in credit contributes nothing: its silver is its own.
        claims: i64,
        warned: bool,
        /// A doubted sharer makes the pool untrusted, so no pooled finding is emitted at all.
        untrusted: bool,
        /// `<unit> (<its own B - U>)`, so a failure names who is in the purse.
        units: Vec<String>,
    }

    // Keyed by fixture and hex, because two fixtures of the same game carry the same region ids.
    let mut hexes: BTreeMap<(&'static str, String), Pooled> = BTreeMap::new();

    for case in compare_the_corpus() {
        if !case.shared_hex || case.crowded_hex {
            continue;
        }
        let silver = &case.silver;
        let entry = hexes
            .entry((case.fixture, silver.region_id.clone()))
            .or_default();
        entry.warned = case.hex_warned;
        entry.untrusted |= case.doubted_sharer_in_hex;

        // A doubted unit contributes nothing to the purse the check sums either: `relieved_balance`
        // is only read for units the ledger did not doubt.
        let Some(balance) = balance_before_maintenance(silver) else {
            entry.units.push(format!("{} (doubted)", silver.unit_id));
            continue;
        };
        let left = balance - upkeep_drawn_from_silver(silver);
        if case.shares {
            entry.pool += left;
        } else {
            entry.claims += (-left).max(0);
        }
        entry.units.push(format!(
            "{} ({left}{})",
            silver.unit_id,
            if case.shares { ", sharing" } else { "" }
        ));
    }

    for ((fixture, region_id), hex) in hexes {
        if hex.untrusted {
            continue;
        }
        assert_eq!(
            hex.warned,
            hex.pool - hex.claims < 0,
            "{fixture} hex {region_id}: the column gives a purse of {} against claims of {} on it, \
             leaving {}, and the pooled warning {} - {}",
            hex.pool,
            hex.claims,
            hex.pool - hex.claims,
            if hex.warned { "fires" } else { "does not fire" },
            hex.units.join(", "),
        );
    }
}
