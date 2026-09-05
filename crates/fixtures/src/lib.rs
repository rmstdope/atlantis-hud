//! The committed report fixtures, named once. Every test in the workspace that reads a fixture
//! reads it from here, so renaming or replacing one is an edit to this file and to the file on
//! disk - and `every_fixture_on_disk_is_named_here` fails when the two disagree (ah-v2l).

/// One committed report: its const name, its file name under `tests/fixtures/reports/`, and its
/// text.
pub struct Report {
    pub name: &'static str,
    pub file: &'static str,
    pub text: &'static str,
}

macro_rules! report {
    ($name:ident, $file:literal) => {
        Report {
            name: stringify!($name),
            file: $file,
            text: include_str!(concat!("../../../tests/fixtures/reports/", $file)),
        }
    };
}

pub const G2_F42_T0: Report = report!(G2_F42_T0, "neworigins-3.0.0-g2-f42-t0.rep");
pub const G3_F42_T1: Report = report!(G3_F42_T1, "neworigins-3.0.0-g3-f42-t1.rep");
pub const G3_F42_T40: Report = report!(G3_F42_T40, "neworigins-3.0.0-g3-f42-t40.rep");
pub const G3_F42_T41: Report = report!(G3_F42_T41, "neworigins-3.0.0-g3-f42-t41.rep");
pub const G3_F42_T42: Report = report!(G3_F42_T42, "neworigins-3.0.0-g3-f42-t42.rep");
pub const G3_F42_T82: Report = report!(G3_F42_T82, "neworigins-3.0.0-g3-f42-t82.rep");
pub const G4_F17_T0: Report = report!(G4_F17_T0, "neworigins-3.0.0-g4-f17-t0.rep");
pub const G5_F21_T0: Report = report!(G5_F21_T0, "neworigins-3.0.0-g5-f21-t0.rep");
pub const G5_F21_T23: Report = report!(G5_F21_T23, "neworigins-3.0.0-g5-f21-t23.rep");
pub const G5_F21_T24: Report = report!(G5_F21_T24, "neworigins-3.0.0-g5-f21-t24.rep");
pub const G5_F21_T25: Report = report!(G5_F21_T25, "neworigins-3.0.0-g5-f21-t25.rep");
pub const G5_F21_T39: Report = report!(G5_F21_T39, "neworigins-3.0.0-g5-f21-t39.rep");
pub const G7_F39_T17: Report = report!(G7_F39_T17, "neworigins-3.0.0-g7-f39-t17.rep");
pub const G7_F39_T18: Report = report!(G7_F39_T18, "neworigins-3.0.0-g7-f39-t18.rep");
pub const G7_F62_T0: Report = report!(G7_F62_T0, "neworigins-3.0.0-g7-f62-t0.rep");
pub const G7_F62_T17: Report = report!(G7_F62_T17, "neworigins-3.0.0-g7-f62-t17.rep");
pub const G7_F62_T18: Report = report!(G7_F62_T18, "neworigins-3.0.0-g7-f62-t18.rep");
pub const G7_F62_T20: Report = report!(G7_F62_T20, "neworigins-3.0.0-g7-f62-t20.rep");
pub const G7_F95_T55: Report = report!(G7_F95_T55, "neworigins-3.0.0-g7-f95-t55.rep");
pub const G7_F95_T70: Report = report!(G7_F95_T70, "neworigins-3.0.0-g7-f95-t70.rep");
pub const G7_F95_T71: Report = report!(G7_F95_T71, "neworigins-3.0.0-g7-f95-t71.rep");
pub const G7_F95_T72: Report = report!(G7_F95_T72, "neworigins-3.0.0-g7-f95-t72.rep");
pub const G7_F95_T74: Report = report!(G7_F95_T74, "neworigins-3.0.0-g7-f95-t74.rep");
pub const G8_F73_T1: Report = report!(G8_F73_T1, "neworigins-3.0.0-g8-f73-t1.rep");
pub const G8_F73_T2: Report = report!(G8_F73_T2, "neworigins-3.0.0-g8-f73-t2.rep");
pub const G8_F73_T71: Report = report!(G8_F73_T71, "neworigins-3.0.0-g8-f73-t71.rep");

/// Every fixture, for the lockstep test and for anything that walks them all
/// (`parse_real_reports`).
pub const ALL: &[&Report] = &[
    &G2_F42_T0,
    &G3_F42_T1,
    &G3_F42_T40,
    &G3_F42_T41,
    &G3_F42_T42,
    &G3_F42_T82,
    &G4_F17_T0,
    &G5_F21_T0,
    &G5_F21_T23,
    &G5_F21_T24,
    &G5_F21_T25,
    &G5_F21_T39,
    &G7_F39_T17,
    &G7_F39_T18,
    &G7_F62_T0,
    &G7_F62_T17,
    &G7_F62_T18,
    &G7_F62_T20,
    &G7_F95_T55,
    &G7_F95_T70,
    &G7_F95_T71,
    &G7_F95_T72,
    &G7_F95_T74,
    &G8_F73_T1,
    &G8_F73_T2,
    &G8_F73_T71,
];

/// One committed mage sheet: the report it was exported from, the unit ids it was exported with,
/// and its text.
///
/// The unit-id list is what makes the fixture reproducible: `export_mage_sheet` never asks the
/// ruleset who is a mage, so the ids are the whole definition of what the sheet contains.
pub struct MageSheet {
    pub name: &'static str,
    pub file: &'static str,
    /// The committed report `export_mage_sheet` was run over.
    pub source: &'static Report,
    /// The unit ids it was given, ascending.
    pub mages: &'static [&'static str],
    pub text: &'static str,
}

macro_rules! mage_sheet {
    ($name:ident, $file:literal, $source:expr, $mages:expr) => {
        MageSheet {
            name: stringify!($name),
            file: $file,
            source: &$source,
            mages: &$mages,
            text: include_str!(concat!("../../../tests/fixtures/mage-sheets/", $file)),
        }
    };
}

pub const MAGES_G7_F39_T17: MageSheet = mage_sheet!(
    MAGES_G7_F39_T17,
    "mages-neworigins-3.0.0-g7-f39-t17.txt",
    G7_F39_T17,
    ["1447", "1448", "7310", "7311"]
);
pub const MAGES_G7_F39_T18: MageSheet = mage_sheet!(
    MAGES_G7_F39_T18,
    "mages-neworigins-3.0.0-g7-f39-t18.txt",
    G7_F39_T18,
    ["1447", "1448", "7310", "7311", "7722"]
);
pub const MAGES_G7_F39_T18_TRIMMED: MageSheet = mage_sheet!(
    MAGES_G7_F39_T18_TRIMMED,
    "mages-neworigins-3.0.0-g7-f39-t18-trimmed.txt",
    G7_F39_T18,
    ["7310", "7722"]
);
pub const MAGES_G7_F62_T18: MageSheet = mage_sheet!(
    MAGES_G7_F62_T18,
    "mages-neworigins-3.0.0-g7-f62-t18.txt",
    G7_F62_T18,
    ["916", "1656", "1657", "1658", "1659"]
);

/// Every committed mage sheet, for the lockstep test and for anything that walks them all.
pub const ALL_MAGE_SHEETS: &[&MageSheet] = &[
    &MAGES_G7_F39_T17,
    &MAGES_G7_F39_T18,
    &MAGES_G7_F39_T18_TRIMMED,
    &MAGES_G7_F62_T18,
];

/// The shipped ruleset, `config/public/ruleset.json`, which the tests parse against.
pub const RULESET_JSON: &str = include_str!("../../../config/public/ruleset.json");

/// The committed New Age Arcanum ruleset, `config/public/ruleset-newage-arcanum.json`.
pub const NEWAGE_ARCANUM_RULESET_JSON: &str =
    include_str!("../../../config/public/ruleset-newage-arcanum.json");

/// The committed New Age Trident ruleset, `config/public/ruleset-newage-trident.json`.
pub const NEWAGE_TRIDENT_RULESET_JSON: &str =
    include_str!("../../../config/public/ruleset-newage-trident.json");

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs;

    /// Parses `neworigins-3.0.0-g<G>-f<F>-t<T>.rep` into its `(G, F, T)` number strings.
    fn parse_gft(file: &str) -> Option<(&str, &str, &str)> {
        let stem = file.strip_suffix(".rep")?;
        let mut parts = stem.rsplitn(3, '-');
        let t = parts.next()?.strip_prefix('t')?;
        let f = parts.next()?.strip_prefix('f')?;
        let g = parts.next()?.rsplit('-').next()?.strip_prefix('g')?;
        Some((g, f, t))
    }

    fn fixtures_dir() -> std::path::PathBuf {
        std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/reports"
        ))
        .to_path_buf()
    }

    #[test]
    fn every_fixture_on_disk_is_named_here() {
        let on_disk: BTreeSet<String> = fs::read_dir(fixtures_dir())
            .expect("tests/fixtures/reports should exist")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".rep"))
            .collect();
        let named: BTreeSet<String> = ALL.iter().map(|report| report.file.to_string()).collect();

        let on_disk_only: Vec<_> = on_disk.difference(&named).collect();
        let named_only: Vec<_> = named.difference(&on_disk).collect();
        assert!(
            on_disk_only.is_empty() && named_only.is_empty(),
            "fixtures on disk but not named: {on_disk_only:?}; named but missing from disk: {named_only:?}"
        );
    }

    #[test]
    fn names_follow_the_file() {
        for report in ALL {
            let (g, f, t) = parse_gft(report.file).unwrap_or_else(|| {
                panic!(
                    "fixture file name {:?} does not match the expected pattern",
                    report.file
                )
            });
            let expected = format!("G{g}_F{f}_T{t}");
            assert_eq!(
                report.name, expected,
                "const name for {:?} should be {expected}",
                report.file
            );
        }
    }

    fn mage_sheets_dir() -> std::path::PathBuf {
        std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/mage-sheets"
        ))
        .to_path_buf()
    }

    #[test]
    fn every_mage_sheet_on_disk_is_named_here() {
        let on_disk: BTreeSet<String> = fs::read_dir(mage_sheets_dir())
            .expect("tests/fixtures/mage-sheets should exist")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".txt"))
            .collect();
        let named: BTreeSet<String> = ALL_MAGE_SHEETS
            .iter()
            .map(|sheet| sheet.file.to_string())
            .collect();

        let on_disk_only: Vec<_> = on_disk.difference(&named).collect();
        let named_only: Vec<_> = named.difference(&on_disk).collect();
        assert!(
            on_disk_only.is_empty() && named_only.is_empty(),
            "mage sheets on disk but not named: {on_disk_only:?}; named but missing from disk: {named_only:?}"
        );
    }

    /// `mages-neworigins-3.0.0-g7-f39-t18-trimmed.txt` must be named `MAGES_G7_F39_T18_TRIMMED`:
    /// the `g<n>-f<n>-t<n>[-variant]` tail, uppercased, dashes to underscores, prefixed `MAGES_`.
    #[test]
    fn mage_sheet_names_follow_the_file() {
        for sheet in ALL_MAGE_SHEETS {
            let tail = sheet
                .file
                .strip_prefix("mages-")
                .and_then(|rest| rest.strip_suffix(".txt"))
                .and_then(|rest| rest.split_once("-g"))
                .map(|(_, tail)| format!("g{tail}"))
                .unwrap_or_else(|| {
                    panic!(
                        "mage sheet file name {:?} does not match the expected pattern",
                        sheet.file
                    )
                });
            let expected = format!("MAGES_{}", tail.to_uppercase().replace('-', "_"));
            assert_eq!(
                sheet.name, expected,
                "const name for {:?} should be {expected}",
                sheet.file
            );
        }
    }
}
