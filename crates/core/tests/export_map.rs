//! The export against a real report: what goes out has to read back in.
//!
//! Hand-written fixtures prove the grammar; this proves the grammar covers what the game actually
//! prints. Every region of a real turn is written out and parsed again, and the models have to
//! match - if they do, an ally's client has the same chance of reading the file that ours does.

use atlantis_hud_core::movement::graph::RememberedRegion;
use atlantis_hud_core::report::export::{export_map, MapExportRequest};
use atlantis_hud_core::report::model::ReportRegion;
use atlantis_hud_core::report::parse_report_full;
use atlantis_hud_core::report::write::ExportContent;

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

/// A rectangle wide enough to hold anything in the fixture.
fn whole_map(content: ExportContent) -> MapExportRequest {
    MapExportRequest {
        level: 1,
        from_x: -1000,
        from_y: -1000,
        to_x: 1000,
        to_y: 1000,
        content,
    }
}

fn by_id(regions: Vec<ReportRegion>) -> std::collections::BTreeMap<String, ReportRegion> {
    regions
        .into_iter()
        .map(|region| (region.region_id.clone(), region))
        .collect()
}

#[test]
fn every_region_of_a_real_report_survives_the_round_trip() {
    let report = parse_report_full(TURN_71);
    let text = export_map(&report, &[], &whole_map(ExportContent::default()));
    let reparsed = parse_report_full(&text);

    let before = by_id(report.regions.clone());
    let after = by_id(reparsed.regions);

    assert_eq!(
        before.keys().collect::<Vec<_>>(),
        after.keys().collect::<Vec<_>>(),
        "the same hexes should come back"
    );
    for (id, region) in &before {
        assert_eq!(
            after.get(id),
            Some(region),
            "region {id} changed in writing"
        );
    }
}

#[test]
fn a_remembered_region_is_exported_beside_this_turn_s() {
    let report = parse_report_full(TURN_71);
    let remembered = vec![RememberedRegion {
        region: parse_report_full("forest (99,99) in Elsewhere.\n")
            .regions
            .into_iter()
            .next()
            .expect("fixture region"),
        last_seen_turn: 60,
    }];

    let text = export_map(&report, &remembered, &whole_map(ExportContent::default()));
    let ids: Vec<String> = parse_report_full(&text)
        .regions
        .into_iter()
        .map(|region| region.region_id)
        .collect();

    assert_eq!(ids.len(), report.regions.len() + 1);
    assert!(ids.contains(&"1:99,99".to_string()));
    assert!(text.contains("; last seen turn 60, 11 turns before this export"));
}

#[test]
fn withholding_content_withholds_it_everywhere() {
    let report = parse_report_full(TURN_71);
    let text = export_map(
        &report,
        &[],
        &whole_map(ExportContent {
            structures: false,
            units: false,
            advanced_resources: false,
        }),
    );
    let reparsed = parse_report_full(&text);

    assert!(!reparsed.regions.is_empty(), "regions are still exported");
    for region in &reparsed.regions {
        assert!(region.units.is_empty(), "{} kept units", region.region_id);
        assert!(
            region.structures.is_empty(),
            "{} kept structures",
            region.region_id
        );
        for product in &region.products {
            assert!(
                matches!(
                    product.tag.as_str(),
                    "GRAI" | "LIVE" | "WOOD" | "HERB" | "FISH" | "IRON" | "STON" | "FUR" | "HORS"
                ),
                "{} kept the advanced resource {}",
                region.region_id,
                product.tag
            );
        }
    }

    // The economy the toggles say nothing about is untouched.
    assert!(reparsed
        .regions
        .iter()
        .any(|region| !region.exits.is_empty() && region.wages.is_some()));
}

#[test]
fn a_rectangle_exports_only_what_it_covers() {
    let report = parse_report_full(TURN_71);
    let inside: Vec<String> = report
        .regions
        .iter()
        .filter(|region| {
            (17..=20).contains(&region.coordinate.x) && (39..=45).contains(&region.coordinate.y)
        })
        .map(|region| region.region_id.clone())
        .collect();
    assert!(
        inside.len() >= 2,
        "the fixture should have several hexes in this box: {inside:?}"
    );

    let text = export_map(
        &report,
        &[],
        &MapExportRequest {
            level: 1,
            from_x: 17,
            from_y: 39,
            to_x: 20,
            to_y: 45,
            content: ExportContent::default(),
        },
    );
    let exported: Vec<String> = parse_report_full(&text)
        .regions
        .into_iter()
        .map(|region| region.region_id)
        .collect();

    assert_eq!(exported, inside);
}
