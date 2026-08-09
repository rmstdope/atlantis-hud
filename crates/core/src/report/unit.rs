//! Parses the unit lines of a region block.
//!
//! A unit line is a sequence of sentences. The first names the unit and lists its faction, flags
//! and items; later ones are labelled, as in `Weight: 10.` or `Skills: stealth [STEA] 5 (450).`
//!
//! ```text
//! * Three of Five (793), Borg (73), behind, revealing faction, leader [LEAD]. Weight: 10.
//!   Capacity: 0/0/15/0. Skills: observation [OBSE] 1 (35), combat [COMB] 3 (180).
//! ```
//!
//! Foreign units are usually terser, and may conceal their faction entirely.

use super::model::{ItemAmount, ReportUnit, Skill};
use super::scan::{parse_item_amount, parse_skill, split_top_level, split_trailing_id};

/// Flags the game prints for a unit. Anything else in that position is treated as an item.
const KNOWN_FLAGS: &[&str] = &[
    "avoiding",
    "behind",
    "revealing faction",
    "holding",
    "sharing",
    "on guard",
    "guarding",
    "taxing",
    "no aid",
    "consuming unit's food",
    "consuming faction's food",
    "sailing battle spoils",
    "swimming battle spoils",
    "walking battle spoils",
    "riding battle spoils",
    "flying battle spoils",
    "weightless battle spoils",
    "no battle spoils",
    "autotax",
    "under strength",
];

/// Labelled sections a unit line may carry after its head.
///
/// This is a closed set, which is what makes splitting reliable. Splitting on sentence boundaries
/// instead would tear a unit apart at its own name: a real report contains
/// `- Advanced Carpentry Inc. (13762), ...`, whose full stop is not a sentence end at all.
const SECTION_LABELS: &[&str] = &[
    "Weight",
    "Capacity",
    "Skills",
    "Can Study",
    "Ready item",
    "Ready weapon",
    "Ready armor",
    "Combat spell",
];

/// Splits a unit line into its head and whatever labelled sections follow.
fn split_sections(body: &str) -> (String, Vec<(String, String)>) {
    // Every position where a known label begins a new section.
    let mut boundaries: Vec<(usize, &str)> = Vec::new();
    for label in SECTION_LABELS {
        let needle = format!(". {label}:");
        let mut from = 0usize;
        while let Some(found) = body[from..].find(&needle) {
            let at = from + found;
            boundaries.push((at, label));
            from = at + needle.len();
        }
    }
    boundaries.sort_unstable_by_key(|(at, _)| *at);

    let Some(&(first, _)) = boundaries.first() else {
        return (body.trim().trim_end_matches('.').to_string(), Vec::new());
    };

    let head = body[..first].trim().trim_end_matches('.').to_string();

    let mut sections = Vec::new();
    for (position, &(at, label)) in boundaries.iter().enumerate() {
        let value_start = at + 2 + label.len() + 1;
        let value_end = boundaries
            .get(position + 1)
            .map_or(body.len(), |(next, _)| *next);
        if value_start > value_end || value_start > body.len() {
            continue;
        }
        sections.push((
            label.to_string(),
            body[value_start..value_end]
                .trim()
                .trim_end_matches('.')
                .to_string(),
        ));
    }

    (head, sections)
}

fn matching_flag(field: &str) -> Option<&'static str> {
    let normalised = field.trim().trim_end_matches('.');
    KNOWN_FLAGS
        .iter()
        .find(|flag| flag.eq_ignore_ascii_case(normalised))
        .copied()
}

/// Parses one unit line.
///
/// `own` comes from the line's marker rather than from anything in the text, which is what makes
/// the read-only rule for foreign units exact. `region_id` and `structure_id` are supplied by the
/// caller, which knows the block the line sat in.
#[must_use]
pub fn parse_unit(
    body: &str,
    own: bool,
    region_id: &str,
    structure_id: Option<&str>,
) -> Option<ReportUnit> {
    let without_marker = body
        .strip_prefix("* ")
        .or_else(|| body.strip_prefix("- "))
        .unwrap_or(body);

    let (head, sections) = split_sections(without_marker);
    let mut fields = split_top_level(&head, ',');
    if fields.is_empty() {
        return None;
    }

    let (name, unit_id) = split_trailing_id(&fields.remove(0))?;

    let mut unit = ReportUnit {
        unit_id,
        name,
        region_id: region_id.to_string(),
        faction_id: None,
        faction_name: None,
        own,
        on_guard: false,
        flags: Vec::new(),
        items: Vec::new(),
        skills: Vec::new(),
        men: 0,
        men_estimated: true,
        men_by_race: Vec::new(),
        weight: None,
        capacity: None,
        structure_id: structure_id.map(str::to_string),
    };

    for field in fields {
        if let Some(flag) = matching_flag(&field) {
            if flag == "on guard" || flag == "guarding" {
                unit.on_guard = true;
            }
            unit.flags.push(flag.to_string());
            continue;
        }

        // The faction is the only other field shaped `Something (number)`, and it appears before
        // the items. A concealed faction simply leaves it out.
        if unit.faction_id.is_none() && unit.items.is_empty() {
            if let Some((faction_name, faction_id)) = split_trailing_id(&field) {
                unit.faction_name = Some(faction_name);
                unit.faction_id = Some(faction_id);
                continue;
            }
        }

        if let Some(item) = parse_item_amount(&field) {
            unit.items.push(item);
        }
    }

    for (label, value) in sections {
        match label.as_str() {
            "Weight" => unit.weight = value.parse::<i64>().ok(),
            "Capacity" => unit.capacity = Some(value),
            "Skills" => unit.skills = parse_skills(&value),
            // The remaining labels are recognised only so their contents are not mistaken for the
            // unit's items; nothing in the model needs them yet.
            _ => {}
        }
    }

    unit.men = count_men(&unit.items);
    Some(unit)
}

fn parse_skills(value: &str) -> Vec<Skill> {
    if value.trim().trim_end_matches('.') == "none" {
        return Vec::new();
    }

    split_top_level(value, ',')
        .iter()
        .filter_map(|entry| parse_skill(entry))
        .collect()
}

/// Size of the unit's leading item group.
///
/// A report lists a unit's composition first and its equipment after, with no marker between them,
/// so `20 hill dwarves [HDWA], 159 silver [SILV]` gives 20 correctly while
/// `50 gnolls [GNOL], 49 orcs [ORC]` gives only 50. Summing everything that is not silver would be
/// worse, because equipment follows men far more often than a second race does.
///
/// This is now only the opening estimate. `classify_units` settles it exactly against the scraped
/// item catalogue and clears `men_estimated`; parsing keeps working without a ruleset, so the
/// estimate is what a unit carries until that pass has run.
fn count_men(items: &[ItemAmount]) -> i64 {
    items
        .first()
        .filter(|item| item.tag != "SILV")
        .map_or(0, |item| item.amount)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_own_unit_with_skills_and_weight() {
        let unit = parse_unit(
            "* Three of Five (793), Borg (73), behind, revealing faction, leader [LEAD]. \
             Weight: 10. Capacity: 0/0/15/0. Skills: observation [OBSE] 1 (35), combat [COMB] 3 (180).",
            true,
            "1:7,53",
            None,
        )
        .expect("unit should parse");

        assert_eq!(unit.unit_id, "793");
        assert_eq!(unit.name, "Three of Five");
        assert!(unit.own);
        assert_eq!(unit.faction_id.as_deref(), Some("73"));
        assert_eq!(unit.faction_name.as_deref(), Some("Borg"));
        assert_eq!(unit.flags, vec!["behind", "revealing faction"]);
        assert_eq!(unit.weight, Some(10));
        assert_eq!(unit.capacity.as_deref(), Some("0/0/15/0"));
        assert_eq!(unit.skills.len(), 2);
        assert_eq!(unit.skills[1].tag, "COMB");
        assert_eq!(unit.men, 1);
    }

    #[test]
    fn reads_a_foreign_unit_and_marks_it_as_such() {
        let unit = parse_unit(
            "- Unit (5812), Wanderers (83), avoiding, behind, hill dwarf [HDWA].",
            false,
            "1:7,53",
            None,
        )
        .expect("unit should parse");

        assert!(!unit.own);
        assert_eq!(unit.faction_name.as_deref(), Some("Wanderers"));
        assert_eq!(unit.items.len(), 1);
        assert_eq!(unit.men, 1);
    }

    #[test]
    fn records_a_guard_flag_that_precedes_the_faction() {
        let unit = parse_unit(
            "- City Guard (89), on guard, The Guardsmen (1), 80 leaders [LEAD], 80 swords [SWOR].",
            false,
            "1:13,63",
            None,
        )
        .expect("unit should parse");

        assert!(unit.on_guard);
        assert_eq!(unit.faction_id.as_deref(), Some("1"));
        assert_eq!(unit.men, 80);
        assert_eq!(unit.items.len(), 2);
    }

    #[test]
    fn keeps_a_unit_whose_faction_is_concealed() {
        let unit = parse_unit(
            "- Sneaker (1691), avoiding, behind, 1 nomad [NOMA].",
            false,
            "1:7,53",
            None,
        )
        .expect("unit should parse");

        assert_eq!(unit.faction_id, None);
        assert_eq!(unit.items.len(), 1);
    }

    #[test]
    fn does_not_split_a_name_that_contains_punctuation() {
        let unit = parse_unit(
            "- -= 0 =- (7323), The Lord of Drama (29), avoiding, high elf [HELF].",
            false,
            "1:26,52",
            None,
        )
        .expect("unit should parse");

        assert_eq!(unit.name, "-= 0 =-");
        assert_eq!(unit.unit_id, "7323");
    }

    #[test]
    fn attributes_a_unit_to_the_structure_it_sits_in() {
        let unit = parse_unit(
            "- Eastern Watch (14353), on guard, Elder Tree Forests (32), 120 hill dwarves [HDWA].",
            false,
            "1:7,53",
            Some("1"),
        )
        .expect("unit should parse");

        assert_eq!(unit.structure_id.as_deref(), Some("1"));
        assert_eq!(unit.men, 120);
    }

    #[test]
    fn treats_a_skill_list_of_none_as_empty() {
        let unit = parse_unit(
            "* Unit (1387), Borg (73), behind, 6 hill dwarves [HDWA]. Weight: 60. Skills: none.",
            true,
            "1:13,63",
            None,
        )
        .expect("unit should parse");

        assert!(unit.skills.is_empty());
        assert_eq!(unit.men, 6);
    }

    #[test]
    fn counts_only_the_leading_group_for_a_multi_race_unit() {
        // Documented limitation rather than an accident: without an item reference there is no way
        // to tell where a unit's men end and its equipment begins.
        let unit = parse_unit(
            "- Mixed Company (500), Wanderers (83), 50 leaders [LEAD], 20 nomads [NOMA].",
            false,
            "1:7,53",
            None,
        )
        .expect("unit should parse");

        assert_eq!(unit.men, 50, "the leading group, not the sum");
        assert_eq!(
            unit.items.len(),
            2,
            "both groups are still available as items"
        );
    }

    #[test]
    fn does_not_count_carried_silver_as_men() {
        let unit = parse_unit(
            "* Unit (1388), Borg (73), behind, 20 hill dwarves [HDWA], 159 silver [SILV].",
            true,
            "1:13,63",
            None,
        )
        .expect("unit should parse");

        assert_eq!(unit.men, 20);
        assert_eq!(unit.items.len(), 2);
    }
}
