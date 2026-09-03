use crate::movement::rules::{Ruleset, SkillEntry};
use crate::report::model::{ItemAmount, Skill};

pub(crate) const LEADER_TAG: &str = "LEAD";

pub(crate) fn begins_magic(ruleset: &Ruleset, skill: &SkillEntry) -> bool {
    ruleset.is_magic(&skill.tag) && skill.requires.is_empty()
}

pub(crate) fn is_mage(ruleset: &Ruleset, skills: &[Skill]) -> bool {
    skills.iter().any(|skill| ruleset.is_magic(&skill.tag))
}

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

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
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
                .unwrap_or_else(|| panic!("ruleset has skill {tag}"));
            assert!(begins_magic(&ruleset, entry), "{tag} should begin magic");
        }
    }

    #[test]
    fn a_derived_magic_skill_does_not_begin_magic() {
        let ruleset = ruleset();
        let entry = ruleset.find_skill("ESWO").expect("ruleset has ESWO");
        assert!(!begins_magic(&ruleset, entry));
    }

    #[test]
    fn any_magic_skill_makes_a_mage() {
        let ruleset = ruleset();
        assert!(is_mage(&ruleset, &[skill("ESWO")]));
        assert!(!is_mage(&ruleset, &[skill("LUMB")]));
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
        assert_eq!(lone_leader(1, &[]), None);
        assert_eq!(lone_leader(2, &[race(1, "LEAD")]), None);
    }
}
