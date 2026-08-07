//! WASM adapter surface for Atlantis HUD core APIs.

use atlantis_hud_core::game_info;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameInfoDto {
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

/// Returns game metadata serialized as a JS object.
#[wasm_bindgen]
pub fn get_game_info() -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&GameInfoDto::from(game_info()))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_maps_core_fields() {
        let dto = GameInfoDto::from(game_info());
        assert_eq!(dto.id, "atlantis");
        assert_eq!(dto.name, "Atlantis PBEM");
        assert_eq!(dto.ruleset_version, "4.0");
        assert_eq!(dto.max_faction_count, 128);
    }
}
