//! `ah-jo6b.4`. The game refuses a mage's recruiting, and both surfaces say so: the ITEMS ledger
//! already buys nobody, and the SILVER column now charges nothing for them.
//!
//! `rules/magic`: *"Only one man units, with the man being a leader, are permitted to study these
//! skills... In addition, mages may not GIVE men at all; once a unit becomes a mage (by studying
//! one of the Foundations), the unit number is fixed."* The rules page states the GIVE half; the
//! refusal of a mage's BUY of men is the navigator's New Origins ruling, recorded in `ah-ndp9` and
//! resting on the fixed unit number.
//!
//! `data/items`: `orc [ORC]` and `leader [LEAD]` both carry `kind: man`, and `force [FORC]` is a
//! Foundation - so the fixture's lone leader with `force [FORC] 1` is a mage the game could
//! actually produce.
//!
//! `ah-u5rz`. A unit that is no mage is refused too when the BUY would mix leaders and normal men:
//! `rules/playing_units` says *"Leaders and normal people may not be mixed in the same unit"*, and
//! the engine refuses the order outright (`Game::GetBuyAmount`, ../Atlantis `runorders.cpp`:
//! "BUY: Can't mix leaders and normal men.", `o->num = 0`).

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The fixture. The men are the first item on the unit's line because `count_men` reads the
/// headcount off `items.first()`; the region pays `$0`, so no wage moves and the figures below are
/// the purchase and nothing else.
fn report_text(skills: &str) -> String {
    report_with("1 leaders [LEAD]", skills)
}

/// The same fixture with `men` in place of the lone leader, and leaders on sale beside the orcs.
fn report_with(men: &str, skills: &str) -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "",
        "  For Sale: 20 orcs [ORC] at $38, 5 leaders [LEAD] at $100.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        &format!(
            "* Rhia (2390), Foo (1), {men}, 1000 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0. Skills: {skills}."
        ),
        "",
    ]
    .join("\n")
}

fn review_of(text: &str, script: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    review_turn(
        &parsed,
        &format!("{template}\n{script}"),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn row_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the column has a row for unit {unit_id}"))
        .clone()
}

/// How many of `tag` the ITEMS preview leaves `unit_id` holding, and what it admitted as
/// uncounted - or `None` where the preview carries no row for the unit at all, which is what it
/// says about a month whose orders change nothing.
fn preview_holding(
    text: &str,
    script: &str,
    unit_id: &str,
    tag: &str,
) -> Option<(i64, Vec<String>)> {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &format!("{template}\n{script}"),
    )
    .expect("the committed ruleset loads");
    let unit = common::preview_row(text, &preview, unit_id)?;
    Some((
        unit.unit
            .items
            .iter()
            .filter(|item| item.tag == tag)
            .map(|item| item.amount)
            .sum(),
        unit.uncounted.clone(),
    ))
}

const SCRIPT: &str = "unit 2390\nBUY 5 orcs\n";

/// The whole bead. The mage is charged nothing for the five orcs the game will not hand it, and
/// nothing is doubted: the refusal is certain, and the ledger's existing finding says why.
#[test]
fn a_mage_is_charged_nothing_for_the_recruits_the_game_refuses() {
    let text = report_text("force [FORC] 1 (30)");
    let review = review_of(&text, SCRIPT);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(0), "nothing is charged: {rhia:?}");
    assert_eq!(rhia.at_month_end, Some(1000), "the purse is untouched");
    assert_eq!(rhia.doubt, None, "a refusal is certain, not doubtful");
    assert!(
        !rhia
            .changes
            .iter()
            .any(|change| change.cause == SilverChangeCause::Bought),
        "no purchase is booked on the hover: {:?}",
        rhia.changes
    );

    let refusals: Vec<(&str, Option<&str>)> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "men-sent-into-a-mage")
        .map(|finding| (finding.message.as_str(), finding.unit_id.as_deref()))
        .collect();
    assert_eq!(
        refusals,
        vec![(
            "this unit is a mage and cannot recruit, and leaders and normal men may not be mixed, so \
             this order buys nobody",
            Some("2390")
        )]
    );

    // The preview carries a row only for a unit whose month changes something, so a refusal that
    // buys nobody and spends nothing leaves no row at all: the ITEMS surface hands the mage no
    // orcs, and admits nothing as uncounted either.
    assert_eq!(preview_holding(&text, SCRIPT, "2390", "ORC"), None);
}

/// What the game refuses for mixing: nothing is charged, nobody is recruited, and one warning on
/// the line says why (`ah-u5rz`).
fn assert_refused_for_mixing(text: &str, script: &str, tag: &str) {
    let review = review_of(text, script);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(0), "nothing is charged: {rhia:?}");
    assert_eq!(rhia.at_month_end, Some(1000), "the purse is untouched");
    assert_eq!(rhia.doubt, None, "a refusal is certain, not doubtful");
    assert!(
        !rhia
            .changes
            .iter()
            .any(|change| change.cause == SilverChangeCause::Bought),
        "no purchase is booked on the hover: {:?}",
        rhia.changes
    );

    let refusals: Vec<(&str, &str, Option<&str>)> = review
        .findings
        .iter()
        .filter(|finding| {
            matches!(
                finding.code.as_str(),
                "leaders-and-men-mixed" | "men-sent-into-a-mage"
            )
        })
        .map(|finding| {
            (
                finding.code.as_str(),
                finding.message.as_str(),
                finding.unit_id.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        refusals,
        vec![(
            "leaders-and-men-mixed",
            "leaders and normal men may not be mixed, so this order buys nobody",
            Some("2390")
        )]
    );

    assert_eq!(
        preview_holding(text, script, "2390", tag),
        None,
        "the ITEMS preview recruits nobody"
    );
}

/// The bead. A leader who is no mage buying orcs is refused, as the engine refuses it.
#[test]
fn a_leader_who_is_no_mage_is_refused_normal_men() {
    let text = report_text("combat [COMB] 1 (30)");
    assert_refused_for_mixing(&text, SCRIPT, "ORC");
}

/// The reverse: normal men buying leaders are refused the same way.
#[test]
fn normal_men_are_refused_leaders() {
    let text = report_with("2 orcs [ORC]", "combat [COMB] 1 (30)");
    assert_refused_for_mixing(&text, "unit 2390\nBUY 2 leaders\n", "LEAD");
}

/// The control, so the refusal is not widened to every buyer of men: a leader who is no mage
/// recruits more leaders, and pays the market's price for them.
#[test]
fn a_leader_who_is_no_mage_still_recruits_leaders_and_pays() {
    let text = report_text("combat [COMB] 1 (30)");
    let script = "unit 2390\nBUY 2 leaders\n";
    let review = review_of(&text, script);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(200), "two leaders at $100");
    assert_eq!(rhia.at_month_end, Some(800));
    assert!(
        !review.findings.iter().any(|finding| matches!(
            finding.code.as_str(),
            "leaders-and-men-mixed" | "men-sent-into-a-mage"
        )),
        "a mundane leader is refused nothing"
    );

    let (leaders, uncounted) = preview_holding(&text, script, "2390", "LEAD")
        .expect("a leader that recruits has a preview row");
    assert_eq!(leaders, 3);
    assert!(
        uncounted.is_empty(),
        "no ` + ?` on the ITEMS cell: {uncounted:?}"
    );
}

/// The other control: normal men recruit more normal men, and pay for them.
#[test]
fn normal_men_still_recruit_normal_men_and_pay() {
    let text = report_with("2 orcs [ORC]", "combat [COMB] 1 (30)");
    let review = review_of(&text, SCRIPT);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(190), "five orcs at $38");
    assert_eq!(rhia.at_month_end, Some(810));
    let bought: Vec<i64> = rhia
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Bought)
        .map(|change| change.amount)
        .collect();
    assert_eq!(bought, vec![-190]);
    assert!(
        !review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "leaders-and-men-mixed"),
        "orcs buying orcs mix nothing"
    );

    let (orcs, uncounted) = preview_holding(&text, SCRIPT, "2390", "ORC")
        .expect("a unit that recruits has a preview row");
    assert_eq!(orcs, 7);
    assert!(
        uncounted.is_empty(),
        "no ` + ?` on the ITEMS cell: {uncounted:?}"
    );
}

/// The engine asks whether a BUY mixes at the market, after `rules/sequenceofevents`' Give phase:
/// a lone leader that gives its leader away holds no men when its market runs, and recruits the
/// orcs it buys (`IsLeader` and `IsNormal` are both false in `Game::GetBuyAmount`).
#[test]
fn a_leader_given_away_before_the_market_leaves_the_unit_free_to_recruit() {
    let text = format!(
        "{}\n* Bran (2391), Foo (1), 1 leaders [LEAD]. Weight: 10. Capacity: 0/0/15/0. Skills: none.\n",
        report_text("combat [COMB] 1 (30)").trim_end()
    );
    let script = "unit 2390\nGIVE 2391 1 LEAD\nBUY 5 orcs\nunit 2391\n";
    let review = review_of(&text, script);
    let rhia = row_of(&review, "2390");

    assert_eq!(rhia.expense, Some(190), "five orcs at $38: {rhia:?}");
    assert!(
        !review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "leaders-and-men-mixed"),
        "no leader is left to mix with: {:?}",
        review.findings
    );
}

/// The other way round: a unit handed a leader before the market is refused the orcs it buys.
#[test]
fn a_leader_given_in_before_the_market_refuses_the_recruit() {
    let text = report_with("2 leaders [LEAD]", "combat [COMB] 1 (30)");
    let script = "unit 2390\nFORM 1\nBUY 5 orcs\nEND\nGIVE NEW 1 1 LEAD\n";
    let review = review_of(&text, script);

    let mixed: Vec<Option<&str>> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "leaders-and-men-mixed")
        .map(|finding| finding.unit_id.as_deref())
        .collect();
    assert_eq!(mixed.len(), 1, "{:?}", review.findings);
    let formed = review
        .silver
        .iter()
        .find(|row| Some(row.unit_id.as_str()) == mixed[0])
        .expect("the formed unit has a row");
    assert_eq!(formed.expense, Some(0), "nothing is charged: {formed:?}");
    assert_eq!(row_of(&review, "2390").at_month_end, Some(1000));
}

/// `BUY ALL` is refused before it is deferred to the end of the unit's month, so it is charged
/// nothing either.
#[test]
fn a_leader_who_is_no_mage_buying_all_normal_men_is_refused() {
    let text = report_text("combat [COMB] 1 (30)");
    assert_refused_for_mixing(&text, "unit 2390\nBUY ALL orcs\n", "ORC");
}

/// `ah-wk49`. A unit with no men that buys both leaders and normal men recruits whichever the
/// market runs first and is refused the other. The engine's `RunBuyOrders` settles one market line
/// at a time, in the region's market list - the `For Sale:` order - and `Game::GetBuyAmount` asks
/// `IsLeader` and `IsNormal` of the unit as the earlier lines left it (../Atlantis
/// `runorders.cpp`), so the second purchase meets men of the other kind and is refused with "BUY:
/// Can't mix leaders and normal men." (`rules/playing_units`: leaders and normal people may not be
/// mixed in the same unit).
///
/// The orders write the leaders first on purpose: what decides is the market's order, not the
/// document's. The formed unit is handed `silver`.
struct BuyingBoth {
    row: UnitSilver,
    /// The lines the `leaders-and-men-mixed` findings sit on.
    mixed: Vec<Option<usize>>,
    /// The order lines of `BUY 1 leaders` and `BUY 5 orcs`, numbered as findings number them.
    leaders_line: usize,
    orcs_line: usize,
    orcs: i64,
    leaders: i64,
}

fn formed_unit_buying_both(for_sale: &str, silver: i64) -> BuyingBoth {
    let text = report_with("1 leaders [LEAD]", "combat [COMB] 1 (30)")
        .replace("20 orcs [ORC] at $38, 5 leaders [LEAD] at $100", for_sale);
    let script =
        format!("unit 2390\nFORM 1\nBUY 1 leaders\nBUY 5 orcs\nEND\nGIVE NEW 1 {silver} SILV\n");
    let review = review_of(&text, &script);

    let formed_id = review
        .silver
        .iter()
        .find(|row| row.unit_id != "2390")
        .map(|row| row.unit_id.clone())
        .expect("the formed unit has a silver row");
    let mixed: Vec<Option<usize>> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "leaders-and-men-mixed")
        .map(|finding| {
            assert_eq!(finding.unit_id.as_deref(), Some(formed_id.as_str()));
            finding.line
        })
        .collect();
    // Read off the response directly: `common::preview_row` insists on a unit of the report, and
    // a formed unit is not one.
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\n{script}");
    let line_of = |wanted: &str| {
        orders
            .lines()
            .position(|line| line.trim() == wanted)
            .expect("the script writes the line")
            + 1
    };
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &orders,
    )
    .expect("the committed ruleset loads");
    let formed = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == formed_id)
        .expect("the formed unit has a preview row");
    let holding = |tag: &str| -> i64 {
        formed
            .unit
            .items
            .iter()
            .filter(|item| item.tag == tag)
            .map(|item| item.amount)
            .sum()
    };
    BuyingBoth {
        row: row_of(&review, &formed_id),
        mixed,
        leaders_line: line_of("BUY 1 leaders"),
        orcs_line: line_of("BUY 5 orcs"),
        orcs: holding("ORC"),
        leaders: holding("LEAD"),
    }
}

#[test]
fn orcs_sold_first_recruit_the_orcs_and_refuse_the_leader() {
    let both = formed_unit_buying_both("20 orcs [ORC] at $38, 5 leaders [LEAD] at $100", 500);

    assert_eq!(
        both.row.expense,
        Some(190),
        "five orcs at $38 and no leader: {:?}",
        both.row
    );
    assert_eq!(both.row.at_month_end, Some(310));
    assert_eq!(
        both.mixed,
        vec![Some(both.leaders_line)],
        "one warning, on the refused leader"
    );
    assert_eq!((both.orcs, both.leaders), (5, 0));
}

#[test]
fn leaders_sold_first_recruit_the_leader_and_refuse_the_orcs() {
    let both = formed_unit_buying_both("5 leaders [LEAD] at $100, 20 orcs [ORC] at $38", 500);

    assert_eq!(
        both.row.expense,
        Some(100),
        "one leader at $100 and no orc: {:?}",
        both.row
    );
    assert_eq!(both.row.at_month_end, Some(400));
    assert_eq!(
        both.mixed,
        vec![Some(both.orcs_line)],
        "one warning, on the refused orcs"
    );
    assert_eq!((both.orcs, both.leaders), (0, 1));
}

/// A first line that buys nobody leaves nobody to mix with. `Game::GetBuyAmount` cuts a line to
/// what the unit can afford and drops one cut to nothing, so `DoBuy` adds no leader, and the orcs'
/// line, sized next, meets a unit with no men and buys what the silver left covers: one orc at $38.
#[test]
fn a_first_line_the_unit_cannot_afford_leaves_the_second_free_to_recruit() {
    let both = formed_unit_buying_both("5 leaders [LEAD] at $100, 20 orcs [ORC] at $38", 50);

    assert_eq!(both.mixed, vec![], "no leader arrives to mix with");
    assert_eq!(
        both.row.expense,
        Some(38),
        "one orc at $38, and nothing for the leader: {:?}",
        both.row
    );
    assert_eq!(both.row.at_month_end, Some(12));
    assert_eq!((both.orcs, both.leaders), (1, 0));
}

/// `ah-fsgb`. The unit whose leader line bought nobody still recruits orcs, so it is one of the
/// buyers the orcs' line is split among (`rules/buy`: *"the available items will be split among
/// the buyers in proportion to the amount each buyer attempted to buy"*). `Game::GetBuyAmount`
/// (../Atlantis `runorders.cpp`) cuts the formed unit's `BUY 5 orcs` to the one its $50 pays for,
/// and asks `IsLeader` of a unit the leaders' line added nobody to, so the orcs' line is attempted
/// by 1 + 6 = 7 against 6 for sale. `Game::DoBuy` gives the faction-mate `(6 * 6 + r) / 7` - five
/// to the nearest - and the formed unit the one that is left.
#[test]
fn a_recruit_an_unaffordable_first_line_left_free_takes_its_share_of_the_line() {
    let text = format!(
        "{}\n* Bran (2391), Foo (1), 3 orcs [ORC], 1000 silver [SILV]. Weight: 30. \
         Capacity: 0/0/45/0. Skills: none.\n",
        report_with("1 leaders [LEAD]", "combat [COMB] 1 (30)")
            .replace(
                "20 orcs [ORC] at $38, 5 leaders [LEAD] at $100",
                "5 leaders [LEAD] at $100, 6 orcs [ORC] at $38"
            )
            .trim_end()
    );
    let script = "unit 2390\nFORM 1\nBUY 1 leaders\nBUY 5 orcs\nEND\nGIVE NEW 1 50 SILV\n\
                  unit 2391\nBUY 6 orcs\n";
    let review = review_of(&text, script);

    let formed = review
        .silver
        .iter()
        .find(|row| row.unit_id != "2390" && row.unit_id != "2391")
        .expect("the formed unit has a silver row")
        .clone();
    let bran = row_of(&review, "2391");
    assert_eq!(
        (formed.expense, bran.expense),
        (Some(38), Some(190)),
        "one orc for the formed unit and five for Bran, six in all: {formed:?} {bran:?}"
    );
    assert!(
        !review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "leaders-and-men-mixed"),
        "no leader arrives to mix with: {:?}",
        review.findings
    );
    // `ah-efb5`: the warning counts the 1 + 6 the game attempts, as the split does, and says why
    // that is not the 5 + 6 written.
    let oversubscribed: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "region-pool-oversubscribed")
        .map(|finding| finding.message.as_str())
        .collect();
    let stated = "your units here buy 7 orcs between them and this market has 6 \
                  (11 ordered, cut to what they can pay for)";
    assert_eq!(
        oversubscribed,
        vec![stated, stated],
        "one warning on each buyer: {:?}",
        review.findings
    );
}
