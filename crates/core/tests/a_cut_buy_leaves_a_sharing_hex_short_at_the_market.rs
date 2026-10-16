//! A sharing hex whose purse cut a `BUY` is short what the market could not fund, not upkeep
//! the engine pays (`ah-s8ud`).
//!
//! Found verifying `ah-6xb2` on a trimmed `newage-arcanum-f5-t84`, jungle (38,34), under Trident,
//! with 4829's `TRANSPORT 5508 ALL SILV` in. `rules/sequenceofevents` runs "Market orders" before
//! TRANSPORT, WORK and "Maintenance costs are assessed". At the market the purse holds only 4829's
//! $150 tax, so 4682's `BUY` buys one wood. After that the wages come in, and every fee is paid.
//! 3431 and 4682 cover what 4829 and the leader 4216 cannot, from "Silver from other faction units
//! in the same region" (`rules/economy_maintenance`), and the hex ends the month $2 up.
//!
//! The sentence read the month's end on balances that still carried the `BUY`'s whole ask, which
//! the market never spent. It was short $18 "of orders and upkeep", while the hovers, which follow
//! the purchase as cut, added up to $409. The navigator chose the market reading (2026-10-16): the
//! hex is short what its `BUY`s asked beyond what the purse held as they ran. That is the sentence
//! the same hex shows without the `TRANSPORT`.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;

/// The jungle hex as the report showed it, cut to our own units: three sharers with no silver,
/// and four faction-mates put on `SHARE 0` this month - two holding silver (4868, 4862), a leader
/// with none (4216), and a quartermaster in a Caravanserai for the `TRANSPORT` (5508).
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

fn review(buy: i64) -> TurnReview {
    let ruleset = common::trident_ruleset();
    let mut parsed = parse_report_full(REPORT);
    classify_units(&mut parsed, &ruleset);
    let orders = format!(
        "unit 5508\nSHARE 0\nunit 4868\nSHARE 0\nunit 4862\nSHARE 0\nunit 4216\nSHARE 0\n\
         unit 4829\nTAX\nTRANSPORT 5508 ALL SILV\nunit 4682\nBUY {buy} WOOD\n"
    );
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn forecast<'a>(review: &'a TurnReview, unit_id: &str) -> &'a UnitSilver {
    review
        .silver
        .iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("{unit_id} has a forecast"))
}

fn hex_sentence(buy: i64) -> String {
    let review = review(buy);
    let found: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.unit_id.is_none() && finding.code.as_str() == "not-enough-silver")
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(found.len(), 1, "{found:?}");
    found[0].to_string()
}

/// One wood bought of two: the purse held $150 at the market against a $162 ask.
#[test]
fn with_the_transport_in_two_wood_are_short_at_the_market() {
    assert_eq!(
        hex_sentence(2),
        "the units in this hex are short $12 between them: they can have $150 and their orders \
         spend $162"
    );
    // The ask is the one the buyer's hover names beside its cut line ("asked 162").
    assert_eq!(forecast(&review(2), "4682").wanted_for_orders, Some(162));
}

#[test]
fn and_four_wood_too() {
    assert_eq!(
        hex_sentence(4),
        "the units in this hex are short $174 between them: they can have $150 and their orders \
         spend $324"
    );
}

/// The $7 the navigator could not find at ab01c28e: 3431's silver paying the leader's fee, on
/// 3431's hover (`ah-2zku`).
#[test]
fn the_sharers_silver_paying_an_outsiders_upkeep_is_a_line_on_the_payer() {
    let review = review(2);
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
