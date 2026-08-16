//! Acceptance tests for `resolve_known_map`: the one place the precedence rules for the
//! accumulated map are written, pinned rule by rule.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::known_map::{known_map_json, resolve_known_map, HexKnowledge, MapLevel};
use atlantis_hud_core::movement::graph::RememberedRegion;
use atlantis_hud_core::report::parse_report_full;
use atlantis_hud_core::report::region::parse_region_header;

mod common;
use common::at;

/// A single-region report at the given turn, with an exit to keep a neighbour company.
fn report_at_turn(
    terrain: &str,
    month: &str,
    year: u32,
    units: &str,
) -> atlantis_hud_core::report::ParsedReport {
    parse_report_full(&format!(
        "Atlantis Report For:\nFoo (1)\n{month}, Year {year}\n\n\
         {terrain} (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n\n\
         {units}",
    ))
}

fn empty_report(month: &str, year: u32) -> atlantis_hud_core::report::ParsedReport {
    parse_report_full(&format!(
        "Atlantis Report For:\nFoo (1)\n{month}, Year {year}\n"
    ))
}

/// The current report always wins wherever it disagrees with a stored sighting, and only the
/// current description can be trusted about who is standing there.
#[test]
fn a_current_report_hex_beats_a_stored_sighting_of_it() {
    let remembered_region = report_at_turn(
        "plain",
        "February",
        1,
        "- Someone (500), Bar (2), 3 orcs [ORC].\n",
    )
    .regions[0]
        .clone();

    let current = report_at_turn("mountain", "March", 1, "");

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: remembered_region,
            last_seen_turn: 1,
        }],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("known");
    assert_eq!(hex.knowledge, HexKnowledge::Current);
    assert_eq!(hex.terrain, "mountain", "the current report's terrain wins");
    assert_eq!(hex.last_seen_turn, Some(2), "March, Year 1 is turn 2");
    assert!(
        hex.region.as_ref().unwrap().units.is_empty(),
        "a remembered garrison is not evidence of a present one"
    );
}

/// A sighting from an earlier turn is stale, and only stale sightings drop their units - a unit
/// standing there when last seen may have moved, disbanded or died since.
#[test]
fn an_older_sighting_is_stale_and_keeps_no_units() {
    let older = report_at_turn(
        "swamp",
        "February",
        1,
        "- Someone (500), Bar (2), 3 orcs [ORC].\n",
    )
    .regions[0]
        .clone();

    let current = empty_report("December", 6);

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: older,
            last_seen_turn: 1,
        }],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("known");
    assert_eq!(hex.knowledge, HexKnowledge::Stale);
    assert_eq!(hex.terrain, "swamp");
    assert!(hex.region.as_ref().unwrap().units.is_empty());
}

/// The ally-units merge (rule 4) looks up a same-turn stored sighting by coordinate, and that
/// lookup must be as deterministic as the direct-sighting resolution (rule 3) it sits beside: two
/// remembered entries for the same hex - one a same-turn ally sighting, one an older, stale one -
/// must resolve to the same winner regardless of which the input lists last, or the ally's units
/// can be silently dropped depending on storage's iteration order (found in review of ah-u4e.1).
#[test]
fn the_allys_units_merge_ignores_a_stale_duplicate_of_the_same_hex() {
    let stale = report_at_turn(
        "swamp",
        "February",
        1,
        "- Nobody (999), Bar (2), 1 orc [ORC].\n",
    )
    .regions[0]
        .clone();
    let same_turn = report_at_turn(
        "swamp",
        "December",
        6,
        "- Someone (500), Bar (2), 3 orcs [ORC].\n",
    )
    .regions[0]
        .clone();

    // The current report, at turn 71, visits the hex itself, with a unit of its own.
    let current = report_at_turn("swamp", "December", 6, "* Us (100), 1 man [MAN].\n");

    // Listed most-recent-first, which is what would fool an unsorted "last in the slice wins"
    // lookup into picking the stale entry instead.
    let known = resolve_known_map(
        &current,
        &[
            RememberedRegion {
                region: same_turn,
                last_seen_turn: 71,
            },
            RememberedRegion {
                region: stale,
                last_seen_turn: 1,
            },
        ],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("known");
    let units = &hex.region.as_ref().unwrap().units;
    assert_eq!(
        units
            .iter()
            .map(|unit| unit.unit_id.as_str())
            .collect::<Vec<_>>(),
        vec!["100", "500"],
        "the same-turn ally's unit should merge in, not the stale sighting's"
    );
}

/// Storage is expected to hand back one sighting per coordinate, but nothing enforces it - two
/// direct sightings of the same hex must still settle on an answer rather than an unspecified one,
/// and it should be the more recent sighting, exactly as the naming rules already prefer.
#[test]
fn two_direct_sightings_of_the_same_hex_settle_on_the_more_recent_one() {
    let older = report_at_turn("swamp", "February", 1, "").regions[0].clone();
    let newer = report_at_turn("forest", "March", 1, "").regions[0].clone();

    let current = empty_report("December", 6);

    let known = resolve_known_map(
        &current,
        &[
            RememberedRegion {
                region: newer,
                last_seen_turn: 2,
            },
            RememberedRegion {
                region: older,
                last_seen_turn: 1,
            },
        ],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("known");
    assert_eq!(hex.terrain, "forest", "the more recent sighting wins");
    assert_eq!(hex.last_seen_turn, Some(2));
}

/// A sighting from this same turn - a hex only an ally reported, with none of our own units in it
/// - is as fresh as anything in the current report, so it is `Current` and keeps its units.
#[test]
fn a_same_turn_ally_sighting_is_current_and_keeps_its_units() {
    let ally_sighting = report_at_turn(
        "plain",
        "February",
        1,
        "- Someone (500), Bar (2), 3 orcs [ORC].\n",
    )
    .regions[0]
        .clone();

    // The current report says nothing about (1,1) at all - the ally sighting is the only account.
    let current = empty_report("February", 1);

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: ally_sighting,
            last_seen_turn: 1,
        }],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("known");
    assert_eq!(hex.knowledge, HexKnowledge::Current);
    assert_eq!(
        hex.region.as_ref().unwrap().units.len(),
        1,
        "the ally's unit should still be here"
    );
}

/// A same-turn stored sighting's extra units join the current report's own account of the hex,
/// appended and marked foreign - additive only, and never replacing what the report already names.
#[test]
fn an_allys_units_join_the_current_hex_marked_foreign() {
    let ally_sighting = report_at_turn(
        "plain",
        "February",
        1,
        "- Someone (500), Bar (2), 3 orcs [ORC].\n",
    )
    .regions[0]
        .clone();

    // The current report describes the same hex, with a unit of our own, but knows nothing of the
    // ally's stranger.
    let current = report_at_turn("plain", "February", 1, "* Us (100), 1 man [MAN].\n");

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: ally_sighting,
            last_seen_turn: 1,
        }],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("known");
    let units = &hex.region.as_ref().unwrap().units;
    assert_eq!(units.len(), 2, "our own unit plus the ally's stranger");
    assert_eq!(units[0].unit_id, "100", "the report's own unit comes first");
    let extra = &units[1];
    assert_eq!(extra.unit_id, "500");
    assert!(!extra.own, "a unit contributed this way is never ours");
}

/// Namings from memory: a later turn's naming overwrites an earlier one, and within one turn the
/// first naming wins.
#[test]
fn an_older_naming_is_overwritten_by_a_newer_one_and_the_first_in_a_turn_wins() {
    let older = report_at_turn("swamp", "February", 1, "").regions[0].clone();
    let newer = report_at_turn("forest", "March", 1, "").regions[0].clone();

    // Neither report actually visits (2,2); each merely names it through its own exit.
    let current = empty_report("December", 6);

    let known = resolve_known_map(
        &current,
        &[
            RememberedRegion {
                region: older,
                last_seen_turn: 1,
            },
            RememberedRegion {
                region: newer,
                last_seen_turn: 2,
            },
        ],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(2, 2))
        .expect("named");
    assert_eq!(hex.knowledge, HexKnowledge::Named);
    assert_eq!(hex.terrain, "plain", "both exits name it the same way");
    assert_eq!(
        hex.last_seen_turn,
        Some(2),
        "the newer sighting's naming wins"
    );
}

/// The current report's own naming always wins over anything remembered, whatever turn it carries.
#[test]
fn the_current_reports_naming_wins_over_memorys() {
    // A memory that named (2,2) as swamp at turn 1.
    let remembered_naming = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nFebruary, Year 1\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : swamp (2,2) in Nowhere.\n",
    )
    .regions[0]
        .clone();

    // The current report, at turn 71, names the same hex as plain through its own exit - not
    // through a remembered region at all, so this exercises rule 2 rather than rule 4.
    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n\
         plain (5,5) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n",
    );

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: remembered_naming,
            last_seen_turn: 1,
        }],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(2, 2))
        .expect("named");
    assert_eq!(hex.knowledge, HexKnowledge::Named);
    assert_eq!(hex.terrain, "plain", "the current report's own naming wins");
    assert_eq!(hex.last_seen_turn, Some(71), "December, Year 6 is turn 71");
}

/// A visited hex - current or stale - always beats one merely named by an exit.
#[test]
fn a_visited_hex_beats_one_merely_named() {
    // (2,2) is both stood in by an older sighting and merely named by the current report's exit.
    let older = report_at_turn("swamp", "February", 1, "").regions[0].clone();
    let mut moved = older.clone();
    moved.coordinate = at(2, 2);
    moved.region_id = "1:2,2".to_string();

    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : forest (2,2) in Nowhere.\n",
    );

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: moved,
            last_seen_turn: 1,
        }],
    );

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(2, 2))
        .expect("known");
    assert_eq!(
        hex.knowledge,
        HexKnowledge::Stale,
        "the stored visit wins over the naming"
    );
    assert_eq!(hex.terrain, "swamp");
}

/// The resolved hexes come out sorted by level, then row, then column - the order the screen has
/// always drawn in.
#[test]
fn hexes_come_out_sorted_by_level_then_row_then_column() {
    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n\
         plain (5,5) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  North : plain (5,3) in Nowhere.\n  South : plain (5,7) in Nowhere.\n\
         Southwest : plain (4,6) in Nowhere.\n",
    );

    let known = resolve_known_map(&current, &[]);

    let coordinates: Vec<(i32, i32)> = known
        .hexes
        .iter()
        .map(|hex| (hex.coordinate.y, hex.coordinate.x))
        .collect();
    let mut sorted = coordinates.clone();
    sorted.sort_unstable();
    assert_eq!(
        coordinates, sorted,
        "already sorted by y then x within one level"
    );
}

/// A hex known only by name keeps the settlement its exit names, so a named town does not lose its
/// label when the map is drawn from the resolved hex rather than the raw report.
#[test]
fn a_named_hex_keeps_the_settlement_its_exits_names() {
    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere, contains Foo [village].\n",
    );

    let known = resolve_known_map(&current, &[]);

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(2, 2))
        .expect("named");
    assert_eq!(hex.knowledge, HexKnowledge::Named);
    let settlement = hex.settlement.as_ref().expect("settlement carried");
    assert_eq!(settlement.name, "Foo");
    assert_eq!(settlement.size, "village");
}

/// A visited hex carries its own settlement too, from the region as reported rather than from an
/// exit.
#[test]
fn a_visited_hex_carries_its_own_settlement() {
    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n\
         mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants (hill dwarves), $33983.\n",
    );

    let known = resolve_known_map(&current, &[]);

    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(7, 53))
        .expect("known");
    assert_eq!(hex.knowledge, HexKnowledge::Current);
    let settlement = hex.settlement.as_ref().expect("settlement carried");
    assert_eq!(settlement.name, "Inholm");
    assert_eq!(settlement.size, "city");
}

const REPORT: &str = concat!(
    "Atlantis Report For:\n",
    "Foo (1)\n",
    "December, Year 6\n",
    "\n",
    "plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n",
    "\n",
    "Exits:\n",
    "  Southeast : plain (2,2) in Nowhere.\n",
);

/// The boundary entry parses the raw report and the remembered regions itself, and resolves them
/// exactly as `resolve_known_map` would given the same arguments.
#[test]
fn known_map_json_reads_its_arguments() {
    let mut cache = ReportCache::default();

    let known = known_map_json(&mut cache, REPORT, None, "[]").expect("resolves");

    assert!(
        known.current_turn.is_some(),
        "the current report's own date is read"
    );
    let hex = known
        .hexes
        .iter()
        .find(|hex| hex.coordinate == at(1, 1))
        .expect("the current report's own region is known");
    assert_eq!(hex.knowledge, HexKnowledge::Current);
}

/// Unreadable remembered JSON is refused with a message naming what could not be read, the same
/// wording `export_map_text` and `plan_for_remembered_report` already use.
#[test]
fn rejects_unreadable_remembered_json() {
    let mut cache = ReportCache::default();

    let error = known_map_json(&mut cache, REPORT, None, "not json").expect_err("refused");

    assert!(
        error.starts_with("remembered regions could not be read:"),
        "unexpected message: {error}"
    );
}

/// `KnownMap.levels` lists the distinct levels the resolved hexes hold, ascending by z, each named
/// by `report::level::level_name` - the level control reads this list rather than deriving it.
#[test]
fn the_map_lists_its_levels_by_name_shallowest_first() {
    let current = report_at_turn("plain", "February", 1, "");
    let underworld_region =
        parse_region_header("cavern (7,53,underworld) in Deeps.").expect("header should parse");

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: underworld_region,
            last_seen_turn: 1,
        }],
    );

    assert_eq!(
        known.levels,
        vec![
            MapLevel {
                z: 1,
                name: "surface".to_string()
            },
            MapLevel {
                z: 2,
                name: "underworld".to_string()
            },
        ]
    );

    let nexus_report = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nFebruary, Year 1\n\n\
         nexus (0,0,nexus) in The Void.\n\n\
         Exits:\n  none\n",
    );
    let nexus_only = resolve_known_map(&nexus_report, &[]);
    assert_eq!(
        nexus_only.levels,
        vec![MapLevel {
            z: 0,
            name: "nexus".to_string()
        }]
    );

    let empty = empty_report("February", 1);
    let known_empty = resolve_known_map(&empty, &[]);
    assert!(known_empty.levels.is_empty());
}

/// A nexus sighting stored before ah-4b4 - at `(0,0)` on the surface, the shape the parser wrote
/// before it could read the level field - is repaired at read time onto its own level, so a game
/// imported before the fix draws the nexus correctly without a store migration.
#[test]
fn a_nexus_sighting_stored_on_the_surface_is_given_its_level_back() {
    let legacy_nexus = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nFebruary, Year 1\n\n\
         nexus (0,0) in The Void, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n\n\
         - City Guard (1), on guard, Atlantis Defense (999), 10 vikings [VIKI].\n",
    )
    .regions[0]
        .clone();
    assert_eq!(legacy_nexus.coordinate.z, 1, "the pre-fix shape");
    assert_eq!(
        legacy_nexus.units[0].region_id, "1:0,0",
        "the unit's own region_id carries the pre-fix shape too"
    );

    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nMarch, Year 1\n\n\
         mountain (36,4) in Slounspifra, 5 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (37,5) in Nowhere.\n",
    );

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: legacy_nexus,
            last_seen_turn: 1,
        }],
    );

    let nexus_hex = known
        .hexes
        .iter()
        .find(|hex| hex.region.as_ref().is_some_and(|r| r.terrain == "nexus"))
        .expect("the nexus is still known");
    assert_eq!(nexus_hex.coordinate.z, 0);
    assert_eq!(
        nexus_hex.region.as_ref().map(|r| r.region_id.as_str()),
        Some("0:0,0")
    );
    assert_eq!(nexus_hex.knowledge, HexKnowledge::Stale);

    assert!(
        known.hexes.iter().all(|hex| hex.coordinate != at(0, 0)),
        "no hex is left at the surface origin"
    );
    assert_eq!(
        known.levels,
        vec![
            MapLevel {
                z: 0,
                name: "nexus".to_string()
            },
            MapLevel {
                z: 1,
                name: "surface".to_string()
            },
        ]
    );
}

/// The repair above only rewrites a region's own coordinate; a pre-fix sighting can also name the
/// nexus in its `exits` list at the same misfiled coordinate, and that has to be repaired too, or a
/// phantom `Named` hex reappears at the surface origin alongside the correctly repaired nexus.
#[test]
fn a_neighbours_exit_naming_the_nexus_on_the_surface_is_also_repaired() {
    let neighbour = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nFebruary, Year 1\n\n\
         plain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Northwest : nexus (0,0) in The Void.\n",
    )
    .regions[0]
        .clone();
    assert_eq!(neighbour.exits[0].coordinate.z, 1, "the pre-fix shape");

    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nMarch, Year 1\n\n\
         mountain (36,4) in Slounspifra, 5 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (37,5) in Nowhere.\n",
    );

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: neighbour,
            last_seen_turn: 1,
        }],
    );

    assert!(
        known
            .hexes
            .iter()
            .any(|hex| hex.coordinate.x == 0 && hex.coordinate.y == 0 && hex.coordinate.z == 0),
        "the nexus is named at its own level"
    );
    assert!(
        known.hexes.iter().all(|hex| hex.coordinate != at(0, 0)),
        "no phantom hex is left at the surface origin"
    );
}

/// A unit inside a misfiled region carries its own `region_id` (`ReportUnit.region_id`), separate
/// from the region's - so repairing the region's coordinate without also repairing every unit
/// inside it would leave a unit claiming to stand in `1:0,0` while its own region now reads
/// `0:0,0`. A same-turn sighting is used so `resolve_known_map`'s Rule 3 keeps the units rather
/// than dropping them as it does for an older, stale one.
#[test]
fn a_units_region_id_is_repaired_along_with_its_regions() {
    let legacy_nexus = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nFebruary, Year 1\n\n\
         nexus (0,0) in The Void, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n\n\
         - City Guard (1), on guard, Atlantis Defense (999), 10 vikings [VIKI].\n",
    )
    .regions[0]
        .clone();
    assert_eq!(
        legacy_nexus.units[0].region_id, "1:0,0",
        "the unit's own region_id carries the pre-fix shape too"
    );

    // Same turn as the sighting, and a different hex, so Rule 4 does not overwrite the nexus entry
    // and Rule 3 treats the sighting as current - keeping its units rather than dropping them.
    let current = parse_report_full(
        "Atlantis Report For:\nFoo (1)\nFebruary, Year 1\n\n\
         mountain (36,4) in Slounspifra, 5 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (37,5) in Nowhere.\n",
    );

    let known = resolve_known_map(
        &current,
        &[RememberedRegion {
            region: legacy_nexus,
            last_seen_turn: current.header.turn_number.expect("a turn number"),
        }],
    );

    let nexus_hex = known
        .hexes
        .iter()
        .find(|hex| hex.region.as_ref().is_some_and(|r| r.terrain == "nexus"))
        .expect("the nexus is still known");
    let unit = nexus_hex
        .region
        .as_ref()
        .and_then(|r| r.units.first())
        .expect("the unit survives on a same-turn sighting");
    assert_eq!(unit.region_id, "0:0,0");
}
