//! Parses the `Battles during turn:` section into a structured, ordered list of battles.
//!
//! Run as a second, independent pass over the same preamble slice `parse_header` reads
//! (`crates/core/src/report/mod.rs`). `parse_header` already sends `Battles during turn:` to
//! `Section::None`, so the two parsers never fight over the same lines; this one simply looks for
//! its own section and ignores everything else.
//!
//! ```text
//! AA Tomb's Guards (7280) attacks Pirates (14789) in ocean (25,55) in
//!   Atlantis Ocean!
//!
//! Attackers:
//! AA Tomb's Guards (7280), Greywolf (33), 78 gnolls [GNOL], ...
//!
//! Defenders:
//! Pirates (14789), Creatures (2), 15 pirates [PIRA] (Combat 3/3, ...).
//!
//! Round 1:
//! AA Tomb's Guards (7280) tactics bonus 3.
//! ...
//! AA Tomb's Guards (7280) loses 0.
//! Pirates (14789) loses 15.
//!
//! Round 1 statistics:
//! ...
//!
//! Battle statistics:
//! ...
//!
//! Total Casualties:
//! Pirates (14789) loses 15.
//! Damaged units: 14789.
//! AA Tomb's Guards (7280) loses 0.
//!
//! Spoils: 3 magic crossbows [MXBO], ..., 2531 silver [SILV].
//! ```
//!
//! Every structured field is optional, or has a verbatim companion, so a block the parser cannot
//! fully make sense of still becomes a `Battle` carrying its headline and its line span rather than
//! being dropped.

use serde::{Deserialize, Serialize};

use super::scan::{parse_coordinate, split_top_level, split_trailing_id};
use super::unit::matching_flag;
use super::unwrap::LogicalLine;

/// The preamble section headers `parse_header` recognises, other than `Battles during turn` itself.
/// Any of these ends the battle section, in addition to running out of preamble.
const OTHER_PREAMBLE_HEADERS: &[&str] = &[
    "Atlantis Report For",
    "Errors during turn",
    "Events during turn",
    "Faction Status",
    "Skill reports",
    "Item reports",
];

/// A named participant, as printed: `Pirates (14789)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Combatant {
    pub name: String,
    pub id: String,
}

/// One entry in an attacker or defender roster.
///
/// `body` is everything after the name, faction and flags, kept verbatim rather than parsed down to
/// individual items: a roster line can be a paragraph of `#a hero/dwarf` repeats, and nothing
/// downstream has asked for it broken down.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleUnit {
    pub name: String,
    pub id: String,
    pub faction: Option<Combatant>,
    pub flags: Vec<String>,
    pub body: String,
}

/// A casualty line, on the close of a round or of the whole battle: `Pirates (14789) loses 15.`
///
/// `text` is that line trimmed and with its trailing full stop removed - `Pirates (14789) loses
/// 15` - matching the convention `parse_casualty_line` uses for every other verbatim field here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Casualty {
    pub combatant: Option<Combatant>,
    pub lost: Option<i64>,
    pub text: String,
}

/// One round of a battle.
///
/// `statistics` is the `Round N statistics:` block, kept as text; modelling it field by field is
/// out of scope here.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleRound {
    pub number: Option<u32>,
    pub lines: Vec<String>,
    pub losses: Vec<Casualty>,
    pub statistics: Vec<String>,
}

/// One battle, headline to spoils.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Battle {
    /// The headline, verbatim, whether or not it was recognised.
    pub headline: String,
    pub attacker: Option<Combatant>,
    pub defender: Option<Combatant>,
    pub terrain: Option<String>,
    pub coordinate: Option<super::model::Coordinate>,
    pub province: Option<String>,
    pub attackers: Vec<BattleUnit>,
    pub defenders: Vec<BattleUnit>,
    pub rounds: Vec<BattleRound>,
    /// The `Battle statistics:` block, kept as text.
    pub statistics: Vec<String>,
    pub casualties: Vec<Casualty>,
    pub damaged_units: Vec<String>,
    pub spoils: Option<String>,
    pub line_start: usize,
    pub line_end: usize,
    /// Whether the headline was an assassination (`<victim> is assassinated in ...!`) rather than
    /// an `attacks` battle. `#[serde(default)]` because a payload stored before this field existed
    /// carries no key for it.
    #[serde(default)]
    pub assassination: bool,
}

/// Whether `label` (a line's body with any trailing colon already stripped) opens one of the other
/// preamble sections, and so ends the battle section.
fn ends_the_section(label: &str) -> bool {
    OTHER_PREAMBLE_HEADERS.contains(&label)
}

/// Whether `line` opens a new battle.
///
/// A headline ends in `!`, but so does `<unit> (<id>) is destroyed!`, printed inside a round's
/// statistics block, and `<unit> (<id>) is routed!`, which starts a free round of attacks within
/// the battle it came from rather than a battle of its own (`parse_one_battle` folds it in).
/// Excluding those two shapes is enough to tell headlines apart from in-battle narration without
/// requiring the recognised `attacks` wording, which is what lets an unrecognised headline (an
/// assassination, say) still open its own battle rather than being read as part of the one before
/// it.
fn opens_a_battle(line: &LogicalLine) -> bool {
    if line.indent != 0 {
        return false;
    }
    let body = line.body();
    body.ends_with('!') && !body.ends_with("is destroyed!") && !body.ends_with("is routed!")
}

/// Parses the `Battles during turn:` section out of the preamble slice.
///
/// A report with no such section, or none of its own, yields an empty list. Nothing here can fail
/// the parse.
#[must_use]
pub fn parse_battles(lines: &[LogicalLine]) -> Vec<Battle> {
    let Some(section_start) = lines
        .iter()
        .position(|line| line.body().trim_end_matches(':') == "Battles during turn")
    else {
        return Vec::new();
    };

    let section_end = lines[section_start + 1..]
        .iter()
        .position(|line| ends_the_section(line.body().trim_end_matches(':')))
        .map_or(lines.len(), |offset| section_start + 1 + offset);

    let section = &lines[section_start + 1..section_end];

    let headline_indices: Vec<usize> = section
        .iter()
        .enumerate()
        .filter(|(_, line)| opens_a_battle(line))
        .map(|(index, _)| index)
        .collect();

    headline_indices
        .iter()
        .enumerate()
        .map(|(position, &start)| {
            let end = headline_indices
                .get(position + 1)
                .copied()
                .unwrap_or(section.len());
            parse_one_battle(&section[start..end])
        })
        .collect()
}

/// Which part of a battle the lines after the headline currently belong to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    None,
    Attackers,
    Defenders,
    Round,
    RoundStatistics,
    BattleStatistics,
    TotalCasualties,
}

fn parse_one_battle(lines: &[LogicalLine]) -> Battle {
    let headline_line = &lines[0];
    let parsed_headline = parse_headline(headline_line.body());

    let mut battle = Battle {
        headline: headline_line.body().to_string(),
        attacker: parsed_headline.attacker,
        defender: parsed_headline.defender,
        terrain: parsed_headline.terrain,
        coordinate: parsed_headline.coordinate,
        province: parsed_headline.province,
        attackers: Vec::new(),
        defenders: Vec::new(),
        rounds: Vec::new(),
        statistics: Vec::new(),
        casualties: Vec::new(),
        damaged_units: Vec::new(),
        spoils: None,
        line_start: headline_line.line_start,
        line_end: lines
            .last()
            .map_or(headline_line.line_end, |line| line.line_end),
        assassination: parsed_headline.assassination,
    };

    let mut phase = Phase::None;
    let mut current_round: Option<BattleRound> = None;

    for line in &lines[1..] {
        let body = line.body();
        let label = body.trim_end_matches(':');

        if body.ends_with("is routed!") {
            // The rout belongs to the battle it came from: close whatever round was open (a
            // round's statistics, typically) and start a new, unnumbered round with the rout line
            // as its first entry - the free round of attacks that follows is this round's body.
            close_round(&mut battle, &mut current_round);
            current_round = Some(BattleRound {
                number: None,
                lines: vec![body.to_string()],
                ..BattleRound::default()
            });
            phase = Phase::Round;
            continue;
        }

        match label {
            "Attackers" => {
                phase = Phase::Attackers;
                continue;
            }
            "Defenders" => {
                phase = Phase::Defenders;
                continue;
            }
            "Battle statistics" => {
                close_round(&mut battle, &mut current_round);
                phase = Phase::BattleStatistics;
                continue;
            }
            "Total Casualties" => {
                close_round(&mut battle, &mut current_round);
                phase = Phase::TotalCasualties;
                continue;
            }
            _ => {}
        }

        if let Some(prefix) = label.strip_suffix(" statistics") {
            if prefix == "Free round" || parse_round_number(prefix).is_some() {
                // The block belongs to the round already open; it is not itself a new round. A
                // free round (the round a rout opens) is labelled "Free round statistics" rather
                // than "Round N statistics", but it closes the same way.
                phase = Phase::RoundStatistics;
                continue;
            }
        }

        if let Some(number) = parse_round_number(label) {
            close_round(&mut battle, &mut current_round);
            current_round = Some(BattleRound {
                number: Some(number),
                ..BattleRound::default()
            });
            phase = Phase::Round;
            continue;
        }

        if let Some(spoils) = body.strip_prefix("Spoils:") {
            battle.spoils = Some(spoils.trim().trim_end_matches('.').to_string());
            continue;
        }

        match phase {
            Phase::Attackers => {
                if let Some(unit) = parse_battle_unit(body) {
                    battle.attackers.push(unit);
                }
            }
            Phase::Defenders => {
                if let Some(unit) = parse_battle_unit(body) {
                    battle.defenders.push(unit);
                }
            }
            Phase::Round => {
                if let Some(round) = current_round.as_mut() {
                    if let Some(casualty) = parse_casualty_line(body) {
                        round.losses.push(casualty);
                    } else {
                        round.lines.push(body.to_string());
                    }
                }
            }
            Phase::RoundStatistics => {
                if let Some(round) = current_round.as_mut() {
                    round.statistics.push(body.to_string());
                }
            }
            Phase::BattleStatistics => battle.statistics.push(body.to_string()),
            Phase::TotalCasualties => {
                if let Some(ids) = body.strip_prefix("Damaged units:") {
                    battle
                        .damaged_units
                        .extend(split_top_level(ids.trim().trim_end_matches('.'), ','));
                } else if let Some(casualty) = parse_casualty_line(body) {
                    battle.casualties.push(casualty);
                }
            }
            Phase::None => {}
        }
    }

    close_round(&mut battle, &mut current_round);
    battle
}

/// Flushes a round in progress onto the battle, if there is one.
fn close_round(battle: &mut Battle, current_round: &mut Option<BattleRound>) {
    if let Some(round) = current_round.take() {
        battle.rounds.push(round);
    }
}

fn parse_round_number(label: &str) -> Option<u32> {
    label.strip_prefix("Round ")?.trim().parse().ok()
}

/// A casualty line: `<combatant> loses <n>.`
fn parse_casualty_line(body: &str) -> Option<Casualty> {
    let text = body.trim().trim_end_matches('.');
    let (combatant_text, lost_text) = text.rsplit_once(" loses ")?;
    let combatant = split_trailing_id(combatant_text).map(|(name, id)| Combatant { name, id });
    let lost = lost_text.trim().parse::<i64>().ok();
    Some(Casualty {
        combatant,
        lost,
        text: text.to_string(),
    })
}

/// What the headline says, when it says something this parser recognises.
#[derive(Default)]
struct ParsedHeadline {
    attacker: Option<Combatant>,
    defender: Option<Combatant>,
    terrain: Option<String>,
    coordinate: Option<super::model::Coordinate>,
    province: Option<String>,
    assassination: bool,
}

/// Reads `<attacker> (<id>) attacks <defender> (<id>) in <terrain> (<x>,<y>) in <province>!` or
/// `<victim> (<id>) is assassinated in <terrain> (<x>,<y>) in <province>!`
///
/// Every field is independently optional: a headline this does not recognise yields every field
/// `None`, and the battle it opens still carries the headline verbatim. The assassin is never
/// named for the victim's faction, so an assassination has no `attacker` - only `defender` (the
/// victim), `assassination: true`, and the same location tail as an `attacks` headline.
fn parse_headline(headline: &str) -> ParsedHeadline {
    let mut result = ParsedHeadline::default();
    let text = headline.trim().trim_end_matches('!');

    if let Some((victim_text, location)) = text.split_once(" is assassinated in ") {
        result.assassination = true;
        result.defender = split_trailing_id(victim_text).map(|(name, id)| Combatant { name, id });
        apply_location_tail(location.trim(), &mut result);
        return result;
    }

    let Some((attacker_text, rest)) = text.split_once(" attacks ") else {
        return result;
    };
    result.attacker = split_trailing_id(attacker_text).map(|(name, id)| Combatant { name, id });

    let Some(defender_close) = rest.find(") in ") else {
        return result;
    };
    let defender_text = &rest[..=defender_close];
    result.defender = split_trailing_id(defender_text).map(|(name, id)| Combatant { name, id });

    let location = rest[defender_close + ") in ".len()..].trim();
    apply_location_tail(location, &mut result);
    result
}

/// Reads the `<terrain> (<x>,<y>) in <province>` tail shared by every headline shape this parser
/// recognises, and fills in whichever `ParsedHeadline` fields it can.
fn apply_location_tail(location: &str, result: &mut ParsedHeadline) {
    let Some(open) = location.find('(') else {
        return;
    };
    let Some(close) = location.find(')') else {
        return;
    };
    if close < open {
        return;
    }

    let terrain = location[..open].trim();
    if !terrain.is_empty() {
        result.terrain = Some(terrain.to_string());
    }
    result.coordinate = parse_coordinate(&location[open..=close]);
    if let Some(province) = location[close + 1..].trim().strip_prefix("in ") {
        result.province = Some(province.trim().to_string());
    }
}

/// Like [`split_top_level`], but also returns the byte offset in `input` immediately after each
/// field's trailing comma (or the end of the string, for the last field).
///
/// A roster line's item and skill body is kept verbatim rather than rebuilt from parsed tokens, so
/// the caller needs to know exactly where in the original text the recognised leading fields end.
fn top_level_fields_with_ends(input: &str) -> Vec<(String, usize)> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;

    for (byte_index, character) in input.char_indices() {
        match character {
            '(' | '[' => {
                depth += 1;
                current.push(character);
            }
            ')' | ']' => {
                depth -= 1;
                current.push(character);
            }
            ',' if depth <= 0 => {
                parts.push((
                    current.trim().to_string(),
                    byte_index + character.len_utf8(),
                ));
                current.clear();
            }
            _ => current.push(character),
        }
    }
    if !current.trim().is_empty() {
        parts.push((current.trim().to_string(), input.len()));
    }

    parts
}

/// Parses one roster line: name, id, faction where printed, flags, and everything after that kept
/// verbatim as `body`. Not `unit::parse_unit`: a roster line's item list is not modelled here, only
/// kept, and a roster line carries no ownership marker to strip.
fn parse_battle_unit(line: &str) -> Option<BattleUnit> {
    let trimmed = line.trim().trim_end_matches('.');
    let fields = top_level_fields_with_ends(trimmed);
    let (name_field, mut body_start) = fields.first()?.clone();
    let (name, id) = split_trailing_id(&name_field)?;

    let mut faction = None;
    let mut flags = Vec::new();

    for (field, end) in &fields[1..] {
        if let Some(flag) = matching_flag(field) {
            flags.push(flag.to_string());
            body_start = *end;
            continue;
        }
        // Matches `unit::parse_unit`'s own guard (`faction_id.is_none() && items.is_empty()`): a
        // flag may precede the faction field, as in "City Guard (89), on guard, The Guardsmen
        // (1), ...", so only whether the body has started - not whether a flag was seen - closes
        // the window for recognising a faction.
        if faction.is_none() {
            if let Some((faction_name, faction_id)) = split_trailing_id(field) {
                faction = Some(Combatant {
                    name: faction_name,
                    id: faction_id,
                });
                body_start = *end;
                continue;
            }
        }
        break;
    }

    let body = trimmed
        .get(body_start..)
        .unwrap_or_default()
        .trim_start_matches(',')
        .trim()
        .to_string();

    Some(BattleUnit {
        name,
        id,
        faction,
        flags,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::unwrap::unwrap_lines;

    fn battles(source: &str) -> Vec<Battle> {
        parse_battles(&unwrap_lines(source))
    }

    #[test]
    fn finds_each_battle_in_the_section() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "C (3) attacks D (4) in ocean (2,2) in Sea!\n",
        ));

        assert_eq!(parsed.len(), 2);
        assert!(parsed[0].headline.starts_with("A (1) attacks B (2)"));
        assert!(parsed[1].headline.starts_with("C (3) attacks D (4)"));
    }

    #[test]
    fn stops_at_the_section_that_follows() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "Events during turn:\n",
            "Something happened.\n",
        ));

        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn reads_the_attacker_defender_and_location_from_the_headline() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "AA Tomb's Guards (7280) attacks Pirates (14789) in ocean (25,55) in\n",
            "  Atlantis Ocean!\n",
        ));

        let battle = &parsed[0];
        assert_eq!(
            battle.attacker,
            Some(Combatant {
                name: "AA Tomb's Guards".to_string(),
                id: "7280".to_string()
            })
        );
        assert_eq!(
            battle.defender,
            Some(Combatant {
                name: "Pirates".to_string(),
                id: "14789".to_string()
            })
        );
        assert_eq!(battle.terrain.as_deref(), Some("ocean"));
        assert_eq!(
            battle.coordinate,
            Some(super::super::model::Coordinate { x: 25, y: 55, z: 1 })
        );
        assert_eq!(battle.province.as_deref(), Some("Atlantis Ocean"));
    }

    #[test]
    fn keeps_a_headline_it_does_not_recognise() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "Someone assassinates Someone Else in the dead of night!\n",
        ));

        assert_eq!(parsed.len(), 1);
        assert_eq!(
            parsed[0].headline,
            "Someone assassinates Someone Else in the dead of night!"
        );
        assert_eq!(parsed[0].attacker, None);
        assert_eq!(parsed[0].defender, None);
    }

    #[test]
    fn reads_the_attacker_and_defender_rosters() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Attackers:\n",
            "AA Tomb's Guards (7280), Greywolf (33), 78 gnolls [GNOL], 73 mithril\n",
            "  armor [MARM].\n",
            "Ailen's Acolyte (2965), behind, leader [LEAD], mithril sword [MSWO].\n",
            "\n",
            "Defenders:\n",
            "Pirates (14789), Creatures (2), 15 pirates [PIRA] (Combat 3/3, Attacks\n",
            "  5, Hits 5, Tactics 1).\n",
        ));

        let battle = &parsed[0];
        assert_eq!(battle.attackers.len(), 2);
        assert_eq!(battle.attackers[0].name, "AA Tomb's Guards");
        assert_eq!(battle.attackers[0].id, "7280");
        assert_eq!(
            battle.attackers[0].faction,
            Some(Combatant {
                name: "Greywolf".to_string(),
                id: "33".to_string()
            })
        );
        assert!(battle.attackers[0].flags.is_empty());
        assert_eq!(
            battle.attackers[0].body,
            "78 gnolls [GNOL], 73 mithril armor [MARM]"
        );

        assert_eq!(battle.attackers[1].faction, None);
        assert_eq!(battle.attackers[1].flags, vec!["behind"]);
        assert_eq!(
            battle.attackers[1].body,
            "leader [LEAD], mithril sword [MSWO]"
        );

        assert_eq!(battle.defenders.len(), 1);
        assert_eq!(battle.defenders[0].name, "Pirates");
        assert_eq!(
            battle.defenders[0].faction,
            Some(Combatant {
                name: "Creatures".to_string(),
                id: "2".to_string()
            })
        );
    }

    #[test]
    fn recognises_a_roster_faction_that_a_flag_precedes() {
        // The same shape unit.rs pins with `records_a_guard_flag_that_precedes_the_faction`: a
        // flag can come before the faction field, and that must not close the window for
        // recognising it.
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Attackers:\n",
            "City Guard (89), on guard, The Guardsmen (1), 80 leaders [LEAD].\n",
        ));

        let unit = &parsed[0].attackers[0];
        assert_eq!(unit.flags, vec!["on guard"]);
        assert_eq!(
            unit.faction,
            Some(Combatant {
                name: "The Guardsmen".to_string(),
                id: "1".to_string()
            })
        );
        assert_eq!(unit.body, "80 leaders [LEAD]");
    }

    #[test]
    fn keeps_a_roster_body_verbatim_rather_than_splitting_it() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Attackers:\n",
            "Mota (1388), La Orden de la Sangre (9), behind, leader [LEAD], 10\n",
            "  skeletons [SKEL]; #a hero/dwarf #a hero/dwarf #a hero/dwarf.\n",
        ));

        let unit = &parsed[0].attackers[0];
        assert!(unit
            .body
            .contains("#a hero/dwarf #a hero/dwarf #a hero/dwarf"));
    }

    #[test]
    fn reads_the_rounds_in_order_with_their_loss_lines() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Round 1:\n",
            "A (1) tactics bonus 3.\n",
            "A (1) loses 0.\n",
            "B (2) loses 15.\n",
        ));

        let round = &parsed[0].rounds[0];
        assert_eq!(round.number, Some(1));
        assert_eq!(round.lines, vec!["A (1) tactics bonus 3."]);
        assert_eq!(round.losses.len(), 2);
        assert_eq!(round.losses[0].lost, Some(0));
        assert_eq!(round.losses[1].lost, Some(15));
        assert_eq!(
            round.losses[1].combatant,
            Some(Combatant {
                name: "B".to_string(),
                id: "2".to_string()
            })
        );
    }

    #[test]
    fn keeps_the_round_statistics_as_text() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Round 1:\n",
            "A (1) loses 0.\n",
            "\n",
            "Round 1 statistics:\n",
            "A (1) army:\n",
            "Army made no attacks.\n",
        ));

        let round = &parsed[0].rounds[0];
        assert_eq!(
            round.statistics,
            vec![
                "A (1) army:".to_string(),
                "Army made no attacks.".to_string()
            ]
        );
    }

    #[test]
    fn reads_the_total_casualties_damaged_units_and_spoils() {
        // The report interleaves "Damaged units:" between the two casualty lines.
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Total Casualties:\n",
            "B (2) loses 15.\n",
            "Damaged units: 2.\n",
            "A (1) loses 0.\n",
            "\n",
            "Spoils: 3 magic crossbows [MXBO], 2531 silver [SILV].\n",
        ));

        let battle = &parsed[0];
        assert_eq!(battle.casualties.len(), 2);
        assert_eq!(battle.casualties[0].lost, Some(15));
        assert_eq!(battle.casualties[1].lost, Some(0));
        assert_eq!(battle.damaged_units, vec!["2".to_string()]);
        assert_eq!(
            battle.spoils.as_deref(),
            Some("3 magic crossbows [MXBO], 2531 silver [SILV]")
        );
    }

    #[test]
    fn parses_a_battle_missing_its_spoils() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Total Casualties:\n",
            "B (2) loses 15.\n",
        ));

        assert_eq!(parsed[0].spoils, None);
        assert_eq!(parsed[0].casualties.len(), 1);
    }

    #[test]
    fn parses_a_battle_with_no_statistics() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Round 1:\n",
            "A (1) tactics bonus 3.\n",
            "\n",
            "Total Casualties:\n",
            "B (2) loses 1.\n",
        ));

        let battle = &parsed[0];
        assert!(battle.statistics.is_empty());
        assert_eq!(battle.rounds.len(), 1);
        assert!(battle.rounds[0].statistics.is_empty());
    }

    #[test]
    fn records_the_line_span_of_each_battle() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Total Casualties:\n",
            "B (2) loses 1.\n",
        ));

        // Line 1 is the section header, so the headline is line 2. The blank line before "Total
        // Casualties:" still counts as a physical line even though it produces no logical one, so
        // the casualty line - the last logical line - sits on physical line 5.
        assert_eq!(parsed[0].line_start, 2);
        assert_eq!(parsed[0].line_end, 5);
    }

    #[test]
    fn a_report_with_no_battles_section_parses_to_an_empty_list() {
        assert!(battles("Errors during turn:\nSomething went wrong.\n").is_empty());
    }

    #[test]
    fn folds_a_rout_into_the_battle_it_came_from() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
            "\n",
            "Round 1:\n",
            "\n",
            "A (1) loses 0.\n",
            "B (2) loses 4.\n",
            "\n",
            "Round 1 statistics:\n",
            "\n",
            "A (1) army:\n",
            "stuff.\n",
            "\n",
            "B (2) is routed!\n",
            "A (1) gets a free round of attacks.\n",
            "\n",
            "B (2) loses 3.\n",
            "\n",
            "Free round statistics:\n",
            "\n",
            "A (1) army:\n",
            "more stuff.\n",
            "\n",
            "Total Casualties:\n",
            "B (2) loses 7.\n",
        ));

        // The rout must not have opened a second battle.
        assert_eq!(parsed.len(), 1);

        let battle = &parsed[0];
        assert_eq!(battle.rounds.len(), 2);

        let free_round = &battle.rounds[1];
        assert_eq!(free_round.number, None);
        assert_eq!(
            free_round.lines,
            vec![
                "B (2) is routed!".to_string(),
                "A (1) gets a free round of attacks.".to_string()
            ]
        );
        assert_eq!(free_round.losses.len(), 1);
        assert_eq!(free_round.losses[0].lost, Some(3));
        assert_eq!(
            free_round.statistics,
            vec!["A (1) army:".to_string(), "more stuff.".to_string()]
        );

        assert_eq!(battle.casualties.len(), 1);
        assert_eq!(battle.casualties[0].lost, Some(7));
    }

    #[test]
    fn reads_the_assassination_headline() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "L Arslan (1446) is assassinated in forest (43,79) in Utso!\n",
        ));

        let battle = &parsed[0];
        assert!(battle.assassination);
        assert_eq!(battle.attacker, None);
        assert_eq!(
            battle.defender,
            Some(Combatant {
                name: "L Arslan".to_string(),
                id: "1446".to_string()
            })
        );
        assert_eq!(battle.terrain.as_deref(), Some("forest"));
        assert_eq!(
            battle.coordinate,
            Some(super::super::model::Coordinate { x: 43, y: 79, z: 1 })
        );
        assert_eq!(battle.province.as_deref(), Some("Utso"));
    }

    #[test]
    fn a_normal_battle_is_not_an_assassination() {
        let parsed = battles(concat!(
            "Battles during turn:\n",
            "A (1) attacks B (2) in ocean (1,1) in Sea!\n",
        ));

        assert!(!parsed[0].assassination);
    }
}
