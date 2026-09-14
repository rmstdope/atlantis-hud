//! Acceptance tests for the Problems warning about a MOVE into a wall a report proves
//! (`ah-wq2e.4`), on the navigator's own report.
//!
//! In `newage-arcanum-f3-t84`, cavern (9,3,2) contains Ciestucshire and lists exits only Southeast,
//! South and Northwest; the described cavern (9,1,2) to its north does not name it back, so North
//! of (9,3,2) is a wall by `ah-wq2e.1`'s rule. Gnashgib Eyesniffer (2531) stands there.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::{OrderCheckOptions, OrderDiagnosticSeverity};

fn wall_diagnostics(orders: &str) -> Vec<atlantis_hud_core::OrderDiagnostic> {
    let raw = atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text;
    let rules = atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON;
    let mut cache = ReportCache::new();
    let walled =
        atlantis_hud_core::orders::effects::walled_moves(&mut cache, rules, raw, "[]", orders, None)
            .expect("loads");
    let ruleset = cache.ruleset(rules).expect("ruleset");
    let report = cache.classified(raw, rules);
    atlantis_hud_core::validate_turn(
        orders,
        Some(&ruleset),
        Some(&report),
        OrderCheckOptions {
            walled_moves: walled,
            ..Default::default()
        },
    )
    .diagnostics
    .into_iter()
    .filter(|diagnostic| diagnostic.code == "move-into-a-wall")
    .collect()
}

#[test]
fn a_move_north_from_ciestucshire_warns_about_its_wall() {
    let walled = wall_diagnostics("unit 2531\nMOVE N\n");

    assert_eq!(walled.len(), 1, "{walled:?}");
    assert_eq!(
        walled[0].message,
        "There is no exit North from Ciestucshire (9,3,2): a report shows a wall on that side."
    );
    assert_eq!(walled[0].line_start, Some(2));
    assert_eq!(walled[0].severity, OrderDiagnosticSeverity::Warning);
}

#[test]
fn a_move_south_from_ciestucshire_is_not_warned_about() {
    let walled = wall_diagnostics("unit 2531\nMOVE S\n");
    assert!(walled.is_empty(), "{walled:?}");
}
