//! Tauri command adapter for Atlantis HUD core APIs.

use atlantis_hud_core::game_info;
use serde::{Deserialize, Serialize};

/// JSON contract returned by Tauri for game metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfoDto {
    id: String,
    name: String,
    ruleset_version: String,
    max_faction_count: u16,
}

impl From<atlantis_hud_core::GameInfo> for GameInfoDto {
    fn from(value: atlantis_hud_core::GameInfo) -> Self {
        Self {
            id: value.id,
            name: value.name,
            ruleset_version: value.ruleset_version,
            max_faction_count: value.max_faction_count,
        }
    }
}

/// Returns canonical game metadata for a Tauri command wrapper.
#[must_use]
pub fn command_get_game_info() -> GameInfoDto {
    GameInfoDto::from(game_info())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tauri_adapter_returns_core_contract_values() {
        let response = command_get_game_info();

        assert_eq!(
            response,
            GameInfoDto {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }
}
