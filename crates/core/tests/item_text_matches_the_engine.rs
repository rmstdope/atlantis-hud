//! The writer's item text against what the engine actually printed.
//!
//! The map export writes items back in the engine's `Item::Report` form (`../Atlantis/items.cpp`),
//! and `report::item_text` is the one table both that writer and the parser read (`ah-lmfc`). A
//! round trip only proves the writer agrees with the parser; this proves it agrees with the game:
//! every complete unit line in every committed report, its items read and written again, has to
//! reproduce the engine's own item list character for character.

use atlantis_hud_core::report::item_text::write_item_amount;
use atlantis_hud_core::report::model::UnitRead;
use atlantis_hud_core::report::unit::parse_unit;
use atlantis_hud_core::report::unwrap::unwrap_lines;

#[test]
fn every_unit_item_list_in_the_fixtures_writes_back_verbatim() {
    let mut checked = 0usize;
    let mut illusions = 0usize;
    let mut unfinished = 0usize;
    for report in atlantis_hud_fixtures::ALL {
        for line in unwrap_lines(report.text) {
            let Some(marker @ ('*' | '-')) = line.marker() else {
                continue;
            };
            let body = line.body();
            let Some(unit) = parse_unit(body, marker == '*', "", None) else {
                continue;
            };
            if unit.read != UnitRead::Complete || unit.items.is_empty() {
                continue;
            }
            let written = unit
                .items
                .iter()
                .map(write_item_amount)
                .collect::<Vec<_>>()
                .join(", ");
            // The list ends the head sentence, or runs into the unit's description after a `;`.
            assert!(
                body.contains(&format!(", {written}.")) || body.contains(&format!(", {written};")),
                "{}:{}: wrote `{written}` for\n{body}",
                report.file,
                line.line_start
            );
            checked += 1;
            illusions += usize::from(written.contains(" (illusion)"));
            unfinished += usize::from(written.contains(" (needs "));
        }
    }
    // The corpus has to exercise every form in the table, or this proves less than it says.
    assert!(checked > 1000, "only {checked} unit lines checked");
    assert!(illusions > 0, "no illusion in the corpus was checked");
    assert!(unfinished > 0, "no unfinished ship in the corpus was checked");
}
