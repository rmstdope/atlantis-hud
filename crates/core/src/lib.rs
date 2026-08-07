//! Shared domain core for Atlantis HUD.

/// Canonical cross-platform game metadata contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameInfo {
    /// Stable identifier used by platform adapters and clients.
    pub id: String,
    /// Display name for the game.
    pub name: String,
    /// Semantic version for the currently supported ruleset.
    pub ruleset_version: String,
    /// Maximum number of factions supported by the game.
    pub max_faction_count: u16,
}

/// Returns default game metadata shared across all platform adapters.
#[must_use]
pub fn game_info() -> GameInfo {
    GameInfo {
        id: "atlantis".to_string(),
        name: "Atlantis PBEM".to_string(),
        ruleset_version: "4.0".to_string(),
        max_faction_count: 128,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_info_uses_stable_identifier() {
        assert_eq!(game_info().id, "atlantis");
    }

    #[test]
    fn game_info_exposes_expected_metadata() {
        assert_eq!(
            game_info(),
            GameInfo {
                id: "atlantis".to_string(),
                name: "Atlantis PBEM".to_string(),
                ruleset_version: "4.0".to_string(),
                max_faction_count: 128,
            }
        );
    }
}
