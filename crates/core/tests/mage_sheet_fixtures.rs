//! Every committed mage sheet under `tests/fixtures/mage-sheets/` is exactly what
//! `export_mage_sheet` writes today for its source report and its unit ids.
//!
//! That is the whole answer to the one risk in committing generated data: if the exporter's output
//! ever changes, these fixtures go red rather than quietly describing a format the code no longer
//! writes. Set `UPDATE_MAGE_SHEET_FIXTURES=1` to write the files instead of asserting - which is
//! also how they came into existence.
//!
//! Fixtures are read with `read_to_string`, never `include_str!`: the latter bakes content in at
//! compile time, so a run that has just rewritten a file would compare the new file with the old
//! bytes and pass while proving nothing (ah-fu0j).

use atlantis_hud_core::report::export::export_mage_sheet;
use atlantis_hud_core::report::parse_report_full;
use std::collections::BTreeSet;
use std::path::PathBuf;

fn sheets_dir() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/mage-sheets"
    ))
}

/// The file, the report it is exported from, and the unit ids it is exported with.
///
/// Local to this test only until `atlantis_hud_fixtures` names the sheets: `include_str!` of a file
/// that does not exist is a compile error, so the files have to exist before they can be named.
const SHEETS: &[(&str, &atlantis_hud_fixtures::Report, &[&str])] = &[
    (
        "mages-neworigins-3.0.0-g7-f39-t17.txt",
        &atlantis_hud_fixtures::G7_F39_T17,
        &["1447", "1448", "7310", "7311"],
    ),
    (
        "mages-neworigins-3.0.0-g7-f39-t18.txt",
        &atlantis_hud_fixtures::G7_F39_T18,
        &["1447", "1448", "7310", "7311", "7722"],
    ),
    (
        "mages-neworigins-3.0.0-g7-f39-t18-trimmed.txt",
        &atlantis_hud_fixtures::G7_F39_T18,
        &["7310", "7722"],
    ),
    (
        "mages-neworigins-3.0.0-g7-f62-t18.txt",
        &atlantis_hud_fixtures::G7_F62_T18,
        &["916", "1656", "1657", "1658", "1659"],
    ),
];

#[test]
fn every_committed_mage_sheet_matches_a_fresh_export() {
    let update = std::env::var_os("UPDATE_MAGE_SHEET_FIXTURES").is_some();
    for (file, source, mages) in SHEETS {
        let ids: BTreeSet<String> = mages.iter().map(|id| (*id).to_string()).collect();
        let report = parse_report_full(source.text);
        let fresh = export_mage_sheet(&report, &ids);
        let path = sheets_dir().join(file);
        if update {
            std::fs::create_dir_all(sheets_dir()).expect("the mage-sheets directory should be creatable");
            std::fs::write(&path, &fresh)
                .unwrap_or_else(|error| panic!("{} should be writable: {error}", path.display()));
            continue;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "{} should exist and be readable: {error}. Regenerate with \
                 UPDATE_MAGE_SHEET_FIXTURES=1 cargo test -p atlantis-hud-core --test mage_sheet_fixtures",
                path.display()
            )
        });
        assert_eq!(
            committed, fresh,
            "{file} is not what export_mage_sheet writes today for {} and {mages:?}",
            source.file
        );
    }
}
