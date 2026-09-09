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
use crate::orders::effects::LimitingRace;
use crate::report::model::{ItemAmount, Skill};

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

/// Whether this unit may take `skill` no further, and what stops it - the ceiling test the
/// `study-at-maximum` finding makes, asked by the two surfaces that charge the fee.
///
/// `None` is *charge as today*, and it covers three different cases on purpose: the unit is below
/// its ceiling; its skills cannot be said this month; its composition cannot be said this month.
/// The house rule is silent when unsure, and the fee stands where the ceiling cannot be proved.
///
/// **The rules do not settle whether the server bills a study at the ceiling.**
/// `rules/skills_studying` prices a study; `rules/skills_limitations` and the race entries
/// (`data/GNOL`) stop it. Nothing states what happens when both apply, so this application assumes
/// the study is neither performed nor billed. If that is wrong, a capped unit's month-end figure
/// is high by its fee, and this comment is the assumption to revisit.
pub(crate) fn at_the_ceiling<'a>(
    ruleset: &'a Ruleset,
    skills: Option<&[Skill]>,
    races: Option<&[ItemAmount]>,
    skill: &SkillEntry,
) -> Option<StudyCeiling<'a>> {
    let skills = skills?;
    let races = races?;
    // No entry means the unit has never studied it, so it is not at any maximum.
    let level = skills
        .iter()
        .find(|entry| entry.tag.eq_ignore_ascii_case(&skill.tag))
        .map(|entry| entry.level)?;
    let ceiling = study_ceiling(ruleset, races, skill);
    (level >= ceiling.level()).then_some(ceiling)
}

/// A ceiling's races as the wire carries them, `men_by_race` order kept.
pub(crate) fn limiting_races(ceiling: &StudyCeiling<'_>) -> Vec<LimitingRace> {
    match ceiling {
        StudyCeiling::Global { .. } => Vec::new(),
        StudyCeiling::Race { limiting_races, .. } => limiting_races
            .iter()
            .map(|entry| LimitingRace {
                tag: entry.tag.to_ascii_uppercase(),
                name: entry.name.clone(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::rules::RaceSkillLimits;
    use crate::report::model::Skill;

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

    fn skill_entry(name: &str, tag: &str, level: u32) -> Skill {
        Skill {
            name: name.to_string(),
            tag: tag.to_string(),
            level,
            points: 0,
        }
    }

    #[test]
    fn a_unit_at_its_race_ceiling_owes_no_study_fee() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        let ceiling = at_the_ceiling(
            &ruleset,
            Some(&[skill_entry("combat", "COMB", 5)]),
            Some(&[race("GNOL", 60)]),
            &combat,
        )
        .expect("a gnoll stops at combat 5, so the month can teach nothing");

        assert_eq!(ceiling.level(), 5);
        assert_eq!(
            limiting_races(&ceiling),
            Vec::new(),
            "`data/GNOL` allows combat to 5 and combat's own maximum is 5, so the skill's cap is \
             what stops the unit and no race is blamed - the same reading the shipped \
             `study-at-maximum` sentence gives this unit"
        );

        // A ceiling a race really does impose names that race.
        let observation = skill(&ruleset, "OBSE");
        let by_race = at_the_ceiling(
            &ruleset,
            Some(&[skill_entry("observation", "OBSE", 2)]),
            Some(&[race("HUMN", 5)]),
            &observation,
        )
        .expect("`data/HUMN` stops observation at 2, below the skill's own maximum");

        assert_eq!(by_race.level(), 2);
        let races = limiting_races(&by_race);
        assert_eq!(races.len(), 1);
        assert_eq!(races[0].tag, "HUMN");
        assert!(
            !races[0].name.is_empty(),
            "the sentence needs a name to say"
        );
    }

    #[test]
    fn a_unit_below_its_ceiling_owes_the_fee() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        assert_eq!(
            at_the_ceiling(
                &ruleset,
                Some(&[skill_entry("combat", "COMB", 4)]),
                Some(&[race("GNOL", 60)]),
                &combat,
            ),
            None
        );
    }

    #[test]
    fn a_skill_the_unit_has_never_studied_owes_the_fee() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");

        assert_eq!(
            at_the_ceiling(&ruleset, Some(&[]), Some(&[race("GNOL", 60)]), &combat),
            None,
            "no entry is a unit that has never studied it, not a unit at its maximum"
        );
    }

    #[test]
    fn unsayable_skills_or_races_owe_the_fee() {
        let ruleset = ruleset();
        let combat = skill(&ruleset, "COMB");
        let held = [skill_entry("combat", "COMB", 5)];

        assert_eq!(
            at_the_ceiling(&ruleset, None, Some(&[race("GNOL", 60)]), &combat),
            None,
            "skills that cannot be said leave the fee standing"
        );
        assert_eq!(
            at_the_ceiling(&ruleset, Some(&held), None, &combat),
            None,
            "a composition that cannot be said leaves the fee standing"
        );
    }
}
