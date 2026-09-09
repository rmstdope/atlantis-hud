//! Every property of a `GIVE ... ALL SILV` that `silver.rs`'s own `mod tests` used to pin, held
//! across **both** walks that answer for one (`ah-6m7b.3`).
//!
//! The column used to settle every `ALL` gift *after* the whole Give phase, against
//! `held + give_phase_income - expense`. Since this bead a `GIVE ... ALL SILV` is settled in
//! exactly one place, `semantics::transfer`, and the SILVER column books what that decided through
//! `UnitFacts::settled_gifts`; a ledger-less caller therefore settles none at all and there was
//! nothing left for those unit tests to exercise.
//!
//! Re-expressed here as `review_turn` cases over hand-built reports, each asserting the same
//! property it always did **and** that the ITEMS surface agrees - so nothing is lost and each now
//! guards both walks instead of one. Every figure below was measured on this tree.
//!
//! `rules/give`: *"The second form of the GIVE order will give all of a given item to another
//! unit."* `rules/sequenceofevents` fixes which phases run before and after *"Give orders"*.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{
    ProductionCap, SilverChangeCause, SilverDoubt, SilverSpender, UnitSilver,
};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, an optional market line, and whatever own units the caller names.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn report(region: &str, market: &[&str], units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        region.to_string(),
    ];
    lines.extend(market.iter().map(|line| format!("  {line}")));
    lines.extend([
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ]);
    lines.extend(units.iter().map(|unit| (*unit).to_string()));
    lines.push(String::new());
    lines.join("\n")
}

/// The whole review for one order script, so a test can read the column and the findings from one
/// pass - they are computed together and must agree.
fn review_of(text: &str, script: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    review_turn(
        &parsed,
        &format!("{template}\n{script}"),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn row_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the column has a row for unit {unit_id}"))
        .clone()
}

/// How many of `tag` the ITEMS preview leaves `unit_id` holding.
fn preview_holding(text: &str, script: &str, unit_id: &str, tag: &str) -> i64 {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &format!("{template}\n{script}"),
    )
    .expect("the committed ruleset loads");
    preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the preview has unit {unit_id}"))
        .unit
        .items
        .iter()
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum()
}

/// A quiet region: nothing to tax, nothing to pillage, no wages worth having.
const QUIET: &str = "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.";
/// The same region with a tax base, for the phases that draw on one.
/// The same region with a tax base ten combat-ready men can pillage: `rules/economy_taxingpillaging`
/// requires enough men to tax half the available money, and ten taxers collect $500 of this $1000.
const TAXABLE: &str = "plain (1,1) in Nowhere, 1000 peasants (orcs), $1000.";

/// A giver holding `silver`, with the combat skill that makes its men taxers and pillagers.
fn giver(silver: i64) -> String {
    format!(
        "* Givers (900), Foo (1), 10 orcs [ORC], {silver} silver [SILV]. Weight: 100. \
         Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30)."
    )
}

/// A bare unit to receive gifts.
fn hands(id: &str) -> String {
    format!("* Hands ({id}), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.")
}

// --- the one figure this bead moves ---------------------------------------------------------

/// `ah-6m7b.3`. An `ALL` gift hands over the whole purse; a later exact gift cannot reach back and
/// shrink it, and the column no longer contradicts the warning printed beside it.
#[test]
fn an_earlier_give_all_is_not_shrunk_by_a_later_exact_give() {
    let text = report(QUIET, &[], &[&giver(100), &hands("901"), &hands("902")]);
    let script = "unit 900\nGIVE 901 ALL SILV\nGIVE 902 50 SILV\n";
    let review = review_of(&text, script);
    let giver = row_of(&review, "900");

    assert_eq!(giver.doubt, None, "the month is priced");
    let gifts: Vec<(Option<i64>, i64, &SilverChangeCause, Option<&str>)> = giver
        .changes
        .iter()
        .map(|change| {
            (
                change.line,
                change.amount,
                &change.cause,
                change.other.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        gifts,
        vec![
            (
                Some(3),
                -100,
                &SilverChangeCause::GaveAway,
                Some("unit 901")
            ),
            (Some(4), -50, &SilverChangeCause::GaveAway, Some("unit 902")),
        ],
        "the whole purse goes to the first target and the exact gift is booked in full"
    );
    assert_eq!(giver.expense, Some(150), "both gifts, in full");
    assert_eq!(
        giver.at_month_end,
        Some(-50),
        "the orders spend more than the unit holds, and the column says so"
    );

    // The receiver's row, which the column already got right and now agrees with.
    assert_eq!(row_of(&review, "901").income, Some(100));
    assert_eq!(preview_holding(&text, script, "901", "SILV"), 100);

    // The finding is unchanged by this bead - it is already the ledger's number - and the column
    // beside it has stopped contradicting it.
    let shortfall = review
        .findings
        .iter()
        .find(|finding| finding.code.as_str() == "not-enough-silver")
        .expect("the shortfall is reported");
    assert_eq!(
        shortfall.message,
        "short $50: this unit can have $100 and its orders spend $150"
    );
}

// --- the arithmetic that moved out of `silver.rs`'s `mod tests` ------------------------------

/// The gift is an expense of the month, and the receiver is credited it.
#[test]
fn a_unit_that_gives_silver_away_is_charged_for_it() {
    let text = report(QUIET, &[], &[&giver(300), &hands("901")]);
    let script = "unit 900\nGIVE 901 ALL SILV\n";
    let review = review_of(&text, script);
    let giver = row_of(&review, "900");

    assert_eq!(giver.doubt, None);
    assert_eq!(giver.expense, Some(300));
    assert_eq!(giver.at_month_end, Some(0));
    assert_eq!(giver.given_to_nobody, 0);
    assert_eq!(preview_holding(&text, script, "901", "SILV"), 300);
}

/// `GIVE 0 ALL SILV` destroys the money (`rules/give`), and destroyed money is still spent.
#[test]
fn silver_given_to_nobody_is_still_spent() {
    let text = report(QUIET, &[], &[&giver(40)]);
    let script = "unit 900\nGIVE 0 ALL SILV\n";
    let review = review_of(&text, script);
    let giver = row_of(&review, "900");

    assert_eq!(giver.doubt, None);
    assert_eq!(giver.given_to_nobody, 40);
    assert_eq!(giver.expense, Some(40));
    assert_eq!(giver.at_month_end, Some(0));
    assert_eq!(
        giver.changes.iter().map(|c| &c.cause).collect::<Vec<_>>(),
        vec![&SilverChangeCause::Discarded]
    );
    assert_eq!(preview_holding(&text, script, "900", "SILV"), 0);
}

/// `rules/sequenceofevents` runs *Give orders* before *"Market orders"*, so the gift is settled
/// first and an exact `BUY` is priced against what it left - whichever line each was written on
/// (`ah-npab`).
#[test]
fn giving_all_silver_precedes_exact_market_spending_in_either_text_order() {
    for script in [
        "unit 900\nGIVE 901 ALL SILV\nBUY 1 grain\n",
        "unit 900\nBUY 1 grain\nGIVE 901 ALL SILV\n",
    ] {
        let text = report(
            QUIET,
            &["For Sale: 20 grain [GRAI] at $10."],
            &[&giver(100), &hands("901")],
        );
        let review = review_of(&text, script);
        let giver = row_of(&review, "900");

        assert_eq!(giver.doubt, None, "{script:?}");
        assert_eq!(
            giver.expense,
            Some(100),
            "{script:?}: the gift takes the whole purse and the purchase then fails"
        );
        assert_eq!(giver.wanted_for_orders, Some(110), "{script:?}");
        assert_eq!(giver.at_month_end, Some(0), "{script:?}");
        assert_eq!(giver.short_for_orders, Some(10), "{script:?}");
        assert_eq!(preview_holding(&text, script, "901", "SILV"), 100);
    }
}

/// "Instant Magic ... Spells are CAST" runs after *Give orders*, so a cast's cost does not make the
/// gift smaller - and the cast is priced against the purse the gift leaves behind (`ah-a5ci`,
/// `ah-m7su`). `data/CRPA` prices Create Amulet of Protection at 200 silver.
#[test]
fn giving_all_silver_away_is_not_charged_for_this_months_cast() {
    let mage = "* Mages (900), Foo (1), orc [ORC], 200 silver [SILV]. Weight: 10. \
                Capacity: 0/0/15/0. Skills: create amulet of protection [CRPA] 1 (30).";
    for script in [
        "unit 900\nCAST Create_Amulet_Of_Protection\nGIVE 0 ALL SILV\n",
        "unit 900\nGIVE 0 ALL SILV\nCAST Create_Amulet_Of_Protection\n",
    ] {
        let text = report(QUIET, &[], &[mage]);
        let review = review_of(&text, script);
        let unit = row_of(&review, "900");

        assert_eq!(unit.doubt, None, "{script:?}");
        assert_eq!(unit.given_to_nobody, 200, "{script:?}");
        assert_eq!(
            unit.cast_made, 0,
            "{script:?}: the gift leaves nothing to cast with"
        );
        assert_eq!(unit.cast_wanted, 1, "{script:?}");
        assert_eq!(
            unit.cast_capped_by,
            Some(ProductionCap::Silver),
            "{script:?}"
        );
        // `plan_cast` charges a mage that cannot afford even one for one anyway, which is the
        // shipped reading and not this bead's to change.
        assert_eq!(
            unit.expense,
            Some(400),
            "{script:?}: 200 given away and 200 charged for the cast"
        );
        assert_eq!(unit.at_month_end, Some(-200), "{script:?}");
        assert_eq!(unit.short_for_orders, Some(200), "{script:?}");
        assert_eq!(unit.short_on, Some(SilverSpender::Cast), "{script:?}");
    }
}

/// `rules/sequenceofevents` runs *Give orders* before "Manufacturing PRODUCE orders", so the gift
/// is settled first and the catapult is then unaffordable.
#[test]
fn giving_all_silver_away_is_not_charged_for_this_months_manufacture() {
    let wright = "* Wrights (900), Foo (1), 4 orcs [ORC], 3000 silver [SILV], 10 wood [WOOD]. \
                  Weight: 100. Capacity: 0/0/60/0. Skills: catapult [CATA] 1 (30).";
    for script in [
        "unit 900\nPRODUCE catapult\nGIVE 0 ALL SILV\n",
        "unit 900\nGIVE 0 ALL SILV\nPRODUCE catapult\n",
    ] {
        let text = report(QUIET, &[], &[wright]);
        let review = review_of(&text, script);
        let unit = row_of(&review, "900");

        assert_eq!(unit.doubt, None, "{script:?}");
        assert_eq!(unit.given_to_nobody, 3000, "{script:?}");
        assert_eq!(
            unit.produced, 0,
            "{script:?}: the gift leaves nothing to build the catapult with"
        );
        assert_eq!(
            unit.expense,
            Some(3000),
            "{script:?}: the gift, and nothing for a catapult never made"
        );
        assert_eq!(unit.at_month_end, Some(0), "{script:?}");
    }
}

/// `rules/sequenceofevents` opens the market after *Give orders*, so a sale's proceeds are not in
/// the purse the gift empties (`ah-tc79`).
#[test]
fn a_sale_does_not_fund_the_same_months_gift() {
    let seller = "* Givers (900), Foo (1), 10 orcs [ORC], 100 silver [SILV], 30 grain [GRAI]. \
                  Weight: 130. Capacity: 0/0/150/0.";
    let text = report(
        QUIET,
        &["Wanted: 100 grain [GRAI] at $10."],
        &[seller, &hands("901")],
    );
    let script = "unit 900\nSELL 30 grain\nGIVE 901 ALL SILV\n";
    let giver = row_of(&review_of(&text, script), "900");

    assert_eq!(giver.doubt, None);
    assert_eq!(giver.income, Some(300), "the sale earns 300");
    assert_eq!(
        giver.expense,
        Some(100),
        "but the gift is only what it held"
    );
    assert_eq!(giver.at_month_end, Some(300));
    assert_eq!(preview_holding(&text, script, "901", "SILV"), 100);
}

/// PILLAGE settles in the tax phase, after *Give orders*, so its take is not in the purse the gift
/// empties (`ah-tc79`).
#[test]
fn a_pillage_does_not_fund_the_same_months_gift() {
    let text = report(TAXABLE, &[], &[&giver(100), &hands("901")]);
    let script = "unit 900\nPILLAGE\nGIVE 901 ALL SILV\n";
    let giver = row_of(&review_of(&text, script), "900");

    assert_eq!(giver.doubt, None);
    assert_eq!(giver.income, Some(2000), "twice the hex's tax base");
    assert_eq!(giver.expense, Some(100), "the gift is only what it held");
    assert_eq!(giver.at_month_end, Some(2000));
    assert_eq!(preview_holding(&text, script, "901", "SILV"), 100);
}

/// `CLAIM` is an instant order and so precedes *Give orders*: claimed silver is in the purse a gift
/// empties (`ah-tc79`).
#[test]
fn a_claim_does_fund_the_same_months_gift() {
    let text = report(QUIET, &[], &[&giver(100), &hands("901")]);
    let script = "unit 900\nCLAIM 100\nGIVE 901 ALL SILV\n";
    let giver = row_of(&review_of(&text, script), "900");

    assert_eq!(giver.doubt, None);
    assert_eq!(giver.income, Some(100), "the claim");
    assert_eq!(
        giver.expense,
        Some(200),
        "the claim is in the purse the gift empties, on top of the 100 the unit held"
    );
    assert_eq!(giver.at_month_end, Some(0));
    // The ITEMS *preview* clamps a transfer to what the report shows the source holding, while the
    // ledger charges in full - the documented difference between the three readers of a Give phase
    // (`orders/transfer_agreement.rs`), and not a disagreement about this gift.
    assert_eq!(preview_holding(&text, script, "901", "SILV"), 100);
}

/// The doubt the column raises for itself still hides the gift where it should: an order it cannot
/// price *later* in the turn does not, since the gift is settled in the Give phase (`ah-m7su`).
#[test]
fn an_unpriceable_later_order_no_longer_hides_the_size_of_the_gift() {
    let text = report(QUIET, &[], &[&giver(300)]);
    let script = "unit 900\nGIVE 0 ALL SILV\nBUY 1 grain\n";
    let unit = row_of(&review_of(&text, script), "900");

    assert_eq!(unit.doubt, Some(SilverDoubt::MarketDoesNotSell));
    assert_eq!(unit.expense, None, "a doubted side is not a number");
    assert_eq!(unit.given_to_nobody, 300, "but the size of the gift is");
    assert_eq!(
        unit.short_on, None,
        "a doubted month reports no shortfall to explain"
    );
}
