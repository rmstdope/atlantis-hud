//! Every engine error in the committed report corpus, counted, as
//! `docs/order-checks/corpus-errors.generated.md`. Fails when the committed table no longer
//! matches the corpus (a fixture added, a message changed) unless `ATLANTIS_UPDATE_GENERATED=1`
//! rewrites it - the same gate as `generated_ts.rs`. The judgement about which errors an order
//! check could have caught is not here; it is `docs/order-checks/README.md`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use atlantis_hud_core::report::parse_report_full;
use atlantis_hud_fixtures::ALL;

const RELATIVE_PATH: &str = "../../docs/order-checks/corpus-errors.generated.md";
const REGENERATE: &str =
    "ATLANTIS_UPDATE_GENERATED=1 cargo test -p atlantis-hud-core --test corpus_errors";

/// One engine error, reduced to what repeats: the order keyword and the message with the unit
/// prefix stripped and every number replaced by `N`.
///
/// `Builders (11619): MOVE: Unit is overloaded and cannot move.` -> (`MOVE`, `Unit is overloaded
/// and cannot move.`)
/// `GIVE: Nonexistant target (7233).` -> (`GIVE`, `Nonexistant target (N).`)
/// `Drone (8548): STUDY: Not enough funds.` -> (`STUDY`, `Not enough funds.`)
/// A line with no `ORDER:` keyword (none in the corpus today) keeps its whole text under `-`.
pub fn normalise(line: &str) -> (String, String) {
    let stripped = strip_unit_prefix(line);
    let (keyword, message) = split_keyword(stripped);
    (keyword, replace_numbers(message.trim()))
}

/// Strips a leading `<anything> (<digits>): ` unit prefix, if the line has one. Matches the
/// *first* `(<digits>): ` in the line, since a unit name is never followed by another one.
fn strip_unit_prefix(line: &str) -> &str {
    if let Some(open) = line.find('(') {
        let rest = &line[open + 1..];
        if let Some(close_rel) = rest.find(')') {
            let digits = &rest[..close_rel];
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                let after_close = &rest[close_rel + 1..];
                if let Some(stripped) = after_close.strip_prefix(": ") {
                    return stripped;
                }
            }
        }
    }
    line
}

/// Splits at the first `: ` into an order keyword and the rest of the message. A line with no
/// `: ` at all (none observed in the corpus) keeps its whole text under the sentinel keyword `-`.
fn split_keyword(s: &str) -> (String, String) {
    if let Some(idx) = s.find(": ") {
        (s[..idx].to_string(), s[idx + 2..].to_string())
    } else {
        ("-".to_string(), s.to_string())
    }
}

/// Replaces every maximal run of ASCII digits with a single `N`.
fn replace_numbers(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            out.push('N');
            while matches!(chars.peek(), Some(next) if next.is_ascii_digit()) {
                chars.next();
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// One normalised message's counts across the corpus.
pub struct Tally {
    pub occurrences: usize,
    pub turns: usize,
    pub games: usize,
}

/// The `gN` segment of a fixture file name, e.g. `neworigins-3.0.0-g7-f95-t71.rep` -> `g7`.
fn game_of(file: &str) -> String {
    file.split('-')
        .find(|segment| {
            segment.len() > 1
                && segment.starts_with('g')
                && segment[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or("?")
        .to_string()
}

/// Every distinct (order, message) in the corpus, with how often it occurs, across how many
/// fixture files (turns) and how many distinct games.
pub fn tally() -> BTreeMap<(String, String), Tally> {
    let mut occurrences: BTreeMap<(String, String), usize> = BTreeMap::new();
    let mut turns: BTreeMap<(String, String), BTreeSet<&str>> = BTreeMap::new();
    let mut games: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();

    for report in ALL {
        let parsed = parse_report_full(report.text);
        let game = game_of(report.file);
        for line in &parsed.header.errors {
            let key = normalise(line);
            *occurrences.entry(key.clone()).or_insert(0) += 1;
            turns.entry(key.clone()).or_default().insert(report.file);
            games.entry(key.clone()).or_default().insert(game.clone());
        }
    }

    occurrences
        .into_iter()
        .map(|(key, occurrences)| {
            let turns = turns.get(&key).map_or(0, BTreeSet::len);
            let games = games.get(&key).map_or(0, BTreeSet::len);
            (
                key,
                Tally {
                    occurrences,
                    turns,
                    games,
                },
            )
        })
        .collect()
}

fn render() -> String {
    let tallies = tally();
    let mut rows: Vec<(&(String, String), &Tally)> = tallies.iter().collect();
    rows.sort_by(|a, b| {
        b.1.occurrences
            .cmp(&a.1.occurrences)
            .then_with(|| a.0 .0.cmp(&b.0 .0))
            .then_with(|| a.0 .1.cmp(&b.0 .1))
    });

    let mut games: BTreeSet<String> = BTreeSet::new();
    for report in ALL {
        games.insert(game_of(report.file));
    }
    let games_list: Vec<String> = games.into_iter().collect();

    let mut out = String::new();
    out.push_str("# Engine errors in the report corpus\n\n");
    out.push_str(
        "GENERATED by crates/core/tests/corpus_errors.rs from tests/fixtures/reports/. Do not edit by hand.\n",
    );
    out.push_str(&format!("Regenerate with: {REGENERATE}\n\n"));
    out.push_str(&format!(
        "{} reports, {} games ({}), all neworigins-3.0.0. Numbers in messages are `N`.\n",
        ALL.len(),
        games_list.len(),
        games_list.join(", ")
    ));
    out.push_str("Turns of one game are not independent samples; see README.md.\n\n");
    out.push_str("| Order | Message | Occurrences | Turns | Games |\n");
    out.push_str("|---|---|---:|---:|---:|\n");
    for ((order, message), t) in rows {
        out.push_str(&format!(
            "| {order} | {message} | {} | {} | {} |\n",
            t.occurrences, t.turns, t.games
        ));
    }
    out
}

#[test]
fn corpus_error_table_matches_the_corpus() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(RELATIVE_PATH);
    let expected = render();
    if std::env::var_os("ATLANTIS_UPDATE_GENERATED").is_some() {
        std::fs::write(&path, &expected).expect("writes the generated corpus error table");
        return;
    }
    let actual = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => panic!("could not read {}: {error}", path.display()),
    };
    assert_eq!(
        actual, expected,
        "docs/order-checks/corpus-errors.generated.md is stale; regenerate it with:\n  {REGENERATE}"
    );
}

#[test]
fn normalise_strips_the_unit_prefix() {
    assert_eq!(
        normalise("Builders (11619): MOVE: Unit is overloaded and cannot move."),
        (
            "MOVE".to_string(),
            "Unit is overloaded and cannot move.".to_string()
        )
    );
}

#[test]
fn normalise_replaces_numbers_in_a_faction_level_message() {
    assert_eq!(
        normalise("GIVE: Nonexistant target (7233)."),
        ("GIVE".to_string(), "Nonexistant target (N).".to_string())
    );
}

#[test]
fn normalise_strips_the_unit_prefix_with_a_multi_word_unit_name() {
    assert_eq!(
        normalise("Drone (8548): STUDY: Not enough funds."),
        ("STUDY".to_string(), "Not enough funds.".to_string())
    );
}

#[test]
fn normalise_leaves_a_faction_level_message_without_numbers_unchanged() {
    assert_eq!(
        normalise("DECLARE: Can't declare towards your own faction."),
        (
            "DECLARE".to_string(),
            "Can't declare towards your own faction.".to_string()
        )
    );
}

#[test]
fn normalise_replaces_every_number_in_a_message() {
    assert_eq!(
        normalise("a Workers (7308): BUY: Can't afford item costing 50 at 3 silver each."),
        (
            "BUY".to_string(),
            "Can't afford item costing N at N silver each.".to_string()
        )
    );
}
