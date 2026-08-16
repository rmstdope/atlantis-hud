//! Map levels: how a report names one in a coordinate's third field, and how the core numbers it.
//! The numbers are the engine's own (`ARegion::zloc`): nexus 0, surface 1, underworld 2, and the
//! two deeper kinds no shipped ruleset turns on at 3 and 4.

pub const NEXUS: u32 = 0;
pub const SURFACE: u32 = 1;
pub const UNDERWORLD: u32 = 2;
pub const UNDERDEEP: u32 = 3;
pub const ABYSS: u32 = 4;

/// The level a coordinate's third field names. `None` for a field the engine never prints.
///
/// Accepts every spelling the engine has: `nexus`; `underworld`, `underdeep`, `abyss`, each with
/// any number of leading `very ` and one `deep ` adding one level per word; `2 <underworld>` (the
/// EASIER_UNDERWORLD multi-level form — the leading number is authoritative and the rest is
/// ignored); and a bare number, which is what this client wrote until now.
#[must_use]
pub fn parse_level(field: &str) -> Option<u32> {
    let field = field.trim();

    if field.starts_with(|c: char| c.is_ascii_digit()) {
        let digits: String = field.chars().take_while(char::is_ascii_digit).collect();
        return digits.parse::<u32>().ok();
    }

    let mut rest = field;
    let mut extra = 0u32;
    while let Some(stripped) = rest.strip_prefix("very ") {
        rest = stripped;
        extra += 1;
    }
    if let Some(stripped) = rest.strip_prefix("deep ") {
        rest = stripped;
        extra += 1;
    }

    match rest {
        "nexus" => Some(NEXUS + extra),
        "underworld" => Some(UNDERWORLD + extra),
        "underdeep" => Some(UNDERDEEP + extra),
        "abyss" => Some(ABYSS + extra),
        _ => None,
    }
}

/// The word the level control shows: `nexus`, `surface`, `underworld`, `underdeep`, `abyss`, and
/// `level 5` for a number no shipped ruleset names.
#[must_use]
pub fn level_name(z: u32) -> String {
    match z {
        NEXUS => "nexus".to_string(),
        SURFACE => "surface".to_string(),
        UNDERWORLD => "underworld".to_string(),
        UNDERDEEP => "underdeep".to_string(),
        ABYSS => "abyss".to_string(),
        _ => format!("level {z}"),
    }
}

/// The third field the report prints for the level: `None` on the surface, otherwise the name
/// (`nexus`, `underworld`, `underdeep`, `abyss`) or the bare number for a level with no name.
/// `parse_level` reads back everything this writes.
#[must_use]
pub fn level_field(z: u32) -> Option<String> {
    match z {
        SURFACE => None,
        NEXUS | UNDERWORLD | UNDERDEEP | ABYSS => Some(level_name(z)),
        other => Some(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_spelling_the_engine_prints() {
        assert_eq!(parse_level("nexus"), Some(0));
        assert_eq!(parse_level("underworld"), Some(2));
        assert_eq!(parse_level("underdeep"), Some(3));
        assert_eq!(parse_level("abyss"), Some(4));
        assert_eq!(parse_level("deep underworld"), Some(3));
        assert_eq!(parse_level("very deep underworld"), Some(4));
        assert_eq!(parse_level("very very deep underworld"), Some(5));
        assert_eq!(parse_level("2"), Some(2));
        assert_eq!(parse_level("2 <underworld>"), Some(2));
        assert_eq!(parse_level("moon"), None);
        assert_eq!(parse_level(""), None);
    }

    #[test]
    fn names_and_fields_round_trip() {
        for z in 0..=6u32 {
            let round_tripped = level_field(z).map_or(1, |f| parse_level(&f).unwrap());
            assert_eq!(round_tripped, z, "level {z} did not round trip");
        }
        assert_eq!(level_name(0), "nexus");
        assert_eq!(level_name(1), "surface");
        assert_eq!(level_name(2), "underworld");
        assert_eq!(level_name(3), "underdeep");
        assert_eq!(level_name(4), "abyss");
        assert_eq!(level_name(5), "level 5");
        assert_eq!(level_field(1), None);
        assert_eq!(level_field(5), Some("5".to_string()));
    }
}
