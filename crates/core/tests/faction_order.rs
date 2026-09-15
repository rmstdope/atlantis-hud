//! `ah-7g4f`. This turn's FACTION order sets the faction type and the limits the review shows and
//! checks.
//!
//! Rules each piece rests on:
//! - `rules/faction`: FACTION assigns MARTIAL and MAGIC points; too many mages, apprentices or
//!   quartermasters for the new points make it fail.
//! - `rules/tablefactionpoints`: the limits each points value gives, per world.
//! - `rules/playing_factions`: "The faction has 5 Faction Points" (3 in Trident).
//! - `rules/sequenceofevents`: FACTION runs before TAX, PILLAGE and the month-long orders.

use atlantis_hud_core::movement::rules::{FactionPointsRow, Ruleset};
use atlantis_hud_core::orders::faction_orders::FactionSplit;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::{ruleset, trident_ruleset};

#[test]
fn the_committed_rulesets_carry_their_faction_points() {
    let origins = ruleset()
        .faction_points
        .expect("New Origins states its table");
    assert_eq!(origins.available, 5);
    assert_eq!(
        origins.table.iter().find(|row| row.points == 3),
        Some(&FactionPointsRow {
            points: 3,
            regions: 40,
            quartermasters: 9,
            mages: 4,
            apprentices: 7,
        })
    );

    let trident = trident_ruleset()
        .faction_points
        .expect("Trident states its table");
    assert_eq!(trident.available, 3);
    assert_eq!(
        trident
            .table
            .iter()
            .map(|row| row.points)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );

    let arcanum = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset loads")
        .faction_points
        .expect("Arcanum states its table");
    let row = arcanum
        .table
        .iter()
        .find(|row| row.points == 3)
        .expect("row 3");
    assert_eq!((row.regions, row.quartermasters), (56, 16));
}

/// A report header with a type line and a `Faction Status:` block, then one plain hex holding the
/// given units.
fn report(types: &str, quartermasters: &str, mages: &str, units: &[&str]) -> String {
    let mut lines: Vec<String> = [
        "Atlantis Report For:".to_string(),
        format!("Foo (1) ({types})"),
        "February, Year 1".to_string(),
        String::new(),
        "Faction Status:".to_string(),
        "Regions: 0 (10)".to_string(),
        format!("Quartermasters: {quartermasters}"),
        format!("Mages: {mages}"),
        "Apprentices: 0 (3)".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $500.".to_string(),
        "------------------------------------------------------------".to_string(),
        "  Wages: $13.5 (Max: $633).".to_string(),
        "  Wanted: none.".to_string(),
        "  For Sale: 100 grain [GRAI] at $1.".to_string(),
        "  Entertainment available: $0.".to_string(),
        "  Products: none.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (9,9) in Nowhere.".to_string(),
        String::new(),
    ]
    .to_vec();
    lines.extend(units.iter().map(ToString::to_string));
    lines.push(String::new());
    lines.join("\n")
}

fn unit(id: u32) -> String {
    format!(
        "* Student ({id}), Foo (1), behind, 1 orc [ORC]. Weight: 10. Capacity: 0/0/15/0. \
         Skills: combat [COMB] 1 (30)."
    )
}

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

fn codes(review: &TurnReview) -> Vec<&str> {
    review
        .findings
        .iter()
        .map(|finding| finding.code.as_str())
        .collect()
}

#[test]
fn a_succeeding_faction_order_raises_the_limits_the_review_uses() {
    let (first, second) = (unit(900), unit(901));
    let text = report("Martial 1, Magic 1", "2 (2)", "0 (2)", &[&first, &second]);

    let review = review_of(
        &text,
        "unit 900\nFACTION MARTIAL 3 MAGIC 1\nunit 901\nSTUDY QUAM\n",
    );
    assert!(
        !codes(&review).contains(&"too-many-quartermasters"),
        "{:?}",
        review.findings
    );
    assert_eq!(review.production.limits.pooled, Some(40));
    assert_eq!(
        review.faction.applied.map(|applied| applied.split),
        Some(FactionSplit {
            martial: 3,
            magic: 1
        })
    );

    let without = review_of(&text, "unit 901\nSTUDY QUAM\n");
    let messages: Vec<&str> = without
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "too-many-quartermasters")
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(messages.len(), 1, "{:?}", without.findings);
    assert!(
        messages[0].contains("your faction already has its 2 quartermasters"),
        "{}",
        messages[0]
    );
}

#[test]
fn a_failing_faction_order_is_warned_on_its_line_and_changes_no_limit() {
    let first = unit(900);
    let text = report("Martial 1, Magic 4", "0 (2)", "5 (5)", &[&first]);
    let script = "unit 900\nFACTION MARTIAL 3 MAGIC 2\n";
    let review = review_of(&text, script);

    let failing: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "faction-order-will-fail")
        .collect();
    assert_eq!(failing.len(), 1, "{:?}", review.findings);
    assert_eq!(
        failing[0].message,
        "FACTION will fail - the faction has 5 mages and MAGIC 2 allows 3"
    );
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let source = format!("{template}\n{script}");
    let faction_line = source
        .lines()
        .position(|line| line.starts_with("FACTION"))
        .map(|index| index + 1);
    assert_eq!(failing[0].line, faction_line);
    assert_eq!(review.production.limits.pooled, Some(10));
    assert_eq!(review.faction.applied, None);
    assert_eq!(
        review
            .faction
            .last_failure
            .map(|failure| failure.limits.len()),
        Some(1)
    );
}
