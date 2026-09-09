//! Reads a map exported by **AtlaClient**, another Atlantis client.
//!
//! AtlaClient writes its map in the game's own region syntax, with no report header of any kind,
//! and welds a turn stamp onto each region's underline: `;16` for a hex as new as the file,
//! `;16-11` for one last seen on turn 11. `ARegion::WriteReport` (`source/region.cpp` in
//! `Atlantis-PBEM/Atlaclient`) is what writes them, padding the line to sixty characters with a
//! minimum of ten dashes — which is why the dash count varies.
//!
//! So [`super::parse_report_full`] already reads the regions: `parse_region_block` skips any line
//! opening with `---`. What is missing, and what this module supplies, is the recogniser and a
//! reader for the stamps.

use std::collections::BTreeMap;

use super::opens_a_region;
use super::region::parse_region_header;
use super::unwrap::unwrap_lines;

/// The `merged_faction_id` a map imported from AtlaClient is filed under.
///
/// A reserved value rather than a faction number, because an AtlaClient map names no faction and
/// the provenance row still has to say where the hexes came from. The game numbers factions, so
/// nothing can collide. The shell has its own copy in `packages/shared/src/atlaClientImport.ts`;
/// nothing compiles a check between the two.
pub const ATLACLIENT_SOURCE_ID: &str = "atlaclient";

/// The two numbers of one stamp: the turn the file was written on, and the turn that hex was last
/// seen, which is the same when the stamp carries no dash.
///
/// A line is a stamp when it is nothing but dashes, a semicolon and the numbers. That is a shape no
/// turn report has: our own exporter writes sixty plain dashes (`super::write::write_region`), and
/// no committed fixture carries a semicolon on such a line.
fn read_stamp(line: &str) -> Option<(u32, u32)> {
    // Trimmed, because AtlaClient is a Windows program and a real export may arrive with CRLF
    // line endings — an untrimmed `\r` would never match.
    let line = line.trim();
    let (dashes, stamp) = line.split_once(';')?;
    if dashes.len() < 3 || !dashes.chars().all(|c| c == '-') {
        return None;
    }

    match stamp.split_once('-') {
        Some((file_turn, seen)) => Some((parse_number(file_turn)?, parse_number(seen)?)),
        None => {
            let file_turn = parse_number(stamp)?;
            Some((file_turn, file_turn))
        }
    }
}

/// A field of one or more ASCII digits, and nothing else.
fn parse_number(field: &str) -> Option<u32> {
    if field.is_empty() || !field.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    field.parse().ok()
}

/// Whether this text is a map exported by AtlaClient, judged on any line carrying a stamp.
#[must_use]
pub fn is_atlaclient_map(text: &str) -> bool {
    text.lines().any(|line| read_stamp(line).is_some())
}

/// The turn the file was written on: the largest number before the dash across every stamp.
///
/// AtlaClient writes the same number on all of them, so the maximum is that number; taking the
/// maximum rather than the first makes the answer total for a hand-edited file too, and means a
/// recognised file always names a turn.
#[must_use]
pub fn atlaclient_file_turn(text: &str) -> Option<u32> {
    text.lines()
        .filter_map(|line| read_stamp(line).map(|(file_turn, _)| file_turn))
        .max()
}

/// The turn each hex was last seen, by `region_id`.
///
/// The number after the dash, or the file's own turn when the stamp has no dash. A `-0` stamp
/// yields 0, the oldest a hex can be, which is what AtlaClient writes when it does not know when
/// it saw the hex.
///
/// Built the way [`super::export::map_export_ages`] is, with one difference: our own note
/// *precedes* the header and AtlaClient's stamp *follows* it, so the pending value is set after a
/// header rather than before one. A stamp whose header did not parse is dropped, which is why this
/// is keyed by region id.
#[must_use]
pub fn atlaclient_ages(text: &str) -> BTreeMap<String, u32> {
    let mut ages = BTreeMap::new();
    let mut pending: Option<String> = None;

    for line in unwrap_lines(text) {
        let body = line.body();

        if let Some((_, seen)) = read_stamp(body) {
            if let Some(region_id) = pending.take() {
                ages.insert(region_id, seen);
            }
            continue;
        }

        if opens_a_region(&line) {
            pending = parse_region_header(body).map(|region| region.region_id);
        }
    }

    ages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::export::MAP_EXPORT_MARKER;
    use crate::report::parse_report_full;

    fn fixture() -> &'static str {
        atlantis_hud_fixtures::ATLACLIENT_T16.text
    }

    #[test]
    fn reads_the_committed_fixture() {
        let text = fixture();
        assert!(is_atlaclient_map(text));
        assert_eq!(atlaclient_file_turn(text), Some(16));

        let ages = atlaclient_ages(text);
        assert_eq!(ages.len(), 83, "the fixture has 83 stamped hexes");

        let current = ages.values().filter(|&&turn| turn == 16).count();
        let older = ages
            .values()
            .filter(|&&turn| (5..16).contains(&turn))
            .count();
        let undated = ages.values().filter(|&&turn| turn == 0).count();
        assert_eq!((current, older, undated), (49, 29, 5));

        let oldest_dated = ages.values().copied().filter(|&turn| turn > 0).min();
        assert_eq!(oldest_dated, Some(5));
    }

    #[test]
    fn a_turn_report_is_not_an_atlaclient_map() {
        for report in atlantis_hud_fixtures::ALL {
            assert!(
                !is_atlaclient_map(report.text),
                "{} should not look like an AtlaClient map",
                report.file
            );
        }

        let ours = format!("{MAP_EXPORT_MARKER}\n; last seen turn 4, of 16\nforest (1,1) in Ai.\n");
        assert!(!is_atlaclient_map(&ours));
    }

    #[test]
    fn a_stamp_survives_windows_line_endings() {
        let text = fixture().replace('\n', "\r\n");
        assert!(is_atlaclient_map(&text));
        assert_eq!(atlaclient_file_turn(&text), Some(16));
        // The one that actually decides a Windows export's merge: it reaches the stamps through
        // `unwrap_lines` rather than through `read_stamp`'s own trim, so it is a separate path.
        assert_eq!(atlaclient_ages(&text), atlaclient_ages(fixture()));
    }

    /// A region the player annotated in AtlaClient is written as `(their note) forest (30,18) ...`
    /// (`ARegion::FullName`), and `opens_a_region` requires the first word to be all lowercase, so
    /// such a header is not a header and its hex is dropped. Its stamp is dropped with it here,
    /// which is what keying the ages by region id buys: nothing is merged under a hex that was
    /// never read. The shell counts stamps rather than regions, so its two numbers can legitimately
    /// differ - that is pinned on the TypeScript side, in `atlaClientImport.test.ts`, where the
    /// arithmetic lives. Pinned rather than fixed: widening `opens_a_region` is out of scope.
    #[test]
    fn a_hex_the_player_annotated_is_dropped_while_its_stamp_is_still_a_stamp() {
        let text = "(my note) forest (42,26) in Sonchizel.\n\
                    ------------------------;16-11\n\
                    plain (44,26) in Sonchizel.\n\
                    ------------------------;16\n";

        assert!(is_atlaclient_map(text));
        assert_eq!(atlaclient_file_turn(text), Some(16));

        let ages = atlaclient_ages(text);
        assert_eq!(
            ages.len(),
            1,
            "the annotated hex has no header to key it by"
        );
        assert_eq!(parse_report_full(text).regions.len(), 1);
    }

    #[test]
    fn the_fixture_parses_with_nothing_unreadable_but_its_own_narrow_wrap() {
        let parsed = parse_report_full(fixture());
        assert_eq!(parsed.regions.len(), 83);

        // This map export is wrapped narrower than a turn report is, so four of its unit lines
        // lost their tail to the re-wrap before this application ever saw the file (`ah-l09a`).
        // Those four are marked rather than read silently; nothing else on the list is a record
        // the parser could not read at all.
        let unmarked: Vec<_> = parsed
            .unreadable_lines
            .iter()
            .filter(|line| line.unit_read.is_none())
            .collect();
        assert!(unmarked.is_empty(), "unreadable: {unmarked:?}");
        assert_eq!(
            parsed
                .unreadable_lines
                .iter()
                .filter(|line| line.unit_read.is_some())
                .count(),
            4
        );

        let hex = parsed
            .regions
            .iter()
            .find(|region| region.coordinate.x == 42 && region.coordinate.y == 26)
            .expect("the fixture has a hex at (42,26)");
        assert_eq!(hex.terrain, "forest");
        assert_eq!(hex.province, "Sonchizel");
        assert_eq!(hex.population, Some(2216));
        assert_eq!(hex.products.len(), 3);
    }
}
