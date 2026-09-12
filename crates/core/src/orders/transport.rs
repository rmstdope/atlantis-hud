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
        OrderLanguage::NewAgeTrident | OrderLanguage::NewAgeArcanum if distance <= 2 => {
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

#[cfg(test)]
mod tests {
    use super::*;

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
