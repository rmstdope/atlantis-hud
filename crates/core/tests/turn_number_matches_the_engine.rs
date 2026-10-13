//! The turn number HUD derives from a report's date is the one the game itself gives that report.
//!
//! The engine numbers turns `(year - 1) * 12 + month + 1` with January as month 0
//! (`Game::TurnNumber`, game.cpp), so January of Year 1 is turn 1. A New Age report prints that
//! number beside a date in its quest list, which lets a real report check the derivation (ah-m6pw).

use atlantis_hud_core::report::parse_report_full;

#[test]
fn a_december_year_7_report_is_turn_84_as_the_report_itself_says() {
    let text = atlantis_hud_fixtures::NEWAGE_ARCANUM_F5_T84.text;
    assert!(
        text.contains("Posted: Year 7, December (turn 84)"),
        "the report names its own turn number"
    );

    let header = parse_report_full(text).header;

    assert_eq!(header.month.as_deref(), Some("December"));
    assert_eq!(header.year, Some(7));
    assert_eq!(header.turn_number, Some(84));
}

#[test]
fn every_date_a_new_age_report_prints_beside_a_turn_number_derives_that_number() {
    use atlantis_hud_core::report::header::turn_number_for;

    let mut checked = 0;

    for report in atlantis_hud_fixtures::ALL_NEWAGE_ARCANUM_REPORTS {
        for (month, year, turn) in printed_turns(report.text) {
            assert_eq!(
                turn_number_for(&month, year),
                Some(turn),
                "{month}, Year {year} is printed as turn {turn}"
            );
            checked += 1;
        }
    }
    assert!(checked > 0, "the New Age reports print dated turn numbers");
}

/// Every `Year <y>, <Month> (turn <n>)` the report prints.
fn printed_turns(text: &str) -> Vec<(String, u32, u32)> {
    let mut found = Vec::new();
    for line in text.lines() {
        let mut rest = line;
        while let Some(start) = rest.find("Year ") {
            rest = &rest[start + "Year ".len()..];
            let Some((year, after)) = rest.split_once(", ") else {
                break;
            };
            let Some((month, after)) = after.split_once(" (turn ") else {
                continue;
            };
            let Some((turn, _)) = after.split_once(')') else {
                continue;
            };
            if let (Ok(year), Ok(turn)) = (year.parse(), turn.parse()) {
                found.push((month.to_string(), year, turn));
            }
        }
    }
    found
}
