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

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::cache::ReportCache;
use crate::movement::rules::Ruleset;
use crate::orders::items::{is_unfinished_ship, item_named, unfinished_ship_named};
use crate::orders::standing::{standing_after, BoardingOrder};
use crate::report::composition;
use crate::report::model::{level_for_points, ReportUnit, Skill, UnitMovementStatus};

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
    /// The `ReportUnit` field, in its wire spelling: `name`, `onGuard`, `flags`, `items`, `skills`,
    /// `men`, `structureId`, `movement`.
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
    /// What this unit's `PRODUCE` orders make this month, so the hover can say the goods arrive in
    /// the month's last phase. Empty for a unit not producing, and for one whose run comes to
    /// nothing (`ah-ofpb.1`).
    pub produced: Vec<ProducedItem>,
    /// What this unit's `BUILD` orders spend this month, so the hover can say where the material
    /// went and what cut the work short. Empty for a unit not building, and for one whose build
    /// comes to nothing (`ah-ofpb.2`).
    pub built: Vec<BuildSpend>,
    /// What this unit's `CAST` orders create this month, so the hover can say what is arriving and
    /// the column can show a chance creation as a range. Empty for a unit not casting, and for one
    /// whose cast creates nothing an item catalogue can carry (`ah-ofpb.5`).
    pub created: Vec<CreatedItem>,
    /// One line of what this unit's `TRANSPORT`/`DISTRIBUTE` orders send this month, in document
    /// order. Empty for a unit that sent nothing (`ah-bxgs`).
    pub transport_sent: Vec<TransportSent>,
    /// One item arriving by another unit's `TRANSPORT`/`DISTRIBUTE` this month. Empty for a unit
    /// receiving nothing (`ah-bxgs`).
    pub transport_received: Vec<TransportReceived>,
}

/// One line of what a unit's `TRANSPORT`/`DISTRIBUTE` orders send this month, in document order
/// (`ah-bxgs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportSent {
    /// How much leaves. `0` on a refused line, which moves nothing.
    pub amount: i64,
    pub tag: String,
    /// The unit number the order named. Empty on a refused line, whose sentence names no target.
    pub to: String,
    /// The order named a unit number that appears nowhere in the report - an ally's
    /// quartermaster, or a mistake. `false` for a unit the report shows but we cannot project.
    pub to_unshown: bool,
    /// The game will not transport this item (`rules/economy_transport`), so it stays put.
    pub refused: bool,
}

/// One item arriving by another unit's `TRANSPORT`/`DISTRIBUTE` (`ah-bxgs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportReceived {
    pub amount: i64,
    pub tag: String,
    /// The sending unit's number.
    pub from: String,
}

/// Goods taken from a unit the report does not show in this hex (`ah-agbm`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenUnshown {
    pub amount: i64,
    pub tag: String,
    pub from: String,
}

/// One item a `PRODUCE` order makes this month (`ah-ofpb.1`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProducedItem {
    pub amount: i64,
    pub tag: String,
}

/// Which limit decided how much work a `BUILD` does, when it was not the unit's men.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BuildCap {
    /// The unit holds less of the material than its men could work.
    Materials,
    /// The structure wants less work than its men could do - the last month of every build.
    Needs,
}

/// What one `BUILD` order spends this month (`ah-ofpb.2`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSpend {
    /// Material consumed, which is also the units of work done.
    pub amount: i64,
    /// The material's tag, as the item list keys it - `WOOD`.
    pub tag: String,
    /// The material's display name, as the cap sentence says it - `wood`.
    pub name: String,
    /// What is being worked on: `structure_label` for one that exists, or the kind the player
    /// wrote when `founding`.
    pub place: String,
    /// Set when `place` names a kind being founded rather than a structure that is already there.
    pub founding: bool,
    /// The unit being helped, for a `BUILD HELP`. `None` for a unit building on its own account.
    pub helping: Option<String>,
    /// What this unit's men alone could have done.
    pub could_do: i64,
    pub capped_by: Option<BuildCap>,
}

/// One item a `CAST` order creates this month (`ah-ofpb.5`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedItem {
    /// The fewest the cast may bring.
    pub fewest: i64,
    /// The most it may bring, which is the figure already folded into the unit's item list.
    pub most: i64,
    pub tag: String,
    /// Whether the skill calls this a summoning, which decides the hover's verb.
    pub summoned: bool,
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
    // `rules/sequenceofevents` settles GIVE and TAKE in one Give phase, before the market - and
    // processes units in report order, which is why nothing moved while the document was being
    // read (`ah-3mwm`).
    working.apply_transfers();

    // What `BUY`, `SELL`, `WITHDRAW` and `TAKE` do to each unit's item list, read from the same
    // ledger the Silver column and the shortfall warnings settle an oversubscribed market line
    // from - so the ITEMS and SILVER cells on one row cannot disagree (`ah-agbm`). `GIVE` is not
    // read here: the walk above already applied every gift through `Working::give`.
    let item_effects =
        super::semantics::item_effects(&report, orders_document, Some(ruleset.as_ref()));
    working.apply_item_effects(&item_effects);
    settle_headcounts(&mut working.units, &ruleset);
    // `rules/form`, and only once the market has settled: a formed unit's own BUY is what decides
    // whether it gained anybody, so nothing can be dissolved before `item_effects` has been
    // applied and the headcounts derived from it (`ah-dhga`).
    let dissolved = working.dissolve_empty_forms();
    // Last of all, because `rules/sequenceofevents` runs TRANSPORT in the month's final phases -
    // after the market, after movement, after production. A sale takes its goods first, and
    // whatever a PRODUCE made this month is there to be sent.
    working.apply_transports(&dissolved);
    for (index, working_unit) in working.units.iter_mut().enumerate() {
        if dissolved.contains(&index) {
            continue;
        }
        working_unit.refresh_movement(&ruleset);
    }

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

    for (index, entry) in working.units.into_iter().enumerate() {
        if dissolved.contains(&index) {
            continue;
        }
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
        let produced = entry.produced.clone();
        let built = entry.built.clone();
        let created = entry.created.clone();
        let transport_sent = entry.transport_sent.clone();
        let transport_received = entry.transport_received.clone();

        let departed = status == UnitPreviewStatus::Departing;
        if changes.is_empty()
            && !departed
            && status != UnitPreviewStatus::Formed
            && uncounted.is_empty()
            && transport_sent.is_empty()
            && transport_received.is_empty()
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
                    produced: produced.clone(),
                    built: built.clone(),
                    created: created.clone(),
                    transport_sent: transport_sent.clone(),
                    transport_received: transport_received.clone(),
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
                    produced,
                    built,
                    created,
                    transport_sent,
                    transport_received,
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
                    produced,
                    built,
                    created,
                    transport_sent,
                    transport_received,
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
        // A newly formed unit has cast nothing and been set to cast nothing.
        combat_spell: None,
        men: 0,
        // Nothing has been given yet, and what is given is counted exactly.
        men_estimated: false,
        men_by_race: Vec::new(),
        weight: None,
        capacity: None,
        movement: None,
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
    /// What this row was handed by `GIVE` this month, in the order the gifts were read.
    ///
    /// Only a formed unit's is read, and only to dissolve it: `rules/form` reverts "the silver and
    /// any other items it **was given**", which is exactly this list and not whatever the row's
    /// own month bought or took (`ah-dhga`).
    given: Vec<crate::report::model::ItemAmount>,
    /// This unit's orders whose effect on its items could not be counted, verbatim, in document
    /// order. Written once by `apply_item_effects`, after the walk that builds every unit here has
    /// finished (`ah-agbm`).
    uncounted: Vec<String>,
    /// Silver or goods taken from a unit the report does not show in this hex. Written once by
    /// `apply_item_effects` (`ah-agbm`).
    taken_unshown: Vec<TakenUnshown>,
    /// What this unit's `PRODUCE` orders make this month. Written once by `apply_item_effects`
    /// (`ah-ofpb.1`).
    produced: Vec<ProducedItem>,
    /// What this unit's `BUILD` orders spend this month. Written once by `apply_item_effects`
    /// (`ah-ofpb.2`).
    built: Vec<BuildSpend>,
    /// What this unit's `CAST` orders create this month. Written once by `apply_item_effects`
    /// (`ah-ofpb.5`).
    created: Vec<CreatedItem>,
    /// What this unit's `TRANSPORT`/`DISTRIBUTE` orders send this month. Written once by
    /// `apply_transports`, after everything else has run (`ah-bxgs`).
    transport_sent: Vec<TransportSent>,
    /// What arrives at this unit by another unit's `TRANSPORT`/`DISTRIBUTE` this month. Written
    /// once by `apply_transports` (`ah-bxgs`).
    transport_received: Vec<TransportReceived>,
    /// This unit's settled recruits this month, copied from `UnitItemEffects::recruited` by
    /// `apply_item_effects`. Empty when nothing was recruited and when a `BUY ALL` makes the exact
    /// figure unknowable; `settle_headcounts` reads this to dilute skills by the exact settled
    /// count rather than infer one from the item list's net change (`ah-4a13`).
    recruited: Vec<crate::report::model::ItemAmount>,
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
            "skills",
            self.unit.skills != original.skills,
            original
                .skills
                .iter()
                .map(|skill| format!("{} {} ({})", skill.tag, skill.level, skill.points))
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
        let original_status = original.movement.map(|movement| movement.status);
        let current_status = self.unit.movement.map(|movement| movement.status);
        if original_status != current_status {
            if let Some(status) = original_status {
                changes.push(FieldChange {
                    field: "movement".to_string(),
                    original: movement_status_label(status).to_string(),
                });
            }
        }
        changes
    }

    fn refresh_movement(&mut self, ruleset: &Ruleset) {
        if !self.formed
            && self
                .original
                .as_ref()
                .is_some_and(|original| self.unit.items == original.items)
        {
            return;
        }
        if !self.uncounted.is_empty()
            || self
                .created
                .iter()
                .any(|created| created.fewest != created.most)
        {
            self.unit.movement = self.original.as_ref().and_then(|unit| unit.movement);
            return;
        }
        self.unit.movement = crate::movement::mode::unit_movement_from_items(&self.unit, ruleset)
            .or_else(|| self.original.as_ref().and_then(|unit| unit.movement));
    }
}

fn movement_status_label(status: UnitMovementStatus) -> &'static str {
    match status {
        UnitMovementStatus::Overloaded => "Overloaded",
        UnitMovementStatus::Fly => "Flying",
        UnitMovementStatus::Ride => "Riding",
        UnitMovementStatus::Walk => "Walking",
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
    /// Every `TRANSPORT`/`DISTRIBUTE` this document writes, in document order, to be applied once
    /// everything else has been. `rules/sequenceofevents` runs transport in the month's last
    /// phases, after the market and after production, so a sale written below a transport still
    /// takes its goods first (`ah-bxgs`).
    transports: Vec<PendingTransport>,
    /// Every unit id the report names, ours and everyone else's. A target in here but not in
    /// `by_id` is a unit we can see and cannot project; one in neither is what the hover calls
    /// "which your report does not show" (`ah-bxgs`).
    known_units: std::collections::BTreeSet<String>,
    /// Every unit id the report shows in each region, ours and everyone else's, keyed by region id.
    ///
    /// `known_units` above is report-wide and answers `ah-bxgs`'s TRANSPORT question, which reaches
    /// across hexes. A `GIVE` is settled in one hex - `rules/sequenceofevents` runs it in phase 4,
    /// before anything moves in phase 9 - so the test a target needs is per-region, and the two
    /// must not be confused (`ah-vcp8.2`).
    shown_in_region: BTreeMap<String, std::collections::BTreeSet<String>>,
    /// Every unit id the report shows that is not ours. A `TAKE` naming one of these is refused
    /// outright - `rules/take` confines a TAKE to "another unit in the same faction" - and must
    /// not be mistaken for the bounded optimism a take from a unit the report never shows gets.
    foreign_units: std::collections::BTreeSet<String>,
    /// Every `GIVE` and `TAKE` this document writes, applied only once the whole document has
    /// been read. `rules/sequenceofevents` settles both in one Give phase and processes units
    /// "in the order they appear on the report", which is not the order their blocks were
    /// written in (`ah-3mwm`).
    transfers: Vec<PendingTransfer>,
    /// Every unit id the report shows holding the quartermaster skill, resolved through the
    /// catalogue rather than by tag spelling - `QUAM` is quartermaster and `QUAR` is quarrying
    /// (`ah-d0ku`).
    quartermasters: std::collections::BTreeSet<String>,
}

/// One `GIVE` or `TAKE`, held until the whole document has been read so the Give phase can be
/// settled in report order (`ah-3mwm`).
struct PendingTransfer {
    /// The unit whose block the order is in - its position in `Working::units`, which is report
    /// order for reported units and, after them, the order the `FORM` blocks created them in.
    actor: usize,
    /// The document line, the secondary key: report order chooses between actors, and this still
    /// chooses between several transfers one actor wrote.
    line: usize,
    /// The other end. For a `GIVE` this is the receiver; for a `TAKE`, `rules/take` reverses the
    /// direction and it is the source.
    party: super::forms::Party,
    what: super::forms::Selector,
    amount: super::forms::Amount,
    is_give: bool,
}

/// One `TRANSPORT`/`DISTRIBUTE` order, held until the month's other orders have been worked out
/// (`ah-bxgs`).
struct PendingTransport {
    sender: usize,
    /// The receiving row, when the target is one of ours. `None` for an ally's quartermaster or a
    /// unit number the report does not carry - the goods still leave.
    receiver: Option<usize>,
    /// The unit number as the order wrote it, for the hover.
    to: String,
    /// `true` when `to` appears nowhere in the report at all.
    to_unshown: bool,
    what: super::forms::Selector,
    amount: super::forms::Amount,
    /// Where the line stood in the document, kept privately so phase execution can restore
    /// document order on `transport_sent`/`transport_received` afterwards (`ah-d0ku`).
    sequence: usize,
}

/// The three phases `rules/sequenceofevents` runs TRANSPORT in, in rule order: "Items are sent
/// from non-quartermaster units to quartermaster units", then "from one quartermaster unit to
/// another quartermaster units", then "a quartermaster unit to non-quartermaster units"
/// (`ah-d0ku`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum TransportPhase {
    ToQuartermaster,
    BetweenQuartermasters,
    FromQuartermaster,
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
                given: Vec::new(),
                uncounted: Vec::new(),
                taken_unshown: Vec::new(),
                produced: Vec::new(),
                built: Vec::new(),
                created: Vec::new(),
                transport_sent: Vec::new(),
                transport_received: Vec::new(),
                recruited: Vec::new(),
            });
        }
        let known_units: std::collections::BTreeSet<String> =
            report.units().map(|unit| unit.unit_id.clone()).collect();
        // `rules/sequenceofevents` phases TRANSPORT by whether each end is a quartermaster, so the
        // skill has to be resolved by name through the catalogue: `QUAM` is quartermaster and
        // `QUAR` is quarrying, and matching the spelling alone confuses the two (`ah-d0ku`).
        let quartermaster_tag = ruleset
            .find_skill("quartermaster")
            .map(|skill| skill.tag.to_string());
        let quartermasters = match &quartermaster_tag {
            Some(tag) => report
                .units()
                .filter(|unit| {
                    unit.skills
                        .iter()
                        .any(|skill| skill.tag.eq_ignore_ascii_case(tag))
                })
                .map(|unit| unit.unit_id.clone())
                .collect(),
            None => std::collections::BTreeSet::new(),
        };
        let mut shown_in_region: BTreeMap<String, std::collections::BTreeSet<String>> =
            BTreeMap::new();
        for region in &report.regions {
            let shown = shown_in_region.entry(region.region_id.clone()).or_default();
            for unit in &region.units {
                shown.insert(unit.unit_id.clone());
            }
        }
        Self {
            units,
            by_id,
            by_alias: BTreeMap::new(),
            current: None,
            forming: Vec::new(),
            ruleset,
            transports: Vec::new(),
            quartermasters,
            known_units,
            shown_in_region,
            foreign_units: report
                .units()
                .filter(|unit| !unit.own)
                .map(|unit| unit.unit_id.clone())
                .collect(),
            transfers: Vec::new(),
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
                self.read_order(line.command, line.arguments, line.number);
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

    /// Dissolves every formed unit that gained nobody, returning its goods to the first own unit
    /// the report shows in that region (`rules/form`: "If no recruits are gained at all, the empty
    /// unit will be dissolved, and the silver and any other items it was given will revert to the
    /// first unit you have in that region").
    ///
    /// Returns the indices of the dissolved rows rather than removing them: `by_id`, `by_alias`
    /// and every queued `PendingTransport` store indices into `self.units`, so the entries stay
    /// put and the caller filters them out while rendering. What the row was not given stays on
    /// it, unrendered - so `apply_transports` is given the same set and drops what a dissolved row
    /// had queued.
    fn dissolve_empty_forms(&mut self) -> BTreeSet<usize> {
        let mut dissolved = BTreeSet::new();
        for index in 0..self.units.len() {
            if !self.units[index].formed || self.units[index].unit.men != 0 {
                continue;
            }
            let region_id = self.units[index].unit.region_id.clone();
            // `over_own_units` preserves report order, so `position` finds the first unit the
            // report shows in that region - not the unit that formed this one. A region with no
            // own report unit has nobody to revert to, and then nothing is taken from the
            // dissolving row either: taking first and discarding what could not be handed over
            // would destroy the goods.
            let Some(recipient) = self
                .units
                .iter()
                .position(|unit| unit.unit.region_id == region_id && unit.original.is_some())
            else {
                dissolved.insert(index);
                continue;
            };
            // Exactly what it was *given*, which is what `rules/form` reverts - not what its own
            // month bought, produced or took. A `BUY` the game would never have executed must not
            // become a windfall for the unit the goods revert to.
            //
            // Clamped to what the row still holds, by the same case-insensitive tag match the
            // rest of this file uses: a gift the unit then sold or gave on is not there to
            // revert. The clamp is a bound, not a ledger - it cannot tell gifted stock from stock
            // the row acquired itself, so a row given 100 silver, giving it on and then earning
            // 50 reverts that 50. At this layer that is the cheaper wrong answer of the two.
            for gift in std::mem::take(&mut self.units[index].given) {
                let Some(at) = self.units[index]
                    .unit
                    .items
                    .iter()
                    .position(|item| item.tag.eq_ignore_ascii_case(&gift.tag))
                else {
                    continue;
                };
                let moved = gift.amount.min(self.units[index].unit.items[at].amount);
                if moved <= 0 {
                    continue;
                }
                take_item(&mut self.units[index].unit.items, at, moved);
                add_item(
                    &mut self.units[recipient].unit.items,
                    &gift.name,
                    &gift.tag,
                    moved,
                );
            }
            dissolved.insert(index);
        }
        dissolved
    }

    /// Applies what `BUY`, `SELL` and `WITHDRAW` move into or out of each unit's item
    /// list, and records what could not be counted at all - `super::semantics::item_effects`'s
    /// seam onto the ledger the same settlement already prices (`ah-agbm`).
    ///
    /// `GIVE` and `TAKE` are not read here: `Working::apply_transfers` has already settled the
    /// whole Give phase in report order, and the ledger records no movement for either for
    /// exactly that reason - applying one again here would move it twice (`ah-3mwm`).
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
            unit.recruited = effect.recruited.clone();
            unit.produced = effect
                .moved
                .iter()
                .filter(|movement| movement.produced)
                .map(|movement| ProducedItem {
                    amount: movement.delta,
                    tag: movement.tag.clone(),
                })
                .collect();
            unit.built = effect.built.clone();
            unit.created = effect
                .moved
                .iter()
                .filter_map(|movement| {
                    movement.created.as_ref().map(|created| CreatedItem {
                        fewest: created.fewest,
                        most: movement.delta,
                        tag: movement.tag.clone(),
                        summoned: created.summoned,
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
            given: Vec::new(),
            uncounted: Vec::new(),
            taken_unshown: Vec::new(),
            produced: Vec::new(),
            built: Vec::new(),
            created: Vec::new(),
            transport_sent: Vec::new(),
            transport_received: Vec::new(),
            recruited: Vec::new(),
        });
        self.forming.push(Some(index));
    }

    /// Applied through the grammar's own consumed prefix (`ah-86vk`), like [`super::intents`]:
    /// trailing text a valid order ignores is trimmed away before any reader below sees it, so an
    /// accepted line previews the same thing validation and `intents` agree it means, and a
    /// malformed required argument previews nothing at all - the same answer `check_shape` gives.
    fn read_order(
        &mut self,
        command: &super::lexer::Token,
        arguments: &[super::lexer::Token],
        line: usize,
    ) {
        let Some(active) = self.active() else {
            return;
        };
        let Some(arguments) = super::grammar::consumed_arguments(command, arguments) else {
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
            self.queue_give(active, arguments, line);
        } else if command.is("take") {
            self.queue_take(active, arguments, line);
        } else if command.is("transport") || command.is("distribute") {
            // `rules/transport`: "the order DISTRIBUTE can be used in place of TRANSPORT and has
            // the same meaning and syntax", which is why one arm serves both and why the grammar
            // gives them one shared `TRANSPORT_FORMS` (`ah-bxgs`).
            self.transport(active, arguments);
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

    /// Our own row for a unit id standing in one region - a reported unit by number, or one this
    /// month's `FORM` orders create, whose id `formed_unit` mints as `new-{alias}` (`:520`).
    /// `by_alias` is keyed `(region, alias)`, so the prefix is stripped back off to reach it.
    fn index_in(&self, region: &str, id: &str) -> Option<usize> {
        match id.strip_prefix("new-") {
            Some(alias) => self
                .by_alias
                .get(&(region.to_string(), alias.to_string()))
                .copied(),
            None => self
                .by_id
                .get(id)
                .copied()
                .filter(|&index| self.units[index].unit.region_id == region),
        }
    }

    /// `GIVE target amount item`, where the target is a unit, `NEW n`, another faction's new unit,
    /// or `0` to discard.
    ///
    /// The shapes are read by [`super::forms`], the same reader the validator and the intent pass
    /// use, so an order this previews is an order the validator accepts. Nothing moves here: the
    /// order is queued and settled by [`Working::apply_transfers`] once the whole document has
    /// been read, because `rules/sequenceofevents` settles the Give phase in report order rather
    /// than in the order the blocks were written (`ah-3mwm`).
    fn queue_give(&mut self, giver: usize, arguments: &[super::lexer::Token], line: usize) {
        let Some((target, rest)) = super::forms::read_party(arguments) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };
        self.transfers.push(PendingTransfer {
            actor: giver,
            line,
            party: target,
            what,
            amount,
            is_give: true,
        });
    }

    /// `TAKE FROM source amount item`, which `rules/take` defines as a GIVE with the direction
    /// reversed. Queued exactly as a `GIVE` is, and for the same reason.
    fn queue_take(&mut self, taker: usize, arguments: &[super::lexer::Token], line: usize) {
        let Some((_, rest)) = arguments.split_first().filter(|(kw, _)| kw.is("FROM")) else {
            return;
        };
        let Some((source, rest)) = super::forms::read_party(rest) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };
        self.transfers.push(PendingTransfer {
            actor: taker,
            line,
            party: source,
            what,
            amount,
            is_give: false,
        });
    }

    /// Settles this month's Give phase.
    ///
    /// `rules/sequenceofevents` processes GIVE and TAKE together and, where nothing else orders
    /// units within a phase, "units will be processed in the order they appear on the report" -
    /// which is `Working::units`' own order, reported units first and this month's formed units
    /// after them. The line is the secondary key alone, so one actor's own transfers still settle
    /// in the order it wrote them. `sort_by_key` is stable, so equal keys - which cannot occur,
    /// one order per line - would keep document order anyway.
    fn apply_transfers(&mut self) {
        let mut pending = std::mem::take(&mut self.transfers);
        pending.sort_by_key(|transfer| (transfer.actor, transfer.line));
        for transfer in pending {
            if transfer.is_give {
                self.give(
                    transfer.actor,
                    &transfer.party,
                    &transfer.what,
                    &transfer.amount,
                );
            } else {
                self.take(
                    transfer.actor,
                    &transfer.party,
                    &transfer.what,
                    &transfer.amount,
                );
            }
        }
    }

    /// One settled `GIVE`.
    ///
    /// What is left here is resolution: which unit the target names, whether the giver holds what
    /// it is giving, and how much actually moves.
    ///
    /// A target the walker cannot find - another hex, another faction, an alias never formed -
    /// makes the whole order a no-op: the validator flags what the server would refuse, and
    /// half-applying it here would show a transfer that will not happen.
    fn give(
        &mut self,
        giver: usize,
        target: &super::forms::Party,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
    ) {
        use super::targets::{give_reach, party_unit_id, GiveReach};

        let region = self.units[giver].unit.region_id.clone();
        let giver_id = self.units[giver].unit.unit_id.clone();
        let reach = give_reach(
            target,
            &giver_id,
            |id| self.index_in(&region, id).is_some(),
            |id| {
                self.shown_in_region
                    .get(&region)
                    .is_some_and(|shown| shown.contains(id))
            },
            // Report-wide, and it is what separates a unit we know is in another hex from a number
            // the report never prints, which may be a hidden Friendly target (`ah-66yi`).
            |id| self.known_units.contains(id),
        );
        let receiver = match reach {
            // Nothing at all: not even the giver loses what it named (`ah-vcp8.2`).
            GiveReach::Nowhere => return,
            // The goods leave and no row of ours gains them. `Unshown` reaches here too and moves
            // nothing at all, because `tags_moved` returns no tag for it - `rules/give` may or may
            // not let the gift through and this column says so with `+ ?` rather than a figure
            // (`ah-66yi`).
            GiveReach::Discard | GiveReach::Foreign | GiveReach::Unshown => None,
            // Decided by this same lookup a line ago, so it answers again.
            GiveReach::Ours => party_unit_id(target).and_then(|id| self.index_in(&region, &id)),
        };

        self.move_between(giver, receiver, what, amount, reach, true);
    }

    /// One settled `TAKE`, which `rules/take` defines as a GIVE with the direction reversed and
    /// confines to "another unit in the same faction" - so the source is always one of ours, found
    /// the same way `give` finds its receiver.
    ///
    /// Moves the goods as well as the people, unlike the pass this replaced: the Give phase is
    /// settled here in report order now, so leaving the items to the later ledger-driven pass
    /// would settle the two halves of one order in two different orders (`ah-3mwm`).
    fn take(
        &mut self,
        taker: usize,
        source: &super::forms::Party,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
    ) {
        use super::forms::{Amount, Party, Selector};

        let source_index = match source {
            Party::New(alias) => {
                let key = (self.units[taker].unit.region_id.clone(), alias.clone());
                match self.by_alias.get(&key) {
                    Some(&index) => index,
                    None => return,
                }
            }
            // Nobody to take from: `rules/take` confines a TAKE to a faction-mate, so another
            // faction's unit and the discard target both leave the taker unchanged.
            Party::Discard | Party::Foreign { .. } => return,
            Party::Unit(id) => match self.by_id.get(id) {
                Some(&index)
                    if self.units[index].unit.region_id == self.units[taker].unit.region_id =>
                {
                    index
                }
                // A unit the report does not show here holds what no catalogue can say, so an
                // `ALL` is left alone - but a stated quantity of a named item the catalogue knows
                // is granted, and marked unverifiable, exactly as `ah-agbm` had the ledger grant
                // it. A unit the report shows and we do not own is refused outright instead.
                _ => {
                    if self.foreign_units.contains(id) {
                        return;
                    }
                    let (Selector::Item(text), Amount::Exact(count)) = (what, amount) else {
                        return;
                    };
                    if *count <= 0 {
                        return;
                    }
                    let Some(entry) = self.ruleset.find_item(text) else {
                        return;
                    };
                    let (name, tag) = (entry.name.clone(), entry.tag.to_ascii_uppercase());
                    add_item(&mut self.units[taker].unit.items, &name, &tag, *count);
                    self.units[taker].taken_unshown.push(TakenUnshown {
                        amount: *count,
                        tag,
                        from: id.clone(),
                    });
                    return;
                }
            },
        };

        if source_index == taker {
            return;
        }

        self.move_between(
            source_index,
            Some(taker),
            what,
            amount,
            super::targets::GiveReach::Ours,
            false,
        );
    }

    /// The half a `GIVE` and a `TAKE` share once each has decided which row holds the goods and
    /// which - if any - receives them: what leaves the source, what arrives, and the skills the
    /// arriving men bring.
    fn move_between(
        &mut self,
        source: usize,
        receiver: Option<usize>,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        reach: super::targets::GiveReach,
        // `rules/magic` forbids a mage to GIVE men and says nothing about TAKE, so the one rule
        // this half applies differently for its two callers needs telling which it is serving
        // (`ah-t8ei`).
        is_give: bool,
    ) {
        for (name, tag, moved) in self.tags_moved(source, what, amount, reach) {
            // `rules/magic`: "mages may not GIVE men at all", whatever the target - a discard
            // included, since `GIVE 0`'s exception is about *transfer* restrictions and this is
            // not one. Asked here rather than inside `tags_moved`, which `apply_transports` also
            // calls: the rule is about GIVE alone, which is why a TAKE passes `false` above
            // (`ah-t8ei`). Per tag, so `ALL ITEMS` still hands over the equipment the mage may
            // give.
            if is_give
                && super::targets::mage_give_refused(
                    &self.units[source].unit.skills,
                    &tag,
                    Some(&self.ruleset),
                )
            {
                continue;
            }
            // Re-resolved by tag rather than kept from the snapshot: an earlier tag in this same
            // loop may have removed an item ahead of this one and shifted every index after it.
            let Some(held) = self.units[source]
                .unit
                .items
                .iter()
                .position(|item| item.tag == tag)
            else {
                continue;
            };
            take_item(&mut self.units[source].unit.items, held, moved);
            if let Some(receiver) = receiver {
                add_item(&mut self.units[receiver].unit.items, &name, &tag, moved);
                // `rules/form` reverts what a dissolving formed unit "was given", so only a GIVE
                // is recorded here: what the row TAKES is its own doing, not a gift, and must not
                // revert with the rest (`ah-dhga`, `ah-3mwm`).
                if is_give {
                    add_item(&mut self.units[receiver].given, &name, &tag, moved);
                }
            }

            // A race is people, so moving one moves men as well as stock.
            if self.ruleset.is_man(&tag) {
                let unit = &mut self.units[source].unit;
                unit.men -= moved;
                if let Some(race) = unit.men_by_race.iter().position(|race| race.tag == tag) {
                    take_item(&mut unit.men_by_race, race, moved);
                }
                if let Some(receiver) = receiver {
                    let arriving = self.units[source].unit.skills.clone();
                    let unit = &mut self.units[receiver].unit;
                    // The merge runs before the men are added: weighting by the headcount after
                    // the arrivals is silently wrong.
                    unit.skills = merge_skills(&unit.skills, unit.men, &arriving, moved);
                    unit.men += moved;
                    add_item(&mut unit.men_by_race, &name, &tag, moved);
                }
            }
        }
    }

    /// `TRANSPORT`/`DISTRIBUTE target amount item`, whose target need only be FRIENDLY
    /// (`rules/economy_transport`) - so sending to another faction's quartermaster is the
    /// ordinary case and not a mistake. Parses and queues; nothing moves until
    /// `apply_transports` runs, last of all (`ah-bxgs`).
    ///
    /// Returns without queueing in five cases, each a decision: the line cannot be read at all;
    /// the selector is a whole class or a whole unit, which `TRANSPORT_FORMS` has no grammar for
    /// even though `read_transfer` (shared with `GIVE`) will still hand one back; the target was
    /// formed this month or belongs to another faction, and so owns no Caravanserai and cannot be
    /// a quartermaster; the target is `0` (`TRANSPORT` is not `GIVE`, and no rule makes
    /// transport-to-zero destroy goods); or the target resolves to the sender itself, which the
    /// server refuses.
    fn transport(&mut self, sender: usize, arguments: &[super::lexer::Token]) {
        use super::forms::{Party, Selector};

        let Some((target, rest)) = super::forms::read_party(arguments) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };
        if matches!(what, Selector::Class(_) | Selector::WholeUnit) {
            return;
        }

        let id = match target {
            Party::Unit(id) => id,
            Party::New(_) | Party::Foreign { .. } | Party::Discard => return,
        };
        if id == self.units[sender].unit.unit_id {
            return;
        }

        let receiver = self.by_id.get(&id).copied();
        let to_unshown = !self.known_units.contains(&id);

        let sequence = self.transports.len();
        self.transports.push(PendingTransport {
            sender,
            receiver,
            to: id,
            to_unshown,
            what,
            amount,
            sequence,
        });
    }

    /// Applies every queued `TRANSPORT`/`DISTRIBUTE`, last of all: `rules/sequenceofevents` runs
    /// transport in the month's final phases, after the market, after movement, after production
    /// (`ah-bxgs`).
    fn apply_transports(&mut self, dissolved: &BTreeSet<usize>) {
        let pending = std::mem::take(&mut self.transports);
        let mut sent: Vec<Vec<(usize, TransportSent)>> = vec![Vec::new(); self.units.len()];
        let mut received: Vec<Vec<(usize, TransportReceived)>> = vec![Vec::new(); self.units.len()];

        for phase in [
            TransportPhase::ToQuartermaster,
            TransportPhase::BetweenQuartermasters,
            TransportPhase::FromQuartermaster,
        ] {
            let mut of_this_phase: Vec<&PendingTransport> = pending
                .iter()
                .filter(|pending| !dissolved.contains(&pending.sender))
                .filter(|pending| self.transport_phase(pending) == phase)
                .collect();
            // `rules/sequenceofevents`: "units that appear higher on the report get precedence",
            // which is `Working::units`' own order. The sequence is the secondary key alone, so
            // one sender's own lines still settle in the order it wrote them.
            of_this_phase.sort_by_key(|pending| (pending.sender, pending.sequence));
            if of_this_phase.is_empty() {
                continue;
            }
            self.apply_transport_phase(&of_this_phase, &mut sent, &mut received);
        }

        for (index, working) in self.units.iter_mut().enumerate() {
            let mut theirs = std::mem::take(&mut sent[index]);
            theirs.sort_by_key(|(sequence, _)| *sequence);
            working.transport_sent = theirs.into_iter().map(|(_, value)| value).collect();
            let mut theirs = std::mem::take(&mut received[index]);
            theirs.sort_by_key(|(sequence, _)| *sequence);
            working.transport_received = theirs.into_iter().map(|(_, value)| value).collect();
        }
    }

    /// Which of `rules/sequenceofevents`' three phases one queued line belongs to.
    ///
    /// A sender that is not a quartermaster is always the first phase. A quartermaster sending to
    /// a unit the report shows holding the skill is the second. Everything else - including a
    /// target the report does not show, or one whose skills are hidden - is the third: the
    /// navigator chose that deterministic fallback over inventing a skill the report never states
    /// (`ah-d0ku`).
    fn transport_phase(&self, pending: &PendingTransport) -> TransportPhase {
        let sender = &self.units[pending.sender].unit.unit_id;
        if !self.quartermasters.contains(sender) {
            return TransportPhase::ToQuartermaster;
        }
        if self.quartermasters.contains(&pending.to) {
            TransportPhase::BetweenQuartermasters
        } else {
            TransportPhase::FromQuartermaster
        }
    }

    /// One phase of transport, over every queued line that belongs to it.
    ///
    /// Each unit's holdings as the phase opened are the allowance every send in this phase is
    /// resolved against, while the movement itself is applied to the live item list. That is
    /// `rules/sequenceofevents`' "items may move in each of the phases but only once in each
    /// phase": goods that arrived in an earlier phase are available, and goods arriving during
    /// this one are not (`ah-d0ku`).
    fn apply_transport_phase(
        &mut self,
        pending: &[&PendingTransport],
        sent: &mut [Vec<(usize, TransportSent)>],
        received: &mut [Vec<(usize, TransportReceived)>],
    ) {
        let mut allowance: BTreeMap<usize, Vec<crate::report::model::ItemAmount>> = BTreeMap::new();
        for pending in pending {
            allowance
                .entry(pending.sender)
                .or_insert_with(|| self.units[pending.sender].unit.items.clone());
        }

        for pending in pending {
            let held = allowance
                .get(&pending.sender)
                .cloned()
                .unwrap_or_else(Vec::new);
            // `GiveReach::Discard` bypasses target-specific refusal: `TRANSPORT` has
            // its own permission gate, `can_be_transported`, checked below - the two lists are
            // not the same (`IENT` may not be given but may be transported).
            for (name, tag, moved) in self.tags_moved_from(
                &held,
                &pending.what,
                &pending.amount,
                super::targets::GiveReach::Discard,
            ) {
                if !self.ruleset.can_be_transported(&tag) {
                    sent[pending.sender].push((
                        pending.sequence,
                        TransportSent {
                            amount: 0,
                            tag,
                            to: String::new(),
                            to_unshown: false,
                            refused: true,
                        },
                    ));
                    continue;
                }
                // Re-resolved by tag rather than kept from the snapshot, exactly as `give` does:
                // an earlier transport in this same document may have emptied a stock ahead of
                // this one and shifted every index after it.
                let Some(live) =
                    find_item(&self.ruleset, &self.units[pending.sender].unit.items, &tag)
                else {
                    continue;
                };
                take_item(&mut self.units[pending.sender].unit.items, live, moved);
                if let Some(allowed) = allowance.get_mut(&pending.sender) {
                    if let Some(index) = allowed.iter().position(|item| item.tag == tag) {
                        take_item(allowed, index, moved);
                    }
                }
                sent[pending.sender].push((
                    pending.sequence,
                    TransportSent {
                        amount: moved,
                        tag: tag.clone(),
                        to: pending.to.clone(),
                        to_unshown: pending.to_unshown,
                        refused: false,
                    },
                ));
                if let Some(receiver) = pending.receiver {
                    add_item(&mut self.units[receiver].unit.items, &name, &tag, moved);
                    let from = self.units[pending.sender].unit.unit_id.clone();
                    received[receiver].push((
                        pending.sequence,
                        TransportReceived {
                            amount: moved,
                            tag,
                            from,
                        },
                    ));
                }
            }
        }
    }

    /// What one transfer actually moves out of `holder`: the tag, the name the holder writes it
    /// by, and how many.
    ///
    /// Snapshotted before anything moves, because the caller mutates the list this was read
    /// from.
    ///
    /// `rules/give` lists the classes and defines `ITEM`/`ITEMS` as "the combination of all of
    /// the previous categories", so it needs no classifying: it is everything. `MAN`/`MEN` is
    /// `composition::men_in`'s filter, the same one that derived the headcount to begin with.
    /// Every other class asks the catalogue (`Ruleset::class_members`, `ah-3sp7.1`); `ADVANCED`,
    /// `MAGIC` and `SPECIAL` stay unresolvable because the data page never states their members,
    /// and so does a word that is not a class at all.
    ///
    /// `GIVE target UNIT` hands over the whole unit rather than anything it holds - ownership is
    /// a different question from what a row shows, and is left to a later issue.
    ///
    /// `give_outcome` preserves the discard exception, rejects men aimed at another faction, and
    /// holds back a tag whose permission the report cannot establish (`rules/give`, `ah-66yi`).
    fn tags_moved(
        &self,
        holder: usize,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        reach: super::targets::GiveReach,
    ) -> Vec<(String, String, i64)> {
        self.tags_moved_from(&self.units[holder].unit.items, what, amount, reach)
    }

    /// The same question asked of an explicit item list rather than of a row's live holdings, so
    /// that a transport phase can resolve against the allowance it opened with while the movement
    /// itself is applied to the live list (`ah-d0ku`).
    fn tags_moved_from(
        &self,
        held_items: &[crate::report::model::ItemAmount],
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        reach: super::targets::GiveReach,
    ) -> Vec<(String, String, i64)> {
        use super::forms::{Amount, Selector};

        let moving: Vec<(String, String, i64)> = match what {
            Selector::Item(item) => {
                let Some(held) = find_item(&self.ruleset, held_items, item)
                else {
                    return Vec::new();
                };
                let (name, tag, held_amount) = {
                    let held = &held_items[held];
                    if is_unfinished_ship(held, Some(&self.ruleset)) {
                        return Vec::new();
                    }
                    (held.name.clone(), held.tag.clone(), held.amount)
                };
                let requested = match amount {
                    Amount::All { except } => held_amount.saturating_sub(*except),
                    Amount::Exact(count) => *count,
                };
                let moved = requested.clamp(0, held_amount);
                if moved == 0 {
                    Vec::new()
                } else {
                    vec![(name, tag, moved)]
                }
            }
            Selector::UnfinishedShip(text) => {
                let Some(tag) = unfinished_ship_named(Some(&self.ruleset), text, || {
                    held_items.iter()
                }) else {
                    return Vec::new();
                };
                let Some(held) = held_items
                    .iter()
                    .find(|item| item.tag.eq_ignore_ascii_case(&tag))
                else {
                    return Vec::new();
                };
                let requested = match amount {
                    Amount::All { except } => held.amount.saturating_sub(*except),
                    Amount::Exact(count) => *count,
                };
                let moved = requested.clamp(0, held.amount);
                if moved > 0 {
                    vec![(held.name.clone(), held.tag.clone(), moved)]
                } else {
                    Vec::new()
                }
            }
            // `rules/give` gives `EXCEPT` and a stated amount to the named-item forms alone; the
            // class form is `GIVE [unit] ALL [item class]` and nothing else. A class arriving
            // with either is a shape the rules do not define, so it is left exactly as today.
            Selector::Class(_) if *amount != (Amount::All { except: 0 }) => Vec::new(),
            Selector::Class(name)
                if name.eq_ignore_ascii_case("MAN") || name.eq_ignore_ascii_case("MEN") =>
            {
                held_items
                    .iter()
                    .filter(|item| {
                        !is_unfinished_ship(item, Some(&self.ruleset))
                            && self.ruleset.is_man(&item.tag)
                    })
                    .filter(|item| !is_unfinished_ship(item, Some(&self.ruleset)))
                    .map(|item| (item.name.clone(), item.tag.clone(), item.amount))
                    .collect()
            }
            Selector::Class(name)
                if name.eq_ignore_ascii_case("ITEM") || name.eq_ignore_ascii_case("ITEMS") =>
            {
                held_items
                    .iter()
                    .filter(|item| !is_unfinished_ship(item, Some(&self.ruleset)))
                    .map(|item| (item.name.clone(), item.tag.clone(), item.amount))
                    .collect()
            }
            Selector::Class(name) => match self.ruleset.class_members(name) {
                Some(tags) => held_items
                    .iter()
                    .filter(|item| {
                        !is_unfinished_ship(item, Some(&self.ruleset))
                            && tags.iter().any(|tag| tag == &item.tag)
                    })
                    .map(|item| (item.name.clone(), item.tag.clone(), item.amount))
                    .collect(),
                None => Vec::new(),
            },
            Selector::WholeUnit => Vec::new(),
        };

        moving
            .into_iter()
            .filter(|(_, tag, _)| {
                // Only what definitely moves. A tag the rules refuse and a tag whose permission the
                // report cannot establish both stay with the giver - the second is admitted through
                // the ledger's `uncounted`, which the preview renders as `+ ?` (`ah-66yi`).
                matches!(
                    super::targets::give_outcome(reach, tag, Some(&self.ruleset)),
                    super::targets::GiveOutcome::Moves
                )
            })
            .collect()
    }
}

/// Puts every unit's headcount back in step with the items it will actually hold.
///
/// `men` is derived from the item list (`composition::men_in`), so any pass that moves items has to
/// re-derive it or the two drift apart - which is what `TAKE FROM 1234 10 HUMN` did before this
/// function existed, leaving a row reading `20 HUMN` in ITEMS and `10` in MEN.
///
/// Men that arrived by a route the walk did not see were bought. `rules/economy_recruiting`: "New
/// recruits will not have any skills or items" - so they merge in at zero and dilute the unit's
/// skills exactly as gifted men do, by the same rule in `rules/give`.
fn settle_headcounts(units: &mut [WorkingUnit], ruleset: &crate::movement::rules::Ruleset) {
    for working in units {
        // A headcount the report itself could only estimate stays exactly as the parser left it:
        // re-deriving from a list the catalogue cannot fully read is the guess `classify_unit`
        // refuses to make (`composition.rs:56-63`), under another name.
        if working.unit.men_estimated {
            continue;
        }
        let before = working.unit.men;
        let (by_race, total) = composition::men_in(&working.unit.items, ruleset);
        let recruited = if working.recruited.is_empty() {
            // No exact settled recruit to read - either nothing was recruited, or a `BUY ALL`
            // makes the exact figure unknowable and this falls back to the net change in the item
            // list exactly as it did before `UnitItemEffects::recruited` existed.
            if total > before {
                // A man tag credited from a unit this hex does not show (`ah-agbm`'s
                // `taken_unshown`) is not a recruit: its true skills are unknown, not zero,
                // exactly as `apply_gifts_of_men` already marks that unit `Unknowable` rather than
                // guessing. Left out of the merge here, or the checks and the units table would
                // disagree about the same arrival.
                let taken_unknown: i64 = working
                    .taken_unshown
                    .iter()
                    .filter(|taken| ruleset.is_man(&taken.tag))
                    .map(|taken| taken.amount)
                    .sum();
                total - before - taken_unknown
            } else {
                0
            }
        } else {
            // A same-race gift out and recruit back in can leave `total` unchanged even though a
            // recruit arrived (`ah-4a13`) - the exact settled list still dilutes the unit's
            // skills even when the net headcount does not move.
            working.recruited.iter().map(|item| item.amount).sum()
        };
        if recruited > 0 {
            working.unit.skills = merge_skills(&working.unit.skills, before, &[], recruited);
        }
        working.unit.men_by_race = by_race;
        working.unit.men = total;
    }
}

/// The receiving unit's skills once `moved` men arrive from a unit whose own skills are `arriving`.
///
/// Points are per man (`level_for_points`), so the merged figure is the headcount-weighted average:
/// a skill either side lacks contributes zero for its men, which is why arriving men can LOWER a
/// level. Integer division truncates, and the remainder is dropped rather than tracked: the report
/// itself prints only a truncated per-man figure, so there is no exact total to preserve.
///
/// The giver is deliberately absent: dividing evenly among people leaves its points per man
/// unchanged, so a GIVE never alters the giver's own skills.
pub(crate) fn merge_skills(
    into: &[Skill],
    into_men: i64,
    arriving: &[Skill],
    moved: i64,
) -> Vec<Skill> {
    if into_men + moved == 0 {
        return into.to_vec();
    }

    let mut tags: Vec<&str> = into
        .iter()
        .chain(arriving.iter())
        .map(|skill| skill.tag.as_str())
        .collect();
    tags.sort_unstable();
    tags.dedup();

    let mut merged: Vec<Skill> = tags
        .into_iter()
        .filter_map(|tag| {
            let held = into.iter().find(|skill| skill.tag == tag);
            let coming = arriving.iter().find(|skill| skill.tag == tag);
            let held_points = held.map_or(0, |skill| i64::from(skill.points));
            let coming_points = coming.map_or(0, |skill| i64::from(skill.points));
            let points = (into_men * held_points + moved * coming_points) / (into_men + moved);
            if points <= 0 {
                return None;
            }
            let points = points as u32;
            let name = held
                .or(coming)
                .map(|skill| skill.name.clone())
                .unwrap_or_default();
            Some(Skill {
                name,
                tag: tag.to_string(),
                level: level_for_points(points),
                points,
            })
        })
        .collect();

    merged.sort_by(|left, right| left.tag.cmp(&right.tag));
    merged
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
/// The catalogue as well as the holding, through the one resolver every surface uses
/// ([`item_named`]): a player may write `LEADER`, which the catalogue knows and a unit's own
/// `8 leaders [LEAD]` matches neither way round (`ah-vcp8.1`). A tag the catalogue knows but this
/// unit does not hold still answers `None`, exactly as it did before.
fn find_item(
    ruleset: &Ruleset,
    items: &[crate::report::model::ItemAmount],
    text: &str,
) -> Option<usize> {
    let tag = item_named(Some(ruleset), text, || items.iter())?;
    items
        .iter()
        .position(|item| item.tag.eq_ignore_ascii_case(&tag))
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

    /// Like `report_with_market()`, but the market sells people and the unit already has men, a
    /// skill and the silver to spend - for `settle_headcounts`' recruiting cases.
    fn report_with_market_selling_people() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 humans [HUMN] at $38.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 400 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "",
        ]
        .join("\n")
    }

    /// A hex with one own unit of eight men holding iron, for the `PRODUCE` cases.
    /// `report_with_market`'s own unit is a one-man leader, which makes at most one of anything.
    ///
    /// The men must be the *first* item on the line: `count_men` (`report/unit.rs:217`) reads the
    /// headcount off `items.first()`, which is the report's own convention.
    fn report_with_a_smith() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
            "",
        ]
        .join("\n")
    }

    /// [`report_with_a_smith`], with a neighbour to give to - for the cases where a transfer and a
    /// `PRODUCE` are written in the same month (`ah-qct4`).
    ///
    /// A second helper rather than a second unit on the shipped one, because `only_unit` asserts
    /// exactly one unit changed for three tests that already read it. The men stay the *first*
    /// item on each own unit's line, as `count_men` (`report/unit.rs:221`) requires.
    fn report_with_a_smith_and_a_neighbour() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    /// Two own units, the giver holding men whose tag, report name and catalogue name are three
    /// different words - `LEAD`, `leaders`, `leader` - which is what makes the spellings diverge.
    ///
    /// The men must be the *first* item on each own unit's line (`count_men`,
    /// `report/unit.rs:221`).
    fn report_with_leaders() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Guards (900), Foo (1), behind, 8 leaders [LEAD], 20 iron [IRON]. Weight: 180. \
             Capacity: 0/0/120/0.",
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    /// Two regions joined by an exit, own units in both, and one foreign unit - for the
    /// `TRANSPORT`/`DISTRIBUTE` cases (`ah-bxgs`). `5530` sends; `6857` is a quartermaster that can
    /// receive. `7001` is a foreign unit visible in `6857`'s hex, present so a transport aimed at a
    /// unit we can see but do not own has a subject.
    ///
    /// The men must be the *first* item on each own unit's line (`count_men`,
    /// `report/unit.rs:217`).
    fn report_across_two_hexes() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  Wanted: 100 stone [STON] at $10.",
            "",
            "Exits:",
            "  Southeast : mountain (2,2) in Nowhere.",
            "",
            "* Sender (5530), Foo (1), 6 orcs [ORC], 40 stone [STON], 2 horses [HORS], \
             5 fur [FUR]. Weight: 300. Capacity: 0/0/90/0.",
            "",
            "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
            "",
            "Exits:",
            "  Northwest : plain (1,1) in Nowhere.",
            "",
            "* Quartermaster (6857), Foo (1), leader [LEAD], 15 stone [STON]. Weight: 10. \
             Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 1 (30).",
            "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    fn two_hex_preview(orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report_across_two_hexes(),
            "[]",
            orders,
        )
        .expect("the ruleset loads")
    }

    /// A mage holding swords to enchant, for the `CAST` cases (`ah-ofpb.5`).
    fn report_with_a_mage() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Enchanter (900), Foo (1), behind, leader [LEAD], 20 swords [SWOR]. Weight: 220. \
             Capacity: 0/0/15/0. Skills: enchant swords [ESWO] 3 (270).",
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
        let response = preview("unit 900\nENTER 4\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n");

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

    // --- trailing text after a completed order is ignored, matching the engine (ah-86vk) ------
    //
    // The validator used to invent an "extra-arguments" error once a form's own arguments were
    // consumed, and this walker mirrored that by treating the whole order as unreadable. Neither
    // matches the engine, which simply stops reading once a form is satisfied - so both now read
    // through `grammar::consumed_arguments`, and an order the validator accepts previews the same
    // thing it did without the trailing text. The malformed-argument controls beside them are
    // unaffected: a form the grammar cannot complete at all still previews nothing.

    #[test]
    fn a_give_with_a_trailing_token_still_moves_the_stock() {
        // `[unit] [amount] [item]` is complete after three tokens; `junk` is trailing text the
        // engine never reads.
        let response = preview("unit 900\nGIVE 901 1 SWOR junk\n");
        let giver = response.regions[0]
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
            2
        );
    }

    #[test]
    fn an_except_without_all_is_ignored_as_trailing_text() {
        // EXCEPT belongs to the ALL form alone, so `[unit] [amount] [item]` is still the form
        // that matches here; `EXCEPT 1` is trailing text the engine drops, not a reserve.
        let response = preview("unit 900\nGIVE 901 2 SWOR EXCEPT 1\n");
        let receiver = response.regions[0]
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
            2
        );
    }

    /// The lexer calls a token a number only when it is all digits, so `-1` is a word. `ALL SWOR
    /// EXCEPT` reaches one token farther than the plain `[unit] [amount] [item]` form before
    /// finding no reserve there, so that farther failure still wins over the shorter form's
    /// trailing-text reading - the order stays unreadable rather than giving everything away.
    #[test]
    fn a_negative_reserve_is_unreadable_rather_than_giving_everything() {
        let response = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT -1\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn a_flag_order_with_a_trailing_token_still_sets_the_flag() {
        let response = preview("unit 900\nGUARD 1 junk\n");
        assert!(only_unit(&response).unit.on_guard);
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
        let response = preview(
            "unit 900\nFORM 1\nENDFORM\nNAME UNIT \"Formed\"\nunit 900\nGIVE NEW 1 1 LEAD\n",
        );

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
    ///
    /// `ITEM`/`ITEMS` and `MAN`/`MEN` are resolved by `ah-dxfd.1` and no longer land here - see
    /// `a_gift_of_all_men_moves_every_race` and `a_gift_of_all_items_moves_the_swords_too` below.
    /// A class the catalogue still cannot classify, `MAGIC` - the data page never states its
    /// members, and neither `ADVANCED` nor `SPECIAL` fare any better - still turns away exactly as
    /// every class once did, which is what proves the change is narrow.
    #[test]
    fn giving_a_class_this_walk_cannot_resolve_still_moves_nothing() {
        let response = preview("unit 900\nGIVE 901 ALL MAGIC\n");
        let unit = only_unit(&response);
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "a class the preview cannot classify must move nothing: {:?}",
            unit.changes
        );
        assert_eq!(unit.uncounted, vec!["GIVE 901 ALL MAGIC".to_string()]);

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

    /// `classify_unit`'s own filter, run over a GIVE: every race the giver holds moves, and its
    /// equipment stays behind.
    #[test]
    fn a_gift_of_all_men_moves_every_race() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mixed (900), Foo (1), 10 orcs [ORC], 1 leader [LEAD], 3 swords [SWOR]. \
             Weight: 100. Capacity: 0/0/150/0.",
            "* Empty (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL MEN\n",
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

        assert_eq!(giver.unit.men, 0, "every race it holds moved away");
        assert!(
            giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "the giver keeps its three swords: {:?}",
            giver.unit.items
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "ORC")
                .map(|item| item.amount),
            Some(10)
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(2),
            "the receiver's own leader plus the one given"
        );
        assert!(!receiver.unit.items.iter().any(|item| item.tag == "SWOR"));
    }

    /// A mage holding one leader and one sword, with an own unit to give to.
    ///
    /// The men must be the *first* item on each own unit's line (`count_men`,
    /// `report/unit.rs:221`).
    fn report_with_a_mage_and_a_neighbour(skill: &str) -> String {
        [
            "Foo (1) Report".to_string(),
            String::new(),
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
            String::new(),
            format!(
                "* Mage (900), Foo (1), leader [LEAD], sword [SWOR]. Weight: 11. \
                 Capacity: 0/0/15/0. Skills: {skill} 1 (30)."
            ),
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
            String::new(),
        ]
        .join("\n")
    }

    fn preview_for_mage(skill: &str, orders: &str) -> OrdersPreviewResponse {
        preview_over(&report_with_a_mage_and_a_neighbour(skill), orders)
    }

    /// `rules/magic`: "mages may not GIVE men at all". Neither naming the race nor asking for the
    /// whole class moves a Foundation mage's leader, so no row changes at all.
    #[test]
    fn foundation_mages_keep_men_given_by_name_or_class() {
        for orders in [
            "unit 900\nGIVE 901 1 LEAD\n",
            "unit 900\nGIVE 901 ALL MEN\n",
        ] {
            for skill in ["force [FORC]", "pattern [PATT]", "spirit [SPIR]"] {
                let response = preview_for_mage(skill, orders);
                assert!(
                    response.regions.is_empty(),
                    "{skill} / {orders} must move nothing: {:?}",
                    response.regions
                );
            }
            // The control: the same order from the same helper report under a mundane skill does
            // change rows, so an empty `regions` above cannot pass for the wrong reason if the
            // fixture's skill line or the order form should ever stop parsing.
            let mundane = preview_for_mage("lumberjack [LUMB]", orders);
            assert!(
                !mundane.regions.is_empty(),
                "the control: a mundane unit's {orders} does move its leader"
            );
        }
    }

    /// The other side of `ah-t8ei`'s rule, and the position this application takes: a mage's men
    /// may be **taken** from it, even though the mage may not give them.
    ///
    /// `rules/magic` says "mages may not GIVE men at all", and `ah-t8ei` (#877) read that as
    /// binding `GIVE` alone — its own summary says "GIVE UNIT, TAKE, TRANSPORT and DISTRIBUTE are
    /// untouched" — so all three surfaces gate the refusal on the order being a GIVE. Nothing
    /// asserted it until this test: the delta round on `ah-3mwm` found that removing the `is_give`
    /// gate left the whole suite green, so the position was carried only by the code.
    ///
    /// It is worth knowing that `rules/take` says the TAKE order "works just like the GIVE order,
    /// except that the direction of transfer is reversed", which is an argument the other way.
    /// Whether that should extend the prohibition is not `ah-3mwm`'s question — this test pins
    /// what the application does today, so that changing it has to be deliberate.
    #[test]
    fn a_mages_men_may_still_be_taken_from_it() {
        let response = preview_for_mage("force [FORC]", "unit 901\nTAKE FROM 900 1 LEAD\n");

        let of = |id: &str| {
            response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == id)
                .unwrap_or_else(|| panic!("unit {id} is previewed"))
        };

        let taker = of("901");
        assert_eq!(
            taker
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(1),
            "the leader reaches the taker"
        );
        assert_eq!(taker.unit.men, 2, "its own orc, and the leader it took");

        let mage = of("900");
        assert!(
            !mage.unit.items.iter().any(|item| item.tag == "LEAD"),
            "and leaves the mage: {:?}",
            mage.unit.items
        );
        assert_eq!(mage.unit.men, 0);
    }

    /// `GIVE 0` bypasses the catalogue's own un-giveable restrictions, because a discard is not a
    /// transfer to another unit - but `rules/magic` refuses the mage's men whatever the target.
    #[test]
    fn a_mage_cannot_discard_men() {
        let orders = "unit 900\nGIVE 0 1 LEAD\n";
        let response = preview_for_mage("force [FORC]", orders);
        assert!(
            response.regions.is_empty(),
            "a mage may not discard its men either: {:?}",
            response.regions
        );

        // The control, for the same reason as the test above: the discard itself works.
        let mundane = preview_for_mage("lumberjack [LUMB]", orders);
        assert!(
            !mundane.regions.is_empty(),
            "a mundane unit does discard its leader"
        );
    }

    /// The refusal is per tag, not per order: `ALL ITEMS` still hands over the equipment the mage
    /// may give while its men stay behind.
    #[test]
    fn a_mage_giving_all_items_keeps_men_and_moves_equipment() {
        let response = preview_for_mage("force [FORC]", "unit 900\nGIVE 901 ALL ITEMS\n");
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

        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(1),
            "the mage keeps its leader: {:?}",
            giver.unit.items
        );
        assert_eq!(giver.unit.men, 1, "and keeps the headcount that leader is");
        assert!(
            !giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "the sword is equipment and still moves: {:?}",
            giver.unit.items
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(1)
        );
        assert!(
            !receiver.unit.items.iter().any(|item| item.tag == "LEAD"),
            "and no leader arrives: {:?}",
            receiver.unit.items
        );
    }

    /// `rules/magic`'s own exception: "The mage may be given to another faction using the GIVE UNIT
    /// order." That is ownership rather than item movement, and the preview leaves it unmodelled
    /// exactly as it does for any other unit (`effects.rs:1294`) - the new refusal must not turn it
    /// into a refused man-item transfer.
    #[test]
    fn give_unit_remains_a_whole_unit_order_for_a_mage() {
        let response = preview_for_mage("force [FORC]", "unit 900\nGIVE 901 UNIT\n");
        let region = &response.regions[0];
        assert_eq!(region.units.len(), 1, "only the giver's row is annotated");
        let unit = &region.units[0];
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "handing over the unit itself moves no items: {:?}",
            unit.changes
        );
        assert_eq!(unit.unit.men, 1, "and no headcount changes");
        assert_eq!(unit.uncounted, vec!["GIVE 901 UNIT".to_string()]);
    }

    /// `ah-3sp7.1` taught the catalogue `MOUNT`'s five tags, so `tags_moved` can now resolve a
    /// class beyond `MAN`/`MEN` and `ITEM`/`ITEMS`: the horses move, the swords - not a mount -
    /// stay behind, and nothing about the gift is left unresolved.
    #[test]
    fn a_gift_of_all_mounts_moves_the_horses() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 4 horses [HORS], 3 swords [SWOR]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL MOUNTS\n",
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

        assert!(!giver.unit.items.iter().any(|item| item.tag == "HORS"));
        assert!(
            giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "the giver keeps its swords: {:?}",
            giver.unit.items
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HORS")
                .map(|item| item.amount),
            Some(4)
        );
        assert!(giver.uncounted.is_empty());
    }

    /// 51 monsters and the imprisoned entity carry `This item cannot be given to other units.`, so
    /// `ALL MONSTERS` selects sixty items and moves the one that may change hands.
    #[test]
    fn a_gift_of_all_monsters_leaves_the_lions_behind() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 20 lions [LION], 1 skeleton [SKEL]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL MONSTERS\n",
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

        assert!(
            giver.unit.items.iter().any(|item| item.tag == "LION"),
            "the lions cannot be given away and stay put: {:?}",
            giver.unit.items
        );
        assert!(!giver.unit.items.iter().any(|item| item.tag == "SKEL"));
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SKEL")
                .map(|item| item.amount),
            Some(1)
        );
        assert!(!receiver.unit.items.iter().any(|item| item.tag == "LION"));
    }

    /// The same refusal applies to a named-item gift, not only the class form: `GIVE 901 20 LION`
    /// moves nothing.
    #[test]
    fn a_named_gift_of_lions_moves_nothing() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 20 lions [LION]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 20 LION\n",
        )
        .expect("the ruleset loads");

        assert!(
            response.regions.is_empty(),
            "nothing moves, so no row changes: {:?}",
            response.regions
        );
    }

    /// `GIVE 0` discards rather than gives, and unit 0 is not "another unit" - the refusal that
    /// keeps the lions with a live receiver does not apply to a discard (epic decision 9).
    #[test]
    fn a_discard_of_all_monsters_takes_the_lions_too() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 20 lions [LION], 1 skeleton [SKEL]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 0 ALL MONSTERS\n",
        )
        .expect("the ruleset loads");

        let giver = only_unit(&response);
        assert!(
            !giver.unit.items.iter().any(|item| item.tag == "LION"),
            "a discard destroys the lions too: {:?}",
            giver.unit.items
        );
        assert!(!giver.unit.items.iter().any(|item| item.tag == "SKEL"));
    }

    /// `rules/give`: `ITEM`/`ITEMS` is "the combination of all of the previous categories" -
    /// everything the unit holds, silver included, so the giver ends up with nothing.
    #[test]
    fn a_gift_of_all_items_moves_the_swords_too() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mixed (900), Foo (1), 10 orcs [ORC], 1 leader [LEAD], 3 swords [SWOR]. \
             Weight: 100. Capacity: 0/0/150/0.",
            "* Empty (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL ITEMS\n",
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

        assert!(
            giver.unit.items.is_empty(),
            "the giver ends up holding nothing: {:?}",
            giver.unit.items
        );
        assert_eq!(giver.unit.men, 0);
        assert!(receiver.unit.items.iter().any(|item| item.tag == "SWOR"));
        assert!(receiver.unit.items.iter().any(|item| item.tag == "ORC"));
    }

    /// A gift to another faction's new unit is decided without any closure: the game really
    /// creates that unit in this hex, so it is not "named nowhere" however little the report can
    /// say about it - and it is another faction's, so `rules/give` wants a declaration no report
    /// carries. The swords' count stands and the order is admitted (`ah-66yi`).
    #[test]
    fn giving_to_another_factions_new_unit_leaves_the_goods_uncertain() {
        let response = preview("unit 900\nGIVE FACTION 14 NEW 2 1 SWOR\n");
        let giver = only_unit(&response);
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(3),
            "the report's own count stands"
        );
        assert_eq!(
            giver.uncounted,
            vec!["GIVE FACTION 14 NEW 2 1 SWOR".to_string()]
        );

        // The control: our own new unit, same order shape. Without it this test would pass just as
        // well against a reader that had stopped understanding `NEW` at all - and the arm it
        // guards is the dangerous one, since a foreign target read as a zero would destroy the
        // swords rather than merely fail to move them.
        let ours = preview("unit 900\nFORM 2\nEND\nGIVE NEW 2 1 SWOR\nGIVE NEW 2 1 LEAD\n");
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
            "unit 900\nFORM 1\nNAME UNIT \"First\"\nEND\nFORM 1\nNAME UNIT \"Second\"\nEND\nGIVE NEW 1 1 LEAD\n",
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
            "unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\nunit 902\nGIVE NEW 1 2 SWOR\n",
        )
        .expect("the ruleset loads");

        let formed = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("the formed unit");
        assert!(
            !formed.unit.items.iter().any(|item| item.tag == "SWOR"),
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

    /// Trailing text the grammar now ignores (`ah-86vk`) still applies ENTER and LEAVE; a
    /// genuinely malformed target still moves nobody, exactly as `read_only_number` already
    /// read it for `orders::intents`.
    #[test]
    fn accepted_trailing_text_still_boards_and_leaves() {
        let entered = preview("unit 900\nENTER 4 note\n");
        assert_eq!(only_unit(&entered).unit.structure_id.as_deref(), Some("4"));

        // A unit already inside a structure, so a LEAVE has something to undo - unlike the
        // control above, where the unit starts ashore and a no-op LEAVE previews nothing.
        let boarded_report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "+ Tower [4] : Tower.",
            "  * Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let left = preview_over(&boarded_report, "unit 900\nLEAVE note\n");
        assert_eq!(only_unit(&left).unit.structure_id, None);
    }

    #[test]
    fn a_malformed_enter_target_moves_nobody() {
        assert!(preview("unit 900\nENTER shed\n").regions.is_empty());
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
        let response =
            preview("unit 900\nFORM 1\nNAME UNIT \"Recruits\"\nBEHIND 1\nEND\nGIVE NEW 1 1 LEAD\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.status == UnitPreviewStatus::Formed)
            .expect("a formed unit");
        assert_eq!(formed.unit.unit_id, "new-1");
        assert_eq!(formed.unit.name, "Recruits");
        assert!(formed.unit.own);
        assert!(formed.unit.flags.iter().any(|flag| flag == "behind"));
        assert_eq!(
            formed.unit.men, 1,
            "the leader transferred to it, which is what keeps it from dissolving"
        );
    }

    /// A formed unit's own `BUY` has to reach the preview before dissolution can be decided, or
    /// every unit created through the documented `rules/form` recruitment idiom would be removed
    /// (`rules/form`: "If a new unit gains at least one recruit, the unit will form possessing any
    /// unused silver and all the other items it was given").
    #[test]
    fn formed_market_purchases_are_projected_before_dissolution() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 100 silver\n",
        );

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the formed unit survives its successful recruitment");
        assert_eq!(formed.status, UnitPreviewStatus::Formed);
        assert_eq!(formed.unit.men, 1, "the recruit was bought");
        assert_eq!(
            formed
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HUMN")
                .map_or(0, |item| item.amount),
            1
        );
        assert_eq!(
            formed
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SILV")
                .map_or(0, |item| item.amount),
            100,
            "the silver it was given stays with it, as the ITEMS column shows silver for every \
             other unit that BUYs - the spend belongs to the SILVER column"
        );
    }

    /// `rules/form`: "If the demand for recruits in that region that month is much higher than
    /// the supply, ... it may not gain any recruits at all. ... If no recruits are gained at all,
    /// the empty unit will be dissolved, and the silver and any other items it was given will
    /// revert to the first unit you have in that region." The first unit is the first the *report*
    /// shows, not the one that formed it - so the market here has nobody left to sell.
    #[test]
    fn an_empty_formed_unit_returns_its_goods_to_the_first_own_unit() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 10 silver [SILV]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 1 10 SILV\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            !units.iter().any(|unit| unit.unit.unit_id == "new-1"),
            "the empty formed unit is dissolved: {:?}",
            units
                .iter()
                .map(|unit| &unit.unit.unit_id)
                .collect::<Vec<_>>()
        );

        let amount = |id: &str, tag: &str| {
            units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == tag))
                .map_or(0, |item| item.amount)
        };
        assert_eq!(amount("900", "SWOR"), 3, "the first own unit receives them");
        assert_eq!(amount("900", "SILV"), 10);
        assert_eq!(amount("901", "SWOR"), 0, "the bystander receives nothing");
        assert_eq!(amount("901", "SILV"), 0);
        assert_eq!(amount("902", "SWOR"), 0, "the former gave them away");
        assert_eq!(amount("902", "SILV"), 0);
    }

    /// `rules/form` reverts "the silver and any other items it **was given**". A unit that
    /// dissolves never existed to trade, so what its own `BUY` bought is not a windfall for the
    /// unit it reverts to.
    #[test]
    fn a_dissolved_units_purchases_are_not_handed_on() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 grain [GRAI] at $10.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 5 grain\nEND\nGIVE NEW 1 100 SILV\n",
        );

        let receiver = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the first own unit receives what was given");
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SILV")
                .map_or(0, |item| item.amount),
            100,
            "the silver it was given reverts in full"
        );
        assert!(
            !receiver.unit.items.iter().any(|item| item.tag == "GRAI"),
            "nobody ordered grain for this unit: {:?}",
            receiver.unit.items
        );
    }

    /// A dissolved unit's queued `TRANSPORT` is dropped: what its own month bought must not reach
    /// a recipient by the one path the revert itself does not cover.
    #[test]
    fn a_dissolved_unit_sends_no_transport() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 grain [GRAI] at $10.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 5 grain\nTRANSPORT 900 5 GRAI\nEND\nGIVE NEW 1 100 SILV\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            !units.iter().any(|unit| unit.unit.unit_id == "new-1"),
            "the empty formed unit dissolves"
        );
        let receiver = units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the first own unit is previewed, having received the silver");
        assert!(
            receiver.transport_received.is_empty(),
            "nothing arrives from a unit that never existed: {:?}",
            receiver.transport_received
        );
        assert!(
            !receiver.unit.items.iter().any(|item| item.tag == "GRAI"),
            "and no grain with it: {:?}",
            receiver.unit.items
        );
    }

    /// A formed unit's `BUY` competes for the same limited stock as the report's own units
    /// (`rules/buy`), which is what wiring `formed_units` into `item_effects` puts back.
    #[test]
    fn a_formed_units_buy_competes_for_a_scarce_market() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 2 humans [HUMN] at $38.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 400 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0.",
            "",
        ]
        .join("\n");
        let alone = preview_over(&report, "unit 900\nBUY 2 HUMN\n");
        let bought_alone = alone.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == "HUMN"))
            .map_or(0, |item| item.amount);
        assert_eq!(bought_alone, 12, "the whole offer, with nobody to share it");

        let shared = preview_over(
            &report,
            "unit 900\nBUY 2 HUMN\nFORM 1\nBUY 2 HUMN\nEND\nGIVE NEW 1 100 SILV\n",
        );
        let bought_shared = shared.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == "HUMN"))
            .map_or(0, |item| item.amount);
        assert_eq!(
            bought_shared, 11,
            "one of the two on offer goes to the formed unit"
        );
    }

    /// What a dissolving unit `TAKE`s from a unit the report shows is not handed on either - only
    /// what it was given is. The source keeps the shortfall its own projected `TAKE` left it,
    /// which is the pre-existing behaviour of that row and not dissolution's to unwind.
    #[test]
    fn a_dissolved_units_take_is_not_handed_on() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 5 stone [STON], 2 swords [SWOR]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nTAKE FROM 902 4 STON\nEND\nGIVE NEW 1 2 SWOR\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            !units.iter().any(|unit| unit.unit.unit_id == "new-1"),
            "the empty formed unit dissolves"
        );
        let held = |id: &str, tag: &str| {
            units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == tag))
                .map_or(0, |item| item.amount)
        };
        assert_eq!(held("900", "SWOR"), 2, "the gift reverts");
        assert_eq!(
            held("900", "STON"),
            0,
            "what the dissolving unit took is not a windfall for the recipient"
        );
    }

    /// Two empty formed units in one region: both dissolve, and both revert to the same first own
    /// unit - a dissolving row can never be another's recipient, because a recipient is always a
    /// unit the report shows.
    #[test]
    fn two_empty_forms_in_one_region_both_revert_to_the_first_unit() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 4 stone [STON]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nEND\nFORM 2\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 2 4 STON\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            !units
                .iter()
                .any(|unit| unit.unit.unit_id.starts_with("new-")),
            "both dissolve: {:?}",
            units
                .iter()
                .map(|unit| &unit.unit.unit_id)
                .collect::<Vec<_>>()
        );
        let receiver = units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the first own unit receives both lots");
        let held = |tag: &str| {
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map_or(0, |item| item.amount)
        };
        assert_eq!(held("SWOR"), 3);
        assert_eq!(held("STON"), 4);
    }

    /// The recipient search is region-scoped: two regions, each forming an empty unit, must revert
    /// to their own first unit and not to the other region's.
    #[test]
    fn each_region_reverts_to_its_own_first_unit() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* North (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* NorthFormer (901), Foo (1), leader [LEAD], 3 swords [SWOR]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
            "plain (3,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* South (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* SouthFormer (903), Foo (1), leader [LEAD], 4 stone [STON]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 901\nFORM 1\nEND\nGIVE NEW 1 3 SWOR\nunit 903\nFORM 1\nEND\nGIVE NEW 1 4 STON\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            !units
                .iter()
                .any(|unit| unit.unit.unit_id.starts_with("new-")),
            "both empty formed units dissolve: {:?}",
            units
                .iter()
                .map(|unit| &unit.unit.unit_id)
                .collect::<Vec<_>>()
        );
        let held = |id: &str, tag: &str| {
            units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == tag))
                .map_or(0, |item| item.amount)
        };
        assert_eq!(held("900", "SWOR"), 3, "its own region's goods come back");
        assert_eq!(held("900", "STON"), 0, "and the other region's do not");
        assert_eq!(held("902", "STON"), 4);
        assert_eq!(held("902", "SWOR"), 0);
    }

    /// The rule's condition is the resulting headcount, not whether a `BUY` was written: people
    /// handed over by `GIVE` keep the provisional unit alive.
    #[test]
    fn people_given_to_a_formed_unit_keep_it_alive() {
        let response = preview("unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("a formed unit holding people survives");
        assert_eq!(formed.status, UnitPreviewStatus::Formed);
        assert_eq!(formed.unit.men, 1);
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
    fn given_men_bring_their_skills_and_the_giver_is_untouched() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "* Students (2200), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 1 (30).",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 1234\nGIVE 2200 5 HUMN\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "1234")
            .expect("the giver changed (men and items moved)");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "2200")
            .expect("the receiver changed");

        // Receiver: 10 men at (30) merge with 5 arriving at (180) -> (80), level 2.
        assert_eq!(
            receiver.unit.skills,
            vec![lumberjack(80)],
            "{:?}",
            receiver.unit.skills
        );
        assert_eq!(change(receiver, "skills").original, "LUMB 1 (30)");

        // The giver's own skills are untouched by giving men away.
        assert_eq!(giver.unit.skills, vec![lumberjack(180)]);
        assert!(
            giver.changes.iter().all(|change| change.field != "skills"),
            "the giver's skills must not be marked changed: {:?}",
            giver.changes
        );
    }

    /// `rules/take`: "works just like the GIVE order, except that the direction of transfer is
    /// reversed" - so a TAKE has to move the headcount and merge skills exactly as a GIVE does,
    /// even though the item movement itself belongs to the ledger (`ah-agbm`) rather than here.
    #[test]
    fn a_take_of_men_moves_the_headcount_and_merges_their_skills() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: lumberjack [LUMB] 3 (180).",
            "* Students (2200), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: lumberjack [LUMB] 1 (30).",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 2200\nTAKE FROM 1234 5 ORC\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let source = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "1234")
            .expect("the source changed");
        let taker = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "2200")
            .expect("the taker changed");

        assert_eq!(taker.unit.men, 15, "10 already there plus 5 taken");
        assert_eq!(source.unit.men, 5, "10 less the 5 taken");
        // Taker: 10 men at (30) merge with 5 arriving at (180) -> (80), level 1.
        assert_eq!(
            taker.unit.skills,
            vec![lumberjack(80)],
            "{:?}",
            taker.unit.skills
        );
        // The source's own skills are untouched by losing men.
        assert_eq!(source.unit.skills, vec![lumberjack(180)]);
    }

    /// A `TAKE FROM` a unit this hex does not show still credits the item optimistically
    /// (`ah-agbm`'s `taken_unshown` path), but the arriving men's true skills are unknown, not
    /// zero - the checks side (`apply_gifts_of_men`) already marks a unit taking from an unshown
    /// source `Unknowable` rather than guessing, and `settle_headcounts` must not quietly guess
    /// zero either by treating the arrival as a bought recruit.
    #[test]
    fn men_taken_from_an_unshown_source_do_not_dilute_the_takers_skills() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: lumberjack [LUMB] 3 (180).",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 1234\nTAKE FROM 999 5 HUMN\n",
        )
        .expect("the ruleset loads");

        let unit = only_unit(&response);
        assert_eq!(
            unit.unit.men, 15,
            "the item still arrives optimistically, per `ah-agbm`"
        );
        assert_eq!(
            unit.unit.skills,
            vec![lumberjack(180)],
            "arriving from an unshown source must not be assumed skill-less: {:?}",
            unit.unit.skills
        );
    }

    /// `rules/economy_recruiting`: "New recruits will not have any skills or items" - so a `BUY`
    /// of people has to reach the headcount and dilute the unit's skills exactly as a gift of men
    /// does, even though `BUY` never touches `Working::give` at all.
    #[test]
    fn bought_men_join_the_unit_and_bring_no_skills() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nBUY 5 HUMN\n",
        );
        let unit = only_unit(&response);

        assert_eq!(unit.unit.men, 15, "10 already there plus 5 bought");
        // (10 * 180 + 5 * 0) / 15 = 120, level 2.
        assert_eq!(
            unit.unit.skills,
            vec![lumberjack(120)],
            "{:?}",
            unit.unit.skills
        );
        assert_eq!(change(unit, "men").original, "10");
    }

    #[test]
    fn the_skills_merge_weighs_by_the_receivers_headcount_before_the_men_arrive() {
        // Giver: 3 men at (30). Receiver: 7 men with no skill at all.
        // Correct: (7 * 0 + 3 * 30) / (7 + 3) = 9. Weighing by the receiver's headcount AFTER the
        // 3 men already arrived - the bug this test guards against - gives
        // (10 * 0 + 3 * 30) / (10 + 3) = 6 instead: a different, wrong, number.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 3 humans [HUMN]. Weight: 30. Capacity: 0/0/45/0. Skills: lumberjack [LUMB] 1 (30).",
            "* Students (2200), Foo (1), 7 humans [HUMN]. Weight: 70. Capacity: 0/0/105/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 1234\nGIVE 2200 3 HUMN\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "2200")
            .expect("the receiver changed");

        assert_eq!(receiver.unit.skills, vec![lumberjack(9)]);
    }

    fn skill(tag: &str, points: u32) -> Skill {
        Skill {
            name: tag.to_lowercase(),
            tag: tag.to_string(),
            level: level_for_points(points),
            points,
        }
    }

    /// `lumberjack [LUMB] n (points)`, as a real report line parses it - `name` is the spelled-out
    /// word, not the tag lower-cased, which matters when a test's expected `Skill` is compared
    /// against one actually read from report text.
    fn lumberjack(points: u32) -> Skill {
        Skill {
            name: "lumberjack".to_string(),
            tag: "LUMB".to_string(),
            level: level_for_points(points),
            points,
        }
    }

    #[test]
    fn men_arriving_at_an_empty_unit_keep_their_level() {
        let merged = merge_skills(&[], 0, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 30)]);
    }

    /// `semantics.rs`'s checks read this through its full crate path, so it must be `pub(crate)`
    /// rather than private to this module — ah-z73s.2.
    #[test]
    fn merge_skills_is_reachable_from_the_checks() {
        let merged = crate::orders::effects::merge_skills(&[], 0, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 30)]);
        assert_eq!(merged[0].level, 1);
    }

    #[test]
    fn arriving_men_who_know_less_lower_the_level() {
        let merged = merge_skills(&[skill("LUMB", 180)], 5, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 105)]);
        assert_eq!(merged[0].level, 2);
    }

    #[test]
    fn a_skill_only_the_arrivals_have_is_diluted_across_everyone() {
        let merged = merge_skills(&[], 25, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 5)]);
        assert_eq!(merged[0].level, 0);
    }

    #[test]
    fn a_skill_worth_no_points_after_the_merge_is_dropped() {
        let merged = merge_skills(&[], 999, &[skill("LUMB", 30)], 1);

        assert!(merged.is_empty(), "{:?}", merged);
    }

    #[test]
    fn the_result_is_ordered_by_tag() {
        let merged = merge_skills(
            &[skill("STEA", 30), skill("LUMB", 30)],
            5,
            &[skill("FORC", 30)],
            5,
        );

        assert_eq!(
            merged
                .iter()
                .map(|skill| skill.tag.clone())
                .collect::<Vec<_>>(),
            vec!["FORC", "LUMB", "STEA"]
        );
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

        let formed = preview("unit 900\nFORM 1\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 1 1 LEAD\n");
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

    /// `7001` is another faction's unit standing in `6857`'s own hex. `rules/give` allows the gift
    /// once *their* faction has declared us Friendly, and the report carries only our declarations
    /// toward them - so the stone neither definitely leaves nor definitely stays, and the column
    /// keeps the report's count and admits the order instead (`ah-66yi`, which reversed
    /// `ah-vcp8.2`'s answer here).
    #[test]
    fn a_gift_to_a_visible_foreign_unit_leaves_the_goods_uncertain() {
        let response = two_hex_preview("unit 6857\nGIVE 7001 10 STON\n");
        let giver = row(&response, "1:2,2", "6857").expect("the giver's row is previewed");

        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount),
            Some(15),
            "the report's own count stands: nothing is known to have left"
        );
        assert_eq!(giver.uncounted, vec!["GIVE 7001 10 STON".to_string()]);
        assert!(
            row(&response, "1:2,2", "7001").is_none(),
            "no row of ours gains them either"
        );
    }

    /// The same target, and silver: `rules/give` exempts silver from the factional rule outright
    /// ("silver may be given to any unit, regardless of factional affiliation"), so a target we can
    /// see takes it definitely and nothing is admitted (`ah-66yi`).
    #[test]
    fn visible_foreign_silver_still_leaves_definitely() {
        let report = [
            "Foo (1) Report",
            "",
            "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
            "",
            "* Quartermaster (6857), Foo (1), leader [LEAD], 15 stone [STON], 20 silver [SILV], \
             unfinished Cog [COG] (needs 15), \
             Weight: 10. Capacity: 0/0/15/0.",
            "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(&report, "unit 6857\nGIVE 7001 20 SILV\n");
        let giver = only_unit(&response);

        assert!(
            !giver
                .unit
                .items
                .iter()
                .any(|item| item.tag == "SILV" && item.amount > 0),
            "the five silver left: {:?}",
            giver.unit.items
        );
        assert!(giver.uncounted.is_empty(), "{:?}", giver.uncounted);
    }

    /// A unit number the *whole report* never prints. `rules/give` lets a unit we cannot see
    /// receive a gift once its faction has declared us Friendly, so this may be a perfectly good
    /// order - the count stands and the order is admitted rather than silently doing nothing
    /// (`ah-66yi`).
    #[test]
    fn an_unshown_number_is_not_a_definite_missing_target() {
        let response = two_hex_preview("unit 6857\nGIVE 9999 10 STON\n");
        let giver = row(&response, "1:2,2", "6857").expect("the giver's row is previewed");

        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount),
            Some(15)
        );
        assert_eq!(giver.uncounted, vec!["GIVE 9999 10 STON".to_string()]);
    }

    /// The control that keeps the case above narrow: `5530` is a unit our own report shows, in the
    /// *other* hex. Gifts settle in phase 4 and nothing moves until phase 9
    /// (`rules/sequenceofevents`), so that target really is not here - today's definite no-op, and
    /// an unchanged row is dropped from the response entirely.
    #[test]
    fn a_gift_to_a_unit_the_report_shows_elsewhere_moves_nothing() {
        let response = two_hex_preview("unit 6857\nGIVE 5530 10 STON\n");

        assert!(row(&response, "1:2,2", "6857").is_none());
    }

    /// `ALL ITEMS` across the same visible foreign target: `rules/give` settles the silver and
    /// cannot settle the stone, so the known half moves and the rest keeps its count with the
    /// order admitted once (`ah-66yi`).
    #[test]
    fn a_mixed_gift_moves_the_silver_and_leaves_the_rest_uncertain() {
        let report = [
            "Foo (1) Report",
            "",
            "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
            "",
            "* Quartermaster (6857), Foo (1), leader [LEAD], 15 stone [STON], 20 silver [SILV]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(&report, "unit 6857\nGIVE 7001 ALL ITEMS\n");
        let giver = only_unit(&response);

        assert!(
            !giver
                .unit
                .items
                .iter()
                .any(|item| item.tag == "SILV" && item.amount > 0),
            "the silver is definite and goes: {:?}",
            giver.unit.items
        );
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount),
            Some(15),
            "the stone's permission is unresolved, so its count stands"
        );
        assert_eq!(
            giver.uncounted,
            vec!["GIVE 7001 ALL ITEMS".to_string()],
            "one order, one line in the hover, however many tags it named"
        );
    }

    #[test]
    fn give_beyond_the_hex_or_the_stock_changes_nothing_wrong() {
        // Unit 555 is nowhere in the report at all, so `rules/give` may or may not let the sword
        // through - the count stands and the order is admitted rather than vanishing (`ah-66yi`).
        let missing = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report(),
            "[]",
            "unit 900\nGIVE 555 1 SWOR\n",
        )
        .expect("the ruleset loads");
        let giver = only_unit(&missing);
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(3)
        );
        assert_eq!(giver.uncounted, vec!["GIVE 555 1 SWOR".to_string()]);

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
            "name",
            "guard",
            "avoid",
            "behind",
            "enter",
            "leave",
            "form",
            "give",
            "turn",
            "endturn",
            "transport",
            "distribute",
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

        // `report_with_market()`'s hex sells horses, so a `BUY ALL` of them is settled rather
        // than uncounted since `ah-jown` - these two now name a good the market does not carry
        // (`SWOR`, not on its `For Sale` line) to stay examples of an order that really cannot
        // be counted at all.
        #[test]
        fn an_uncounted_order_reaches_the_preview_verbatim() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nbuy all SWOR ; testing\nSELL 1 FUR\n",
            );
            let unit = only_unit(&response);

            assert_eq!(unit.uncounted, vec!["buy all SWOR".to_string()]);
        }

        /// The navigator's S1 state: a unit whose only order cannot be counted still reaches the
        /// response, with `changes` empty and `uncounted` naming the order - the filter at the
        /// bottom of `preview_orders_on_map` gains `&& uncounted.is_empty()` for exactly this.
        #[test]
        fn a_unit_whose_only_order_cannot_be_counted_is_still_sent() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY ALL SWOR\n");
            let unit = only_unit(&response);

            assert!(unit.changes.is_empty(), "{:?}", unit.changes);
            assert_eq!(unit.uncounted, vec!["BUY ALL SWOR".to_string()]);
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

        #[test]
        fn a_take_from_a_visible_foreign_unit_changes_no_previewed_items() {
            let response = two_hex_preview("unit 6857\nTAKE FROM 7001 1 LEAD\n");
            assert!(
                response.regions.is_empty(),
                "a refused TAKE must not create an item preview: {response:?}"
            );
        }

        #[test]
        fn a_produced_item_reaches_the_previewed_unit() {
            let response = preview_over(&report_with_a_smith(), "unit 900\nPRODUCE sword\n");
            let unit = only_unit(&response);

            let swords = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .expect("the produced swords are in the previewed list");
            assert_eq!(swords.amount, 8);
            let iron = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "IRON")
                .expect("the remaining iron is in the previewed list");
            assert_eq!(iron.amount, 12);
            change(unit, "items");
        }

        /// `ah-agbm`'s Q4 rule, through the existing `take_item`: a stock a `PRODUCE` consumes
        /// entirely disappears rather than showing zero.
        #[test]
        fn a_consumed_stock_that_empties_disappears_from_the_previewed_list() {
            let hex_region = [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 8 iron [IRON]. Weight: 180. \
                 Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
                "",
            ]
            .join("\n");
            let response = preview_over(&hex_region, "unit 900\nPRODUCE sword\n");
            let unit = only_unit(&response);

            assert!(
                !unit.unit.items.iter().any(|item| item.tag == "IRON"),
                "an emptied stock must not be shown, even as zero: {:?}",
                unit.unit.items
            );
        }

        #[test]
        fn a_produced_item_is_named_on_the_preview() {
            let response = preview_over(&report_with_a_smith(), "unit 900\nPRODUCE sword\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.produced,
                vec![ProducedItem {
                    amount: 8,
                    tag: "SWOR".to_string(),
                }]
            );
        }

        /// A hex whose one own unit stands in an unfinished Stockade, for the `BUILD` cases
        /// (`ah-ofpb.2`).
        ///
        /// The men must be the *first* item on the line: `count_men` reads the headcount off
        /// `items.first()`, which is the report's own convention.
        fn report_with_a_builder() -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "+ Building [4] : Stockade, needs 45.",
                "  * Builders (900), Foo (1), behind, 10 humans [HUMN], 120 wood [WOOD]. Weight: \
                 1300. Capacity: 0/0/120/0. Skills: building [BUIL] 3 (250).",
                "",
            ]
            .join("\n")
        }

        #[test]
        fn a_built_material_leaves_the_previewed_unit() {
            let response = preview_over(&report_with_a_builder(), "unit 900\nBUILD\n");
            let unit = only_unit(&response);

            let wood = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "WOOD")
                .expect("the remaining wood is in the previewed list");
            assert_eq!(wood.amount, 90);
            change(unit, "items");
        }

        #[test]
        fn a_material_spent_to_nothing_disappears_from_the_previewed_list() {
            let hex_region = [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "+ Building [4] : Stockade, needs 45.",
                "  * Builders (900), Foo (1), behind, 10 humans [HUMN], 30 wood [WOOD]. Weight: \
                 1300. Capacity: 0/0/120/0. Skills: building [BUIL] 3 (250).",
                "",
            ]
            .join("\n");
            let response = preview_over(&hex_region, "unit 900\nBUILD\n");
            let unit = only_unit(&response);

            assert!(
                !unit.unit.items.iter().any(|item| item.tag == "WOOD"),
                "an emptied stock must not be shown, even as zero: {:?}",
                unit.unit.items
            );
        }

        #[test]
        fn a_build_is_named_on_the_preview() {
            let response = preview_over(&report_with_a_builder(), "unit 900\nBUILD\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.built,
                vec![BuildSpend {
                    amount: 30,
                    tag: "WOOD".to_string(),
                    name: "wood".to_string(),
                    place: "Building 4".to_string(),
                    founding: false,
                    helping: None,
                    could_do: 30,
                    capped_by: None,
                }]
            );
        }

        #[test]
        fn a_cast_creation_reaches_the_previewed_unit() {
            let response = preview_over(&report_with_a_mage(), "unit 900\nCAST Enchant_Swords\n");
            let unit = only_unit(&response);

            let swords = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "MSWO")
                .expect("the enchanted mithril swords are in the previewed list");
            assert_eq!(
                swords.amount, 15,
                "unit.items carries the most, which is what the ledger charged for"
            );
            assert_eq!(
                unit.created,
                vec![CreatedItem {
                    fewest: 15,
                    most: 15,
                    tag: "MSWO".to_string(),
                    summoned: false,
                }]
            );
            change(unit, "items");
        }
    }

    /// The catalogue calls a leader "leader"; the report calls eight of them "leaders" and tags
    /// them `LEAD`. All three are legal spellings and only this one moved nothing (`ah-vcp8.1`).
    #[test]
    fn a_gift_written_with_the_catalogues_own_name_empties_the_unit() {
        let response = preview_over(&report_with_leaders(), "unit 900\nGIVE 901 ALL LEADER\n");
        let giver = row(&response, "1:1,1", "900").expect("the giver's row is previewed");

        assert_eq!(giver.unit.men, 0, "every leader left this unit");
    }

    /// `ah-qct4`. `rules/sequenceofevents` settles "Give orders. GIVE and TAKE orders are
    /// processed." nine phases before "Primary PRODUCE orders ... are processed", so the men who
    /// work this month and the materials they work with are the ones the month's gifts leave
    /// behind - not the ones the report printed.
    mod production_after_a_gift {
        use super::*;

        fn preview_gift(orders: &str) -> OrdersPreviewResponse {
            preview_over(
                &report_with_a_smith_and_a_neighbour(),
                &format!("unit 900\n{orders}\n"),
            )
        }

        fn giver(response: &OrdersPreviewResponse) -> &UnitPreview {
            row(response, "1:1,1", "900").expect("the giver's row is previewed")
        }

        fn held(unit: &UnitPreview, tag: &str) -> i64 {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map_or(0, |item| item.amount)
        }

        /// The report prints `8 orcs [ORC]`, so `ALL ORCS` is the first thing anyone would type -
        /// and until `item_spellings` folded case it resolved to nothing at all.
        #[test]
        fn an_upper_case_plural_gift_of_men_empties_the_unit() {
            let response = preview_gift("GIVE 901 ALL ORCS");
            let giver = giver(&response);

            assert_eq!(giver.unit.men, 0, "every orc left this unit");
            assert_eq!(held(giver, "ORC"), 0, "no orcs remain in the item list");
        }

        /// `rules/tableiteminfo` pays production in man-months - "The higher the skill of the unit,
        /// the more productive each man-month of work will be" - so a unit with no men left at
        /// PRODUCE time makes nothing, and its materials stay where they are.
        #[test]
        fn a_unit_that_gives_its_men_away_produces_nothing() {
            let response = preview_gift("GIVE 901 ALL MEN\nPRODUCE sword");
            let giver = giver(&response);

            assert!(
                giver.produced.is_empty(),
                "no men, no production: {:?}",
                giver.produced
            );
            assert_eq!(held(giver, "SWOR"), 0, "no phantom swords in the item list");
            assert_eq!(held(giver, "IRON"), 20, "the iron was never spent");
        }

        /// Half the men leave, so half the month's work does.
        #[test]
        fn a_unit_that_gives_half_its_men_away_produces_half() {
            let response = preview_gift("GIVE 901 4 ORC\nPRODUCE sword");

            assert_eq!(
                giver(&response).produced,
                vec![ProducedItem {
                    amount: 4,
                    tag: "SWOR".to_string(),
                }]
            );
        }

        /// `rules/tableiteminfo`: "Producing items will always produce as many items as during a
        /// month up to the limit of the supplies carried by the producing unit" - and a unit that
        /// gave its supplies away in the Give phase carries none.
        #[test]
        fn a_unit_that_gives_its_materials_away_produces_nothing() {
            let response = preview_gift("GIVE 901 ALL IRON\nPRODUCE sword");
            let giver = giver(&response);

            assert!(
                giver.produced.is_empty(),
                "no iron, no swords: {:?}",
                giver.produced
            );
            assert_eq!(giver.unit.men, 8, "the men are all still here");
        }

        /// Fifteen of the twenty iron leave, so five swords are all the month can make.
        #[test]
        fn a_unit_that_gives_some_materials_away_produces_what_is_left() {
            let response = preview_gift("GIVE 901 15 IRON\nPRODUCE sword");

            assert_eq!(
                giver(&response).produced,
                vec![ProducedItem {
                    amount: 5,
                    tag: "SWOR".to_string(),
                }]
            );
        }

        /// The regression that must not move: giving away the *goods* changes nothing about the
        /// month's run, because the swords leave in the Give phase and the new ones are made in
        /// the last one.
        #[test]
        fn a_gift_of_the_goods_it_makes_leaves_this_months_production_behind() {
            let report = report_with_a_smith_and_a_neighbour().replace(
                "8 orcs [ORC], 20 iron [IRON]",
                "8 orcs [ORC], 20 iron [IRON], 5 swords [SWOR]",
            );
            let response = preview_over(&report, "unit 900\nGIVE 901 ALL SWOR\nPRODUCE sword\n");

            assert_eq!(
                held(giver(&response), "SWOR"),
                8,
                "the month's eight swords stay with the giver"
            );
            assert_eq!(
                held(
                    row(&response, "1:1,1", "901").expect("the receiver's row is previewed"),
                    "SWOR"
                ),
                5,
                "the five it already had are what the receiver gets"
            );
        }
    }

    /// `ah-bxgs`. `TRANSPORT`/`DISTRIBUTE` moves goods between units that need not share a hex,
    /// routed through quartermasters, resolved after everything else `rules/sequenceofevents`
    /// runs first.
    mod transport {
        use super::*;

        fn sender_row(response: &OrdersPreviewResponse) -> &UnitPreview {
            row(response, "1:1,1", "5530").expect("the sender's row is previewed")
        }

        fn receiver_row(response: &OrdersPreviewResponse) -> Option<&UnitPreview> {
            row(response, "1:2,2", "6857")
        }

        #[test]
        fn a_transport_moves_goods_across_hexes() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\n");

            let sender = sender_row(&response);
            let sent_stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(sent_stone, Some(10), "40 held, 30 sent, 10 left");
            assert!(sender.changes.iter().any(|change| change.field == "items"));

            let receiver = receiver_row(&response).expect("the receiver is previewed");
            let held_stone = receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(held_stone, Some(45), "15 held, 30 arrived");
            assert!(receiver
                .changes
                .iter()
                .any(|change| change.field == "items"));
        }

        #[test]
        fn a_transport_within_one_hex_moves_goods_too() {
            let response = preview_orders_for_remembered_report(
                &mut ReportCache::new(),
                RULESET,
                &report(),
                "[]",
                "unit 900\nTRANSPORT 901 2 SWOR\n",
            )
            .expect("the ruleset loads");

            let sender = only_unit_by_id(&response, "900");
            let sword_count = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount);
            assert_eq!(sword_count, Some(1), "3 held, 2 sent");

            let receiver = only_unit_by_id(&response, "901");
            let sword_count = receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount);
            assert_eq!(
                sword_count,
                Some(2),
                "0 held, 2 arrived, within the same hex"
            );
        }

        #[test]
        fn distribute_is_transport_under_another_name() {
            let response = two_hex_preview("unit 5530\nDISTRIBUTE 6857 30 STON\n");

            let sender = sender_row(&response);
            let sent_stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(sent_stone, Some(10));

            let receiver = receiver_row(&response).expect("the receiver is previewed");
            let held_stone = receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(held_stone, Some(45));
        }

        #[test]
        fn the_game_will_not_transport_a_mount_so_it_stays_put() {
            let response =
                two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\nTRANSPORT 6857 2 HORS\n");

            let sender = sender_row(&response);
            let horses = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HORS")
                .map(|item| item.amount);
            assert_eq!(
                horses,
                Some(2),
                "the horses stay: the game will not carry them"
            );

            assert_eq!(
                sender.transport_sent,
                vec![
                    TransportSent {
                        amount: 30,
                        tag: "STON".to_string(),
                        to: "6857".to_string(),
                        to_unshown: false,
                        refused: false,
                    },
                    TransportSent {
                        amount: 0,
                        tag: "HORS".to_string(),
                        to: String::new(),
                        to_unshown: false,
                        refused: true,
                    },
                ]
            );
        }

        #[test]
        fn a_transport_of_men_moves_nothing_and_leaves_the_headcount_alone() {
            let response = two_hex_preview("unit 6857\nTRANSPORT 5530 1 LEAD\n");

            // The row is still previewed (the refusal itself is news), but nothing about the
            // unit's items or headcount changed - `can_be_transported` refuses every `MAN` tag,
            // so `apply_transports` never touches `unit.men`, `men_by_race` or `skills`.
            let unit = row(&response, "1:2,2", "6857").expect("the refusal is still reported");
            assert_eq!(unit.unit.men, 1);
            assert!(unit.changes.iter().all(|change| change.field != "items"));
            assert!(unit.changes.iter().all(|change| change.field != "men"));
            assert_eq!(
                unit.transport_sent,
                vec![TransportSent {
                    amount: 0,
                    tag: "LEAD".to_string(),
                    to: String::new(),
                    to_unshown: false,
                    refused: true,
                }]
            );
        }

        #[test]
        fn a_refusal_is_silent_when_the_unit_holds_none_of_it() {
            let response = two_hex_preview("unit 6857\nTRANSPORT 5530 2 HORS\n");

            // `6857` holds no horses: nothing to refuse, nothing to report, no row at all.
            assert!(row(&response, "1:2,2", "6857").is_none());
        }

        #[test]
        fn a_sale_takes_its_goods_before_a_transport_can() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\nSELL 40 STON\n");

            let sender = sender_row(&response);
            let stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(
                stone, None,
                "the sale took all 40 before transport could run"
            );
            assert!(
                sender.transport_sent.is_empty(),
                "transport had nothing left to send"
            );

            assert!(
                receiver_row(&response).is_none(),
                "the receiver gets nothing: the sale emptied the stock first"
            );
        }

        #[test]
        fn what_a_produce_makes_can_be_transported() {
            let response = preview_orders_for_remembered_report(
                &mut ReportCache::new(),
                RULESET,
                &report_with_a_smith(),
                "[]",
                "unit 900\nPRODUCE SWOR\nTRANSPORT 901 ALL SWOR\n",
            )
            .expect("the ruleset loads");

            let sender = only_unit_by_id(&response, "900");
            assert!(
                sender
                    .transport_sent
                    .iter()
                    .any(|sent| sent.tag == "SWOR" && sent.amount > 0),
                "what PRODUCE made this month is there to be sent"
            );
        }

        #[test]
        fn more_ordered_away_than_the_unit_holds_sends_what_is_there() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 90 STON\n");

            let sender = sender_row(&response);
            let stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(stone, None, "all 40 emptied");
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 40,
                    tag: "STON".to_string(),
                    to: "6857".to_string(),
                    to_unshown: false,
                    refused: false,
                }]
            );
        }

        #[test]
        fn a_transport_to_a_unit_the_report_does_not_show_still_empties_the_stock() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 99999 5 STON\n");

            let sender = sender_row(&response);
            let stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(stone, Some(35));
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 5,
                    tag: "STON".to_string(),
                    to: "99999".to_string(),
                    to_unshown: true,
                    refused: false,
                }]
            );
        }

        #[test]
        fn a_transport_to_a_unit_we_can_see_but_do_not_own() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 7001 5 STON\n");

            let sender = sender_row(&response);
            let stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(stone, Some(35));
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 5,
                    tag: "STON".to_string(),
                    to: "7001".to_string(),
                    to_unshown: false,
                    refused: false,
                }]
            );
            // No row of ours gains anything: 7001 is not our unit.
            assert!(row(&response, "1:2,2", "7001").is_none());
        }

        #[test]
        fn a_transport_to_nobody_in_particular_moves_nothing() {
            for orders in [
                "unit 5530\nTRANSPORT 0 30 STON\n",
                "unit 5530\nTRANSPORT NEW 1 30 STON\n",
                "unit 5530\nTRANSPORT FACTION 15 NEW 1 30 STON\n",
                "unit 5530\nTRANSPORT 5530 30 STON\n",
                "unit 5530\nTRANSPORT 6857 ALL WEAPONS\n",
            ] {
                let response = two_hex_preview(orders);
                let sender = row(&response, "1:1,1", "5530");
                let stone_untouched = sender.is_none_or(|unit| {
                    let stone = unit
                        .unit
                        .items
                        .iter()
                        .find(|item| item.tag == "STON")
                        .map(|item| item.amount);
                    stone == Some(40) && unit.transport_sent.is_empty()
                });
                assert!(stone_untouched, "orders {orders:?} moved nothing");
            }
        }

        #[test]
        fn a_unit_whose_transports_net_to_nothing_is_still_sent() {
            // 6857 starts holding 15 stone, receives 30 more, then forwards the same 30 on -
            // ending exactly where the report found it.
            let response = two_hex_preview(
                "unit 5530\nTRANSPORT 6857 30 STON\nunit 6857\nTRANSPORT 5530 30 STON\n",
            );
            let receiver = receiver_row(&response).expect("6857 is still sent");
            assert!(
                receiver
                    .changes
                    .iter()
                    .all(|change| change.field != "items"),
                "30 arrived and 30 left again, netting to the reported 15 - no items change"
            );
            assert!(!receiver.transport_received.is_empty());
            assert!(!receiver.transport_sent.is_empty());
        }

        #[test]
        fn a_unit_whose_only_transport_was_refused_is_still_sent() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 1 HORS\n");
            let sender = sender_row(&response);
            assert!(sender.changes.iter().all(|change| change.field != "items"));
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 0,
                    tag: "HORS".to_string(),
                    to: String::new(),
                    to_unshown: false,
                    refused: true,
                }]
            );
        }

        /// Four own units in one hex, so the chain is about the phases and not about range:
        /// an ordinary source, two quartermasters and an ordinary destination. Held skills are
        /// what `Working::over_own_units` reads (`ah-d0ku`).
        fn quartermaster_chain_report() -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "* Source (900), Foo (1), leader [LEAD], 10 stone [STON]. Weight: 510. \
                 Capacity: 0/0/15/0.",
                "* Quarterone (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
                 Skills: quartermaster [QUAM] 1 (30).",
                "* Quartertwo (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
                 Skills: quartermaster [QUAM] 1 (30).",
                "* Destination (903), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "",
            ]
            .join("\n")
        }

        fn chain_preview(orders: &str) -> OrdersPreviewResponse {
            preview_orders_for_remembered_report(
                &mut ReportCache::new(),
                RULESET,
                &quartermaster_chain_report(),
                "[]",
                orders,
            )
            .expect("the ruleset loads")
        }

        fn stone_of(response: &OrdersPreviewResponse, unit_id: &str) -> i64 {
            only_unit_by_id(response, unit_id)
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map_or(0, |item| item.amount)
        }

        #[test]
        fn transports_run_in_three_global_phases() {
            // `rules/sequenceofevents`: non-quartermaster to quartermaster, quartermaster to
            // quartermaster, then quartermaster to non-quartermaster - each phase run over every
            // unit before the next begins. The document is written in the opposite order on
            // purpose: document order must not decide where the goods end up (`ah-d0ku`).
            let response = chain_preview(
                "unit 902\nTRANSPORT 903 10 STON\n\
                 unit 901\nTRANSPORT 902 10 STON\n\
                 unit 900\nTRANSPORT 901 10 STON\n",
            );

            assert_eq!(stone_of(&response, "903"), 10, "the chain reaches the end");
            assert_eq!(stone_of(&response, "900"), 0, "the source sent everything");
            assert_eq!(stone_of(&response, "901"), 0, "the first hop kept nothing");
            assert_eq!(stone_of(&response, "902"), 0, "the second hop kept nothing");
        }

        #[test]
        fn an_item_moves_only_once_in_a_transport_phase() {
            // "Items may move in each of the phases but only once in each phase". 901 receives in
            // phase 1 and forwards in phase 2, which is allowed; 902 receives in phase 2 and its
            // own phase-2 line therefore has nothing it may move (`ah-d0ku`).
            let response = chain_preview(
                "unit 900\nTRANSPORT 901 10 STON\n\
                 unit 901\nTRANSPORT 902 10 STON\n\
                 unit 902\nTRANSPORT 901 10 STON\n",
            );

            assert_eq!(
                stone_of(&response, "902"),
                10,
                "what arrived in this phase cannot leave again in the same phase"
            );
            assert_eq!(stone_of(&response, "900"), 0, "the source sent its stone");
        }

        #[test]
        fn transport_annotations_remain_in_document_order() {
            // The quartermaster-to-quartermaster line settles a phase before the line written
            // above it, and the annotations still read in the order the player wrote them: the
            // navigator chose document order for this column (`ah-d0ku`).
            let response = chain_preview(
                "unit 900\nTRANSPORT 901 10 STON\n\
                 unit 901\nTRANSPORT 903 4 STON\nTRANSPORT 902 6 STON\n",
            );

            let hop = only_unit_by_id(&response, "901");
            let targets: Vec<&str> = hop
                .transport_sent
                .iter()
                .map(|sent| sent.to.as_str())
                .collect();
            assert_eq!(targets, vec!["903", "902"], "document order is kept");
        }

        fn only_unit_by_id<'a>(
            response: &'a OrdersPreviewResponse,
            unit_id: &str,
        ) -> &'a UnitPreview {
            response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == unit_id)
                .unwrap_or_else(|| panic!("unit {unit_id} is previewed"))
        }
    }

    /// `rules/sequenceofevents` runs GIVE and TAKE in one Give phase and processes units "in the
    /// order they appear on the report", so the preview settles them that way too - the same
    /// answer `semantics::apply_transfers` gives the Problems and SILVER columns beside it
    /// (`ah-3mwm`).
    mod report_ordered_transfers {
        use super::*;

        /// Three own units in report order - the source first, then the taker, then the unit the
        /// source gives to. The source holds exactly what the other two compete for.
        fn report_with_three() -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "* Source (900), Foo (1), 10 humans [HUMN], 10 swords [SWOR]. Weight: 150. \
                 Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
                "* Taker (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "* Recipient (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "",
            ]
            .join("\n")
        }

        fn amount_of(unit: &UnitPreview, tag: &str) -> i64 {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map_or(0, |item| item.amount)
        }

        #[test]
        fn competing_give_and_take_transfers_follow_report_order_in_preview() {
            let taker_block = "unit 901\nTAKE FROM 900 10 SWOR\nTAKE FROM 900 10 HUMN\n";
            let giver_block = "unit 900\nGIVE 902 10 SWOR\nGIVE 902 10 HUMN\n";

            for (label, orders) in [
                (
                    "the take written first",
                    format!("{taker_block}{giver_block}"),
                ),
                (
                    "the give written first",
                    format!("{giver_block}{taker_block}"),
                ),
            ] {
                let response = preview_over(&report_with_three(), &orders);
                let of = |id: &str| {
                    response
                        .regions
                        .iter()
                        .flat_map(|region| region.units.iter())
                        .find(|unit| unit.unit.unit_id == id)
                        .unwrap_or_else(|| panic!("{label}: unit {id} is previewed"))
                };

                let recipient = of("902");
                assert_eq!(amount_of(recipient, "SWOR"), 10, "{label}");
                assert_eq!(amount_of(recipient, "HUMN"), 10, "{label}");
                assert_eq!(
                    recipient.unit.men, 11,
                    "{label}: its own leader and the ten arrivals"
                );
                assert_eq!(
                    recipient
                        .unit
                        .skills
                        .iter()
                        .find(|skill| skill.tag == "LUMB")
                        .map(|skill| skill.level),
                    Some(2),
                    "{label}: ten lumberjack-3 men diluted across the leader they join"
                );

                let taker = response
                    .regions
                    .iter()
                    .flat_map(|region| region.units.iter())
                    .find(|unit| unit.unit.unit_id == "901");
                assert!(
                    taker.is_none_or(
                        |taker| amount_of(taker, "SWOR") == 0 && amount_of(taker, "HUMN") == 0
                    ),
                    "{label}: the losing TAKE moved nothing"
                );
            }
        }

        /// `ah-agbm`'s bounded optimism, kept where the preview now owns TAKE outright: an exact
        /// take of a named item from a unit the report does not show still reaches the taker, and
        /// still says where it came from.
        #[test]
        fn an_unseen_exact_take_still_reaches_the_preview_after_report_ordering() {
            let response = preview_over(&report_with_three(), "unit 901\nTAKE FROM 999 5 GRAI\n");
            let unit = only_unit(&response);

            assert_eq!(amount_of(unit, "GRAI"), 5);
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
