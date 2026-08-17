//! Finds every trade worth making across the map a faction has seen.
//!
//! Every region block a report prints carries what the hex sells and what it wants, with prices
//! and quantities. Finding a hex selling a good another will pay more for is arithmetic over data
//! already parsed - and until now it was done by eye, across turns, by remembering where things
//! were cheap.
//!
//! This is the core half: it answers *what trades are there*, and shows nobody. `ah-1j5.2` puts a
//! counted `Trade` chip in the header and lists the answer.
//!
//! Both halves of every pair come from the known map ([`crate::known_map::resolve_known_map`]), not
//! the current report alone: a single turn's report almost never contains a route at all, and the
//! known map is where the answer lives.

use serde::{Deserialize, Serialize};

use crate::cache::ReportCache;
use crate::known_map::{resolve_known_map, KnownMapHex};
use crate::movement::graph::{MapKnowledge, RememberedRegion};
use crate::movement::plan::route_for_mode;
use crate::movement::rules::{MovementMode, Ruleset};
use crate::report::model::{Coordinate, MarketItem};
use crate::report::ParsedReport;

/// One good worth carrying from one hex to another.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradedGood {
    /// The item's tag, as both markets name it.
    pub tag: String,
    /// The seller's own spelling, which is what the region panel shows.
    pub name: String,
    pub buy_price: i64,
    pub sell_price: i64,
    /// The smaller of what the seller has and what the buyer will take.
    pub quantity: i64,
    /// `sell_price - buy_price`, per unit.
    pub margin: i64,
    /// The turn each half was last seen in, so a rumour can say so. `None` only when the report
    /// carries no turn number at all.
    pub buy_seen_turn: Option<u32>,
    pub sell_seen_turn: Option<u32>,
}

/// How long the journey takes, in months, for each way of travelling. `None` where the known map
/// offers that mode no route at all - water for a walker, or a gap in what has been seen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelTurns {
    pub walk: Option<u32>,
    pub ride: Option<u32>,
    pub fly: Option<u32>,
}

/// A pair of hexes worth trading between, and everything worth carrying either way.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeRoute {
    /// Where the journey starts: the hex whose outbound leg is worth at least as much as the
    /// other way (a tie keeps the lower-indexed hex, for a stable answer).
    pub from: Coordinate,
    pub to: Coordinate,
    /// Goods bought at `from` and sold at `to`. Never empty.
    pub outbound: Vec<TradedGood>,
    /// Goods bought at `to` and sold at `from`. Empty unless the way back also pays, which is what
    /// makes this a circuit rather than a one-way trip.
    pub inbound: Vec<TradedGood>,
    /// Silver earned running the whole thing once: every good on both legs, quantity times margin.
    pub worth: i64,
    pub turns: TravelTurns,
}

/// Every trade worth making in the map the faction has seen, best first.
///
/// Both halves of every pair come from the known map, so a price seen forty turns ago is included
/// and says so through `buy_seen_turn`/`sell_seen_turn`. Nothing here judges whether a unit could
/// carry the goods: `quantity` is what the market allows, and the weight of it is the player's
/// problem.
#[must_use]
pub fn trade_routes(
    report: &ParsedReport,
    remembered: &[RememberedRegion],
    ruleset: &Ruleset,
) -> Vec<TradeRoute> {
    let known = resolve_known_map(report, remembered);
    let markets: Vec<&KnownMapHex> = known
        .hexes
        .iter()
        .filter(|hex| hex.region.is_some())
        .collect();

    // Every ordered pair that carries at least one good worth carrying, keyed by index into
    // `markets` so the fold below can compare a pair against its reverse without re-deriving keys.
    let mut goods_by_pair: std::collections::BTreeMap<(usize, usize), Vec<TradedGood>> =
        std::collections::BTreeMap::new();
    for (i, seller) in markets.iter().enumerate() {
        for (j, buyer) in markets.iter().enumerate() {
            if i == j {
                continue;
            }
            let goods = goods_between(seller, buyer);
            if !goods.is_empty() {
                goods_by_pair.insert((i, j), goods);
            }
        }
    }

    // Route searches are the expensive part, so they run once per folded pair below - never per
    // good, and never for a pair that turned out to carry nothing.
    let map = MapKnowledge::from_remembered(report, remembered);

    let mut routes = Vec::new();
    for i in 0..markets.len() {
        for j in (i + 1)..markets.len() {
            let forward = goods_by_pair.get(&(i, j));
            let backward = goods_by_pair.get(&(j, i));
            if forward.is_none() && backward.is_none() {
                continue;
            }

            let forward_worth = worth_of(forward);
            let backward_worth = worth_of(backward);

            let (from_hex, to_hex, outbound, inbound) = if forward_worth >= backward_worth {
                (
                    markets[i],
                    markets[j],
                    forward.cloned().unwrap_or_default(),
                    backward.cloned().unwrap_or_default(),
                )
            } else {
                (
                    markets[j],
                    markets[i],
                    backward.cloned().unwrap_or_default(),
                    forward.cloned().unwrap_or_default(),
                )
            };

            routes.push(TradeRoute {
                from: from_hex.coordinate,
                to: to_hex.coordinate,
                outbound,
                inbound,
                worth: forward_worth + backward_worth,
                turns: travel_turns(&map, ruleset, from_hex.coordinate, to_hex.coordinate),
            });
        }
    }

    routes.sort_by(|a, b| {
        b.worth
            .cmp(&a.worth)
            .then_with(|| a.from.id().cmp(&b.from.id()))
            .then_with(|| a.to.id().cmp(&b.to.id()))
    });
    routes
}

/// Silver earned by carrying every good in one direction, once.
fn worth_of(goods: Option<&Vec<TradedGood>>) -> i64 {
    goods
        .map(|goods| goods.iter().map(|good| good.quantity * good.margin).sum())
        .unwrap_or(0)
}

/// Every good worth carrying from `seller` to `buyer`.
///
/// A hex with no market (`region: None`) sells and wants nothing, so it contributes no goods
/// either way - the guard is implicit in the empty `for_sale`/`wanted` lists a `None` region can
/// never carry.
fn goods_between(seller: &KnownMapHex, buyer: &KnownMapHex) -> Vec<TradedGood> {
    let Some(seller_region) = &seller.region else {
        return Vec::new();
    };
    let Some(buyer_region) = &buyer.region else {
        return Vec::new();
    };

    let mut goods = Vec::new();
    for sale in &seller_region.for_sale {
        for want in &buyer_region.wanted {
            if !sale.tag.eq_ignore_ascii_case(&want.tag) {
                continue;
            }
            if want.price <= sale.price {
                continue;
            }
            let quantity = sale.amount.min(want.amount);
            if quantity <= 0 {
                continue;
            }
            goods.push(traded_good(sale, want, quantity, seller, buyer));
        }
    }
    goods
}

fn traded_good(
    sale: &MarketItem,
    want: &MarketItem,
    quantity: i64,
    seller: &KnownMapHex,
    buyer: &KnownMapHex,
) -> TradedGood {
    TradedGood {
        tag: sale.tag.clone(),
        name: sale.name.clone(),
        buy_price: sale.price,
        sell_price: want.price,
        quantity,
        margin: want.price - sale.price,
        buy_seen_turn: seller.last_seen_turn,
        sell_seen_turn: buyer.last_seen_turn,
    }
}

/// How long the journey between two hexes takes, once for each mode a trader might use.
///
/// `Sail` is deliberately not among them: a fleet's journey is a different question with a
/// different origin, and the navigator asked for three numbers, not four.
fn travel_turns(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    from: Coordinate,
    to: Coordinate,
) -> TravelTurns {
    TravelTurns {
        walk: months_for(map, ruleset, MovementMode::Walk, from, to),
        ride: months_for(map, ruleset, MovementMode::Ride, from, to),
        fly: months_for(map, ruleset, MovementMode::Fly, from, to),
    }
}

fn months_for(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    from: Coordinate,
    to: Coordinate,
) -> Option<u32> {
    let points_per_month = ruleset.movement_points(mode);
    route_for_mode(map, ruleset, mode, points_per_month, from, to)
        .ok()
        .map(|(_steps, months)| months.len() as u32)
}

/// The same as [`trade_routes`], reading the ruleset, the report and the remembered regions from
/// their wire forms - the entry the wasm and Tauri adapters both call, exactly as
/// [`crate::movement::request::plan_for_remembered_report`] does for a route.
///
/// # Errors
///
/// Returns an error only when the ruleset cannot be used or the remembered regions cannot be read.
/// A report with nothing to trade is a successful answer carrying an empty list, not a failure.
pub fn trade_routes_json(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
) -> Result<Vec<TradeRoute>, String> {
    let ruleset = cache
        .ruleset(ruleset_json)
        .map_err(|error| error.to_string())?;
    let remembered: Vec<RememberedRegion> = serde_json::from_str(remembered_json)
        .map_err(|error| format!("remembered regions could not be read: {error}"))?;

    let report = cache.classified(raw_report, ruleset_json);
    Ok(trade_routes(&report, &remembered, &ruleset))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::{Exit, ReportRegion};

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset loads")
    }

    fn coordinate(x: i32, y: i32) -> Coordinate {
        Coordinate { x, y, z: 1 }
    }

    /// A hex with a market, linked to nothing - most tests here care only about the market
    /// arithmetic, not about pathing.
    fn market_hex(
        x: i32,
        y: i32,
        for_sale: Vec<MarketItem>,
        wanted: Vec<MarketItem>,
    ) -> ReportRegion {
        let here = coordinate(x, y);
        ReportRegion {
            region_id: here.id(),
            coordinate: here,
            terrain: "plain".to_string(),
            province: "Nowhere".to_string(),
            for_sale,
            wanted,
            ..Default::default()
        }
    }

    fn item(tag: &str, name: &str, amount: i64, price: i64) -> MarketItem {
        MarketItem {
            amount,
            name: name.to_string(),
            tag: tag.to_string(),
            price,
        }
    }

    fn report_of(regions: Vec<ReportRegion>) -> ParsedReport {
        ParsedReport {
            regions,
            ..Default::default()
        }
    }

    /// Links two regions with an exit each way, so [`MapKnowledge`] can find a path between them.
    /// `forward`/`backward` are the direction a report would print, e.g. `"Southeast"` /
    /// `"Northwest"`.
    fn link(a: &mut ReportRegion, forward: &str, b: &mut ReportRegion, backward: &str) {
        a.exits.push(Exit {
            direction: forward.to_string(),
            terrain: b.terrain.clone(),
            coordinate: b.coordinate,
            province: b.province.clone(),
            settlement: None,
        });
        b.exits.push(Exit {
            direction: backward.to_string(),
            terrain: a.terrain.clone(),
            coordinate: a.coordinate,
            province: a.province.clone(),
            settlement: None,
        });
    }

    #[test]
    fn a_hex_selling_cheap_and_one_paying_more_is_a_route() {
        let seller = market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new());
        let buyer = market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 15, 300)]);
        let report = report_of(vec![seller, buyer]);

        let routes = trade_routes(&report, &[], &ruleset());

        assert_eq!(routes.len(), 1);
        let route = &routes[0];
        assert_eq!(route.outbound.len(), 1);
        let good = &route.outbound[0];
        assert_eq!(good.quantity, 15);
        assert_eq!(good.margin, 240);
        assert_eq!(route.worth, 3600);
    }

    #[test]
    fn quantity_is_the_smaller_of_the_two_sides() {
        let seller = market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new());
        let buyer = market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 15, 300)]);
        let report = report_of(vec![seller, buyer]);
        let routes = trade_routes(&report, &[], &ruleset());
        assert_eq!(
            routes[0].outbound[0].quantity, 15,
            "buyer wants fewer than the seller has"
        );

        let seller = market_hex(1, 1, vec![item("SILK", "silk", 5, 60)], Vec::new());
        let buyer = market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 15, 300)]);
        let report = report_of(vec![seller, buyer]);
        let routes = trade_routes(&report, &[], &ruleset());
        assert_eq!(
            routes[0].outbound[0].quantity, 5,
            "seller has fewer than the buyer wants"
        );
    }

    #[test]
    fn a_pair_that_does_not_pay_is_not_a_route() {
        let equal = report_of(vec![
            market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new()),
            market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 15, 60)]),
        ]);
        assert!(
            trade_routes(&equal, &[], &ruleset()).is_empty(),
            "equal prices pay nothing"
        );

        let losing = report_of(vec![
            market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new()),
            market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 15, 40)]),
        ]);
        assert!(
            trade_routes(&losing, &[], &ruleset()).is_empty(),
            "a buyer paying less loses money"
        );
    }

    #[test]
    fn a_hex_does_not_trade_with_itself() {
        let region = market_hex(
            1,
            1,
            vec![item("SILK", "silk", 20, 60)],
            vec![item("SILK", "silk", 20, 300)],
        );
        let report = report_of(vec![region]);
        assert!(trade_routes(&report, &[], &ruleset()).is_empty());
    }

    #[test]
    fn a_hex_with_no_market_is_skipped() {
        // Named only by an exit: no region at all, so no market.
        let mut seller = market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new());
        seller.exits.push(Exit {
            direction: "Southeast".to_string(),
            terrain: "plain".to_string(),
            coordinate: coordinate(2, 2),
            province: "Nowhere".to_string(),
            settlement: None,
        });
        // A region with an empty market, wanting nothing.
        let empty = market_hex(3, 3, Vec::new(), Vec::new());
        let report = report_of(vec![seller, empty]);
        assert!(trade_routes(&report, &[], &ruleset()).is_empty());
    }

    #[test]
    fn several_goods_between_one_pair_are_one_route() {
        let seller = market_hex(
            1,
            1,
            vec![item("SILK", "silk", 20, 60), item("GRAI", "grain", 30, 10)],
            Vec::new(),
        );
        let buyer = market_hex(
            2,
            2,
            Vec::new(),
            vec![item("SILK", "silk", 15, 300), item("GRAI", "grain", 30, 20)],
        );
        let report = report_of(vec![seller, buyer]);

        let routes = trade_routes(&report, &[], &ruleset());
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].outbound.len(), 2);
        assert_eq!(routes[0].worth, 15 * 240 + 30 * 10);
    }

    #[test]
    fn a_remembered_market_is_used_and_dated() {
        let seller = market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new());
        let buyer = market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 15, 300)]);
        let mut report = report_of(vec![buyer]);
        report.header.turn_number = Some(82);
        let remembered = vec![RememberedRegion {
            region: seller,
            last_seen_turn: 42,
        }];

        let routes = trade_routes(&report, &remembered, &ruleset());
        assert_eq!(routes.len(), 1);
        let good = &routes[0].outbound[0];
        assert_eq!(good.buy_seen_turn, Some(42));
        assert_eq!(good.sell_seen_turn, Some(82));
    }

    #[test]
    fn a_pair_that_pays_both_ways_is_one_circuit() {
        let a = market_hex(
            1,
            1,
            vec![item("SILK", "silk", 20, 60)],
            vec![item("GRAI", "grain", 30, 300)],
        );
        let b = market_hex(
            2,
            2,
            vec![item("GRAI", "grain", 30, 10)],
            vec![item("SILK", "silk", 15, 300)],
        );
        let report = report_of(vec![a, b]);

        let routes = trade_routes(&report, &[], &ruleset());
        assert_eq!(routes.len(), 1, "one circuit, not two one-way routes");
        let route = &routes[0];
        assert!(!route.inbound.is_empty());
        // outbound: silk 15 * 240 = 3600 (the richer leg, from b to a)
        // inbound: grain 30 * 290 = 8700
        assert_eq!(route.worth, 15 * 240 + 30 * 290);
        assert_eq!(route.from, coordinate(2, 2));
        assert_eq!(route.to, coordinate(1, 1));
    }

    #[test]
    fn the_ranking_is_stable() {
        // Two pairs of equal worth, on different tags so neither also trades across the pairs:
        // (1,1)/(2,2) worth 100 in silk, (3,3)/(4,4) worth 100 in grain.
        let a = market_hex(1, 1, vec![item("SILK", "silk", 1, 0)], Vec::new());
        let b = market_hex(2, 2, Vec::new(), vec![item("SILK", "silk", 1, 100)]);
        let c = market_hex(3, 3, vec![item("GRAI", "grain", 1, 0)], Vec::new());
        let d = market_hex(4, 4, Vec::new(), vec![item("GRAI", "grain", 1, 100)]);
        let report = report_of(vec![a, b, c, d]);

        let first = trade_routes(&report, &[], &ruleset());
        let second = trade_routes(&report, &[], &ruleset());
        assert_eq!(
            first, second,
            "ties must resolve to the same order every time"
        );
        assert_eq!(first[0].from, coordinate(1, 1));
        assert_eq!(first[1].from, coordinate(3, 3));
    }

    #[test]
    fn the_route_says_how_long_it_takes_each_way() {
        // A corridor of four mountains: flying is untroubled by them, walking is not.
        let mut hexes: Vec<ReportRegion> = (0..5)
            .map(|index| {
                let terrain = if index == 0 { "plain" } else { "mountain" };
                let mut region = market_hex(1 + index, 1 + index, Vec::new(), Vec::new());
                region.terrain = terrain.to_string();
                region
            })
            .collect();
        for index in 0..hexes.len() - 1 {
            let (before, after) = hexes.split_at_mut(index + 1);
            link(&mut before[index], "Southeast", &mut after[0], "Northwest");
        }
        // Give the two ends something to trade so a route exists at all.
        hexes[0].for_sale.push(item("SILK", "silk", 20, 60));
        hexes[4].wanted.push(item("SILK", "silk", 15, 300));
        let report = report_of(hexes);

        let routes = trade_routes(&report, &[], &ruleset());
        assert_eq!(routes.len(), 1);
        let turns = routes[0].turns;
        assert!(turns.walk.is_some());
        assert!(turns.fly.is_some());
        assert!(
            turns.fly.unwrap() < turns.walk.unwrap(),
            "a flier is untroubled by mountains"
        );
    }

    #[test]
    fn a_mode_with_no_route_says_so() {
        // Land, then ocean, then land: a walker cannot cross the ocean hex in between, a flier can.
        let mut near = market_hex(1, 1, vec![item("SILK", "silk", 20, 60)], Vec::new());
        let mut ocean = market_hex(2, 2, Vec::new(), Vec::new());
        ocean.terrain = "ocean".to_string();
        let mut far = market_hex(3, 3, Vec::new(), vec![item("SILK", "silk", 15, 300)]);
        link(&mut near, "Southeast", &mut ocean, "Northwest");
        link(&mut ocean, "Southeast", &mut far, "Northwest");
        let report = report_of(vec![near, ocean, far]);

        let routes = trade_routes(&report, &[], &ruleset());
        assert_eq!(routes.len(), 1);
        let turns = routes[0].turns;
        assert_eq!(
            turns.walk, None,
            "the ocean hex between them blocks a walker"
        );
        assert!(turns.fly.is_some(), "a flier is untroubled by water");
    }

    #[test]
    fn the_whole_known_map_answers() {
        let current: ParsedReport =
            crate::report::parse_report_full(atlantis_hud_fixtures::G3_F42_T82.text);
        let remembered_report =
            crate::report::parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
        let remembered: Vec<RememberedRegion> = remembered_report
            .regions
            .into_iter()
            .map(|region| RememberedRegion {
                region,
                last_seen_turn: 42,
            })
            .collect();

        let routes = trade_routes(&current, &remembered, &ruleset());

        let worths: Vec<i64> = routes.iter().map(|route| route.worth).collect();
        assert_eq!(
            worths,
            vec![15_598, 10_209, 5_868, 5_103, 4_066, 1_105],
            "six routes, ranked by worth, as measured from the committed fixtures"
        );

        let circuit = routes
            .iter()
            .find(|route| route.worth == 15_598)
            .expect("the reciprocal pair");
        assert!(
            !circuit.inbound.is_empty(),
            "the best route is the reciprocal circuit"
        );
    }
}
