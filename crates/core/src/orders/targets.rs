//! Where a transfer's target stands, decided once for every surface that must agree.
//!
//! Four surfaces resolved a `GIVE`'s target separately and answered three ways for one order
//! (`ah-vcp8.2`): the units-table preview and `early_men` did nothing at all where the ledger and
//! the SILVER column charged the giver. The rule lives here rather than on `Hex` because
//! `effects::Working` has no `Hex` and `orders::silver` holds no hex types.

use super::forms::Party;
use crate::movement::rules::Ruleset;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiveRefusal {
    CannotChangeHands,
    MenToAnotherFaction,
}

#[must_use]
pub fn give_refusal(reach: GiveReach, tag: &str, ruleset: Option<&Ruleset>) -> Option<GiveRefusal> {
    let ruleset = ruleset?;
    match reach {
        GiveReach::Discard | GiveReach::Nowhere => None,
        GiveReach::Ours => (!ruleset.can_be_given(tag)).then_some(GiveRefusal::CannotChangeHands),
        GiveReach::Unprojectable => {
            if !ruleset.can_be_given(tag) {
                Some(GiveRefusal::CannotChangeHands)
            } else if ruleset.is_man(tag) {
                Some(GiveRefusal::MenToAnotherFaction)
            } else {
                None
            }
        }
    }
}

/// What a `GIVE`'s target is, as far as this region's report can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiveReach {
    /// One of our own units standing in this region, a unit this month's `FORM` orders create here
    /// included. Charge the giver, credit the receiver.
    Ours,
    /// `GIVE 0`: the giver loses what it gives and nobody receives it - and unit 0 is not another
    /// unit, so the game hands over even the items it refuses to give one (`rules/give`).
    Discard,
    /// A unit this region's report shows that is not ours to project: another faction's unit
    /// standing here, and `FACTION n NEW m`, which the game creates here. Charge the giver, credit
    /// nobody - `rules/give` allows the gift once their faction has declared us Friendly, and the
    /// report cannot say whether it has.
    Unprojectable,
    /// Named nowhere in this region: a unit number no unit here carries, a `NEW` alias no `FORM`
    /// here creates, and a unit giving to itself, which the server refuses. The order does nothing
    /// at all - no charge, no credit, no movement.
    Nowhere,
}

/// The unit id a party names, in the spelling every surface here files units under.
///
/// `new-{alias}` is `effects::formed_unit`'s own minting (`effects.rs:520`) and is what
/// `Hex::read` files a formed unit under, so one string answers for a reported unit and a formed
/// one alike. `None` for the two parties that name no unit id at all.
#[must_use]
pub fn party_unit_id(party: &Party) -> Option<String> {
    match party {
        Party::Unit(id) => Some(id.clone()),
        Party::New(alias) => Some(format!("new-{alias}")),
        Party::Foreign { .. } | Party::Discard => None,
    }
}

/// Where a `GIVE` from `giver_id` lands.
///
/// `ours_here` answers "is this unit id one of ours, standing in this region" - the test each
/// surface already had. `shown_here` answers "does this region's report show a unit of this number
/// at all, ours or anyone's", which is `hex.region.units` and never `hex.units`: `Hex::read`
/// filters that to our own, which is exactly why the three cases were two. It is asked only once
/// `ours_here` has said no, so the common case pays for one lookup.
#[must_use]
pub fn give_reach(
    party: &Party,
    giver_id: &str,
    ours_here: impl Fn(&str) -> bool,
    shown_here: impl Fn(&str) -> bool,
) -> GiveReach {
    let id = match party {
        Party::Discard => return GiveReach::Discard,
        // The game creates that unit in this region and it is not ours: the goods leave and no row
        // of ours gains them. It is not "named nowhere" however little we can read of it.
        Party::Foreign { .. } => return GiveReach::Unprojectable,
        Party::Unit(id) => id.clone(),
        Party::New(alias) => format!("new-{alias}"),
    };
    if id == giver_id {
        // `rules/give`: the server refuses a unit giving to itself, and a net-zero application
        // would reorder the item list into a phantom "items changed" row (`effects::give`).
        return GiveReach::Nowhere;
    }
    if ours_here(&id) {
        GiveReach::Ours
    } else if shown_here(&id) {
        GiveReach::Unprojectable
    } else {
        GiveReach::Nowhere
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hex holding two of our own units, one unit we formed here this month, and an ally.
    /// `4573` is in the report and not ours; `new-1` is ours and in no report at all.
    fn reach(party: &Party, giver: &str) -> GiveReach {
        let ours = ["900", "901", "new-1"];
        let shown = ["900", "901", "4573"];
        give_reach(
            party,
            giver,
            |id| ours.contains(&id),
            |id| shown.contains(&id),
        )
    }

    #[test]
    fn our_own_unit_standing_here_receives() {
        assert_eq!(
            reach(&Party::Unit("901".to_string()), "900"),
            GiveReach::Ours
        );
    }

    /// `Hex::read` files a formed unit under `new-{alias}`, so an alias resolves through the same
    /// `ours_here` lookup a number does.
    #[test]
    fn a_unit_formed_here_this_month_receives() {
        assert_eq!(reach(&Party::New("1".to_string()), "900"), GiveReach::Ours);
    }

    #[test]
    fn unit_zero_discards() {
        assert_eq!(reach(&Party::Discard, "900"), GiveReach::Discard);
    }

    /// The case the bead is about: shown here, not ours. The goods leave and no row of ours gains
    /// them.
    #[test]
    fn another_factions_unit_standing_here_takes_the_goods_away() {
        assert_eq!(
            reach(&Party::Unit("4573".to_string()), "900"),
            GiveReach::Unprojectable
        );
    }

    /// The game creates that unit in this hex, so it is never "named nowhere" however little of it
    /// we can read - and it is decided without consulting either closure.
    #[test]
    fn another_factions_new_unit_takes_the_goods_away() {
        let party = Party::Foreign {
            faction: "2".to_string(),
            alias: "1".to_string(),
        };
        assert_eq!(reach(&party, "900"), GiveReach::Unprojectable);
    }

    #[test]
    fn a_number_this_hex_does_not_show_reaches_nothing() {
        assert_eq!(
            reach(&Party::Unit("999".to_string()), "900"),
            GiveReach::Nowhere
        );
    }

    /// An alias no `FORM` here creates. Only `ours_here` can answer for an alias - no report shows
    /// a unit under a number that does not exist yet - so the miss must reach `Nowhere` rather
    /// than falling through to `shown_here` and reading as another faction's.
    #[test]
    fn an_alias_no_form_here_creates_reaches_nothing() {
        assert_eq!(
            reach(&Party::New("7".to_string()), "900"),
            GiveReach::Nowhere
        );
    }

    /// `rules/give`: the server refuses a unit giving to itself.
    #[test]
    fn a_unit_giving_to_itself_reaches_nothing() {
        assert_eq!(
            reach(&Party::Unit("900".to_string()), "900"),
            GiveReach::Nowhere
        );
    }

    /// `ours_here` is asked before `shown_here`, and that order is load-bearing: our own units are
    /// in `region.units` too, so reversing them reads every row of ours as another faction's.
    #[test]
    fn one_of_ours_is_never_read_as_another_factions() {
        assert_eq!(
            reach(&Party::Unit("900".to_string()), "901"),
            GiveReach::Ours
        );
    }
}
