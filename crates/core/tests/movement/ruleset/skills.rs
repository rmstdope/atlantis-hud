//! What a month of study costs, which is what order validation prices a STUDY order from. The
//! figures are the ones the rules page singles out: "Most skills cost $10 per person per month to
//! study ... The exceptions are Stealth and Observation (both of which cost $50), Magic skills
//! (which cost $100), and Tactics (which costs $200)."

use crate::common::ruleset;
use atlantis_hud_core::movement::rules::{
    CastInput, CastOutput, ControlCap, MovementMode, Ruleset,
};

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

#[test]
fn reads_what_a_month_of_study_costs() {
    let ruleset = ruleset();

    assert_eq!(cost_of(&ruleset, "MINI"), Some(10));
    assert_eq!(cost_of(&ruleset, "TACT"), Some(200));
    assert_eq!(cost_of(&ruleset, "STEA"), Some(50));
    assert_eq!(cost_of(&ruleset, "FORC"), Some(100));
}

fn cost_of(ruleset: &Ruleset, text: &str) -> Option<i64> {
    ruleset.find_skill(text).and_then(|skill| skill.cost)
}

/// What CASTing a skill consumes, as ah-dbb.2 will charge it against. Most spells state no cost at
/// all, which is why `cast` is `Option` rather than an always-present, possibly-empty list.
#[test]
fn reads_what_a_cast_consumes() {
    let ruleset = ruleset();

    let crri = ruleset
        .find_skill("CRRI")
        .expect("CRRI is in the catalogue");
    let cast = crri.cast.as_ref().expect("CRRI has a casting cost");
    assert_eq!(
        cast.costs,
        vec![CastInput {
            tag: "SILV".into(),
            amount: 600
        }]
    );
    assert!(cast.transmute.is_empty());

    let eswo = ruleset
        .find_skill("ESWO")
        .expect("ESWO is in the catalogue");
    assert_eq!(
        eswo.cast.as_ref().expect("ESWO has a casting cost").costs,
        vec![CastInput {
            tag: "SWOR".into(),
            amount: 1
        }]
    );

    let swin = ruleset
        .find_skill("SWIN")
        .expect("SWIN is in the catalogue");
    assert_eq!(
        swin.cast.as_ref().expect("SWIN has a casting cost").costs,
        vec![
            CastInput {
                tag: "FLOA".into(),
                amount: 75
            },
            CastInput {
                tag: "IRWD".into(),
                amount: 75
            }
        ]
    );

    let cgat = ruleset
        .find_skill("CGAT")
        .expect("CGAT is in the catalogue");
    assert_eq!(
        cgat.cast.as_ref().expect("CGAT has a casting cost").costs,
        vec![CastInput {
            tag: "SILV".into(),
            amount: 1000
        }]
    );

    let trns = ruleset
        .find_skill("TRNS")
        .expect("TRNS is in the catalogue");
    let trns_cast = trns.cast.as_ref().expect("TRNS has a casting cost");
    assert_eq!(
        trns_cast.transmute.get("ROOT").map(String::as_str),
        Some("STON")
    );
    assert_eq!(
        trns_cast.transmute.get("MITH").map(String::as_str),
        Some("IRON")
    );

    let fire = ruleset
        .find_skill("FIRE")
        .expect("FIRE is in the catalogue");
    assert!(fire.cast.is_none());
}

/// What CASTing a skill creates, as `ah-ofpb.4` will charge against and `ah-ofpb.5` will render.
/// Nothing here is charged or shown yet - this bead only records the figure.
#[test]
fn reads_what_a_cast_creates() {
    let ruleset = ruleset();

    let eswo = ruleset
        .find_skill("ESWO")
        .expect("ESWO is in the catalogue");
    assert_eq!(
        eswo.cast.as_ref().expect("ESWO has a casting cost").creates,
        vec![CastOutput {
            tag: "MSWO".into(),
            level: 1,
            percent_per_level: 500,
            level_offset: 0,
            averaged: false,
            summoned: false,
            control: None
        }]
    );

    let crru = ruleset
        .find_skill("CRRU")
        .expect("CRRU is in the catalogue");
    let crru_creates = &crru.cast.as_ref().expect("CRRU has a casting cost").creates;
    assert_eq!(crru_creates.len(), 1);
    assert_eq!(crru_creates[0].percent_per_level, 90);

    let trns = ruleset
        .find_skill("TRNS")
        .expect("TRNS is in the catalogue");
    let trns_creates = &trns.cast.as_ref().expect("TRNS has a casting cost").creates;
    let yew = trns_creates
        .iter()
        .find(|made| made.tag == "YEW")
        .expect("TRNS creates yew");
    assert_eq!(yew.level, 4);

    let bird = ruleset
        .find_skill("BIRD")
        .expect("BIRD is in the catalogue");
    let bird_creates = &bird.cast.as_ref().expect("BIRD has a casting cost").creates;
    let eagl = bird_creates
        .iter()
        .find(|made| made.tag == "EAGL")
        .expect("BIRD creates eagles");
    assert_eq!(eagl.level_offset, -2);

    let cgat = ruleset
        .find_skill("CGAT")
        .expect("CGAT is in the catalogue");
    let cgat_cast = cgat.cast.as_ref().expect("CGAT has a casting cost");
    assert!(cgat_cast.creates.is_empty());
    assert!(!cgat_cast.costs.is_empty());

    // WOLF states no cost anywhere on the page, so before this bead it had no `cast` at all.
    let wolf = ruleset
        .find_skill("WOLF")
        .expect("WOLF is in the catalogue");
    let wolf_cast = wolf.cast.as_ref().expect("WOLF now has a cast block");
    assert!(wolf_cast.costs.is_empty());
    assert_eq!(
        wolf_cast.creates,
        vec![CastOutput {
            tag: "WOLF".into(),
            level: 1,
            percent_per_level: 200,
            level_offset: 0,
            averaged: true,
            summoned: true,
            control: Some(ControlCap {
                multiplier: 4,
                offset: 0,
                exponent: 2
            })
        }]
    );

    // BIRD, DRAG and SUBA are the other three skills that state a control cap on the page - see
    // this test's own doc comment for why nothing here is charged or shown yet.
    let bird_cap = bird_creates
        .iter()
        .find(|made| made.tag == "EAGL")
        .expect("BIRD creates eagles")
        .control
        .clone()
        .expect("BIRD states a control cap");
    assert_eq!(
        bird_cap,
        ControlCap {
            multiplier: 2,
            offset: -2,
            exponent: 2
        }
    );
    assert!(eagl.summoned);
    assert!(eagl.averaged);

    let drag = ruleset
        .find_skill("DRAG")
        .expect("DRAG is in the catalogue");
    let drag_creates = &drag.cast.as_ref().expect("DRAG has a casting cost").creates;
    assert_eq!(drag_creates.len(), 1);
    assert_eq!(
        drag_creates[0].control,
        Some(ControlCap {
            multiplier: 1,
            offset: 0,
            exponent: 1
        })
    );
    assert!(drag_creates[0].summoned);
    assert!(!drag_creates[0].averaged);

    let suba = ruleset
        .find_skill("SUBA")
        .expect("SUBA is in the catalogue");
    let suba_creates = &suba.cast.as_ref().expect("SUBA has a casting cost").creates;
    assert_eq!(suba_creates.len(), 1);
    assert_eq!(
        suba_creates[0].control,
        Some(ControlCap {
            multiplier: 1,
            offset: 0,
            exponent: 0
        })
    );
    assert!(suba_creates[0].summoned);
    assert!(!suba_creates[0].averaged);
}

/// A ruleset from before casting costs were scraped must still load: the shell serves whatever
/// file is deployed, and a skill entry that predates the field is not malformed for lacking it.
#[test]
fn a_skill_entry_without_a_cast_block_still_loads() {
    let mut value: serde_json::Value = serde_json::from_str(RULESET).expect("the ruleset is JSON");
    value["skills"]["MINI"]
        .as_object_mut()
        .expect("MINI is a skill entry")
        .remove("cast")
        .expect("the committed entry has a cast field");
    let stripped = serde_json::to_string(&value).expect("it serialises back");

    let ruleset = Ruleset::from_json(&stripped).expect("a skill entry without cast should load");
    assert_eq!(
        ruleset
            .find_skill("MINI")
            .and_then(|skill| skill.cast.as_ref()),
        None
    );
}

/// What a skill may PRODUCE, and the level at which each becomes available - what ah-bai.2 will use
/// to narrow the PRODUCE completion popup to what the unit standing in the hex can actually make.
#[test]
fn reads_what_a_skill_can_produce() {
    let ruleset = ruleset();

    let mini = ruleset
        .find_skill("MINI")
        .expect("MINI is in the catalogue");
    // Projected to tag and level: what this test is about is which products appear at which
    // level, and the recipe fields beside them are `reads_what_a_production_consumes`' business.
    assert_eq!(
        mini.produces
            .iter()
            .map(|made| (made.tag.as_str(), made.level))
            .collect::<Vec<_>>(),
        vec![("IRON", 1), ("MITH", 3), ("ADMT", 5)]
    );

    let weap = ruleset
        .find_skill("WEAP")
        .expect("WEAP is in the catalogue");
    let weapons: Vec<_> = weap
        .produces
        .iter()
        .map(|made| (made.tag.as_str(), made.level))
        .collect();
    assert!(weapons.contains(&("SWOR", 1)));
    assert!(weapons.contains(&("ASWR", 5)));
}

/// ah-19l2.1: the recipe itself, from the committed ruleset - the catapult being the one production
/// a real committed turn orders, at 3000 silver apiece and one per four man-months.
#[test]
fn reads_what_a_production_consumes() {
    let ruleset = ruleset();

    let carp = ruleset
        .find_skill("CARP")
        .expect("CARP is in the catalogue");
    let catapult = carp
        .produces
        .iter()
        .find(|made| made.tag == "CATP")
        .expect("a carpenter may produce catapults");

    assert_eq!(catapult.man_months, Some(4));
    assert_eq!(catapult.outputs, Some(1));
    assert!(!catapult.inputs_are_alternatives);
    assert_eq!(
        catapult
            .inputs
            .iter()
            .map(|input| (input.tag.as_str(), input.amount))
            .collect::<Vec<_>>(),
        vec![("WOOD", 250), ("IRWD", 30), ("FUR", 80), ("SILV", 3000)]
    );

    // A raw resource takes labour and nothing else - an empty list rather than an absent one.
    let mini = ruleset
        .find_skill("MINI")
        .expect("MINI is in the catalogue");
    assert!(mini.produces[0].inputs.is_empty());
}

/// A material a product is made from must never be recorded as a product itself: WEAP produces
/// swords from iron and crossbows from wood, and it is not a miner or a lumberjack.
#[test]
fn a_product_is_not_confused_with_its_materials() {
    let ruleset = ruleset();

    let weap = ruleset
        .find_skill("WEAP")
        .expect("WEAP is in the catalogue");
    assert!(!weap.produces.iter().any(|p| p.tag == "IRON"));
    assert!(!weap.produces.iter().any(|p| p.tag == "WOOD"));
}

/// A count, deliberately: when the fixture page is next updated these numbers move, and that is
/// worth a failing test rather than a silent change.
#[test]
fn the_committed_ruleset_names_every_producing_skill() {
    let ruleset = ruleset();

    let producing: Vec<_> = ruleset
        .skills
        .values()
        .filter(|skill| !skill.produces.is_empty())
        .collect();
    assert_eq!(producing.len(), 13, "expected 13 producing skills");

    let pairs: usize = producing.iter().map(|skill| skill.produces.len()).sum();
    assert_eq!(pairs, 53, "expected 53 skill-item production pairs");
}

/// A ruleset from before production was scraped must still load: the shell serves whatever file is
/// deployed, and a skill entry that predates the field is not malformed for lacking it.
#[test]
fn a_skill_entry_without_a_produces_block_still_loads() {
    let mut value: serde_json::Value = serde_json::from_str(RULESET).expect("the ruleset is JSON");
    value["skills"]["MINI"]
        .as_object_mut()
        .expect("MINI is a skill entry")
        .remove("produces")
        .expect("the committed entry has a produces field");
    let stripped = serde_json::to_string(&value).expect("it serialises back");

    let ruleset =
        Ruleset::from_json(&stripped).expect("a skill entry without produces should load");
    assert_eq!(
        ruleset.find_skill("MINI").map(|skill| &skill.produces),
        Some(&Vec::new())
    );
}

/// A player writes a skill the way they like: `STUDY obse`, `STUDY COMBAT`, `STUDY herb_lore`. The
/// abbreviation is the tag, and a name with a space in it comes quoted or underscored.
#[test]
fn finds_a_skill_by_tag_or_name_however_it_is_written() {
    let ruleset = ruleset();

    assert_eq!(tag_of(&ruleset, "obse"), Some("OBSE"));
    assert_eq!(tag_of(&ruleset, "COMBAT"), Some("COMB"));
    assert_eq!(tag_of(&ruleset, "herb_lore"), Some("HERB"));
    assert_eq!(tag_of(&ruleset, "herb lore"), Some("HERB"));
}

fn tag_of<'a>(ruleset: &'a Ruleset, text: &str) -> Option<&'a str> {
    ruleset.find_skill(text).map(|skill| skill.tag.as_str())
}

/// Ten tags name a skill and an item both - FISH is fishing and also fish. The two catalogues are
/// separate, so looking one up must never answer with the other.
#[test]
fn a_tag_shared_with_an_item_still_finds_the_skill() {
    let ruleset = ruleset();

    assert_eq!(
        ruleset.find_skill("FISH").map(|skill| skill.name.as_str()),
        Some("fishing")
    );
    assert_eq!(ruleset.items["FISH"].name, "fish");
}

/// "annihilation [ANNI] 1: ... This skill cannot be studied via normal means." The page prices it
/// nowhere, so the catalogue carries no price and the validator can stay silent rather than invent
/// one.
#[test]
fn a_skill_the_page_prices_nowhere_carries_no_cost() {
    let ruleset = ruleset();

    let skill = ruleset
        .find_skill("ANNI")
        .expect("annihilation is in the catalogue");
    assert_eq!(skill.cost, None);
}

#[test]
fn a_skill_the_catalogue_does_not_have_is_not_found() {
    let ruleset = ruleset();

    assert!(ruleset.find_skill("flying").is_none());
    assert!(ruleset.find_skill("").is_none());
}

/// A ruleset from before the skills block existed must still load. The shell serves whatever file
/// is deployed, and a player's orders are not at fault for a config that predates a feature.
#[test]
fn a_ruleset_without_a_skill_catalogue_still_loads() {
    let mut value: serde_json::Value = serde_json::from_str(RULESET).expect("the ruleset is JSON");
    value
        .as_object_mut()
        .expect("a ruleset is an object")
        .remove("skills")
        .expect("the committed ruleset has a skills block");
    let stripped = serde_json::to_string(&value).expect("it serialises back");

    let ruleset = Ruleset::from_json(&stripped).expect("a ruleset without skills should load");
    assert_eq!(ruleset.movement_points(MovementMode::Walk), 2);
    assert!(ruleset.find_skill("MINI").is_none());
}
