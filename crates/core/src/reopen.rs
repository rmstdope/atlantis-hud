//! Which turn a game reopens on.
//!
//! A game holds turns for one or more factions and a draft per turn; the one that reopens is the
//! one most recently *touched* - re-imported or edited - because editing orders is the strongest
//! signal of attention there is (the desktop's rule since migration 6). SQLite got there with a
//! LEFT JOIN and IndexedDB with a reduce, equal by comment; both stores now hand over what they
//! hold and this decides.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One turn as a store lists it for ranking, or one draft: whose, which turn, and when it was
/// last written. `updated_at` is ISO-8601 from the caller's clock on both platforms; a browser
/// record written before turns carried a stamp has none, and ranks last rather than being dropped
/// (one unrankable turn must not become a game that reopens on nothing).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TurnTouch {
    pub faction_id: String,
    pub turn_number: u32,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// The turn that reopens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TurnRef {
    pub faction_id: String,
    pub turn_number: u32,
}

/// The turn a game reopens on, or `None` when it holds no imported turns.
///
/// Rank: the later of the turn's own `updated_at` and its draft's `updated_at` (an absent stamp is
/// `""`, so it loses to any real one), compared as strings - both are ISO-8601 in one format, which
/// is what makes that valid. Ties: higher `turn_number`, then lower `faction_id` (as text), so the
/// answer is total. A draft for a turn that was never imported counts for nothing.
#[must_use]
pub fn latest_turn<'a>(turns: &'a [TurnTouch], drafts: &'a [TurnTouch]) -> Option<TurnRef> {
    let edited: HashMap<(&'a str, u32), &'a str> = drafts
        .iter()
        .map(|draft| {
            (
                (draft.faction_id.as_str(), draft.turn_number),
                draft.updated_at.as_deref().unwrap_or(""),
            )
        })
        .collect();

    // Borrows straight out of `turns`/`drafts` rather than allocating: both parameters share the
    // lifetime `'a`, so the winner's `&str` can live as long as `edited` itself.
    let touched = |turn: &'a TurnTouch| -> &'a str {
        let own = turn.updated_at.as_deref().unwrap_or("");
        let draft = edited
            .get(&(turn.faction_id.as_str(), turn.turn_number))
            .copied()
            .unwrap_or("");
        own.max(draft)
    };

    turns
        .iter()
        .max_by(|a, b| {
            touched(a)
                .cmp(touched(b))
                .then(a.turn_number.cmp(&b.turn_number))
                .then(b.faction_id.cmp(&a.faction_id))
        })
        .map(|turn| TurnRef {
            faction_id: turn.faction_id.clone(),
            turn_number: turn.turn_number,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(faction_id: &str, turn_number: u32, updated_at: Option<&str>) -> TurnTouch {
        TurnTouch {
            faction_id: faction_id.to_string(),
            turn_number,
            updated_at: updated_at.map(str::to_string),
        }
    }

    #[test]
    fn a_game_with_no_turns_reopens_on_nothing() {
        let drafts = vec![touch("17", 5, Some("2026-08-01T00:00:00Z"))];
        assert_eq!(latest_turn(&[], &drafts), None);
    }

    #[test]
    fn with_no_drafts_the_turn_most_recently_re_imported_wins() {
        let turns = vec![
            touch("17", 12, Some("2026-08-01T10:00:00Z")),
            touch("17", 13, Some("2026-08-01T11:00:00Z")),
        ];
        assert_eq!(
            latest_turn(&turns, &[]),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 13
            })
        );
    }

    #[test]
    fn the_turn_most_recently_edited_wins_over_the_one_most_recently_imported() {
        let turns = vec![
            touch("17", 17, Some("2026-08-01T10:00:00Z")),
            touch("17", 18, Some("2026-08-01T11:00:00Z")),
        ];
        let drafts = vec![touch("17", 17, Some("2026-08-01T12:00:00Z"))];
        assert_eq!(
            latest_turn(&turns, &drafts),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 17
            })
        );
    }

    #[test]
    fn a_tie_on_time_goes_to_the_higher_turn_number() {
        let turns = vec![
            touch("17", 12, Some("2026-08-01T10:00:00Z")),
            touch("17", 13, Some("2026-08-01T10:00:00Z")),
        ];
        assert_eq!(
            latest_turn(&turns, &[]),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 13
            })
        );
    }

    #[test]
    fn a_tie_on_time_and_turn_goes_to_the_lower_faction_id() {
        let turns = vec![
            touch("18", 12, Some("2026-08-01T10:00:00Z")),
            touch("17", 12, Some("2026-08-01T10:00:00Z")),
        ];
        assert_eq!(
            latest_turn(&turns, &[]),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 12
            })
        );
    }

    #[test]
    fn a_turn_without_a_stamp_ranks_last_rather_than_being_dropped() {
        let turns = vec![
            touch("17", 12, None),
            touch("17", 13, Some("2026-08-01T10:00:00Z")),
        ];
        assert_eq!(
            latest_turn(&turns, &[]),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 13
            })
        );

        let only_unstamped = vec![touch("17", 12, None)];
        assert_eq!(
            latest_turn(&only_unstamped, &[]),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 12
            })
        );
    }

    #[test]
    fn a_draft_for_a_turn_never_imported_counts_for_nothing() {
        let turns = vec![touch("17", 12, Some("2026-08-01T10:00:00Z"))];
        let drafts = vec![touch("17", 99, Some("2026-08-01T23:00:00Z"))];
        assert_eq!(
            latest_turn(&turns, &drafts),
            Some(TurnRef {
                faction_id: "17".to_string(),
                turn_number: 12
            })
        );
    }

    #[test]
    fn a_touch_without_a_stamp_deserialises_from_json_missing_the_key() {
        let parsed: TurnTouch =
            serde_json::from_str(r#"{"factionId":"1","turnNumber":2}"#).expect("valid json");
        assert_eq!(parsed.updated_at, None);
    }
}
