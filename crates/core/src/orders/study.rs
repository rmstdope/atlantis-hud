//! How far this unit may take a skill, once its races are taken into account.
//!
//! `rules/skills_limitations` states that a unit of several races may only study a skill as far as
//! the least of its races allows - "the least common denominator" - and `rules/tableraces` gives
//! each race a handful of specialized skills it may take to a higher level than everything else.
//! `data/HUMN` and the other race entries carry both numbers, which `ah-9hp7.1` scraped into
//! [`RaceSkillLimits`](crate::movement::rules::RaceSkillLimits).
//!
//! One decision procedure, shared by the `study-at-maximum` warning (`semantics.rs`) and by what
//! `STUDY` offers in the editor (`completion.rs`), so the two cannot disagree about the same unit.
//!
//! **Nothing is guessed.** A composition the report has not classified, a race the catalogue does
//! not carry, and a race whose entry states no limits all fall back to the skill's global maximum
//! rather than to the limits of the races that *are* known: a partly known mixed unit could
//! otherwise be told a ceiling higher than its true one, which is exactly what the validator's
//! accept-on-doubt policy forbids.

use crate::movement::rules::{ItemEntry, Ruleset, SkillEntry};
use crate::report::model::ItemAmount;

/// How far a unit may study a skill, and what says so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StudyCeiling<'a> {
    /// The skill's own maximum, which is also the answer where the races cannot be judged or do
    /// not reduce it.
    Global { level: u32 },
    /// A race limit below the skill's maximum, with every race that ties at it - in the unit's own
    /// `men_by_race` order, so a message naming them reads in the order the report wrote them.
    Race {
        level: u32,
        limiting_races: Vec<&'a ItemEntry>,
    },
}

impl StudyCeiling<'_> {
    /// The level the unit may study up to, whichever of the two says so.
    pub(crate) fn level(&self) -> u32 {
        match self {
            StudyCeiling::Global { level } | StudyCeiling::Race { level, .. } => *level,
        }
    }
}

/// The least legal ceiling for `skill` across `races`, capped by the skill's own maximum.
pub(crate) fn study_ceiling<'a>(
    ruleset: &'a Ruleset,
    races: &[ItemAmount],
    skill: &SkillEntry,
) -> StudyCeiling<'a> {
    let global = StudyCeiling::Global {
        level: skill.max_level,
    };

    let mut limits: Vec<(u32, &ItemEntry)> = Vec::new();
    for race in races.iter().filter(|race| race.amount > 0) {
        let Some(entry) = ruleset.item_spelled(&race.tag) else {
            return global;
        };
        let Some(stated) = entry.skill_limits.as_ref() else {
            return global;
        };
        let level = if stated
            .specialized_skills
            .iter()
            .any(|tag| tag.eq_ignore_ascii_case(&skill.tag))
        {
            stated.specialized_level
        } else {
            stated.default_level
        };
        limits.push((level, entry));
    }

    let Some(least) = limits.iter().map(|(level, _)| *level).min() else {
        return global;
    };
    // Equality is the skill's cap talking, not the race's: the race has taken nothing away, so the
    // message names the skill rather than blaming a race for a limit it did not impose.
    if least >= skill.max_level {
        return global;
    }

    StudyCeiling::Race {
        level: least,
        limiting_races: limits
            .iter()
            .filter(|(level, _)| *level == least)
            .map(|(_, entry)| *entry)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::rules::RaceSkillLimits;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    fn skill(ruleset: &Ruleset, tag: &str) -> SkillEntry {
        ruleset
            .skills
            .get(tag)
            .unwrap_or_else(|| panic!("{tag} is a skill"))
            .clone()
    }

    fn race(tag: &str, amount: i64) -> ItemAmount {
        ItemAmount {
            amount,
            name: String::new(),
            tag: tag.to_string(),
        }
    }

    fn tags(ceiling: &StudyCeiling<'_>) -> Vec<String> {
        match ceiling {
            StudyCeiling::Global { .. } => Vec::new(),
            StudyCeiling::Race { limiting_races, .. } => limiting_races
                .iter()
                .map(|entry| entry.tag.clone())
                .collect(),
        }
    }

    #[test]
    fn specialized_and_default_limits_are_selected_by_skill_tag() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");
        let observation = skill(&ruleset, "OBSE");

        // `data/HUMN`: combat is one of the human specializations, observation is not.
        let specialized = study_ceiling(&ruleset, &[race("HUMN", 5)], &combat);
        assert_eq!(specialized.level(), 4);
        assert_eq!(tags(&specialized), ["HUMN"]);

        let fallback = study_ceiling(&ruleset, &[race("HUMN", 5)], &observation);
        assert_eq!(fallback.level(), 2);
        assert_eq!(tags(&fallback), ["HUMN"]);
    }

    #[test]
    fn specialized_tags_are_matched_whatever_their_case() {
        let ruleset = ruleset();
        let mut combat = skill(&ruleset, "COMB");
        combat.tag = "comb".to_string();

        let ceiling = study_ceiling(&ruleset, &[race("humn", 5)], &combat);

        assert_eq!(ceiling.level(), 4, "neither tag's case decides anything");
    }

    #[test]
    fn mixed_races_use_the_lowest_limit_and_keep_every_tied_race_in_report_order() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");
        let observation = skill(&ruleset, "OBSE");

        // Combat is specialized for humans (4) and not for wood elves (2).
        let one_limits = study_ceiling(&ruleset, &[race("HUMN", 5), race("WELF", 3)], &combat);
        assert_eq!(one_limits.level(), 2);
        assert_eq!(tags(&one_limits), ["WELF"]);

        // Observation is nobody's specialization, so all three tie at their fallback.
        let tied = study_ceiling(
            &ruleset,
            &[race("HUMN", 5), race("WELF", 3), race("HELF", 1)],
            &observation,
        );
        assert_eq!(tied.level(), 2);
        assert_eq!(
            tags(&tied),
            ["HUMN", "WELF", "HELF"],
            "the unit's own order, not the catalogue's"
        );
    }

    #[test]
    fn the_skill_maximum_wins_when_lower_or_equal() {
        let mut ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        // `data/LEAD`: a leader may take every skill to 5, which is combat's own maximum too.
        let equal = study_ceiling(&ruleset, &[race("LEAD", 2)], &combat);
        assert_eq!(equal, StudyCeiling::Global { level: 5 });

        let mut capped = combat.clone();
        capped.max_level = 3;
        let lower = study_ceiling(&ruleset, &[race("HUMN", 5)], &capped);
        assert_eq!(
            lower,
            StudyCeiling::Global { level: 3 },
            "the human specialization of 4 cannot lift a skill that stops at 3"
        );

        // A race below the skill's maximum is what `Race` is for, whatever the other races allow.
        ruleset
            .items
            .get_mut("LEAD")
            .expect("leaders are an item")
            .skill_limits = Some(RaceSkillLimits {
            specialized_skills: Vec::new(),
            specialized_level: 5,
            default_level: 5,
        });
        let mixed = study_ceiling(&ruleset, &[race("LEAD", 1), race("HUMN", 5)], &combat);
        assert_eq!(mixed.level(), 4);
        assert_eq!(tags(&mixed), ["HUMN"]);
    }

    #[test]
    fn zero_count_races_do_not_limit_study() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        let ceiling = study_ceiling(&ruleset, &[race("HUMN", 5), race("WELF", 0)], &combat);

        assert_eq!(ceiling.level(), 4, "nobody in the unit is a wood elf");
        assert_eq!(tags(&ceiling), ["HUMN"]);
    }

    #[test]
    fn no_composition_uses_the_global_maximum() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        assert_eq!(
            study_ceiling(&ruleset, &[], &combat),
            StudyCeiling::Global { level: 5 }
        );
        assert_eq!(
            study_ceiling(&ruleset, &[race("HUMN", 0)], &combat),
            StudyCeiling::Global { level: 5 },
            "a unit of nobody is judged by nobody's limits"
        );
    }

    #[test]
    fn an_unknown_race_uses_the_global_maximum() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        assert_eq!(
            study_ceiling(&ruleset, &[race("HUMN", 5), race("XYZZ", 2)], &combat),
            StudyCeiling::Global { level: 5 },
            "the unknown race could be the lower one, so no race limit is claimed"
        );
    }

    #[test]
    fn one_race_without_limits_uses_the_global_maximum() {
        let mut ruleset = ruleset();
        ruleset
            .items
            .get_mut("WELF")
            .expect("wood elves are an item")
            .skill_limits = None;
        let combat = skill(&ruleset, "COMB");

        assert_eq!(
            study_ceiling(&ruleset, &[race("HUMN", 5), race("WELF", 2)], &combat),
            StudyCeiling::Global { level: 5 },
            "a ruleset cached before ah-9hp7.1 states no race limits at all"
        );
    }
}
