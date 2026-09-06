//! The vocabulary of unit flags: the words a report prints, and the settings the flag orders change.
//!
//! It lives under `report` rather than `orders` because these are the *report's* words. The parser
//! (`report::unit::matching_flag`) accepts exactly this closed set and `report::write` writes it
//! back verbatim, so a spelling the preview invents and the parser does not know would break that
//! round trip. One declaration serves both.

/// Every setting the game defines a flag order for.
///
/// A setting, not a flag: `rules/consume`, `rules/reveal` and `rules/spoils` each define one
/// setting with several states, and the report prints a different word for each state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Setting {
    Guarding,
    Avoiding,
    Behind,
    Sharing,
    Taxing,
    NoAid,
    Holding,
    NoCross,
    RevealingUnit,
    RevealingFaction,
    ConsumingUnit,
    ConsumingFaction,
    SpoilsWeightless,
    SpoilsWalking,
    SpoilsRiding,
    SpoilsFlying,
    SpoilsSwimming,
    SpoilsSailing,
}

/// Every `Setting` there is, so the vocabulary can be walked without listing it a second time.
pub(crate) const ALL_SETTINGS: &[Setting] = &[
    Setting::Guarding,
    Setting::Avoiding,
    Setting::Behind,
    Setting::Sharing,
    Setting::Taxing,
    Setting::NoAid,
    Setting::Holding,
    Setting::NoCross,
    Setting::RevealingUnit,
    Setting::RevealingFaction,
    Setting::ConsumingUnit,
    Setting::ConsumingFaction,
    Setting::SpoilsWeightless,
    Setting::SpoilsWalking,
    Setting::SpoilsRiding,
    Setting::SpoilsFlying,
    Setting::SpoilsSwimming,
    Setting::SpoilsSailing,
];

/// A state the engine prints about a unit that no flag order sets, so no [`Setting`] owns it. The
/// parser must still accept it.
const UNOWNED_FLAGS: &[&str] = &["under strength"];

impl Setting {
    /// Every spelling a report may print for this setting, **the one reports actually print
    /// first**. The first is what the preview writes; all of them are cleared when it is unset.
    pub(crate) const fn spellings(self) -> &'static [&'static str] {
        match self {
            Setting::Guarding => &["on guard", "guarding"],
            Setting::Avoiding => &["avoiding"],
            Setting::Behind => &["behind"],
            Setting::Sharing => &["sharing"],
            Setting::Taxing => &["taxing", "autotax"],
            Setting::NoAid => &["receiving no aid", "no aid"],
            Setting::Holding => &["holding"],
            Setting::NoCross => &["won't cross water"],
            Setting::RevealingUnit => &["revealing unit"],
            Setting::RevealingFaction => &["revealing faction"],
            Setting::ConsumingUnit => &["consuming unit's food"],
            Setting::ConsumingFaction => &["consuming faction's food"],
            Setting::SpoilsWeightless => &["weightless battle spoils", "no battle spoils"],
            Setting::SpoilsWalking => &["walking battle spoils"],
            Setting::SpoilsRiding => &["riding battle spoils"],
            Setting::SpoilsFlying => &["flying battle spoils"],
            Setting::SpoilsSwimming => &["swimming battle spoils"],
            Setting::SpoilsSailing => &["sailing battle spoils"],
        }
    }
}

/// A set of settings the game allows at most one of at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    Reveal,
    Consume,
    Spoils,
}

impl Group {
    pub(crate) const fn members(self) -> &'static [Setting] {
        match self {
            Group::Reveal => &[Setting::RevealingUnit, Setting::RevealingFaction],
            Group::Consume => &[Setting::ConsumingUnit, Setting::ConsumingFaction],
            Group::Spoils => &[
                Setting::SpoilsWeightless,
                Setting::SpoilsWalking,
                Setting::SpoilsRiding,
                Setting::SpoilsFlying,
                Setting::SpoilsSwimming,
                Setting::SpoilsSailing,
            ],
        }
    }
}

/// One flag order's whole effect, owned and free of tokens and lifetimes so it can be carried out
/// of a document walk and replayed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlagChange {
    /// Turn one setting on or off, clearing every other spelling of it.
    Toggle { setting: Setting, on: bool },
    /// Put a group into one of its states, or into none of them — bare `REVEAL`, `CONSUME` and
    /// `SPOILS ALL` all mean "none of the group's flags".
    Choose {
        group: Group,
        chosen: Option<Setting>,
    },
}

/// Removes every spelling of `setting` from `flags`, however the report cased them.
fn clear(flags: &mut Vec<String>, setting: Setting) {
    flags.retain(|existing| {
        !setting
            .spellings()
            .iter()
            .any(|spelling| spelling.eq_ignore_ascii_case(existing))
    });
}

/// Whether this flag list already says `setting`, in any of its spellings.
fn holds(flags: &[String], setting: Setting) -> bool {
    flags.iter().any(|existing| {
        setting
            .spellings()
            .iter()
            .any(|spelling| spelling.eq_ignore_ascii_case(existing))
    })
}

/// Applies one change to a flag list, in the report's own spellings, without disturbing the order
/// of the flags it does not touch.
///
/// `rules/guard` and `rules/avoid`: "The Guard and Avoid Combat flags are mutually exclusive;
/// setting one automatically cancels the other" — so setting `Guarding` clears `Avoiding` and the
/// reverse, which is why that pair is handled here and not by the caller.
pub(crate) fn apply(flags: &mut Vec<String>, change: FlagChange) {
    match change {
        FlagChange::Toggle { setting, on } => {
            if !on {
                clear(flags, setting);
                return;
            }
            match setting {
                Setting::Guarding => clear(flags, Setting::Avoiding),
                Setting::Avoiding => clear(flags, Setting::Guarding),
                _ => {}
            }
            if !holds(flags, setting) {
                flags.push(setting.spellings()[0].to_string());
            }
        }
        FlagChange::Choose { group, chosen } => {
            for member in group.members() {
                if Some(*member) != chosen {
                    clear(flags, *member);
                }
            }
            if let Some(setting) = chosen {
                if !holds(flags, setting) {
                    flags.push(setting.spellings()[0].to_string());
                }
            }
        }
    }
}

/// Whether this flag list says the unit guards, in either spelling.
pub(crate) fn is_guarding(flags: &[String]) -> bool {
    holds(flags, Setting::Guarding)
}

/// Whether the report ever prints this word for a unit, and the canonical spelling if so.
///
/// Every spelling of every [`Setting`], plus the engine's own `under strength`, which no order
/// sets. Matched case-insensitively, because a report's casing is not guaranteed.
pub(crate) fn known(word: &str) -> Option<&'static str> {
    ALL_SETTINGS
        .iter()
        .flat_map(|setting| setting.spellings().iter())
        .chain(UNOWNED_FLAGS.iter())
        .find(|flag| flag.eq_ignore_ascii_case(word))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).to_string()).collect()
    }

    #[test]
    fn every_spelling_is_a_word_the_report_parser_knows() {
        for setting in ALL_SETTINGS {
            for spelling in setting.spellings() {
                assert_eq!(known(spelling), Some(*spelling), "{setting:?}");
            }
        }
        assert_eq!(known("under strength"), Some("under strength"));
    }

    #[test]
    fn a_settings_first_spelling_is_the_one_reports_print() {
        assert_eq!(Setting::Guarding.spellings()[0], "on guard");
        assert_eq!(Setting::Taxing.spellings()[0], "taxing");
        assert_eq!(Setting::NoAid.spellings()[0], "receiving no aid");
        assert_eq!(
            Setting::SpoilsWeightless.spellings()[0],
            "weightless battle spoils"
        );
    }

    #[test]
    fn a_group_lists_every_state_it_has() {
        assert_eq!(Group::Spoils.members().len(), 6);
        assert_eq!(
            Group::Reveal.members(),
            &[Setting::RevealingUnit, Setting::RevealingFaction]
        );
    }

    #[test]
    fn known_matches_however_the_report_cases_it() {
        assert_eq!(known("On Guard"), Some("on guard"));
        assert_eq!(known("not a flag"), None);
    }

    #[test]
    fn setting_a_flag_clears_every_other_spelling_of_it() {
        let mut flags = list(&["on guard"]);
        apply(
            &mut flags,
            FlagChange::Toggle {
                setting: Setting::Guarding,
                on: false,
            },
        );
        assert!(flags.is_empty(), "{flags:?}");

        let mut flags = list(&["autotax"]);
        apply(
            &mut flags,
            FlagChange::Toggle {
                setting: Setting::Taxing,
                on: false,
            },
        );
        assert!(flags.is_empty(), "{flags:?}");
    }

    #[test]
    fn setting_a_flag_writes_the_spelling_reports_print() {
        let mut flags = Vec::new();
        apply(
            &mut flags,
            FlagChange::Toggle {
                setting: Setting::Guarding,
                on: true,
            },
        );
        assert_eq!(flags, list(&["on guard"]));
    }

    #[test]
    fn setting_a_flag_twice_does_not_repeat_it() {
        let mut flags = Vec::new();
        for _ in 0..2 {
            apply(
                &mut flags,
                FlagChange::Toggle {
                    setting: Setting::Guarding,
                    on: true,
                },
            );
        }
        assert_eq!(flags, list(&["on guard"]));
    }

    #[test]
    fn guarding_and_avoiding_cancel_each_other() {
        let mut flags = list(&["on guard"]);
        apply(
            &mut flags,
            FlagChange::Toggle {
                setting: Setting::Avoiding,
                on: true,
            },
        );
        assert_eq!(flags, list(&["avoiding"]));

        let mut flags = list(&["avoiding"]);
        apply(
            &mut flags,
            FlagChange::Toggle {
                setting: Setting::Guarding,
                on: true,
            },
        );
        assert_eq!(flags, list(&["on guard"]));

        // Cancelling is what *setting* one does, per `rules/guard`; unsetting one leaves the
        // other alone.
        let mut flags = list(&["on guard"]);
        apply(
            &mut flags,
            FlagChange::Toggle {
                setting: Setting::Avoiding,
                on: false,
            },
        );
        assert_eq!(flags, list(&["on guard"]));
    }

    #[test]
    fn choosing_a_group_member_clears_the_others() {
        let mut flags = list(&["riding battle spoils"]);
        apply(
            &mut flags,
            FlagChange::Choose {
                group: Group::Spoils,
                chosen: Some(Setting::SpoilsWalking),
            },
        );
        assert_eq!(flags, list(&["walking battle spoils"]));

        apply(
            &mut flags,
            FlagChange::Choose {
                group: Group::Spoils,
                chosen: None,
            },
        );
        assert!(flags.is_empty(), "{flags:?}");
    }

    #[test]
    fn applying_a_change_leaves_the_other_flags_where_they_were() {
        let mut flags = list(&["behind", "sharing"]);
        apply(
            &mut flags,
            FlagChange::Choose {
                group: Group::Consume,
                chosen: Some(Setting::ConsumingUnit),
            },
        );
        assert_eq!(flags, list(&["behind", "sharing", "consuming unit's food"]));
    }
}
