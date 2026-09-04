//! Turns everything the faction knows about one rectangle of the map into a report-shaped file.
//!
//! The player picks an area and what to put in it; this gathers the regions, newest description of
//! each winning, and hands them to [`super::write`]. The result is meant to be traded: a human can
//! read it, and our own import can merge it, because it is written in the game's own syntax.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::header::ReportHeader;
use super::model::ReportRegion;
use super::region::parse_region_header;
use super::unwrap::unwrap_lines;
use super::write::{write_mage_region, write_region, ExportContent};
use super::{opens_a_region, ParsedReport};
use crate::cache::ReportCache;
use crate::movement::graph::RememberedRegion;

/// The first line the exporter writes, and the whole test for whether a file is one of ours.
///
/// The shell has its own copy in `packages/shared/src/mapExportImport.ts`; nothing compiles a check
/// between the two, so the smoke suite's round trip is what catches a divergence.
pub const MAP_EXPORT_MARKER: &str = "; Map export from Atlantis HUD";

/// The opening of every per-hex age comment; see [`staleness_note`].
const STALENESS_PREFIX: &str = "; last seen turn ";

/// Whether this text is one of our own map exports.
///
/// The marker is looked for on the first non-blank line only, so a turn report that happens to
/// quote the phrase further down is not caught.
#[must_use]
pub fn is_map_export(text: &str) -> bool {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .is_some_and(|line| line == MAP_EXPORT_MARKER)
}

/// The turn each hex was actually last seen, by `region_id`.
///
/// A hex the exporter saw on the export turn itself carries no comment ([`staleness_note`] returns
/// `None` when the age is zero) and is absent here; the caller stamps those with the file's own
/// turn.
#[must_use]
pub fn map_export_ages(text: &str) -> BTreeMap<String, u32> {
    let mut ages = BTreeMap::new();
    let mut pending: Option<u32> = None;

    for line in unwrap_lines(text) {
        let body = line.body();
        if let Some(rest) = body.strip_prefix(STALENESS_PREFIX) {
            // Both forms `staleness_note` writes open the same way; the digits stop at the comma.
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            pending = digits.parse().ok();
            continue;
        }

        // `opens_a_region` is what tells a region header from an exit line, which parses as one on
        // its own.
        if opens_a_region(&line) {
            if let (Some(turn), Some(region)) = (pending.take(), parse_region_header(body)) {
                ages.insert(region.region_id, turn);
            }
        }
    }

    ages
}

/// The area, level and content one export covers.
///
/// The corners are inclusive and may be given in either order: they come from a drag on the map,
/// where nothing says which corner the player started at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapExportRequest {
    pub level: u32,
    pub from_x: i32,
    pub from_y: i32,
    pub to_x: i32,
    pub to_y: i32,
    pub content: ExportContent,
}

impl MapExportRequest {
    /// Whether a region falls inside the requested area.
    #[must_use]
    pub fn covers(&self, region: &ReportRegion) -> bool {
        let coordinate = region.coordinate;
        coordinate.z == self.level
            && between(coordinate.x, self.from_x, self.to_x)
            && between(coordinate.y, self.from_y, self.to_y)
    }
}

fn between(value: i32, one_end: i32, other_end: i32) -> bool {
    value >= one_end.min(other_end) && value <= one_end.max(other_end)
}

/// Writes the known map inside the request's rectangle.
#[must_use]
pub fn export_map(
    report: &ParsedReport,
    remembered: &[RememberedRegion],
    request: &MapExportRequest,
) -> String {
    let regions = gather(report, remembered, request);
    let turn = report.header.turn_number;

    let mut text = preamble(request, regions.len());
    text.push_str(&write_header(&report.header));

    for shared in &regions {
        if let Some(note) = staleness_note(shared.last_seen_turn, turn) {
            text.push_str(&note);
            text.push('\n');
        }
        text.push_str(&write_region(&shared.region, &request.content));
    }

    text
}

/// One region as it will be written, with the turn its description came from.
struct SharedRegion {
    region: ReportRegion,
    last_seen_turn: Option<u32>,
}

/// Everything known inside the rectangle, the freshest account of each hex winning.
///
/// Remembered sightings are entered oldest first and this turn's report last, which is the same
/// precedence the map itself uses: only the current report can be trusted about who is standing in
/// a hex, and a hex seen in turn seventy beats the same hex seen in turn forty.
fn gather(
    report: &ParsedReport,
    remembered: &[RememberedRegion],
    request: &MapExportRequest,
) -> Vec<SharedRegion> {
    let mut chosen: BTreeMap<String, SharedRegion> = BTreeMap::new();

    let mut ordered: Vec<&RememberedRegion> = remembered
        .iter()
        .filter(|entry| request.covers(&entry.region))
        .collect();
    ordered.sort_by_key(|entry| entry.last_seen_turn);

    for entry in ordered {
        chosen.insert(
            entry.region.region_id.clone(),
            SharedRegion {
                region: entry.region.clone(),
                last_seen_turn: Some(entry.last_seen_turn),
            },
        );
    }
    for region in report
        .regions
        .iter()
        .filter(|region| request.covers(region))
    {
        chosen.insert(
            region.region_id.clone(),
            SharedRegion {
                region: region.clone(),
                last_seen_turn: report.header.turn_number,
            },
        );
    }

    let mut regions: Vec<SharedRegion> = chosen.into_values().collect();
    // North to south, west to east, which is the order a report itself prints hexes in.
    regions.sort_by_key(|shared| (shared.region.coordinate.y, shared.region.coordinate.x));
    regions
}

/// The first line every mage sheet carries, and the whole test for whether a file is one.
///
/// The shell will gain its own copy in `packages/shared` when the import side is built; nothing
/// compiles a check between the two, so a round trip is what catches a divergence.
pub const MAGE_SHEET_MARKER: &str = "; Mage sheet from Atlantis HUD";

/// Writes the named units as a report fragment an ally's client can read back.
///
/// `unit_ids` decides who is a mage; this function never asks the ruleset. The shell already
/// derives that list with `magesOf`, and a second definition in Rust is a second thing to drift.
#[must_use]
pub fn export_mage_sheet(report: &ParsedReport, unit_ids: &BTreeSet<String>) -> String {
    let mut text = String::from(MAGE_SHEET_MARKER);
    text.push('\n');
    if let Some(line) = mage_sheet_note(&report.header) {
        text.push_str(&line);
        text.push('\n');
    }
    text.push('\n');
    text.push_str(&write_header(&report.header));

    for region in &report.regions {
        if region
            .units
            .iter()
            .any(|unit| unit_ids.contains(&unit.unit_id))
        {
            text.push_str(&write_mage_region(region, unit_ids));
        }
    }

    text
}

/// One comment naming the faction and the turn, for a person opening the file in a mail client.
///
/// The real report header underneath is what an importer reads; this is for the human. With
/// neither a faction nor a turn there is nothing to say, and the line is omitted.
fn mage_sheet_note(header: &ReportHeader) -> Option<String> {
    let faction = match (&header.faction_name, &header.faction_id) {
        // The id is the half that identifies a faction, so a nameless one still gets a line.
        (Some(name), Some(id)) => Some(format!("{name} ({id})")),
        (None, Some(id)) => Some(format!("({id})")),
        (Some(name), None) => Some(name.clone()),
        (None, None) => None,
    };

    match (faction, header.turn_number) {
        (Some(faction), Some(turn)) => Some(format!("; {faction}, turn {turn}")),
        (Some(faction), None) => Some(format!("; {faction}")),
        (None, Some(turn)) => Some(format!("; turn {turn}")),
        (None, None) => None,
    }
}

/// The same, over the wire shape the adapters carry.
///
/// # Errors
///
/// Returns an error when `unit_ids_json` cannot be read as a list of strings.
pub fn export_mage_sheet_text(
    cache: &mut ReportCache,
    raw_report: &str,
    unit_ids_json: &str,
) -> Result<String, String> {
    let unit_ids: BTreeSet<String> = serde_json::from_str(unit_ids_json)
        .map_err(|error| format!("unit ids could not be read: {error}"))?;

    let report = cache.report(raw_report);
    Ok(export_mage_sheet(&report, &unit_ids))
}

/// The comment lines saying what this file is, before it starts pretending to be a report.
fn preamble(request: &MapExportRequest, regions: usize) -> String {
    let yes_or_no = |included: bool| if included { "yes" } else { "no" };

    format!(
        "{}\n\
         ; level {}, hexes ({},{}) to ({},{}), {} region{}\n\
         ; structures: {}, units: {}, advanced resources: {}\n\n",
        MAP_EXPORT_MARKER,
        request.level,
        request.from_x.min(request.to_x),
        request.from_y.min(request.to_y),
        request.from_x.max(request.to_x),
        request.from_y.max(request.to_y),
        regions,
        if regions == 1 { "" } else { "s" },
        yes_or_no(request.content.structures),
        yes_or_no(request.content.units),
        yes_or_no(request.content.advanced_resources),
    )
}

/// The report preamble, so the file identifies its faction and turn the way a real one does.
fn write_header(header: &ReportHeader) -> String {
    let mut text = String::from("Atlantis Report For:\n");

    if let (Some(name), Some(id)) = (&header.faction_name, &header.faction_id) {
        text.push_str(&format!("{name} ({id})"));
        if !header.faction_types.is_empty() {
            // One comma-separated parenthetical, which is what the game writes and what
            // `parse_faction` can find an id in front of.
            text.push_str(&format!(" ({})", header.faction_types.join(", ")));
        }
        text.push('\n');
    }
    if let (Some(month), Some(year)) = (&header.month, header.year) {
        text.push_str(&format!("{month}, Year {year}\n"));
    }

    text.push('\n');
    text
}

/// How old a remembered description is, written where the reader meets the data it qualifies.
///
/// A hex described in the report being exported from gets nothing: it is as fresh as the file
/// itself. Everything else names its turn, and says how far back that was whenever the arithmetic
/// means anything - which it does not when the player has loaded an *older* turn than their memory
/// reaches, a thing the application lets them do. The turn is still named in that case, because a
/// bare figure the recipient can compare against their own is worth more than a silence.
fn staleness_note(last_seen_turn: Option<u32>, current_turn: Option<u32>) -> Option<String> {
    let seen = last_seen_turn?;
    let Some(age) = current_turn.and_then(|current| current.checked_sub(seen)) else {
        return Some(format!("{STALENESS_PREFIX}{seen}"));
    };

    if age == 0 {
        return None;
    }

    Some(format!(
        "{STALENESS_PREFIX}{seen}, {age} turn{} before this export",
        if age == 1 { "" } else { "s" }
    ))
}

/// The same, over the wire shapes the adapters carry.
///
/// # Errors
///
/// Returns an error when the remembered regions or the request cannot be read.
pub fn export_map_text(
    cache: &mut ReportCache,
    raw_report: &str,
    remembered_json: &str,
    request_json: &str,
) -> Result<String, String> {
    let remembered: Vec<RememberedRegion> = serde_json::from_str(remembered_json)
        .map_err(|error| format!("remembered regions could not be read: {error}"))?;
    let request: MapExportRequest = serde_json::from_str(request_json)
        .map_err(|error| format!("export request could not be read: {error}"))?;

    let report = cache.report(raw_report);
    Ok(export_map(&report, &remembered, &request))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::parse_report_full;

    const REPORT: &str = concat!(
        "Atlantis Report For:\n",
        "Borg TNG (95) (Magic 5)\n",
        "December, Year 6\n",
        "\n",
        "mountain (7,53) in Inhead, 12051 peasants (hill dwarves), $33983.\n",
        "------------------------------------------------------------\n",
        "  Wages: $24.1 (Max: $6796).\n",
        "  Products: 57 grain [GRAI].\n",
        "\n",
        "Exits:\n",
        "  North : mountain (7,51) in Inhead.\n",
        "\n",
        "* Seven of Eight (18642), Borg TNG (95), behind, leader [LEAD].\n",
    );

    fn remembered_at(x: i32, y: i32, z: u32, turn: u32) -> RememberedRegion {
        let source = format!("forest ({x},{y}{}) in Elsewhere.\n", level_suffix(z));
        let region = parse_report_full(&source)
            .regions
            .into_iter()
            .next()
            .expect("fixture region");
        RememberedRegion {
            region,
            last_seen_turn: turn,
        }
    }

    fn level_suffix(z: u32) -> String {
        if z == 1 {
            String::new()
        } else {
            format!(",{z}")
        }
    }

    fn request(from: (i32, i32), to: (i32, i32)) -> MapExportRequest {
        MapExportRequest {
            level: 1,
            from_x: from.0,
            from_y: from.1,
            to_x: to.0,
            to_y: to.1,
            content: ExportContent::default(),
        }
    }

    fn exported(remembered: &[RememberedRegion], request: &MapExportRequest) -> Vec<String> {
        let text = export_map(&parse_report_full(REPORT), remembered, request);
        parse_report_full(&text)
            .regions
            .into_iter()
            .map(|region| region.region_id)
            .collect()
    }

    #[test]
    fn keeps_the_regions_inside_the_rectangle_including_its_edges() {
        let remembered = vec![
            remembered_at(4, 50, 1, 68),
            remembered_at(6, 52, 1, 68),
            remembered_at(8, 54, 1, 68),
        ];

        let ids = exported(&remembered, &request((4, 50), (8, 54)));
        assert_eq!(ids, vec!["1:4,50", "1:6,52", "1:7,53", "1:8,54"]);
    }

    #[test]
    fn drops_the_regions_outside_it() {
        let remembered = vec![remembered_at(4, 50, 1, 68), remembered_at(20, 60, 1, 68)];

        let ids = exported(&remembered, &request((4, 50), (8, 54)));
        assert!(!ids.contains(&"1:20,60".to_string()), "{ids:?}");
    }

    #[test]
    fn reads_the_corners_in_either_order() {
        let remembered = vec![remembered_at(4, 50, 1, 68)];

        assert_eq!(
            exported(&remembered, &request((8, 54), (4, 50))),
            exported(&remembered, &request((4, 50), (8, 54)))
        );
    }

    #[test]
    fn covers_only_the_requested_level() {
        let remembered = vec![remembered_at(6, 52, 2, 68)];

        let ids = exported(&remembered, &request((4, 50), (8, 54)));
        assert_eq!(ids, vec!["1:7,53"], "the cavern below is a different map");
    }

    #[test]
    fn prefers_this_turn_over_a_remembered_sighting_of_the_same_hex() {
        let stale = parse_report_full(concat!(
            "mountain (7,53) in Inhead, 3 peasants (hill dwarves), $9.\n",
            "------------------------------------------------------------\n",
            "  Products: 1 grain [GRAI].\n",
        ))
        .regions
        .into_iter()
        .next()
        .expect("fixture region");
        let remembered = vec![RememberedRegion {
            region: stale,
            last_seen_turn: 52,
        }];

        let text = export_map(
            &parse_report_full(REPORT),
            &remembered,
            &request((4, 50), (8, 54)),
        );
        let region = parse_report_full(&text)
            .regions
            .into_iter()
            .find(|region| region.region_id == "1:7,53")
            .expect("the hex should be exported once");

        assert_eq!(region.population, Some(12051), "this turn's description");
        assert!(
            !text.contains("last seen turn"),
            "a hex in this turn's report is not stale:\n{text}"
        );
    }

    #[test]
    fn marks_a_remembered_hex_with_the_turn_it_was_seen_in() {
        let remembered = vec![remembered_at(4, 50, 1, 68)];
        let text = export_map(
            &parse_report_full(REPORT),
            &remembered,
            &request((4, 50), (8, 54)),
        );

        assert!(
            text.contains("; last seen turn 68, 3 turns before this export"),
            "the age belongs beside the data it qualifies:\n{text}"
        );
    }

    /**
     * Loading an older turn than the memory reaches is something the application offers, so a
     * remembered hex can be newer than the report being exported from. It still names its turn:
     * the arithmetic is what stops making sense, not the fact.
     */
    #[test]
    fn names_the_turn_of_a_hex_remembered_after_the_report_being_exported() {
        let remembered = vec![remembered_at(4, 50, 1, 80)];
        let text = export_map(
            &parse_report_full(REPORT),
            &remembered,
            &request((4, 50), (8, 54)),
        );

        assert!(text.contains("; last seen turn 80"), "{text}");
        assert!(
            !text.contains("before this export"),
            "an age counted backwards would be a fiction:\n{text}"
        );
    }

    #[test]
    fn heads_the_file_with_the_faction_and_the_turn() {
        let text = export_map(&parse_report_full(REPORT), &[], &request((4, 50), (8, 54)));

        assert!(text.contains("Atlantis Report For:"), "{text}");
        assert!(text.contains("Borg TNG (95)"), "{text}");
        assert!(text.contains("December, Year 6"), "{text}");
        assert!(
            text.contains("; level 1, hexes (4,50) to (8,54), 1 region"),
            "the comment block says what was exported:\n{text}"
        );
    }

    #[test]
    fn says_in_the_header_what_was_left_out() {
        let mut request = request((4, 50), (8, 54));
        request.content = ExportContent {
            structures: true,
            units: false,
            advanced_resources: false,
        };

        let text = export_map(&parse_report_full(REPORT), &[], &request);
        assert!(
            text.contains("; structures: yes, units: no, advanced resources: no"),
            "{text}"
        );
    }

    #[test]
    fn exports_nothing_but_a_header_when_the_rectangle_is_empty() {
        let text = export_map(
            &parse_report_full(REPORT),
            &[],
            &request((40, 40), (44, 44)),
        );

        assert!(parse_report_full(&text).regions.is_empty());
        assert!(text.contains("0 regions"), "{text}");
    }

    #[test]
    fn reads_the_wire_shapes_the_adapters_carry() {
        let remembered = serde_json::to_string(&vec![remembered_at(4, 50, 1, 68)]).expect("json");
        let request = serde_json::to_string(&request((4, 50), (8, 54))).expect("json");

        let mut cache = ReportCache::new();
        let text = export_map_text(&mut cache, REPORT, &remembered, &request).expect("export");

        assert_eq!(parse_report_full(&text).regions.len(), 2);
    }

    #[test]
    fn refuses_a_request_it_cannot_read() {
        let mut cache = ReportCache::new();
        assert!(export_map_text(&mut cache, REPORT, "[]", "not json").is_err());
        assert!(export_map_text(&mut cache, REPORT, "not json", "{}").is_err());
    }

    /**
     * The game prints one parenthetical holding every faction type, comma separated. Writing one
     * bracket per type made the id unfindable to our own parser, so a multi-type faction's export
     * could not be read back at all.
     */
    #[test]
    fn faction_types_are_written_as_one_parenthetical() {
        let mut header = ReportHeader {
            faction_id: Some("42".into()),
            faction_name: Some("The Disinherited Knights".into()),
            ..ReportHeader::default()
        };
        header.faction_types = vec!["War 1".into(), "Trade 1".into(), "Magic 1".into()];

        let text = write_header(&header);

        assert!(
            text.contains("The Disinherited Knights (42) (War 1, Trade 1, Magic 1)"),
            "the game's own shape:\n{text}"
        );
        assert!(
            !text.contains(") (Trade"),
            "one parenthetical, not one per type:\n{text}"
        );
    }

    #[test]
    fn a_faction_with_no_types_gets_no_empty_parenthetical() {
        let header = ReportHeader {
            faction_id: Some("42".into()),
            faction_name: Some("The Disinherited Knights".into()),
            ..ReportHeader::default()
        };

        let text = write_header(&header);

        assert!(text.contains("The Disinherited Knights (42)\n"), "{text}");
        assert!(!text.contains("()"), "{text}");
    }

    #[test]
    fn a_map_export_is_recognised_by_its_first_line() {
        let export = export_map(&parse_report_full(REPORT), &[], &request((4, 50), (8, 54)));

        assert!(is_map_export(&export), "our own output:\n{export}");
        assert!(!is_map_export(REPORT), "a turn report is not a map export");
        assert!(!is_map_export(""), "empty text names nothing");
        assert!(
            !is_map_export(&format!("{REPORT}\n{MAP_EXPORT_MARKER}\n")),
            "the marker counts on the first line only"
        );
        assert!(
            is_map_export(&format!("\n\n{export}")),
            "leading blank lines are skipped"
        );
    }

    #[test]
    fn each_remembered_hex_carries_the_turn_it_was_seen() {
        let remembered = vec![remembered_at(4, 50, 1, 60)];
        let text = export_map(
            &parse_report_full(REPORT),
            &remembered,
            &request((4, 50), (8, 54)),
        );

        let ages = map_export_ages(&text);

        assert_eq!(ages.get("1:4,50"), Some(&60), "the remembered hex's turn");
        assert_eq!(
            ages.get("1:7,53"),
            None,
            "a hex from the export's own turn carries no age"
        );
    }

    #[test]
    fn an_exit_line_is_never_taken_for_a_hex_of_its_own() {
        let remembered = vec![remembered_at(4, 50, 1, 60)];
        let text = export_map(
            &parse_report_full(REPORT),
            &remembered,
            &request((4, 50), (8, 54)),
        );

        let ages = map_export_ages(&text);

        assert_eq!(ages.len(), 1, "one aged hex, not its exits too: {ages:?}");
    }

    const MAGE_REPORT: &str = concat!(
        "Atlantis Report For:\n",
        "Borg (21) (Magic 5)\n",
        "December, Year 6\n",
        "\n",
        "plain (3,7) in Isaen, contains Sarn [village], 1200 peasants (humans), $600.\n",
        "------------------------------------------------------------\n",
        "  Wages: $12.5 (Max: $400).\n",
        "  Wanted: 10 grain [GRAI] at $30.\n",
        "  For Sale: 5 leather armor [LARM] at $90.\n",
        "  Products: 57 grain [GRAI].\n",
        "\n",
        "Exits:\n",
        "  North : plain (3,5) in Isaen.\n",
        "\n",
        "* Woodsman (300), Borg (21), behind, 2 leaders [LEAD]. Skills: lumberjack [LUMB] 2 (90).\n",
        "* Outdoor Mage (301), Borg (21), behind, 1 leader [LEAD]. Skills: force [FORC] 3 (180), pattern [PATT] 1 (30).\n",
        "\n",
        "+ Tower [500] : Tower.\n",
        "  * Housed Mage (302), Borg (21), behind, 1 leader [LEAD]. Skills: force [FORC] 2 (105).\n",
        "\n",
        "+ Shed [501] : Shaft.\n",
        "  * Miner (303), Borg (21), behind, 1 leader [LEAD]. Skills: mining [MINI] 1 (30).\n",
    );

    fn mage_ids() -> BTreeSet<String> {
        ["301".to_string(), "302".to_string()].into_iter().collect()
    }

    #[test]
    fn a_mage_sheet_reads_back_as_the_named_mages_owned_by_nobody() {
        let text = export_mage_sheet(&parse_report_full(MAGE_REPORT), &mage_ids());
        assert!(
            text.starts_with(MAGE_SHEET_MARKER),
            "the marker opens the file:\n{text}"
        );

        let back = parse_report_full(&text);
        let units: Vec<_> = back.regions.iter().flat_map(|r| r.units.iter()).collect();
        assert_eq!(units.len(), 2, "only the named mages:\n{text}");

        let outdoor = units
            .iter()
            .find(|unit| unit.unit_id == "301")
            .expect("the outdoor mage");
        assert_eq!(outdoor.name, "Outdoor Mage");
        assert!(
            !outdoor.own,
            "a sheet must not arrive as the ally's own units"
        );
        assert_eq!(outdoor.faction_id.as_deref(), Some("21"));
        assert_eq!(outdoor.faction_name.as_deref(), Some("Borg"));
        assert_eq!(outdoor.structure_id, None);
        let skills: Vec<_> = outdoor
            .skills
            .iter()
            .map(|skill| (skill.tag.as_str(), skill.level, skill.points))
            .collect();
        assert_eq!(skills, vec![("FORC", 3, 180), ("PATT", 1, 30)]);

        let housed = units
            .iter()
            .find(|unit| unit.unit_id == "302")
            .expect("the housed mage");
        assert!(
            !housed.own,
            "a sheet must not arrive as the ally's own units"
        );
        assert_eq!(housed.structure_id.as_deref(), Some("500"));

        assert!(
            !units.iter().any(|unit| unit.unit_id == "300"),
            "the woodcutter is not a mage:\n{text}"
        );
    }

    #[test]
    fn a_mage_sheet_shares_no_market_wages_or_exits() {
        let text = export_mage_sheet(&parse_report_full(MAGE_REPORT), &mage_ids());

        for forbidden in ["Wanted:", "For Sale:", "Products:", "Wages:", "Exits"] {
            assert!(
                !text.contains(forbidden),
                "{forbidden} is the hex's trade, not the mages':\n{text}"
            );
        }

        let region = back_region(&text);
        assert!(region.wanted.is_empty());
        assert!(region.for_sale.is_empty());
        assert!(region.products.is_empty());
        assert!(region.exits.is_empty());
    }

    fn back_region(text: &str) -> ReportRegion {
        parse_report_full(text)
            .regions
            .into_iter()
            .next()
            .expect("one region")
    }

    #[test]
    fn a_faction_with_no_mages_writes_a_sheet_with_no_units() {
        let text = export_mage_sheet(&parse_report_full(MAGE_REPORT), &BTreeSet::new());

        assert!(text.starts_with(MAGE_SHEET_MARKER), "{text}");
        assert!(text.contains("Atlantis Report For:"), "{text}");
        assert!(text.contains("Borg (21)"), "{text}");

        let back = parse_report_full(&text);
        assert_eq!(
            back.regions.iter().flat_map(|r| r.units.iter()).count(),
            0,
            "an empty sheet is a true statement:\n{text}"
        );
    }

    #[test]
    fn export_mage_sheet_text_reads_its_ids_and_refuses_nonsense() {
        let mut cache = ReportCache::default();
        let text = export_mage_sheet_text(&mut cache, MAGE_REPORT, "[\"301\",\"302\"]")
            .expect("a good id list");
        assert_eq!(
            text,
            export_mage_sheet(&parse_report_full(MAGE_REPORT), &mage_ids())
        );

        assert!(export_mage_sheet_text(&mut cache, MAGE_REPORT, "{").is_err());
    }

    /// The buildings are the player's secret as much as the market is: a structure nobody named
    /// stands in has no business appearing in a file about mages.
    #[test]
    fn a_mage_sheet_leaves_out_a_structure_holding_no_named_unit() {
        let text = export_mage_sheet(&parse_report_full(MAGE_REPORT), &mage_ids());

        assert!(
            text.contains("Tower [500]"),
            "the mage's own tower:\n{text}"
        );
        assert!(
            !text.contains("Shed [501]"),
            "a building with no named mage in it is not shared:\n{text}"
        );
        assert!(!text.contains("Miner"), "{text}");
    }

    /// The comment line a person reads when the file arrives in their mail.
    ///
    /// Every one of the four faction shapes is pinned against both a known and an unknown turn,
    /// because the navigator settled the cases one at a time; the name-with-no-id shape is mine,
    /// and follows the id-only case in naming whichever half identifies the faction.
    #[test]
    fn the_human_comment_names_whichever_of_the_faction_and_the_turn_is_known() {
        let note = |name: Option<&str>, id: Option<&str>, turn: Option<u32>| {
            let header = ReportHeader {
                faction_name: name.map(str::to_string),
                faction_id: id.map(str::to_string),
                turn_number: turn,
                ..ReportHeader::default()
            };
            mage_sheet_note(&header)
        };

        assert_eq!(
            note(Some("Borg"), Some("21"), Some(23)).as_deref(),
            Some("; Borg (21), turn 23")
        );
        assert_eq!(
            note(Some("Borg"), Some("21"), None).as_deref(),
            Some("; Borg (21)")
        );
        assert_eq!(note(None, None, Some(23)).as_deref(), Some("; turn 23"));
        assert_eq!(note(None, None, None), None, "nothing to say, so no line");
        assert_eq!(
            note(None, Some("21"), Some(23)).as_deref(),
            Some("; (21), turn 23"),
            "the id is the half that identifies a faction"
        );
        assert_eq!(
            note(Some("Borg"), None, Some(23)).as_deref(),
            Some("; Borg, turn 23"),
            "a name with no id still names the sender"
        );
        assert_eq!(note(None, Some("21"), None).as_deref(), Some("; (21)"));
        assert_eq!(note(Some("Borg"), None, None).as_deref(), Some("; Borg"));
    }
}
