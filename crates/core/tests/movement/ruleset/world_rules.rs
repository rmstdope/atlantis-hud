use crate::common::ruleset;
use atlantis_hud_core::movement::rules::{Ruleset, RulesetError};

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// New Age: Trident widens the sailing rule's water: "Lakes count as water for this purpose, and a
/// region bordering one counts as its shore, so fleets may also sail between a lake and the land
/// around it." (`newage trident rules/movement_sailing`.) New Origins' sailing section carries no
/// such sentence, so a lake there is dry land — which is why both worlds are asserted here.
#[test]
fn knows_lakes_are_water_in_trident() {
    let trident = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
        .expect("the committed Trident ruleset parses and validates");

    assert!(trident.is_water("lake"));
    assert!(
        trident.is_water("Lake"),
        "case should not decide whether a unit drowns"
    );
    assert!(trident.is_water("ocean"), "the sea is still water");
    assert!(!trident.is_water("plain"));

    assert!(
        !ruleset().is_water("lake"),
        "New Origins has no lake sentence, so a lake there is dry land"
    );
}

#[test]
fn new_origins_splits_production_around_build() {
    // `rules/sequenceofevents`: manufacturing PRODUCE, then BUILD, then primary PRODUCE.
    assert!(!ruleset().builds_before_production());
}

/// New Origins' `rules/movement_normal` carries no swimming paragraph at all, so its ruleset has
/// no swimming rule - and asking is not an error. That is not the same as a world whose swimmers
/// can carry nothing: nothing in New Origins swims.
#[test]
fn knows_new_origins_has_no_swimming() {
    assert!(ruleset().swimming().is_none());
}

/// The swimming sentence's terrain names are captured with bare-word matches, so a reworded page
/// can put any word there. A swimmer restricted to coastal ocean cannot also be unrestricted in
/// the ocean, and a blank name would match no hex and silently model nothing.
#[test]
fn refuses_a_swimming_rule_that_contradicts_the_water_rule() {
    // Each value reaches a different arm: "ocean" contradicts the coastal restriction, and ""
    // would match no hex at all.
    for unrestricted in ["\"ocean\"", "\"\""] {
        // New Origins has no swimming rule at all, so the committed ruleset carries
        // `"swimming": null`; the contradiction has to be spliced in over it.
        let with_swimming = RULESET.replacen(
            "\"swimming\": null",
            &format!(
                "\"swimming\": {{ \"unrestricted\": [{unrestricted}], \
                 \"deepNeedsSeaCreatures\": true }}"
            ),
            1,
        );
        assert_ne!(
            with_swimming, RULESET,
            "the fixture should have been altered"
        );

        let error = Ruleset::from_json(&with_swimming).expect_err("should refuse");
        assert!(matches!(error, RulesetError::Unusable(_)), "got {error}");
    }

    // And the lake the real rule names is accepted, so the arms above refuse a mis-capture
    // rather than every swimming rule.
    let lake = RULESET.replacen(
        "\"swimming\": null",
        "\"swimming\": { \"unrestricted\": [\"lake\"], \"deepNeedsSeaCreatures\": true }",
        1,
    );
    assert!(Ruleset::from_json(&lake).is_ok());
}

/// `rules/movement_sailing`, in every committed world: "Ships may not sail through single hex land
/// masses and must leave via the same side they entered or a side adjacent to that one." The
/// restriction is not a New Age addition, so New Origins must state it too.
#[test]
fn knows_the_sailing_side_restriction() {
    assert!(ruleset().sailing_side_restricted());

    for json in [
        atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON,
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
    ] {
        let world = Ruleset::from_json(json).expect("a committed New Age ruleset parses");
        assert!(world.sailing_side_restricted());
    }
}

/// `newage/trident data/Canal`: "Passage through a stone canal costs 2 movement points";
/// `newage/trident data/Mystic Canal`: "Passage through a mystic canal costs 1 movement point."
/// New Origins has neither grade, so it prices neither.
#[test]
fn knows_what_a_pass_through_each_canal_costs() {
    let trident = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
        .expect("the committed Trident ruleset parses");

    assert_eq!(trident.canal_cost("Canal"), Some(2));
    assert_eq!(
        trident.canal_cost("mystic canal"),
        Some(1),
        "a report's case should not decide what a pass costs"
    );
    assert_eq!(trident.canal_cost("Fort"), None);

    let new_origins = ruleset();
    assert_eq!(new_origins.canal_cost("Canal"), None);
    assert_eq!(new_origins.canal_cost("Mystic Canal"), None);
}
