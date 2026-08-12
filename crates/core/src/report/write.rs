//! Writes a region back out in the shape a turn report prints it.
//!
//! The inverse of [`super::region`], function for function, and the reason the export is worth
//! having at all: a file an ally can drop into their own client is worth more than a pretty
//! listing nobody can read back. Every line written here is a line [`super::region`] parses, and
//! the test that matters is the round trip.
//!
//! Wrapping is part of that contract rather than cosmetic. [`super::unwrap`] rejoins a fragment
//! when its first word could not have fitted on the line before, so filling greedily to the same
//! column is exactly what makes the output readable again.

use super::model::{Exit, ItemAmount, MarketItem, ReportRegion, ReportUnit, Settlement, Structure};
use super::unwrap::WRAP_COLUMN;

/// Resources every faction sees without a skill.
///
/// The ruleset says nothing about which resources are advanced, so the distinction lives here as a
/// short list of the ordinary ones. Anything unlisted counts as advanced and is withheld when the
/// player asks for that, which is the safe direction to be wrong in: a resource we have not heard
/// of is kept back rather than shared by accident.
const BASIC_PRODUCTS: &[&str] = &[
    "GRAI", "LIVE", "WOOD", "HERB", "FISH", "IRON", "STON", "FUR", "HORS",
];

/// What the player chose to put in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportContent {
    pub structures: bool,
    pub units: bool,
    pub advanced_resources: bool,
}

impl Default for ExportContent {
    /// Everything, which is what a player sharing a map with an ally usually means.
    fn default() -> Self {
        Self {
            structures: true,
            units: true,
            advanced_resources: true,
        }
    }
}

/// Writes one region block, ending with a blank line.
#[must_use]
pub fn write_region(region: &ReportRegion, content: &ExportContent) -> String {
    let mut block = Block::default();

    block.line(&region_header(region), 0);
    block.line(&"-".repeat(60), 0);
    for line in economy_lines(region, content) {
        block.line(&line, 2);
    }

    if !region.exits.is_empty() {
        block.blank();
        block.line("Exits:", 0);
        for exit in &region.exits {
            block.line(&exit_line(exit), 2);
        }
    }

    // A unit is written under a structure only where that structure is itself being written and
    // is actually in this region. A structure the player kept back cannot hold anybody, so its
    // units move outdoors rather than disappearing - the buildings are the secret, not the people
    // standing in them - and so does a unit whose structure the region does not name, which a
    // merged sighting could otherwise lose without a trace.
    let housed = |unit: &&ReportUnit| {
        content.structures
            && unit.structure_id.as_deref().is_some_and(|inside| {
                region
                    .structures
                    .iter()
                    .any(|structure| structure.structure_id == inside)
            })
    };

    if content.units {
        let mut outdoors = region.units.iter().filter(|unit| !housed(unit)).peekable();
        if outdoors.peek().is_some() {
            block.blank();
            for unit in outdoors {
                block.line(&unit_line(unit), 0);
            }
        }
    }

    if content.structures {
        for structure in &region.structures {
            block.blank();
            block.line(&structure_line(structure), 0);
            if content.units {
                for unit in region
                    .units
                    .iter()
                    .filter(|unit| unit.structure_id.as_deref() == Some(&structure.structure_id))
                {
                    block.line(&unit_line(unit), 2);
                }
            }
        }
    }

    block.blank();
    block.text
}

/// The region's opening line, as in `mountain (7,53) in Inhead, 12051 peasants (hill dwarves).`
fn region_header(region: &ReportRegion) -> String {
    let mut line = format!(
        "{} {} in {}",
        region.terrain,
        coordinate(region.coordinate),
        region.province
    );

    if let Some(settlement) = &region.settlement {
        line.push_str(&settlement_phrase(settlement));
    }
    if let Some(population) = region.population {
        line.push_str(&format!(", {population} peasants"));
        if let Some(race) = &region.race {
            line.push_str(&format!(" ({race})"));
        }
    }
    if let Some(tax_base) = region.tax_base {
        line.push_str(&format!(", ${tax_base}"));
    }

    line.push('.');
    line
}

/// `(7,53)` on the surface, `(7,53,2)` anywhere else - the form the parser reads back.
fn coordinate(coordinate: super::model::Coordinate) -> String {
    if coordinate.z == 1 {
        format!("({},{})", coordinate.x, coordinate.y)
    } else {
        format!("({},{},{})", coordinate.x, coordinate.y, coordinate.z)
    }
}

fn settlement_phrase(settlement: &Settlement) -> String {
    format!(", contains {} [{}]", settlement.name, settlement.size)
}

/// The indented economy block, in the order the game prints it.
///
/// `Wanted`, `For Sale` and `Products` are always written, `none` where they are empty, because
/// that is what a report does and an absent line and an empty one mean the same thing to the
/// parser. `Wages` and `Entertainment` are written only where the region has them: a hex nobody
/// has stood in knows neither.
fn economy_lines(region: &ReportRegion, content: &ExportContent) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(wages) = &region.wages {
        lines.push(match region.max_wages {
            Some(max) => format!("Wages: {wages} (Max: ${max})."),
            None => format!("Wages: {wages}."),
        });
    }
    lines.push(format!("Wanted: {}.", market_list(&region.wanted)));
    lines.push(format!("For Sale: {}.", market_list(&region.for_sale)));
    if let Some(entertainment) = region.entertainment {
        lines.push(format!("Entertainment available: ${entertainment}."));
    }
    lines.push(format!(
        "Products: {}.",
        item_list(&shared_products(region, content))
    ));

    lines
}

/// The products the player agreed to share.
fn shared_products(region: &ReportRegion, content: &ExportContent) -> Vec<ItemAmount> {
    region
        .products
        .iter()
        .filter(|product| content.advanced_resources || is_basic(&product.tag))
        .cloned()
        .collect()
}

fn is_basic(tag: &str) -> bool {
    BASIC_PRODUCTS.contains(&tag)
}

fn item_list(items: &[ItemAmount]) -> String {
    if items.is_empty() {
        return "none".to_string();
    }
    items
        .iter()
        .map(|item| format!("{} {} [{}]", item.amount, item.name, item.tag))
        .collect::<Vec<_>>()
        .join(", ")
}

fn market_list(items: &[MarketItem]) -> String {
    if items.is_empty() {
        return "none".to_string();
    }
    items
        .iter()
        .map(|item| {
            format!(
                "{} {} [{}] at ${}",
                item.amount, item.name, item.tag, item.price
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn exit_line(exit: &Exit) -> String {
    let mut line = format!(
        "{} : {} {} in {}",
        exit.direction,
        exit.terrain,
        coordinate(exit.coordinate),
        exit.province
    );
    if let Some(settlement) = &exit.settlement {
        line.push_str(&settlement_phrase(settlement));
    }
    line.push('.');
    line
}

fn structure_line(structure: &Structure) -> String {
    let mut line = format!(
        "+ {} [{}] : {}",
        structure.name, structure.structure_id, structure.kind
    );
    if let Some(needs) = structure.needs {
        line.push_str(&format!(", needs {needs}"));
    }
    match &structure.description {
        // The description keeps whatever punctuation it arrived with, so nothing is added here.
        Some(description) => line.push_str(&format!("; {description}")),
        None => line.push('.'),
    }
    line
}

/// One unit line: the head sentence, then the labelled sections the parser splits on.
fn unit_line(unit: &ReportUnit) -> String {
    let mut head = format!(
        "{} {} ({})",
        if unit.own { "*" } else { "-" },
        unit.name,
        unit.unit_id
    );

    if let (Some(name), Some(id)) = (&unit.faction_name, &unit.faction_id) {
        head.push_str(&format!(", {name} ({id})"));
    }
    for flag in &unit.flags {
        head.push_str(&format!(", {flag}"));
    }
    for item in &unit.items {
        head.push_str(&format!(", {} {} [{}]", item.amount, item.name, item.tag));
    }
    head.push('.');

    if let Some(weight) = unit.weight {
        head.push_str(&format!(" Weight: {weight}."));
    }
    if let Some(capacity) = &unit.capacity {
        head.push_str(&format!(" Capacity: {capacity}."));
    }
    if !unit.skills.is_empty() {
        let skills = unit
            .skills
            .iter()
            .map(|skill| {
                format!(
                    "{} [{}] {} ({})",
                    skill.name, skill.tag, skill.level, skill.points
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        head.push_str(&format!(" Skills: {skills}."));
    }

    head
}

/// A region block under construction, which knows when its own layout would mislead the reader.
///
/// [`super::unwrap`] joins a deeper-indented line to the one above when the first word could not
/// have fitted up there. That is right for a wrapped report and wrong for two lines that were
/// always separate, so where the rule would misfire a blank line goes in: a paragraph break stops
/// the join, and costs the file one empty line.
#[derive(Default)]
struct Block {
    text: String,
    /// Indent of the last logical line, and the width of the last physical line written for it.
    last_indent: usize,
    last_width: usize,
    open: bool,
}

impl Block {
    fn line(&mut self, body: &str, indent: usize) {
        if self.would_be_read_as_a_continuation(body, indent) {
            self.blank();
        }

        let wrapped = wrap_line(body, indent);
        self.last_width = wrapped.lines().last().map_or(0, str::len);
        self.last_indent = indent;
        self.open = true;
        self.text.push_str(&wrapped);
        self.text.push('\n');
    }

    fn blank(&mut self) {
        if !self.text.is_empty() && !self.text.ends_with("\n\n") {
            self.text.push('\n');
        }
        self.open = false;
    }

    fn would_be_read_as_a_continuation(&self, body: &str, indent: usize) -> bool {
        self.open
            && indent > self.last_indent
            && super::unwrap::marker_of(body).is_none()
            && self.last_width + 1 + super::unwrap::first_word_len(body) > WRAP_COLUMN
    }
}

/// Fills a line greedily to the report's wrap column, indenting continuations two columns further.
///
/// Greedy is not an implementation detail: breaking exactly where the next word stops fitting is
/// what makes [`super::unwrap`]'s test - could this word have fitted above? - answer no, and so
/// what lets the file be read back.
#[must_use]
fn wrap_line(body: &str, indent: usize) -> String {
    let mut words = words_of(body);
    let continuation = " ".repeat(indent + 2);
    let mut out = String::new();
    let mut line = format!(
        "{}{}",
        " ".repeat(indent),
        if words.is_empty() {
            ""
        } else {
            words.remove(0).text
        }
    );

    for word in words {
        let fits = line.len() + word.spaces_before + word.text.len() <= WRAP_COLUMN;
        // Two reasons to keep a word on an over-long line rather than break before it. A fragment
        // opening with a bare `-`, `*` or `+` would read as a unit or a structure of its own; and a
        // break swallows the gap it replaces, so breaking at a double space would quietly turn it
        // into a single one. Both are rare, and an over-long line still reads back correctly.
        let unbreakable = matches!(word.text, "-" | "*" | "+") || word.spaces_before != 1;
        if fits || unbreakable {
            line.push_str(&" ".repeat(word.spaces_before));
            line.push_str(word.text);
            continue;
        }

        out.push_str(&line);
        out.push('\n');
        line = format!("{continuation}{}", word.text);
    }

    out.push_str(&line);
    out
}

/// A word and the gap that precedes it.
///
/// The gap is carried rather than normalised because a report's own text may contain double
/// spaces - one structure description in the fixture does - and a writer that tidied them would
/// hand back something other than what it was given.
struct Word<'a> {
    text: &'a str,
    spaces_before: usize,
}

fn words_of(body: &str) -> Vec<Word<'_>> {
    let mut words = Vec::new();
    let mut spaces_before = 0usize;

    for piece in body.split_inclusive(' ') {
        let text = piece.trim_end_matches(' ');
        let trailing = piece.len() - text.len();
        if text.is_empty() {
            spaces_before += trailing;
            continue;
        }
        words.push(Word {
            text,
            spaces_before,
        });
        spaces_before = trailing;
    }

    words
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::region::parse_region_block;
    use crate::report::unwrap::unwrap_lines;

    const SETTLED: &str = concat!(
        "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants (hill dwarves), $33983.\n",
        "------------------------------------------------------------\n",
        "  Wages: $24.1 (Max: $6796).\n",
        "  Wanted: 138 grain [GRAI] at $24, 118 livestock [LIVE] at $23.\n",
        "  For Sale: 482 hill dwarves [HDWA] at $77.\n",
        "  Entertainment available: $2500.\n",
        "  Products: 57 grain [GRAI], 37 iron [IRON], 4 ironwood [IRWD].\n",
        "\n",
        "Exits:\n",
        "  North : mountain (7,51) in Inhead.\n",
        "  Northeast : ocean (8,52) in Atlantis Ocean.\n",
        "\n",
        "- Unit (5812), Wanderers (83), avoiding, behind, hill dwarf [HDWA].\n",
        "* Seven of Eight (18642), Borg TNG (95), behind, 20 leaders [LEAD], 159 silver [SILV]. Weight: 260. Capacity: 0/0/300/0. Skills: observation [OBSE] 1 (35), combat [COMB] 3 (180).\n",
        "\n",
        "+ Cartographers HQ [1] : Fort.\n",
        "  - Eastern Watch (14353), on guard, Elder Tree Forests (32), 120 hill dwarves [HDWA].\n",
    );

    const OCEAN: &str = concat!(
        "ocean (19,39) in Atlantis Ocean.\n",
        "------------------------------------------------------------\n",
        "  Wages: $0.\n",
        "  Wanted: none.\n",
        "  For Sale: none.\n",
        "  Products: 44 fish [FISH].\n",
        "\n",
        "Exits:\n",
        "  North : ocean (19,37) in Atlantis Ocean.\n",
        "  South : swamp (19,41) in Bloockprant.\n",
    );

    fn region_of(source: &str) -> ReportRegion {
        let lines = unwrap_lines(source);
        parse_region_block(&lines[0], &lines[1..]).expect("fixture should parse")
    }

    /// Writes a region and reads it back, which is the whole contract of this module.
    fn round_trip(region: &ReportRegion, content: &ExportContent) -> ReportRegion {
        region_of(&write_region(region, content))
    }

    #[test]
    fn round_trips_a_settled_region() {
        let region = region_of(SETTLED);
        assert_eq!(round_trip(&region, &ExportContent::default()), region);
    }

    #[test]
    fn round_trips_a_region_with_nothing_but_terrain_and_exits() {
        let region = region_of(OCEAN);
        assert_eq!(round_trip(&region, &ExportContent::default()), region);
    }

    /**
     * A merged sighting can name a structure the region does not carry - the ally's report saw the
     * unit and not the building it stood in. Written outdoors rather than dropped: a unit that
     * vanished from the file would be an army the recipient never learns about.
     */
    #[test]
    fn writes_a_unit_whose_structure_the_region_does_not_name() {
        let mut region = region_of(SETTLED);
        region.structures.clear();

        let written = round_trip(&region, &ExportContent::default());
        assert!(written.units.iter().any(|unit| unit.unit_id == "14353"));
        assert_eq!(written.units.len(), region.units.len());
    }

    #[test]
    fn round_trips_an_underworld_coordinate() {
        let mut region = region_of(OCEAN);
        region.coordinate.z = 2;
        region.region_id = region.coordinate.id();

        let written = round_trip(&region, &ExportContent::default());
        assert_eq!(written.coordinate.z, 2);
        assert_eq!(written, region);
    }

    #[test]
    fn withholds_structures_when_they_are_not_included() {
        let region = region_of(SETTLED);
        let content = ExportContent {
            structures: false,
            ..ExportContent::default()
        };

        let written = round_trip(&region, &content);
        assert!(written.structures.is_empty());
        // The unit that stood inside the structure is still there, at the outer indent.
        assert!(written.units.iter().any(|unit| unit.unit_id == "14353"));
        assert!(written.units.iter().all(|unit| unit.structure_id.is_none()));
    }

    #[test]
    fn withholds_units_when_they_are_not_included() {
        let region = region_of(SETTLED);
        let content = ExportContent {
            units: false,
            ..ExportContent::default()
        };

        let written = round_trip(&region, &content);
        assert!(written.units.is_empty());
        assert_eq!(
            written.structures.len(),
            1,
            "structures survive without units"
        );
    }

    #[test]
    fn withholds_advanced_products_but_keeps_the_ordinary_ones() {
        let region = region_of(SETTLED);
        let content = ExportContent {
            advanced_resources: false,
            ..ExportContent::default()
        };

        let tags: Vec<String> = round_trip(&region, &content)
            .products
            .into_iter()
            .map(|product| product.tag)
            .collect();
        assert_eq!(tags, vec!["GRAI", "IRON"], "ironwood is advanced");
    }

    #[test]
    fn keeps_advanced_products_when_they_are_included() {
        let region = region_of(SETTLED);
        let tags: Vec<String> = round_trip(&region, &ExportContent::default())
            .products
            .into_iter()
            .map(|product| product.tag)
            .collect();
        assert_eq!(tags, vec!["GRAI", "IRON", "IRWD"]);
    }

    #[test]
    fn wraps_at_the_column_the_unwrapper_rejoins_from() {
        let region = region_of(SETTLED);
        let written = write_region(&region, &ExportContent::default());

        assert!(
            written
                .lines()
                .any(|line| line.len() > WRAP_COLUMN - 20 && line.len() <= WRAP_COLUMN),
            "the long unit line should have been filled, not left short:\n{written}"
        );
        assert!(
            written.lines().all(|line| line.len() <= WRAP_COLUMN),
            "no line may exceed the report's wrap column:\n{written}"
        );
    }

    #[test]
    fn a_wrapped_line_reads_back_as_one_logical_line() {
        let long = concat!(
            "* Drones (14451), Borg TNG (95), avoiding, behind, sharing, swimming battle spoils, ",
            "50 lizardmen [LIZA], 7500 silver [SILV]. Weight: 500. Capacity: 0/0/750/750. ",
            "Skills: observation [OBSE] 2 (90), stealth [STEA] 2 (90)."
        );

        let wrapped = wrap_line(long, 0);
        assert!(wrapped.contains('\n'), "the fixture is long enough to wrap");

        let lines = unwrap_lines(&wrapped);
        assert_eq!(lines.len(), 1, "rejoined into one line: {wrapped}");
        assert_eq!(lines[0].text, long);
    }

    #[test]
    fn wraps_an_indented_line_deeper_than_its_own_indent() {
        let long = format!(
            "- Eastern Watch (14353), on guard, {}",
            "Elder Tree Forests (32), 120 hill dwarves [HDWA], 40 mithril swords [MSWO]."
        );
        let wrapped = wrap_line(&long, 2);

        let mut physical = wrapped.lines();
        assert!(physical.next().map(str::len).unwrap_or(0) <= WRAP_COLUMN);
        for continuation in physical {
            assert!(
                continuation.starts_with("    "),
                "continuations sit two columns inside their own line: {continuation}"
            );
        }
        assert_eq!(unwrap_lines(&wrapped).len(), 1);
    }
}
