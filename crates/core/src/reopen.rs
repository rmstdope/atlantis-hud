//! Which turn a game reopens on.
//!
//! A game remembers which faction is the player's (`GameMetadata::active_faction_id`) and reopens
//! on that faction's highest-numbered imported turn. When it remembers none - a game whose manifest
//! predates the field - it falls back to the highest-numbered turn in the game, whichever faction
//! holds it, and the shell adopts that faction. Nothing here reads a timestamp: ranking by what was
//! touched last is what let an older report imported later take the game back in time.

use serde::{Deserialize, Serialize};

/// One turn a game holds, and the turn it reopens on: the same three-word shape either way.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TurnRef {
    pub faction_id: String,
    pub turn_number: u32,
}

/// The turn a game reopens on, or `None` when it holds no imported turns.
///
/// The remembered faction's highest-numbered turn. When that faction holds none - a game whose
/// manifest predates `activeFactionId`, or one whose only turn of that faction was removed - the
/// highest-numbered turn in the game, whichever faction holds it; a game that holds a turn always
/// reopens on a turn. Ties on the turn number in that fallback go to the lower `faction_id` as
/// text, which only ever decides between two factions that both hold the game's highest turn and
/// neither of which is remembered.
///
/// Nothing here reads a timestamp. Which faction is the player's is remembered
/// (`GameMetadata::active_faction_id`) rather than inferred from what was touched last, which is
/// what let an older report imported later take the game back in time.
#[must_use]
pub fn latest_turn(turns: &[TurnRef], active_faction_id: Option<&str>) -> Option<TurnRef> {
    let remembered: Vec<&TurnRef> = active_faction_id
        .map(|faction_id| {
            turns
                .iter()
                .filter(|turn| turn.faction_id == faction_id)
                .collect()
        })
        .unwrap_or_default();

    let pool: Vec<&TurnRef> = if remembered.is_empty() {
        turns.iter().collect()
    } else {
        remembered
    };

    pool.into_iter()
        .max_by(|a, b| {
            a.turn_number
                .cmp(&b.turn_number)
                .then(b.faction_id.cmp(&a.faction_id))
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(faction_id: &str, turn_number: u32) -> TurnRef {
        TurnRef {
            faction_id: faction_id.to_string(),
            turn_number,
        }
    }

    #[test]
    fn a_game_with_no_turns_reopens_on_nothing() {
        assert_eq!(latest_turn(&[], Some("17")), None);
        assert_eq!(latest_turn(&[], None), None);
    }

    #[test]
    fn the_remembered_factions_highest_turn_reopens() {
        let turns = vec![turn("95", 70), turn("95", 71), turn("73", 71)];
        assert_eq!(latest_turn(&turns, Some("95")), Some(turn("95", 71)));
    }

    #[test]
    fn a_higher_turn_of_another_faction_does_not_win() {
        let turns = vec![turn("95", 70), turn("73", 71)];
        assert_eq!(latest_turn(&turns, Some("95")), Some(turn("95", 70)));
    }

    #[test]
    fn an_older_turn_imported_later_does_not_win() {
        let turns = vec![turn("17", 25), turn("17", 23)];
        assert_eq!(latest_turn(&turns, Some("17")), Some(turn("17", 25)));
    }

    #[test]
    fn with_no_remembered_faction_the_highest_turn_in_the_game_reopens() {
        let turns = vec![turn("95", 70), turn("73", 71)];
        assert_eq!(latest_turn(&turns, None), Some(turn("73", 71)));
    }

    #[test]
    fn a_remembered_faction_holding_no_turns_falls_back_to_the_game() {
        let turns = vec![turn("95", 70), turn("73", 71)];
        assert_eq!(latest_turn(&turns, Some("42")), Some(turn("73", 71)));
    }

    #[test]
    fn a_tie_on_turn_number_in_the_fallback_goes_to_the_lower_faction_id() {
        let turns = vec![turn("95", 71), turn("73", 71)];
        assert_eq!(latest_turn(&turns, None), Some(turn("73", 71)));
    }

    #[test]
    fn a_turn_ref_deserialises_from_camel_case_json() {
        let parsed: TurnRef =
            serde_json::from_str(r#"{"factionId":"1","turnNumber":2}"#).expect("valid json");
        assert_eq!(parsed, turn("1", 2));
    }
}
