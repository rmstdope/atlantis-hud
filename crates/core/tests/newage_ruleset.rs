//! The two committed New Age rulesets, read by the core exactly as a shell would hand them over.
//!
//! `Ruleset::from_json` parses with `deny_unknown_fields` and then validates, so these cases are
//! what proves a generated New Age file is a ruleset this application can actually use - and that
//! the terrain premiums and the weather block say what those worlds' rules pages say.

use atlantis_hud_core::movement::rules::{MovementMode, Ruleset};

fn arcanum() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset parses and validates")
}

fn trident() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
        .expect("the committed Trident ruleset parses and validates")
}

#[test]
fn loads_both_committed_newage_rulesets() {
    let _ = arcanum();
    let _ = trident();
}

#[test]
fn costs_new_age_terrain_as_its_rules_page_states_it() {
    for ruleset in [arcanum(), trident()] {
        assert_eq!(ruleset.terrain_cost("volcano", MovementMode::Walk), 4);
        assert_eq!(ruleset.terrain_cost("forest", MovementMode::Walk), 2);
        assert_eq!(ruleset.terrain_cost("plain", MovementMode::Walk), 1);
        // The premium is stated for walking and riding units only.
        assert_eq!(ruleset.terrain_cost("volcano", MovementMode::Fly), 1);
    }
}

#[test]
fn knows_new_age_weather_changes_nothing() {
    for ruleset in [arcanum(), trident()] {
        assert!(ruleset.gaps.weather.modelled);
        assert!(ruleset.is_fully_modelled());
    }
}

#[test]
fn trident_settles_builds_before_production() {
    // `newage trident rules/sequenceofevents`: "BUILD orders are processed: new structures are
    // laid down first, then the work of everyone building on them is counted." and only then
    // "PRODUCE orders are processed -- both those that make items out of other items ... and
    // those that take items from the region's own resources".
    assert!(trident().builds_before_production());

    // Arcanum's own page states Trident's order, but the audit behind this accessor is a Trident
    // audit whose charter is to preserve New Origins and Arcanum behaviour. An Arcanum audit, with
    // its own regressions behind it, is what should flip this.
    assert!(
        !arcanum().builds_before_production(),
        "Arcanum stays on the New Origins schedule until an Arcanum audit moves it"
    );
}
