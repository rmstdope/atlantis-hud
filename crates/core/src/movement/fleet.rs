//! Which movement order a unit actually travels by.
//!
//! A unit standing aboard a ship writes no order of its own: the unit sailing the hull writes
//! `SAIL`, and everyone aboard goes with it. Every reader that wants to know where a unit ends the
//! month therefore has the same two-part question to answer, and this module answers it once so a
//! second reader cannot answer it differently - which is exactly the disagreement ah-p1p, ah-l2i
//! and ah-048 were each filed for.

use std::collections::{BTreeMap, BTreeSet};

use crate::movement::chain::{ChainedRoute, RouteChain};
use crate::movement::orders::MoveStep;
use crate::movement::rules::Ruleset;
use crate::orders::blocks::OrderedUnitKey;
use crate::orders::intents::Intent;
use crate::orders::standing::{self, standing_after, Boarding, BoardingOrder};
use crate::report::model::{ReportRegion, ReportUnit, Structure};
use crate::report::ParsedReport;

/// Each unit's movement lines, chained into one route and read once from the whole orders document.
///
/// This is the only walk of the orders document that chains a route: `effects::Working` reads each
/// row's route from here rather than chaining one of its own (`ah-xmqo`). Every route is keyed by
/// an [`OrderedUnitKey`]: a block's by its unit number, a `FORM` block's by the 1-based line of the
/// `FORM` that opened it, in one map, so a rule over the map reaches both (`ah-74y9`). A `TURN`
/// block holds orders for the turn after this one and is skipped, and movement inside a `FORM`
/// block says nothing about where the unit whose block it is goes next. A unit's movement lines
/// are chained by `movement::chain::RouteChain` (`rules/move`: "Multiple MOVE orders given by one
/// unit will chain together."); a different month-long order replaces the chain, as
/// `orders::semantics::month_segments` states.
///
/// This is the document as **written**, and it answers nothing about routes: whether a route closed
/// by a TEACH runs turns on the settled month, which only a report can say. [`Self::settle`] turns
/// it into the [`OrderedUnits`] every movement reader takes, so no reader can be handed a route the
/// month has not settled (`ah-y1yr`).
#[derive(Debug, Default, Clone)]
pub struct WrittenMovement {
    /// Each unit's route, shown and formed alike.
    routes: BTreeMap<OrderedUnitKey, ChainedRoute>,
    /// The units whose `SAIL` lends hands to their hull. Only ever a shown unit: a formed unit's
    /// `SAIL` is not recorded (see the walk in [`Self::from_document`]), but the set is keyed like
    /// `routes` so [`Self::settle`] drops a teacher from both with one key.
    sailers: BTreeSet<OrderedUnitKey>,
    /// Each unit's ENTER and LEAVE orders, in the order they were written. A unit that wrote
    /// neither is absent, and the report's own answer stands for it.
    ///
    /// The orders themselves are kept rather than the answer, because two different questions are
    /// asked of them - see [`crate::orders::standing`], which holds both and says why they differ.
    boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>>,
    /// Each unit's syntactically valid `PROMOTE` targets this month, in the order written.
    promotes_by_unit: BTreeMap<String, Vec<String>>,
    /// The units, shown or formed, whose block ends its movement with a TEACH
    /// ([`RouteChain::closed_by_teach`]): whether their route runs turns on the settled month,
    /// which this reader cannot see, so [`Self::settle`] decides it (`ah-0x6x`, `ah-r3rv`).
    closed_by_teach: BTreeSet<OrderedUnitKey>,
}

/// This month's movement once it is settled: which route each unit walks or sails, whose `SAIL`
/// lends hands, and where each unit stands after its ENTER and LEAVE.
///
/// The one input every movement reader takes - the preview, the shipment measures, the wall check,
/// the map trace, the passage claims and the fleet-course check. Its only constructors settle the
/// month first ([`Self::of_month`], [`WrittenMovement::settle`]), so a rule that stops a unit moving
/// is applied once, in [`WrittenMovement::settle`], and every reader gets it (`ah-y1yr`; before it
/// each caller had to remember the settlement, and `ah-0x6x` needed three rounds to find them).
/// `Default` is the empty month: nobody moves.
#[derive(Debug, Default, Clone)]
pub struct OrderedUnits(WrittenMovement);

impl WrittenMovement {
    /// Reads every unit's block out of one orders document. `None` reads it under the New Origins
    /// lexical rules.
    #[must_use]
    pub fn from_document(orders_document: &str, ruleset: Option<&Ruleset>) -> Self {
        use crate::orders::walk::{walk, BlockKind, Event};

        let mut chains: BTreeMap<OrderedUnitKey, RouteChain> = BTreeMap::new();
        let mut promotes_by_unit: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>> = BTreeMap::new();
        let mut sailers = BTreeSet::new();
        let mut current: Option<String> = None;
        // The `FORM` blocks currently open, innermost last, each holding the line of the `FORM`
        // that opened it - or `None` for a FORM whose alias could not be read, which still opens a block
        // so its orders do not fall through to the unit outside it. The nesting rules themselves
        // live in `orders::blocks`, driven by this reader, `Working::visit` and
        // `intents::FormReader` alike, so they cannot drift apart again (`ah-i33f`).
        let mut forms: crate::orders::blocks::FormStack<usize> =
            crate::orders::blocks::FormStack::new();

        walk(orders_document, ruleset, |event| match event {
            Event::Unit(line) => {
                current = line.arguments.first().map(|id| id.text.to_string());
                forms.reset();
            }
            // A directive ends the block, as `effects::Working` and `intents::FormReader` read it.
            Event::Directive(_) => {
                current = None;
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
                        .map(|_| line.number),
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
                let Some(intent) =
                    crate::orders::intents::read_order(line.command, line.arguments, ruleset)
                else {
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

                // A `FORM` block's route is keyed by the line of its `FORM`, not by `new-<alias>`:
                // that id is unique only inside its hex (`rules/form`) and this reader sees no
                // regions (`ah-5nqc`). `effects::Working` resolves aliases by `(region, alias)` and
                // asks for the line of each `FORM` it took up (`ah-xmqo`).
                //
                // Every readable order goes in, not only movement: a month-long order between two
                // movement lines breaks their chain (`movement::chain::RouteChain`).
                match &owner {
                    crate::orders::blocks::Owner::Block => {
                        if let Some(unit_id) = current.clone() {
                            chains
                                .entry(OrderedUnitKey::Shown(unit_id))
                                .or_default()
                                .push(&line.command.text, &intent);
                        }
                    }
                    crate::orders::blocks::Owner::Formed(form_line) => chains
                        .entry(OrderedUnitKey::Formed(**form_line))
                        .or_default()
                        .push(&line.command.text, &intent),
                    crate::orders::blocks::Owner::Nobody => {}
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
                        sailers.insert(OrderedUnitKey::shown(unit_id));
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

        // A SAIL a later month-long order replaced will not run, so it lends no hands to the
        // hull's course either (`ah-osny`).
        sailers.retain(|key| !chains.get(key).is_some_and(RouteChain::replaced));
        let closed_by_teach: BTreeSet<OrderedUnitKey> = chains
            .iter()
            .filter(|(_, chain)| chain.closed_by_teach())
            .map(|(key, _)| key.clone())
            .collect();
        let routes: BTreeMap<OrderedUnitKey, ChainedRoute> = chains
            .into_iter()
            .filter_map(|(key, chain)| chain.into_route().map(|route| (key, route)))
            .collect();
        // Only a TEACH that leaves something to replace: most teachers wrote no movement at all,
        // and those must not cost `settle` a settlement.
        let closed_by_teach = closed_by_teach
            .into_iter()
            .filter(|key| routes.contains_key(key) || sailers.contains(key))
            .collect();

        Self {
            routes,
            sailers,
            boardings_by_unit,
            promotes_by_unit,
            closed_by_teach,
        }
    }

    /// Whether any unit's movement waits on [`Self::settle`] - for a caller that has to prepare the
    /// report it settles against, and would rather not when nothing waits.
    #[must_use]
    pub fn waits_on_teachers(&self) -> bool {
        !self.closed_by_teach.is_empty()
    }

    /// This reading as the month settles it, for a caller holding the report.
    ///
    /// A TEACH spends the month only for a unit that can teach - `rules/skills_teaching`:
    /// "Only leaders may use the TEACH order." - judged on the settled month, after this month's
    /// GIVE, TAKE and BUY. When it does, it is the last month-long order and the one that runs, so
    /// a MOVE or SAIL before it does not: the unit walks nowhere and lends no hands to a hull's
    /// course. Which units that is comes from [`crate::orders::semantics::month_long_teachers`],
    /// the same settlement the checker's "will not run" reads, so the map, the preview and the
    /// shipment measure agree with it (`ah-0x6x`). Shown and formed units share one key
    /// ([`OrderedUnitKey`]), so one loop settles both (`ah-r3rv`, `ah-74y9`). Costs nothing when no
    /// block ends its movement on a TEACH.
    #[must_use]
    pub fn settle(
        mut self,
        report: &ParsedReport,
        orders_document: &str,
        ruleset: Option<&Ruleset>,
    ) -> OrderedUnits {
        if self.waits_on_teachers() {
            let teachers =
                crate::orders::semantics::month_long_teachers(report, orders_document, ruleset);
            for key in std::mem::take(&mut self.closed_by_teach) {
                if teachers.contains(&key) {
                    self.routes.remove(&key);
                    self.sailers.remove(&key);
                }
            }
        }
        OrderedUnits(self)
    }
}

#[cfg(test)]
impl OrderedUnits {
    /// The month settled against a report that shows no unit, for a test of the document's own
    /// shape with no report to hand. Nobody's TEACH can be judged there, so a test whose answer
    /// turns on one settles against its fixture with [`Self::of_month`] instead.
    pub(crate) fn unreported(orders_document: &str, ruleset: Option<&Ruleset>) -> Self {
        Self::of_month(&ParsedReport::default(), orders_document, ruleset)
    }
}

impl OrderedUnits {
    /// This month's movement, read from the orders document and settled against the report it was
    /// written for. `None` reads the document under the New Origins lexical rules.
    #[must_use]
    pub fn of_month(
        report: &ParsedReport,
        orders_document: &str,
        ruleset: Option<&Ruleset>,
    ) -> Self {
        WrittenMovement::from_document(orders_document, ruleset).settle(
            report,
            orders_document,
            ruleset,
        )
    }

    /// The route a unit's own block chains to, if it wrote one. A formed unit's is the one chained
    /// inside its `FORM` block, when that block's alias could be read.
    pub(crate) fn route(&self, key: &OrderedUnitKey) -> Option<&ChainedRoute> {
        self.0.routes.get(key)
    }

    /// The unit's own movement steps, if it wrote any.
    #[must_use]
    pub fn steps_for(&self, key: &OrderedUnitKey) -> Option<&[MoveStep]> {
        self.route(key).map(|route| route.steps.as_slice())
    }

    /// Whether this unit's own movement order was a `SAIL` naming a course.
    ///
    /// Distinct from [`Self::issues_sail`], which answers participation - a bare `SAIL` lends a
    /// pair of hands and sets no course.
    #[must_use]
    pub fn sails_a_course(&self, key: &OrderedUnitKey) -> bool {
        self.route(key).is_some_and(|route| route.sail)
    }

    /// The units this unit named in a syntactically valid `PROMOTE` this month, in the order they
    /// were written.
    #[must_use]
    pub fn promotes_of(&self, unit_id: &str) -> &[String] {
        self.0
            .promotes_by_unit
            .get(unit_id)
            .map_or(&[][..], Vec::as_slice)
    }

    #[must_use]
    pub(crate) fn issues_sail(&self, key: &OrderedUnitKey) -> bool {
        self.0.sailers.contains(key)
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
        self.0
            .boardings_by_unit
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

    /// Whether this unit issued an ENTER for `structure_id`.
    #[must_use]
    pub fn enters(&self, unit: &ReportUnit, structure_id: &str) -> bool {
        self.boardings_of(&unit.unit_id)
            .any(|boarding| boarding == Boarding::Enter(structure_id))
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
/// The report's owner remains in charge unless it LEAVEs and another unit ENTERs that hull. The
/// first such entrant takes ownership ("The first unit to enter an object is considered to be the
/// owner", `rules/world_structures`; `rules/sequenceofevents` runs ENTER and LEAVE before PROMOTE
/// and movement); then each valid `PROMOTE` written by the owner to a unit aboard the same hull.
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
        Some(owner) if ordered.structure_of(owner) == Some(structure_id) => owner,
        Some(owner) => region
            .units
            .iter()
            .find(|unit| ordered.enters(unit, structure_id))
            .unwrap_or(owner),
        None => region
            .units
            .iter()
            .find(|unit| ordered.structure_of(unit) == Some(structure_id))?,
    }
    .unit_id
    .clone();

    // Each promotion is followed in turn, so a hull handed on twice in one month ends with the
    // unit actually holding it. `seen` bounds the walk: a document can name a cycle.
    let mut seen: BTreeSet<String> = BTreeSet::new();
    while seen.insert(owner.clone()) {
        let Some(next) = ordered
            .promotes_of(&owner)
            .iter()
            .find(|target| {
                region.units.iter().any(|unit| {
                    &unit.unit_id == *target && ordered.structure_of(unit) == Some(structure_id)
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
    let steps = if ordered.sails_a_course(&OrderedUnitKey::shown(&owner_id)) {
        ordered.steps_for(&OrderedUnitKey::shown(&owner_id))
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
    course_followed(
        report,
        ruleset,
        ordered,
        unit,
        ordered.steps_for(&OrderedUnitKey::shown(&unit.unit_id)),
        ordered.sails_a_course(&OrderedUnitKey::shown(&unit.unit_id)),
    )
}

/// The steps `unit` travels by, given its own movement: its own `MOVE` wins, and otherwise it
/// goes where a priceable hull it stands in is sailed. `own` and `own_is_sail` are the unit's
/// own order, however the caller found it - a formed unit's come from its settled row
/// (`ah-5nqc`).
#[must_use]
pub fn course_followed<'a>(
    report: &ParsedReport,
    ruleset: &crate::movement::rules::Ruleset,
    ordered: &'a OrderedUnits,
    unit: &ReportUnit,
    own: Option<&'a [MoveStep]>,
    own_is_sail: bool,
) -> Option<&'a [MoveStep]> {
    // A unit's own MOVE still wins: standing in a fleet does not stop it walking off, and the map
    // draws what the player typed. Only its own SAIL is the hull's business.
    if own.is_some() && !own_is_sail {
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
        let ordered = OrderedUnits::of_month(&report, orders, Some(&ruleset));
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
        assert!(crate::orders::intents::read_intents(unreadable, None)[0]
            .intents
            .is_empty());
        let ordered = OrderedUnits::unreported(unreadable, None);
        assert_eq!(ordered.steps_for(&OrderedUnitKey::shown("1471")), None);
        assert!(!ordered.issues_sail(&OrderedUnitKey::shown("1471")));

        let bare = "#atlantis 95 pw\nunit 1471\n  SAIL\n#end\n";
        assert_eq!(
            crate::orders::validate_orders(bare, None).diagnostics,
            vec![]
        );
        let intents = &crate::orders::intents::read_intents(bare, None)[0].intents;
        assert_eq!(intents.len(), 1);
        assert!(
            matches!(&intents[0].intent, crate::orders::intents::Intent::Sail { steps, .. } if steps.is_empty()),
            "{intents:?}"
        );
        let ordered = OrderedUnits::unreported(bare, None);
        assert_eq!(ordered.steps_for(&OrderedUnitKey::shown("1471")), None);
        assert!(ordered.issues_sail(&OrderedUnitKey::shown("1471")));
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
        let ordered = OrderedUnits::unreported(orders, None);
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
        let ordered = OrderedUnits::unreported(orders, None);
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

    #[test]
    fn a_builder_who_leaves_cannot_keep_or_promote_the_hull() {
        assert_eq!(
            scene_owner(
                "unit 900\nLEAVE\nunit 903\nENTER 329\nPROMOTE 902\nunit 902\nSAIL SE\n",
                "329"
            ),
            Some("902".to_string()),
            "after the builder leaves, the first entrant promotes the sailor"
        );
        assert_eq!(
            scene_course(
                "unit 900\nLEAVE\nunit 903\nENTER 329\nPROMOTE 902\nunit 902\nSAIL SE\n",
                "329"
            ),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "the promoted sailor owns the hull and its course"
        );
    }

    #[test]
    fn a_passenger_who_reenters_can_replace_a_departing_builder() {
        assert_eq!(
            scene_owner(
                "unit 900\nLEAVE\nunit 901\nLEAVE\nENTER 329\nPROMOTE 902\nunit 902\nSAIL SE\n",
                "329"
            ),
            Some("902".to_string()),
            "a passenger who reenters can promote the sailor"
        );
        assert_eq!(
            scene_course(
                "unit 900\nLEAVE\nunit 901\nLEAVE\nENTER 329\nPROMOTE 902\nunit 902\nSAIL SE\n",
                "329"
            ),
            Some(vec![MoveStep::Go(
                crate::movement::graph::Direction::Southeast
            )]),
            "the promoted sailor owns the hull and its course"
        );
    }

    fn scene_followed(orders: &str, unit_id: &str) -> Option<Vec<MoveStep>> {
        let mut cache = ReportCache::new();
        let report = cache.classified(&owner_scene(), RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let ordered = OrderedUnits::of_month(&report, orders, Some(&ruleset));
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
        assert!(OrderedUnits::unreported("unit 10575\nSAIL SE\n", None)
            .sails_a_course(&OrderedUnitKey::shown("10575")));
        assert!(!OrderedUnits::unreported("unit 10575\nMOVE N\n", None)
            .sails_a_course(&OrderedUnitKey::shown("10575")));
        assert!(
            !OrderedUnits::unreported("unit 10575\nSAIL\n", None)
                .sails_a_course(&OrderedUnitKey::shown("10575")),
            "a bare SAIL stores no steps, so it names no course"
        );
        assert_eq!(
            OrderedUnits::unreported("unit 900\nPROMOTE 901\n", None).promotes_of("900"),
            ["901".to_string()]
        );
    }

    #[test]
    fn bare_sail_participates_but_only_directional_sail_departs() {
        let bare = OrderedUnits::unreported("unit 10575\nSAIL\n", None);
        let in_only = OrderedUnits::unreported("unit 10575\nSAIL IN\n", None);
        let out_only = OrderedUnits::unreported("unit 10575\nSAIL OUT\n", None);
        let directional = OrderedUnits::unreported("unit 10575\nSAIL SE\n", None);

        assert!(bare.issues_sail(&OrderedUnitKey::shown("10575")));
        assert!(!in_only.issues_sail(&OrderedUnitKey::shown("10575")));
        assert!(!out_only.issues_sail(&OrderedUnitKey::shown("10575")));
        assert!(directional.issues_sail(&OrderedUnitKey::shown("10575")));
    }

    /// A STUDY after a SAIL replaces it ("STUDY replaces this SAIL as the unit's month-long order,
    /// so this SAIL will not run"), so the unit sets no course and lends no hands (`ah-osny`).
    #[test]
    fn a_sail_a_later_study_replaced_neither_departs_nor_participates() {
        for orders in [
            "unit 10575\nSAIL SE\nSTUDY COMB\n",
            "unit 10575\nSAIL\nSTUDY COMB\n",
        ] {
            let ordered = OrderedUnits::unreported(orders, None);
            assert!(
                !ordered.issues_sail(&OrderedUnitKey::shown("10575")),
                "{orders:?}"
            );
            assert!(
                !ordered.sails_a_course(&OrderedUnitKey::shown("10575")),
                "{orders:?}"
            );
        }
        assert!(
            OrderedUnits::unreported("unit 10575\nSTUDY COMB\nSAIL SE\n", None)
                .issues_sail(&OrderedUnitKey::shown("10575")),
            "the SAIL written last is the one that runs"
        );
    }

    /// `ah-y1yr`: the only way to a route is through the settled month. A leader's TEACH spends
    /// the month (`rules/skills_teaching`: "Only leaders may use the TEACH order."), so the MOVE
    /// and the SAIL it closes are gone before any reader can ask for them; a human's TEACH spends
    /// nothing, so its own still run. The document alone can only say that a settlement is owed.
    #[test]
    fn a_month_read_from_the_document_is_settled_before_any_route_is_read() {
        let text = "Foo (1) Report\n\
                    \n\
                    plain (0,0) in Nowhere, 10 peasants (orcs), $5.\n\
                    \n\
                    * Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\
                    * Hand (901), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/15/0.\n\
                    * Captain (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n";
        let orders = "unit 900\nMOVE N\nTEACH 901\nunit 901\nMOVE N\nTEACH 900\n\
                      unit 902\nSAIL SE\nTEACH 901\n";
        let mut cache = ReportCache::new();
        let report = cache.classified(text, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");

        assert!(WrittenMovement::from_document(orders, Some(&ruleset)).waits_on_teachers());
        let month = OrderedUnits::of_month(&report, orders, Some(&ruleset));
        assert_eq!(
            month.route(&OrderedUnitKey::shown("900")),
            None,
            "the leader teaches instead of walking"
        );
        assert_eq!(month.steps_for(&OrderedUnitKey::shown("900")), None);
        assert!(
            !month.issues_sail(&OrderedUnitKey::shown("902"))
                && !month.sails_a_course(&OrderedUnitKey::shown("902"))
        );
        assert!(
            month.steps_for(&OrderedUnitKey::shown("901")).is_some(),
            "the human's TEACH replaces nothing"
        );
    }

    /// `ah-y1yr`: a unit this month's FORM creates is settled by the same constructor as one the
    /// report shows. Given leaders it can teach (`rules/skills_teaching`: "Only leaders may use
    /// the TEACH order."), so the MOVE its TEACH closes is gone from its FORM line's route; given
    /// humans, its TEACH spends nothing and the route stands.
    #[test]
    fn a_formed_route_an_eligible_teach_replaced_is_settled_out() {
        let text = "Foo (1) Report\n\
                    \n\
                    plain (0,0) in Nowhere, 10 peasants (orcs), $5.\n\
                    \n\
                    * Source (900), Foo (1), 2 leaders [LEAD]. Weight: 20. Capacity: 0/0/30/0.\n\
                    * Other (901), Foo (1), 2 humans [HUMN]. Weight: 20. Capacity: 0/0/30/0.\n";
        let mut cache = ReportCache::new();
        let report = cache.classified(text, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let route_under_form = |giver: &str, tag: &str| {
            let orders =
                format!("unit {giver}\nFORM 1\nMOVE N\nTEACH {giver}\nEND\nGIVE NEW 1 1 {tag}\n");
            OrderedUnits::of_month(&report, &orders, Some(&ruleset))
                .route(&OrderedUnitKey::Formed(2))
                .is_some()
        };

        assert!(
            !route_under_form("900", "LEAD"),
            "a formed leader teaches instead"
        );
        assert!(
            route_under_form("901", "HUMN"),
            "a formed human still walks"
        );
    }

    /// `ah-74y9`: a unit the report shows and a unit this month's FORM creates are keyed alike, so
    /// the one settlement rule reaches both without a second change. A leader can teach
    /// (`rules/skills_teaching`: "Only leaders may use the TEACH order."), so the shown leader's
    /// and the formed leader's MOVE are both replaced, while a formed human's still runs.
    #[test]
    fn one_settlement_drops_a_shown_and_a_formed_teachers_route_alike() {
        let text = "Foo (1) Report\n\
                    \n\
                    plain (0,0) in Nowhere, 10 peasants (orcs), $5.\n\
                    \n\
                    * Source (900), Foo (1), 2 leaders [LEAD]. Weight: 20. Capacity: 0/0/30/0.\n\
                    * Other (901), Foo (1), 2 humans [HUMN]. Weight: 20. Capacity: 0/0/30/0.\n";
        let mut cache = ReportCache::new();
        let report = cache.classified(text, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        // Lines: 1 `unit 900`, 2 `FORM 1`, ... 7 `unit 901`, 8 `FORM 2`.
        let orders = "unit 900\nFORM 1\nMOVE N\nTEACH 900\nEND\nGIVE NEW 1 1 LEAD\n\
                      unit 901\nFORM 2\nMOVE N\nTEACH 901\nEND\nGIVE NEW 2 1 HUMN\n\
                      unit 900\nMOVE N\nTEACH 901\n";
        let month = OrderedUnits::of_month(&report, orders, Some(&ruleset));

        assert_eq!(month.route(&OrderedUnitKey::shown("900")), None);
        assert_eq!(month.route(&OrderedUnitKey::Formed(2)), None);
        assert!(
            month.route(&OrderedUnitKey::Formed(8)).is_some(),
            "a formed human's TEACH replaces nothing"
        );
    }

    /// `ah-0x6x`: a leader's TEACH spends the month (`rules/skills_teaching`: "Only leaders
    /// may use the TEACH order."), so once the month is settled its earlier SAIL neither sets a course nor lends
    /// hands. A human's TEACH spends nothing, so its SAIL still runs.
    #[test]
    fn a_sail_an_eligible_teach_replaced_neither_departs_nor_participates() {
        let text = "Foo (1) Report\n\
                    \n\
                    plain (0,0) in Nowhere, 10 peasants (orcs), $5.\n\
                    \n\
                    * Captain (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\
                    * Hand (901), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/15/0.\n";
        let orders = "unit 900\nSAIL SE\nTEACH 901\nunit 901\nSAIL SE\nTEACH 900\n";
        let mut cache = ReportCache::new();
        let report = cache.classified(text, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");

        let written = WrittenMovement::from_document(orders, Some(&ruleset));
        assert!(
            written.waits_on_teachers(),
            "the document alone cannot judge a TEACH"
        );
        let settled = written.settle(&report, orders, Some(&ruleset));
        assert!(!settled.issues_sail(&OrderedUnitKey::shown("900")));
        assert!(!settled.sails_a_course(&OrderedUnitKey::shown("900")));
        assert!(settled.issues_sail(&OrderedUnitKey::shown("901")));
        assert!(settled.sails_a_course(&OrderedUnitKey::shown("901")));
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
        let ordered = OrderedUnits::of_month(&report, orders, None);
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
        let ordered = OrderedUnits::unreported("unit 6311\nsail sw\n", None);
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

    /// `rules/move`: "Multiple MOVE orders given by one unit will chain together."
    #[test]
    fn chained_move_lines_are_one_route() {
        use crate::movement::graph::Direction::{North, Northeast};
        let ordered = OrderedUnits::unreported("unit 900\nMOVE N\nMOVE NE\n", None);
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("900")),
            Some(&[MoveStep::Go(North), MoveStep::Go(Northeast)][..])
        );
    }

    /// `rules/sail`: `SAIL N` / `SAIL NW` is the same as `SAIL N NW`.
    #[test]
    fn chained_sail_lines_are_one_course() {
        use crate::movement::graph::Direction::{North, Northwest};
        let ordered = OrderedUnits::unreported("unit 10575\nSAIL N\nSAIL NW\n", None);
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("10575")),
            Some(&[MoveStep::Go(North), MoveStep::Go(Northwest)][..])
        );
        assert!(ordered.sails_a_course(&OrderedUnitKey::shown("10575")));
    }

    #[test]
    fn a_work_between_two_moves_leaves_only_the_second() {
        use crate::movement::graph::Direction::South;
        let ordered = OrderedUnits::unreported("unit 900\nMOVE N\nWORK\nMOVE S\n", None);
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("900")),
            Some(&[MoveStep::Go(South)][..])
        );
    }

    #[test]
    fn a_formed_units_move_lines_are_not_the_parents() {
        use crate::movement::graph::Direction::{North, Northeast};
        let ordered = OrderedUnits::unreported(
            "unit 900\nMOVE N\nFORM 1\nMOVE S\nMOVE SE\nEND\nMOVE NE\n",
            None,
        );
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("900")),
            Some(&[MoveStep::Go(North), MoveStep::Go(Northeast)][..])
        );
    }

    /// `newage trident rules/orders`: "A semicolon ends whatever word it lands in, so it starts a
    /// comment wherever it appears".
    #[test]
    fn a_trident_comment_on_a_movement_line_is_read_as_a_comment() {
        use crate::movement::graph::Direction::Southeast;
        let trident = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
            .expect("the Trident ruleset loads");
        let ordered = OrderedUnits::unreported("unit 900\nMOVE SE;scouting\n", Some(&trident));
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("900")),
            Some(&[MoveStep::Go(Southeast)][..])
        );
    }

    /// `rules/orders` closes the document with `#END`, so an order after a directive belongs to
    /// no unit - as `effects::Working` and `intents::FormReader` already read it.
    #[test]
    fn an_order_after_a_directive_belongs_to_no_unit() {
        use crate::movement::graph::Direction::North;
        let ordered = OrderedUnits::unreported("unit 900\nMOVE N\n#end\nMOVE S\n", None);
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("900")),
            Some(&[MoveStep::Go(North)][..])
        );
    }

    #[test]
    fn a_form_blocks_route_is_recorded_under_its_form_line() {
        use crate::movement::graph::Direction::{North, Northeast, South, Southeast};
        let ordered = OrderedUnits::unreported(
            "unit 900\nMOVE N\nFORM 1\nMOVE S\nMOVE SE\nEND\nMOVE NE\n",
            None,
        );
        let formed = ordered
            .route(&OrderedUnitKey::Formed(3))
            .expect("the FORM on line 3 chains a route");
        assert_eq!(
            formed.steps,
            vec![MoveStep::Go(South), MoveStep::Go(Southeast)]
        );
        assert_eq!(formed.command, "MOVE");
        assert!(!formed.sail);
        assert_eq!(ordered.route(&OrderedUnitKey::Formed(1)), None);
        assert_eq!(
            ordered.steps_for(&OrderedUnitKey::shown("900")),
            Some(&[MoveStep::Go(North), MoveStep::Go(Northeast)][..])
        );

        let unreadable = OrderedUnits::unreported("unit 900\nFORM 0\nMOVE S\nEND\n", None);
        assert_eq!(unreadable.route(&OrderedUnitKey::Formed(2)), None);
    }

    /// `ah-r3rv`: a FORM block whose movement a TEACH closed waits on the settlement; one whose
    /// TEACH replaced no movement leaves nothing to drop and must not cost one.
    #[test]
    fn only_a_formed_teach_closing_a_route_waits_on_the_settlement() {
        let closing =
            WrittenMovement::from_document("unit 900\nFORM 1\nMOVE N\nTEACH 900\nEND\n", None);
        assert!(closing.waits_on_teachers());
        let teaching_only =
            WrittenMovement::from_document("unit 900\nFORM 1\nTEACH 900\nEND\n", None);
        assert!(!teaching_only.waits_on_teachers());
    }
}
