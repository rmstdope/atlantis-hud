//! ENTERTAIN by a unit without the entertainment skill earns nothing and loses the month (`ah-sej1`).
//!
//! The engine runs ENTERTAIN as a `PRODUCE` of silver by the entertainment skill: parseorders.cpp
//! `ProcessEntertainOrder` sets `o->skill = S_ENTERTAINMENT`. Silver's production level is 0
//! (`gamedata.cpp`), so `Game::ValidProd` (../Atlantis `monthorders.cpp`) refuses nothing and pays
//! `men * level`, where the level is `Unit::GetSkill(S_ENTERTAINMENT)`: the `entertainment`
//! attribute, the larger of ENTE and five times PHEN (`unit.cpp`, `gamedata.cpp`). A unit with
//! neither earns 0, and since its month order exists it is not set to work: the month is lost.
//! `rules/entertain`: "Spend the month entertaining the populace to earn money."
//!
//! `mountain (7,53)` of the committed turn 72 holds Seven of Eight (18642), with manipulation,
//! stealth and observation and no entertainment, beside foreign player units
//! (`tests/fixtures/reports/neworigins-3.0.0-g7-f95-t72.rep:7161`).

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

fn review_under(orders: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G7_F95_T72.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
}

fn orders_for_18642(body: &str) -> String {
    format!("#atlantis 95 \"<password>\"\n\nunit 18642\n{body}\n")
}

fn messages_for<'a>(review: &'a TurnReview, unit_id: &str, code: &str) -> Vec<&'a str> {
    review
        .findings
        .iter()
        .filter(|finding| {
            finding.unit_id.as_deref() == Some(unit_id) && finding.code.as_str() == code
        })
        .map(|finding| finding.message.as_str())
        .collect()
}

#[test]
fn an_unskilled_entertainer_is_warned_that_it_lacks_the_skill() {
    let review = review_under(&orders_for_18642("@STUDY OBSE\nENTERTAIN"));
    assert_eq!(
        messages_for(&review, "18642", "produce-without-skill"),
        ["cannot entertain: needs entertainment 1, has no entertainment"],
    );
}

#[test]
fn an_unskilled_entertainers_silver_does_not_suggest_it_will_be_paid() {
    let review = review_under(&orders_for_18642("@STUDY OBSE\nENTERTAIN"));
    let silver = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "18642")
        .expect("Seven of Eight should have a forecast");
    assert_eq!(silver.late_income, Some(0), "it earns nothing entertaining");
    assert!(
        !silver.late_income_foreign_sharer,
        "a unit that draws nothing from the pool has no share a foreign unit could shrink"
    );
}
