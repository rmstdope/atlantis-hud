//! Which movement order a unit actually travels by.
//!
//! A unit standing aboard a ship writes no order of its own: the unit sailing the hull writes
//! `SAIL`, and everyone aboard goes with it. Every reader that wants to know where a unit ends the
//! month therefore has the same two-part question to answer, and this module answers it once so a
//! second reader cannot answer it differently - which is exactly the disagreement ah-p1p, ah-l2i
//! and ah-048 were each filed for.

use std::collections::{BTreeMap, BTreeSet};

use crate::movement::orders::MoveStep;
use crate::movement::rules::Ruleset;
use crate::orders::intents::Intent;
use crate::orders::standing::{self, standing_after, Boarding, BoardingOrder};
use crate::report::model::{ReportRegion, ReportUnit, Structure};
use crate::report::ParsedReport;

/// A unit's own movement order, and whether it was written as a `SAIL`.
///
/// The two are kept together because only a `SAIL` is a fleet's business: a `MOVE` written by a
/// unit standing in a hull is that unit walking off, and is nobody else's course.
#[derive(Debug, Clone)]
struct UnitCourse {
    steps: Vec<MoveStep>,
    sail: bool,
}

/// The last top-level movement order each unit wrote, read once from the whole orders document.
///
/// Only lines that are a unit's own for this turn count: a `TURN` block holds orders for the turn
/// after this one and a `FORM` block's orders belong to the unit being formed, so movement inside
/// either says nothing about where the unit whose block it is goes next. The last readable
/// movement line wins, because a later order replaces an earlier one when the game executes them.
#[derive(Debug, Default, Clone)]
pub struct OrderedUnits {
    by_unit: BTreeMap<String, UnitCourse>,
    sailers: BTreeSet<String>,
    /// Each unit's ENTER and LEAVE orders, in the order they were written. A unit that wrote
    /// neither is absent, and the report's own answer stands for it.
    ///
    /// The orders themselves are kept rather than the answer, because two different questions are
    /// asked of them - see [`crate::orders::standing`], which holds both and says why they differ.
    boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>>,
    /// Each unit's syntactically valid `PROMOTE` targets this month, in the order written.
    promotes_by_unit: BTreeMap<String, Vec<String>>,
}

impl OrderedUnits {
    /// Reads every unit's block out of one orders document.
    #[must_use]
    pub fn from_document(orders_document: &str) -> Self {
        Self::from_document_with_ruleset(orders_document, None)
    }

    #[must_use]
    pub fn from_document_with_ruleset(orders_document: &str, ruleset: Option<&Ruleset>) -> Self {
        use crate::orders::walk::{walk, BlockKind, Event};

        let mut by_unit: BTreeMap<String, UnitCourse> = BTreeMap::new();
        let mut promotes_by_unit: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>> = BTreeMap::new();
        let mut sailers = BTreeSet::new();
        let mut current: Option<String> = None;
        // The `FORM` blocks currently open, innermost last, each holding the id of the unit it
        // creates - or `None` for a FORM whose alias could not be read, which still opens a block
        // so its orders do not fall through to the unit outside it. The nesting rules themselves
        // live in `orders::blocks`, driven by this reader, `Working::visit` and
        // `intents::FormReader` alike, so they cannot drift apart again (`ah-i33f`).
        let mut forms: crate::orders::blocks::FormStack<String> =
            crate::orders::blocks::FormStack::new();

        walk(orders_document, |event| match event {
            Event::Unit(line) => {
                current = line.arguments.first().map(|id| id.text.to_string());
                forms.reset();
            }
            Event::Directive(_) => {
                forms.reset();
            }
            Event::Open {
                line,
                kind: BlockKind::Form,
                depth,
            } if depth.turn == 0 => {
                forms.open(
                    line.arguments
                        .first()
                        .and_then(crate::orders::forms::read_alias)
                        .map(|alias| {
                            format!("{}{alias}", crate::orders::effects::FORMED_ID_PREFIX)
                        }),
                );
            }
            Event::Close {
                kind: BlockKind::Form,
                depth,
                ..
            } if depth.turn == 0 => {
                forms.close();
            }
            // `depth.turn == 0` rather than `depth == Depth::default()`: a `TURN` block holds next
            // month's orders and says nothing about this one, but a `FORM` block's own MOVE is the
            // formed unit's and must be read (`ah-4hux`). `Depth` counts the two separately.
            Event::Order { line, depth } if depth.turn == 0 => {
                // Read through `orders::intents::read_order`, which is the same function
                // `orders::semantics` reads a line with - so the map and the preview cannot read
                // one line two ways. Before `ah-i33f` this walk read the raw token slice and
                // refused an `ENTER 5 junk` the validator and the preview both accept, so one
                // document put a unit ashore in the pane and left it aboard on the map.
                // `PROMOTE` is no `Intent` - nothing consumes it as a phase - so it is read from
                // the line before the intent guard below throws the line away. Only a block's own
                // orders count: a `FORM` block's orders are the formed unit's.
                if let (crate::orders::blocks::Owner::Block, Some(unit_id)) =
                    (forms.owner(), current.as_ref())
                {
                    if let Some(target) =
                        crate::orders::intents::promoted_unit(line.command, line.arguments, ruleset)
                    {
                        promotes_by_unit
                            .entry(unit_id.clone())
                            .or_default()
                            .push(target);
                    }
                }
                let Some(intent) = crate::orders::intents::read_order_with_ruleset(
                    line.command,
                    line.arguments,
                    ruleset,
                ) else {
                    return;
                };
                let owner = forms.owner();
                // Movement moves with the formed unit; SAIL participation and the boardings stay
                // with the block's own unit, because `Working` already applies a formed unit's
                // boardings to its own `structure_id` and `structure_of` reads both - recording
                // them here as well would apply one order twice (`ah-4hux`).
                //
                // `Owner::Nobody` - a FORM whose alias could not be read - moves nobody, rather
                // than falling the order through to the block's own unit. `Working::active`
                // answers `None` there too, and these two readers must agree or the parent draws a
                // line for a MOVE it did not write (`ah-4hux`).
                //
                // A formed unit's id is global here and not in `Working`, which keys its aliases
                // on `(region_id, alias)` - so two units in *different* hexes each writing
                // `FORM 1` are two legitimate formed units there - `effects.rs` pins that case -
                // and one `new-1` in this map, last write winning. The trace then picks
                // arbitrarily between them. Not modelled rather than overlooked: giving these ids
                // a region would mean deciding what a formed unit is called everywhere the
                // synthetic id is read, which is the planner's call and not this bead's. What the
                // match below does guarantee is that the divergence stays on the formed unit
                // instead of leaking onto the parent (`ah-4hux`).
                let moving = match &owner {
                    crate::orders::blocks::Owner::Block => current.clone(),
                    crate::orders::blocks::Owner::Formed(id) => Some((*id).clone()),
                    crate::orders::blocks::Owner::Nobody => None,
                };
                if let (Some(unit_id), Intent::Move { steps } | Intent::Sail { steps }) =
                    (moving, &intent)
                {
                    // An order that goes nowhere is not a movement order: `parse_move` already
                    // refuses an empty route, and a bare `SAIL` reaches here with no steps. Without
                    // this guard `steps_for` starts answering `Some(&[])` for a bare SAIL, and
                    // `steps_followed_by` returns that empty route instead of looking for the
                    // hull's.
                    if !steps.is_empty() {
                        by_unit.insert(
                            unit_id,
                            UnitCourse {
                                steps: steps.clone(),
                                sail: matches!(intent, Intent::Sail { .. }),
                            },
                        );
                    }
                }
                // Skipped inside a FORM block for the reason above: those orders are applied by
                // `Working` to the formed unit's own row already.
                let (crate::orders::blocks::Owner::Block, Some(unit_id)) =
                    (owner, current.as_ref())
                else {
                    return;
                };
                match intent {
                    // A bare SAIL participates; one with a route departs. `In`, `Out` and a
                    // structure number are not a departure, which is why this is not simply "has
                    // steps".
                    Intent::Sail { ref steps }
                        if steps.is_empty()
                            || steps.iter().any(|step| matches!(step, MoveStep::Go(_))) =>
                    {
                        sailers.insert(unit_id.clone());
                    }
                    Intent::Enter { structure } => boardings_by_unit
                        .entry(unit_id.clone())
                        .or_default()
                        .push(BoardingOrder::Enter(structure)),
                    Intent::Leave => boardings_by_unit
                        .entry(unit_id.clone())
                        .or_default()
                        .push(BoardingOrder::Leave),
                    _ => {}
                }
            }
            _ => {}
        });

        Self {
            by_unit,
            sailers,
            boardings_by_unit,
            promotes_by_unit,
        }
    }

    /// The unit's own movement steps, if it wrote any.
    #[must_use]
    pub fn steps_for(&self, unit_id: &str) -> Option<&[MoveStep]> {
        self.by_unit
            .get(unit_id)
            .map(|course| course.steps.as_slice())
    }

    /// Whether this unit's own movement order was a `SAIL` naming a course.
    ///
    /// Distinct from [`Self::issues_sail`], which answers participation - a bare `SAIL` lends a
    /// pair of hands and sets no course.
    #[must_use]
    pub fn sails_a_course(&self, unit_id: &str) -> bool {
        self.by_unit.get(unit_id).is_some_and(|course| course.sail)
    }

    /// The units this unit named in a syntactically valid `PROMOTE` this month, in the order they
    /// were written.
    #[must_use]
    pub fn promotes_of(&self, unit_id: &str) -> &[String] {
        self.promotes_by_unit
            .get(unit_id)
            .map_or(&[][..], Vec::as_slice)
    }

    #[must_use]
    pub(crate) fn issues_sail(&self, unit_id: &str) -> bool {
        self.sailers.contains(unit_id)
    }

    /// The structure this unit is in once this month's ENTER/LEAVE orders have run.
    ///
    /// ENTER and LEAVE both run before anything moves, so every reader that asks "what is this
    /// unit standing in when its orders happen" wants this rather than `unit.structure_id`, which
    /// is only where the report found it. The rule is [`crate::orders::standing::standing_after`]'s
    /// and is stated only there; this is the adapter that reads it out of an orders document.
    ///
    /// This is where a unit *ends up*. For "could this unit be the one sailing the hull" the
    /// question is different and [`Self::could_captain`] answers it.
    #[must_use]
    pub fn structure_of<'a>(&'a self, unit: &'a ReportUnit) -> Option<&'a str> {
        standing_after(
            unit.structure_id.as_deref(),
            self.boardings_of(&unit.unit_id),
        )
    }

    /// One unit's boardings as the rule reads them.
    fn boardings_of(&self, unit_id: &str) -> impl Iterator<Item = Boarding<'_>> + '_ {
        self.boardings_by_unit
            .get(unit_id)
            .into_iter()
            .flatten()
            .map(BoardingOrder::as_boarding)
    }
}

impl OrderedUnits {
    /// Whether this unit could be the one giving the hull's movement order: standing in it per the
    /// report, or boarding it this month.
    ///
    /// Deliberately not [`Self::structure_of`], for the reason
    /// [`crate::orders::standing::could_captain`] gives, which is where the rule lives.
    #[must_use]
    pub fn could_captain(&self, unit: &ReportUnit, structure_id: &str) -> bool {
        standing::could_captain(
            unit.structure_id.as_deref(),
            structure_id,
            self.boardings_of(&unit.unit_id),
        )
    }
}

/// The unit the report makes a structure's owner: the first unit listed under it.
///
/// `rules/world_structures`: "The owner of an object can be identified on the turn report, as it is
/// the first unit listed under the object." `units_in_hex` must be in report order, which
/// `ReportRegion::units` and `KnownHex::units` both are.
#[must_use]
pub fn reported_owner<'r>(
    units_in_hex: &'r [ReportUnit],
    structure_id: &str,
) -> Option<&'r ReportUnit> {
    units_in_hex
        .iter()
        .find(|unit| unit.structure_id.as_deref() == Some(structure_id))
}

/// Who owns a hull once this month's boardings and `PROMOTE`s have run, as a unit id.
///
/// The report's own answer first; then, for a hull the report lists nobody under, the first unit in
/// report order that boards it this month ("The first unit to enter an object is considered to be
/// the owner", `rules/world_structures` - and `rules/sequenceofevents` runs ENTER before movement);
/// then each valid `PROMOTE` written by the owner to a unit aboard the same hull.
///
/// Among several `PROMOTE`s from one owner the **first valid one written** takes the hull, not the
/// last: `rules/promote` promotes a unit "to owner of the object of which you are currently the
/// owner", so once one has run that unit owns the object no longer and its later `PROMOTE`s hand
/// on nothing. One naming a unit that is not aboard promotes nobody and leaves the next to run.
/// The walk then continues from the new owner, so a hull promoted on twice in one month ends with
/// the unit actually holding it. `None` when no unit can be named at all.
#[must_use]
pub fn fleet_owner(
    region: &ReportRegion,
    ordered: &OrderedUnits,
    structure_id: &str,
) -> Option<String> {
    let mut owner = match reported_owner(&region.units, structure_id) {
        Some(unit) => unit.unit_id.clone(),
        // Nobody is listed under it, so the first unit to board it this month owns it.
        None => region
            .units
            .iter()
            .find(|unit| ordered.structure_of(unit) == Some(structure_id))?
            .unit_id
            .clone(),
    };

    // Each promotion is followed in turn, so a hull handed on twice in one month ends with the
    // unit actually holding it. `seen` bounds the walk: a document can name a cycle.
    let mut seen: BTreeSet<String> = BTreeSet::new();
    while seen.insert(owner.clone()) {
        let Some(next) = ordered
            .promotes_of(&owner)
            .iter()
            .find(|target| {
                region.units.iter().any(|unit| {
                    &unit.unit_id == *target && ordered.could_captain(unit, structure_id)
                })
            })
            .cloned()
        else {
            break;
        };
        owner = next;
    }
    Some(owner)
}

/// Who owns a hull, and the course that owner set.
///
/// `steps` is `Some` only when `owner_id` is `Some` and that owner wrote a `SAIL` naming a course.
/// A hull whose owner set no course goes nowhere, whatever anyone else aboard wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetCourse<'o> {
    pub owner_id: Option<String>,
    pub steps: Option<&'o [MoveStep]>,
}

#[must_use]
pub fn fleet_course<'o>(
    region: &ReportRegion,
    ordered: &'o OrderedUnits,
    structure_id: &str,
) -> FleetCourse<'o> {
    let Some(owner_id) = fleet_owner(region, ordered, structure_id) else {
        return FleetCourse {
            owner_id: None,
            steps: None,
        };
    };
    let steps = if ordered.sails_a_course(&owner_id) {
        ordered.steps_for(&owner_id)
    } else {
        None
    };
    FleetCourse {
        owner_id: Some(owner_id),
        steps,
    }
}

/// The hull this unit stands in once its own ENTER/LEAVE have run, when it is a fleet whose speed
/// can be priced.
///
/// Deliberately `mode::fleet_speed(...).is_some()` and **not** `mode::hulls_named_in`, which is
/// syntactic and reads `Fort` as a hull - the same test `steps_followed_by` applies. A garrison
/// must not follow whoever in the building wrote an order.
#[must_use]
pub fn priceable_fleet_of<'r>(
    region: &'r ReportRegion,
    ruleset: &Ruleset,
    ordered: &OrderedUnits,
    unit: &ReportUnit,
) -> Option<&'r Structure> {
    let structure_id = ordered.structure_of(unit)?;
    region
        .structures
        .iter()
        .find(|structure| structure.structure_id == structure_id)
        .filter(|structure| crate::movement::mode::fleet_speed(structure, ruleset).is_some())
}

/// The movement steps a unit travels by: its own, or those of whoever is sailing the fleet it
/// stands in.
///
/// A passenger writes no order and goes where the hull goes - the same rule the units-in-hex
/// preview applies (`orders::effects`, ah-l2i.2), stated once so a second reader cannot answer
/// differently. `None` for a unit with no order of its own that is not aboard a departing fleet.
///
/// The hull's course is its **owner's** and nobody else's: `rules/movement_sailing` - "the owner of
/// a fleet must issue the SAIL order, and other units wishing to help sail the fleet must also
/// issue the SAIL order". A `SAIL` from any other unit aboard lends a pair of hands and never a
/// direction, so a hull whose owner named no course goes nowhere and this answers `None`
/// (`ah-ofra`). [`fleet_course`] states that rule, and the units-in-hex preview reads the same
/// function.
///
/// "Is a fleet" is the same test [`crate::movement::trace::trace_move`] applies before it draws a
/// unit sailing: a hull whose speed can be *priced*, from the server's own stated numbers or from
/// the ruleset. [`crate::movement::mode::hulls_named_in`] is not that test - it is syntactic and
/// reads any single-word kind, `Fort` included, as a hull - and using it here would have every
/// garrison follow whoever in the building wrote a MOVE.
#[must_use]
pub fn steps_followed_by<'a>(
    report: &ParsedReport,
    ruleset: &crate::movement::rules::Ruleset,
    ordered: &'a OrderedUnits,
    unit: &ReportUnit,
) -> Option<&'a [MoveStep]> {
    let own = ordered.steps_for(&unit.unit_id);
    // A unit's own MOVE still wins: standing in a fleet does not stop it walking off, and the map
    // draws what the player typed. Only its own SAIL is the hull's business.
    if own.is_some() && !ordered.sails_a_course(&unit.unit_id) {
        return own;
    }
    let Some(region) = report
        .regions
        .iter()
        .find(|region| region.region_id == unit.region_id)
    else {
        return own;
    };
    // A unit in a Fort follows nobody: only a priceable hull carries its occupants away.
    let Some(hull) = priceable_fleet_of(region, ruleset, ordered, unit) else {
        return own;
    };
    fleet_course(region, ordered, &hull.structure_id).steps
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::ReportCache;
    use crate::movement::orders::MoveStep;

    const TURN_24: &str = atlantis_hud_fixtures::G5_F21_T24.text;
    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    /// Raft [235] in the plain at (36,44) carries Drones (10575), which can sail, and Drones
    /// (10594), which writes nothing.
    fn followed(orders: &str, unit_id: &str) -> Option<Vec<MoveStep>> {
        let mut cache = ReportCache::new();
        let report = cache.classified(TURN_24, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let ordered = OrderedUnits::from_document(orders);
        let unit = report
            .units()
            .find(|unit| unit.unit_id == unit_id)
            .expect("the fixture carries the unit")
            .clone();
        steps_followed_by(&report, &ruleset, &ordered, &unit).map(<[MoveStep]>::to_vec)
    }

    #[test]
    fn a_unit_follows_its_own_order() {
        assert_eq!(
            followed("unit 10575\nsail se\n", "10575"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )])
        );
    }

    #[test]
    fn a_passenger_follows_the_fleet_it_stands_in() {
        assert_eq!(
            followed("unit 10575\nsail se\n", "10594"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "10594 wrote nothing and stands in the raft 10575 is sailing"
        );
    }

    #[test]
    fn a_unit_ashore_follows_nothing() {
        // "* One of Three (1293)" stands in Building [3], and nobody in it wrote anything.
        assert_eq!(followed("unit 10575\nsail se\n", "1293"), None);
    }

    #[test]
    fn a_unit_in_a_building_follows_nothing() {
        // Drones (5983) and Five of Three (775) both stand in Building [2], a Fort. A Fort is not a
        // hull, so an order written by one carries nobody: a garrison is not cargo.
        let orders = "unit 5983\nmove n\n";
        assert_eq!(
            followed(orders, "5983"),
            Some(vec![MoveStep::Go(crate::movement::graph::Direction::North)]),
            "the unit that wrote it still follows it"
        );
        assert_eq!(
            followed(orders, "775"),
            None,
            "a Fort is not a fleet, so its other occupant follows nobody"
        );
    }

    /// The checker and every reader must say the same thing about one line. Nothing enforced that
    /// before, which is how `SAIL NRTH` came to be accepted in silence while all three readers
    /// threw it away (`ah-twsa`).
    #[test]
    fn the_checker_and_every_reader_agree_an_unreadable_sail_is_no_order() {
        let unreadable = "#atlantis 95 pw\nunit 1471\n  SAIL NRTH\n#end\n";
        let diagnostics = crate::orders::validate_orders(unreadable, None).diagnostics;
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        assert_eq!(diagnostics[0].code, "bad-argument");
        assert!(crate::orders::intents::read_intents(unreadable)[0]
            .intents
            .is_empty());
        let ordered = OrderedUnits::from_document(unreadable);
        assert_eq!(ordered.steps_for("1471"), None);
        assert!(!ordered.issues_sail("1471"));

        let bare = "#atlantis 95 pw\nunit 1471\n  SAIL\n#end\n";
        assert_eq!(
            crate::orders::validate_orders(bare, None).diagnostics,
            vec![]
        );
        let intents = &crate::orders::intents::read_intents(bare)[0].intents;
        assert_eq!(intents.len(), 1);
        assert!(
            matches!(&intents[0].intent, crate::orders::intents::Intent::Sail { steps, .. } if steps.is_empty()),
            "{intents:?}"
        );
        let ordered = OrderedUnits::from_document(bare);
        assert_eq!(ordered.steps_for("1471"), None);
        assert!(ordered.issues_sail("1471"));
    }

    /// The scene the ah-ofra design was agreed against, which no committed report carries: one
    /// ocean hex with NE and SE ocean exits, a priceable Longship carrying three own units in the
    /// order `Sea Rovers (900)`, `Deckhands (901)`, `Marines (902)`, a second Longship the report
    /// lists nobody under, and one unit ashore. Modelled on the proven builder in
    /// `orders::effects`'s own tests.
    fn owner_scene() -> String {
        let mut text = String::from("Foo (1) Report\n\n");
        text.push_str("ocean (1,1) in Sea.\n\n");
        text.push_str(
            "Exits:\n  Northeast : ocean (2,0) in Sea.\n  Southeast : ocean (2,2) in Sea.\n\n",
        );
        text.push_str("* Ashore (903), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n");
        text.push_str("+ Longship [329] : Longship; Load: 110/150; Sailors: 4/4; MaxSpeed: 4.\n");
        text.push_str(
            "  * Sea Rovers (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
        );
        text.push_str(
            "  * Deckhands (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
        );
        text.push_str(
            "  * Marines (902), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0.\n",
        );
        text.push_str("+ Seagull [330] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
        text.push_str("\nocean (2,0) in Sea.\n\nExits:\n  Southwest : ocean (1,1) in Sea.\n");
        text.push_str("\nocean (2,2) in Sea.\n\nExits:\n  Northwest : ocean (1,1) in Sea.\n");
        text
    }

    fn scene_owner(orders: &str, structure_id: &str) -> Option<String> {
        let mut cache = ReportCache::new();
        let report = cache.classified(&owner_scene(), RULESET);
        let region = report
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the scene's ocean hex");
        let ordered = OrderedUnits::from_document(orders);
        fleet_owner(region, &ordered, structure_id)
    }

    fn scene_course(orders: &str, structure_id: &str) -> Option<Vec<MoveStep>> {
        let mut cache = ReportCache::new();
        let report = cache.classified(&owner_scene(), RULESET);
        let region = report
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the scene's ocean hex");
        let ordered = OrderedUnits::from_document(orders);
        fleet_course(region, &ordered, structure_id)
            .steps
            .map(<[MoveStep]>::to_vec)
    }

    #[test]
    fn the_first_unit_listed_under_a_hull_owns_it() {
        // Opens with the fixture's own shape, so a later edit to the report text fails loudly
        // instead of quietly weakening every test built on it.
        let mut cache = ReportCache::new();
        let report = cache.classified(&owner_scene(), RULESET);
        let region = report
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the scene's ocean hex");
        let aboard: Vec<&str> = region
            .units
            .iter()
            .filter(|unit| unit.structure_id.as_deref() == Some("329"))
            .map(|unit| unit.unit_id.as_str())
            .collect();
        assert_eq!(aboard, ["900", "901", "902"]);
        assert!(
            !region
                .units
                .iter()
                .any(|unit| unit.structure_id.as_deref() == Some("330")),
            "the scene lists nobody under Seagull [330]"
        );

        assert_eq!(scene_owner("", "329"), Some("900".to_string()));
        assert_eq!(
            scene_owner("unit 901\nSAIL SE\n", "329"),
            Some("900".to_string()),
            "orders do not change who the report lists first"
        );
    }

    #[test]
    fn an_empty_hull_is_owned_by_the_first_unit_that_boards_it() {
        assert_eq!(scene_owner("", "330"), None);
        assert_eq!(
            scene_owner("unit 902\nENTER 330\n", "330"),
            Some("902".to_string())
        );
    }

    #[test]
    fn a_promote_hands_a_hull_on_to_a_unit_aboard() {
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\n", "329"),
            Some("901".to_string())
        );
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 903\n", "329"),
            Some("900".to_string()),
            "903 stands ashore, so the promotion moves no hull"
        );
    }

    fn scene_followed(orders: &str, unit_id: &str) -> Option<Vec<MoveStep>> {
        let mut cache = ReportCache::new();
        let report = cache.classified(&owner_scene(), RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let ordered = OrderedUnits::from_document(orders);
        let unit = report
            .units()
            .find(|unit| unit.unit_id == unit_id)
            .expect("the scene carries the unit")
            .clone();
        steps_followed_by(&report, &ruleset, &ordered, &unit).map(<[MoveStep]>::to_vec)
    }

    fn go(direction: crate::movement::graph::Direction) -> Option<Vec<MoveStep>> {
        Some(vec![MoveStep::Go(direction)])
    }

    #[test]
    fn a_course_from_a_unit_that_does_not_own_the_hull_carries_nobody() {
        for unit_id in ["900", "901", "902"] {
            assert_eq!(
                scene_followed("unit 901\nSAIL SE\n", unit_id),
                None,
                "{unit_id} travels by the owner's course, and 900 set none"
            );
        }
    }

    #[test]
    fn the_owners_course_overrules_another_units() {
        for unit_id in ["900", "901", "902"] {
            assert_eq!(
                scene_followed("unit 900\nSAIL NE\nunit 901\nSAIL SE\n", unit_id),
                go(crate::movement::graph::Direction::Northeast),
                "{unit_id} sails the owner's NE"
            );
        }
    }

    #[test]
    fn a_bare_sail_from_another_unit_overrules_nothing() {
        for unit_id in ["900", "901", "902"] {
            assert_eq!(
                scene_followed("unit 900\nSAIL NE\nunit 901\nSAIL\n", unit_id),
                go(crate::movement::graph::Direction::Northeast),
                "{unit_id} sails the owner's NE"
            );
        }
    }

    #[test]
    fn a_units_own_move_still_wins_aboard_a_fleet() {
        assert_eq!(
            scene_followed("unit 900\nSAIL NE\nunit 902\nMOVE SW\n", "902"),
            go(crate::movement::graph::Direction::Southwest),
            "standing in a fleet does not stop a unit walking off"
        );
    }

    /// Among several `PROMOTE`s from one owner the first valid one written takes the hull: once it
    /// has run the owner no longer owns the object, so its later ones hand on nothing, and one
    /// naming a unit that is not aboard promotes nobody and leaves the next to run. The walk then
    /// continues from the new owner, so a hull promoted on twice ends with the unit holding it.
    #[test]
    fn the_first_promote_takes_the_hull_and_the_walk_goes_on_from_there() {
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nPROMOTE 902\n", "329"),
            Some("901".to_string()),
            "900's second PROMOTE hands on nothing: it no longer owns the hull"
        );
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nunit 901\nPROMOTE 902\n", "329"),
            Some("902".to_string()),
            "the hull was handed on twice, and ends with the unit holding it"
        );
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 903\nPROMOTE 901\n", "329"),
            Some("901".to_string()),
            "903 is ashore, so that PROMOTE promotes nobody and leaves the next one to run"
        );
    }

    #[test]
    fn a_fleet_takes_its_course_from_its_owner_alone() {
        assert_eq!(
            scene_course("unit 900\nSAIL NE\nunit 901\nSAIL SE\n", "329"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Northeast
            )])
        );
        assert_eq!(scene_course("unit 901\nSAIL SE\n", "329"), None);
    }

    #[test]
    fn a_sail_is_told_from_a_move_and_a_promote_is_read() {
        assert!(OrderedUnits::from_document("unit 10575\nSAIL SE\n").sails_a_course("10575"));
        assert!(!OrderedUnits::from_document("unit 10575\nMOVE N\n").sails_a_course("10575"));
        assert!(
            !OrderedUnits::from_document("unit 10575\nSAIL\n").sails_a_course("10575"),
            "a bare SAIL stores no steps, so it names no course"
        );
        assert_eq!(
            OrderedUnits::from_document("unit 900\nPROMOTE 901\n").promotes_of("900"),
            ["901".to_string()]
        );
    }

    #[test]
    fn bare_sail_participates_but_only_directional_sail_departs() {
        let bare = OrderedUnits::from_document("unit 10575\nSAIL\n");
        let in_only = OrderedUnits::from_document("unit 10575\nSAIL IN\n");
        let out_only = OrderedUnits::from_document("unit 10575\nSAIL OUT\n");
        let directional = OrderedUnits::from_document("unit 10575\nSAIL SE\n");

        assert!(bare.issues_sail("10575"));
        assert!(!in_only.issues_sail("10575"));
        assert!(!out_only.issues_sail("10575"));
        assert!(directional.issues_sail("10575"));
    }

    /// Two units aboard Raft [235] both write a `SAIL`, and the **owner's** wins - the first unit
    /// listed under the hull, whichever line came later (`ah-ofra`). This test stated the rule
    /// replaced by that one: the last order aboard used to win.
    #[test]
    fn the_owners_order_aboard_wins_over_a_later_one() {
        let orders = "unit 10575\nsail se\nunit 10594\nsail n\n";
        let mut cache = ReportCache::new();
        let report = cache.classified(TURN_24, RULESET);
        let aboard: Vec<String> = report
            .units()
            .filter(|unit| {
                unit.region_id == "1:36,44" && unit.structure_id.as_deref() == Some("235")
            })
            .map(|unit| unit.unit_id.clone())
            .collect();
        assert_eq!(aboard, vec!["10575".to_string(), "10594".to_string()]);
        assert_eq!(
            followed(orders, "10594"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "10575 is listed first under the raft, so its SE is the hull's course"
        );
        assert_eq!(
            followed("unit 10575\nsail se\nunit 10594\nmove n\n", "10594"),
            Some(vec![MoveStep::Go(crate::movement::graph::Direction::North)]),
            "a MOVE is the unit walking off, and is still its own business"
        );
    }

    fn structure_after(orders: &str, unit_id: &str) -> Option<String> {
        let mut cache = ReportCache::new();
        let report = cache.classified(TURN_24, RULESET);
        let ordered = OrderedUnits::from_document(orders);
        let unit = report
            .units()
            .find(|unit| unit.unit_id == unit_id)
            .expect("the fixture carries the unit")
            .clone();
        ordered.structure_of(&unit).map(str::to_string)
    }

    #[test]
    fn a_unit_that_enters_this_month_is_in_the_structure_it_entered() {
        // Drones (1297) stands ashore in the report's own answer.
        assert_eq!(structure_after("", "1297"), None, "ashore in the report");
        assert_eq!(
            structure_after("unit 1297\nENTER 235\n", "1297"),
            Some("235".to_string())
        );
    }

    #[test]
    fn a_unit_that_leaves_this_month_is_in_nothing() {
        assert_eq!(structure_after("unit 10594\nLEAVE\n", "10594"), None);
    }

    #[test]
    fn a_unit_that_wrote_neither_keeps_the_reports_answer() {
        assert_eq!(
            structure_after("unit 10594\nwork\n", "10594"),
            Some("235".to_string()),
            "the report's own answer stands for a unit that wrote no ENTER or LEAVE"
        );
    }

    /// Every LEAVE runs before any ENTER, so an ENTER in the block wins whichever way round they
    /// were typed - the rule `orders::semantics::structure_after_orders` states, confirmed by the
    /// navigator on 2026-08-18 after a verification failed on exactly it (ah-mjy). Among ENTERs
    /// the last one wins, which is document order.
    #[test]
    fn an_enter_wins_over_a_leave_in_the_same_block() {
        assert_eq!(
            structure_after("unit 1297\nENTER 235\nLEAVE\n", "1297"),
            Some("235".to_string()),
            "the LEAVE ran first and the unit walked back in"
        );
        assert_eq!(
            structure_after("unit 10594\nLEAVE\nENTER 235\n", "10594"),
            Some("235".to_string())
        );
    }

    #[test]
    fn the_last_of_several_enters_wins() {
        assert_eq!(
            structure_after("unit 1297\nENTER 3\nENTER 235\n", "1297"),
            Some("235".to_string())
        );
    }

    #[test]
    fn an_enter_inside_a_turn_block_is_next_months_business() {
        assert_eq!(
            structure_after("unit 1297\nTURN\nENTER 235\nENDTURN\n", "1297"),
            None,
            "a TURN block is next month's orders"
        );
    }

    #[test]
    fn a_passenger_that_boards_this_month_follows_the_fleet() {
        assert_eq!(
            followed("unit 10575\nsail se\nunit 1297\nENTER 235\n", "1297"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "1297 boards the raft 10575 is sailing"
        );
    }

    #[test]
    fn a_passenger_that_leaves_this_month_follows_nothing() {
        assert_eq!(
            followed("unit 10575\nsail se\nunit 10594\nLEAVE\n", "10594"),
            None,
            "10594 steps ashore before the raft goes"
        );
    }

    /// A FORM block's orders belong to the unit being formed, not to the unit whose block holds
    /// it - the same guard movement already relies on.
    #[test]
    fn an_enter_inside_a_form_block_belongs_to_the_formed_unit() {
        assert_eq!(
            structure_after("unit 1297\nFORM 1\nENTER 235\nEND\n", "1297"),
            None,
            "the ENTER is the new unit's, not 1297's"
        );
    }

    /// The game's own parser is case-insensitive, and so is `Token::is`.
    #[test]
    fn the_orders_are_read_whatever_their_case() {
        assert_eq!(
            structure_after("unit 1297\nenter 235\n", "1297"),
            Some("235".to_string())
        );
        assert_eq!(structure_after("unit 10594\nLeAvE\n", "10594"), None);
    }

    /// `ah-86vk` let a valid order carry trailing text the validator ignores, and
    /// `orders::intents` and the preview both read the order underneath it. This reader used to
    /// refuse the whole line, so one document put a unit ashore in the pane and left it aboard on
    /// the map (`ah-i33f`).
    #[test]
    fn trailing_text_does_not_make_an_enter_or_a_leave_unreadable() {
        assert_eq!(
            structure_after("unit 1297\nENTER 235 X\n", "1297"),
            Some("235".to_string())
        );
        assert_eq!(structure_after("unit 10594\nLEAVE 3\n", "10594"), None);
        // An ENTER whose argument is not a structure number is still no order at all: the number
        // is required, not merely tolerated.
        assert_eq!(structure_after("unit 1297\nENTER shed\n", "1297"), None);
    }

    /// **`ah-8myf`, the failed verification of 2026-08-25.** Frozen Tomb [194] in barren (32,50)
    /// is written `Galley, 40 Galleons, 11 Galleys, 10 Balloons` and states no `MaxSpeed:`, so
    /// whether it is a priceable hull falls to ruleset arithmetic - and the whole clause read as
    /// one hull name matched no item, so only 13401, which wrote the SAIL, was projected as
    /// moving. Everyone else aboard stood still on screen.
    #[test]
    fn a_passenger_on_a_fleet_that_names_its_class_follows_it() {
        let mut cache = ReportCache::new();
        let report = cache.classified(atlantis_hud_fixtures::G7_F95_T72.text, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        // The hull's course is its owner's, and the first unit listed under Frozen Tomb [194] is
        // the **foreign** `A Tomb's Crew (6311)` - which is exactly why our own 13401 sailing it
        // now carries nobody, and why the SAIL is written under 6311 here (`ah-ofra`).
        let ordered = OrderedUnits::from_document("unit 6311\nsail sw\n");
        let passenger = report
            .units()
            .find(|unit| unit.unit_id == "13848")
            .expect("13848 is aboard Frozen Tomb [194]")
            .clone();

        assert_eq!(
            steps_followed_by(&report, &ruleset, &ordered, &passenger),
            Some(&[MoveStep::Go(crate::movement::graph::Direction::Southwest)][..]),
            "13848 wrote nothing and stands in the vessel 13401 is sailing"
        );
    }

    /// A unit that writes SAIL and then LEAVE still gave the order - the server reads the SAIL
    /// line before running the LEAVE - so its passengers must still be carried. Asking where the
    /// captain *ends up* would strand them, which is why `could_captain` is a second predicate.
    #[test]
    fn a_captain_that_also_leaves_still_carries_its_passengers() {
        assert_eq!(
            followed("unit 10575\nsail se\nLEAVE\n", "10594"),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )])
        );
    }
}
