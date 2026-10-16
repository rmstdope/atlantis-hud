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
//! permission, so a visible foreign target's goods are [`GiveOutcome::Uncertain`] rather than a
//! made-up answer. A number the report never prints may in principle be a hidden Friendly target,
//! but the engine finds no such unit in the region and gives nothing, so the projection gives
//! nothing too and the `give-target-not-here` warning names the number (`ah-xaem`, which reverses
//! `ah-jo6b`'s assumption that the gift lands).

use super::forms::Party;
use crate::movement::rules::Ruleset;
use crate::report::model::{ItemAmount, Skill};

/// Silver's tag, the one item `rules/give` exempts from the factional rule.
const SILVER_TAG: &str = "SILV";

/// Why the game keeps one tag of a transfer with its source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiveRefusal {
    /// The catalogue's "This item cannot be given to other units." - every target but the discard.
    CannotChangeHands,
    /// `rules/give`: "men may not be given to units in other factions".
    MenToAnotherFaction,
    /// `rules/magic`: "mages may not GIVE men at all" - the discard included, and a TAKE never.
    MageGivesMen,
    /// The navigator's New Origins ruling (`ah-ndp9`): no man may join a mage, by GIVE or by TAKE.
    MenIntoAMage,
}

/// Whether `rules/magic` refuses this `GIVE` of `tag` because the giver is a mage.
///
/// `rules/magic`: "mages may not GIVE men at all; once a unit becomes a mage (by studying one of
/// the Foundations), the unit number is fixed. (The mage may be given to another faction using the
/// GIVE UNIT order.)" So the refusal is about **men**, and about the item forms of `GIVE` only -
/// `GIVE UNIT` is the rule's own exception, and TAKE, TRANSPORT and DISTRIBUTE are other orders.
/// Callers must not put a `Selector::WholeUnit` through here.
///
/// A unit holding any catalogue-marked magic skill is already a mage: the derived skills all
/// require a Foundation to begin, so accepting every magic skill also covers a report that lists a
/// derived skill without its prerequisites. Without a ruleset nothing can be said, and the answer
/// is `false` - the same "cannot say is not a refusal" reading [`give_outcome`] takes.
#[must_use]
pub fn mage_give_refused(skills: &[Skill], tag: &str, ruleset: Option<&Ruleset>) -> bool {
    let Some(ruleset) = ruleset else {
        return false;
    };
    ruleset.is_man(tag) && super::magic::is_mage(ruleset, skills)
}

/// Whether the game refuses this `BUY` of `tag` because the buyer is a mage.
///
/// `rules/magic`: "once a unit becomes a mage (by studying one of the Foundations), the unit
/// number is fixed." The navigator's New Origins ruling (`ah-ndp9`) reads that as refusing a
/// mage's recruiting outright, so the order buys nobody and spends nothing.
///
/// Deliberately a second function rather than a rename of [`mage_give_refused`]: the two refusals
/// have different sources - the rules page states the GIVE half itself, the BUY half is a ruling -
/// so they may legitimately diverge, and one call site each is cheaper than one function with two
/// stories. Without a ruleset nothing can be said and the answer is `false`, the same "cannot say
/// is not a refusal" reading its sibling takes.
#[must_use]
pub fn mage_recruit_refused(skills: &[Skill], tag: &str, ruleset: Option<&Ruleset>) -> bool {
    let Some(ruleset) = ruleset else {
        return false;
    };
    ruleset.is_man(tag) && super::magic::is_mage(ruleset, skills)
}

/// Whether the game refuses this `BUY` of `tag` outright: the buyer is a mage
/// ([`mage_recruit_refused`]), or the recruits would put leaders and normal men in one unit.
///
/// `rules/playing_units`: "Leaders and normal people may not be mixed in the same unit", and the
/// engine refuses such a `BUY` before anything is paid (`Game::GetBuyAmount`, ../Atlantis
/// `runorders.cpp`: "BUY: Can't mix leaders and normal men.", `o->num = 0`) - a unit that is no
/// mage included (`ah-u5rz`). Every surface that prices or counts a `BUY` asks this one question,
/// so they cannot disagree about who recruits. Without a ruleset nothing can be said and the
/// answer is `false`.
#[must_use]
pub fn recruit_refused(
    skills: &[Skill],
    men_by_race: &[ItemAmount],
    tag: &str,
    ruleset: Option<&Ruleset>,
) -> bool {
    mage_recruit_refused(skills, tag, ruleset)
        || ruleset.is_some_and(|ruleset| {
            ruleset.is_man(tag) && super::magic::mixes_leaders(men_by_race, tag)
        })
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
    /// A `GIVE` to it gives nothing, as one to [`Self::Nowhere`] does: the engine looks the target
    /// up in the giver's region and, finding none, errors "Nonexistant target" before anything
    /// moves (`Game::DoGiveOrder`, ../Atlantis `runorders.cpp`), and the navigator decided
    /// (`ah-xaem`, 2026-10-16) to follow the game rather than assume a hidden Friendly target. The
    /// `give-target-not-here` warning still names the number nothing in the report matches. It is
    /// kept apart from `Nowhere` for what the other transfer orders and that warning say about it.
    Unshown,
    /// Definitely no target: a unit the report shows somewhere else - `rules/sequenceofevents`
    /// settles gifts in phase 4, before anything moves - a `NEW` alias no `FORM` here creates, and
    /// a unit giving to itself, which the server refuses. The order does nothing at all: the whole
    /// transfer is void and the giver is not charged either, exactly as `effects::give` returns
    /// early for these without touching it.
    Nowhere,
}

impl GiveReach {
    /// Whether a `GIVE` aimed here does nothing at all: the giver is not charged, nobody
    /// receives, and nothing is doubted - the ledger reads exactly as it would with the line
    /// deleted. A unit the report shows elsewhere and a number it never prints alike (`ah-xaem`).
    #[must_use]
    pub fn gives_nothing(self) -> bool {
        matches!(self, Self::Nowhere | Self::Unshown)
    }
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

/// One `GIVE` - or `TAKE` - judged once: where it lands, and who stands at each end.
///
/// The single answer every forecast surface consumes (`ah-amkn`): the units-table preview
/// (`effects::Working::give`), the headcount walk (`semantics::apply_transfers`), the hex ledger
/// (`semantics::transfer`) and the SILVER forecast (`silver.rs`) each build one of these per order
/// and ask [`GiveVerdict::of`] per tag, so a refusal rule written here reaches all four. Five fixes
/// had to find every surface by hand before it existed (`ah-xaem`, `ah-t8ei`, `ah-jo6b.4`,
/// `ah-8lej`, `ah-66yi`), and the ledger was still moving men into a mage.
///
/// Plain data and no `&Ruleset`: `effects::Working` owns its catalogue and mutates its rows while
/// a verdict is alive, so [`GiveVerdict::of`] takes the catalogue again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GiveVerdict {
    reach: GiveReach,
    is_give: bool,
    giver_is_mage: bool,
    receiver_is_mage: bool,
}

impl GiveVerdict {
    /// A `GIVE` from a unit holding `giver_skills`. `receiver_skills` is `Some` exactly when a row
    /// of ours receives - the endpoint's `row` - and is that unit's skills as the report printed
    /// them, which is what `ah-ndp9`'s refusal reads on every surface.
    #[must_use]
    pub fn give(
        reach: GiveReach,
        giver_skills: &[Skill],
        receiver_skills: Option<&[Skill]>,
        ruleset: Option<&Ruleset>,
    ) -> Self {
        Self {
            reach,
            is_give: true,
            giver_is_mage: is_mage(giver_skills, ruleset),
            receiver_is_mage: receiver_skills.is_some_and(|skills| is_mage(skills, ruleset)),
        }
    }

    /// A `TAKE` by a unit holding `taker_skills`. `rules/take` confines it to "another unit in the
    /// same faction", so the source is always [`GiveReach::Ours`]; `rules/magic`'s refusal is
    /// about GIVE, so a mage source is not asked about.
    #[must_use]
    pub fn take(taker_skills: &[Skill], ruleset: Option<&Ruleset>) -> Self {
        Self {
            reach: GiveReach::Ours,
            is_give: false,
            giver_is_mage: false,
            receiver_is_mage: is_mage(taker_skills, ruleset),
        }
    }

    /// Where the target stands.
    #[must_use]
    pub fn reach(self) -> GiveReach {
        self.reach
    }

    /// Whether this is a `GIVE` rather than a `TAKE`.
    #[must_use]
    pub fn is_give(self) -> bool {
        self.is_give
    }

    /// Whether the whole line does nothing: the source is not charged, nobody receives, and
    /// nothing is doubted - see [`GiveReach::Unshown`] and [`GiveReach::Nowhere`].
    #[must_use]
    pub fn gives_nothing(self) -> bool {
        self.reach.gives_nothing()
    }

    /// What one tag of this transfer does.
    ///
    /// No target first; then the giver's mage refusal, which holds whatever the target
    /// (`rules/magic`); then the receiver's (`ah-ndp9`); then the permission table of
    /// `rules/give`. A tag two rules refuse is reported under the first, as both walks always
    /// did. Without a catalogue nobody is a mage and nothing is a man, so neither mage refusal is
    /// made - "cannot say is not a refusal".
    #[must_use]
    pub fn of(self, tag: &str, ruleset: Option<&Ruleset>) -> GiveOutcome {
        if self.gives_nothing() {
            return GiveOutcome::NoTarget;
        }
        let is_man = ruleset.is_some_and(|ruleset| ruleset.is_man(tag));
        if is_man && self.is_give && self.giver_is_mage {
            return GiveOutcome::Refused(GiveRefusal::MageGivesMen);
        }
        if is_man && self.receiver_is_mage {
            return GiveOutcome::Refused(GiveRefusal::MenIntoAMage);
        }
        give_outcome(self.reach, tag, ruleset)
    }
}

/// Whether `skills` make a mage, as far as the catalogue can say.
fn is_mage(skills: &[Skill], ruleset: Option<&Ruleset>) -> bool {
    ruleset.is_some_and(|ruleset| super::magic::is_mage(ruleset, skills))
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

/// How a party reads in a sentence about it - a `GIVE`'s target, a `BUILD HELP`'s target.
#[must_use]
pub fn party_label(party: &Party) -> String {
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
    give_endpoint(
        party,
        giver_id,
        |id| ours_here(id).then_some(()),
        shown_here,
        shown_anywhere,
    )
    .reach
}

/// Where a transfer lands, and which of our own rows receives it.
///
/// The step every surface takes after [`give_reach`], written once: three surfaces each had their
/// own copy of it and a fourth read it backwards (`ah-1zca.2`).
///
/// `row` is `Some` exactly when `reach` is [`GiveReach::Ours`], and that is structural rather than
/// a promise: `row_of` is the same lookup that decides `Ours`, so the two cannot disagree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GiveEndpoint<T> {
    pub reach: GiveReach,
    pub row: Option<T>,
}

impl<T> GiveEndpoint<T> {
    /// One of our own rows, known without a lookup - the giver's side of a `GIVE` and the taker's
    /// side of a `TAKE`, each of which is the ordered unit itself.
    #[must_use]
    pub fn ours(row: T) -> Self {
        Self {
            reach: GiveReach::Ours,
            row: Some(row),
        }
    }

    /// No row of ours receives: the goods leave, or may leave, and nothing here gains them.
    #[must_use]
    pub fn elsewhere(reach: GiveReach) -> Self {
        Self { reach, row: None }
    }
}

/// Where a `GIVE` from `giver_id` lands, and which of our own rows receives it.
///
/// `row_of` answers "is this unit id one of ours, standing in this region - and if so, which row",
/// replacing the separate `ours_here` predicate [`give_reach`] takes: one closure, so the answer
/// that decides [`GiveReach::Ours`] and the row that is then credited cannot come from two
/// lookups. `shown_here` and `shown_anywhere` are unchanged - see [`give_reach`] for what each
/// separates and why.
#[must_use]
pub fn give_endpoint<T>(
    party: &Party,
    giver_id: &str,
    row_of: impl Fn(&str) -> Option<T>,
    shown_here: impl Fn(&str) -> bool,
    shown_anywhere: impl Fn(&str) -> bool,
) -> GiveEndpoint<T> {
    let id = match party {
        Party::Discard => return GiveEndpoint::elsewhere(GiveReach::Discard),
        // The game creates that unit in this region and it is not ours: the goods reach a target
        // whose faction we cannot read. It is not "named nowhere" however little we can see.
        Party::Foreign { .. } => return GiveEndpoint::elsewhere(GiveReach::Foreign),
        Party::Unit(id) => id.clone(),
        // Only this month's own orders can create such a unit, so no report could ever show it and
        // `row_of` is the whole question. A miss is a definite no-op, never uncertainty.
        Party::New(alias) => {
            let id = format!("new-{alias}");
            if id == giver_id {
                return GiveEndpoint::elsewhere(GiveReach::Nowhere);
            }
            return match row_of(&id) {
                Some(row) => GiveEndpoint::ours(row),
                None => GiveEndpoint::elsewhere(GiveReach::Nowhere),
            };
        }
    };
    if id == giver_id {
        // `rules/give`: the server refuses a unit giving to itself, and a net-zero application
        // would reorder the item list into a phantom "items changed" row (`effects::give`).
        return GiveEndpoint::elsewhere(GiveReach::Nowhere);
    }
    match row_of(&id) {
        Some(row) => GiveEndpoint::ours(row),
        None if shown_here(&id) => GiveEndpoint::elsewhere(GiveReach::Foreign),
        None if shown_anywhere(&id) => GiveEndpoint::elsewhere(GiveReach::Nowhere),
        None => GiveEndpoint::elsewhere(GiveReach::Unshown),
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
        // A number the report never prints gives nothing, men and all (`ah-xaem`): see
        // [`GiveReach::Unshown`].
        GiveReach::Nowhere | GiveReach::Unshown => GiveOutcome::NoTarget,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
    }

    /// A skill as a report prints it - only the tag matters to `mage_give_refused`, but the whole
    /// value is built so the test cannot drift from the report model.
    fn skill(name: &str, tag: &str) -> Skill {
        Skill {
            name: name.to_string(),
            tag: tag.to_string(),
            level: 1,
            points: 30,
        }
    }

    /// `rules/magic`: "mages may not GIVE men at all". The three Foundations, and a derived magic
    /// skill whose holder is necessarily already a mage.
    #[test]
    fn a_mage_cannot_give_a_man_tag() {
        let ruleset = ruleset();
        for (name, tag) in [
            ("force", "FORC"),
            ("pattern", "PATT"),
            ("spirit", "SPIR"),
            ("enchant swords", "ESWO"),
        ] {
            assert!(
                mage_give_refused(&[skill(name, tag)], "LEAD", Some(&ruleset)),
                "{tag} should refuse to give men"
            );
        }
    }

    /// The refusal is about men and about mages, and says nothing at all without a catalogue.
    #[test]
    fn mage_give_refusal_is_only_for_men() {
        let ruleset = ruleset();
        let mage = [skill("force", "FORC")];
        assert!(
            !mage_give_refused(&mage, "SWOR", Some(&ruleset)),
            "a mage may still give equipment"
        );
        assert!(
            !mage_give_refused(&[skill("lumberjack", "LUMB")], "LEAD", Some(&ruleset)),
            "a mundane unit may give men"
        );
        assert!(
            !mage_give_refused(&[], "LEAD", Some(&ruleset)),
            "a unit with no skills is no mage"
        );
        assert!(
            !mage_give_refused(&mage, "LEAD", None),
            "without a ruleset nothing can be said"
        );
    }

    /// The `BUY` refusal answers exactly as the `GIVE` one does: men, mages, and nothing at all
    /// without a catalogue.
    #[test]
    fn mage_recruit_refusal_matches_the_give_refusal() {
        let ruleset = ruleset();
        assert!(
            mage_recruit_refused(&[skill("force", "FORC")], "ORC", Some(&ruleset)),
            "a mage may not recruit men"
        );
        assert!(
            !mage_recruit_refused(&[skill("combat", "COMB")], "ORC", Some(&ruleset)),
            "a mundane unit may recruit men"
        );
        assert!(
            !mage_recruit_refused(&[skill("force", "FORC")], "SWOR", Some(&ruleset)),
            "a mage may still buy equipment"
        );
        assert!(
            !mage_recruit_refused(&[skill("force", "FORC")], "ORC", None),
            "without a ruleset nothing can be said"
        );
    }

    /// `rules/playing_units`: leaders and normal people may not be mixed, so a mundane unit is
    /// refused a recruit of the other kind - and only of men (`ah-u5rz`).
    #[test]
    fn a_recruit_that_mixes_leaders_and_normal_men_is_refused() {
        let ruleset = ruleset();
        let combat = [skill("combat", "COMB")];
        let leaders = [ItemAmount::new(
            1,
            "leaders".to_string(),
            "LEAD".to_string(),
        )];
        let orcs = [ItemAmount::new(2, "orcs".to_string(), "ORC".to_string())];
        assert!(recruit_refused(&combat, &leaders, "ORC", Some(&ruleset)));
        assert!(recruit_refused(&combat, &orcs, "LEAD", Some(&ruleset)));
        assert!(!recruit_refused(&combat, &leaders, "LEAD", Some(&ruleset)));
        assert!(!recruit_refused(&combat, &orcs, "HUMN", Some(&ruleset)));
        assert!(
            !recruit_refused(&combat, &leaders, "SWOR", Some(&ruleset)),
            "equipment mixes nothing"
        );
        assert!(
            recruit_refused(&[skill("force", "FORC")], &leaders, "LEAD", Some(&ruleset)),
            "a mage is still refused"
        );
        assert!(!recruit_refused(&combat, &leaders, "ORC", None));
    }

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

    /// The same hex as [`reach`], but asking for the row as well: `row_of` is the very lookup that
    /// decides `Ours`, so a row is present exactly when the reach is.
    fn endpoint(party: &Party, giver: &str) -> GiveEndpoint<usize> {
        let ours = ["900", "901", "new-1"];
        let shown = ["900", "901", "4573"];
        let anywhere = ["900", "901", "4573", "8000"];
        give_endpoint(
            party,
            giver,
            |id| ours.iter().position(|&o| o == id),
            |id| shown.contains(&id),
            |id| anywhere.contains(&id),
        )
    }

    #[test]
    fn an_endpoint_carries_the_row_that_decided_ours() {
        assert_eq!(
            endpoint(&Party::Unit("901".to_string()), "900"),
            GiveEndpoint {
                reach: GiveReach::Ours,
                row: Some(1)
            }
        );
        assert_eq!(
            endpoint(&Party::New("1".to_string()), "900"),
            GiveEndpoint {
                reach: GiveReach::Ours,
                row: Some(2)
            }
        );
    }

    #[test]
    fn every_other_reach_carries_no_row() {
        for (party, giver, reach) in [
            (Party::Discard, "900", GiveReach::Discard),
            (
                Party::Foreign {
                    faction: "2".to_string(),
                    alias: "1".to_string(),
                },
                "900",
                GiveReach::Foreign,
            ),
            (Party::Unit("4573".to_string()), "900", GiveReach::Foreign),
            (Party::Unit("8000".to_string()), "900", GiveReach::Nowhere),
            (Party::Unit("999".to_string()), "900", GiveReach::Unshown),
            (Party::Unit("900".to_string()), "900", GiveReach::Nowhere),
        ] {
            assert_eq!(
                endpoint(&party, giver),
                GiveEndpoint { reach, row: None },
                "{party:?} from {giver}"
            );
        }
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

    /// `ah-xaem`: a number the whole report never prints receives nothing, whatever is given and
    /// with or without a catalogue. The engine finds no such unit in the region and errors
    /// "Nonexistant target" before it reads the item at all (`Game::DoGiveOrder`, ../Atlantis
    /// `runorders.cpp`), so neither men nor ungiveable goods are a separate case.
    #[test]
    fn a_gift_to_an_unshown_number_gives_nothing() {
        let ruleset = ruleset();
        for tag in ["STON", "SILV", "ORC", "LION"] {
            assert_eq!(
                give_outcome(GiveReach::Unshown, tag, Some(&ruleset)),
                GiveOutcome::NoTarget,
                "{tag}"
            );
            assert_eq!(
                give_outcome(GiveReach::Unshown, tag, None),
                GiveOutcome::NoTarget,
                "{tag} with no catalogue"
            );
        }
        assert!(GiveReach::Unshown.gives_nothing());
        assert!(GiveReach::Nowhere.gives_nothing());
        for reach in [GiveReach::Ours, GiveReach::Foreign, GiveReach::Discard] {
            assert!(!reach.gives_nothing(), "{reach:?}");
        }
    }

    /// Ordinary goods aimed at a *visible* foreign unit stay uncertain: the silver exemption is
    /// from the *factional* rule alone, and what is missing here is that faction's declaration
    /// toward us. An unshown target is a different case - see
    /// `a_gift_to_an_unshown_number_gives_nothing`.
    #[test]
    fn ordinary_foreign_goods_are_uncertain() {
        let ruleset = ruleset();
        for tag in ["STON", "IRON", "WOOD", "HORS"] {
            assert_eq!(
                give_outcome(GiveReach::Foreign, tag, Some(&ruleset)),
                GiveOutcome::Uncertain,
                "{tag} to a visible foreign unit needs a declaration no report carries"
            );
        }
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
    /// the rules' own exemption, and everything else a visible foreign target might receive is
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
        // A number the report never prints receives nothing, catalogue or not (`ah-xaem`).
        assert_eq!(
            give_outcome(GiveReach::Unshown, "SILV", None),
            GiveOutcome::NoTarget
        );
    }

    /// A mage, as a report prints one: `rules/magic` makes a unit a mage by "studying one of the
    /// Foundations".
    fn mage() -> Vec<Skill> {
        vec![skill("force", "FORC")]
    }

    fn plain() -> Vec<Skill> {
        vec![skill("weaponsmith", "WEAP")]
    }

    /// `ah-amkn`: one verdict answers every reach and every refusal, so no surface needs to ask
    /// `give_outcome` or `mage_give_refused` itself.
    #[test]
    fn a_verdict_answers_every_reach_and_refusal() {
        let ruleset = ruleset();
        let rs = Some(&ruleset);
        let give =
            |reach, receiver: Option<&[Skill]>| GiveVerdict::give(reach, &plain(), receiver, rs);
        let plain_receiver = plain();
        let ours = give(GiveReach::Ours, Some(&plain_receiver));
        assert_eq!(ours.of("IRON", rs), GiveOutcome::Moves);
        assert_eq!(ours.of("ORC", rs), GiveOutcome::Moves);
        assert_eq!(
            ours.of("LION", rs),
            GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
        );
        let discard = give(GiveReach::Discard, None);
        assert_eq!(discard.of("LION", rs), GiveOutcome::Moves);
        let foreign = give(GiveReach::Foreign, None);
        assert_eq!(foreign.of("SILV", rs), GiveOutcome::Moves);
        assert_eq!(foreign.of("IRON", rs), GiveOutcome::Uncertain);
        assert_eq!(
            foreign.of("ORC", rs),
            GiveOutcome::Refused(GiveRefusal::MenToAnotherFaction)
        );
        assert_eq!(
            foreign.of("LION", rs),
            GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
        );
        for reach in [GiveReach::Unshown, GiveReach::Nowhere] {
            let nothing = give(reach, None);
            assert!(nothing.gives_nothing(), "{reach:?}");
            for tag in ["SILV", "IRON", "ORC", "LION"] {
                assert_eq!(
                    nothing.of(tag, rs),
                    GiveOutcome::NoTarget,
                    "{reach:?} {tag}"
                );
            }
        }
        for reach in [GiveReach::Ours, GiveReach::Foreign, GiveReach::Discard] {
            assert!(!give(reach, None).gives_nothing(), "{reach:?}");
            assert_eq!(give(reach, None).reach(), reach);
        }
    }

    /// `rules/magic`: "mages may not GIVE men at all" - whatever the target, the discard included,
    /// and only men.
    #[test]
    fn a_mage_giver_is_refused_men_even_to_the_discard() {
        let ruleset = ruleset();
        let rs = Some(&ruleset);
        let plain_receiver = plain();
        for (reach, receiver) in [
            (GiveReach::Ours, Some(plain_receiver.as_slice())),
            (GiveReach::Discard, None),
        ] {
            let verdict = GiveVerdict::give(reach, &mage(), receiver, rs);
            assert_eq!(
                verdict.of("ORC", rs),
                GiveOutcome::Refused(GiveRefusal::MageGivesMen),
                "{reach:?}"
            );
            assert_eq!(verdict.of("IRON", rs), GiveOutcome::Moves, "{reach:?}");
        }
    }

    /// `ah-ndp9`: no man may join a mage, by GIVE or by TAKE - goods still may.
    #[test]
    fn men_into_a_mage_are_refused_by_give_and_by_take() {
        let ruleset = ruleset();
        let rs = Some(&ruleset);
        let mage_receiver = mage();
        let give = GiveVerdict::give(GiveReach::Ours, &plain(), Some(&mage_receiver), rs);
        let take = GiveVerdict::take(&mage(), rs);
        for verdict in [give, take] {
            assert_eq!(
                verdict.of("ORC", rs),
                GiveOutcome::Refused(GiveRefusal::MenIntoAMage)
            );
            assert_eq!(verdict.of("IRON", rs), GiveOutcome::Moves);
        }
        // A mage giving men to a mage is refused as the giver first, as both walks always did.
        let both = GiveVerdict::give(GiveReach::Ours, &mage(), Some(&mage_receiver), rs);
        assert_eq!(
            both.of("ORC", rs),
            GiveOutcome::Refused(GiveRefusal::MageGivesMen)
        );
    }

    /// `rules/magic`'s rule is about GIVE: a TAKE from a mage is not a mage giving.
    #[test]
    fn a_take_never_applies_the_mage_giver_rule() {
        let ruleset = ruleset();
        let rs = Some(&ruleset);
        let take = GiveVerdict::take(&plain(), rs);
        assert_eq!(take.reach(), GiveReach::Ours);
        assert_eq!(take.of("ORC", rs), GiveOutcome::Moves);
        assert_eq!(
            take.of("LION", rs),
            GiveOutcome::Refused(GiveRefusal::CannotChangeHands)
        );
    }

    /// Without a catalogue nobody can be called a mage or a man, so neither mage refusal is
    /// made - the "cannot say is not a refusal" reading `mage_give_refused` always took.
    #[test]
    fn a_verdict_without_a_ruleset_refuses_nothing() {
        let mage_receiver = mage();
        let verdict = GiveVerdict::give(GiveReach::Ours, &mage(), Some(&mage_receiver), None);
        assert_eq!(verdict.of("ORC", None), GiveOutcome::Moves);
        assert_eq!(
            GiveVerdict::give(GiveReach::Foreign, &mage(), None, None).of("STON", None),
            GiveOutcome::Uncertain
        );
    }
}
