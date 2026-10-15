//! A sharing hex's not-enough-silver sentence adds up from the units' SILVER hovers (`ah-s8ud`).
//!
//! Found verifying `ah-6xb2` on a trimmed `newage-arcanum-f5-t84`, jungle (38,34), under Trident:
//! with 4829's `TRANSPORT 5508 ALL SILV` in, the sentence spent $7 more than the sharers' hover
//! lines added up to. The $7 was 3431's silver paying part of Centurion Aimfram (4216)'s upkeep -
//! a faction-mate that does not share - at maintenance: `newage trident
//! rules/economy_maintenance` pays a fee from "Silver from other faction units in the same region"
//! once the unit's own runs out. It is really spent, so the sentence is right to count it; what
//! was missing was the line, which `ah-2zku` added to the payer's hover as `lent for upkeep`.
//!
//! So the sentence's "spend" is the cost lines of the sharers' hovers - what the orders asked
//! (the `BUY`'s whole ask, not the part the purse could fund), what was given away, the upkeep
//! they pay themselves, and what they lent an outsider for its upkeep - and "short" is spend less
//! "can have". Silver moving between two sharers (a `SHARE` loan, one sharer paying another's
//! fee) is the pool's own and is counted once.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;

/// The hex's units that share: they hold no silver and earn it this month.
const SHARERS: [&str; 3] = ["3431", "4682", "4829"];

/// What the wood costs at this market.
const WOOD: i64 = 81;

/// The jungle hex as the report showed it, cut to our own units: three sharers with no silver,
/// three faction-mates that stop sharing this month, a leader with none, and a quartermaster in a
/// Caravanserai for the `TRANSPORT`.
const REPORT: &str = "Bog Brawlers (5) Report

jungle (38,34) in Mordur Canopy, contains Brackford [city], 8647
  peasants (orcs), $21790.
------------------------------------------------------------
  The weather was clear last month; it will be clear next month.
  Wages: $22.6 (Max: $4358).
  Wanted: 140 grain [GRAI] at $35.
  For Sale: 28 wood [WOOD] at $81, 345 orcs [ORC] at $72.
  Entertainment available: $1175.
  Products: 65 grain [GRAI], 27 wood [WOOD], 8 herbs [HERB], 8 furs
    [FUR].

Exits:
  Southeast : jungle (39,35) in Mordur Canopy.

* Unit (3431), Bog Brawlers (5), behind, revealing faction, holding,
  sharing, consuming unit's food, 3 orcs [ORC], bag [BAG], 16 herbs
  [HERB]. Weight: 31. Capacity: 0/0/45/0. Skills: herb lore [HERB] 2
  (90).
* Unit (4682), Bog Brawlers (5), behind, revealing faction, holding,
  sharing, consuming unit's food, 5 orcs [ORC]. Weight: 50. Capacity:
  0/0/75/0. Skills: hunting [HUNT] 2 (90).
* Unit (4829), Bog Brawlers (5), behind, revealing faction, holding,
  sharing, consuming unit's food, 3 orcs [ORC], 2 spears [SPEA], 8 furs
  [FUR]. Weight: 40. Capacity: 0/0/45/0. Skills: hunting [HUNT] 2 (90).
* Centurion Aimfram (4216), Bog Brawlers (5), behind, sharing,
  consuming unit's food, leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.
  Skills: tactics [TACT] 5 (450).
* Unit (4868), Bog Brawlers (5), avoiding, behind, revealing faction,
  holding, sharing, consuming unit's food, 10 orcs [ORC], 48 wood
  [WOOD], 3713 silver [SILV]. Weight: 350. Capacity: 0/0/150/0. Skills:
  shipbuilding [SHIP] 5 (450).
* Unit (4862), Bog Brawlers (5), avoiding, behind, revealing faction,
  holding, sharing, consuming unit's food, 10 orcs [ORC], 789 silver
  [SILV]. Weight: 100. Capacity: 0/0/150/0. Skills: building [BUIL] 5
  (450).

+ Skag Lug Urgol [7] : Caravanserai.
  * Prefect Elfried (5508), Bog Brawlers (5), avoiding, behind,
    revealing faction, holding, sharing, consuming unit's food, leader
    [LEAD], 1260 silver [SILV]. Weight: 10. Capacity: 0/0/15/0. Skills:
    quartermaster [QUAM] 4 (360), observation [OBSE] 5 (450).

";

fn review(buy: i64, transport: bool) -> TurnReview {
    let ruleset = common::trident_ruleset();
    let mut parsed = parse_report_full(REPORT);
    classify_units(&mut parsed, &ruleset);
    let transport = if transport {
        "TRANSPORT 5508 ALL SILV\n"
    } else {
        ""
    };
    let orders = format!(
        "unit 5508\nSHARE 0\nunit 4868\nSHARE 0\nunit 4862\nSHARE 0\nunit 4216\nSHARE 0\n\
         unit 4829\nTAX\n{transport}unit 4682\nBUY {buy} WOOD\n"
    );
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

/// `(short, can have, spend)` from the hex's not-enough-silver sentence.
fn sentence(review: &TurnReview) -> (i64, i64, i64) {
    let found: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.unit_id.is_none() && finding.code.as_str() == "not-enough-silver")
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(found.len(), 1, "{found:?}");
    let message = found[0];
    assert!(
        message.starts_with("the units in this hex are short $")
            && message.contains("between them: they can have $")
            && message.contains("and their orders and upkeep spend $"),
        "the sentence's wording is unchanged: {message}"
    );
    let amount = |after: &str| -> i64 {
        let rest = &message[message.find(after).expect(after) + after.len()..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse().unwrap_or_else(|_| panic!("{message}"))
    };
    (amount("short $"), amount("can have $"), amount("spend $"))
}

fn forecast<'a>(review: &'a TurnReview, unit_id: &str) -> &'a UnitSilver {
    review
        .silver
        .iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("{unit_id} has a forecast"))
}

/// What the sharers' SILVER hovers say they spend, line by line, counting each coin once.
fn hover_spend(review: &TurnReview, buy: i64) -> i64 {
    let sharer = |label: &str| SHARERS.iter().any(|id| label.ends_with(&format!("({id})")));
    SHARERS
        .iter()
        .map(|id| {
            let unit = forecast(review, id);
            let lines: i64 = unit
                .changes
                .iter()
                .map(|change| match change.cause {
                    // The hover names the whole ask beside a BUY the purse cut ("asked ...").
                    SilverChangeCause::Bought => buy * WOOD,
                    SilverChangeCause::GaveAway => -change.amount,
                    // A fee paid for a unit outside the pool; one paid for a sharer is that
                    // sharer's upkeep, counted below.
                    SilverChangeCause::LentForUpkeep
                        if !change.other.as_deref().is_some_and(sharer) =>
                    {
                        -change.amount
                    }
                    _ => 0,
                })
                .sum();
            lines + unit.upkeep.expect("priced") + unit.shared_silver_covered
        })
        .sum()
}

fn assert_adds_up(buy: i64) {
    let review = review(buy, true);
    let (short, can_have, spend) = sentence(&review);
    assert_eq!(
        spend,
        hover_spend(&review, buy),
        "the sentence spends what the sharers' hover lines do"
    );
    assert_eq!(short, spend - can_have, "short is spend less can have");
}

#[test]
fn with_the_transport_in_two_wood_spend_what_the_hovers_add_up_to() {
    assert_adds_up(2);
}

#[test]
fn and_four_wood_too() {
    assert_adds_up(4);
}

/// The $7 the navigator could not find: 3431's silver paying the leader's fee, on 3431's hover.
#[test]
fn the_sharers_silver_paying_an_outsiders_upkeep_is_a_line_on_the_payer() {
    let review = review(2, true);
    let lent: Vec<(i64, Option<&str>)> = forecast(&review, "3431")
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::LentForUpkeep)
        .map(|change| (change.amount, change.other.as_deref()))
        .collect();
    assert!(
        lent.contains(&(-7, Some("Centurion Aimfram (4216)"))),
        "{lent:?}"
    );
}
