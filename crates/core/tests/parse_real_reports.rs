//! Acceptance tests for the NewOrigins parser, against real turn reports.
//!
//! The figures asserted here were read out of the files by hand, so a regression shows up as a
//! disagreement with the report itself rather than with an earlier run of the parser.

use atlantis_hud_core::report::parse_report_full as parse_regions;

const TURN_2: &str = atlantis_hud_fixtures::G8_F73_T2.text;
const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
/// Faction 73's own turn 71, written for issue #53 so a merge has two reports of one turn to work
/// with. Hand-written rather than captured, because no second real report of this turn exists.
const ALLY_TURN_71: &str = atlantis_hud_fixtures::G8_F73_T71.text;
/// Faction 95's turn 70, so loading an older report of one's *own* faction can still be tested.
const TURN_70: &str = atlantis_hud_fixtures::G7_F95_T70.text;
/// A fresh faction's very first turn: no history, nothing to merge into.
const FIRST_TURN: &str = atlantis_hud_fixtures::G2_F42_T0.text;
/// A report with no orders template at all - see `tests/fixtures/reports/README.md`.
const NO_ORDERS: &str = atlantis_hud_fixtures::G7_F62_T20.text;
/// A late, large turn from an established faction - the stress case, most likely to expose a
/// quadratic. Not the single largest committed report (that is `g7-f95-t72`, exercised by the
/// battle tests) but the largest from a faction none of the other fixtures also cover.
const LARGE_TURN: &str = atlantis_hud_fixtures::G3_F42_T82.text;

#[test]
fn turn_2_yields_its_single_region() {
    let parsed = parse_regions(TURN_2);
    assert_eq!(parsed.regions.len(), 1);

    let region = &parsed.regions[0];
    assert_eq!(region.region_id, "1:13,63");
    assert_eq!(region.terrain, "mountain");
    assert_eq!(region.province, "Liou'ecpu");
    assert_eq!(
        region.settlement.as_ref().map(|s| s.name.as_str()),
        Some("Rihead")
    );
    assert_eq!(region.population, Some(7922));
    assert_eq!(region.race.as_deref(), Some("hill dwarves"));
    assert_eq!(region.tax_base, Some(4753));
    assert_eq!(region.wages.as_deref(), Some("$13.0"));
    assert_eq!(region.max_wages, Some(950));
    assert_eq!(region.entertainment, Some(316));

    assert_eq!(region.products.len(), 3, "34 grain, 20 iron, 14 stone");
    assert_eq!(region.wanted.len(), 9);
    assert_eq!(region.for_sale.len(), 3);
    assert_eq!(region.exits.len(), 6, "an island hex, ocean on every side");
    assert!(region.structures.is_empty(), "no structures this early");
}

#[test]
fn turn_2_attributes_every_unit_to_the_right_faction() {
    let region = &parse_regions(TURN_2).regions[0];

    assert_eq!(region.units.len(), 9);

    let own: Vec<&str> = region
        .units
        .iter()
        .filter(|unit| unit.own)
        .map(|unit| unit.unit_id.as_str())
        .collect();
    assert_eq!(
        own,
        vec!["793", "1382", "1383", "1384", "1385", "1386", "1387", "1388"]
    );

    // The City Guard is the one unit that is not the player's.
    let guard = region
        .units
        .iter()
        .find(|unit| unit.unit_id == "89")
        .expect("city guard");
    assert!(!guard.own);
    assert!(guard.on_guard);
    assert_eq!(guard.faction_name.as_deref(), Some("The Guardsmen"));
    assert_eq!(guard.men, 80);
}

#[test]
fn turn_71_yields_every_visited_region() {
    let parsed = parse_regions(TURN_71);
    assert_eq!(parsed.regions.len(), 11);

    let ids: Vec<&str> = parsed
        .regions
        .iter()
        .map(|region| region.region_id.as_str())
        .collect();
    assert!(ids.contains(&"1:7,53"), "Inholm");
    assert!(ids.contains(&"1:15,63"), "Trasicy");
    assert!(ids.contains(&"1:26,52"), "the fleet's ocean hex");
}

#[test]
fn turn_71_reads_the_city_of_inholm_in_full() {
    let parsed = parse_regions(TURN_71);
    let inholm = parsed
        .regions
        .iter()
        .find(|region| region.region_id == "1:7,53")
        .expect("Inholm should be parsed");

    assert_eq!(inholm.label(), "mountain (7,53) in Inhead");
    assert_eq!(
        inholm.settlement.as_ref().map(|s| s.size.as_str()),
        Some("city")
    );
    assert_eq!(inholm.population, Some(12051));
    assert_eq!(inholm.tax_base, Some(33983));
    assert_eq!(inholm.max_wages, Some(6796));
    assert_eq!(inholm.entertainment, Some(2500));
    assert_eq!(inholm.wanted.len(), 9);
    assert_eq!(inholm.for_sale.len(), 4);
    assert_eq!(inholm.exits.len(), 6);

    assert_eq!(inholm.structures.len(), 24);
    // 18 units stand in the open and 74 sit inside structures.
    assert_eq!(inholm.units.len(), 92);
    assert_eq!(
        inholm
            .units
            .iter()
            .filter(|u| u.structure_id.is_some())
            .count(),
        74
    );

    let own: Vec<&str> = inholm
        .units
        .iter()
        .filter(|unit| unit.own)
        .map(|unit| unit.unit_id.as_str())
        .collect();
    assert_eq!(own, vec!["18642"], "exactly one unit here is the player's");
}

#[test]
fn turn_71_keeps_units_attached_to_their_structures() {
    let parsed = parse_regions(TURN_71);
    let inholm = parsed
        .regions
        .iter()
        .find(|region| region.region_id == "1:7,53")
        .expect("Inholm");

    let watch = inholm
        .units
        .iter()
        .find(|unit| unit.unit_id == "14353")
        .expect("Eastern Watch");
    assert_eq!(watch.structure_id.as_deref(), Some("1"));
    assert_eq!(watch.men, 120);
    assert!(watch.on_guard);

    // The player's own unit is not inside any structure.
    let seven = inholm
        .units
        .iter()
        .find(|unit| unit.unit_id == "18642")
        .expect("Seven of Eight");
    assert_eq!(seven.structure_id, None);
    assert_eq!(seven.skills.len(), 3);
    assert!(seven
        .skills
        .iter()
        .any(|skill| skill.tag == "STEA" && skill.level == 5));
}

#[test]
fn turn_71_finds_the_same_own_units_the_orders_template_lists() {
    // An independent cross check: the report's own orders template contains one `unit` block per
    // unit the player controls, so the two halves of the file must agree.
    let template_units = TURN_71
        .lines()
        .filter(|line| line.starts_with("unit "))
        .count();

    let parsed_own: usize = parse_regions(TURN_71)
        .regions
        .iter()
        .map(|region| region.units.iter().filter(|unit| unit.own).count())
        .sum();

    assert_eq!(parsed_own, template_units);
    assert_eq!(parsed_own, 27);
}

#[test]
fn turn_71_reads_its_preamble() {
    let parsed = parse_regions(TURN_71);
    let header = &parsed.header;

    assert_eq!(header.faction_name.as_deref(), Some("Borg TNG"));
    assert_eq!(header.faction_id.as_deref(), Some("95"));
    assert_eq!(header.faction_types, vec!["Magic 5"]);
    assert_eq!(header.month.as_deref(), Some("December"));
    assert_eq!(header.year, Some(6));
    // The filename calls this turn 71, and the date derivation agrees.
    assert_eq!(header.turn_number, Some(71));
    assert_eq!(header.ruleset.as_deref(), Some("NewOrigins"));
    assert_eq!(header.ruleset_version.as_deref(), Some("3.0.0 (beta)"));
    assert_eq!(header.engine_version.as_deref(), Some("5.2.5 (beta)"));
    assert_eq!(header.unclaimed_silver, Some(6038));
    assert_eq!(header.errors.len(), 1, "one DECLARE error this turn");
}

#[test]
fn turn_71_reads_its_faction_status_and_declared_attitudes() {
    let header = parse_regions(TURN_71).header;

    assert_eq!(header.faction_status.entries.len(), 4);
    assert_eq!(header.faction_status.entries[0].label, "Regions");
    assert_eq!(header.faction_status.entries[0].used, 0);
    assert_eq!(header.faction_status.entries[0].maximum, 0);
    let mages = header
        .faction_status
        .entries
        .iter()
        .find(|entry| entry.label == "Mages")
        .expect("a Mages entry");
    assert_eq!((mages.used, mages.maximum), (6, 6));
    let apprentices = header
        .faction_status
        .entries
        .iter()
        .find(|entry| entry.label == "Apprentices")
        .expect("an Apprentices entry");
    assert_eq!((apprentices.used, apprentices.maximum), (15, 15));

    assert_eq!(
        header.attitudes.default_attitude.as_deref(),
        Some("Unfriendly")
    );
    let hostile = header
        .attitudes
        .levels
        .iter()
        .find(|level| level.attitude == "Hostile")
        .expect("a Hostile level");
    // The wrapped Hostile line's last entry, proving the wrap survives real text.
    assert_eq!(
        hostile.factions.last().map(|faction| faction.name.as_str()),
        Some("Heirs of the Sun")
    );
    let neutral = header
        .attitudes
        .levels
        .iter()
        .find(|level| level.attitude == "Neutral")
        .expect("a Neutral level");
    assert_eq!(
        neutral.factions,
        vec![atlantis_hud_core::report::header::FactionRef {
            name: "Fon".to_string(),
            id: "8".to_string()
        }]
    );
}

#[test]
fn turn_71_of_the_ally_faction_reads_its_faction_status_and_declared_attitudes() {
    let header = parse_regions(ALLY_TURN_71).header;

    let regions = header
        .faction_status
        .entries
        .iter()
        .find(|entry| entry.label == "Regions")
        .expect("a Regions entry");
    assert_eq!((regions.used, regions.maximum), (3, 10));
    let apprentices = header
        .faction_status
        .entries
        .iter()
        .find(|entry| entry.label == "Apprentices")
        .expect("an Apprentices entry");
    assert_eq!((apprentices.used, apprentices.maximum), (0, 15));

    assert_eq!(
        header.attitudes.default_attitude.as_deref(),
        Some("Neutral")
    );
    let ally = header
        .attitudes
        .levels
        .iter()
        .find(|level| level.attitude == "Ally")
        .expect("an Ally level");
    assert_eq!(
        ally.factions,
        vec![atlantis_hud_core::report::header::FactionRef {
            name: "Borg TNG".to_string(),
            id: "95".to_string()
        }]
    );
}

#[test]
fn turn_2_reads_its_preamble_and_per_unit_errors() {
    let header = parse_regions(TURN_2).header;

    assert_eq!(header.faction_id.as_deref(), Some("73"));
    assert_eq!(header.turn_number, Some(2), "March of Year 1");
    assert_eq!(header.unclaimed_silver, Some(4935));
    assert_eq!(header.errors.len(), 2, "unit 1387 failed a BUY and a STUDY");
    assert!(header.errors.iter().all(|error| error.contains("1387")));
    assert!(!header.events.is_empty());
}

#[test]
fn turn_2_reads_its_declared_attitude_of_unfriendly_towards_creatures() {
    let header = parse_regions(TURN_2).header;

    let unfriendly = header
        .attitudes
        .levels
        .iter()
        .find(|level| level.attitude == "Unfriendly")
        .expect("an Unfriendly level");
    assert_eq!(
        unfriendly.factions,
        vec![atlantis_hud_core::report::header::FactionRef {
            name: "Creatures".to_string(),
            id: "2".to_string()
        }]
    );
    let hostile = header
        .attitudes
        .levels
        .iter()
        .find(|level| level.attitude == "Hostile")
        .expect("a Hostile level");
    assert!(hostile.factions.is_empty());
}

#[test]
fn turn_71_carries_an_orders_template_for_every_unit_it_reports() {
    let parsed = parse_regions(TURN_71);
    let template = parsed
        .orders_template
        .as_ref()
        .expect("the report carries a template");

    assert_eq!(template.faction_id.as_deref(), Some("95"));
    assert!(template.text.starts_with("#atlantis 95 "));
    assert!(template.text.ends_with("#end"));

    // The template and the region blocks must describe the same set of units.
    let mut template_ids: Vec<&str> = template
        .units
        .iter()
        .map(|unit| unit.unit_id.as_str())
        .collect();
    let mut reported_ids: Vec<&str> = parsed
        .own_units()
        .map(|unit| unit.unit_id.as_str())
        .collect();
    template_ids.sort_unstable();
    reported_ids.sort_unstable();

    assert_eq!(template_ids, reported_ids);
    assert_eq!(template_ids.len(), 27);
}

#[test]
fn the_template_is_a_verbatim_slice_of_the_report() {
    // Import seeds the order draft from this text, and export must round trip it, so it has to be
    // exactly what the report said rather than something reassembled.
    let template = parse_regions(TURN_71).orders_template.expect("template");

    assert!(TURN_71.contains(&template.text));
}

#[test]
fn a_unit_with_orders_keeps_them_apart_from_its_description() {
    let template = parse_regions(TURN_71).orders_template.expect("template");

    let unit = template
        .units
        .iter()
        .find(|unit| unit.unit_id == "18642")
        .expect("Seven of Eight has a block");

    assert_eq!(unit.commands(), vec!["@claim 50", "@study obse"]);
    // The game's descriptive comment stays in the block so the document round trips.
    assert!(unit
        .lines
        .iter()
        .any(|line| line.starts_with(";Seven of Eight")));
}

#[test]
fn the_ally_report_describes_the_same_turn_as_faction_95() {
    let parsed = parse_regions(ALLY_TURN_71);

    assert_eq!(parsed.header.faction_id.as_deref(), Some("73"));
    assert_eq!(parsed.header.faction_name.as_deref(), Some("Borg"));
    assert_eq!(parsed.header.turn_number, Some(71), "December, Year 6");
    assert_eq!(parsed.regions.len(), 3);
}

#[test]
fn the_ally_report_stands_in_the_swamp_faction_95_also_reports() {
    let parsed = parse_regions(ALLY_TURN_71);
    let swamp = &parsed.regions[0];

    assert_eq!(swamp.region_id, "1:10,50");
    assert_eq!(swamp.terrain, "swamp");
    assert_eq!(swamp.province, "Cebo");
    assert_eq!(swamp.population, Some(1980), "not faction 95's 2018");
    assert_eq!(swamp.exits.len(), 6);
    assert_eq!(swamp.structures.len(), 1, "Cebo Watchpost");

    // Four of its own across the report, and a stranger faction 95 reports as well.
    assert_eq!(parsed.own_units().count(), 4);
    assert!(swamp.units.iter().any(|unit| unit.unit_id == "12694"));
}

#[test]
fn the_ally_report_reaches_two_hexes_faction_95_never_stood_in() {
    let parsed = parse_regions(ALLY_TURN_71);

    let ids: Vec<&str> = parsed
        .regions
        .iter()
        .map(|region| region.region_id.as_str())
        .collect();
    assert_eq!(ids, vec!["1:10,50", "1:9,51", "1:9,53"]);
    assert!(!TURN_71.contains("(9,53)"), "the plain is new to the map");
}

#[test]
fn turn_70_is_the_same_faction_one_turn_earlier() {
    let parsed = parse_regions(TURN_70);

    assert_eq!(parsed.header.faction_id.as_deref(), Some("95"));
    assert_eq!(parsed.header.turn_number, Some(70), "November, Year 6");
    assert_eq!(parsed.regions.len(), 1);
    assert!(parsed.orders_template.is_some());
}

#[test]
fn turn_71_finds_its_two_battles() {
    let parsed = parse_regions(TURN_71);
    assert_eq!(parsed.battles.len(), 2);

    let first = &parsed.battles[0];
    assert_eq!(
        first.attacker.as_ref().map(|c| c.name.as_str()),
        Some("AA Tomb's Guards")
    );
    assert_eq!(first.attacker.as_ref().map(|c| c.id.as_str()), Some("7280"));
    assert_eq!(
        first.defender.as_ref().map(|c| c.name.as_str()),
        Some("Pirates")
    );
    assert_eq!(
        first.defender.as_ref().map(|c| c.id.as_str()),
        Some("14789")
    );
    assert_eq!(first.terrain.as_deref(), Some("ocean"));
    assert_eq!(
        first.coordinate,
        Some(atlantis_hud_core::report::model::Coordinate { x: 25, y: 55, z: 1 })
    );
    assert_eq!(first.province.as_deref(), Some("Atlantis Ocean"));
    assert_eq!(first.rounds.len(), 1, "one round of combat");
    assert_eq!(first.damaged_units, vec!["14789".to_string()]);
    assert_eq!(first.casualties.len(), 2);
    assert!(first.casualties.iter().any(|c| c
        .combatant
        .as_ref()
        .map(|combatant| combatant.id.as_str())
        == Some("14789")
        && c.lost == Some(15)));
    assert!(first.casualties.iter().any(|c| c
        .combatant
        .as_ref()
        .map(|combatant| combatant.id.as_str())
        == Some("7280")
        && c.lost == Some(0)));
    assert_eq!(
        first.spoils.as_deref(),
        Some(
            "3 magic crossbows [MXBO], 2 battle axes [BAXE], magic wagon [MWAG], 11 mithril \
             [MITH], 3 gliders [GLID], 8 floater hides [FLOA], 5 mushrooms [MUSH], yew [YEW], \
             5 healing potions [HPOT], 2531 silver [SILV]"
        )
    );

    let second = &parsed.battles[1];
    assert_eq!(
        second.attacker.as_ref().map(|c| c.name.as_str()),
        Some("Sail")
    );
    assert_eq!(
        second.defender.as_ref().map(|c| c.name.as_str()),
        Some("Looter")
    );
}

#[test]
fn reports_without_battles_parse_to_an_empty_list() {
    assert!(parse_regions(TURN_2).battles.is_empty());
    assert!(parse_regions(TURN_70).battles.is_empty());
    assert!(parse_regions(ALLY_TURN_71).battles.is_empty());
}

/// The three newly interesting shapes ah-dyi imported, so a fixture that is committed and never
/// read is caught by review rather than sitting there for a year.
#[test]
fn a_fresh_factions_first_turn_parses_with_no_history_to_speak_of() {
    let parsed = parse_regions(FIRST_TURN);

    assert_eq!(parsed.header.faction_id.as_deref(), Some("42"));
    assert!(parsed.header.turn_number.is_some());
    assert!(!parsed.regions.is_empty());
}

#[test]
fn the_first_turn_is_the_nexus_on_its_own_level() {
    let parsed = parse_regions(FIRST_TURN);

    assert_eq!(parsed.regions.len(), 1);
    let region = &parsed.regions[0];
    assert_eq!(region.region_id, "0:0,0");
    assert_eq!(region.coordinate.z, 0);
    assert_eq!(region.terrain, "nexus");
    assert_eq!(region.province, "The Void");
    assert!(!region.units.is_empty());
    assert!(region.exits.is_empty());
}

#[test]
fn a_report_with_no_orders_template_parses_with_everything_else_intact() {
    let parsed = parse_regions(NO_ORDERS);

    assert_eq!(parsed.header.faction_id.as_deref(), Some("62"));
    assert!(parsed.orders_template.is_none());
    assert!(!parsed.regions.is_empty(), "the map still parses");
}

#[test]
fn the_largest_newly_imported_turn_parses_without_falling_over() {
    let parsed = parse_regions(LARGE_TURN);

    assert_eq!(parsed.header.faction_id.as_deref(), Some("42"));
    assert!(
        parsed.regions.len() > 20,
        "an established, sprawling faction"
    );
}

/// The strongest available check that the producers added by ah-w544.2 do not fire spuriously: a
/// real report the parser handles is a report with nothing to say about it.
#[test]
fn every_committed_report_is_read_completely() {
    for report in atlantis_hud_fixtures::ALL {
        let parsed = parse_regions(report.text);
        let unreadable: Vec<&str> = parsed
            .unreadable_lines
            .iter()
            .map(|entry| entry.text.as_str())
            .collect();
        assert!(
            unreadable.is_empty(),
            "{} has unreadable lines: {unreadable:#?}",
            report.file
        );
    }
}

/// The corpus pins the roster-skill parse exactly. These are measured totals, not bounds: a change
/// in any of them is a change in the parser, and should fail here rather than pass quietly.
#[test]
fn every_committed_report_yields_its_roster_skills() {
    use atlantis_hud_core::report::battle::roster_skills;
    use std::collections::{BTreeMap, BTreeSet};

    let mut entries = 0usize;
    let mut per_name: BTreeMap<String, usize> = BTreeMap::new();

    for report in atlantis_hud_fixtures::ALL {
        let parsed = parse_regions(report.text);
        for entry in roster_skills(&parsed.battles) {
            entries += 1;

            let mut seen = BTreeSet::new();
            for skill in &entry.skills {
                assert!(
                    ["combat", "riding", "tactics", "longbow", "crossbow"]
                        .contains(&skill.name.as_str()),
                    "{} disclosed an unexpected skill name {:?}",
                    report.file,
                    skill.name
                );
                assert!(
                    seen.insert(skill.name.clone()),
                    "{} disclosed {:?} twice for unit {}",
                    report.file,
                    skill.name,
                    entry.unit_id
                );
                *per_name.entry(skill.name.clone()).or_default() += 1;
            }
        }
    }

    assert_eq!(
        entries, 1618,
        "roster entries disclosing at least one skill"
    );
    assert_eq!(per_name.get("combat").copied(), Some(901));
    assert_eq!(per_name.get("riding").copied(), Some(891));
    assert_eq!(per_name.get("longbow").copied(), Some(366));
    assert_eq!(per_name.get("tactics").copied(), Some(318));
    assert_eq!(per_name.get("crossbow").copied(), Some(116));
}
