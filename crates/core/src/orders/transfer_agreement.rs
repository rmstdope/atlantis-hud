//! The three readers of "what did this month's GIVE/TAKE move" agree.
//!
//! One `GIVE`/`TAKE` is projected by three pieces of code that share nothing but their inputs, and
//! each decides its own answer: the preview (`orders::effects`, reaching the units table as
//! `UnitPreview::item_changes`), the headcount walk (`apply_transfers` in `orders::semantics`,
//! rewriting `holdings_after_gifts`), and the hex ledger (`transfer` in the same module, charging
//! and crediting balances at `StatePhase::Give`).
//!
//! `rules/sequenceofevents` runs `GIVE` and `TAKE` in one *Give orders* phase, and within a phase
//! "units that appear higher on the report get precedence" - one rule, three implementations of
//! it. `rules/give` is the citation for the item classes and for men not being givable to another
//! faction. This file is the safety net under `ah-1zca`: nothing may unify those projections until
//! a test can say the unification changed no answer.

use std::collections::{BTreeMap, BTreeSet};

use super::effects::{preview_orders_for_remembered_report, ItemChangeCause, UnitPreviewStatus};
use super::semantics::transfer_projection_for_tests;
use crate::cache::ReportCache;
use crate::movement::rules::Ruleset;
use crate::report::orders::extract_orders_template;
use crate::report::{classify_units, parse_report_full, ParsedReport};

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

fn ruleset() -> Ruleset {
    Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
}

/// One hex, a smith with men and iron, and a neighbour to give to.
///
/// The men must be the *first* item on each own unit's line: `count_men`
/// (`crates/core/src/report/unit.rs`) reads the headcount off `items.first()`. The shape is
/// `crates/core/tests/production_after_a_gift.rs`'s, which is the house fixture for a gift.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. \
         Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
        "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "- Stranger (7001), Bar (2), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

fn parsed(ruleset: &Ruleset) -> ParsedReport {
    let mut parsed = parse_report_full(&report_text());
    classify_units(&mut parsed, ruleset);
    parsed
}

/// How much of `tag` a unit's item list carries.
fn amount_of(items: &[crate::report::model::ItemAmount], tag: &str) -> i64 {
    items
        .iter()
        .find(|item| item.tag.eq_ignore_ascii_case(tag))
        .map_or(0, |item| item.amount)
}

#[test]
fn the_seam_reads_the_give_phase_of_a_hand_built_hex() {
    let ruleset = ruleset();
    let report = parsed(&ruleset);
    let orders = "unit 900\nGIVE 901 15 IRON\n";

    let projections = transfer_projection_for_tests(&report, orders, Some(&ruleset));

    let smith = projections
        .iter()
        .find(|projection| projection.unit_id == "900")
        .expect("the smith is an own unit of the only region");
    let hands = projections
        .iter()
        .find(|projection| projection.unit_id == "901")
        .expect("the neighbour is an own unit of the only region");

    assert_eq!(amount_of(&smith.reported_items, "IRON"), 20);
    assert_eq!(amount_of(&hands.reported_items, "IRON"), 0);

    let smith_walked = smith
        .walked_items
        .as_ref()
        .expect("the walk followed a plain gift between two own units");
    let hands_walked = hands
        .walked_items
        .as_ref()
        .expect("the walk followed a plain gift between two own units");
    assert_eq!(amount_of(smith_walked, "IRON"), 5);
    assert_eq!(amount_of(hands_walked, "IRON"), 15);

    let give_delta = |projection: &super::semantics::TransferProjection, tag: &str| {
        projection.ledger_after_give.get(tag).copied().unwrap_or(0)
            - projection.ledger_before_give.get(tag).copied().unwrap_or(0)
    };
    assert_eq!(give_delta(smith, "IRON"), -15);
    assert_eq!(give_delta(hands, "IRON"), 15);
}

/// Every item this month's transfers move into or out of one unit, netted per upper-case tag.
///
/// The five transfer causes and no others. `GiftReverted` is deliberately excluded: it is
/// `rules/form`'s dissolution reverting goods to another unit, not a Give-phase transfer, and
/// neither of the other two surfaces records it as one.
///
/// A moving unit gets an `Arriving` row under the destination and a `Departing` row under its own
/// region, and the two carry the *same* `item_changes` - the arriving row clones them. Dropping
/// the `Arriving` rows leaves every own unit the report shows with exactly one row.
fn preview_transfers(report_text: &str, orders: &str) -> BTreeMap<String, BTreeMap<String, i64>> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        report_text,
        "[]",
        orders,
    )
    .expect("the ruleset loads");

    let mut by_unit: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
    for region in &response.regions {
        for unit in &region.units {
            if unit.status == UnitPreviewStatus::Arriving {
                continue;
            }
            let entry = by_unit.entry(unit.unit.unit_id.clone()).or_default();
            for change in &unit.item_changes {
                if !matches!(
                    change.cause,
                    ItemChangeCause::GivenAway
                        | ItemChangeCause::WasGiven
                        | ItemChangeCause::Took
                        | ItemChangeCause::WasTakenFrom
                        | ItemChangeCause::Discarded
                ) {
                    continue;
                }
                *entry.entry(change.tag.to_ascii_uppercase()).or_insert(0) += change.delta;
            }
        }
    }
    by_unit
}

#[test]
fn the_preview_reads_the_same_hand_built_gift() {
    let preview = preview_transfers(&report_text(), "unit 900\nGIVE 901 15 IRON\n");

    assert_eq!(preview["900"].get("IRON").copied().unwrap_or(0), -15);
    assert_eq!(preview["901"].get("IRON").copied().unwrap_or(0), 15);
}

/// One own unit of one fixture, with each surface's Give-phase movement per tag.
#[derive(Debug, Clone)]
struct Compared {
    fixture: &'static str,
    region_id: String,
    unit_id: String,
    formed: bool,
    men_estimated: bool,
    reported_men: i64,
    /// The preview: `UnitPreview::item_changes` whose cause is one of the five transfer causes,
    /// netted per tag.
    preview: BTreeMap<String, i64>,
    /// The walk: `walked_items` minus `reported_items`, per tag. `None` where the walk answered
    /// `HoldingsAfterGifts::Unknowable`.
    walk: Option<BTreeMap<String, i64>>,
    /// The walk's own headcount, `Ordered::early_men()`.
    walked_men: i64,
    /// The ledger: `ledger_after_give` minus `ledger_before_give`, per tag.
    ledger: BTreeMap<String, i64>,
    ledger_doubted: bool,
    ledger_uncertain_tags: BTreeSet<String>,
    /// Tags some own unit of this unit's hex ends the Give phase holding *less than none* of.
    ///
    /// Per hex rather than per unit because an overdraft is a statement about the whole transfer,
    /// not about one end of it: the source that overdrew and every unit it credited are both
    /// affected. See [`Exempt::LedgerOverdrawn`].
    hex_overdrawn_tags: BTreeSet<String>,
}

/// Why one surface's answer about one tag is not compared, and what is asserted instead.
///
/// A rule, never a unit id or a tag list: a list rots the moment a fixture is added, and it hides a
/// real divergence behind "that one was already failing".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Exempt {
    /// `HoldingsAfterGifts::Unknowable`: a transfer this walk cannot follow touched the unit, so
    /// the walk has no per-tag answer at all. The preview and the ledger are still compared.
    WalkUnknowable,
    /// `Ledger::doubted` names the unit: a line of its own the ledger could not follow, so its
    /// balances are not a statement about this month. The preview and the walk are still compared.
    LedgerDoubted,
    /// `PhaseState::uncertain` marks this tag (`ah-66yi`): the ledger deliberately leaves the
    /// balance at the report's figure and shows `+ ?` rather than picking a side.
    LedgerUncertain,
    /// A man tag. `transfer`'s own comment records that the ledger asks an end-of-hex skills list
    /// where the other two ask per order, so a `GIVE` of men written above a `TAKE FROM <mage>`
    /// moves in the walk and is refused in the ledger - and that "no surface reads its man-item
    /// balance". `Working::men_clamped` is the same divergence from the other end. This is the
    /// divergence `ah-1zca.5` exists to shrink; until then the preview and the walk are compared
    /// and the ledger is not.
    ManTag,
    /// Some own unit of this hex ends the Give phase holding less than none of this tag.
    ///
    /// `transfer` charges `TransferShape::Exact(count)` in full and lets the balance go negative
    /// (`semantics.rs`, the `charge` at the end of `transfer`), because a negative balance is
    /// exactly what `report_shortfalls` reads to warn that the orders spend more than the unit
    /// holds. The preview and the headcount walk instead clamp a transfer to what the source
    /// actually has - so on an over-ordered hex the ledger's movement is a shortfall statement and
    /// the other two are a projection, and the two are not the same question.
    ///
    /// The corpus reaches this: `G3_F42_T41` has a city guard holding 2,263 silver whose thirteen
    /// `GIVE`s name 3,088 between them. It is the same clamping asymmetry `Working::men_clamped`
    /// records from the other end, for tags that are not men.
    LedgerOverdrawn,
}

/// Whether the walk's answer may be compared at all, and why not when it may not.
fn walk_exemption(case: &Compared) -> Option<Exempt> {
    case.walk.is_none().then_some(Exempt::WalkUnknowable)
}

/// Whether the ledger's answer about one tag may be compared, and why not when it may not.
fn ledger_exemption(case: &Compared, tag: &str, ruleset: &Ruleset) -> Option<Exempt> {
    if case.ledger_doubted {
        return Some(Exempt::LedgerDoubted);
    }
    if case.ledger_uncertain_tags.contains(tag) {
        return Some(Exempt::LedgerUncertain);
    }
    if case.hex_overdrawn_tags.contains(tag) {
        return Some(Exempt::LedgerOverdrawn);
    }
    // `Ruleset::is_man` and nothing else - never `ItemChange::is_man`, which only exists for tags
    // the preview happened to move.
    if ruleset.is_man(tag) {
        return Some(Exempt::ManTag);
    }
    None
}

/// Every tag any of the three surfaces mentions for this unit.
///
/// The union, because a tag that ends at zero or below is dropped from `Holdings::items`: a unit
/// that gave away all of something has *no* entry rather than a zero one, and a map built from one
/// surface alone would read that as "no change".
fn tags_mentioned(case: &Compared) -> BTreeSet<String> {
    case.preview
        .keys()
        .chain(case.walk.iter().flat_map(BTreeMap::keys))
        .chain(case.ledger.keys())
        .cloned()
        .collect()
}

/// Holds all three surfaces to one answer about one unit, failing with all three numbers named.
#[track_caller]
fn assert_the_surfaces_agree(case: &Compared, ruleset: &Ruleset) {
    let where_it_is = format!(
        "{} region {} unit {}",
        case.fixture, case.region_id, case.unit_id
    );
    let walk_exempt = walk_exemption(case);

    for tag in tags_mentioned(case) {
        let preview = case.preview.get(&tag).copied().unwrap_or(0);
        if walk_exempt.is_none() {
            let walk = case
                .walk
                .as_ref()
                .expect("an unexempted walk has an answer")
                .get(&tag)
                .copied()
                .unwrap_or(0);
            assert_eq!(
                preview, walk,
                "{where_it_is}: the preview moved {preview} {tag} and the headcount walk moved {walk}"
            );
        }
        if ledger_exemption(case, &tag, ruleset).is_none() {
            let ledger = case.ledger.get(&tag).copied().unwrap_or(0);
            assert_eq!(
                preview, ledger,
                "{where_it_is}: the preview moved {preview} {tag} and the hex ledger moved {ledger}"
            );
        }
    }

    // The headcount identity: what the walk settled is the report's figure plus what the preview
    // moved in man tags. Skipped for a unit whose `men_estimated` is set, whose `Holdings::men` is
    // deliberately not re-derived, and where the walk has no answer at all.
    if !case.men_estimated && walk_exempt.is_none() {
        let moved_men: i64 = case
            .preview
            .iter()
            .filter(|(tag, _)| ruleset.is_man(tag))
            .map(|(_, delta)| *delta)
            .sum();
        assert_eq!(
            case.walked_men,
            case.reported_men + moved_men,
            "{where_it_is}: the walk settled {} men from a reported {} while the preview moved {moved_men}",
            case.walked_men,
            case.reported_men
        );
    }
}

/// The `Compared` rows for one report text and one orders document.
fn compare_one(
    fixture: &'static str,
    report_text: &str,
    orders: &str,
    ruleset: &Ruleset,
) -> Vec<Compared> {
    let mut report = parse_report_full(report_text);
    classify_units(&mut report, ruleset);
    let preview = preview_transfers(report_text, orders);

    let projections = transfer_projection_for_tests(&report, orders, Some(ruleset));
    // One set per hex, because an overdraft is a statement about the whole transfer rather than
    // about the unit that overdrew: every unit it credited reads the same unclamped figure.
    let mut overdrawn_by_region: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for projection in &projections {
        for (tag, balance) in &projection.ledger_after_give {
            if *balance < 0 {
                overdrawn_by_region
                    .entry(projection.region_id.clone())
                    .or_default()
                    .insert(tag.clone());
            }
        }
    }

    projections
        .into_iter()
        .map(|projection| {
            let reported: BTreeMap<String, i64> = amounts_by_tag(&projection.reported_items);
            let walk = projection.walked_items.as_ref().map(|items| {
                let after = amounts_by_tag(items);
                after
                    .keys()
                    .chain(reported.keys())
                    .cloned()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .map(|tag| {
                        let delta = after.get(&tag).copied().unwrap_or(0)
                            - reported.get(&tag).copied().unwrap_or(0);
                        (tag, delta)
                    })
                    .filter(|(_, delta)| *delta != 0)
                    .collect()
            });
            let ledger = projection
                .ledger_after_give
                .keys()
                .chain(projection.ledger_before_give.keys())
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .map(|tag| {
                    let delta = projection.ledger_after_give.get(&tag).copied().unwrap_or(0)
                        - projection
                            .ledger_before_give
                            .get(&tag)
                            .copied()
                            .unwrap_or(0);
                    (tag, delta)
                })
                .filter(|(_, delta)| *delta != 0)
                .collect();
            Compared {
                fixture,
                hex_overdrawn_tags: overdrawn_by_region
                    .get(&projection.region_id)
                    .cloned()
                    .unwrap_or_default(),
                region_id: projection.region_id,
                formed: projection.formed,
                men_estimated: projection.men_estimated,
                reported_men: projection.reported_men,
                preview: preview
                    .get(&projection.unit_id)
                    .cloned()
                    .unwrap_or_default(),
                walk,
                walked_men: projection.walked_men,
                ledger,
                ledger_doubted: projection.ledger_doubted,
                ledger_uncertain_tags: projection.ledger_uncertain_tags,
                unit_id: projection.unit_id,
            }
        })
        .collect()
}

/// An item list as an upper-cased tag map.
fn amounts_by_tag(items: &[crate::report::model::ItemAmount]) -> BTreeMap<String, i64> {
    items
        .iter()
        .map(|item| (item.tag.to_ascii_uppercase(), item.amount))
        .collect()
}

#[test]
fn the_three_surfaces_agree_on_a_hand_built_gift() {
    let ruleset = ruleset();
    let text = report_text();

    for orders in [
        "unit 900\nGIVE 901 15 IRON\n",
        "unit 900\nGIVE 901 4 ORC\n",
        // A visible foreign target: `rules/give` cannot settle ordinary goods without that
        // faction's declaration toward us, so this is what exercises `Exempt::LedgerUncertain`
        // now that no committed fixture does (`ah-jo6b.1`).
        "unit 900\nGIVE 7001 15 IRON\n",
        // A class the committed catalogue cannot expand - `MAGIC` parses as a class but has no
        // `itemClasses` entry - so the ledger cannot say what moves and doubts the unit outright.
        // This is what exercises `Exempt::LedgerDoubted`, since the same bead.
        "unit 900\nGIVE 901 ALL MAGIC\n",
    ] {
        for case in compare_one("hand-built", &text, orders, &ruleset) {
            assert_the_surfaces_agree(&case, &ruleset);
        }
    }
}

/// Every own unit of every committed fixture, judged by all three surfaces.
///
/// A fixture without an orders template is **not skipped**: it is run with an empty orders
/// document, because a unit with no orders still holds goods and is still the simplest case where
/// the three surfaces are most likely to be assumed rather than checked.
fn compare_the_corpus(ruleset: &Ruleset) -> Vec<Compared> {
    atlantis_hud_fixtures::ALL
        .iter()
        .flat_map(|report| {
            let orders = extract_orders_template(report.text)
                .map(|template| template.text)
                .unwrap_or_default();
            compare_one(report.name, report.text, &orders, ruleset)
        })
        .collect()
}

#[test]
fn the_three_surfaces_agree_on_every_transfer_in_the_corpus() {
    let ruleset = ruleset();
    for case in compare_the_corpus(&ruleset) {
        assert_the_surfaces_agree(&case, &ruleset);
    }
}

/// A predicate that is never exercised asserts nothing.
///
/// Every floor is set well below what the corpus measured when this was written, so a fixture
/// added or dropped does not fail it: the floors say "this comparison still sees real transfers",
/// not "the corpus is exactly this size". Measured 2026-09-08: 1,392 own units, 319 of them with a
/// transfer, 39 `WalkUnknowable`, 9 `LedgerDoubted`, 5 `LedgerUncertain`, 18 `LedgerOverdrawn`,
/// and 337 (unit, tag) pairs compared against all three surfaces at once - every surface unexempt,
/// the walk included.
///
/// Re-measured 2026-09-09 (`ah-jo6b.1`): `LedgerDoubted` is now **0**. All nine came from
/// `SilverDoubt::GiveTargetUncertain` on gifts to a unit number the report never prints, and that
/// doubt no longer exists - the projection assumes such a gift lands. Its floor is therefore
/// dropped rather than lowered: a floor over zero would fail today and one at zero would assert
/// nothing. `LedgerUncertain` went to **0** with it and for the same reason - the five it counted
/// were unshown-target gifts too, not the visible-foreign ones expected.
///
/// Both exemptions are still reachable in production, so both are given the arrangement `ManTag`
/// already had rather than being left uncovered: `the_three_surfaces_agree_on_a_hand_built_gift`
/// gained a visible-foreign case and an unexpandable-class case, and each has a guard test of its
/// own below proving it reaches the arm it is there for.
#[test]
fn the_corpus_actually_exercises_the_agreement() {
    let ruleset = ruleset();
    let cases = compare_the_corpus(&ruleset);

    let units = cases.len();
    let moving = cases.iter().filter(|case| !case.preview.is_empty()).count();
    let walk_unknowable = cases
        .iter()
        .filter(|case| walk_exemption(case) == Some(Exempt::WalkUnknowable))
        .count();

    let mut overdrawn = 0;
    let mut compared_pairs = 0;
    for case in &cases {
        let walk_exempt = walk_exemption(case).is_some();
        for tag in tags_mentioned(case) {
            match ledger_exemption(case, &tag, &ruleset) {
                // No floor for either, and each has a guard test of its own - see the note above.
                Some(Exempt::LedgerDoubted) | Some(Exempt::LedgerUncertain) => {}
                Some(Exempt::LedgerOverdrawn) => overdrawn += 1,
                // `ManTag` has no floor: the corpus moves no men at all, and the case below is
                // where that arm is exercised instead.
                Some(Exempt::ManTag) => {}
                // Unreachable, and asserted rather than silently absorbed: `WalkUnknowable` only
                // ever comes from `walk_exemption`, and an arm that quietly accepted it here
                // would read as though walk exemptions were accounted for in this count.
                Some(Exempt::WalkUnknowable) => {
                    unreachable!("ledger_exemption never answers WalkUnknowable")
                }
                // Held to *all three*, so the walk must be unexempt too: a pair whose walk
                // answered `Unknowable` was compared against two surfaces, not three, and
                // counting it here would overstate what this floor guards.
                None if !walk_exempt => compared_pairs += 1,
                None => {}
            }
        }
    }

    assert!(units > 500, "own units compared: {units}");
    assert!(moving > 20, "units whose month moves an item: {moving}");
    assert!(
        compared_pairs > 100,
        "(unit, tag) pairs held to all three surfaces at once: {compared_pairs}"
    );
    assert!(
        walk_unknowable > 0,
        "WalkUnknowable exemptions: {walk_unknowable}"
    );
    assert!(overdrawn > 0, "LedgerOverdrawn exemptions: {overdrawn}");

    // No floor for `Exempt::ManTag`, and none for a formed unit either: the corpus's committed
    // templates move no man tag and carry no `FORM`, so both measured zero on 2026-09-08. A floor
    // over zero would fail today and one *at* zero would assert nothing, so neither is written -
    // exactly as `crates/core/tests/silver_agrees_with_the_warning.rs` dates its own missing row.
    // `the_three_surfaces_agree_on_a_hand_built_gift` is what exercises the man-tag arm.
    assert_eq!(
        cases.iter().filter(|case| case.formed).count(),
        0,
        "a fixture now carries a FORM: give the formed-unit case a floor of its own"
    );
}

/// The hand-built `GIVE 901 ALL MAGIC` is the `LedgerDoubted` arm's only exercise now that no
/// committed fixture reaches it (`ah-jo6b.1`), so it must really reach it. `transfer` doubts a unit
/// whose line "moves an amount that depends on classifying everything the unit holds, which is not
/// modelled".
#[test]
fn the_hand_built_class_gift_reaches_the_ledger_doubted_exemption() {
    let ruleset = ruleset();
    let text = report_text();
    let cases = compare_one(
        "hand-built",
        &text,
        "unit 900\nGIVE 901 ALL MAGIC\n",
        &ruleset,
    );

    let smith = cases
        .iter()
        .find(|case| case.unit_id == "900")
        .expect("the smith is compared");
    assert_eq!(
        ledger_exemption(smith, "IRON", &ruleset),
        Some(Exempt::LedgerDoubted),
        "a class the ledger cannot expand leaves none of this unit's balances a statement"
    );
}

/// The hand-built `GIVE 7001 15 IRON` is the `LedgerUncertain` arm's only exercise now that no
/// committed fixture reaches it (`ah-jo6b.1`), so it must really reach it. `rules/give`: ordinary
/// goods need the target faction's declaration toward us, which no report carries.
#[test]
fn the_hand_built_foreign_gift_reaches_the_ledger_uncertain_exemption() {
    let ruleset = ruleset();
    let text = report_text();
    let cases = compare_one(
        "hand-built",
        &text,
        "unit 900\nGIVE 7001 15 IRON\n",
        &ruleset,
    );

    let smith = cases
        .iter()
        .find(|case| case.unit_id == "900")
        .expect("the smith is compared");
    assert_eq!(
        ledger_exemption(smith, "IRON", &ruleset),
        Some(Exempt::LedgerUncertain),
        "a visible foreign target leaves the ledger's IRON balance at the report's figure"
    );
}

/// The hand-built `GIVE 901 4 ORC` is the man-tag arm's only exercise, so it must really reach it.
#[test]
fn the_hand_built_gift_of_men_reaches_the_man_tag_exemption() {
    let ruleset = ruleset();
    let text = report_text();
    let cases = compare_one("hand-built", &text, "unit 900\nGIVE 901 4 ORC\n", &ruleset);

    let smith = cases
        .iter()
        .find(|case| case.unit_id == "900")
        .expect("the smith is compared");
    assert_eq!(smith.preview.get("ORC").copied().unwrap_or(0), -4);
    assert_eq!(
        ledger_exemption(smith, "ORC", &ruleset),
        Some(Exempt::ManTag),
        "ORC is a man tag, so the ledger arm is exempt and the preview and the walk carry the case"
    );
    assert_eq!(walk_exemption(smith), None, "the walk followed this gift");
    assert_eq!(smith.walked_men, smith.reported_men - 4);
}
