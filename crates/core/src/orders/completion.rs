//! What may stand where the caret is, for the orders editor's completion popup.
//!
//! `grammar.rs` keeps the walk over the order table - it is about the grammar, and belongs beside
//! it. This module is about everything else a position can offer: the item catalogue, a hex's own
//! market and products, and the skill list, none of which the grammar table knows anything about.
//!
//! **The hex decides.** `BUY` offers what this hex has for sale, `SELL` what its market wants,
//! `PRODUCE` what can be produced here - by the ground or by this unit's own skills - `GIVE` what
//! this unit is actually carrying, and everything else the whole catalogue. See the module's test table for exactly what each
//! situation answers.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::grammar::{self, arguments_at_caret, caret_at, Arg, CaretShape, Order};
use super::lexer::utf16_column;
use crate::movement::rules::Ruleset;
use crate::report::model::{ItemAmount, MarketItem, ReportRegion, ReportUnit};
use crate::report::ParsedReport;

/// One entry in the orders editor's completion popup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderCompletion {
    /// What is written into the line when the entry is accepted, and the first thing the typed
    /// word is matched against. Always the canonical spelling: a keyword, or an item or skill tag.
    pub value: String,
    /// The other thing the typed word may match: an item's or skill's name, so `cross` finds
    /// `XBOW`. Empty for a keyword, which has no second name.
    pub name: String,
    /// What the entry shows beside its value. Empty for a keyword, which is its own explanation.
    pub detail: String,
}

impl OrderCompletion {
    fn keyword(value: &str) -> Self {
        Self {
            value: value.to_string(),
            name: String::new(),
            detail: String::new(),
        }
    }
}

/// Which position the caret is in, decided once, in the core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaretPosition {
    /// The first word of the line, behind any indentation and an optional `@`. The shell's own
    /// command and snippet lists answer here; `options` below is empty.
    Command,
    /// Any position after the command, where the grammar, the catalogue and the hex decide.
    Argument,
    /// Nowhere a completion belongs: inside a comment, inside an unterminated quote, or after a
    /// command the grammar table does not have.
    Nowhere,
}

/// Where the caret is in one order line, what word is being typed there, and what may stand there.
///
/// One call, because the three answers come from one lexing of the line and the shell needs all
/// three for every keystroke. Splitting them is what left the caret's position decided in three
/// places and two of them disagreeing about what a word is (ah-vfq).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaretCompletions {
    pub position: CaretPosition,
    /// Where the word being typed starts, counted in **UTF-16 code units** from the start of the
    /// line - the same counting the checker's spans use (`lexer.rs`) and the same unit
    /// CodeMirror's own document offsets are in, so a shell adds it to `line.from` directly.
    /// Equal to the caret's own column when no word is being typed - the caret sits after
    /// whitespace or a closing quote - which is where a chosen entry is then written.
    pub word_start: usize,
    /// The word being typed, verbatim from the line. Empty when none is.
    pub word: String,
    /// What may stand here. Empty unless `position` is `Argument`.
    pub options: Vec<OrderCompletion>,
}

/// The caret's whole story for one order line up to the caret. See [`CaretCompletions`].
///
/// The one reader of where the caret is: every completion source in every shell asks this rather
/// than deciding for itself, which is what keeps a boundary case fixed once fixed everywhere.
#[must_use]
pub fn completions_at_caret(
    line_prefix: &str,
    ruleset: Option<&Ruleset>,
    report: Option<&ParsedReport>,
    unit_id: Option<&str>,
) -> CaretCompletions {
    let caret = caret_at(line_prefix);
    let (word_start, word) = match caret.word {
        Some(token) => (token.column_start, token.text),
        None => (utf16_column(line_prefix, line_prefix.len()), String::new()),
    };

    let (position, options) = match caret.shape {
        CaretShape::Nowhere => (CaretPosition::Nowhere, Vec::new()),
        CaretShape::Command => (CaretPosition::Command, Vec::new()),
        // The line is lexed once for the whole answer: `caret_at` already found the order and the
        // arguments that may stand here, so what is left is turning them into entries.
        CaretShape::InOrder(order, args) => (
            CaretPosition::Argument,
            completions_for(order, args, ruleset, report, unit_id),
        ),
    };

    CaretCompletions {
        position,
        word_start,
        word,
        options,
    }
}

/// What may stand where the caret is, from the grammar, the catalogue and the hex.
///
/// `ruleset` and `report` are optional because the answer is useful without either: the grammar's
/// own keywords need neither, a market needs only the report, and only the catalogue needs the
/// ruleset. `unit_id` is whose block is being typed, which is what makes "this hex" and "this
/// unit's skills" answerable; without it the hex-narrowed positions fall back to the catalogue.
#[must_use]
pub fn order_argument_completions(
    line_prefix: &str,
    ruleset: Option<&Ruleset>,
    report: Option<&ParsedReport>,
    unit_id: Option<&str>,
) -> Vec<OrderCompletion> {
    let Some((order, args)) = arguments_at_caret(line_prefix) else {
        return Vec::new();
    };
    completions_for(order, args, ruleset, report, unit_id)
}

/// The entries for one already-known position: the order the caret is inside and the arguments the
/// grammar allows there. Split out so `completions_at_caret` can answer from the one lexing it has
/// already done rather than starting the line again (ah-vfq).
fn completions_for(
    order: &'static Order,
    args: Vec<&'static Arg>,
    ruleset: Option<&Ruleset>,
    report: Option<&ParsedReport>,
    unit_id: Option<&str>,
) -> Vec<OrderCompletion> {
    // The three families answer in a fixed order regardless of which form of the order found
    // them: keywords first, then the item catalogue, then skills. That is what puts the 22 item
    // classes before the items at `GIVE 4573 ALL ` even though the EXCEPT form (which offers the
    // item) is earlier in the grammar table than the ALL-class form.
    let mut keywords: Vec<OrderCompletion> = Vec::new();
    let mut items: Vec<OrderCompletion> = Vec::new();
    let mut skills: Vec<OrderCompletion> = Vec::new();

    for arg in args {
        match arg {
            Arg::Kw(_) | Arg::OneOf(_) | Arg::ItemClass | Arg::MoveStep => {
                for word in grammar::keywords(arg) {
                    if !keywords.iter().any(|entry| entry.value == word) {
                        keywords.push(OrderCompletion::keyword(word));
                    }
                }
            }
            Arg::Item if items.is_empty() => {
                items = item_completions(order, ruleset, report, unit_id);
            }
            Arg::Skill if skills.is_empty() => {
                skills = ruleset.map(skill_completions).unwrap_or_default();
            }
            _ => {}
        }
    }

    keywords.into_iter().chain(items).chain(skills).collect()
}

/// What an `Arg::Item` position offers, by the order it belongs to.
fn item_completions(
    order: &'static Order,
    ruleset: Option<&Ruleset>,
    report: Option<&ParsedReport>,
    unit_id: Option<&str>,
) -> Vec<OrderCompletion> {
    if matches!(order.name, "BUY" | "SELL" | "PRODUCE" | "GIVE") {
        if let Some((region, unit)) = located(report, unit_id) {
            return match order.name {
                "BUY" => market_completions(&region.for_sale, MarketSide::Sale),
                "SELL" => market_completions(&region.wanted, MarketSide::Wanted),
                "PRODUCE" => produce_completions(region, unit, ruleset),
                "GIVE" => holdings_completions(unit),
                _ => unreachable!("guarded by the outer match"),
            };
        }
        // No report, no unit id, or a unit the report does not carry: the hex cannot be found, so
        // there is nothing to narrow by and the catalogue stands in (Q9).
    }

    ruleset.map(catalogue_completions).unwrap_or_default()
}

/// The unit's own hex, and the unit itself - two lookups, since a unit carries its own region id.
fn located<'a>(
    report: Option<&'a ParsedReport>,
    unit_id: Option<&str>,
) -> Option<(&'a ReportRegion, &'a ReportUnit)> {
    let unit_id = unit_id?;
    let report = report?;
    let unit = report.units().find(|unit| unit.unit_id == unit_id)?;
    let region = report
        .regions
        .iter()
        .find(|region| region.region_id == unit.region_id)?;
    Some((region, unit))
}

/// Whether a market list is what the hex sells or what it wants - the two are worded differently.
enum MarketSide {
    Sale,
    Wanted,
}

/// A hex's `for_sale` or `wanted` list, alphabetical by tag. Empty stays empty: the report's own
/// silence is respected rather than papered over with the catalogue.
fn market_completions(items: &[MarketItem], side: MarketSide) -> Vec<OrderCompletion> {
    let mut sorted: Vec<&MarketItem> = items.iter().collect();
    sorted.sort_by(|a, b| a.tag.cmp(&b.tag));

    sorted
        .into_iter()
        .map(|item| OrderCompletion {
            value: item.tag.clone(),
            name: item.name.clone(),
            detail: match side {
                MarketSide::Sale => {
                    format!("{} · ${}, {} left", item.name, item.price, item.amount)
                }
                MarketSide::Wanted => {
                    format!("{} · ${}, wants {}", item.name, item.price, item.amount)
                }
            },
        })
        .collect()
}

/// What the unit is carrying, as a manifest: the tag to type, and the amount beside it.
///
/// Sorted by tag like `market_completions`, so two narrowed lists read the same way. Silver is an
/// item like any other here - a report writes it `150 silver [SILV]` - so it appears without a
/// special case, which is what stops the most-given thing in the game falling out of the list.
fn holdings_completions(unit: &ReportUnit) -> Vec<OrderCompletion> {
    let mut sorted: Vec<&ItemAmount> = unit.items.iter().collect();
    sorted.sort_by(|a, b| a.tag.cmp(&b.tag));

    sorted
        .into_iter()
        .map(|item| OrderCompletion {
            value: item.tag.clone(),
            name: item.name.clone(),
            detail: format!("{} · {} held", item.name, item.amount),
        })
        .collect()
}

/// `PRODUCE`'s two groups, in order: the ground's own products, then what this unit's skills can
/// make. Never the same tag twice, even where both groups would offer it.
fn produce_completions(
    region: &ReportRegion,
    unit: &ReportUnit,
    ruleset: Option<&Ruleset>,
) -> Vec<OrderCompletion> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut entries = Vec::new();

    let mut ground: Vec<&ItemAmount> = region.products.iter().collect();
    ground.sort_by(|a, b| a.tag.cmp(&b.tag));
    for product in ground {
        if !seen.insert(product.tag.clone()) {
            continue;
        }
        let name = ruleset
            .and_then(|ruleset| ruleset.items.get(&product.tag))
            .map_or_else(|| product.name.clone(), |entry| entry.name.clone());
        entries.push(OrderCompletion {
            value: product.tag.clone(),
            name: name.clone(),
            detail: format!("{name} · {} here", product.amount),
        });
    }

    // Ruleset-less rulesets carry no `produces` data (`ah-9na`'s field is `#[serde(default)]`),
    // so this half degrades to nothing rather than panicking or guessing.
    if let Some(ruleset) = ruleset {
        let mut made: Vec<(String, String, String)> = Vec::new();
        for skill in &unit.skills {
            let Some(entry) = ruleset.skills.get(&skill.tag) else {
                // A skill the ruleset does not know - skip rather than guess.
                continue;
            };
            for production in &entry.produces {
                if production.level > skill.level {
                    continue;
                }
                let Some(item) = ruleset.items.get(&production.tag) else {
                    continue;
                };
                made.push((
                    production.tag.clone(),
                    item.name.clone(),
                    entry.name.clone(),
                ));
            }
        }
        made.sort_by(|a, b| a.0.cmp(&b.0));
        for (tag, item_name, skill_name) in made {
            if !seen.insert(tag.clone()) {
                continue;
            }
            entries.push(OrderCompletion {
                value: tag,
                name: item_name.clone(),
                detail: format!("{item_name} · {skill_name}"),
            });
        }
    }

    entries
}

/// The whole item catalogue, tag order - `ruleset.items` is a `BTreeMap` keyed by tag, so this is
/// free.
fn catalogue_completions(ruleset: &Ruleset) -> Vec<OrderCompletion> {
    ruleset
        .items
        .values()
        .map(|item| OrderCompletion {
            value: item.tag.clone(),
            name: item.name.clone(),
            detail: item.name.clone(),
        })
        .collect()
}

/// Every skill in the ruleset, tag order, with its monthly cost where the data page prices one.
fn skill_completions(ruleset: &Ruleset) -> Vec<OrderCompletion> {
    ruleset
        .skills
        .values()
        .map(|skill| OrderCompletion {
            value: skill.tag.clone(),
            name: skill.name.clone(),
            detail: match skill.cost {
                Some(cost) => format!("{} · {cost} silver", skill.name),
                None => skill.name.clone(),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orders::grammar::ITEM_CLASSES;
    use crate::report::model::{Coordinate, Skill};

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
    }

    fn report(regions: Vec<ReportRegion>) -> ParsedReport {
        ParsedReport {
            regions,
            ..Default::default()
        }
    }

    fn kw(value: &str) -> OrderCompletion {
        OrderCompletion::keyword(value)
    }

    fn no_ruleset(prefix: &str) -> Vec<OrderCompletion> {
        order_argument_completions(prefix, None, None, None)
    }

    // --- moved from grammar.rs: the grammar answers did not change when the type did -----------

    #[test]
    fn name_offers_everything_it_may_rename() {
        assert_eq!(
            no_ruleset("NAME U"),
            vec![kw("UNIT"), kw("FACTION"), kw("OBJECT"), kw("CITY")]
        );
    }

    #[test]
    fn the_command_position_belongs_to_order_commands() {
        for prefix in ["", "NAM", "  "] {
            assert_eq!(no_ruleset(prefix), Vec::<OrderCompletion>::new());
        }
    }

    #[test]
    fn an_unknown_order_offers_nothing() {
        assert_eq!(no_ruleset("WROK "), Vec::<OrderCompletion>::new());
    }

    #[test]
    fn a_finished_form_offers_nothing() {
        for prefix in ["DECLARE 15 ALLY ", "TAX "] {
            assert_eq!(no_ruleset(prefix), Vec::<OrderCompletion>::new());
        }
    }

    #[test]
    fn an_open_position_offers_nothing() {
        for prefix in ["STUDY ", "GUARD ", "FORM "] {
            assert_eq!(no_ruleset(prefix), Vec::<OrderCompletion>::new());
        }
    }

    #[test]
    fn a_unit_reference_is_stepped_over_however_long_it_is() {
        for prefix in ["GIVE 17 ", "GIVE NEW 2 ", "GIVE FACTION 15 NEW 2 "] {
            assert_eq!(no_ruleset(prefix), vec![kw("UNIT"), kw("ALL")]);
        }
    }

    #[test]
    fn a_move_offers_its_steps_again_after_each_one() {
        let expected: Vec<OrderCompletion> = ["N", "NE", "SE", "S", "SW", "NW", "IN", "OUT"]
            .into_iter()
            .map(kw)
            .collect();
        for prefix in ["MOVE ", "MOVE N ", "MOVE N S", "SAIL ", "ADVANCE IN "] {
            assert_eq!(no_ruleset(prefix), expected);
        }
    }

    #[test]
    fn a_second_keyword_position_is_reached_through_the_first() {
        assert_eq!(
            no_ruleset("OPTION TEMPLATE "),
            vec![kw("OFF"), kw("SHORT"), kw("LONG"), kw("MAP")]
        );
        assert_eq!(no_ruleset("TAKE "), vec![kw("FROM")]);
    }

    #[test]
    fn a_comment_is_not_an_order() {
        assert_eq!(no_ruleset("MOVE N ; go h"), Vec::<OrderCompletion>::new());
    }

    #[test]
    fn an_unclosed_quote_swallows_the_position() {
        assert_eq!(
            no_ruleset("NAME UNIT \"Big "),
            Vec::<OrderCompletion>::new()
        );
    }

    #[test]
    fn a_closed_quote_is_not_still_being_typed() {
        assert_eq!(no_ruleset("BUILD \"Big Boat\""), vec![kw("COMPLETE")]);
    }

    #[test]
    fn the_repeat_prefix_and_indentation_are_ignored() {
        let expected = vec![kw("UNIT"), kw("FACTION"), kw("OBJECT"), kw("CITY")];
        assert_eq!(no_ruleset("@NAME U"), expected);
        assert_eq!(no_ruleset("   NAME U"), expected);
    }

    #[test]
    fn the_half_typed_word_does_not_move_the_position() {
        assert_eq!(no_ruleset("NAME U"), no_ruleset("NAME "));
    }

    // --- increment 2: the catalogue ---------------------------------------------------------

    #[test]
    fn the_catalogue_answers_where_an_item_may_stand() {
        let ruleset = ruleset();
        let offered = order_argument_completions("GIVE 4573 ALL ", Some(&ruleset), None, None);

        assert_eq!(offered.len(), ITEM_CLASSES.len() + ruleset.items.len());
        let classes: Vec<&str> = offered[..ITEM_CLASSES.len()]
            .iter()
            .map(|entry| entry.value.as_str())
            .collect();
        let mut sorted_classes = classes.clone();
        sorted_classes.sort_unstable();
        assert_eq!(
            classes, sorted_classes,
            "classes come first, alphabetically"
        );

        let items = &offered[ITEM_CLASSES.len()..];
        let mut tags: Vec<&str> = items.iter().map(|entry| entry.value.as_str()).collect();
        let mut sorted_tags = tags.clone();
        sorted_tags.sort_unstable();
        assert_eq!(tags, sorted_tags, "items come after, in tag order");
        tags.sort_unstable();

        let silver = items
            .iter()
            .find(|entry| entry.value == "SILV")
            .expect("silver is in the catalogue");
        assert_eq!(silver.name, "silver");
    }

    #[test]
    fn skills_carry_their_name_and_cost() {
        let ruleset = ruleset();
        let offered = order_argument_completions("STUDY ", Some(&ruleset), None, None);

        let observation = offered
            .iter()
            .find(|entry| entry.value == "OBSE")
            .expect("observation is a skill");
        assert_eq!(
            observation.detail,
            format!("{} · 50 silver", observation.name)
        );

        let unpriced = offered
            .iter()
            .find(|entry| {
                ruleset
                    .skills
                    .get(&entry.value)
                    .is_some_and(|skill| skill.cost.is_none())
            })
            .expect("at least one skill the data page prices nowhere");
        assert_eq!(unpriced.detail, unpriced.name);
    }

    // --- increment 3: BUY and SELL narrow to the hex ----------------------------------------

    fn inholm_region() -> ReportRegion {
        // From the committed fixture's own report block for unit 18642's hex.
        ReportRegion {
            region_id: "1:7,53".to_string(),
            coordinate: Coordinate { x: 7, y: 53, z: 1 },
            terrain: "mountain".to_string(),
            province: "Inhead".to_string(),
            for_sale: vec![
                MarketItem {
                    amount: 63,
                    name: "perfume".to_string(),
                    tag: "PERF".to_string(),
                    price: 204,
                },
                MarketItem {
                    amount: 53,
                    name: "gems".to_string(),
                    tag: "GEM".to_string(),
                    price: 213,
                },
                MarketItem {
                    amount: 482,
                    name: "hill dwarves".to_string(),
                    tag: "HDWA".to_string(),
                    price: 77,
                },
                MarketItem {
                    amount: 96,
                    name: "leaders".to_string(),
                    tag: "LEAD".to_string(),
                    price: 1349,
                },
            ],
            wanted: vec![
                MarketItem {
                    amount: 0,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 0,
                    name: "livestock".to_string(),
                    tag: "LIVE".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 0,
                    name: "fish".to_string(),
                    tag: "FISH".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 0,
                    name: "spears".to_string(),
                    tag: "SPEA".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 0,
                    name: "leather armor".to_string(),
                    tag: "LARM".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 0,
                    name: "spinnaker".to_string(),
                    tag: "SPIN".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 82,
                    name: "jewelry".to_string(),
                    tag: "JEWE".to_string(),
                    price: 630,
                },
                MarketItem {
                    amount: 0,
                    name: "lassos".to_string(),
                    tag: "LASS".to_string(),
                    price: 0,
                },
                MarketItem {
                    amount: 0,
                    name: "truffles".to_string(),
                    tag: "TRUF".to_string(),
                    price: 0,
                },
            ],
            products: vec![
                ItemAmount {
                    amount: 57,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                },
                ItemAmount {
                    amount: 37,
                    name: "iron".to_string(),
                    tag: "IRON".to_string(),
                },
                ItemAmount {
                    amount: 17,
                    name: "stone".to_string(),
                    tag: "STON".to_string(),
                },
            ],
            units: vec![unit_18642()],
            ..Default::default()
        }
    }

    fn unit_18642() -> ReportUnit {
        ReportUnit {
            unit_id: "18642".to_string(),
            name: "Seven of Eight".to_string(),
            region_id: "1:7,53".to_string(),
            own: true,
            skills: vec![
                Skill {
                    name: "manipulation".to_string(),
                    tag: "MANI".to_string(),
                    level: 3,
                    points: 0,
                },
                Skill {
                    name: "stealth".to_string(),
                    tag: "STEA".to_string(),
                    level: 5,
                    points: 0,
                },
                Skill {
                    name: "observation".to_string(),
                    tag: "OBSE".to_string(),
                    level: 2,
                    points: 0,
                },
            ],
            ..Default::default()
        }
    }

    fn inholm_report() -> ParsedReport {
        report(vec![inholm_region()])
    }

    #[test]
    fn a_purchase_offers_only_what_the_hex_sells() {
        let ruleset = ruleset();
        let report = inholm_report();
        let offered =
            order_argument_completions("BUY 5 ", Some(&ruleset), Some(&report), Some("18642"));

        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        assert_eq!(tags, vec!["GEM", "HDWA", "LEAD", "PERF"]);

        let perfume = offered.iter().find(|entry| entry.value == "PERF").unwrap();
        assert_eq!(perfume.detail, "perfume · $204, 63 left");
    }

    #[test]
    fn a_sale_offers_only_what_the_hex_wants() {
        let ruleset = ruleset();
        let report = inholm_report();
        let offered =
            order_argument_completions("SELL ALL ", Some(&ruleset), Some(&report), Some("18642"));

        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        assert_eq!(
            tags,
            vec!["FISH", "GRAI", "JEWE", "LARM", "LASS", "LIVE", "SPEA", "SPIN", "TRUF"]
        );

        let jewelry = offered.iter().find(|entry| entry.value == "JEWE").unwrap();
        assert_eq!(jewelry.detail, "jewelry · $630, wants 82");
    }

    // --- increment 4: PRODUCE narrows to the hex and the unit's skills ----------------------

    #[test]
    fn production_offers_what_the_ground_yields() {
        let ruleset = ruleset();
        let report = inholm_report();
        let offered =
            order_argument_completions("PRODUCE ", Some(&ruleset), Some(&report), Some("18642"));

        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        assert_eq!(tags, vec!["GRAI", "IRON", "STON"]);

        let grain = offered.iter().find(|entry| entry.value == "GRAI").unwrap();
        assert_eq!(grain.detail, "grain · 57 here");
    }

    #[test]
    fn production_offers_what_the_unit_can_make() {
        let ruleset = ruleset();
        let mut region = inholm_region();
        region.units = vec![ReportUnit {
            unit_id: "1".to_string(),
            region_id: region.region_id.clone(),
            own: true,
            skills: vec![Skill {
                name: "weaponsmith".to_string(),
                tag: "WEAP".to_string(),
                level: 1,
                points: 0,
            }],
            ..Default::default()
        }];
        let report = report(vec![region]);

        let offered =
            order_argument_completions("PRODUCE ", Some(&ruleset), Some(&report), Some("1"));
        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();

        assert_eq!(
            &tags[..3],
            &["GRAI", "IRON", "STON"],
            "the ground's products come first"
        );
        let skill_tags = &tags[3..];
        let mut sorted = skill_tags.to_vec();
        sorted.sort_unstable();
        assert_eq!(
            skill_tags, sorted,
            "then everything WEAP 1 can make, in tag order"
        );
        assert!(skill_tags.contains(&"SWOR"));

        let sword = offered.iter().find(|entry| entry.value == "SWOR").unwrap();
        assert_eq!(sword.detail, format!("{} · weaponsmith", sword.name));

        assert_eq!(
            skill_tags.iter().collect::<HashSet<_>>().len(),
            skill_tags.len(),
            "no tag twice"
        );
    }

    #[test]
    fn a_level_too_low_produces_nothing_extra() {
        let ruleset = ruleset();
        let mut region = inholm_region();
        region.units = vec![ReportUnit {
            unit_id: "1".to_string(),
            region_id: region.region_id.clone(),
            own: true,
            skills: vec![Skill {
                name: "weaponsmith".to_string(),
                tag: "WEAP".to_string(),
                level: 1,
                points: 0,
            }],
            ..Default::default()
        }];
        let report = report(vec![region]);

        let offered =
            order_argument_completions("PRODUCE ", Some(&ruleset), Some(&report), Some("1"));
        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();

        assert!(
            !tags.contains(&"MSWO"),
            "level 3 is out of reach at level 1"
        );
        assert!(
            !tags.contains(&"ASWR"),
            "level 5 is out of reach at level 1"
        );
    }

    #[test]
    fn a_skill_the_ruleset_does_not_know_is_skipped() {
        let ruleset = ruleset();
        let mut region = inholm_region();
        region.units = vec![ReportUnit {
            unit_id: "1".to_string(),
            region_id: region.region_id.clone(),
            own: true,
            skills: vec![Skill {
                name: "made up".to_string(),
                tag: "ZZZZ".to_string(),
                level: 9,
                points: 0,
            }],
            ..Default::default()
        }];
        let report = report(vec![region]);

        let offered =
            order_argument_completions("PRODUCE ", Some(&ruleset), Some(&report), Some("1"));
        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        assert_eq!(tags, vec!["GRAI", "IRON", "STON"]);
    }

    // --- increment 5: silence and fallback ---------------------------------------------------

    #[test]
    fn a_hex_with_no_market_offers_nothing() {
        let ruleset = ruleset();
        let mut region = inholm_region();
        region.for_sale = Vec::new();
        let report = report(vec![region]);

        let offered =
            order_argument_completions("BUY 5 ", Some(&ruleset), Some(&report), Some("18642"));
        assert_eq!(offered, Vec::<OrderCompletion>::new());
    }

    #[test]
    fn without_a_report_the_catalogue_stands_in() {
        let ruleset = ruleset();
        let offered = order_argument_completions("BUY 5 ", Some(&ruleset), None, None);
        assert_eq!(offered.len(), ruleset.items.len());
    }

    #[test]
    fn without_a_ruleset_a_market_still_answers() {
        let report = inholm_report();
        let offered = order_argument_completions("BUY 5 ", None, Some(&report), Some("18642"));
        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        assert_eq!(tags, vec!["GEM", "HDWA", "LEAD", "PERF"]);
    }

    #[test]
    fn an_unknown_unit_falls_back() {
        let ruleset = ruleset();
        let report = inholm_report();
        let offered =
            order_argument_completions("BUY 5 ", Some(&ruleset), Some(&report), Some("99999"));
        assert_eq!(offered.len(), ruleset.items.len());
    }

    // --- increment 6: GIVE narrows to what the unit holds (ah-84w) ---------------------------

    /// The Inholm hex, with unit 18642 carrying a short, deliberately unsorted inventory.
    fn carrying_report() -> ParsedReport {
        let mut region = inholm_region();
        let mut unit = unit_18642();
        unit.items = vec![
            ItemAmount {
                amount: 1,
                name: "sword".to_string(),
                tag: "SWOR".to_string(),
            },
            ItemAmount {
                amount: 150,
                name: "silver".to_string(),
                tag: "SILV".to_string(),
            },
            ItemAmount {
                amount: 3,
                name: "herbs".to_string(),
                tag: "HERB".to_string(),
            },
        ];
        region.units = vec![unit];
        report(vec![region])
    }

    #[test]
    fn give_offers_only_what_the_unit_holds() {
        let ruleset = ruleset();
        let report = carrying_report();
        let offered =
            order_argument_completions("GIVE 7 3 ", Some(&ruleset), Some(&report), Some("18642"));

        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        assert_eq!(tags, vec!["HERB", "SILV", "SWOR"]);
    }

    #[test]
    fn give_names_the_amount_held() {
        let ruleset = ruleset();
        let report = carrying_report();
        let offered =
            order_argument_completions("GIVE 7 3 ", Some(&ruleset), Some(&report), Some("18642"));

        let herbs = offered.iter().find(|entry| entry.value == "HERB").unwrap();
        assert_eq!(herbs.detail, "herbs · 3 held");
    }

    #[test]
    fn give_offers_silver_like_any_other_item() {
        let ruleset = ruleset();
        let report = carrying_report();
        let offered =
            order_argument_completions("GIVE 7 3 ", Some(&ruleset), Some(&report), Some("18642"));

        let silver = offered.iter().find(|entry| entry.value == "SILV").unwrap();
        assert_eq!(silver.detail, "silver · 150 held");
    }

    #[test]
    fn give_sorts_by_tag_like_a_market_list() {
        let ruleset = ruleset();
        let report = carrying_report();
        let offered =
            order_argument_completions("GIVE 7 3 ", Some(&ruleset), Some(&report), Some("18642"));

        let tags: Vec<&str> = offered.iter().map(|entry| entry.value.as_str()).collect();
        let mut sorted = tags.clone();
        sorted.sort_unstable();
        assert_eq!(tags, sorted);
    }

    #[test]
    fn a_unit_holding_nothing_is_offered_nothing() {
        let ruleset = ruleset();
        let report = inholm_report(); // unit 18642 carries nothing here
        let offered =
            order_argument_completions("GIVE 7 3 ", Some(&ruleset), Some(&report), Some("18642"));

        assert_eq!(offered, Vec::<OrderCompletion>::new());
    }

    #[test]
    fn give_falls_back_to_the_catalogue_when_the_unit_cannot_be_found() {
        let ruleset = ruleset();
        let report = carrying_report();

        for unit_id in [None, Some("99999")] {
            let offered =
                order_argument_completions("GIVE 7 3 ", Some(&ruleset), Some(&report), unit_id);
            assert_eq!(offered.len(), ruleset.items.len());
        }
    }

    #[test]
    fn giving_a_whole_unit_still_offers_its_keywords() {
        let ruleset = ruleset();
        let report = carrying_report();
        let offered =
            order_argument_completions("GIVE 7 ", Some(&ruleset), Some(&report), Some("18642"));

        assert_eq!(offered, vec![kw("UNIT"), kw("ALL")]);
    }

    // --- where the caret is, decided once (ah-vfq) -------------------------------------------

    fn caret(prefix: &str) -> CaretCompletions {
        completions_at_caret(prefix, None, None, None)
    }

    #[test]
    fn the_command_position_is_reported_as_such() {
        let answer = caret("  @ta");
        assert_eq!(answer.position, CaretPosition::Command);
        assert_eq!(answer.word, "ta");
        assert_eq!(answer.word_start, 3);
        assert!(answer.options.is_empty());
    }

    #[test]
    fn an_argument_position_carries_its_options() {
        let answer = caret("NAME U");
        assert_eq!(answer.position, CaretPosition::Argument);
        assert_eq!(answer.word, "U");
        assert_eq!(answer.word_start, 5);
        assert_eq!(answer.options, no_ruleset("NAME U"));
        assert!(!answer.options.is_empty());
    }

    #[test]
    fn a_caret_after_a_closing_quote_is_the_next_position() {
        let answer = caret("BUILD \"Big Boat\"");
        assert_eq!(answer.position, CaretPosition::Argument);
        assert_eq!(answer.word, "");
        assert_eq!(answer.word_start, 16);
    }

    #[test]
    fn a_caret_after_whitespace_types_no_word() {
        let answer = caret("NAME UNIT ");
        assert_eq!(answer.word, "");
        assert_eq!(answer.word_start, 10);
    }

    #[test]
    fn a_word_start_counts_utf16_code_units() {
        let answer = caret("NAME UNIT \"Mörk\" ta");
        assert_eq!(answer.word, "ta");
        assert_eq!(answer.word_start, 17);
    }

    #[test]
    fn a_hyphenated_word_is_one_word() {
        // What the snippet source filters by: if the lexer split on `-`, a snippet named
        // `tax-and-work` would stop being reachable by typing it (ah-vfq).
        let answer = caret("tax-and");
        assert_eq!(answer.word, "tax-and");
        assert_eq!(answer.word_start, 0);
    }

    #[test]
    fn a_comment_is_nowhere() {
        let answer = caret("TAX ; note");
        assert_eq!(answer.position, CaretPosition::Nowhere);
        assert!(answer.options.is_empty());
    }

    #[test]
    fn an_unterminated_quote_is_nowhere() {
        assert_eq!(caret("BUILD \"Big").position, CaretPosition::Nowhere);
    }

    #[test]
    fn an_order_the_grammar_does_not_have_is_nowhere() {
        assert_eq!(caret("FLURBLE x").position, CaretPosition::Nowhere);
    }

    #[test]
    fn an_empty_line_is_the_command_position() {
        let answer = caret("");
        assert_eq!(answer.position, CaretPosition::Command);
        assert_eq!(answer.word, "");
        assert_eq!(answer.word_start, 0);
    }
}
