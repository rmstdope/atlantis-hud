//! A regional pool a foreign player unit may also draw on is forecast as a ceiling (`ah-e23d.2`).
//!
//! The engine settles every region resource, the wage pool and the entertainment demand across
//! **every** unit working it, whatever its faction: `RunAProduction` (../Atlantis
//! `monthorders.cpp`) totals the productivity of each unit in the region with a matching `PRODUCE`
//! and hands each `amount * own / attempted`, and WORK and ENTERTAIN are productions of silver run
//! by the same function. `rules/economy_income` says "All units may WORK, regardless of skills or
//! faction type", and `rules/economy_entertainment` that "All factions may have entertainers".
//! The application settled own units only, so a pool a foreign unit could share read as ours alone.
//!
//! Foreign orders are unknown, so the navigator's answer (2026-10-09) keeps the figure and marks it
//! a ceiling; The Guardsmen (1) and Creatures (2) issue no such orders and do not count.
//!
//! `mountain (36,4)` of the committed turn 42 holds own miners and an own entertainer beside ten
//! foreign player units (`tests/fixtures/reports/neworigins-3.0.0-g3-f42-t42.rep:1385` onwards).

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn the_report() -> String {
    atlantis_hud_fixtures::G3_F42_T42.text.to_string()
}

/// A miner, and the entertainer, of `mountain (36,4)`, and nothing else.
fn orders() -> String {
    [
        "#atlantis 42 \"<password>\"",
        "",
        "unit 5105",
        "PRODUCE iron",
        "unit 1164",
        "ENTERTAIN",
        "",
    ]
    .join("\n")
}

fn forecast_of(report: &str, unit_id: &str) -> UnitSilver {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(report);
    classify_units(&mut parsed, &ruleset);
    let review = review_turn(&parsed, &orders(), Some(&ruleset), CheckOptions::default());
    review
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} should have a forecast"))
}

/// The report with every foreign unit of `mountain (36,4)` removed and `replacement` put in their
/// place - so the hex holds exactly the foreign units the caller names.
fn with_foreigners_of_the_hex(replacement: &[&str]) -> String {
    let report = the_report();
    let lines: Vec<&str> = report.lines().collect();
    let start = lines
        .iter()
        .position(|line| line.starts_with("mountain (36,4) in Slounspifra"))
        .expect("the fixture still holds mountain (36,4)");
    // The next region's header is the next line that starts in column one with a letter.
    let end = start
        + 1
        + lines[start + 1..]
            .iter()
            .position(|line| line.chars().next().is_some_and(|c| c.is_ascii_lowercase()))
            .expect("a region follows mountain (36,4)");

    let mut out: Vec<String> = lines[..start].iter().map(|line| line.to_string()).collect();
    let mut removed = 0;
    let mut in_foreign = false;
    let mut placed = false;
    for line in &lines[start..end] {
        // A foreign unit inside a structure is indented under it, and is a unit of the hex all
        // the same.
        if line.trim_start().starts_with("- ") {
            in_foreign = true;
            removed += 1;
            if !placed {
                out.extend(replacement.iter().map(|line| line.to_string()));
                placed = true;
            }
            continue;
        }
        let opens = line.trim_start();
        if opens.starts_with("* ") || opens.starts_with("+ ") || opens.is_empty() {
            in_foreign = false;
        }
        if !in_foreign {
            out.push(line.to_string());
        }
    }
    out.extend(lines[end..].iter().map(|line| line.to_string()));
    assert_eq!(
        removed, 10,
        "the hex should still hold its ten foreign units"
    );
    out.join("\n")
}

#[test]
fn a_miners_iron_is_a_ceiling_beside_a_foreign_unit() {
    let miner = forecast_of(&the_report(), "5105");
    assert!(
        miner.produced > 0,
        "the miner should be producing iron, or the assertion below is vacuous"
    );
    assert!(
        miner.production_foreign_sharer,
        "ten foreign player units stand in the hex and may mine the same iron"
    );
}

#[test]
fn an_entertainers_takings_are_a_ceiling_beside_a_foreign_unit() {
    let entertainer = forecast_of(&the_report(), "1164");
    assert!(
        entertainer.late_income.is_some_and(|late| late > 0),
        "the entertainer should be earning, or the assertion below is vacuous"
    );
    assert!(entertainer.late_income_foreign_sharer);
    assert_eq!(
        entertainer.doubt, None,
        "the figure is kept, only its label changes"
    );
}

#[test]
fn guards_and_creatures_share_nothing() {
    let report = with_foreigners_of_the_hex(&[
        "- City Guard (99901), on guard, The Guardsmen (1), 20 leaders [LEAD].",
        "- Wolves (99902), Creatures (2), 5 orcs [ORC].",
    ]);
    let miner = forecast_of(&report, "5105");
    let entertainer = forecast_of(&report, "1164");
    assert!(!miner.production_foreign_sharer);
    assert!(!entertainer.late_income_foreign_sharer);
    // The figures themselves are what they were beside the foreign players: a ceiling never moves one.
    assert_eq!(miner.produced, forecast_of(&the_report(), "5105").produced);
    assert_eq!(
        entertainer.late_income,
        forecast_of(&the_report(), "1164").late_income
    );
}

#[test]
fn one_foreign_player_unit_is_enough() {
    let report = with_foreigners_of_the_hex(&["- Scout (99903), Rivals (77), orc [ORC]."]);
    assert!(forecast_of(&report, "5105").production_foreign_sharer);
    assert!(forecast_of(&report, "1164").late_income_foreign_sharer);
}

#[test]
fn a_unit_hiding_its_faction_may_be_a_player() {
    let report = with_foreigners_of_the_hex(&["- Scout (99904), orc [ORC]."]);
    assert!(forecast_of(&report, "5105").production_foreign_sharer);
    assert!(forecast_of(&report, "1164").late_income_foreign_sharer);
}
