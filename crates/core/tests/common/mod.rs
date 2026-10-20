//! Shared helpers for `crates/core`'s integration tests. Not every test file uses every helper
//! here, so an unused one is expected rather than a mistake (ah-v2l).
#![allow(dead_code)]

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::effects::{ItemChangeCause, OrdersPreviewResponse, UnitPreview};
use atlantis_hud_core::orders::intents::{read_intents, spends_the_month};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::{classify_units, parse_report_full};

/// A map coordinate on the plane most fixtures live on.
pub fn at(x: i32, y: i32) -> Coordinate {
    Coordinate { x, y, z: 1 }
}

/// The shipped ruleset, parsed once per call.
pub fn ruleset() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON).expect("the committed ruleset loads")
}

/// The committed Trident ruleset - the one world here that swims.
pub fn trident_ruleset() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
        .expect("the committed Trident ruleset parses and validates")
}

/// The report's own orders template with the standing month-long orders of `units` dropped.
///
/// `rules/tax`, `rules/move` and `rules/study` each spend the unit's month, so a `PILLAGE`
/// written under a unit that still carries its template's `@tax`, `MOVE` or `@STUDY` never runs
/// and is told so instead (`ah-rzkm`). A player giving one of these units `PILLAGE` replaces its
/// standing month order; these fixtures say the same thing by dropping every one of them.
///
/// The crate's own reader and predicate decide what goes, rather than a keyword list copied into
/// test code that nothing would fail to update: `read_intents` skips `TURN` blocks, whose orders
/// belong to a later month, so those lines survive.
pub fn without_standing_month_orders(template: &str, units: &[&str]) -> String {
    let dropped: std::collections::BTreeSet<usize> = read_intents(template, None)
        .iter()
        .filter(|block| units.contains(&block.unit_id.as_str()))
        .flat_map(|block| block.intents.iter())
        .filter(|placed| spends_the_month(&placed.intent))
        .map(|placed| placed.line)
        .collect();

    template
        .lines()
        .enumerate()
        .filter(|(index, _)| !dropped.contains(&(index + 1)))
        .map(|(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n")
}

/// The preview row for `unit_id`, or `None` when the orders change nothing about it.
///
/// The preview omits every unit its orders leave alone (`OrdersPreviewResponse`'s own doc), so an
/// absent row is an ordinary answer. It is only an answer, though, when the unit exists: this
/// panics when `unit_id` is not an own unit of `report_text` at all, so a fixture that reaches
/// nothing fails as a broken fixture rather than reading as "unchanged" (ah-z9g8).
pub fn preview_row<'a>(
    report_text: &str,
    response: &'a OrdersPreviewResponse,
    unit_id: &str,
) -> Option<&'a UnitPreview> {
    let report = ReportCache::new().classified(report_text, atlantis_hud_fixtures::RULESET_JSON);
    assert!(
        report.own_units().any(|unit| unit.unit_id == unit_id),
        "unit {unit_id} is not an own unit of the fixture report, so no orders can reach it - the fixture is broken, not the preview"
    );
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == unit_id)
}

/// How many of `tag` the ITEMS preview leaves `unit` holding **before maintenance eats**: the
/// holding plus whatever [`ItemChangeCause::EatenForUpkeep`] took (`ah-q490`).
///
/// For a test about what the market, a gift or a production leaves: a unit that ends the month out
/// of silver eats its own food at maintenance (`rules/economy_maintenance`), which is true and is
/// not what such a test is about. `food_eaten_for_upkeep.rs` pins the meal itself.
pub fn held_before_upkeep(unit: &UnitPreview, tag: &str) -> i64 {
    let held: i64 = unit
        .unit
        .items
        .iter()
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum();
    let eaten: i64 = unit
        .item_changes
        .iter()
        .filter(|change| change.tag == tag && change.cause == ItemChangeCause::EatenForUpkeep)
        .map(|change| change.delta)
        .sum();
    held - eaten
}

/// As [`preview_row`], for a unit the orders are known to change: panics, naming which of the two
/// reasons it is, when there is no row.
pub fn expect_preview_row<'a>(
    report_text: &str,
    response: &'a OrdersPreviewResponse,
    unit_id: &str,
) -> &'a UnitPreview {
    preview_row(report_text, response, unit_id).unwrap_or_else(|| {
        panic!(
            "unit {unit_id} is an own unit of the report but has no preview row: the orders change nothing the preview shows about it"
        )
    })
}

/// A fleet the rules let sail, written as the report block that shows it (`ah-l20e`).
///
/// `rules/movement_sailing`: *"A fleet can only move if the total weight of everything aboard does
/// not exceed the fleet's capacity ... Also, there must be enough sailors aboard (using the SAIL
/// order), to sail the fleet, or it will not go anywhere."* A departure test that writes its hull
/// line by hand can break either without noticing, and seven did until the check was enforced on
/// every surface (`ah-zbtx`, `docs/retrospectives/ah-zbtx.md`). This one reads the hull's capacity,
/// crew requirement and speed from the ruleset, gives the captain that requirement on its own, and
/// refuses a load over capacity. **Start every new sailing test from it**, and pair it with
/// [`assert_fleet_sails`] once the orders are written: a test that wants a refused fleet writes the
/// refusal on purpose, by editing what this returns.
pub struct FleetThatSails {
    structure_id: String,
    hull: String,
    capacity: i64,
    requirement: i64,
    speed: u32,
    captain: Option<String>,
    aboard: Vec<String>,
}

/// A `hull` with id `[structure_id]`, sized from `ruleset`'s own entry for it - the catalogue
/// figures `movement::mode::cargo_capacity` and `sailing_requirement` fall back to. Panics when the
/// ruleset does not price the hull, so a typo fails here rather than as a fleet nobody can judge.
pub fn fleet_that_sails(ruleset: &Ruleset, structure_id: &str, hull: &str) -> FleetThatSails {
    let item = ruleset
        .find_item(hull)
        .unwrap_or_else(|| panic!("the ruleset has no {hull}"));
    FleetThatSails {
        structure_id: structure_id.to_string(),
        hull: hull.to_string(),
        capacity: item
            .cargo_capacity
            .unwrap_or_else(|| panic!("the ruleset states no capacity for {hull}")),
        requirement: item
            .sailing_skill
            .unwrap_or_else(|| panic!("the ruleset states no sailing requirement for {hull}")),
        speed: item.moves,
        captain: None,
        aboard: Vec::new(),
    }
}

impl FleetThatSails {
    /// The weight the hull carries, from its catalogue entry.
    pub fn capacity(&self) -> i64 {
        self.capacity
    }

    /// The sailing levels its crew must hold between them, from its catalogue entry.
    pub fn sailing_requirement(&self) -> i64 {
        self.requirement
    }

    /// The hull's captain: `unit` is its report line up to where its skills would start, e.g.
    /// `"Captain (900), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/15/0."`, and `men` its
    /// headcount. Each man is given the sailing level that lets the captain alone meet the hull's
    /// requirement - a level is held by every man of a unit ("the sailing skill increases the
    /// usefulness of a unit proportionally", `rules/movement_sailing`) - so four men sail a
    /// Longship at level 1 and three need level 2. The days beside the level are a month of
    /// training's 30 for each of the 1 + 2 + ... + level months it takes (`rules/skills_studying`).
    pub fn captain(mut self, unit: &str, men: i64) -> Self {
        assert!(men > 0, "a captain has men");
        let level = (self.requirement + men - 1) / men;
        let days = 30 * level * (level + 1) / 2;
        self.captain = Some(format!("{unit} Skills: sailing [SAIL] {level} ({days})."));
        self
    }

    /// Any other unit standing in the hull, its report line as written (without the `  * `).
    pub fn aboard(mut self, line: &str) -> Self {
        self.aboard.push(line.to_string());
        self
    }

    /// The hull line and every unit in it, as a report prints them. Its `Load:` is the sum of the
    /// units' stated weights - how the server computes it (`orders::semantics`'s `judge_sailing`,
    /// checked against two committed reports). Panics when there is no captain, a unit states no
    /// weight, or the load is over the capacity.
    pub fn text(&self) -> String {
        let captain = self
            .captain
            .as_ref()
            .unwrap_or_else(|| panic!("{} [{}] has no captain", self.hull, self.structure_id));
        let units: Vec<&String> = std::iter::once(captain).chain(&self.aboard).collect();
        let load: i64 = units.iter().map(|line| stated_weight(line)).sum();
        assert!(
            load <= self.capacity,
            "{} [{}] carries {load}, over its capacity of {}, so it will not sail",
            self.hull,
            self.structure_id,
            self.capacity
        );

        let mut text = format!(
            "+ Ship [{}] : {}; Load: {load}/{}; Sailors: {}/{}; MaxSpeed: {}.\n",
            self.structure_id,
            self.hull,
            self.capacity,
            self.requirement,
            self.requirement,
            self.speed
        );
        for line in units {
            text.push_str(&format!("  * {line}\n"));
        }
        text
    }
}

/// The `N` of a unit line's `Weight: N.`
fn stated_weight(line: &str) -> i64 {
    line.split("Weight: ")
        .nth(1)
        .and_then(|rest| {
            rest.split(|c: char| !c.is_ascii_digit())
                .next()
                .and_then(|digits| digits.parse().ok())
        })
        .unwrap_or_else(|| panic!("{line:?} states no weight, so the load cannot be summed"))
}

/// Panics, naming each finding, when the sailing check refuses a fleet of `report` under `orders`:
/// `review_turn` raises `fleet-overloaded` or `fleet-undercrewed` (`rules/movement_sailing`). The
/// report is parsed and classified the way the application reads it.
///
/// For a departure test's own fixture, so that one which sails a fleet the rules keep in port fails
/// as a broken fixture rather than passing on a departure the game would never make (`ah-zbtx`).
pub fn assert_fleet_sails(report: &str, orders: &str, ruleset: &Ruleset) {
    let mut parsed = parse_report_full(report);
    classify_units(&mut parsed, ruleset);
    let refused: Vec<String> = review_turn(&parsed, orders, Some(ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| {
            matches!(
                finding.code.as_str(),
                "fleet-overloaded" | "fleet-undercrewed"
            )
        })
        .map(|finding| format!("{}: {}", finding.code.as_str(), finding.message))
        .collect();
    assert!(
        refused.is_empty(),
        "the fixture's fleet will not sail, so the test is not about a fleet that does: {refused:#?}"
    );
}
