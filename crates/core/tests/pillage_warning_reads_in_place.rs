//! The pillage warning on the report `ah-cw75` was filed from, asserted in full.
//!
//! The navigator gave `PILLAGE` to `Taxers (10116)` in forest (36,0) of Reprau and was told
//! *"needs 24 combat ready men, this faction has 0"* about a unit visibly holding 19 high elves.
//! Two things were wrong: the count said `faction` where it counted a region, and the count itself
//! was wrong - the unit holds **combat [COMB] 1**, and the rules' taxing test makes every man of
//! such a unit a taxer whatever it wields.
//!
//! `ah-q6bt` changed the subject a third time, to the units that actually ordered `PILLAGE`
//! (decision G1) - `Taxers (10116)` is the only one here, so the number is unchanged and it is the
//! sentence that moved.
//!
//! Unit tests pin both halves in isolation. This pins the sentence a player actually reads, on the
//! real report, because that is the thing the bead exists for and no isolated fixture proves it.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

#[test]
fn the_reported_pillage_warning_names_the_pillagers_and_counts_a_combat_skilled_unit() {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G3_F42_T82.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{orders}\nunit 10116\nPILLAGE\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    let told: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "pillage-without-men")
        .map(|finding| finding.message.as_str())
        .collect();

    assert_eq!(
        told,
        vec!["cannot pillage here: needs 24 combat ready men, the units ordering PILLAGE have 19"],
        "the warning the bead was filed from"
    );
}

/// `ah-q6bt`: the navigator ordered `PILLAGE` on Transporter (2418) in mountain (36,4), a hex whose
/// tax base is $22,654, and **no warning fired at all**.
///
/// The cause is `combat_ready_in`'s `?` inside its loop: one own unit anywhere in the hex whose
/// `readiness` cannot be told made the whole regional total `None`, and `check_pillage_men` then
/// returned before it marked anything. A `GIVE` of a class the catalogue cannot enumerate is
/// exactly such a unit, and mountain (36,4) holds ninety-odd own units - it takes one.
#[test]
fn pillage_warning_fires_when_a_gift_cannot_be_followed() {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{orders}\nunit 13303\nGIVE 2418 ALL MAGIC\nunit 2418\nPILLAGE\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    let told: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "pillage-without-men")
        .map(|finding| finding.message.as_str())
        .collect();

    assert_eq!(
        told.len(),
        1,
        "one warning, on 2418's PILLAGE line: {told:?}"
    );
}

/// Decision **G1** (`ah-q6bt`): only the units that *issue* `PILLAGE` count towards the threshold.
///
/// City Guards (13303) stands in the same hex with 445 orcs and 592 swords - a sword needs no skill
/// to wield (`data/sword`) - and orders nothing. Under the rules text's faction-wide count it would
/// carry a one-man Transporter over a threshold of 227 and hand it $45,308; the navigator's rule is
/// that a unit standing by having ordered nothing does not help.
#[test]
fn a_bystander_units_men_do_not_meet_the_threshold() {
    let told = pillage_warnings("\nunit 2418\nPILLAGE\n");

    assert_eq!(
        told,
        vec![
            "cannot pillage here: needs 227 combat ready men, the units ordering PILLAGE have 0 — it has no combat skill, no weapon it can wield, no mount it can ride and no damaging spell"
        ],
        "the bystander's 445 armed men are not counted"
    );
}

/// The other half of G1: the men of the units that *do* order it add up across them. City Guards'
/// 445 alone clear the threshold of 227, so nothing is said at all.
#[test]
fn pillagers_men_add_up_across_units() {
    let told = pillage_warnings("\nunit 2418\nPILLAGE\nunit 13303\nPILLAGE\n");

    assert!(
        told.is_empty(),
        "445 combat ready men over a threshold of 227: {told:?}"
    );
}

/// Decision **U1** (`ah-q6bt`): a pillaging unit whose own men cannot be counted says so, rather
/// than asserting a shortfall it cannot know. The gift is to the pillaging unit itself, so it is
/// 2418's own readiness that is unknowable.
#[test]
fn says_it_cannot_tell_when_the_pillagers_men_are_unknown() {
    let told = pillage_warnings("\nunit 13303\nGIVE 2418 ALL MAGIC\nunit 2418\nPILLAGE\n");

    assert_eq!(
        told,
        vec![
            "may not be able to pillage here: needs 227 combat ready men, and a transfer this month means this unit's cannot be counted"
        ],
        "no `— this unit has` tail: there is no readiness to build one from"
    );
}

/// A unit that *was* counted, in a hex where another pillager was not, is still told it cannot:
/// its own men are known and the shortfall is real as far as anything can be known. The hedge
/// belongs on the unit the doubt is about, which is why the branch is chosen per unit.
///
/// `GIVE 2418 ALL MAGIC` makes both giver and receiver unfollowable, so Fighters (12222) - 50 orcs
/// and 48 swords, untouched by the gift - is the countable pillager here.
#[test]
fn a_countable_pillager_is_still_told_it_cannot() {
    let told = pillage_warnings(
        "\nunit 13303\nGIVE 2418 ALL MAGIC\nunit 2418\nPILLAGE\nunit 12222\nPILLAGE\n",
    );

    assert_eq!(
        told,
        vec![
            "may not be able to pillage here: needs 227 combat ready men, and a transfer this month means this unit's cannot be counted",
            "cannot pillage here: needs 227 combat ready men, the units ordering PILLAGE have 50",
        ],
        "the hedge on the unit that cannot be counted, the flat refusal on the one that can"
    );
}

/// The pillage warnings of mountain (36,4) in `G3_F42_T42`, in the order they are raised, with
/// `extra` appended to the report's own orders template.
fn pillage_warnings(extra: &str) -> Vec<String> {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{orders}{extra}");

    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "pillage-without-men")
        .map(|finding| finding.message.clone())
        .collect()
}
