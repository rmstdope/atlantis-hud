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

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};
use std::collections::{BTreeMap, BTreeSet};

mod common;
use common::{ruleset, without_standing_month_orders};

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
    assert!(
        !warned_shared_hexes.is_empty(),
        "no sharing hex in the corpus is warned, so the hex-level equality never sees a `true`"
    );
}

/// The ledger's balance before maintenance, reconstructed from the column.
///
/// `B = held + income - late_income - wanted_for_orders`. The ledger credits `TAX` but never
/// `WORK` or `ENTERTAIN` (`semantics.rs`: wages and takings from entertaining are paid in the
/// turn's last phase, so they can fund nothing this month) - which is exactly what `late_income`
/// names, and why it is subtracted here.
///
/// It is `wanted_for_orders` rather than `expense` because the two differ on exactly one kind of
/// unit: one whose bounded `BUY` was cut down to what its silver covers (`ah-omn7`). The column
/// then spends only what the unit pays, while the ledger still charges the whole ask - which is
/// what keeps `not-enough-silver` firing on it. Reconstructing the ledger's balance therefore
/// needs the ask.
fn balance_before_maintenance(silver: &UnitSilver) -> Option<i64> {
    Some(silver.held + silver.income? - silver.late_income? - silver.wanted_for_orders?)
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

/// What maintenance draws off a unit's own silver **before step 4 moves anything**.
///
/// `upkeep_drawn_from_silver` is the figure the column shows, which is net of every relief - and
/// since `ah-e66j` that includes silver a faction-mate in the same hex lent at step 4. Steps 2 and
/// 7 are paid from *outside* the hex (faction food, the unclaimed fund) and must stay subtracted;
/// step 4 is paid from *inside* it, by a unit this very sum is about to count as a lender, so
/// leaving it subtracted would count the same silver twice - once as the lender's spare and once
/// as a claim that no longer exists.
///
/// Correct in both of `ah-e66j`'s branches without distinguishing them, so the test needs no signal
/// for what step 4 did. Where the hex covered everybody, `shared_silver_covered` carries what each
/// fed unit received and adding it back restores the pre-step-4 claim exactly. Where the hex fell
/// short, `ah-e66j` records nothing on either side by decision, so `upkeep` was never reduced and
/// `shared_silver_covered` is `0` - and adding zero is right.
fn upkeep_before_hex_sharing(silver: &UnitSilver) -> i64 {
    let late = silver.late_income.unwrap_or(0);
    (silver.upkeep.unwrap_or(0) + silver.shared_silver_covered - late).max(0)
}

/// A `UnitSilver` carrying only the three terms the claim helpers read, for the arithmetic test
/// below. Everything else is the neutral value, so a reader can see at a glance that nothing else
/// is in play.
fn claim_case(upkeep: i64, late_income: i64, shared_silver_covered: i64) -> UnitSilver {
    UnitSilver {
        unit_id: "1".into(),
        region_id: "(0,0)".into(),
        held: 0,
        income: Some(0),
        late_income: Some(late_income),
        expense: Some(0),
        wanted_for_orders: Some(0),
        at_month_end: Some(0),
        short_for_orders: Some(0),
        short_on: None,
        upkeep: Some(upkeep),
        doubt: None,
        doubt_subject: None,
        received: 0,
        givers: Vec::new(),
        taken: 0,
        taken_from: Vec::new(),
        taken_unshown: 0,
        taken_unshown_from: Vec::new(),
        faction_food_covered: 0,
        shared_silver_covered,
        shared_silver_for_orders: 0,
        taxes_by_flag: false,
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
        production_requested: None,
        production_capped_by: None,
        production_region_name: None,
        works_by_default: false,
        cast_made: 0,
        cast_made_named: None,
        cast_wanted: 0,
        cast_capped_by: None,
        cast_summons: false,
        formed: None,
        buy_all: Vec::new(),
        changes: Vec::new(),
    }
}

#[test]
fn upkeep_before_hex_sharing_adds_back_what_a_neighbour_lent() {
    // 20 still owed after a neighbour paid 40 of it: the claim on the hex was 60 before step 4.
    assert_eq!(upkeep_before_hex_sharing(&claim_case(20, 0, 40)), 60);

    // With nothing lent - which is every unit outside a sharing hex, and every unit in a hex that
    // fell short - the two helpers must agree, or the reconstruction would have changed meaning
    // for units step 4 never touched.
    let untouched = claim_case(30, 5, 0);
    assert_eq!(
        upkeep_before_hex_sharing(&untouched),
        upkeep_drawn_from_silver(&untouched)
    );

    // Late income still cancels the claim rather than driving it negative, exactly as
    // `charge_upkeep` does.
    assert_eq!(upkeep_before_hex_sharing(&claim_case(10, 50, 5)), 0);
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
/// sum over the hex: the purse is what every non-doubted own unit has spare once its own
/// maintenance is drawn, the claims on it are what maintenance still draws on the units that came
/// up short - capped at what it drew, so a unit's *overspending* is never put on the hex - and
/// **the pooled `not-enough-silver` finding fires exactly when the purse does not cover the claims
/// and some unit's whole remaining overdraft is still upkeep.**
/// Both directions are asserted, as one equality, because both are real: a hex warned with a
/// healthy purse and a hex silent with an empty one are different defects and each has a surface
/// that could cause it.
///
/// The warning read here is the **hex-level** finding, the one with no `unit_id`. That is the only
/// kind a sharing hex ever gets, and reading the per-unit findings instead is what made an earlier
/// version of this test assert nothing at all.
/// **Dormant between `ah-e66j` and `ah-8l9a`, and awake again now.** `ah-e66j` made maintenance
/// sharing automatic - every hex holding more than one own unit lends silver between its units at
/// step 4 - and the lender's row shows nothing of the loan (the navigator's round-2 decision),
/// so the purse could no longer be reconstructed the way this test reconstructed it. The filter
/// was widened to skip every such hex, which was every sharing hex the corpus has, and the test
/// walked nothing: exactly the vacuity Copilot caught on #602, reintroduced knowingly with a bead
/// against it.
///
/// `ah-8l9a` restores it without asking production for a new field. Step 4 is reconstructed in its
/// two states instead - `upkeep_before_hex_sharing` adds `shared_silver_covered` back to recover
/// the claim the pool actually saw, and `upkeep_drawn_from_silver` stays as the column's own,
/// post-relief figure that the hex-level message is finally collected from. What that cannot reach
/// is the `SHARE` pool for *orders*, whose lender the column never shows; a hex that is both
/// flagged and crowded is therefore skipped, and said so at the filter.
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
        /// Whether this hex is judged by `report_shortfalls`'s `SHARE` pool rather than by step
        /// 4's maintenance pooling. True only for a hex whose single own unit carries the flag -
        /// a flagged hex with neighbours is skipped above, unreconstructable.
        flagged: bool,
        /// What that lone sharer has left once the column's maintenance is drawn.
        lone_sharer_left: i64,
        /// The overdrafts the hex-level maintenance message is summed from: those of units whose
        /// whole shortfall is upkeep step 4 could not cover.
        maintenance_short: i64,
        /// `<unit> (<its own B - U>)`, so a failure names who is in the purse.
        units: Vec<String>,
    }

    // Keyed by fixture and hex, because two fixtures of the same game carry the same region ids.
    let mut hexes: BTreeMap<(&'static str, String), Pooled> = BTreeMap::new();

    for case in &compare_the_corpus() {
        // Judged: every hex the ledger pools maintenance across (`crowded_hex`), plus the lone
        // `sharing` unit whose hex pools nothing, where the two arms coincide.
        //
        // Skipped: a hex that is **both** flagged and crowded. There the pooled finding may come
        // from `report_shortfalls`'s `SHARE` pool for *orders*, which sums `relieved_balance` over
        // the sharers alone - and a lender's `relieved_balance` is below what its row shows,
        // because `ah-e66j`'s round-2 decision keeps the loan off the column. That half is
        // unreconstructable from the column and stays unguarded here, deliberately: this test
        // restores the maintenance guard, which is what `ah-e66j` broke, and guarding the orders
        // pool would need the lending exposed (`ah-8l9a`, *Out of scope*).
        //
        // **`ah-moq3` narrowed what is missing, and it is not yet nothing.** The borrower's side
        // is on the column now (`shared_silver_for_orders`) and the lender pays for it out of its
        // own `expense`, so the two surfaces agree about *who is short* - which is the defect that
        // bead fixed, and which the per-unit walk above now covers for these hexes too. What the
        // column still does not say is **which** lender paid: the loan is inside one `expense`
        // among several, so the purse this test sums over the sharers cannot be told apart from
        // the money they spent on themselves. Attempted here and reverted: letting these hexes in
        // fails `G3_F42_T40 1:35,9`, where the reconstruction reads a purse of 10,477 against
        // claims of 3,290 while the ledger's `SHARE` arm - the one that actually judges a flagged
        // crowded hex - warns. Removing this needs the lender's share of the loan on the column,
        // which is a field and a decision of its own.
        if case.shared_hex && case.crowded_hex {
            continue;
        }
        if !case.shared_hex && !case.crowded_hex {
            continue;
        }
        let silver = &case.silver;
        let entry = hexes
            .entry((case.fixture, silver.region_id.clone()))
            .or_default();
        entry.warned = case.hex_warned;
        entry.untrusted |= case.doubted_sharer_in_hex;
        entry.flagged |= case.shares;

        // A doubted unit contributes nothing to the purse the check sums either: `relieved_balance`
        // is only read for units the ledger did not doubt.
        let Some(balance) = balance_before_maintenance(silver) else {
            entry.units.push(format!("{} (doubted)", silver.unit_id));
            continue;
        };
        // Step 4 is reconstructed as the ledger runs it, in two states: what each unit's balance
        // was *before* it - which is what the pool lends out of and what claims are made against -
        // and what the column shows *after* it, which is what the hex-level message is finally
        // collected from. The one field that separates them is `shared_silver_covered`, and
        // `upkeep_before_hex_sharing` is where it is added back.
        let drawn_before = upkeep_before_hex_sharing(silver);
        let left_before = balance - drawn_before;
        let left_after = balance - upkeep_drawn_from_silver(silver);

        // Every unit lends what it has spare once its own maintenance is paid, and claims at most
        // what maintenance drew on it - `unpayable_upkeep`'s own cap, without which a unit whose
        // *orders* overspend would put that overspending on the hex.
        entry.pool += left_before.max(0);
        entry.claims += (-left_before).max(0).min(drawn_before);

        // What the hex-level message is actually made of: a unit whose whole overdraft is unpaid
        // upkeep. One that also overspends on its orders keeps its own per-unit finding instead
        // (`report_shortfalls`'s `short <= unpaid_upkeep` gate), and a non-negative balance before
        // maintenance is exactly that condition seen from the column.
        if balance >= 0 && left_after < 0 {
            entry.maintenance_short += -left_after;
        }
        if case.shares {
            entry.lone_sharer_left += left_after;
        }

        entry.units.push(format!(
            "{} (before {left_before}, after {left_after}, drawn {drawn_before})",
            silver.unit_id,
        ));
    }

    let mut judged_pooled_hexes = 0usize;
    for ((fixture, region_id), hex) in &hexes {
        if hex.untrusted {
            continue;
        }
        if hex.units.len() > 1 {
            judged_pooled_hexes += 1;
        }

        // The ledger sets `maintenance_pooled` only when step 4 had something to lend and could
        // not cover everybody, and emits the hex finding only when some unit's whole overdraft is
        // then still upkeep. Both halves are needed: a hex that covered everybody is silent, and
        // so is one whose only overdrafts are its orders'.
        let pooled_and_short = hex.pool > 0 && hex.claims > 0 && hex.pool < hex.claims;
        // A lone sharer's hex is judged by the `SHARE` pool instead, which is that one unit's own
        // relieved balance - and with no neighbour there is nothing for step 4 to lend, so the
        // maintenance arm never speaks for it.
        let expected = if hex.flagged {
            hex.lone_sharer_left < 0
        } else {
            pooled_and_short && hex.maintenance_short > 0
        };
        assert_eq!(
            hex.warned,
            expected,
            "{fixture} hex {region_id}: the column gives a purse of {} against claims of {} on it, \
             leaving {}, and the pooled warning {} - {}",
            hex.pool,
            hex.claims,
            hex.pool - hex.claims,
            if hex.warned { "fires" } else { "does not fire" },
            hex.units.join(", "),
        );
    }

    // A test that compares nothing passes, which is the defect this bead was written against
    // (`ah-8l9a`, and Copilot's comment on #602 before it). The count is of hexes actually
    // **judged** - `untrusted` hexes are short-circuited above and must not reach it, or the same
    // vacuity returns in a new place.
    //
    // A count of *judged* pooled hexes rather than of *warned* ones, which is what `ah-8l9a`'s
    // acceptance asked for, and the corpus is why: all 22 of its crowded, unflagged hexes are
    // solvent, so no floor over warned ones can be met without either widening the corpus or
    // counting the flagged hexes this test cannot reconstruct. The warned direction is covered
    // instead by `a_hex_that_cannot_cover_its_own_upkeep_is_warned_once_for_the_hex` below, which
    // is the branch a corpus of solvent hexes can never exercise.
    assert!(
        judged_pooled_hexes > 0,
        "no hex holding more than one own unit was judged, so this test compared nothing that \
         pooling applies to - either the corpus changed or the reconstruction is silently \
         exempting every hex, which is what `ah-8l9a` was written to end"
    );
}

/// The branch the corpus does not contain: a hex whose units cannot cover their own upkeep between
/// them.
///
/// Every crowded, unflagged hex in the corpus is solvent, so the walk above only ever watches step
/// 4 succeed. This is the other side of `ah-e66j`'s decision - where the pool falls short the whole
/// hex is marked once and no unit's figure moves - and without a fixture for it the restored guard
/// would still be blind to the case it most needs to catch.
///
/// One lender with a little spare and one unit that cannot pay a penny of its fee: the pool is real
/// but too small, so nothing is recorded on either unit and the hex is marked instead.
#[test]
fn a_hex_that_cannot_cover_its_own_upkeep_is_warned_once_for_the_hex() {
    let ruleset = ruleset();
    // Joined rather than written as one escaped literal: a wrapped unit line is recognised by its
    // two-space indent, and a `\`-continuation in a Rust string eats exactly that.
    let report = [
        "Atlantis Report For:",
        "The Disinherited Knights (42)",
        "February, Year 1",
        "",
        "plain (1,1) in Nowhere, 10 peasants (humans), $5.",
        "------------------------------------------------------------",
        "  Wages: $13.5 (Max: $633).",
        "  Wanted: none.",
        "  For Sale: none.",
        "  Entertainment available: $85.",
        "  Products: 31 grain [GRAI].",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Lender (100), The Disinherited Knights (42), behind, human [HUMN], 12 silver [SILV]. Weight: 10. Capacity: 0/0/15/0. Skills: none.",
        "* Pauper (101), The Disinherited Knights (42), behind, human [HUMN]. Weight: 10. Capacity: 0/0/15/0. Skills: none.",
        "",
    ]
    .join("\n");
    let mut parsed = parse_report_full(&report);
    classify_units(&mut parsed, &ruleset);
    // Both units are ordered `IDLE` rather than left blank: a unit with no month-long order is set
    // to work and earns the region's wage, which would pay both fees and leave this fixture
    // asserting about a hex that is no longer short (`ah-gjq4`). `IDLE` spends the month and earns
    // nothing, which is the state this branch needs.
    let review = review_turn(
        &parsed,
        "unit 100\nIDLE\nunit 101\nIDLE\n",
        Some(&ruleset),
        CheckOptions::default(),
    );

    let silver: BTreeMap<&str, &UnitSilver> = review
        .silver
        .iter()
        .map(|silver| (silver.unit_id.as_str(), silver))
        .collect();
    assert_eq!(
        silver.len(),
        2,
        "both own units must reach the column, or this fixture asserts about nothing"
    );

    // `ah-e66j`'s contended branch records nothing on either side, so the column shows the pauper
    // owing its whole fee and the lender having lent nothing. If this ever moves, the branch this
    // fixture covers has changed and the reconstruction above must change with it.
    for (id, unit) in &silver {
        assert_eq!(
            unit.shared_silver_covered, 0,
            "{id}: a hex that fell short records no relief, by decision (`ah-e66j`)"
        );
    }
    assert_eq!(silver["100"].held, 12);
    assert_eq!(silver["101"].held, 0);
    assert_eq!(silver["100"].upkeep, Some(10));
    assert_eq!(silver["101"].upkeep, Some(10));

    let shortfalls: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "not-enough-silver")
        .collect();
    assert_eq!(
        shortfalls.len(),
        1,
        "expected exactly one shortfall for this hex, got {:?}",
        shortfalls
            .iter()
            .map(|finding| (finding.unit_id.clone(), finding.message.clone()))
            .collect::<Vec<_>>()
    );
    assert!(
        shortfalls[0].unit_id.is_none(),
        "the hex is marked once and no unit is named, because which of them the engine feeds \
         cannot be told (`ah-e66j`): {:?}",
        shortfalls[0]
    );

    // And the reconstruction the corpus walk uses agrees, which is the point of the fixture: a
    // real pool of $2 against claims of $10, and the pauper's whole overdraft still upkeep.
    let left_of = |unit: &UnitSilver| {
        balance_before_maintenance(unit).expect("nothing is doubted here")
            - upkeep_before_hex_sharing(unit)
    };
    let claim_of = |unit: &UnitSilver| (-left_of(unit)).max(0).min(upkeep_before_hex_sharing(unit));
    let pool = left_of(silver["100"]).max(0) + left_of(silver["101"]).max(0);
    let claims = claim_of(silver["100"]) + claim_of(silver["101"]);
    assert_eq!((pool, claims), (2, 10));
    assert!(
        pool > 0 && pool < claims,
        "the reconstruction must see a real pool that falls short - pool {pool}, claims {claims}"
    );
}

/// The table's rows and the Silver column's figures are two separate walks of one document
/// (`effects::Working` and `intents::read_formed`), and they must classify every `FORM` block the
/// same way or a unit shown in one surface could be silently missing from the other (`ah-jw85`).
///
/// Run over the whole corpus rather than a synthetic fixture built for the purpose: none of the 26
/// committed turns happens to carry a `FORM` order, so this is the drift guard for whichever real
/// document is the first to, and increment 2's own unit tests (`intents.rs`) already pin the
/// nested, duplicate-alias and unreadable-alias rules this integration test cannot exercise without
/// a fixture of its own.
#[test]
fn the_preview_and_the_review_form_the_same_units() {
    let ruleset = ruleset();

    for report in atlantis_hud_fixtures::ALL {
        let mut parsed = parse_report_full(report.text);
        classify_units(&mut parsed, &ruleset);
        let orders = extract_orders_template(report.text)
            .map(|template| template.text)
            .unwrap_or_default();

        let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
        let reviewed: BTreeSet<&str> = review
            .silver
            .iter()
            .map(|silver| silver.unit_id.as_str())
            .filter(|id| id.starts_with("new-"))
            .collect();

        let preview = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            atlantis_hud_fixtures::RULESET_JSON,
            report.text,
            "[]",
            &orders,
        )
        .expect("the committed ruleset loads");
        let previewed: BTreeSet<&str> = preview
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .map(|unit| unit.unit.unit_id.as_str())
            .filter(|id| id.starts_with("new-"))
            .collect();

        assert_eq!(
            reviewed, previewed,
            "{}: the preview's rows and the review's silver entries disagree about which units \
             this document's FORM blocks create",
            report.name
        );
    }
}

// --- PILLAGE: the two surfaces, on the hex `ah-q6bt` was filed from -------------------------

/// The take of mountain (36,4) in `G3_F42_T42`: twice a tax base of $22,654.
const THE_TAKE: i64 = 45_308;

/// The column and the pillage warning, on one hex, for one set of orders: what each pillaging unit
/// earns, and what it is told.
fn pillage_case(extra: &str) -> (BTreeMap<String, UnitSilver>, Vec<String>) {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    // The units these cases order to PILLAGE carry standing month-long orders in the report's own
    // template, and a PILLAGE that lost the month never runs (`ah-rzkm`).
    let orders = without_standing_month_orders(&template, &["2418", "12222", "13303"]);
    let review = review_turn(
        &parsed,
        &format!("{orders}{extra}"),
        Some(&ruleset),
        CheckOptions::default(),
    );

    let priced = review
        .silver
        .iter()
        .map(|row| (row.unit_id.clone(), row.clone()))
        .collect();
    let told = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "pillage-without-men")
        .map(|finding| finding.message.clone())
        .collect();
    (priced, told)
}

/// `ah-q6bt`, decisions G1 and D1 together, held across both surfaces: with City Guards (13303) and
/// Transporter (2418) both ordering `PILLAGE`, the warning is silent - 445 combat ready men against
/// a threshold of 227 - and the column divides the take between them in proportion to those men.
///
/// The property that matters more than either figure is the last assertion: the two shares add up
/// to no more than the region holds. Crediting each pillager the whole take, which is what shipped
/// before this bead, overstated the faction's month by a factor of the number of pillaging units.
#[test]
fn the_column_divides_one_take_between_the_pillagers_the_warning_allows() {
    let (priced, told) = pillage_case("\nunit 2418\nPILLAGE\nunit 13303\nPILLAGE\n");
    assert!(told.is_empty(), "the pillage goes ahead: {told:?}");

    let guards = priced.get("13303").expect("City Guards is priced");
    let transporter = priced.get("2418").expect("Transporter is priced");
    assert_eq!(guards.doubt, None);
    assert_eq!(transporter.doubt, None);
    assert_eq!(
        guards.income,
        Some(THE_TAKE),
        "445 of the 445 combat ready men"
    );
    assert_eq!(
        transporter.income,
        Some(0),
        "one man with no weapon takes no share of what its men did not take"
    );
    assert!(
        guards.income.unwrap_or(0) + transporter.income.unwrap_or(0) <= THE_TAKE,
        "the region holds the take once"
    );
}

/// The other direction, and `ah-abwx`'s rule: where the warning fires the column must not promise
/// the money. Transporter alone cannot reach the threshold, so it is told so *and* earns nothing.
#[test]
fn a_warned_pillager_is_promised_nothing_by_the_column() {
    let (priced, told) = pillage_case("\nunit 2418\nPILLAGE\n");
    assert_eq!(told.len(), 1, "one warning: {told:?}");

    let transporter = priced.get("2418").expect("Transporter is priced");
    assert_eq!(transporter.income, Some(0));
    assert_eq!(transporter.doubt, None, "a certain zero, not a doubt");
}

/// And where the warning hedges, so does the column: a pillager whose own men cannot be counted is
/// doubted rather than shown a confident zero (decision U1). A column showing `$0` beside a warning
/// saying *"may not be able to"* would be the two surfaces contradicting each other about one
/// order, which is what this file exists to catch.
#[test]
fn a_hedged_pillager_is_doubted_by_the_column_too() {
    let (priced, told) = pillage_case("\nunit 13303\nGIVE 2418 ALL MAGIC\nunit 2418\nPILLAGE\n");
    assert_eq!(
        told,
        vec![
            "may not be able to pillage here: needs 227 combat ready men, and a transfer this month means this unit's cannot be counted"
        ]
    );

    let transporter = priced.get("2418").expect("Transporter is priced");
    assert_eq!(
        transporter.doubt,
        Some(atlantis_hud_core::orders::silver::SilverDoubt::UnknownCombatReady)
    );
    assert_eq!(transporter.income, None);
}
