//! Recognising the item an order names.
//!
//! The rules let a player write an item three ways - by tag (`SWOR`), by name (`sword`), or by the
//! plural the examples themselves use (`GIVE 4573 10 swords`) - and names containing spaces come
//! quoted or underscored (`"Plate Armor"`, `Plate_Armor`). All four have to be accepted or the
//! checker would complain about the rules page's own examples.
//!
//! Failing to recognise a name is a **warning**, never an error. The catalogue is scraped from the
//! game being played and may be stale, absent, or simply missing an entry; none of that is grounds
//! for telling a player their order is wrong.
//!
//! There is deliberately no equivalent for skills. The scraped ruleset has an item catalogue and no
//! skill catalogue, so a skill argument is checked for shape and nothing else.

use crate::movement::rules::Ruleset;

/// Whether the catalogue knows the item this text names.
///
/// The plural rule is crude on purpose: try the text as written first, then with a trailing `s` or
/// `es` removed. Trying the unstripped form first is what keeps the catalogue's own plural entries -
/// `pearls`, `spices`, `figurines` - recognisable, because stripping them would find nothing.
#[must_use]
pub fn is_known_item(text: &str, ruleset: &Ruleset) -> bool {
    if text.is_empty() {
        return false;
    }

    let written = text.replace('_', " ");
    let candidates = [
        Some(written.as_str()),
        written.strip_suffix("es"),
        written.strip_suffix('s'),
    ];

    let recognised = candidates.into_iter().flatten().any(|candidate| {
        ruleset.items.values().any(|item| {
            item.tag.eq_ignore_ascii_case(candidate) || item.name.eq_ignore_ascii_case(candidate)
        })
    });

    recognised
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULESET: &str = include_str!("../../../../config/public/ruleset.json");

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
    }

    #[test]
    fn a_tag_is_recognised_whatever_its_case() {
        let ruleset = ruleset();
        assert!(is_known_item("SWOR", &ruleset));
        // Real orders carry lower-cased tags: the turn 71 template has "@give 0 all spea".
        assert!(is_known_item("spea", &ruleset));
    }

    #[test]
    fn a_singular_name_is_recognised() {
        assert!(is_known_item("sword", &ruleset()));
    }

    #[test]
    fn the_plural_the_rules_own_examples_use_is_recognised() {
        let ruleset = ruleset();
        // "GIVE 4573 10 swords" and "SELL 10 furs" are both examples on the rules page.
        assert!(is_known_item("swords", &ruleset));
        assert!(is_known_item("furs", &ruleset));
        assert!(is_known_item("crossbows", &ruleset));
    }

    #[test]
    fn a_name_that_is_already_plural_survives_the_plural_rule() {
        // Stripping first would look for "pearl", which the catalogue does not have.
        let ruleset = ruleset();
        assert!(is_known_item("pearls", &ruleset));
        assert!(is_known_item("spices", &ruleset));
    }

    #[test]
    fn a_name_with_spaces_is_recognised_quoted_or_underscored() {
        let ruleset = ruleset();
        // The lexer has already removed the quotes by the time this is asked.
        assert!(is_known_item("Plate Armor", &ruleset));
        assert!(is_known_item("Plate_Armor", &ruleset));
    }

    #[test]
    fn a_name_the_catalogue_does_not_have_is_not_recognised() {
        let ruleset = ruleset();
        assert!(!is_known_item("swordz", &ruleset));
        assert!(!is_known_item("", &ruleset));
    }
}
