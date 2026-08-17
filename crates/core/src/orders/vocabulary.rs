//! Every word the rules know, for a caller that has to recognise a keyword as it is typed.
//!
//! The grammar's own words are compiled in; the item and skill words are not, because two servers
//! running different games disagree about them - the same reason the item catalogue is passed in
//! rather than baked into `grammar.rs`.

use std::collections::BTreeSet;

use super::grammar::{self, Arg, GRAMMAR};
use crate::movement::rules::Ruleset;

/// Every word the rules know, uppercase, deduplicated and sorted.
///
/// The order names and the grammar's own fixed words are always there. The item and skill words -
/// each entry's tag, and every whitespace-separated word of its name - arrive only with a ruleset,
/// since two servers running different games disagree about them.
///
/// **Singular words only.** Nothing here manufactures plurals: `item_spellings` strips suffixes
/// from a written word rather than generating them, so a caller matching a typed `LONGBOWS` tries
/// those three spellings against this set instead of expecting the plural to be in it.
///
/// A one-character word coming from the ruleset is dropped - a stray `a` in an item name would
/// otherwise turn every lone `a` in an order into `A`. One-character words from the grammar stay:
/// `N` and `S` are directions and are the point.
#[must_use]
pub fn order_vocabulary(ruleset: Option<&Ruleset>) -> Vec<String> {
    let mut words: BTreeSet<String> = BTreeSet::new();

    for order in GRAMMAR {
        words.insert(order.name.to_ascii_uppercase());
        for form in order.forms {
            for argument in *form {
                collect_argument(argument, &mut words);
            }
        }
    }

    if let Some(ruleset) = ruleset {
        for item in ruleset.items.values() {
            insert_ruleset_words(&item.tag, &mut words);
            insert_ruleset_words(&item.name, &mut words);
        }
        for skill in ruleset.skills.values() {
            insert_ruleset_words(&skill.tag, &mut words);
            insert_ruleset_words(&skill.name, &mut words);
        }
    }

    words.into_iter().collect()
}

/// The fixed words one argument can take, `Arg::Rest` unwrapped.
///
/// `grammar::keywords` lumps `Rest` in with the open arguments and answers nothing for it, so
/// without this recursion every repeated argument's keywords - the directions among them - vanish.
fn collect_argument(argument: &'static Arg, words: &mut BTreeSet<String>) {
    if let Arg::Rest(inner) = argument {
        collect_argument(inner, words);
        return;
    }

    for keyword in grammar::keywords(argument) {
        words.insert(keyword.to_ascii_uppercase());
    }
}

/// Every usable word of a ruleset tag or name, uppercased; one-character words dropped.
fn insert_ruleset_words(text: &str, words: &mut BTreeSet<String>) {
    for word in text.split_whitespace() {
        if word.chars().count() > 1 {
            words.insert(word.to_ascii_uppercase());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::rules::Ruleset;
    use crate::orders::grammar::order_commands;

    fn committed_ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
            .expect("the committed ruleset should be usable")
    }

    #[test]
    fn the_vocabulary_carries_every_order_name() {
        let vocabulary = order_vocabulary(None);
        for name in order_commands() {
            assert!(
                vocabulary.contains(&name.to_ascii_uppercase()),
                "{name} is missing"
            );
        }
    }

    #[test]
    fn the_vocabulary_carries_the_grammars_own_keywords() {
        let vocabulary = order_vocabulary(None);
        for word in ["ALL", "UNIT", "EXCEPT", "FROM", "HOSTILE", "NORMAL"] {
            assert!(vocabulary.contains(&word.to_string()), "{word} is missing");
        }
    }

    #[test]
    fn the_vocabulary_carries_the_directions_and_in_and_out() {
        let vocabulary = order_vocabulary(None);
        for word in ["N", "NE", "SE", "S", "SW", "NW", "IN", "OUT"] {
            assert!(vocabulary.contains(&word.to_string()), "{word} is missing");
        }
    }

    #[test]
    fn a_keyword_behind_a_repeated_argument_is_not_lost() {
        // `MoveStep` appears in `GRAMMAR` only ever wrapped in `Arg::Rest`, and `grammar::keywords`
        // answers nothing for a `Rest` - so `NW` is here only if the walk unwraps it.
        let vocabulary = order_vocabulary(None);
        assert!(vocabulary.contains(&"NW".to_string()));
    }

    #[test]
    fn without_a_ruleset_no_item_or_skill_words_appear() {
        assert!(!order_vocabulary(None).contains(&"SILV".to_string()));
    }

    #[test]
    fn with_a_ruleset_the_item_and_skill_words_appear() {
        let mut ruleset = committed_ruleset();
        let mut item = ruleset
            .items
            .values()
            .next()
            .expect("the committed ruleset has items")
            .clone();
        item.tag = "WIDG".to_string();
        item.name = "widget".to_string();
        ruleset.items.insert("WIDG".to_string(), item);

        let mut skill = ruleset
            .skills
            .values()
            .next()
            .expect("the committed ruleset has skills")
            .clone();
        skill.tag = "UTAC".to_string();
        skill.name = "unit tactics".to_string();
        ruleset.skills.insert("UTAC".to_string(), skill);

        let vocabulary = order_vocabulary(Some(&ruleset));
        for word in ["SILV", "WIDG", "WIDGET", "UTAC", "TACTICS"] {
            assert!(vocabulary.contains(&word.to_string()), "{word} is missing");
        }
    }

    #[test]
    fn a_one_letter_word_from_the_ruleset_is_dropped_but_a_direction_is_not() {
        let mut ruleset = committed_ruleset();
        let mut item = ruleset
            .items
            .values()
            .next()
            .expect("the committed ruleset has items")
            .clone();
        item.tag = "THNG".to_string();
        item.name = "a thing".to_string();
        ruleset.items.insert("THNG".to_string(), item);

        let vocabulary = order_vocabulary(Some(&ruleset));
        assert!(vocabulary.contains(&"THING".to_string()));
        assert!(!vocabulary.contains(&"A".to_string()));
        assert!(vocabulary.contains(&"N".to_string()));
    }

    #[test]
    fn the_vocabulary_is_uppercase_sorted_and_free_of_duplicates() {
        let vocabulary = order_vocabulary(Some(&committed_ruleset()));

        let mut tidied = vocabulary.clone();
        tidied.sort();
        tidied.dedup();
        assert_eq!(vocabulary, tidied);

        for word in &vocabulary {
            assert_eq!(word, &word.to_ascii_uppercase(), "{word} is not uppercase");
        }
    }
}
