//! The checks that need the report as well as the text.
//!
//! Whether an order is spelled correctly is [`super::parser`]'s business. Whether the silver goes
//! round, whether anyone is left guarding the hex, whether a teacher's students are actually
//! studying - none of that can be decided from the orders document alone, and all of it is decided
//! here, from the report and the intents [`super::intents`] read out of the document.
//!
//! Two policies govern everything below, and both exist to keep the panel worth reading.
//!
//! **Never blocking.** Every finding is a warning. A syntax error means the server refuses the
//! file; a finding here means the turn plays out badly, and that is the player's call to make.
//!
//! **Accept on doubt.** Income the report cannot pin down is estimated at its most generous - every
//! man taxes, the whole region pool is ours, no other faction competes - so a shortfall is reported
//! only when the unit is short even in the best case. Anything that cannot be estimated at all
//! silences the unit's shortfall rather than guessing at it. A false warning costs the player their
//! confidence in every other line on the screen, which is a far worse trade than a missed one.

use std::collections::{BTreeMap, BTreeSet};

use super::forms::{Amount, Party, Selector};
use super::intents::{read_intents, Intent, PlacedIntent, UnitIntents};
use crate::movement::mode::{cargo_capacity, fleet_label, parse_fleet_kind, sailing_requirement};
use crate::movement::orders::MoveStep;
use crate::movement::rules::{item_spellings, Ruleset};
use crate::report::model::{ItemAmount, MarketItem, ReportRegion, ReportUnit};
use crate::report::ParsedReport;

/// The game's own currency tag.
const SILVER: &str = "SILV";

/// "Each taxing character collects $50."
const TAX_PER_MAN: i64 = 50;

/// "Each person can only teach up to 10 students in a month; additional students dilute the
/// training."
const STUDENTS_PER_TEACHER: i64 = 10;

/// An advisory check's code, as the shell, the settings and the diagnostics know it.
///
/// Constructible only through the constants in [`codes`]: the field is private and `codes` is the
/// one child module, so a finding cannot be emitted under a code that is not in `codes::ALL`. That
/// is the guarantee `ah-m9q.2` had to add by hand when `teacher-has-free-slots` shipped as a bare
/// literal missing from both this list and the shell's copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Code(&'static str);

impl Code {
    /// The kebab-case string that crosses the wire and is stored in the settings.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// Every advisory code the semantic checks can emit, in one place.
///
/// The settings UI and the client mirror this list; a new check adds its code here first.
pub mod codes {
    use super::Code;

    pub const NOT_ENOUGH_SILVER: Code = Code("not-enough-silver");
    pub const NOT_ENOUGH_ITEMS: Code = Code("not-enough-items");
    pub const GUARD_DROPPED: Code = Code("guard-dropped");
    pub const HEX_UNGUARDED: Code = Code("hex-unguarded");
    pub const TAUGHT_NOT_HERE: Code = Code("taught-not-here");
    pub const TAUGHT_NOT_STUDYING: Code = Code("taught-not-studying");
    pub const TEACHER_CANNOT_TEACH: Code = Code("teacher-cannot-teach");
    pub const TEACHING_OVERSUBSCRIBED: Code = Code("teaching-oversubscribed");
    pub const TEACHER_HAS_FREE_SLOTS: Code = Code("teacher-has-free-slots");
    pub const FORM_ALIAS_REUSED: Code = Code("form-alias-reused");
    pub const FLEET_OVERLOADED: Code = Code("fleet-overloaded");
    pub const FLEET_UNDERCREWED: Code = Code("fleet-undercrewed");
    pub const GIVE_TARGET_NOT_HERE: Code = Code("give-target-not-here");
    pub const NOT_TRADED_HERE: Code = Code("not-traded-here");
    /// Every code. This array's own order is not the settings tab's grouping (that groups by
    /// concern - Teaching / Resources / Markets / Guarding / Orders / Sailing - not by this list),
    /// but a new entry still goes last: the generated TypeScript copies this order. Until
    /// `give-target-not-here` every entry had also been last in its tab group; that one joins the
    /// existing *Orders* group instead, so the two orders are no longer in step and nothing depends
    /// on their being so.
    pub const ALL: [Code; 14] = [
        NOT_ENOUGH_SILVER,
        NOT_ENOUGH_ITEMS,
        GUARD_DROPPED,
        HEX_UNGUARDED,
        TAUGHT_NOT_HERE,
        TAUGHT_NOT_STUDYING,
        TEACHER_CANNOT_TEACH,
        TEACHING_OVERSUBSCRIBED,
        TEACHER_HAS_FREE_SLOTS,
        FORM_ALIAS_REUSED,
        FLEET_OVERLOADED,
        FLEET_UNDERCREWED,
        GIVE_TARGET_NOT_HERE,
        NOT_TRADED_HERE,
    ];
}

/// Which checks to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckOptions {
    /// Advisory codes not to emit. Unknown codes are ignored.
    pub disabled: BTreeSet<String>,
}

impl CheckOptions {
    /// Whether a check with this code should run.
    #[must_use]
    pub fn emits(&self, code: Code) -> bool {
        !self.disabled.contains(code.as_str())
    }
}

impl Default for CheckOptions {
    /// `hex-unguarded` starts disabled: most hexes are deliberately unguarded, and the
    /// wasm/tauri entry points fall back to this default when no options arrive.
    ///
    /// Off by default, and deliberately: most hexes are left unguarded on purpose, so this fires
    /// across the map and trains the player to ignore the panel. Dropping a guard you *had* is a
    /// change you probably did not mean, and that is reported either way.
    fn default() -> Self {
        Self {
            disabled: std::iter::once(codes::HEX_UNGUARDED.as_str().to_string()).collect(),
        }
    }
}

/// One thing that looks wrong about a turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub code: Code,
    pub message: String,
    /// The hex it belongs to. Every finding has one; that is what makes them filterable by hex.
    pub region_id: String,
    /// The unit at fault, where one unit is at fault.
    pub unit_id: Option<String>,
    /// The line that carries it, where a line does. A hex having no guard is nobody's line.
    pub line: Option<usize>,
    pub column_start: Option<usize>,
    pub column_end: Option<usize>,
}

/// Where the report shows each unit, by unit number, across every region it covers.
///
/// Built once for the whole report rather than per hex, because the point of the lookup is to tell
/// a mistyped unit number from a real unit standing somewhere else, and only the second of those
/// is answerable from outside the hex. Every unit the report prints is in here, ours and any
/// foreign one we can see: a gift to another faction's unit standing in our hex is ordinary.
fn where_the_report_shows_each_unit(report: &ParsedReport) -> BTreeMap<&str, &ReportRegion> {
    let mut located = BTreeMap::new();
    for region in &report.regions {
        for unit in &region.units {
            located.insert(unit.unit_id.as_str(), region);
        }
    }
    located
}

/// Checks a whole turn's orders against the report they were written for.
///
/// Only the reporting faction's units, in the hexes this turn's report covers. Allied and foreign
/// units are excluded because you cannot order them, and a warning you cannot act on is noise.
/// Hexes carried over from earlier turns are excluded for free: a parsed report holds only what
/// this turn's report said.
#[must_use]
pub fn check_turn(
    report: &ParsedReport,
    source: &str,
    ruleset: Option<&Ruleset>,
    options: CheckOptions,
) -> Vec<Finding> {
    let ordered = OrderedUnits::read(source);
    // `validate_turn` runs this on every keystroke once typing settles, so the lookup is built only
    // when the check that reads it is actually enabled - skipping a walk of every region and unit
    // in the report (the map insert per unit below, not a label - that is formatted only where a
    // finding is actually emitted) on a hot path that would otherwise pay for it with the toggle off.
    let located = if options.emits(codes::GIVE_TARGET_NOT_HERE) {
        where_the_report_shows_each_unit(report)
    } else {
        BTreeMap::new()
    };
    let mut findings = Vec::new();

    for region in &report.regions {
        let hex = Hex::read(region, &ordered);
        if hex.units.is_empty() {
            continue;
        }

        let start = findings.len();
        let ledger = ledger_for(&hex, ruleset);
        check_resources(&hex, &ledger, ruleset, &options, &mut findings);
        check_markets(&hex, ruleset, &options, &mut findings);
        check_guard(&hex, &options, &mut findings);
        check_teaching(&hex, ruleset, &options, &mut findings);
        check_forms(&hex, &options, &mut findings);
        check_transfer_targets(&hex, &located, &options, &mut findings);
        check_sailing(&hex, &ledger, ruleset, &options, &mut findings);

        // Within a hex, what sits on a line comes first and in line order; what belongs to the hex
        // itself comes last. `sort_by_key` is stable, so checks that produce several findings for
        // one line keep the order they produced them in.
        findings[start..].sort_by_key(|finding| (finding.line.is_none(), finding.line));
    }

    findings
}

/// Every unit block in the document, by unit number.
///
/// A unit written twice has both blocks read as one: the server would run them both, so charging
/// the unit for only the first would be a model of a turn nobody is playing.
struct OrderedUnits {
    by_unit: BTreeMap<String, Vec<PlacedIntent>>,
}

impl OrderedUnits {
    fn read(source: &str) -> Self {
        let mut by_unit: BTreeMap<String, Vec<PlacedIntent>> = BTreeMap::new();
        for UnitIntents {
            unit_id, intents, ..
        } in read_intents(source)
        {
            by_unit.entry(unit_id).or_default().extend(intents);
        }
        Self { by_unit }
    }

    fn get(&self, unit_id: &str) -> &[PlacedIntent] {
        self.by_unit.get(unit_id).map_or(&[], Vec::as_slice)
    }
}

/// One hex, with the units we may order in it and what they have been told to do.
struct Hex<'a> {
    region: &'a ReportRegion,
    units: Vec<Ordered<'a>>,
}

/// One of our units, and its orders.
struct Ordered<'a> {
    unit: &'a ReportUnit,
    intents: &'a [PlacedIntent],
}

impl<'a> Hex<'a> {
    fn read(region: &'a ReportRegion, ordered: &'a OrderedUnits) -> Self {
        let units = region
            .units
            .iter()
            .filter(|unit| unit.own)
            .map(|unit| Ordered {
                unit,
                intents: ordered.get(&unit.unit_id),
            })
            .collect();
        Self { region, units }
    }

    fn find(&self, unit_id: &str) -> Option<&Ordered<'a>> {
        self.units
            .iter()
            .find(|ordered| ordered.unit.unit_id == unit_id)
    }

    fn finding(&self, code: Code, message: String) -> Finding {
        Finding {
            code,
            message,
            region_id: self.region.region_id.clone(),
            unit_id: None,
            line: None,
            column_start: None,
            column_end: None,
        }
    }
}

impl Ordered<'_> {
    fn intents(&self) -> impl Iterator<Item = &Intent> {
        self.intents.iter().map(|placed| &placed.intent)
    }

    /// Whether the unit's orders take it out of the hex. Entering or leaving a structure moves it
    /// within the hex, so those steps leave it standing where it was.
    fn leaves_the_hex(&self) -> bool {
        self.intents().any(|intent| match intent {
            Intent::Move { steps } | Intent::Sail { steps } => {
                steps.iter().any(|step| matches!(step, MoveStep::Go(_)))
            }
            _ => false,
        })
    }

    /// Whether the unit will be guarding at the end of the turn. The last GUARD order wins, as it
    /// would on the server; a unit that walks away guards nothing.
    fn will_guard(&self) -> bool {
        let ordered = self
            .intents()
            .filter_map(|intent| match intent {
                Intent::Guard(on) => Some(*on),
                _ => None,
            })
            .last();

        ordered.unwrap_or(self.unit.on_guard) && !self.leaves_the_hex()
    }

    /// Whether the unit's month is already spoken for by something other than teaching.
    ///
    /// Teaching is itself a full-month order, so a unit doing anything else with its month cannot
    /// be offered as a spare teacher. Getting this wrong is not a small matter: without it, every
    /// unit in a hex where fifteen units all study is a candidate teacher for all the others, and
    /// one hex of turn 71 produced twenty-nine findings that were all the same non-observation.
    fn is_busy(&self) -> bool {
        self.intents().any(|intent| {
            matches!(
                intent,
                Intent::Study { .. }
                    | Intent::Work
                    | Intent::Entertain
                    | Intent::Tax
                    | Intent::Pillage
                    | Intent::Move { .. }
                    | Intent::Sail { .. }
                    | Intent::MonthLong(_)
            )
        })
    }

    fn skill_level(&self, tag: &str) -> u32 {
        self.unit
            .skills
            .iter()
            .find(|skill| skill.tag.eq_ignore_ascii_case(tag))
            .map_or(0, |skill| skill.level)
    }

    fn studies(&self) -> Option<&str> {
        self.intents().find_map(|intent| match intent {
            Intent::Study { skill } => Some(skill.as_str()),
            _ => None,
        })
    }

    /// Whether the unit puts its stock, silver included, at the disposal of the others in the hex.
    ///
    /// "SHARE [flag]: Instruct a unit to share its available resources with other units in the
    /// same region." The engine calls the result borrowing, and turn 71 is full of it.
    fn shares(&self) -> bool {
        self.unit
            .flags
            .iter()
            .any(|flag| flag.eq_ignore_ascii_case("sharing"))
    }

    fn holding(&self, tag: &str) -> i64 {
        self.unit
            .items
            .iter()
            .find(|item| item.tag.eq_ignore_ascii_case(tag))
            .map_or(0, |item| item.amount)
    }

    fn finding(
        &self,
        hex: &Hex<'_>,
        code: Code,
        message: String,
        at: Option<&PlacedIntent>,
    ) -> Finding {
        Finding {
            code,
            message,
            region_id: hex.region.region_id.clone(),
            unit_id: Some(self.unit.unit_id.clone()),
            line: at.map(|placed| placed.line),
            column_start: at.map(|placed| placed.column_start),
            column_end: at.map(|placed| placed.column_end),
        }
    }
}

// --- what the hex can afford -------------------------------------------------------------------

/// Everything the units in one hex hold, and what their orders would do to it.
///
/// Balances are kept per unit and per item tag, and transfers between units in the hex move
/// between them - which is what the issue means by asking whether the silver goes round.
struct Ledger<'a> {
    /// The catalogue that turns an order's item argument into a tag, where there is one.
    ruleset: Option<&'a Ruleset>,
    /// What each unit would hold once its orders had run, keyed by unit and item tag.
    balance: BTreeMap<(String, String), i64>,
    /// Units whose sums cannot be trusted, and which are therefore not judged at all.
    ///
    /// A unit lands here the moment its orders touch something the report cannot price: a
    /// withdrawal, a purchase the market does not offer, a whole class of items. Reporting a
    /// shortfall computed from a sum with a hole in it is exactly the false warning this module's
    /// header refuses to produce.
    doubted: BTreeSet<String>,
    /// The first order that drew each balance down, so a finding can point at a line.
    charged_at: BTreeMap<(String, String), PlacedIntent>,
}

/// Everything the hex's units hold, with this month's orders applied.
///
/// Built once per hex and read by two checks: `check_resources` asks whether the sums go negative,
/// `check_sailing` asks what the change of stock weighs. One ledger rather than two, because the
/// answer has to be the same one - a fleet judged against a different set of transfers from the
/// set that produced the shortfall warnings would be two models of the same turn.
fn ledger_for<'a>(hex: &Hex<'_>, ruleset: Option<&'a Ruleset>) -> Ledger<'a> {
    let mut ledger = Ledger {
        ruleset,
        balance: BTreeMap::new(),
        doubted: BTreeSet::new(),
        charged_at: BTreeMap::new(),
    };

    for ordered in &hex.units {
        for item in &ordered.unit.items {
            ledger.balance.insert(
                (ordered.unit.unit_id.clone(), item.tag.to_ascii_uppercase()),
                item.amount,
            );
        }
    }

    for ordered in &hex.units {
        for placed in ordered.intents {
            apply(&mut ledger, hex, ordered, placed, ruleset);
        }
    }

    ledger
}

fn check_resources(
    hex: &Hex<'_>,
    ledger: &Ledger<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    report_shortfalls(ledger, hex, ruleset, options, findings);
}

// --- markets: a BUY or SELL naming what this hex does not trade --------------------------------

/// Every BUY against the hex's `For Sale` list, and every SELL against its `Wanted` list: is the
/// item one this market actually trades? A separate pass rather than a hook inside `buy`/`sell`
/// (`ah-d8u`) - those build the ledger and have nothing to push a [`Finding`] to, and threading one
/// through would entangle pricing with reporting.
fn check_markets(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::NOT_TRADED_HERE) {
        return;
    }

    for ordered in &hex.units {
        for placed in ordered.intents {
            let (lines, item, verb, empty_message) = match &placed.intent {
                Intent::Buy { item, .. } => (
                    &hex.region.for_sale,
                    item,
                    "sell",
                    "this hex sells nothing at all",
                ),
                Intent::Sell { item, .. } => (
                    &hex.region.wanted,
                    item,
                    "want",
                    "this hex wants nothing at all",
                ),
                _ => continue,
            };

            let MarketAnswer::NotTraded(tag) = market_answer(lines, item, hex, ordered, ruleset)
            else {
                continue;
            };

            let message = if lines.is_empty() {
                empty_message.to_string()
            } else {
                let name = item_name(&tag, hex, ruleset);
                let has_or_wants = if verb == "sell" { "has" } else { "wants" };
                format!(
                    "this hex does not {verb} {name} — its market {has_or_wants} {}",
                    market_list(lines)
                )
            };

            findings.push(ordered.finding(hex, codes::NOT_TRADED_HERE, message, Some(placed)));
        }
    }
}

/// A market's own lines, in the report's order and the report's own spelling, joined for a
/// message: `"perfume, gems and hill dwarves"`, or just `"perfume"` for a single line.
fn market_list(lines: &[MarketItem]) -> String {
    match lines {
        [] => String::new(),
        [only] => only.name.clone(),
        [rest @ .., last] => {
            let rest = rest
                .iter()
                .map(|line| line.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            format!("{rest} and {}", last.name)
        }
    }
}

/// Applies one order to the ledger.
fn apply(
    ledger: &mut Ledger<'_>,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    ruleset: Option<&Ruleset>,
) {
    let who = &actor.unit.unit_id;

    match &placed.intent {
        Intent::Give { to, what, amount } => {
            transfer(
                ledger,
                hex,
                actor,
                placed,
                what,
                amount,
                who.clone(),
                party_id(to, hex),
            );
        }
        Intent::Take { from, what, amount } => {
            let source = party_id(from, hex);
            // "TAKE FROM 999 ALL SILV" where 999 is not in this hex takes an amount only that unit
            // knows. Crediting nothing would be a shortfall of our own invention the moment the
            // taker spends it, so the taker goes unjudged instead. A stated quantity needs no such
            // caution: the order says how much, and optimism grants it.
            if source.is_none() && matches!(amount, Amount::All { .. }) {
                ledger.doubted.insert(who.clone());
                return;
            }
            transfer(
                ledger,
                hex,
                actor,
                placed,
                what,
                amount,
                source.unwrap_or_default(),
                Some(who.clone()),
            );
        }
        Intent::Claim(amount) => credit(ledger, who, SILVER, *amount),
        Intent::Tax => {
            // "Each taxing character collects $50", capped by what the region has to give - and
            // optimistically, none of it goes to anybody else.
            let ceiling = hex.region.tax_base.unwrap_or(i64::MAX);
            credit(
                ledger,
                who,
                SILVER,
                actor.unit.men.saturating_mul(TAX_PER_MAN).min(ceiling),
            );
        }
        Intent::Pillage => match hex.region.tax_base {
            // "The amount of money collected is equal to twice the available tax money."
            Some(base) => credit(ledger, who, SILVER, base.saturating_mul(2)),
            None => {
                ledger.doubted.insert(who.clone());
            }
        },
        Intent::Buy { amount, item } => buy(ledger, hex, actor, placed, amount, item, ruleset),
        Intent::Sell { amount, item } => sell(ledger, hex, actor, placed, amount, item, ruleset),
        Intent::Study { skill } => study(ledger, actor, placed, skill, ruleset),
        // The ruleset carries no withdrawal prices. Spending an amount nobody can count is exactly
        // the case for declining to judge the unit.
        Intent::Withdraw => {
            ledger.doubted.insert(who.clone());
        }
        // Wages and takings from entertaining are paid in the last phase of the turn, after study
        // has been paid for, so they can fund nothing this month.
        Intent::Work | Intent::Entertain => {}
        Intent::Guard(_)
        | Intent::Teach { .. }
        | Intent::Move { .. }
        | Intent::MonthLong(_)
        | Intent::Form { .. } => {}
        Intent::Sail { .. } | Intent::Enter { .. } | Intent::Leave => {}
    }
}

/// The unit number a party names, when it names one of ours in this hex.
///
/// A new unit has no number yet and a foreign one is not ours, so neither can be credited. Nothing
/// is lost by that: the giver is charged either way, which is the half that can go wrong.
fn party_id(party: &Party, hex: &Hex<'_>) -> Option<String> {
    match party {
        Party::Unit(id) => hex.find(id).map(|_| id.clone()),
        Party::New(_) | Party::Foreign { .. } | Party::Discard => None,
    }
}

/// Moves goods from one unit to another. Either end may be absent - a gift out of the hex is
/// charged to the giver and credited to nobody.
#[allow(clippy::too_many_arguments)]
fn transfer(
    ledger: &mut Ledger<'_>,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    what: &Selector,
    amount: &Amount,
    from: String,
    to: Option<String>,
) {
    let Selector::Item(text) = what else {
        // A whole class of items, or the unit itself. Either moves an amount that depends on
        // classifying everything the unit holds, which is not modelled.
        ledger.doubted.insert(actor.unit.unit_id.clone());
        return;
    };

    let Some(tag) = resolve_item(text, hex, actor, ledger.ruleset) else {
        ledger.doubted.insert(actor.unit.unit_id.clone());
        return;
    };

    let quantity = match amount {
        Amount::Exact(count) => *count,
        // Giving all of something can never overdraw it, whatever the reserve.
        Amount::All { except } => (balance_of(ledger, &from, &tag) - except).max(0),
    };

    if !from.is_empty() {
        charge(ledger, &from, &tag, quantity, placed);
    }
    if let Some(to) = to {
        credit(ledger, &to, &tag, quantity);
    }
}

fn buy(
    ledger: &mut Ledger<'_>,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    amount: &Amount,
    item: &str,
    ruleset: Option<&Ruleset>,
) {
    let who = &actor.unit.unit_id;
    let Some(offer) = market(&hex.region.for_sale, item, hex, actor, ruleset) else {
        ledger.doubted.insert(who.clone());
        return;
    };

    let Amount::Exact(count) = amount else {
        // "BUY ALL" takes as many as the unit can pay for, so it cannot overdraw. What it ends up
        // holding is another matter, and not one any check here reads.
        return;
    };

    charge(
        ledger,
        who,
        SILVER,
        count.saturating_mul(offer.price),
        placed,
    );
    credit(ledger, who, &offer.tag.to_ascii_uppercase(), *count);
}

fn sell(
    ledger: &mut Ledger<'_>,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    amount: &Amount,
    item: &str,
    ruleset: Option<&Ruleset>,
) {
    let who = &actor.unit.unit_id;
    let Some(demand) = market(&hex.region.wanted, item, hex, actor, ruleset) else {
        ledger.doubted.insert(who.clone());
        return;
    };

    let tag = demand.tag.to_ascii_uppercase();
    let quantity = match amount {
        Amount::Exact(count) => *count,
        // As much as the market will take, or as much as the unit has - whichever runs out first.
        Amount::All { except } => (balance_of(ledger, who, &tag) - except)
            .max(0)
            .min(demand.amount),
    };

    charge(ledger, who, &tag, quantity, placed);
    credit(ledger, who, SILVER, quantity.saturating_mul(demand.price));
}

fn study(
    ledger: &mut Ledger<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    skill: &str,
    ruleset: Option<&Ruleset>,
) {
    let who = &actor.unit.unit_id;

    // A headcount that is a guess cannot price a study, and neither can a catalogue that does not
    // price the skill - annihilation being the one the page refuses to price at all.
    let cost = ruleset
        .filter(|_| !actor.unit.men_estimated)
        .and_then(|ruleset| ruleset.find_skill(skill))
        .and_then(|skill| skill.cost);

    match cost {
        Some(cost) => charge(
            ledger,
            who,
            SILVER,
            cost.saturating_mul(actor.unit.men),
            placed,
        ),
        None => {
            ledger.doubted.insert(who.clone());
        }
    }
}

/// What the hex's market says about an item an order names.
#[derive(Debug, PartialEq, Eq)]
enum MarketAnswer<'a> {
    /// The market trades it, on this line.
    Offered(&'a MarketItem),
    /// The item was identified and this market does not trade it. Carries the canonical tag, so
    /// a message can name the item the way the catalogue does rather than the way it was typed.
    NotTraded(String),
    /// Nothing could say what item this is - not the catalogue, not the inventories in the hex,
    /// not the market lines. Saying "this hex does not sell it" would be inventing the "it".
    Unknown,
}

/// The market line for an item, matched the same way an order's item argument is, and saying
/// which kind of no it is when there is no line.
fn market_answer<'a>(
    lines: &'a [MarketItem],
    text: &str,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    ruleset: Option<&Ruleset>,
) -> MarketAnswer<'a> {
    let Some(tag) = resolve_item(text, hex, actor, ruleset).or_else(|| {
        // A market line is itself a naming of the item, so it can settle a name no catalogue does.
        lines
            .iter()
            .find(|line| names_the_same_item(text, &line.tag, &line.name))
            .map(|line| line.tag.to_ascii_uppercase())
    }) else {
        return MarketAnswer::Unknown;
    };

    match lines
        .iter()
        .find(|line| line.tag.eq_ignore_ascii_case(&tag))
    {
        Some(line) => MarketAnswer::Offered(line),
        None => MarketAnswer::NotTraded(tag),
    }
}

/// The market line for an item, matched the same way an order's item argument is.
fn market<'a>(
    lines: &'a [MarketItem],
    text: &str,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    ruleset: Option<&Ruleset>,
) -> Option<&'a MarketItem> {
    match market_answer(lines, text, hex, actor, ruleset) {
        MarketAnswer::Offered(line) => Some(line),
        MarketAnswer::NotTraded(_) | MarketAnswer::Unknown => None,
    }
}

/// The canonical tag for an item an order names.
///
/// The catalogue settles it where there is one. Without a ruleset the inventories in the hex are
/// the next best authority, since a report names every item a unit holds by both tag and name.
/// Anything neither can identify is left unresolved rather than guessed at.
fn resolve_item(
    text: &str,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    ruleset: Option<&Ruleset>,
) -> Option<String> {
    if let Some(item) = ruleset.and_then(|ruleset| ruleset.find_item(text)) {
        return Some(item.tag.to_ascii_uppercase());
    }

    actor
        .unit
        .items
        .iter()
        .chain(
            hex.units
                .iter()
                .flat_map(|ordered| ordered.unit.items.iter()),
        )
        .find(|item| names_the_same_item(text, &item.tag, &item.name))
        .map(|item| item.tag.to_ascii_uppercase())
}

/// Whether an order's item argument names this tag or name, plural and underscores allowed.
///
/// This answers about one entry, and `resolve_item` above walks the inventories asking it entry by
/// entry - the opposite nesting to the two catalogue searches, which try each spelling across
/// everything before the next. So an inventory holding both `pearl` and `pearls` could resolve
/// `pearls` to the wrong one here where `Ruleset::find_item` would not. No such pair exists in the
/// committed catalogue, and this searches a hex's inventories rather than the catalogue, so it has
/// never mattered; it is written down because the difference is invisible until it is not.
fn names_the_same_item(text: &str, tag: &str, name: &str) -> bool {
    let written = text.replace('_', " ");
    let matched = item_spellings(&written)
        .into_iter()
        .flatten()
        .any(|spelling| tag.eq_ignore_ascii_case(spelling) || name.eq_ignore_ascii_case(spelling));
    matched
}

fn balance_of(ledger: &Ledger<'_>, unit_id: &str, tag: &str) -> i64 {
    ledger
        .balance
        .get(&(unit_id.to_string(), tag.to_string()))
        .copied()
        .unwrap_or(0)
}

fn credit(ledger: &mut Ledger<'_>, unit_id: &str, tag: &str, amount: i64) {
    *ledger
        .balance
        .entry((unit_id.to_string(), tag.to_ascii_uppercase()))
        .or_insert(0) += amount;
}

fn charge(ledger: &mut Ledger<'_>, unit_id: &str, tag: &str, amount: i64, placed: &PlacedIntent) {
    let key = (unit_id.to_string(), tag.to_ascii_uppercase());
    *ledger.balance.entry(key.clone()).or_insert(0) -= amount;
    if amount > 0 {
        // The first order to draw on it, which is where a player looking for the mistake starts.
        ledger
            .charged_at
            .entry(key)
            .or_insert_with(|| placed.clone());
    }
}

/// Silver and items a unit is short of, and what the hex's sharing units can cover for it.
///
/// The engine's `Unit::GetSharedNum` counts a unit's own holdings plus every same-faction unit in
/// the region carrying `FLAG_SHARING` - the borrower's own flag is never consulted, and every tag
/// but men (`IT_MAN`) is eligible. `DoGiveOrder`/`DoSell` draw on it for items,
/// `DoBuy`/`Do1StudyOrder` through `GetSharedMoney` for silver. Without a ruleset there is no
/// catalogue to tell men from anything else, so every tag pools - see `pooled` below.
///
/// A hex with no sharing unit judges each unit on its own, as before. A hex with one or more
/// judges every pooled tag once, against the hex: the engine drains sharers in whatever order it
/// iterates them, so which borrower "went short" is genuinely undeterminable, and blaming one of
/// several would be as wrong as blaming the treasurer for holding the purse. Sixteen units of
/// turn 71 sailed together with their money held by one of them; blaming each of the fifteen for
/// being penniless would have been fifteen wrong answers.
fn report_shortfalls(
    ledger: &Ledger<'_>,
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    let sharers: Vec<&Ordered<'_>> = hex.units.iter().filter(|o| o.shares()).collect();
    // The pool is their sum, so one sharer whose sums cannot be trusted makes the sum
    // untrustworthy - checked once here and applied after the per-unit pass below, which must
    // still run so a doubted sharer does not also silence a non-pooled (men) finding.
    let pool_trusted = !sharers
        .iter()
        .any(|o| ledger.doubted.contains(&o.unit.unit_id));
    // Without a ruleset every tag pools; with one, men never do (the engine's one exception).
    let pooled = |tag: &str| -> bool {
        !sharers.is_empty() && !ruleset.is_some_and(|ruleset| ruleset.is_man(tag))
    };

    // tag -> the overdrafts of the units that must borrow it (non-sharers; a sharer's own
    // overdraft is already inside the pool's sum, not a claim against it).
    let mut claims: BTreeMap<String, i64> = BTreeMap::new();
    // Every pooled tag any unit is short of, so the pool pass below knows what to judge.
    let mut pooled_tags: BTreeSet<String> = BTreeSet::new();

    for ordered in &hex.units {
        let who = &ordered.unit.unit_id;
        if ledger.doubted.contains(who) {
            continue;
        }

        // The ledger is keyed by unit and then by tag, so this unit's entries are one contiguous
        // run of it. Scanning the whole map of balances once per unit would be quadratic in the
        // size of a hex, and a city holds a great many units.
        let mine = ledger
            .balance
            .range((who.clone(), String::new())..)
            .take_while(|((unit_id, _), _)| unit_id == who);

        for ((unit_id, tag), balance) in mine {
            if *balance >= 0 {
                continue;
            }

            if pooled(tag) {
                pooled_tags.insert(tag.clone());
                if !ordered.shares() {
                    *claims.entry(tag.clone()).or_insert(0) += -balance;
                }
                continue;
            }

            let code = if tag == SILVER {
                codes::NOT_ENOUGH_SILVER
            } else {
                codes::NOT_ENOUGH_ITEMS
            };
            if !options.emits(code) {
                continue;
            }

            let short = -balance;
            let at = ledger.charged_at.get(&(unit_id.clone(), tag.clone()));
            let finding = if tag == SILVER {
                ordered.finding(
                    hex,
                    codes::NOT_ENOUGH_SILVER,
                    format!(
                        "short ${short}: this unit can have ${} and its orders spend ${}",
                        ordered.holding(SILVER),
                        ordered.holding(SILVER) + short,
                    ),
                    at,
                )
            } else {
                let name = item_name(tag, hex, ruleset);
                ordered.finding(
                    hex,
                    codes::NOT_ENOUGH_ITEMS,
                    format!(
                        "short {short} {name}: this unit can have {} and its orders give away or sell {}",
                        ordered.holding(tag),
                        ordered.holding(tag) + short,
                    ),
                    at,
                )
            };
            findings.push(finding);
        }
    }

    if !pool_trusted {
        return;
    }
    for tag in pooled_tags {
        let code = if tag == SILVER {
            codes::NOT_ENOUGH_SILVER
        } else {
            codes::NOT_ENOUGH_ITEMS
        };
        if !options.emits(code) {
            continue;
        }

        let pool: i64 = sharers
            .iter()
            .map(|o| balance_of(ledger, &o.unit.unit_id, &tag))
            .sum();
        let short = claims.get(&tag).copied().unwrap_or(0) - pool;
        if short <= 0 {
            continue;
        }

        // What the pool's members and its borrowers actually hold, so the message can say "they
        // can have X and their orders spend/give away Y" the way the per-unit one does.
        let held: i64 = hex
            .units
            .iter()
            .filter(|o| {
                o.shares()
                    || (!ledger.doubted.contains(&o.unit.unit_id)
                        && balance_of(ledger, &o.unit.unit_id, &tag) < 0)
            })
            .map(|o| o.holding(&tag))
            .sum();

        let message = if tag == SILVER {
            format!(
                "the units in this hex are short ${short} between them: they can have ${held} \
                 and their orders spend ${}",
                held + short,
            )
        } else {
            let name = item_name(&tag, hex, ruleset);
            format!(
                "the units in this hex are short {short} {name} between them: they can have \
                 {held} and their orders give away or sell {}",
                held + short,
            )
        };
        findings.push(hex.finding(code, message));
    }
}

/// How to write an item in a message: the catalogue's name where there is one, the tag otherwise.
fn item_name(tag: &str, hex: &Hex<'_>, ruleset: Option<&Ruleset>) -> String {
    if let Some(item) = ruleset.and_then(|ruleset| ruleset.find_item(tag)) {
        return item.name.clone();
    }
    hex.units
        .iter()
        .flat_map(|ordered| ordered.unit.items.iter())
        .find(|item: &&ItemAmount| item.tag.eq_ignore_ascii_case(tag))
        .map_or_else(|| tag.to_string(), |item| item.name.clone())
}

// --- who is left guarding ----------------------------------------------------------------------

fn check_guard(hex: &Hex<'_>, options: &CheckOptions, findings: &mut Vec<Finding>) {
    let guarded_now = hex.units.iter().any(|ordered| ordered.unit.on_guard);
    let guarded_next = hex.units.iter().any(Ordered::will_guard);

    if guarded_next {
        return;
    }

    if guarded_now {
        if options.emits(codes::GUARD_DROPPED) {
            findings.push(hex.finding(
                codes::GUARD_DROPPED,
                "this hex is guarded now and will be guarded by nobody next turn".to_string(),
            ));
        }
    } else if options.emits(codes::HEX_UNGUARDED) {
        findings.push(hex.finding(
            codes::HEX_UNGUARDED,
            "you have units here and none of them is guarding this hex".to_string(),
        ));
    }
}

// --- who is teaching whom ------------------------------------------------------------------------

fn check_teaching(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    let mut taught: BTreeSet<&str> = BTreeSet::new();
    for ordered in &hex.units {
        for intent in ordered.intents() {
            if let Intent::Teach { students } = intent {
                taught.extend(students.iter().filter_map(|student| match student {
                    Party::Unit(id) => Some(id.as_str()),
                    _ => None,
                }));
            }
        }
    }

    for ordered in &hex.units {
        check_one_teacher(hex, ordered, ruleset, options, findings);
        offer_free_slots(hex, ordered, &taught, ruleset, options, findings);
    }
}

/// Everything wrong with one unit's TEACH order.
fn check_one_teacher(
    hex: &Hex<'_>,
    teacher: &Ordered<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    let Some(placed) = teacher
        .intents
        .iter()
        .find(|placed| matches!(placed.intent, Intent::Teach { .. }))
    else {
        return;
    };
    let Intent::Teach { students } = &placed.intent else {
        return;
    };

    let mut taught_men = 0;
    for student in students {
        // A unit formed this turn has no number to look up, and another faction's unit is not in
        // this report. Neither can be judged.
        let Party::Unit(id) = student else { continue };

        let Some(pupil) = hex.find(id).filter(|pupil| !pupil.leaves_the_hex()) else {
            if options.emits(codes::TAUGHT_NOT_HERE) {
                findings.push(teacher.finding(
                    hex,
                    codes::TAUGHT_NOT_HERE,
                    format!("unit {id} is not in this hex to be taught"),
                    Some(placed),
                ));
            }
            continue;
        };

        let Some(studying) = pupil.studies() else {
            if options.emits(codes::TAUGHT_NOT_STUDYING) {
                findings.push(teacher.finding(
                    hex,
                    codes::TAUGHT_NOT_STUDYING,
                    format!("unit {id} is being taught but has no STUDY order"),
                    Some(placed),
                ));
            }
            continue;
        };

        taught_men += pupil.unit.men;

        // "In order to teach, the teacher must be at a higher level in the skill than the
        // student." Without a catalogue the skill cannot be turned into a tag, so the two levels
        // cannot be compared and the question goes unasked.
        let Some(tag) = ruleset.and_then(|ruleset| ruleset.find_skill(studying)) else {
            continue;
        };
        let theirs = pupil.skill_level(&tag.tag);
        if teacher.skill_level(&tag.tag) <= theirs && options.emits(codes::TEACHER_CANNOT_TEACH) {
            findings.push(teacher.finding(
                hex,
                codes::TEACHER_CANNOT_TEACH,
                format!(
                    "this unit is {} in {} and unit {id} is level {theirs}, so it cannot teach it",
                    describe_level(teacher.skill_level(&tag.tag)),
                    tag.name,
                ),
                Some(placed),
            ));
        }
    }

    let slots = teacher.unit.men.saturating_mul(STUDENTS_PER_TEACHER);
    if taught_men > slots && options.emits(codes::TEACHING_OVERSUBSCRIBED) {
        findings.push(teacher.finding(
            hex,
            codes::TEACHING_OVERSUBSCRIBED,
            format!("{taught_men} students on {slots} slots, so each gets less than a full month",),
            Some(placed),
        ));
    }
}

fn describe_level(level: u32) -> String {
    if level == 0 {
        "not skilled".to_string()
    } else {
        format!("level {level}")
    }
}

/// The issue's own example: a teacher with slots going spare while somebody studies untaught.
///
/// At most one finding per teacher, however many students it could take. A finding per pairing is
/// a cross-product, and in a hex full of soldiers all learning the same skill that is dozens of
/// lines saying one thing.
fn offer_free_slots(
    hex: &Hex<'_>,
    teacher: &Ordered<'_>,
    taught: &BTreeSet<&str>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::TEACHER_HAS_FREE_SLOTS) {
        return;
    }
    let Some(ruleset) = ruleset else { return };
    // Teaching takes the whole month, so a unit spending its month otherwise is not free to teach.
    if teacher.is_busy() {
        return;
    }

    let free = teacher.unit.men.saturating_mul(STUDENTS_PER_TEACHER) - taught_by(teacher, hex);
    if free <= 0 {
        return;
    }

    let could_take: Vec<&Ordered<'_>> = hex
        .units
        .iter()
        .filter(|pupil| {
            if pupil.unit.unit_id == teacher.unit.unit_id
                || taught.contains(pupil.unit.unit_id.as_str())
                || pupil.leaves_the_hex()
            {
                return false;
            }
            pupil
                .studies()
                .and_then(|studying| ruleset.find_skill(studying))
                .is_some_and(|skill| {
                    teacher.skill_level(&skill.tag) > pupil.skill_level(&skill.tag)
                })
        })
        .collect();

    let Some(first) = could_take.first() else {
        return;
    };
    let others = could_take.len() - 1;
    let and_others = match others {
        0 => String::new(),
        1 => " and 1 other".to_string(),
        _ => format!(" and {others} others"),
    };

    findings.push(
        teacher.finding(
            hex,
            codes::TEACHER_HAS_FREE_SLOTS,
            format!(
                "this unit has {free} teaching slots free and could teach unit {}{and_others}",
                first.unit.unit_id,
            ),
            teacher
                .intents
                .iter()
                .find(|placed| matches!(placed.intent, Intent::Teach { .. })),
        ),
    );
}

/// How many student-men a teacher has already taken on.
fn taught_by(teacher: &Ordered<'_>, hex: &Hex<'_>) -> i64 {
    teacher
        .intents()
        .filter_map(|intent| match intent {
            Intent::Teach { students } => Some(students),
            _ => None,
        })
        .flatten()
        .filter_map(|student| match student {
            Party::Unit(id) => hex.find(id),
            _ => None,
        })
        .map(|pupil| pupil.unit.men)
        .sum()
}

// --- FORM aliases --------------------------------------------------------------------------------

/// Every FORM in the hex, in document order; each alias after its first use is a block the server
/// will refuse (the alias is per region for the month — see the rules on FORM), and says so on
/// its own line, naming the first use. The first FORM is the one that will exist and is left alone.
fn check_forms(hex: &Hex<'_>, options: &CheckOptions, findings: &mut Vec<Finding>) {
    if !options.emits(codes::FORM_ALIAS_REUSED) {
        return;
    }
    // (alias, forming unit, the FORM's placement), every FORM in the hex, by line.
    let mut forms: Vec<(&str, &Ordered<'_>, &PlacedIntent)> = hex
        .units
        .iter()
        .flat_map(|ordered| {
            ordered
                .intents
                .iter()
                .filter_map(move |placed| match &placed.intent {
                    Intent::Form { alias } => Some((alias.as_str(), ordered, placed)),
                    _ => None,
                })
        })
        .collect();
    forms.sort_by_key(|(_, _, placed)| placed.line);

    let mut first_use: BTreeMap<&str, (&Ordered<'_>, &PlacedIntent)> = BTreeMap::new();
    for (alias, ordered, placed) in forms {
        match first_use.get(alias) {
            None => {
                first_use.insert(alias, (ordered, placed));
            }
            Some((first_unit, first)) => {
                let where_ = if first_unit.unit.unit_id == ordered.unit.unit_id {
                    format!("line {}", first.line)
                } else {
                    format!("unit {} (line {})", first_unit.unit.unit_id, first.line)
                };
                findings.push(ordered.finding(
                    hex,
                    codes::FORM_ALIAS_REUSED,
                    format!(
                        "FORM {alias} again: {where_} already forms NEW {alias} in this hex, so this block is refused"
                    ),
                    Some(placed),
                ));
            }
        }
    }
}

/// Whether the unit is aboard `fleet_id` once this month's ENTER/LEAVE orders have run: the
/// report's own structure first, then the last of this unit's ENTER/LEAVE intents in document
/// order - which is the order the server itself would apply them in.
fn is_aboard(ordered: &Ordered<'_>, fleet_id: &str) -> bool {
    let mut aboard = ordered.unit.structure_id.as_deref() == Some(fleet_id);
    for placed in ordered.intents {
        match &placed.intent {
            Intent::Enter { structure } => aboard = structure == fleet_id,
            Intent::Leave => aboard = false,
            _ => {}
        }
    }
    aboard
}

/// Whether the unit could be giving the SAIL order for `fleet_id`: standing in it per the report,
/// or boarding it this month. A unit that also LEAVEs is not excluded here - the server would
/// still read its SAIL line before running the LEAVE.
fn could_captain(ordered: &Ordered<'_>, fleet_id: &str) -> bool {
    ordered.unit.structure_id.as_deref() == Some(fleet_id)
        || ordered.intents.iter().any(
            |placed| matches!(&placed.intent, Intent::Enter { structure } if structure == fleet_id),
        )
}

/// What one unit weighs when the fleet sails: the weight the report gave it, plus everything this
/// month's orders move into or out of it that the ruleset can price.
///
/// The ledger is read whole rather than filtered, because every order that changes an item balance
/// runs before the fleet does: GIVE and TAKE in phase 4, SELL and BUY in phase 7, movement in
/// phase 9. TAX, CLAIM, PILLAGE and STUDY move silver, which the ruleset weighs at 0; PRODUCE,
/// BUILD and WORK are phase 10, after the fleet has gone, and touch no balance here anyway.
///
/// An order the ledger could not price changed no balance at all - `transfer`, `buy` and the
/// WITHDRAW arm record their doubt and return before charging anything - so it contributes nothing
/// here and the unit keeps the report's weight for that part. That is the navigator's answer to
/// "silence or fall back": fall back. `None` only when the report never said what the unit weighs.
fn weight_at_sailing(
    ordered: &Ordered<'_>,
    ledger: &Ledger<'_>,
    ruleset: Option<&Ruleset>,
) -> Option<i64> {
    let mut weight = ordered.unit.weight?;

    for ((unit_id, tag), balance) in &ledger.balance {
        if unit_id != &ordered.unit.unit_id {
            continue;
        }
        let moved = balance - ordered.holding(tag);
        if moved == 0 {
            continue;
        }
        if let Some(item) = ruleset.and_then(|ruleset| ruleset.find_item(tag)) {
            weight = weight.saturating_add(moved.saturating_mul(item.weight));
        }
    }

    Some(weight)
}

// --- gifts and takings ---------------------------------------------------------------------------

/// Every GIVE and TAKE one of our units gives whose counterparty is a unit number: is that unit in
/// this hex to receive the goods, or to be taken from? The engine refuses the order outright when
/// it is not - `GIVE: Nonexistant target (N).` - and says so only once the turn has run. GIVE and
/// TAKE are phase 4, before anything moves in phase 9, so the hex the report prints a unit in is
/// the hex the transfer will look for it in.
///
/// The test is against every unit the report shows in this region, not against `hex.find`, which
/// sees only our own: giving to another faction's unit standing here is legal and ordinary.
///
/// A unit the report shows somewhere else has that region named, because a courier that has moved
/// and a mistyped number are different mistakes with different fixes. NEW, FACTION n NEW and unit
/// zero name nothing the report could show, and are passed over rather than guessed at.
fn check_transfer_targets(
    hex: &Hex<'_>,
    located: &BTreeMap<&str, &ReportRegion>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::GIVE_TARGET_NOT_HERE) {
        return;
    }

    for ordered in &hex.units {
        for placed in ordered.intents {
            let (party, verb) = match &placed.intent {
                Intent::Give { to, .. } => (to, "given to"),
                Intent::Take { from, .. } => (from, "taken from"),
                _ => continue,
            };
            let Party::Unit(id) = party else { continue };
            if hex.region.units.iter().any(|unit| &unit.unit_id == id) {
                continue;
            }

            // The label is only ever formatted here, on the rare path that actually emits a
            // finding - `located` itself carries just a region reference per unit, so the common
            // case (nothing wrong) never allocates a label string per unit in the report.
            let message = match located.get(id.as_str()) {
                Some(region) => format!(
                    "unit {id} is not in this hex to be {verb} - your report shows it in {}",
                    region.label()
                ),
                None => format!(
                    "unit {id} is not in this hex to be {verb}, and appears nowhere else in \
                     your report"
                ),
            };
            findings.push(ordered.finding(hex, codes::GIVE_TARGET_NOT_HERE, message, Some(placed)));
        }
    }
}

/// Every fleet in the hex that one of our units orders to SAIL: is what is aboard within what the
/// hull carries, and is enough sailing skill aboard to sail it? Aboard means the report's units in
/// the fleet, plus those that ENTER it this month, minus those that LEAVE - the instant orders the
/// server runs before anything moves. Each of them is weighed at what this month's orders leave it
/// holding (`weight_at_sailing`), not at what the report printed, because the server runs every
/// transfer and every market order before it moves a fleet. Skills are still the report's own.
/// Two different kinds of "cannot price" behave differently, deliberately: a MOVE touching the
/// fleet, a foreign unit aboard, or a report that never states a unit's weight silences the whole
/// fleet - never a guess. A single transfer the ledger or the ruleset cannot price (a WITHDRAW, an
/// item with no catalogue weight) instead falls back to that unit's report weight for its own
/// contribution (`weight_at_sailing`'s doc comment), rather than silencing the fleet outright.
fn check_sailing(
    hex: &Hex<'_>,
    ledger: &Ledger<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    for fleet in &hex.region.structures {
        if parse_fleet_kind(&fleet.kind).is_none() {
            continue;
        }

        let captain = hex
            .units
            .iter()
            .filter(|ordered| could_captain(ordered, &fleet.structure_id))
            .filter_map(|ordered| {
                ordered
                    .intents
                    .iter()
                    .find(|placed| matches!(placed.intent, Intent::Sail { .. }))
                    .map(|placed| (ordered, placed))
            })
            .min_by_key(|(_, placed)| placed.line);
        let Some((captain, sail_placement)) = captain else {
            continue;
        };

        let aboard: Vec<&Ordered<'_>> = hex
            .units
            .iter()
            .filter(|ordered| is_aboard(ordered, &fleet.structure_id))
            .collect();

        // A MOVE by anyone aboard, or a MOVE that steps into this fleet, leaves the server's
        // ordering against the SAIL unpromised - doubt, not a guess. `MOVE IN` with no number
        // enters whatever single structure the server finds in the hex, which may be this one, so
        // it counts as touching every fleet here rather than none of them.
        let move_touches_fleet = hex.units.iter().any(|ordered| {
            ordered.intents.iter().any(|placed| match &placed.intent {
                Intent::Move { steps } => steps.iter().any(|step| match step {
                    MoveStep::In(None) => true,
                    MoveStep::In(Some(id)) => id == &fleet.structure_id,
                    _ => false,
                }),
                _ => false,
            })
        });
        let aboard_unit_moves = aboard.iter().any(|ordered| {
            ordered
                .intents
                .iter()
                .any(|placed| matches!(placed.intent, Intent::Move { .. }))
        });
        // A unit of another faction standing in the same hull is not ours to weigh or to train.
        let foreign_aboard = hex.region.units.iter().any(|unit| {
            !unit.own && unit.structure_id.as_deref() == Some(fleet.structure_id.as_str())
        });

        if move_touches_fleet || aboard_unit_moves || foreign_aboard {
            continue;
        }

        let label = fleet_label(fleet);

        // What the report says is in the hull now, before this month's ENTER and LEAVE. On a real
        // report this is the first number of the ship line's `Load: H/N`: the server computes it
        // the same way, as the sum of the weights of the units standing in the hull. Checked
        // against two committed reports - Longship [329] states 110 and holds 50 + 50 + 10
        // (neworigins-3.0.0-g3-f42-t41.rep:2018), Raft [235] states 220 and holds 20 + 200
        // (neworigins-3.0.0-g5-f21-t24.rep:1359). Summed here rather than read off the `Load:`
        // line so that a fleet whose report states no load still gets a first number, and so that
        // a report disagreeing with its own units cannot make the message claim that weight moved
        // when nothing did.
        let reported: Option<i64> = hex
            .units
            .iter()
            .filter(|ordered| {
                ordered.unit.structure_id.as_deref() == Some(fleet.structure_id.as_str())
            })
            .map(|ordered| ordered.unit.weight)
            .sum();

        let sailing: Option<i64> = aboard
            .iter()
            .map(|ordered| weight_at_sailing(ordered, ledger, ruleset))
            .sum();

        if let (Some(load), Some(capacity)) = (sailing, cargo_capacity(fleet, ruleset)) {
            if load > capacity && options.emits(codes::FLEET_OVERLOADED) {
                let overload = match reported.map(|reported| (reported, load - reported)) {
                    Some((reported, change)) if change > 0 => format!(
                        "{reported} aboard plus {change} loaded this month, \
                         on a capacity of {capacity}"
                    ),
                    Some((reported, change)) if change < 0 => format!(
                        "{reported} aboard less {} unloaded this month, on a capacity of {capacity}",
                        -change
                    ),
                    // Nothing moved, or a unit in the hull whose weight the report never gave, so
                    // there is no honest before-and-after to draw. `ah-j0e`'s own sentence.
                    _ => format!("{load} aboard on a capacity of {capacity}"),
                };
                findings.push(captain.finding(
                    hex,
                    codes::FLEET_OVERLOADED,
                    format!("{label} is overloaded: {overload}, so it will not sail"),
                    Some(sail_placement),
                ));
            }
        }

        let levels: i64 = aboard
            .iter()
            .flat_map(|ordered| ordered.unit.skills.iter())
            .filter(|skill| skill.tag.eq_ignore_ascii_case("SAIL"))
            .map(|skill| i64::from(skill.level))
            .sum();
        if let Some(required) = sailing_requirement(fleet, ruleset) {
            if levels < required && options.emits(codes::FLEET_UNDERCREWED) {
                findings.push(captain.finding(
                    hex,
                    codes::FLEET_UNDERCREWED,
                    format!(
                        "{label} is short of sailors: {levels} sailing levels aboard, it needs \
                         {required}, so it will not sail"
                    ),
                    Some(sail_placement),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::{Coordinate, Skill, Structure};

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
    }

    // --- fixtures ---------------------------------------------------------------------------

    fn region(units: Vec<ReportUnit>) -> ReportRegion {
        ReportRegion {
            region_id: "1:7,53".to_string(),
            coordinate: Coordinate { x: 7, y: 53, z: 1 },
            terrain: "mountain".to_string(),
            province: "Inhead".to_string(),
            population: Some(1000),
            race: Some("humans".to_string()),
            units,
            ..Default::default()
        }
    }

    fn unit(id: &str) -> ReportUnit {
        ReportUnit {
            unit_id: id.to_string(),
            name: format!("Unit {id}"),
            region_id: "1:7,53".to_string(),
            faction_id: Some("95".to_string()),
            faction_name: Some("Ours".to_string()),
            own: true,
            men: 1,
            // The checks that price a study are entitled to an exact headcount, so the fixtures
            // give them one; `an_estimated_headcount_prices_no_study` covers the other case.
            men_estimated: false,
            ..Default::default()
        }
    }

    fn with_silver(mut unit: ReportUnit, amount: i64) -> ReportUnit {
        unit.items.push(ItemAmount {
            amount,
            name: "silver".to_string(),
            tag: SILVER.to_string(),
        });
        unit
    }

    fn with_item(mut unit: ReportUnit, amount: i64, name: &str, tag: &str) -> ReportUnit {
        unit.items.push(ItemAmount {
            amount,
            name: name.to_string(),
            tag: tag.to_string(),
        });
        unit
    }

    fn with_men(mut unit: ReportUnit, men: i64) -> ReportUnit {
        unit.men = men;
        unit
    }

    fn with_skill(mut unit: ReportUnit, tag: &str, level: u32) -> ReportUnit {
        unit.skills.push(Skill {
            name: tag.to_lowercase(),
            tag: tag.to_string(),
            level,
            points: 0,
        });
        unit
    }

    /// A longship, stated exactly as the fixture reports write one: `Load: 110/150; Sailors:
    /// 4/4; MaxSpeed: 4.`
    fn longship(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Ship".to_string(),
            kind: "Longship".to_string(),
            description: Some("Load: 110/150; Sailors: 4/4; MaxSpeed: 4.".to_string()),
            needs: None,
        }
    }

    fn sail(level: u32) -> Skill {
        Skill {
            name: "sailing".to_string(),
            tag: "SAIL".to_string(),
            level,
            points: 0,
        }
    }

    fn report(regions: Vec<ReportRegion>) -> ParsedReport {
        ParsedReport {
            regions,
            ..Default::default()
        }
    }

    /// Runs the checks with the committed ruleset, which is what the shell serves.
    fn check(regions: Vec<ReportRegion>, orders: &str) -> Vec<Finding> {
        check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            CheckOptions::default(),
        )
    }

    /// `check`, with `give-target-not-here` also disabled.
    ///
    /// A raft of resource-ledger fixtures below give or take from unit numbers ("7", "999", ...)
    /// chosen only to be absent from the report - that is what lets them test "a recipient outside
    /// the hex is not credited" without also standing up a whole second region. `give-target-not-here`
    /// is built for exactly that shape and now fires on every one of them; real, but not what these
    /// tests are about, so it is turned off here rather than folded into every fixture below.
    fn check_ignoring_transfer_targets(regions: Vec<ReportRegion>, orders: &str) -> Vec<Finding> {
        check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            disabling(codes::GIVE_TARGET_NOT_HERE),
        )
    }

    fn codes(findings: &[Finding]) -> Vec<&str> {
        findings
            .iter()
            .map(|finding| finding.code.as_str())
            .collect()
    }

    /// The `Code` newtype is the string the shell, the settings and the diagnostics all know -
    /// constructible only through `codes::*`, so a finding can no longer be emitted under a bare
    /// literal missing from `codes::ALL` (ah-m9q.2's `teacher-has-free-slots` gap).
    #[test]
    fn a_code_is_the_string_the_shell_and_the_settings_know() {
        let code: Code = codes::HEX_UNGUARDED;
        assert_eq!(code.as_str(), "hex-unguarded");
        assert_eq!(code.to_string(), "hex-unguarded");
    }

    fn only(findings: Vec<Finding>) -> Finding {
        assert_eq!(findings.len(), 1, "expected one finding: {findings:?}");
        findings.into_iter().next().expect("just counted")
    }

    // --- coverage ---------------------------------------------------------------------------

    #[test]
    fn a_foreign_unit_is_never_checked() {
        let mut theirs = with_silver(unit("900"), 0);
        theirs.own = false;
        theirs.faction_id = Some("15".to_string());

        assert_eq!(
            check(vec![region(vec![theirs])], "unit 900\nGIVE 5 100 SILV\n"),
            vec![],
            "you cannot order it, so a warning about it is noise"
        );
    }

    #[test]
    fn a_unit_the_report_does_not_have_is_not_checked() {
        assert_eq!(
            check(vec![region(vec![])], "unit 4242\nGIVE 5 100 SILV\n"),
            vec![],
        );
    }

    #[test]
    fn a_turn_with_nothing_wrong_says_nothing() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 500)])],
                "unit 5\nGIVE 7 100 SILV\n"
            ),
            vec![]
        );
    }

    // --- silver -----------------------------------------------------------------------------

    #[test]
    fn a_unit_giving_away_more_silver_than_it_holds_is_warned_about() {
        let finding = only(check_ignoring_transfer_targets(
            vec![region(vec![with_silver(unit("5"), 40)])],
            "unit 5\nGIVE 7 100 SILV\n",
        ));

        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(finding.unit_id.as_deref(), Some("5"));
        assert_eq!(finding.region_id, "1:7,53");
        assert!(
            finding.message.contains("60"),
            "the message names the shortfall: {}",
            finding.message
        );
    }

    /// The heart of the issue: "is there enough silver to go around for everyone in the hex given
    /// what they plan to do". Silver handed over in the give phase is spendable in the buy phase,
    /// so the recipient is credited before its own spending is judged.
    #[test]
    fn silver_given_inside_the_hex_is_credited_to_the_unit_receiving_it() {
        let regions = vec![region(vec![
            with_silver(unit("5"), 500),
            with_men(with_silver(unit("7"), 0), 2),
        ])];

        assert_eq!(
            check(regions, "unit 5\nGIVE 7 100 SILV\nunit 7\nSTUDY combat\n").len(),
            0,
            "unit 7 has 100 to spend and combat costs 10 a man"
        );
    }

    #[test]
    fn a_recipient_outside_the_hex_is_charged_to_the_giver_and_credited_to_nobody() {
        let elsewhere = ReportRegion {
            region_id: "1:9,51".to_string(),
            coordinate: Coordinate { x: 9, y: 51, z: 1 },
            ..region(vec![])
        };
        let mut far = with_silver(unit("7"), 0);
        far.region_id = "1:9,51".to_string();
        far.men = 2;

        let regions = vec![
            region(vec![with_silver(unit("5"), 500)]),
            ReportRegion {
                units: vec![far],
                ..elsewhere
            },
        ];

        let finding = only(check_ignoring_transfer_targets(
            regions,
            "unit 5\nGIVE 7 100 SILV\nunit 7\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.unit_id.as_deref(),
            Some("7"),
            "the giver could afford it; the distant recipient is not credited"
        );
    }

    #[test]
    fn a_take_moves_silver_the_other_way() {
        let regions = vec![region(vec![
            with_silver(unit("5"), 0),
            with_silver(unit("7"), 500),
        ])];

        // Unit 5 starts with nothing, so without the take being counted it could not give the 100
        // away - which is what makes this test say anything about TAKE at all.
        assert_eq!(
            check_ignoring_transfer_targets(
                regions,
                "unit 5\nTAKE FROM 7 100 SILV\nGIVE 8 100 SILV\n"
            ),
            vec![]
        );
    }

    /// How much "ALL" is depends on what the other unit holds, and a unit outside the hex does not
    /// say. Crediting nothing would invent a shortfall the moment the taker spent it.
    #[test]
    fn taking_all_of_something_from_outside_the_hex_leaves_the_taker_unjudged() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nTAKE FROM 999 ALL SILV\nGIVE 8 100 SILV\n"
            ),
            vec![]
        );
    }

    /// A stated quantity needs no such caution: the order says how much, and optimism grants it.
    /// Without this pairing the rule above would read as "any TAKE silences the unit".
    #[test]
    fn taking_a_stated_amount_from_outside_the_hex_is_still_counted() {
        let finding = only(check_ignoring_transfer_targets(
            vec![region(vec![with_silver(unit("5"), 0)])],
            "unit 5\nTAKE FROM 999 10 SILV\nGIVE 8 100 SILV\n",
        ));

        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert!(
            finding.message.contains("90"),
            "$10 taken against $100 given leaves it $90 short: {}",
            finding.message
        );
    }

    #[test]
    fn claimed_silver_is_money_the_unit_has() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\n@claim 200\nGIVE 7 100 SILV\n"
            ),
            vec![]
        );
    }

    // --- units that share ---------------------------------------------------------------------
    //
    // "SHARE [flag]: Instruct a unit to share its available resources with other units in the same
    // region." The engine calls it borrowing, and says so in the report: turn 71 carries the line
    // "Seven of Eight (13401): Borrows 50 silver [SILV] from Nine of Eight (13403)".
    //
    // Without this, sixteen units of that turn - a fleet whose purse is held by one of them - each
    // reported a shortfall for a study the game paid for without complaint.
    //
    // The engine's `Unit::GetSharedNum` counts the unit itself plus every same-faction unit in
    // the region carrying `FLAG_SHARING` - the borrower's own flag is not consulted, so a
    // non-sharer may draw on a sharer just as freely as a sharer may draw on another.

    fn sharing(mut unit: ReportUnit) -> ReportUnit {
        unit.flags.push("sharing".to_string());
        unit
    }

    #[test]
    fn a_sharing_unit_may_draw_on_the_purse_of_others_sharing_in_the_hex() {
        let regions = vec![region(vec![
            sharing(with_men(with_silver(unit("5"), 0), 2)),
            sharing(with_silver(unit("7"), 500)),
        ])];

        assert_eq!(
            check(regions, "unit 5\nSTUDY combat\n"),
            vec![],
            "unit 7 is sharing, so unit 5 can borrow the $20 from it"
        );
    }

    /// The engine's `GetSharedNum` counts the unit itself plus every same-faction unit in the
    /// region carrying `FLAG_SHARING` — the borrower's own flag is never consulted.
    #[test]
    fn a_unit_that_does_not_share_may_still_draw_on_one_that_does() {
        let regions = vec![region(vec![
            with_men(with_silver(unit("5"), 0), 2),
            sharing(with_silver(unit("7"), 500)),
        ])];

        assert_eq!(
            check(regions, "unit 5\nSTUDY combat\n"),
            vec![],
            "unit 7 shares, so unit 5 can borrow the $20 from it even though unit 5 does not share"
        );
    }

    #[test]
    fn a_sharing_unit_cannot_borrow_from_one_that_keeps_its_purse_shut() {
        let regions = vec![region(vec![
            sharing(with_men(with_silver(unit("5"), 0), 2)),
            with_silver(unit("7"), 500),
        ])];

        assert_eq!(
            codes(&check(regions, "unit 5\nSTUDY combat\n")),
            ["not-enough-silver"]
        );
    }

    /// When the shared purse itself runs dry, it is the hex that is short and not any one unit:
    /// picking one of them to blame would send the player to a unit that did nothing wrong.
    #[test]
    fn a_shared_purse_that_runs_dry_is_the_hex_s_problem() {
        let regions = vec![region(vec![
            sharing(with_men(with_silver(unit("5"), 0), 10)),
            sharing(with_silver(unit("7"), 30)),
        ])];

        let finding = only(check(regions, "unit 5\nSTUDY combat\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.unit_id, None,
            "the purse is shared, so the shortfall is too"
        );
        assert_eq!(finding.line, None);
        assert!(
            finding.message.contains("short $70")
                && finding.message.contains("the units in this hex"),
            "it names the shortfall and says whose it is: {}",
            finding.message
        );
    }

    /// One unit whose sums cannot be trusted makes the whole purse untrustworthy, because the
    /// purse is their sum.
    #[test]
    fn a_doubted_unit_silences_the_purse_it_shares() {
        let regions = vec![region(vec![
            sharing(with_men(with_silver(unit("5"), 0), 10)),
            sharing(with_silver(unit("7"), 30)),
        ])];

        assert_eq!(
            check(regions, "unit 5\nSTUDY combat\nunit 7\nWITHDRAW 10 grain\n"),
            vec![]
        );
    }

    #[test]
    fn giving_all_of_something_can_never_overdraw_it() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 40)])],
                "unit 5\nGIVE 7 ALL SILV\n"
            ),
            vec![]
        );
    }

    /// A study costs the scraped price times the unit's men: "Most skills cost $10 per person per
    /// month to study", and combat is one of those.
    #[test]
    fn a_study_is_priced_per_man_from_the_scraped_cost() {
        let regions = vec![region(vec![with_men(with_silver(unit("5"), 50), 10)])];

        let finding = only(check(regions, "unit 5\nSTUDY combat\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert!(
            finding.message.contains("100"),
            "ten men at $10 is $100: {}",
            finding.message
        );
    }

    #[test]
    fn a_magic_study_is_priced_at_what_the_page_says_it_costs() {
        // "Magic skills (which cost $100)". One man studying force costs 100.
        let regions = vec![region(vec![with_silver(unit("5"), 50)])];

        assert_eq!(
            codes(&check(regions, "unit 5\nSTUDY force\n")),
            ["not-enough-silver"]
        );
    }

    #[test]
    fn a_purchase_is_priced_from_the_hex_s_own_market() {
        let mut hex = region(vec![with_silver(unit("5"), 100)]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 70,
        });

        let finding = only(check(vec![hex], "unit 5\nBUY 2 horses\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert!(finding.message.contains("140"), "{}", finding.message);
    }

    #[test]
    fn a_sale_pays_what_the_market_wants_to_pay() {
        let mut hex = region(vec![with_item(
            with_silver(unit("5"), 0),
            10,
            "grain",
            "GRAI",
        )]);
        hex.wanted.push(MarketItem {
            amount: 20,
            name: "grain".to_string(),
            tag: "GRAI".to_string(),
            price: 30,
        });
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 70,
        });

        assert_eq!(
            check(vec![hex], "unit 5\nSELL 10 grain\nBUY 4 horses\n"),
            vec![],
            "300 earned covers 280 spent"
        );
    }

    // --- income the report cannot pin down --------------------------------------------------

    /// Optimism, made concrete: five men could tax $250 if the whole tax base were theirs, so a
    /// $200 purchase is affordable in the best case and goes unremarked.
    #[test]
    fn a_taxing_unit_is_credited_the_most_it_could_possibly_collect() {
        let mut hex = region(vec![with_men(with_silver(unit("5"), 0), 5)]);
        hex.tax_base = Some(500);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 50,
        });

        assert_eq!(check(vec![hex], "unit 5\nTAX\nBUY 4 horses\n"), vec![]);
    }

    /// The other side of the same coin: optimism is a bound, not a blank cheque. Short even at
    /// best is short.
    #[test]
    fn a_taxing_unit_short_even_at_its_best_is_still_warned_about() {
        let mut hex = region(vec![with_men(with_silver(unit("5"), 0), 5)]);
        hex.tax_base = Some(100);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 50,
        });

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nTAX\nBUY 4 horses\n")),
            ["not-enough-silver"],
            "the whole $100 base could not buy $200 of men"
        );
    }

    /// Wages are paid in the last phase of the turn, after study is paid for. A unit that works
    /// cannot spend this month's wages this month, so working credits it nothing.
    #[test]
    fn wages_earned_this_month_do_not_pay_for_this_month() {
        let mut hex = region(vec![with_men(with_silver(unit("5"), 0), 10)]);
        hex.wages = Some("$12.0".to_string());
        hex.max_wages = Some(300);

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nWORK\nSTUDY combat\n")),
            ["not-enough-silver"]
        );
    }

    /// The ruleset carries no withdrawal prices, so a unit that withdraws spends an amount nobody
    /// can count. Silence is the only honest answer.
    #[test]
    fn a_unit_spending_an_amount_we_cannot_price_is_left_alone() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nWITHDRAW 10 grain\nGIVE 7 100 SILV\n"
            ),
            vec![]
        );
    }

    /// The catalogue knows what a horse is; this hex is simply not selling any. Without a price
    /// there is no sum, and without a sum there is nothing to be short of. `not-traded-here` is
    /// disabled here because it now fires on this same order (`ah-d8u`); this test is about the
    /// pricing/doubted behaviour, not the new warning, which has its own tests below.
    #[test]
    fn a_purchase_the_hex_does_not_offer_is_not_priced_and_not_judged() {
        assert_eq!(
            check_turn(
                &report(vec![region(vec![with_silver(unit("5"), 0)])]),
                "unit 5\nBUY 5 horses\n",
                Some(&ruleset()),
                disabling(codes::NOT_TRADED_HERE),
            ),
            vec![],
            "the market has no price for it, so there is no sum to check"
        );
    }

    /// Handing over a whole class of items moves an amount that depends on classifying every item
    /// the unit holds. Until that is modelled, the unit's silver is not judged at all.
    #[test]
    fn giving_a_whole_class_of_items_silences_the_unit() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nGIVE 7 ALL ITEMS\nGIVE 8 100 SILV\n"
            ),
            vec![]
        );
    }

    /// A headcount that is a guess cannot price a study. Estimates come from a report parsed
    /// without a catalogue, and a unit holding two races is counted wrong.
    #[test]
    fn an_estimated_headcount_prices_no_study() {
        let mut guessing = with_silver(unit("5"), 0);
        guessing.men = 10;
        guessing.men_estimated = true;

        assert_eq!(
            check(vec![region(vec![guessing])], "unit 5\nSTUDY combat\n"),
            vec![]
        );
    }

    #[test]
    fn without_a_ruleset_a_study_is_not_priced() {
        let regions = vec![region(vec![with_silver(unit("5"), 0)])];

        assert_eq!(
            check_turn(
                &report(regions),
                "unit 5\nSTUDY combat\n",
                None,
                CheckOptions::default()
            ),
            vec![]
        );
    }

    // --- items other than silver ------------------------------------------------------------

    #[test]
    fn a_unit_giving_away_more_of_an_item_than_it_holds_is_warned_about() {
        let regions = vec![region(vec![with_item(unit("5"), 3, "sword", "SWOR")])];

        let finding = only(check_ignoring_transfer_targets(
            regions,
            "unit 5\nGIVE 7 10 swords\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert!(finding.message.contains("sword"), "{}", finding.message);
        assert!(
            finding.message.contains("give away or sell"),
            "a SELL also charges the item: {}",
            finding.message
        );
    }

    #[test]
    fn items_given_between_units_in_the_hex_go_round() {
        let regions = vec![region(vec![
            with_item(unit("5"), 10, "sword", "SWOR"),
            unit("7"),
        ])];

        assert_eq!(
            check_ignoring_transfer_targets(
                regions,
                "unit 5\nGIVE 7 10 swords\nunit 7\nGIVE 8 10 SWOR\n"
            ),
            vec![],
            "unit 7 has the swords it was given"
        );
    }

    #[test]
    fn an_item_nobody_can_identify_is_not_counted() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![unit("5")])],
                "unit 5\nGIVE 7 10 widgets\n"
            ),
            vec![],
            "the catalogue has no widget, so there is nothing to count against"
        );
    }

    // --- items pool like silver does -------------------------------------------------------

    #[test]
    fn a_sharing_unit_s_stock_covers_a_neighbour_that_gives_it_away() {
        let regions = vec![region(vec![
            unit("5"),
            sharing(with_item(unit("7"), 10, "sword", "SWOR")),
        ])];

        assert_eq!(
            check_ignoring_transfer_targets(regions, "unit 5\nGIVE 9 10 swords\n"),
            vec![],
            "unit 7 shares its swords, so unit 5 can give away 10 of them"
        );
    }

    #[test]
    fn a_sharing_unit_s_stock_covers_a_neighbour_that_sells_it() {
        let mut hex = region(vec![
            unit("5"),
            sharing(with_item(unit("7"), 10, "sword", "SWOR")),
        ]);
        hex.wanted.push(MarketItem {
            amount: 20,
            name: "sword".to_string(),
            tag: "SWOR".to_string(),
            price: 30,
        });

        assert_eq!(
            check(vec![hex], "unit 5\nSELL 10 swords\n"),
            vec![],
            "unit 7 shares its swords, so unit 5 can sell 10 of them"
        );
    }

    /// When the shared stock itself runs dry, it is the hex that is short and not any one unit -
    /// the item twin of `a_shared_purse_that_runs_dry_is_the_hex_s_problem`.
    #[test]
    fn a_shared_stock_that_runs_dry_is_the_hex_s_problem() {
        let regions = vec![region(vec![
            unit("5"),
            sharing(with_item(unit("7"), 20, "sword", "SWOR")),
        ])];

        let finding = only(check_ignoring_transfer_targets(
            regions,
            "unit 5\nGIVE 9 30 swords\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert_eq!(
            finding.unit_id, None,
            "the stock is shared, so the shortfall is too"
        );
        assert_eq!(finding.line, None);
        assert_eq!(
            finding.message,
            "the units in this hex are short 10 sword between them: they can have 20 \
             and their orders give away or sell 30"
        );
    }

    /// A non-sharer's own stock is not pooled - only a sharing unit's stock is anyone else's to
    /// draw on.
    #[test]
    fn a_stock_a_unit_keeps_to_itself_is_not_lent() {
        let regions = vec![region(vec![
            with_item(unit("5"), 10, "sword", "SWOR"),
            with_item(unit("7"), 0, "sword", "SWOR"),
            sharing(unit("9")),
        ])];

        let finding = only(check_ignoring_transfer_targets(
            regions,
            "unit 7\nGIVE 8 10 swords\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert_eq!(
            finding.unit_id, None,
            "there is a sharer in the hex, so the shortfall is judged against the pool"
        );
        assert!(
            finding.message.contains("short 10 sword"),
            "unit 5's swords are not lent - only the sharer's (empty) stock is the pool: {}",
            finding.message
        );
    }

    /// Men are the engine's one exception (`GetSharedNum` excludes `IT_MAN`): never borrowed,
    /// sharer or no sharer.
    #[test]
    fn men_are_never_borrowed_from_a_sharing_unit() {
        let regions = vec![region(vec![
            unit("5"),
            sharing(with_item(unit("7"), 10, "human", "HUMN")),
        ])];

        let finding = only(check_ignoring_transfer_targets(
            regions,
            "unit 5\nGIVE 9 10 HUMN\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert_eq!(
            finding.unit_id.as_deref(),
            Some("5"),
            "men do not pool, so the shortfall stays with the unit that ordered it"
        );
    }

    /// The item twin of `a_doubted_unit_silences_the_purse_it_shares`.
    #[test]
    fn a_doubted_sharer_silences_the_stock_it_shares() {
        let regions = vec![region(vec![
            unit("5"),
            sharing(with_item(unit("7"), 20, "sword", "SWOR")),
        ])];

        assert_eq!(
            check_ignoring_transfer_targets(
                regions,
                "unit 5\nGIVE 9 30 swords\nunit 7\nWITHDRAW 10 grain\n"
            ),
            vec![]
        );
    }

    #[test]
    fn a_hex_without_sharers_still_reports_each_unit_on_its_own() {
        let regions = vec![region(vec![
            with_item(unit("5"), 3, "sword", "SWOR"),
            with_item(unit("7"), 2, "sword", "SWOR"),
        ])];

        let findings = check_ignoring_transfer_targets(
            regions,
            "unit 5\nGIVE 9 10 swords\nunit 7\nGIVE 9 10 swords\n",
        );
        assert_eq!(
            findings.len(),
            2,
            "no sharer in the hex: each is on its own"
        );
        for finding in &findings {
            assert_eq!(finding.code.as_str(), "not-enough-items");
            assert!(finding.unit_id.is_some());
            assert!(finding.line.is_some());
        }
    }

    // --- markets: telling the two silences apart ------------------------------------------

    #[test]
    fn an_item_the_market_does_not_trade_is_named() {
        let mut hex_region = region(vec![unit("5")]);
        hex_region.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });
        let ordered = OrderedUnits::read("unit 5\nBUY 5 horses\n");
        let hex = Hex::read(&hex_region, &ordered);
        let actor = hex.find("5").expect("unit 5 is in the hex");

        assert_eq!(
            market_answer(
                &hex.region.for_sale,
                "horses",
                &hex,
                actor,
                Some(&ruleset())
            ),
            MarketAnswer::NotTraded("HORS".to_string()),
            "the catalogue knows a horse; this market simply does not sell one"
        );
    }

    #[test]
    fn an_item_nothing_can_identify_is_unknown() {
        let hex_region = region(vec![unit("5")]);
        let ordered = OrderedUnits::read("unit 5\nBUY 5 wodgets\n");
        let hex = Hex::read(&hex_region, &ordered);
        let actor = hex.find("5").expect("unit 5 is in the hex");

        assert_eq!(
            market_answer(
                &hex.region.for_sale,
                "wodgets",
                &hex,
                actor,
                Some(&ruleset())
            ),
            MarketAnswer::Unknown,
            "nothing - not the catalogue, not the hex's inventories, not the market lines - can \
             say what a wodget is"
        );
    }

    #[test]
    fn a_purchase_the_hex_does_not_sell_warns() {
        let mut hex = region(vec![unit("5")]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });
        hex.for_sale.push(MarketItem {
            amount: 5,
            name: "gems".to_string(),
            tag: "GEMS".to_string(),
            price: 40,
        });

        let finding = only(check(vec![hex], "unit 5\nBUY 5 silk\n"));
        assert_eq!(finding.code.as_str(), "not-traded-here");
        assert_eq!(
            finding.message,
            "this hex does not sell silk — its market has perfume and gems"
        );
    }

    #[test]
    fn a_sale_the_hex_does_not_want_warns() {
        let mut hex = region(vec![unit("5")]);
        hex.wanted.push(MarketItem {
            amount: 10,
            name: "grain".to_string(),
            tag: "GRAI".to_string(),
            price: 3,
        });
        hex.wanted.push(MarketItem {
            amount: 10,
            name: "livestock".to_string(),
            tag: "LIVE".to_string(),
            price: 5,
        });

        let finding = only(check(vec![hex], "unit 5\nSELL 3 fur\n"));
        assert_eq!(finding.code.as_str(), "not-traded-here");
        assert_eq!(
            finding.message,
            "this hex does not want fur — its market wants grain and livestock"
        );
    }

    #[test]
    fn one_good_needs_no_list_punctuation() {
        let mut hex = region(vec![unit("5")]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });

        let finding = only(check(vec![hex], "unit 5\nBUY 5 silk\n"));
        assert_eq!(
            finding.message,
            "this hex does not sell silk — its market has perfume"
        );
    }

    #[test]
    fn a_hex_with_no_market_says_so() {
        let hex = region(vec![unit("5")]);

        let finding = only(check(vec![hex], "unit 5\nBUY 5 silk\n"));
        assert_eq!(finding.message, "this hex sells nothing at all");
    }

    #[test]
    fn a_hex_wanting_nothing_says_so() {
        let hex = region(vec![unit("5")]);

        let finding = only(check(vec![hex], "unit 5\nSELL 3 fur\n"));
        assert_eq!(finding.message, "this hex wants nothing at all");
    }

    #[test]
    fn an_unidentifiable_item_stays_silent() {
        let mut hex = region(vec![unit("5")]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nBUY 5 wodgets\n")),
            Vec::<&str>::new(),
            "nothing can identify a wodget, so nothing is said about it"
        );
    }

    #[test]
    fn an_item_the_market_does_trade_stays_silent() {
        let mut hex = region(vec![with_silver(unit("5"), 1000)]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nBUY 5 PERF\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn the_market_s_own_spelling_is_used() {
        let mut hex = region(vec![unit("5")]);
        hex.wanted.push(MarketItem {
            amount: 10,
            name: "hill dwarves".to_string(),
            tag: "HDWA".to_string(),
            price: 30,
        });

        let finding = only(check(vec![hex], "unit 5\nSELL 3 fur\n"));
        assert!(
            finding.message.contains("hill dwarves"),
            "the report's own plural, not the catalogue's singular: {}",
            finding.message
        );
    }

    #[test]
    fn a_foreign_unit_is_not_warned_about_a_market_it_cannot_use() {
        let mut theirs = unit("900");
        theirs.own = false;
        theirs.faction_id = Some("15".to_string());
        let mut hex = region(vec![theirs]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });

        assert_eq!(
            check(vec![hex], "unit 900\nBUY 5 silk\n"),
            vec![],
            "you cannot order it, so a warning about it is noise"
        );
    }

    /// Real market lines, not hand-made ones: Inholm `(7,53)` sells `PERF, GEM, HDWA, LEAD` and
    /// wants nine goods, exactly as the committed turn-71 fixture report writes them.
    #[test]
    fn a_fixture_hex_names_what_it_actually_sells_and_wants() {
        let report = crate::report::parse_report_full(atlantis_hud_fixtures::G7_F95_T71.text);

        let findings = check_turn(
            &report,
            "unit 18642\nBUY 5 SILK\nSELL ALL FUR\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let messages: Vec<&str> = findings
            .iter()
            .filter(|finding| finding.code.as_str() == "not-traded-here")
            .map(|finding| finding.message.as_str())
            .collect();
        assert_eq!(
            messages,
            vec![
                "this hex does not sell silk — its market has perfume, gems, hill dwarves and \
                 leaders",
                "this hex does not want fur — its market wants grain, livestock, fish, spears, \
                 leather armor, spinning wheels, lassoes, jewelry and truffles",
            ]
        );
    }

    #[test]
    fn the_not_traded_finding_sits_on_the_order_line() {
        let mut hex = region(vec![unit("5")]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "perfume".to_string(),
            tag: "PERF".to_string(),
            price: 30,
        });

        let finding = only(check(vec![hex], "unit 5\nBUY 5 silk\n"));
        assert_eq!(finding.region_id, "1:7,53");
        assert_eq!(finding.unit_id.as_deref(), Some("5"));
        assert_eq!(finding.line, Some(2), "the BUY line, not the unit header");
    }

    // --- guarding ---------------------------------------------------------------------------

    #[test]
    fn a_hex_that_loses_its_last_guard_is_warned_about() {
        let mut guarding = unit("5");
        guarding.on_guard = true;

        let finding = only(check(vec![region(vec![guarding])], "unit 5\nMOVE N\n"));
        assert_eq!(finding.code.as_str(), "guard-dropped");
        assert_eq!(finding.region_id, "1:7,53");
        assert_eq!(finding.line, None, "the hex is nobody's line");
        assert_eq!(
            finding.unit_id, None,
            "it is the hex's problem, not one unit's"
        );
    }

    /// A guard that sails away drops the guard exactly as one that marches - SAIL with a route is
    /// a move to the intents reader, so `leaves_the_hex` agrees with the order tracer.
    #[test]
    fn a_guard_that_sails_away_drops_the_guard_like_one_that_marches() {
        let mut guarding = unit("5");
        guarding.on_guard = true;

        let finding = only(check(vec![region(vec![guarding])], "unit 5\nSAIL N\n"));
        assert_eq!(finding.code.as_str(), "guard-dropped");
    }

    #[test]
    fn ordering_guard_off_drops_it_just_as_surely() {
        let mut guarding = unit("5");
        guarding.on_guard = true;

        assert_eq!(
            codes(&check(vec![region(vec![guarding])], "unit 5\nGUARD 0\n")),
            ["guard-dropped"]
        );
    }

    #[test]
    fn a_guard_that_stays_is_no_cause_for_warning() {
        let mut guarding = unit("5");
        guarding.on_guard = true;

        assert_eq!(
            check(vec![region(vec![guarding])], "unit 5\nWORK\n"),
            vec![]
        );
    }

    #[test]
    fn another_unit_taking_up_the_guard_keeps_the_hex_guarded() {
        let mut leaving = unit("5");
        leaving.on_guard = true;

        assert_eq!(
            check(
                vec![region(vec![leaving, unit("7")])],
                "unit 5\nMOVE N\nunit 7\nGUARD 1\n"
            ),
            vec![]
        );
    }

    /// The one code disabled by default is `hex-unguarded`; every other advisory code still fires.
    #[test]
    fn default_options_disable_only_the_broad_guard_check() {
        let options = CheckOptions::default();
        assert!(
            !options.emits(codes::HEX_UNGUARDED),
            "hex-unguarded should start disabled"
        );
        for code in codes::ALL {
            if code == codes::HEX_UNGUARDED {
                continue;
            }
            assert!(
                options.emits(code),
                "{code} should not be disabled by default"
            );
        }
    }

    /// Most hexes are deliberately unguarded, so this stays silent unless it is asked for.
    #[test]
    fn a_hex_that_was_never_guarded_is_silent_by_default() {
        assert_eq!(
            check(vec![region(vec![unit("5")])], "unit 5\nWORK\n"),
            vec![]
        );
    }

    #[test]
    fn the_broad_guard_check_reports_an_unguarded_hex_when_it_is_asked_to() {
        let regions = vec![region(vec![unit("5")])];
        let options = CheckOptions {
            disabled: BTreeSet::new(),
        };

        let finding = only(check_turn(
            &report(regions),
            "unit 5\nWORK\n",
            Some(&ruleset()),
            options,
        ));
        assert_eq!(finding.code.as_str(), "hex-unguarded");
    }

    /// One hex, one guard problem. Reported as the change it is, not also as the state it leaves.
    #[test]
    fn a_dropped_guard_is_not_also_reported_as_an_unguarded_hex() {
        let mut guarding = unit("5");
        guarding.on_guard = true;
        let options = CheckOptions {
            disabled: BTreeSet::new(),
        };

        assert_eq!(
            codes(&check_turn(
                &report(vec![region(vec![guarding])]),
                "unit 5\nMOVE N\n",
                Some(&ruleset()),
                options,
            )),
            ["guard-dropped"]
        );
    }

    /// Entering or leaving a structure moves a unit within its hex, so it is still standing there
    /// to guard it.
    #[test]
    fn a_move_that_only_enters_a_structure_does_not_leave_the_hex() {
        let mut guarding = unit("5");
        guarding.on_guard = true;

        assert_eq!(
            check(vec![region(vec![guarding])], "unit 5\nMOVE IN 4\n"),
            vec![]
        );
    }

    // --- teaching ---------------------------------------------------------------------------

    fn teaching_hex() -> Vec<ReportUnit> {
        vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ]
    }

    #[test]
    fn a_student_named_but_not_studying_is_warned_about() {
        let finding = only(check(
            vec![region(teaching_hex())],
            "unit 500\nTEACH 700\nunit 700\nWORK\n",
        ));

        assert_eq!(finding.code.as_str(), "taught-not-studying");
        assert_eq!(
            finding.unit_id.as_deref(),
            Some("500"),
            "the teacher's order is the mistake"
        );
        assert_eq!(finding.line, Some(2), "the TEACH line");
        assert!(finding.message.contains("700"), "{}", finding.message);
    }

    #[test]
    fn a_student_who_is_not_in_the_hex_is_warned_about() {
        assert_eq!(
            codes(&check(
                vec![region(teaching_hex())],
                "unit 500\nTEACH 999\n"
            )),
            ["taught-not-here"]
        );
    }

    #[test]
    fn a_student_leaving_the_hex_cannot_be_taught_there() {
        assert_eq!(
            codes(&check(
                vec![region(teaching_hex())],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\nMOVE N\n"
            )),
            ["taught-not-here"]
        );
    }

    #[test]
    fn a_teacher_above_the_student_teaching_a_student_who_studies_is_no_cause_for_warning() {
        assert_eq!(
            check(
                vec![region(teaching_hex())],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n"
            ),
            vec![]
        );
    }

    /// "In order to teach, the teacher must be at a higher level in the skill than the student."
    #[test]
    fn a_teacher_who_is_not_above_the_student_is_warned_about() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 2),
            with_skill(with_men(with_silver(unit("700"), 1000), 2), "COMB", 2),
        ];

        let finding = only(check(
            vec![region(units)],
            "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "teacher-cannot-teach");
        assert!(finding.message.contains("level"), "{}", finding.message);
    }

    #[test]
    fn a_teacher_lacking_the_skill_entirely_is_warned_about() {
        let units = vec![
            with_men(with_silver(unit("500"), 1000), 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            codes(&check(
                vec![region(units)],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n"
            )),
            ["teacher-cannot-teach"]
        );
    }

    /// The issue's own example: a teacher with slots to spare while somebody in the hex studies
    /// untaught.
    #[test]
    fn a_teacher_with_free_slots_beside_an_untaught_student_is_pointed_out() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        // Unit 500 has been given nothing to do, so its month is free to teach in.
        let finding = only(check(vec![region(units)], "unit 700\nSTUDY combat\n"));
        assert_eq!(finding.code.as_str(), "teacher-has-free-slots");
        assert_eq!(finding.unit_id.as_deref(), Some("500"));
        assert!(
            finding.message.contains("700") && finding.message.contains("30"),
            "it names the student and the slots going spare: {}",
            finding.message
        );
    }

    /// Teaching takes the whole month, so a unit already spending its month is not a spare teacher.
    ///
    /// Not a nicety. Without this rule every unit in a hex is a candidate teacher for every other,
    /// and one hex of the committed turn 71 - fifteen soldiers all learning combat - produced
    /// twenty-nine findings that all said the same nothing.
    #[test]
    fn a_unit_spending_its_own_month_is_not_offered_as_a_teacher() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            check(
                vec![region(units)],
                "unit 500\nSTUDY combat\nunit 700\nSTUDY combat\n"
            ),
            vec![],
            "unit 500 is studying, so it has no month left to teach in"
        );
    }

    /// One finding per teacher, not one per pairing.
    #[test]
    fn a_teacher_who_could_take_several_students_is_reported_once() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
            with_men(with_silver(unit("800"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        let finding = only(check(
            vec![region(units)],
            "unit 700\nSTUDY combat\nunit 800\nSTUDY combat\nunit 900\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "teacher-has-free-slots");
        assert!(
            finding.message.contains("2 others"),
            "the rest are counted rather than listed: {}",
            finding.message
        );
    }

    #[test]
    fn a_student_already_being_taught_is_not_offered_a_second_teacher() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_skill(with_men(with_silver(unit("600"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            check(
                vec![region(units)],
                "unit 500\nTEACH 700\nunit 600\nWORK\nunit 700\nSTUDY combat\n"
            ),
            vec![]
        );
    }

    /// "if 1 teacher teaches 20 men, each man being taught will gain 1 1/2 months of training, not
    /// 2 months."
    #[test]
    fn more_students_than_slots_dilutes_the_teaching() {
        let units = vec![
            with_skill(with_silver(unit("500"), 1000), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 20),
        ];

        let finding = only(check(
            vec![region(units)],
            "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "teaching-oversubscribed");
        assert!(
            finding.message.contains("20") && finding.message.contains("10"),
            "it names the students and the slots: {}",
            finding.message
        );
    }

    /// Without a ruleset there is no way to turn `combat` into a tag, so the teacher's level
    /// cannot be compared with the student's. The checks that need no catalogue still run.
    #[test]
    fn without_a_ruleset_teaching_levels_are_not_judged() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 1),
            with_skill(with_men(with_silver(unit("700"), 1000), 2), "COMB", 5),
        ];
        let regions = vec![region(units)];

        assert_eq!(
            check_turn(
                &report(regions),
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
                None,
                CheckOptions::default(),
            ),
            vec![]
        );
    }

    // --- FORM aliases -------------------------------------------------------------------------

    #[test]
    fn a_form_number_used_twice_by_one_unit_warns_on_the_second() {
        let finding = only(check(
            vec![region(vec![unit("5")])],
            "unit 5\nFORM 1\nSTUDY FORC\nEND\nFORM 1\nSTUDY FORC\nEND\n",
        ));

        assert_eq!(finding.code, codes::FORM_ALIAS_REUSED);
        assert_eq!(finding.unit_id, Some("5".to_string()));
        assert_eq!(finding.line, Some(5));
        assert_eq!(
            finding.message,
            "FORM 1 again: line 2 already forms NEW 1 in this hex, so this block is refused"
        );
    }

    #[test]
    fn three_copies_give_two_warnings_each_naming_the_first() {
        let findings = check(
            vec![region(vec![unit("5")])],
            "unit 5\nFORM 1\nEND\nFORM 1\nEND\nFORM 1\nEND\n",
        );

        assert_eq!(
            findings.iter().map(|f| f.line).collect::<Vec<_>>(),
            vec![Some(4), Some(6)]
        );
        for finding in &findings {
            assert!(
                finding.message.contains("line 2 already forms NEW 1"),
                "both should name the first use: {}",
                finding.message
            );
        }
    }

    #[test]
    fn two_units_in_one_hex_forming_the_same_number_warn_on_the_second_and_name_the_first_unit() {
        let finding = only(check(
            vec![region(vec![unit("5"), unit("7")])],
            "unit 5\nFORM 1\nEND\nunit 7\nFORM 1\nEND\n",
        ));

        assert_eq!(finding.unit_id, Some("7".to_string()));
        assert_eq!(finding.line, Some(5));
        assert_eq!(
            finding.message,
            "FORM 1 again: unit 5 (line 2) already forms NEW 1 in this hex, so this block is refused"
        );
    }

    #[test]
    fn the_same_number_in_two_hexes_is_fine() {
        let mut second = region(vec![unit("7")]);
        second.region_id = "1:8,53".to_string();
        second.coordinate = Coordinate { x: 8, y: 53, z: 1 };

        assert_eq!(
            codes(&check(
                vec![region(vec![unit("5")]), second],
                "unit 5\nFORM 1\nEND\nunit 7\nFORM 1\nEND\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_form_inside_a_turn_block_is_next_months_and_not_counted() {
        assert_eq!(
            codes(&check(
                vec![region(vec![unit("5")])],
                "unit 5\nFORM 1\nEND\nTURN\nFORM 1\nEND\nENDTURN\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn distinct_numbers_are_silent() {
        assert_eq!(
            codes(&check(
                vec![region(vec![unit("5")])],
                "unit 5\nFORM 1\nEND\nFORM 2\nEND\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_nested_form_that_repeats_the_outer_alias_is_a_repeat() {
        let finding = only(check(
            vec![region(vec![unit("5")])],
            "unit 5\nFORM 1\nFORM 1\nEND\nEND\n",
        ));

        assert_eq!(finding.line, Some(3));
        assert!(finding.message.contains("line 2 already forms NEW 1"));
    }

    // --- transfer targets ---------------------------------------------------------------------

    #[test]
    fn a_gift_to_a_unit_the_report_shows_elsewhere_names_that_hex() {
        let mut elsewhere = region(vec![unit("3247")]);
        elsewhere.region_id = "1:8,53".to_string();
        elsewhere.coordinate = Coordinate { x: 8, y: 53, z: 1 };

        let regions = vec![
            region(vec![with_item(unit("8443"), 30, "grain", "GRAI")]),
            elsewhere,
        ];

        let finding = only(check(regions, "unit 8443\nGIVE 3247 30 GRAI\n"));

        assert_eq!(finding.code, codes::GIVE_TARGET_NOT_HERE);
        assert_eq!(finding.unit_id, Some("8443".to_string()));
        assert_eq!(finding.line, Some(2));
        assert_eq!(
            finding.message,
            "unit 3247 is not in this hex to be given to - your report shows it in mountain (8,53) in Inhead"
        );
    }

    #[test]
    fn a_gift_to_a_unit_in_no_region_says_so() {
        let finding = only(check(
            vec![region(vec![with_silver(unit("13303"), 1000)])],
            "unit 13303\nGIVE 16585 500 SILV\n",
        ));

        assert_eq!(
            finding.message,
            "unit 16585 is not in this hex to be given to, and appears nowhere else in your report"
        );
    }

    #[test]
    fn a_take_from_a_unit_the_report_shows_elsewhere_names_that_hex() {
        let mut elsewhere = region(vec![unit("13304")]);
        elsewhere.region_id = "1:8,53".to_string();
        elsewhere.coordinate = Coordinate { x: 8, y: 53, z: 1 };

        let regions = vec![region(vec![unit("4426")]), elsewhere];

        let finding = only(check(regions, "unit 4426\nTAKE FROM 13304 50 SILV\n"));

        assert_eq!(
            finding.message,
            "unit 13304 is not in this hex to be taken from - your report shows it in mountain (8,53) in Inhead"
        );
    }

    #[test]
    fn a_take_from_a_unit_in_no_region_says_so() {
        let finding = only(check(
            vec![region(vec![unit("4426")])],
            "unit 4426\nTAKE FROM 16585 50 SILV\n",
        ));

        assert_eq!(
            finding.message,
            "unit 16585 is not in this hex to be taken from, and appears nowhere else in your report"
        );
    }

    #[test]
    fn a_gift_to_a_unit_in_this_hex_is_silent() {
        assert_eq!(
            codes(&check(
                vec![region(vec![
                    with_item(unit("8443"), 30, "grain", "GRAI"),
                    unit("3247")
                ])],
                "unit 8443\nGIVE 3247 30 GRAI\n",
            )),
            Vec::<&str>::new()
        );
    }

    /// This is the test that fails if the implementation reaches for `hex.find`, which sees only
    /// our own units - a gift to a visible foreign unit standing in the same hex is legal.
    #[test]
    fn a_gift_to_a_foreign_unit_in_the_hex_is_silent() {
        let mut foreign = unit("900");
        foreign.own = false;
        foreign.faction_id = Some("15".to_string());

        assert_eq!(
            codes(&check(
                vec![region(vec![
                    with_item(unit("8443"), 30, "grain", "GRAI"),
                    foreign
                ])],
                "unit 8443\nGIVE 900 30 GRAI\n",
            )),
            Vec::<&str>::new()
        );
    }

    /// `read_party` reads any all-zero token as `Party::Discard`, so `GIVE 0` can never look like a
    /// missing unit.
    #[test]
    fn a_discard_is_not_a_missing_unit() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_item(unit("8443"), 30, "grain", "GRAI")])],
                "unit 8443\nGIVE 0 30 GRAI\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_gift_to_a_unit_formed_this_month_is_silent() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_item(unit("8443"), 30, "grain", "GRAI")])],
                "unit 8443\nGIVE NEW 1 30 GRAI\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_gift_to_another_factions_new_unit_is_silent() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_item(unit("8443"), 30, "grain", "GRAI")])],
                "unit 8443\nGIVE FACTION 15 NEW 2 30 GRAI\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn both_a_give_and_a_take_on_one_unit_are_two_findings() {
        let findings = check(
            vec![region(vec![unit("4426")])],
            "unit 4426\nGIVE 16585 50 SILV\nTAKE FROM 16586 50 SILV\n",
        );

        assert_eq!(
            findings.iter().map(|f| f.code).collect::<Vec<_>>(),
            vec![codes::GIVE_TARGET_NOT_HERE, codes::GIVE_TARGET_NOT_HERE]
        );
        assert_eq!(
            findings.iter().map(|f| f.line).collect::<Vec<_>>(),
            vec![Some(2), Some(3)]
        );
        assert!(findings[0].message.contains("given to"));
        assert!(findings[1].message.contains("taken from"));
    }

    // --- disabling advisory checks -------------------------------------------------------------

    /// The runtime default (`hex-unguarded` off, everything else on) plus one more code disabled.
    fn disabling(code: Code) -> CheckOptions {
        let mut options = CheckOptions::default();
        options.disabled.insert(code.as_str().to_string());
        options
    }

    /// The runtime default plus every one of `codes`, for a test that needs more than one code
    /// disabled alongside the one under test.
    fn disabling_all(codes: &[Code]) -> CheckOptions {
        let mut options = CheckOptions::default();
        options
            .disabled
            .extend(codes.iter().map(|code| code.as_str().to_string()));
        options
    }

    /// Every advisory code has a fixture that emits it, and disabling that code by name silences
    /// it - proven both ways: present when nothing is disabled, absent when it is. The settings
    /// UI's nine toggles are only as real as this.
    #[test]
    fn every_advisory_code_can_be_silenced() {
        let mut guard_dropping = unit("5");
        guard_dropping.on_guard = true;
        let teacher_below_student = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 2),
            with_skill(with_men(with_silver(unit("700"), 1000), 2), "COMB", 2),
        ];
        let oversubscribed = vec![
            with_skill(with_silver(unit("500"), 1000), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 20),
        ];

        let cases: Vec<(Code, Vec<ReportRegion>, &str)> = vec![
            (
                codes::NOT_ENOUGH_SILVER,
                vec![region(vec![with_silver(unit("5"), 40)])],
                "unit 5\nGIVE 7 100 SILV\n",
            ),
            (
                codes::NOT_ENOUGH_ITEMS,
                vec![region(vec![with_item(unit("5"), 3, "sword", "SWOR")])],
                "unit 5\nGIVE 7 10 swords\n",
            ),
            (
                codes::GUARD_DROPPED,
                vec![region(vec![guard_dropping])],
                "unit 5\nMOVE N\n",
            ),
            (
                codes::HEX_UNGUARDED,
                vec![region(vec![unit("5")])],
                "unit 5\nWORK\n",
            ),
            (
                codes::TAUGHT_NOT_HERE,
                vec![region(teaching_hex())],
                "unit 500\nTEACH 999\n",
            ),
            (
                codes::TAUGHT_NOT_STUDYING,
                vec![region(teaching_hex())],
                "unit 500\nTEACH 700\nunit 700\nWORK\n",
            ),
            (
                codes::TEACHER_CANNOT_TEACH,
                vec![region(teacher_below_student)],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
            ),
            (
                codes::TEACHING_OVERSUBSCRIBED,
                vec![region(oversubscribed)],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
            ),
            (
                codes::TEACHER_HAS_FREE_SLOTS,
                vec![region(teaching_hex())],
                "unit 700\nSTUDY combat\n",
            ),
            (
                codes::FORM_ALIAS_REUSED,
                vec![region(vec![unit("5")])],
                "unit 5\nFORM 1\nEND\nFORM 1\nEND\n",
            ),
            (
                codes::FLEET_OVERLOADED,
                vec![ReportRegion {
                    structures: vec![longship("329")],
                    ..region(vec![ReportUnit {
                        structure_id: Some("329".to_string()),
                        weight: Some(200),
                        skills: vec![sail(4)],
                        ..unit("11125")
                    }])
                }],
                "unit 11125\nSAIL N\n",
            ),
            (
                codes::FLEET_UNDERCREWED,
                vec![ReportRegion {
                    structures: vec![longship("329")],
                    ..region(vec![ReportUnit {
                        structure_id: Some("329".to_string()),
                        weight: Some(10),
                        ..unit("11125")
                    }])
                }],
                "unit 11125\nSAIL N\n",
            ),
            (
                codes::GIVE_TARGET_NOT_HERE,
                vec![region(vec![with_silver(unit("5"), 1000)])],
                "unit 5\nGIVE 16585 500 SILV\n",
            ),
            (
                codes::NOT_TRADED_HERE,
                vec![region(vec![unit("5")])],
                "unit 5\nBUY 5 silk\n",
            ),
        ];

        assert_eq!(
            cases.len(),
            codes::ALL.len(),
            "every code in codes::ALL needs a fixture here, or a silenced one would go unnoticed"
        );

        for (code, regions, orders) in &cases {
            // Fully enabled (rather than the runtime default) so `hex-unguarded`'s own case, which
            // the default itself disables, still gets to prove its fixture fires at all.
            let enabled = check_turn(
                &report(regions.clone()),
                orders,
                Some(&ruleset()),
                CheckOptions {
                    disabled: BTreeSet::new(),
                },
            );
            assert!(
                codes(&enabled).contains(&code.as_str()),
                "{code}'s own fixture should emit it when nothing is disabled: {enabled:?}"
            );

            let silenced = check_turn(
                &report(regions.clone()),
                orders,
                Some(&ruleset()),
                disabling(*code),
            );
            assert!(
                !codes(&silenced).contains(&code.as_str()),
                "{code} should be silenced once disabled: {silenced:?}"
            );
        }
    }

    /// `not-enough-silver` comes from two different places - a single unit's balance in a hex
    /// with no sharer, and the pool in a hex that has one - and disabling the code has to close
    /// both, not just the one a simpler test would happen to hit.
    #[test]
    fn a_disabled_code_silences_both_its_emission_sites() {
        let no_sharer = region(vec![with_silver(unit("9"), 40)]);
        let mut shared = region(vec![
            sharing(with_men(with_silver(unit("5"), 0), 10)),
            sharing(with_silver(unit("7"), 30)),
        ]);
        shared.region_id = "1:8,53".to_string();
        shared.coordinate = Coordinate { x: 8, y: 53, z: 1 };
        let regions = vec![no_sharer, shared];
        // Unit 11 does not exist in either region, so this order also trips `give-target-not-here` -
        // orthogonal to what this test is about, and disabled below alongside the code under test.
        let orders = "unit 9\nGIVE 11 100 SILV\nunit 5\nSTUDY combat\n";

        let enabled = check_turn(
            &report(regions.clone()),
            orders,
            Some(&ruleset()),
            disabling(codes::GIVE_TARGET_NOT_HERE),
        );
        assert_eq!(
            codes(&enabled)
                .into_iter()
                .filter(|code| *code == "not-enough-silver")
                .count(),
            2,
            "unit 9's own balance and the shared pool should both be short: {enabled:?}"
        );

        assert_eq!(
            check_turn(
                &report(regions),
                orders,
                Some(&ruleset()),
                disabling_all(&[codes::NOT_ENOUGH_SILVER, codes::GIVE_TARGET_NOT_HERE]),
            ),
            vec![],
            "disabling the code should close both sites, not just one"
        );
    }

    /// Disabling one code must not touch any other: a hex that is both short of silver and losing
    /// its guard still reports the guard when only the silver check is turned off.
    #[test]
    fn a_disabled_code_leaves_every_other_advisory_untouched() {
        let mut guarding = unit("9");
        guarding.on_guard = true;
        let regions = vec![region(vec![with_silver(unit("5"), 40), guarding])];
        // Unit 7 does not exist in the report, so this order also trips `give-target-not-here` -
        // orthogonal to what this test is about, and disabled below alongside the code under test.
        let orders = "unit 5\nGIVE 7 100 SILV\nunit 9\nMOVE N\n";

        assert_eq!(
            codes(&check_turn(
                &report(regions),
                orders,
                Some(&ruleset()),
                disabling_all(&[codes::NOT_ENOUGH_SILVER, codes::GIVE_TARGET_NOT_HERE]),
            )),
            ["guard-dropped"]
        );
    }

    // --- sailing ------------------------------------------------------------------------------

    /// A unit aboard `fleet_id`, at the given weight and sailing skill.
    fn aboard(id: &str, fleet_id: &str, weight: i64, sail_level: u32) -> ReportUnit {
        let mut aboard = ReportUnit {
            structure_id: Some(fleet_id.to_string()),
            weight: Some(weight),
            ..unit(id)
        };
        if sail_level > 0 {
            aboard.skills.push(sail(sail_level));
        }
        aboard
    }

    #[test]
    fn a_gift_loaded_aboard_this_month_overloads_the_fleet() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 4),
                with_item(unit("8801"), 30, "grain", "GRAI"),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 11125 30 GRAI\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert_eq!(finding.unit_id, Some("11125".to_string()));
    }

    #[test]
    fn a_fleet_loaded_this_month_says_how_much_was_loaded() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 4),
                with_item(unit("8801"), 30, "grain", "GRAI"),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 11125 30 GRAI\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 50 aboard plus 150 loaded this month, on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_fleet_lightened_this_month_says_how_much_was_unloaded() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                with_item(aboard("11125", "329", 300, 4), 20, "grain", "GRAI"),
                unit("8801"),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 11125\nGIVE 8801 20 GRAI\nSAIL N\n",
        ));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 300 aboard less 100 unloaded this month, on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_transfer_elsewhere_in_the_hex_leaves_the_fleet_alone() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 190, 4),
                with_item(unit("8801"), 30, "grain", "GRAI"),
                unit("8802"),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 8802 30 GRAI\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 190 aboard on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_unit_leaving_this_month_is_unloaded_weight() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 4),
                aboard("12590", "329", 100, 0),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 12590\nLEAVE\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 300 aboard less 100 unloaded this month, on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_purchase_this_month_is_aboard_when_the_fleet_sails() {
        let mut hex = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![with_silver(aboard("11125", "329", 50, 4), 10_000)])
        };
        hex.for_sale.push(MarketItem {
            amount: 100,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 1,
        });

        let finding = only(check(vec![hex], "unit 11125\nBUY 3 horses\nSAIL N\n"));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert!(finding
            .message
            .contains("50 aboard plus 150 loaded this month"));
    }

    #[test]
    fn cargo_sold_this_month_is_no_longer_aboard() {
        let mut hex = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![with_item(
                aboard("11125", "329", 300, 4),
                40,
                "grain",
                "GRAI",
            )])
        };
        hex.wanted.push(MarketItem {
            amount: 100,
            name: "grain".to_string(),
            tag: "GRAI".to_string(),
            price: 1,
        });

        assert_eq!(
            codes(&check(vec![hex], "unit 11125\nSELL 40 grain\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn silver_given_aboard_weighs_nothing() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 4),
                with_silver(unit("8801"), 10_000),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 11125 10000 SILV\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 200 aboard on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_gift_between_two_units_aboard_changes_nothing() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                with_item(aboard("11125", "329", 100, 4), 20, "grain", "GRAI"),
                aboard("12590", "329", 50, 0),
            ])
        };

        assert_eq!(
            codes(&check(
                vec![region],
                "unit 11125\nGIVE 12590 20 GRAI\nSAIL N\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn men_given_aboard_are_weighed() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 4),
                with_men(with_item(unit("8801"), 20, "gnoll", "GNOL"), 20),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 11125 15 GNOL\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert!(finding
            .message
            .contains("50 aboard plus 150 loaded this month"));
    }

    #[test]
    fn an_order_nothing_can_price_leaves_the_report_weights_standing() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![aboard("11125", "329", 200, 4)])
        };

        let finding = only(check(
            vec![region],
            "unit 11125\nWITHDRAW 20 GRAI\nSAIL N\n",
        ));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 200 aboard on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn an_item_the_catalogue_cannot_weigh_is_not_counted() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 4),
                with_item(unit("8801"), 100, "moonstone", "MOON"),
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 11125 100 MOON\nunit 11125\nSAIL N\n",
        ));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 200 aboard on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn without_a_ruleset_the_report_weights_stand() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 4),
                with_item(unit("8801"), 30, "grain", "GRAI"),
            ])
        };
        let orders = "unit 8801\nGIVE 11125 30 GRAI\nunit 11125\nSAIL N\n";

        let without_ruleset = only(check_turn(
            &report(vec![region.clone()]),
            orders,
            None,
            CheckOptions::default(),
        ));
        assert_eq!(
            without_ruleset.message,
            "Longship [329] is overloaded: 200 aboard on a capacity of 150, so it will not sail"
        );

        let with_ruleset = only(check_turn(
            &report(vec![region]),
            orders,
            Some(&ruleset()),
            CheckOptions::default(),
        ));
        assert!(with_ruleset
            .message
            .contains("200 aboard plus 150 loaded this month"));
    }

    #[test]
    fn a_fleet_within_its_numbers_sails_in_silence() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 2),
                aboard("12590", "329", 60, 2),
            ])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 11125\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_fleet_over_capacity_is_warned_on_the_captains_sail_line() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 100, 2),
                aboard("12590", "329", 90, 2),
            ])
        };

        let finding = only(check(vec![region], "unit 11125\nSAIL N\n"));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert_eq!(finding.unit_id, Some("11125".to_string()));
        assert_eq!(finding.line, Some(2));
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 190 aboard on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_fleet_short_of_sailors_is_warned() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 2),
                aboard("12590", "329", 50, 0),
            ])
        };

        let finding = only(check(vec![region], "unit 11125\nSAIL N\n"));
        assert_eq!(finding.code.as_str(), "fleet-undercrewed");
        assert_eq!(
            finding.message,
            "Longship [329] is short of sailors: 2 sailing levels aboard, it needs 4, so it will not sail"
        );
    }

    #[test]
    fn both_problems_are_two_findings_on_the_same_line() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![aboard("11125", "329", 200, 0)])
        };

        let findings = check(vec![region], "unit 11125\nSAIL N\n");
        assert_eq!(
            codes(&findings),
            vec!["fleet-overloaded", "fleet-undercrewed"]
        );
        assert!(findings.iter().all(|f| f.line == Some(2)));
    }

    #[test]
    fn a_unit_entering_this_month_counts_aboard() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 4),
                ReportUnit {
                    weight: Some(200),
                    ..unit("999")
                },
            ])
        };

        let finding = only(check(
            vec![region],
            "unit 11125\nSAIL N\nunit 999\nENTER 329\n",
        ));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert_eq!(
            finding.message,
            "Longship [329] is overloaded: 50 aboard plus 200 loaded this month, on a capacity of 150, so it will not sail"
        );
    }

    #[test]
    fn a_unit_leaving_this_month_does_not_count() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 4),
                aboard("12590", "329", 100, 0),
            ])
        };

        assert_eq!(
            codes(&check(
                vec![region],
                "unit 11125\nSAIL N\nunit 12590\nLEAVE\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn exactly_at_capacity_and_exactly_enough_crew_sail() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![aboard("11125", "329", 150, 4)])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 11125\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_bare_sail_is_a_sail() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![aboard("11125", "329", 200, 4)])
        };

        let finding = only(check(vec![region], "unit 11125\nSAIL\n"));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
    }

    #[test]
    fn a_move_touching_the_fleet_silences_it() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 0),
                ReportUnit {
                    weight: Some(0),
                    ..unit("999")
                },
            ])
        };

        assert_eq!(
            codes(&check(
                vec![region.clone()],
                "unit 11125\nSAIL N\nunit 999\nMOVE IN 329\n",
            )),
            Vec::<&str>::new()
        );

        // The captain itself gives MOVE rather than SAIL: no SAIL, so the fleet is not checked.
        assert_eq!(
            codes(&check(vec![region], "unit 11125\nMOVE N\n")),
            Vec::<&str>::new()
        );
    }

    /// A bare `MOVE IN` names no structure - it boards whatever single one the server finds in
    /// the hex - so it cannot be ruled out as touching this fleet either.
    #[test]
    fn a_bare_move_in_also_silences_the_fleet() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 0),
                ReportUnit {
                    weight: Some(0),
                    ..unit("999")
                },
            ])
        };

        assert_eq!(
            codes(&check(
                vec![region],
                "unit 11125\nSAIL N\nunit 999\nMOVE IN\n"
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn an_unstated_weight_silences_the_load_but_not_the_crew() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![ReportUnit {
                structure_id: Some("329".to_string()),
                weight: None,
                ..unit("11125")
            }])
        };

        let finding = only(check(vec![region], "unit 11125\nSAIL N\n"));
        assert_eq!(finding.code.as_str(), "fleet-undercrewed");
    }

    #[test]
    fn stated_numbers_beat_the_ruleset() {
        let region = ReportRegion {
            structures: vec![Structure {
                structure_id: "1121".to_string(),
                name: "Ship".to_string(),
                kind: "Fleet, 2 Galleons".to_string(),
                description: None,
                needs: None,
            }],
            ..region(vec![aboard("11125", "1121", 5401, 30)])
        };

        let finding = only(check(vec![region], "unit 11125\nSAIL N\n"));
        assert_eq!(finding.code.as_str(), "fleet-overloaded");
        assert!(finding.message.contains("capacity of 5400"));
    }

    #[test]
    fn the_ruleset_prices_a_fleet_the_report_does_not() {
        let region = ReportRegion {
            structures: vec![Structure {
                structure_id: "1".to_string(),
                name: "Ship".to_string(),
                kind: "Longship".to_string(),
                description: None,
                needs: None,
            }],
            ..region(vec![aboard("11125", "1", 200, 0)])
        };

        let findings = check_turn(
            &report(vec![region]),
            "unit 11125\nSAIL N\n",
            None,
            CheckOptions::default(),
        );
        assert_eq!(codes(&findings), Vec::<&str>::new());
    }

    #[test]
    fn a_foreign_unit_aboard_silences_the_fleet() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 200, 0),
                ReportUnit {
                    own: false,
                    structure_id: Some("329".to_string()),
                    weight: Some(0),
                    ..unit("13")
                },
            ])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 11125\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_that_only_stands_in_the_hex_is_not_aboard() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 50, 4),
                ReportUnit {
                    weight: Some(1000),
                    ..unit("999")
                },
            ])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 11125\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    // --- ordering ---------------------------------------------------------------------------

    #[test]
    fn findings_come_back_grouped_by_hex_and_in_line_order_within_one() {
        let mut hex = region(vec![with_silver(unit("5"), 0), with_silver(unit("7"), 0)]);
        hex.units[0].on_guard = true;

        let findings = check_ignoring_transfer_targets(
            vec![hex],
            "unit 5\nGUARD 0\nGIVE 9 10 SILV\nunit 7\nGIVE 9 10 SILV\n",
        );

        assert_eq!(
            findings.iter().map(|f| f.line).collect::<Vec<_>>(),
            vec![Some(3), Some(5), None],
            "lines first, in order, then what belongs to no line: {findings:?}"
        );
    }
}
