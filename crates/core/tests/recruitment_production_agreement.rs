//! Every production surface, held to the one settled recruitment (`ah-40c9`).
//!
//! `rules/sequenceofevents` resolves `BUY` in the market phase, before the month-long `PRODUCE`
//! that follows it, and `rules/buy` says a recruit dilutes the unit's skills - `rules/tableraces`
//! says a merge averages skill points rather than levels. Eight orcs with weaponsmith 1 (30
//! points) that buy eight more orcs average to 15 points, which `data/WEAP` and the ruleset's own
//! level table read back as level 0: the unit that could make eight swords a month ago can now
//! make none. Before this bead the Problems list, the SILVER forecast and the unit preview each
//! settled that recruitment on their own timeline and could disagree about it - `swor` credited
//! zero, eight and sixteen on the same row for the same order.
//!
//! One raw report and one script feed all four surfaces below - Problems, `UnitSilver.produced`,
//! the projected inventory, and the projected men/skill points - across full, partial and failed
//! recruitment, so a future divergence between any two of them fails here rather than showing up
//! as a mismatched hover.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// Eight orc weaponsmiths with sixteen iron, a recruit market selling orcs at $10, and `silver`
/// silver on hand - the only thing that varies between the failed case and the other two.
///
/// The men must be the *first* item on the unit's line: `count_men`
/// (`crates/core/src/report/unit.rs`) reads the headcount off `items.first()`.
fn report(silver: i64, market_amount: i64) -> String {
    let held = if silver > 0 {
        format!(", {silver} silver [SILV]")
    } else {
        String::new()
    };
    [
        "Atlantis Report For:".to_string(),
        "The Smiths (1)".to_string(),
        "February, Year 1".to_string(),
        "".to_string(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        "------------------------------------------------------------".to_string(),
        "  Wages: $13.5 (Max: $633).".to_string(),
        "  Wanted: none.".to_string(),
        format!(
            "  For Sale: {}.",
            if market_amount == 0 {
                "none".to_string()
            } else {
                format!("{market_amount} orcs [ORC] at $10")
            }
        ),
        "  Entertainment available: $85.".to_string(),
        "  Products: none.".to_string(),
        "".to_string(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        "".to_string(),
        format!(
            "* Smiths (900), The Smiths (1), behind, 8 orcs [ORC], 16 iron [IRON]{held}. \
             Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30)."
        ),
        "".to_string(),
    ]
    .join("\n")
}

const ORDERS: &str = "unit 900\nBUY 8 ORC\nPRODUCE SWOR\n";

/// Every surface's answer for one case, gathered from the same report and orders.
struct Surfaces {
    men: i64,
    weaponsmith_points: u32,
    produce_without_skill: bool,
    silver_produced: i64,
    preview_swor: i64,
}

fn surfaces_for(silver: i64, market_amount: i64) -> Surfaces {
    let text = report(silver, market_amount);

    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());
    let review = review_turn(&parsed, ORDERS, Some(&ruleset()), CheckOptions::default());

    let produce_without_skill = review.findings.iter().any(|finding| {
        finding.unit_id.as_deref() == Some("900")
            && finding.code.as_str() == "produce-without-skill"
    });
    let silver_produced = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .map_or(0, |silver| silver.produced);

    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &format!(
            "{}\n{ORDERS}",
            atlantis_hud_core::report::orders::extract_orders_template(&text)
                .map(|template| template.text)
                .unwrap_or_default()
        ),
    )
    .expect("the ruleset loads");

    let unit = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
        .expect("unit 900 is in the preview");

    let men = unit.unit.men;
    let weaponsmith_points = unit
        .unit
        .skills
        .iter()
        .find(|skill| skill.tag == "WEAP")
        .map_or(0, |skill| skill.points);
    let preview_swor = unit
        .produced
        .iter()
        .filter(|produced| produced.tag == "SWOR")
        .map(|produced| produced.amount)
        .sum();

    Surfaces {
        men,
        weaponsmith_points,
        produce_without_skill,
        silver_produced,
        preview_swor,
    }
}

/// `(silver, market_amount, (men, weaponsmith_points, produce_without_skill, swords))` for one
/// table row.
type Case = (i64, i64, (i64, u32, bool, i64));

/// Full, partial and failed recruitment, pinned against the bead's own table: `(men, points,
/// warning?, swords)`. All four cases must agree across every surface, including the two SWOR
/// assertions, which read the same expected count because the report starts with no swords.
///
/// Both limits on a bounded `BUY` are real and both are pinned here: the market line, and - since
/// `ah-omn7` - the unit's silver. `rules/buy`: *"If the unit can't afford as many as [quantity],
/// it will attempt to buy as many as it can."*
#[test]
fn full_partial_and_failed_recruitment_leave_every_production_surface_in_agreement() {
    let cases: [Case; 4] = [
        // Full recruitment: 80 silver buys all 8 wanted orcs at $10 each, from a market with 8 for
        // sale. (8*30 + 8*0)/16 = 15 points, level 0 - no weaponsmith left to produce with.
        (80, 8, (16, 15, true, 0)),
        // Partial recruitment: the market has only 4 to sell, so 4 arrive despite the silver for
        // 8. (8*30 + 4*0)/12 = 20 points, still level 0.
        (80, 4, (12, 20, true, 0)),
        // Silver is what binds, with stock to spare: 40 pays for 4 of the 8 orcs the market has.
        // The same 12 men and 20 points as the row above, reached the other way round.
        (40, 8, (12, 20, true, 0)),
        // Nothing is affordable, so no recruit arrives and the original level 1 (30 points)
        // survives to produce all 8 swords.
        (0, 8, (8, 30, false, 8)),
    ];

    for (silver, market_amount, (men, points, warning, swords)) in cases {
        let surfaces = surfaces_for(silver, market_amount);

        assert_eq!(
            surfaces.men, men,
            "projected men for silver={silver} market={market_amount}"
        );
        assert_eq!(
            surfaces.weaponsmith_points, points,
            "projected weaponsmith points for silver={silver} market={market_amount}"
        );
        assert_eq!(
            surfaces.produce_without_skill, warning,
            "produce-without-skill for silver={silver} market={market_amount}"
        );
        assert_eq!(
            surfaces.silver_produced, swords,
            "SILVER column's produced swords for silver={silver} market={market_amount}"
        );
        assert_eq!(
            surfaces.preview_swor, swords,
            "unit preview's produced swords for silver={silver} market={market_amount}"
        );
    }
}

/// A raw-report fixture for `ah-4a13`'s own regression: a same-race `GIVE` out and `BUY` back that
/// leaves the net headcount unchanged, which is exactly the case `Ledger::balance` cannot tell
/// apart from "nothing happened" - only `Ledger::bought` can.
///
/// Unit 900 gives one of its two orcs to unit 901 and immediately recruits one back, so its
/// headcount never moves even though a fresh, unskilled recruit did arrive and must still dilute
/// its weaponsmith.
fn give_then_recruit_report() -> String {
    [
        "Atlantis Report For:".to_string(),
        "The Smiths (1)".to_string(),
        "February, Year 1".to_string(),
        "".to_string(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        "------------------------------------------------------------".to_string(),
        "  Wages: $13.5 (Max: $633).".to_string(),
        "  Wanted: none.".to_string(),
        "  For Sale: 1 orc [ORC] at $10.".to_string(),
        "  Entertainment available: $85.".to_string(),
        "  Products: none.".to_string(),
        "".to_string(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        "".to_string(),
        "* Smiths (900), The Smiths (1), behind, 2 orcs [ORC], 100 iron [IRON], 100 silver \
         [SILV]. Weight: 45. Capacity: 0/0/30/0. Skills: weaponsmith [WEAP] 3 (180)."
            .to_string(),
        "* Recipients (901), The Smiths (1), behind, 1 orc [ORC]. Weight: 15. \
         Capacity: 0/0/15/0."
            .to_string(),
        "".to_string(),
    ]
    .join("\n")
}

const GIVE_THEN_RECRUIT_ORDERS: &str = "unit 900\nGIVE 901 1 ORC\nBUY 1 ORC\nPRODUCE SWOR\n";

#[test]
fn give_then_recruit_keeps_problems_and_preview_skill_dilution_in_agreement() {
    let text = give_then_recruit_report();

    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());
    let review = review_turn(
        &parsed,
        GIVE_THEN_RECRUIT_ORDERS,
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let arrivals: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| {
            finding.unit_id.as_deref() == Some("900")
                && finding.code.as_str() == "arrivals-lower-a-skill"
        })
        .collect();
    assert_eq!(arrivals.len(), 1, "{:?}", review.findings);
    assert_eq!(
        arrivals[0].message,
        "buying 1 man into this unit lowers its weaponsmith from 3 to 2"
    );

    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &format!(
            "{}\n{GIVE_THEN_RECRUIT_ORDERS}",
            atlantis_hud_core::report::orders::extract_orders_template(&text)
                .map(|template| template.text)
                .unwrap_or_default()
        ),
    )
    .expect("the ruleset loads");

    let unit = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
        .expect("unit 900 is in the preview");

    assert_eq!(
        unit.unit.men, 2,
        "the GIVE out and the BUY back leave the headcount exactly where it started"
    );
    let weaponsmith_points = unit
        .unit
        .skills
        .iter()
        .find(|skill| skill.tag == "WEAP")
        .map_or(0, |skill| skill.points);
    assert_eq!(
        weaponsmith_points, 90,
        "the recruit still dilutes weaponsmith even though the headcount did not move"
    );

    let preview_swor: i64 = unit
        .produced
        .iter()
        .filter(|produced| produced.tag == "SWOR")
        .map(|produced| produced.amount)
        .sum();
    let silver_produced = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .map_or(0, |silver| silver.produced);
    assert_eq!(
        preview_swor, silver_produced,
        "the unit preview and the SILVER column must still agree on the produced sword count"
    );
}
