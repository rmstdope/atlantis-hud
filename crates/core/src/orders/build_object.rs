//! Whether the object type a `BUILD` order names is one this world lets a player build.
//!
//! `rules/build` gives the forms `BUILD [object type]` and `BUILD [object type] COMPLETE`, and the
//! New Age worlds add `WOOD`/`STONE`; in every one the first argument is the object type. A name
//! the catalogue does not have, or a structure whose data says "This structure cannot be built by
//! players" (data/Ruin), wastes the unit's month, so both are errors (ah-jyqk).

use super::lexer::Token;
use crate::movement::rules::{BuildObject, Ruleset};

pub(super) const UNKNOWN_OBJECT: &str = "unknown-object";
pub(super) const UNBUILDABLE_OBJECT: &str = "unbuildable-object";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum BuildObjectProblem {
    /// `typed` is the token's text as written: quotes already stripped by the lexer, underscores kept.
    Unknown {
        typed: String,
        suggestion: Option<String>,
    },
    /// `name` in the game's spelling.
    Unbuildable { name: String },
}

impl BuildObjectProblem {
    pub(super) fn code(&self) -> &'static str {
        match self {
            Self::Unknown { .. } => UNKNOWN_OBJECT,
            Self::Unbuildable { .. } => UNBUILDABLE_OBJECT,
        }
    }

    pub(super) fn message(&self) -> String {
        match self {
            Self::Unknown {
                typed,
                suggestion: Some(suggestion),
            } => format!(
                "BUILD: there is no building or ship called {typed} — did you mean {suggestion}?"
            ),
            Self::Unknown {
                typed,
                suggestion: None,
            } => format!("BUILD: there is no building or ship called {typed}"),
            Self::Unbuildable { name } => format!(
                "BUILD: {} {name} cannot be built by players",
                super::semantics::article_for(name)
            ),
        }
    }
}

/// `consumed` is the BUILD line's arguments already trimmed to what the grammar consumed. `None`
/// when nothing is wrong or nothing can be said: the ruleset knows no buildings, nothing was
/// consumed, or the first token is `HELP` or `COMPLETE` (`BUILD COMPLETE`, `BUILD HELP n`,
/// `BUILD HELP n COMPLETE`). Otherwise the first token is the object type.
pub(super) fn build_object_problem<'t>(
    consumed: &'t [Token],
    ruleset: &Ruleset,
) -> Option<(&'t Token, BuildObjectProblem)> {
    if !ruleset.knows_buildings() {
        return None;
    }
    let token = consumed.first()?;
    if token.is("HELP") || token.is("COMPLETE") {
        return None;
    }
    let problem = match ruleset.build_object(&token.text) {
        Some(BuildObject::Building {
            player_buildable: false,
            name,
        }) => BuildObjectProblem::Unbuildable { name },
        Some(_) => return None,
        None => BuildObjectProblem::Unknown {
            typed: token.text.clone(),
            suggestion: closest(&token.text, &ruleset.buildable_object_names()),
        },
    };
    Some((token, problem))
}

fn normalise(text: &str) -> String {
    text.replace('_', " ").to_uppercase()
}

/// The one candidate clearly closest to `typed`, as the candidate is spelled: at most a third of
/// the typed length away (rounded down) and strictly nearer than every other candidate.
pub(super) fn closest(typed: &str, candidates: &[String]) -> Option<String> {
    let typed = normalise(typed);
    let limit = typed.chars().count() / 3;
    let mut best: Option<(usize, &String)> = None;
    let mut tied = false;
    for candidate in candidates {
        let distance = edit_distance(&typed, &normalise(candidate));
        match best {
            Some((nearest, _)) if distance > nearest => {}
            Some((nearest, _)) if distance == nearest => tied = true,
            _ => {
                best = Some((distance, candidate));
                tied = false;
            }
        }
    }
    match best {
        Some((distance, candidate)) if !tied && distance <= limit => Some(candidate.clone()),
        _ => None,
    }
}

/// Levenshtein distance over `char`s: insert, delete, substitute, each costing 1.
fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, left) in a.chars().enumerate() {
        let mut current = vec![i + 1];
        for (j, right) in b.iter().enumerate() {
            let substitute = previous[j] + usize::from(left != *right);
            current.push(substitute.min(previous[j + 1] + 1).min(current[j] + 1));
        }
        previous = current;
    }
    previous[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_distance_counts_single_character_edits() {
        assert_eq!(edit_distance("GALEON", "GALLEON"), 1);
        assert_eq!(edit_distance("RIN", "INN"), 2);
        assert_eq!(edit_distance("", "ABC"), 3);
    }

    #[test]
    fn a_clear_closest_candidate_is_suggested_in_its_own_spelling() {
        assert_eq!(
            closest("Castel", &["Castle".into(), "Citadel".into()]),
            Some("Castle".to_string())
        );
    }

    #[test]
    fn a_tie_suggests_nothing() {
        assert_eq!(closest("Road", &["Road N".into(), "Road S".into()]), None);
    }

    #[test]
    fn a_candidate_too_far_for_the_length_suggests_nothing() {
        assert_eq!(closest("Rin", &["Inn".into()]), None);
    }
}
