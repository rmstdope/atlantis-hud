//! How far a shipment may travel, and what it costs by weight.

use crate::movement::rules::OrderLanguage;

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
    /// out. Nothing is charged here and nothing is said; `ah-7ale.5` is what marks such a month.
    Unknown,
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
    let rate = match hex_distance(from, to, geometry) {
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
                return Priced::Unknown;
            }
            outside
        }
        // The two ends are on different levels of the map (`ah-e07g`).
        None => return Priced::Unknown,
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
    /// Whether the catalogue names a quartermaster skill at all. False makes every absence unknown
    /// rather than a fact (`ah-64wm`).
    skill_known: bool,
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
                skill_known: false,
            };
        };
        let by_id = report
            .units()
            .filter_map(|unit| {
                let level = unit
                    .skills
                    .iter()
                    .find(|skill| skill.tag.eq_ignore_ascii_case(&tag))?
                    .level;
                Some((unit.unit_id.clone(), level))
            })
            .collect();
        Self {
            by_id,
            skill_known: true,
        }
    }

    pub(crate) fn contains(&self, unit_id: &str) -> bool {
        self.by_id.contains_key(unit_id)
    }

    /// The level, or 0 for a unit the report does not show holding the skill.
    pub(crate) fn level(&self, unit_id: &str) -> u32 {
        self.by_id.get(unit_id).copied().unwrap_or_default()
    }

    pub(crate) fn skill_known(&self) -> bool {
        self.skill_known
    }
}

/// What the report shows about one unit a `TRANSPORT` could name (`ah-64wm`).
///
/// Read from the report alone, before any order runs: `rules/transport` asks about the target's
/// skill and its structure, and neither is something this month's orders are being previewed to
/// change.
pub(crate) struct TargetFacts {
    /// Ours, whose skills the report prints in full - so an absent skill is an absent skill,
    /// rather than an undisclosed one.
    pub own: bool,
    /// Whether the absence of the skill can be read as absence at all (`ah-64wm`, `ah-d0ku`).
    pub quartermaster_disclosed: bool,
    /// The report shows the quartermaster skill on this unit.
    pub quartermaster: bool,
    /// The unit is the first one listed inside a Caravanserai in its hex, which is what
    /// `rules/world_structures` makes the owner of the structure.
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

/// Whether the game will let this target accept the goods, and why not when it will not.
///
/// `rules/transport`: "The target of the transport unit must be a unit with the quartermaster
/// skill and must be the owner of a transport structure", which `rules/economy_transport` names
/// the Caravanserai and which must also "be at least FRIENDLY to the unit which issues the order".
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
    EligibilityUnknown,
    AcceptanceUnknown,
}

pub(crate) fn acceptance(facts: Option<&TargetFacts>) -> Acceptance {
    let Some(facts) = facts else {
        // A unit number the report never described: an ally's quartermaster, or a mistake.
        return Acceptance::EligibilityUnknown;
    };
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

/// Which reach this shipment is measured against, or `None` when no reach rule applies to it.
///
/// `None` is exactly `rules/sequenceofevents`' third phase - a quartermaster distributing to a unit
/// that is not one - which since `ah-64wm` carries only orders the target gate has already
/// refused, so no rule is invented for it.
pub(crate) fn reach_for(
    sender_is_quartermaster: bool,
    target_is_quartermaster: bool,
    sender_level: u32,
) -> Option<Reach> {
    if !sender_is_quartermaster {
        return Some(Reach::Local);
    }
    if target_is_quartermaster {
        return Some(Reach::BetweenQuartermasters {
            level: sender_level,
        });
    }
    None
}

/// How far apart the two ends are and how far the shipment was allowed to travel, when the map
/// settles that it is certainly too far.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OutOfReach {
    pub away: i32,
    pub limit: i32,
    /// Which sentence this refusal takes: the sender's own skill-dependent reach, or the flat two
    /// hexes a quartermaster accepts from anyone.
    pub between_quartermasters: bool,
}

/// Whether the game will refuse this shipment for distance alone, and the two numbers its sentence
/// names (`ah-7ale.2.1`).
///
/// `None` - the shipment is not refused for distance - covers "near enough", a distance the map's
/// shape leaves unsettled (`HexDistance::AtMost`, whose real distance may be anything down to
/// zero, so refusing would state a guess as a fact), and two ends on different levels of the map
/// (`hex_distance` answers `None`). `ah-7ale.5` is what marks the unsettled case as uncertain.
///
/// `AtMost(n)` with `n <= limit` is a shipment that is *certainly* in reach - an upper bound inside
/// the limit settles the question - and is likewise no refusal.
pub(crate) fn out_of_reach(
    reach: Reach,
    from: crate::report::model::Coordinate,
    to: crate::report::model::Coordinate,
    geometry: Option<crate::movement::graph::MapGeometry>,
) -> Option<OutOfReach> {
    use crate::movement::graph::{hex_distance, HexDistance};

    let limit = reach.hexes();
    let away = match hex_distance(from, to, geometry)? {
        HexDistance::Exact(hexes) => hexes,
        // An upper bound only refuses nothing: see this function's own note.
        HexDistance::AtMost(_) => return None,
    };
    if away <= limit {
        return None;
    }
    Some(OutOfReach {
        away,
        limit,
        between_quartermasters: matches!(reach, Reach::BetweenQuartermasters { .. }),
    })
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
        }
    }

    fn hex(x: i32, y: i32) -> crate::report::model::Coordinate {
        crate::report::model::Coordinate { x, y, z: 1 }
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

    /// `rules/transport`: the target "must be a unit with the quartermaster skill and must be the
    /// owner of a transport structure" - and `ah-64wm`'s four refusals for the cases the report
    /// cannot settle.
    #[test]
    fn a_target_that_is_not_a_caravanserai_owning_quartermaster_is_refused() {
        // One of ours, holding the skill, owning the Caravanserai: the goods go.
        assert_eq!(
            acceptance(Some(&facts(true, true, true, true))),
            Acceptance::Eligible
        );
        // Ours, skill absent from a report that prints ours in full: a fact.
        assert_eq!(
            acceptance(Some(&facts(true, false, true, true))),
            Acceptance::NotQuartermaster
        );
        // Ours, with the skill but no Caravanserai of its own.
        assert_eq!(
            acceptance(Some(&facts(true, true, false, true))),
            Acceptance::NotCaravanseraiOwner
        );
        // Ours, but the catalogue names no quartermaster skill: missing evidence, not a missing
        // skill (`ah-d0ku`).
        assert_eq!(
            acceptance(Some(&facts(true, false, true, false))),
            Acceptance::EligibilityUnknown
        );
        // Foreign: the structure is drawn in our report, so ownership is certain either way.
        assert_eq!(
            acceptance(Some(&facts(false, true, false, true))),
            Acceptance::NotCaravanseraiOwner
        );
        // Foreign, owning one, skills undisclosed (`rules/reportformat`).
        assert_eq!(
            acceptance(Some(&facts(false, false, true, true))),
            Acceptance::EligibilityUnknown
        );
        // Foreign, owning one and shown holding the skill: only its attitude to us is unknown.
        assert_eq!(
            acceptance(Some(&facts(false, true, true, true))),
            Acceptance::AcceptanceUnknown
        );
        // A unit number the report never described at all.
        assert_eq!(acceptance(None), Acceptance::EligibilityUnknown);
    }

    /// `rules/economy_transport`: a unit may send to a quartermaster "within 2 hexes", so three
    /// hexes away is refused and the sentence names both numbers (`ah-7ale.2.2.1`).
    #[test]
    fn a_shipment_beyond_the_flat_reach_is_refused_by_the_shared_rule() {
        let map = Some(fixture_map());

        assert_eq!(
            out_of_reach(Reach::Local, hex(0, 0), hex(0, 6), map),
            Some(OutOfReach {
                away: 3,
                limit: 2,
                between_quartermasters: false,
            })
        );
        // Two hexes away is inside the limit, so nothing is refused.
        assert_eq!(out_of_reach(Reach::Local, hex(0, 0), hex(0, 4), map), None);
        // No map shape: the distance is an upper bound only, which refuses nothing.
        assert_eq!(out_of_reach(Reach::Local, hex(0, 0), hex(0, 6), None), None);

        // Which reach a shipment is measured against, by what each end is.
        assert_eq!(reach_for(false, true, 0), Some(Reach::Local));
        assert_eq!(
            reach_for(true, true, 1),
            Some(Reach::BetweenQuartermasters { level: 1 })
        );
        // A quartermaster distributing to a unit that is not one: no reach rule applies, because
        // since `ah-64wm` the target gate has already refused every such order.
        assert_eq!(reach_for(true, false, 1), None);
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
                priced(Reach::Local, hex(0, 0), hex(0, 6), map, language, 9),
                Priced::Free,
                "{language:?}"
            );
        }
        assert_eq!(
            priced(qm, hex(0, 0), hex(0, 6), map, OrderLanguage::NewOrigins, 0),
            Priced::Free
        );
        assert_eq!(
            priced(qm, hex(0, 0), hex(0, 4), map, OrderLanguage::NewAgeTrident, 9),
            Priced::Free
        );
        assert!(matches!(
            priced(qm, hex(0, 0), hex(0, 4), map, OrderLanguage::NewOrigins, 9),
            Priced::Charged { rate: 5, .. }
        ));
        assert_eq!(
            priced(qm, hex(0, 0), hex(0, 8), None, OrderLanguage::NewAgeTrident, 9),
            Priced::Unknown
        );
        assert!(matches!(
            priced(qm, hex(0, 0), hex(0, 8), None, OrderLanguage::NewOrigins, 9),
            Priced::Charged { rate: 5, .. }
        ));
        let upstairs = crate::report::model::Coordinate { x: 0, y: 0, z: 2 };
        for language in [OrderLanguage::NewAgeTrident, OrderLanguage::NewOrigins] {
            assert_eq!(
                priced(qm, hex(0, 0), upstairs, map, language, 9),
                Priced::Unknown,
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
}
