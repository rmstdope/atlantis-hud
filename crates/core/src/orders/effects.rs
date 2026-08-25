//! What this month's orders make of the units the report described.
//!
//! The report says where every unit stands today; the orders document says what each one has been
//! told to do. This module applies the orders that change how a unit *reads* - its name, its
//! flags, what it carries, where it sits and where it is going - so the interface can show the
//! coming month instead of the past one. Orders whose outcome depends on the game's own dice or on
//! other factions (taxing, studying, production, combat) are left alone: showing a guess as fact
//! is worse than showing the report.
//!
//! The governing policy is the validator's own **accept on doubt**: an order that cannot be read,
//! or whose target cannot be found, changes nothing rather than changing something wrong.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::cache::ReportCache;
use crate::movement::rules::item_spellings;
use crate::orders::standing::{standing_after, BoardingOrder};
use crate::report::model::ReportUnit;

/// How a previewed unit relates to the hex its row sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UnitPreviewStatus {
    /// Still here next month, with some field changed.
    Present,
    /// Ordered out of this hex.
    Departing,
    /// Ordered into this hex from somewhere else.
    Arriving,
    /// Does not exist yet: a `FORM` order creates it this month.
    Formed,
}

/// One field the orders change, with what the report said before.
///
/// The original travels with the change so the interface can show "was: ..." without diffing
/// anything itself. It is a display string rather than a typed value because that is all a tooltip
/// needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    /// The `ReportUnit` field, in its wire spelling: `name`, `onGuard`, `flags`, `items`, `men`,
    /// `structureId`.
    pub field: String,
    pub original: String,
}

/// One unit as the orders leave it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitPreview {
    /// The full predicted state, so the row renders exactly like a reported one.
    pub unit: ReportUnit,
    pub status: UnitPreviewStatus,
    pub changes: Vec<FieldChange>,
    /// Where an arriving unit set out from.
    pub arriving_from: Option<String>,
    /// Where a departing unit ends the month, when the trace can say.
    pub departing_to: Option<String>,
    /// The fleet carrying this unit away, as `<name> [<id>]`, when it is departing because the ship
    /// it stands in is. Never set on an arriving row: an arrival says only where it came from.
    pub aboard: Option<String>,
    /// This unit's orders whose effect on its items could not be counted, verbatim, in document
    /// order (`ah-agbm`).
    pub uncounted: Vec<String>,
    /// Silver or goods taken from a unit the report does not show in this hex (`ah-agbm`).
    pub taken_unshown: Vec<TakenUnshown>,
}

/// Goods taken from a unit the report does not show in this hex (`ah-agbm`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenUnshown {
    pub amount: i64,
    pub tag: String,
    pub from: String,
}

/// Every previewed unit standing in (or bound for) one region.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPreview {
    pub region_id: String,
    pub units: Vec<UnitPreview>,
}

/// What the orders document changes, region by region.
///
/// Regions and units the orders leave alone are simply absent, so an empty response means the
/// report already shows the coming month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdersPreviewResponse {
    pub regions: Vec<RegionPreview>,
}

/// Applies an orders document to the units of the faction that wrote it.
///
/// `remembered_json` is the same accumulated map memory the movement trace reads; it is what lets
/// a MOVE order's destination be named even when the current report never describes it.
///
/// # Errors
///
/// As the movement calls: only an unusable ruleset or unreadable memory is an error. An order
/// that cannot be applied is a successful answer that leaves the unit alone.
pub fn preview_orders_for_remembered_report(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    orders_document: &str,
) -> Result<OrdersPreviewResponse, String> {
    preview_orders_on_map(
        cache,
        ruleset_json,
        raw_report,
        remembered_json,
        orders_document,
        "",
    )
}

/// The same, over a map whose shape the game knows.
///
/// `map_json` as [`crate::movement::request::plan_on_map`]: the game's own dimensions, or empty
/// for a game that never recorded any, which leaves every preview exactly as it was.
///
/// # Errors
///
/// As [`preview_orders_for_remembered_report`], plus an error when the map shape cannot be read.
pub fn preview_orders_on_map(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    orders_document: &str,
    map_json: &str,
) -> Result<OrdersPreviewResponse, String> {
    use crate::movement::graph::MapKnowledge;
    use crate::movement::trace::trace_move;

    let ruleset = cache
        .ruleset(ruleset_json)
        .map_err(|error| error.to_string())?;
    let remembered: Vec<crate::movement::graph::RememberedRegion> =
        serde_json::from_str(remembered_json)
            .map_err(|error| format!("remembered regions could not be read: {error}"))?;

    let report = cache.classified(raw_report, ruleset_json);

    let mut working = Working::over_own_units(&report, ruleset.clone());
    super::walk::walk(orders_document, |event| working.visit(event));

    // What `BUY`, `SELL`, `WITHDRAW` and `TAKE` do to each unit's item list, read from the same
    // ledger the Silver column and the shortfall warnings settle an oversubscribed market line
    // from - so the ITEMS and SILVER cells on one row cannot disagree (`ah-agbm`). `GIVE` is not
    // read here: the walk above already applied every gift through `Working::give`.
    let item_effects =
        super::semantics::item_effects(&report, orders_document, Some(ruleset.as_ref()));
    working.apply_item_effects(&item_effects);

    // Movement is resolved after everything else, so a renamed or re-equipped unit departs and
    // arrives as the orders leave it, not as the report found it.
    let map = MapKnowledge::from_remembered(&report, &remembered)
        .with_geometry(crate::movement::graph::geometry_from_json(map_json)?);
    // Where each unit stands once its own ENTER/LEAVE have run: `entry.unit` is already corrected
    // (see `Working::visit`), but the map and the aboard set it is compared against are the
    // report's, so the correction was thrown away one call later. `Working` applies the same
    // ENTER/LEAVE rule to the unit row, so the two halves of one preview cannot disagree.
    let ordered = crate::movement::fleet::OrderedUnits::from_document(orders_document);

    // Two passes, because a passenger's status depends on another unit's trace: the first decides
    // every unit on its own orders and notes which fleets leave, the second carries the units
    // standing in those fleets.
    let mut decided: Vec<Decided> = Vec::new();
    let mut sailing: BTreeMap<(String, String), SailingFleet> = BTreeMap::new();

    for entry in working.units {
        let mut arrival = None;
        let mut mode = None;

        let status = if entry.formed {
            UnitPreviewStatus::Formed
        } else if let Some(steps) = &entry.move_steps {
            match trace_move(&map, &ruleset, &entry.unit, steps, Some(&ordered)) {
                // The first month's end is where the unit stands when the next report is written;
                // the rest of a longer journey is later months' business.
                Some(path) => {
                    mode = path.mode;
                    match path.months.first() {
                        Some(month) if month.ends_at.id() != entry.unit.region_id => {
                            arrival = Some(month.ends_at.id());
                            UnitPreviewStatus::Departing
                        }
                        // A round trip is not a departure, so only the other changes count.
                        Some(_) => UnitPreviewStatus::Present,
                        // The report never said how the unit travels, so the trace cannot say
                        // where the month ends: a departure to nowhere nameable.
                        None => UnitPreviewStatus::Departing,
                    }
                }
                None => UnitPreviewStatus::Departing,
            }
        } else {
            UnitPreviewStatus::Present
        };

        // `TracedPath::mode` is the sail test rather than the order word: it is Sail exactly when
        // the unit is aboard a priceable fleet, which is what the map already draws.
        if status == UnitPreviewStatus::Departing
            && mode == Some(crate::movement::rules::MovementMode::Sail)
        {
            if let Some(structure_id) = entry.unit.structure_id.clone() {
                if let Some(label) = aboard_label(&report, &entry.unit.region_id, &structure_id) {
                    sailing.insert(
                        (entry.unit.region_id.clone(), structure_id),
                        SailingFleet {
                            // `None` is a value here, not a miss: a fleet whose destination cannot
                            // be named carries its passengers to nowhere nameable.
                            destination: arrival.clone(),
                            label,
                        },
                    );
                }
            }
        }

        decided.push(Decided {
            entry,
            status,
            arrival,
            aboard: None,
        });
    }

    for decided in &mut decided {
        // A unit with its own movement order keeps its own destination and gets no marker, and a
        // unit already departing or formed has been decided by its own orders.
        if decided.entry.move_steps.is_some() || decided.status != UnitPreviewStatus::Present {
            continue;
        }
        let Some(structure_id) = decided.entry.unit.structure_id.clone() else {
            continue;
        };
        let Some(fleet) = sailing.get(&(decided.entry.unit.region_id.clone(), structure_id)) else {
            continue;
        };

        decided.status = UnitPreviewStatus::Departing;
        decided.arrival = fleet.destination.clone();
        decided.aboard = Some(fleet.label.clone());
    }

    let mut regions: BTreeMap<String, Vec<UnitPreview>> = BTreeMap::new();
    for Decided {
        entry,
        status,
        arrival,
        aboard,
    } in decided
    {
        let changes = entry.changes();
        // Captured before `entry.unit` is moved below - the same data on both rows of a unit
        // that is arriving and departing at once, since items are not a property of where the
        // unit stands (`ah-agbm`).
        let uncounted = entry.uncounted.clone();
        let taken_unshown = entry.taken_unshown.clone();

        let departed = status == UnitPreviewStatus::Departing;
        if changes.is_empty()
            && !departed
            && status != UnitPreviewStatus::Formed
            && uncounted.is_empty()
        {
            continue;
        }

        if let Some(destination) = arrival {
            let mut arrived = entry.unit.clone();
            arrived.region_id.clone_from(&destination);
            // A walker cannot take a building with it. A ship can, and does: the hull is what is
            // moving, so the unit is still standing in it when it gets there - the one that wrote
            // the SAIL and every passenger alike (ah-l2i.3). Keyed off the origin region, because
            // `arrived.region_id` is already the destination by now.
            let sails_along = entry.unit.structure_id.as_deref().is_some_and(|id| {
                sailing.contains_key(&(entry.unit.region_id.clone(), id.to_string()))
            });
            if !sails_along {
                arrived.structure_id = None;
            }
            regions
                .entry(destination.clone())
                .or_default()
                .push(UnitPreview {
                    unit: arrived,
                    status: UnitPreviewStatus::Arriving,
                    changes: changes.clone(),
                    arriving_from: Some(entry.unit.region_id.clone()),
                    departing_to: None,
                    // An arrival says only where the unit came from.
                    aboard: None,
                    uncounted: uncounted.clone(),
                    taken_unshown: taken_unshown.clone(),
                });
            regions
                .entry(entry.unit.region_id.clone())
                .or_default()
                .push(UnitPreview {
                    departing_to: Some(destination),
                    unit: entry.unit,
                    status,
                    changes,
                    arriving_from: None,
                    aboard,
                    uncounted,
                    taken_unshown,
                });
        } else {
            regions
                .entry(entry.unit.region_id.clone())
                .or_default()
                .push(UnitPreview {
                    unit: entry.unit,
                    status,
                    changes,
                    arriving_from: None,
                    departing_to: None,
                    aboard,
                    uncounted,
                    taken_unshown,
                });
        }
    }

    Ok(OrdersPreviewResponse {
        regions: regions
            .into_iter()
            .map(|(region_id, units)| RegionPreview { region_id, units })
            .collect(),
    })
}

/// One unit's verdict, held between the two passes of the preview.
struct Decided {
    entry: WorkingUnit,
    status: UnitPreviewStatus,
    /// Where the unit ends the month, when the trace could say.
    arrival: Option<String>,
    /// Set on the departing row of a unit carried by a fleet: `<name> [<id>]`.
    aboard: Option<String>,
}

/// A fleet leaving its hex this month, as its passengers need to read it.
struct SailingFleet {
    /// Where the fleet ends the month, or nothing when the trace could not say.
    destination: Option<String>,
    /// `<name> [<id>]`, for the carried unit's row.
    label: String,
}

/// How a carrying fleet is named to the player: `Wavecrest [329]`.
///
/// The player renames a ship precisely so they can tell two apart, so the name is the half worth
/// showing - `movement::mode::fleet_label`'s kind would read `Longship [329]` for every hull of that
/// kind in the hex. Nothing is said about a hull the report does not list; in practice the trace
/// found the fleet in this same list, so that is a guard rather than a case.
fn aboard_label(
    report: &crate::report::ParsedReport,
    region_id: &str,
    structure_id: &str,
) -> Option<String> {
    let structure = report
        .regions
        .iter()
        .find(|region| region.region_id == region_id)?
        .structures
        .iter()
        .find(|structure| structure.structure_id == structure_id)?;
    Some(format!("{} [{}]", structure.name, structure.structure_id))
}

/// The unit a `FORM n` creates, as it stands at the start of the turn.
///
/// No items, no skills, no men: everything it comes to hold arrives through this month's orders,
/// exactly as it does for a unit the report shows. That is the whole of what makes it an ordinary
/// unit to the checks, and it is why `semantics` builds it with this function rather than with one
/// of its own - two readings of which units a document forms, and of what they are called, is how
/// the table's rows and the column's figures come to disagree about one turn.
pub(crate) fn formed_unit(parent: &ReportUnit, alias: &str) -> ReportUnit {
    ReportUnit {
        unit_id: format!("new-{alias}"),
        name: format!("Unit (new {alias})"),
        region_id: parent.region_id.clone(),
        faction_id: parent.faction_id.clone(),
        faction_name: parent.faction_name.clone(),
        own: true,
        on_guard: false,
        flags: Vec::new(),
        items: Vec::new(),
        skills: Vec::new(),
        men: 0,
        // Nothing has been given yet, and what is given is counted exactly.
        men_estimated: false,
        men_by_race: Vec::new(),
        weight: None,
        capacity: None,
        // The game creates the new unit in the same object as the unit forming it.
        structure_id: parent.structure_id.clone(),
    }
}

/// One unit as the walker holds it: the state being changed, and the report's word for diffing.
struct WorkingUnit {
    unit: ReportUnit,
    original: Option<ReportUnit>,
    formed: bool,
    move_steps: Option<Vec<crate::movement::orders::MoveStep>>,
    /// Where this unit stood before any of its boarding orders ran: the report's answer, or for a
    /// formed unit the structure its parent stood in when the FORM was read.
    reported: Option<String>,
    /// The unit's ENTER and LEAVE orders so far, in the order they were written.
    ///
    /// Kept rather than applied as they are read, because what they mean together is
    /// [`super::standing`]'s to say and only its. The answer is recomputed from the whole list
    /// after each one, so a FORM later in the block still inherits the structure the unit is
    /// standing in by then - `visit` is a mutating walk and other arms read `structure_id`.
    boardings: Vec<BoardingOrder>,
    /// This unit's orders whose effect on its items could not be counted, verbatim, in document
    /// order. Written once by `apply_item_effects`, after the walk that builds every unit here has
    /// finished (`ah-agbm`).
    uncounted: Vec<String>,
    /// Silver or goods taken from a unit the report does not show in this hex. Written once by
    /// `apply_item_effects` (`ah-agbm`).
    taken_unshown: Vec<TakenUnshown>,
}

impl WorkingUnit {
    /// The fields the orders changed, each with what the report said.
    ///
    /// Formatted for a tooltip rather than typed, because "was: ..." is all the interface does
    /// with an original. A formed unit has no original and so never any changes.
    fn changes(&self) -> Vec<FieldChange> {
        let Some(original) = &self.original else {
            return Vec::new();
        };
        let mut changes = Vec::new();
        let mut change = |field: &str, changed: bool, original: String| {
            if changed {
                changes.push(FieldChange {
                    field: field.to_string(),
                    original,
                });
            }
        };

        change(
            "name",
            self.unit.name != original.name,
            original.name.clone(),
        );
        change(
            "onGuard",
            self.unit.on_guard != original.on_guard,
            if original.on_guard { "yes" } else { "no" }.to_string(),
        );
        change(
            "flags",
            self.unit.flags != original.flags,
            original.flags.join(", "),
        );
        change(
            "items",
            self.unit.items != original.items,
            original
                .items
                .iter()
                .map(|item| format!("{} {}", item.amount, item.tag))
                .collect::<Vec<_>>()
                .join(", "),
        );
        change(
            "men",
            self.unit.men != original.men,
            original.men.to_string(),
        );
        change(
            "structureId",
            self.unit.structure_id != original.structure_id,
            original.structure_id.clone().unwrap_or_default(),
        );
        changes
    }
}

/// The walker's state across the document.
struct Working {
    units: Vec<WorkingUnit>,
    /// Index by unit id, for `unit` lines and GIVE targets.
    by_id: BTreeMap<String, usize>,
    /// Index by `(region id, alias)`, because `NEW n` names are per-hex: any own unit in the same
    /// hex may give to a sibling's formed unit.
    by_alias: BTreeMap<(String, String), usize>,
    /// The unit whose block the walker is inside.
    current: Option<usize>,
    /// Formed units being described, innermost last. `None` marks a FORM that could not be read,
    /// so its orders are swallowed rather than applied to whoever came before.
    forming: Vec<Option<usize>>,
    /// Consulted only to tell people from equipment when a GIVE moves a race.
    ruleset: std::sync::Arc<crate::movement::rules::Ruleset>,
}

impl Working {
    fn over_own_units(
        report: &crate::report::ParsedReport,
        ruleset: std::sync::Arc<crate::movement::rules::Ruleset>,
    ) -> Self {
        let mut units = Vec::new();
        let mut by_id = BTreeMap::new();
        for unit in report.own_units() {
            by_id.insert(unit.unit_id.clone(), units.len());
            units.push(WorkingUnit {
                unit: unit.clone(),
                original: Some(unit.clone()),
                formed: false,
                move_steps: None,
                reported: unit.structure_id.clone(),
                boardings: Vec::new(),
                uncounted: Vec::new(),
                taken_unshown: Vec::new(),
            });
        }
        Self {
            units,
            by_id,
            by_alias: BTreeMap::new(),
            current: None,
            forming: Vec::new(),
            ruleset,
        }
    }

    /// Folds one event from [`super::walk`] into the units being built.
    ///
    /// The walk settles the block bookkeeping - nesting, which closer belongs to which opener, an
    /// unclosed block abandoned at the next `unit` line or `#` directive - so only the semantics
    /// specific to a preview are left here: a `FORM` at top level starts describing a new unit, an
    /// order at top level is applied to whichever unit (formed or not) is currently active, and
    /// anything at `depth.turn > 0` is next month's and changes nothing.
    fn visit(&mut self, event: super::walk::Event<'_>) {
        use super::walk::{BlockKind, Event};

        match event {
            Event::Broken { .. } => {}
            Event::Directive(_) => {
                // `#atlantis` and `#end` bound the document; neither leaves a unit's block open.
                self.current = None;
                self.forming.clear();
            }
            Event::Unit(line) => {
                self.forming.clear();
                self.current = line
                    .arguments
                    .first()
                    .and_then(|id| self.by_id.get(&id.text))
                    .copied();
            }
            Event::Open {
                line,
                kind: BlockKind::Form,
                depth,
            } if depth.turn == 0 => {
                self.open_form(line.arguments);
            }
            Event::Open { .. } => {}
            Event::Close {
                kind: BlockKind::Form,
                depth,
                ..
            } if depth.turn == 0 => {
                self.forming.pop();
            }
            Event::Close { .. } | Event::Stray { .. } | Event::Abandoned(_) => {}
            Event::Order { line, depth } if depth.turn == 0 => {
                self.read_order(line.command, line.arguments);
            }
            Event::Order { .. } => {}
        }
    }

    /// The unit the next order belongs to: the formed unit being described, or the block's own.
    fn active(&self) -> Option<usize> {
        match self.forming.last() {
            Some(formed) => *formed,
            None => self.current,
        }
    }

    /// Applies what `BUY`, `SELL`, `WITHDRAW` and `TAKE` move into or out of each unit's item
    /// list, and records what could not be counted at all - `super::semantics::item_effects`'s
    /// seam onto the ledger the same settlement already prices (`ah-agbm`).
    ///
    /// `GIVE` is not read here: the walk that built `self.units` has already applied every gift
    /// through `Working::give`, and the ledger records no movement for one (`RecordMovement::No`)
    /// for exactly that reason - applying it again here would move it twice.
    fn apply_item_effects(
        &mut self,
        effects: &BTreeMap<String, super::semantics::UnitItemEffects>,
    ) {
        for unit in &mut self.units {
            let Some(effect) = effects.get(&unit.unit.unit_id) else {
                continue;
            };
            for movement in &effect.moved {
                match movement.delta.cmp(&0) {
                    std::cmp::Ordering::Greater => {
                        add_item(
                            &mut unit.unit.items,
                            &movement.name,
                            &movement.tag,
                            movement.delta,
                        );
                    }
                    std::cmp::Ordering::Less => {
                        // A stock can go negative here - the ledger clamps against a running
                        // balance while `give` above clamped against the report's holding, so an
                        // overdrawn unit can reach one. `take_item` already drops a stock at or
                        // below zero, which is the clamp this column needs; an item already
                        // absent (emptied by an earlier movement) has nothing left to remove.
                        if let Some(index) = unit
                            .unit
                            .items
                            .iter()
                            .position(|item| item.tag.eq_ignore_ascii_case(&movement.tag))
                        {
                            take_item(&mut unit.unit.items, index, -movement.delta);
                        }
                    }
                    std::cmp::Ordering::Equal => {}
                }
            }
            unit.uncounted = effect.uncounted.clone();
            unit.taken_unshown = effect
                .moved
                .iter()
                .filter_map(|movement| {
                    movement.from_unshown.as_ref().map(|from| TakenUnshown {
                        amount: movement.delta,
                        tag: movement.tag.clone(),
                        from: from.clone(),
                    })
                })
                .collect();
        }
    }

    fn open_form(&mut self, arguments: &[super::lexer::Token]) {
        // The alias has to be a number: `GIVE NEW n` is the only way to reach the formed unit, and
        // the grammar's `Arg::Unit` accepts `NEW 1` and never `NEW a`.
        let alias = arguments
            .first()
            .filter(|alias| alias.kind == super::lexer::TokenKind::Number);
        let (Some(alias), Some(parent)) = (alias, self.active()) else {
            // A FORM that cannot be read still opens a block, or its orders would fall through
            // to the unit outside it.
            self.forming.push(None);
            return;
        };

        let parent = &self.units[parent].unit;
        let key = (parent.region_id.clone(), alias.text.clone());
        if self.by_alias.contains_key(&key) {
            // The alias is taken, so the server would refuse this FORM; its block is swallowed
            // rather than applied to the unit the alias already names.
            self.forming.push(None);
            return;
        }

        let unit = formed_unit(parent, &alias.text);

        let reported = unit.structure_id.clone();
        let index = self.units.len();
        self.by_alias.insert(key, index);
        self.units.push(WorkingUnit {
            unit,
            original: None,
            formed: true,
            move_steps: None,
            reported,
            boardings: Vec::new(),
            uncounted: Vec::new(),
            taken_unshown: Vec::new(),
        });
        self.forming.push(Some(index));
    }

    fn read_order(&mut self, command: &super::lexer::Token, arguments: &[super::lexer::Token]) {
        let Some(active) = self.active() else {
            return;
        };

        if crate::movement::orders::is_movement_command(&command.text) {
            if let Some(steps) = super::forms::read_move_line(command, arguments) {
                // The last movement order wins, because a later order replaces an earlier one
                // when the game executes them.
                self.units[active].move_steps = Some(steps);
            }
        } else if command.is("name") {
            self.rename(active, arguments);
        } else if command.is("guard") {
            if let Some(set) = super::forms::read_flag(arguments) {
                let unit = &mut self.units[active].unit;
                unit.on_guard = set;
                set_flag(&mut unit.flags, "guarding", set);
                // "The Guard and Avoid Combat flags are mutually exclusive; setting one
                // automatically cancels the other."
                if set {
                    set_flag(&mut unit.flags, "avoiding", false);
                }
            }
        } else if command.is("avoid") {
            if let Some(set) = super::forms::read_flag(arguments) {
                let unit = &mut self.units[active].unit;
                set_flag(&mut unit.flags, "avoiding", set);
                if set {
                    unit.on_guard = false;
                    set_flag(&mut unit.flags, "guarding", false);
                }
            }
        } else if command.is("behind") {
            if let Some(set) = super::forms::read_flag(arguments) {
                set_flag(&mut self.units[active].unit.flags, "behind", set);
            }
        } else if command.is("enter") {
            if let Some(structure) = super::forms::read_only_number(arguments) {
                self.board(active, BoardingOrder::Enter(structure.to_string()));
            }
        } else if command.is("leave") && arguments.is_empty() {
            self.board(active, BoardingOrder::Leave);
        } else if command.is("give") {
            self.give(active, arguments);
        }
    }

    /// Records one boarding order and puts the unit where the whole block leaves it so far.
    ///
    /// Recomputed from every boarding seen rather than applied in isolation, because a LEAVE after
    /// an ENTER does not put the unit ashore: every LEAVE runs before any ENTER whatever order the
    /// lines were typed in. That rule is [`super::standing::standing_after`]'s, stated only there.
    fn board(&mut self, active: usize, boarding: BoardingOrder) {
        self.units[active].boardings.push(boarding);
        let working = &self.units[active];
        let standing = standing_after(
            working.reported.as_deref(),
            working.boardings.iter().map(BoardingOrder::as_boarding),
        )
        .map(str::to_string);
        self.units[active].unit.structure_id = standing;
    }

    /// `NAME UNIT "..."` renames the active unit; naming the faction or an object changes no row.
    fn rename(&mut self, active: usize, arguments: &[super::lexer::Token]) {
        let Some((what, name)) = arguments.split_first() else {
            return;
        };
        if !what.is("unit") || name.is_empty() {
            return;
        }
        // The game prints an underscored name with spaces, so the preview shows what the next
        // report will say rather than what the player typed.
        self.units[active].unit.name = name
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .replace('_', " ");
    }

    /// `GIVE target amount item`, where the target is a unit, `NEW n`, another faction's new unit,
    /// or `0` to discard.
    ///
    /// The shapes are read by [`super::forms`], the same reader the validator and the intent pass
    /// use, so an order this previews is an order the validator accepts. What is left here is
    /// resolution: which unit the target names, whether the giver holds what it is giving, and how
    /// much actually moves.
    ///
    /// A target the walker cannot find - another hex, another faction, an alias never formed -
    /// makes the whole order a no-op: the validator flags what the server would refuse, and
    /// half-applying it here would show a transfer that will not happen.
    fn give(&mut self, giver: usize, arguments: &[super::lexer::Token]) {
        use super::forms::{Amount, Party, Selector};

        let Some((target, rest)) = super::forms::read_party(arguments) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };

        let receiver = match target {
            Party::New(alias) => {
                let key = (self.units[giver].unit.region_id.clone(), alias);
                match self.by_alias.get(&key) {
                    Some(index) => Some(*index),
                    None => return,
                }
            }
            Party::Discard => None,
            // Another faction's new unit is not a row of ours. It has to be turned away here
            // rather than left to fall through: read as a plain id it would find nothing, but
            // read as a zero it would silently destroy the goods.
            Party::Foreign { .. } => return,
            Party::Unit(id) => match self.by_id.get(&id) {
                Some(&index)
                    if self.units[index].unit.region_id == self.units[giver].unit.region_id =>
                {
                    Some(index)
                }
                _ => return,
            },
        };

        // The server refuses a unit giving to itself, and even a net-zero application here would
        // reorder the item list into a phantom "items changed" row.
        if receiver == Some(giver) {
            return;
        }

        let Selector::Item(item) = what else {
            // `GIVE target UNIT` hands over the whole unit, and `ALL ITEMS` a whole class of them.
            // Ownership is a different question from what a row shows, and a class needs every
            // item the unit holds classified; both are left to a later issue.
            return;
        };
        let Some(held) = find_item(&self.units[giver].unit.items, &item) else {
            return;
        };
        let (name, tag, held_amount) = {
            let held = &self.units[giver].unit.items[held];
            (held.name.clone(), held.tag.clone(), held.amount)
        };

        let requested = match amount {
            // `GIVE target ALL item EXCEPT n` keeps n back.
            Amount::All { except } => held_amount.saturating_sub(except),
            Amount::Exact(count) => count,
        };
        let moved = requested.clamp(0, held_amount);
        if moved == 0 {
            return;
        }

        take_item(&mut self.units[giver].unit.items, held, moved);
        if let Some(receiver) = receiver {
            add_item(&mut self.units[receiver].unit.items, &name, &tag, moved);
        }

        // A race is people, so giving one moves men as well as stock.
        if self.ruleset.is_man(&tag) {
            let unit = &mut self.units[giver].unit;
            unit.men -= moved;
            if let Some(race) = unit.men_by_race.iter().position(|race| race.tag == tag) {
                take_item(&mut unit.men_by_race, race, moved);
            }
            if let Some(receiver) = receiver {
                let unit = &mut self.units[receiver].unit;
                unit.men += moved;
                add_item(&mut unit.men_by_race, &name, &tag, moved);
            }
        }
    }
}

/// Adds or removes a flag, in the report's own vocabulary, without disturbing the others' order.
fn set_flag(flags: &mut Vec<String>, flag: &str, set: bool) {
    let present = flags.iter().any(|existing| existing == flag);
    if set && !present {
        flags.push(flag.to_string());
    } else if !set && present {
        flags.retain(|existing| existing != flag);
    }
}

/// The index of the item this text names, accepting the same spellings the game does.
///
/// Spelling-major, as [`item_spellings`] requires.
fn find_item(items: &[crate::report::model::ItemAmount], text: &str) -> Option<usize> {
    let written = text.replace('_', " ");
    let found = item_spellings(&written)
        .into_iter()
        .flatten()
        .find_map(|spelling| {
            items.iter().position(|item| {
                item.tag.eq_ignore_ascii_case(spelling) || item.name.eq_ignore_ascii_case(spelling)
            })
        });
    found
}

fn take_item(items: &mut Vec<crate::report::model::ItemAmount>, index: usize, amount: i64) {
    items[index].amount -= amount;
    if items[index].amount <= 0 {
        // The report never lists an empty stock, so neither does the preview.
        items.remove(index);
    }
}

fn add_item(items: &mut Vec<crate::report::model::ItemAmount>, name: &str, tag: &str, amount: i64) {
    if let Some(existing) = items.iter_mut().find(|item| item.tag == tag) {
        existing.amount += amount;
    } else {
        items.push(crate::report::model::ItemAmount {
            amount,
            name: name.to_string(),
            tag: tag.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    /// A one-region report with two own units, the second there to prove untouched units stay
    /// out of the answer.
    fn report() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    fn preview(orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report(),
            "[]",
            orders,
        )
        .expect("the ruleset loads")
    }

    /// Like `report()`, but with a market line on each side and the giver holding fur, for the
    /// `BUY`/`SELL`/`WITHDRAW`/`TAKE` increments (`ah-agbm`).
    fn report_with_market() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 12 horses [HORS] at $10.",
            "  Wanted: 100 fur [FUR] at $10.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR], 10 fur [FUR]. Weight: 20. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    fn preview_over(report: &str, orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(&mut ReportCache::new(), RULESET, report, "[]", orders)
            .expect("the ruleset loads")
    }

    fn only_unit(response: &OrdersPreviewResponse) -> &UnitPreview {
        assert_eq!(response.regions.len(), 1, "one region changed");
        assert_eq!(response.regions[0].units.len(), 1, "one unit changed");
        &response.regions[0].units[0]
    }

    fn change<'a>(unit: &'a UnitPreview, field: &str) -> &'a FieldChange {
        unit.changes
            .iter()
            .find(|change| change.field == field)
            .unwrap_or_else(|| panic!("no change recorded for {field}: {:?}", unit.changes))
    }

    #[test]
    fn name_unit_renames_and_leaves_untouched_units_out_of_the_answer() {
        let response = preview("unit 900\nNAME UNIT \"Renamed\"\n");

        let unit = only_unit(&response);
        assert_eq!(response.regions[0].region_id, "1:1,1");
        assert_eq!(unit.unit.name, "Renamed");
        assert_eq!(unit.status, UnitPreviewStatus::Present);
        assert_eq!(change(unit, "name").original, "Walker");
        assert!(
            !response.regions[0]
                .units
                .iter()
                .any(|unit| unit.unit.unit_id == "901"),
            "the bystander got no orders and must not appear"
        );
    }

    /// This test previously encoded a defect: it asserted a unit could preview as guarding and
    /// avoiding at once, which "The Guard and Avoid Combat flags are mutually exclusive; setting
    /// one automatically cancels the other" says the server never produces.
    #[test]
    fn guard_and_avoid_cancel_each_other_as_the_rules_say() {
        let guarded = preview("unit 900\nAVOID 1\nGUARD 1\n");
        let unit = only_unit(&guarded);
        assert!(unit.unit.on_guard);
        assert!(unit.unit.flags.iter().any(|flag| flag == "guarding"));
        assert!(!unit.unit.flags.iter().any(|flag| flag == "avoiding"));
        assert_eq!(change(unit, "onGuard").original, "no");
        // The walker starts with only "behind", so that is the original flag list.
        assert_eq!(change(unit, "flags").original, "behind");

        let avoided = preview("unit 900\nGUARD 1\nAVOID 1\n");
        let unit = only_unit(&avoided);
        assert!(!unit.unit.on_guard, "avoiding cancels the guard");
        assert!(unit.unit.flags.iter().any(|flag| flag == "avoiding"));
        assert!(!unit.unit.flags.iter().any(|flag| flag == "guarding"));
    }

    #[test]
    fn a_move_with_a_trailing_comment_still_departs() {
        let response = preview("unit 900\nMOVE SE ;to the coast\n");

        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        assert_eq!(origin.units[0].departing_to.as_deref(), Some("1:2,2"));
    }

    #[test]
    fn a_formed_unit_starts_inside_the_parents_structure() {
        // The game creates the new unit in the same object as the unit forming it.
        let response = preview("unit 900\nENTER 4\nFORM 1\nEND\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("a formed unit");
        assert_eq!(formed.unit.structure_id.as_deref(), Some("4"));
    }

    #[test]
    fn giving_to_yourself_changes_nothing() {
        // The server refuses it, and even a net-zero application would reorder the item list
        // into a phantom "items changed" row: the whole leader stock removed from the front of
        // the list and re-appended at its back.
        let response = preview("unit 900\nGIVE 900 1 LEAD\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn give_all_moves_the_stock_and_except_keeps_some_back() {
        let all = preview("unit 900\nGIVE 901 ALL SWOR\n");
        let receiver = all.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            3
        );

        let kept = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT 1\n");
        let giver = kept.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            1
        );

        // An EXCEPT that cannot be read makes the whole order unreadable, and an unreadable
        // order changes nothing - it must not fall back to giving everything away.
        let unreadable = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT x\n");
        assert!(unreadable.regions.is_empty(), "{:?}", unreadable.regions);
    }

    // --- orders the validator refuses (#92) ---------------------------------------------------
    //
    // This walker used to read its own arguments and was looser than the syntax checker about
    // them: it would act on lines the editor was underlining in red. Now that both read through
    // `super::forms`, an order the validator refuses previews nothing, which is the only answer
    // that agrees with what the server will do with the file.
    //
    // Each of these is a line the validator already reports as an error today.

    #[test]
    fn a_give_with_a_trailing_token_is_unreadable() {
        // "extra-arguments" from the validator. Reading the first three arguments and ignoring
        // the rest previewed a gift the server would never make.
        let response = preview("unit 900\nGIVE 901 1 SWOR junk\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn an_except_without_all_is_unreadable() {
        // EXCEPT belongs to the ALL form alone. Taken as a plain quantity with trailing noise,
        // this previewed a gift of two.
        let response = preview("unit 900\nGIVE 901 2 SWOR EXCEPT 1\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    /// The lexer calls a token a number only when it is all digits, so `-1` is a word. Parsing it
    /// as an integer made `EXCEPT -1` keep back minus one sword, which is to say all of them.
    #[test]
    fn a_negative_reserve_is_unreadable_rather_than_giving_everything() {
        let response = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT -1\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn a_flag_order_with_a_trailing_token_is_unreadable() {
        let response = preview("unit 900\nGUARD 1 junk\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);

        // The control, so this is not passing because GUARD stopped working altogether.
        let set = preview("unit 900\nGUARD 1\n");
        assert!(only_unit(&set).unit.on_guard);
    }

    /// A flag is the literal `0` or `1`. `01` parses to one but is not an order the game has, and
    /// the validator says so - so the preview must not quietly set the flag anyway.
    #[test]
    fn a_flag_written_with_a_leading_zero_is_unreadable() {
        let response = preview("unit 900\nGUARD 01\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    /// `GIVE 0` destroys what is given, and the game writes zero however it likes. Matching the
    /// literal `"0"` sent `000` down the unit-lookup path, where it found nothing and did nothing.
    #[test]
    fn any_way_of_writing_zero_discards() {
        let response = preview("unit 900\n@give 000 1 SWOR\n");

        let giver = only_unit(&response);
        assert_eq!(giver.unit.unit_id, "900");
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            2,
            "one of the three swords is destroyed"
        );
    }

    /// The grammar requires a numeric alias (`Arg::Unit` accepts `NEW 1`, never `NEW a`), so a
    /// FORM the server would refuse must form nothing here either.
    #[test]
    fn a_form_alias_that_is_not_a_number_forms_nothing() {
        let response = preview("unit 900\nFORM a\nNAME UNIT \"Ghost\"\nEND\n");

        // Nothing at all, which is the stronger claim: a FORM that cannot be read still has to
        // open a block, or the orders inside it fall through and rename unit 900 instead. Asking
        // only that no row is `Formed` would not notice that.
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    /// NewOrigins has no ENDFORM - `grammar.rs` deliberately dropped it from the vocabulary, and
    /// the validator calls it an unknown command. A block it appears to close is not closed, so
    /// the orders after it still belong to the unit being formed.
    #[test]
    fn endform_closes_nothing_because_the_rules_have_no_such_order() {
        let response = preview("unit 900\nFORM 1\nENDFORM\nNAME UNIT \"Formed\"\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("a formed unit");
        assert_eq!(
            formed.unit.name, "Formed",
            "the NAME belongs to the formed unit, because ENDFORM closed nothing"
        );
    }

    /// Handing over a whole unit is ownership, not a row's contents, so it moves none of the
    /// giver's items - but `ah-agbm` still marks it uncounted, exactly as a whole class of items
    /// is below: `transfer`'s selector guard cannot tell "ownership, deliberately out of scope"
    /// from "a class this bead has not modelled" apart, and the navigator's Round 1 Q2 chose to
    /// admit the gap rather than hide it (see the design's *Where each recording goes* table).
    /// Renamed from `giving_the_unit_itself_previews_nothing`, whose old name and assertion
    /// predate that decision - recorded as a deviation from the plan's regression net in the PR.
    #[test]
    fn giving_the_unit_itself_moves_no_items_but_is_marked_uncounted() {
        let response = preview("unit 900\nGIVE 901 UNIT\n");
        let unit = only_unit(&response);
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "handing over the unit itself must move none of its items: {:?}",
            unit.changes
        );
        assert_eq!(unit.uncounted, vec!["GIVE 901 UNIT".to_string()]);

        // The control: the same giver and receiver, with a transfer the preview does model and
        // count, so the row above is not just every GIVE reading as uncounted. Both units change
        // here (the giver loses a sword, the receiver gains one), so the giver is found by id
        // rather than assumed to be the only row.
        let moved = preview("unit 900\nGIVE 901 1 SWOR\n");
        let giver = moved.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert!(giver.uncounted.is_empty());
    }

    /// Likewise a whole class of items: the shared reader recognises `ALL ITEMS` where the old
    /// inline parse merely failed to find an item called "ITEMS". `ah-agbm`'s Round 1 Q2 named
    /// exactly this order as the example of one the ITEMS column cannot count, so it is now
    /// admitted rather than silently dropped. Renamed from
    /// `giving_a_class_of_items_previews_nothing`; see the sibling test above for why.
    #[test]
    fn giving_a_class_of_items_moves_no_items_but_is_marked_uncounted() {
        let response = preview("unit 900\nGIVE 901 ALL ITEMS\n");
        let unit = only_unit(&response);
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "a class the preview cannot classify must move nothing: {:?}",
            unit.changes
        );
        assert_eq!(unit.uncounted, vec!["GIVE 901 ALL ITEMS".to_string()]);

        // The control: `ALL` of one named item is modelled and counted, so the row above is the
        // class being turned away rather than `ALL` failing to read. Both units change here, so
        // the giver is found by id rather than assumed to be the only row.
        let named = preview("unit 900\nGIVE 901 ALL SWOR\n");
        let giver = named.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert!(giver.uncounted.is_empty());
    }

    /// A gift to another faction's new unit leaves this faction's rows alone. The shared reader
    /// recognises the `FACTION f NEW n` form, so it has to be turned away deliberately - taken as
    /// a plain unit id it would find nothing, but taken as a zero it would silently destroy the
    /// goods.
    #[test]
    fn giving_to_another_factions_new_unit_previews_nothing() {
        let response = preview("unit 900\nGIVE FACTION 14 NEW 2 1 SWOR\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);

        // The control: our own new unit, same order shape. Without it this test would pass just as
        // well against a reader that had stopped understanding `NEW` at all - and the arm it
        // guards is the dangerous one, since a foreign target read as a zero would destroy the
        // swords rather than merely fail to move them.
        let ours = preview("unit 900\nFORM 2\nEND\nGIVE NEW 2 1 SWOR\n");
        assert!(
            ours.regions[0]
                .units
                .iter()
                .any(|unit| unit.status == UnitPreviewStatus::Formed
                    && unit.unit.items.iter().any(|item| item.tag == "SWOR")),
            "the control must hand the sword to our own formed unit: {:?}",
            ours.regions
        );
    }

    #[test]
    fn a_second_form_with_a_taken_alias_is_swallowed() {
        let response = preview(
            "unit 900\nFORM 1\nNAME UNIT \"First\"\nEND\nFORM 1\nNAME UNIT \"Second\"\nEND\n",
        );

        let formed: Vec<_> = response.regions[0]
            .units
            .iter()
            .filter(|unit| unit.status == UnitPreviewStatus::Formed)
            .collect();
        assert_eq!(formed.len(), 1, "one alias, one unit");
        assert_eq!(
            formed[0].unit.name, "First",
            "the block that could not form anything is swallowed, not applied to the first"
        );
    }

    #[test]
    fn a_new_alias_belongs_to_its_own_hex() {
        // Two own units in two hexes: the alias formed in one must be invisible to the other.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
            "plain (3,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Trader (902), Foo (1), leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nFORM 1\nEND\nunit 902\nGIVE NEW 1 2 SWOR\n",
        )
        .expect("the ruleset loads");

        let formed = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("the formed unit");
        assert!(
            formed.unit.items.is_empty(),
            "a GIVE from another hex must not reach it: {:?}",
            formed.unit.items
        );
    }

    #[test]
    fn an_underscored_name_reads_with_spaces() {
        // The server prints Nine_of_Eight as "Nine of Eight", so the preview must too.
        let response = preview("unit 900\nNAME UNIT Nine_of_Eight\n");
        assert_eq!(only_unit(&response).unit.name, "Nine of Eight");
    }

    #[test]
    fn behind_zero_removes_the_reported_flag() {
        let response = preview("unit 900\nBEHIND 0\n");

        let unit = only_unit(&response);
        assert!(
            !unit.unit.flags.iter().any(|flag| flag == "behind"),
            "flags were: {:?}",
            unit.unit.flags
        );
        assert_eq!(change(unit, "flags").original, "behind");
    }

    #[test]
    fn enter_and_leave_change_the_structure() {
        let entered = preview("unit 900\nENTER 4\n");
        assert_eq!(only_unit(&entered).unit.structure_id.as_deref(), Some("4"));

        // Every LEAVE runs before any ENTER, so a block holding both ends *inside* - the rule
        // `semantics::structure_after_orders` states, settled by the navigator on 2026-08-18
        // (ah-mjy). This assertion previously read the two in document order and so encoded the
        // defect: it expected the unit ashore and no row at all.
        let both = preview("unit 900\nENTER 4\nLEAVE\n");
        assert_eq!(only_unit(&both).unit.structure_id.as_deref(), Some("4"));

        // A LEAVE on its own does put it ashore, and the report already had it there: nothing to
        // say.
        let left = preview("unit 900\nLEAVE\n");
        assert!(left.regions.is_empty(), "{:?}", left.regions);
    }

    /// An ENTER the game would not read moves nobody: `read_only_number` is the same reader
    /// `orders::intents` uses, so a stray argument or a non-numeric one leaves the unit alone.
    #[test]
    fn an_unreadable_enter_or_leave_moves_nobody() {
        assert!(preview("unit 900\nENTER 4 X\n").regions.is_empty());
        assert!(preview("unit 900\nENTER shed\n").regions.is_empty());
        assert!(preview("unit 900\nLEAVE 3\n").regions.is_empty());
    }

    /// The walker abandons an unclosed TURN at the next `unit` line, as the parser and the intents
    /// reader always did - so an unclosed block no longer swallows the units written after it.
    #[test]
    fn an_unclosed_turn_block_ends_at_the_next_unit() {
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &[
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "",
            ]
            .join("\n"),
            "[]",
            "unit 900\nTURN\nWORK\nunit 901\nGUARD 1\n",
        )
        .expect("the ruleset loads");

        let bystander = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == "901")
            .expect("unit 901's GUARD is applied even though unit 900 left a TURN block open");
        assert!(bystander.unit.on_guard);
    }

    #[test]
    fn turn_blocks_are_next_month_and_repeat_orders_are_this_month() {
        let response = preview(
            "unit 900\n@NAME UNIT \"Repeated\"\nTURN\nNAME UNIT \"Later\"\nGUARD 1\nENDTURN\n",
        );

        let unit = only_unit(&response);
        assert_eq!(unit.unit.name, "Repeated", "@ applies, TURN does not");
        assert!(!unit.unit.on_guard, "the GUARD belongs to next month");
    }

    #[test]
    fn form_creates_a_provisional_unit_that_its_block_names() {
        let response = preview("unit 900\nFORM 1\nNAME UNIT \"Recruits\"\nBEHIND 1\nEND\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("a formed unit");
        assert_eq!(formed.unit.unit_id, "new-1");
        assert_eq!(formed.unit.name, "Recruits");
        assert!(formed.unit.own);
        assert!(formed.unit.flags.iter().any(|flag| flag == "behind"));
        assert_eq!(formed.unit.men, 0, "nobody has been given to it yet");
    }

    #[test]
    fn give_moves_items_between_both_units() {
        let response = preview("unit 900\nGIVE 901 2 SWOR\n");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        let swords = |unit: &UnitPreview| {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount)
        };
        assert_eq!(swords(giver), 1);
        assert_eq!(swords(receiver), 2);
        assert_eq!(change(giver, "items").original, "1 LEAD, 3 SWOR");
    }

    #[test]
    fn give_of_a_race_moves_men_too() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Crowd (900), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0.",
            "* Empty (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 4 ORC\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert_eq!(giver.unit.men, 6);
        assert_eq!(receiver.unit.men, 5, "the leader plus four orcs");
        assert_eq!(change(giver, "men").original, "10");
    }

    #[test]
    fn give_to_nobody_discards_and_give_new_reaches_the_formed_unit() {
        let discarded = preview("unit 900\nGIVE 0 1 SWOR\n");
        let giver = only_unit(&discarded);
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            2
        );

        let formed = preview("unit 900\nFORM 1\nEND\nGIVE NEW 1 3 SWOR\n");
        let recruit = formed.regions[0]
            .units
            .iter()
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("a formed unit");
        assert_eq!(
            recruit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            3
        );
    }

    #[test]
    fn give_beyond_the_hex_or_the_stock_changes_nothing_wrong() {
        // Unit 555 is nowhere in the report, so the whole order is a no-op.
        let missing = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report(),
            "[]",
            "unit 900\nGIVE 555 1 SWOR\n",
        )
        .expect("the ruleset loads");
        assert!(missing.regions.is_empty(), "{:?}", missing.regions);

        // Giving more than the unit holds empties the stock rather than going negative.
        let drained = preview("unit 900\nGIVE 901 99 SWOR\n");
        let giver = drained.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert!(
            !giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "an emptied stock disappears from the list"
        );
    }

    #[test]
    fn a_move_order_departs_here_and_arrives_there() {
        let response = preview("unit 900\nMOVE SE\n");

        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        let destination = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:2,2")
            .expect("the destination changed");

        let departing = &origin.units[0];
        assert_eq!(departing.status, UnitPreviewStatus::Departing);
        assert_eq!(departing.departing_to.as_deref(), Some("1:2,2"));

        let arriving = &destination.units[0];
        assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
        assert_eq!(arriving.arriving_from.as_deref(), Some("1:1,1"));
        assert_eq!(arriving.unit.unit_id, "900");
        assert_eq!(arriving.unit.region_id, "1:2,2");
    }

    #[test]
    fn a_sail_order_departs_here_and_arrives_there() {
        // SAIL is a movement word like MOVE and ADVANCE; the preview reads it from the one list
        // rather than spelling the words itself, so it cannot fall out of step with the trace
        // again (ah-p1p).
        let response = preview("unit 900\nSAIL SE\n");

        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        let destination = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:2,2")
            .expect("the destination changed");

        let departing = &origin.units[0];
        assert_eq!(departing.status, UnitPreviewStatus::Departing);
        assert_eq!(departing.departing_to.as_deref(), Some("1:2,2"));

        let arriving = &destination.units[0];
        assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
        assert_eq!(arriving.arriving_from.as_deref(), Some("1:1,1"));
        assert_eq!(arriving.unit.unit_id, "900");
        assert_eq!(arriving.unit.region_id, "1:2,2");
    }

    #[test]
    fn an_advance_order_still_departs() {
        // The word that already worked, kept working: the list replaced two hand-spelt words,
        // not one.
        let response = preview("unit 900\nADVANCE SE\n");
        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        assert_eq!(origin.units[0].status, UnitPreviewStatus::Departing);
    }

    #[test]
    fn a_sail_order_with_no_direction_changes_nothing() {
        // "SAIL" alone is a form of its own and parse_move refuses it - "an order that goes
        // nowhere is not one". So move_steps stays unset, the unit is Present with no changes,
        // and no region is entered into the response at all.
        let response = preview("unit 900\nSAIL\n");
        assert!(
            response.regions.is_empty(),
            "regions were: {:?}",
            response.regions
        );
    }

    #[test]
    fn the_arriving_row_carries_the_other_changes_but_not_the_structure() {
        let response = preview("unit 900\nNAME UNIT \"Wanderer\"\nENTER 4\nMOVE SE\n");

        let arriving = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:2,2")
            .expect("the destination changed")
            .units
            .first()
            .expect("an arriving unit");
        assert_eq!(arriving.unit.name, "Wanderer");
        assert_eq!(
            arriving.unit.structure_id, None,
            "structures do not travel with a walker"
        );
    }

    #[test]
    fn a_unit_whose_speed_is_unknown_departs_to_nowhere_nameable() {
        // No Capacity section, so the report never said how it travels: the trace cannot split
        // months and the destination cannot be named.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mystery (900), Foo (1), leader [LEAD].",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nMOVE SE\n",
        )
        .expect("the ruleset loads");

        let unit = only_unit(&response);
        assert_eq!(unit.status, UnitPreviewStatus::Departing);
        assert_eq!(unit.departing_to, None);
        assert!(
            !response
                .regions
                .iter()
                .any(|region| region.region_id == "1:2,2"),
            "an unknowable arrival is not drawn"
        );
    }

    #[test]
    fn a_round_trip_is_not_a_departure() {
        let response = preview("unit 900\nMOVE SE NW\n");
        assert!(
            response.regions.is_empty(),
            "back where it started, nothing to say: {:?}",
            response.regions
        );
    }

    #[test]
    fn the_last_movement_order_wins() {
        // The game executes the later MOVE, exactly as the map trace draws it.
        let response = preview("unit 900\nMOVE N\nMOVE SE\n");
        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        assert_eq!(origin.units[0].departing_to.as_deref(), Some("1:2,2"));
    }

    /// Two sea hexes, and in the first a named, priceable hull with two own units aboard, a
    /// second hull with a third, and a fourth unit standing outside any structure. Everything a
    /// sail trace needs is stated - `Load`, `Sailors` and `MaxSpeed` - because an unpriceable
    /// fleet is traced as a walker instead, which is a different test.
    fn fleet_report(first_hull: &str) -> String {
        let mut text = String::from("Foo (1) Report\n\n");
        text.push_str("ocean (1,1) in Sea.\n\n");
        text.push_str("Exits:\n  Southeast : ocean (2,2) in Sea.\n\n");
        text.push_str("* Ashore (903), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n");
        text.push_str(&format!("+ {first_hull}\n"));
        text.push_str(
            "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
        );
        text.push_str(
            "  * Passengers (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0.\n",
        );
        text.push_str("+ Seagull [330] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
        text.push_str(
            "  * Idlers (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n",
        );
        text.push_str("\nocean (2,2) in Sea.\n\n");
        text.push_str("Exits:\n  Northwest : ocean (1,1) in Sea.\n");
        text
    }

    /// The hull the passengers ride in: named, so the marker can name it, and priceable, so the
    /// trace calls the mode Sail.
    const WAVECREST: &str = "Wavecrest [329] : Longship; Load: 110/150; Sailors: 4/4; MaxSpeed: 4.";

    fn fleet_preview(hull: &str, orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &fleet_report(hull),
            "[]",
            orders,
        )
        .expect("the ruleset loads")
    }

    fn region_of<'a>(
        response: &'a OrdersPreviewResponse,
        region_id: &str,
    ) -> Option<&'a RegionPreview> {
        response
            .regions
            .iter()
            .find(|region| region.region_id == region_id)
    }

    fn row<'a>(
        response: &'a OrdersPreviewResponse,
        region_id: &str,
        unit_id: &str,
    ) -> Option<&'a UnitPreview> {
        region_of(response, region_id).and_then(|region| {
            region
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == unit_id)
        })
    }

    #[test]
    fn units_aboard_a_sailing_fleet_depart_with_it() {
        // The passenger wrote no order of its own; it goes where the ship goes, so the origin hex
        // must not keep men the fleet is taking away.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        for unit_id in ["900", "901"] {
            let departing =
                row(&response, "1:1,1", unit_id).unwrap_or_else(|| panic!("{unit_id} departs"));
            assert_eq!(departing.status, UnitPreviewStatus::Departing);
            assert_eq!(departing.departing_to.as_deref(), Some("1:2,2"));

            let arriving =
                row(&response, "1:2,2", unit_id).unwrap_or_else(|| panic!("{unit_id} arrives"));
            assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
            assert_eq!(arriving.arriving_from.as_deref(), Some("1:1,1"));
        }
    }

    #[test]
    fn a_carried_unit_names_the_fleet_that_takes_it() {
        // Name plus id, from the report's own structure: two hulls of one kind read alike, so the
        // name the player gave is the half worth showing.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let carried = row(&response, "1:1,1", "901").expect("the passenger departs");
        assert_eq!(carried.aboard.as_deref(), Some("Wavecrest [329]"));
    }

    #[test]
    fn the_unit_that_wrote_the_order_carries_no_aboard_marker() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let sailor = row(&response, "1:1,1", "900").expect("the sailing unit departs");
        assert_eq!(sailor.aboard, None, "it wrote the order; it is not cargo");
    }

    #[test]
    fn an_arriving_row_carries_no_aboard_marker() {
        // An arrival says only where the unit came from.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let arrived = row(&response, "1:2,2", "901").expect("the passenger arrives");
        assert_eq!(arrived.aboard, None);
    }

    #[test]
    fn a_passengers_own_move_order_wins() {
        // Overwriting what the player deliberately typed was the rejected alternative.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\nunit 901\nMOVE NW\n");

        let passenger = row(&response, "1:1,1", "901").expect("the passenger departs");
        assert_eq!(passenger.status, UnitPreviewStatus::Departing);
        assert_eq!(passenger.aboard, None, "it goes under its own order");
        assert_ne!(
            passenger.departing_to.as_deref(),
            Some("1:2,2"),
            "its own destination, not the ship's"
        );
    }

    #[test]
    fn passengers_follow_an_untraceable_ship() {
        // `SAIL OUT` names no hex to enter, so the trace can price the fleet but cannot say where
        // the month ends: the passengers depart to nowhere nameable, and appear in no destination.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL OUT\n");

        let carried = row(&response, "1:1,1", "901").expect("the passenger departs");
        assert_eq!(carried.status, UnitPreviewStatus::Departing);
        assert_eq!(carried.departing_to, None);
        assert_eq!(carried.aboard.as_deref(), Some("Wavecrest [329]"));
        assert!(
            region_of(&response, "1:2,2").is_none(),
            "an unknowable arrival is not drawn"
        );
    }

    #[test]
    fn a_unit_ashore_is_not_carried() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        assert!(
            row(&response, "1:1,1", "903").is_none() && row(&response, "1:2,2", "903").is_none(),
            "a unit outside the hull is untouched, so it is not in the answer at all"
        );
    }

    #[test]
    fn a_unit_in_a_different_structure_is_not_carried() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        assert!(
            row(&response, "1:1,1", "902").is_none() && row(&response, "1:2,2", "902").is_none(),
            "the other hull is not sailing"
        );
    }

    #[test]
    fn a_unit_aboard_a_fleet_that_walks_is_not_carried() {
        // An unknown hull cannot be priced, so the trace falls back to the ordering unit's own
        // land mobility: no Sail, nobody carried.
        let response = fleet_preview("Dinghy [329] : Skiff.", "unit 900\nSAIL SE\n");

        let passenger = row(&response, "1:1,1", "901");
        assert!(
            passenger.is_none(),
            "the passenger is untouched: {passenger:?}"
        );
    }

    #[test]
    fn a_sailing_fleet_arrives_with_its_hull() {
        // The hull is what is moving, so the unit that wrote the order is still standing in it
        // when it gets there: the destination's `in` column reads the ship, not a dash.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let arrived = row(&response, "1:2,2", "900").expect("the sailing unit arrives");
        assert_eq!(arrived.unit.structure_id.as_deref(), Some("329"));
    }

    #[test]
    fn everyone_aboard_arrives_still_aboard() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let arrived = row(&response, "1:2,2", "901").expect("the passenger arrives");
        assert_eq!(arrived.unit.structure_id.as_deref(), Some("329"));
    }

    #[test]
    fn a_walker_leaving_a_fort_arrives_outside_it() {
        // A building never travels, so a unit standing in one arrives ashore.
        let response = preview("unit 901\nENTER 5\nMOVE SE\n");

        let arrived = row(&response, "1:2,2", "901").expect("the walker arrives");
        assert_eq!(arrived.unit.structure_id, None);
    }

    #[test]
    fn a_unit_that_left_the_ship_before_moving_arrives_outside() {
        // `LEAVE` runs before movement is resolved, so there is no hull to carry.
        let response = fleet_preview(WAVECREST, "unit 900\nLEAVE\nSAIL SE\n");

        for region_id in ["1:1,1", "1:2,2"] {
            if let Some(unit) = row(&response, region_id, "900") {
                assert_eq!(
                    unit.unit.structure_id, None,
                    "it left the hull before moving ({region_id})"
                );
            }
        }
    }

    /// Every order this module applies must be one the grammar recognises, so the two cannot
    /// drift apart: an order the validator rejects must never silently change the preview.
    #[test]
    fn every_effect_order_is_in_the_grammar() {
        // The movement words are derived from the one list, so a fourth one can never be
        // forgotten here.
        for keyword in [
            "name", "guard", "avoid", "behind", "enter", "leave", "form", "give", "turn", "endturn",
        ]
        .iter()
        .copied()
        .chain(
            crate::movement::orders::MOVEMENT_ORDER_COMMANDS
                .iter()
                .copied(),
        ) {
            assert!(
                crate::orders::grammar::find_order(keyword).is_some(),
                "{keyword} is not in the grammar"
            );
        }
    }

    /// `ah-agbm`. The seam onto `semantics::item_effects`, and what the preview does with it:
    /// `BUY`, `SELL`, `WITHDRAW` and `TAKE` reach `unit.items` exactly as `GIVE` already does, and
    /// the two new fields cross the boundary.
    mod item_effects {
        use super::*;

        #[test]
        fn a_bought_item_reaches_the_previewed_unit() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY 5 horse\n");
            let unit = only_unit(&response);

            let bought = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HORS")
                .expect("the bought horses are in the previewed list");
            assert_eq!(bought.amount, 5);
            change(unit, "items");
        }

        /// Q4's rule, via the existing `take_item`.
        #[test]
        fn a_sold_out_stock_disappears_from_the_previewed_list() {
            let response = preview_over(&report_with_market(), "unit 900\nSELL ALL FUR\n");
            let unit = only_unit(&response);

            assert!(
                !unit.unit.items.iter().any(|item| item.tag == "FUR"),
                "an emptied stock must not be shown, even as zero: {:?}",
                unit.unit.items
            );
            change(unit, "items");
        }

        /// A unit ordered `sell 8 FUR` and then `give 901 5 FUR` out of a stock of 10 is
        /// overdrawn: the ledger's `SELL` movement is computed against the report's original 10,
        /// but the `GIVE` has already taken 5 off the previewed list by the time it applies. The
        /// column must not render `-3 FUR`.
        #[test]
        fn an_overdrawn_stock_is_never_negative() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nSELL 8 FUR\nGIVE 901 5 FUR\n",
            );
            let giver = response.regions[0]
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == "900")
                .expect("the giver changed");

            assert!(
                !giver.unit.items.iter().any(|item| item.tag == "FUR"),
                "an overdrawn stock must be dropped, not shown negative: {:?}",
                giver.unit.items
            );
        }

        /// The guard on double-application: `GIVE` records no movement in the ledger, so a unit
        /// ordered to give 2 swords loses exactly 2, not 4.
        #[test]
        fn a_gift_is_still_applied_exactly_once() {
            let response = preview("unit 900\nGIVE 901 2 SWOR\n");
            let giver = response.regions[0]
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == "900")
                .expect("the giver changed");

            let swords = giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount);
            assert_eq!(swords, 1, "3 swords less 2 given, not less 4");
        }

        #[test]
        fn an_uncounted_order_reaches_the_preview_verbatim() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nbuy all HORS ; testing\nSELL 1 FUR\n",
            );
            let unit = only_unit(&response);

            assert_eq!(unit.uncounted, vec!["buy all HORS".to_string()]);
        }

        /// The navigator's S1 state: a unit whose only order cannot be counted still reaches the
        /// response, with `changes` empty and `uncounted` naming the order - the filter at the
        /// bottom of `preview_orders_on_map` gains `&& uncounted.is_empty()` for exactly this.
        #[test]
        fn a_unit_whose_only_order_cannot_be_counted_is_still_sent() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY ALL HORS\n");
            let unit = only_unit(&response);

            assert!(unit.changes.is_empty(), "{:?}", unit.changes);
            assert_eq!(unit.uncounted, vec!["BUY ALL HORS".to_string()]);
        }

        #[test]
        fn a_take_from_a_unit_not_shown_here_names_its_source() {
            let response = preview_over(&report_with_market(), "unit 901\nTAKE FROM 999 5 GRAI\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.taken_unshown,
                vec![TakenUnshown {
                    amount: 5,
                    tag: "GRAI".to_string(),
                    from: "999".to_string(),
                }]
            );
        }
    }
}
