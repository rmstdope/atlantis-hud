//! Shared domain core for Atlantis HUD.

/// Workspace bootstrapping marker used by issue #2.
pub const CORE_BOOTSTRAP_MARKER: &str = "atlantis-hud-core-bootstrap";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_bootstrap_marker_is_set() {
        assert_eq!(CORE_BOOTSTRAP_MARKER, "atlantis-hud-core-bootstrap");
    }
}
