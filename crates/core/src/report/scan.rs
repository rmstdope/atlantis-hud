//! Small scanners shared by the region and unit parsers.
//!
//! Deliberately hand written rather than regex based: the crate has no regex dependency, and these
//! shapes are simple enough that the parsing reads more clearly than a pattern would.

use std::collections::BTreeSet;

use super::level;
use super::model::{CombatSpell, Coordinate, ItemAmount, MarketItem, Settlement, Skill};

/// One character of the input, with the bracket depth on either side of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Scanned {
    /// Byte index, as `char_indices` reports it.
    index: usize,
    character: char,
    /// Depth before this character is applied: `(` or `[` here at `before <= 0` opens the top level.
    before: i32,
    /// Depth after it is applied: `)` or `]` here at `after <= 0` closes the top level.
    after: i32,
}

/// Walks `input` once, reporting every character with the bracket depth on either side.
///
/// **The one depth model in this module.** `(`, `[`, `)` and `]` are interchangeable, deliberately:
/// every scanner here must agree about the same string, and a scanner hardened alone is how the
/// same defect gets found twice. A byte index in `ignore` is an ordinary character that changes no
/// depth, which is how a stray bracket inside a player's name is stepped over rather than derailing
/// the scan.
fn scan_depths<'a>(
    input: &'a str,
    ignore: &'a BTreeSet<usize>,
) -> impl Iterator<Item = Scanned> + 'a {
    let mut depth = 0i32;

    input.char_indices().map(move |(index, character)| {
        let before = depth;
        if !ignore.contains(&index) {
            match character {
                '(' | '[' => depth += 1,
                ')' | ']' => depth -= 1,
                _ => {}
            }
        }
        Scanned {
            index,
            character,
            before,
            after: depth,
        }
    })
}

/// The byte index of every top-level `separator` in `input`, with stray brackets stepped over.
///
/// Unlike [`split_leading_id`], a splitter has no failure to detect - every input yields *some*
/// answer - so it cannot try the cheap walk and retry. `unmatched_brackets` is therefore computed
/// on every call: one extra O(n) pass whose `BTreeSet` stays empty for well-formed input, against a
/// function that already allocates a `String` per field.
fn top_level_separators(input: &str, separator: char) -> Vec<usize> {
    let stray = unmatched_brackets(input);

    scan_depths(input, &stray)
        .filter(|scanned| is_top_level_separator(scanned, separator))
        .map(|scanned| scanned.index)
        .collect()
}

/// The byte index of the first top-level `separator`, for callers that need only that one.
///
/// [`next_top_level_field`] is called in a loop over a shrinking remainder, so building the whole
/// list per call would walk the line once per field. This stops at the first hit.
fn first_top_level_separator(input: &str, separator: char) -> Option<usize> {
    let stray = unmatched_brackets(input);

    // Bound rather than returned directly: the opaque iterator would otherwise outlive `stray`.
    let index = scan_depths(input, &stray)
        .find(|scanned| is_top_level_separator(scanned, separator))
        .map(|scanned| scanned.index);
    index
}

/// A separator counts only outside every bracket, and a bracket is never a separator - matching the
/// order the hand-written scanners used before they shared this model.
fn is_top_level_separator(scanned: &Scanned, separator: char) -> bool {
    !matches!(scanned.character, '(' | '[' | ')' | ']')
        && scanned.character == separator
        && scanned.before <= 0
}

/// Splits on a separator, ignoring separators nested inside brackets or parentheses.
///
/// A flat `split(',')` would tear `Skills: observation [OBSE] 1 (35), force [FORC] 1 (35)` apart at
/// the wrong places.
#[must_use]
pub fn split_top_level(input: &str, separator: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0usize;

    for index in top_level_separators(input, separator) {
        parts.push(input[start..index].trim().to_string());
        start = index + separator.len_utf8();
    }

    // A blank final field is dropped, so `"a, b,"` is two fields and not three.
    let last = input[start..].trim();
    if !last.is_empty() {
        parts.push(last.to_string());
    }

    parts
}

/// The byte indices of brackets that never close (or never open).
///
/// A name may contain a stray bracket - `Smiley :(` is a real one - and a depth counter cannot tell
/// that from a nesting that has not finished yet. Matching the brackets first says exactly which
/// ones are noise, so the scan can step over them instead of being derailed by them.
///
/// `(` and `[` are interchangeable here, matching [`split_top_level`] and the scan below, so that
/// every scanner in this module agrees about the same string.
///
/// Empty for well-formed input, which is what makes the fallback in [`split_leading_id`] free on
/// every real report.
#[must_use]
fn unmatched_brackets(input: &str) -> BTreeSet<usize> {
    let mut open_positions: Vec<usize> = Vec::new();
    let mut stray = BTreeSet::new();

    for (index, character) in input.char_indices() {
        match character {
            '(' | '[' => open_positions.push(index),
            // A closer with nothing open is itself the stray one; `pop` both matches and reports.
            ')' | ']' if open_positions.pop().is_none() => {
                stray.insert(index);
            }
            _ => {}
        }
    }

    stray.extend(open_positions);
    stray
}

/// Reads a leading `Name (id)` from `input`, where the name may itself contain top-level commas.
///
/// Scans for the first parenthesised group at bracket depth zero whose contents are all ASCII
/// digits; everything before it is the name. `Ranger (scout) Bob (100)` therefore yields
/// `("Ranger (scout) Bob", "100")`, and `Smith, Jones (100), Wanderers (29)` yields
/// `("Smith, Jones", "100")` with the remainder trimmed down to `"Wanderers (29)"`.
///
/// The third element is what follows the closing `)`, with leading whitespace and one leading
/// separator comma removed, so a caller can keep walking or compute a byte offset with
/// `input.len() - rest.len()`. `input` is scanned exactly as given - never trimmed here - so that
/// offset arithmetic stays correct.
///
/// `None` when no top-level `(digits)` group exists, which is what every caller already treats as
/// an unreadable line.
#[must_use]
pub fn split_leading_id(input: &str) -> Option<(String, String, &str)> {
    if let Some(found) = scan_leading_id(input, &BTreeSet::new()) {
        return Some(found);
    }

    let stray = unmatched_brackets(input);
    if stray.is_empty() {
        return None;
    }

    scan_leading_id(input, &stray)
}

/// [`split_leading_id`]'s scan, with a set of byte indices to treat as ordinary characters.
///
/// A bracket at an ignored index changes no depth and opens no candidate, which is what lets a
/// stray one inside a name be stepped over rather than derail the scan.
fn scan_leading_id<'a>(
    input: &'a str,
    ignore: &BTreeSet<usize>,
) -> Option<(String, String, &'a str)> {
    let mut candidate_open: Option<usize> = None;

    for scanned in scan_depths(input, ignore) {
        if ignore.contains(&scanned.index) {
            continue;
        }

        match scanned.character {
            '(' if scanned.before <= 0 => candidate_open = Some(scanned.index),
            ')' | ']' if scanned.after <= 0 => {
                if let Some(open) = candidate_open.take() {
                    if scanned.character == ')' {
                        let id = &input[open + 1..scanned.index];
                        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
                            let name = input[..open].trim().to_string();
                            let after = &input[scanned.index + 1..];
                            let rest = after
                                .trim_start()
                                .strip_prefix(',')
                                .unwrap_or_else(|| after.trim_start())
                                .trim_start();
                            return Some((name, id.to_string(), rest));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    None
}

/// The next top-level field of `input` (trimmed) and what follows it, past one separator.
///
/// The slice-returning counterpart of [`split_top_level`], for callers that consume fields one at a
/// time and need the untouched remainder rather than a rebuilt list.
///
/// `None` when `input` is empty or all whitespace.
#[must_use]
pub fn next_top_level_field(input: &str, separator: char) -> Option<(&str, &str)> {
    if let Some(index) = first_top_level_separator(input, separator) {
        let field = input[..index].trim();
        let rest = input[index + separator.len_utf8()..].trim_start();
        return Some((field, rest));
    }

    let field = input.trim();
    if field.is_empty() {
        None
    } else {
        Some((field, ""))
    }
}

/// Reads a trailing parenthesised number, as in `Borg TNG (95)`, returning the name and the number.
///
/// Deliberately not a reading of [`scan_depths`] (ah-hlqc): this scanner is right-anchored - it
/// takes the last `(` of a string that ends in `)` - which makes it correct on a name carrying a
/// stray bracket without needing a depth model at all. `Smiley :( (95)` reads as `("Smiley :(",
/// "95")` today, and rewriting it onto a left-to-right walk would trade a working strategy for one
/// that then needs the stray pre-pass to get back to where it started.
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

/// Reads a coordinate: `(7,53)` on the surface, `(0,0,nexus)`, `(7,53,underworld)` - the third
/// field is the level's name, and a bare number is also read (it is what this client wrote until
/// ah-4b4). A name the engine never prints falls back to the surface, as before.
#[must_use]
pub fn parse_coordinate(input: &str) -> Option<Coordinate> {
    let inner = input.trim().trim_start_matches('(').trim_end_matches(')');
    let mut parts = inner.split(',').map(str::trim);

    let x = parts.next()?.parse::<i32>().ok()?;
    let y = parts.next()?.parse::<i32>().ok()?;
    let z = match parts.next() {
        None => level::SURFACE,
        Some(field) => level::parse_level(field).unwrap_or(level::SURFACE),
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

/// Splits `fire [FIRE]` into a combat spell's name and tag.
///
/// `rfind` rather than `find`, as `parse_item_amount` does: a spell's printed name is plain words,
/// but reading from the right costs nothing and matches its neighbours.
#[must_use]
pub fn parse_combat_spell(input: &str) -> Option<CombatSpell> {
    let text = input.trim().trim_end_matches('.');
    let open = text.rfind('[')?;
    let close = text.rfind(']')?;
    if close < open {
        return None;
    }

    let name = text[..open].trim().to_string();
    if name.is_empty() {
        return None;
    }

    Some(CombatSpell {
        name,
        tag: text[open + 1..close].to_string(),
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
    fn a_depth_walk_reports_the_depth_on_either_side_of_each_bracket() {
        let input = "a (b) c";
        let open = input.find('(').unwrap();
        let close = input.find(')').unwrap();

        let walked: Vec<Scanned> = scan_depths(input, &BTreeSet::new()).collect();
        let opening = walked.iter().find(|s| s.index == open).unwrap();
        assert_eq!((opening.before, opening.after), (0, 1));
        let closing = walked.iter().find(|s| s.index == close).unwrap();
        assert_eq!((closing.before, closing.after), (1, 0));

        let ignore: BTreeSet<usize> = [open].into_iter().collect();
        let ignored: Vec<Scanned> = scan_depths(input, &ignore).collect();
        let opening = ignored.iter().find(|s| s.index == open).unwrap();
        assert_eq!((opening.before, opening.after), (0, 0));
    }

    #[test]
    fn walks_past_a_field_whose_name_carries_an_unclosed_bracket() {
        assert_eq!(
            next_top_level_field("Smiley :( (100), Wanderers (29)", ','),
            Some(("Smiley :( (100)", "Wanderers (29)"))
        );
    }

    #[test]
    fn splits_past_an_unclosed_bracket() {
        assert_eq!(
            split_top_level("Smiley :( (100), Wanderers (29)", ','),
            vec!["Smiley :( (100)".to_string(), "Wanderers (29)".to_string()]
        );
    }

    #[test]
    fn a_trailing_identifier_survives_an_unclosed_bracket_in_the_name() {
        assert_eq!(
            split_trailing_id("Smiley :( (95)"),
            Some(("Smiley :(".to_string(), "95".to_string()))
        );
    }

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
    fn reads_a_leading_identifier_past_commas_in_the_name() {
        assert_eq!(
            split_leading_id("Smith, Jones (100), Wanderers (29)"),
            Some((
                "Smith, Jones".to_string(),
                "100".to_string(),
                "Wanderers (29)"
            ))
        );
        assert_eq!(
            split_leading_id("Ranger (scout) Bob (100), x"),
            Some(("Ranger (scout) Bob".to_string(), "100".to_string(), "x"))
        );
        assert_eq!(split_leading_id("Ranger (scout)"), None);
    }

    #[test]
    fn walks_top_level_fields_one_at_a_time() {
        assert_eq!(
            next_top_level_field("a, b (1), c", ','),
            Some(("a", "b (1), c"))
        );
        assert_eq!(next_top_level_field("  ", ','), None);
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
    fn reads_the_level_by_name() {
        assert_eq!(
            parse_coordinate("(0,0,nexus)"),
            Some(Coordinate { x: 0, y: 0, z: 0 })
        );
        assert_eq!(
            parse_coordinate("(7,53,underworld)"),
            Some(Coordinate { x: 7, y: 53, z: 2 })
        );
        assert_eq!(
            parse_coordinate("(7,53,2)"),
            Some(Coordinate { x: 7, y: 53, z: 2 })
        );
        assert_eq!(
            parse_coordinate("(7,53)"),
            Some(Coordinate { x: 7, y: 53, z: 1 })
        );
    }

    #[test]
    fn reads_a_combat_spell_name_and_tag() {
        assert_eq!(
            parse_combat_spell("fire [FIRE]"),
            Some(CombatSpell {
                name: "fire".to_string(),
                tag: "FIRE".to_string()
            })
        );
        assert_eq!(
            parse_combat_spell("summon tornado [STOR]"),
            Some(CombatSpell {
                name: "summon tornado".to_string(),
                tag: "STOR".to_string()
            })
        );
        assert_eq!(parse_combat_spell("fire"), None);
        assert_eq!(parse_combat_spell("fire ]FIRE["), None);
        assert_eq!(parse_combat_spell("[FIRE]"), None);
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

    #[test]
    fn finds_the_brackets_that_never_close() {
        let one = "Smiley :( (100)";
        assert_eq!(
            unmatched_brackets(one),
            [one.find('(').unwrap()].into_iter().collect()
        );

        let two = "Bob [x (100)";
        assert_eq!(
            unmatched_brackets(two),
            [two.find('[').unwrap()].into_iter().collect()
        );

        assert_eq!(
            unmatched_brackets("Three of Five (793)"),
            std::collections::BTreeSet::new()
        );

        let four = "Smiley :) (100)";
        assert_eq!(
            unmatched_brackets(four),
            [four.find(')').unwrap()].into_iter().collect()
        );
    }

    #[test]
    fn reads_a_name_containing_an_unclosed_bracket() {
        assert_eq!(
            split_leading_id("Smiley :( (100), Wanderers (29), 10 humans [HUMN]"),
            Some((
                "Smiley :(".to_string(),
                "100".to_string(),
                "Wanderers (29), 10 humans [HUMN]"
            ))
        );

        assert_eq!(
            split_leading_id("Bob [x (100), Wanderers (29)"),
            Some(("Bob [x".to_string(), "100".to_string(), "Wanderers (29)"))
        );
    }

    #[test]
    fn an_unclosed_bracket_does_not_change_a_line_that_already_read() {
        assert_eq!(
            split_leading_id("Smiley :) (100), Wanderers (29), 10 humans [HUMN]"),
            Some((
                "Smiley :)".to_string(),
                "100".to_string(),
                "Wanderers (29), 10 humans [HUMN]"
            ))
        );

        assert_eq!(
            split_leading_id("Three of Five (793), Borg (73), behind"),
            Some((
                "Three of Five".to_string(),
                "793".to_string(),
                "Borg (73), behind"
            ))
        );
    }
}
