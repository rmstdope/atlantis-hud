//! An owner's EVICT puts its target outside the structure, and an EVICT by anybody else is
//! refused (`ah-0ace`).
//!
//! `rules/evict`: "Evict the specified unit from the object of which you are currently the
//! owner." `../Atlantis/runorders.cpp` `RunOrders` runs ENTER/LEAVE, then `RunPromoteOrders`,
//! which runs each object's owner's PROMOTE and then its owner's EVICT (`Object::GetOwner`, the
//! first unit in the object), and errors every other unit's "EVICT: Must be owner" - or "EVICT:
//! Can only evict inside structures." for one standing in no structure. `Do1EvictOrder` moves
//! each target to the region's dummy object: outside. Both run before any month-long order, so a
//! mage evicted this month studies outside, and `rules/magic_skills` halves a magic study above
//! level 2 there.
//!
//! Lonthax plain (36,44) of the committed turn 24: Six of Seven (1296, FORC 2 (145), `@study
//! forc`) stands outside; Drones (7183) is alone in `Building [5] : Stockade`
//! (`neworigins-3.0.0-g5-f21-t24.rep:1392`) and its template LEAVEs.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, OrdersPreviewResponse, StudyForecast,
};
use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::{expect_preview_row, ruleset};

const MAGE: &str = "1296";
const DRONES: &str = "7183";

fn report() -> &'static str {
    atlantis_hud_fixtures::G5_F21_T24.text
}

/// The turn's own orders with the mage writing `mage` and the Drones' block opening with
/// `drones` in place of its template LEAVE.
fn orders(mage: &str, drones: &str) -> String {
    let template = extract_orders_template(report())
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let leave = format!("\nunit {DRONES}\n");
    let at = template.find(&leave).expect("the Drones have a block") + leave.len();
    let block_end = at + template[at..].find("\nunit ").expect("a block follows");
    let block = &template[at..block_end];
    assert!(
        block.contains("\nleave\n"),
        "the template LEAVEs: {block:?}"
    );
    let mut orders = format!(
        "{}{}",
        &template[..at],
        block.replacen("\nleave\n", &format!("\n{drones}"), 1)
    );
    orders.push_str(&template[block_end..]);
    let header = format!("\nunit {MAGE}\n");
    assert_eq!(orders.matches(&header).count(), 1, "{header:?} once");
    orders.replace(&header, &format!("{header}{mage}\n"))
}

fn preview(orders: &str) -> OrdersPreviewResponse {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        report(),
        "[]",
        orders,
    )
    .expect("the ruleset loads")
}

fn findings(orders: &str) -> Vec<Finding> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(report());
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default()).findings
}

/// The mage's structure in the preview, and its study forecast.
fn mage(orders: &str) -> (Option<String>, StudyForecast) {
    let response = preview(orders);
    let row = expect_preview_row(report(), &response, MAGE);
    (
        row.unit.structure_id.clone(),
        row.study.clone().expect("the mage's study is forecast"),
    )
}

fn halving_warned(findings: &[Finding]) -> bool {
    findings.iter().any(|finding| {
        finding.code == codes::MAGIC_STUDY_OUTSIDE_BUILDING
            && finding.unit_id.as_deref() == Some(MAGE)
    })
}

fn evict_warnings(findings: &[Finding], unit_id: &str) -> Vec<String> {
    findings
        .iter()
        .filter(|finding| {
            finding.unit_id.as_deref() == Some(unit_id) && finding.message.starts_with("EVICT")
        })
        .map(|finding| finding.message.clone())
        .collect()
}

/// The control: the mage enters the Stockade and nobody evicts it, so it studies sheltered.
#[test]
fn a_mage_nobody_evicts_studies_inside() {
    let orders = orders("ENTER 5", "");
    let (structure, study) = mage(&orders);
    assert_eq!(structure.as_deref(), Some("5"));
    assert!(!study.halved_outside_a_building, "{study:?}");
    assert_eq!(study.points_after, 175, "{study:?}");
    assert!(!halving_warned(&findings(&orders)));
}

/// The bug: the Drones stay as owner and EVICT the mage, which ends the month outside, its
/// FORC month halved (145 + 30 / 2 = 160) and warned about.
#[test]
fn an_owners_evict_puts_the_mage_outside() {
    let orders = orders("ENTER 5", &format!("EVICT {MAGE}\n"));
    let (structure, study) = mage(&orders);
    assert_eq!(structure, None, "the evicted mage stands outside");
    assert!(study.halved_outside_a_building, "{study:?}");
    assert_eq!(study.points_after, 160, "{study:?}");
    let findings = findings(&orders);
    assert!(halving_warned(&findings), "{findings:#?}");
    assert!(
        evict_warnings(&findings, DRONES).is_empty(),
        "{findings:#?}"
    );
}

/// An EVICT by a unit that does not own the structure is refused "EVICT: Must be owner" and
/// changes nothing: the mage enters behind the Drones and tries to evict them.
#[test]
fn an_evict_by_a_unit_that_does_not_own_the_structure_is_refused() {
    let orders = orders(&format!("ENTER 5\nEVICT {DRONES}"), "");
    let findings = findings(&orders);
    assert_eq!(
        evict_warnings(&findings, MAGE),
        vec![
            "EVICT will be refused: Drones (7183) owns Stockade [5] when evictions run, \
             not this unit, so nothing changes"
                .to_string()
        ],
        "{findings:#?}"
    );
    let response = preview(&orders);
    let drones = expect_preview_row(report(), &response, DRONES);
    assert_eq!(drones.unit.structure_id.as_deref(), Some("5"));
    let (structure, study) = mage(&orders);
    assert_eq!(structure.as_deref(), Some("5"));
    assert_eq!(study.points_after, 175, "{study:?}");
}

/// The template's LEAVE runs first, so the Drones stand in no structure when evictions run: the
/// game refuses "EVICT: Can only evict inside structures." and the mage, now the Stockade's only
/// occupant, studies inside.
#[test]
fn an_evict_from_outside_any_structure_is_refused() {
    let orders = orders("ENTER 5", &format!("leave\nEVICT {MAGE}\n"));
    let findings = findings(&orders);
    assert_eq!(
        evict_warnings(&findings, DRONES),
        vec![
            "EVICT will be refused: this unit stands in no structure when evictions run, so \
             nothing changes"
                .to_string()
        ],
        "{findings:#?}"
    );
    let (structure, study) = mage(&orders);
    assert_eq!(structure.as_deref(), Some("5"));
    assert_eq!(study.points_after, 175, "{study:?}");
}

/// `Game::RunPromoteOrders` runs the PROMOTEs before the EVICTs, so an owner that promotes the
/// mage owns the Stockade no longer: its EVICT is refused and the mage, now the owner, studies
/// inside.
#[test]
fn an_evict_after_promoting_its_target_is_refused() {
    let orders = orders("ENTER 5", &format!("PROMOTE {MAGE}\nEVICT {MAGE}\n"));
    let findings = findings(&orders);
    assert_eq!(
        evict_warnings(&findings, DRONES),
        vec![
            "EVICT will be refused: Six of Seven (1296) owns Stockade [5] when evictions run, \
             not this unit, so nothing changes"
                .to_string()
        ],
        "{findings:#?}"
    );
    let (structure, study) = mage(&orders);
    assert_eq!(structure.as_deref(), Some("5"));
    assert_eq!(study.points_after, 175, "{study:?}");
    assert!(!halving_warned(&findings));
}

/// Five of Eight (1294) stands in the other Stockade, `Building [4]`, in the same hex: a unit that
/// is not in the Drones' object.
const ELSEWHERE: &str = "1294";

/// Of several PROMOTEs one unit writes, only the last is kept (`ah-nhgo`): `../Atlantis
/// parseorders.cpp` `ProcessPromoteOrder` overwrites `u->promote`. The Drones' last PROMOTE names
/// themselves, so they still own the Stockade when EVICTs run; their EVICT runs and the mage
/// studies outside.
#[test]
fn the_last_of_several_promotes_decides_who_owns() {
    let orders = orders(
        "ENTER 5",
        &format!("PROMOTE {MAGE}\nPROMOTE {DRONES}\nEVICT {MAGE}\n"),
    );
    let findings = findings(&orders);
    assert!(
        evict_warnings(&findings, DRONES).is_empty(),
        "the Drones still own the Stockade, so their EVICT runs: {findings:#?}"
    );
    let (structure, study) = mage(&orders);
    assert_eq!(structure, None, "the evicted mage stands outside");
    assert_eq!(study.points_after, 160, "{study:?}");
}

/// A last PROMOTE naming a unit not in the object promotes nobody (`ah-nhgo`): `../Atlantis
/// runorders.cpp` `Do1PromoteOrder` errors "PROMOTE: Can't find target." and returns, and the
/// earlier PROMOTE of the mage was overwritten (`ProcessPromoteOrder`). So the Drones still own
/// the Stockade and their EVICT puts the mage outside.
#[test]
fn a_last_promote_naming_a_unit_not_in_the_structure_promotes_nobody() {
    let orders = orders(
        "ENTER 5",
        &format!("PROMOTE {MAGE}\nPROMOTE {ELSEWHERE}\nEVICT {MAGE}\n"),
    );
    let findings = findings(&orders);
    assert!(
        evict_warnings(&findings, DRONES).is_empty(),
        "the Drones still own the Stockade, so their EVICT runs: {findings:#?}"
    );
    let (structure, study) = mage(&orders);
    assert_eq!(structure, None, "the evicted mage stands outside");
    assert_eq!(study.points_after, 160, "{study:?}");
}
