//! The case `ah-ywyf` was filed from: plain (36,44), Lonthax, of faction 21's turn 24, where
//! Drones (7880) - 10 goblins at shipbuilding 3, sharing, holding no wood - writes
//! `BUILD LONGSHIP`, and Unit (8333), sharing too, holds the wood.
//!
//! `rules/build`: "BUILD given with an [object type] (such as "Tower" or "Galleon") instructs the
//! unit to begin work on a new object of the type given." `data/shipbuilding` 1: a Longship is
//! built "from 10 wood [WOOD]". The engine's `ShipConstruction` (`../Atlantis/monthorders.cpp`)
//! caps the 30 units of work the men could do at the 10 the ship needs and draws the wood with
//! `GetSharedNum`/`ConsumeShared`; `CreateShip` then makes the finished ship a fleet of its own
//! with the builder aboard (`rules/economy_ships`: ships "when completed are placed in fleets").

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, NewShipOutcome, OrdersPreviewResponse,
};

mod common;
use common::expect_preview_row;

fn preview(orders: &str) -> (String, OrdersPreviewResponse) {
    let report = atlantis_hud_fixtures::G5_F21_T24.text.to_string();
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report,
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    (report, response)
}

fn wood(unit: &atlantis_hud_core::orders::effects::UnitPreview) -> i64 {
    unit.unit
        .items
        .iter()
        .filter(|item| item.tag == "WOOD")
        .map(|item| item.amount)
        .sum()
}

#[test]
fn drones_finish_a_longship_on_the_sharers_wood() {
    let (report, response) = preview("unit 7880\nBUILD LONGSHIP\n");

    let drones = expect_preview_row(&report, &response, "7880");
    let sharer = expect_preview_row(&report, &response, "8333");
    assert!(drones.uncounted.is_empty(), "{:?}", drones.uncounted);
    assert_eq!(
        drones
            .new_ship
            .as_ref()
            .map(|ship| (ship.name.as_str(), ship.outcome)),
        Some(("Longship", NewShipOutcome::NewFleet))
    );
    assert_eq!(drones.built.len(), 1, "{:?}", drones.built);
    assert_eq!((drones.built[0].amount, drones.built[0].could_do), (10, 30));
    let lent: i64 = sharer
        .item_changes
        .iter()
        .filter(|change| change.tag == "WOOD")
        .map(|change| change.delta)
        .sum();
    assert_eq!(lent, -10, "{:?}", sharer.item_changes);
    assert!(wood(sharer) > 0);
}
