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
use crate::orders::standing::{self, Boarding, BoardingOrder, HexStandings, Leaver};
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
    /// Every unit each unit's `EVICT` orders name this month, in the order written (`ah-0ace`).
    evicts_by_unit: BTreeMap<String, Vec<String>>,
    /// Every unit this month's `FORM` blocks create, keyed by the line of its `FORM`
    /// ([`FormedAtPromotion`], `ah-vweq`). A `FORM` whose alias could not be read creates nobody
    /// here, as it moves nobody.
    formed: BTreeMap<usize, FormedAtPromotion>,
    /// The last `NOCROSS` each unit's own block writes this month. `rules/sequenceofevents` runs
    /// NOCROSS among the first instant orders, before LEAVE, so this is the flag a LEAVE at sea
    /// meets ([`standing::leave_refused_at_sea`]).
    nocross_by_unit: BTreeMap<String, bool>,
    /// The units, shown or formed, whose block ends its movement with a TEACH
    /// ([`RouteChain::closed_by_teach`]): whether their route runs turns on the settled month,
    /// which this reader cannot see, so [`Self::settle`] decides it (`ah-0x6x`, `ah-r3rv`).
    closed_by_teach: BTreeSet<OrderedUnitKey>,
    /// What the standing rule knows about each hex the report shows, filled by [`Self::settle`]
    /// ([`HexStandings`], `ah-6udn`). Empty until then, when every hex is undescribed.
    hexes: HexStandings,
}

/// A unit a `FORM` block creates, and the structure it stands in when `Game::RunPromoteOrders`
/// runs (`ah-vweq`). Where in the object's list it stands is [`occupants_after_boarding`]'s: one
/// that stays where it was formed ahead of every entrant, since the engine appends it as the
/// `FORM` is read, before any ENTER runs (`ah-7ful`).
///
/// `rules/form`: the new unit is "in the same structure if any" as the unit that formed it -
/// `../Atlantis parseorders.cpp` moves it into its former's object as the `FORM` is read
/// (`temp->MoveUnit(former->object)`), so into the structure the report shows the block's unit in,
/// whatever that unit's own ENTER or LEAVE later does. Its own ENTER and LEAVE then run with
/// everyone else's, before the PROMOTEs. Whether it gains men is decided only later, by GIVE and
/// BUY (`rules/sequenceofevents`), and an empty unit is deleted only after that
/// (`Game::DeleteEmptyUnits`), so every formed unit is in its object when the PROMOTEs and EVICTs
/// run.
#[derive(Debug, Clone)]
struct FormedAtPromotion {
    /// `new-<alias>`, as [`crate::orders::intents::promoted_unit`] names it.
    unit_id: String,
    /// The unit whose block the outermost `FORM` stands in: a nested `FORM`'s former stands in
    /// the same object, so the report's structure is that unit's.
    former: String,
    /// The formed unit's own ENTER and LEAVE orders, in the order written.
    boardings: Vec<BoardingOrder>,
    /// Its NOCROSS when its LEAVE runs, where this month's orders set it
    /// ([`crate::orders::blocks::FormedUnit::nocross`]); `None` leaves the former's report flag.
    nocross: Option<bool>,
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
        use crate::orders::walk::{walk, Event};

        let mut chains: BTreeMap<OrderedUnitKey, RouteChain> = BTreeMap::new();
        let mut promotes_by_unit: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut evicts_by_unit: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut formed: BTreeMap<usize, FormedAtPromotion> = BTreeMap::new();
        let mut boardings_by_unit: BTreeMap<String, Vec<BoardingOrder>> = BTreeMap::new();
        let mut nocross_by_unit: BTreeMap<String, bool> = BTreeMap::new();
        let mut sailers = BTreeSet::new();
        // What each `FORM` creates, whose block each order is in, and every flag order, read once
        // for this reader, `effects::Working` and `intents::FormReader` alike (`ah-i33f`,
        // `ah-0vc6`). This reader sees no report, so it knows no hexes and no alias is taken here.
        let mut forms = crate::orders::blocks::FormBlocks::new();

        walk(orders_document, ruleset, |event| {
            let step = forms.visit(&event, ruleset, crate::orders::blocks::Hexes::Unknown);
            let current = forms.current().map(str::to_string);
            let formed_at = |index: usize| forms.formed()[index].form_line;
            match (step, event) {
                (crate::orders::blocks::Step::Formed(index), Event::Open { .. }) => {
                    let record = &forms.formed()[index];
                    formed.insert(
                        record.form_line,
                        FormedAtPromotion {
                            unit_id: record.unit_id(),
                            former: record.block_unit.clone(),
                            boardings: Vec::new(),
                            nocross: None,
                        },
                    );
                }
                // `depth.turn == 0` rather than `depth == Depth::default()`: a `TURN` block holds next
                // month's orders and says nothing about this one, but a `FORM` block's own MOVE is the
                // formed unit's and must be read (`ah-4hux`). `Depth` counts the two separately.
                (crate::orders::blocks::Step::Order { flag }, Event::Order { line, .. }) => {
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
                        if let Some(target) = crate::orders::intents::promoted_unit(
                            line.command,
                            line.arguments,
                            ruleset,
                        ) {
                            promotes_by_unit
                                .entry(unit_id.clone())
                                .or_default()
                                .push(target);
                        }
                        let evicted = crate::orders::intents::evicted_units(
                            line.command,
                            line.arguments,
                            ruleset,
                        );
                        if !evicted.is_empty() {
                            evicts_by_unit
                                .entry(unit_id.clone())
                                .or_default()
                                .extend(evicted);
                        }
                        if let Some(crate::report::flags::FlagChange::Toggle {
                            setting: crate::report::flags::Setting::NoCross,
                            on,
                        }) = flag
                        {
                            nocross_by_unit.insert(unit_id.clone(), on);
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
                        crate::orders::blocks::Owner::Formed(index) => chains
                            .entry(OrderedUnitKey::Formed(formed_at(**index)))
                            .or_default()
                            .push(&line.command.text, &intent),
                        crate::orders::blocks::Owner::Nobody => {}
                    }
                    // Skipped inside a FORM block for the reason above: those orders are applied by
                    // `Working` to the formed unit's own row already. Kept apart for who stands in an
                    // object when the PROMOTEs run, which `Working` cannot answer this early
                    // (`ah-vweq`).
                    let (crate::orders::blocks::Owner::Block, Some(unit_id)) =
                        (&owner, current.as_ref())
                    else {
                        if let crate::orders::blocks::Owner::Formed(index) = owner {
                            if let Some(formed) = formed.get_mut(&formed_at(*index)) {
                                match intent {
                                    Intent::Enter { structure } => {
                                        formed.boardings.push(BoardingOrder::Enter(structure));
                                    }
                                    Intent::Leave => formed.boardings.push(BoardingOrder::Leave),
                                    _ => {}
                                }
                            }
                        }
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
            }
        });
        // Its own NOCROSS orders are only all read once the walk has passed its block.
        for record in forms.formed() {
            if let Some(formed) = formed.get_mut(&record.form_line) {
                formed.nocross = record.nocross();
            }
        }

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
            evicts_by_unit,
            formed,
            nocross_by_unit,
            closed_by_teach,
            // Only a report says what a hex holds; `settle` fills this from one.
            hexes: HexStandings::default(),
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
        self.hexes = HexStandings::of(report, ruleset);
        let mut settled = OrderedUnits(self);
        if !settled.0.evicts_by_unit.is_empty() {
            for region in &report.regions {
                let evicted = settled.evictions_in(region);
                if !evicted.is_empty() {
                    settled.0.hexes.set_evictions(&region.region_id, evicted);
                }
            }
        }
        settled
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

    /// Whether the unit won't cross water when its LEAVE runs: this month's own `NOCROSS` if its
    /// block writes one, otherwise the report's "won't cross water" (`rules/nocross`).
    #[must_use]
    pub fn wont_cross_water(&self, unit: &ReportUnit) -> bool {
        self.0
            .nocross_by_unit
            .get(&unit.unit_id)
            .copied()
            .unwrap_or_else(|| {
                crate::report::flags::holds(&unit.flags, crate::report::flags::Setting::NoCross)
            })
    }

    #[must_use]
    pub(crate) fn issues_sail(&self, key: &OrderedUnitKey) -> bool {
        self.0.sailers.contains(key)
    }

    /// The structure this unit is in once this month's ENTER/LEAVE orders have run.
    ///
    /// ENTER and LEAVE both run before anything moves, so every reader that asks "what is this
    /// unit standing in when its orders happen" wants this rather than `unit.structure_id`, which
    /// is only where the report found it. The rule is [`crate::orders::standing::standing_after_in`]'s
    /// and is stated only there - an ENTER of a structure the hex does not have moves nobody
    /// (`ah-5maa`), and neither does a LEAVE the game refuses at sea (`ah-djst`); this is the
    /// adapter that reads it out of an orders document.
    ///
    /// This is where a unit *ends up*. For "could this unit be the one sailing the hull" the
    /// question is different and [`Self::could_captain`] answers it.
    ///
    /// A unit its structure's owner EVICTs this month stands outside ([`standing::HexStanding::evicted_by`],
    /// `ah-0ace`): the EVICT runs right after the boardings, before anything else this month.
    #[must_use]
    pub fn structure_of<'a>(&'a self, unit: &'a ReportUnit) -> Option<&'a str> {
        if self
            .0
            .hexes
            .of_region(&unit.region_id)
            .evicted_by(&unit.unit_id)
            .is_some()
        {
            return None;
        }
        self.structure_after_boarding(unit)
    }

    /// The owner whose `EVICT` puts this unit outside its structure this month, if one does
    /// (`ah-0ace`).
    #[must_use]
    pub fn evicted_by(&self, unit: &ReportUnit) -> Option<&str> {
        self.0
            .hexes
            .of_region(&unit.region_id)
            .evicted_by(&unit.unit_id)
    }

    /// Where the unit stands once ENTER and LEAVE have run and before any `EVICT`: the list
    /// `Game::RunPromoteOrders` asks each object's owner of, for its PROMOTE and then its EVICT.
    fn structure_after_boarding<'a>(&'a self, unit: &'a ReportUnit) -> Option<&'a str> {
        self.0.hexes.of_region(&unit.region_id).standing_after(
            unit.structure_id.as_deref(),
            self.boardings_of(&unit.unit_id),
            Leaver {
                wont_cross_water: self.wont_cross_water(unit),
                movement: unit.movement.as_ref(),
            },
        )
    }

    /// Every unit an owner's `EVICT` puts outside in `region`, with that owner (`ah-0ace`).
    ///
    /// `Game::RunPromoteOrders` (../Atlantis `runorders.cpp`) runs each object's owner's PROMOTE,
    /// then each object's owner's EVICT - the owner as the PROMOTE left it (`Object::GetOwner`) -
    /// and errors every other unit's ("EVICT: Must be owner"). `Do1EvictOrder` moves each target
    /// standing in that object to the region's dummy, unless the object is a fleet at sea and the
    /// target cannot really swim ([`crate::orders::standing::eviction_refused_at_sea`]). A unit
    /// formed aboard is in the object ([`Self::formed_at_promotion`]), so an owner's last
    /// `PROMOTE NEW <n>` hands it on and the old owner's EVICT is refused (`ah-vweq`). A formed
    /// owner's own EVICT, and an EVICT naming a formed unit, still evict nobody here. A unit of
    /// another faction is evicted here as the engine evicts it (`Object::GetUnitId` finds any unit
    /// in the object), where `orders::semantics::evictions`
    /// leaves one where the report shows it - a known divergence, since the checks there read a
    /// foreign unit's structure from the report throughout.
    fn evictions_in(&self, region: &ReportRegion) -> BTreeMap<String, String> {
        let hex = self.0.hexes.of_region(&region.region_id);
        let formed = self.formed_at_promotion(region);
        let mut evicted = BTreeMap::new();
        for structure in &region.structures {
            let structure_id = structure.structure_id.as_str();
            let Some(owner) = occupants_after_promotes(region, self, &formed, structure_id)
                .into_iter()
                .next()
            else {
                continue;
            };
            let Some(targets) = self.0.evicts_by_unit.get(&owner) else {
                continue;
            };
            for unit in &region.units {
                if targets.contains(&unit.unit_id)
                    && self.structure_after_boarding(unit) == Some(structure_id)
                    && !hex.eviction_refused(Leaver {
                        wont_cross_water: self.wont_cross_water(unit),
                        movement: unit.movement.as_ref(),
                    })
                {
                    evicted.insert(unit.unit_id.clone(), owner.clone());
                }
            }
        }
        evicted
    }

    /// Every unit this month's `FORM` blocks create in `region`, standing where it stands when the
    /// PROMOTEs and EVICTs run ([`FormedAtPromotion`], `ah-vweq`): in its former's reported
    /// structure, then through its own ENTER and LEAVE. Every one of them, given men or not - the
    /// engine deletes an empty unit only after GIVE and BUY (`Game::DeleteEmptyUnits`), which is
    /// why [`crate::orders::effects`]' formed crews, settled for the movement phase, are not these.
    /// A formed unit's LEAVE at sea is read with the NOCROSS it holds then: what it was formed with
    /// (`Unit::CopyFlags` copies its former's flags whole) and its own NOCROSS orders
    /// ([`crate::orders::blocks::FormedUnit::nocross`]). No formed unit can need it at sea, having
    /// no stated movement of its own: one that can neither swim nor fly is refused either way.
    #[must_use]
    pub fn formed_at_promotion(&self, region: &ReportRegion) -> Vec<FormedCrew> {
        self.formed_placed(region)
            .into_iter()
            .map(|(crew, _)| crew)
            .collect()
    }

    /// [`Self::formed_at_promotion`], each with whether it stands where it was formed (`ah-7ful`):
    /// in its former's reported structure, which no ENTER of its own named. Such a unit joined the
    /// object as its `FORM` was parsed, ahead of every entrant; one whose ENTER is refused stays
    /// there too. Any other formed unit standing in a structure boarded it when ENTER ran.
    fn formed_placed(&self, region: &ReportRegion) -> Vec<(FormedCrew, bool)> {
        let hex = self.0.hexes.of_region(&region.region_id);
        self.0
            .formed
            .iter()
            .filter_map(|(form_line, formed)| {
                let former = region
                    .units
                    .iter()
                    .find(|unit| unit.unit_id == formed.former)?;
                let structure_id = hex.standing_after(
                    former.structure_id.as_deref(),
                    formed.boardings.iter().map(BoardingOrder::as_boarding),
                    Leaver {
                        wont_cross_water: formed.nocross.unwrap_or_else(|| {
                            crate::report::flags::holds(
                                &former.flags,
                                crate::report::flags::Setting::NoCross,
                            )
                        }),
                        movement: None,
                    },
                );
                let in_place = structure_id.is_some()
                    && structure_id == former.structure_id.as_deref()
                    && !formed.boardings.iter().any(|boarding| {
                        structure_id.is_some_and(|id| boarding.as_boarding() == Boarding::Enter(id))
                    });
                Some((
                    FormedCrew {
                        unit_id: formed.unit_id.clone(),
                        region_id: region.region_id.clone(),
                        key: OrderedUnitKey::Formed(*form_line),
                        structure_id: structure_id.map(str::to_string),
                    },
                    in_place,
                ))
            })
            .collect()
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

/// A unit this month's `FORM` creates that is still there when the fleets move: it was given men,
/// or may have been, so `rules/form` does not dissolve it.
///
/// [`fleet_owner`] cannot find these in the report, which does not carry them, so a caller that
/// has the month's formed rows hands them in. A formed unit known to gain nobody is left out by the
/// caller: the engine deletes a unit with no men before anything moves (`Game::DeleteEmptyUnits`,
/// run just ahead of `RunMovementOrders`), which is how `rules/world_structures`' "newly created
/// units cannot own a structure until they contain men" comes about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormedCrew {
    /// `new-<alias>`, unique only inside its hex (`rules/form`).
    pub unit_id: String,
    /// The hex it was formed in.
    pub region_id: String,
    /// How [`OrderedUnits`] keys its route: the line of its `FORM`.
    pub key: OrderedUnitKey,
    /// The structure it stands in once its ENTER and LEAVE have run.
    pub structure_id: Option<String>,
}

/// Who owns a hull once this month's boardings and `PROMOTE`s have run, as a unit id.
///
/// The engine's owner is the first unit in the object's list (`Object::GetOwner`), and LEAVE and
/// ENTER run in one pass before PROMOTE and movement (`Game::RunEnterOrders`;
/// `rules/sequenceofevents`). A unit that leaves is taken off the list and one that enters is
/// appended to its end (`Unit::MoveUnit`), so the list the fleet moves with is: the report's
/// occupants who stayed, in report order ("the first unit listed under the object",
/// `rules/world_structures`), then everyone who boarded. A reported occupant whose last boarding
/// order re-enters the hull it stands in is moved to the end like any other entrant. A unit
/// formed aboard stands between the two (`ah-7ful`): the engine appends a formed unit to its
/// former's object as the `FORM` is parsed (../Atlantis `parseorders.cpp`
/// `temp->MoveUnit(former->object)`), before `Game::RunEnterOrders`, so behind the occupants who
/// stayed and ahead of every entrant. One that boards by its own ENTER is an entrant itself, and
/// stands behind the reported ones ([`occupants_after_boarding`]). Nobody aboard at all is no
/// owner (`ah-877p`).
///
/// A LEAVE at sea by a unit that can neither swim nor fly is refused and moves nobody
/// (`rules/leave`: "If a unit is capable of swimming or flying then this order is usable to leave a
/// boat while at sea"; `Do1EnterOrder`: "LEAVE: Can't leave a ship in the ocean."), so that unit
/// keeps its place - and its ownership. [`OrderedUnits::structure_of`] applies that refusal
/// ([`standing::leave_refused_at_sea`], `ah-djst`), so it is read here like every other answer
/// about who is aboard. The same list order is walked for the
/// month-long phase by `orders::semantics::walk_after_boarding`, whose known gaps (PROMOTE and
/// EVICT reordering, refused ENTERs) this walk shares.
///
/// Then the owner's `PROMOTE`, when it names a unit aboard the same hull - a reported unit, or one
/// in `formed`. Among several `PROMOTE`s from one owner only the **last written** is kept
/// (`ah-nhgo`): `ProcessPromoteOrder` (../Atlantis `parseorders.cpp`) overwrites `u->promote`. One
/// naming a unit that is not aboard promotes nobody (`Do1PromoteOrder`: "PROMOTE: Can't find
/// target."), and an earlier one does not run in its place; `rules/promote` does not settle
/// either question. Only that owner's `PROMOTE` runs (`ah-c1p2`): `Game::RunPromoteOrders`
/// (../Atlantis `runorders.cpp`) runs one per object, written by its owner once ENTER and LEAVE
/// have run (`Object::GetOwner`), and errors every other unit's "PROMOTE: Must be owner" - so the
/// unit it promotes does not hand the hull on again that month. A formed owner's own `PROMOTE` is
/// not followed: `promotes_of` records only a reported unit's block. `None` when no unit can be
/// named at all.
#[must_use]
pub fn fleet_owner(
    region: &ReportRegion,
    ordered: &OrderedUnits,
    formed: &[FormedCrew],
    structure_id: &str,
) -> Option<String> {
    occupants_after_promotes(region, ordered, formed, structure_id)
        .into_iter()
        .next()
}

/// Everyone standing in a structure once this month's boardings and `PROMOTE`s have run, owner
/// first, as unit ids - the object's list [`fleet_owner`] reads its first entry from, by the rules
/// stated there. A structure of any kind, not only a hull: the engine keeps one list per object
/// (`Object::GetOwner`), and `CheckTransportOrders` asks it about a Caravanserai long after the
/// movement phase has taken more units off it (`ah-1jl9`).
///
/// Every unit this month's `FORM`s put in the structure stands in the list while PROMOTE and
/// EVICT run, men or none ([`OrderedUnits::formed_at_promotion`]; `ah-vweq`, `ah-7ful`), but only
/// those `formed` names survive into the answer: one left out is a unit the caller knows to be
/// deleted before anything moves (`Game::DeleteEmptyUnits`), or one it cannot follow. The EVICTs
/// pass every formed unit, and the fleets and `orders::transport` the crews that survive the
/// market (`ah-877p`, `ah-ry88`).
#[must_use]
pub fn occupants_after_promotes(
    region: &ReportRegion,
    ordered: &OrderedUnits,
    formed: &[FormedCrew],
    structure_id: &str,
) -> Vec<String> {
    let placed = ordered.formed_placed(region);
    let mut occupants = occupants_after_boarding(region, ordered, &placed, structure_id);
    // One `PROMOTE` per object, its owner's (`Game::RunPromoteOrders`): the unit it promotes does
    // not run its own that month (`ah-c1p2`).
    let Some(owner) = occupants.first().cloned() else {
        return occupants;
    };
    // Only the last `PROMOTE` the owner wrote is kept (`ProcessPromoteOrder` overwrites
    // `u->promote`), and one naming a unit not in the object promotes nobody (`Do1PromoteOrder`:
    // "PROMOTE: Can't find target.") - `ah-nhgo`. A unit formed aboard is in the object too.
    let promoted = ordered
        .promotes_of(&owner)
        .last()
        .filter(|target| occupants.contains(target));
    if let Some(next) = promoted.cloned() {
        // `Do1PromoteOrder`: the target is taken off the object's list and put back at its head.
        occupants.retain(|unit| unit != &next);
        occupants.insert(0, next);
    }
    // Then the EVICTs (`ah-0ace`): whoever they put outside is no longer in the object's list.
    let hex = ordered.0.hexes.of_region(&region.region_id);
    occupants.retain(|unit| hex.evicted_by(unit).is_none());
    // And the formed units the caller does not hand in.
    occupants.retain(|unit| {
        placed
            .iter()
            .find(|(crew, _)| &crew.unit_id == unit)
            .is_none_or(|(crew, _)| {
                formed
                    .iter()
                    .any(|kept| kept.region_id == region.region_id && kept.key == crew.key)
            })
    });
    occupants
}

/// Everyone standing in a structure once this month's ENTER and LEAVE have run and before any
/// `PROMOTE`, owner first, as unit ids - the list `Game::RunPromoteOrders` asks for its owner, by
/// the rules [`fleet_owner`] states. Its first entry is the one unit whose `PROMOTE` runs
/// (`ah-c1p2`). `orders::semantics::owner_when_promotions_run` reads the same rule from a hex's
/// own units.
///
/// The order is the engine's (`ah-7ful`): the report's occupants who stayed; then the units
/// formed where they stand, which joined as their `FORM`s were parsed; then the reported units
/// that boarded, as `Game::RunEnterOrders` appends them; then the formed units that boarded by
/// their own ENTER. Which of the last two the engine appends first turns on the order it walks
/// the region's objects in, which the report does not show.
#[must_use]
fn occupants_after_boarding(
    region: &ReportRegion,
    ordered: &OrderedUnits,
    placed: &[(FormedCrew, bool)],
    structure_id: &str,
) -> Vec<String> {
    let listed_under = |unit: &ReportUnit| unit.structure_id.as_deref() == Some(structure_id);
    let aboard = |unit: &&ReportUnit| ordered.structure_after_boarding(unit) == Some(structure_id);
    let stayed = region
        .units
        .iter()
        .filter(aboard)
        .filter(|unit| listed_under(unit) && !ordered.enters(unit, structure_id));
    let boarded = region
        .units
        .iter()
        .filter(aboard)
        .filter(|unit| !listed_under(unit) || ordered.enters(unit, structure_id));
    let formed_aboard = |in_place: bool| {
        placed
            .iter()
            .filter(move |(crew, stays)| {
                *stays == in_place && crew.structure_id.as_deref() == Some(structure_id)
            })
            .map(|(crew, _)| crew.unit_id.clone())
    };
    stayed
        .map(|unit| unit.unit_id.clone())
        .chain(formed_aboard(true))
        .chain(boarded.map(|unit| unit.unit_id.clone()))
        .chain(formed_aboard(false))
        .collect()
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

/// [`fleet_owner`], and the course its route sets. A formed owner's route is keyed by its `FORM`
/// line, as every formed unit's is.
#[must_use]
pub fn fleet_course<'o>(
    region: &ReportRegion,
    ordered: &'o OrderedUnits,
    formed: &[FormedCrew],
    structure_id: &str,
) -> FleetCourse<'o> {
    let Some(owner_id) = fleet_owner(region, ordered, formed, structure_id) else {
        return FleetCourse {
            owner_id: None,
            steps: None,
        };
    };
    let key = formed
        .iter()
        .find(|crew| crew.region_id == region.region_id && crew.unit_id == owner_id)
        .map_or_else(|| OrderedUnitKey::shown(&owner_id), |crew| crew.key.clone());
    let steps = if ordered.sails_a_course(&key) {
        ordered.steps_for(&key)
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
///
/// It weighs no formed unit as a hull's owner; [`course_followed`] takes them for a caller that has
/// the month's formed rows (`ah-877p`).
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
        Vec::new,
        unit,
        ordered.steps_for(&OrderedUnitKey::shown(&unit.unit_id)),
        ordered.sails_a_course(&OrderedUnitKey::shown(&unit.unit_id)),
    )
}

/// The steps `unit` travels by, given its own movement: its own `MOVE` wins, and otherwise it
/// goes where a priceable hull it stands in is sailed. `own` and `own_is_sail` are the unit's
/// own order, however the caller found it - a formed unit's come from its settled row
/// (`ah-5nqc`). `formed` answers the month's formed units that survive to move, which can own the
/// hull ([`fleet_owner`]); it is asked only once the unit is found aboard a priceable hull, since
/// answering it can cost a whole settle.
#[must_use]
pub fn course_followed<'a>(
    report: &ParsedReport,
    ruleset: &crate::movement::rules::Ruleset,
    ordered: &'a OrderedUnits,
    formed: impl FnOnce() -> Vec<FormedCrew>,
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
    fleet_course(region, ordered, &formed(), &hull.structure_id).steps
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

    /// [`owner_scene`] moved onto a coast, where a LEAVE always runs: at sea the engine refuses one
    /// from a unit that can neither swim nor fly (`rules/leave`).
    fn coast_scene() -> String {
        owner_scene().replace("ocean (1,1) in Sea", "plain (1,1) in Shire")
    }

    fn course_in(
        scene: &str,
        orders: &str,
        formed: &[FormedCrew],
        structure_id: &str,
    ) -> (Option<String>, Option<Vec<MoveStep>>) {
        let mut cache = ReportCache::new();
        let report = cache.classified(scene, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let region = report
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the scene's hex");
        let ordered = OrderedUnits::of_month(&report, orders, Some(&ruleset));
        let course = fleet_course(region, &ordered, formed, structure_id);
        (course.owner_id, course.steps.map(<[MoveStep]>::to_vec))
    }

    fn scene_owner(orders: &str, structure_id: &str) -> Option<String> {
        course_in(&owner_scene(), orders, &[], structure_id).0
    }

    fn scene_course(orders: &str, structure_id: &str) -> Option<Vec<MoveStep>> {
        course_in(&owner_scene(), orders, &[], structure_id).1
    }

    fn coast_owner(orders: &str, structure_id: &str) -> Option<String> {
        course_in(&coast_scene(), orders, &[], structure_id).0
    }

    fn coast_course(orders: &str, structure_id: &str) -> Option<Vec<MoveStep>> {
        course_in(&coast_scene(), orders, &[], structure_id).1
    }

    /// Where `unit_id` of `scene`'s hex stands once this month's boardings and EVICTs have run.
    fn standing_in(scene: &str, orders: &str, unit_id: &str) -> Option<String> {
        let mut cache = ReportCache::new();
        let report = cache.classified(scene, RULESET);
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let unit = report
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit_id == unit_id)
            .expect("the scene's unit");
        let ordered = OrderedUnits::of_month(&report, orders, Some(&ruleset));
        ordered.structure_of(unit).map(str::to_string)
    }

    /// `rules/evict`: "EVICT [unit] ..." names any number of units, and the owner's EVICT puts
    /// each one outside (`Do1EvictOrder`, `ah-0ace`). The owner itself stays.
    #[test]
    fn an_owners_evict_puts_every_unit_it_names_outside() {
        let orders = "unit 900\nEVICT 901 902\n";
        assert_eq!(standing_in(&coast_scene(), orders, "901"), None);
        assert_eq!(standing_in(&coast_scene(), orders, "902"), None);
        assert_eq!(
            standing_in(&coast_scene(), orders, "900").as_deref(),
            Some("329")
        );
        assert_eq!(
            standing_in(&coast_scene(), "unit 900\nEVICT 901\nEVICT 902\n", "902"),
            None,
            "if multiple EVICT orders are given, all of the units will be evicted"
        );
    }

    /// `Game::RunPromoteOrders` runs the EVICTs after the PROMOTEs, so the EVICT that runs is the
    /// promoted unit's, and the old owner's is refused ("EVICT: Must be owner").
    #[test]
    fn the_evict_that_runs_is_the_owners_once_promote_has_run() {
        let orders = "unit 900\nPROMOTE 901\nEVICT 902\nunit 901\nEVICT 900\n";
        assert_eq!(standing_in(&coast_scene(), orders, "900"), None);
        assert_eq!(
            standing_in(&coast_scene(), orders, "902").as_deref(),
            Some("329")
        );
        assert_eq!(coast_owner(orders, "329"), Some("901".to_string()));
        assert_eq!(
            standing_in(&coast_scene(), "unit 901\nEVICT 902\n", "902").as_deref(),
            Some("329"),
            "901 does not own the hull, so its EVICT moves nobody"
        );
    }

    /// A unit formed aboard stands in its former's object when the PROMOTEs run (`rules/form`: "in
    /// the same structure if any"; `parseorders.cpp` `temp->MoveUnit(former->object)`), so the
    /// owner's last `PROMOTE NEW 1` makes it owner and the old owner's EVICT is refused
    /// ("EVICT: Must be owner") - as `orders::semantics` warns it (`ah-vweq`).
    #[test]
    fn a_unit_formed_aboard_and_promoted_runs_the_evicts_in_place_of_its_former() {
        assert_eq!(
            standing_in(
                &coast_scene(),
                "unit 900\nFORM 1\nEND\nPROMOTE NEW 1\nEVICT 901\n",
                "901"
            )
            .as_deref(),
            Some("329")
        );
    }

    /// A formed unit's own LEAVE runs before the PROMOTEs, so it is not in the object and the
    /// `PROMOTE NEW 1` promotes nobody ("PROMOTE: Can't find target."): its former's EVICT runs.
    #[test]
    fn a_unit_formed_aboard_that_leaves_is_not_promoted() {
        assert_eq!(
            standing_in(
                &coast_scene(),
                "unit 900\nFORM 1\nLEAVE\nEND\nPROMOTE NEW 1\nEVICT 901\n",
                "901"
            ),
            None
        );
    }

    /// `Do1EvictOrder`: "EVICT: Cannot forcibly evict units over ocean." for a target that cannot
    /// really swim; the scene's centaurs swim nothing.
    #[test]
    fn nobody_is_evicted_over_the_ocean_who_cannot_swim() {
        assert_eq!(
            standing_in(&owner_scene(), "unit 900\nEVICT 901\n", "901").as_deref(),
            Some("329")
        );
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

    /// The engine's owner is the first unit in the object's list when the fleet moves
    /// (`Object::GetOwner`); a leaver is taken off that list and an entrant appended to its end
    /// (`Unit::MoveUnit`). So when the builder leaves, the first occupant who **stayed** owns the
    /// hull, ahead of any entrant, and an entrant's PROMOTE is not the owner's and hands on nothing
    /// (`Game::RunPromoteOrders` runs only the owner's) - `ah-877p`, which corrected the first
    /// entrant this test once named.
    #[test]
    fn a_builder_who_leaves_hands_the_hull_to_the_next_unit_aboard() {
        let orders = "unit 900\nLEAVE\nunit 903\nENTER 329\nPROMOTE 902\nunit 902\nSAIL SE\n";
        assert_eq!(
            coast_owner(orders, "329"),
            Some("901".to_string()),
            "901 stayed aboard, so it owns the hull ahead of the entrant 903"
        );
        assert_eq!(
            coast_course(orders, "329"),
            None,
            "901 set no course, so 902's SAIL sails nowhere"
        );
        assert_eq!(
            coast_owner(
                "unit 900\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\nunit 903\nENTER 329\n\
                 PROMOTE 902\n",
                "329"
            ),
            Some("903".to_string()),
            "with every occupant gone, the entrant owns the hull"
        );
        assert_eq!(
            coast_owner("unit 900\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\n", "329"),
            None,
            "a hull everyone left has no owner, not the builder who left it"
        );
    }

    /// `ah-877p` (gh-1491): a unit formed this month that boards a hull every reported occupant
    /// left owns it, and its course is the one its `FORM` block wrote.
    #[test]
    fn a_formed_unit_aboard_owns_a_hull_its_occupants_left() {
        let orders = "unit 900\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\n\
                      unit 903\nFORM 1\nENTER 329\nSAIL SE\nEND\n";
        let crew = FormedCrew {
            unit_id: "new-1".to_string(),
            region_id: "1:1,1".to_string(),
            key: OrderedUnitKey::Formed(8),
            structure_id: Some("329".to_string()),
        };
        assert_eq!(
            course_in(&coast_scene(), orders, std::slice::from_ref(&crew), "329"),
            (
                Some("new-1".to_string()),
                go(crate::movement::graph::Direction::Southeast)
            )
        );
        assert_eq!(
            course_in(&coast_scene(), orders, &[], "329"),
            (None, None),
            "left out by the caller - a formed unit given nobody - it owns nothing"
        );
        let elsewhere = FormedCrew {
            region_id: "1:2,0".to_string(),
            ..crew
        };
        assert_eq!(
            course_in(&coast_scene(), orders, &[elsewhere], "329").0,
            None,
            "a formed unit of another hex is not aboard this one"
        );
    }

    /// `ah-7ful`: the engine adds a formed unit to its former's object as the `FORM` is parsed
    /// (../Atlantis `parseorders.cpp`: `temp->MoveUnit(former->object)`), before
    /// `Game::RunEnterOrders`, and `Unit::MoveUnit` appends - so a unit formed aboard stands
    /// ahead of a reported unit that ENTERs, and owns the hull once every reported occupant left.
    #[test]
    fn a_unit_formed_aboard_stands_ahead_of_a_reported_entrant() {
        let orders = "unit 900\nFORM 1\nEND\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\n\
                      unit 903\nENTER 329\n";
        let crew = FormedCrew {
            unit_id: "new-1".to_string(),
            region_id: "1:1,1".to_string(),
            key: OrderedUnitKey::Formed(2),
            structure_id: Some("329".to_string()),
        };
        assert_eq!(
            course_in(&coast_scene(), orders, std::slice::from_ref(&crew), "329").0,
            Some("new-1".to_string())
        );
    }

    /// `ah-7ful` review: the movement side's EVICT reads the same list. 900 forms NEW 1 aboard
    /// Longship [329] and leaves; 903 and 901 board (901 re-entering), and 903 EVICTs 901. NEW 1
    /// owns the hull when EVICT runs - with no men yet, since `Game::DeleteEmptyUnits` runs
    /// later - so the engine refuses 903's EVICT ("EVICT: Must be owner") and 901 stays aboard.
    #[test]
    fn a_unit_formed_aboard_owns_the_hull_when_evict_runs() {
        let mut cache = ReportCache::new();
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        let report = cache.classified(&coast_scene(), RULESET);
        let deckhands = report
            .units()
            .find(|unit| unit.unit_id == "901")
            .expect("Deckhands is in the scene");
        let stands = |orders: &str| {
            OrderedUnits::of_month(&report, orders, Some(&ruleset))
                .structure_of(deckhands)
                .map(str::to_string)
        };
        let boarding = "unit 901\nENTER 329\nunit 902\nLEAVE\nunit 903\nENTER 329\nEVICT 901\n";
        assert_eq!(
            stands(&format!("unit 900\nLEAVE\n{boarding}")),
            None,
            "with nobody formed, 903 owns the hull and evicts 901"
        );
        assert_eq!(
            stands(&format!("unit 900\nFORM 1\nEND\nLEAVE\n{boarding}")),
            Some("329".to_string())
        );
    }

    /// `ah-7ful` review: a unit formed elsewhere that boards by its own ENTER is an entrant, so
    /// it stands behind a unit formed in place and behind the reported entrants.
    #[test]
    fn a_formed_unit_that_enters_stands_behind_one_formed_in_place() {
        let orders = "unit 903\nFORM 1\nENTER 329\nEND\n\
                      unit 900\nFORM 2\nEND\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\n";
        let entrant = FormedCrew {
            unit_id: "new-1".to_string(),
            region_id: "1:1,1".to_string(),
            key: OrderedUnitKey::Formed(2),
            structure_id: Some("329".to_string()),
        };
        let in_place = FormedCrew {
            unit_id: "new-2".to_string(),
            key: OrderedUnitKey::Formed(6),
            ..entrant.clone()
        };
        assert_eq!(
            course_in(&coast_scene(), orders, &[entrant.clone(), in_place], "329").0,
            Some("new-2".to_string())
        );
        assert_eq!(
            course_in(&coast_scene(), orders, &[entrant], "329").0,
            Some("new-1".to_string()),
            "left out by the caller - given nobody - the unit formed in place is gone by SAIL"
        );
    }

    /// `ah-7ful` review: an ENTER the engine refuses ("ENTER: Can't enter that.", no such
    /// structure here) moves the formed unit nowhere, so it keeps its place ahead of the entrants.
    #[test]
    fn a_formed_unit_whose_enter_is_refused_keeps_its_place() {
        let orders = "unit 900\nFORM 1\nENTER 999\nEND\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\n\
                      unit 903\nENTER 329\n";
        let crew = FormedCrew {
            unit_id: "new-1".to_string(),
            region_id: "1:1,1".to_string(),
            key: OrderedUnitKey::Formed(2),
            structure_id: Some("329".to_string()),
        };
        assert_eq!(
            course_in(&coast_scene(), orders, &[crew], "329").0,
            Some("new-1".to_string())
        );
    }

    /// `ah-7ful` review: a formed unit that boards by its own ENTER stands behind the reported
    /// units that board too - here 901, re-entering the hull it stood in.
    #[test]
    fn a_formed_unit_that_enters_stands_behind_a_reported_entrant() {
        let orders = "unit 903\nFORM 1\nENTER 329\nEND\n\
                      unit 900\nLEAVE\nunit 901\nENTER 329\nunit 902\nLEAVE\n";
        let entrant = FormedCrew {
            unit_id: "new-1".to_string(),
            region_id: "1:1,1".to_string(),
            key: OrderedUnitKey::Formed(2),
            structure_id: Some("329".to_string()),
        };
        assert_eq!(
            course_in(&coast_scene(), orders, &[entrant], "329").0,
            Some("901".to_string())
        );
    }

    /// At sea the engine refuses a LEAVE from a unit that can neither swim nor fly
    /// (`rules/leave`; `Do1EnterOrder`: "LEAVE: Can't leave a ship in the ocean."), so it keeps
    /// its place and its hull, and its own SAIL still sets the course (`ah-877p` review).
    #[test]
    fn a_leave_refused_at_sea_keeps_the_owner_aboard() {
        assert_eq!(
            scene_owner("unit 900\nLEAVE\nunit 901\nLEAVE\nunit 902\nLEAVE\n", "329"),
            Some("900".to_string())
        );
        assert_eq!(
            scene_course("unit 900\nSAIL SE\nLEAVE\n", "329"),
            go(crate::movement::graph::Direction::Southeast)
        );
    }

    /// The refusal belongs to [`OrderedUnits::structure_of`], so every reader of where a unit
    /// stands - the units-in-hex preview and the checks included - keeps the leaver aboard, not
    /// only the owner walk (`ah-djst`).
    #[test]
    fn where_a_unit_stands_keeps_a_refused_leaver_aboard() {
        let mut cache = ReportCache::new();
        let ruleset = cache.ruleset(RULESET).expect("the fixture ruleset loads");
        for (scene, aboard) in [(owner_scene(), Some("329")), (coast_scene(), None)] {
            let report = cache.classified(&scene, RULESET);
            let rovers = report
                .units()
                .find(|unit| unit.unit_id == "900")
                .expect("Sea Rovers is in the scene");
            let ordered =
                OrderedUnits::of_month(&report, "unit 900\nSAIL SE\nLEAVE\n", Some(&ruleset));
            assert_eq!(ordered.structure_of(rovers), aboard, "{scene}");
        }
    }

    /// [`owner_scene`] with Sea Rovers (900) able to fly its load - which `Unit::CanSwim` admits as
    /// leaving a ship at sea (`rules/leave`) - and, when `nocross`, showing "won't cross water".
    fn flying_owner_scene(nocross: bool) -> String {
        let flag = if nocross { ", won't cross water" } else { "" };
        owner_scene().replace(
            "  * Sea Rovers (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0.",
            &format!(
                "  * Sea Rovers (900), Foo (1), leader [LEAD], sharing{flag}, centaur [CTAU]. \
                 Weight: 50. Capacity: 70/70/70/0."
            ),
        )
    }

    /// At sea a unit that can fly its load may LEAVE (`rules/leave`), so the hull passes on; one
    /// that won't cross water may not (`Do1EnterOrder` refuses it for `FLAG_NOCROSS_WATER`,
    /// `rules/nocross`) - unless this month's own `NOCROSS 0` clears the flag first, among the
    /// instant orders that run before LEAVE (`rules/sequenceofevents`).
    #[test]
    fn a_leave_at_sea_runs_only_for_a_unit_that_can_fly_and_will_cross_water() {
        let owner = |scene: String, orders: &str| course_in(&scene, orders, &[], "329").0;
        assert!(
            flying_owner_scene(false).contains("Capacity: 70/70/70/0"),
            "the fixture was rewritten"
        );
        assert_eq!(
            owner(flying_owner_scene(false), "unit 900\nLEAVE\n"),
            Some("901".to_string()),
            "a flyer leaves, and the next unit aboard owns the hull"
        );
        assert_eq!(
            owner(flying_owner_scene(true), "unit 900\nLEAVE\n"),
            Some("900".to_string()),
            "won't cross water: the LEAVE is refused"
        );
        assert_eq!(
            owner(flying_owner_scene(true), "unit 900\nNOCROSS 0\nLEAVE\n"),
            Some("901".to_string()),
            "NOCROSS 0 clears the flag before the LEAVE runs"
        );
        assert_eq!(
            owner(flying_owner_scene(false), "unit 900\nNOCROSS 1\nLEAVE\n"),
            Some("900".to_string()),
            "NOCROSS 1 set this month refuses it too"
        );
    }

    /// A unit whose LEAVE is refused at sea is still aboard, so the owner can promote it
    /// (`Do1PromoteOrder` takes any unit in the object).
    #[test]
    fn a_unit_whose_leave_is_refused_at_sea_can_be_promoted() {
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nunit 901\nLEAVE\n", "329"),
            Some("901".to_string())
        );
    }

    /// `ah-q4kp`: LEAVE runs before PROMOTE (`rules/sequenceofevents`), so an owner that writes
    /// both is in no structure when promotions run; its PROMOTE errors "PROMOTE: Can only promote
    /// inside structures." (../Atlantis `runorders.cpp` `RunPromoteOrders`) and the hull goes to
    /// the next unit aboard, not to the unit it named.
    #[test]
    fn a_promote_written_with_leave_does_not_hand_the_hull_on() {
        assert_eq!(
            coast_owner("unit 900\nLEAVE\nPROMOTE 902\n", "329"),
            Some("901".to_string())
        );
    }

    #[test]
    fn a_passenger_who_reenters_can_replace_a_departing_builder() {
        assert_eq!(
            coast_owner(
                "unit 900\nLEAVE\nunit 901\nLEAVE\nENTER 329\nPROMOTE 902\nunit 902\nSAIL SE\n",
                "329"
            ),
            Some("902".to_string()),
            "a passenger who reenters can promote the sailor"
        );
        assert_eq!(
            coast_course(
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

    /// Among several `PROMOTE`s from one owner only the last written is kept (`ah-nhgo`):
    /// `ProcessPromoteOrder` (../Atlantis `parseorders.cpp`) overwrites `u->promote`. One naming a
    /// unit not in the object promotes nobody (`Do1PromoteOrder`: "PROMOTE: Can't find target.").
    /// Only the owner's `PROMOTE` runs at all (`ah-c1p2`): `Game::RunPromoteOrders` (../Atlantis
    /// `runorders.cpp`) runs one per object, the one its owner wrote (`Object::GetOwner`), and
    /// errors every other unit's "PROMOTE: Must be owner" - so a promoted unit's own `PROMOTE`
    /// hands on nothing that month.
    #[test]
    fn the_last_promote_takes_the_hull_and_the_promoted_units_own_promote_does_not_run() {
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nPROMOTE 902\n", "329"),
            Some("902".to_string()),
            "900's second PROMOTE overwrites its first"
        );
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nunit 901\nPROMOTE 902\n", "329"),
            Some("901".to_string()),
            "901 did not own the hull when PROMOTEs ran, so its PROMOTE is refused"
        );
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nPROMOTE 903\n", "329"),
            Some("900".to_string()),
            "903 is ashore, so the PROMOTE that is kept promotes nobody"
        );
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 903\nPROMOTE 901\n", "329"),
            Some("901".to_string()),
            "the last PROMOTE names a unit aboard, so it runs"
        );
    }

    /// `ah-fcro`: a `PROMOTE FACTION 3 NEW 1` is kept like any other target `ParseUnit` accepts
    /// (../Atlantis `parseorders.cpp` `ProcessPromoteOrder` overwrites `u->promote`), so written
    /// last it replaces 900's `PROMOTE 901`. It names a unit another faction forms this month,
    /// which this reader cannot see (`Object::GetUnitId` looks it up by that faction's alias), so
    /// the hull stays with 900 rather than going to 901.
    #[test]
    fn a_last_promote_of_another_factions_new_unit_overwrites_an_earlier_one() {
        assert_eq!(
            scene_owner("unit 900\nPROMOTE 901\nPROMOTE FACTION 3 NEW 1\n", "329"),
            Some("900".to_string())
        );
    }

    /// A last `PROMOTE NEW 1` names the unit 900 formed: the engine appends it to its parent's
    /// object as it is formed (../Atlantis `parseorders.cpp`: `temp->MoveUnit(former->object)`),
    /// so it is in the hull and is promoted, as `orders::semantics` reads it for DESTROY and EVICT
    /// (`ah-nhgo` review).
    #[test]
    fn a_last_promote_naming_a_unit_formed_aboard_promotes_it() {
        let orders = "unit 900\nFORM 1\nEND\nPROMOTE 901\nPROMOTE NEW 1\n";
        let crew = FormedCrew {
            unit_id: "new-1".to_string(),
            region_id: "1:1,1".to_string(),
            key: OrderedUnitKey::Formed(2),
            structure_id: Some("329".to_string()),
        };
        assert_eq!(
            course_in(&owner_scene(), orders, std::slice::from_ref(&crew), "329").0,
            Some("new-1".to_string())
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

    /// A unit that writes SAIL and then LEAVE is ashore when the fleets move: the engine runs every
    /// LEAVE before movement (`Game::RunEnterOrders` ahead of `RunMovementOrders`), which then asks
    /// the hull for its owner as it stands (`Object::GetOwner`). 10594 is the one left aboard, it
    /// set no course, and the raft carries nobody (`ah-877p`, which corrected the voyage this test
    /// once expected).
    #[test]
    fn a_captain_that_also_leaves_carries_nobody() {
        assert_eq!(followed("unit 10575\nsail se\nLEAVE\n", "10594"), None);
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

    /// A `FORM` nested in one whose alias could not be read has no former, so it forms nobody and
    /// its MOVE draws no line - the preview and the intent reader already said so, and
    /// `FormBlocks` now says it for all three (`ah-0vc6`).
    #[test]
    fn a_form_nested_in_an_unreadable_one_forms_nobody_on_the_map() {
        let nested = OrderedUnits::unreported("unit 900\nFORM 0\nFORM 2\nMOVE S\nEND\nEND\n", None);
        assert_eq!(nested.route(&OrderedUnitKey::Formed(3)), None);
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
