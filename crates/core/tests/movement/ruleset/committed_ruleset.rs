use crate::common::ruleset;
use atlantis_hud_core::movement::rules::{ItemKind, MovementMode, Ruleset, RulesetError};

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

#[test]
fn loads_the_committed_ruleset() {
    let ruleset = ruleset();

    // "Walking units have two movement points, riding units have four, and flying units have four."
    assert_eq!(ruleset.movement_points(MovementMode::Walk), 2);
    assert_eq!(ruleset.movement_points(MovementMode::Ride), 4);
    assert_eq!(ruleset.movement_points(MovementMode::Fly), 4);
}

#[test]
fn costs_terrain_as_the_rules_page_states_it() {
    let ruleset = ruleset();

    // "...the following terrain types take two movement points for riding or walking units to
    //  enter: Forest, Mountain, Swamp, Jungle, and Tundra."
    for doubled in ["forest", "mountain", "swamp", "jungle", "tundra"] {
        assert_eq!(
            ruleset.terrain_cost(doubled, MovementMode::Walk),
            2,
            "{doubled} should cost a walker two"
        );
    }

    // Everything else costs one, including terrain the page never enumerated. The page says so:
    // "there may be other types of terrain to be discovered as the game progresses", and the map
    // renderer already paints cavern, underforest and wasteland that this game never shows.
    //
    // Ocean is deliberately not in this list: nothing can walk into it, so what it "costs" is a
    // number with no meaning to pin.
    for normal in ["plain", "desert", "cavern", "underforest", "wasteland"] {
        assert_eq!(
            ruleset.terrain_cost(normal, MovementMode::Walk),
            1,
            "{normal} should cost one"
        );
    }
}

/// "the following terrain types take two movement points **for riding or walking units** to enter".
///
/// Flight is deliberately absent from that list, so difficult ground is no obstacle to a flier -
/// which the scraped `premiumFor` records rather than the core assuming.
#[test]
fn difficult_going_costs_a_flier_nothing_extra() {
    let ruleset = ruleset();

    for doubled in ["forest", "mountain", "swamp", "jungle", "tundra"] {
        assert_eq!(
            ruleset.terrain_cost(doubled, MovementMode::Fly),
            1,
            "{doubled} should cost a flier the ordinary amount"
        );
        assert_eq!(ruleset.terrain_cost(doubled, MovementMode::Ride), 2);
    }
}

#[test]
fn terrain_cost_ignores_case() {
    // Reports print terrain lower-cased, but an exit or a stored sighting is not worth trusting to
    // stay that way, and a mis-cased miss would silently under-cost a route.
    let ruleset = ruleset();

    assert_eq!(ruleset.terrain_cost("Forest", MovementMode::Walk), 2);
    assert_eq!(ruleset.terrain_cost("MOUNTAIN", MovementMode::Walk), 2);
}

#[test]
fn a_road_halves_a_cost_but_never_below_its_floor() {
    // "If a road in the given direction is connected, units move along that road at half cost to a
    //  minimum of 1 movement point."
    let ruleset = ruleset();

    assert_eq!(ruleset.road_cost(2), 1, "a doubled terrain halves");
    assert_eq!(
        ruleset.road_cost(1),
        1,
        "a normal terrain cannot go below the floor"
    );

    // An odd cost is where "half cost" stops being exact, and the page does not say which way it
    // rounds. Floor is what the code does; this pins that choice so it cannot drift unnoticed.
    // No cost above 2 is reachable from this ruleset today, so nothing depends on it yet - see the
    // weather gap recorded in docs/ruleset-contract.md for when it would start to.
    assert_eq!(ruleset.road_cost(3), 1, "an odd cost rounds down");
}

#[test]
fn knows_which_terrain_is_water() {
    let ruleset = ruleset();

    assert!(ruleset.is_water("ocean"));
    assert!(
        ruleset.is_water("Ocean"),
        "case should not decide whether a unit drowns"
    );
    assert!(!ruleset.is_water("plain"));
    assert!(!ruleset.is_water("swamp"), "a swamp is difficult, not wet");
}

/// "For a fleet to enter any region only costs one movement point" and "A coastal region is
/// defined as a non-ocean region with at least one adjacent ocean region." Sail planning
/// (ah-2vy.2) needs both to cost and to legalise a sea route.
#[test]
fn reads_the_fleet_movement_rule_from_the_committed_ruleset() {
    let ruleset = ruleset();

    assert_eq!(ruleset.sailing_flat_cost(), 1);
    assert!(ruleset.sailing_land_needs_coast());
}

#[test]
fn tells_men_from_equipment() {
    let ruleset = ruleset();

    assert!(ruleset.is_man("LEAD"), "a leader is a man");
    assert!(ruleset.is_man("LIZA"), "a lizardman is a man");
    // Both a race and a mount; the catalogue exists to get this one right.
    assert!(ruleset.is_man("CTAU"), "a centaur is a man");

    assert!(!ruleset.is_man("HORS"), "a horse is not");
    assert!(!ruleset.is_man("SWOR"), "a sword is not");
    assert!(!ruleset.is_man("LION"), "a monster is not");
}

#[test]
fn committed_ruleset_carries_race_skill_limits() {
    let ruleset = ruleset();

    let leaders = ruleset
        .find_item("LEAD")
        .and_then(|item| item.skill_limits.as_ref())
        .expect("data/LEAD should carry its all-skills ceiling");
    assert!(leaders.specialized_skills.is_empty());
    assert_eq!(leaders.specialized_level, 5);
    assert_eq!(leaders.default_level, 5);

    let humans = ruleset
        .find_item("HUMN")
        .and_then(|item| item.skill_limits.as_ref())
        .expect("data/HUMN should carry specialized and fallback ceilings");
    assert_eq!(
        humans.specialized_skills,
        ["BUIL", "RIDI", "COMB", "MINI", "FARM", "COOK"]
    );
    assert_eq!(humans.specialized_level, 4);
    assert_eq!(humans.default_level, 2);

    let wood_elves = ruleset
        .find_item("WELF")
        .and_then(|item| item.skill_limits.as_ref())
        .expect("data/WELF should carry specialized and fallback ceilings");
    assert_eq!(
        wood_elves.specialized_skills,
        ["LUMB", "LBOW", "ENTE", "CARP", "FISH", "COOK"]
    );
    assert_eq!(wood_elves.specialized_level, 5);
    assert_eq!(wood_elves.default_level, 2);
}

#[test]
fn the_catalogue_knows_which_items_are_armor() {
    let ruleset = ruleset();

    let armor = ruleset
        .class_members("ARMOR")
        .expect("ARMOR should be a class this catalogue can read");
    assert!(
        armor.iter().any(|tag| tag == "CARM"),
        "chain armor should be recorded as ARMOR, got {armor:?}"
    );
}

#[test]
fn a_tag_the_page_says_cannot_change_hands_is_not_giveable() {
    let ruleset = ruleset();

    assert!(
        !ruleset.can_be_given("LION"),
        "a lion's entry says it cannot be given to other units"
    );
}

#[test]
fn a_tag_the_catalogue_does_not_carry_is_giveable_by_default() {
    let ruleset = ruleset();

    // The page states a restriction and is silent otherwise, so silence and ignorance look the
    // same and the permissive reading is the one that matches the page - true both for a real tag
    // the catalogue has nothing to say about and for one it has never heard of at all.
    assert!(ruleset.can_be_given("SWOR"), "a sword may change hands");
    assert!(
        ruleset.can_be_given("ZZZZ"),
        "an unknown tag is not known to be restricted"
    );
}

#[test]
fn carries_the_item_catalogue_the_risk_heuristic_needs() {
    let ruleset = ruleset();

    let lion = ruleset
        .items
        .get("LION")
        .expect("the catalogue should name a lion");
    assert_eq!(lion.kind, ItemKind::Monster);
    let combat = lion
        .combat
        .expect("a monster should carry its combat numbers");
    assert_eq!(combat.attacks_per_round, 2);
    assert_eq!(combat.hits_to_kill, 4);

    // Nothing but a monster fights on its own account.
    let horse = ruleset
        .items
        .get("HORS")
        .expect("the catalogue should name a horse");
    assert_eq!(horse.kind, ItemKind::Mount);
    assert!(horse.combat.is_none());
}

#[test]
fn keeps_the_provenance_of_every_scraped_value() {
    let ruleset = ruleset();

    assert!(ruleset
        .movement
        .provenance
        .movement_points
        .contains("Walking units have two movement points"));
    // The risk thresholds are ours, and the file has to keep saying so.
    assert!(!ruleset.risk.scraped);
}

/// The core has to carry the gaps forward, not just the numbers.
///
/// Weather is the live one: the rules page proves winter raises costs without ever saying by how
/// much, so any route crossing a winter month is under-cost. A planner that does not know this
/// would present a lower bound as fact, which is the failure direction that matters.
#[test]
fn knows_that_weather_is_not_modelled() {
    let ruleset = ruleset();

    assert!(!ruleset.gaps.weather.modelled);
    assert!(ruleset.gaps.weather.consequence.contains("under-cost"));
    assert!(
        !ruleset.is_fully_modelled(),
        "a ruleset with an open gap should say so"
    );
}

#[test]
fn rejects_text_that_is_not_a_ruleset() {
    let error = Ruleset::from_json("{\"hello\":true}").expect_err("should refuse");

    assert!(matches!(error, RulesetError::Malformed(_)));
    // serde names both the offending field and the ones it wanted, which is what makes the message
    // actionable. Asserting the text beats a disjunction: an earlier `contains("movement") ||
    // contains("source")` had a dead branch and passed on a weaker condition than it claimed.
    let message = error.to_string();
    assert!(
        message.contains("unknown field `hello`") && message.contains("`movement`"),
        "message should name the offending field and what was expected, got: {message}"
    );
}

#[test]
fn rejects_a_ruleset_that_would_make_every_route_free() {
    // A zero allowance parses perfectly well and then divides by nothing. Refusing beats planning
    // a route no unit could ever walk.
    let broken = RULESET.replacen("\"walk\": 2", "\"walk\": 0", 1);
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
    assert!(
        error.to_string().contains("walk"),
        "the message should name the value"
    );
}

#[test]
fn rejects_a_road_rule_that_divides_by_zero() {
    let broken = RULESET.replace("\"divisor\": 2", "\"divisor\": 0");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// A road floor of zero is the last remaining route to a free step, and the one the earlier
/// validation missed: the divisor and the terrain costs were both guarded, this was not. Dijkstra
/// over zero-cost edges will march a unit across a continent inside one month.
#[test]
fn rejects_a_road_floor_that_would_make_a_step_free() {
    let broken = RULESET.replace("\"minimumCost\": 1", "\"minimumCost\": 0");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// If the "harder" terrain is cheaper than ordinary going, the ruleset has been read backwards.
#[test]
fn rejects_a_premium_below_the_ordinary_cost() {
    let broken = RULESET.replace("\"normal\": 1", "\"normal\": 5");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// New Age charges four for a volcano where forest costs two, which is the case `TerrainCosts` was
/// widened for. The committed ruleset states one tier, so the second is spliced in here.
#[test]
fn costs_a_terrain_that_is_dearer_than_the_doubled_one() {
    let two_tiers = RULESET.replace("\"forest\": 2", "\"forest\": 2,\n        \"volcano\": 4");
    assert_ne!(two_tiers, RULESET, "the fixture should have been altered");
    let ruleset = Ruleset::from_json(&two_tiers).expect("should load");

    assert_eq!(ruleset.terrain_cost("volcano", MovementMode::Walk), 4);
    assert_eq!(ruleset.terrain_cost("Volcano", MovementMode::Ride), 4);
    // The premium still applies to no other mode, whatever its size.
    assert_eq!(ruleset.terrain_cost("volcano", MovementMode::Fly), 1);
    // And the first tier is untouched by the second.
    assert_eq!(ruleset.terrain_cost("forest", MovementMode::Walk), 2);
}

/// A terrain costing nothing makes a route free, which is the one thing no cost check may allow.
#[test]
fn rejects_a_terrain_priced_at_zero() {
    let broken = RULESET.replace("\"forest\": 2", "\"forest\": 0");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
    assert!(
        error.to_string().contains("forest"),
        "the message should name the terrain, got {error}"
    );
}

/// The water terrain is captured by a `(\w+)` group in the scraper, so a reworded page could put
/// any word here. Naming a terrain that also costs double is the tell-tale of a mis-capture: no
/// ruleset charges a walking premium for a hex nothing can walk into.
#[test]
fn rejects_a_water_terrain_that_is_also_difficult_going() {
    let broken = RULESET.replace("\"terrain\": \"ocean\"", "\"terrain\": \"forest\"");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// The same tell-tale, for the world that adds a second water terrain: `alsoWater` is captured by
/// the same kind of bare word match, so an extra name that also costs double is a mis-capture.
#[test]
fn rejects_a_water_terrain_that_is_also_difficult_going_in_the_extra_list() {
    let broken = RULESET.replace("\"alsoWater\": []", "\"alsoWater\": [\"forest\"]");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// A blank extra name would match no hex and silently model nothing, exactly as a blank
/// `ocean.terrain` would.
#[test]
fn rejects_a_blank_extra_water_terrain() {
    let broken = RULESET.replace("\"alsoWater\": []", "\"alsoWater\": [\" \"]");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// Negative thresholds pass an ordering check and then make every hex maximally dangerous.
#[test]
fn rejects_negative_risk_thresholds() {
    let broken = RULESET.replace("\"mediumRatio\": 1", "\"mediumRatio\": -9");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// A new rule the core does not understand must stop the run rather than be dropped in silence.
/// Getting this backwards is how a ruleset that changes costs gets ignored while claiming to apply.
#[test]
fn refuses_a_movement_rule_it_does_not_understand() {
    let extended = RULESET.replace(
        "\"movementPoints\": {",
        "\"weatherMultiplier\": { \"winter\": 3 },\n    \"movementPoints\": {",
    );
    assert_ne!(extended, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&extended).expect_err("should refuse an unknown movement rule");
    assert!(matches!(error, RulesetError::Malformed(_)));
}

/// An item kind the core has never heard of must not take movement planning down with it: what an
/// item is has no bearing on what a hex costs, and `is_man` only needs to know it is not a race.
#[test]
fn tolerates_an_item_kind_it_does_not_understand() {
    let extended = RULESET.replace("\"kind\": \"monster\"", "\"kind\": \"demon\"");
    assert_ne!(extended, RULESET, "the fixture should have been altered");

    let ruleset = Ruleset::from_json(&extended).expect("an unknown item kind should not be fatal");
    assert_eq!(ruleset.movement_points(MovementMode::Walk), 2);
    assert!(!ruleset.is_man("LION"), "an unknown kind is not a race");
}

#[test]
fn an_unknown_item_tag_is_not_a_man() {
    let ruleset = ruleset();

    assert!(!ruleset.is_man("ZZZZ"));
    assert!(!ruleset.is_man(""));
}

#[test]
fn rejects_risk_thresholds_that_are_the_wrong_way_round() {
    let broken = RULESET.replace("\"highRatio\": 3", "\"highRatio\": 0.5");
    assert_ne!(broken, RULESET, "the fixture should have been altered");

    let error = Ruleset::from_json(&broken).expect_err("should refuse");
    assert!(matches!(error, RulesetError::Unusable(_)));
}

/// Every struct in the file refuses a key it does not know, so a field the scraper starts writing
/// cannot be silently dropped on the way into the core - the file that carries it fails to load
/// until the core has a home for it. Probed at each depth the file has, since `deny_unknown_fields`
/// is per struct and one forgotten struct is a hole.
#[test]
fn an_unknown_key_anywhere_in_the_file_is_refused() {
    let json: serde_json::Value =
        serde_json::from_str(RULESET).expect("the committed file is JSON");
    let probes: [&[&str]; 7] = [
        &["source"],
        &["movement", "provenance"],
        &["risk"],
        &["gaps", "weather"],
        &["items", "HORS"],
        &["skills", "COMB"],
        &["skills", "CRRI", "cast"],
    ];
    for path in probes {
        let mut value = json.clone();
        let mut node = &mut value;
        for key in path {
            node = node
                .get_mut(*key)
                .unwrap_or_else(|| panic!("{path:?} exists in the file"));
        }
        node["notAField"] = serde_json::json!(1);
        let error = Ruleset::from_json(&value.to_string())
            .expect_err(&format!("{path:?} must refuse an unknown key"));
        assert!(
            matches!(error, RulesetError::Malformed(ref detail) if detail.contains("notAField")),
            "{error}"
        );
    }
    // And the file as committed still loads - the probes above must not have been the reason.
    Ruleset::from_json(RULESET).expect("the committed file loads");
}
