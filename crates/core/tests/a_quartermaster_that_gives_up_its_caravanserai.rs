//! A quartermaster that stops owning its Caravanserai this month neither receives nor distributes
//! (`ah-1jl9`).
//!
//! `rules/transport`: "The target ... must be the owner of a transport structure", and the engine
//! asks that question last of all: `../Atlantis/runorders.cpp` `RunOrders` runs ENTER/LEAVE, then
//! PROMOTE/EVICT, then movement, and only then `CheckTransportOrders` ("TRANSPORT: Target ... does
//! not own a transport structure", "DISTRIBUTE: Unit does not own transport structure."). The
//! owner is the first unit in the object's list (`Object::GetOwner`), which `Unit::MoveUnit`
//! changes whenever a unit leaves or enters, and `Do1PromoteOrder` whenever the owner promotes.
//! Both surfaces judged the target from the report's owner instead, so a quartermaster that left,
//! walked away or handed its Caravanserai over still took the shipment in and still sent its
//! DISTRIBUTEs out.
//!
//! Mountain (36,4) of the committed turn 42: Trader (6857, quartermaster 5) is alone in
//! `Building [6] : Caravanserai` (`neworigins-3.0.0-g3-f42-t42.rep:1574`), holding no silver, and
//! Ivanhoe (683) holds 2890.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, shipment_measures, OrdersPreviewResponse,
    TransportTargetReason, UnitPreview,
};
use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::{ruleset, without_standing_month_orders};

const TRADER: &str = "6857";
const IVANHOE: &str = "683";
const REBECCA: &str = "1163";

const SHIPMENT: &str = "TRANSPORT 6857 1000 SILV\n";
const DISTRIBUTES: &str = "DISTRIBUTE 1162 500 SILV\nDISTRIBUTE 12127 100 SILV\n";

/// The turn's own orders with Ivanhoe giving the Trader 600 silver and shipping it 1000 more, the
/// Trader distributing and doing `trader` besides, and `others` written into the named blocks.
/// `rules/sequenceofevents` runs GIVE long before TRANSPORT, so the Trader holds the 600 its
/// DISTRIBUTEs name whoever owns the Caravanserai.
fn orders(trader: &str, others: &[(&str, &str)]) -> String {
    let template = extract_orders_template(atlantis_hud_fixtures::G3_F42_T42.text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    // The Trader's own `@study mani` would replace a MOVE as its month-long order.
    // Rebecca's too, for the case where she studies.
    let mut orders = without_standing_month_orders(&template, &[TRADER, REBECCA]);
    let mut blocks = vec![
        (TRADER, format!("{trader}\n{DISTRIBUTES}")),
        (IVANHOE, format!("GIVE 6857 600 SILV\n{SHIPMENT}")),
    ];
    blocks.extend(
        others
            .iter()
            .map(|(unit, line)| (*unit, format!("{line}\n"))),
    );
    for (unit, lines) in blocks {
        let header = format!("\nunit {unit}\n");
        assert_eq!(orders.matches(&header).count(), 1, "{header:?} once");
        orders = orders.replace(&header, &format!("{header}{lines}"));
    }
    orders
}

fn preview(orders: &str) -> OrdersPreviewResponse {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        atlantis_hud_fixtures::G3_F42_T42.text,
        "[]",
        orders,
    )
    .expect("the ruleset loads")
}

/// Every row `unit_id` has - a walker has a departing and an arriving one.
fn rows<'a>(response: &'a OrdersPreviewResponse, unit_id: &str) -> Vec<&'a UnitPreview> {
    let rows: Vec<_> = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|row| row.unit.unit_id == unit_id)
        .collect();
    assert!(!rows.is_empty(), "{unit_id} has a preview row");
    rows
}

/// The Problems panel's review, with the month end traced as the shells trace it.
fn review(orders: &str) -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let measures = shipment_measures(
        &mut ReportCache::default(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        orders,
        "",
        CheckOptions::default(),
    )
    .expect("the trace runs");
    let options = CheckOptions {
        month_end: measures.month_end,
        ..CheckOptions::default()
    };
    review_turn(&parsed, orders, Some(&ruleset), options)
}

/// The Problems panel's silver forecast for one unit.
fn silver(orders: &str, unit_id: &str) -> UnitSilver {
    review(orders)
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("{unit_id} has a forecast"))
}

/// The refusal warnings at the order lines, as (unit, message).
fn refusals(orders: &str) -> Vec<(String, String)> {
    review(orders)
        .findings
        .into_iter()
        .filter(|finding| finding.code == codes::TRANSPORT_TARGET_REFUSED)
        .map(|finding| (finding.unit_id.unwrap_or_default(), finding.message))
        .collect()
}

/// Both surfaces agree the Caravanserai is no longer the Trader's when the month ships: Ivanhoe's
/// 1000 stays with Ivanhoe, refused because the Trader owns no Caravanserai, and the Trader
/// receives nothing and distributes nothing.
fn assert_trader_no_longer_owns(orders: &str) {
    let response = preview(orders);
    for row in rows(&response, IVANHOE) {
        assert!(
            row.transport_sent.iter().all(|sent| sent.to != TRADER),
            "Ivanhoe's 1000 does not leave: {:?}",
            row.transport_sent
        );
        let refused: Vec<_> = row
            .transport_target_issues
            .iter()
            .filter(|issue| issue.to == TRADER)
            .map(|issue| (issue.amount, issue.reason))
            .collect();
        assert_eq!(
            refused,
            vec![(1000, TransportTargetReason::NotCaravanseraiOwner)],
            "Ivanhoe's TRANSPORT is refused for the Trader's ownership"
        );
    }
    for row in rows(&response, TRADER) {
        assert_eq!(
            row.transport_received,
            vec![],
            "the Trader receives nothing"
        );
        assert_eq!(row.transport_sent, vec![], "the Trader distributes nothing");
        // `CheckTransportOrders`: "DISTRIBUTE: Unit does not own transport structure." - the
        // sender's refusal, not the recipients'.
        let refused: Vec<(&str, TransportTargetReason)> = row
            .transport_target_issues
            .iter()
            .map(|issue| (issue.to.as_str(), issue.reason))
            .collect();
        assert_eq!(
            refused,
            vec![
                ("1162", TransportTargetReason::SenderOwnsNoCaravanserai),
                ("12127", TransportTargetReason::SenderOwnsNoCaravanserai),
            ],
            "each DISTRIBUTE is explained on the Trader's row"
        );
    }

    // The order lines say so: the TRANSPORT, and each DISTRIBUTE.
    let warned = refusals(orders);
    assert!(
        warned.contains(&(
            IVANHOE.to_string(),
            "Unit 6857 does not own a Caravanserai, so 1000 SILV stay with this unit.".to_string()
        )),
        "{warned:?}"
    );
    let distributes: Vec<&str> = warned
        .iter()
        .filter(|(unit, _)| unit == TRADER)
        .map(|(_, message)| message.as_str())
        .collect();
    assert_eq!(
        distributes,
        vec![
            "This unit owns no Caravanserai when the shipments run, so 500 SILV stay with this unit.",
            "This unit owns no Caravanserai when the shipments run, so 100 SILV stay with this unit.",
        ],
        "{warned:?}"
    );

    // The same month with no TRANSPORT written at all, on both silver rows.
    let unshipped = orders.replace(SHIPMENT, "");
    assert_eq!(
        silver(orders, TRADER).income,
        silver(&unshipped, TRADER).income,
        "the Trader's silver receives nothing"
    );
    assert_eq!(
        silver(orders, IVANHOE).at_month_end,
        silver(&unshipped, IVANHOE).at_month_end,
        "Ivanhoe ends the month with the 1000 it could not ship"
    );
}

#[test]
fn the_trader_that_stays_owner_receives_and_distributes() {
    let orders = orders("", &[]);
    let response = preview(&orders);
    let trader = rows(&response, TRADER);
    let received: Vec<i64> = trader[0]
        .transport_received
        .iter()
        .map(|received| received.amount)
        .collect();
    assert_eq!(received, vec![1000]);
    let sent: Vec<&str> = trader[0]
        .transport_sent
        .iter()
        .map(|sent| sent.to.as_str())
        .collect();
    assert_eq!(sent, vec!["1162", "12127"]);
    assert_eq!(
        silver(&orders, TRADER).income,
        silver(&orders.replace(SHIPMENT, ""), TRADER)
            .income
            .map(|income| income + 1000),
        "the Trader's silver receives Ivanhoe's 1000"
    );
}

#[test]
fn a_trader_that_leaves_its_caravanserai_owns_it_no_longer() {
    assert_trader_no_longer_owns(&orders("LEAVE", &[]));
}

#[test]
fn a_trader_that_walks_away_owns_it_no_longer() {
    assert_trader_no_longer_owns(&orders("MOVE N", &[]));
}

/// `rules/move`: "OUT, which will leave the structure that the unit is in" - in its own hex, in
/// the movement phase, still ahead of the shipments.
#[test]
fn a_trader_that_moves_out_owns_it_no_longer() {
    assert_trader_no_longer_owns(&orders("MOVE OUT", &[]));
}

#[test]
fn a_trader_that_promotes_a_newcomer_owns_it_no_longer() {
    assert_trader_no_longer_owns(&orders("PROMOTE 1163", &[(REBECCA, "ENTER 6")]));
}

/// A PROMOTE naming a unit that is not inside hands nothing over (`Do1PromoteOrder`: "PROMOTE:
/// Can't find target."), so the Trader still owns the Caravanserai.
#[test]
fn a_promote_of_a_unit_outside_hands_nothing_over() {
    let response = preview(&orders("PROMOTE 1163", &[]));
    let received: Vec<i64> = rows(&response, TRADER)[0]
        .transport_received
        .iter()
        .map(|received| received.amount)
        .collect();
    assert_eq!(received, vec![1000]);
}

/// A refusal the target's own month may undo is not warned about, whichever end it names: Rebecca
/// enters the Caravanserai the Trader leaves, so she owns it, and studies the quartermaster skill
/// before the shipments run (`rules/sequenceofevents`), after which she accepts from anybody within
/// the flat reach (`ah-kjjv`, `ah-1jl9`).
#[test]
fn a_shipment_the_targets_month_may_make_good_is_not_warned_about() {
    let orders = orders(
        "LEAVE\nTRANSPORT 1163 77 SILV",
        &[(REBECCA, "ENTER 6\nSTUDY QUAM")],
    );
    let warned = refusals(&orders);
    assert!(
        !warned
            .iter()
            .any(|(unit, message)| unit == TRADER && message.contains("77 SILV")),
        "{warned:?}"
    );
}

/// `ah-ry88`: a unit the Trader forms stands in the Caravanserai with it (`rules/form`: "in the
/// same structure if any"), so the Trader's `PROMOTE NEW 1` hands the Caravanserai on
/// (`rules/promote`), and once the new unit has bought a man it is still there when the shipments
/// run - `rules/world_structures`: "Only units with men in them can be structure owners". Ivanhoe
/// gives it the silver its `BUY` spends.
#[test]
fn a_trader_that_promotes_a_unit_it_forms_owns_it_no_longer() {
    assert_trader_no_longer_owns(&orders(
        "FORM 1\nBUY 1 ORC\nEND\nPROMOTE NEW 1",
        &[(IVANHOE, "GIVE NEW 1 100 SILV")],
    ));
}

/// `ah-ry88`: a formed unit that gains nobody is dissolved (`rules/form`: "If no recruits are
/// gained at all, the empty unit will be dissolved") long before the shipments run, so the
/// Caravanserai the Trader promoted it to is the Trader's again, and Ivanhoe's 1000 arrives.
#[test]
fn a_trader_that_promotes_an_empty_formed_unit_still_owns_it() {
    let orders = orders("FORM 1\nEND\nPROMOTE NEW 1", &[]);
    let response = preview(&orders);
    let received: Vec<i64> = rows(&response, TRADER)[0]
        .transport_received
        .iter()
        .map(|received| received.amount)
        .collect();
    assert_eq!(received, vec![1000]);
    assert_eq!(
        silver(&orders, TRADER).income,
        silver(&orders.replace(SHIPMENT, ""), TRADER)
            .income
            .map(|income| income + 1000),
        "the Trader's silver receives Ivanhoe's 1000"
    );
    assert!(
        !refusals(&orders).iter().any(|(unit, _)| unit == IVANHOE),
        "Ivanhoe's TRANSPORT is not warned about"
    );
}
