//! The case `ah-m1th` was filed from: faction 3's turn 84 of New Age Arcanum, which states
//! `Unclaimed silver: 1796.` Wisplith of Petal Court (2543) writes `WITHDRAW 89 MEAL`, which
//! `data/MEAL` prices at 20 silver each - $1780 of the fund. `rules/sequenceofevents` processes
//! WITHDRAW before "Maintenance costs are assessed", and `rules/economy_maintenance` has the
//! unclaimed fund feed "units that would otherwise starve", so Gunkgrip Earpurse (202), who the
//! report shows claiming 10 silver for maintenance, is left short by an order on another unit's
//! line. That line now says so; the short units' own warnings are untouched.

use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::semantics::{check_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

const DRAW: &str = "draw-leaves-upkeep-unpaid";

/// The report's own template, with `WITHDRAW 89 MEAL` written as the first line of 2543's block,
/// and the line number it lands on.
fn orders(withdraw: bool) -> (String, usize) {
    let template = extract_orders_template(atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text)
        .expect("the report carries a template")
        .text;
    let header = template
        .lines()
        .position(|line| line.trim_start().to_lowercase().starts_with("unit 2543"))
        .expect("the template has a block for 2543");
    if !withdraw {
        return (template, 0);
    }
    let mut lines: Vec<&str> = template.lines().collect();
    lines.insert(header + 1, "WITHDRAW 89 MEAL");
    // 1-based, the line after the header.
    (lines.join("\n") + "\n", header + 2)
}

fn findings(orders: &str) -> Vec<Finding> {
    let ruleset = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset loads");
    let mut parsed = parse_report_full(atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text);
    classify_units(&mut parsed, &ruleset);
    check_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
}

#[test]
fn the_withdrawal_that_drains_the_fund_is_warned_on_its_line() {
    let (orders, line) = orders(true);
    let all = findings(&orders);
    let on_the_line: Vec<&Finding> = all
        .iter()
        .filter(|finding| finding.code.as_str() == DRAW)
        .collect();
    assert_eq!(on_the_line.len(), 1, "{on_the_line:?}");
    let warning = on_the_line[0];
    assert_eq!(warning.unit_id.as_deref(), Some("2543"));
    assert_eq!(warning.line, Some(line));
    // $1796 less $1780 leaves $16. The bead's own example reads $115 and twelve units because it
    // was taken with more of the turn's orders typed; on the template alone, four units rely on
    // the fund, named in report order, three in full.
    assert_eq!(
        warning.message,
        "This leaves $16 of the faction's unclaimed silver, and $40 of upkeep relies on it: \
         Gunkgrip Earpurse (202), Nimaer of Hallowed Mist House (586), Gunkjabber Brainworrier \
         (2708) and 1 other."
    );
}

/// Option A: nothing is added to the units left short. Gunkgrip's own findings are exactly what
/// they are with the new warning taken out of the same run.
#[test]
fn the_units_left_short_keep_their_own_warnings_unchanged() {
    let (orders, _) = orders(true);
    let all = findings(&orders);
    let of_gunkgrip = |findings: &[Finding]| -> Vec<Finding> {
        findings
            .iter()
            .filter(|finding| finding.unit_id.as_deref() == Some("202"))
            .cloned()
            .collect()
    };
    let without_the_draw_warning: Vec<Finding> = all
        .iter()
        .filter(|finding| finding.code.as_str() != DRAW)
        .cloned()
        .collect();
    let gunkgrip = of_gunkgrip(&all);
    assert_eq!(gunkgrip, of_gunkgrip(&without_the_draw_warning));
    assert!(
        gunkgrip
            .iter()
            .any(|finding| finding.code.as_str() == "upkeep-exceeds-unclaimed"),
        "Gunkgrip is still told it goes short: {gunkgrip:?}"
    );
}

#[test]
fn the_template_alone_draws_nothing_and_is_not_warned() {
    let (orders, _) = orders(false);
    assert!(findings(&orders)
        .iter()
        .all(|finding| finding.code.as_str() != DRAW));
}
