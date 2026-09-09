//! Every unit in every committed fixture is read completely, and a deliberately narrow re-wrap is
//! caught and said so.
//!
//! The first test is the false-positive net under the detector in `report::unit`: the detector is
//! blunt on purpose ("the logical line does not end with `.`"), and this is what proves it may be.

use atlantis_hud_core::report::model::UnitRead;
use atlantis_hud_core::report::parse_report_full;

#[test]
fn every_unit_in_every_fixture_is_read_completely() {
    for report in atlantis_hud_fixtures::ALL {
        let parsed = parse_report_full(report.text);

        for region in &parsed.regions {
            for unit in &region.units {
                assert_eq!(
                    unit.read,
                    UnitRead::Complete,
                    "{}: unit {} ({}) read as {:?}",
                    report.file,
                    unit.unit_id,
                    unit.name,
                    unit.read
                );
            }
        }

        for line in &parsed.unreadable_lines {
            assert_eq!(
                line.unit_read, None,
                "{}: unreadable line {} carries a unit read state",
                report.file, line.line_start
            );
        }
    }
}

#[test]
fn the_reported_narrow_wrap_loses_a_unit_and_says_so() {
    // The one physical line the failure was measured on, shortened by nine columns so the
    // fragment below it stops being recognised as a continuation. Nothing else is touched, and
    // the wrapping is deliberately left alone: that is exactly the report a narrower wrapper
    // would produce.
    let source: String = atlantis_hud_fixtures::G5_F21_T39
        .text
        .lines()
        .map(|line| {
            if line.contains("* Drones (9498)") {
                line.replacen(", sharing,", ",", 1)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    let parsed = parse_report_full(&source);

    let unit = parsed
        .regions
        .iter()
        .flat_map(|region| &region.units)
        .find(|unit| unit.unit_id == "9498")
        .expect("unit 9498 still reaches the map");

    assert_eq!(unit.read, UnitRead::Nothing);
    assert!(unit.items.is_empty());

    let marked: Vec<_> = parsed
        .unreadable_lines
        .iter()
        .filter(|line| line.unit_read == Some(UnitRead::Nothing))
        .collect();

    assert_eq!(marked.len(), 1);
}
