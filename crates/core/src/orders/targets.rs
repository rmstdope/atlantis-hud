//! Where a transfer's target stands, decided once for every surface that must agree.
//!
//! Four surfaces resolved a `GIVE`'s target separately and answered three ways for one order
//! (`ah-vcp8.2`): the units-table preview and `early_men` did nothing at all where the ledger and
//! the SILVER column charged the giver. The rule lives here rather than on `Hex` because
//! `effects::Working` has no `Hex` and `orders::silver` holds no hex types.
//!
//! `rules/give` has two permission gates and this module keeps them apart (`ah-66yi`): a unit may
//! give only to a unit it can see **unless** the target's faction has declared us Friendly, and a
//! target in another faction needs that declaration whatever we can see - with silver exempt from
//! the factional rule and men forbidden by it. Our report carries our declarations toward other
//! factions, never theirs toward us, so seeing a foreign target proves location and not
//! permission, and a number the report never prints may be a hidden Friendly target rather than a
//! definite miss. Both of those are [`GiveOutcome::Uncertain`] rather than a made-up answer.

use super::forms::Party;
use crate::movement::rules::Ruleset;

/// Silver's tag, the one item `rules/give` exempts from the factional rule.
const SILVER_TAG: &str = "SILV";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiveRefusal {
    CannotChangeHands,
    MenToAnotherFaction,
}

/// What a `GIVE`'s target is, as far as the whole report can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiveReach {
    /// One of our own units standing in this region, a unit this month's `FORM` orders create here
    /// included. Charge the giver, credit the receiver.
    Ours,
    /// `GIVE 0`: the giver loses what it gives and nobody receives it - and unit 0 is not another
    /// unit, so the game hands over even the items it refuses to give one (`rules/give`).
    Discard,
    /// A unit this region's report shows that is not ours: another faction's unit standing here,
    /// and `FACTION n NEW m`, which the game creates here. The target is definitely in reach; what
    /// the report cannot say is whether their faction has declared us Friendly.
    Foreign,
    /// A unit number the whole report never prints. It may not exist, and it may be a unit we
    /// cannot see whose faction has declared us Friendly - `rules/give` allows exactly that gift.
    /// Neither can be established from a report.
    Unshown,
    /// Definitely no target: a unit the report shows somewhere else - `rules/sequenceofevents`
    /// settles gifts in phase 4, before anything moves - a `NEW` alias no `FORM` here creates, and
    /// a unit giving to itself, which the server refuses. The order does nothing at all.
    Nowhere,
}

/// What one tag of one transfer actually does, once reach and the item are both known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiveOutcome {
    /// It leaves the giver. Whether any row of ours gains it is the caller's business.
    Moves,
    /// The game refuses to move it, and says so: the order is followed to its end and the answer
    /// is that these goods stay.
    Refused(GiveRefusal),
    /// The report cannot say whether it moves. Not a refusal and not a movement.
    Uncertain,
    /// There is no target at all, so the whole line does nothing.
    NoTarget,
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

/// How a `GIVE`'s target reads in the sentence that explains why its outcome cannot be stated.
#[must_use]
pub fn give_target_label(party: &Party) -> String {
    match party {
        Party::Unit(id) => format!("unit {id}"),
        Party::New(alias) => format!("NEW {alias}"),
        Party::Foreign { faction, alias } => format!("faction {faction}'s NEW {alias}"),
        Party::Discard => "unit 0".to_string(),
    }
}

/// Where a `GIVE` from `giver_id` lands.
///
/// `ours_here` answers "is this unit id one of ours, standing in this region" - the test each
/// surface already had. `shown_here` answers "does this region's report show a unit of this number
/// at all, ours or anyone's", which is `hex.region.units` and never `hex.units`: `Hex::read`
/// filters that to our own, which is exactly why the three cases were two. It is asked only once
/// `ours_here` has said no, so the common case pays for one lookup. `shown_anywhere` is the
/// report-wide question, and it is what separates a unit we know is elsewhere - definitely not
/// here in phase 4 - from a number the report never prints, which may be a hidden Friendly target
/// (`ah-66yi`).
#[must_use]
pub fn give_reach(
    party: &Party,
    giver_id: &str,
    ours_here: impl Fn(&str) -> bool,
    shown_here: impl Fn(&str) -> bool,
    shown_anywhere: impl Fn(&str) -> bool,
) -> GiveReach {
    let id = match party {
        Party::Discard => return GiveReach::Discard,
        // The game creates that unit in this region and it is not ours: the goods reach a target
        // whose faction we cannot read. It is not "named nowhere" however little we can see.
        Party::Foreign { .. } => return GiveReach::Foreign,
        Party::Unit(id) => id.clone(),
        // Only this month's own orders can create such a unit, so no report could ever show it and
        // `ours_here` is the whole question. A miss is a definite no-op, never uncertainty.
        Party::New(alias) => {
            let id = format!("new-{alias}");
            return if id != giver_id && ours_here(&id) {
                GiveReach::Ours
            } else {
                GiveReach::Nowhere
            };
        }
    };
    if id == giver_id {
        // `rules/give`: the server refuses a unit giving to itself, and a net-zero application
        // would reorder the item list into a phantom "items changed" row (`effects::give`).
        return GiveReach::Nowhere;
    }
    if ours_here(&id) {
        GiveReach::Ours
    } else if shown_here(&id) {
        GiveReach::Foreign
    } else if shown_anywhere(&id) {
        GiveReach::Nowhere
    } else {
        GiveReach::Unshown
    }
}

/// What one item tag of a `GIVE` does, given where the target stands.
///
/// The one permission table, so no surface may answer differently. `rules/give`: items only move
/// to a unit we can see unless that faction has declared us Friendly; a target outside our faction
/// needs that declaration whatever we can see; silver is exempt from the factional rule; men may
/// never be given across factions; and the catalogue's own "cannot be given to other units" holds
/// for every target but the discard.
#[must_use]
pub fn give_outcome(reach: GiveReach, tag: &str, ruleset: Option<&Ruleset>) -> GiveOutcome {
    let silver = tag.eq_ignore_ascii_case(SILVER_TAG);
    match reach {
        // Unit 0 is not another unit, so no permission applies and even ungiveable goods go.
        GiveReach::Discard => GiveOutcome::Moves,
        GiveReach::Nowhere => GiveOutcome::NoTarget,
        GiveReach::Ours => match ruleset {
            Some(ruleset) if !ruleset.can_be_given(tag) => {
                GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
            }
            _ => GiveOutcome::Moves,
        },
        GiveReach::Foreign => match ruleset {
            Some(ruleset) if !ruleset.can_be_given(tag) => {
                GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
            }
            Some(ruleset) if ruleset.is_man(tag) => {
                GiveOutcome::Refused(GiveRefusal::MenToAnotherFaction)
            }
            // Visible and silver: `rules/give` exempts silver from the factional rule outright, so
            // this is the one foreign gift a report can settle.
            _ if silver => GiveOutcome::Moves,
            _ => GiveOutcome::Uncertain,
        },
        GiveReach::Unshown => match ruleset {
            Some(ruleset) if !ruleset.can_be_given(tag) => {
                GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
            }
            // Silver included: whether the target exists at all is unresolved, so even the item
            // that needs no factional permission cannot be said to move.
            _ => GiveOutcome::Uncertain,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hex holding two of our own units, one unit we formed here this month, and an ally.
    /// `4573` is in the report and not ours; `new-1` is ours and in no report at all. `8000` is a
    /// unit the report shows in some *other* hex, and `999` is a number it never prints.
    fn reach(party: &Party, giver: &str) -> GiveReach {
        let ours = ["900", "901", "new-1"];
        let shown = ["900", "901", "4573"];
        let anywhere = ["900", "901", "4573", "8000"];
        give_reach(
            party,
            giver,
            |id| ours.contains(&id),
            |id| shown.contains(&id),
            |id| anywhere.contains(&id),
        )
    }

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
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

    /// Shown here, not ours: the target is definitely in reach, and `rules/give` still wants their
    /// faction's declaration, which no report carries.
    #[test]
    fn a_visible_foreign_target_needs_friendly() {
        assert_eq!(
            reach(&Party::Unit("4573".to_string()), "900"),
            GiveReach::Foreign
        );
        assert_eq!(
            give_outcome(GiveReach::Foreign, "STON", Some(&ruleset())),
            GiveOutcome::Uncertain
        );
    }

    /// The game creates that unit in this hex, so it is never "named nowhere" however little of it
    /// we can read - and it is decided without consulting any closure.
    #[test]
    fn another_factions_new_unit_is_foreign() {
        let party = Party::Foreign {
            faction: "2".to_string(),
            alias: "1".to_string(),
        };
        assert_eq!(reach(&party, "900"), GiveReach::Foreign);
    }

    /// The heart of `ah-66yi`: a number the whole report never prints is not proof of absence.
    /// `rules/give` lets a faction that has declared us Friendly receive a gift from a unit that
    /// cannot see it at all.
    #[test]
    fn an_unshown_number_is_not_a_definite_missing_target() {
        assert_eq!(
            reach(&Party::Unit("999".to_string()), "900"),
            GiveReach::Unshown
        );
    }

    /// Shown in another hex, and `rules/sequenceofevents` settles gifts in phase 4, before
    /// anything moves in phase 9 - so this one really is a definite no-op.
    #[test]
    fn a_target_shown_elsewhere_is_nowhere() {
        assert_eq!(
            reach(&Party::Unit("8000".to_string()), "900"),
            GiveReach::Nowhere
        );
    }

    /// An alias no `FORM` here creates. Only `ours_here` can answer for an alias - no report shows
    /// a unit under a number that does not exist yet - so the miss must reach `Nowhere` rather
    /// than falling through and reading as uncertainty.
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

    /// `rules/give`: "silver may be given to any unit, regardless of factional affiliation" - so a
    /// target we can see takes it definitely, with no declaration needed.
    #[test]
    fn visible_foreign_silver_moves() {
        assert_eq!(
            give_outcome(GiveReach::Foreign, "SILV", Some(&ruleset())),
            GiveOutcome::Moves
        );
    }

    /// The same silver aimed at a number the report never prints stays uncertain: the exemption is
    /// from the *factional* rule, and what is missing here is whether there is a target at all.
    #[test]
    fn ordinary_foreign_goods_are_uncertain() {
        let ruleset = ruleset();
        assert_eq!(
            give_outcome(GiveReach::Foreign, "STON", Some(&ruleset)),
            GiveOutcome::Uncertain
        );
        assert_eq!(
            give_outcome(GiveReach::Unshown, "STON", Some(&ruleset)),
            GiveOutcome::Uncertain
        );
        assert_eq!(
            give_outcome(GiveReach::Unshown, "SILV", Some(&ruleset)),
            GiveOutcome::Uncertain
        );
    }

    /// `rules/give`: "men may not be given to units in other factions", and the catalogue's own
    /// "cannot be given to other units" holds wherever the target is not the discard.
    #[test]
    fn foreign_men_and_ungiveable_items_are_refused() {
        let ruleset = ruleset();
        assert_eq!(
            give_outcome(GiveReach::Foreign, "ORC", Some(&ruleset)),
            GiveOutcome::Refused(GiveRefusal::MenToAnotherFaction)
        );
        assert_eq!(
            give_outcome(GiveReach::Foreign, "LION", Some(&ruleset)),
            GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
        );
        assert_eq!(
            give_outcome(GiveReach::Unshown, "LION", Some(&ruleset)),
            GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
        );
        assert_eq!(
            give_outcome(GiveReach::Ours, "LION", Some(&ruleset)),
            GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
        );
        // The discard is not another unit, so nothing is refused it.
        assert_eq!(
            give_outcome(GiveReach::Discard, "LION", Some(&ruleset)),
            GiveOutcome::Moves
        );
    }

    /// No catalogue at all: our own units keep today's optimism, visible foreign silver is still
    /// the rules' own exemption, and everything else a foreign or unshown target might receive is
    /// uncertain rather than assumed.
    #[test]
    fn without_a_ruleset_only_our_own_and_visible_silver_are_definite() {
        assert_eq!(
            give_outcome(GiveReach::Ours, "STON", None),
            GiveOutcome::Moves
        );
        assert_eq!(
            give_outcome(GiveReach::Discard, "STON", None),
            GiveOutcome::Moves
        );
        assert_eq!(
            give_outcome(GiveReach::Nowhere, "STON", None),
            GiveOutcome::NoTarget
        );
        assert_eq!(
            give_outcome(GiveReach::Foreign, "SILV", None),
            GiveOutcome::Moves
        );
        assert_eq!(
            give_outcome(GiveReach::Foreign, "STON", None),
            GiveOutcome::Uncertain
        );
        assert_eq!(
            give_outcome(GiveReach::Unshown, "SILV", None),
            GiveOutcome::Uncertain
        );
    }
}
