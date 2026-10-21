//! Who may become a mage, and who has already become one.
//!
//! `rules/magic`: *"Only one man units, with the man being a leader, are permitted to study these
//! skills… In addition, mages may not GIVE men at all; once a unit becomes a mage (by studying one
//! of the Foundations), the unit number is fixed."* `rules/magic_apprentices` puts the same
//! composition restriction on `manipulation`.
//!
//! One place answers "is this unit a mage", "does this skill make one" and "is this unit a lone
//! leader", so the study warning, the three arrival refusals and the GIVE verdict's mage refusals
//! ([`super::targets::GiveVerdict`]) cannot come to disagree about the same unit in the same month.
//!
//! **Accept on doubt**, like [`super::study`]: a composition the report has not fully classified
//! answers `None`, and every caller goes silent on it. A warning that is wrong costs more than one
//! that is missing.

use crate::movement::rules::{Ruleset, SkillEntry, SkillUse};
use crate::report::model::{level_for_points, ItemAmount, Skill};

/// The tag a leader carries in `men_by_race`.
///
/// `rules/tableraces` names exactly one leader race, and the data page carries no leader flag on
/// the item entry, so the tag is the only signal there is.
pub(crate) const LEADER_TAG: &str = "LEAD";

/// The skill that makes an apprentice: `rules/magic_apprentices`, "Apprentices may be created by
/// having a unit study manipulation."
pub(crate) const APPRENTICE_SKILL: &str = "MANI";

/// Whether studying `tag` is studying magic in the sense of `rules/magic_skills`' halving outside
/// a building that houses mages.
///
/// Every magic skill except manipulation: the navigator ruled it studied as the ordinary skill it
/// is (`ah-xy2g`, gh-1554). It still makes an apprentice, so [`begins_magic`] and [`is_mage`]
/// keep answering for it.
pub(crate) fn studied_as_magic(ruleset: &Ruleset, tag: &str) -> bool {
    ruleset.is_magic(tag) && !tag.eq_ignore_ascii_case(APPRENTICE_SKILL)
}

/// Whether studying `skill` is what makes a unit a mage or an apprentice.
///
/// The catalogue's magic skills that require nothing first: `force`, `pattern` and `spirit`
/// (`rules/magic_foundations`), and `manipulation` (`rules/magic_apprentices`). Every other magic
/// skill needs one of those first, so a unit ordered to study one is already a mage or is already
/// answered by `magic-study-capped-by-prerequisites`. No tag is hard-coded.
pub(crate) fn begins_magic(ruleset: &Ruleset, skill: &SkillEntry) -> bool {
    skill.is_studyable() && ruleset.is_magic(&skill.tag) && skill.requires.is_empty()
}

/// Whether this unit has already begun magic.
///
/// Any magic skill at all - the same test the GIVE refusal has applied since `ah-t8ei`, and
/// lifted out of it so the two directions of the rule cannot disagree. A derived magic skill can
/// only be held by a unit that took a Foundation first, and an apprentice is a mage for this rule.
pub(crate) fn is_mage(ruleset: &Ruleset, skills: &[Skill]) -> bool {
    skills.iter().any(|skill| ruleset.is_magic(&skill.tag))
}

/// Whether this unit's only magic is `manipulation`, which `data/MANI` says makes an apprentice
/// rather than a mage - the engine names the two apart when it refuses a recruitment
/// (`runorders.cpp`: "Apprentices can't recruit more men"), and so does the warning (`ah-yvgi`).
pub(crate) fn is_apprentice(ruleset: &Ruleset, skills: &[Skill]) -> bool {
    is_mage(ruleset, skills)
        && skills
            .iter()
            .filter(|skill| ruleset.is_magic(&skill.tag))
            .all(|skill| skill.tag.eq_ignore_ascii_case(APPRENTICE_SKILL))
}

/// Whether recruiting `tag` would put leaders and normal men in one unit, which
/// `rules/playing_units` forbids: "Leaders and normal people may not be mixed in the same unit"
/// (`ah-yvgi`). Accept on doubt: a unit whose races the report did not list mixes nothing.
pub(crate) fn mixes_leaders(men_by_race: &[ItemAmount], tag: &str) -> bool {
    let buys_leaders = tag.eq_ignore_ascii_case(LEADER_TAG);
    men_by_race
        .iter()
        .filter(|race| race.amount > 0)
        .any(|race| race.tag.eq_ignore_ascii_case(LEADER_TAG) != buys_leaders)
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

/// Days of practice a cast that works gives: `neworigins/rules.cpp` SKILL_PRACTICE_AMOUNT, per man.
pub(crate) const PRACTICE_DAYS: u32 = 5;

/// `skills` as they stand once this month's `CAST` of `spell` has practised (`ah-ozr2`), or
/// `None` when the cast practises nothing the app can be sure of.
///
/// `runorders.cpp` runs CAST before the month-long orders, so a STUDY sees the practice. The
/// engine practises only a cast that works (`spells.cpp`: `if (val) u->Practice(sk)`), and the
/// one failure counted here is the certain one: a spell that is not cast at all, or a level below
/// the lowest at which `data/<tag>` says the spell creates anything - `data/SWIN` makes its
/// Cloudship only from level 3. Where the practice goes is `unit.cpp` `Unit::Practice`, as
/// [`practised_by`] walks it.
pub(crate) fn after_cast_practice(
    ruleset: &Ruleset,
    skills: &[Skill],
    spell: &SkillEntry,
) -> Option<Vec<Skill>> {
    if !matches!(spell.usage, Some(SkillUse::Cast | SkillUse::Both)) {
        return None;
    }
    let level = level_of(skills, &spell.tag);
    let works_from = spell
        .cast
        .as_ref()
        .and_then(|cast| cast.creates.iter().map(|made| made.level).min())
        .unwrap_or(1);
    if level < works_from {
        return None;
    }
    let gains = practised_by(ruleset, skills, spell)?;
    let mut after = skills.to_vec();
    let entry = after
        .iter_mut()
        .find(|skill| skill.tag.eq_ignore_ascii_case(&gains))?;
    // A report that printed no days still printed the level, which stands at its threshold at
    // least: `rules/skills_studying`, level n at 30 * n(n+1)/2 days.
    let floor = 15 * entry.level * (entry.level + 1);
    entry.points = entry.points.max(floor) + PRACTICE_DAYS;
    entry.level = entry.level.max(level_for_points(entry.points));
    Some(after)
}

/// The tag a month's practice of `skill` raises, after `unit.cpp` `Unit::Practice`: nothing for a
/// skill never studied or already at its maximum; otherwise each prerequisite, in the order the
/// catalogue lists them, whose level is not above the skill's is practised in its place, the first
/// that gains taking the days, and one that cannot gain withholds them from the skill; with none
/// at or below, the skill itself. `packages/shared/src/castPractice.ts` walks the same rule for
/// the planner.
fn practised_by(ruleset: &Ruleset, skills: &[Skill], skill: &SkillEntry) -> Option<String> {
    let level = level_of(skills, &skill.tag);
    if level < 1 || level >= skill.max_level {
        return None;
    }
    let mut withheld = false;
    for need in &skill.requires {
        if level_of(skills, &need.tag) > level {
            continue;
        }
        // Terminates: a prerequisite's own prerequisites are strictly shallower in the tree.
        if let Some(gains) = ruleset
            .find_skill(&need.tag)
            .and_then(|prerequisite| practised_by(ruleset, skills, prerequisite))
        {
            return Some(gains);
        }
        withheld = true;
    }
    (!withheld).then(|| skill.tag.to_uppercase())
}

fn level_of(skills: &[Skill], tag: &str) -> u32 {
    skills
        .iter()
        .find(|skill| skill.tag.eq_ignore_ascii_case(tag))
        .map_or(0, |skill| skill.level)
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
        ItemAmount::new(amount, tag.to_lowercase(), tag.to_string())
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
    fn item_granted_magic_does_not_begin_magic() {
        let ruleset = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
            .expect("the committed Trident ruleset should be usable");
        let entry = ruleset
            .find_skill("CPIR")
            .expect("Trident should carry Call Pirates");
        assert!(!entry.is_studyable());
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
    fn manipulation_is_not_studied_as_magic() {
        let ruleset = ruleset();
        assert!(studied_as_magic(&ruleset, "FORC"));
        assert!(studied_as_magic(&ruleset, "ESWO"));
        assert!(!studied_as_magic(&ruleset, "MANI"));
        assert!(!studied_as_magic(&ruleset, "COMB"));
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

    /// A skill at the level `points` days stand for.
    fn at(tag: &str, points: u32) -> Skill {
        Skill {
            level: level_for_points(points),
            points,
            ..skill(tag)
        }
    }

    /// What casting `spell` raises, and to how many days, for a mage holding `skills`.
    fn practice(skills: &[Skill], spell: &str) -> Option<(String, u32, u32)> {
        let ruleset = ruleset();
        let spell = ruleset
            .find_skill(spell)
            .expect("the catalogue carries the spell");
        let after = after_cast_practice(&ruleset, skills, spell)?;
        after
            .iter()
            .zip(skills)
            .find(|(after, before)| after.points != before.points)
            .map(|(after, _)| (after.tag.clone(), after.points, after.level))
    }

    /// `unit.cpp` `Unit::Practice`: summon imps (2) passes its practice to demon lore (2, not
    /// above it), whose own prerequisites, force and spirit at 3, are above it - so demon lore
    /// takes the 5 days.
    #[test]
    fn a_spell_passes_its_practice_to_a_prerequisite_not_above_it() {
        let skills = [
            at("FORC", 180),
            at("SPIR", 180),
            at("DEMO", 175),
            at("SUIM", 90),
        ];
        assert_eq!(
            practice(&skills, "Summon_Imps"),
            Some(("DEMO".to_string(), 180, 3))
        );
    }

    /// The walk goes on down the chain: force (2) is not above demon lore (2), so force gains.
    #[test]
    fn the_practice_goes_down_the_chain_to_the_first_that_can_gain() {
        let skills = [
            at("FORC", 90),
            at("SPIR", 180),
            at("DEMO", 175),
            at("SUIM", 90),
        ];
        assert_eq!(practice(&skills, "SUIM"), Some(("FORC".to_string(), 95, 2)));
    }

    /// With every prerequisite above it, the spell practises itself.
    #[test]
    fn a_spell_with_every_prerequisite_above_it_practises_itself() {
        let skills = [
            at("FORC", 180),
            at("SPIR", 180),
            at("DEMO", 300),
            at("SUIM", 90),
        ];
        assert_eq!(practice(&skills, "SUIM"), Some(("SUIM".to_string(), 95, 2)));
    }

    /// `data/SWIN` creates its Cloudship only from level 3, so a cast at 2 fails and practises
    /// nothing; at 3 it works and weather lore (3, not above; its own force and pattern above it)
    /// gains.
    #[test]
    fn a_cast_below_the_level_that_creates_practises_nothing() {
        assert_eq!(practice(&[at("WEAT", 175), at("SWIN", 90)], "SWIN"), None);
        assert_eq!(
            practice(
                &[
                    at("FORC", 300),
                    at("PATT", 300),
                    at("WEAT", 180),
                    at("SWIN", 180)
                ],
                "SWIN"
            ),
            Some(("WEAT".to_string(), 185, 3))
        );
    }

    /// A skill that is not cast - demon lore is automatic - is never practised by a CAST.
    #[test]
    fn a_skill_that_is_not_cast_practises_nothing() {
        assert_eq!(
            practice(&[at("FORC", 180), at("SPIR", 180), at("DEMO", 90)], "DEMO"),
            None
        );
    }

    /// A level the report printed without its days still stands at its threshold.
    #[test]
    fn a_level_printed_without_days_is_counted_from_its_threshold() {
        let skills = [
            at("FORC", 180),
            at("SPIR", 180),
            Skill {
                points: 0,
                level: 2,
                ..skill("DEMO")
            },
            at("SUIM", 90),
        ];
        assert_eq!(practice(&skills, "SUIM"), Some(("DEMO".to_string(), 95, 2)));
    }
}
