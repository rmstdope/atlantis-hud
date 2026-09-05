//! Every committed mage sheet under `tests/fixtures/mage-sheets/` is exactly what
//! `export_mage_sheet` writes today for its source report and its unit ids.
//!
//! That is the whole answer to the one risk in committing generated data: if the exporter's output
//! ever changes, these fixtures go red rather than quietly describing a format the code no longer
//! writes. Set `UPDATE_MAGE_SHEET_FIXTURES=1` to write the files instead of asserting - which is
//! also how they came into existence. That refreshes content only: `atlantis_hud_fixtures` reaches
//! each file with `include_str!`, so a named file missing from disk fails to compile before this
//! test can run, and has to be created empty first.
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

#[test]
fn every_committed_mage_sheet_matches_a_fresh_export() {
    let update = std::env::var_os("UPDATE_MAGE_SHEET_FIXTURES").is_some();
    for sheet in atlantis_hud_fixtures::ALL_MAGE_SHEETS {
        let (file, source, mages) = (sheet.file, sheet.source, sheet.mages);
        let ids: BTreeSet<String> = mages.iter().map(|id| (*id).to_string()).collect();
        let report = parse_report_full(source.text);
        let fresh = export_mage_sheet(&report, &ids);
        let path = sheets_dir().join(file);
        if update {
            std::fs::create_dir_all(sheets_dir())
                .expect("the mage-sheets directory should be creatable");
            std::fs::write(&path, &fresh)
                .unwrap_or_else(|error| panic!("{} should be writable: {error}", path.display()));
            continue;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "{} should exist and be readable: {error}. A named-but-missing file has to be \
                 created empty before UPDATE_MAGE_SHEET_FIXTURES=1 can fill it - see \
                 tests/fixtures/mage-sheets/README.md",
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
