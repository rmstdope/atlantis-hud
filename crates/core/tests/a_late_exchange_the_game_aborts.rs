//! `ah-a58i`. An `EXCHANGE` pair the game aborts because one side's goods only arrive by another
//! exchange the game settles later is warned on both of its lines, and names the late unit.
//!
//! `rules/exchange`: *"If either unit involved does not have the items it is offering ... the
//! exchange is aborted."* When the game checks is the engine's walk (`runorders.cpp`
//! `DoExchangeOrders`, followed since `ah-6cni`): units in report order, the partner's holding read
//! at a pair's first line, the first side's at its second, goods moved there. So a pair completed
//! later in the walk cannot pay for one completed earlier, whatever order the lines are written in.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

const CODE: &str = "exchange-aborted";

/// The aborted-exchange warnings, as (unit, line, message).
fn warnings(text: &str, script: &str) -> Vec<(String, usize, String)> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, script, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code.as_str() == CODE)
        .map(|finding| {
            (
                finding.unit_id.unwrap_or_default(),
                finding.line.unwrap_or_default(),
                finding.message,
            )
        })
        .collect()
}

/// The bead's case, on the committed turn 42: tundra (35,9) lists Scout (1170), City Guard (7676)
/// and Miners (11127) in that order (`neworigins-3.0.0-g3-f42-t42.rep:2114`). Scout holds a sword
/// and no iron; Miners hold 7 iron; City Guard holds silver. Scout trades its sword to Miners for
/// iron, and that iron on to City Guard - but the game reaches City Guard first.
#[test]
fn the_beads_case_warns_both_lines_of_the_pair_the_walk_reaches_first() {
    let script = "#atlantis 42 \"<password>\"\n\n\
                  unit 1170\nEXCHANGE 11127 1 SWOR 1 IRON\nEXCHANGE 7676 1 IRON 1 SILV\n\
                  unit 7676\nEXCHANGE 1170 1 SILV 1 IRON\n\
                  unit 11127\nEXCHANGE 1170 1 IRON 1 SWOR\n";
    let late = "EXCHANGE will be aborted: Scout (1170) will hold only 0 of the 1 IRON it offers — \
                the IRON from Miners (11127) arrives after this exchange is settled";
    assert_eq!(
        warnings(atlantis_hud_fixtures::G3_F42_T42.text, script),
        vec![
            ("1170".to_string(), 5, late.to_string()),
            ("7676".to_string(), 7, late.to_string()),
        ]
    );
}

/// Scout (1170), City Guard (7676), Miners (11127) and Smiths (2210), all ours and in that report
/// order, with Mark (7001) of another faction looking on.
fn hex(scout_iron: u32, guard_silver: u32) -> String {
    let scout_iron = if scout_iron == 0 {
        String::new()
    } else {
        format!(", {scout_iron} iron [IRON]")
    };
    let guard_silver = if guard_silver == 0 {
        String::new()
    } else {
        format!(", {guard_silver} silver [SILV]")
    };
    [
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.".to_string(),
        "  Wanted: none.".to_string(),
        "  For Sale: none.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        format!(
            "* Scout (1170), Foo (1), leader [LEAD], 5 swords [SWOR]{scout_iron}. Weight: 15. \
             Capacity: 0/0/15/0."
        ),
        format!(
            "* City Guard (7676), Foo (1), leader [LEAD]{guard_silver}. Weight: 10. Capacity: \
             0/0/15/0."
        ),
        "* Miners (11127), Foo (1), leader [LEAD], 7 iron [IRON]. Weight: 80. Capacity: 0/0/15/0."
            .to_string(),
        "* Smiths (2210), Foo (1), leader [LEAD], 7 iron [IRON], 2 swords [SWOR]. Weight: 82. \
         Capacity: 0/0/15/0."
            .to_string(),
        "- Mark (7001), Bar (2), 5 orcs [ORC], 900 silver [SILV], 4 iron [IRON].".to_string(),
        String::new(),
    ]
    .join("\n")
}

/// The orders of Scout, City Guard, Miners and Smiths.
fn script(text: &str, [scout, guard, miners, smiths]: [&str; 4]) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!(
        "{template}\nunit 1170\n{scout}\nunit 7676\n{guard}\nunit 11127\n{miners}\nunit 2210\n\
         {smiths}\n"
    )
}

/// The warnings as (unit, message), lines left out.
fn warned(scout_iron: u32, guard_silver: u32, orders: [&str; 4]) -> Vec<(String, String)> {
    let text = hex(scout_iron, guard_silver);
    warnings(&text, &script(&text, orders))
        .into_iter()
        .map(|(unit, _, message)| (unit, message))
        .collect()
}

fn on_both(message: &str) -> Vec<(String, String)> {
    vec![
        ("1170".to_string(), message.to_string()),
        ("7676".to_string(), message.to_string()),
    ]
}

/// The agreed "partly short" state: Scout holds 1 iron and the other 2 arrive late.
#[test]
fn a_partly_short_side_gives_what_it_really_holds() {
    let orders = [
        "EXCHANGE 11127 2 SWOR 2 IRON\nEXCHANGE 7676 3 IRON 3 SILV",
        "EXCHANGE 1170 3 SILV 3 IRON",
        "EXCHANGE 1170 2 IRON 2 SWOR",
        "",
    ];
    assert_eq!(
        warned(1, 100, orders),
        on_both(
            "EXCHANGE will be aborted: Scout (1170) will hold only 1 of the 3 IRON it offers — \
             the IRON from Miners (11127) arrives after this exchange is settled"
        )
    );
}

/// The agreed "several late exchanges" state: every late unit is named, in report order, joined
/// with "and" - Smiths (2210) is written first but listed last.
#[test]
fn several_late_exchanges_are_all_named_in_report_order() {
    let orders = [
        "EXCHANGE 2210 1 SWOR 1 IRON\nEXCHANGE 11127 1 SWOR 1 IRON\nEXCHANGE 7676 2 IRON 2 SILV",
        "EXCHANGE 1170 2 SILV 2 IRON",
        "EXCHANGE 1170 1 IRON 1 SWOR",
        "EXCHANGE 1170 1 IRON 1 SWOR",
    ];
    assert_eq!(
        warned(0, 100, orders),
        on_both(
            "EXCHANGE will be aborted: Scout (1170) will hold only 0 of the 2 IRON it offers — \
             the IRON from Miners (11127) and Smiths (2210) arrives after this exchange is settled"
        )
    );
}

/// A unit whose two late exchanges both bring the item is named once.
#[test]
fn a_unit_with_two_late_exchanges_is_named_once() {
    let orders = [
        "EXCHANGE 11127 1 SWOR 1 IRON\nEXCHANGE 11127 2 SWOR 1 IRON\nEXCHANGE 7676 2 IRON 2 SILV",
        "EXCHANGE 1170 2 SILV 2 IRON",
        "EXCHANGE 1170 1 IRON 1 SWOR\nEXCHANGE 1170 1 IRON 2 SWOR",
        "",
    ];
    assert_eq!(
        warned(0, 100, orders),
        on_both(
            "EXCHANGE will be aborted: Scout (1170) will hold only 0 of the 2 IRON it offers — \
             the IRON from Miners (11127) arrives after this exchange is settled"
        )
    );
}

/// The agreed "both sides short" state: City Guard holds no silver either, and nothing else trades
/// silver, so its part carries no clause; the two parts are joined with "; ".
#[test]
fn both_sides_short_each_carry_their_own_clause() {
    let orders = [
        "EXCHANGE 11127 1 SWOR 1 IRON\nEXCHANGE 7676 1 IRON 1 SILV",
        "EXCHANGE 1170 1 SILV 1 IRON",
        "EXCHANGE 1170 1 IRON 1 SWOR",
        "",
    ];
    assert_eq!(
        warned(0, 0, orders),
        on_both(
            "EXCHANGE will be aborted: Scout (1170) will hold only 0 of the 1 IRON it offers — \
             the IRON from Miners (11127) arrives after this exchange is settled; City Guard \
             (7676) will hold only 0 of the 1 SILV it offers"
        )
    );
}

/// A later exchange that is itself aborted brings nothing, so it is not named as arriving late;
/// whether anything else covers the shortfall is then not followed, and nothing is said - the
/// conservative rule from before (`ah-p5ow`). Miners offer 9 iron and hold 7.
#[test]
fn a_late_exchange_that_is_itself_aborted_is_not_named() {
    let orders = [
        "EXCHANGE 11127 1 SWOR 9 IRON\nEXCHANGE 7676 1 IRON 1 SILV",
        "EXCHANGE 1170 1 SILV 1 IRON",
        "EXCHANGE 1170 9 IRON 1 SWOR",
        "",
    ];
    assert_eq!(warned(0, 100, orders), vec![]);
}

/// The agreed "late exchange with another faction's unit" state: Mark may hand Scout iron in time,
/// so nothing is said.
#[test]
fn an_exchange_with_another_faction_trading_the_item_keeps_it_silent() {
    let orders = [
        "EXCHANGE 11127 1 SWOR 1 IRON\nEXCHANGE 7001 1 SWOR 1 IRON\nEXCHANGE 7676 1 IRON 1 SILV",
        "EXCHANGE 1170 1 SILV 1 IRON",
        "EXCHANGE 1170 1 IRON 1 SWOR",
        "",
    ];
    assert_eq!(warned(0, 100, orders), vec![]);
}

/// The agreed "goods cannot be read" state: a line whose goods nothing names might trade iron.
#[test]
fn a_line_whose_goods_cannot_be_read_keeps_it_silent() {
    let orders = [
        "EXCHANGE 11127 1 SWOR 1 IRON\nEXCHANGE 7676 1 IRON 1 SILV",
        "EXCHANGE 1170 1 SILV 1 IRON",
        "EXCHANGE 1170 1 IRON 1 SWOR\nEXCHANGE 2210 1 WIDGETS 1 SWOR",
        "",
    ];
    assert_eq!(warned(0, 100, orders), vec![]);
}

/// A late exchange that hands the iron to somebody else says nothing about Scout's holding, but
/// is not followed either: nothing is said, as before.
#[test]
fn a_late_exchange_of_the_item_to_another_unit_keeps_it_silent() {
    let orders = [
        "EXCHANGE 7676 1 IRON 1 SILV",
        "EXCHANGE 1170 1 SILV 1 IRON",
        "EXCHANGE 2210 1 IRON 1 SWOR",
        "EXCHANGE 11127 1 SWOR 1 IRON",
    ];
    assert_eq!(warned(0, 100, orders), vec![]);
}
