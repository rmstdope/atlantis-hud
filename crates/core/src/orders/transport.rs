//! How far a shipment may travel, and what it costs by weight.

use super::effects::{TransportReach, TransportTargetReason};
use crate::movement::rules::OrderLanguage;

/// Where each unit the report shows ends this month, for the units whose month-end hex differs from
/// the one the report prints and can be named. `rules/sequenceofevents` moves every unit before any
/// TRANSPORT, so a shipment is measured from here (`ah-b6fz`).
///
/// A unit absent from the map is measured from where the report shows it: it does not move, or the
/// forecast cannot name where its month ends (`→ …`).
///
/// A unit this month's orders form is keyed by [`formed_month_end_key`], never by its bare
/// `new-<alias>`: `rules/form` scopes an alias to its region, so two hexes may each form a
/// `new-1`. A shipment reads the map by bare id, so it still measures a formed unit from where it
/// was formed; maintenance reads it by that key (`ah-6cka`).
pub type MonthEndHexes = std::collections::BTreeMap<String, crate::report::model::Coordinate>;

/// The [`MonthEndHexes`] key of the unit formed as `unit_id` (`new-<alias>`) in `region_id`.
pub(crate) fn formed_month_end_key(region_id: &str, unit_id: &str) -> String {
    format!("{region_id}/{unit_id}")
}

/// The hex one end of a shipment is measured from: its month-end hex when the map names one,
/// otherwise `reported`.
pub(crate) fn standing_at(
    month_end: &MonthEndHexes,
    unit_id: &str,
    reported: crate::report::model::Coordinate,
) -> crate::report::model::Coordinate {
    month_end.get(unit_id).copied().unwrap_or(reported)
}

/// Which of the two reaches in `rules/economy_transport` a shipment is measured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// The flat two hexes any unit may send to a quartermaster within, and any quartermaster may
    /// distribute to a unit within.
    Local,
    /// Quartermaster to quartermaster, which grows with the *sending* unit's own skill.
    BetweenQuartermasters { level: u32 },
}

impl Reach {
    /// How many hexes this reach covers.
    ///
    /// `data/quartermaster`: "up to 3 plus (level+1)/3 hexes distant from each other", with the
    /// division as the catalogue writes it, truncating.
    #[must_use]
    pub fn hexes(self) -> i32 {
        match self {
            // `rules/economy_transport`: "within 2 hexes distance".
            Self::Local => 2,
            Self::BetweenQuartermasters { level } => {
                3 + i32::try_from(level.checked_add(1).unwrap_or(level) / 3).unwrap_or(i32::MAX)
            }
        }
    }
}

/// Which of `rules/sequenceofevents`' three TRANSPORT phases a shipment runs in: to quartermaster,
/// between quartermasters, or from quartermaster. Declaration order is the turn's order, so `Ord`
/// sorts a hex's shipments into it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ShipmentPhase {
    ToQuartermaster,
    BetweenQuartermasters,
    FromQuartermaster,
}

/// Which phase this shipment runs in, from what the two ends are.
pub(crate) fn shipment_phase(
    sender_is_quartermaster: bool,
    target_is_quartermaster: bool,
) -> ShipmentPhase {
    match (sender_is_quartermaster, target_is_quartermaster) {
        (false, true) => ShipmentPhase::ToQuartermaster,
        (true, true) => ShipmentPhase::BetweenQuartermasters,
        (true, false) => ShipmentPhase::FromQuartermaster,
        // A non-quartermaster sending to a non-quartermaster is not a valid shipment under the
        // rules this function classifies; treat it as ToQuartermaster for stability.
        (false, false) => ShipmentPhase::ToQuartermaster,
    }
}

/// A shipment the sender's month could not pay for, so the goods stay where they are.
/// Travels from the ledger to both other surfaces: `Ledger::refused_shipments` feeds the shortfall
/// sentence's tail clause, and `UnitItemEffects::refused_shipments` feeds the item preview, which
/// has no silver of its own to judge with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RefusedShipment {
    pub unit_id: String,
    /// The 1-based document line of the order — the key all three surfaces join on, the same key
    /// `ShipmentPriced::line` and `SilverChange::line` already carry.
    pub line: i64,
    /// The unit number the order named.
    pub to: String,
    /// The catalogue tag of the goods, for the sentence's `counted_item`.
    pub tag: String,
    /// How many the order would have sent — what the tail clause counts. Never used as a partial
    /// figure: a shipment is all or nothing, so the clause always says `none of the N …`.
    pub ordered: i64,
    /// What it would have cost, which is what the sender's month is short by on account of it.
    pub cost: i64,
    /// What the sender could pay the fee from when it was judged - its own silver, or the SHARE
    /// purse's remainder - for the refused line's own sentence (`ah-2pbd`).
    pub available: i64,
}

/// What shipping one weight unit costs in silver, or `None` when the shipment is free.
///
/// `distance` is a distance the caller has settled: `shipping_rate` answers what the rules charge
/// for a shipment that far, and says nothing about a distance that could not be worked out.
#[must_use]
pub fn shipping_rate(reach: Reach, distance: i32, language: OrderLanguage) -> Option<i64> {
    let level = match reach {
        // The fee sentence in all three rulesets names a shipment from one quartermaster to
        // another and nothing else, so the flat two-hex reach is free in every game.
        Reach::Local => return None,
        Reach::BetweenQuartermasters { level } => level,
    };

    // `rules/economy_transport`, New Age: Trident and New Age: Arcanum only: "Sending items to a
    // quartermaster no more than 2 hexes away is free". New Origins has no such sentence.
    match language {
        OrderLanguage::NewAgeTrident | OrderLanguage::NewAgeArcanum
            if distance <= FREE_SHORT_RANGE_HEXES =>
        {
            return None;
        }
        OrderLanguage::NewAgeTrident | OrderLanguage::NewAgeArcanum | OrderLanguage::NewOrigins => {
        }
    }

    // `data/quartermaster`: "4-((level+1)/2) * 5 silver", with the rules' own floor of 5 for a
    // world whose catalogue carries a quartermaster above level 5. `(level + 1) / 2` on an
    // unsigned level is exactly `level.div_ceil(2)`, which is the form clippy insists on.
    Some(((4 - i64::from(level.div_ceil(2))) * 5).max(5))
}

/// The reach `rules/economy_transport`'s New Age free-shipping sentence names: "Sending items to a
/// quartermaster no more than 2 hexes away is free".
///
/// Shared with [`priced`], whose upper bound inside this range settles the price without settling
/// the distance.
const FREE_SHORT_RANGE_HEXES: i32 = 2;

/// What one shipment costs, or why it cannot be said (`ah-7ale.3`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Priced {
    /// The rules carry it for nothing. Nothing is charged and nothing is said about it anywhere -
    /// never "for 0 silver".
    Free,
    /// What it costs, and the two numbers the SILVER hover's aside names.
    Charged { rate: i64, weight: i64, cost: i64 },
    /// The map cannot settle the one thing the price still turns on, so the price cannot be worked
    /// out. Nothing is charged here; `ah-7ale.5` marks the month, by cause.
    Unknown(Unpriceable),
}

/// Why one shipment's price could not be worked out (`ah-7ale.5`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unpriceable {
    /// The world's width (or, on a map that wraps north to south, its height) was never recorded,
    /// so the distance is an upper bound and the free short range can be neither ruled in nor out.
    WorldWrap,
    /// The two ends are on different levels of the map, where no hex distance exists at all.
    /// Nothing acts on this: such a shipment is refused before it is priced (`ah-e07g`).
    DifferentLevels,
}

/// Which of the two unmeasurable causes one unit's shipments met this month (`ah-7ale.5`).
///
/// Two flags rather than a list of lines: the month's notes name one cause once, however many
/// shipments hit it, and the sentence that names a shipment is the ITEMS hover's, which is built
/// from `TransportTargetIssue` and not from this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UnmeasuredShipments {
    /// A shipment whose price, or whose arrival, turns on a distance the world's shape cannot settle.
    pub world_wrap: bool,
    /// A shipment to a unit the report does not show anywhere, so there is nowhere to measure to.
    pub target_unshown: bool,
}

impl UnmeasuredShipments {
    /// Whether anything at all left this unit's month unpriceable.
    pub fn any(self) -> bool {
        self.world_wrap || self.target_unshown
    }
}

/// What this shipment costs.
///
/// `weight` is the total weight the order sends, which is what `data/quartermaster`'s rate is
/// charged on. Zero weight is [`Priced::Free`]: a shipment that carries nothing owes nothing, and
/// `SilverChange::amount` is documented as never zero.
pub(crate) fn priced(
    reach: Reach,
    from: crate::report::model::Coordinate,
    to: crate::report::model::Coordinate,
    geometry: Option<crate::movement::graph::MapGeometry>,
    shown: &crate::movement::graph::ShownExtent,
    language: OrderLanguage,
    weight: i64,
) -> Priced {
    use crate::movement::graph::{hex_distance, HexDistance};

    if weight <= 0 {
        return Priced::Free;
    }
    // `shipping_rate` answers `None` for `Local` at every distance in every world, so the common
    // case never reads the map at all.
    if reach == Reach::Local {
        return Priced::Free;
    }
    let rate = match hex_distance(from, to, geometry, shown) {
        Some(HexDistance::Exact(hexes)) => shipping_rate(reach, hexes, language),
        // An upper bound inside the free short range settles the question outright.
        Some(HexDistance::AtMost(hexes)) if hexes <= FREE_SHORT_RANGE_HEXES => {
            shipping_rate(reach, hexes, language)
        }
        Some(HexDistance::AtMost(_)) => {
            // Whether this world charges differently inside the short range at all. Where it does
            // not, an unsettled distance settles nothing and the rate stands; where it does, the
            // bound leaves the price genuinely unknown. Asking `shipping_rate` keeps every world's
            // rule inside it, so a new `OrderLanguage` needs no edit here.
            let inside = shipping_rate(reach, FREE_SHORT_RANGE_HEXES, language);
            let outside = shipping_rate(reach, FREE_SHORT_RANGE_HEXES + 1, language);
            if inside != outside {
                return Priced::Unknown(Unpriceable::WorldWrap);
            }
            outside
        }
        // The two ends are on different levels of the map (`ah-e07g`).
        None => return Priced::Unknown(Unpriceable::DifferentLevels),
    };
    match rate {
        None => Priced::Free,
        Some(rate) => Priced::Charged {
            rate,
            weight,
            cost: rate.saturating_mul(weight),
        },
    }
}

/// Every unit the report shows holding the quartermaster skill, and at what level.
///
/// Resolved by name through the catalogue rather than by tag spelling: `QUAM` is quartermaster and
/// `QUAR` is quarrying (`ah-d0ku`).
pub(crate) struct Quartermasters {
    by_id: std::collections::BTreeMap<String, u32>,
    /// The catalogue's tag for the quartermaster skill. `None` when the catalogue names no such
    /// skill, which makes every absence unknown rather than a fact (`ah-64wm`).
    tag: Option<String>,
}

impl Quartermasters {
    pub(crate) fn read(
        report: &crate::report::ParsedReport,
        ruleset: &crate::movement::rules::Ruleset,
    ) -> Self {
        // `rules/sequenceofevents` phases TRANSPORT by whether each end is a quartermaster, so the
        // skill has to be resolved by name through the catalogue (`ah-d0ku`).
        let Some(tag) = ruleset
            .find_skill("quartermaster")
            .map(|skill| skill.tag.to_string())
        else {
            // No catalogue entry for the skill: nothing can be classified, and no absence is a
            // fact. The shipped ruleset states `quartermaster [QUAM]`, so this is a catalogue
            // fault rather than a report one (`ah-d0ku`).
            return Self {
                by_id: std::collections::BTreeMap::new(),
                tag: None,
            };
        };
        let mut quartermasters = Self {
            by_id: std::collections::BTreeMap::new(),
            tag: Some(tag),
        };
        quartermasters.by_id = report
            .units()
            .filter_map(|unit| {
                let level = quartermasters.held_by(&unit.skills)?.level;
                Some((unit.unit_id.clone(), level))
            })
            .collect();
        quartermasters
    }

    /// The quartermaster skill among `skills`, if it is there: the one place the catalogue's tag
    /// is matched against a unit's skills (`ah-s79p`).
    fn held_by<'s>(
        &self,
        skills: &'s [crate::report::model::Skill],
    ) -> Option<&'s crate::report::model::Skill> {
        let tag = self.tag.as_deref()?;
        skills
            .iter()
            .find(|skill| skill.tag.eq_ignore_ascii_case(tag))
    }

    pub(crate) fn contains(&self, unit_id: &str) -> bool {
        self.by_id.contains_key(unit_id)
    }

    /// The level, or 0 for a unit the report does not show holding the skill.
    pub(crate) fn level(&self, unit_id: &str) -> u32 {
        self.by_id.get(unit_id).copied().unwrap_or_default()
    }

    pub(crate) fn skill_known(&self) -> bool {
        self.tag.is_some()
    }
}

/// What the report shows about one unit a `TRANSPORT` could name (`ah-64wm`).
///
/// Read from the report, before any order runs, except `caravanserai_owner`, which
/// [`Shipping::read_owners`] settles for the moment the shipments run (`ah-1jl9`).
pub(crate) struct TargetFacts {
    /// Ours, whose skills the report prints in full - so an absent skill is an absent skill,
    /// rather than an undisclosed one.
    pub own: bool,
    /// Whether the absence of the skill can be read as absence at all (`ah-64wm`, `ah-d0ku`).
    pub quartermaster_disclosed: bool,
    /// The report shows the quartermaster skill on this unit.
    pub quartermaster: bool,
    /// The unit is the first one listed inside a Caravanserai in its hex, which is what
    /// `rules/world_structures` makes the owner of the structure - as [`target_facts`] reads the
    /// report, and as [`Shipping::read_owners`] then settles it for when the shipments run.
    pub caravanserai_owner: bool,
    /// The hex the report shows this unit standing in, for the reach the shipment is measured
    /// against (`ah-7ale.2.1`).
    pub coordinate: crate::report::model::Coordinate,
}

/// Whether a structure is the one `rules/economy_transport` allows transport into: "The structures
/// which allow this are: Caravanserai."
pub(crate) fn is_caravanserai(structure: &crate::report::model::Structure) -> bool {
    structure_kind_is(structure, "Caravanserai")
}

/// Whether a report structure has the given base kind.
///
/// Remembered reports may predate `base_kind`, so retain the parser's old prefix fallback.
pub(crate) fn structure_kind_is(
    structure: &crate::report::model::Structure,
    expected: &str,
) -> bool {
    let base = if structure.base_kind.is_empty() {
        structure.kind.split(',').next().unwrap_or_default().trim()
    } else {
        structure.base_kind.as_str()
    };
    base.eq_ignore_ascii_case(expected)
}

/// What the report says about every unit it shows, as a `TRANSPORT` target (`ah-64wm`).
pub(crate) fn target_facts(
    report: &crate::report::ParsedReport,
    quartermasters: &Quartermasters,
) -> std::collections::BTreeMap<String, TargetFacts> {
    let mut facts = std::collections::BTreeMap::new();
    for region in &report.regions {
        // The first unit listed inside each Caravanserai owns it (`rules/world_structures`), so
        // the owners are read off the region's unit list in the order the report wrote them.
        let mut owners: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::new();
        for structure in region.structures.iter().filter(|one| is_caravanserai(one)) {
            if let Some(owner) = region
                .units
                .iter()
                .find(|unit| unit.structure_id.as_deref() == Some(&structure.structure_id))
            {
                owners.insert(structure.structure_id.as_str(), owner.unit_id.as_str());
            }
        }
        for unit in &region.units {
            let caravanserai_owner = unit.structure_id.as_deref().is_some_and(|structure_id| {
                owners.get(structure_id) == Some(&unit.unit_id.as_str())
            });
            facts.insert(
                unit.unit_id.clone(),
                TargetFacts {
                    own: unit.own,
                    quartermaster_disclosed: quartermasters.skill_known(),
                    quartermaster: quartermasters.contains(&unit.unit_id),
                    caravanserai_owner,
                    coordinate: region.coordinate,
                },
            );
        }
    }
    facts
}

/// The units owning a Caravanserai when the month's shipments run, for a document that moves
/// anybody in or out of one (`ah-1jl9`).
///
/// `rules/transport` asks the owner of a transport structure, and the engine asks last of all:
/// `RunOrders` runs ENTER/LEAVE, then PROMOTE/EVICT, then movement, and only then
/// `CheckTransportOrders` (`../Atlantis/runorders.cpp`). The owner is the first unit in the
/// object's list (`Object::GetOwner`); [`occupants_after_promotes`] gives that list once the
/// boardings and promotions have run, and the movement phase then takes off every unit
/// `Unit::MoveUnit` moves out - a walker ending the month in another hex (`month_end`), and a
/// `MOVE OUT` or `MOVE <structure>` from inside ([`standing_through_move`]) - and appends anyone a
/// `MOVE <structure>` brings in, `MOVE <dir> <structure>` into another hex's included. A unit this month's `FORM` creates
/// stands in the list while PROMOTE runs, so an owner's `PROMOTE NEW <n>` hands the structure on;
/// it is still there when the shipments run only when it is one of `survivors`, the formed units
/// the month's dissolution keeps (`ah-ry88`): `RunOrders` deletes a unit that gained no men
/// (`Game::DeleteEmptyUnits`) after BUY and long before `CheckTransportOrders`, and with it goes
/// whatever it owned. A survivor's own MOVE is followed like a reported unit's, so one that
/// moves out hands the structure back. [`target_facts`] still says a formed unit owns nothing as a shipment end;
/// what it changes here is who else does. The owner's EVICT takes its targets off the list too
/// ([`occupants_after_promotes`], `ah-0ace`), units behind the owner, so it changes who owns only
/// for an owner that evicts itself.
///
/// [`occupants_after_promotes`]: crate::movement::fleet::occupants_after_promotes
/// [`standing_through_move`]: super::standing::standing_through_move
fn caravanserai_owners_at_transport(
    report: &crate::report::ParsedReport,
    orders_document: &str,
    ruleset: &crate::movement::rules::Ruleset,
    month_end: &MonthEndHexes,
    survivors: &[crate::movement::fleet::FormedCrew],
) -> std::collections::BTreeSet<String> {
    use crate::movement::fleet::{occupants_after_promotes, OrderedUnits};
    use crate::orders::blocks::OrderedUnitKey;
    use crate::report::model::Coordinate;

    let ordered = OrderedUnits::of_month(report, orders_document, Some(ruleset));
    // Where every unit the report shows stands once the movement phase has run: the hex, and the
    // structure in it. A walker that crossed out of its hex stands in whatever its order entered
    // after the crossing, which is nothing unless it wrote `MOVE <dir> <structure>`.
    let mut standing: std::collections::BTreeMap<&str, (Coordinate, Option<String>)> =
        std::collections::BTreeMap::new();
    for region in &report.regions {
        for unit in &region.units {
            let before = ordered.structure_of(unit).map(str::to_string);
            let key = OrderedUnitKey::shown(&unit.unit_id);
            let moved = ordered
                .steps_for(&key)
                .filter(|_| !ordered.sails_a_course(&key))
                .map(|steps| super::standing::standing_through_move(before.as_deref(), steps));
            // A unit the trace walked at least one step has a month end, even one back in the hex
            // it set out from: every step stands it in the open of the hex it enters (`ah-1jl9`).
            let walked = month_end.contains_key(&unit.unit_id);
            let hex = standing_at(month_end, &unit.unit_id, region.coordinate);
            let structure = match moved {
                Some(moved) if walked => moved.destination,
                Some(moved) => moved.origin,
                None if walked => None,
                None => before,
            };
            standing.insert(unit.unit_id.as_str(), (hex, structure));
        }
    }
    let stands_in = |unit_id: &str, hex: Coordinate, id: &str| {
        standing
            .get(unit_id)
            .is_some_and(|(at, structure)| *at == hex && structure.as_deref() == Some(id))
    };

    let mut owners = std::collections::BTreeSet::new();
    for region in &report.regions {
        // Where each unit formed in this hex stands once the movement phase has run, by the rule
        // a reported unit's walk is read by above, from where the PROMOTEs found it: a formed
        // unit promoted to owner that then moves out hands the structure back (`ah-ry88`
        // review). Keyed by its `new-<alias>`, which is unique only inside its hex (`rules/form`).
        let formed_standing: std::collections::BTreeMap<String, (Coordinate, Option<String>)> =
            ordered
                .formed_at_promotion(region)
                .into_iter()
                .map(|crew| {
                    let month_end_key = formed_month_end_key(&region.region_id, &crew.unit_id);
                    let walked = month_end.contains_key(&month_end_key);
                    let hex = standing_at(month_end, &month_end_key, region.coordinate);
                    let moved = ordered
                        .steps_for(&crew.key)
                        .filter(|_| !ordered.sails_a_course(&crew.key))
                        .map(|steps| {
                            super::standing::standing_through_move(
                                crew.structure_id.as_deref(),
                                steps,
                            )
                        });
                    let structure = match moved {
                        Some(moved) if walked => moved.destination,
                        Some(moved) => moved.origin,
                        None if walked => None,
                        None => crew.structure_id,
                    };
                    (crew.unit_id, (hex, structure))
                })
                .collect();
        for structure in region.structures.iter().filter(|one| is_caravanserai(one)) {
            let id = structure.structure_id.as_str();
            let mut occupants = occupants_after_promotes(region, &ordered, survivors, id);
            occupants.retain(|unit| match formed_standing.get(unit) {
                Some((at, structure)) => {
                    *at == region.coordinate && structure.as_deref() == Some(id)
                }
                // A unit `occupants_after_promotes` reads from outside the report and this
                // month's FORMs - none today - is left where it put it.
                None => {
                    !standing.contains_key(unit.as_str()) || stands_in(unit, region.coordinate, id)
                }
            });
            // `Unit::MoveUnit` appends whoever the movement phase brings in, from this hex or
            // another, in the order the report lists them.
            for unit in report.units() {
                if stands_in(&unit.unit_id, region.coordinate, id)
                    && !occupants.contains(&unit.unit_id)
                {
                    occupants.push(unit.unit_id.clone());
                }
            }
            if let Some(owner) = occupants.into_iter().next() {
                owners.insert(owner);
            }
        }
    }
    owners
}

/// Which of the two words a shipment line was written with. `rules/transport` calls DISTRIBUTE a
/// synonym of TRANSPORT, but `CheckTransportOrders` (`../Atlantis/runorders.cpp`) asks every
/// DISTRIBUTE's issuer to be a quartermaster owning a transport structure, whatever the target,
/// and a TRANSPORT's only beyond `LOCAL_TRANSPORT` (`ah-g4bz`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShipmentOrder {
    Transport,
    Distribute,
}

impl ShipmentOrder {
    /// The word of an order already known to be a shipment: DISTRIBUTE, or else TRANSPORT.
    pub fn from_command(distribute: bool) -> Self {
        if distribute {
            Self::Distribute
        } else {
            Self::Transport
        }
    }

    /// The order's own word, as a sentence about the line names it (`ah-lis2`).
    pub fn word(self) -> &'static str {
        match self {
            Self::Transport => "TRANSPORT",
            Self::Distribute => "DISTRIBUTE",
        }
    }
}

/// Whether the game will let this target receive the goods, and why not when it will not.
///
/// A quartermaster owning a Caravanserai may DISTRIBUTE to any unit within two hexes: the engine
/// never asks a DISTRIBUTE's target about skill or structure (`CheckTransportOrders`,
/// `../Atlantis/runorders.cpp`). In New Origins every TRANSPORT, whoever sends it, may go only to
/// a quartermaster owning a Caravanserai, the transport structure `rules/economy_transport` names -
/// the engine, not that page's "may also TRANSPORT items to any unit", by the navigator's choice
/// (`ah-1d3i`). In the New Age worlds a TRANSPORT from a Caravanserai owner is judged as its
/// DISTRIBUTE, as that page says (`ah-4kcg`), and a quartermaster target owning no Caravanserai
/// counts as any unit within 2 hexes there (`ah-a51z`, settled in [`Shipping::judge`], which knows
/// the distance). Either target must be at least FRIENDLY to the sender.
///
/// Only the first two are ours to settle. `rules/com_attitudes` prints the attitudes *we* declare
/// toward other factions, never theirs toward us, so a foreign target that passes both structural
/// tests is still unknown - accept on doubt, and say so. The ladder lives here, shared by the
/// forecast and the advisory, so the two cannot answer it differently (`ah-7ale.2.2.1`).
// The variants are named one-to-one after the wire `TransportTargetReason` they map onto, so
// `AcceptanceUnknown` repeating the enum's own name is what keeps the two readable side by side.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Acceptance {
    Eligible,
    NotQuartermaster,
    NotCaravanseraiOwner,
    /// The sender is a quartermaster that owns no Caravanserai when the shipments run, and the
    /// shipment needs one: every DISTRIBUTE (`ah-g4bz`), and a TRANSPORT beyond the flat reach. In
    /// New Origins a TRANSPORT to a unit that is no quartermaster is the target's refusal whoever
    /// sends it (`ah-1d3i`).
    /// `CheckTransportOrders` blames the sender for a DISTRIBUTE ("Unit does not own transport
    /// structure.") and the distance for a TRANSPORT ("Recipient ... is too far away.", its range
    /// capped at `LOCAL_TRANSPORT`); the sentence names the sender's missing Caravanserai for
    /// both, the navigator's choice (`ah-1jl9`). Set by [`Shipping::judge`] over [`acceptance`]'s
    /// answer, which knows nothing of distance.
    SenderOwnsNoCaravanserai,
    /// A DISTRIBUTE whose sender is not a quartermaster. `CheckTransportOrders` asks a
    /// DISTRIBUTE's issuer, never its target, and refuses this one with "DISTRIBUTE: Unit is not a
    /// quartermaster" whoever the target is (`ah-lis2`). A TRANSPORT from the same unit is judged
    /// on its target, as `rules/transport` describes. Set by [`Shipping::judge`].
    SenderNotQuartermaster,
    EligibilityUnknown,
    AcceptanceUnknown,
}

pub(crate) fn acceptance(skips_target_test: bool, facts: Option<&TargetFacts>) -> Acceptance {
    let Some(facts) = facts else {
        // A unit number the report never described: an ally's quartermaster, or a mistake.
        return Acceptance::EligibilityUnknown;
    };
    if skips_target_test && !facts.quartermaster {
        // A DISTRIBUTE from a Caravanserai owner, or in the New Age worlds its TRANSPORT
        // (`ah-4kcg`), is what makes an ordinary target eligible. The
        // report can settle that immediately for our unit; a foreign target's attitude stays
        // unknown because `rules/com_attitudes` only reports our attitudes toward others.
        return accepted_as_any_unit(facts);
    }
    if facts.own {
        // Our own report prints our own units' skills in full, so a missing quartermaster is a
        // fact rather than a gap - and it is the reason worth naming when the unit fails both
        // tests.
        if !facts.quartermaster {
            if !facts.quartermaster_disclosed {
                // The catalogue names no quartermaster skill, so the report was never asked the
                // question: missing evidence, not a missing skill.
                return Acceptance::EligibilityUnknown;
            }
            return Acceptance::NotQuartermaster;
        }
        if !facts.caravanserai_owner {
            return Acceptance::NotCaravanseraiOwner;
        }
        return Acceptance::Eligible;
    }
    // A foreign unit's structure is drawn in our report even though its skills are not, so
    // ownership is certain either way and is asked first.
    if !facts.caravanserai_owner {
        return Acceptance::NotCaravanseraiOwner;
    }
    if !facts.quartermaster {
        // A foreign unit's skills are undisclosed (`rules/reportformat`), so an empty list is
        // missing evidence rather than proof.
        return Acceptance::EligibilityUnknown;
    }
    Acceptance::AcceptanceUnknown
}

/// How a target whose own transport test is skipped answers: certainly for ours, whose skills the
/// report prints in full, and on the faction's attitude for another's (`rules/com_attitudes` only
/// reports our attitudes toward others).
fn accepted_as_any_unit(facts: &TargetFacts) -> Acceptance {
    if facts.own && facts.quartermaster_disclosed {
        Acceptance::Eligible
    } else if facts.own {
        Acceptance::EligibilityUnknown
    } else {
        Acceptance::AcceptanceUnknown
    }
}

/// Which reach this shipment is measured against.
///
/// `rules/economy_transport` gives shipments involving one quartermaster the local two-hex reach,
/// while two quartermasters use the sender skill's longer reach. That longer reach is TRANSPORT's
/// alone: the engine's `CheckTransportOrders` measures every DISTRIBUTE against `LOCAL_TRANSPORT`
/// (`ah-4g2l`), although `rules/transport` calls the two orders one. The engine source at hand is
/// New Origins'; the New Age worlds' rules text says the same as New Origins' (`newage trident
/// rules distribute`), so they are assumed to share the engine's behaviour too.
pub(crate) fn reach_for(
    order: ShipmentOrder,
    sender_is_quartermaster: bool,
    target_is_quartermaster: bool,
    sender_level: u32,
) -> Option<Reach> {
    if !sender_is_quartermaster {
        return Some(Reach::Local);
    }
    if target_is_quartermaster && order == ShipmentOrder::Transport {
        return Some(Reach::BetweenQuartermasters {
            level: sender_level,
        });
    }
    Some(Reach::Local)
}

/// How far apart the two ends are and how far the shipment was allowed to travel, when the map
/// settles that it is certainly too far.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutOfReach {
    /// A numeric refusal: the map settled an exact distance and it exceeds the limit.
    Distance {
        away: i32,
        limit: i32,
        /// Whose limit was passed, which decides the sentence this refusal takes.
        range: Range,
    },
    /// The ends are on different levels of the map, which the old `hex_distance` API reported as
    /// `None`. This is a definite refusal that names both levels rather than a numeric distance.
    DifferentLevel {
        from_level: u32,
        to_level: u32,
        range: Range,
    },
}

/// Whose limit a refused shipment passed (`rules/economy_transport`), so the sentence can blame the
/// right end of it (`ah-nzb0`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Range {
    /// The flat two hexes within which a quartermaster accepts goods from any unit.
    Accepts,
    /// The flat two hexes within which a quartermaster may TRANSPORT (or DISTRIBUTE) to any unit:
    /// the sender's own range, not the recipient's.
    Distributes,
    /// Quartermaster to quartermaster, as far as the *sender's* own skill reaches.
    Ships,
}

impl Acceptance {
    /// The wire reason a refusal crosses as, or `None` for an eligible target: the one mapping the
    /// forecast and the order check both read (`ah-9lyr`).
    pub(crate) fn refusal(self) -> Option<TransportTargetReason> {
        match self {
            Self::Eligible => None,
            Self::NotQuartermaster => Some(TransportTargetReason::NotQuartermaster),
            Self::NotCaravanseraiOwner => Some(TransportTargetReason::NotCaravanseraiOwner),
            Self::SenderOwnsNoCaravanserai => Some(TransportTargetReason::SenderOwnsNoCaravanserai),
            Self::SenderNotQuartermaster => Some(TransportTargetReason::SenderNotQuartermaster),
            Self::EligibilityUnknown => Some(TransportTargetReason::EligibilityUnknown),
            Self::AcceptanceUnknown => Some(TransportTargetReason::AcceptanceUnknown),
        }
    }
}

impl OutOfReach {
    /// The wire reason for whose limit was passed (`ah-nzb0`), and the reach its sentence names
    /// (`ah-7ale.2.1`, `ah-e07g`): the one mapping the forecast and the order check both read.
    pub(crate) fn refusal(self) -> (TransportTargetReason, TransportReach) {
        let reason = |range: Range| match range {
            Range::Accepts => TransportTargetReason::TooFarToAccept,
            Range::Distributes => TransportTargetReason::TooFarToDistribute,
            Range::Ships => TransportTargetReason::TooFarToShip,
        };
        match self {
            Self::Distance { away, limit, range } => (
                reason(range),
                TransportReach {
                    away: Some(i64::from(away)),
                    limit: Some(i64::from(limit)),
                    from_level: None,
                    to_level: None,
                },
            ),
            Self::DifferentLevel {
                from_level,
                to_level,
                range,
            } => (
                reason(range),
                TransportReach {
                    away: None,
                    limit: None,
                    from_level: Some(from_level),
                    to_level: Some(to_level),
                },
            ),
        }
    }
}

impl Arrival {
    /// The same arrival, with a refusal blamed on the sending quartermaster's distribution range
    /// rather than on the recipient's acceptance: [`Reach::Local`] is one limit for both, and only
    /// the caller knows which end is the quartermaster.
    fn distributed(self) -> Self {
        match self {
            Self::TooFar(OutOfReach::Distance { away, limit, .. }) => {
                Self::TooFar(OutOfReach::Distance {
                    away,
                    limit,
                    range: Range::Distributes,
                })
            }
            Self::TooFar(OutOfReach::DifferentLevel {
                from_level,
                to_level,
                ..
            }) => Self::TooFar(OutOfReach::DifferentLevel {
                from_level,
                to_level,
                range: Range::Distributes,
            }),
            settled => settled,
        }
    }
}

/// Whether the map settles that one shipment arrives (`ah-7ale.5`).
///
/// Replaces `ah-7ale.2.1`'s `out_of_reach`, whose `None` meant both "near enough" and "no answer" -
/// two things the forecast must treat differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Arrival {
    /// Nothing here refuses it: it is near enough, or an upper bound on the distance already sits
    /// inside the limit.
    Certain,
    /// Certainly refused: too far (`ah-7ale.2.1`), or on another level of the map (`ah-e07g`).
    TooFar(OutOfReach),
    /// The game never recorded how far the world reaches around, so the distance is an upper bound
    /// only: the shipment may be inside the reach or outside it, and nothing may claim either.
    Unmeasured,
}

/// What the map says about whether this shipment arrives.
///
/// When the ends lie on different z-levels the map cannot supply a numeric distance, and the agreed
/// UX wants a definite refusal naming the two levels (`ah-e07g`).
pub(crate) fn arrival(
    reach: Reach,
    from: crate::report::model::Coordinate,
    to: crate::report::model::Coordinate,
    geometry: Option<crate::movement::graph::MapGeometry>,
    shown: &crate::movement::graph::ShownExtent,
) -> Arrival {
    use crate::movement::graph::{hex_distance, HexDistance};

    let limit = reach.hexes();
    let range = match reach {
        Reach::Local => Range::Accepts,
        Reach::BetweenQuartermasters { .. } => Range::Ships,
    };
    match hex_distance(from, to, geometry, shown) {
        Some(HexDistance::Exact(hexes)) if hexes > limit => Arrival::TooFar(OutOfReach::Distance {
            away: hexes,
            limit,
            range,
        }),
        Some(HexDistance::Exact(_)) => Arrival::Certain,
        // An upper bound inside the limit settles the question.
        Some(HexDistance::AtMost(hexes)) if hexes <= limit => Arrival::Certain,
        // Past it, the real distance may be anything down to zero: refusing would state a guess
        // as a fact, and delivering would too.
        Some(HexDistance::AtMost(_)) => Arrival::Unmeasured,
        None => Arrival::TooFar(OutOfReach::DifferentLevel {
            from_level: from.z,
            to_level: to.z,
            range,
        }),
    }
}

/// Everything the measurement of a shipment reads, built once per settle. A new input to where or
/// when a shipment is measured is a field here, filled in `read` and read in `judge` - so the
/// Problems check, the shipping bill and the item preview cannot measure one line differently.
pub(crate) struct Shipping {
    pub(crate) quartermasters: Quartermasters,
    pub(crate) targets: std::collections::BTreeMap<String, TargetFacts>,
    pub(crate) geometry: Option<crate::movement::graph::MapGeometry>,
    shown: crate::movement::graph::ShownExtent,
    month_end: MonthEndHexes,
    /// Units whose own month could give them the quartermaster skill before TRANSPORT runs - a
    /// STUDY of it - from [`Shipping::read_orders`]. Empty until it is called (`ah-kjjv`).
    may_learn: std::collections::BTreeSet<String>,
    /// Units whose month could make them the owner of a transport structure before TRANSPORT
    /// runs - a BUILD, or a structure the trace cannot follow - from [`Shipping::read_orders`].
    /// Kept apart from `may_learn` because `rules/transport` asks the target for both, and a month
    /// that can mend only one leaves a target failing both refused (`ah-xbnu`).
    may_own: std::collections::BTreeSet<String>,
    /// Whether a quartermaster owning a Caravanserai may TRANSPORT to a unit that is no
    /// quartermaster, as it may DISTRIBUTE. The New Age worlds do as `rules/economy_transport`
    /// says ("Quartermasters may also TRANSPORT items to any unit within 2 hexes", `newage trident`
    /// and `newage arcanum`); New Origins does as its engine does, which asks every TRANSPORT's
    /// target (`CheckTransportOrders`, `ah-1d3i`). The navigator's ruling, `ah-4kcg`.
    transport_to_anyone: bool,
}

impl Shipping {
    /// `geometry`, `shown` and `month_end` are cloned out of `options`. Every Caravanserai's owner
    /// is the report's until [`Shipping::read_owners`] settles who owns it when the shipments run,
    /// which every caller does once it knows the month's dissolution (`ah-ry88`).
    pub(crate) fn read(
        report: &crate::report::ParsedReport,
        ruleset: &crate::movement::rules::Ruleset,
        options: &super::semantics::CheckOptions,
    ) -> Self {
        let quartermasters = Quartermasters::read(report, ruleset);
        let targets = target_facts(report, &quartermasters);
        Self {
            quartermasters,
            targets,
            geometry: options.geometry,
            shown: options.shown.clone(),
            month_end: options.month_end.clone(),
            may_learn: std::collections::BTreeSet::new(),
            may_own: std::collections::BTreeSet::new(),
            transport_to_anyone: ruleset.is_new_age(),
        }
    }

    /// Settles who owns each Caravanserai when the shipments run, from `orders_document`
    /// ([`caravanserai_owners_at_transport`]). `survivors` are the month's formed units the
    /// dissolution keeps - those that gained men, or may have - as the fleets are handed them: a
    /// formed unit left out is deleted before the shipments, and owns nothing then (`ah-ry88`).
    /// A survivor is matched by its hex and `FORM` key alone, never by its `structure_id`: where it
    /// stands is read from the month's orders (`movement::fleet::occupants_after_promotes`).
    pub(crate) fn read_owners(
        &mut self,
        report: &crate::report::ParsedReport,
        orders_document: &str,
        ruleset: &crate::movement::rules::Ruleset,
        survivors: &[crate::movement::fleet::FormedCrew],
    ) {
        // The report's owners are where the month starts. Only a hex with a Caravanserai can
        // change them, so the document is not walked again for a faction that has none in view.
        let any_caravanserai = report
            .regions
            .iter()
            .any(|region| region.structures.iter().any(is_caravanserai));
        if !any_caravanserai {
            return;
        }
        let owners = caravanserai_owners_at_transport(
            report,
            orders_document,
            ruleset,
            &self.month_end,
            survivors,
        );
        for (unit_id, facts) in &mut self.targets {
            facts.caravanserai_owner = owners.contains(unit_id);
        }
    }

    /// Whether this unit's own month could change it as a shipment end at all.
    fn month_may_change(&self, unit: &str) -> bool {
        self.may_learn.contains(unit) || self.may_own.contains(unit)
    }

    /// Reads this month's orders for the units whose eligibility as a target they could change
    /// before TRANSPORT runs (`ah-kjjv`).
    ///
    /// `rules/sequenceofevents` processes LEAVE, ENTER and PROMOTE, then MOVE, then the month's
    /// STUDY and BUILD, all before TRANSPORT; `rules/transport` asks the target for the
    /// quartermaster skill and ownership of a transport structure, and `rules/world_structures`
    /// makes the owner "the first unit listed under the object". So a unit is unsettled when it
    /// studies the quartermaster skill (resolved through the catalogue, `ah-d0ku`) or BUILDs, or
    /// stands in a structure one of whose units BUILDs or walks where the trace cannot follow -
    /// which can hand ownership on. Deliberately broad: a refusal the player is warned about with
    /// no switch must be one the month cannot undo.
    ///
    /// ENTER, LEAVE, PROMOTE and a traced MOVE no longer unsettle anybody: [`Shipping::read_owners`] has
    /// already settled who owns each Caravanserai once they have run (`ah-1jl9`). A walk with no
    /// month end - a unit of unstated speed, a passage nobody has proved the far side of - is the
    /// one movement it cannot follow, so it still unsettles everyone it stood with.
    pub(crate) fn read_orders(
        &mut self,
        report: &crate::report::ParsedReport,
        orders: &str,
        ruleset: &crate::movement::rules::Ruleset,
    ) {
        use super::intents::Intent;
        let quartermaster = self.quartermasters.tag.clone();
        let studies_quartermaster = |skill: &str| {
            ruleset
                .find_skill(skill)
                .is_some_and(|found| Some(&found.tag) == quartermaster.as_ref())
        };
        // Where each unit stands at the start of the month: its hex and its structure.
        let mut inside: std::collections::BTreeMap<&str, (&str, &str)> =
            std::collections::BTreeMap::new();
        for region in &report.regions {
            for unit in &region.units {
                if let Some(structure) = unit.structure_id.as_deref() {
                    inside.insert(
                        unit.unit_id.as_str(),
                        (region.region_id.as_str(), structure),
                    );
                }
            }
        }
        let mut shaken: std::collections::BTreeSet<(&str, &str)> =
            std::collections::BTreeSet::new();
        for unit in super::intents::read_intents(orders, Some(ruleset)) {
            let mut learns = false;
            let mut builds = false;
            let mut steps_out = false;
            for placed in &unit.intents {
                match &placed.intent {
                    Intent::Study { skill } if studies_quartermaster(skill) => learns = true,
                    Intent::Build { .. } => {
                        builds = true;
                        steps_out = true;
                    }
                    Intent::Move { steps }
                        if !self.month_end.contains_key(&unit.unit_id)
                            && steps.iter().any(|step| {
                                matches!(
                                    step,
                                    crate::movement::orders::MoveStep::Go(_)
                                        | crate::movement::orders::MoveStep::In
                                )
                            }) =>
                    {
                        steps_out = true;
                    }
                    _ => {}
                }
            }
            if learns {
                self.may_learn.insert(unit.unit_id.clone());
            }
            if builds {
                self.may_own.insert(unit.unit_id.clone());
            }
            if steps_out {
                if let Some(place) = inside.get(unit.unit_id.as_str()) {
                    shaken.insert(*place);
                }
            }
        }
        for (unit, place) in &inside {
            if shaken.contains(place) {
                self.may_own.insert((*unit).to_string());
            }
        }
    }

    /// The one judgement of one shipment line: whether the target accepts, which phase and reach
    /// it runs under, where both ends stand once `rules/sequenceofevents` has moved every unit, and
    /// whether the map lets it arrive. The target is one the report may show; a unit this month's
    /// own FORM creates is `judge_formed`'s.
    pub(crate) fn judge(
        &self,
        order: ShipmentOrder,
        sender: &str,
        sender_reported: Option<crate::report::model::Coordinate>,
        target: &str,
    ) -> Judged {
        self.judge_on(
            order,
            sender,
            sender_reported,
            target,
            self.targets.get(target),
        )
    }

    /// `judge`, for a target this month's own FORM creates, which the report cannot describe: its
    /// facts come from what the calling engine knows of it, read by `formed_target_facts`, so the
    /// effects walk and the forecast cannot judge one formed unit differently (`ah-s79p`).
    pub(crate) fn judge_formed(
        &self,
        order: ShipmentOrder,
        sender: &str,
        sender_reported: Option<crate::report::model::Coordinate>,
        target: &str,
        formed: FormedTarget<'_>,
    ) -> Judged {
        let facts = self.formed_target_facts(formed);
        self.judge_on(order, sender, sender_reported, target, Some(&facts))
    }

    /// What a formed unit is as a target: ours, owning nothing yet, and a quartermaster exactly when
    /// its skills - as far as the engine can know them - hold the catalogue's quartermaster skill.
    fn formed_target_facts(&self, formed: FormedTarget<'_>) -> TargetFacts {
        TargetFacts {
            own: true,
            quartermaster_disclosed: self.quartermasters.skill_known() && formed.skills.is_some(),
            quartermaster: formed
                .skills
                .is_some_and(|skills| self.quartermasters.held_by(skills).is_some()),
            caravanserai_owner: false,
            coordinate: formed.coordinate,
        }
    }

    fn judge_on(
        &self,
        order: ShipmentOrder,
        sender: &str,
        sender_reported: Option<crate::report::model::Coordinate>,
        target: &str,
        facts: Option<&TargetFacts>,
    ) -> Judged {
        let sender_qm = self.quartermasters.contains(sender);
        let sender_can_distribute = sender_qm
            && self
                .targets
                .get(sender)
                .is_some_and(|facts| facts.caravanserai_owner);
        let target_qm = facts.is_some_and(|facts| facts.quartermaster);
        // The long reach is the transport structure's owner's alone: `CheckTransportOrders` gives
        // anyone else `LOCAL_TRANSPORT` and refuses a TRANSPORT beyond it ("Recipient ... is too
        // far away."), so a quartermaster that owns none ships like anybody (`ah-1jl9`). A
        // DISTRIBUTE never gets it: that branch asks for `o->type == O_TRANSPORT` (`ah-4g2l`).
        let reach = reach_for(
            order,
            sender_can_distribute,
            target_qm,
            self.quartermasters.level(sender),
        );
        let measured = match (reach, sender_reported, facts) {
            (Some(reach), Some(reported), Some(facts)) => {
                let from = standing_at(&self.month_end, sender, reported);
                let to = standing_at(&self.month_end, target, facts.coordinate);
                Some(Measured {
                    reach,
                    from,
                    to,
                    arrival: {
                        let settled = arrival(reach, from, to, self.geometry, &self.shown);
                        // A quartermaster's flat reach to a target that is no quartermaster, and
                        // every DISTRIBUTE's, is the sender's own range (`ah-nzb0`, `ah-1d3i`).
                        if sender_qm && (!target_qm || order == ShipmentOrder::Distribute) {
                            settled.distributed()
                        } else {
                            settled
                        }
                    },
                })
            }
            _ => None,
        };
        // A quartermaster that owns no Caravanserai can neither DISTRIBUTE nor ship past the flat
        // reach; either refusal is its own, not the target's (`ah-1jl9`). A DISTRIBUTE is refused
        // whoever its target is: `CheckTransportOrders` asks its issuer for a transport structure
        // unconditionally (`ah-g4bz`).
        let sender_without_caravanserai = sender_qm && !sender_can_distribute;
        // A DISTRIBUTE's issuer must hold the skill whatever the target (`ah-lis2`) - when the
        // catalogue names a quartermaster skill for our report to show. `CheckTransportOrders`
        // asks about the target's existence, its attitude and the distance before it asks this,
        // but each of those only refuses a refusal already certain here, so this answer comes
        // first on purpose: it is the one the player can act on, and it turns what would be a
        // gap in the report (an unshown or foreign target) into the certainty it is.
        let sender_not_quartermaster =
            order == ShipmentOrder::Distribute && !sender_qm && self.quartermasters.skill_known();
        // In New Origins only a DISTRIBUTE skips the target's own test: `CheckTransportOrders` asks
        // every TRANSPORT's target for the quartermaster skill and a transport structure, whoever
        // sends it, so a TRANSPORT to an ordinary unit is the target's refusal even from a
        // quartermaster owning a Caravanserai. The navigator chose the engine over
        // `rules/economy_transport`'s "may also TRANSPORT items to any unit" there (`ah-1d3i`), and
        // the page over the engine in the New Age worlds (`ah-4kcg`).
        let skips_target_test = sender_can_distribute
            && (order == ShipmentOrder::Distribute || self.transport_to_anyone);
        // In the New Age worlds a quartermaster that owns no Caravanserai is still "any unit"
        // within 2 hexes (`newage trident rules/economy_transport`: "Quartermasters may also
        // TRANSPORT items to any unit within 2 hexes"); only past them does the longer reach
        // between quartermasters ask for its Caravanserai. The navigator's ruling, `ah-a51z`.
        // Only a distance the map proves past the 2 hexes refuses it: one it cannot settle states
        // neither answer, so the target is judged as any unit and the arrival left unmeasured
        // below, and one nobody measured is judged as ah-4kcg's ordinary target is.
        let flat_arrival = measured.map(|measured| {
            arrival(
                Reach::Local,
                measured.from,
                measured.to,
                self.geometry,
                &self.shown,
            )
        });
        let any_unit_within_flat_reach = skips_target_test
            && order == ShipmentOrder::Transport
            && target_qm
            && facts.is_some_and(|facts| !facts.caravanserai_owner)
            && !matches!(flat_arrival, Some(Arrival::TooFar(_)));
        let measured = match measured {
            Some(measured)
                if any_unit_within_flat_reach && flat_arrival == Some(Arrival::Unmeasured) =>
            {
                Some(Measured {
                    arrival: Arrival::Unmeasured,
                    ..measured
                })
            }
            measured => measured,
        };
        let acceptance = match acceptance(skips_target_test, facts) {
            _ if sender_not_quartermaster => Acceptance::SenderNotQuartermaster,
            _ if sender_without_caravanserai && order == ShipmentOrder::Distribute => {
                Acceptance::SenderOwnsNoCaravanserai
            }
            Acceptance::Eligible
                if sender_without_caravanserai
                    && measured
                        .is_some_and(|measured| matches!(measured.arrival, Arrival::TooFar(_))) =>
            {
                Acceptance::SenderOwnsNoCaravanserai
            }
            Acceptance::NotCaravanseraiOwner if any_unit_within_flat_reach => {
                facts.map_or(Acceptance::EligibilityUnknown, accepted_as_any_unit)
            }
            settled => settled,
        };
        // A TRANSPORT refused on its target's account, to a unit not known to be a quartermaster,
        // is the line a DISTRIBUTE would deliver when that DISTRIBUTE is accepted - certainly for
        // ours, on the faction's attitude for another's - and the map proves it inside the reach
        // (`ah-7j90`). Asked of the DISTRIBUTE judgement itself, so the sender's tests and
        // DISTRIBUTE's `LOCAL_TRANSPORT` reach are not restated here.
        let distribute_would_deliver = order == ShipmentOrder::Transport
            && matches!(
                acceptance,
                Acceptance::NotQuartermaster | Acceptance::NotCaravanseraiOwner
            )
            && !target_qm
            && {
                let distributed = self.judge_on(
                    ShipmentOrder::Distribute,
                    sender,
                    sender_reported,
                    target,
                    facts,
                );
                matches!(
                    distributed.acceptance,
                    Acceptance::Eligible | Acceptance::AcceptanceUnknown
                ) && distributed
                    .measured
                    .is_some_and(|measured| measured.arrival == Arrival::Certain)
            };
        Judged {
            target_shown: facts.is_some(),
            distribute_would_deliver,
            // Another faction's orders are never ours to read, so its month is never settled. The
            // sender's own refusal is unsettled exactly when the sender's month is.
            unsettled: match acceptance {
                // `rules/transport` asks the target for the quartermaster skill and ownership of a
                // transport structure, so our own target's refusal is unsettled only when its
                // month could mend every one it fails (`ah-xbnu`): a STUDY of the skill gives no
                // structure, and a BUILD no skill. `acceptance` asks an own unit for the skill
                // first, so `NotCaravanseraiOwner` there means it already has the skill. A
                // `NotQuartermaster` target that already owns a Caravanserai and studies the skill
                // is the case that stays unsettled, and carries ah-7j90's "either way" hint
                // (`ah-pi5b`).
                _ if facts.is_some_and(|facts| !facts.own)
                    && matches!(
                        acceptance,
                        Acceptance::NotQuartermaster | Acceptance::NotCaravanseraiOwner
                    ) =>
                {
                    true
                }
                Acceptance::NotQuartermaster => {
                    self.may_learn.contains(target)
                        && (facts.is_some_and(|facts| facts.caravanserai_owner)
                            || self.may_own.contains(target))
                }
                Acceptance::NotCaravanseraiOwner => self.may_own.contains(target),
                // The sender's own month can undo it, but only by making it an owner: it already
                // has the skill, and `rules/economy_transport` asks "a quartermaster must be the
                // owner of a structure which allows transportation", so a STUDY mends nothing
                // (`ah-xbnu`). A TRANSPORT's target's month can too: a target that ends the month a
                // quartermaster owning a Caravanserai accepts from anybody within the flat reach.
                // A DISTRIBUTE's cannot, since `CheckTransportOrders` never asks a DISTRIBUTE's
                // target about its skill or structure (`ah-g4bz`).
                Acceptance::SenderOwnsNoCaravanserai => {
                    self.may_own.contains(sender)
                        || (order == ShipmentOrder::Transport && self.month_may_change(target))
                }
                // Only the sender's own month - a STUDY of the skill - can undo it.
                Acceptance::SenderNotQuartermaster => self.may_learn.contains(sender),
                _ => false,
            },
            acceptance,
            phase: shipment_phase(sender_qm, target_qm),
            reach,
            measured,
        }
    }

    /// What a shipment whose ends `judge` measured costs by weight.
    pub(crate) fn priced(
        &self,
        measured: &Measured,
        language: OrderLanguage,
        weight: i64,
    ) -> Priced {
        priced(
            measured.reach,
            measured.from,
            measured.to,
            self.geometry,
            &self.shown,
            language,
            weight,
        )
    }
}

/// A shipment target this month's own FORM creates (`ah-s79p`): what `Shipping::judge_formed`
/// needs to know of it, from whichever engine is walking the month.
#[derive(Debug, Clone, Copy)]
pub(crate) struct FormedTarget<'a> {
    /// The formed unit's skills, or `None` when the engine cannot know them (men arrived by a route
    /// it does not follow), which leaves its quartermaster status undisclosed.
    pub skills: Option<&'a [crate::report::model::Skill]>,
    /// The hex it is formed in.
    pub coordinate: crate::report::model::Coordinate,
}

/// What `Shipping::judge` settled about one line. Owned and `Copy`, so the preview can hold it
/// across `&mut self`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Judged {
    /// The report shows the target somewhere: `targets` has an entry for it.
    pub target_shown: bool,
    /// A refusal `acceptance` reads off the report that the month may undo: the target belongs to
    /// another faction, or its own orders this month could make it eligible
    /// ([`Shipping::read_orders`], `ah-kjjv`) - or, for a refusal that is the sender's own, the
    /// sender's orders could (`ah-1jl9`, `ah-lis2`). `false` for every other answer. Meaningful only on a
    /// `Shipping` that has read the month's orders; every caller does, straight after `read`.
    pub unsettled: bool,
    /// A TRANSPORT refused because its target is no quartermaster owning a Caravanserai, which the
    /// same line written as DISTRIBUTE would deliver: the sender is a quartermaster owning one, the
    /// target is not known to be a quartermaster, and the map proves it within DISTRIBUTE's reach
    /// (`ah-7j90`). For another faction's target the DISTRIBUTE still waits on that faction's
    /// attitude. `false` for every other line, a DISTRIBUTE included.
    pub distribute_would_deliver: bool,
    pub acceptance: Acceptance,
    pub phase: ShipmentPhase,
    /// `None` exactly when `reach_for` answers `None`.
    pub reach: Option<Reach>,
    /// `Some` exactly when `reach`, the sender's reported hex and the target's facts are all known.
    pub measured: Option<Measured>,
}

/// Both ends of a shipment as the month leaves them, and whether it arrives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Measured {
    pub reach: Reach,
    /// `standing_at(month_end, sender, sender_reported)`.
    pub from: crate::report::model::Coordinate,
    /// `standing_at(month_end, target, facts.coordinate)`.
    pub to: crate::report::model::Coordinate,
    /// `arrival(reach, from, to, geometry, &shown)` - ungated: the preview's switch stays the
    /// preview's.
    pub arrival: Arrival,
}

/// The target id of a line any surface measures, or `None` for a line none of them does: another
/// faction's `NEW`, unit `0`, a target that is the sender itself, or a `Class` / `WholeUnit`
/// selector. `NEW` aliases resolve to the same synthetic ids used for formed units. A surface that
/// measures fewer selectors than this filters them itself.
pub(crate) fn shipment_target(
    sender: &str,
    to: &super::forms::Party,
    what: &super::forms::Selector,
) -> Option<String> {
    use super::forms::{Party, Selector};
    if matches!(what, Selector::Class(_) | Selector::WholeUnit) {
        return None;
    }
    match to {
        Party::Unit(id) if id != sender => Some(id.clone()),
        Party::New(alias) if format!("new-{alias}") != sender => Some(format!("new-{alias}")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_map() -> crate::movement::graph::MapGeometry {
        crate::movement::graph::MapGeometry {
            width: 72,
            height: 72,
            wrap_x: false,
            wrap_y: false,
            levels: None,
        }
    }

    fn hex(x: i32, y: i32) -> crate::report::model::Coordinate {
        crate::report::model::Coordinate { x, y, z: 1 }
    }

    fn hex_at_level(x: i32, y: i32, z: u32) -> crate::report::model::Coordinate {
        crate::report::model::Coordinate { x, y, z }
    }

    fn facts(
        own: bool,
        quartermaster: bool,
        caravanserai_owner: bool,
        quartermaster_disclosed: bool,
    ) -> TargetFacts {
        TargetFacts {
            own,
            quartermaster_disclosed,
            quartermaster,
            caravanserai_owner,
            coordinate: hex(0, 0),
        }
    }

    /// `rules/economy_transport`: a non-quartermaster sender needs a quartermaster target that
    /// owns a Caravanserai; only a DISTRIBUTE from a Caravanserai owner may target an ordinary unit
    /// (`ah-1d3i`).
    #[test]
    fn a_target_that_is_not_a_caravanserai_owning_quartermaster_is_refused() {
        // One of ours, holding the skill, owning the Caravanserai: the goods go.
        assert_eq!(
            acceptance(false, Some(&facts(true, true, true, true))),
            Acceptance::Eligible
        );
        // Ours, skill absent from a report that prints ours in full: a fact.
        assert_eq!(
            acceptance(false, Some(&facts(true, false, true, true))),
            Acceptance::NotQuartermaster
        );
        // Ours, with the skill but no Caravanserai of its own.
        assert_eq!(
            acceptance(false, Some(&facts(true, true, false, true))),
            Acceptance::NotCaravanseraiOwner
        );
        // Ours, but the catalogue names no quartermaster skill: missing evidence, not a missing
        // skill (`ah-d0ku`).
        assert_eq!(
            acceptance(false, Some(&facts(true, false, true, false))),
            Acceptance::EligibilityUnknown
        );
        // Foreign: the structure is drawn in our report, so ownership is certain either way.
        assert_eq!(
            acceptance(false, Some(&facts(false, true, false, true))),
            Acceptance::NotCaravanseraiOwner
        );
        // Foreign, owning one, skills undisclosed (`rules/reportformat`).
        assert_eq!(
            acceptance(false, Some(&facts(false, false, true, true))),
            Acceptance::EligibilityUnknown
        );
        // Foreign, owning one and shown holding the skill: only its attitude to us is unknown.
        assert_eq!(
            acceptance(false, Some(&facts(false, true, true, true))),
            Acceptance::AcceptanceUnknown
        );
        // A unit number the report never described at all.
        assert_eq!(acceptance(false, None), Acceptance::EligibilityUnknown);
        assert_eq!(
            acceptance(true, Some(&facts(true, false, false, true))),
            Acceptance::Eligible
        );
    }

    /// `rules/economy_transport`: a unit may send to a quartermaster "within 2 hexes", so three
    /// hexes away is refused and the sentence names both numbers (`ah-7ale.2.2.1`).
    #[test]
    fn a_shipment_beyond_the_flat_reach_is_refused_by_the_shared_rule() {
        let map = Some(fixture_map());

        assert_eq!(
            arrival(
                Reach::Local,
                hex(0, 0),
                hex(0, 6),
                map,
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::TooFar(OutOfReach::Distance {
                away: 3,
                limit: 2,
                range: Range::Accepts,
            })
        );
        // Two hexes away is inside the limit, so nothing is refused.
        assert_eq!(
            arrival(
                Reach::Local,
                hex(0, 0),
                hex(0, 4),
                map,
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::Certain
        );
        // No map shape: the distance is an upper bound only, which settles nothing (`ah-7ale.5`).
        assert_eq!(
            arrival(
                Reach::Local,
                hex(0, 0),
                hex(0, 6),
                None,
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::Unmeasured
        );

        // Which reach a shipment is measured against, by what each end is.
        let transport = ShipmentOrder::Transport;
        assert_eq!(reach_for(transport, false, true, 0), Some(Reach::Local));
        assert_eq!(
            reach_for(transport, true, true, 1),
            Some(Reach::BetweenQuartermasters { level: 1 })
        );
        assert_eq!(reach_for(transport, true, false, 1), Some(Reach::Local));
        assert_eq!(
            reach_for(ShipmentOrder::Distribute, true, true, 1),
            Some(Reach::Local)
        );
    }

    #[test]
    fn a_shipment_to_another_map_level_is_a_definite_refusal() {
        assert_eq!(
            arrival(
                Reach::Local,
                hex_at_level(0, 0, 1),
                hex_at_level(0, 6, 2),
                Some(fixture_map()),
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::TooFar(OutOfReach::DifferentLevel {
                from_level: 1,
                to_level: 2,
                range: Range::Accepts,
            })
        );
    }

    /// `ah-7ale.5`: an upper bound past the limit settles neither answer, while a settled distance
    /// and a bound inside the limit both do. A cross-level shipment keeps `ah-e07g`'s refusal.
    #[test]
    fn a_distance_the_map_cannot_settle_is_neither_in_reach_nor_out() {
        let reach = Reach::BetweenQuartermasters { level: 0 };
        let map = Some(crate::movement::graph::MapGeometry {
            width: 72,
            height: 96,
            wrap_x: false,
            wrap_y: false,
            levels: None,
        });
        assert_eq!(
            arrival(
                reach,
                hex(0, 0),
                hex(0, 8),
                None,
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::Unmeasured
        );
        assert_eq!(
            arrival(
                reach,
                hex(0, 0),
                hex(0, 8),
                map,
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::TooFar(OutOfReach::Distance {
                away: 4,
                limit: 3,
                range: Range::Ships,
            })
        );
        assert_eq!(
            arrival(
                reach,
                hex(0, 0),
                hex(0, 4),
                None,
                &crate::movement::graph::ShownExtent::default()
            ),
            Arrival::Certain
        );
        for geometry in [None, map] {
            assert!(matches!(
                arrival(
                    reach,
                    hex(0, 0),
                    hex_at_level(0, 8, 2),
                    geometry,
                    &crate::movement::graph::ShownExtent::default()
                ),
                Arrival::TooFar(OutOfReach::DifferentLevel { .. })
            ));
        }
    }

    /// `ah-7ale.5`: which of the two causes left a price unsaid.
    #[test]
    fn an_unpriceable_shipment_names_the_cause_that_left_it_unpriced() {
        let qm = Reach::BetweenQuartermasters { level: 5 };
        assert_eq!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 8),
                None,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewAgeTrident,
                9
            ),
            Priced::Unknown(Unpriceable::WorldWrap)
        );
        assert_eq!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 8),
                None,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewOrigins,
                9
            ),
            Priced::Charged {
                rate: 5,
                weight: 9,
                cost: 45
            }
        );
        for language in [OrderLanguage::NewAgeTrident, OrderLanguage::NewOrigins] {
            assert_eq!(
                priced(
                    qm,
                    hex(0, 0),
                    hex_at_level(0, 8, 2),
                    None,
                    &crate::movement::graph::ShownExtent::default(),
                    language,
                    9
                ),
                Priced::Unknown(Unpriceable::DifferentLevels)
            );
        }
    }

    /// `data/quartermaster`: "up to 3 plus (level+1)/3 hexes distant"; `rules/economy_transport`:
    /// "within 2 hexes distance".
    #[test]
    fn a_quartermasters_reach_grows_with_its_skill() {
        assert_eq!(Reach::Local.hexes(), 2);

        let reaches: Vec<i32> = (1..=5)
            .map(|level| Reach::BetweenQuartermasters { level }.hexes())
            .collect();

        assert_eq!(reaches, vec![3, 4, 4, 4, 5]);
    }

    /// `data/quartermaster`: "The cost of shipping one weight unit from one transport structure to
    /// another transport structure is `4-((level+1)/2) * 5` silver."
    #[test]
    fn shipping_costs_less_the_better_the_quartermaster() {
        let rate = |level| {
            shipping_rate(
                Reach::BetweenQuartermasters { level },
                3,
                OrderLanguage::NewAgeTrident,
            )
        };

        let rates: Vec<Option<i64>> = (1..=5).map(rate).collect();

        assert_eq!(rates, vec![Some(15), Some(15), Some(10), Some(10), Some(5)]);
        // The rules' floor: "dropping to the minimum above when the unit is at the maximum skill
        // level" - the catalogue formula would otherwise go negative.
        assert_eq!(rate(9), Some(5));
    }

    /// `rules/economy_transport`, New Age only: "Sending items to a quartermaster no more than 2
    /// hexes away is free".
    #[test]
    fn a_short_new_age_shipment_is_free_and_a_new_origins_one_is_not() {
        let reach = Reach::BetweenQuartermasters { level: 5 };

        assert_eq!(shipping_rate(reach, 2, OrderLanguage::NewAgeTrident), None);
        assert_eq!(shipping_rate(reach, 2, OrderLanguage::NewAgeArcanum), None);
        assert_eq!(
            shipping_rate(reach, 2, OrderLanguage::NewOrigins),
            Some(5),
            "New Origins states no free short range"
        );

        for language in [
            OrderLanguage::NewAgeTrident,
            OrderLanguage::NewAgeArcanum,
            OrderLanguage::NewOrigins,
        ] {
            assert_eq!(shipping_rate(reach, 3, language), Some(5), "{language:?}");
        }
    }

    fn tall_map() -> crate::movement::graph::MapGeometry {
        crate::movement::graph::MapGeometry {
            width: 72,
            height: 96,
            wrap_x: false,
            wrap_y: false,
            levels: None,
        }
    }

    /// `data/quartermaster`: "The cost of shipping one weight unit ... is `4-((level+1)/2) * 5`
    /// silver", charged on the weight the order sends (`ah-7ale.3`).
    #[test]
    fn a_long_shipment_costs_its_weight_at_the_skills_rate() {
        let map = Some(tall_map());
        assert_eq!(
            priced(
                Reach::BetweenQuartermasters { level: 5 },
                hex(0, 0),
                hex(0, 6),
                map,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewAgeTrident,
                9
            ),
            Priced::Charged {
                rate: 5,
                weight: 9,
                cost: 45
            }
        );
        assert_eq!(
            priced(
                Reach::BetweenQuartermasters { level: 1 },
                hex(0, 0),
                hex(0, 6),
                map,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewAgeTrident,
                9
            ),
            Priced::Charged {
                rate: 15,
                weight: 9,
                cost: 135
            }
        );
    }

    /// `rules/economy_transport`: a local shipment is free everywhere, and New Age carries two
    /// hexes or less free; a distance the map cannot settle leaves the price unknown only where the
    /// short range would change it (`ah-7ale.3`).
    #[test]
    fn a_price_that_is_free_or_cannot_be_worked_out_charges_nothing() {
        let map = Some(tall_map());
        let qm = Reach::BetweenQuartermasters { level: 5 };
        for language in [
            OrderLanguage::NewAgeTrident,
            OrderLanguage::NewAgeArcanum,
            OrderLanguage::NewOrigins,
        ] {
            assert_eq!(
                priced(
                    Reach::Local,
                    hex(0, 0),
                    hex(0, 6),
                    map,
                    &crate::movement::graph::ShownExtent::default(),
                    language,
                    9
                ),
                Priced::Free,
                "{language:?}"
            );
        }
        assert_eq!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 6),
                map,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewOrigins,
                0
            ),
            Priced::Free
        );
        assert_eq!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 4),
                map,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewAgeTrident,
                9
            ),
            Priced::Free
        );
        assert!(matches!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 4),
                map,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewOrigins,
                9
            ),
            Priced::Charged { rate: 5, .. }
        ));
        assert_eq!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 8),
                None,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewAgeTrident,
                9
            ),
            Priced::Unknown(Unpriceable::WorldWrap)
        );
        assert!(matches!(
            priced(
                qm,
                hex(0, 0),
                hex(0, 8),
                None,
                &crate::movement::graph::ShownExtent::default(),
                OrderLanguage::NewOrigins,
                9
            ),
            Priced::Charged { rate: 5, .. }
        ));
        let upstairs = crate::report::model::Coordinate { x: 0, y: 0, z: 2 };
        for language in [OrderLanguage::NewAgeTrident, OrderLanguage::NewOrigins] {
            assert_eq!(
                priced(
                    qm,
                    hex(0, 0),
                    upstairs,
                    map,
                    &crate::movement::graph::ShownExtent::default(),
                    language,
                    9
                ),
                Priced::Unknown(Unpriceable::DifferentLevels),
                "{language:?}"
            );
        }
    }

    #[test]
    fn a_local_shipment_is_free_in_every_game() {
        for language in [
            OrderLanguage::NewAgeTrident,
            OrderLanguage::NewAgeArcanum,
            OrderLanguage::NewOrigins,
        ] {
            for distance in 0..=4 {
                assert_eq!(
                    shipping_rate(Reach::Local, distance, language),
                    None,
                    "{language:?} at {distance}"
                );
            }
        }
    }

    fn shipping(
        quartermasters: &[(&str, u32)],
        targets: Vec<(&str, TargetFacts)>,
        month_end: &[(&str, crate::report::model::Coordinate)],
    ) -> Shipping {
        Shipping {
            quartermasters: Quartermasters {
                by_id: quartermasters
                    .iter()
                    .map(|(id, level)| ((*id).to_string(), *level))
                    .collect(),
                tag: Some("QUAM".to_string()),
            },
            targets: targets
                .into_iter()
                .map(|(id, facts)| (id.to_string(), facts))
                .collect(),
            geometry: Some(fixture_map()),
            shown: crate::movement::graph::ShownExtent::default(),
            month_end: month_end
                .iter()
                .map(|(id, at)| ((*id).to_string(), *at))
                .collect(),
            may_learn: std::collections::BTreeSet::new(),
            may_own: std::collections::BTreeSet::new(),
            transport_to_anyone: false,
        }
    }

    fn at(mut facts: TargetFacts, coordinate: crate::report::model::Coordinate) -> TargetFacts {
        facts.coordinate = coordinate;
        facts
    }

    /// `CheckTransportOrders` asks a DISTRIBUTE's issuer for a transport structure and never asks
    /// its target about skill or structure, so the target's month cannot undo the refusal; only
    /// the sender's can. A TRANSPORT's target month still can (`ah-g4bz`).
    #[test]
    fn only_the_senders_month_unsettles_a_refused_distribute() {
        let mut shipping = shipping(
            &[("900", 1), ("901", 1)],
            vec![
                ("900", at(facts(true, true, false, true), hex(0, 0))),
                ("901", at(facts(true, false, false, true), hex(0, 1))),
            ],
            &[],
        );
        // 901 fails both of the target's tests, so only a month that could mend both unsettles it.
        shipping.may_learn.insert("901".to_string());
        shipping.may_own.insert("901".to_string());

        let distributed = shipping.judge(ShipmentOrder::Distribute, "900", Some(hex(0, 0)), "901");
        assert_eq!(distributed.acceptance, Acceptance::SenderOwnsNoCaravanserai);
        assert!(!distributed.unsettled, "901's month cannot undo it");
        // A TRANSPORT to a unit that is no quartermaster is the target's refusal, whoever sends it
        // (`ah-1d3i`).
        let transported = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901");
        assert_eq!(transported.acceptance, Acceptance::NotQuartermaster);
        assert!(
            transported.unsettled,
            "901 may end the month able to accept"
        );

        // `ah-xbnu` review, finding 1: 900 already has the skill, so a STUDY of it mends nothing.
        shipping.may_learn.insert("900".to_string());
        assert!(
            !shipping
                .judge(ShipmentOrder::Distribute, "900", Some(hex(0, 0)), "901")
                .unsettled,
            "a STUDY gives 900 no Caravanserai"
        );
        shipping.may_own.insert("900".to_string());
        assert!(
            shipping
                .judge(ShipmentOrder::Distribute, "900", Some(hex(0, 0)), "901")
                .unsettled,
            "900's own month can"
        );
    }

    /// `ah-xbnu`: `rules/transport` asks a TRANSPORT's target for the quartermaster skill *and*
    /// ownership of a transport structure. A target failing both is unsettled only when its month
    /// could mend both: a STUDY of the skill alone, or a BUILD alone, leaves it refused for certain.
    #[test]
    fn a_target_failing_both_tests_is_unsettled_only_when_its_month_can_mend_both() {
        let judged = |learns: bool, owns: bool, target: TargetFacts| {
            let mut shipping = shipping(
                &[],
                vec![
                    ("900", at(facts(true, false, false, true), hex(0, 0))),
                    ("901", at(target, hex(0, 0))),
                ],
                &[],
            );
            if learns {
                shipping.may_learn.insert("901".to_string());
            }
            if owns {
                shipping.may_own.insert("901".to_string());
            }
            shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901")
        };
        let bare = || facts(true, false, false, true);
        let owner = || facts(true, false, true, true);
        let quartermaster = || facts(true, true, false, true);

        let studies_only = judged(true, false, bare());
        assert_eq!(studies_only.acceptance, Acceptance::NotQuartermaster);
        assert!(!studies_only.unsettled, "a STUDY gives no Caravanserai");
        assert!(
            !judged(false, true, bare()).unsettled,
            "a BUILD gives no skill"
        );
        assert!(judged(true, true, bare()).unsettled);
        assert!(
            judged(true, false, owner()).unsettled,
            "the owner lacks only the skill"
        );
        assert!(!judged(false, true, owner()).unsettled);

        let quartermaster_only = judged(true, false, quartermaster());
        assert_eq!(
            quartermaster_only.acceptance,
            Acceptance::NotCaravanseraiOwner
        );
        assert!(!quartermaster_only.unsettled, "it lacks only the structure");
        assert!(judged(false, true, quartermaster()).unsettled);

        // Another faction's month is never ours to read, whatever its orders show (`ah-kjjv`).
        let foreign = judged(false, false, facts(false, true, false, false));
        assert_eq!(foreign.acceptance, Acceptance::NotCaravanseraiOwner);
        assert!(
            foreign.unsettled,
            "a foreign target's month is never settled"
        );
    }

    /// `ah-1d3i`: `CheckTransportOrders` (`../Atlantis/runorders.cpp`) refuses every TRANSPORT
    /// whose target is not a quartermaster owning a transport structure, whoever the sender is; it
    /// asks a DISTRIBUTE's target nothing of the kind. The navigator chose the engine over
    /// `rules/economy_transport` (2026-10-17).
    #[test]
    fn a_transport_from_a_caravanserai_owner_is_judged_on_its_target() {
        let shipping = shipping(
            &[("900", 1), ("902", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("901", at(facts(true, false, false, true), hex(0, 1))),
                ("902", at(facts(true, true, false, true), hex(0, 1))),
            ],
            &[],
        );

        let judged = |order, target| {
            shipping
                .judge(order, "900", Some(hex(0, 0)), target)
                .acceptance
        };
        assert_eq!(
            judged(ShipmentOrder::Transport, "901"),
            Acceptance::NotQuartermaster
        );
        assert_eq!(
            judged(ShipmentOrder::Transport, "902"),
            Acceptance::NotCaravanseraiOwner
        );
        assert_eq!(
            judged(ShipmentOrder::Distribute, "901"),
            Acceptance::Eligible
        );
    }

    /// `ah-a51z`: `newage trident rules/economy_transport` (and `newage arcanum`) reads
    /// "Quartermasters may also TRANSPORT items to any unit within 2 hexes ... and may TRANSPORT
    /// items to another quartermaster up to 3 hexes distant". The navigator ruled (2026-10-22) that
    /// a quartermaster owning no Caravanserai is "any unit" within 2 hexes, and that beyond them it
    /// still needs the Caravanserai the longer reach between quartermasters asks for.
    #[test]
    fn a_new_age_transport_to_a_quartermaster_owning_no_caravanserai_goes_within_two_hexes() {
        let mut shipping = shipping(
            &[("900", 1), ("902", 1), ("903", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                // Two hexes away, and three.
                ("902", at(facts(true, true, false, true), hex(0, 4))),
                ("903", at(facts(true, true, false, true), hex(0, 6))),
            ],
            &[],
        );
        shipping.transport_to_anyone = true;

        let judged = |target| {
            shipping
                .judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), target)
                .acceptance
        };
        assert_eq!(judged("902"), Acceptance::Eligible);
        assert_eq!(judged("903"), Acceptance::NotCaravanseraiOwner);
    }

    /// `ah-a51z` follow-up review: with the sender's hex unknown nothing is measured, so the
    /// target is judged as ah-4kcg judges an ordinary one with no measurement - as any unit.
    #[test]
    fn a_new_age_transport_to_a_quartermaster_owning_no_caravanserai_from_an_unknown_hex_goes() {
        let mut shipping = shipping(
            &[("900", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("903", at(facts(true, true, false, true), hex(0, 6))),
            ],
            &[],
        );
        shipping.transport_to_anyone = true;

        let judged = shipping.judge(ShipmentOrder::Transport, "900", None, "903");
        assert_eq!(judged.acceptance, Acceptance::Eligible);
        assert_eq!(judged.measured, None);
    }

    /// `ah-a51z` review, finding 2: another faction's quartermaster owning no Caravanserai is any
    /// unit within 2 hexes too, and like any other faction's unit only its attitude stays unknown
    /// (`rules/com_attitudes`).
    #[test]
    fn a_new_age_transport_to_a_foreign_quartermaster_owning_no_caravanserai_waits_on_its_attitude()
    {
        let mut shipping = shipping(
            &[("900", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("902", at(facts(false, true, false, true), hex(0, 4))),
            ],
            &[],
        );
        shipping.transport_to_anyone = true;

        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "902");
        assert_eq!(judged.acceptance, Acceptance::AcceptanceUnknown);
    }

    /// `ah-a51z` review, finding 1: whether a quartermaster owning no Caravanserai accepts now
    /// turns on the 2 hexes, so a distance the map cannot settle (`Arrival::Unmeasured`) settles
    /// neither the delivery nor the refusal - here three hexes at most, which the longer reach
    /// between quartermasters would call certain.
    #[test]
    fn a_new_age_transport_to_a_quartermaster_owning_no_caravanserai_at_an_unmeasured_distance_is_unmeasured(
    ) {
        let mut shipping = shipping(
            &[("900", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("903", at(facts(true, true, false, true), hex(0, 6))),
            ],
            &[],
        );
        shipping.transport_to_anyone = true;
        shipping.geometry = None;

        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "903");
        assert_eq!(judged.acceptance, Acceptance::Eligible);
        assert_eq!(
            judged.measured.map(|measured| measured.arrival),
            Some(Arrival::Unmeasured)
        );
    }

    /// `ah-1d3i` review, finding 4: a TRANSPORT from a Caravanserai owner to another faction's
    /// unit that owns no Caravanserai is refused like anybody's (`CheckTransportOrders` asks every
    /// TRANSPORT's target), and left unsettled, since that faction's orders are not ours to read.
    #[test]
    fn a_transport_from_a_caravanserai_owner_to_a_foreign_non_owner_is_refused_unsettled() {
        let shipping = shipping(
            &[("900", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("901", at(facts(false, false, false, true), hex(0, 1))),
            ],
            &[],
        );

        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901");
        assert_eq!(judged.acceptance, Acceptance::NotCaravanseraiOwner);
        assert!(judged.unsettled, "another faction's month is never settled");
        assert_eq!(
            shipping
                .judge(ShipmentOrder::Distribute, "900", Some(hex(0, 0)), "901")
                .acceptance,
            Acceptance::AcceptanceUnknown
        );
    }

    /// `ah-7j90`: a TRANSPORT refused because its target is no quartermaster (`ah-1d3i`) is the
    /// line a DISTRIBUTE would have delivered whenever the sender is a quartermaster owning a
    /// Caravanserai and the target sits inside DISTRIBUTE's `LOCAL_TRANSPORT` reach
    /// (`CheckTransportOrders`, `../Atlantis/runorders.cpp`). The answer is the DISTRIBUTE
    /// judgement's own, so it agrees with what that line would be told.
    #[test]
    fn a_refused_transport_a_distribute_would_deliver_is_marked() {
        let mut shipping = shipping(
            &[("900", 1), ("902", 1), ("910", 1), ("920", 1)],
            vec![
                // 900: a quartermaster owning a Caravanserai.
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                // 901: one of ours, ordinary, a hex away.
                ("901", at(facts(true, false, false, true), hex(0, 1))),
                // 902: a quartermaster of ours owning no Caravanserai.
                ("902", at(facts(true, true, false, true), hex(0, 1))),
                // 903: one of ours, ordinary, three hexes away.
                ("903", at(facts(true, false, false, true), hex(0, 6))),
                // 904: another faction's unit owning no Caravanserai.
                ("904", at(facts(false, false, false, true), hex(0, 1))),
                // 905: one of ours, ordinary, whose month may make it a quartermaster owning a
                // Caravanserai.
                ("905", at(facts(true, false, false, true), hex(0, 1))),
                // 910: a quartermaster owning no Caravanserai, sending.
                ("910", at(facts(true, true, false, true), hex(0, 0))),
                // 911: ordinary, sending.
                ("911", at(facts(true, false, false, true), hex(0, 0))),
            ],
            &[],
        );
        // It fails both of the target's tests, so its month must be able to mend both (`ah-xbnu`).
        shipping.may_learn.insert("905".to_string());
        shipping.may_own.insert("905".to_string());
        let delivers = |order, sender, target| {
            shipping
                .judge(order, sender, Some(hex(0, 0)), target)
                .distribute_would_deliver
        };

        assert!(delivers(ShipmentOrder::Transport, "900", "901"));
        assert!(
            delivers(ShipmentOrder::Transport, "900", "904"),
            "another faction's ordinary unit, if it accepts"
        );
        let unsettled = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "905");
        assert!(unsettled.unsettled && unsettled.distribute_would_deliver);

        assert!(
            !delivers(ShipmentOrder::Distribute, "900", "901"),
            "a DISTRIBUTE is not refused"
        );
        assert!(
            !delivers(ShipmentOrder::Transport, "900", "903"),
            "beyond DISTRIBUTE's reach"
        );
        assert!(
            !delivers(ShipmentOrder::Transport, "900", "902"),
            "a quartermaster target without a Caravanserai keeps no hint"
        );
        assert!(
            !delivers(ShipmentOrder::Transport, "910", "901"),
            "a sender owning no Caravanserai cannot DISTRIBUTE"
        );
        assert!(
            !delivers(ShipmentOrder::Transport, "911", "901"),
            "a sender that is no quartermaster cannot DISTRIBUTE"
        );
    }

    /// `ah-7j90`: a distance the map cannot measure (the world's width was never reported) proves
    /// no DISTRIBUTE delivery either, so the refusal carries no hint.
    #[test]
    fn an_unmeasured_distance_names_no_distribute() {
        let mut shipping = shipping(
            &[("900", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("903", at(facts(true, false, false, true), hex(0, 6))),
            ],
            &[],
        );
        shipping.geometry = None;

        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "903");
        assert_eq!(judged.acceptance, Acceptance::NotQuartermaster);
        assert_eq!(
            shipping
                .judge(ShipmentOrder::Distribute, "900", Some(hex(0, 0)), "903")
                .measured
                .map(|measured| measured.arrival),
            Some(Arrival::Unmeasured)
        );
        assert!(!judged.distribute_would_deliver);
    }

    /// `ah-s79p`: a unit this month's FORM creates is judged on what the engine knows of it, by the
    /// one builder both engines call. A quartermaster owning a Caravanserai may DISTRIBUTE to any
    /// unit within two hexes, but a TRANSPORT's target must be a quartermaster owning a
    /// Caravanserai (`CheckTransportOrders`, `ah-1d3i`) - which a unit formed this month never is.
    #[test]
    fn a_formed_target_is_judged_on_its_own_skills() {
        // 900 is a quartermaster owning a Caravanserai, as the report shows it.
        let shipping = shipping(
            &[("900", 1)],
            vec![("900", at(facts(true, true, true, true), hex(0, 0)))],
            &[],
        );
        let quartermaster = [crate::report::model::Skill {
            name: "quartermaster".to_string(),
            tag: "QUAM".to_string(),
            level: 1,
            points: 30,
        }];
        let judged_as = |order, skills: Option<&[crate::report::model::Skill]>| {
            shipping.judge_formed(
                order,
                "900",
                Some(hex(0, 0)),
                "new-1",
                FormedTarget {
                    skills,
                    coordinate: hex(0, 0),
                },
            )
        };

        let judged = |skills| judged_as(ShipmentOrder::Distribute, skills);
        let plain = judged(Some(&[]));
        assert_eq!(plain.acceptance, Acceptance::Eligible);
        assert_eq!(
            judged_as(ShipmentOrder::Transport, Some(&[])).acceptance,
            Acceptance::NotQuartermaster
        );
        assert!(plain.target_shown, "the formed unit is described");
        assert_eq!(plain.phase, ShipmentPhase::FromQuartermaster);
        assert_eq!(
            judged(Some(&quartermaster)).acceptance,
            Acceptance::NotCaravanseraiOwner
        );
        assert_eq!(judged(None).acceptance, Acceptance::EligibilityUnknown);
    }

    /// `ah-4g2l`: `rules/transport` calls DISTRIBUTE TRANSPORT's other name, but the engine's
    /// `CheckTransportOrders` gives the long reach to `O_TRANSPORT` alone and measures every
    /// DISTRIBUTE against `LOCAL_TRANSPORT` (2), refusing it beyond that as "Recipient ... is too
    /// far away." - whoever the target is. TRANSPORT's long reach between quartermasters stays.
    #[test]
    fn a_distribute_beyond_the_flat_reach_is_refused_even_between_quartermasters() {
        // Both are quartermasters owning a Caravanserai, three hexes apart.
        let shipping = shipping(
            &[("900", 1), ("901", 1)],
            vec![
                ("900", at(facts(true, true, true, true), hex(0, 0))),
                ("901", at(facts(true, true, true, true), hex(0, 6))),
            ],
            &[],
        );

        let distributed = shipping.judge(ShipmentOrder::Distribute, "900", Some(hex(0, 0)), "901");
        assert_eq!(distributed.reach, Some(Reach::Local));
        assert_eq!(
            distributed.measured.map(|measured| measured.arrival),
            Some(Arrival::TooFar(OutOfReach::Distance {
                away: 3,
                limit: 2,
                range: Range::Distributes,
            }))
        );

        let transported = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901");
        assert_eq!(
            transported.reach,
            Some(Reach::BetweenQuartermasters { level: 1 })
        );
        assert_eq!(
            transported.measured.map(|measured| measured.arrival),
            Some(Arrival::Certain)
        );
    }

    /// `rules/sequenceofevents` moves every unit before any TRANSPORT, so both ends are measured
    /// from where the month leaves them.
    #[test]
    fn judge_measures_both_ends_from_their_month_end_hexes() {
        let shipping = shipping(
            &[("901", 1)],
            vec![("901", at(facts(true, true, true, true), hex(0, 4)))],
            &[("901", hex(0, 6))],
        );
        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901");
        assert_eq!(
            judged.measured,
            Some(Measured {
                reach: Reach::Local,
                from: hex(0, 0),
                to: hex(0, 6),
                arrival: Arrival::TooFar(OutOfReach::Distance {
                    away: 3,
                    limit: 2,
                    range: Range::Accepts,
                }),
            })
        );
        assert_eq!(judged.acceptance, Acceptance::Eligible);
        assert_eq!(judged.phase, ShipmentPhase::ToQuartermaster);
        assert!(judged.target_shown);
    }

    #[test]
    fn judge_measures_a_sender_the_map_does_not_move_from_where_the_report_shows_it() {
        let shipping = shipping(
            &[("901", 1)],
            vec![("901", at(facts(true, true, true, true), hex(0, 2)))],
            &[],
        );
        let measured = shipping
            .judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901")
            .measured
            .expect("both ends are shown");
        assert_eq!(measured.from, hex(0, 0));
        assert_eq!(measured.to, hex(0, 2));
        assert_eq!(measured.arrival, Arrival::Certain);
    }

    #[test]
    fn judge_measures_a_quartermaster_sending_to_a_non_quartermaster() {
        let shipping = shipping(
            &[("900", 2)],
            vec![("901", at(facts(true, false, true, true), hex(0, 1)))],
            &[],
        );
        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901");
        assert_eq!(judged.reach, Some(Reach::Local));
        assert_eq!(
            judged.measured,
            Some(Measured {
                reach: Reach::Local,
                from: hex(0, 0),
                to: hex(0, 1),
                arrival: Arrival::Certain,
            })
        );
        assert_eq!(judged.phase, ShipmentPhase::FromQuartermaster);
    }

    #[test]
    fn judge_measures_nothing_without_the_senders_hex() {
        let shipping = shipping(
            &[("901", 1)],
            vec![("901", at(facts(true, true, true, true), hex(0, 1)))],
            &[],
        );
        let judged = shipping.judge(ShipmentOrder::Transport, "900", None, "901");
        assert!(judged.reach.is_some());
        assert_eq!(judged.measured, None);
    }

    #[test]
    fn judge_measures_nothing_for_a_target_the_report_does_not_show() {
        let shipping = shipping(&[("901", 1)], Vec::new(), &[]);
        let judged = shipping.judge(ShipmentOrder::Transport, "900", Some(hex(0, 0)), "901");
        assert!(!judged.target_shown);
        assert_eq!(judged.acceptance, Acceptance::EligibilityUnknown);
        assert_eq!(judged.measured, None);
    }

    #[test]
    fn shipment_target_names_an_existing_unit_other_than_the_sender() {
        use super::super::forms::{Party, Selector};
        let to = Party::Unit("901".to_string());
        assert_eq!(
            shipment_target("900", &to, &Selector::Item("STON".to_string())),
            Some("901".to_string())
        );
        assert_eq!(
            shipment_target("900", &to, &Selector::UnfinishedShip("Cog".to_string())),
            Some("901".to_string())
        );
    }

    #[test]
    fn shipment_target_resolves_a_formed_unit_alias() {
        use super::super::forms::{Party, Selector};
        assert_eq!(
            shipment_target(
                "900",
                &Party::New("1".to_string()),
                &Selector::Item("SILV".to_string())
            ),
            Some("new-1".to_string())
        );
        assert_eq!(
            shipment_target(
                "new-1",
                &Party::New("1".to_string()),
                &Selector::Item("SILV".to_string())
            ),
            None
        );
    }

    #[test]
    fn shipment_target_skips_what_no_surface_measures() {
        use super::super::forms::{Party, Selector};
        let item = Selector::Item("STON".to_string());
        for to in [
            Party::Foreign {
                faction: "3".to_string(),
                alias: "1".to_string(),
            },
            Party::Discard,
            Party::Unit("900".to_string()),
        ] {
            assert_eq!(shipment_target("900", &to, &item), None, "{to:?}");
        }
        let to = Party::Unit("901".to_string());
        for what in [Selector::Class("items".to_string()), Selector::WholeUnit] {
            assert_eq!(shipment_target("900", &to, &what), None, "{what:?}");
        }
    }
}
