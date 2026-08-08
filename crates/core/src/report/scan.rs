//! Small scanners shared by the region and unit parsers.
//!
//! Deliberately hand written rather than regex based: the crate has no regex dependency, and these
//! shapes are simple enough that the parsing reads more clearly than a pattern would.

use super::model::{Coordinate, ItemAmount, MarketItem, Settlement, Skill};

/// Splits on a separator, ignoring separators nested inside brackets or parentheses.
///
/// A flat `split(',')` would tear `Skills: observation [OBSE] 1 (35), force [FORC] 1 (35)` apart at
/// the wrong places.
#[must_use]
pub fn split_top_level(input: &str, separator: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;

    for character in input.chars() {
        match character {
            '(' | '[' => {
                depth += 1;
                current.push(character);
            }
            ')' | ']' => {
                depth -= 1;
                current.push(character);
            }
            _ if character == separator && depth <= 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(character),
        }
    }

    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }

    parts
}

/// Reads a trailing parenthesised number, as in `Borg TNG (95)`, returning the name and the number.
#[must_use]
pub fn split_trailing_id(input: &str) -> Option<(String, String)> {
    let trimmed = input.trim().trim_end_matches('.');
    let open = trimmed.rfind('(')?;
    if !trimmed.ends_with(')') {
        return None;
    }

    let id = &trimmed[open + 1..trimmed.len() - 1];
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    Some((trimmed[..open].trim().to_string(), id.to_string()))
}

/// Reads a coordinate, accepting both `(7,53)` and the underworld form `(7,53,2)`.
///
/// A missing level means the surface, which the game numbers 1.
#[must_use]
pub fn parse_coordinate(input: &str) -> Option<Coordinate> {
    let inner = input.trim().trim_start_matches('(').trim_end_matches(')');
    let mut parts = inner.split(',').map(str::trim);

    let x = parts.next()?.parse::<i32>().ok()?;
    let y = parts.next()?.parse::<i32>().ok()?;
    let z = match parts.next() {
        None => 1,
        Some(level) => level.parse::<u32>().ok().unwrap_or(1),
    };

    Some(Coordinate { x, y, z })
}

/// Reads `contains Inholm [city]`.
#[must_use]
pub fn parse_settlement(input: &str) -> Option<Settlement> {
    let rest = input.trim().strip_prefix("contains ")?;
    let open = rest.rfind('[')?;
    let close = rest.rfind(']')?;
    if close < open {
        return None;
    }

    Some(Settlement {
        name: rest[..open].trim().to_string(),
        size: rest[open + 1..close].to_string(),
    })
}

/// Splits `230 crossbows [XBOW]` into its amount, name and tag.
///
/// A bare `leader [LEAD]` means one.
#[must_use]
pub fn parse_item_amount(input: &str) -> Option<ItemAmount> {
    let text = input.trim().trim_end_matches('.');
    let open = text.rfind('[')?;
    let close = text.rfind(']')?;
    if close < open {
        return None;
    }

    let tag = text[open + 1..close].to_string();
    let head = text[..open].trim();
    let (amount, name) = match head.split_once(' ') {
        Some((first, rest)) if first.chars().all(|c| c.is_ascii_digit()) && !first.is_empty() => {
            (first.parse::<i64>().unwrap_or(1), rest.trim().to_string())
        }
        _ => (1, head.to_string()),
    };

    if name.is_empty() {
        return None;
    }

    Some(ItemAmount { amount, name, tag })
}

/// Splits `138 grain [GRAI] at $24` into an item and its price.
#[must_use]
pub fn parse_market_item(input: &str) -> Option<MarketItem> {
    let (item_text, price_text) = input.trim().rsplit_once(" at $")?;
    let item = parse_item_amount(item_text)?;
    let price = price_text
        .trim()
        .trim_end_matches('.')
        .parse::<i64>()
        .ok()?;

    Some(MarketItem {
        amount: item.amount,
        name: item.name,
        tag: item.tag,
        price,
    })
}

/// Splits `stealth [STEA] 5 (450)` into its name, tag, level and study points.
#[must_use]
pub fn parse_skill(input: &str) -> Option<Skill> {
    let text = input.trim().trim_end_matches('.');
    let open = text.find('[')?;
    let close = text.find(']')?;
    if close < open {
        return None;
    }

    let name = text[..open].trim().to_string();
    let tag = text[open + 1..close].to_string();
    let rest = text[close + 1..].trim();

    let (level_text, points_text) = rest.split_once('(')?;
    let level = level_text.trim().parse::<u32>().ok()?;
    let points = points_text
        .trim_end_matches(')')
        .trim()
        .parse::<u32>()
        .ok()?;

    Some(Skill {
        name,
        tag,
        level,
        points,
    })
}

/// Reads a money figure such as `$14826` or `$24.1`, keeping only the whole part.
#[must_use]
pub fn parse_money(input: &str) -> Option<i64> {
    let text = input.trim().trim_end_matches('.').trim_start_matches('$');
    let whole = text.split_once('.').map_or(text, |(head, _)| head);
    whole.replace(',', "").parse::<i64>().ok()
}

/// A list field reading `none` carries no entries; the game writes that rather than omitting it.
#[must_use]
pub fn is_none_list(input: &str) -> bool {
    matches!(input.trim().trim_end_matches('.'), "none" | "None")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_only_at_the_top_level() {
        let parts = split_top_level(
            "observation [OBSE] 1 (35), force [FORC] 1 (35), combat [COMB] 3 (180)",
            ',',
        );
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[2], "combat [COMB] 3 (180)");
    }

    #[test]
    fn keeps_a_parenthesised_race_with_its_field() {
        let parts = split_top_level("12051 peasants (hill dwarves), $33983", ',');
        assert_eq!(parts, vec!["12051 peasants (hill dwarves)", "$33983"]);
    }

    #[test]
    fn reads_a_trailing_identifier() {
        assert_eq!(
            split_trailing_id("Seven of Eight (18642)"),
            Some(("Seven of Eight".to_string(), "18642".to_string()))
        );
        // A name that merely ends in a parenthetical is not an identifier.
        assert_eq!(split_trailing_id("Ranger (scout)"), None);
    }

    #[test]
    fn defaults_a_missing_level_to_the_surface() {
        assert_eq!(
            parse_coordinate("(7,53)"),
            Some(Coordinate { x: 7, y: 53, z: 1 })
        );
        assert_eq!(
            parse_coordinate("(7,53,2)"),
            Some(Coordinate { x: 7, y: 53, z: 2 })
        );
    }

    #[test]
    fn reads_a_settlement_and_its_size() {
        assert_eq!(
            parse_settlement("contains Inholm [city]"),
            Some(Settlement {
                name: "Inholm".to_string(),
                size: "city".to_string()
            })
        );
    }

    #[test]
    fn treats_an_unquantified_item_as_one() {
        let single = parse_item_amount("leader [LEAD]").expect("item");
        assert_eq!((single.amount, single.tag.as_str()), (1, "LEAD"));

        let many = parse_item_amount("230 crossbows [XBOW]").expect("item");
        assert_eq!((many.amount, many.name.as_str()), (230, "crossbows"));
    }

    #[test]
    fn reads_a_market_entry_with_its_price() {
        let item = parse_market_item("138 grain [GRAI] at $24").expect("market item");
        assert_eq!(
            (item.amount, item.tag.as_str(), item.price),
            (138, "GRAI", 24)
        );
    }

    #[test]
    fn reads_a_skill_with_level_and_points() {
        assert_eq!(
            parse_skill("stealth [STEA] 5 (450)"),
            Some(Skill {
                name: "stealth".to_string(),
                tag: "STEA".to_string(),
                level: 5,
                points: 450
            })
        );
    }

    #[test]
    fn reads_money_including_the_fractional_wage_form() {
        assert_eq!(parse_money("$14826"), Some(14826));
        assert_eq!(parse_money("$24.1"), Some(24));
        assert_eq!(parse_money("$0."), Some(0));
    }

    #[test]
    fn recognises_an_empty_list() {
        assert!(is_none_list("none."));
        assert!(!is_none_list("69 fish [FISH]."));
    }
}
