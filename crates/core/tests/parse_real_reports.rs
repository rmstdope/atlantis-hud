//! Acceptance tests for the NewOrigins parser, against real turn reports.
//!
//! The figures asserted here were read out of the files by hand, so a regression shows up as a
//! disagreement with the report itself rather than with an earlier run of the parser.

use atlantis_hud_core::report::parse_regions;

const TURN_2: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f73-t2.rep");
const TURN_71: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");

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
