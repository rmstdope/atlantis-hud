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
use super::standing::{self, standing_after, Boarding};
use crate::movement::mode::{
    best_allowance, cargo_capacity, fleet_label, parse_fleet_kind, sailing_requirement,
};
use crate::movement::orders::MoveStep;
use crate::movement::rules::{item_spellings, Ruleset};
use crate::orders::silver::{
    feed_from_faction_food, food_claim, forecast_unit, parse_wage_centis, unit_upkeep, FoodClaim,
    Lookups, PurchaseAnswer, Receipts, RegionWages, SaleAnswer, SilverDoubt, UnitFacts, UnitSilver,
};
use crate::report::model::{ItemAmount, MarketItem, ReportRegion, ReportUnit, Structure};
use crate::report::ParsedReport;

/// The report's name for the allowance this check reads from `Faction Status:`.
const QUARTERMASTERS: &str = "quartermasters";

/// The skill this check is about, by name rather than by tag - see [`check_faction`]'s own doc
/// comment for why.
const QUARTERMASTER_SKILL: &str = "quartermaster";

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
    pub const UNIT_OVERLOADED: Code = Code("unit-overloaded");
    pub const TOO_MANY_QUARTERMASTERS: Code = Code("too-many-quartermasters");
    pub const STUDY_AT_MAXIMUM: Code = Code("study-at-maximum");
    pub const ALREADY_BUILT: Code = Code("already-built");
    pub const TOO_MANY_TRADE_REGIONS: Code = Code("too-many-trade-regions");
    pub const MAGIC_STUDY_OUTSIDE_BUILDING: Code = Code("magic-study-outside-building");
    pub const BUILD_OUTSIDE_STRUCTURE: Code = Code("build-outside-structure");
    pub const BUILD_HELP_NOT_BUILDING: Code = Code("build-help-not-building");
    pub const UNIT_DOES_NOTHING: Code = Code("unit-does-nothing");
    pub const BUILD_WITHOUT_SKILL: Code = Code("build-without-skill");
    /// Every code. This array's own order is not the settings tab's grouping (that groups by
    /// concern - Teaching / Resources / Markets / Guarding / Orders / Sailing - not by this list):
    /// a new entry joins whichever group fits its concern, which need not be the last one
    /// (`give-target-not-here` and `not-traded-here` joined the existing *Orders* group;
    /// `too-many-quartermasters` and `study-at-maximum` joined the existing *Studying/Teaching*
    /// group). What every entry so far has kept is new-*here*-last: the generated TypeScript
    /// copies this array's order, so a new code is always appended to it regardless of where it
    /// lands in the UI.
    pub const ALL: [Code; 24] = [
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
        UNIT_OVERLOADED,
        TOO_MANY_QUARTERMASTERS,
        STUDY_AT_MAXIMUM,
        ALREADY_BUILT,
        TOO_MANY_TRADE_REGIONS,
        MAGIC_STUDY_OUTSIDE_BUILDING,
        BUILD_OUTSIDE_STRUCTURE,
        BUILD_HELP_NOT_BUILDING,
        UNIT_DOES_NOTHING,
        BUILD_WITHOUT_SKILL,
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
    review_turn(report, source, ruleset, options).findings
}

/// A whole turn read once: everything wrong with it, and what its units' months cost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnReview {
    pub findings: Vec<Finding>,
    /// One entry per own unit the report shows, whether or not it has orders. `ah-1wcw.1`.
    pub silver: Vec<UnitSilver>,
}

/// Checks a whole turn's orders against the report they were written for, and forecasts each
/// unit's silver in the same pass.
///
/// One walk rather than two: this runs on every keystroke once typing settles, and the hexes and
/// their own units have already been read here by the time the forecast wants them.
#[must_use]
pub fn review_turn(
    report: &ParsedReport,
    source: &str,
    ruleset: Option<&Ruleset>,
    options: CheckOptions,
) -> TurnReview {
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
    let mut silver = Vec::new();

    // Gifts of silver live in the *giver's* block, which may be anywhere in the document, so they
    // are gathered once for the whole turn before any hex is priced. Per unit this would be
    // quadratic in the size of a faction, on a path that runs on every keystroke.
    let receipts = gather_receipts(report, &ordered, ruleset);

    for region in &report.regions {
        let hex = Hex::read(region, &ordered);
        forecast_hex(&hex, &receipts, ruleset, &mut silver);
        if hex.units.is_empty() {
            continue;
        }

        let start = findings.len();
        let ledger = ledger_for(&hex, ruleset);
        check_resources(&hex, &ledger, ruleset, &options, &mut findings);
        check_markets(&hex, ruleset, &options, &mut findings);
        check_guard(&hex, &options, &mut findings);
        check_teaching(&hex, ruleset, &options, &mut findings);
        check_building(&hex, &options, &mut findings);
        check_building_outside(&hex, &options, &mut findings);
        check_build_help(&hex, &options, &mut findings);
        check_build_skill(&hex, ruleset, &options, &mut findings);
        check_studying(&hex, ruleset, &options, &mut findings);
        check_magic_study(&hex, ruleset, &options, &mut findings);
        check_forms(&hex, &options, &mut findings);
        check_idle_units(&hex, &options, &mut findings);
        check_transfer_targets(&hex, &located, &options, &mut findings);
        check_sailing(&hex, &ledger, ruleset, &options, &mut findings);
        check_movement(&hex, &ledger, ruleset, &options, &mut findings);

        // Within a hex, what sits on a line comes first and in line order; what belongs to the hex
        // itself comes last. `sort_by_key` is stable, so checks that produce several findings for
        // one line keep the order they produced them in.
        findings[start..].sort_by_key(|finding| (finding.line.is_none(), finding.line));
    }

    // Everything above is about one hex. An allowance is spent across the whole map, so it is
    // counted once, after every hex has been read - and `validate_turn` sorts the whole list by
    // line afterwards, so these findings land beside the per-hex ones rather than after them.
    check_faction(report, &ordered, ruleset, &options, &mut findings);

    TurnReview { findings, silver }
}

/// Every own unit in one hex, priced. Foreign units are not here to begin with: `Hex::read` has
/// already filtered them out, so their cell is blank for free.
fn forecast_hex(
    hex: &Hex<'_>,
    receipts: &BTreeMap<String, Receipts>,
    ruleset: Option<&Ruleset>,
    into: &mut Vec<UnitSilver>,
) {
    let region = RegionWages {
        tax_base: hex.region.tax_base,
        wage_centis: parse_wage_centis(hex.region.wages.as_deref()),
        max_wages: hex.region.max_wages,
        entertainment: hex.region.entertainment,
    };
    let nothing = Receipts::default();

    // Step 2 of the payment order runs across the whole hex, so it needs every unit's step-1
    // leftovers before it can settle any of them. Gathered here, applied once the loop is done.
    let mut claims: Vec<FoodClaim> = Vec::with_capacity(hex.units.len());
    let start = into.len();

    for ordered in &hex.units {
        // The market's answer depends on the item each SELL names, and resolving an item name is
        // this module's business - so the arithmetic is handed a closure rather than a value.
        let sale = |item: &str| match market_answer(&hex.region.wanted, item, hex, ordered, ruleset)
        {
            MarketAnswer::Offered(line) => SaleAnswer::Wanted {
                price: line.price,
                market_takes: line.amount,
                unit_holds: ordered.holding(&line.tag.to_ascii_uppercase()),
            },
            // `market` collapses these two into `None`; the column must tell them apart, because
            // one earns nothing and the other cannot be priced at all.
            MarketAnswer::NotTraded(_) => SaleAnswer::NotWanted,
            MarketAnswer::Unknown => SaleAnswer::Unknown,
        };

        // The same question of the `For Sale` list, for what a BUY costs. A market with no line
        // for the goods cannot price the purchase at all, so both kinds of no collapse into one -
        // named as well as anything can name them, for the sentence the hover shows.
        let purchase =
            |item: &str| match market_answer(&hex.region.for_sale, item, hex, ordered, ruleset) {
                MarketAnswer::Offered(line) => PurchaseAnswer::ForSale {
                    price: line.price,
                    market_has: line.amount,
                },
                MarketAnswer::NotTraded(tag) => PurchaseAnswer::NotSold {
                    name: item_name(&tag, hex, ruleset).to_lowercase(),
                },
                MarketAnswer::Unknown => PurchaseAnswer::NotSold {
                    name: item.to_lowercase(),
                },
            };

        // Resolving an item an order names is this module's business, and a gift of silver and a
        // priced withdrawal both need it.
        let item_tag = |text: &str| resolve_item(text, hex, ordered, ruleset);

        let facts = UnitFacts {
            unit_id: &ordered.unit.unit_id,
            region_id: &hex.region.region_id,
            held: ordered.holding(SILVER),
            men: ordered.unit.men,
            men_estimated: ordered.unit.men_estimated,
            men_by_race: &ordered.unit.men_by_race,
            items: &ordered.unit.items,
            flags: &ordered.unit.flags,
            skills: &ordered.unit.skills,
            intents: ordered.intents,
            receipts: receipts.get(&ordered.unit.unit_id).unwrap_or(&nothing),
        };
        claims.push(food_claim(&facts));

        into.push(forecast_unit(
            facts,
            region,
            Lookups {
                sale: &sale,
                purchase: &purchase,
                item_tag: &item_tag,
            },
            ruleset,
        ));
    }

    // One claim was pushed per unit, in the same loop that pushed its forecast, so the two are
    // index-aligned - which is also what keeps two units sharing an id from being confused for one
    // another, as a lookup by id could not.
    let settled = feed_from_faction_food(&claims);
    for (claim, forecast) in claims.iter().zip(into[start..].iter_mut()) {
        let Some(upkeep) = settled.get(&claim.unit_id).copied() else {
            continue;
        };
        // What the pool paid off is the difference it made. Usually that is the whole of what step
        // 1 left owing, since the pool feeds all or none - but a lone claimant against a short
        // pool eats what there is and keeps the remainder, so this is a subtraction rather than
        // the assumption that a fed unit owes nothing.
        if let Some(left) = upkeep {
            forecast.faction_food_covered = claim.owed_after_own_food - left;
        }
        forecast.upkeep = upkeep;
        if upkeep.is_none() {
            // A doubt about maintenance alone: income, expense and the month-end figure are all
            // still exactly known, and `at_month_end` never counted upkeep to begin with.
            forecast.doubt = forecast.doubt.or(Some(SilverDoubt::ContestedFactionFood));
        }
    }
}

/// Every gift of silver in the document, credited to the unit it names.
///
/// Only a gift this pass can both read and place is counted: the giver must be a unit the report
/// shows, in the same hex as the recipient, and an `ALL` amount needs the giver's own holding to
/// price. Anything else is silently absent rather than doubted - understating a unit's income shows
/// red where the truth may be black and never the reverse, and it agrees exactly with what the
/// `not-enough-silver` finding already counts.
fn gather_receipts(
    report: &ParsedReport,
    ordered: &OrderedUnits,
    ruleset: Option<&Ruleset>,
) -> BTreeMap<String, Receipts> {
    let located = where_the_report_shows_each_unit(report);
    let mut units: BTreeMap<&str, &ReportUnit> = BTreeMap::new();
    for region in &report.regions {
        for unit in &region.units {
            units.insert(unit.unit_id.as_str(), unit);
        }
    }

    // Document order, so a recipient's givers read in the order the orders were written.
    let mut givers: Vec<(&String, &UnitOrders)> = ordered.by_unit.iter().collect();
    givers.sort_by_key(|(id, orders)| (orders.block_line, id.as_str()));

    let mut receipts: BTreeMap<String, Receipts> = BTreeMap::new();
    for (giver_id, orders) in givers {
        let (Some(giver), Some(from)) = (
            units.get(giver_id.as_str()),
            located
                .get(giver_id.as_str())
                .map(|region| &region.region_id),
        ) else {
            continue;
        };

        for placed in &orders.intents {
            let Intent::Give {
                to: Party::Unit(recipient),
                what: Selector::Item(text),
                amount,
            } = &placed.intent
            else {
                // `GIVE 0` discards to nobody and a foreign unit is not ours; a class or the unit
                // itself moves an amount that depends on classifying everything it holds.
                continue;
            };
            if !names_silver(text, ruleset) {
                continue;
            }
            // A gift from another hex is one this pass cannot see the far side of.
            if located
                .get(recipient.as_str())
                .map(|region| &region.region_id)
                != Some(from)
            {
                continue;
            }

            let held = giver
                .items
                .iter()
                .find(|item| item.tag.eq_ignore_ascii_case(SILVER))
                .map_or(0, |item| item.amount);
            let quantity = match amount {
                Amount::Exact(count) => *count,
                Amount::All { except } => (held - except).max(0),
            };
            if quantity <= 0 {
                continue;
            }

            let entry = receipts.entry(recipient.clone()).or_default();
            entry.silver = entry.silver.saturating_add(quantity);
            let label = format!("{} ({})", giver.name, giver.unit_id);
            if !entry.givers.contains(&label) {
                entry.givers.push(label);
            }
        }
    }

    receipts
}

/// Whether an order's item argument names silver, by the catalogue where there is one and by the
/// item's own tag and name where there is not.
fn names_silver(text: &str, ruleset: Option<&Ruleset>) -> bool {
    match ruleset.and_then(|ruleset| ruleset.find_item(text)) {
        Some(item) => item.tag.eq_ignore_ascii_case(SILVER),
        None => names_the_same_item(text, SILVER, "silver"),
    }
}

/// Whether this order consumes the unit's month.
///
/// Written as an exhaustive `match` on purpose. `is_busy` below was a `matches!` with a fixed list,
/// and a variant missing from such a list returns `false` silently - the failure `ah-90w` had to
/// write a regression test against when `BUILD` gained a shape. Here the compiler refuses a new
/// `Intent` variant until somebody has said which side of this line it falls on.
fn spends_the_month(intent: &Intent) -> bool {
    match intent {
        // The rules' enumerated list, plus IDLE and ANNIHILATE, which reach here as `MonthLong`.
        // ADVANCE arrives as `Intent::Move`.
        Intent::Study { .. }
        | Intent::Teach { .. }
        | Intent::Tax
        | Intent::Pillage
        | Intent::Work
        | Intent::Entertain
        | Intent::Move { .. }
        | Intent::Sail { .. }
        | Intent::Build { .. } => true,

        // CAST is NOT a full month order: "a mage may still MOVE, STUDY, or use any other month
        // long order". A bare CAST falls back to `MonthLong("CAST")`, so it has to be caught
        // before the arm below - which is why these two arms are in this order.
        Intent::MonthLong("CAST") => false,
        Intent::MonthLong(_) => true,

        // Each of these leaves the month free. GUARD is a flag rather than a month's work - a
        // guard can tax as well - and FORM only asks for a unit to exist.
        Intent::Cast { .. }
        | Intent::Give { .. }
        | Intent::Take { .. }
        | Intent::Buy { .. }
        | Intent::Sell { .. }
        | Intent::Guard(_)
        | Intent::Claim(_)
        | Intent::Withdraw { .. }
        | Intent::Form { .. }
        | Intent::Enter { .. }
        | Intent::Leave => false,
    }
}

/// Every unit block in the document, by unit number.
///
/// A unit written twice has both blocks read as one: the server would run them both, so charging
/// the unit for only the first would be a model of a turn nobody is playing.
struct OrderedUnits {
    by_unit: BTreeMap<String, UnitOrders>,
}

/// One unit's orders as this pass needs them: what it was told to do, where its block starts, and
/// whether anything in it could not be read.
struct UnitOrders {
    /// The `unit NNNN` line of the *first* block for this unit, to hang a finding on.
    block_line: usize,
    intents: Vec<PlacedIntent>,
    /// Whether any line in any of this unit's blocks yielded no intent.
    unread: bool,
}

impl OrderedUnits {
    fn read(source: &str) -> Self {
        let mut by_unit: BTreeMap<String, UnitOrders> = BTreeMap::new();
        for UnitIntents {
            unit_id,
            line,
            intents,
            unread,
        } in read_intents(source)
        {
            let entry = by_unit.entry(unit_id).or_insert_with(|| UnitOrders {
                block_line: line,
                intents: Vec::new(),
                unread: false,
            });
            entry.intents.extend(intents);
            entry.unread |= !unread.is_empty();
        }
        Self { by_unit }
    }

    fn get(&self, unit_id: &str) -> Option<&UnitOrders> {
        self.by_unit.get(unit_id)
    }

    /// Just the intents, for a caller that has no use for the block line or the unread flag.
    fn intents_of(&self, unit_id: &str) -> &[PlacedIntent] {
        self.get(unit_id)
            .map_or(&[][..], |orders| orders.intents.as_slice())
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
    /// `None` when the document has no block for this unit at all.
    block_line: Option<usize>,
    unread: bool,
}

impl<'a> Hex<'a> {
    fn read(region: &'a ReportRegion, ordered: &'a OrderedUnits) -> Self {
        let units = region
            .units
            .iter()
            .filter(|unit| unit.own)
            .map(|unit| {
                let orders = ordered.get(&unit.unit_id);
                Ordered {
                    unit,
                    intents: orders.map_or(&[][..], |orders| orders.intents.as_slice()),
                    block_line: orders.map(|orders| orders.block_line),
                    unread: orders.is_some_and(|orders| orders.unread),
                }
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
    /// Teaching is itself a full-month order, so a unit that also does something else with its
    /// month has written an impossible turn, and its teaching slots are not worth offering. Since
    /// ah-vw63 this only ever sees units that actually TEACH, so every other order is classified
    /// by `spends_the_month` - CAST included, which the rules say leaves the month free. Teaching
    /// itself is excluded here because it is the very thing being weighed.
    fn is_busy(&self) -> bool {
        self.intents()
            .any(|intent| spends_the_month(intent) && !matches!(intent, Intent::Teach { .. }))
    }

    fn skill_level(&self, tag: &str) -> u32 {
        self.unit
            .skills
            .iter()
            .find(|skill| skill.tag.eq_ignore_ascii_case(tag))
            .map_or(0, |skill| skill.level)
    }

    fn studies(&self) -> Option<&str> {
        self.studies_placed().map(|(_, skill)| skill)
    }

    /// The unit's STUDY order and where it was written, for a finding that must sit on its line.
    /// `studies()` answers the same question without the placement, and several callers only want
    /// that.
    fn studies_placed(&self) -> Option<(&PlacedIntent, &str)> {
        self.intents.iter().find_map(|placed| match &placed.intent {
            Intent::Study { skill } => Some((placed, skill.as_str())),
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

    /// A finding against the unit's block rather than against one order in it, for a check whose
    /// subject is the absence of an order. No columns: there is no token to underline.
    fn finding_at_block(&self, hex: &Hex<'_>, code: Code, message: String) -> Finding {
        Finding {
            code,
            message,
            region_id: hex.region.region_id.clone(),
            unit_id: Some(self.unit.unit_id.clone()),
            line: self.block_line,
            column_start: None,
            column_end: None,
        }
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
    /// What each unit was charged in maintenance, so a shortfall message can say that the fee is
    /// part of what drew the balance down - it is not an order, and saying "its orders spend" of
    /// it would tell a player their orders spend silver they do not (`ah-1wcw.4`).
    upkeep: BTreeMap<String, i64>,
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
        upkeep: BTreeMap::new(),
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

    charge_upkeep(&mut ledger, hex);

    ledger
}

/// Charges every unit its monthly maintenance, after the orders have run.
///
/// Deliberately not through `charge`: upkeep belongs to no order, and `charged_at` is read only to
/// point a finding at the line that drew a balance down. Deliberately not following the display
/// setting either (`ah-1wcw.4`) - a display preference must not silently change which warnings
/// fire, so the check always counts it. A unit whose headcount is a guess is charged nothing rather
/// than a guess.
fn charge_upkeep(ledger: &mut Ledger<'_>, hex: &Hex<'_>) {
    // Step 2 of the payment order, exactly as `forecast_hex` runs it. The check and the Silver
    // column read one fact, so they settle the hex's faction-food pool the same way: warning that
    // a unit cannot pay a fee its faction-mates' grain already paid is two surfaces contradicting
    // each other, which is what `ah-7cdt`'s verification found.
    let claims: Vec<FoodClaim> = hex
        .units
        .iter()
        .map(|ordered| {
            food_claim(&UnitFacts {
                unit_id: &ordered.unit.unit_id,
                region_id: &hex.region.region_id,
                held: ordered.holding(SILVER),
                men: ordered.unit.men,
                men_estimated: ordered.unit.men_estimated,
                men_by_race: &ordered.unit.men_by_race,
                items: &ordered.unit.items,
                flags: &ordered.unit.flags,
                skills: &ordered.unit.skills,
                intents: ordered.intents,
                receipts: &Receipts::default(),
            })
        })
        .collect();
    let settled = feed_from_faction_food(&claims);

    for ordered in &hex.units {
        let facts = UnitFacts {
            unit_id: &ordered.unit.unit_id,
            region_id: &hex.region.region_id,
            held: ordered.holding(SILVER),
            men: ordered.unit.men,
            men_estimated: ordered.unit.men_estimated,
            men_by_race: &ordered.unit.men_by_race,
            items: &ordered.unit.items,
            flags: &ordered.unit.flags,
            skills: &ordered.unit.skills,
            intents: ordered.intents,
            receipts: &Receipts::default(),
        };
        let owed = match settled.get(&ordered.unit.unit_id) {
            // The pool fed this unit: it owes what step 2 left it, not what step 1 did.
            Some(Some(left)) => *left,
            // Contended for a pool too small to feed them all, so what this unit pays cannot be
            // told at all (the column shows `?`). Charging the undiscounted fee would warn about
            // a shortfall that may not exist, and this module does not produce false warnings.
            Some(None) => continue,
            None => match unit_upkeep(&facts) {
                Some(owed) => owed,
                None => continue,
            },
        };
        if owed <= 0 {
            continue;
        }
        *ledger
            .balance
            .entry((ordered.unit.unit_id.clone(), SILVER.to_string()))
            .or_insert(0) -= owed;
        ledger.upkeep.insert(ordered.unit.unit_id.clone(), owed);
    }
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
                    "this hex does not {verb} {name} - its market {has_or_wants} {}",
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
        Intent::Cast { spell, arguments } => cast(ledger, actor, placed, spell, arguments, ruleset),
        // The ruleset prices a withdrawal (`ah-1wcw.6`), so it is charged. A price it does not
        // carry - an item that is not a basic one, or a ruleset cached before that bead - is still
        // an amount nobody can count, which is exactly the case for declining to judge the unit.
        Intent::Withdraw { count, item } => {
            match resolve_item(item, hex, actor, ruleset)
                .and_then(|tag| ruleset?.items.get(&tag)?.withdraw_cost)
            {
                Some(cost) => charge(ledger, who, SILVER, count.saturating_mul(cost), placed),
                None => {
                    ledger.doubted.insert(who.clone());
                }
            }
        }
        // Wages and takings from entertaining are paid in the last phase of the turn, after study
        // has been paid for, so they can fund nothing this month.
        Intent::Work | Intent::Entertain => {}
        Intent::Guard(_)
        | Intent::Teach { .. }
        | Intent::Move { .. }
        | Intent::MonthLong(_)
        | Intent::Form { .. } => {}
        Intent::Sail { .. } | Intent::Enter { .. } | Intent::Leave | Intent::Build { .. } => {}
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

/// Charges what the ruleset says a cast consumes. A spell the ruleset does not know, or knows no
/// cost for, charges nothing and doubts nothing: most spells cost nothing to cast, and a unit's
/// other sums are still good.
fn cast(
    ledger: &mut Ledger<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    spell: &str,
    arguments: &[String],
    ruleset: Option<&Ruleset>,
) {
    let who = &actor.unit.unit_id;

    let Some(cost) = ruleset
        .and_then(|ruleset| ruleset.find_skill(spell))
        .and_then(|skill| skill.cast.as_ref())
    else {
        return;
    };

    for input in &cost.costs {
        charge(ledger, who, &input.tag, input.amount, placed);
    }

    if cost.transmute.is_empty() {
        return;
    }

    // `CAST Transmutation [number] <material>`: the material is the spell's *output* - "the
    // resource you wish to create" - and the source it is made from is the ruleset's business.
    // An unnumbered cast makes as many as it can, so the least a successful one consumes is one.
    let (number, material) = match arguments {
        [count, material] => match count.parse::<i64>() {
            Ok(count) if count > 0 => (count, material.as_str()),
            _ => return,
        },
        [material] => (1, material.as_str()),
        _ => return,
    };

    let Some(output) = ruleset.and_then(|ruleset| ruleset.find_item(material)) else {
        return;
    };
    let Some(source) = cost.transmute.get(&output.tag.to_ascii_uppercase()) else {
        return;
    };
    charge(ledger, who, source, number, placed);
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
                        "short ${short}: this unit can have ${} and its {} spend ${}",
                        ordered.holding(SILVER),
                        spenders(ledger.upkeep.get(who).copied().unwrap_or(0)),
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
                        "short {short} {name}: this unit can have {} and its orders spend {}",
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
        // can have X and their orders spend Y" the way the per-unit one does.
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
            let owed: i64 = hex
                .units
                .iter()
                .map(|o| ledger.upkeep.get(&o.unit.unit_id).copied().unwrap_or(0))
                .sum();
            format!(
                "the units in this hex are short ${short} between them: they can have ${held} \
                 and their {} spend ${}",
                if owed > 0 {
                    "orders and upkeep"
                } else {
                    "orders"
                },
                held + short,
            )
        } else {
            let name = item_name(&tag, hex, ruleset);
            format!(
                "the units in this hex are short {short} {name} between them: they can have \
                 {held} and their orders spend {}",
                held + short,
            )
        };
        findings.push(hex.finding(code, message));
    }
}

/// What a shortfall message names as having spent the silver.
///
/// Maintenance is not an order, so a unit charged one must not be told its *orders* spend it - the
/// fee is charged whatever a unit is told to do, and a player reading "its orders spend $30" of a
/// unit whose orders spend nothing would go looking for a mistake that is not there.
fn spenders(upkeep: i64) -> &'static str {
    if upkeep > 0 {
        "orders and upkeep"
    } else {
        "orders"
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

/// A unit that actually teaches, with slots going spare while somebody in its hex studies untaught.
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

    // Only a unit that actually wrote a TEACH order this month. Before ah-vw63 this ran for every
    // unit in the hex, so a unit that was never asked to teach was told it had teaching slots
    // free - and the idle-skilled-unit case this check was invented for is now ah-dwk6's
    // `unit-does-nothing`, on the same unit and in the same list.
    if !teacher
        .intents()
        .any(|intent| matches!(intent, Intent::Teach { .. }))
    {
        return;
    }

    // A TEACH naming nobody this hex holds is already reported as `taught-not-here`, and its slots
    // are free only as a consequence of that mistake. One mistake, marked once.
    if !teaches_somebody_here(teacher, hex) {
        return;
    }

    // Teaching takes the whole month, so a unit spending its month otherwise is not free to teach:
    // a unit writing both TEACH and WORK has an impossible month, and offering its slots would be
    // advice about a turn nobody is playing.
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
                "has {free} teaching slots still free and could also teach unit {}{and_others}",
                first.unit.unit_id,
            ),
            teacher
                .intents
                .iter()
                .find(|placed| matches!(placed.intent, Intent::Teach { .. })),
        ),
    );
}

/// Whether this unit's TEACH orders name at least one unit the hex can resolve.
///
/// `Party::New`, `Party::Foreign` and `Party::Discard` never resolve: a unit formed this month has
/// no number yet, and another faction's unit is not ours to read. Those are doubt, not students.
/// A student that marches out of the hex does not resolve either - `check_one_teacher` reads it
/// the same way and already reports it as `taught-not-here`.
fn teaches_somebody_here(teacher: &Ordered<'_>, hex: &Hex<'_>) -> bool {
    teacher
        .intents()
        .filter_map(|intent| match intent {
            Intent::Teach { students } => Some(students),
            _ => None,
        })
        .flatten()
        .any(|student| match student {
            Party::Unit(id) => hex.find(id).is_some_and(|pupil| !pupil.leaves_the_hex()),
            _ => false,
        })
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
        // A student that marches off is taught by nobody, so it holds no slot - the same reading
        // `could_take` and `check_one_teacher` take of a departing pupil.
        .filter(|pupil| !pupil.leaves_the_hex())
        .map(|pupil| pupil.unit.men)
        .sum()
}

// --- building on what is already finished ---------------------------------------------------------

/// A `BUILD` (bare, `COMPLETE`, or `HELP [unit]`) that carries on with a structure the report
/// already shows as finished (`needs: None`) spends the unit's month for nothing. `BUILD [name]`
/// founds something that does not exist yet and is never this case.
fn check_building(hex: &Hex<'_>, options: &CheckOptions, findings: &mut Vec<Finding>) {
    if !options.emits(codes::ALREADY_BUILT) {
        return;
    }

    for ordered in &hex.units {
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Build { .. }))
        else {
            continue;
        };
        let Intent::Build { founding, helping } = &placed.intent else {
            continue;
        };
        if founding.is_some() {
            continue;
        }

        // Whose structure is it: the helped unit's, or the builder's own. A helper naming
        // anything other than an existing unit of ours in this hex - a unit formed this turn
        // with no number yet, another faction's unit, `HELP 0` - cannot be resolved to a
        // structure at all, and is doubt rather than the builder's own structure.
        let (worker, helped_id) = match helping {
            None => (ordered, None),
            Some(Party::Unit(id)) => match hex.find(id) {
                Some(helped) => (helped, Some(id.as_str())),
                // A unit not in this hex - not on the report at all, or one that formed this
                // month and has no number yet - cannot be judged.
                None => continue,
            },
            Some(Party::New(_) | Party::Foreign { .. } | Party::Discard) => continue,
        };

        let Some(structure_id) = structure_after_orders(worker) else {
            continue;
        };
        let Some(structure) = hex
            .region
            .structures
            .iter()
            .find(|structure| structure.structure_id == structure_id)
        else {
            continue;
        };
        if structure.needs.is_some() {
            continue;
        }

        let name = structure_label(structure);
        let message = match helped_id {
            Some(id) => format!("{name}, which unit {id} is in, is already finished"),
            None => format!("{name} is already finished"),
        };
        findings.push(ordered.finding(hex, codes::ALREADY_BUILT, message, Some(placed)));
    }
}

// --- building with nothing to build ----------------------------------------------------------

/// Every own unit whose bare `BUILD` or `BUILD COMPLETE` is written from inside no structure at
/// all. Neither form names what to work on, so from outside the order does nothing and the unit's
/// month is spent for nothing.
///
/// Its own gate rather than a branch of `check_building`, which early-returns on `already-built`:
/// hosting this there would silently switch it off with a different toggle.
fn check_building_outside(hex: &Hex<'_>, options: &CheckOptions, findings: &mut Vec<Finding>) {
    if !options.emits(codes::BUILD_OUTSIDE_STRUCTURE) {
        return;
    }

    for ordered in &hex.units {
        // One warning per unit, on the first BUILD in the block, as `check_building` does.
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Build { .. }))
        else {
            continue;
        };
        let Intent::Build { founding, helping } = &placed.intent else {
            continue;
        };
        // `BUILD [name]` founds something that needs no structure to stand in, and the HELP forms
        // name whose structure to work on - that is `check_build_help`'s business, not this one's.
        if founding.is_some() || helping.is_some() {
            continue;
        }
        // Where the unit stands once its own ENTER/LEAVE have run, never `unit.structure_id`: an
        // `ENTER` then `BUILD` is the ordinary correct way to write this, and a `LEAVE` then
        // `BUILD` is the mistake, whatever the report shows.
        if structure_after_orders(ordered).is_some() {
            continue;
        }

        findings.push(ordered.finding(
            hex,
            codes::BUILD_OUTSIDE_STRUCTURE,
            "is in no structure to build in".to_string(),
            Some(placed),
        ));
    }
}

/// Every own unit whose `BUILD HELP` names one of our own units in this hex that has no BUILD
/// order of its own. There is nothing to help with, so the helper's month is spent for nothing.
///
/// A helper whose target *is* building but is itself in no structure stays silent here: the
/// target's own line carries that warning. One mistake, marked once, where it was made - a
/// deliberate divergence from `check_building`'s helper behaviour.
fn check_build_help(hex: &Hex<'_>, options: &CheckOptions, findings: &mut Vec<Finding>) {
    if !options.emits(codes::BUILD_HELP_NOT_BUILDING) {
        return;
    }

    for ordered in &hex.units {
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Build { .. }))
        else {
            continue;
        };
        let Intent::Build { helping, .. } = &placed.intent else {
            continue;
        };
        // A unit formed this month with no number yet, another faction's unit or `HELP 0` cannot
        // be resolved to anything to judge.
        let Some(Party::Unit(id)) = helping else {
            continue;
        };
        // `hex.units` holds own units only, so this is also the "one of our own" test.
        let Some(helped) = hex.find(id) else {
            continue;
        };
        // Any BUILD counts, `BUILD [name]` included: founding is building, so there is work to
        // help with. Whether that BUILD is any good is judged on the helped unit's own line.
        if helped
            .intents
            .iter()
            .any(|placed| matches!(placed.intent, Intent::Build { .. }))
        {
            continue;
        }

        findings.push(ordered.finding(
            hex,
            codes::BUILD_HELP_NOT_BUILDING,
            format!("unit {id} is not building"),
            Some(placed),
        ));
    }
}

// --- building without the skill ---------------------------------------------------------------

/// `a` or `an` for a structure kind, from its first letter. `an Inn`, `an Oasis`, `a Mine`.
///
/// Letter-wise rather than clever: every kind the data page names is an ordinary English noun, and
/// none of them is one of the exceptions (`a unicorn`, `an hour`) that a rule reading the sound
/// would be needed for.
fn article_for(kind: &str) -> &'static str {
    match kind.chars().next() {
        Some(first) if "aeiouAEIOU".contains(first) => "an",
        _ => "a",
    }
}

/// Every own unit whose BUILD names - or stands in - a structure it has not the skill, or not the
/// level, to build. The order is legal to write and spends the month for nothing.
///
/// A fourth check beside `check_building`, `check_building_outside` and `check_build_help` rather
/// than a branch of any of them, for the reason `check_building_outside`'s own doc gives: hosting
/// it there would silently switch it off with a different toggle.
///
/// Ships are out of scope - they are items, not buildings, and the catalogue carries no build
/// requirement for them, so a `BUILD` of one looks exactly like a kind the page does not name and
/// stays silent for that reason.
fn check_build_skill(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    // No ruleset at all, or one carrying no buildings table: `build_requirement` would answer
    // `None` for every kind, which the loop below already reads as silence, so this gate changes
    // no verdict. It states the whole-catalogue case once and in one place - "this ruleset can say
    // nothing about any structure" is a different fact from "the page names no requirement for
    // this one", even though both end in the same silence - and saves resolving what every unit in
    // the game is building only to find nothing to compare it against.
    let Some(ruleset) = ruleset else { return };
    if !ruleset.knows_buildings() {
        return;
    }
    if !options.emits(codes::BUILD_WITHOUT_SKILL) {
        return;
    }

    for ordered in &hex.units {
        // One warning per unit, on the first BUILD in the block, as the other two BUILD checks do.
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Build { .. }))
        else {
            continue;
        };
        let Intent::Build { founding, helping } = &placed.intent else {
            continue;
        };

        let (kind, helps) = match (founding, helping) {
            // The player named the structure type outright.
            (Some(name), _) => (name.clone(), false),
            // `BUILD HELP <n>`: the helper is judged on what the helped unit is building. One
            // level of indirection only - a helper of a helper is not resolved and stays silent,
            // since nothing here says which of the two the chain really lands on.
            (None, Some(Party::Unit(id))) => {
                let Some(helped) = hex.find(id) else {
                    continue;
                };
                let Some(target) = helped
                    .intents
                    .iter()
                    .find_map(|placed| match &placed.intent {
                        Intent::Build { founding, helping } => Some((founding, helping)),
                        _ => None,
                    })
                else {
                    // Nothing being helped with at all - `check_build_help`'s warning, not this
                    // one's.
                    continue;
                };
                match target {
                    (Some(name), _) => (name.clone(), true),
                    (None, Some(_)) => continue,
                    (None, None) => match kind_standing_in(hex, helped) {
                        Some(kind) => (kind, true),
                        None => continue,
                    },
                }
            }
            // `HELP 0`, another faction's unit, or a unit formed this month with no number yet.
            (None, Some(_)) => continue,
            // A bare `BUILD` or `BUILD COMPLETE`: the unit works on the structure it stands in.
            (None, None) => match kind_standing_in(hex, ordered) {
                Some(kind) => (kind, false),
                None => continue,
            },
        };

        // 22 of the page's 58 buildings state no requirement. That is the catalogue declining to
        // say, never a claim that anyone may build it, so it is silence here.
        let Some((tag, required)) = ruleset.build_requirement(&kind) else {
            continue;
        };
        // `skill_level` answers 0 for a skill the unit has not got, which makes the comparison
        // uniform - the *message* still has to tell the two apart.
        let held = i64::from(ordered.skill_level(tag));
        if held >= required {
            continue;
        }

        // The catalogue's own lower-case name, not the tag: "mining", not "MINI".
        let skill = ruleset
            .find_skill(tag)
            .map_or_else(|| tag.to_ascii_lowercase(), |entry| entry.name.clone());
        let shortfall = if held == 0 {
            format!("has no {skill}")
        } else {
            format!("has {skill} {held}")
        };
        let verb = if helps {
            "cannot help build"
        } else {
            "cannot build"
        };
        let article = article_for(&kind);

        findings.push(ordered.finding(
            hex,
            codes::BUILD_WITHOUT_SKILL,
            format!("{verb} {article} {kind}: needs {skill} {required}, {shortfall}"),
            Some(placed),
        ));
    }
}

/// The kind of structure a unit is working on when its BUILD names none: the one it stands in once
/// its own ENTER/LEAVE have run.
///
/// `None` for both silences - standing in nothing at all, which is `check_building_outside`'s
/// warning rather than this one's, and standing in a structure the report does not describe, which
/// is simply unknowable.
fn kind_standing_in(hex: &Hex<'_>, ordered: &Ordered<'_>) -> Option<String> {
    let id = structure_after_orders(ordered)?;
    hex.region
        .structures
        .iter()
        .find(|structure| structure.structure_id == id)
        .map(|structure| structure.kind.clone())
}

/// A structure's name, or - when the report gave it none and printed a placeholder like
/// `+ Building [4] : Stockade` or `+ Ship [218] : Raft` - that placeholder with the id appended.
fn structure_label(structure: &Structure) -> String {
    if structure.name.eq_ignore_ascii_case("Building")
        || structure.name.eq_ignore_ascii_case("Ship")
    {
        format!("{} {}", structure.name, structure.structure_id)
    } else {
        structure.name.clone()
    }
}

// --- studying at the ceiling ----------------------------------------------------------------------

/// Every own unit whose STUDY order names a skill it has already taken to the ruleset's maximum.
fn check_studying(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    // No ruleset, no stated ceiling: there is nothing to compare the unit's level against.
    let Some(ruleset) = ruleset else { return };
    if !options.emits(codes::STUDY_AT_MAXIMUM) {
        return;
    }

    for ordered in &hex.units {
        let Some((placed, studying)) = ordered.studies_placed() else {
            continue;
        };
        // A skill the catalogue does not know has no stated maximum, and guessing at one is
        // exactly what accept-on-doubt forbids.
        let Some(skill) = ruleset.find_skill(studying) else {
            continue;
        };
        // No entry for this skill on the unit means it has never studied it, so it is not at any
        // maximum.
        let Some(level) = ordered
            .unit
            .skills
            .iter()
            .find(|entry| entry.tag.eq_ignore_ascii_case(&skill.tag))
            .map(|entry| entry.level)
        else {
            continue;
        };

        if level >= skill.max_level {
            findings.push(ordered.finding(
                hex,
                codes::STUDY_AT_MAXIMUM,
                format!(
                    "this unit is already at {} {}, the highest the ruleset has",
                    skill.name, level
                ),
                Some(placed),
            ));
        }
    }
}

// --- magic studied where nothing houses the mage --------------------------------------------------

/// Magic studied above level 2 where nothing houses the mage: half the month is wasted.
///
/// The engine's own message is advisory - the study happens, at half rate - so this mirrors an
/// advisory and never a refusal.
///
/// Silent when the ruleset cannot say: no ruleset, no buildings table, a skill the catalogue does
/// not know, or a unit standing in a structure this region's report does not list. **Not** silent
/// for an unfinished building: the navigator settled that one (2026-08-17) as a deliberate
/// exception to this module's accept-on-doubt policy - an unfinished building shelters nobody, so
/// the study really is halved and the player is told.
fn check_magic_study(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    // No ruleset, or one cached before buildings were scraped: `mage_capacity` would answer `None`
    // for every kind, and this check would then warn about every mage in the game.
    let Some(ruleset) = ruleset else { return };
    if !ruleset.knows_buildings() {
        return;
    }
    if !options.emits(codes::MAGIC_STUDY_OUTSIDE_BUILDING) {
        return;
    }

    for ordered in &hex.units {
        let Some((placed, studying)) = ordered.studies_placed() else {
            continue;
        };
        // A skill the catalogue does not know is one whose magic-ness cannot be judged.
        let Some(skill) = ruleset.find_skill(studying) else {
            continue;
        };
        if !ruleset.is_magic(&skill.tag) {
            continue;
        }

        // "Above level 2" is the level reached, so the level held must be 2 or more. No entry at
        // all means the unit has never studied it - level 0, and below the threshold either way.
        let level = ordered
            .unit
            .skills
            .iter()
            .find(|entry| entry.tag.eq_ignore_ascii_case(&skill.tag))
            .map_or(0, |entry| entry.level);
        if level < 2 {
            continue;
        }

        let standing_in = structure_after_orders(ordered).map(|id| {
            hex.region
                .structures
                .iter()
                .find(|structure| structure.structure_id == id)
        });
        let sheltered = match standing_in {
            // Not in a structure at all: nothing houses the mage.
            None => false,
            // In one the region's report does not list. Nothing can be said about a structure that
            // is not there to look at, so say nothing.
            Some(None) => continue,
            // Unfinished shelters nobody; a kind the table does not name - a Mine, an Inn, a ship -
            // houses no mages either, and a Tower is named and seats zero.
            Some(Some(structure)) => {
                structure.needs.is_none()
                    && ruleset
                        .mage_capacity(&structure.kind)
                        .is_some_and(|seats| seats >= 1)
            }
        };
        if sheltered {
            continue;
        }

        findings.push(ordered.finding(
            hex,
            codes::MAGIC_STUDY_OUTSIDE_BUILDING,
            format!(
                "half of this month's study of {} is wasted outside a building that houses mages",
                skill.name
            ),
            Some(placed),
        ));
    }
}

// --- FORM aliases --------------------------------------------------------------------------------

/// Every FORM in the hex, in document order; each alias after its first use is a block the server
/// will refuse (the alias is per region for the month — see the rules on FORM), and says so on
/// its own line, naming the first use. The first FORM is the one that will exist and is left alone.
/// Every own unit whose orders, all of which we could read, spend none of its month.
fn check_idle_units(hex: &Hex<'_>, options: &CheckOptions, findings: &mut Vec<Finding>) {
    if !options.emits(codes::UNIT_DOES_NOTHING) {
        return;
    }

    for ordered in &hex.units {
        // A line we could not read may well be a month's work - `ASSASSINATE 4021` is - so a unit
        // holding one is not judged at all. Silence here is the price of never being wrong.
        if ordered.unread {
            continue;
        }
        // A unit with no men cannot spend a month on anything, so there is no order the player
        // could add that would satisfy this - the advice would be unfollowable rather than merely
        // unwelcome (ah-udff, revising ah-dwk6's "no exemptions"). Only when the count is a count:
        // `men` is 0 on a unit whose items the ruleset could not read, and exempting that one
        // would hide a real unit instead of a husk.
        if ordered.unit.men == 0 && !ordered.unit.men_estimated {
            continue;
        }
        if ordered.intents().any(spends_the_month) {
            continue;
        }
        findings.push(ordered.finding_at_block(
            hex,
            codes::UNIT_DOES_NOTHING,
            "has no order that spends the month".to_string(),
        ));
    }
}

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

/// Whether the unit is aboard `fleet_id` once this month's ENTER/LEAVE orders have run - see
/// `structure_after_orders` for the rule, which is that every LEAVE runs before any ENTER.
fn is_aboard(ordered: &Ordered<'_>, fleet_id: &str) -> bool {
    structure_after_orders(ordered) == Some(fleet_id)
}

/// The structure the unit is in once this month's ENTER/LEAVE orders have run, or `None` when it
/// ends the month in nothing.
///
/// The rule itself lives in [`super::standing`], which is the one place it is stated; this is the
/// adapter that reads it out of parsed intents.
fn structure_after_orders<'a>(ordered: &Ordered<'a>) -> Option<&'a str> {
    structure_after_intents(ordered.unit.structure_id.as_deref(), ordered.intents)
}

/// [`structure_after_orders`] over the two things it actually reads, so the agreement test can
/// drive this reader without building a whole [`Ordered`].
pub(crate) fn structure_after_intents<'a>(
    reported: Option<&'a str>,
    intents: &'a [PlacedIntent],
) -> Option<&'a str> {
    standing_after(reported, intents.iter().filter_map(boarding_of))
}

/// One parsed intent as [`super::standing`] reads it; anything that is not a boarding order is not
/// one.
fn boarding_of(placed: &PlacedIntent) -> Option<Boarding<'_>> {
    match &placed.intent {
        Intent::Enter { structure } => Some(Boarding::Enter(structure.as_str())),
        Intent::Leave => Some(Boarding::Leave),
        _ => None,
    }
}

/// Whether the unit could be giving the SAIL order for `fleet_id` - see
/// [`super::standing::could_captain`], which states why that is not the same question as where the
/// unit ends up.
fn could_captain(ordered: &Ordered<'_>, fleet_id: &str) -> bool {
    standing::could_captain(
        ordered.unit.structure_id.as_deref(),
        fleet_id,
        ordered.intents.iter().filter_map(boarding_of),
    )
}

/// What one unit weighs once this month's orders have run: the weight the report gave it, plus
/// everything those orders move into or out of it that the ruleset can price.
///
/// The ledger is read whole rather than filtered, because every order that changes an item balance
/// runs before the fleet does: GIVE and TAKE in phase 4, SELL and BUY in phase 7, movement in
/// phase 9. TAX, CLAIM, PILLAGE and STUDY move silver, which the ruleset weighs at 0; PRODUCE,
/// BUILD and WORK are phase 10, after the fleet has gone, and touch no balance here anyway.
///
/// An order the ledger could not price changed no balance at all - `transfer`, `buy` and the
/// WITHDRAW arm (for an item the ruleset prices nowhere) record their doubt and return before
/// charging anything - so it contributes nothing
/// here and the unit keeps the report's weight for that part. That is the navigator's answer to
/// "silence or fall back": fall back. `None` only when the report never said what the unit weighs.
fn weight_after_orders(
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

/// The sailing levels one unit supplies once this month's transfers of men have run.
///
/// A unit's skill level is held by each of its men - "the number of skill levels of the Sailing
/// skill that must be aboard the ship" - so men leaving take levels with them. Read from the
/// ledger for the same reason `weight_after_orders` is: the server runs every GIVE and TAKE
/// (phase 4) before it moves anybody (phase 9), so giving a gnoll away and sailing in the same
/// month is one turn, not two.
///
/// `None` - cannot say, so the caller silences the crew check for this fleet - when men arrive
/// rather than leave. The game merges given men into the receiving unit and recomputes its skill,
/// which this application does not model; counting them at the receiver's own level would turn two
/// unskilled gnolls into two sailors, and a warning that is wrong is worse than one that is
/// missing (this module's header, and the navigator's own answer on the amendment).
fn sailing_levels_after_orders(
    ordered: &Ordered<'_>,
    ledger: &Ledger<'_>,
    ruleset: Option<&Ruleset>,
) -> Option<i64> {
    let level: i64 = ordered
        .unit
        .skills
        .iter()
        .filter(|skill| skill.tag.eq_ignore_ascii_case("SAIL"))
        .map(|skill| i64::from(skill.level))
        .sum();

    // Without a catalogue there is no telling which tags name people, so no delta can be computed.
    let ruleset = ruleset?;

    let mut men_moved: i64 = 0;
    for ((unit_id, tag), balance) in &ledger.balance {
        if unit_id != &ordered.unit.unit_id || !ruleset.is_man(tag) {
            continue;
        }
        let moved = balance - ordered.holding(tag);
        if moved > 0 {
            // Men of this race arrived: the merged unit's skill is unknowable. Tested per tag
            // rather than on the total, so a unit that takes gnolls in and gives centaurs away is
            // doubted rather than netting out to a number that looks like a plain departure.
            return None;
        }
        men_moved = men_moved.saturating_add(moved);
    }

    let men = ordered.unit.men.saturating_add(men_moved).max(0);
    Some(level.saturating_mul(men))
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
/// holding (`weight_after_orders`), not at what the report printed, because the server runs every
/// transfer and every market order before it moves a fleet. The crew is counted the same way
/// (`sailing_levels_after_orders`): men given or taken away this month take their sailing levels
/// with them, and men arriving into a unit aboard silence the crew check for the fleet, because
/// the game merges them and recomputes the receiving unit's skill and that is not modelled here.
/// Two different kinds of "cannot price" behave differently, deliberately: a MOVE touching the
/// fleet, a foreign unit aboard, or a report that never states a unit's weight silences the whole
/// fleet - never a guess. A single transfer the ledger or the ruleset cannot price (an
/// item with no catalogue weight, a WITHDRAW of something the ruleset prices nowhere) instead
/// falls back to that unit's report weight for its own
/// contribution (`weight_after_orders`'s doc comment), rather than silencing the fleet outright.
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
            .map(|ordered| weight_after_orders(ordered, ledger, ruleset))
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

        // A level is held by each of a unit's men, not by the unit once - see
        // `movement::mode::crew_sailing_levels`, which this sums the same way over the
        // aboard-after set.
        // What the report printed, which is the "before" the message compares against.
        let reported_levels: i64 = aboard
            .iter()
            .flat_map(|ordered| {
                let men = ordered.unit.men;
                ordered
                    .unit
                    .skills
                    .iter()
                    .filter(|skill| skill.tag.eq_ignore_ascii_case("SAIL"))
                    .map(move |skill| i64::from(skill.level) * men)
            })
            .sum();
        // The same after this month's transfers of men. `None` from any unit aboard silences the
        // crew check for the whole fleet - one unknowable unit makes the fleet's total unknowable.
        let levels: Option<i64> = aboard
            .iter()
            .map(|ordered| sailing_levels_after_orders(ordered, ledger, ruleset))
            .sum();
        // A guessed headcount cannot price an exact number of sailing levels either - the same
        // doubt `study` already treats `men_estimated` as (`:750`). Raised in review on this
        // bead's own PR. A unit whose sums the ledger could not follow is the same kind of doubt,
        // and both guard the crew finding alone: the load half has never consulted `doubted`, and
        // silencing overload warnings here would be a regression.
        let headcount_is_doubtful = aboard.iter().any(|ordered| {
            ordered.unit.men_estimated || ledger.doubted.contains(&ordered.unit.unit_id)
        });
        if let (Some(levels), Some(required)) = (levels, sailing_requirement(fleet, ruleset)) {
            if !headcount_is_doubtful
                && levels < required
                && options.emits(codes::FLEET_UNDERCREWED)
            {
                let crew = match levels - reported_levels {
                    change if change < 0 => format!(
                        "{reported_levels} sailing levels aboard less {} given away this month, \
                         it needs {required}",
                        -change
                    ),
                    // Unchanged, and the sentence `ah-j0e` already shipped: the crew did not move
                    // this month, so there is no before-and-after to draw. A positive change
                    // cannot occur - men arriving returns `None` above.
                    _ => format!("{levels} sailing levels aboard, it needs {required}"),
                };
                findings.push(captain.finding(
                    hex,
                    codes::FLEET_UNDERCREWED,
                    format!("{label} is short of sailors: {crew}, so it will not sail"),
                    Some(sail_placement),
                ));
            }
        }
    }
}

/// Every unit of ours that orders a MOVE: is what it will be carrying when it steps off more than
/// it can move with at all? "A unit can walk provided that the carrying capacity of its people,
/// horses and wagons is at least as great as the weight of all its other items... Otherwise the
/// unit cannot issue a MOVE order" - the game throws the whole order out rather than moving the
/// unit part of the way.
///
/// The load is what the unit weighs after this month's transfers, not what the report printed,
/// because the server runs every GIVE, TAKE, BUY and SELL before it moves anybody: giving the
/// ballast away and walking off in the same month is the ordinary fix for being overloaded, and a
/// check reading the printed weight would warn about it.
///
/// The allowance is the report's own, unrepriced. A unit that gives away the horses it was riding
/// loses ride capacity as well as weight, and this does not follow that - the error runs towards
/// saying nothing rather than towards a warning that is wrong, which is the trade this module
/// makes everywhere.
///
/// A unit riding a fleet says `SAIL`, which is its own intent, so a passenger is passed over here
/// without needing to be excluded.
fn check_movement(
    hex: &Hex<'_>,
    ledger: &Ledger<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::UNIT_OVERLOADED) {
        return;
    }

    for ordered in &hex.units {
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Move { .. }))
        else {
            continue;
        };

        let (Some(allowance), Some(weight)) = (
            best_allowance(ordered.unit),
            weight_after_orders(ordered, ledger, ruleset),
        ) else {
            continue;
        };

        if weight <= allowance {
            continue;
        }

        findings.push(ordered.finding(
            hex,
            codes::UNIT_OVERLOADED,
            format!(
                "this unit is overloaded: it carries {weight} and the most it can move with is \
                 {allowance}, so it will not move"
            ),
            Some(placed),
        ));
    }
}

// --- allowances spent across the whole map -------------------------------------------------------

/// Checks the allowances the faction spends across the whole map rather than in one hex.
///
/// The report states each one as `used (maximum)` in its `Faction Status:` block. `used` is the
/// faction's own figure rather than anything counted here, and what each check does with it
/// differs: `check_quartermasters` adds what these orders would spend on top of it, because a
/// quartermaster already held is not re-spent by an order. `check_trade_regions` ignores it
/// entirely - it counts last month's spend, and the question there is only what *this* month's
/// orders would spend against the maximum.
fn check_faction(
    report: &ParsedReport,
    ordered: &OrderedUnits,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    check_quartermasters(report, ordered, ruleset, options, findings);
    check_trade_regions(report, ordered, options, findings);
}

/// What this faction may spend on trade this month, and whether taxing draws on the same pool.
///
/// Two schemas are in the corpus and both are live. Older reports print `Tax Regions: 14 (15)` and
/// `Trade Regions: 15 (15)`, two counters over two pools. Newer ones print one `Regions: 10 (10)`
/// pooling both, and there a TAX order costs a region exactly as a PRODUCE does. The label is
/// whatever the ruleset printed (`report/header.rs:60-63`), so the specific one is asked for first
/// and the pooled one second; a report with neither is left alone rather than guessed at.
///
/// The `used` figure is deliberately ignored. It counts what *last* month spent, and the question
/// here is what this month's orders would spend.
fn trade_allowance(report: &ParsedReport) -> Option<(i64, bool)> {
    let entries = &report.header.faction_status.entries;
    let labelled = |label: &str| {
        entries
            .iter()
            .find(|entry| entry.label.eq_ignore_ascii_case(label))
    };

    if let Some(entry) = labelled("Trade Regions") {
        return Some((entry.maximum, false));
    }
    labelled("Regions").map(|entry| (entry.maximum, true))
}

/// `PRODUCE: Faction can't produce in that many regions.` A faction may only conduct trade
/// activity - which the rules define to include producing - in so many regions a month. Order
/// production in one region too many and the engine refuses that whole region's PRODUCE orders.
///
/// Which region loses is the engine's business and not knowable from here, so the warning names
/// the count and the allowance and never a hex. It belongs to the faction rather than to any one
/// region, and every finding needs a hex - a hexless one is dropped by the client on purpose
/// (`orderEditor.ts:194`). So it lands on the first PRODUCE order in the document: one line for
/// one mistake, on something the player can click.
fn check_trade_regions(
    report: &ParsedReport,
    ordered: &OrderedUnits,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::TOO_MANY_TRADE_REGIONS) {
        return;
    }

    let Some((allowance, pooled)) = trade_allowance(report) else {
        return;
    };

    let mut producing: BTreeSet<&str> = BTreeSet::new();
    let mut taxing: BTreeSet<&str> = BTreeSet::new();
    let mut first_produce: Option<(&str, &str, &PlacedIntent)> = None;

    for region in &report.regions {
        let region_id = region.region_id.as_str();
        for unit in region.units.iter().filter(|unit| unit.own) {
            for placed in ordered.intents_of(&unit.unit_id) {
                match &placed.intent {
                    Intent::MonthLong("PRODUCE") => {
                        producing.insert(region_id);
                        let earlier = first_produce
                            .as_ref()
                            .is_none_or(|(_, _, first)| placed.line < first.line);
                        if earlier {
                            first_produce = Some((region_id, unit.unit_id.as_str(), placed));
                        }
                    }
                    Intent::Tax => {
                        taxing.insert(region_id);
                    }
                    _ => {}
                }
            }
        }
    }

    let Some((region_id, unit_id, placed)) = first_produce else {
        return;
    };

    let used = if pooled {
        producing.union(&taxing).count()
    } else {
        producing.len()
    };
    let used = i64::try_from(used).unwrap_or(i64::MAX);
    if used <= allowance {
        return;
    }

    let message = if allowance == 0 {
        "this faction may not trade in any region, so every PRODUCE order will be refused"
            .to_string()
    } else {
        let excess = used - allowance;
        let regions = if excess == 1 { "region's" } else { "regions'" };
        if pooled {
            format!(
                "PRODUCE and TAX orders in {used} regions; this faction may tax and trade in \
                 {allowance}, so {excess} {regions} orders will be refused"
            )
        } else {
            format!(
                "PRODUCE orders in {used} regions; this faction may trade in {allowance}, so \
                 {excess} {regions} production will be refused"
            )
        }
    };

    findings.push(Finding {
        code: codes::TOO_MANY_TRADE_REGIONS,
        message,
        region_id: region_id.to_string(),
        unit_id: Some(unit_id.to_string()),
        line: Some(placed.line),
        column_start: Some(placed.column_start),
        column_end: Some(placed.column_end),
    });
}

/// `STUDY: Can't have another quartermaster.` A faction may hold only so many at once, and the
/// report prints the allowance in its own header - a unit ordered to study past it spends the
/// month and is refused.
fn check_quartermasters(
    report: &ParsedReport,
    ordered: &OrderedUnits,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::TOO_MANY_QUARTERMASTERS) {
        return;
    }

    // Without a ruleset there is no skill catalogue and no way to tell a quartermaster order from
    // any other STUDY. Silent, per this module's accept-on-doubt policy.
    let Some(ruleset) = ruleset else { return };

    // The tag is QUAM. It is not QUAR, which is quarrying - resolving by name rather than writing
    // a tag literal is what keeps that mistake out.
    let Some(skill) = ruleset.find_skill(QUARTERMASTER_SKILL) else {
        return;
    };

    let Some(entry) = report
        .header
        .faction_status
        .entries
        .iter()
        .find(|entry| entry.label.eq_ignore_ascii_case(QUARTERMASTERS))
    else {
        return;
    };

    let free_places = (entry.maximum - entry.used).max(0);

    let mut candidates: Vec<(&ReportUnit, &PlacedIntent)> = report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.own)
        .filter(|unit| {
            !unit
                .skills
                .iter()
                .any(|held| held.tag.eq_ignore_ascii_case(&skill.tag))
        })
        .filter_map(|unit| {
            // The first STUDY order wins, the same as `Ordered::studies()` reads it - a unit that
            // writes several is not asking to be counted once per line.
            let placed =
                ordered
                    .intents_of(&unit.unit_id)
                    .iter()
                    .find_map(|placed| match &placed.intent {
                        Intent::Study { skill: studied } => Some((placed, studied)),
                        _ => None,
                    })?;
            Some((unit, placed))
        })
        .filter(|(_, (_, studied))| {
            ruleset
                .find_skill(studied)
                .is_some_and(|found| found.tag.eq_ignore_ascii_case(&skill.tag))
        })
        .map(|(unit, (placed, _))| (unit, placed))
        .collect();

    candidates.sort_by_key(|(_, placed)| placed.line);

    #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
    let free_places = free_places as usize;
    for (unit, placed) in candidates.into_iter().skip(free_places) {
        findings.push(Finding {
            code: codes::TOO_MANY_QUARTERMASTERS,
            message: format!(
                "your faction already has its {} quartermasters",
                entry.maximum
            ),
            region_id: unit.region_id.clone(),
            unit_id: Some(unit.unit_id.clone()),
            line: Some(placed.line),
            column_start: Some(placed.column_start),
            column_end: Some(placed.column_end),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::model::{Coordinate, Skill};

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    fn ruleset() -> Ruleset {
        Ruleset::from_json(RULESET).expect("the committed ruleset should be usable")
    }

    /// `ah-1wcw.1`: the forecast rides out beside the findings, for own units only, and
    /// `check_turn` still answers exactly what it always did.
    #[test]
    fn a_review_forecasts_every_own_unit() {
        let mut mine = unit("1234");
        mine.men = 8;
        let mut theirs = unit("9999");
        theirs.own = false;
        let report = ParsedReport {
            regions: vec![ReportRegion {
                tax_base: Some(100_000),
                ..region(vec![mine, theirs])
            }],
            ..Default::default()
        };
        let source = "unit 1234\n  tax\n";

        let review = review_turn(&report, source, None, CheckOptions::default());

        assert_eq!(review.silver.len(), 1, "{:?}", review.silver);
        let forecast = &review.silver[0];
        assert_eq!(forecast.unit_id, "1234");
        assert_eq!(forecast.income, Some(400));
        assert_eq!(
            review.findings,
            check_turn(&report, source, None, CheckOptions::default()),
            "check_turn is the same answer it always was"
        );
    }

    #[test]
    fn receipts_are_read_from_the_whole_document_not_one_hex() {
        // Two hexes: a giver beside its recipient, and a giver a map away from another. Only the
        // near one is counted, and the far one is silently absent rather than doubted.
        let near_giver = with_silver(unit("2390"), 500);
        let near_recipient = unit("2391");
        let far_giver = with_silver(unit("4000"), 500);
        let far_recipient = unit("4001");

        let report = ParsedReport {
            regions: vec![
                region(vec![near_giver, near_recipient]),
                region_at("1:9,53", 9, 53, vec![far_recipient]),
                region_at("1:11,53", 11, 53, vec![far_giver]),
            ],
            ..Default::default()
        };
        let source = "unit 2390\nGIVE 2391 200 SILV\nunit 4000\nGIVE 4001 200 SILV\n";

        let review = review_turn(&report, source, Some(&ruleset()), CheckOptions::default());
        let forecast = |id: &str| {
            review
                .silver
                .iter()
                .find(|unit| unit.unit_id == id)
                .expect("every own unit is forecast")
        };

        assert_eq!(forecast("2391").income, Some(200));
        assert_eq!(forecast("2391").received, 200);
        assert_eq!(
            forecast("2391").givers,
            vec!["Unit 2390 (2390)".to_string()]
        );
        assert_eq!(forecast("4001").income, Some(0));
        assert_eq!(forecast("4001").received, 0);
        assert_eq!(forecast("4001").doubt, None);
    }

    #[test]
    fn a_gift_of_all_silver_counts_what_the_giver_holds() {
        let report = ParsedReport {
            regions: vec![region(vec![with_silver(unit("2390"), 500), unit("2391")])],
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 2390\nGIVE 2391 ALL SILV\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let recipient = review
            .silver
            .iter()
            .find(|unit| unit.unit_id == "2391")
            .expect("the recipient is forecast");
        assert_eq!(recipient.received, 500);
    }

    #[test]
    fn a_gift_of_all_silver_from_a_giver_we_cannot_price_is_not_counted() {
        // 9999 is not a unit the report shows, so what `ALL` means for it is unknowable.
        let report = ParsedReport {
            regions: vec![region(vec![unit("2391")])],
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 9999\nGIVE 2391 ALL SILV\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let recipient = review
            .silver
            .iter()
            .find(|unit| unit.unit_id == "2391")
            .expect("the recipient is forecast");
        assert_eq!(recipient.received, 0);
        assert_eq!(recipient.doubt, None);
    }

    #[test]
    fn a_gift_to_nobody_credits_nobody() {
        // `GIVE 0 ALL SILV` discards, and it is 130 of the committed turn's 136 GIVE orders.
        let report = ParsedReport {
            regions: vec![region(vec![with_silver(unit("2390"), 500)])],
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 2390\nGIVE 0 ALL SILV\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(review.silver.iter().all(|unit| unit.received == 0));
        assert!(review.silver.iter().all(|unit| unit.givers.is_empty()));
    }

    #[test]
    fn a_gift_of_something_that_is_not_silver_changes_no_silver() {
        let report = ParsedReport {
            regions: vec![region(vec![
                with_item(unit("2390"), 20, "grain", "GRAI"),
                unit("2391"),
            ])],
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 2390\nGIVE 2391 20 GRAI\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(review.silver.iter().all(|unit| unit.received == 0));
    }

    #[test]
    fn several_givers_in_the_hex_are_all_named() {
        let report = ParsedReport {
            regions: vec![region(vec![
                with_silver(unit("2390"), 500),
                with_silver(unit("2392"), 500),
                unit("2391"),
            ])],
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 2390\nGIVE 2391 200 SILV\nunit 2392\nGIVE 2391 100 SILV\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let recipient = review
            .silver
            .iter()
            .find(|unit| unit.unit_id == "2391")
            .expect("the recipient is forecast");
        assert_eq!(recipient.received, 300);
        assert_eq!(
            recipient.givers,
            vec![
                "Unit 2390 (2390)".to_string(),
                "Unit 2392 (2392)".to_string()
            ]
        );
    }

    #[test]
    fn a_sale_the_market_wants_is_income_and_one_it_does_not_is_zero() {
        let region = ReportRegion {
            wanted: vec![MarketItem {
                amount: 40,
                name: "furs".to_string(),
                tag: "FUR".to_string(),
                price: 24,
            }],
            ..region(vec![with_item(unit("2390"), 200, "furs", "FUR")])
        };

        let review = review_turn(
            &report(vec![region]),
            "unit 2390\nSELL ALL FUR\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert_eq!(review.silver[0].income, Some(960));
        assert_eq!(review.silver[0].doubt, None);
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

    /// A region with the given id, so a test can order things in several at once.
    fn region_at(id: &str, x: i32, y: i32, units: Vec<ReportUnit>) -> ReportRegion {
        ReportRegion {
            region_id: id.to_string(),
            coordinate: Coordinate { x, y, z: 1 },
            ..region(units)
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
            // Every unit owes maintenance now (`ah-1wcw.4`), and a fixture that did not pay it
            // would warn `not-enough-silver` in a hundred tests about something else. These
            // fixtures feed themselves: the flag and the grain pay the fee in food, so no
            // fixture's *silver* moves and every existing assertion still means what it did.
            flags: vec!["consuming unit's food".to_string()],
            items: vec![ItemAmount {
                amount: 1,
                name: "grain".to_string(),
                tag: "GRAI".to_string(),
            }],
            ..Default::default()
        }
    }

    /// A fixture unit with its maintenance grain taken away again, for the handful of tests that
    /// weigh or move everything a unit carries and would otherwise weigh the grain too. It pays
    /// its maintenance in silver instead - which weighs nothing, so no fleet's load moves.
    fn unfed(unit: ReportUnit) -> ReportUnit {
        with_silver(starving(unit), 10_000)
    }

    /// A fixture unit with neither its maintenance grain nor any silver to pay the fee with, for
    /// the tests that are *about* a unit that cannot pay its own upkeep.
    fn starving(mut unit: ReportUnit) -> ReportUnit {
        unit.items
            .retain(|item| !item.tag.eq_ignore_ascii_case("GRAI"));
        unit.flags.clear();
        unit
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
        // More men owe more maintenance, so a fixture that feeds itself has to feed all of them -
        // one grain for each 50 silver owed, or the fee spills over into silver and warns.
        for item in &mut unit.items {
            if item.tag.eq_ignore_ascii_case("GRAI") {
                item.amount = (men * 10 + 49) / 50;
            }
        }
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

    /// `report`, with a `Faction Status:` block carrying one `label: used (maximum)` entry - what
    /// the faction-wide checks read instead of anything counted per hex.
    fn report_with_status(
        label: &str,
        used: i64,
        maximum: i64,
        regions: Vec<ReportRegion>,
    ) -> ParsedReport {
        ParsedReport {
            header: crate::report::header::ReportHeader {
                faction_status: crate::report::header::FactionStatus {
                    entries: vec![crate::report::header::FactionStatusEntry {
                        label: label.to_string(),
                        used,
                        maximum,
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            regions,
            ..Default::default()
        }
    }

    /// Runs the checks with the committed ruleset, which is what the shell serves.
    /// The runtime default, with `unit-does-nothing` off.
    ///
    /// Nearly every fixture below stands up a unit to exercise one check and gives it only the
    /// orders that check is about - a GIVE, a BUY, a bare block - so on the real default this check
    /// fires on almost all of them and buries what each test is actually asserting. Exactly the
    /// shape `check_ignoring_transfer_targets` below was written for when `give-target-not-here`
    /// arrived. The check's own fixtures use `check_idle` above, and
    /// `every_advisory_code_can_be_silenced` runs fully enabled.
    fn check(regions: Vec<ReportRegion>, orders: &str) -> Vec<Finding> {
        check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
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
            disabling_all(&[codes::GIVE_TARGET_NOT_HERE, codes::UNIT_DOES_NOTHING]),
        )
    }

    /// `check`, with both of the "this BUILD builds nothing" checks disabled.
    ///
    /// A run of fixtures below order a bare `BUILD` from a unit standing in nothing, or a
    /// `BUILD HELP` naming a unit with no orders, only to have *something* in the block -
    /// `already-built`'s helper cases, a unit that is busy rather than teaching, a BUILD that is
    /// not a PRODUCE. `build-outside-structure` and `build-help-not-building` are real on every
    /// one of them, and are pinned by their own tests; they are turned off here rather than
    /// folded into fixtures that are about something else.
    fn check_ignoring_empty_builds(regions: Vec<ReportRegion>, orders: &str) -> Vec<Finding> {
        check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            disabling_all(&[
                codes::BUILD_OUTSIDE_STRUCTURE,
                codes::BUILD_HELP_NOT_BUILDING,
                codes::UNIT_DOES_NOTHING,
            ]),
        )
    }

    /// `check`, with `build-without-skill` also disabled.
    ///
    /// The fixtures for the other three BUILD checks stand a unit up with no skills at all and put
    /// it to work on a Timber Yard, a Stockade or a Tower - every one of which states a
    /// requirement, so every one of them newly warns, correctly and beside the point. Turned off
    /// here rather than skilling up a dozen fixtures written about something else, and rather than
    /// softening the new check until they go quiet (`docs/retrospectives/ah-vkut.md`, second
    /// section, is about exactly that temptation).
    fn check_ignoring_build_skill(regions: Vec<ReportRegion>, orders: &str) -> Vec<Finding> {
        check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            disabling_all(&[codes::BUILD_WITHOUT_SKILL, codes::UNIT_DOES_NOTHING]),
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

    // --- what spends the month ---------------------------------------------------------------

    #[test]
    fn teaching_spends_the_month() {
        assert!(spends_the_month(&Intent::Teach {
            students: Vec::new()
        }));
    }

    /// The rules: "a CAST order is not a full month order; a mage may still MOVE, STUDY, or use
    /// any other month long order."
    #[test]
    fn casting_does_not_spend_the_month() {
        assert!(!spends_the_month(&Intent::Cast {
            spell: "Fire".to_string(),
            arguments: Vec::new(),
        }));
    }

    /// A bare `CAST` falls back to `MonthLong("CAST")`, which must be caught before the general
    /// `MonthLong` arm or the correction silently does not apply to it.
    #[test]
    fn a_bare_cast_does_not_spend_the_month() {
        assert!(!spends_the_month(&Intent::MonthLong("CAST")));
    }

    #[test]
    fn idling_spends_the_month() {
        assert!(spends_the_month(&Intent::MonthLong("IDLE")));
    }

    #[test]
    fn annihilating_spends_the_month() {
        assert!(spends_the_month(&Intent::MonthLong("ANNIHILATE")));
    }

    #[test]
    fn giving_does_not_spend_the_month() {
        assert!(!spends_the_month(&Intent::Give {
            to: Party::Unit("4022".to_string()),
            what: Selector::Item("SILV".to_string()),
            amount: Amount::Exact(10),
        }));
    }

    /// The `is_busy` rewrite must leave the teaching check exactly as it was. `is_busy` excludes
    /// `Intent::Teach` on purpose, so a unit already teaching is *not* counted as busy and is still
    /// weighed for spare teaching capacity - which is the whole point of that exclusion. If this
    /// stops firing, the rewrite folded teaching into "busy" and broke the teaching check.
    #[test]
    fn a_teaching_unit_is_still_weighed_for_spare_capacity() {
        let findings = check(
            vec![region(vec![
                with_skill(unit("1"), "COMB", 2),
                unit("2"),
                unit("3"),
            ])],
            concat!(
                "unit 1\nTEACH 2\n",
                "unit 2\nSTUDY COMB\n",
                "unit 3\nSTUDY COMB\n",
            ),
        );
        assert!(
            codes(&findings).contains(&codes::TEACHER_HAS_FREE_SLOTS.as_str()),
            "{findings:?}"
        );
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

    /// Maintenance is a real monthly cost, so `not-enough-silver` counts it (`ah-1wcw.4`): a unit
    /// that can pay its orders but not its upkeep is short, and the check says so.
    #[test]
    fn a_unit_that_cannot_pay_its_upkeep_is_warned_about() {
        let regions = vec![region(vec![with_men(
            with_silver(starving(unit("5")), 30),
            10,
        )])];

        let finding = only(check(regions, "unit 5\nWORK\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.message,
            "short $70: this unit can have $30 and its orders and upkeep spend $100"
        );
    }

    /// The display setting is `ah-1wcw.4`'s and lives in the shell; the core has no such switch at
    /// all, which is the guarantee this test pins - upkeep is charged even where the orders
    /// themselves spend nothing.
    #[test]
    fn upkeep_is_charged_whatever_the_display_setting_says() {
        let regions = vec![region(vec![with_men(
            with_silver(starving(unit("5")), 0),
            3,
        )])];

        let finding = only(check(regions, "unit 5\nWORK\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        // The message says upkeep, not orders: WORK spends nothing, and a player told otherwise
        // would go looking for a mistake that is not there.
        assert_eq!(
            finding.message,
            "short $30: this unit can have $0 and its orders and upkeep spend $30"
        );
    }

    /// The shortfall check and the Silver column read one fact, so they must agree about it: a
    /// unit fed by its hex's faction food owes nothing, and warning that it is short of the fee
    /// the pool already paid is two surfaces contradicting each other (`ah-7cdt`, Psylocke).
    #[test]
    fn a_unit_fed_by_faction_food_is_not_warned_about_the_upkeep_the_pool_paid() {
        let quartermaster = with_item(with_silver(starving(unit("5")), 500), 6, "grain", "GRAI");
        let mut eater = with_silver(starving(unit("7")), 0);
        eater.men = 6;
        eater.flags = vec!["consuming faction's food".to_string()];

        assert_eq!(
            codes(&check(vec![region(vec![quartermaster, eater])], "")),
            Vec::<&str>::new(),
            "the pool covers the whole fee, so nobody is short"
        );
    }

    /// A pool too small for two contenders leaves the fee genuinely unknown, and the column shows
    /// `?`. A warning built on a number the column will not state is the same contradiction the
    /// other way round, so no shortfall is claimed for a contending unit.
    #[test]
    fn a_contested_pool_claims_no_shortfall_it_cannot_price() {
        let quartermaster = with_item(with_silver(starving(unit("5")), 500), 3, "grain", "GRAI");
        let mut first = with_silver(starving(unit("7")), 0);
        first.men = 6;
        first.flags = vec!["consuming faction's food".to_string()];
        let mut second = with_silver(starving(unit("9")), 0);
        second.men = 8;
        second.flags = vec!["consuming faction's food".to_string()];

        assert_eq!(
            codes(&check(vec![region(vec![quartermaster, first, second])], "")),
            Vec::<&str>::new()
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
            check(
                regions,
                "unit 5\nSTUDY combat\nunit 7\nWITHDRAW 1 longship\n"
            ),
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

    /// `ah-1wcw.6`: the ruleset prices a withdrawal, so it is charged like any other spending -
    /// `count * withdrawCost`, which is $370 for ten grain at $37.
    #[test]
    fn a_withdrawing_unit_is_charged_the_rulesets_price() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_silver(unit("5"), 370)])],
                "unit 5\nWITHDRAW 10 grain\n"
            )),
            [] as [&str; 0],
            "$370 covers ten grain exactly"
        );
    }

    /// The behaviour change `ah-1wcw.6` carries: `not-enough-silver` declined to judge a withdrawing
    /// unit only because the price was unknown, and now that it is known it speaks.
    #[test]
    fn a_withdrawing_unit_that_cannot_pay_is_warned_about() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_silver(unit("5"), 369)])],
                "unit 5\nWITHDRAW 10 grain\n"
            )),
            ["not-enough-silver"],
            "one silver short of ten grain"
        );
    }

    /// The old path stays, and stays reachable: a ruleset that prices an item nowhere - as one
    /// cached before `ah-1wcw.6` prices everything - still declines to judge the unit.
    #[test]
    fn a_withdrawal_the_ruleset_cannot_price_is_still_doubted() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nWITHDRAW 1 longship\nGIVE 7 100 SILV\n"
            ),
            vec![],
            "the page prices no ship for withdrawal, so there is no sum to check"
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
                disabling_all(&[codes::NOT_TRADED_HERE, codes::UNIT_DOES_NOTHING]),
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

    // --- what a spell costs to cast ---------------------------------------------------------

    /// "Create Ring of Invisibility" is a silver-cost creation: the ruleset carries `$600` as its
    /// cast cost, and the existing not-enough-silver reporting does the rest.
    #[test]
    fn a_mage_that_cannot_pay_for_the_artifact_it_casts_is_warned_about() {
        let regions = vec![region(vec![with_silver(
            with_skill(unit("5"), "CRRI", 3),
            200,
        )])];

        let finding = only(check(regions, "unit 5\nCAST Create_Ring_Of_Invisibility\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(finding.unit_id.as_deref(), Some("5"));
        assert_eq!(finding.line, Some(2));
        assert_eq!(
            finding.message,
            "short $400: this unit can have $200 and its orders spend $600"
        );
    }

    #[test]
    fn a_mage_that_can_pay_is_silent() {
        let regions = vec![region(vec![with_silver(
            with_skill(unit("5"), "CRRI", 3),
            600,
        )])];

        assert_eq!(
            check(regions, "unit 5\nCAST Create_Ring_Of_Invisibility\n"),
            vec![]
        );
    }

    /// The engine charges the stated inputs once per cast, whatever the roll makes - not once per
    /// item created.
    #[test]
    fn the_stated_cost_is_charged_once_however_much_the_spell_makes() {
        let regions = vec![region(vec![with_silver(
            with_skill(unit("5"), "CRRI", 3),
            200,
        )])];

        let finding = only(check(regions, "unit 5\nCAST Create_Ring_Of_Invisibility\n"));
        assert!(
            finding.message.contains("400"),
            "$600 once, not $600 times whatever the roll makes: {}",
            finding.message
        );
    }

    #[test]
    fn an_enchanter_with_nothing_to_enchant_is_warned_about() {
        let regions = vec![region(vec![with_skill(unit("5"), "ESWO", 3)])];

        let finding = only(check(regions, "unit 5\nCAST Enchant_Swords\n"));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert!(finding.message.contains("1 sword"), "{}", finding.message);
    }

    #[test]
    fn an_enchanter_with_one_sword_is_silent() {
        let regions = vec![region(vec![with_item(
            with_skill(unit("5"), "ESWO", 3),
            1,
            "sword",
            "SWOR",
        )])];

        assert_eq!(check(regions, "unit 5\nCAST Enchant_Swords\n"), vec![]);
    }

    /// Transmutation names its *output* - "the resource you wish to create" - and is charged the
    /// source the ruleset says it is made from.
    #[test]
    fn a_transmuter_names_its_output_and_is_charged_the_source() {
        let short = vec![region(vec![with_item(unit("5"), 3, "stone", "STON")])];
        let finding = only(check(short, "unit 5\nCAST Transmutation 4 rootstone\n"));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert!(finding.message.contains("1 stone"), "{}", finding.message);

        let enough = vec![region(vec![with_item(unit("5"), 3, "stone", "STON")])];
        assert_eq!(
            check(enough, "unit 5\nCAST Transmutation rootstone\n"),
            vec![],
            "an unnumbered cast makes what it can, so the least it consumes is one"
        );

        let none = vec![region(vec![unit("5")])];
        let finding = only(check(none, "unit 5\nCAST Transmutation rootstone\n"));
        assert_eq!(finding.code.as_str(), "not-enough-items");
        assert!(finding.message.contains("1 stone"), "{}", finding.message);
    }

    #[test]
    fn constructing_a_gate_costs_a_thousand() {
        let regions = vec![region(vec![with_silver(
            with_skill(unit("5"), "CGAT", 3),
            999,
        )])];

        let finding = only(check(regions, "unit 5\nCAST Construct_Gate\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.message,
            "short $1: this unit can have $999 and its orders spend $1000"
        );
    }

    #[test]
    fn a_spell_with_no_stated_cost_charges_nothing() {
        assert_eq!(
            check(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nCAST Fire\n"
            ),
            vec![]
        );

        // The mage's other sums are still good - a spell that costs nothing does not doubt it.
        let regions = vec![region(vec![with_silver(with_men(unit("5"), 1), 10)])];
        assert_eq!(check(regions, "unit 5\nCAST Fire\nSTUDY combat\n"), vec![]);
    }

    #[test]
    fn an_unknown_spell_charges_nothing() {
        assert_eq!(
            check(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nCAST Super_Magic\n"
            ),
            vec![]
        );
    }

    /// The mage's own case of ah-j2w's rule: a hex's sharing units cover a caster too, since a
    /// mage is usually supplied by its hex rather than carrying its own silver.
    #[test]
    fn a_mage_supplied_by_a_sharing_unit_in_the_hex_is_silent() {
        let regions = vec![region(vec![
            with_skill(unit("5"), "CRRI", 3),
            sharing(with_silver(unit("7"), 600)),
        ])];

        assert_eq!(
            check(regions, "unit 5\nCAST Create_Ring_Of_Invisibility\n"),
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
            finding.message.contains("spend"),
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
             and their orders spend 30"
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
                "unit 5\nGIVE 9 30 swords\nunit 7\nWITHDRAW 1 longship\n"
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
            "this hex does not sell silk - its market has perfume and gems"
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
            "this hex does not want fur - its market wants grain and livestock"
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
            "this hex does not sell silk - its market has perfume"
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
                "this hex does not sell silk - its market has perfume, gems, hill dwarves and \
                 leaders",
                "this hex does not want fur - its market wants grain, livestock, fish, spears, \
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

    /// A unit that actually teaches, with slots left over while somebody else in the hex studies
    /// untaught. Before ah-vw63 this test's teacher had no orders at all - which is exactly the
    /// case the check was warning about wrongly.
    #[test]
    fn a_teacher_with_free_slots_beside_an_untaught_student_is_pointed_out() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        let finding = only(check(
            vec![region(units)],
            "unit 500\nTEACH 700\nunit 700\nSTUDY combat\nunit 900\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "teacher-has-free-slots");
        assert_eq!(finding.unit_id.as_deref(), Some("500"));
        assert_eq!(
            finding.message,
            "has 28 teaching slots still free and could also teach unit 900"
        );
    }

    /// The reported defect: a unit with no orders at all was told it had teaching slots free.
    /// Being idle is `unit-does-nothing`'s observation, on the same unit and in the same list.
    #[test]
    fn a_unit_that_is_not_teaching_is_not_offered_as_a_teacher() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            check(vec![region(units)], "unit 700\nSTUDY combat\n"),
            vec![],
            "unit 500 was never asked to teach, so it has no free teaching slots to report"
        );
    }

    /// Not-teaching is the rule, not idleness: a unit with a month to spare that is doing
    /// something other than teaching is still not a teacher.
    #[test]
    fn a_unit_that_gives_but_does_not_teach_is_not_offered() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            check(
                vec![region(units)],
                "unit 500\nGIVE 700 100 silver\nunit 700\nSTUDY combat\n"
            ),
            vec![],
            "giving leaves the month free, but unit 500 still teaches nobody"
        );
    }

    /// A TEACH naming a unit this hex cannot resolve is already `taught-not-here`, and the free
    /// slots exist only as a consequence of that one mistake. Marked once.
    #[test]
    fn a_teacher_whose_only_student_is_not_here_is_not_told_about_free_slots() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            codes(&check(
                vec![region(units)],
                "unit 500\nTEACH 9999\nunit 700\nSTUDY combat\n"
            )),
            ["taught-not-here"]
        );
    }

    /// A student that leaves the hex takes no slots with it, so it must not be subtracted from
    /// what the teacher has free - `could_take` and `check_one_teacher` both read it that way.
    #[test]
    fn slots_held_by_a_student_that_leaves_the_hex_are_still_free() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 1), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 8),
            with_men(with_silver(unit("800"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        let findings = check(
            vec![region(units)],
            "unit 500\nTEACH 700 800\nunit 700\nSTUDY combat\nunit 800\nSTUDY combat\nMOVE N\nunit 900\nSTUDY combat\n",
        );
        let spare = findings
            .iter()
            .find(|finding| finding.code.as_str() == "teacher-has-free-slots")
            .expect("the teacher still has slots to offer");
        assert_eq!(
            spare.message, "has 2 teaching slots still free and could also teach unit 900",
            "unit 800 marches off, so its two men hold no slots: {findings:?}"
        );
    }

    /// A student that marches out of the hex is `taught-not-here` and nothing else - the same one
    /// mistake, marked once.
    #[test]
    fn a_teacher_whose_only_student_leaves_the_hex_is_not_told_about_free_slots() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        assert_eq!(
            codes(&check(
                vec![region(units)],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\nMOVE N\nunit 900\nSTUDY combat\n"
            )),
            ["taught-not-here"]
        );
    }

    /// One resolvable student means the TEACH order is real, so the slots going spare are a
    /// separate fact and both findings stand.
    #[test]
    fn a_teacher_with_one_absent_student_and_one_real_one_is_still_told_about_free_slots() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        let findings = check(
            vec![region(units)],
            "unit 500\nTEACH 700 9999\nunit 700\nSTUDY combat\nunit 900\nSTUDY combat\n",
        );
        let mut found = codes(&findings);
        found.sort_unstable();
        assert_eq!(found, ["taught-not-here", "teacher-has-free-slots"]);
    }

    /// A unit formed this month has no number yet, so `TEACH NEW 1` never resolves to a student
    /// the hex holds.
    #[test]
    fn a_teacher_naming_only_a_new_unit_is_not_told_about_free_slots() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert!(
            !codes(&check(
                vec![region(units)],
                "unit 500\nFORM 1\nEND\nTEACH NEW 1\nunit 700\nSTUDY combat\n"
            ))
            .contains(&"teacher-has-free-slots"),
            "a NEW unit is doubt, not a student this hex can resolve"
        );
    }

    /// CAST is not a full-month order by the rules, so a mage that casts and teaches genuinely
    /// has teaching slots. Before ah-vw63 `is_busy` counted CAST as busy to keep this check off
    /// every casting mage; requiring a TEACH order does that job instead.
    #[test]
    fn a_mage_that_casts_and_teaches_is_offered_its_free_slots() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        let finding = only(check(
            vec![region(units)],
            "unit 500\nCAST Fire\nTEACH 700\nunit 700\nSTUDY combat\nunit 900\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "teacher-has-free-slots");
        assert_eq!(finding.unit_id.as_deref(), Some("500"));
    }

    /// `free <= 0`: a teacher with every slot taken has nothing spare to offer.
    #[test]
    fn a_teacher_with_every_slot_taken_is_silent() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 1), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 10),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        assert_eq!(
            check(
                vec![region(units)],
                "unit 500\nTEACH 700\nunit 700\nSTUDY combat\nunit 900\nSTUDY combat\n"
            ),
            vec![],
            "one man teaches ten students, and all ten slots are spoken for"
        );
    }

    /// The hex-wide `taught` set: a student somebody else already teaches is not offered again.
    #[test]
    fn a_teacher_whose_students_are_all_taught_by_others_is_silent() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_skill(with_men(with_silver(unit("600"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
            with_men(with_silver(unit("900"), 1000), 2),
        ];

        assert_eq!(
            check(
                vec![region(units)],
                "unit 500\nTEACH 700\nunit 600\nTEACH 900\nunit 700\nSTUDY combat\nunit 900\nSTUDY combat\n"
            ),
            vec![],
            "every student in the hex already has a teacher"
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
                "unit 500\nTEACH 700\nSTUDY combat\nunit 700\nSTUDY combat\n"
            ),
            vec![],
            "unit 500 is studying, so it has no month left to teach in"
        );
    }

    /// A unit ordered to BUILD has its month spoken for too, exactly as MonthLong orders do -
    /// without this, moving BUILD out of `Intent::MonthLong` compiles cleanly and silently turns
    /// every builder into a candidate spare teacher.
    #[test]
    fn a_unit_building_is_not_offered_as_a_spare_teacher() {
        let units = vec![
            with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
            with_men(with_silver(unit("700"), 1000), 2),
        ];

        assert_eq!(
            check_ignoring_empty_builds(
                vec![region(units)],
                "unit 500\nTEACH 700\nBUILD\nunit 700\nSTUDY combat\n"
            ),
            vec![],
            "unit 500 is building, so it has no month left to teach in"
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
            "unit 500\nTEACH 700\nunit 700\nSTUDY combat\nunit 800\nSTUDY combat\nunit 900\nSTUDY combat\n",
        ));
        assert_eq!(finding.code.as_str(), "teacher-has-free-slots");
        assert!(
            finding.message.contains("1 other"),
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

    // --- building on what is already finished -----------------------------------------------

    /// A structure with a name of its own, already finished (`needs: None`).
    fn finished_mill(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Soggy Saw Mill".to_string(),
            kind: "Timber Yard".to_string(),
            description: None,
            needs: None,
        }
    }

    /// A structure the report never gave a name of its own - the engine's own placeholder,
    /// `Building`, with the id following.
    fn finished_unnamed_building(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Building".to_string(),
            kind: "Stockade".to_string(),
            description: None,
            needs: None,
        }
    }

    fn unfinished_building(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Building".to_string(),
            kind: "Stockade".to_string(),
            description: None,
            needs: Some(45),
        }
    }

    /// A Citadel still being built - `BUIL` 3, and the fixture for "has none of the skill".
    fn unfinished_citadel(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Building".to_string(),
            kind: "Citadel".to_string(),
            description: None,
            needs: Some(200),
        }
    }

    /// A Tower still being built - `BUIL` 1, the cheapest requirement there is.
    fn unfinished_tower(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Building".to_string(),
            kind: "Tower".to_string(),
            description: None,
            needs: Some(10),
        }
    }

    /// A Mine still being built - the plan's worked example, needing `MINI` 3.
    fn unfinished_mine(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Building".to_string(),
            kind: "Mine".to_string(),
            description: None,
            needs: Some(20),
        }
    }

    fn in_structure(unit: ReportUnit, structure_id: &str) -> ReportUnit {
        ReportUnit {
            structure_id: Some(structure_id.to_string()),
            ..unit
        }
    }

    #[test]
    fn carrying_on_with_a_finished_structure_warns() {
        let finding = only(check_ignoring_build_skill(
            vec![ReportRegion {
                structures: vec![finished_mill("1")],
                ..region(vec![in_structure(unit("4021"), "1")])
            }],
            "unit 4021\nBUILD\n",
        ));

        assert_eq!(finding.code.as_str(), "already-built");
        assert_eq!(finding.unit_id.as_deref(), Some("4021"));
        assert_eq!(finding.line, Some(2));
        assert_eq!(finding.message, "Soggy Saw Mill is already finished");
    }

    #[test]
    fn a_helper_is_warned_about_the_structure_it_would_work_on() {
        let finding = only(check_ignoring_empty_builds(
            vec![ReportRegion {
                structures: vec![finished_mill("1")],
                ..region(vec![in_structure(unit("4021"), "1"), unit("5")])
            }],
            "unit 5\nBUILD HELP 4021\n",
        ));

        assert_eq!(finding.code.as_str(), "already-built");
        assert_eq!(finding.unit_id.as_deref(), Some("5"));
        assert_eq!(
            finding.message,
            "Soggy Saw Mill, which unit 4021 is in, is already finished"
        );
    }

    /// The same blindness as the magic-study check had: ENTER and LEAVE run before BUILD, so the
    /// structure that matters is the one the unit ends its ENTER/LEAVE orders in.
    #[test]
    fn a_builder_that_leaves_this_month_is_not_told_the_structure_is_finished() {
        assert_eq!(
            check_ignoring_empty_builds(
                vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![in_structure(unit("4021"), "1")])
                }],
                "unit 4021\nLEAVE\nBUILD\n",
            ),
            vec![]
        );
    }

    /// LEAVE runs before ENTER, so a builder that does both ends inside and is told.
    #[test]
    fn a_builder_that_leaves_and_re_enters_is_told_the_structure_is_finished() {
        for orders in [
            "unit 4021\nLEAVE\nENTER 1\nBUILD\n",
            "unit 4021\nENTER 1\nLEAVE\nBUILD\n",
        ] {
            let finding = only(check_ignoring_build_skill(
                vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![in_structure(unit("4021"), "1")])
                }],
                orders,
            ));
            assert_eq!(finding.code, codes::ALREADY_BUILT);
        }
    }

    #[test]
    fn a_builder_that_enters_a_finished_structure_this_month_is_told_so() {
        let finding = only(check_ignoring_build_skill(
            vec![ReportRegion {
                structures: vec![finished_mill("1")],
                ..region(vec![unit("4021")])
            }],
            "unit 4021\nENTER 1\nBUILD\n",
        ));

        assert_eq!(finding.code.as_str(), "already-built");
    }

    /// With HELP the structure belongs to the *helped* unit, and so do the ENTER/LEAVE orders that
    /// move it.
    #[test]
    fn a_helper_is_judged_on_where_the_helped_unit_ends_its_orders() {
        let finding = only(check_ignoring_empty_builds(
            vec![ReportRegion {
                structures: vec![finished_mill("1")],
                ..region(vec![unit("4021"), unit("5")])
            }],
            "unit 4021\nENTER 1\nunit 5\nBUILD HELP 4021\n",
        ));

        assert_eq!(finding.code.as_str(), "already-built");
        assert_eq!(finding.unit_id.as_deref(), Some("5"));
    }

    #[test]
    fn an_unfinished_structure_is_silent() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![ReportRegion {
                    structures: vec![unfinished_building("4")],
                    ..region(vec![in_structure(unit("4021"), "4")])
                }],
                "unit 4021\nBUILD\n",
            ),
            vec![]
        );
    }

    #[test]
    fn founding_a_new_structure_is_silent() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![in_structure(unit("4021"), "1")])
                }],
                "unit 4021\nBUILD Tower\n",
            ),
            vec![]
        );
    }

    #[test]
    fn a_unit_in_no_structure_is_silent() {
        assert_eq!(
            check_ignoring_empty_builds(vec![region(vec![unit("4021")])], "unit 4021\nBUILD\n"),
            vec![]
        );
    }

    #[test]
    fn a_helper_naming_a_unit_not_in_the_hex_is_silent() {
        assert_eq!(
            check(
                vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![unit("5")])
                }],
                "unit 5\nBUILD HELP 4021\n",
            ),
            vec![]
        );
    }

    /// A helper naming a unit that is not a concrete unit of ours in this hex - one formed this
    /// turn and not yet on the report - cannot be resolved to a structure at all. Judging the
    /// builder's own structure instead would be a guess, not what the order says.
    #[test]
    fn a_helper_naming_a_unit_formed_this_turn_is_silent_even_when_the_builder_stands_in_a_finished_structure(
    ) {
        assert_eq!(
            check(
                vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![in_structure(unit("5"), "1")])
                }],
                "unit 5\nBUILD HELP NEW 2\n",
            ),
            vec![]
        );
    }

    #[test]
    fn an_unnamed_structure_is_named_by_its_number() {
        let finding = only(check_ignoring_build_skill(
            vec![ReportRegion {
                structures: vec![finished_unnamed_building("4")],
                ..region(vec![in_structure(unit("4021"), "4")])
            }],
            "unit 4021\nBUILD\n",
        ));

        assert_eq!(finding.message, "Building 4 is already finished");
    }

    #[test]
    fn a_foreign_unit_building_is_not_warned_about() {
        let mut theirs = in_structure(unit("900"), "1");
        theirs.own = false;
        theirs.faction_id = Some("15".to_string());

        assert_eq!(
            check(
                vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![theirs])
                }],
                "unit 900\nBUILD\n",
            ),
            vec![]
        );
    }

    // --- building outside a structure, and helping a unit that is not building ---------------

    #[test]
    fn a_bare_build_outside_any_structure_warns() {
        let finding = only(check(
            vec![region(vec![unit("4021")])],
            "unit 4021\nBUILD\n",
        ));

        assert_eq!(finding.code.as_str(), "build-outside-structure");
        assert_eq!(finding.unit_id.as_deref(), Some("4021"));
        assert_eq!(finding.line, Some(2));
        assert_eq!(finding.message, "is in no structure to build in");
    }

    #[test]
    fn build_complete_outside_any_structure_warns() {
        let finding = only(check(
            vec![region(vec![unit("4021")])],
            "unit 4021\nBUILD COMPLETE\n",
        ));

        assert_eq!(finding.code, codes::BUILD_OUTSIDE_STRUCTURE);
        assert_eq!(finding.message, "is in no structure to build in");
    }

    #[test]
    fn founding_a_structure_from_outside_is_silent() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![region(vec![unit("4021")])],
                "unit 4021\nBUILD Tower\n"
            ),
            vec![]
        );
    }

    #[test]
    fn a_unit_inside_a_structure_is_not_told_it_is_outside() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![ReportRegion {
                    structures: vec![unfinished_building("1")],
                    ..region(vec![in_structure(unit("4021"), "1")])
                }],
                "unit 4021\nBUILD\n",
            ),
            vec![]
        );
    }

    #[test]
    fn a_foreign_unit_building_outside_is_not_warned_about() {
        let mut theirs = unit("900");
        theirs.own = false;
        theirs.faction_id = Some("12".to_string());

        assert_eq!(
            check(vec![region(vec![theirs])], "unit 900\nBUILD\n"),
            vec![]
        );
    }

    /// The HELP forms name whose structure to work on, so they are never this check's business -
    /// whatever `check_build_help` later says about them.
    #[test]
    fn a_build_help_is_not_told_it_is_outside_a_structure() {
        let findings = check(
            vec![ReportRegion {
                structures: vec![unfinished_building("1")],
                ..region(vec![in_structure(unit("4021"), "1"), unit("4117")])
            }],
            "unit 4021\nBUILD\nunit 4117\nBUILD HELP 4021\n",
        );

        assert!(
            !codes(&findings).contains(&"build-outside-structure"),
            "the HELP form is not this check's business: {findings:?}"
        );
    }

    #[test]
    fn only_the_first_build_in_a_block_is_warned_about() {
        let finding = only(check(
            vec![region(vec![unit("4021")])],
            "unit 4021\nBUILD\nBUILD\n",
        ));

        assert_eq!(finding.code, codes::BUILD_OUTSIDE_STRUCTURE);
        assert_eq!(finding.line, Some(2));
    }

    #[test]
    fn a_unit_that_enters_a_structure_this_month_is_not_told_it_is_outside() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![ReportRegion {
                    structures: vec![unfinished_building("1")],
                    ..region(vec![unit("4021")])
                }],
                "unit 4021\nENTER 1\nBUILD\n",
            ),
            vec![]
        );
    }

    /// The navigator's accepted consequence of reading where the unit stands *after* its own
    /// orders: the report shows this unit safely inside a structure, and it is still warned,
    /// because its own LEAVE takes it out before the BUILD runs. Do not soften this.
    #[test]
    fn a_unit_that_leaves_its_structure_this_month_is_told_it_is_outside() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![unfinished_building("1")],
                ..region(vec![in_structure(unit("4021"), "1")])
            }],
            "unit 4021\nLEAVE\nBUILD\n",
        ));

        assert_eq!(finding.code, codes::BUILD_OUTSIDE_STRUCTURE);
        assert_eq!(finding.unit_id.as_deref(), Some("4021"));
        assert_eq!(finding.line, Some(3));
    }

    #[test]
    fn helping_a_unit_that_is_not_building_warns() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![unfinished_building("1")],
                ..region(vec![in_structure(unit("4021"), "1"), unit("4117")])
            }],
            "unit 4021\nWORK\nunit 4117\nBUILD HELP 4021\n",
        ));

        assert_eq!(finding.code.as_str(), "build-help-not-building");
        assert_eq!(finding.unit_id.as_deref(), Some("4117"));
        assert_eq!(finding.line, Some(4));
        assert_eq!(finding.message, "unit 4021 is not building");
    }

    #[test]
    fn helping_a_unit_that_is_building_is_silent() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![ReportRegion {
                    structures: vec![unfinished_building("1")],
                    ..region(vec![
                        in_structure(unit("4021"), "1"),
                        in_structure(unit("4117"), "1"),
                    ])
                }],
                "unit 4021\nBUILD\nunit 4117\nBUILD HELP 4021\n",
            ),
            vec![]
        );
    }

    /// Founding is building, so there is work to help with.
    #[test]
    fn helping_a_unit_that_is_founding_is_silent() {
        assert_eq!(
            check_ignoring_build_skill(
                vec![region(vec![unit("4021"), unit("4117")])],
                "unit 4021\nBUILD Tower\nunit 4117\nBUILD HELP 4021\n",
            ),
            vec![]
        );
    }

    #[test]
    fn helping_a_unit_not_in_this_hex_is_silent() {
        assert_eq!(
            check(
                vec![region(vec![unit("4117")])],
                "unit 4117\nBUILD HELP 9999\n",
            ),
            vec![]
        );
    }

    #[test]
    fn helping_a_new_unit_is_silent() {
        assert_eq!(
            check(
                vec![region(vec![unit("4117")])],
                "unit 4117\nFORM 1\nEND\nBUILD HELP NEW 1\n",
            ),
            vec![]
        );
    }

    /// One mistake, marked once, where it was made: the target is building from outside a
    /// structure and carries that warning on its own line; the helper is not warned as well.
    /// A deliberate divergence from `already-built`'s helper behaviour - do not "fix" it.
    #[test]
    fn a_helper_whose_target_builds_from_outside_is_not_warned_too() {
        let finding = only(check(
            vec![region(vec![unit("4021"), unit("4117")])],
            "unit 4021\nBUILD\nunit 4117\nBUILD HELP 4021\n",
        ));

        assert_eq!(finding.code, codes::BUILD_OUTSIDE_STRUCTURE);
        assert_eq!(finding.unit_id.as_deref(), Some("4021"));
    }

    // --- building without the skill ------------------------------------------------------------

    #[test]
    fn a_unit_told_to_build_a_mine_without_mining_three_is_warned() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![unfinished_mine("1")],
                ..region(vec![in_structure(with_skill(unit("4021"), "MINI", 1), "1")])
            }],
            "unit 4021\nBUILD\n",
        ));

        assert_eq!(finding.code.as_str(), "build-without-skill");
        assert_eq!(finding.unit_id.as_deref(), Some("4021"));
        assert_eq!(
            finding.message,
            "cannot build a Mine: needs mining 3, has mining 1"
        );
    }

    #[test]
    fn a_unit_with_the_skill_at_the_level_is_not_warned() {
        for level in [3, 4] {
            assert_eq!(
                check(
                    vec![ReportRegion {
                        structures: vec![unfinished_mine("1")],
                        ..region(vec![in_structure(
                            with_skill(unit("4021"), "MINI", level),
                            "1"
                        )])
                    }],
                    "unit 4021\nBUILD\n",
                ),
                vec![],
                "mining {level} should be enough for a Mine"
            );
        }
    }

    /// `skill_level` answers 0 for a skill the unit has not got, which is what makes the
    /// comparison uniform - but "has building 0" reads wrong, so the message says it in words.
    #[test]
    fn a_unit_with_none_of_the_skill_is_told_which_it_lacks() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![unfinished_citadel("1")],
                ..region(vec![in_structure(unit("4021"), "1")])
            }],
            "unit 4021\nBUILD\n",
        ));

        assert_eq!(
            finding.message,
            "cannot build a Citadel: needs building 3, has no building"
        );
    }

    #[test]
    fn building_a_named_structure_checks_that_structure_s_requirement() {
        let finding = only(check(
            vec![region(vec![with_skill(unit("4021"), "MINI", 1)])],
            "unit 4021\nBUILD Mine\n",
        ));

        assert_eq!(
            finding.message,
            "cannot build a Mine: needs mining 3, has mining 1"
        );
    }

    /// `an Inn`, not `a Inn`. The sort of thing that reaches a player.
    #[test]
    fn a_kind_beginning_with_a_vowel_takes_an() {
        let finding = only(check(
            vec![region(vec![unit("4021")])],
            "unit 4021\nBUILD Inn\n",
        ));

        assert_eq!(
            finding.message,
            "cannot build an Inn: needs building 3, has no building"
        );
    }

    #[test]
    fn a_helper_without_the_skill_is_warned_for_what_the_target_is_building() {
        let findings = check(
            vec![ReportRegion {
                structures: vec![unfinished_tower("1")],
                ..region(vec![
                    in_structure(with_skill(unit("4021"), "BUIL", 1), "1"),
                    unit("4117"),
                ])
            }],
            "unit 4021\nBUILD\nunit 4117\nBUILD HELP 4021\n",
        );

        // The builder itself has the level; only the helper is short.
        let finding = only(findings);
        assert_eq!(finding.unit_id.as_deref(), Some("4117"));
        assert_eq!(
            finding.message,
            "cannot help build a Tower: needs building 1, has no building"
        );
    }

    /// One level of indirection only: nothing in a chain of helpers says which structure it really
    /// lands on, so the second helper is not judged.
    #[test]
    fn a_helper_of_a_helper_is_not_judged() {
        let findings = check(
            vec![ReportRegion {
                structures: vec![unfinished_tower("1")],
                ..region(vec![
                    in_structure(with_skill(unit("4021"), "BUIL", 1), "1"),
                    with_skill(unit("4117"), "BUIL", 1),
                    unit("4200"),
                ])
            }],
            "unit 4021\nBUILD\nunit 4117\nBUILD HELP 4021\nunit 4200\nBUILD HELP 4117\n",
        );

        assert_eq!(codes(&findings), Vec::<&str>::new());
    }

    /// 22 of the page's 58 buildings state no requirement, and that is the catalogue declining to
    /// say - never a claim that anybody may build one.
    #[test]
    fn a_structure_the_catalogue_gives_no_requirement_is_not_judged() {
        assert_eq!(
            check(vec![region(vec![unit("4021")])], "unit 4021\nBUILD Lair\n",),
            vec![]
        );
    }

    /// A ruleset cached before build requirements were scraped would make every structure look as
    /// though it needs nothing, so the check says nothing at all rather than clearing every unit.
    #[test]
    fn a_ruleset_without_build_requirements_says_nothing() {
        let mut json: serde_json::Value =
            serde_json::from_str(RULESET).expect("the committed ruleset should parse");
        json["buildings"] = serde_json::json!({});
        let stripped = Ruleset::from_json(&json.to_string()).expect("still a usable ruleset");

        assert_eq!(
            check_turn(
                &report(vec![region(vec![unit("4021")])]),
                "unit 4021\nBUILD Mine\n",
                Some(&stripped),
                disabling(codes::UNIT_DOES_NOTHING),
            ),
            vec![]
        );
    }

    /// Its own gate, not the other BUILD checks': switching one of those off leaves this running.
    #[test]
    fn the_build_skill_check_can_be_turned_off() {
        assert_eq!(
            check_turn(
                &report(vec![region(vec![unit("4021")])]),
                "unit 4021\nBUILD Mine\n",
                Some(&ruleset()),
                disabling_all(&[codes::BUILD_WITHOUT_SKILL, codes::UNIT_DOES_NOTHING]),
            ),
            vec![]
        );
    }

    #[test]
    fn the_build_outside_check_can_be_turned_off() {
        assert_eq!(
            check_turn(
                &report(vec![region(vec![unit("4021")])]),
                "unit 4021\nBUILD\n",
                Some(&ruleset()),
                disabling(codes::BUILD_OUTSIDE_STRUCTURE),
            ),
            vec![]
        );
    }

    /// Its own gate, not `already-built`'s: switching off "Building what is built" leaves this
    /// one running.
    #[test]
    fn the_build_help_check_can_be_turned_off() {
        let regions = || {
            vec![ReportRegion {
                structures: vec![unfinished_building("1")],
                ..region(vec![in_structure(unit("4021"), "1"), unit("4117")])
            }]
        };
        let orders = "unit 4021\nWORK\nunit 4117\nBUILD HELP 4021\n";

        assert_eq!(
            check_turn(
                &report(regions()),
                orders,
                Some(&ruleset()),
                disabling(codes::BUILD_HELP_NOT_BUILDING),
            ),
            vec![]
        );
        assert_eq!(
            codes(&check_turn(
                &report(regions()),
                orders,
                Some(&ruleset()),
                disabling(codes::ALREADY_BUILT),
            )),
            vec!["build-help-not-building"]
        );
    }

    // --- studying -------------------------------------------------------------------------

    /// A unit fully funded for a month of study, so the silver check stays out of these tests.
    fn studying_unit(id: &str, tag: &str, level: u32) -> ReportUnit {
        with_skill(with_silver(unit(id), 1000), tag, level)
    }

    #[test]
    fn a_unit_at_the_ruleset_maximum_is_warned() {
        let units = vec![studying_unit("5", "OBSE", 5)];
        let finding = only(check(vec![region(units)], "unit 5\nSTUDY OBSE\n"));

        assert_eq!(finding.code.as_str(), "study-at-maximum");
        assert_eq!(
            finding.message,
            "this unit is already at observation 5, the highest the ruleset has"
        );
    }

    #[test]
    fn the_skill_may_be_named_or_tagged_for_study_at_maximum() {
        for order in ["STUDY observation", "STUDY obse"] {
            let units = vec![studying_unit("5", "OBSE", 5)];
            assert_eq!(
                codes(&check(vec![region(units)], &format!("unit 5\n{order}\n"))),
                ["study-at-maximum"],
                "{order} should resolve to observation"
            );
        }
    }

    #[test]
    fn a_skill_below_its_maximum_is_silent() {
        let units = vec![studying_unit("5", "OBSE", 3)];
        assert_eq!(check(vec![region(units)], "unit 5\nSTUDY OBSE\n"), vec![]);
    }

    #[test]
    fn a_skill_the_unit_has_never_studied_is_silent() {
        let units = vec![with_silver(unit("5"), 1000)];
        assert_eq!(check(vec![region(units)], "unit 5\nSTUDY OBSE\n"), vec![]);
    }

    #[test]
    fn a_skill_the_ruleset_does_not_know_is_silent() {
        let units = vec![with_silver(unit("5"), 1000)];
        assert_eq!(check(vec![region(units)], "unit 5\nSTUDY xyzzy\n"), vec![]);
    }

    #[test]
    fn without_a_ruleset_nothing_is_said_for_study_at_maximum() {
        let units = vec![studying_unit("5", "OBSE", 5)];
        let regions = vec![region(units)];

        assert_eq!(
            check_turn(
                &report(regions),
                "unit 5\nSTUDY OBSE\n",
                None,
                CheckOptions::default(),
            ),
            vec![]
        );
    }

    #[test]
    fn a_level_above_the_maximum_still_warns() {
        let units = vec![studying_unit("5", "OBSE", 6)];
        assert_eq!(
            codes(&check(vec![region(units)], "unit 5\nSTUDY OBSE\n")),
            ["study-at-maximum"]
        );
    }

    #[test]
    fn the_finding_sits_on_the_study_line_for_study_at_maximum() {
        let units = vec![studying_unit("5", "OBSE", 5)];
        let finding = only(check(vec![region(units)], "unit 5\nWORK\n\nSTUDY OBSE\n"));

        assert_eq!(finding.line, Some(4), "the STUDY line, not the block's");
    }

    // --- magic studied outside a building that houses mages ---------------------------------

    /// A finished structure of the given kind, so a test can put a mage in a Castle, a Tower or a
    /// ship without three near-identical fixtures.
    fn finished_of_kind(structure_id: &str, kind: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Building".to_string(),
            kind: kind.to_string(),
            description: None,
            needs: None,
        }
    }

    fn unfinished_of_kind(structure_id: &str, kind: &str) -> Structure {
        Structure {
            needs: Some(20),
            ..finished_of_kind(structure_id, kind)
        }
    }

    /// A funded mage holding `level` in force, ordered to study it.
    fn mage(level: u32) -> ReportUnit {
        studying_unit("5", "FORC", level)
    }

    #[test]
    fn magic_studied_above_level_two_outside_a_building_is_a_warning() {
        let finding = only(check(vec![region(vec![mage(2)])], "unit 5\nSTUDY FORC\n"));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
        assert_eq!(finding.unit_id.as_deref(), Some("5"));
        assert_eq!(finding.line, Some(2));
        assert_eq!(
            finding.message,
            "half of this month's study of force is wasted outside a building that houses mages"
        );
    }

    #[test]
    fn magic_studied_inside_a_castle_is_silent() {
        assert_eq!(
            check(
                vec![ReportRegion {
                    structures: vec![finished_of_kind("1", "Castle")],
                    ..region(vec![in_structure(mage(2), "1")])
                }],
                "unit 5\nSTUDY FORC\n",
            ),
            vec![]
        );
    }

    /// The bug this bead was filed for: the mage steps out before the month's study happens, so
    /// half of it is wasted and the player wrote the LEAVE deliberately.
    #[test]
    fn a_mage_that_leaves_the_building_this_month_is_warned() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![finished_of_kind("1", "Castle")],
                ..region(vec![in_structure(mage(2), "1")])
            }],
            "unit 5\nLEAVE\nSTUDY FORC\n",
        ));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
    }

    /// The mirror case, and the worse of the two: a warning about a mage that will be sheltered by
    /// the time it studies teaches the player to distrust the check.
    #[test]
    fn a_mage_that_enters_a_building_this_month_is_silent() {
        assert_eq!(
            check(
                vec![ReportRegion {
                    structures: vec![finished_of_kind("1", "Castle")],
                    ..region(vec![mage(2)])
                }],
                "unit 5\nENTER 1\nSTUDY FORC\n",
            ),
            vec![]
        );
    }

    /// Every LEAVE is processed before any ENTER, so a block holding both ends inside the
    /// structure entered - whichever order the lines were typed in.
    #[test]
    fn a_mage_that_leaves_and_re_enters_is_sheltered() {
        let region_with_castle = || ReportRegion {
            structures: vec![finished_of_kind("1", "Castle")],
            ..region(vec![in_structure(mage(2), "1")])
        };

        assert_eq!(
            check(
                vec![region_with_castle()],
                "unit 5\nLEAVE\nENTER 1\nSTUDY FORC\n"
            ),
            vec![]
        );
        assert_eq!(
            check(
                vec![region_with_castle()],
                "unit 5\nENTER 1\nLEAVE\nSTUDY FORC\n"
            ),
            vec![]
        );
    }

    /// With no ENTER at all, the LEAVEs stand: the mage ends the month outside.
    #[test]
    fn a_mage_that_leaves_twice_is_outside() {
        assert_eq!(
            only(check(
                vec![ReportRegion {
                    structures: vec![finished_of_kind("1", "Castle")],
                    ..region(vec![in_structure(mage(2), "1")])
                }],
                "unit 5\nLEAVE\nLEAVE\nSTUDY FORC\n"
            ))
            .code,
            codes::MAGIC_STUDY_OUTSIDE_BUILDING
        );
    }

    /// Accept-on-doubt reaches the new input too: a structure entered but not listed is the same
    /// doubt as one stood in but not listed.
    #[test]
    fn a_mage_entering_a_structure_the_report_does_not_list_is_not_judged() {
        assert_eq!(
            check(
                vec![region(vec![mage(2)])],
                "unit 5\nENTER 999\nSTUDY FORC\n"
            ),
            vec![]
        );
    }

    /// Entering shelters the mage, but a Tower seats none, so the study is halved regardless.
    #[test]
    fn a_mage_entering_a_tower_is_still_halved() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![finished_of_kind("1", "Tower")],
                ..region(vec![mage(2)])
            }],
            "unit 5\nENTER 1\nSTUDY FORC\n",
        ));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
    }

    /// The case that made the buildings table worth scraping: a Tower is in the rules' table and
    /// seats no mages at all, so studying in one is no better than studying in the open.
    #[test]
    fn a_tower_seats_no_mages_so_the_study_is_still_halved() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![finished_of_kind("1", "Tower")],
                ..region(vec![in_structure(mage(3), "1")])
            }],
            "unit 5\nSTUDY FORC\n",
        ));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
    }

    /// ah-3cj4.1 put every building the data page describes into the catalogue, so a Mine now
    /// answers `Some(0)` where it once answered `None`. The warning must not move: the one caller
    /// reads `is_some_and(|seats| seats >= 1)`, false either way.
    #[test]
    fn a_mage_studying_in_a_mine_is_still_warned() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![finished_of_kind("1", "Mine")],
                ..region(vec![in_structure(mage(3), "1")])
            }],
            "unit 5\nSTUDY FORC\n",
        ));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
    }

    /// The navigator's decision (2026-08-17), and a deliberate exception to accept-on-doubt: an
    /// unfinished building shelters nobody, so the study really is halved.
    #[test]
    fn an_unfinished_building_shelters_nobody() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![unfinished_of_kind("1", "Fort")],
                ..region(vec![in_structure(mage(2), "1")])
            }],
            "unit 5\nSTUDY FORC\n",
        ));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
    }

    #[test]
    fn a_mage_at_level_one_is_below_the_threshold() {
        assert_eq!(
            check(vec![region(vec![mage(1)])], "unit 5\nSTUDY FORC\n"),
            vec![]
        );
    }

    #[test]
    fn a_ship_is_not_a_building_that_houses_mages() {
        let finding = only(check(
            vec![ReportRegion {
                structures: vec![longship("1")],
                ..region(vec![in_structure(mage(2), "1")])
            }],
            "unit 5\nSTUDY FORC\n",
        ));

        assert_eq!(finding.code, codes::MAGIC_STUDY_OUTSIDE_BUILDING);
    }

    #[test]
    fn a_skill_the_unit_has_never_studied_is_below_the_threshold() {
        let units = vec![with_silver(unit("5"), 1000)];
        assert_eq!(check(vec![region(units)], "unit 5\nSTUDY FORC\n"), vec![]);
    }

    #[test]
    fn a_mundane_skill_is_not_this_checks_business() {
        let units = vec![studying_unit("5", "COMB", 4)];
        assert_eq!(check(vec![region(units)], "unit 5\nSTUDY COMB\n"), vec![]);
    }

    /// Accept-on-doubt: nothing can be said about a structure the region's report does not list.
    #[test]
    fn a_structure_the_report_does_not_list_is_not_judged() {
        assert_eq!(
            check(
                vec![region(vec![in_structure(mage(2), "999")])],
                "unit 5\nSTUDY FORC\n",
            ),
            vec![]
        );
    }

    /// A ruleset cached before the buildings table was scraped knows nothing about any building,
    /// so warning off it would fire on every mage in the game.
    #[test]
    fn a_ruleset_without_a_buildings_table_says_nothing() {
        let mut json: serde_json::Value = serde_json::from_str(RULESET).unwrap();
        json.as_object_mut()
            .expect("ruleset is a JSON object")
            .remove("buildings");
        let text = serde_json::to_string(&json).unwrap();
        let bare = Ruleset::from_json(&text).expect("a ruleset without buildings still parses");

        assert_eq!(
            check_turn(
                &report(vec![region(vec![mage(2)])]),
                "unit 5\nSTUDY FORC\n",
                Some(&bare),
                CheckOptions::default(),
            ),
            vec![]
        );
    }

    #[test]
    fn a_skill_the_catalogue_does_not_know_says_nothing() {
        let units = vec![with_silver(unit("5"), 1000)];
        assert_eq!(check(vec![region(units)], "unit 5\nSTUDY xyzzy\n"), vec![]);
    }

    #[test]
    fn the_magic_study_check_can_be_turned_off() {
        assert_eq!(
            check_turn(
                &report(vec![region(vec![mage(2)])]),
                "unit 5\nSTUDY FORC\n",
                Some(&ruleset()),
                disabling(codes::MAGIC_STUDY_OUTSIDE_BUILDING),
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

    // --- units with nothing to do --------------------------------------------------------------

    /// `check`, with the checks that fire on a bare hex out of the way. A unit doing nothing also
    /// leaves the hex unguarded, and these fixtures are not about that.
    fn check_idle(regions: Vec<ReportRegion>, orders: &str) -> Vec<Finding> {
        check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            disabling_all(&[codes::TEACHER_HAS_FREE_SLOTS]),
        )
    }

    #[test]
    fn a_unit_with_no_orders_at_all_is_warned() {
        let finding = only(check_idle(vec![region(vec![unit("4021")])], "unit 4021\n"));
        assert_eq!(finding.code, codes::UNIT_DOES_NOTHING);
        assert_eq!(finding.unit_id.as_deref(), Some("4021"));
        assert_eq!(finding.line, Some(1));
        assert_eq!(finding.column_start, None);
        assert_eq!(finding.message, "has no order that spends the month");
    }

    #[test]
    fn a_unit_that_only_gives_is_warned() {
        let findings = check_idle(
            vec![region(vec![with_silver(unit("4021"), 100), unit("4022")])],
            "unit 4021\nGIVE 4022 10 SILV\nunit 4022\nWORK\n",
        );
        let idle: Vec<&Finding> = findings
            .iter()
            .filter(|f| f.code == codes::UNIT_DOES_NOTHING)
            .collect();
        assert_eq!(idle.len(), 1, "{findings:?}");
        assert_eq!(idle[0].unit_id.as_deref(), Some("4021"));
        // The block line, not the GIVE line.
        assert_eq!(idle[0].line, Some(1));
    }

    #[test]
    fn a_unit_that_works_is_silent() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![unit("4021")])],
                "unit 4021\nWORK\n"
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_that_teaches_is_silent() {
        let findings = check_idle(
            vec![region(vec![
                with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 2),
                with_skill(with_silver(unit("700"), 1000), "COMB", 1),
            ])],
            "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
        );
        assert!(
            !codes(&findings).contains(&codes::UNIT_DOES_NOTHING.as_str()),
            "{findings:?}"
        );
    }

    /// GUARD is a flag rather than a month's work - a guard can tax as well - so a garrison that
    /// could be earning is worth being told about. The navigator chose this; do not "fix" it.
    #[test]
    fn a_unit_that_guards_is_warned() {
        let findings = check_idle(vec![region(vec![unit("4021")])], "unit 4021\nGUARD 1\n");
        assert_eq!(codes(&findings), vec![codes::UNIT_DOES_NOTHING.as_str()]);
    }

    /// ah-dwk6's verification failure, at the check's own level: a free order is not a month's
    /// work, and a unit holding only one is still a unit with nothing to do.
    #[test]
    fn a_unit_whose_only_order_is_free_is_warned() {
        let findings = check_idle(
            vec![region(vec![unit("4021")])],
            "unit 4021\nNAME \"Scouts\"\n",
        );
        assert_eq!(codes(&findings), vec![codes::UNIT_DOES_NOTHING.as_str()]);
    }

    /// The rules: "STEAL and ASSASSINATE are not full month orders, and do not interfere with
    /// other activities."
    #[test]
    fn a_unit_that_only_assassinates_is_warned() {
        let findings = check_idle(
            vec![region(vec![unit("4021")])],
            "unit 4021\nASSASSINATE 13432\n",
        );
        assert_eq!(codes(&findings), vec![codes::UNIT_DOES_NOTHING.as_str()]);
    }

    /// The rules: "a CAST order is not a full month order."
    #[test]
    fn a_unit_that_only_casts_is_warned() {
        let findings = check_idle(vec![region(vec![unit("4021")])], "unit 4021\nCAST Fire\n");
        assert!(
            codes(&findings).contains(&codes::UNIT_DOES_NOTHING.as_str()),
            "{findings:?}"
        );
    }

    /// IDLE spends the month by the rules - the player said so.
    #[test]
    fn a_unit_that_is_idle_is_silent() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![unit("4021")])],
                "unit 4021\nIDLE\n",
            )),
            Vec::<&str>::new()
        );
    }

    /// The false-positive guard, now narrow: only a keyword in neither list silences the check.
    #[test]
    fn a_unit_with_an_unknown_keyword_is_silent() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![unit("4021")])],
                "unit 4021\nFLIBBERTIGIBBET\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_with_a_turn_block_is_silent() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![unit("4021")])],
                "unit 4021\nTURN\nWORK\nENDTURN\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_with_no_block_in_the_document_is_warned_with_no_line() {
        let finding = only(check_idle(vec![region(vec![unit("4021")])], ""));
        assert_eq!(finding.code, codes::UNIT_DOES_NOTHING);
        assert_eq!(finding.line, None);
    }

    #[test]
    fn a_foreign_unit_doing_nothing_is_not_warned_about() {
        let mut theirs = unit("9999");
        theirs.own = false;
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![theirs, unit("4021")])],
                "unit 4021\nWORK\n",
            )),
            Vec::<&str>::new()
        );
    }

    /// ah-udff. A count that is a guess is `men: 0` on a unit whose items the ruleset could not
    /// read, so exempting it would hide a real unit instead of a husk. Written first, because
    /// every other case here passes a naive `men == 0`.
    #[test]
    fn a_unit_with_an_estimated_headcount_of_zero_is_still_warned() {
        let mut husk = with_men(unit("4021"), 0);
        husk.men_estimated = true;
        assert_eq!(
            codes(&check_idle(vec![region(vec![husk])], "unit 4021\n")),
            vec![codes::UNIT_DOES_NOTHING.as_str()]
        );
    }

    /// ah-udff, revising ah-dwk6's "no exemptions": a unit with no men cannot spend a month on
    /// anything, so there is no order the player could add that would satisfy the warning.
    #[test]
    fn a_unit_with_no_men_is_not_warned() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![with_men(unit("4021"), 0)])],
                "unit 4021\n"
            )),
            Vec::<&str>::new()
        );
    }

    /// Decision A: the exemption keys on the men count alone. A unit with silver and a horse and
    /// no men still cannot spend a month, so it still says nothing.
    #[test]
    fn a_unit_with_no_men_but_goods_is_not_warned() {
        let laden = with_item(
            with_silver(with_men(unit("4021"), 0), 7500),
            1,
            "horse",
            "HORS",
        );
        assert_eq!(
            codes(&check_idle(vec![region(vec![laden])], "unit 4021\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_with_one_man_and_nothing_to_do_is_still_warned() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![with_men(unit("4021"), 1)])],
                "unit 4021\n"
            )),
            vec![codes::UNIT_DOES_NOTHING.as_str()]
        );
    }

    /// The `unread` guard already covered this and still does - the exemption changes nothing
    /// about a unit whose orders could not be read.
    #[test]
    fn a_men_less_unit_with_an_unreadable_line_is_silent() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![with_men(unit("4021"), 0)])],
                "unit 4021\nFLIBBERTIGIBBET\n"
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_men_less_unit_that_works_is_silent() {
        assert_eq!(
            codes(&check_idle(
                vec![region(vec![with_men(unit("4021"), 0)])],
                "unit 4021\nWORK\n"
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn the_idle_check_can_be_turned_off() {
        assert_eq!(
            codes(&check_turn(
                &report(vec![region(vec![unit("4021")])]),
                "unit 4021\n",
                Some(&ruleset()),
                disabling_all(&[codes::UNIT_DOES_NOTHING, codes::TEACHER_HAS_FREE_SLOTS]),
            )),
            Vec::<&str>::new()
        );
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

        /// One code, and the smallest fixture that makes it fire.
        ///
        /// Named fields rather than a tuple (ah-11lh): two beads adding a case each used to
        /// auto-merge into a case that still compiled and asserted the wrong thing (ah-oq3).
        /// Interleaved named fields do not compile, so a bad merge is a build error instead of a
        /// silent one.
        struct Case {
            code: Code,
            regions: Vec<ReportRegion>,
            orders: &'static str,
            /// A `Faction Status:` allowance the case's report should carry - `None` for every
            /// per-hex check, and what `too-many-quartermasters` and `too-many-trade-regions`
            /// need instead of a hex.
            allowance: Option<(&'static str, i64, i64)>,
        }
        let cases: Vec<Case> = vec![
            Case {
                code: codes::NOT_ENOUGH_SILVER,
                regions: vec![region(vec![with_silver(unit("5"), 40)])],
                orders: "unit 5\nGIVE 7 100 SILV\n",
                allowance: None,
            },
            Case {
                code: codes::NOT_ENOUGH_ITEMS,
                regions: vec![region(vec![with_item(unit("5"), 3, "sword", "SWOR")])],
                orders: "unit 5\nGIVE 7 10 swords\n",
                allowance: None,
            },
            Case {
                code: codes::GUARD_DROPPED,
                regions: vec![region(vec![guard_dropping])],
                orders: "unit 5\nMOVE N\n",
                allowance: None,
            },
            Case {
                code: codes::HEX_UNGUARDED,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nWORK\n",
                allowance: None,
            },
            Case {
                code: codes::TAUGHT_NOT_HERE,
                regions: vec![region(teaching_hex())],
                orders: "unit 500\nTEACH 999\n",
                allowance: None,
            },
            Case {
                code: codes::TAUGHT_NOT_STUDYING,
                regions: vec![region(teaching_hex())],
                orders: "unit 500\nTEACH 700\nunit 700\nWORK\n",
                allowance: None,
            },
            Case {
                code: codes::TEACHER_CANNOT_TEACH,
                regions: vec![region(teacher_below_student)],
                orders: "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
                allowance: None,
            },
            Case {
                code: codes::TEACHING_OVERSUBSCRIBED,
                regions: vec![region(oversubscribed)],
                orders: "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
                allowance: None,
            },
            Case {
                code: codes::TEACHER_HAS_FREE_SLOTS,
                regions: vec![region(vec![
                    with_skill(with_men(with_silver(unit("500"), 1000), 3), "COMB", 3),
                    with_men(with_silver(unit("700"), 1000), 2),
                    with_men(with_silver(unit("900"), 1000), 2),
                ])],
                orders: "unit 500\nTEACH 700\nunit 700\nSTUDY combat\nunit 900\nSTUDY combat\n",
                allowance: None,
            },
            Case {
                code: codes::FORM_ALIAS_REUSED,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nFORM 1\nEND\nFORM 1\nEND\n",
                allowance: None,
            },
            Case {
                code: codes::FLEET_OVERLOADED,
                regions: vec![ReportRegion {
                    structures: vec![longship("329")],
                    ..region(vec![ReportUnit {
                        structure_id: Some("329".to_string()),
                        weight: Some(200),
                        skills: vec![sail(4)],
                        ..unit("11125")
                    }])
                }],
                orders: "unit 11125\nSAIL N\n",
                allowance: None,
            },
            Case {
                code: codes::FLEET_UNDERCREWED,
                regions: vec![ReportRegion {
                    structures: vec![longship("329")],
                    ..region(vec![ReportUnit {
                        structure_id: Some("329".to_string()),
                        weight: Some(10),
                        ..unit("11125")
                    }])
                }],
                orders: "unit 11125\nSAIL N\n",
                allowance: None,
            },
            Case {
                code: codes::GIVE_TARGET_NOT_HERE,
                regions: vec![region(vec![with_silver(unit("5"), 1000)])],
                orders: "unit 5\nGIVE 16585 500 SILV\n",
                allowance: None,
            },
            Case {
                code: codes::NOT_TRADED_HERE,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nBUY 5 silk\n",
                allowance: None,
            },
            Case {
                code: codes::TOO_MANY_QUARTERMASTERS,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nSTUDY QUAM\n",
                allowance: Some(("Quartermasters", 2, 2)),
            },
            Case {
                code: codes::UNIT_OVERLOADED,
                regions: vec![region(vec![carrying("5", 1800, 150)])],
                orders: "unit 5\nMOVE S\n",
                allowance: None,
            },
            Case {
                code: codes::STUDY_AT_MAXIMUM,
                regions: vec![region(vec![with_skill(
                    with_silver(unit("5"), 1000),
                    "OBSE",
                    5,
                )])],
                orders: "unit 5\nSTUDY OBSE\n",
                allowance: None,
            },
            Case {
                code: codes::ALREADY_BUILT,
                regions: vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![in_structure(unit("4021"), "1")])
                }],
                orders: "unit 4021\nBUILD\n",
                allowance: None,
            },
            Case {
                code: codes::TOO_MANY_TRADE_REGIONS,
                regions: vec![
                    region_at("1:7,53", 7, 53, vec![unit("5")]),
                    region_at("1:8,53", 8, 53, vec![unit("6")]),
                    region_at("1:9,53", 9, 53, vec![unit("7")]),
                ],
                orders: "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nPRODUCE grain\n",
                allowance: Some(("Trade Regions", 2, 2)),
            },
            Case {
                code: codes::MAGIC_STUDY_OUTSIDE_BUILDING,
                regions: vec![region(vec![mage(2)])],
                orders: "unit 5\nSTUDY FORC\n",
                allowance: None,
            },
            Case {
                code: codes::BUILD_OUTSIDE_STRUCTURE,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\nBUILD\n",
                allowance: None,
            },
            Case {
                code: codes::BUILD_HELP_NOT_BUILDING,
                regions: vec![ReportRegion {
                    structures: vec![unfinished_building("1")],
                    ..region(vec![in_structure(unit("4021"), "1"), unit("4117")])
                }],
                orders: "unit 4021\nWORK\nunit 4117\nBUILD HELP 4021\n",
                allowance: None,
            },
            Case {
                code: codes::UNIT_DOES_NOTHING,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\n",
                allowance: None,
            },
            Case {
                code: codes::BUILD_WITHOUT_SKILL,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\nBUILD Mine\n",
                allowance: None,
            },
        ];

        assert_eq!(
            cases.len(),
            codes::ALL.len(),
            "every code in codes::ALL needs a fixture here, or a silenced one would go unnoticed"
        );
        // Length alone would accept a case duplicated and another dropped, which is the same hole
        // by a different route.
        let distinct: BTreeSet<&str> = cases.iter().map(|case| case.code.as_str()).collect();
        assert_eq!(
            distinct.len(),
            cases.len(),
            "two cases share a code, so some other code has no fixture"
        );

        for Case {
            code,
            regions,
            orders,
            allowance,
        } in &cases
        {
            let built = match allowance {
                Some((label, used, maximum)) => {
                    report_with_status(label, *used, *maximum, regions.clone())
                }
                None => report(regions.clone()),
            };

            // Fully enabled (rather than the runtime default) so `hex-unguarded`'s own case, which
            // the default itself disables, still gets to prove its fixture fires at all.
            let enabled = check_turn(
                &built,
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

            let silenced = check_turn(&built, orders, Some(&ruleset()), disabling(*code));
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
            disabling_all(&[codes::GIVE_TARGET_NOT_HERE, codes::UNIT_DOES_NOTHING]),
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
                disabling_all(&[
                    codes::NOT_ENOUGH_SILVER,
                    codes::GIVE_TARGET_NOT_HERE,
                    codes::UNIT_DOES_NOTHING,
                ]),
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
                disabling_all(&[
                    codes::NOT_ENOUGH_SILVER,
                    codes::GIVE_TARGET_NOT_HERE,
                    codes::UNIT_DOES_NOTHING,
                ]),
            )),
            ["guard-dropped"]
        );
    }

    // --- quartermasters -------------------------------------------------------------------------

    fn quartermaster(mut unit: ReportUnit) -> ReportUnit {
        unit.skills.push(Skill {
            name: "quartermaster".to_string(),
            tag: "QUAM".to_string(),
            level: 1,
            points: 0,
        });
        unit
    }

    /// Runs only the quartermaster check, with `not-enough-silver` disabled: the fixtures below
    /// are about the allowance, not about whether the unit can afford the study, and `unit()`
    /// starts with no silver of its own.
    fn quartermasters(
        regions: Vec<ReportRegion>,
        orders: &str,
        used: i64,
        maximum: i64,
    ) -> Vec<Finding> {
        check_turn(
            &report_with_status("Quartermasters", used, maximum, regions),
            orders,
            Some(&ruleset()),
            disabling(codes::NOT_ENOUGH_SILVER),
        )
    }

    #[test]
    fn a_study_beyond_the_quartermaster_allowance_is_warned() {
        let findings = quartermasters(vec![region(vec![unit("5")])], "unit 5\nSTUDY QUAM\n", 2, 2);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].code, codes::TOO_MANY_QUARTERMASTERS);
        assert_eq!(
            findings[0].message,
            "your faction already has its 2 quartermasters"
        );
        assert_eq!(findings[0].region_id, "1:7,53".to_string());
        assert_eq!(findings[0].unit_id, Some("5".to_string()));
        assert_eq!(findings[0].line, Some(2));
    }

    #[test]
    fn the_skill_may_be_named_or_tagged() {
        assert_eq!(
            codes(&quartermasters(
                vec![region(vec![unit("5")])],
                "unit 5\nSTUDY quartermaster\n",
                2,
                2
            )),
            ["too-many-quartermasters"]
        );
    }

    #[test]
    fn quarrying_is_not_quartermaster() {
        assert_eq!(
            quartermasters(vec![region(vec![unit("5")])], "unit 5\nSTUDY QUAR\n", 2, 2),
            vec![]
        );
    }

    /// A unit that writes two STUDY lines is not asking to be counted once per line - only the
    /// first is what the server actually studies, the same as `Ordered::studies()` reads it.
    #[test]
    fn a_unit_with_two_study_orders_is_counted_once() {
        assert_eq!(
            quartermasters(
                vec![region(vec![unit("5")])],
                "unit 5\nSTUDY QUAM\nSTUDY QUAM\n",
                1,
                2
            ),
            vec![],
            "the one free place is spent once, not once per STUDY line"
        );
    }

    #[test]
    fn a_unit_that_is_already_a_quartermaster_is_not_counted() {
        assert_eq!(
            quartermasters(
                vec![region(vec![quartermaster(unit("5"))])],
                "unit 5\nSTUDY QUAM\n",
                2,
                2
            ),
            vec![]
        );
    }

    #[test]
    fn only_the_orders_past_the_allowance_are_warned() {
        let findings = quartermasters(
            vec![region(vec![unit("5"), unit("6"), unit("7")])],
            "unit 5\nSTUDY QUAM\nunit 6\nSTUDY QUAM\nunit 7\nSTUDY QUAM\n",
            1,
            2,
        );

        assert_eq!(
            findings
                .iter()
                .map(|f| f.unit_id.clone())
                .collect::<Vec<_>>(),
            vec![Some("6".to_string()), Some("7".to_string())],
            "the first study fits in the one free place; the rest, in document order, are marked"
        );
    }

    #[test]
    fn an_allowance_with_room_is_silent() {
        assert_eq!(
            quartermasters(vec![region(vec![unit("5")])], "unit 5\nSTUDY QUAM\n", 0, 2),
            vec![]
        );
    }

    #[test]
    fn without_a_quartermasters_line_nothing_is_said() {
        assert_eq!(
            check_turn(
                &report(vec![region(vec![unit("5")])]),
                "unit 5\nSTUDY QUAM\n",
                Some(&ruleset()),
                disabling(codes::NOT_ENOUGH_SILVER),
            ),
            vec![]
        );
    }

    #[test]
    fn without_a_ruleset_nothing_is_said() {
        assert_eq!(
            check_turn(
                &report_with_status("Quartermasters", 2, 2, vec![region(vec![unit("5")])]),
                "unit 5\nSTUDY QUAM\n",
                None,
                disabling(codes::NOT_ENOUGH_SILVER),
            ),
            vec![]
        );
    }

    #[test]
    fn a_foreign_unit_is_not_counted() {
        let mut foreign = unit("5");
        foreign.own = false;
        foreign.faction_id = Some("99".to_string());
        foreign.faction_name = Some("Someone Else".to_string());

        assert_eq!(
            quartermasters(vec![region(vec![foreign])], "unit 5\nSTUDY QUAM\n", 2, 2),
            vec![],
            "you cannot order a unit that is not yours, however the orders document reads"
        );
    }

    #[test]
    fn the_finding_sits_on_the_study_line() {
        let findings = quartermasters(
            vec![region(vec![unit("5")])],
            "unit 5\nWORK\nSTUDY QUAM\n",
            2,
            2,
        );

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].line, Some(3));
        assert_eq!(findings[0].region_id, "1:7,53".to_string());
    }

    /// The committed turn-82 fixture's own faction is already at `Quartermasters: 2 (2)` - a real
    /// report proving the header is read as the parser leaves it, not just as this module's own
    /// hand-built fixtures build it.
    #[test]
    fn a_fixture_faction_already_at_its_quartermaster_allowance_is_warned() {
        let report = crate::report::parse_report_full(atlantis_hud_fixtures::G3_F42_T82.text);
        assert_eq!(
            report
                .header
                .faction_status
                .entries
                .iter()
                .find(|entry| entry.label.eq_ignore_ascii_case("Quartermasters"))
                .map(|entry| (entry.used, entry.maximum)),
            Some((2, 2))
        );

        let findings = check_turn(
            &report,
            "unit 10989\nSTUDY QUAM\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(
            codes(&findings).contains(&"too-many-quartermasters"),
            "unit 10989 studying quartermaster on top of an already-full allowance should warn: \
             {findings:?}"
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

    /// `Ship [218]` of `neworigins-3.0.0-g5-f21-t23.rep`: a Raft stating `Load: 70/450; Sailors:
    /// 2/2`, the fleet both of this bead's verification failures were found on.
    fn raft(structure_id: &str) -> Structure {
        Structure {
            structure_id: structure_id.to_string(),
            name: "Ship".to_string(),
            kind: "Raft".to_string(),
            description: Some("Load: 70/450; Sailors: 2/2; MaxSpeed: 2.".to_string()),
            needs: None,
        }
    }

    /// `Drones (9508)` as that report prints it: two gnolls at sailing 1, which is exactly the two
    /// levels the raft needs - until one of them is given away.
    fn two_gnolls_aboard(id: &str, fleet_id: &str) -> ReportUnit {
        with_item(
            with_men(aboard(id, fleet_id, 20, 1), 2),
            2,
            "gnolls",
            "GNOL",
        )
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
                with_item(unfed(aboard("11125", "329", 300, 4)), 20, "grain", "GRAI"),
                unfed(unit("8801")),
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
                unfed(aboard("11125", "329", 300, 4)),
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
                with_item(unfed(aboard("11125", "329", 100, 4)), 20, "grain", "GRAI"),
                unfed(aboard("12590", "329", 50, 0)),
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
                unfed(aboard("11125", "329", 50, 4)),
                with_men(with_item(unfed(unit("8801")), 20, "gnoll", "GNOL"), 20),
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
            "unit 11125\nWITHDRAW 20 LONG\nSAIL N\n",
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
            // Unit 8801 only gives, so `unit-does-nothing` is right about it and orthogonal here.
            disabling(codes::UNIT_DOES_NOTHING),
        ));
        assert_eq!(
            without_ruleset.message,
            "Longship [329] is overloaded: 200 aboard on a capacity of 150, so it will not sail"
        );

        let with_ruleset = only(check_turn(
            &report(vec![region]),
            orders,
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
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

    /// Atlantis counts sailing levels per man, not per unit: a unit of several men at a low skill
    /// supplies one level per man. Verification failure on `ah-j0e` (PR #341, fixtures
    /// `neworigins-3.0.0-g5-f21-t23.rep` and `t24.rep`): a Raft stated `Sailors: 2/2`, crewed by
    /// two gnolls at sailing 1, was warned as short of sailors because the check summed one level
    /// per unit instead of per man.
    #[test]
    fn sailing_levels_are_reckoned_per_man_not_per_unit() {
        let raft = Structure {
            structure_id: "218".to_string(),
            name: "Ship".to_string(),
            kind: "Raft".to_string(),
            description: Some("Load: 70/450; Sailors: 2/2; MaxSpeed: 2.".to_string()),
            needs: None,
        };
        let two_gnolls = with_men(aboard("9508", "218", 20, 1), 2);
        let region = ReportRegion {
            structures: vec![raft],
            ..region(vec![two_gnolls])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 9508\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    /// A guessed headcount cannot price an exact number of sailing levels: doubt, not a warning.
    /// Raised in review on this bead's own PR.
    #[test]
    fn an_estimated_headcount_silences_the_undercrewed_check() {
        let mut guessed = aboard("9508", "329", 20, 1);
        guessed.men_estimated = true;
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![guessed])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 9508\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    /// The second verification failure on `ah-j0e`: a raft that will not sail, and no warning.
    /// The server runs every GIVE (phase 4) before it moves anybody (phase 9), so a gnoll given
    /// away this month is a sailing level the raft does not have when it sails.
    #[test]
    fn giving_a_sailor_away_this_month_is_short_of_sailors() {
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![two_gnolls_aboard("9508", "218")])
        };

        let found = only(check(vec![region], "unit 9508\nGIVE 0 1 GNOL\nSAIL N\n"));
        assert_eq!(found.code, codes::FLEET_UNDERCREWED);
        assert_eq!(found.unit_id.as_deref(), Some("9508"));
        assert_eq!(
            found.message,
            "Raft [218] is short of sailors: 2 sailing levels aboard less 1 given away this \
             month, it needs 2, so it will not sail"
        );
    }

    /// The men have left the hull whether they were discarded or handed to a neighbour, so the
    /// counterparty is never what the crew count turns on.
    #[test]
    fn giving_a_sailor_to_a_unit_in_the_hex_is_short_of_sailors() {
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![two_gnolls_aboard("9508", "218"), unit("9509")])
        };

        let found = only(check(vec![region], "unit 9508\nGIVE 9509 1 GNOL\nSAIL N\n"));
        assert_eq!(found.code, codes::FLEET_UNDERCREWED);
        assert_eq!(
            found.message,
            "Raft [218] is short of sailors: 2 sailing levels aboard less 1 given away this \
             month, it needs 2, so it will not sail"
        );
    }

    /// The first verification failure's regression: a full crew that transfers nothing still
    /// sails, and must never be warned about again.
    #[test]
    fn a_full_crew_that_gives_nothing_away_still_sails() {
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![two_gnolls_aboard("9508", "218")])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 9508\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    /// Men given *into* a unit aboard are merged and the receiving unit's skill recomputed, which
    /// this application does not model - so the crew check says nothing rather than inventing
    /// sailors. The load half is untouched by that doubt and still warns.
    #[test]
    fn men_given_into_a_unit_aboard_silence_the_crew_check() {
        let heavy = with_item(aboard("9508", "218", 500, 1), 1, "gnolls", "GNOL");
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![heavy, with_item(unit("9509"), 2, "gnolls", "GNOL")])
        };

        let found = only(check(
            vec![region],
            "unit 9509\nGIVE 9508 2 GNOL\nunit 9508\nSAIL N\n",
        ));
        assert_eq!(found.code, codes::FLEET_OVERLOADED);
    }

    /// The same, taken rather than given: men arriving is the doubt, whichever order moved them.
    #[test]
    fn men_taken_aboard_silence_the_crew_check() {
        let heavy = with_item(aboard("9508", "218", 500, 1), 1, "gnolls", "GNOL");
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![heavy, with_item(unit("9509"), 2, "gnolls", "GNOL")])
        };

        let found = only(check(
            vec![region],
            "unit 9508\nTAKE FROM 9509 2 GNOL\nSAIL N\n",
        ));
        assert_eq!(found.code, codes::FLEET_OVERLOADED);
    }

    /// Only people carry sailing levels: giving equipment away moves weight and leaves the crew
    /// exactly as it was.
    #[test]
    fn a_give_of_equipment_does_not_touch_the_crew() {
        let armed = with_item(two_gnolls_aboard("9508", "218"), 1, "sword", "SWOR");
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![armed])
        };

        assert_eq!(
            codes(&check(vec![region], "unit 9508\nGIVE 0 1 SWOR\nSAIL N\n")),
            Vec::<&str>::new()
        );
    }

    /// Without a catalogue there is no telling which tags name people, so no transfer of men can
    /// be recognised - silence, not a guess.
    #[test]
    fn no_ruleset_silences_the_crew_check() {
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![with_item(
                aboard("9508", "218", 20, 1),
                1,
                "gnolls",
                "GNOL",
            )])
        };

        assert_eq!(
            codes(&check_turn(
                &report(vec![region]),
                "unit 9508\nSAIL N\n",
                None,
                CheckOptions::default(),
            )),
            Vec::<&str>::new()
        );
    }

    /// A unit whose sums the ledger could not follow cannot price its crew either - but the load
    /// half never consulted `doubted` and must go on warning exactly as it does today.
    #[test]
    fn a_doubted_unit_aboard_silences_the_crew_but_not_the_load() {
        let heavy = with_silver(aboard("9508", "218", 500, 1), 500);
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![heavy])
        };

        let found = only(check(vec![region], "unit 9508\nGIVE 0 1 flumph\nSAIL N\n"));
        assert_eq!(found.code, codes::FLEET_OVERLOADED);
    }

    /// Men of one race arriving while men of another leave is still a merge, so the doubt is
    /// per race and not on the total - raised in review on PR #387.
    #[test]
    fn men_of_one_race_arriving_silence_the_crew_even_as_others_leave() {
        let heavy = with_item(
            with_item(aboard("9508", "218", 500, 1), 1, "gnolls", "GNOL"),
            0,
            "centaurs",
            "CTAU",
        );
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![heavy, with_item(unit("9509"), 1, "centaurs", "CTAU")])
        };

        let found = only(check(
            vec![region],
            "unit 9509\nGIVE 9508 1 CTAU\nunit 9508\nGIVE 0 1 GNOL\nSAIL N\n",
        ));
        assert_eq!(found.code, codes::FLEET_OVERLOADED);
    }

    /// Giving the whole crew away leaves no sailors at all, and the clamp holds at zero.
    #[test]
    fn giving_every_man_away_is_short_of_sailors() {
        let region = ReportRegion {
            structures: vec![raft("218")],
            ..region(vec![two_gnolls_aboard("9508", "218")])
        };

        let found = only(check(vec![region], "unit 9508\nGIVE 0 2 GNOL\nSAIL N\n"));
        assert_eq!(found.code, codes::FLEET_UNDERCREWED);
        assert_eq!(
            found.message,
            "Raft [218] is short of sailors: 2 sailing levels aboard less 2 given away this \
             month, it needs 2, so it will not sail"
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

    /// Every LEAVE runs before any ENTER, so a unit that does both is aboard when the fleet sails
    /// - in either written order.
    #[test]
    fn a_unit_that_leaves_and_re_enters_is_aboard() {
        let region = || ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![
                aboard("11125", "329", 100, 4),
                aboard("12590", "329", 100, 0),
            ])
        };

        // Both aboard is 200 on a capacity of 150; only a unit that really left would silence it.
        assert_eq!(
            only(check(
                vec![region()],
                "unit 11125\nSAIL N\nunit 12590\nLEAVE\nENTER 329\n",
            ))
            .code,
            codes::FLEET_OVERLOADED
        );
        assert_eq!(
            only(check(
                vec![region()],
                "unit 11125\nSAIL N\nunit 12590\nENTER 329\nLEAVE\n",
            ))
            .code,
            codes::FLEET_OVERLOADED
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

    // --- movement ---------------------------------------------------------------------------

    /// A unit carrying `weight` that the report says can move `allowance` on foot, as a real
    /// report states it: `Weight: 600. Capacity: 0/0/75/0.`
    fn carrying(id: &str, weight: i64, allowance: i64) -> ReportUnit {
        ReportUnit {
            weight: Some(weight),
            capacity: Some(format!("0/0/{allowance}/0")),
            ..unit(id)
        }
    }

    #[test]
    fn an_overloaded_unit_ordered_to_move_is_warned_on_its_move_line() {
        let finding = only(check(
            vec![region(vec![carrying("12054", 1800, 150)])],
            "unit 12054\nMOVE S S\n",
        ));
        assert_eq!(finding.code.as_str(), "unit-overloaded");
        assert_eq!(finding.unit_id.as_deref(), Some("12054"));
        assert_eq!(finding.line, Some(2));
        assert_eq!(
            finding.message,
            "this unit is overloaded: it carries 1800 and the most it can move with is 150, so \
             it will not move"
        );
    }

    #[test]
    fn a_unit_within_its_allowance_moves_in_silence() {
        assert_eq!(
            codes(&check(
                vec![region(vec![carrying("12054", 100, 150)])],
                "unit 12054\nMOVE S S\n",
            )),
            Vec::<&str>::new()
        );
    }

    /// "at least as great as" (rules:1101) - exactly at the allowance is fine.
    #[test]
    fn exactly_at_its_allowance_moves() {
        assert_eq!(
            codes(&check(
                vec![region(vec![carrying("12054", 150, 150)])],
                "unit 12054\nMOVE S S\n",
            )),
            Vec::<&str>::new()
        );
    }

    /// The real turn-41 case: 11 stone weigh 550, so 600 - 550 = 50 <= 75. Fails if the check
    /// read `ordered.unit.weight` instead of `weight_after_orders`.
    #[test]
    fn giving_the_ballast_away_first_lets_the_unit_move() {
        let region = region(vec![
            with_item(carrying("11619", 600, 75), 11, "stone", "STON"),
            unit("11992"),
        ]);
        assert_eq!(
            codes(&check(
                vec![region],
                "unit 11619\nGIVE 11992 11 STON\nMOVE S S\n",
            )),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_gift_that_overloads_a_unit_stops_it_moving() {
        let region = region(vec![
            carrying("999", 100, 150),
            with_item(unit("8801"), 30, "grain", "GRAI"),
        ]);
        let finding = only(check(
            vec![region],
            "unit 8801\nGIVE 999 30 GRAI\nunit 999\nMOVE S\n",
        ));
        assert_eq!(finding.code.as_str(), "unit-overloaded");
        assert!(
            finding
                .message
                .contains("it carries 250 and the most it can move with is 150"),
            "{}",
            finding.message
        );
    }

    /// 80 beats the ride allowance of 70 but not the walk allowance of 85, and the game takes
    /// whichever works - the comparison is against the best of the three, not the walk figure.
    #[test]
    fn the_best_of_the_three_allowances_is_what_counts() {
        let unit = ReportUnit {
            weight: Some(80),
            capacity: Some("0/70/85/0".to_string()),
            ..unit("13432")
        };
        assert_eq!(
            codes(&check(vec![region(vec![unit])], "unit 13432\nMOVE S\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_the_report_gives_no_capacity_is_not_judged() {
        let unit = ReportUnit {
            weight: Some(9999),
            capacity: None,
            ..unit("5")
        };
        assert_eq!(
            codes(&check(vec![region(vec![unit])], "unit 5\nMOVE S\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_unit_the_report_gives_no_weight_is_not_judged() {
        let unit = ReportUnit {
            weight: None,
            capacity: Some("0/0/1/0".to_string()),
            ..unit("5")
        };
        assert_eq!(
            codes(&check(vec![region(vec![unit])], "unit 5\nMOVE S\n")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn an_advance_is_a_move() {
        let finding = only(check(
            vec![region(vec![carrying("12054", 1800, 150)])],
            "unit 12054\nADVANCE S\n",
        ));
        assert_eq!(finding.code.as_str(), "unit-overloaded");
        assert_eq!(
            finding.message,
            "this unit is overloaded: it carries 1800 and the most it can move with is 150, so \
             it will not move"
        );
    }

    #[test]
    fn a_sail_is_not_a_move() {
        let region = ReportRegion {
            structures: vec![longship("329")],
            ..region(vec![ReportUnit {
                structure_id: Some("329".to_string()),
                ..carrying("11125", 1800, 150)
            }])
        };
        assert!(!codes(&check(vec![region], "unit 11125\nSAIL N\n")).contains(&"unit-overloaded"));
    }

    #[test]
    fn a_unit_that_does_not_move_is_not_judged() {
        assert_eq!(
            codes(&check(
                vec![region(vec![carrying("12054", 1800, 150)])],
                "unit 12054\nWORK\n",
            )),
            Vec::<&str>::new()
        );
    }

    // --- the faction's region allowance ---------------------------------------------------------

    /// `report_with_status`, checked with `check_trade_regions` reachable through `check_turn`
    /// rather than through the `check`/`check_ignoring_transfer_targets` helpers, which build a
    /// report with no `Faction Status:` block at all.
    fn check_trade(
        regions: Vec<ReportRegion>,
        orders: &str,
        label: &str,
        maximum: i64,
    ) -> Vec<Finding> {
        check_turn(
            &report_with_status(label, 0, maximum, regions),
            orders,
            Some(&ruleset()),
            // Their bare BUILDs are written from outside any structure, which
            // `build-outside-structure` is right about and these tests are not about.
            disabling_all(&[codes::BUILD_OUTSIDE_STRUCTURE, codes::UNIT_DOES_NOTHING]),
        )
    }

    #[test]
    fn producing_in_more_regions_than_the_faction_may_is_warned() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nPRODUCE grain\n";
        let findings = check_trade(regions, orders, "Trade Regions", 2);

        assert_eq!(codes(&findings), ["too-many-trade-regions"]);
        assert_eq!(
            findings[0].message,
            "PRODUCE orders in 3 regions; this faction may trade in 2, so 1 region's production \
             will be refused"
        );
    }

    #[test]
    fn the_warning_lands_on_the_first_produce_in_the_document() {
        // The first PRODUCE in the document is unit 6's, in the second region - deliberately not
        // the first region, so the test cannot pass by accident on "the first region" instead of
        // "the first PRODUCE line".
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nWORK\nunit 6\nPRODUCE grain\nunit 7\nPRODUCE grain\n\
                      unit 5\nPRODUCE grain\n";
        let findings = check_trade(regions, orders, "Trade Regions", 2);

        assert_eq!(codes(&findings), ["too-many-trade-regions"]);
        assert_eq!(findings[0].unit_id.as_deref(), Some("6"));
        assert_eq!(findings[0].region_id, "1:8,53");
    }

    #[test]
    fn two_regions_too_many_reads_as_a_plural() {
        let regions = vec![
            region_at("1:6,53", 6, 53, vec![unit("4")]),
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 4\nPRODUCE grain\nunit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\n\
                      unit 7\nPRODUCE grain\n";
        let findings = check_trade(regions, orders, "Trade Regions", 2);

        assert!(findings[0]
            .message
            .ends_with("so 2 regions' production will be refused"));
    }

    #[test]
    fn a_pooled_regions_counter_charges_tax_orders_too() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nTAX\n";
        let findings = check_trade(regions, orders, "Regions", 2);

        assert_eq!(codes(&findings), ["too-many-trade-regions"]);
        assert_eq!(
            findings[0].message,
            "PRODUCE and TAX orders in 3 regions; this faction may tax and trade in 2, so 1 \
             region's orders will be refused"
        );
    }

    /// A region that both produces and taxes must count once against the pooled allowance, not
    /// twice - proven by summing producing.len() + taxing.len() instead of the union, which would
    /// read this as 3 regions and warn where none is owed.
    #[test]
    fn a_region_that_both_produces_and_taxes_counts_once_under_the_pooled_schema() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5"), unit("6")]),
            region_at("1:8,53", 8, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nTAX\nunit 7\nPRODUCE grain\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Regions", 2)),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_faction_that_may_not_trade_at_all_is_told_so() {
        let regions = vec![region_at("1:7,53", 7, 53, vec![unit("5")])];
        let orders = "unit 5\nPRODUCE grain\n";
        let findings = check_trade(regions, orders, "Regions", 0);

        assert_eq!(
            findings[0].message,
            "this faction may not trade in any region, so every PRODUCE order will be refused"
        );
    }

    #[test]
    fn producing_within_the_allowance_is_silent() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Trade Regions", 2)),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn tax_orders_do_not_count_against_a_separate_trade_counter() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
            region_at("1:10,53", 10, 53, vec![unit("8")]),
            region_at("1:11,53", 11, 53, vec![unit("9")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nTAX\nunit 8\nTAX\n\
                      unit 9\nTAX\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Trade Regions", 2)),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn several_produce_orders_in_one_region_count_once() {
        let regions = vec![region_at(
            "1:7,53",
            7,
            53,
            vec![unit("5"), unit("6"), unit("7")],
        )];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nPRODUCE grain\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Trade Regions", 1)),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_report_with_no_faction_status_is_not_judged() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nPRODUCE grain\n";

        assert_eq!(codes(&check(regions, orders)), Vec::<&str>::new());
    }

    #[test]
    fn a_status_block_with_no_region_label_is_not_judged() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\nunit 7\nPRODUCE grain\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Quartermasters", 2)),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn no_produce_orders_means_nothing_to_warn_about() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nTAX\nunit 6\nTAX\nunit 7\nTAX\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Regions", 1)),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn a_build_order_is_not_a_produce() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![unit("7")]),
        ];
        let orders = "unit 5\nBUILD\nunit 6\nBUILD\nunit 7\nBUILD\n";

        assert_eq!(
            codes(&check_trade(regions, orders, "Trade Regions", 1)),
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

    // --- ah-7cdt: faction food in the hex ------------------------------------------------------

    /// A quartermaster's grain feeds a faction-mate set to `consuming faction's food`.
    #[test]
    fn a_unit_consuming_faction_food_is_fed_by_its_neighbours() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        let mut eater = starving(unit("2001"));
        eater.flags = vec!["consuming faction's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        assert_eq!(forecast(&review, "2001").upkeep, Some(0));
        assert_eq!(forecast(&review, "2001").doubt, None);
        // The hover's `covers {n}` line reads this, and nothing else in the core does.
        assert_eq!(forecast(&review, "2001").faction_food_covered, 60);
        assert_eq!(forecast(&review, "2000").faction_food_covered, 0);
    }

    /// A hex with one eater and not enough grain: it eats what there is, and the hover says how
    /// much that was rather than claiming the whole fee was met.
    #[test]
    fn a_lone_eater_in_a_short_hex_is_fed_what_there_is() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 1, "grain", "GRAI");
        let mut eater = starving(unit("2001"));
        eater.flags = vec!["consuming faction's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        assert_eq!(forecast(&review, "2001").upkeep, Some(10));
        assert_eq!(forecast(&review, "2001").faction_food_covered, 50);
        assert_eq!(forecast(&review, "2001").doubt, None);
    }

    #[test]
    fn a_unit_consuming_only_its_own_food_does_not_draw_on_the_pool() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        let mut eater = starving(unit("2001"));
        eater.flags = vec!["consuming unit's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        assert_eq!(forecast(&review, "2001").upkeep, Some(60));
    }

    #[test]
    fn a_unit_consuming_nothing_pays_silver_beside_a_full_pool() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        let mut eater = starving(unit("2001"));
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        assert_eq!(forecast(&review, "2001").upkeep, Some(60));
    }

    /// The doubt is about the upkeep alone: everything else about the month is still exact.
    #[test]
    fn a_contested_pool_doubts_the_upkeep_but_not_the_income() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 3, "grain", "GRAI");
        let mut first = with_silver(starving(unit("2001")), 500);
        first.flags = vec!["consuming faction's food".to_string()];
        first.men = 6;
        let mut second = with_silver(starving(unit("2002")), 500);
        second.flags = vec!["consuming faction's food".to_string()];
        second.men = 8;

        let review = forecast_of(vec![quartermaster, first, second]);

        for id in ["2001", "2002"] {
            let unit = forecast(&review, id);
            assert_eq!(unit.upkeep, None, "{id}");
            assert!(unit.income.is_some(), "{id}");
            assert!(unit.expense.is_some(), "{id}");
            assert!(unit.at_month_end.is_some(), "{id}");
            assert_eq!(unit.doubt, Some(SilverDoubt::ContestedFactionFood), "{id}");
        }
        assert_eq!(forecast(&review, "2000").upkeep, Some(10));
    }

    fn forecast_of(units: Vec<ReportUnit>) -> TurnReview {
        let report = ParsedReport {
            regions: vec![region(units)],
            ..Default::default()
        };
        review_turn(&report, "", None, CheckOptions::default())
    }

    fn forecast<'a>(review: &'a TurnReview, id: &str) -> &'a UnitSilver {
        review
            .silver
            .iter()
            .find(|unit| unit.unit_id == id)
            .expect("every own unit is forecast")
    }
}
