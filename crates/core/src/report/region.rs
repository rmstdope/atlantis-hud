//! Parses region blocks: the header, the economy lines, the exits, the structures and the units.
//!
//! ```text
//! mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants (hill dwarves), $33983.
//! ------------------------------------------------------------
//!   Wages: $24.1 (Max: $6796).
//!   Wanted: 138 grain [GRAI] at $24, 118 livestock [LIVE] at $23.
//!   Products: 57 grain [GRAI], 37 iron [IRON].
//!
//! Exits:
//!   North : mountain (7,51) in Inhead.
//!
//! - Unit (5812), Wanderers (83), avoiding, behind, hill dwarf [HDWA].
//!
//! + Cartographers HQ [1] : Fort.
//!   - Eastern Watch (14353), on guard, Elder Tree Forests (32), 120 hill dwarves [HDWA].
//! ```

use super::model::{Exit, ItemAmount, MarketItem, ReportRegion, Structure};
use super::scan::{
    is_none_list, parse_coordinate, parse_item_amount, parse_market_item, parse_money,
    parse_settlement, split_top_level,
};
use super::unit::parse_unit;
use super::unwrap::LogicalLine;

/// The six directions a region prints in its `Exits` block.
const DIRECTIONS: &[&str] = &[
    "North",
    "Northeast",
    "Southeast",
    "South",
    "Southwest",
    "Northwest",
];

/// Reads a region header, returning the region with its location fields filled in.
///
/// Everything after the province is optional: an ocean prints nothing else, while a settled land
/// hex prints a settlement, a peasant count and a tax figure.
#[must_use]
pub fn parse_region_header(body: &str) -> Option<ReportRegion> {
    let fields = split_top_level(body.trim().trim_end_matches('.'), ',');
    let head = fields.first()?;

    // `mountain (7,53) in Inhead`
    let open = head.find('(')?;
    let close = head.find(')')?;
    if close < open {
        return None;
    }

    let terrain = head[..open].trim().to_string();
    if terrain.is_empty() {
        return None;
    }
    let coordinate = parse_coordinate(&head[open..=close])?;
    let province = head[close + 1..]
        .trim()
        .strip_prefix("in ")?
        .trim()
        .to_string();

    let mut region = ReportRegion {
        region_id: coordinate.id(),
        coordinate,
        terrain,
        province,
        settlement: None,
        population: None,
        race: None,
        tax_base: None,
        wages: None,
        max_wages: None,
        entertainment: None,
        products: Vec::new(),
        wanted: Vec::new(),
        for_sale: Vec::new(),
        exits: Vec::new(),
        structures: Vec::new(),
        units: Vec::new(),
    };

    for field in fields.iter().skip(1) {
        if let Some(settlement) = parse_settlement(field) {
            region.settlement = Some(settlement);
        } else if let Some((count, race)) = parse_peasants(field) {
            region.population = Some(count);
            region.race = race;
        } else if field.trim_start().starts_with('$') {
            region.tax_base = parse_money(field);
        }
    }

    Some(region)
}

/// Reads `12051 peasants (hill dwarves)`, where the race may be absent.
fn parse_peasants(field: &str) -> Option<(i64, Option<String>)> {
    let text = field.trim();
    let (count_text, rest) = text.split_once(' ')?;
    if !rest.trim_start().starts_with("peasants") {
        return None;
    }

    let count = count_text.replace(',', "").parse::<i64>().ok()?;
    let race = rest
        .find('(')
        .zip(rest.rfind(')'))
        .filter(|(open, close)| close > open)
        .map(|(open, close)| rest[open + 1..close].trim().to_string());

    Some((count, race))
}

/// Reads one line of an `Exits` block, such as `North : ocean (8,52) in Atlantis Ocean.`
#[must_use]
pub fn parse_exit(body: &str) -> Option<Exit> {
    let (direction, rest) = body.split_once(':')?;
    let direction = direction.trim();
    if !DIRECTIONS.iter().any(|known| known == &direction) {
        return None;
    }

    let target = parse_region_header(rest.trim())?;
    Some(Exit {
        direction: direction.to_string(),
        terrain: target.terrain,
        coordinate: target.coordinate,
        province: target.province,
        settlement: target.settlement,
    })
}

/// Reads a structure line, such as `+ Building [21] : Magical Citadel, needs 560.`
///
/// A description may follow the kind after a semicolon.
#[must_use]
pub fn parse_structure(body: &str) -> Option<Structure> {
    let text = body.strip_prefix("+ ").unwrap_or(body).trim();
    let (name_part, rest) = text.split_once(" : ")?;

    let open = name_part.rfind('[')?;
    let close = name_part.rfind(']')?;
    if close < open {
        return None;
    }

    let structure_id = name_part[open + 1..close].to_string();
    let name = name_part[..open].trim().to_string();

    let (kind_part, description) = match rest.split_once(';') {
        Some((kind, description)) => (kind.trim(), Some(description.trim().to_string())),
        None => (rest.trim(), None),
    };

    let kind_text = kind_part.trim_end_matches('.');
    let (kind, needs) = match kind_text.split_once(", needs ") {
        Some((kind, needs)) => (kind.trim(), needs.trim().parse::<i64>().ok()),
        None => (kind_text, None),
    };

    Some(Structure {
        structure_id,
        name,
        kind: kind.to_string(),
        description,
        needs,
    })
}

/// Applies one indented economy line to a region.
fn apply_economy_line(region: &mut ReportRegion, body: &str) {
    let Some((label, value)) = body.split_once(':') else {
        return;
    };
    let value = value.trim();

    match label.trim() {
        "Wages" => {
            // `$24.1 (Max: $6796)` — the wage itself is kept verbatim because it is fractional.
            let wage = value.split('(').next().unwrap_or(value).trim();
            region.wages = Some(wage.trim_end_matches('.').to_string());
            // The figure arrives as `$6796).`, so both the closing paren and the full stop go.
            region.max_wages = value
                .split_once("Max:")
                .and_then(|(_, max)| parse_money(max.trim().trim_end_matches(['.', ')'])));
        }
        "Wanted" => region.wanted = parse_market_list(value),
        "For Sale" => region.for_sale = parse_market_list(value),
        "Entertainment available" => region.entertainment = parse_money(value),
        "Products" => region.products = parse_product_list(value),
        _ => {}
    }
}

fn parse_market_list(value: &str) -> Vec<MarketItem> {
    if is_none_list(value) {
        return Vec::new();
    }
    split_top_level(value.trim_end_matches('.'), ',')
        .iter()
        .filter_map(|entry| parse_market_item(entry))
        .collect()
}

fn parse_product_list(value: &str) -> Vec<ItemAmount> {
    if is_none_list(value) {
        return Vec::new();
    }
    split_top_level(value.trim_end_matches('.'), ',')
        .iter()
        .filter_map(|entry| parse_item_amount(entry))
        .collect()
}

/// Assembles one region from its header line and the lines that follow it.
///
/// Units nested under a structure keep that structure's identifier, which is what lets the unit
/// table present the region as the flattened tree it really is.
#[must_use]
pub fn parse_region_block(header: &LogicalLine, rest: &[LogicalLine]) -> Option<ReportRegion> {
    let mut region = parse_region_header(header.body())?;
    let region_id = region.region_id.clone();
    let mut current_structure: Option<String> = None;
    let mut in_exits = false;

    for line in rest {
        let body = line.body();

        if body.starts_with("---") {
            continue;
        }

        if body.trim_end_matches(':') == "Exits" {
            in_exits = true;
            continue;
        }

        match line.marker() {
            Some('+') => {
                if let Some(structure) = parse_structure(body) {
                    current_structure = Some(structure.structure_id.clone());
                    region.structures.push(structure);
                }
                in_exits = false;
                continue;
            }
            Some(marker @ ('*' | '-')) => {
                // A unit at the outer indent has left any structure behind.
                if line.indent == 0 {
                    current_structure = None;
                }
                if let Some(unit) = parse_unit(
                    body,
                    marker == '*',
                    &region_id,
                    current_structure.as_deref(),
                ) {
                    region.units.push(unit);
                }
                in_exits = false;
                continue;
            }
            _ => {}
        }

        if in_exits {
            if let Some(exit) = parse_exit(body) {
                region.exits.push(exit);
                continue;
            }
            in_exits = false;
        }

        apply_economy_line(&mut region, body);
    }

    Some(region)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::unwrap::unwrap_lines;

    #[test]
    fn reads_a_settled_region_header() {
        let region = parse_region_header(
            "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants (hill dwarves), $33983.",
        )
        .expect("header should parse");

        assert_eq!(region.terrain, "mountain");
        assert_eq!(region.coordinate.x, 7);
        assert_eq!(region.coordinate.y, 53);
        assert_eq!(region.coordinate.z, 1);
        assert_eq!(region.province, "Inhead");
        assert_eq!(
            region.settlement.as_ref().map(|s| s.name.as_str()),
            Some("Inholm")
        );
        assert_eq!(
            region.settlement.as_ref().map(|s| s.size.as_str()),
            Some("city")
        );
        assert_eq!(region.population, Some(12051));
        assert_eq!(region.race.as_deref(), Some("hill dwarves"));
        assert_eq!(region.tax_base, Some(33983));
        assert_eq!(region.region_id, "1:7,53");
    }

    #[test]
    fn reads_an_empty_ocean_header() {
        let region =
            parse_region_header("ocean (26,52) in Atlantis Ocean.").expect("header should parse");

        assert_eq!(region.terrain, "ocean");
        assert_eq!(region.province, "Atlantis Ocean");
        assert_eq!(region.settlement, None);
        assert_eq!(region.population, None);
    }

    #[test]
    fn reads_an_underworld_coordinate() {
        let region =
            parse_region_header("cavern (7,53,underworld) in Deeps.").expect("header should parse");
        assert_eq!(region.coordinate.z, 2);
        assert_eq!(region.region_id, "2:7,53");
    }

    #[test]
    fn reads_the_nexus_onto_its_own_level() {
        let region =
            parse_region_header("nexus (0,0,nexus) in The Void.").expect("header should parse");
        assert_eq!(region.coordinate.z, 0);
        assert_eq!(region.region_id, "0:0,0");
        assert_eq!(region.terrain, "nexus");
        assert_eq!(region.province, "The Void");
    }

    #[test]
    fn reads_a_structure_with_a_remaining_build_cost() {
        let structure =
            parse_structure("+ Building [21] : Magical Citadel, needs 560.").expect("structure");

        assert_eq!(structure.structure_id, "21");
        assert_eq!(structure.name, "Building");
        assert_eq!(structure.kind, "Magical Citadel");
        assert_eq!(structure.needs, Some(560));
    }

    #[test]
    fn reads_a_structure_description_after_the_semicolon() {
        let structure = parse_structure(
            "+ Ent Trade Emporium [2] : Caravanserai; A collection of tents and camel corrals.",
        )
        .expect("structure");

        assert_eq!(structure.kind, "Caravanserai");
        assert!(structure
            .description
            .as_deref()
            .is_some_and(|d| d.contains("camel corrals")));
        assert_eq!(structure.needs, None);
    }

    #[test]
    fn reads_an_exit() {
        let exit = parse_exit("North : ocean (8,52) in Atlantis Ocean.").expect("exit");
        assert_eq!(exit.direction, "North");
        assert_eq!(exit.terrain, "ocean");
        assert_eq!(exit.coordinate.x, 8);
    }

    #[test]
    fn assembles_a_whole_region_block() {
        let source = concat!(
            "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants (hill dwarves), $33983.\n",
            "------------------------------------------------------------\n",
            "  Wages: $24.1 (Max: $6796).\n",
            "  Wanted: 138 grain [GRAI] at $24, 118 livestock [LIVE] at $23.\n",
            "  For Sale: 482 hill dwarves [HDWA] at $77.\n",
            "  Entertainment available: $2500.\n",
            "  Products: 57 grain [GRAI], 37 iron [IRON], 17 stone [STON].\n",
            "\n",
            "Exits:\n",
            "  North : mountain (7,51) in Inhead.\n",
            "  Northeast : ocean (8,52) in Atlantis Ocean.\n",
            "\n",
            "- Unit (5812), Wanderers (83), avoiding, behind, hill dwarf [HDWA].\n",
            "* Seven of Eight (18642), Borg TNG (95), avoiding, behind, leader [LEAD].\n",
            "\n",
            "+ Cartographers HQ [1] : Fort.\n",
            "  - Eastern Watch (14353), on guard, Elder Tree Forests (32), 120 hill dwarves [HDWA].\n",
        );

        let lines = unwrap_lines(source);
        let region = parse_region_block(&lines[0], &lines[1..]).expect("region should parse");

        assert_eq!(region.wages.as_deref(), Some("$24.1"));
        assert_eq!(region.max_wages, Some(6796));
        assert_eq!(region.entertainment, Some(2500));
        assert_eq!(region.wanted.len(), 2);
        assert_eq!(region.for_sale.len(), 1);
        assert_eq!(region.products.len(), 3);
        assert_eq!(region.exits.len(), 2);
        assert_eq!(region.structures.len(), 1);
        assert_eq!(region.units.len(), 3);

        let own: Vec<&str> = region
            .units
            .iter()
            .filter(|unit| unit.own)
            .map(|unit| unit.unit_id.as_str())
            .collect();
        assert_eq!(own, vec!["18642"]);

        let nested = region
            .units
            .iter()
            .find(|unit| unit.unit_id == "14353")
            .expect("nested unit");
        assert_eq!(nested.structure_id.as_deref(), Some("1"));

        // The units before the structure are not attributed to it.
        let outer = region
            .units
            .iter()
            .find(|unit| unit.unit_id == "5812")
            .expect("outer unit");
        assert_eq!(outer.structure_id, None);
    }
}
