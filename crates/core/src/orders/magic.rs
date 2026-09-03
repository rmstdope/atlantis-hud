//! Who may become a mage, and who has already become one.
//!
//! `rules/magic`: *"Only one man units, with the man being a leader, are permitted to study these
//! skills… In addition, mages may not GIVE men at all; once a unit becomes a mage (by studying one
//! of the Foundations), the unit number is fixed."* `rules/magic_apprentices` puts the same
//! composition restriction on `manipulation`.
//!
//! One place answers "is this unit a mage", "does this skill make one" and "is this unit a lone
//! leader", so the study warning, the three arrival refusals and [`targets::mage_give_refused`]
//! cannot come to disagree about the same unit in the same month.
//!
//! **Accept on doubt**, like [`super::study`]: a composition the report has not fully classified
//! answers `None`, and every caller goes silent on it. A warning that is wrong costs more than one
//! that is missing.

use crate::movement::rules::{Ruleset, SkillEntry};
use crate::report::model::{ItemAmount, Skill};

/// The tag a leader carries in `men_by_race`.
///
/// `rules/tableraces` names exactly one leader race, and the data page carries no leader flag on
/// the item entry, so the tag is the only signal there is.
pub(crate) const LEADER_TAG: &str = "LEAD";

/// Whether studying `skill` is what makes a unit a mage or an apprentice.
///
/// The catalogue's magic skills that require nothing first: `force`, `pattern` and `spirit`
/// (`rules/magic_foundations`), and `manipulation` (`rules/magic_apprentices`). Every other magic
/// skill needs one of those first, so a unit ordered to study one is already a mage or is already
/// answered by `magic-study-capped-by-prerequisites`. No tag is hard-coded.
pub(crate) fn begins_magic(ruleset: &Ruleset, skill: &SkillEntry) -> bool {
    ruleset.is_magic(&skill.tag) && skill.requires.is_empty()
}

/// Whether this unit has already begun magic.
///
/// Any magic skill at all - the same test `mage_give_refused` has applied since `ah-t8ei`, and
/// lifted out of it so the two directions of the rule cannot disagree. A derived magic skill can
/// only be held by a unit that took a Foundation first, and an apprentice is a mage for this rule.
pub(crate) fn is_mage(ruleset: &Ruleset, skills: &[Skill]) -> bool {
    skills.iter().any(|skill| ruleset.is_magic(&skill.tag))
}

/// Whether this unit is exactly one man and that man a leader.
///
/// `None` where the app cannot say: a race breakdown that does not account for every man.
pub(crate) fn lone_leader(men: i64, men_by_race: &[ItemAmount]) -> Option<bool> {
    if men_by_race.iter().map(|race| race.amount).sum::<i64>() != men {
        return None;
    }
    Some(
        men == 1
            && men_by_race
                .iter()
                .filter(|race| race.amount > 0)
                .all(|race| race.tag.eq_ignore_ascii_case(LEADER_TAG)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    fn skill(tag: &str) -> Skill {
        Skill {
            name: tag.to_lowercase(),
            tag: tag.to_string(),
            level: 1,
            points: 30,
        }
    }

    fn race(amount: i64, tag: &str) -> ItemAmount {
        ItemAmount {
            amount,
            name: tag.to_lowercase(),
            tag: tag.to_string(),
        }
    }

    #[test]
    fn foundations_and_manipulation_begin_magic() {
        let ruleset = ruleset();
        for tag in ["FORC", "PATT", "SPIR", "MANI"] {
            let entry = ruleset
                .find_skill(tag)
                .expect("the catalogue should carry the foundation");
            assert!(begins_magic(&ruleset, entry), "{tag} should begin magic");
        }
    }

    #[test]
    fn a_derived_magic_skill_does_not_begin_magic() {
        let ruleset = ruleset();
        let entry = ruleset
            .find_skill("ESWO")
            .expect("the catalogue should carry the derived skill");
        assert!(!begins_magic(&ruleset, entry));
    }

    #[test]
    fn any_magic_skill_makes_a_mage() {
        let ruleset = ruleset();
        assert!(is_mage(&ruleset, &[skill("ESWO")]));
        assert!(is_mage(&ruleset, &[skill("FORC")]));
        assert!(is_mage(&ruleset, &[skill("MANI")]));
        assert!(!is_mage(&ruleset, &[skill("COMB")]));
        assert!(!is_mage(&ruleset, &[]));
    }

    #[test]
    fn lone_leader_is_one_leader_and_nothing_else() {
        assert_eq!(lone_leader(1, &[race(1, "LEAD")]), Some(true));
        assert_eq!(lone_leader(2, &[race(2, "LEAD")]), Some(false));
        assert_eq!(lone_leader(1, &[race(1, "HUMN")]), Some(false));
        assert_eq!(
            lone_leader(2, &[race(1, "LEAD"), race(1, "HUMN")]),
            Some(false)
        );
        assert_eq!(lone_leader(0, &[]), Some(false));
    }

    #[test]
    fn a_composition_that_does_not_add_up_cannot_be_judged() {
        assert_eq!(lone_leader(3, &[race(1, "LEAD")]), None);
        assert_eq!(lone_leader(1, &[]), None);
    }
}
