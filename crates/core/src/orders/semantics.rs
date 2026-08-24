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
use super::intents::{read_intents, spends_the_month, Intent, PlacedIntent, UnitIntents};
use super::standing::{self, standing_after, Boarding};
use crate::movement::mode::{
    best_allowance, cargo_capacity, fleet_label, parse_fleet_kind, sailing_requirement,
};
use crate::movement::orders::MoveStep;
use crate::movement::rules::{item_spellings, Production, Ruleset, SkillEntry};
use crate::orders::silver::{
    combat_ready, feed_after_silver, feed_from_faction_food, food_claim, forecast_unit,
    late_income, parse_wage_centis, pillage_threshold, plan_production, pool_wants, price_pillage,
    price_tax, recipe_for, settle_unclaimed, split_pool, taxes, unit_upkeep, ContendedPool,
    FactionFoodPass, FactionPurse, FoodClaim, LateFoodClaim, LateFoodRelief, Lookups, MarketSide,
    PoolOverrun, PoolShare, PoolShares, PoolWants, PurchaseAnswer, Receipts, RegionWages,
    SaleAnswer, SilverDoubt, UnitFacts, UnitSilver, UpkeepClaim, UpkeepSettlement, FOOD_TAGS,
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
    pub const CLAIMS_EXCEED_UNCLAIMED: Code = Code("claims-exceed-unclaimed");
    pub const UPKEEP_EXCEEDS_UNCLAIMED: Code = Code("upkeep-exceeds-unclaimed");
    pub const TAXED_A_PILLAGED_HEX: Code = Code("taxed-a-pillaged-hex");
    pub const PRODUCE_WITHOUT_SKILL: Code = Code("produce-without-skill");
    pub const PRODUCE_NOT_HERE: Code = Code("produce-not-here");
    pub const REGION_POOL_OVERSUBSCRIBED: Code = Code("region-pool-oversubscribed");
    pub const PILLAGE_WITHOUT_MEN: Code = Code("pillage-without-men");
    pub const TAXED_A_GUARDED_HEX: Code = Code("taxed-a-guarded-hex");
    /// Every code. This array's own order is not the settings tab's grouping (that groups by
    /// concern - Teaching / Resources / Markets / Guarding / Orders / Sailing - not by this list):
    /// a new entry joins whichever group fits its concern, which need not be the last one
    /// (`give-target-not-here` and `not-traded-here` joined the existing *Orders* group;
    /// `too-many-quartermasters` and `study-at-maximum` joined the existing *Studying/Teaching*
    /// group). What every entry so far has kept is new-*here*-last: the generated TypeScript
    /// copies this array's order, so a new code is always appended to it regardless of where it
    /// lands in the UI.
    pub const ALL: [Code; 32] = [
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
        CLAIMS_EXCEED_UNCLAIMED,
        UPKEEP_EXCEEDS_UNCLAIMED,
        TAXED_A_PILLAGED_HEX,
        PRODUCE_WITHOUT_SKILL,
        PRODUCE_NOT_HERE,
        REGION_POOL_OVERSUBSCRIBED,
        PILLAGE_WITHOUT_MEN,
        TAXED_A_GUARDED_HEX,
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

    // Read once for the whole report rather than per hex or per message: the unit a shortfall is
    // said of is often the one holding none of the thing, so the evidence for its plural is
    // usually somewhere else entirely (`ah-rsdz`).
    let plurals = plurals_in(report);

    // Faction-wide, so it is read once for the whole report rather than per hex: the same value
    // recomputed in every region would also read to the next person as though it were regional.
    let purse = FactionPurse {
        unclaimed: report.header.unclaimed_silver,
    };

    // Step 7 of the payment order is faction-wide, so every hex's ledger has to exist before any
    // of them can be judged: what one hex's units take from the fund is what another hex's cannot.
    // Hence two passes over the regions rather than one. `Hex<'_>` borrows `report` and `ordered`
    // and `Ledger<'_>` borrows `ruleset`, all of which outlive this function, so holding them all
    // at once costs peak memory rather than work - each ledger is still built exactly once. A
    // region with no own units now builds an empty ledger where the single-pass loop skipped it,
    // which is a walk of nothing.
    let mut hexes: Vec<(Hex<'_>, Ledger<'_>)> = report
        .regions
        .iter()
        .map(|region| {
            let hex = Hex::read(region, &ordered);
            let ledger = ledger_for(&hex, ruleset);
            (hex, ledger)
        })
        .collect();

    // Step 4 comes before steps 5 and 6: a neighbour's silver is spent before anybody's grain.
    let shared_silver = share_silver_for_upkeep(&mut hexes);
    // Steps 5 and 6 come before step 7 in the payment order, and `upkeep_claims` reads the relief
    // they leave, so this must run first.
    let food_relief = feed_from_food_after_silver(&mut hexes);
    let claims = upkeep_claims(&hexes);
    // `CLAIM` resolves during the month and maintenance is settled at its end, so this month's
    // claims come off the fund before step 7 ever sees it (`ah-fjty`).
    // A fund whose withdrawals nothing can price is not a fund we can spend on upkeep, so an
    // unknown total leaves the settlement inactive rather than falling back (`ah-tdsi`).
    let available = purse
        .unclaimed
        .zip(total_drawn_from_fund(report, &ordered, ruleset))
        .map(|(held, drawn)| (held - drawn).max(0));
    let settlement = settle_unclaimed(&claims, available);
    apply_relief(&mut hexes, &settlement);

    for (hex, ledger) in &hexes {
        // Per hex, because the pools are: what one region's units ask of its tax base says nothing
        // about the next region's.
        let mut overruns: Vec<PoolOverrun> = Vec::new();
        forecast_hex(
            hex,
            &receipts,
            purse,
            ruleset,
            &Relief {
                shared_silver: &shared_silver,
                food: &food_relief,
                settlement: &settlement,
            },
            &mut silver,
            &mut overruns,
        );
        if hex.units.is_empty() {
            continue;
        }

        let start = findings.len();
        check_region_pools(hex, &overruns, ruleset, &plurals, &options, &mut findings);
        check_resources(hex, ledger, ruleset, &plurals, &options, &mut findings);
        check_markets(hex, ruleset, &options, &mut findings);
        let pillaged = own_unit_pillages(hex);
        check_pillaged_tax(hex, pillaged, &options, &mut findings);
        check_guarded_tax(
            hex,
            foreign_unit_guards(hex),
            pillaged,
            &options,
            &mut findings,
        );
        check_pillage_men(hex, ruleset, &options, &mut findings);
        check_guard(hex, &options, &mut findings);
        check_teaching(hex, ruleset, &options, &mut findings);
        check_building(hex, &options, &mut findings);
        check_building_outside(hex, &options, &mut findings);
        check_build_help(hex, &options, &mut findings);
        check_build_skill(hex, ruleset, &options, &mut findings);
        check_production(hex, ruleset, &options, &mut findings);
        check_studying(hex, ruleset, &options, &mut findings);
        check_magic_study(hex, ruleset, &options, &mut findings);
        check_forms(hex, &options, &mut findings);
        check_idle_units(hex, &options, &mut findings);
        check_transfer_targets(hex, &located, &options, &mut findings);
        check_sailing(hex, ledger, ruleset, &options, &mut findings);
        check_movement(hex, ledger, ruleset, &options, &mut findings);

        // Within a hex, what sits on a line comes first and in line order; what belongs to the hex
        // itself comes last. `sort_by_key` is stable, so checks that produce several findings for
        // one line keep the order they produced them in.
        findings[start..].sort_by_key(|finding| (finding.line.is_none(), finding.line));
    }

    // Everything above is about one hex. An allowance is spent across the whole map, so it is
    // counted once, after every hex has been read - and `validate_turn` sorts the whole list by
    // line afterwards, so these findings land beside the per-hex ones rather than after them.
    check_faction(report, &ordered, ruleset, &options, &mut findings);
    check_upkeep_fund(report, &settlement, &options, &mut findings);

    TurnReview { findings, silver }
}

/// What the payment order's later steps paid on the units' behalf, decided before any hex is
/// priced and applied to the column together.
///
/// One argument rather than three because they are one idea - who paid what, and at which step -
/// and because the order they are applied in is the rules' own: step 4, then steps 5 and 6, then
/// step 7.
struct Relief<'a> {
    /// Step 4: silver from other own units in the same hex (`ah-e66j`).
    shared_silver: &'a BTreeMap<String, i64>,
    /// Steps 5 and 6: the unit's own food, then its hex's faction food (`ah-eacd`).
    food: &'a BTreeMap<String, LateFoodRelief>,
    /// Step 7: the faction's unclaimed fund, which is faction-wide (`ah-fjty`).
    settlement: &'a UpkeepSettlement,
}

/// What settling a hex's pools between their claimants produced: a share per unit, and what had to
/// be divided to arrive at them.
///
/// The overruns travel with the shares rather than being worked out again by the check that
/// reports them (`ah-t2pn.4`), so the sentence a player reads and the figures in their Silver
/// column can never disagree about what this hex asked for.
struct PoolSettlement {
    /// One entry per unit in `hex.units`, index-aligned with it.
    shares: Vec<PoolShares>,
    /// Every pool the hex's own units asked more of than it holds. Empty is the ordinary case.
    overruns: Vec<PoolOverrun>,
}

/// One [`PoolShares`] per unit in `hex.units`, index-aligned, for every contended regional pool.
///
/// Computed **once per hex** and handed to both [`forecast_hex`] and [`charge_upkeep`]: they price
/// `WORK` and `ENTERTAIN` through the same [`late_income`], so two settlements would be two answers
/// to one question - the drift `ah-uwa3` removed and `ah-ycuj` now guards.
///
/// Per pool the same three rules: fewer than two units wanting it is not contention and keeps the
/// arithmetic it always had; any wanting unit with a guessed headcount makes every wanting unit's
/// share [`PoolShare::Unknowable`]; otherwise [`split_pool`] divides it. A unit not drawing on a
/// pool is never touched by somebody else's contention for it.
fn pool_shares_for(hex: &Hex<'_>, region: RegionWages) -> PoolSettlement {
    /// One contended pool, as the loop below reads it: what a unit asks of it, where that unit's
    /// share of it is written, what the region says it holds, and which pool to name in a finding
    /// about it.
    struct Contended {
        want_of: fn(&PoolWants) -> i64,
        share_of: fn(&mut PoolShares) -> &mut PoolShare,
        pool: Option<i64>,
        names: ContendedPool,
    }

    let nothing = Receipts::default();
    let wants: Vec<PoolWants> = hex_facts(hex, &nothing)
        .iter()
        .map(|facts| pool_wants(facts, region))
        .collect();

    let mut shares = vec![PoolShares::default(); hex.units.len()];
    let mut overruns: Vec<PoolOverrun> = Vec::new();
    // `max_wages: None` means the region states *no ceiling*, not that it has no money, so it is
    // never contended - dividing a pool of zero would pay every worker nothing. `entertainment:
    // None` is the opposite default and is documented as such on `RegionWages`: the region pays
    // entertainers nothing, so there is nothing to divide and nothing to doubt.
    let pools = [
        Contended {
            want_of: |want| want.tax,
            share_of: |into| &mut into.tax,
            // A pillage empties the hex before any TAX reaches it (`ah-cxxa`), so there is no
            // pool left for anybody to draw on, let alone oversubscribe: every taxer here
            // collects a certain nothing whatever the settlement would have said, and
            // `taxed-a-pillaged-hex` is the finding that fits. `ah-t2pn.4` found the two firing
            // together.
            pool: region.tax_base.filter(|_| !region.pillaged),
            names: ContendedPool::Tax,
        },
        Contended {
            want_of: |want| want.wages,
            share_of: |into| &mut into.wages,
            pool: region.max_wages,
            names: ContendedPool::Wages,
        },
        Contended {
            want_of: |want| want.entertainment,
            share_of: |into| &mut into.entertainment,
            pool: region.entertainment,
            names: ContendedPool::Entertainment,
        },
    ];

    for Contended {
        want_of,
        share_of,
        pool,
        names,
    } in pools
    {
        let wanting: Vec<usize> = (0..hex.units.len())
            .filter(|index| want_of(&wants[*index]) > 0)
            .collect();
        // A region stating no pool has none to divide, and one unit is not contention: both keep
        // the arithmetic - and, for `TAX`, the `UnknownTaxBase` doubt - they always had.
        let Some(pool) = pool.filter(|_| wanting.len() > 1) else {
            continue;
        };

        // A guessed headcount is a guessed ask, so no unit's share is a number - not even one
        // whose own count is exact.
        if wanting
            .iter()
            .any(|index| hex.units[*index].unit.men_estimated)
        {
            for index in wanting {
                *share_of(&mut shares[index]) = PoolShare::Unknowable;
            }
            continue;
        }

        let asks: Vec<i64> = wanting
            .iter()
            .map(|index| want_of(&wants[*index]))
            .collect();
        // Only a pool that is genuinely short is an overrun (`ah-t2pn.4`): one that covers every
        // claim divided nothing, so there is nothing to tell anybody about.
        let wanted: i64 = asks.iter().copied().fold(0, i64::saturating_add);
        if wanted > pool {
            overruns.push(PoolOverrun {
                pool: names,
                wanted,
                available: pool,
                claimants: wanting.clone(),
            });
        }
        for (index, share) in wanting.iter().zip(split_pool(&asks, pool)) {
            *share_of(&mut shares[*index]) = PoolShare::Share(share);
        }
    }
    PoolSettlement { shares, overruns }
}

/// Every own unit's claim on each of this hex's market lines, settled (`ah-t2pn.3`).
///
/// Keyed by canonical item tag **and side**: a unit selling horses and a unit buying horses draw
/// on two different pools - the `Wanted` and `For Sale` lists - which the report prints as two
/// lines. Each vector is index-aligned with `hex.units`, as the tax shares are and for the same
/// reason: two units may carry the same id, and a map keyed by id would merge them.
///
/// [`PoolShare::Unknowable`] has no counterpart here. A market claim is counted in goods and does
/// not multiply out by headcount, so a guessed headcount tells us nothing about it.
fn market_shares_for(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    overruns: &mut Vec<PoolOverrun>,
) -> BTreeMap<(String, MarketSide), Vec<i64>> {
    let mut wants: BTreeMap<(String, MarketSide), Vec<i64>> = BTreeMap::new();

    for (index, ordered) in hex.units.iter().enumerate() {
        for placed in ordered.intents {
            let (text, side) = match &placed.intent {
                Intent::Sell { item, .. } => (item, MarketSide::Selling),
                Intent::Buy { item, .. } => (item, MarketSide::Buying),
                _ => continue,
            };
            let Some(tag) = resolve_item(text, hex, ordered, ruleset) else {
                continue;
            };
            let tag = tag.to_ascii_uppercase();
            let lines = match side {
                MarketSide::Selling => &hex.region.wanted,
                MarketSide::Buying => &hex.region.for_sale,
            };
            // A tag this market has no line for has no pool, so there is nothing to divide - and
            // the goods are unsellable or unpriceable, which the arms already answer for.
            let Some(pool) = lines
                .iter()
                .find(|line| line.tag.eq_ignore_ascii_case(&tag))
                .map(|line| line.amount)
            else {
                continue;
            };

            let want = match (&placed.intent, side) {
                // A unit cannot sell what it does not hold, so asking for more is not a larger
                // claim on the market.
                (Intent::Sell { amount, .. }, _) => {
                    let holds = ordered.holding(&tag);
                    match amount {
                        Amount::Exact(count) => (*count).min(holds),
                        Amount::All { except } => (holds - except).max(0),
                    }
                }
                (Intent::Buy { amount, .. }, _) => match amount {
                    Amount::Exact(count) => *count,
                    // An unbounded order attempts to buy everything there is, so that is what it
                    // contends for. What it can afford is not known until the deferred pass, which
                    // runs after this settlement must.
                    Amount::All { .. } => pool,
                },
                _ => continue,
            };
            if want <= 0 {
                // A zero want is not a claim and takes no share.
                continue;
            }

            let claims = wants
                .entry((tag, side))
                .or_insert_with(|| vec![0; hex.units.len()]);
            claims[index] = claims[index].saturating_add(want);
        }
    }

    wants
        .into_iter()
        .map(|((tag, side), claims)| {
            let lines = match side {
                MarketSide::Selling => &hex.region.wanted,
                MarketSide::Buying => &hex.region.for_sale,
            };
            let pool = lines
                .iter()
                .find(|line| line.tag.eq_ignore_ascii_case(&tag))
                .map_or(0, |line| line.amount);
            // Only a line that is genuinely short is an overrun (`ah-t2pn.4`). Unlike the silver
            // pools, one trader is enough: `ah-t2pn.3` settles a market whenever anybody trades,
            // which is what caps a unit ordering `BUY 200` where 100 exist.
            let wanted: i64 = claims.iter().copied().fold(0, i64::saturating_add);
            if wanted > pool {
                overruns.push(PoolOverrun {
                    pool: ContendedPool::Market {
                        tag: tag.clone(),
                        side,
                    },
                    wanted,
                    available: pool,
                    claimants: claims
                        .iter()
                        .enumerate()
                        .filter(|(_, claim)| **claim > 0)
                        .map(|(index, _)| index)
                        .collect(),
                });
            }
            let shares = split_pool(&claims, pool);
            ((tag, side), shares)
        })
        .collect()
}

/// The region's shared figures, as both surfaces that price a hex read them.
///
/// One function rather than two identical literals: `forecast_hex` and `charge_upkeep` must settle
/// the same pools from the same numbers, and two copies are two things to keep in step.
fn region_wages(hex: &Hex<'_>, ruleset: Option<&Ruleset>) -> RegionWages {
    RegionWages {
        tax_base: hex.region.tax_base,
        wage_centis: parse_wage_centis(hex.region.wages.as_deref()),
        max_wages: hex.region.max_wages,
        entertainment: hex.region.entertainment,
        pillaged: own_unit_pillages(hex),
        combat_ready: combat_ready_in(hex, ruleset),
    }
}

/// Combat ready men this faction has in one hex, summed over its own units - foreign units are not
/// in `hex.units` to begin with, since `Hex::read` has already filtered them out.
///
/// `None` when any own unit's headcount is a guess, or there is no ruleset: one guess is enough to
/// make the threshold unanswerable, and it is unanswerable in the direction that matters - the
/// estimate might be what carries the faction over it (`ah-1ad6.2`).
fn combat_ready_in(hex: &Hex<'_>, ruleset: Option<&Ruleset>) -> Option<i64> {
    let nothing = Receipts::default();
    let mut total = 0i64;
    for facts in hex_facts(hex, &nothing) {
        total = total.saturating_add(combat_ready(&facts, ruleset)?);
    }
    Some(total)
}

/// Every own unit in one hex, priced. Foreign units are not here to begin with: `Hex::read` has
/// already filtered them out, so their cell is blank for free.
fn forecast_hex(
    hex: &Hex<'_>,
    receipts: &BTreeMap<String, Receipts>,
    purse: FactionPurse,
    ruleset: Option<&Ruleset>,
    relief: &Relief<'_>,
    into: &mut Vec<UnitSilver>,
    overruns: &mut Vec<PoolOverrun>,
) {
    let Relief {
        shared_silver,
        food: food_relief,
        settlement,
    } = relief;
    let region = region_wages(hex, ruleset);
    let nothing = Receipts::default();

    // A region's pools are shared, so who else in this hex draws on them has to be settled before
    // any one unit can be priced against them (`ah-t2pn`).
    let settled = pool_shares_for(hex, region);
    let shares = settled.shares;
    overruns.extend(settled.overruns);

    // A market line is shared the same way, and the rules say so outright: oversupply and
    // oversubscription split in proportion to what each unit tried to trade (`ah-t2pn.3`).
    let market_shares = market_shares_for(hex, ruleset, overruns);

    // Step 2 of the payment order runs across the whole hex, so it needs every unit's step-1
    // leftovers before it can settle any of them. Gathered here, applied once the loop is done.
    let mut claims: Vec<FoodClaim> = Vec::with_capacity(hex.units.len());
    let start = into.len();

    for (index, ordered) in hex.units.iter().enumerate() {
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
        // What this unit's own share of the settled market line is. `None` where nothing was
        // settled - untraded goods, goods nothing could identify - and the arm then falls back to
        // what the market line itself says.
        let market_share = |text: &str, side: MarketSide| {
            resolve_item(text, hex, ordered, ruleset).and_then(|tag| {
                market_shares
                    .get(&(tag.to_ascii_uppercase(), side))
                    .map(|shares| shares[index])
            })
        };
        let name_of = |tag: &str| item_name(tag, hex, ruleset);

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
            shares[index],
            purse,
            Lookups {
                sale: &sale,
                purchase: &purchase,
                item_tag: &item_tag,
                item_name: &name_of,
                market_share: &market_share,
            },
            ruleset,
        ));
    }

    // One claim was pushed per unit, in the same loop that pushed its forecast, so the two are
    // index-aligned - which is also what keeps two units sharing an id from being confused for one
    // another, as a lookup by id could not.
    let settled = feed_from_faction_food(&claims).settled;
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

    // Step 4, decided per hex before this one was priced and only applied here - and before the
    // step-5/6 pass below, which is the payment order's own sequence.
    //
    // The walk is positional over `hex.units` but the lookup is by id, so two report units sharing
    // an id are conflated here; the same caveat, and the same reason, as the pass below.
    for (ordered, forecast) in hex.units.iter().zip(into[start..].iter_mut()) {
        let Some(owed) = forecast.upkeep else {
            // A doubted fee stays doubted: a neighbour cannot settle a number nothing knows.
            continue;
        };
        let covered = shared_silver
            .get(&ordered.unit.unit_id)
            .copied()
            .unwrap_or_default();
        forecast.shared_silver_covered = covered;
        forecast.upkeep = Some((owed - covered).max(0));
    }

    // Steps 5 and 6, decided per hex before this one was priced and only applied here.
    //
    // The walk is positional over `hex.units` but the lookup is by id, so - unlike the food pass
    // above - two report units sharing an id are conflated here. That is exactly what
    // `Ledger.balance` already does with such a pair, so this adds no hazard it does not have.
    for (ordered, forecast) in hex.units.iter().zip(into[start..].iter_mut()) {
        let Some(owed) = forecast.upkeep else {
            // A doubted fee stays doubted: food cannot settle a number nothing knows.
            continue;
        };
        let Some(relief) = food_relief.get(&ordered.unit.unit_id) else {
            continue;
        };
        forecast.food_contended = relief.contended;
        forecast.own_food_covered += relief.own_covered;
        forecast.faction_food_covered += relief.faction_covered;
        forecast.forced_own_food = relief.own_items;
        forecast.forced_own_food_tag = relief.own_tag.clone();
        forecast.forced_faction_food = relief.faction_items;
        forecast.upkeep = Some((owed - relief.own_covered - relief.faction_covered).max(0));
    }

    // Step 7, in a second pass for the same reason the first one exists: the settlement is
    // faction-wide, so it is decided before any hex is priced and only applied here.
    //
    // The walk is positional over `hex.units` but the lookup is by id, so - unlike the food pass
    // above - two report units sharing an id are conflated here. That is exactly what
    // `Ledger.balance` already does with such a pair, so this adds no hazard it does not have; it
    // is written down because the difference from the pass above is invisible until it is not.
    for (ordered, forecast) in hex.units.iter().zip(into[start..].iter_mut()) {
        let Some(owed) = forecast.upkeep else {
            // A fee that is already doubted stays doubted: the fund cannot settle a number
            // nothing knows.
            continue;
        };
        if settlement.covered.is_empty() {
            // The fund could not reach everybody, so it reached nobody here. The figure stays
            // where it is - the pessimistic answer the navigator chose - and only the hover's
            // note changes.
            forecast.unclaimed_contended =
                settlement.short > 0 && settlement.claimants.contains(&ordered.unit.unit_id);
            continue;
        }
        let covered = settlement
            .covered
            .get(&ordered.unit.unit_id)
            .copied()
            .unwrap_or_default();
        forecast.unclaimed_covered = covered;
        forecast.upkeep = Some((owed - covered).max(0));
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
    /// What maintenance actually took off each unit's silver balance - the fee less the silver
    /// that arrives in time to pay it. Different from `upkeep` for any unit that works or
    /// entertains, and it is this figure, not the fee, that the faction's unclaimed fund can be
    /// asked to settle (`ah-fjty`). Present for every unit that owes a fee at all, including one
    /// whose wages cover the whole of it, so an absent key means "no fee" rather than "covered".
    upkeep_drawn: BTreeMap<String, i64>,
    /// What the faction's unclaimed fund takes back off that overdraft, at step 7 of the payment
    /// order. Written by `review_turn` after the ledger is built, never inside `ledger_for`, and
    /// deliberately not credited to `balance`: `check_sailing` and `check_movement` read the same
    /// ledger, and moving a balance to make one message read correctly is how two checks end up
    /// disagreeing about one turn (`ah-fjty`).
    upkeep_relieved: BTreeMap<String, i64>,
    /// What each unit lent a faction-mate for maintenance at step 4. Subtracted by `silver_balance`,
    /// so a lender's silver is spent exactly once: without it the same silver would pay a
    /// neighbour's fee here and still be counted into `report_shortfalls`'s `SHARE` pool for
    /// somebody's orders (`ah-e66j`).
    ///
    /// Deliberately not debited from `balance`, for the reason `upkeep_relieved` gives:
    /// `check_sailing` and `check_movement` read this ledger and must go on seeing the silver the
    /// unit actually holds.
    upkeep_lent: BTreeMap<String, i64>,
    /// Whether this hex's maintenance sharing fell short, so its silver shortfall belongs to the
    /// hex rather than to any unit in it. Turns the per-unit `not-enough-silver` findings into the
    /// single hex-level one, exactly as a `SHARE` flag already does for every tag (`ah-e66j`).
    maintenance_pooled: bool,
    /// What step 2 left of this hex's faction-food pool, written by `charge_upkeep` from the pass
    /// it already makes. Steps 5 and 6 draw on the same food, and a third call to
    /// `feed_from_faction_food` would be a third answer to one question.
    faction_food: FactionFoodPass,
}

/// Whether any *foreign* unit in this hex is on guard.
///
/// A guard blocks another faction's `TAX` unless the guarding faction has declared that faction
/// Friendly - **its** declaration, not ours, which our report does not carry and never will
/// (`ah-g7ts`). So this is deliberately a bare "is anyone guarding", with no reference to
/// `header.attitudes`: that block states our attitudes toward them, which is the other direction
/// and would answer a question nobody asked.
///
/// Foreign units are read from `hex.region.units` rather than `hex.units`, which `Hex::read` has
/// already filtered down to our own.
fn foreign_unit_guards(hex: &Hex<'_>) -> bool {
    hex.region
        .units
        .iter()
        .any(|unit| !unit.own && unit.on_guard)
}

/// Whether any own unit in this hex is ordered to pillage it.
///
/// "PILLAGE comes before TAX, so a unit performing TAX will collect no money in that region that
/// month" - so this empties the region's tax base for every own unit taxing it (`ah-cxxa`).
/// Foreign units are not here to begin with (`Hex::read` filters them out) and their orders are
/// unknowable, so this is only ever about the orders in the document being edited.
///
/// Computed once per hex and passed down rather than called per intent: `apply` runs for every
/// placed intent of every unit, so calling this there would walk the hex quadratically on a path
/// that runs on every keystroke.
fn own_unit_pillages(hex: &Hex<'_>) -> bool {
    hex.units.iter().any(|ordered| {
        ordered
            .intents
            .iter()
            .any(|placed| matches!(placed.intent, Intent::Pillage))
    })
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
        upkeep_drawn: BTreeMap::new(),
        upkeep_relieved: BTreeMap::new(),
        upkeep_lent: BTreeMap::new(),
        maintenance_pooled: false,
        faction_food: FactionFoodPass::default(),
    };

    for ordered in &hex.units {
        for item in &ordered.unit.items {
            ledger.balance.insert(
                (ordered.unit.unit_id.clone(), item.tag.to_ascii_uppercase()),
                item.amount,
            );
        }
    }

    let pillaged = own_unit_pillages(hex);
    // Once per hex, not once per pillaging unit: `apply` runs per intent and this path runs per
    // keystroke, so a city of forty units would otherwise rebuild the sum forty times.
    let hex_combat_ready = combat_ready_in(hex, ruleset);
    for ordered in &hex.units {
        for placed in ordered.intents {
            apply(&mut ledger, hex, ordered, placed, ruleset, hex_combat_ready);
        }
        credit_tax(&mut ledger, hex, ordered, pillaged);
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
///
/// Silver the unit earns in the turn's last phase - wages, entertaining, Phantasmal Entertainment -
/// arrives too late to pay for anything the orders spend but *is* in time for maintenance
/// (`ah-uwa3`), so it is netted off the fee. Netted off rather than credited to the balance: a
/// credit would leave the surplus where the orders could spend it, which is the very error this
/// removes.
/// Every own unit in one hex as maintenance sees it. Shared by `charge_upkeep` and by steps 5 and
/// 6, which must read exactly the same facts or the column and the warning will disagree.
fn hex_facts<'a>(hex: &'a Hex<'_>, nothing: &'a Receipts) -> Vec<UnitFacts<'a>> {
    hex.units
        .iter()
        .map(|ordered| UnitFacts {
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
            receipts: nothing,
        })
        .collect()
}

fn charge_upkeep(ledger: &mut Ledger<'_>, hex: &Hex<'_>) {
    // Step 2 of the payment order needs every unit's step-1 leftovers before it can settle any of
    // them, so this is two passes over one set of facts rather than one pass - built once here,
    // because two copies of the same literal are two things to keep in step.
    let nothing = Receipts::default();
    let facts = hex_facts(hex, &nothing);

    // The same settlement `forecast_hex` prices the column from: `WORK` and `ENTERTAIN` reach both
    // surfaces through one `late_income`, so two settlements would be two answers to one question.
    let region = region_wages(hex, ledger.ruleset);
    let shares = pool_shares_for(hex, region).shares;

    // The check and the Silver column read one fact, so they settle the hex's faction-food pool
    // the same way: warning that a unit cannot pay a fee its faction-mates' grain already paid is
    // two surfaces contradicting each other, which is what `ah-7cdt`'s verification found.
    let claims: Vec<FoodClaim> = facts.iter().map(food_claim).collect();
    let pass = feed_from_faction_food(&claims);
    let settled = pass.settled.clone();
    ledger.faction_food = pass;

    for ((ordered, facts), shares) in hex.units.iter().zip(&facts).zip(&shares) {
        let owed = match settled.get(&ordered.unit.unit_id) {
            // The pool fed this unit: it owes what step 2 left it, not what step 1 did.
            Some(Some(left)) => *left,
            // Contended for a pool too small to feed them all, so what this unit pays cannot be
            // told at all (the column shows `?`). Charging the undiscounted fee would warn about
            // a shortfall that may not exist, and this module does not produce false warnings.
            Some(None) => continue,
            None => match unit_upkeep(facts) {
                Some(owed) => owed,
                None => continue,
            },
        };
        if owed <= 0 {
            continue;
        }
        // Only what the late earnings cannot cover reaches the balance. `ledger.upkeep` keeps the
        // *full* fee: it is read only to word the finding ("orders and upkeep" against "orders"),
        // and a unit whose wages cover its fee is still a unit with a fee.
        let charged = (owed - late_income(facts, region, *shares)).max(0);
        if charged > 0 {
            *ledger
                .balance
                .entry((ordered.unit.unit_id.clone(), SILVER.to_string()))
                .or_insert(0) -= charged;
        }
        ledger.upkeep.insert(ordered.unit.unit_id.clone(), owed);
        ledger
            .upkeep_drawn
            .insert(ordered.unit.unit_id.clone(), charged);
    }
}

fn check_resources(
    hex: &Hex<'_>,
    ledger: &Ledger<'_>,
    ruleset: Option<&Ruleset>,
    plurals: &Plurals,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    report_shortfalls(ledger, hex, ruleset, plurals, options, findings);
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

/// Own units ordered to tax a hex one of their faction-mates is pillaging.
///
/// One finding per taxing unit, on its own `TAX` line: each is separately editable and each is
/// equally affected. The pillager itself is never named - its orders are fine, and it is the only
/// unit here that will collect anything. A unit ordered to do both is still told about its `TAX`
/// line, because the emptiness is a property of the hex rather than of who caused it (`ah-cxxa`).
fn check_pillaged_tax(
    hex: &Hex<'_>,
    pillaged: bool,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !pillaged || !options.emits(codes::TAXED_A_PILLAGED_HEX) {
        return;
    }

    for ordered in &hex.units {
        let mut ordered_to_tax = false;
        for placed in ordered.intents {
            if !matches!(placed.intent, Intent::Tax) {
                continue;
            }
            ordered_to_tax = true;
            findings.push(ordered.finding(
                hex,
                codes::TAXED_A_PILLAGED_HEX,
                "a unit is pillaging this hex, so this TAX will collect nothing".to_string(),
                Some(placed),
            ));
        }
        // A unit that taxes by its flag collects nothing here either, and has no line to hang the
        // mark on - so it hangs on the block, which is what `finding_at_block` is for (`ah-fvzu`).
        if !ordered_to_tax && taxes(&ordered.unit.flags, ordered.intents) {
            findings.push(ordered.finding_at_block(
                hex,
                codes::TAXED_A_PILLAGED_HEX,
                "a unit is pillaging this hex, so this TAX will collect nothing".to_string(),
            ));
        }
    }
}

/// Our units taxing or pillaging a hex a foreign unit is guarding.
///
/// One finding per affected order line, like its sibling `check_pillaged_tax`. It says **may**
/// rather than **will**: whether the guard actually blocks us turns on that faction's declared
/// attitude toward ours, which our report does not state (`ah-g7ts`).
///
/// On a `TAX` line in a hex one of our own units is also pillaging, `taxed-a-pillaged-hex` already
/// says the money is certainly gone - so this weaker restatement is suppressed there. On a
/// `PILLAGE` line both still fire: our own pillage does not stop our own pillager, but the guard
/// may.
///
/// A unit that taxes by its flag has no `TAX` line to hang the mark on, so it is marked on its
/// block instead, in the same words - but only when it has no `TAX` line of its own, so one unit
/// never reads the same sentence twice, and only in a hex nobody is pillaging, for the same reason
/// a `TAX` line is spared there (`ah-leeg`).
fn check_guarded_tax(
    hex: &Hex<'_>,
    guarded: bool,
    pillaged: bool,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !guarded || !options.emits(codes::TAXED_A_GUARDED_HEX) {
        return;
    }

    for ordered in &hex.units {
        let mut ordered_to_tax = false;
        for placed in ordered.intents {
            let order = match placed.intent {
                Intent::Tax if !pillaged => "TAX",
                Intent::Pillage => "PILLAGE",
                _ => continue,
            };
            if matches!(placed.intent, Intent::Tax) {
                ordered_to_tax = true;
            }
            findings.push(ordered.finding(
                hex,
                codes::TAXED_A_GUARDED_HEX,
                format!("a foreign unit is guarding this hex, so this {order} may collect nothing"),
                Some(placed),
            ));
        }
        // A unit that taxes by its flag collects nothing here either, and has no line to hang the
        // mark on - so it hangs on the block, which is what `finding_at_block` is for (`ah-fvzu`).
        // Suppressed in a pillaged hex for the same reason the `TAX` line is: `taxed-a-pillaged-hex`
        // already says the money is certainly gone, and `check_pillaged_tax` marks this same block
        // with it (`ah-cxxa`).
        if !pillaged && !ordered_to_tax && taxes(&ordered.unit.flags, ordered.intents) {
            findings.push(ordered.finding_at_block(
                hex,
                codes::TAXED_A_GUARDED_HEX,
                "a foreign unit is guarding this hex, so this TAX may collect nothing".to_string(),
            ));
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

/// The tax a unit collects this month, credited once per unit rather than once per `TAX` line.
///
/// A unit-level term because taxing is a property of the unit: the taxing flag makes it tax every
/// turn with no order at all, and a unit carrying both the flag and a `TAX` taxes once
/// (`ah-fvzu`). Priced by `silver::price_tax`, which `silver::forecast_unit` calls too - two
/// surfaces reading one order must not price it two ways (`ah-abwx`, and the reason `ah-ycuj`
/// exists). "PILLAGE comes before TAX", so a pillage leaves every own taxer with nothing
/// (`ah-cxxa`), and that rule lives in `price_tax` as well.
fn credit_tax(ledger: &mut Ledger<'_>, hex: &Hex<'_>, actor: &Ordered<'_>, pillaged: bool) {
    if !taxes(&actor.unit.flags, actor.intents) {
        return;
    }
    // "Each taxing character collects $50", capped by what the region has to give. Both of the
    // arguments below are this module's *accept on doubt* policy rather than oversights, and both
    // are the caller's to choose precisely because the Silver column chooses differently - see
    // `price_tax`'s doc comment.
    //
    // A region that states no tax base is not a region with nothing to give: it is one whose
    // figure we do not have, so it is read as no cap at all and the taxer is credited its full
    // ask. The column raises `SilverDoubt::UnknownTaxBase` instead, because it must show a number
    // rather than a guess. Pinned by `the_ledger_stays_optimistic_about_an_unstated_tax_base`.
    let ceiling = hex.region.tax_base.unwrap_or(i64::MAX);
    // And none of what is left goes to any *foreign* unit, nor to any own one - pinned by
    // `the_ledger_stays_optimistic_about_a_contended_tax_pool`.
    let priced = price_tax(
        actor.unit.men,
        Some(ceiling),
        pillaged,
        PoolShare::Uncontended,
    );
    debug_assert!(
        priced.doubt.is_none(),
        "the ledger's optimism leaves nothing for `price_tax` to doubt"
    );
    credit(ledger, &actor.unit.unit_id, SILVER, priced.earns);
}

/// Applies one order to the ledger.
fn apply(
    ledger: &mut Ledger<'_>,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    ruleset: Option<&Ruleset>,
    // Combat ready men this faction has in this hex - computed once per hex by the caller, because
    // this function runs for every placed intent of every unit (`ah-1ad6.2`).
    hex_combat_ready: Option<i64>,
) {
    let who = &actor.unit.unit_id;

    match &placed.intent {
        Intent::Produce { item } => produce(ledger, hex, actor, placed, item, ruleset),
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
        // Credited once per unit by `credit_tax` in `ledger_for`, not per line: a unit may tax by
        // its flag with no `TAX` order at all, and one carrying both taxes once (`ah-fvzu`).
        Intent::Tax => {}
        // Priced by `silver::price_pillage`, which `silver::forecast_unit` calls too: two surfaces
        // reading one order must not price it two ways (`ah-abwx`, and the reason `ah-ycuj`
        // exists). The two differ only in how they express the doubt - a typed variant there, the
        // unit's sums no longer trusted here.
        Intent::Pillage => {
            let priced = price_pillage(hex.region.tax_base, hex_combat_ready);
            if priced.doubt.is_some() {
                ledger.doubted.insert(who.clone());
            } else {
                credit(ledger, who, SILVER, priced.earns);
            }
        }
        Intent::Buy { amount, item } => buy(ledger, hex, actor, placed, amount, item, ruleset),
        Intent::Sell { amount, item } => sell(ledger, hex, actor, placed, amount, item, ruleset),
        Intent::Study { skill } => study(ledger, actor, placed, skill, ruleset),
        Intent::Cast { spell, arguments } => cast(ledger, actor, placed, spell, arguments, ruleset),
        // The fund pays, not the unit (`ah-tdsi`). Nothing is charged here, and an unpriceable
        // withdrawal no longer doubts the unit: what cannot be counted is the *faction's* total,
        // which is `check_claims`'s to decline on.
        Intent::Withdraw { .. } => {}
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

/// `PRODUCE <item>`: what the run costs comes off the unit's silver and its materials.
///
/// It **does not** `credit` what it makes, which is where it differs from `buy` directly above.
/// Production resolves in the month's last phase, so goods made this month cannot be spent this
/// month - and crediting them would silence a `not-enough-items` warning that should fire, because
/// the engine will refuse a `GIVE` of goods that do not exist yet. The same reading the ledger
/// already gives wages and takings from entertaining (`ah-uwa3`, `ah-19l2.2`).
fn produce(
    ledger: &mut Ledger<'_>,
    hex: &Hex<'_>,
    actor: &Ordered<'_>,
    placed: &PlacedIntent,
    item: &str,
    ruleset: Option<&Ruleset>,
) {
    let who = &actor.unit.unit_id;
    let plan = resolve_item(item, hex, actor, ruleset)
        .and_then(|tag| recipe_for(ruleset, &tag))
        .and_then(|recipe| plan_production(recipe, actor.unit.men, &actor.unit.items));
    let Some(plan) = plan else {
        // Nothing in the ruleset prices it, so this unit's month cannot be judged at all - the
        // same posture `buy` takes for goods the market does not carry.
        ledger.doubted.insert(who.clone());
        return;
    };

    charge(ledger, who, SILVER, plan.silver, placed);
    for material in &plan.materials {
        charge(ledger, who, &material.tag, material.amount, placed);
    }
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

/// A unit's silver balance as the shortfall check must read it: what the ledger holds, plus what
/// an earlier step of the payment order took back off its maintenance (steps 4-7), less what it
/// lent a faction-mate at step 4 (`ah-e66j`, `ah-fjty`).
///
/// A term added on top rather than a credit to `balance`, because `check_sailing` and
/// `check_movement` read the same ledger and must go on seeing the silver the unit actually holds.
fn silver_balance(ledger: &Ledger<'_>, unit_id: &str) -> i64 {
    balance_of(ledger, unit_id, SILVER)
        + ledger
            .upkeep_relieved
            .get(unit_id)
            .copied()
            .unwrap_or_default()
        - ledger.upkeep_lent.get(unit_id).copied().unwrap_or_default()
}

/// A balance for any tag, with step 7's relief applied where the tag is the one it can pay.
///
/// The relief is silver and only silver, so every other tag reads exactly as it did.
fn relieved_balance(ledger: &Ledger<'_>, unit_id: &str, tag: &str) -> i64 {
    if tag == SILVER {
        silver_balance(ledger, unit_id)
    } else {
        balance_of(ledger, unit_id, tag)
    }
}

/// Every unit that owes maintenance its faction-mates' silver cannot cover, across the report.
///
/// Every hex's claims, from [`unpayable_upkeep`], which reads each unit on its own balance and
/// consults no sharing at all: step 4 (`share_silver_for_upkeep`) has already done the lending for
/// real, so by the time this is asked the neighbours' silver is spent and inside the balance
/// (`ah-e66j`). This once said the function had two branches, one per reading; it has had one
/// since `ah-e66j`. The pooling rule `report_shortfalls` applies to *orders* has a single home in
/// [`Sharing::reading`] (`ah-3ddq`) - a second implementation of it here is how the column and the
/// warning drifted apart before (`ah-ycuj`).
///
/// A shared hex allocates its shortfall to its units in report order, which decides *which* of
/// several fee-owing units is named when the shortfall runs out before the fees do. That order is
/// ours rather than the engine's, and it is only ever visible in a hex whose pooled silver is
/// short by less than its units' fees between them; the total - which is what the settlement and
/// every message state - is exact either way.
fn upkeep_claims(hexes: &[(Hex<'_>, Ledger<'_>)]) -> Vec<UpkeepClaim> {
    let mut claims = Vec::new();
    for (hex, ledger) in hexes {
        claims.extend(
            unpayable_upkeep(hex, ledger)
                .into_iter()
                .map(|(unit_id, short)| UpkeepClaim { unit_id, short }),
        );
    }
    claims
}

/// What each unit in one hex owes in maintenance that its own silver cannot cover. The input to
/// step 4, then to step 5 and, once food has run, to step 7.
///
/// Every unit is read on its own balance. That is not a simplification of the hex's sharing: step 4
/// (`share_silver_for_upkeep`) does the lending for real, before anything reads a balance, so by
/// the time this is asked again the neighbours' silver is already spent and inside `silver_balance`
/// (`ah-e66j`). An earlier version of this function carried a second branch that *estimated* what a
/// `SHARE` pool would cover; two implementations of one idea is how the column and the warning
/// drifted apart before (`ah-ycuj`).
fn unpayable_upkeep(hex: &Hex<'_>, ledger: &Ledger<'_>) -> Vec<(String, i64)> {
    let mut claims = Vec::new();
    let owes = |ordered: &Ordered<'_>| -> Option<(String, i64)> {
        let who = &ordered.unit.unit_id;
        if ledger.doubted.contains(who) {
            // A unit whose sums cannot be trusted is not judged at all, here as everywhere else in
            // this module - and a guessed headcount is charged nothing to begin with.
            return None;
        }
        // What an earlier step has already paid off is no longer drawn on the balance, so it is no
        // longer maintenance's to claim: steps 5 and 6 write their relief before step 7 asks.
        let drawn = ledger.upkeep_drawn.get(who).copied().unwrap_or_default()
            - ledger.upkeep_relieved.get(who).copied().unwrap_or_default();
        let drawn = drawn.max(0);
        (drawn > 0).then(|| (who.clone(), drawn))
    };

    // Every unit is judged on its own balance, which already carries whatever step 4 lent it
    // (`silver_balance`). At most what maintenance drew is maintenance's fault, and the rest of an
    // overdraft belongs to the unit's orders: a unit holding $10, buying $350 of horses and owing
    // $40 is short $380, of which food or the fund may pay $40 and never the $340.
    for ordered in &hex.units {
        let Some((unit_id, drawn)) = owes(ordered) else {
            continue;
        };
        let overdraft = -silver_balance(ledger, &unit_id);
        let short = overdraft.min(drawn);
        if short > 0 {
            claims.push((unit_id, short));
        }
    }
    claims
}

/// Step 4 of the maintenance payment order, per hex: silver from other faction units in the same
/// region pays what a unit's own silver could not.
///
/// **Automatic and unconditional.** The `SHARE` flag governs discretionary spending only - the
/// rules share money for maintenance "automatically ... between your units in the same region",
/// and say of `SHARE` itself that funds are shared "for maintenance, but not for less important
/// purposes" (`ah-e66j`). So every own unit in the hex lends, flag or no flag.
///
/// Runs before steps 5 and 6, so a neighbour's silver is spent before anybody's grain - which is
/// the rules' own order and not a preference.
///
/// Returns what each fed unit's neighbours paid, for the column to show. A hex whose pool cannot
/// cover every claimant lends all of it anyway and returns nothing for it: the total is exact even
/// though which unit the engine feeds is not, and understating what step 4 paid would send a claim
/// to the unclaimed fund that step 4 had already met.
fn share_silver_for_upkeep(hexes: &mut [(Hex<'_>, Ledger<'_>)]) -> BTreeMap<String, i64> {
    let mut covered: BTreeMap<String, i64> = BTreeMap::new();

    for (hex, ledger) in hexes {
        let claims = unpayable_upkeep(hex, ledger);
        if claims.is_empty() {
            continue;
        }

        // Every own unit in the hex lends what it has spare. `silver_balance` is post-orders and
        // post-own-maintenance and already carries any relief written before this point, so it is
        // exactly "what this unit has spare" - which `balance_of` is not.
        let spare: Vec<(String, i64)> = hex
            .units
            .iter()
            .filter(|ordered| !ledger.doubted.contains(&ordered.unit.unit_id))
            .map(|ordered| {
                let id = ordered.unit.unit_id.clone();
                let spare = silver_balance(ledger, &id).max(0);
                (id, spare)
            })
            .collect();
        let pool: i64 = spare.iter().map(|(_, spare)| spare).sum();
        if pool <= 0 {
            // Nothing to lend, so nothing is pooled and nothing is contended: every claimant is
            // left exactly as its own balance found it.
            continue;
        }
        let needed: i64 = claims.iter().map(|(_, short)| short).sum();

        // Short of covering everybody, the whole pool is still lent - in document order over the
        // claims - and no unit's figure moves. Pessimistic, and the same posture `food_contended`
        // and `unclaimed_contended` already take.
        let short = pool < needed;
        let mut left = pool.min(needed);
        let lent = left;
        for (unit_id, claim) in &claims {
            if left <= 0 {
                break;
            }
            let relieved = (*claim).min(left);
            left -= relieved;
            *ledger.upkeep_relieved.entry(unit_id.clone()).or_default() += relieved;
            if !short {
                *covered.entry(unit_id.clone()).or_default() += relieved;
            }
        }
        if short {
            ledger.maintenance_pooled = true;
        }

        // The lenders, in document order, for exactly what the borrowers took.
        let mut owed = lent;
        for (unit_id, spare) in &spare {
            if owed <= 0 {
                break;
            }
            let taken = (*spare).min(owed);
            if taken > 0 {
                owed -= taken;
                *ledger.upkeep_lent.entry(unit_id.clone()).or_default() += taken;
            }
        }
    }

    covered
}

/// Steps 5 and 6 of the payment order, per hex, and what they leave for step 7.
///
/// Faction-wide only because it walks every hex; the food itself never leaves the hex that holds
/// it.
fn feed_from_food_after_silver(
    hexes: &mut [(Hex<'_>, Ledger<'_>)],
) -> BTreeMap<String, LateFoodRelief> {
    let mut all: BTreeMap<String, LateFoodRelief> = BTreeMap::new();
    let nothing = Receipts::default();

    for (hex, ledger) in hexes {
        let short: BTreeMap<String, i64> = unpayable_upkeep(hex, ledger).into_iter().collect();
        if short.is_empty() {
            continue;
        }

        let facts = hex_facts(hex, &nothing);
        let claims: Vec<LateFoodClaim> = hex
            .units
            .iter()
            .zip(&facts)
            .map(|(ordered, facts)| LateFoodClaim {
                unit_id: ordered.unit.unit_id.clone(),
                short: short
                    .get(&ordered.unit.unit_id)
                    .copied()
                    .unwrap_or_default(),
                own_food: food_claim(facts).spare_food,
                own_food_tag: lone_food_tag(&ordered.unit.items),
            })
            .collect();

        let pool_left = ledger.faction_food.pool_left;
        let relief = feed_after_silver(&claims, pool_left);

        for claim in &claims {
            let Some(fed) = relief.get(&claim.unit_id) else {
                continue;
            };
            // A unit a short pool might yet have fed is not warned about a fee that may not be
            // owed - which is what relieving the whole of it does, without touching any figure.
            let relieved = if fed.contended {
                claim.short
            } else {
                fed.own_covered + fed.faction_covered
            };
            if relieved > 0 {
                *ledger
                    .upkeep_relieved
                    .entry(claim.unit_id.clone())
                    .or_insert(0) += relieved;
            }
        }
        all.extend(relief);
    }
    all
}

/// The tag of a unit's food when it holds one kind of food and only one; `None` when it holds
/// several, because which items the engine eats then cannot be told.
fn lone_food_tag(items: &[ItemAmount]) -> Option<String> {
    let mut tags = items
        .iter()
        .filter(|item| {
            item.amount > 0
                && FOOD_TAGS
                    .iter()
                    .any(|tag| item.tag.eq_ignore_ascii_case(tag))
        })
        .map(|item| item.tag.to_ascii_uppercase());
    let first = tags.next()?;
    tags.all(|tag| tag == first).then_some(first)
}

/// Writes what the fund paid into each ledger, so the checks that read a balance see it.
///
/// A no-op for an inactive settlement and for one the fund could not cover, whose `covered` is
/// empty by construction.
fn apply_relief(hexes: &mut [(Hex<'_>, Ledger<'_>)], settlement: &UpkeepSettlement) {
    if settlement.covered.is_empty() {
        return;
    }
    for (hex, ledger) in hexes {
        for ordered in &hex.units {
            if let Some(covered) = settlement.covered.get(&ordered.unit.unit_id) {
                // Added, never inserted. Step 4 and steps 5-6 have both already written here, and
                // a pool that covered part of a claim hands the remainder straight to the fund -
                // so replacing would discard what an earlier step paid and invent a shortfall in a
                // hex that paid for itself (`ah-e66j`).
                *ledger
                    .upkeep_relieved
                    .entry(ordered.unit.unit_id.clone())
                    .or_default() += *covered;
            }
        }
    }
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

/// How one item tag is judged in one hex.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reading {
    /// Nothing in the hex shares, or the tag is men - which the engine never pools.
    PerUnit,
    /// Something in the hex carries `sharing`, so the tag is one purse across it.
    Pooled,
}

/// The hex's sharing units, read once, and the rule for whether a tag pools in it.
///
/// The single home of "does this hex pool this tag?". Four plans in a row have assumed a hex is
/// judged unit by unit; this is the thing they should have been able to find (`ah-3ddq`).
struct Sharing<'a> {
    /// The units carrying `sharing`, in hex order.
    sharers: Vec<&'a Ordered<'a>>,
}

impl<'a> Sharing<'a> {
    fn read(hex: &'a Hex<'a>) -> Self {
        Self {
            sharers: hex.units.iter().filter(|o| o.shares()).collect(),
        }
    }

    /// Whether the pool's sum can be trusted at all: the pool is the sharers' sum, so one sharer
    /// whose sums cannot be trusted makes the sum untrustworthy. Read once, and applied only after
    /// the per-unit pass, which must still run so a doubted sharer does not also silence a
    /// non-pooled (men) finding.
    fn pool_trusted(&self, ledger: &Ledger<'_>) -> bool {
        !self
            .sharers
            .iter()
            .any(|o| ledger.doubted.contains(&o.unit.unit_id))
    }

    /// `Pooled` only when something shares AND the tag is not men.
    ///
    /// Without a ruleset every tag pools; with one, men never do (the engine's one exception).
    ///
    /// Maintenance is **not** pooled here, even though `ah-e66j` made sharing it automatic: this
    /// pool is what a `SHARE` flag lends for *orders*, and folding a hex's maintenance into it
    /// would put a unit's overspending on a purse the rules never open for it. The maintenance
    /// shortfall of an unflagged hex is collected separately.
    fn reading(&self, tag: &str, ruleset: Option<&Ruleset>) -> Reading {
        if !self.sharers.is_empty() && !ruleset.is_some_and(|ruleset| ruleset.is_man(tag)) {
            Reading::Pooled
        } else {
            Reading::PerUnit
        }
    }

    /// The pool's balance for one tag: the sharers' `relieved_balance`s, summed.
    fn pool(&self, ledger: &Ledger<'_>, tag: &str) -> i64 {
        self.sharers
            .iter()
            .map(|o| relieved_balance(ledger, &o.unit.unit_id, tag))
            .sum()
    }
}

/// What the shortfall pass decided about one unit and one item tag.
///
/// Every negative balance produces exactly one of these, so a test can assert *which* reading a
/// hex used rather than inferring it from whether a message appeared (`ah-3ddq`).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Verdict {
    /// Judged on the unit's own balance, and short. Anchored to the unit and its order line.
    UnitShort {
        unit_id: String,
        tag: String,
        short: i64,
    },
    /// The tag pools in this hex, so this overdraft is a claim against the pool rather than a
    /// finding of its own. A sharer's own overdraft is already inside the pool's sum and claims
    /// nothing (`claims_pool: false`).
    DeferredToPool {
        unit_id: String,
        tag: String,
        short: i64,
        claims_pool: bool,
    },
    /// Silver, in an unflagged hex, whose whole overdraft is maintenance nothing could pay. The
    /// unit is not named in the message: it may well be one the engine feeds (`ah-e66j`).
    DeferredToMaintenance { unit_id: String, short: i64 },
}

/// Every verdict this hex reaches, in hex order and then tag order.
///
/// Reaches no decision about messages and emits nothing: `report_shortfalls` renders it. Doubted
/// units produce no verdict at all, here as everywhere else in this module - not a verdict saying
/// "doubted".
///
/// Takes no [`CheckOptions`]: a disabled code still puts a tag up for pooled judgement and still
/// adds to the maintenance shortfall today, because the `emits` test sits *after* the branches
/// that do both. Filtering here would quietly change which hexes report a pooled shortfall.
fn judge_shortfalls(
    hex: &Hex<'_>,
    ledger: &Ledger<'_>,
    sharing: &Sharing<'_>,
    ruleset: Option<&Ruleset>,
) -> Vec<Verdict> {
    let mut verdicts = Vec::new();

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

        let mine: Vec<(String, String, i64)> = mine
            .map(|((unit_id, tag), _)| {
                let balance = relieved_balance(ledger, unit_id, tag);
                (unit_id.clone(), tag.clone(), balance)
            })
            .collect();

        for (unit_id, tag, balance) in &mine {
            let (unit_id, tag, balance) = (unit_id, tag, *balance);
            if balance >= 0 {
                continue;
            }
            let short = -balance;

            if sharing.reading(tag, ruleset) == Reading::Pooled {
                verdicts.push(Verdict::DeferredToPool {
                    unit_id: unit_id.clone(),
                    tag: tag.clone(),
                    short,
                    // A sharer's own overdraft is already inside the pool's sum, so it claims
                    // nothing against it - but its tag still goes up for judgement.
                    claims_pool: !ordered.shares(),
                });
                continue;
            }

            // A unit whose overdraft is *entirely* the maintenance an unflagged hex could not pay
            // between its units is not named: it may well be one the engine feeds. One that also
            // overspends on its orders keeps its own finding, its line and its name, because
            // nothing shared that silver for it (`ah-e66j`).
            if tag == SILVER && ledger.maintenance_pooled && short <= unpaid_upkeep(ledger, who) {
                verdicts.push(Verdict::DeferredToMaintenance {
                    unit_id: unit_id.clone(),
                    short,
                });
                continue;
            }

            verdicts.push(Verdict::UnitShort {
                unit_id: unit_id.clone(),
                tag: tag.clone(),
                short,
            });
        }
    }

    verdicts
}

/// What a pooled tag owes once its claims are netted against its pool, or nothing at all when the
/// pool covers them. `held` is what the pool's members and its borrowers hold, for the message.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PoolShortfall {
    tag: String,
    short: i64,
    held: i64,
}

/// The pooled tags this hex is short of, from the `DeferredToPool` verdicts.
///
/// Returns nothing at all when the pool is not trusted: one doubted sharer silences every pooled
/// tag. Tags come out alphabetical, which is the order the messages have always been pushed in -
/// `pooled_tags` was a `BTreeSet<String>` and a `Vec` here would reorder a hex short of two tags
/// at once.
fn pool_shortfalls(
    hex: &Hex<'_>,
    ledger: &Ledger<'_>,
    sharing: &Sharing<'_>,
    verdicts: &[Verdict],
) -> Vec<PoolShortfall> {
    if !sharing.pool_trusted(ledger) {
        return Vec::new();
    }

    // tag -> the overdrafts of the units that must borrow it (non-sharers; a sharer's own
    // overdraft is already inside the pool's sum, not a claim against it).
    let mut claims: BTreeMap<String, i64> = BTreeMap::new();
    // Every pooled tag any unit is short of, so the pass below knows what to judge.
    let mut pooled_tags: BTreeSet<String> = BTreeSet::new();
    for verdict in verdicts {
        let Verdict::DeferredToPool {
            tag,
            short,
            claims_pool,
            ..
        } = verdict
        else {
            continue;
        };
        pooled_tags.insert(tag.clone());
        if *claims_pool {
            *claims.entry(tag.clone()).or_insert(0) += short;
        }
    }

    let mut shortfalls = Vec::new();
    for tag in pooled_tags {
        let short = claims.get(&tag).copied().unwrap_or(0) - sharing.pool(ledger, &tag);
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
                        && relieved_balance(ledger, &o.unit.unit_id, &tag) < 0)
            })
            .map(|o| o.holding(&tag))
            .sum();

        shortfalls.push(PoolShortfall { tag, short, held });
    }
    shortfalls
}

/// Silver and items a unit is short of, and what the hex's sharing units can cover for it.
///
/// The engine's `Unit::GetSharedNum` counts a unit's own holdings plus every same-faction unit in
/// the region carrying `FLAG_SHARING` - the borrower's own flag is never consulted, and every tag
/// but men (`IT_MAN`) is eligible. `DoGiveOrder`/`DoSell` draw on it for items,
/// `DoBuy`/`Do1StudyOrder` through `GetSharedMoney` for silver. Without a ruleset there is no
/// catalogue to tell men from anything else, so every tag pools - see [`Sharing::reading`],
/// which is the one home of that rule.
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
    plurals: &Plurals,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    let sharing = Sharing::read(hex);

    // What the hex owes in maintenance that nothing in it could pay, gathered across the units
    // whose whole overdraft is that fee. Which of them the engine actually leaves unpaid cannot be
    // told - sharing for maintenance is automatic and drains the hex in the engine's own order - so
    // they are reported once, against the hex (`ah-e66j`, round 1 question 3).
    let mut maintenance_short: i64 = 0;

    let verdicts = judge_shortfalls(hex, ledger, &sharing, ruleset);

    for verdict in &verdicts {
        let (unit_id, tag, short) = match verdict {
            // Judged by `pool_shortfalls` below, against the hex rather than the unit.
            Verdict::DeferredToPool { .. } => continue,
            Verdict::DeferredToMaintenance { short, .. } => {
                maintenance_short += short;
                continue;
            }
            Verdict::UnitShort {
                unit_id,
                tag,
                short,
            } => (unit_id, tag, *short),
        };

        let code = if tag == SILVER {
            codes::NOT_ENOUGH_SILVER
        } else {
            codes::NOT_ENOUGH_ITEMS
        };
        if !options.emits(code) {
            continue;
        }

        let Some(ordered) = hex.find(unit_id) else {
            continue;
        };
        let at = ledger.charged_at.get(&(unit_id.clone(), tag.clone()));
        let finding = if tag == SILVER {
            ordered.finding(
                hex,
                codes::NOT_ENOUGH_SILVER,
                format!(
                    "short ${short}: this unit can have ${} and its {} spend ${}",
                    ordered.holding(SILVER),
                    spenders(upkeep_still_drawn(ledger, unit_id)),
                    ordered.holding(SILVER) + short,
                ),
                at,
            )
        } else {
            let short_of = counted_item(short, tag, hex, ruleset, plurals);
            ordered.finding(
                hex,
                codes::NOT_ENOUGH_ITEMS,
                format!(
                    "short {short_of}: this unit can have {} and its orders spend {}",
                    ordered.holding(tag),
                    ordered.holding(tag) + short,
                ),
                at,
            )
        };
        findings.push(finding);
    }

    for PoolShortfall { tag, short, held } in pool_shortfalls(hex, ledger, &sharing, &verdicts) {
        let code = if tag == SILVER {
            codes::NOT_ENOUGH_SILVER
        } else {
            codes::NOT_ENOUGH_ITEMS
        };
        if !options.emits(code) {
            continue;
        }

        let message = if tag == SILVER {
            let owed: i64 = hex
                .units
                .iter()
                .map(|o| upkeep_still_drawn(ledger, &o.unit.unit_id))
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
            let short_of = counted_item(short, &tag, hex, ruleset, plurals);
            format!(
                "the units in this hex are short {short_of} between them: they can have \
                 {held} and their orders spend {}",
                held + short,
            )
        };
        findings.push(hex.finding(code, message));
    }

    // One mark for the hex, and only for its maintenance: an unflagged hex pools nothing else, so
    // the sentence names upkeep and nothing else either (`ah-e66j`, round 2 question 2). `costs`
    // rather than `spend`, because a fee is charged whatever a unit is told to do - telling a
    // player their orders spend it sends them looking through orders that spend nothing
    // (`ah-1wcw.4`).
    //
    // The fees are every non-doubted unit's, and what the hex "can have" is the part of them it
    // covered - so the arithmetic holds whatever else the hex's orders spent, which a figure taken
    // from holdings does not.
    if maintenance_short > 0 && options.emits(codes::NOT_ENOUGH_SILVER) {
        let owed: i64 = hex
            .units
            .iter()
            .filter(|o| !ledger.doubted.contains(&o.unit.unit_id))
            .map(|o| {
                ledger
                    .upkeep
                    .get(&o.unit.unit_id)
                    .copied()
                    .unwrap_or_default()
            })
            .sum();
        findings.push(hex.finding(
            codes::NOT_ENOUGH_SILVER,
            format!(
                "the units in this hex are short ${maintenance_short} of upkeep between them: \
                 they can have ${} and their upkeep costs ${owed}",
                owed - maintenance_short,
            ),
        ));
    }
}

/// The maintenance a unit is left paying, once the faction's unclaimed fund has taken its share.
///
/// The fee a message may blame, rather than the fee that was charged: a unit whose whole fee the
/// fund paid but whose orders still overspend must be told that its *orders* spend the silver, or
/// the sentence's own arithmetic does not add up (`ah-fjty`).
/// What maintenance is still taking off this unit's silver: what it actually drew, less what an
/// earlier step of the payment order has already paid back.
///
/// Different from [`unpaid_upkeep`], which is the whole fee less the relief and answers a different
/// question - whether an overdraft is maintenance's doing. This one words the message, and a
/// message must not name an upkeep that spent none of the unit's silver: since `ah-gjq4` an idle
/// unit's own wages pay its fee, exactly as an explicit `WORK`'s already did, and saying "its
/// orders and upkeep spend" of a unit whose wages paid the fee sends the reader looking for a
/// charge that is not there - the same reasoning `ah-1wcw.4` and `ah-fjty` applied to the fund.
fn upkeep_still_drawn(ledger: &Ledger<'_>, unit_id: &str) -> i64 {
    let drawn = ledger
        .upkeep_drawn
        .get(unit_id)
        .copied()
        .unwrap_or_default();
    let relieved = ledger
        .upkeep_relieved
        .get(unit_id)
        .copied()
        .unwrap_or_default();
    (drawn - relieved).max(0)
}

fn unpaid_upkeep(ledger: &Ledger<'_>, unit_id: &str) -> i64 {
    let fee = ledger.upkeep.get(unit_id).copied().unwrap_or_default();
    let paid = ledger
        .upkeep_relieved
        .get(unit_id)
        .copied()
        .unwrap_or_default();
    (fee - paid).max(0)
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

/// Every item's plural, as the report itself writes it.
///
/// Keyed by upper-case tag. Built from every unit line in the report that shows **more than one**
/// of something: `5 horses [HORS]` is the engine's own plural, which is why this beats any rule -
/// `amulets of protection` and `books of exorcism` are not what adding an `s` produces, and
/// `10 grain` is what an invariant noun looks like rather than a missing plural.
///
/// A tag is absent when nobody in the report holds more than one of it.
type Plurals = BTreeMap<String, String>;

/// Reads the plural of every item any unit in the report holds more than one of.
///
/// **The whole report, not one hex**, and deliberately: the unit a message is about is often the
/// one that has *too few* of the thing - `short 5 horses` is said of a unit holding none - so the
/// hex it stands in is exactly where the evidence tends not to be. Built once in `review_turn`
/// and passed down, rather than scanned per message.
///
/// Every unit the report shows, ours and foreign alike: a foreign unit's inventory is as good a
/// dictionary as ours, and nothing is read from it but a noun. Where two units disagree about a
/// tag's plural the first by document order stands - it does not arise on the committed corpus,
/// and a stable answer matters more than which of the two it is.
fn plurals_in(report: &ParsedReport) -> Plurals {
    let mut plurals = Plurals::new();
    for item in report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .flat_map(|unit| unit.items.iter())
        .filter(|item| item.amount > 1)
    {
        plurals
            .entry(item.tag.to_ascii_uppercase())
            .or_insert_with(|| item.name.clone());
    }
    plurals
}

/// A count and an item's name, agreeing in number: `1 horse`, `5 horses`, `10 grain`.
///
/// The acceptance criterion `ah-rsdz` was filed for: the rule lives here and nowhere else, so a
/// message added later inherits it by using this instead of [`item_name`].
///
/// A count of 1 takes the ruleset's singular - the catalogue is always present, and the table only
/// ever holds plurals. Any other count, 0 included (`0 horses` is what English does), takes the
/// plural, falling back to the singular where the report never showed one. The fallback is never
/// an invented `-s`: 84 of the 114 items the corpus shows with a count above one pluralise
/// irregularly, and 30 do not pluralise at all.
fn counted_item(
    count: i64,
    tag: &str,
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    plurals: &Plurals,
) -> String {
    if count == 1 {
        return format!("1 {}", item_name(tag, hex, ruleset));
    }
    let name = plurals
        .get(&tag.to_ascii_uppercase())
        .cloned()
        .unwrap_or_else(|| item_name(tag, hex, ruleset));
    format!("{count} {name}")
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

/// A `PILLAGE` by a faction without the combat ready men the region needs (`ah-1ad6.2`).
///
/// One finding per pillaging unit, on that unit's `PILLAGE` line, rather than one per hex: the
/// finding hangs on an order, and each pillaging unit wrote its own.
///
/// Silent where the tax base or the headcount is unknown. The Silver column already shows `?`
/// there, and a mark would be a second and louder claim about something nobody knows.
fn check_pillage_men(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::PILLAGE_WITHOUT_MEN) {
        return;
    }
    let Some(tax_base) = hex.region.tax_base else {
        return;
    };
    let Some(ready) = combat_ready_in(hex, ruleset) else {
        return;
    };
    let needed = pillage_threshold(tax_base);
    if ready >= needed {
        return;
    }

    for ordered in &hex.units {
        // One warning per unit, on the first PILLAGE in the block, as the BUILD checks do.
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Pillage))
        else {
            continue;
        };
        findings.push(ordered.finding(
            hex,
            codes::PILLAGE_WITHOUT_MEN,
            format!(
                "cannot pillage here: needs {needed} combat ready men, this faction has {ready}"
            ),
            Some(placed),
        ));
    }
}

/// Both ways a `PRODUCE` order makes nothing: the unit cannot make the item anywhere, or not here.
///
/// Two codes rather than one because they are separately toggleable and separately true, and a
/// unit that fails both gets both marks - the navigator's choice, 2026-08-23: suppressing one must
/// never silently hide the other, and a player who fixed only the region would move a unit that
/// still cannot do the job when it arrives.
///
/// Unlike `check_build_skill` there is no whole-catalogue gate to add beside the ruleset one: a
/// ruleset carrying no recipes answers `None` from [`producing_skill`] for every item, which the
/// loop below already reads as the "no skill produces it" sentence rather than as silence.
fn check_production(
    hex: &Hex<'_>,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    let Some(ruleset) = ruleset else { return };
    let says_skill = options.emits(codes::PRODUCE_WITHOUT_SKILL);
    let says_here = options.emits(codes::PRODUCE_NOT_HERE);
    if !says_skill && !says_here {
        return;
    }

    for ordered in &hex.units {
        // One warning per unit, on the first PRODUCE in the block, as the BUILD checks do. A
        // PRODUCE is month-long, so a unit has at most one that matters anyway.
        let Some(placed) = ordered
            .intents
            .iter()
            .find(|placed| matches!(placed.intent, Intent::Produce { .. }))
        else {
            continue;
        };
        let Intent::Produce { item } = &placed.intent else {
            continue;
        };

        // The catalogue's own name where it knows the item - "catapult", not the "CATP" or the
        // "catapults" the player may have typed. Nothing is pluralised here: how it is said is the
        // interface's business.
        let label = ruleset
            .find_item(item)
            .map_or_else(|| item.to_lowercase(), |entry| entry.name.clone());

        let recipe = resolve_item(item, hex, ordered, Some(ruleset))
            .and_then(|tag| producing_skill(ruleset, &tag, ordered).map(|found| (tag, found)));
        let Some((tag, (skill, recipe))) = recipe else {
            // The item resolves to nothing, or nothing in the game produces it. Either way the
            // month is wasted, so this is a sentence rather than silence.
            if says_skill {
                findings.push(ordered.finding(
                    hex,
                    codes::PRODUCE_WITHOUT_SKILL,
                    format!("cannot produce {label}: no skill produces it"),
                    Some(placed),
                ));
            }
            continue;
        };

        if says_skill {
            // `skill_level` answers 0 for a skill the unit has not got, which makes the comparison
            // uniform - the *message* still has to tell the two apart.
            let held = i64::from(ordered.skill_level(&skill.tag));
            let required = i64::from(recipe.level);
            if held < required {
                let name = &skill.name;
                let shortfall = if held == 0 {
                    format!("has no {name}")
                } else {
                    format!("has {name} {held}")
                };
                findings.push(ordered.finding(
                    hex,
                    codes::PRODUCE_WITHOUT_SKILL,
                    format!("cannot produce {label}: needs {name} {required}, {shortfall}"),
                    Some(placed),
                ));
            }
        }

        // Only a recipe with no material inputs comes from the hex itself. A sword is made *from*
        // iron and can be made wherever there is iron to hand, so running this on it would mark
        // every `@produce sword` in the game; a unit short of the iron is `not-enough-items`.
        if says_here && recipe.inputs.is_empty() {
            let products = &hex.region.products;
            if !products
                .iter()
                .any(|product| product.tag.eq_ignore_ascii_case(&tag))
            {
                let names: Vec<String> = products
                    .iter()
                    .map(|product| product.name.clone())
                    .collect();
                let has = if names.is_empty() {
                    "nothing".to_string()
                } else {
                    in_a_list(&names)
                };
                findings.push(ordered.finding(
                    hex,
                    codes::PRODUCE_NOT_HERE,
                    format!("cannot produce {label} here: this region produces {has}"),
                    Some(placed),
                ));
            }
        }
    }
}

/// The skill that makes an item tag, and the recipe by which it makes it.
///
/// [`crate::orders::silver::recipe_for`] answers the recipe alone, which is all the ledger needs;
/// here the message has to name the skill too, and both surfaces must agree on which recipe, so
/// this is that lookup extended rather than a second one.
///
/// Which skill, when more than one produces the same tag: the one the unit already has, if any
/// does; otherwise the one needing the lowest level; ties broken alphabetically by tag, which the
/// `BTreeMap`'s own order gives. Deterministic on purpose - a message that changed with map
/// iteration order would flake a test months later.
fn producing_skill<'a>(
    ruleset: &'a Ruleset,
    tag: &str,
    ordered: &Ordered<'_>,
) -> Option<(&'a SkillEntry, &'a Production)> {
    let candidates: Vec<(&SkillEntry, &Production)> = ruleset
        .skills
        .values()
        .flat_map(|skill| {
            skill
                .produces
                .iter()
                .filter(|recipe| recipe.tag.eq_ignore_ascii_case(tag))
                .map(move |recipe| (skill, recipe))
        })
        .collect();

    candidates
        .iter()
        .find(|(skill, _)| ordered.skill_level(&skill.tag) > 0)
        .or_else(|| candidates.iter().min_by_key(|(_, recipe)| recipe.level))
        .copied()
}

/// `a`, `a and b`, `a, b and c` - the shape `namesInAList` already uses in the interface.
fn in_a_list(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [only] => only.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
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
        // A unit set to tax every turn spends its month doing so, with no order in this turn's
        // orders to say it - and no order the player could add would satisfy this advice, since a
        // `TAX` would be redundant (`ah-fvzu`). The same reasoning `ah-udff` used for a unit with
        // no men. `spends_the_month` takes an `&Intent` and a flagged unit has no intent at all,
        // so the exemption belongs here rather than there.
        if taxes(&ordered.unit.flags, ordered.intents) {
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
    check_claims(report, ordered, ruleset, options, findings);
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
            // A unit taxing by its flag taxes this region with no `TAX` line to find, so the
            // region counts against the allowance like any other (`ah-fvzu`).
            if taxes(&unit.flags, ordered.intents_of(&unit.unit_id)) {
                taxing.insert(region_id);
            }
            for placed in ordered.intents_of(&unit.unit_id) {
                match &placed.intent {
                    // Both shapes a PRODUCE order can take: one naming what it makes
                    // (`ah-19l2.2`) and one that named nothing readable.
                    Intent::Produce { .. } | Intent::MonthLong("PRODUCE") => {
                        producing.insert(region_id);
                        let earlier = first_produce
                            .as_ref()
                            .is_none_or(|(_, _, first)| placed.line < first.line);
                        if earlier {
                            first_produce = Some((region_id, unit.unit_id.as_str(), placed));
                        }
                    }
                    // Counted once per unit above, flag or order alike.
                    Intent::Tax => {}
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

/// Every unit that owes maintenance it cannot pay, when the faction's unclaimed fund cannot cover
/// them all between them.
///
/// Faction-wide rather than per hex, because the fund is: what one hex's units eat is what another
/// hex's cannot. Every claimant is named and the message states the total, so a unit reading it is
/// not being blamed for a shortfall that is the faction's - the same reasoning
/// `claims-exceed-unclaimed` gives for naming every claiming unit.
///
/// The finding carries no line: maintenance belongs to no order, so there is nothing to point at.
/// Per-hex sorting already puts a line-less finding last within its hex, which is where it belongs.
fn check_upkeep_fund(
    report: &ParsedReport,
    settlement: &UpkeepSettlement,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::UPKEEP_EXCEEDS_UNCLAIMED) {
        return;
    }
    // `short > 0` already implies the settlement is active: nothing can be short of a fund that
    // was never in play.
    if settlement.short <= 0 {
        return;
    }

    let message = format!(
        "your units owe ${} of upkeep they cannot pay and the faction has ${} unclaimed",
        settlement.owed, settlement.available
    );

    for unit in report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.own && settlement.claimants.contains(&unit.unit_id))
    {
        findings.push(Finding {
            code: codes::UPKEEP_EXCEEDS_UNCLAIMED,
            message: message.clone(),
            region_id: unit.region_id.clone(),
            unit_id: Some(unit.unit_id.clone()),
            line: None,
            column_start: None,
            column_end: None,
        });
    }
}

/// What this month's orders ask of the faction's unclaimed fund: every `CLAIM` amount, plus every
/// `WITHDRAW`'s price from the ruleset.
///
/// `CLAIM` resolves during the month and maintenance is settled at its end, so this comes off the
/// unclaimed fund before step 7 of the payment order sees it (`ah-fjty`). Shared with
/// `check_claims` rather than summed twice, so the fund cannot be spent differently by two pieces
/// of code that disagree.
///
/// `None` when any withdrawal cannot be priced - no ruleset, or an item the catalogue carries no
/// `withdraw_cost` for. That is not zero and must not be treated as zero: the total is genuinely
/// unknown, and both callers decline rather than guess (`ah-tdsi`, following `check_claims`'s own
/// rule for a report that states no fund at all).
///
/// Priced against the ruleset's catalogue by the order's own item text, because at faction scope
/// there is no hex and no actor for `resolve_item` to search the inventories of.
fn total_drawn_from_fund(
    report: &ParsedReport,
    ordered: &OrderedUnits,
    ruleset: Option<&Ruleset>,
) -> Option<i64> {
    report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.own)
        .flat_map(|unit| ordered.intents_of(&unit.unit_id).iter())
        .try_fold(0i64, |total, placed| match &placed.intent {
            Intent::Claim(amount) => Some(total.saturating_add(*amount)),
            Intent::Withdraw { count, item } => {
                let cost = withdrawal_cost(item, ruleset)?;
                Some(total.saturating_add(count.saturating_mul(cost)))
            }
            _ => Some(total),
        })
}

/// What the ruleset says one of `item` costs to withdraw, or `None` where it says nothing.
fn withdrawal_cost(item: &str, ruleset: Option<&Ruleset>) -> Option<i64> {
    ruleset?.find_item(item)?.withdraw_cost
}

/// Own units in one hex promised more of a region's pool than it holds.
///
/// Per hex, because the pools are: a tax base belongs to the region, unlike the faction purse that
/// `claims-exceed-unclaimed` guards.
///
/// Every claimant is named, on its own order line, each carrying the same total - `ah-wur4`'s
/// reasoning, and its words: none of them is more at fault than the others, and a message stating
/// the total means a unit reading it is not being blamed for the overrun on its own.
fn check_region_pools(
    hex: &Hex<'_>,
    overruns: &[PoolOverrun],
    ruleset: Option<&Ruleset>,
    plurals: &Plurals,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::REGION_POOL_OVERSUBSCRIBED) {
        return;
    }

    for overrun in overruns {
        let PoolOverrun {
            pool,
            wanted,
            available,
            claimants,
        } = overrun;

        // `ah-t2pn.1`'s rule 1 leaves a lone claimant on a silver pool uncontended, so it can
        // never be settled and never overrun. Inventing a singular sentence for one would hide a
        // real defect in the settlement behind a plausible message. A market is different:
        // `ah-t2pn.3` settles one for a lone trader too, which is what caps a unit ordering
        // `BUY 200` where 100 exist - so that case has a sentence of its own.
        let alone = claimants.len() < 2;
        debug_assert!(
            !alone || matches!(pool, ContendedPool::Market { .. }),
            "a silver pool cannot be oversubscribed by one unit: {overrun:?}"
        );

        let message = match pool {
            ContendedPool::Tax if !alone => format!(
                "your units here tax for ${wanted} between them and this region has ${available}"
            ),
            ContendedPool::Wages if !alone => format!(
                "your units here work for ${wanted} between them and this region pays ${available}"
            ),
            ContendedPool::Entertainment if !alone => format!(
                "your units here entertain for ${wanted} between them and this region pays ${available}"
            ),
            // A market line is stated in what it trades, so the sentence is too - as
            // `not-traded-here` already speaks about a market in its own terms, and unlike the
            // silver pools above there is no `$`.
            ContendedPool::Market { tag, side } => {
                // The noun agrees with what is *wanted*, never with what is available: the two
                // differ in number exactly when the sentence is worth reading (`ah-rsdz`).
                // Lowercasing the whole thing is what this site already did to the name alone -
                // a leading digit is unaffected by it.
                let goods = counted_item(*wanted, tag, hex, ruleset, plurals).to_lowercase();
                match (side, alone) {
                    (MarketSide::Selling, false) => format!(
                        "your units here sell {goods} between them and this market wants {available}"
                    ),
                    (MarketSide::Buying, false) => format!(
                        "your units here buy {goods} between them and this market has {available}"
                    ),
                    (MarketSide::Selling, true) => {
                        format!("this unit sells {goods} and this market wants {available}")
                    }
                    (MarketSide::Buying, true) => {
                        format!("this unit buys {goods} and this market has {available}")
                    }
                }
            }
            // A lone claimant on a silver pool, which the assertion above calls a bug: emitting
            // nothing in release is the safe answer.
            _ => continue,
        };

        for index in claimants {
            let Some(ordered) = hex.units.get(*index) else {
                continue;
            };
            // The unit's own line for this pool, so the finding can be clicked to the order it is
            // about - the first placement of the relevant intent, as `check_claims` anchors per
            // placement.
            let at = ordered.intents.iter().find(|placed| match pool {
                ContendedPool::Tax => matches!(placed.intent, Intent::Tax),
                ContendedPool::Wages => matches!(placed.intent, Intent::Work),
                ContendedPool::Entertainment => matches!(placed.intent, Intent::Entertain),
                ContendedPool::Market { tag, side } => match (&placed.intent, side) {
                    (Intent::Sell { item, .. }, MarketSide::Selling)
                    | (Intent::Buy { item, .. }, MarketSide::Buying) => {
                        resolve_item(item, hex, ordered, ruleset)
                            .is_some_and(|resolved| resolved.eq_ignore_ascii_case(tag))
                    }
                    _ => false,
                },
            });
            findings.push(ordered.finding(
                hex,
                codes::REGION_POOL_OVERSUBSCRIBED,
                message.clone(),
                at,
            ));
        }
    }
}

/// Every unit that claims or withdraws, when the faction's units ask more of the unclaimed fund
/// between them than it holds. Two orders draw on the one fund (`ah-tdsi`).
///
/// Faction-wide rather than per hex: the purse is one pool for the whole report, and a claim in one
/// hex spends what a claim in another cannot. Every claiming unit is named because none of them is
/// more at fault than the others - the message says the total, so a unit reading it is not being
/// blamed for the overrun on its own.
///
/// A report that states no purse does not fire the check at all. That is a decision rather than a
/// guard: a faction with no stated `Unclaimed silver:` is not evidence of an empty purse, and
/// treating absence as zero would warn about every claim in any report whose header the parser did
/// not read. `ah-bumi` counts a claim as written in exactly that case, for the same reason.
fn check_claims(
    report: &ParsedReport,
    ordered: &OrderedUnits,
    ruleset: Option<&Ruleset>,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) {
    if !options.emits(codes::CLAIMS_EXCEED_UNCLAIMED) {
        return;
    }

    let Some(purse) = report.header.unclaimed_silver else {
        return;
    };

    // Placed intents rather than units: a unit with two CLAIM lines contributes both to the total
    // and is warned on each, and each line is separately editable.
    let claims: Vec<(&ReportUnit, &PlacedIntent)> = report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.own)
        .flat_map(|unit| {
            ordered
                .intents_of(&unit.unit_id)
                .iter()
                .filter(|placed| {
                    matches!(placed.intent, Intent::Claim(_) | Intent::Withdraw { .. })
                })
                .map(move |placed| (unit, placed))
        })
        .collect();

    let Some(total) = total_drawn_from_fund(report, ordered, ruleset) else {
        return;
    };

    if total <= purse {
        return;
    }

    for (unit, placed) in claims {
        findings.push(Finding {
            code: codes::CLAIMS_EXCEED_UNCLAIMED,
            message: format!(
                "your units claim and withdraw ${total} between them and the faction has ${purse}"
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

    /// `ah-rsdz`. A count and an item name have to agree in number, and the plural comes from the
    /// report's own item lines rather than from any rule: 84 of the 114 items the corpus shows
    /// with a count above one pluralise irregularly, and 30 do not pluralise at all.
    mod plural_names {
        use super::*;

        fn holding(id: &str, amount: i64, name: &str, tag: &str) -> ReportUnit {
            with_item(unit(id), amount, name, tag)
        }

        fn plural_of(tag: &str, units: Vec<ReportUnit>) -> Option<String> {
            plurals_in(&report(vec![region(units)])).get(tag).cloned()
        }

        #[test]
        fn reads_a_plural_from_a_unit_that_holds_more_than_one() {
            assert_eq!(
                plural_of("HORS", vec![holding("2390", 5, "horses", "HORS")]).as_deref(),
                Some("horses")
            );
        }

        #[test]
        fn ignores_a_unit_that_holds_exactly_one() {
            assert_eq!(
                plural_of("HORS", vec![holding("2390", 1, "horse", "HORS")]),
                None
            );
        }

        /// The test the whole bead exists for: no rule produces `amulets of protection`.
        #[test]
        fn reads_an_irregular_plural_as_the_report_writes_it() {
            assert_eq!(
                plural_of(
                    "AMPR",
                    vec![holding("2390", 3, "amulets of protection", "AMPR")]
                )
                .as_deref(),
                Some("amulets of protection")
            );
        }

        #[test]
        fn reads_an_invariant_noun_unchanged() {
            assert_eq!(
                plural_of("GRAI", vec![holding("2390", 10, "grain", "GRAI")]).as_deref(),
                Some("grain")
            );
        }

        /// A foreign unit's inventory is as good a dictionary as ours, and nothing is read from it
        /// but a noun.
        #[test]
        fn reads_a_foreign_units_inventory_too() {
            let mut theirs = holding("14", 4, "books of exorcism", "BOOK");
            theirs.own = false;
            assert_eq!(
                plural_of("BOOK", vec![theirs]).as_deref(),
                Some("books of exorcism")
            );
        }

        fn counted(count: i64, tag: &str, plurals: &Plurals) -> String {
            let region = region(vec![]);
            let ordered = OrderedUnits::read("");
            let hex = Hex::read(&region, &ordered);
            counted_item(count, tag, &hex, Some(&ruleset()), plurals)
        }

        fn table(tag: &str, plural: &str) -> Plurals {
            let mut plurals = Plurals::new();
            plurals.insert(tag.to_string(), plural.to_string());
            plurals
        }

        /// The catalogue's singular, not the table's - the table only ever holds plurals.
        #[test]
        fn one_reads_singular() {
            assert_eq!(counted(1, "HORS", &table("HORS", "horses")), "1 horse");
        }

        #[test]
        fn many_reads_plural() {
            assert_eq!(counted(5, "HORS", &table("HORS", "horses")), "5 horses");
        }

        /// Today's behaviour, for the residue only: wrong, but never invented.
        #[test]
        fn an_unknown_plural_falls_back() {
            assert_eq!(counted(5, "HORS", &Plurals::new()), "5 horse");
        }

        #[test]
        fn an_invariant_noun_does_not_gain_an_s() {
            assert_eq!(counted(10, "GRAI", &table("GRAI", "grain")), "10 grain");
        }
        // --- the messages that pair a count with a name ---------------------------------------

        /// A unit holding several of something, so the report states the plural somewhere - the
        /// unit a message is about is usually the one that has too few of the thing.
        fn dictionary(id: &str, amount: i64, plural: &str, tag: &str) -> ReportUnit {
            with_item(unit(id), amount, plural, tag)
        }

        #[test]
        fn a_shortfall_of_several_reads_plural() {
            let regions = vec![region(vec![
                unit("5"),
                dictionary("7", 3, "swords", "SWOR"),
            ])];
            let finding = only(check_ignoring_transfer_targets(
                regions,
                "unit 5\nGIVE 9 5 swords\n",
            ));
            assert_eq!(
                finding.message,
                "short 5 swords: this unit can have 0 and its orders spend 5"
            );
        }

        #[test]
        fn a_shortfall_of_one_reads_singular() {
            let regions = vec![region(vec![
                unit("5"),
                dictionary("7", 3, "swords", "SWOR"),
            ])];
            let finding = only(check_ignoring_transfer_targets(
                regions,
                "unit 5\nGIVE 9 1 sword\n",
            ));
            assert_eq!(
                finding.message,
                "short 1 sword: this unit can have 0 and its orders spend 1"
            );
        }

        #[test]
        fn a_hex_shortfall_of_several_reads_plural() {
            let regions = vec![region(vec![
                unit("5"),
                sharing(with_item(unit("7"), 20, "swords", "SWOR")),
            ])];
            let finding = only(check_ignoring_transfer_targets(
                regions,
                "unit 5\nGIVE 9 30 swords\n",
            ));
            assert_eq!(
                finding.message,
                "the units in this hex are short 10 swords between them: they can have 20 \
                 and their orders spend 30"
            );
        }

        /// The noun agrees with what is wanted, never with what is available - invisible until the
        /// two differ in number.
        #[test]
        fn the_market_sentences_agree_in_number() {
            let hex = ReportRegion {
                for_sale: vec![MarketItem {
                    amount: 1,
                    name: "horse".to_string(),
                    tag: "HORS".to_string(),
                    price: 50,
                }],
                ..region(vec![
                    with_silver(unit("2390"), 100_000),
                    dictionary("2391", 4, "horses", "HORS"),
                ])
            };
            let findings = check(vec![hex], "unit 2390\nBUY 2 horse\n");
            let message = findings
                .iter()
                .find(|finding| finding.code == codes::REGION_POOL_OVERSUBSCRIBED)
                .map(|finding| finding.message.clone())
                .unwrap_or_else(|| panic!("expected an oversubscription: {findings:?}"));
            assert_eq!(message, "this unit buys 2 horses and this market has 1");
        }

        /// `not-traded-here` never puts a number against a name, which is why it escaped the
        /// defect - and it must keep escaping it.
        #[test]
        fn a_message_with_no_count_is_unchanged() {
            let hex = ReportRegion {
                for_sale: vec![MarketItem {
                    amount: 10,
                    name: "perfume".to_string(),
                    tag: "PERF".to_string(),
                    price: 50,
                }],
                ..region(vec![
                    with_silver(unit("2390"), 100_000),
                    dictionary("2391", 4, "horses", "HORS"),
                ])
            };
            let findings = check(vec![hex], "unit 2390\nBUY 5 horse\n");
            assert!(
                findings.iter().any(|finding| finding.message
                    == "this hex does not sell horse - its market has perfume"),
                "{findings:?}"
            );
        }
    }

    /// `ah-t2pn.4`. When own units in one hex are promised more of a region's pool than it holds,
    /// each of them is told so on its own order line.
    ///
    /// Tax only for now: `ah-t2pn.2` and `ah-t2pn.3` had not landed when this was built, and a
    /// sentence for a pool nothing settles is a string no player could reach.
    mod region_pool_oversubscribed {
        use super::*;

        fn taxer(id: &str, men: i64) -> ReportUnit {
            let mut unit = unit(id);
            unit.men = men;
            unit
        }

        fn review(base: Option<i64>, units: Vec<ReportUnit>, orders: &str) -> TurnReview {
            let hex = ReportRegion {
                tax_base: base,
                ..region(units)
            };
            review_turn(
                &report(vec![hex]),
                orders,
                Some(&ruleset()),
                CheckOptions::default(),
            )
        }

        fn oversubscriptions(review: &TurnReview) -> Vec<&Finding> {
            review
                .findings
                .iter()
                .filter(|finding| finding.code == codes::REGION_POOL_OVERSUBSCRIBED)
                .collect()
        }

        /// The bead's headline. Every claimant is named, each on its own `TAX` line, and each
        /// message states the total - so no one unit is blamed for the overrun on its own.
        #[test]
        fn every_taxer_is_told_the_region_cannot_pay_them_all() {
            let review = review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 50)],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 2, "{:?}", review.findings);
            for finding in &found {
                assert_eq!(
                    finding.message,
                    "your units here tax for $3000 between them and this region has $2500"
                );
            }
            assert_eq!(found[0].unit_id.as_deref(), Some("2390"));
            assert_eq!(
                found[0].line,
                Some(2),
                "anchored on the unit's own TAX line"
            );
            assert_eq!(found[1].unit_id.as_deref(), Some("2391"));
            assert_eq!(found[1].line, Some(4));
        }

        #[test]
        fn a_unit_not_drawing_on_the_pool_is_not_told() {
            let review = review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 50), taxer("2392", 50)],
                "unit 2390\nTAX\nunit 2391\nTAX\nunit 2392\nMOVE N\n",
            );

            let told: Vec<&str> = oversubscriptions(&review)
                .iter()
                .filter_map(|finding| finding.unit_id.as_deref())
                .collect();
            assert_eq!(told, vec!["2390", "2391"]);
        }

        /// A base that covers every taxer divided nothing, so nothing is said.
        #[test]
        fn a_region_that_can_pay_everybody_says_nothing() {
            let review = review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 20)],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );

            assert!(oversubscriptions(&review).is_empty());
        }

        /// A lone taxer is uncontended by `ah-t2pn.1`'s rule 1, so a silver pool can never produce
        /// a one-claimant overrun - which is why there is no singular sentence for one.
        #[test]
        fn a_lone_taxer_never_produces_an_overrun() {
            let review = review(Some(2500), vec![taxer("2390", 500)], "unit 2390\nTAX\n");

            assert!(oversubscriptions(&review).is_empty());
        }

        /// Note **pays**, not has: a region pays wages, it does not have them.
        #[test]
        fn every_worker_is_told_the_region_cannot_pay_them_all() {
            let hex = ReportRegion {
                wages: Some("13.5".to_string()),
                max_wages: Some(100),
                ..region(vec![taxer("2390", 10), taxer("2391", 10)])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nWORK\nunit 2391\nWORK\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 2, "{:?}", review.findings);
            assert_eq!(
                found[0].message,
                "your units here work for $270 between them and this region pays $100"
            );
        }

        #[test]
        fn every_entertainer_is_told_the_region_cannot_pay_them_all() {
            let hex = ReportRegion {
                entertainment: Some(50),
                ..region(vec![
                    with_skill(taxer("2390", 2), "ENTE", 1),
                    with_skill(taxer("2391", 2), "ENTE", 1),
                ])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nENTERTAIN\nunit 2391\nENTERTAIN\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 2, "{:?}", review.findings);
            assert_eq!(
                found[0].message,
                "your units here entertain for $120 between them and this region pays $50"
            );
        }

        fn horse_seller(id: &str, holds: i64) -> ReportUnit {
            with_item(unit(id), holds, "horse", "HORS")
        }

        fn market(
            wanted: Vec<MarketItem>,
            for_sale: Vec<MarketItem>,
            units: Vec<ReportUnit>,
        ) -> ReportRegion {
            ReportRegion {
                wanted,
                for_sale,
                ..region(units)
            }
        }

        fn horses(amount: i64) -> MarketItem {
            MarketItem {
                amount,
                name: "horse".to_string(),
                tag: "HORS".to_string(),
                price: 50,
            }
        }

        /// Goods, not silver: a market line is stated in what it trades, and `not-traded-here`
        /// already speaks about a market in its own terms.
        #[test]
        fn every_seller_is_told_the_market_will_not_take_it_all() {
            let review = review_turn(
                &report(vec![market(
                    vec![horses(100)],
                    vec![],
                    vec![horse_seller("2390", 60), horse_seller("2391", 60)],
                )]),
                "unit 2390\nSELL 60 horse\nunit 2391\nSELL 60 horse\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 2, "{:?}", review.findings);
            assert_eq!(
                found[0].message,
                "your units here sell 120 horse between them and this market wants 100"
            );
        }

        #[test]
        fn every_buyer_is_told_the_market_has_not_got_it_all() {
            let review = review_turn(
                &report(vec![market(
                    vec![],
                    vec![horses(100)],
                    vec![
                        with_silver(unit("2390"), 100_000),
                        with_silver(unit("2391"), 100_000),
                    ],
                )]),
                "unit 2390\nBUY 60 horse\nunit 2391\nBUY 60 horse\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 2, "{:?}", review.findings);
            assert_eq!(
                found[0].message,
                "your units here buy 120 horse between them and this market has 100"
            );
        }

        /// `ah-t2pn.3` settles a market for a lone trader too, which is what caps a unit ordering
        /// `BUY 200` where 100 exist - so the plural sentence would say "your units ... between
        /// them" of one unit.
        #[test]
        fn a_lone_buyer_asking_for_more_than_the_market_has_is_told_so() {
            let review = review_turn(
                &report(vec![market(
                    vec![],
                    vec![horses(100)],
                    vec![with_silver(unit("2390"), 100_000)],
                )]),
                "unit 2390\nBUY 200 horse\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 1, "{:?}", review.findings);
            assert_eq!(
                found[0].message,
                "this unit buys 200 horse and this market has 100"
            );
        }

        #[test]
        fn a_lone_seller_offering_more_than_the_market_wants_is_told_so() {
            let review = review_turn(
                &report(vec![market(
                    vec![horses(100)],
                    vec![],
                    vec![horse_seller("2390", 200)],
                )]),
                "unit 2390\nSELL 200 horse\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let found = oversubscriptions(&review);
            assert_eq!(found.len(), 1, "{:?}", review.findings);
            assert_eq!(
                found[0].message,
                "this unit sells 200 horse and this market wants 100"
            );
        }

        /// One code, two facts. Nothing here deduplicates by unit.
        #[test]
        fn two_pools_in_one_hex_produce_two_findings_per_unit() {
            let hex = ReportRegion {
                tax_base: Some(100),
                wages: Some("13.5".to_string()),
                max_wages: Some(100),
                ..region(vec![taxer("2390", 10), taxer("2391", 10)])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nTAX\nWORK\nunit 2391\nTAX\nWORK\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let for_2390: Vec<&str> = oversubscriptions(&review)
                .iter()
                .filter(|finding| finding.unit_id.as_deref() == Some("2390"))
                .map(|finding| finding.message.as_str())
                .collect();
            assert_eq!(for_2390.len(), 2, "{:?}", review.findings);
            assert!(for_2390.iter().any(|message| message.contains("tax for")));
            assert!(for_2390.iter().any(|message| message.contains("work for")));
        }

        /// A market has one pool per item per side, so an oversubscribed one says nothing about
        /// the line beside it.
        #[test]
        fn different_goods_produce_different_findings() {
            let swords = MarketItem {
                amount: 100,
                name: "sword".to_string(),
                tag: "SWOR".to_string(),
                price: 50,
            };
            let review = review_turn(
                &report(vec![market(
                    vec![horses(100), swords],
                    vec![],
                    vec![
                        with_item(horse_seller("2390", 60), 10, "sword", "SWOR"),
                        with_item(horse_seller("2391", 60), 10, "sword", "SWOR"),
                    ],
                )]),
                "unit 2390\nSELL 60 horse\nSELL 10 sword\nunit 2391\nSELL 60 horse\nSELL 10 sword\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let messages: Vec<&str> = oversubscriptions(&review)
                .iter()
                .map(|finding| finding.message.as_str())
                .collect();
            assert_eq!(messages.len(), 2, "{:?}", review.findings);
            assert!(messages.iter().all(|message| message.contains("horse")));
            assert!(!messages.iter().any(|message| message.contains("sword")));
        }

        /// `ah-cxxa` empties the hex before any TAX reaches it, so there is no pool left to
        /// oversubscribe and this check must stay quiet - the pillage finding is the one to read.
        #[test]
        fn a_pillaged_hex_has_no_pool_to_oversubscribe() {
            let review = review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 50), taxer("2392", 1)],
                "unit 2390\nTAX\nunit 2391\nTAX\nunit 2392\nPILLAGE\n",
            );

            assert!(
                oversubscriptions(&review).is_empty(),
                "{:?}",
                review.findings
            );
        }

        /// The guard that the sentence and the column come from one computation: `wanted` is what
        /// the units' own figures would have shown before the split.
        #[test]
        fn the_totals_in_the_sentence_match_the_column() {
            let contended = review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 50)],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );

            let alone = review(Some(1_000_000), vec![taxer("2390", 10)], "unit 2390\nTAX\n");
            let also_alone = review(Some(1_000_000), vec![taxer("2391", 50)], "unit 2391\nTAX\n");
            let uncontended = alone.silver[0].income.expect("a number")
                + also_alone.silver[0].income.expect("a number");

            assert!(oversubscriptions(&contended)[0]
                .message
                .contains(&format!("tax for ${uncontended} between them")));
        }
    }

    /// `ah-t2pn.1`. A region's tax base is shared: two own units taxing one hex split it, and the
    /// column shows what the game will actually pay rather than promising each of them all of it.
    mod shared_tax_base {
        use super::*;

        fn taxer(id: &str, men: i64) -> ReportUnit {
            let mut unit = unit(id);
            unit.men = men;
            unit
        }

        fn silver_of(review: &TurnReview, id: &str) -> UnitSilver {
            review
                .silver
                .iter()
                .find(|forecast| forecast.unit_id == id)
                .cloned()
                .unwrap_or_else(|| panic!("no forecast for {id}: {:?}", review.silver))
        }

        fn tax_review(base: Option<i64>, units: Vec<ReportUnit>, orders: &str) -> TurnReview {
            let hex = ReportRegion {
                tax_base: base,
                ..region(units)
            };
            review_turn(
                &report(vec![hex]),
                orders,
                Some(&ruleset()),
                CheckOptions::default(),
            )
        }

        fn settle(base: Option<i64>, units: Vec<ReportUnit>, orders: &str) -> Vec<PoolOverrun> {
            let hex_region = ReportRegion {
                tax_base: base,
                ..region(units)
            };
            let ordered = OrderedUnits::read(orders);
            let hex = Hex::read(&hex_region, &ordered);
            pool_shares_for(&hex, region_wages(&hex, None)).overruns
        }

        /// `ah-t2pn.4`. The settlement says what it divided, so the sentence a player reads comes
        /// from the same arithmetic as the figures in their column.
        #[test]
        fn the_settlement_reports_an_oversubscribed_tax_base() {
            assert_eq!(
                settle(
                    Some(2500),
                    vec![taxer("2390", 10), taxer("2391", 50)],
                    "unit 2390\nTAX\nunit 2391\nTAX\n",
                ),
                vec![PoolOverrun {
                    pool: ContendedPool::Tax,
                    wanted: 3000,
                    available: 2500,
                    claimants: vec![0, 1],
                }]
            );
        }

        /// Nothing was divided, so there is nothing to say.
        #[test]
        fn a_pool_that_covers_everybody_reports_no_overrun() {
            assert_eq!(
                settle(
                    Some(2500),
                    vec![taxer("2390", 10), taxer("2391", 20)],
                    "unit 2390\nTAX\nunit 2391\nTAX\n",
                ),
                vec![]
            );
        }

        /// A pool nothing can settle has no total to put in a sentence. The units carry
        /// `ah-t2pn.1`'s doubt instead, which is the right thing to show.
        #[test]
        fn an_unjudgeable_pool_reports_no_overrun() {
            let mut guessed = taxer("2391", 50);
            guessed.men_estimated = true;
            assert_eq!(
                settle(
                    Some(2500),
                    vec![taxer("2390", 10), guessed],
                    "unit 2390\nTAX\nunit 2391\nTAX\n",
                ),
                vec![]
            );

            let review = tax_review(
                Some(2500),
                vec![taxer("2390", 10), {
                    let mut guessed = taxer("2391", 50);
                    guessed.men_estimated = true;
                    guessed
                }],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );
            assert_eq!(
                silver_of(&review, "2390").doubt,
                Some(SilverDoubt::ContestedRegionPool)
            );
        }

        /// The regression net under everything below: one taxer is not contention, and its
        /// arithmetic must not move a silver.
        #[test]
        fn a_lone_taxer_still_collects_against_the_whole_base() {
            let big = tax_review(Some(2500), vec![taxer("2390", 50)], "unit 2390\nTAX\n");
            assert_eq!(silver_of(&big, "2390").income, Some(2500));

            let small = tax_review(Some(2500), vec![taxer("2390", 10)], "unit 2390\nTAX\n");
            assert_eq!(silver_of(&small, "2390").income, Some(500));
        }

        /// The bead's headline: $2,500 of base, $3,000 of ask, and the two figures now add up to
        /// no more than the region has.
        #[test]
        fn two_taxers_split_the_base_in_proportion_to_their_men() {
            let review = tax_review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 50)],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );

            assert_eq!(silver_of(&review, "2390").income, Some(416));
            assert_eq!(silver_of(&review, "2391").income, Some(2083));
        }

        #[test]
        fn two_taxers_the_base_can_cover_are_not_divided() {
            let review = tax_review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 20)],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );

            assert_eq!(silver_of(&review, "2390").income, Some(500));
            assert_eq!(silver_of(&review, "2391").income, Some(1000));
        }

        #[test]
        fn a_taxers_estimated_headcount_doubts_every_taxer_in_the_hex() {
            let mut guessed = taxer("2391", 50);
            guessed.men_estimated = true;
            let review = tax_review(
                Some(2500),
                vec![taxer("2390", 10), guessed, taxer("2392", 5)],
                "unit 2390\nTAX\nunit 2391\nTAX\nunit 2392\nMOVE N\n",
            );

            let exact_taxer = silver_of(&review, "2390");
            assert_eq!(exact_taxer.doubt, Some(SilverDoubt::ContestedRegionPool));
            assert_eq!(exact_taxer.income, None);
            assert_eq!(exact_taxer.at_month_end, None);

            // The guessed unit itself short-circuits earlier, on its own headcount: the wider
            // doubt never reaches it, and that precedence is deliberate.
            assert_eq!(
                silver_of(&review, "2391").doubt,
                Some(SilverDoubt::EstimatedMen)
            );

            let mover = silver_of(&review, "2392");
            assert_eq!(mover.doubt, None, "a unit not taxing is not contending");
            assert_eq!(mover.income, Some(0));
        }

        /// What separates this doubt from [`SilverDoubt::EstimatedMen`]'s whole-unit early
        /// return: the unit's own men are known, so its spending is still a number.
        #[test]
        fn a_contested_pool_still_prices_what_the_unit_spends() {
            let mut guessed = taxer("2391", 50);
            guessed.men_estimated = true;
            let hex = ReportRegion {
                tax_base: Some(2500),
                for_sale: vec![MarketItem {
                    amount: 100,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                    price: 100,
                }],
                ..region(vec![with_silver(taxer("2390", 10), 5000), guessed])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nTAX\nBUY 2 grain\nunit 2391\nTAX\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let buyer = silver_of(&review, "2390");
            assert_eq!(buyer.doubt, Some(SilverDoubt::ContestedRegionPool));
            assert_eq!(buyer.income, None);
            assert_eq!(buyer.expense, Some(200));
        }

        /// Absence of a base is not contention: the sentence the player already gets is the right
        /// one, and a second doubt over the top of it would be a worse answer.
        #[test]
        fn two_taxers_in_a_region_with_no_stated_base_are_doubted_as_before() {
            let review = tax_review(
                None,
                vec![taxer("2390", 10), taxer("2391", 50)],
                "unit 2390\nTAX\nunit 2391\nTAX\n",
            );

            assert_eq!(
                silver_of(&review, "2390").doubt,
                Some(SilverDoubt::UnknownTaxBase)
            );
            assert_eq!(
                silver_of(&review, "2391").doubt,
                Some(SilverDoubt::UnknownTaxBase)
            );
        }

        /// Different pools, no contention.
        #[test]
        fn a_taxer_and_a_worker_do_not_contend() {
            let hex = ReportRegion {
                tax_base: Some(2500),
                wages: Some("$14.5".to_string()),
                max_wages: Some(100),
                ..region(vec![taxer("2390", 50), taxer("2391", 50)])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nTAX\nunit 2391\nWORK\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            assert_eq!(silver_of(&review, "2390").income, Some(2500));
            assert_eq!(silver_of(&review, "2390").doubt, None);
        }

        /// `ah-t2pn.1` stopped at `TAX`; `ah-t2pn.2` extended the same settlement to the wage
        /// pool, so two equal workers now halve a pool that cannot cover both.
        #[test]
        fn working_is_divided_too() {
            let hex = ReportRegion {
                wages: Some("$10".to_string()),
                max_wages: Some(300),
                ..region(vec![taxer("2390", 50), taxer("2391", 50)])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nWORK\nunit 2391\nWORK\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(150));
            assert_eq!(silver_of(&review, "2391").late_income, Some(150));
        }

        /// A block may say `TAX` twice; the settlement counted its men once, so it draws its
        /// share once.
        #[test]
        fn a_block_that_taxes_twice_still_draws_one_share() {
            let review = tax_review(
                Some(2500),
                vec![taxer("2390", 10), taxer("2391", 50)],
                "unit 2390\nTAX\nTAX\nunit 2391\nTAX\n",
            );

            assert_eq!(silver_of(&review, "2390").income, Some(416));
        }

        #[test]
        fn claiming_is_still_never_divided() {
            let report = ParsedReport {
                regions: vec![region(vec![taxer("2390", 1), taxer("2391", 1)])],
                header: crate::report::header::ReportHeader {
                    unclaimed_silver: Some(4935),
                    ..Default::default()
                },
                ..Default::default()
            };
            let review = review_turn(
                &report,
                "unit 2390\nCLAIM 4000\nunit 2391\nCLAIM 4000\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            assert_eq!(silver_of(&review, "2390").income, Some(4000));
            assert_eq!(silver_of(&review, "2391").income, Some(4000));
        }
    }

    /// `ah-t2pn.2`. A region's wage pool and its entertainment demand are shared exactly as its
    /// tax base is: own units drawing on one split it in proportion to what each asked for, and
    /// both the Silver column and the upkeep charge learn it from one settlement.
    mod shared_wage_and_entertainment_pools {
        use super::*;

        fn worker(id: &str, men: i64) -> ReportUnit {
            let mut unit = unit(id);
            unit.men = men;
            unit
        }

        fn entertainer(id: &str, men: i64, level: u32) -> ReportUnit {
            with_skill(worker(id, men), "ENTE", level)
        }

        fn silver_of(review: &TurnReview, id: &str) -> UnitSilver {
            review
                .silver
                .iter()
                .find(|forecast| forecast.unit_id == id)
                .cloned()
                .unwrap_or_else(|| panic!("no forecast for {id}: {:?}", review.silver))
        }

        fn wage_review(
            wages: &str,
            max_wages: Option<i64>,
            entertainment: Option<i64>,
            units: Vec<ReportUnit>,
            orders: &str,
        ) -> TurnReview {
            let hex = ReportRegion {
                wages: Some(wages.to_string()),
                max_wages,
                entertainment,
                ..region(units)
            };
            review_turn(
                &report(vec![hex]),
                orders,
                Some(&ruleset()),
                CheckOptions::default(),
            )
        }

        /// The regression net under everything below: one worker is not contention.
        #[test]
        fn a_lone_worker_still_earns_the_whole_pool() {
            let review = wage_review(
                "$12.0",
                Some(1200),
                None,
                vec![worker("2390", 50)],
                "unit 2390\nWORK\n",
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(600));
        }

        /// The bead's headline: $1,200 of pool, $1,320 of ask, and the two figures now add up to
        /// no more than the region has. Both are rounded down by `split_pool`, so a few silver of
        /// the pool goes unpromised - the safe direction.
        #[test]
        fn two_workers_split_a_wage_pool_that_cannot_cover_both() {
            let review = wage_review(
                "$12.0",
                Some(1200),
                None,
                vec![worker("2390", 50), worker("2391", 60)],
                "unit 2390\nWORK\nunit 2391\nWORK\n",
            );

            let first = silver_of(&review, "2390").late_income.expect("a number");
            let second = silver_of(&review, "2391").late_income.expect("a number");
            assert_eq!((first, second), (545, 654));
            assert!(
                first + second <= 1200,
                "the pool is never promised twice: {first} + {second}"
            );
        }

        #[test]
        fn two_workers_a_pool_can_cover_are_not_divided() {
            let review = wage_review(
                "$12.0",
                Some(2000),
                None,
                vec![worker("2390", 50), worker("2391", 60)],
                "unit 2390\nWORK\nunit 2391\nWORK\n",
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(600));
            assert_eq!(silver_of(&review, "2391").late_income, Some(720));
        }

        /// The single most damaging mistake available here: `max_wages: None` means the region
        /// states *no ceiling*, not that it has no money.
        #[test]
        fn two_workers_in_a_region_with_no_wage_ceiling_are_not_divided() {
            let review = wage_review(
                "$12.0",
                None,
                None,
                vec![worker("2390", 50), worker("2391", 60)],
                "unit 2390\nWORK\nunit 2391\nWORK\n",
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(600));
            assert_eq!(silver_of(&review, "2391").late_income, Some(720));
        }

        #[test]
        fn two_entertainers_split_the_regions_demand() {
            let review = wage_review(
                "$12.0",
                Some(2000),
                Some(200),
                vec![entertainer("2390", 5, 2), entertainer("2391", 5, 1)],
                "unit 2390\nENTERTAIN\nunit 2391\nENTERTAIN\n",
            );

            // Asks of 300 and 150 against a demand of 200.
            assert_eq!(silver_of(&review, "2390").late_income, Some(133));
            assert_eq!(silver_of(&review, "2391").late_income, Some(66));
        }

        /// Different pools, no contention.
        #[test]
        fn a_worker_and_an_entertainer_do_not_contend() {
            let review = wage_review(
                "$12.0",
                Some(300),
                Some(200),
                vec![worker("2390", 50), entertainer("2391", 5, 2)],
                "unit 2390\nWORK\nunit 2391\nENTERTAIN\n",
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(300));
            assert_eq!(silver_of(&review, "2391").late_income, Some(200));
            assert_eq!(silver_of(&review, "2390").doubt, None);
            assert_eq!(silver_of(&review, "2391").doubt, None);
        }

        /// A region with no entertainment line pays entertainers nothing, contended or not - the
        /// opposite default to `max_wages`, two lines apart in the same struct.
        #[test]
        fn two_entertainers_where_the_region_states_no_demand_still_earn_nothing() {
            let review = wage_review(
                "$12.0",
                Some(2000),
                None,
                vec![entertainer("2390", 5, 2), entertainer("2391", 5, 1)],
                "unit 2390\nENTERTAIN\nunit 2391\nENTERTAIN\n",
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(0));
            assert_eq!(silver_of(&review, "2391").late_income, Some(0));
            assert_eq!(silver_of(&review, "2390").doubt, None);
        }

        /// A block may say `WORK` twice; the settlement counted its men once, so it draws its
        /// share once.
        #[test]
        fn a_block_that_works_twice_still_draws_one_share() {
            let review = wage_review(
                "$12.0",
                Some(1200),
                None,
                vec![worker("2390", 50), worker("2391", 60)],
                "unit 2390\nWORK\nWORK\nunit 2391\nWORK\n",
            );

            assert_eq!(silver_of(&review, "2390").late_income, Some(545));
        }

        /// The bead's real risk: a worker whose wages are cut also covers less of its own fee,
        /// and the warning and the column must learn that from one computation.
        #[test]
        fn contended_wages_leave_less_to_cover_upkeep() {
            let units = || vec![starving(worker("2390", 50)), starving(worker("2391", 60))];
            let orders = "unit 2390\nWORK\nunit 2391\nWORK\n";

            // Fees of 500 and 600; uncontended wages of 600 and 720 cover both.
            let roomy = wage_review("$12.0", Some(5000), None, units(), orders);
            assert!(
                !roomy
                    .findings
                    .iter()
                    .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER),
                "{:?}",
                roomy.findings
            );

            // The same units against a $1,000 pool: shares of 454 and 545 cover neither fee.
            let short = wage_review("$12.0", Some(1000), None, units(), orders);
            let warned: Vec<&str> = short
                .findings
                .iter()
                .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
                .filter_map(|finding| finding.unit_id.as_deref())
                .collect();
            assert!(warned.contains(&"2390"), "{:?}", short.findings);
            assert_eq!(silver_of(&short, "2390").late_income, Some(454));
            assert_eq!(silver_of(&short, "2390").upkeep, Some(500));
        }

        /// The one-computation invariant stated as a test: the figure the column shows and the
        /// figure the upkeep charge nets the fee against are the same number.
        #[test]
        fn wages_and_upkeep_agree_about_one_contended_worker() {
            let review = wage_review(
                "$12.0",
                Some(1000),
                None,
                vec![starving(worker("2390", 50)), starving(worker("2391", 60))],
                "unit 2390\nWORK\nunit 2391\nWORK\n",
            );

            let forecast = silver_of(&review, "2390");
            let late = forecast.late_income.expect("a number");
            let fee = forecast.upkeep.expect("every unit owes a fee");
            let short = review
                .findings
                .iter()
                .find(|finding| {
                    finding.code == codes::NOT_ENOUGH_SILVER
                        && finding.unit_id.as_deref() == Some("2390")
                })
                .expect("the contended worker cannot pay its fee");
            assert!(
                short.message.contains(&(fee - late).to_string()),
                "the warning is short by exactly what the column says is missing: \
                 fee {fee}, wages {late}, message {:?}",
                short.message
            );
        }

        #[test]
        fn a_workers_estimated_headcount_doubts_every_worker_in_the_hex() {
            let mut guessed = worker("2391", 60);
            guessed.men_estimated = true;
            let review = wage_review(
                "$12.0",
                Some(1200),
                Some(200),
                vec![worker("2390", 50), guessed, entertainer("2392", 5, 2)],
                "unit 2390\nWORK\nunit 2391\nWORK\nunit 2392\nENTERTAIN\n",
            );

            let exact_worker = silver_of(&review, "2390");
            assert_eq!(exact_worker.doubt, Some(SilverDoubt::ContestedRegionPool));
            assert_eq!(exact_worker.income, None);
            assert_eq!(exact_worker.late_income, None);
            assert_eq!(exact_worker.at_month_end, None);

            // The guessed unit short-circuits earlier, on its own headcount.
            assert_eq!(
                silver_of(&review, "2391").doubt,
                Some(SilverDoubt::EstimatedMen)
            );

            let entertaining = silver_of(&review, "2392");
            assert_eq!(
                entertaining.doubt, None,
                "a unit drawing on another pool is not contending"
            );
            assert_eq!(entertaining.late_income, Some(200));
        }

        /// What separates this doubt from `EstimatedMen`'s whole-unit early return: the unit's
        /// own men are known, so its spending is still a number.
        #[test]
        fn a_contested_wage_pool_still_prices_what_the_unit_spends() {
            let mut guessed = worker("2391", 60);
            guessed.men_estimated = true;
            let hex = ReportRegion {
                wages: Some("$12.0".to_string()),
                max_wages: Some(1200),
                for_sale: vec![MarketItem {
                    amount: 100,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                    price: 100,
                }],
                ..region(vec![with_silver(worker("2390", 50), 5000), guessed])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nWORK\nBUY 2 grain\nunit 2391\nWORK\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            let buyer = silver_of(&review, "2390");
            assert_eq!(buyer.doubt, Some(SilverDoubt::ContestedRegionPool));
            assert_eq!(buyer.income, None);
            assert_eq!(buyer.expense, Some(200));
        }
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

    /// The pair is the point (`ah-abwx`): one direction alone passes on a surface that credits
    /// nothing. The ledger has always credited a pillage twice the region's tax base, so the
    /// column has to say the same or the player is shown a red month-end beside a silent warning.
    #[test]
    fn the_column_and_the_warning_agree_about_a_pillager_that_spends() {
        let market = |orders: &str| {
            let hex = ReportRegion {
                tax_base: Some(2500),
                for_sale: vec![MarketItem {
                    amount: 100,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                    price: 100,
                }],
                ..region(vec![armed_to_pillage(with_silver(unit("2390"), 0), 2500)])
            };
            review_turn(
                &report(vec![hex]),
                orders,
                Some(&ruleset()),
                CheckOptions::default(),
            )
        };

        // Ten grain at 100 is 1,000 out of the 5,000 the pillage brings in.
        let affordable = market("unit 2390\nPILLAGE\nBUY 10 grain\n");
        assert!(
            affordable.silver[0].at_month_end.is_some_and(|end| end > 0),
            "the column shows the pillage: {:?}",
            affordable.silver[0].at_month_end
        );
        assert!(
            !affordable
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER),
            "the warning stays quiet: {:?}",
            codes(&affordable.findings)
        );

        // Eighty grain at 100 is 8,000, which 5,000 cannot pay for.
        let unaffordable = market("unit 2390\nPILLAGE\nBUY 80 grain\n");
        assert!(
            unaffordable.silver[0]
                .at_month_end
                .is_some_and(|end| end < 0),
            "the column shows the shortfall: {:?}",
            unaffordable.silver[0].at_month_end
        );
        assert!(
            unaffordable
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER),
            "the warning fires: {:?}",
            codes(&unaffordable.findings)
        );
    }

    // --- a unit that taxes by its flag (`ah-fvzu`) ----------------------------------------------

    /// A unit set to tax every turn, with no `TAX` in this month's orders.
    fn taxing_by_flag(mut unit: ReportUnit) -> ReportUnit {
        unit.flags.push("taxing".to_string());
        unit
    }

    #[test]
    fn the_ledger_credits_a_flagged_taxer() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![with_silver(taxing_by_flag(unit("1")), 0)])
        };
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let ledger = ledger_for(&hex, Some(&rules));

        assert_eq!(silver_balance(&ledger, "1"), 50);
    }

    #[test]
    fn the_ledger_does_not_credit_a_flagged_taxer_twice() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![with_silver(taxing_by_flag(unit("1")), 0)])
        };
        let ordered = OrderedUnits::read("unit 1\nTAX\n");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let ledger = ledger_for(&hex, Some(&rules));

        assert_eq!(silver_balance(&ledger, "1"), 50);
    }

    /// A flagged taxer contends for the region's base like any other, or every other taxer's share
    /// is too large (`ah-t2pn.1`).
    #[test]
    fn a_flagged_taxer_contends_for_the_tax_base() {
        let hex_region = ReportRegion {
            tax_base: Some(60),
            ..region(vec![
                with_silver(unit("1"), 0),
                with_silver(taxing_by_flag(unit("2")), 0),
            ])
        };
        let ordered = OrderedUnits::read("unit 1\nTAX\n");
        let hex = Hex::read(&hex_region, &ordered);
        let region = region_wages(&hex, None);
        let settled = pool_shares_for(&hex, region);

        assert_eq!(settled.shares.len(), 2);
        for share in &settled.shares {
            assert_eq!(share.tax, PoolShare::Share(30));
        }
    }

    #[test]
    fn a_flagged_unit_is_not_told_it_does_nothing() {
        let hex_region = region(vec![with_silver(taxing_by_flag(unit("1")), 100)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let mut findings = Vec::new();
        check_idle_units(&hex, &CheckOptions::default(), &mut findings);

        assert!(findings.is_empty(), "{:?}", codes(&findings));
    }

    #[test]
    fn a_unit_without_the_flag_still_is() {
        let hex_region = region(vec![with_silver(unit("1"), 100)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let mut findings = Vec::new();
        check_idle_units(&hex, &CheckOptions::default(), &mut findings);

        assert_eq!(codes(&findings), vec![codes::UNIT_DOES_NOTHING.as_str()]);
    }

    /// A flagged unit has no `TAX` line to hang the mark on, so it hangs on its block
    /// (`semantics::finding_at_block`).
    #[test]
    fn a_flagged_taxer_in_a_pillaged_hex_is_marked_on_its_block() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![
                with_silver(unit("1"), 0),
                with_silver(taxing_by_flag(unit("2")), 0),
            ])
        };
        let ordered = OrderedUnits::read("unit 1\nPILLAGE\n");
        let hex = Hex::read(&hex_region, &ordered);
        let mut findings = Vec::new();
        check_pillaged_tax(&hex, true, &CheckOptions::default(), &mut findings);

        assert_eq!(findings.len(), 1);
        let marked = &findings[0];
        assert_eq!(
            marked.message,
            "a unit is pillaging this hex, so this TAX will collect nothing"
        );
        assert_eq!(marked.column_start, None);
        assert_eq!(marked.column_end, None);
    }

    #[test]
    fn a_unit_with_a_tax_order_is_still_marked_on_its_line() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![
                with_silver(unit("1"), 0),
                with_silver(taxing_by_flag(unit("2")), 0),
            ])
        };
        let ordered = OrderedUnits::read("unit 1\nPILLAGE\n\nunit 2\nTAX\n");
        let hex = Hex::read(&hex_region, &ordered);
        let mut findings = Vec::new();
        check_pillaged_tax(&hex, true, &CheckOptions::default(), &mut findings);

        assert_eq!(findings.len(), 1);
        assert!(findings[0].column_start.is_some());
    }

    // --- a pillage empties the hex for every own taxer (`ah-cxxa`) -----------------------------

    /// "PILLAGE comes before TAX, so a unit performing TAX will collect no money in that region
    /// that month." The ledger read `hex.region.tax_base` alone and never looked at the hex's own
    /// orders, so it credited a taxer beside a pillager in full.
    #[test]
    fn the_ledger_credits_a_taxer_nothing_in_a_pillaged_hex() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![with_silver(unit("1"), 0), with_silver(unit("2"), 0)])
        };
        let ordered = OrderedUnits::read("unit 1\nPILLAGE\n\nunit 2\nTAX\n");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let ledger = ledger_for(&hex, Some(&rules));

        assert_eq!(
            silver_balance(&ledger, "2"),
            0,
            "the taxer collects nothing where a faction-mate is pillaging"
        );
    }

    /// The pair is the point, exactly as `ah-abwx` and `ah-ycuj` require: before this bead the
    /// taxer looked solvent on both surfaces, so a single-surface fix passes its own tests and
    /// fails the corpus agreement test.
    #[test]
    fn the_column_and_the_warning_agree_about_a_taxer_in_a_pillaged_hex() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            for_sale: vec![MarketItem {
                amount: 100,
                name: "grain".to_string(),
                tag: "GRAI".to_string(),
                price: 100,
            }],
            ..region(vec![with_silver(unit("1"), 0), with_silver(unit("2"), 0)])
        };
        // Unit 2 taxes and then spends 1,000 it will not have, because unit 1 empties the hex.
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nPILLAGE\n\nunit 2\nTAX\nBUY 10 grain\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let taxer = review
            .silver
            .iter()
            .find(|row| row.unit_id == "2")
            .expect("the taxer is priced");
        assert!(
            taxer.at_month_end.is_some_and(|end| end < 0),
            "the column shows the shortfall: {:?}",
            taxer.at_month_end
        );
        assert!(
            review
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER
                    && finding.unit_id.as_deref() == Some("2")),
            "the warning fires too: {:?}",
            codes(&review.findings)
        );
    }

    /// The ledger's other optimism, and the one this bead nearly lost (`ah-lu0f.1`, PR #647).
    ///
    /// A region whose report states no tax base is not a region with nothing to give: it is a
    /// region whose figure we do not have. `semantics` accepts on doubt, so it reads an unstated
    /// base as no cap at all and credits the taxer its full ask - and a shortfall is reported only
    /// where the unit is short even then. The Silver column, which must show a number rather than
    /// a guess, raises `SilverDoubt::UnknownTaxBase` instead. Green on `main`, and the reviewer
    /// caught this going red.
    #[test]
    fn the_ledger_stays_optimistic_about_an_unstated_tax_base() {
        let hex_region = ReportRegion {
            tax_base: None,
            for_sale: vec![MarketItem {
                amount: 100,
                name: "sword".to_string(),
                tag: "SWOR".to_string(),
                price: 100,
            }],
            ..region(vec![with_men(with_silver(unit("1"), 100), 10)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nTAX\nBUY 4 sword\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        // The column cannot price the tax at all, so it shows no month-end figure.
        let taxer = review
            .silver
            .iter()
            .find(|row| row.unit_id == "1")
            .expect("the taxer is priced");
        assert_eq!(
            taxer.at_month_end, None,
            "the column doubts an unstated base: {taxer:?}"
        );

        // The ledger credits the full optimistic ask, so nothing is claimed against the unit.
        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER
                    && finding.unit_id.as_deref() == Some("1")),
            "no shortfall is claimed on the optimistic reading: {:?}",
            codes(&review.findings)
        );
    }

    /// The one place the two silver surfaces disagree on purpose (`ah-lu0f.1`).
    ///
    /// `silver::forecast_unit` shows the player the `ah-t2pn` settlement of a contended tax pool -
    /// what this unit will actually collect once its faction-mates are settled against it. This
    /// module does not: its policy is *accept on doubt* (see the module doc), so a shortfall is
    /// reported only when the unit is short even in the best case, and "no other own unit competes
    /// for the pool" is that best case. Passing the settlement here instead would fire a false
    /// `not-enough-silver` in every contended tax hex.
    #[test]
    fn the_ledger_stays_optimistic_about_a_contended_tax_pool() {
        let hex_region = ReportRegion {
            // Two ten-man taxers each want $500, and the region has $500 to give: contended.
            tax_base: Some(500),
            for_sale: vec![MarketItem {
                amount: 100,
                name: "sword".to_string(),
                tag: "SWOR".to_string(),
                price: 100,
            }],
            ..region(vec![
                with_men(with_silver(unit("1"), 100), 10),
                with_men(with_silver(unit("2"), 100), 10),
            ])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nTAX\nBUY 4 sword\n\nunit 2\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        // The column, which shows the settled figure, has unit 1 short.
        let buyer = review
            .silver
            .iter()
            .find(|row| row.unit_id == "1")
            .expect("the buyer is priced");
        assert!(
            buyer.at_month_end.is_some_and(|end| end < 0),
            "the settled column shows the shortfall: {:?}",
            buyer.at_month_end
        );

        // The warning, which stays optimistic, does not.
        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER
                    && finding.unit_id.as_deref() == Some("1")),
            "no shortfall is claimed on the optimistic reading: {:?}",
            codes(&review.findings)
        );
    }

    /// The mark that says why the column shows nothing (`ah-1ad6.2`), one per pillaging unit
    /// because the finding hangs on an order and each pillaging unit wrote its own.
    #[test]
    fn a_faction_without_the_men_is_told_so() {
        let hex_region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![with_silver(unit("683"), 0)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let told: Vec<&Finding> = review
            .findings
            .iter()
            .filter(|finding| finding.code == codes::PILLAGE_WITHOUT_MEN)
            .collect();
        assert_eq!(told.len(), 1, "{:?}", codes(&review.findings));
        assert_eq!(told[0].unit_id.as_deref(), Some("683"));
        assert_eq!(told[0].line, Some(2), "on the PILLAGE line");
        assert_eq!(
            told[0].message,
            "cannot pillage here: needs 90 combat ready men, this faction has 0"
        );
    }

    #[test]
    fn a_faction_with_the_men_is_not_marked() {
        let hex_region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![armed_to_pillage(with_silver(unit("683"), 0), 8963)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );
        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::PILLAGE_WITHOUT_MEN),
            "{:?}",
            codes(&review.findings)
        );
    }

    /// Silence, not a mark: the column already shows `?`, and a mark would be a second and louder
    /// claim about something unknown.
    #[test]
    fn an_unknown_tax_base_is_not_marked() {
        let hex_region = ReportRegion {
            tax_base: None,
            ..region(vec![with_silver(unit("683"), 0)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );
        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::PILLAGE_WITHOUT_MEN),
            "{:?}",
            codes(&review.findings)
        );
    }

    /// The reported defect (`ah-1ad6.2`): *The Lost One (683)* - one leader in a hex whose tax base
    /// is 8,963, which needs 90 combat ready men - was credited the full 17,926 by both surfaces.
    #[test]
    fn a_faction_without_the_men_earns_nothing_from_pillage() {
        let hex_region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![with_silver(unit("683"), 0)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let row = review
            .silver
            .iter()
            .find(|row| row.unit_id == "683")
            .expect("priced");
        assert_eq!(row.income, Some(0));
        assert_eq!(row.doubt, None);
    }

    /// The navigator's decision: "the faction to have enough combat ready men in the region", so a
    /// lone leader ordering `PILLAGE` beside a faction-mate of 90 armed men qualifies, and the
    /// army need issue no order at all. The count is the hex's, never the pillaging unit's own.
    #[test]
    fn the_men_are_counted_across_the_hex_not_the_unit() {
        let hex_region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![
                with_silver(unit("683"), 0),
                armed_to_pillage(with_silver(unit("684"), 0), 8963),
            ])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let row = review
            .silver
            .iter()
            .find(|row| row.unit_id == "683")
            .expect("priced");
        assert_eq!(row.income, Some(17_926));
        assert_eq!(row.doubt, None);
    }

    /// One guessed headcount anywhere in the hex makes the threshold unanswerable - the estimate
    /// might be what carries the faction over it.
    #[test]
    fn a_guessed_headcount_in_the_hex_doubts_the_pillage() {
        let mut guessed = armed_to_pillage(with_silver(unit("684"), 0), 8963);
        guessed.men_estimated = true;
        let hex_region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![with_silver(unit("683"), 0), guessed])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let row = review
            .silver
            .iter()
            .find(|row| row.unit_id == "683")
            .expect("priced");
        assert_eq!(row.doubt, Some(SilverDoubt::EstimatedMen));
        assert_eq!(row.income, None);
    }

    /// The pair is the point (`ah-abwx`, and the reason `ah-ycuj` exists): a faction short of the
    /// men must be shown nothing by the column *and* charged nothing by the ledger, or the player
    /// gets a silent `not-enough-silver` beside a column that promised the silver.
    #[test]
    fn the_ledger_and_the_column_agree_about_pillage() {
        let spend = |units: Vec<ReportUnit>, orders: &str| {
            let hex_region = ReportRegion {
                tax_base: Some(8963),
                for_sale: vec![MarketItem {
                    amount: 100,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                    price: 100,
                }],
                ..region(units)
            };
            review_turn(
                &report(vec![hex_region]),
                orders,
                Some(&ruleset()),
                CheckOptions::default(),
            )
        };

        // Without the men the pillage buys nothing, so both surfaces say so.
        let broke = spend(
            vec![with_silver(unit("683"), 0)],
            "unit 683\nPILLAGE\nBUY 10 grain\n",
        );
        assert_eq!(broke.silver[0].at_month_end, Some(-1000));
        assert!(
            broke
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER),
            "the warning fires too: {:?}",
            codes(&broke.findings)
        );

        // With them, both surfaces credit the pillage and neither complains.
        let paid = spend(
            vec![armed_to_pillage(with_silver(unit("683"), 0), 8963)],
            "unit 683\nPILLAGE\nBUY 10 grain\n",
        );
        assert!(
            paid.silver[0].at_month_end.is_some_and(|end| end > 0),
            "the column shows the pillage: {:?}",
            paid.silver[0].at_month_end
        );
        assert!(
            !paid
                .findings
                .iter()
                .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER),
            "the warning stays quiet: {:?}",
            codes(&paid.findings)
        );
    }

    /// The pillager collects; only taxers are emptied. This is the net under the predicate being
    /// applied to the wrong arm.
    #[test]
    fn the_pillager_itself_still_earns_twice_the_base() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![
                armed_to_pillage(with_silver(unit("1"), 0), 2500),
                with_silver(unit("2"), 0),
            ])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nPILLAGE\n\nunit 2\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let pillager = review
            .silver
            .iter()
            .find(|row| row.unit_id == "1")
            .expect("the pillager is priced");
        assert_eq!(pillager.income, Some(5000));
        assert_eq!(pillager.doubt, None);
    }

    #[test]
    fn a_unit_that_pillages_is_not_warned_about_its_own_pillage() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![with_silver(unit("1"), 0)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::TAXED_A_PILLAGED_HEX),
            "a lone pillager is told nothing: {:?}",
            codes(&review.findings)
        );
    }

    /// One finding per taxing unit, on its own `TAX` line: each is separately editable and each is
    /// equally affected. The pillager is never named - its orders are fine.
    #[test]
    fn every_taxer_in_a_pillaged_hex_is_told_why() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![
                with_silver(unit("1"), 0),
                with_silver(unit("2"), 0),
                with_silver(unit("3"), 0),
            ])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nPILLAGE\n\nunit 2\nTAX\n\nunit 3\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let told: Vec<&Finding> = review
            .findings
            .iter()
            .filter(|finding| finding.code == codes::TAXED_A_PILLAGED_HEX)
            .collect();

        assert_eq!(told.len(), 2, "one per taxer: {told:?}");
        for finding in &told {
            assert_eq!(
                finding.message,
                "a unit is pillaging this hex, so this TAX will collect nothing"
            );
            assert!(
                finding.line.is_some(),
                "anchored on the TAX line: {finding:?}"
            );
        }
        let mut named: Vec<&str> = told
            .iter()
            .filter_map(|finding| finding.unit_id.as_deref())
            .collect();
        named.sort_unstable();
        assert_eq!(named, vec!["2", "3"], "the pillager is not among them");
    }

    #[test]
    fn a_hex_nobody_pillages_says_nothing() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![with_silver(unit("2"), 0)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 2\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::TAXED_A_PILLAGED_HEX),
            "nothing to say: {:?}",
            codes(&review.findings)
        );
    }

    /// `own_unit_pillages` takes a hex, and this is what proves it was not hoisted to the report.
    #[test]
    fn a_pillage_in_one_hex_does_not_empty_another() {
        let here = ReportRegion {
            tax_base: Some(2500),
            ..region_at("1:7,53", 7, 53, vec![with_silver(unit("1"), 0)])
        };
        let mut elsewhere = ReportRegion {
            tax_base: Some(2500),
            ..region_at("1:9,53", 9, 53, vec![with_silver(unit("2"), 0)])
        };
        for unit in &mut elsewhere.units {
            unit.region_id = "1:9,53".to_string();
        }

        let review = review_turn(
            &report(vec![here, elsewhere]),
            "unit 1\nPILLAGE\n\nunit 2\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let taxer = review
            .silver
            .iter()
            .find(|row| row.unit_id == "2")
            .expect("the taxer is priced");
        assert_eq!(
            taxer.income,
            Some(50),
            "another hex's pillage is not its own"
        );
        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::TAXED_A_PILLAGED_HEX),
            "and it is told nothing: {:?}",
            codes(&review.findings)
        );
    }

    /// The predicate is about the hex, not about other units, so a unit ordered to do both is
    /// warned about its own `TAX` line - its pillage is fine, its tax collects nothing.
    #[test]
    fn a_unit_that_pillages_and_is_also_ordered_to_tax_is_still_told() {
        let hex_region = ReportRegion {
            tax_base: Some(2500),
            ..region(vec![armed_to_pillage(with_silver(unit("1"), 0), 2500)])
        };
        let review = review_turn(
            &report(vec![hex_region]),
            "unit 1\nPILLAGE\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let told: Vec<&Finding> = review
            .findings
            .iter()
            .filter(|finding| finding.code == codes::TAXED_A_PILLAGED_HEX)
            .collect();
        assert_eq!(told.len(), 1, "on its TAX line: {told:?}");
        assert_eq!(told[0].unit_id.as_deref(), Some("1"));

        let row = review
            .silver
            .iter()
            .find(|row| row.unit_id == "1")
            .expect("priced");
        assert_eq!(row.income, Some(5000), "the pillage still pays");
    }

    /// A foreign unit on guard, for the `taxed-a-guarded-hex` fixtures (`ah-g7ts`). Ownership is
    /// the report's own marker, never inferred, so a fixture states it.
    fn foreign_guard(id: &str) -> ReportUnit {
        ReportUnit {
            faction_id: Some("1".to_string()),
            faction_name: Some("The Guardsmen".to_string()),
            own: false,
            on_guard: true,
            ..unit(id)
        }
    }

    /// A guarded hex with one of our units in it, its tax base big enough to pillage.
    fn guarded_hex(own: Vec<ReportUnit>) -> ReportRegion {
        let mut units = own;
        units.push(foreign_guard("14"));
        ReportRegion {
            tax_base: Some(8963),
            ..region(units)
        }
    }

    #[test]
    fn a_foreign_unit_on_guard_is_seen() {
        let region = guarded_hex(vec![with_silver(unit("683"), 0)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&region, &ordered);
        assert!(
            foreign_unit_guards(&hex),
            "the foreign guard is visible from the hex"
        );
    }

    #[test]
    fn our_own_guard_is_not_a_foreign_guard() {
        let mut ours = with_silver(unit("683"), 0);
        ours.on_guard = true;
        let region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![ours])
        };
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&region, &ordered);
        assert!(
            !foreign_unit_guards(&hex),
            "guarding our own hex is not somebody else guarding it"
        );
    }

    #[test]
    fn a_foreign_unit_not_on_guard_is_not_a_guard() {
        let mut passer_by = foreign_guard("14");
        passer_by.on_guard = false;
        let region = ReportRegion {
            tax_base: Some(8963),
            ..region(vec![with_silver(unit("683"), 0), passer_by])
        };
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&region, &ordered);
        assert!(
            !foreign_unit_guards(&hex),
            "a foreigner merely standing there guards nothing"
        );
    }

    #[test]
    fn taxing_a_hex_a_foreigner_guards_is_flagged() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![with_silver(unit("683"), 0)])]),
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let told: Vec<&Finding> = review
            .findings
            .iter()
            .filter(|finding| finding.code == codes::TAXED_A_GUARDED_HEX)
            .collect();
        assert_eq!(told.len(), 1, "one, on the TAX line: {told:?}");
        assert_eq!(
            told[0].message,
            "a foreign unit is guarding this hex, so this TAX may collect nothing"
        );
        assert!(told[0].line.is_some(), "anchored on the order line");
        assert_eq!(told[0].unit_id.as_deref(), Some("683"));
    }

    #[test]
    fn an_unguarded_hex_says_nothing() {
        let review = review_turn(
            &report(vec![ReportRegion {
                tax_base: Some(8963),
                ..region(vec![with_silver(unit("683"), 0)])
            }]),
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(
            !codes(&review.findings).contains(&codes::TAXED_A_GUARDED_HEX.as_str()),
            "nothing to say: {:?}",
            codes(&review.findings)
        );
    }

    #[test]
    fn pillaging_a_hex_a_foreigner_guards_is_flagged() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![armed_to_pillage(
                with_silver(unit("683"), 0),
                8963,
            )])]),
            "unit 683\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let told: Vec<&Finding> = review
            .findings
            .iter()
            .filter(|finding| finding.code == codes::TAXED_A_GUARDED_HEX)
            .collect();
        assert_eq!(told.len(), 1, "one, on the PILLAGE line: {told:?}");
        assert_eq!(
            told[0].message,
            "a foreign unit is guarding this hex, so this PILLAGE may collect nothing"
        );
    }

    /// `ah-cxxa`'s finding is the stronger fact on a `TAX` line - the money is certainly gone -
    /// so this bead's "may collect nothing" is not added beside it.
    #[test]
    fn a_pillaged_and_guarded_hex_warns_once_about_tax() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![
                armed_to_pillage(with_silver(unit("1"), 0), 8963),
                with_silver(unit("2"), 0),
            ])]),
            "unit 1\nPILLAGE\n\nunit 2\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let on_the_tax_line: Vec<&str> = review
            .findings
            .iter()
            .filter(|finding| finding.unit_id.as_deref() == Some("2"))
            .map(|finding| finding.code.as_str())
            .collect();
        assert_eq!(
            on_the_tax_line,
            vec![codes::TAXED_A_PILLAGED_HEX.as_str()],
            "the stronger warning alone"
        );
    }

    #[test]
    fn a_pillaged_and_guarded_hex_still_warns_the_pillager() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![armed_to_pillage(
                with_silver(unit("1"), 0),
                8963,
            )])]),
            "unit 1\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(
            review
                .findings
                .iter()
                .any(|finding| finding.code == codes::TAXED_A_GUARDED_HEX
                    && finding.unit_id.as_deref() == Some("1")),
            "our own pillage does not stop our pillager, but the guard may: {:?}",
            codes(&review.findings)
        );
    }

    // --- a unit that taxes by its flag, in a guarded hex (`ah-leeg`) ----------------------------

    /// A flagged unit has no `TAX` line to hang the mark on, so it hangs on its block
    /// (`semantics::finding_at_block`) - `ah-leeg`, mirroring what `ah-fvzu` did for the
    /// pillaged-hex mark.
    #[test]
    fn a_flagged_taxer_in_a_guarded_hex_is_marked_on_its_block() {
        let region = guarded_hex(vec![with_silver(taxing_by_flag(unit("683")), 0)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&region, &ordered);
        let mut findings = Vec::new();
        check_guarded_tax(&hex, true, false, &CheckOptions::default(), &mut findings);

        assert_eq!(findings.len(), 1, "{findings:?}");
        assert_eq!(
            findings[0].message,
            "a foreign unit is guarding this hex, so this TAX may collect nothing"
        );
        assert_eq!(findings[0].unit_id.as_deref(), Some("683"));
        assert_eq!(findings[0].column_start, None);
        assert_eq!(findings[0].column_end, None);
    }

    /// One sentence, once: a unit carrying both the flag and a `TAX` line is marked on the line
    /// only, never on the line and its block together (`ah-leeg`).
    #[test]
    fn a_flagged_taxer_with_a_tax_order_is_marked_only_on_its_line() {
        let region = guarded_hex(vec![with_silver(taxing_by_flag(unit("683")), 0)]);
        let ordered = OrderedUnits::read("unit 683\nTAX\n");
        let hex = Hex::read(&region, &ordered);
        let mut findings = Vec::new();
        check_guarded_tax(&hex, true, false, &CheckOptions::default(), &mut findings);

        assert_eq!(findings.len(), 1, "{findings:?}");
        assert!(
            findings[0].column_start.is_some(),
            "anchored on the TAX line: {findings:?}"
        );
    }

    /// `taxed-a-pillaged-hex` already says the money is certainly gone, and `check_pillaged_tax`
    /// marks this same block with it - so the weaker "may" is suppressed here too (`ah-leeg`).
    #[test]
    fn a_flagged_taxer_in_a_pillaged_and_guarded_hex_is_not_told_twice() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![
                armed_to_pillage(with_silver(unit("1"), 0), 8963),
                with_silver(taxing_by_flag(unit("2")), 0),
            ])]),
            "unit 1\nPILLAGE\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let against_the_flagged_unit: Vec<&str> = review
            .findings
            .iter()
            .filter(|finding| finding.unit_id.as_deref() == Some("2"))
            .map(|finding| finding.code.as_str())
            .collect();
        assert!(
            against_the_flagged_unit.contains(&codes::TAXED_A_PILLAGED_HEX.as_str()),
            "the stronger warning is what it gets instead: {against_the_flagged_unit:?}"
        );
        assert!(
            !against_the_flagged_unit.contains(&codes::TAXED_A_GUARDED_HEX.as_str()),
            "and it gets that one alone: {against_the_flagged_unit:?}"
        );
    }

    /// The mark is about taxing, not about standing in a guarded hex (`ah-leeg`).
    #[test]
    fn an_unflagged_unit_without_orders_is_not_marked() {
        let region = guarded_hex(vec![with_silver(unit("683"), 0)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&region, &ordered);
        let mut findings = Vec::new();
        check_guarded_tax(&hex, true, false, &CheckOptions::default(), &mut findings);

        assert!(findings.is_empty(), "{findings:?}");
    }

    /// The real corpus case: a flagged unit with no orders block at all. `finding_at_block` then
    /// gives `line: None`, and the mark lives in the problems panel - which the navigator chose
    /// knowingly (`ah-leeg`). Asserted end to end, because nothing else proves the hex's other
    /// checks leave it alone.
    #[test]
    fn a_flagged_taxer_is_warned_through_review_turn() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![with_silver(
                taxing_by_flag(unit("683")),
                0,
            )])]),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let told: Vec<&Finding> = review
            .findings
            .iter()
            .filter(|finding| finding.code == codes::TAXED_A_GUARDED_HEX)
            .collect();
        assert_eq!(told.len(), 1, "one, on the block: {told:?}");
        assert_eq!(
            told[0].message,
            "a foreign unit is guarding this hex, so this TAX may collect nothing"
        );
        assert_eq!(told[0].unit_id.as_deref(), Some("683"));
    }

    /// A flagged unit whose orders block holds no `TAX` is still marked on that block - and there
    /// the block is in the document, so the mark carries its line and reaches the editor as well as
    /// the problems panel. The empty-orders case above is the other half of this (`ah-leeg`).
    #[test]
    fn a_flagged_taxer_with_other_orders_is_marked_on_the_block_it_has() {
        let region = guarded_hex(vec![with_silver(taxing_by_flag(unit("683")), 0)]);
        let ordered = OrderedUnits::read("unit 683\nAVOID 1\n");
        let hex = Hex::read(&region, &ordered);
        let mut findings = Vec::new();
        check_guarded_tax(&hex, true, false, &CheckOptions::default(), &mut findings);

        assert_eq!(findings.len(), 1, "{findings:?}");
        assert_eq!(findings[0].line, Some(1), "on the block: {findings:?}");
        assert_eq!(findings[0].column_start, None);
    }

    /// One code, one toggle: a player who turned this advisory off has turned it off (`ah-leeg`).
    #[test]
    fn the_guarded_hex_toggle_silences_the_flagged_case_too() {
        let mut options = CheckOptions::default();
        options
            .disabled
            .insert(codes::TAXED_A_GUARDED_HEX.as_str().to_string());
        let review = review_turn(
            &report(vec![guarded_hex(vec![with_silver(
                taxing_by_flag(unit("683")),
                0,
            )])]),
            "",
            Some(&ruleset()),
            options,
        );

        assert!(
            !codes(&review.findings).contains(&codes::TAXED_A_GUARDED_HEX.as_str()),
            "silenced: {:?}",
            codes(&review.findings)
        );
    }

    /// The navigator's decision: the column keeps its optimistic figure and the warning carries
    /// the uncertainty (`ah-g7ts`).
    #[test]
    fn a_guarded_hex_does_not_change_what_tax_earns() {
        let guarded = review_turn(
            &report(vec![guarded_hex(vec![with_silver(unit("683"), 0)])]),
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );
        let unguarded = review_turn(
            &report(vec![ReportRegion {
                tax_base: Some(8963),
                ..region(vec![with_silver(unit("683"), 0)])
            }]),
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let row = |review: &TurnReview| {
            review
                .silver
                .iter()
                .find(|row| row.unit_id == "683")
                .map(|row| (row.income, row.doubt))
                .expect("the taxer is priced")
        };
        assert_eq!(row(&guarded), row(&unguarded), "the figure does not move");
    }

    /// The rule's *"you"* is the guarding faction, whose attitude toward us our report does not
    /// carry. `header.attitudes` states ours toward them, which is the other direction and must
    /// not be consulted (`ah-g7ts`).
    #[test]
    fn the_attitudes_block_is_not_consulted() {
        let regions = vec![guarded_hex(vec![with_silver(unit("683"), 0)])];
        let without = review_turn(
            &report(regions.clone()),
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let mut friendly = report(regions);
        friendly.header.attitudes = crate::report::header::DeclaredAttitudes {
            default_attitude: Some("Neutral".to_string()),
            levels: vec![crate::report::header::AttitudeLevel {
                attitude: "Friendly".to_string(),
                factions: vec![crate::report::header::FactionRef {
                    name: "The Guardsmen".to_string(),
                    id: "1".to_string(),
                }],
            }],
        };
        let with = review_turn(
            &friendly,
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let guarded = |review: &TurnReview| {
            review
                .findings
                .iter()
                .filter(|finding| finding.code == codes::TAXED_A_GUARDED_HEX)
                .count()
        };
        assert_eq!(guarded(&without), 1);
        assert_eq!(
            guarded(&with),
            1,
            "declaring them Friendly is our direction, not theirs"
        );
    }

    #[test]
    fn a_hex_with_several_foreign_guards_warns_once_per_order_line() {
        let mut region = guarded_hex(vec![with_silver(unit("683"), 0)]);
        region.units.push(foreign_guard("15"));
        let review = review_turn(
            &report(vec![region]),
            "unit 683\nTAX\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert_eq!(
            review
                .findings
                .iter()
                .filter(|finding| finding.code == codes::TAXED_A_GUARDED_HEX)
                .count(),
            1,
            "per order line, not per guard"
        );
    }

    #[test]
    fn a_unit_doing_neither_is_not_warned() {
        let review = review_turn(
            &report(vec![guarded_hex(vec![
                with_silver(unit("683"), 0),
                with_silver(unit("684"), 0),
            ])]),
            "unit 683\nTAX\n\nunit 684\nMOVE N\n",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        assert!(
            !review
                .findings
                .iter()
                .any(|finding| finding.code == codes::TAXED_A_GUARDED_HEX
                    && finding.unit_id.as_deref() == Some("684")),
            "a mover is not taxing: {:?}",
            codes(&review.findings)
        );
    }

    /// `ah-t2pn.3`. A market's stock is shared: own units buying or selling the same goods in one
    /// hex split what the market will trade, in proportion to what each tried to trade - which is
    /// the rules' own wording for this pool.
    mod shared_market {
        use super::*;

        fn trader(id: &str, horses: i64, silver: i64) -> ReportUnit {
            with_item(with_silver(unit(id), silver), horses, "horse", "HORS")
        }

        fn silver_of(review: &TurnReview, id: &str) -> UnitSilver {
            review
                .silver
                .iter()
                .find(|forecast| forecast.unit_id == id)
                .cloned()
                .unwrap_or_else(|| panic!("no forecast for {id}: {:?}", review.silver))
        }

        fn line(amount: i64, price: i64) -> MarketItem {
            MarketItem {
                amount,
                name: "horse".to_string(),
                tag: "HORS".to_string(),
                price,
            }
        }

        fn market_review(
            wanted: Vec<MarketItem>,
            for_sale: Vec<MarketItem>,
            units: Vec<ReportUnit>,
            orders: &str,
        ) -> TurnReview {
            let hex = ReportRegion {
                wanted,
                for_sale,
                ..region(units)
            };
            review_turn(
                &report(vec![hex]),
                orders,
                Some(&ruleset()),
                CheckOptions::default(),
            )
        }

        /// The bead's headline for the selling side: 100 wanted, 120 offered, and the two figures
        /// now add up to no more than the market will take.
        #[test]
        fn two_sellers_split_what_the_market_will_take() {
            let review = market_review(
                vec![line(100, 60)],
                vec![],
                vec![trader("2390", 60, 0), trader("2391", 60, 0)],
                "unit 2390\nSELL 60 horse\nunit 2391\nSELL 60 horse\n",
            );

            assert_eq!(silver_of(&review, "2390").income, Some(50 * 60));
            assert_eq!(silver_of(&review, "2391").income, Some(50 * 60));
        }

        #[test]
        fn two_sellers_the_market_can_take_from_are_not_divided() {
            let review = market_review(
                vec![line(100, 60)],
                vec![],
                vec![trader("2390", 30, 0), trader("2391", 30, 0)],
                "unit 2390\nSELL 30 horse\nunit 2391\nSELL 30 horse\n",
            );

            assert_eq!(silver_of(&review, "2390").income, Some(30 * 60));
            assert_eq!(silver_of(&review, "2391").income, Some(30 * 60));
        }

        /// A unit cannot sell what it does not hold, so an order for more is not a larger claim
        /// on the market and must not squeeze a faction-mate.
        #[test]
        fn a_sellers_claim_is_capped_by_what_it_holds() {
            let review = market_review(
                vec![line(110, 60)],
                vec![],
                vec![trader("2390", 10, 0), trader("2391", 100, 0)],
                "unit 2390\nSELL 200 horse\nunit 2391\nSELL 100 horse\n",
            );

            // 10 + 100 is exactly what the line takes, so nothing is divided. Had the order for
            // 200 counted as a claim for 200, the pair would have been squeezed to 36 and 73.
            assert_eq!(silver_of(&review, "2390").income, Some(10 * 60));
            assert_eq!(silver_of(&review, "2391").income, Some(100 * 60));
        }

        /// The second defect this bead fixes, and the navigator's decision of 2026-08-23: the
        /// settlement applies whenever anyone trades, not only when two units contend, because
        /// `split_pool` caps a lone claimant exactly as it caps five. Before this, the `BUY` arm
        /// never consulted `market_has` for an exact amount and charged for all 200.
        #[test]
        fn a_buyer_asking_for_more_than_the_market_has_is_charged_for_what_it_gets() {
            let review = market_review(
                vec![],
                vec![line(100, 60)],
                vec![trader("2390", 0, 20_000)],
                "unit 2390\nBUY 200 horse\n",
            );

            assert_eq!(silver_of(&review, "2390").expense, Some(6000));
        }

        #[test]
        fn two_buyers_split_what_the_market_has() {
            let review = market_review(
                vec![],
                vec![line(100, 60)],
                vec![trader("2390", 0, 20_000), trader("2391", 0, 20_000)],
                "unit 2390\nBUY 60 horse\nunit 2391\nBUY 60 horse\n",
            );

            assert_eq!(silver_of(&review, "2390").expense, Some(50 * 60));
            assert_eq!(silver_of(&review, "2391").expense, Some(50 * 60));
        }

        /// An unbounded order attempts to buy everything there is, so that is what it contends
        /// for - stated by the plan rather than derived, because what a `BUY ALL` can afford is
        /// not known until after the settlement has run.
        #[test]
        fn a_buy_all_contends_for_everything_the_market_has() {
            let review = market_review(
                vec![],
                vec![line(100, 60)],
                vec![trader("2390", 0, 20_000), trader("2391", 0, 20_000)],
                "unit 2390\nBUY ALL horse\nunit 2391\nBUY 50 horse\n",
            );

            // 100 wanted against 50: the exact buyer's share is 33, not its full 50.
            assert_eq!(silver_of(&review, "2391").expense, Some(33 * 60));
            let all = silver_of(&review, "2390").expense.expect("priced");
            assert!(
                all / 60 + 33 <= 100,
                "the two together must buy no more than the line holds, got {}",
                all / 60 + 33
            );
        }

        /// The regression net under the case above: a lone `BUY ALL` still buys what it can
        /// afford, up to the whole line, exactly as before.
        #[test]
        fn a_lone_buy_all_is_unchanged() {
            let rich = market_review(
                vec![],
                vec![line(100, 60)],
                vec![trader("2390", 0, 20_000)],
                "unit 2390\nBUY ALL horse\n",
            );
            assert_eq!(silver_of(&rich, "2390").expense, Some(100 * 60));

            let poor = market_review(
                vec![],
                vec![line(100, 60)],
                vec![trader("2390", 0, 600)],
                "unit 2390\nBUY ALL horse\n",
            );
            assert_eq!(silver_of(&poor, "2390").expense, Some(10 * 60));
        }

        #[test]
        fn selling_horses_does_not_contend_with_selling_swords() {
            let hex = ReportRegion {
                wanted: vec![
                    line(100, 60),
                    MarketItem {
                        amount: 100,
                        name: "sword".to_string(),
                        tag: "SWOR".to_string(),
                        price: 30,
                    },
                ],
                ..region(vec![
                    trader("2390", 100, 0),
                    with_item(with_silver(unit("2391"), 0), 100, "sword", "SWOR"),
                ])
            };
            let review = review_turn(
                &report(vec![hex]),
                "unit 2390\nSELL 100 horse\nunit 2391\nSELL 100 sword\n",
                Some(&ruleset()),
                CheckOptions::default(),
            );

            assert_eq!(silver_of(&review, "2390").income, Some(100 * 60));
            assert_eq!(silver_of(&review, "2391").income, Some(100 * 30));
        }

        /// The report prints two lines, so the two sides are two pools.
        #[test]
        fn buying_horses_does_not_contend_with_selling_horses() {
            let review = market_review(
                vec![line(100, 60)],
                vec![line(100, 60)],
                vec![trader("2390", 100, 0), trader("2391", 0, 20_000)],
                "unit 2390\nSELL 100 horse\nunit 2391\nBUY 100 horse\n",
            );

            assert_eq!(silver_of(&review, "2390").income, Some(100 * 60));
            assert_eq!(silver_of(&review, "2391").expense, Some(100 * 60));
        }

        /// A market claim is counted in goods and does not multiply out by headcount, so a
        /// guessed headcount tells us nothing about it - this is what stops `ah-t2pn.1`'s
        /// `Unknowable` rule being copied here on autopilot.
        #[test]
        fn a_guessed_headcount_does_not_doubt_a_market_share() {
            let mut guessed = trader("2391", 60, 0);
            guessed.men_estimated = true;
            let review = market_review(
                vec![line(100, 60)],
                vec![],
                vec![trader("2390", 60, 0), guessed],
                "unit 2390\nSELL 60 horse\nunit 2391\nSELL 60 horse\n",
            );

            let exact = silver_of(&review, "2390");
            assert_eq!(exact.doubt, None);
            assert_eq!(exact.income, Some(50 * 60));
        }

        /// Goods the market does not want still earn nothing, and are not doubted - the
        /// settlement never sees a tag with no market line.
        #[test]
        fn goods_this_market_does_not_want_still_earn_nothing() {
            let review = market_review(
                vec![],
                vec![],
                vec![trader("2390", 60, 0), trader("2391", 60, 0)],
                "unit 2390\nSELL 60 horse\nunit 2391\nSELL 60 horse\n",
            );

            for id in ["2390", "2391"] {
                let row = silver_of(&review, id);
                assert_eq!(row.income, Some(0), "{id}");
                assert_eq!(row.doubt, None, "{id}");
            }
        }

        /// Over several ask/pool combinations, what the two sellers are credited for never adds
        /// up to more than the line will take.
        #[test]
        fn a_market_split_never_sells_more_than_the_line() {
            for (pool, first, second) in [
                (100, 60, 60),
                (100, 10, 10),
                (100, 1, 999),
                (1, 1, 1),
                (7, 3, 5),
                (100, 100, 100),
            ] {
                let review = market_review(
                    vec![line(pool, 60)],
                    vec![],
                    vec![trader("2390", first, 0), trader("2391", second, 0)],
                    &format!("unit 2390\nSELL {first} horse\nunit 2391\nSELL {second} horse\n"),
                );

                let sold = silver_of(&review, "2390").income.expect("priced") / 60
                    + silver_of(&review, "2391").income.expect("priced") / 60;
                assert!(
                    sold <= pool,
                    "{first} + {second} into a line of {pool} sold {sold}"
                );
            }
        }

        #[test]
        fn goods_nothing_could_identify_are_still_doubted() {
            let review = market_review(
                vec![line(100, 60)],
                vec![],
                vec![trader("2390", 60, 0), trader("2391", 60, 0)],
                "unit 2390\nSELL 60 widget\nunit 2391\nSELL 60 widget\n",
            );

            for id in ["2390", "2391"] {
                assert_eq!(
                    silver_of(&review, id).doubt,
                    Some(SilverDoubt::UnknownGoods),
                    "{id}"
                );
            }
        }
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

    /// Enough armed men to pillage a hex of this tax base - the threshold exactly, each with a
    /// sword, which is a weapon anyone may wield (`ah-1ad6.2`).
    fn armed_to_pillage(unit: ReportUnit, tax_base: i64) -> ReportUnit {
        let men = pillage_threshold(tax_base);
        with_item(with_men(unit, men), men, "sword", "SWOR")
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

    // --- how a hex reads one tag (`ah-3ddq`) ----------------------------------------------------
    //
    // `Sharing` is the one home of "does this hex pool this tag?", and these pin the rule directly
    // rather than through a message - four plans in a row assumed a hex is judged unit by unit.

    #[test]
    fn a_hex_with_no_sharing_unit_reads_every_tag_per_unit() {
        let hex_region = region(vec![with_item(unit("1"), 1, "horse", "HORS")]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();

        let sharing = Sharing::read(&hex);

        assert_eq!(sharing.reading("HORS", Some(&rules)), Reading::PerUnit);
        assert_eq!(sharing.reading("HORS", None), Reading::PerUnit);
    }

    #[test]
    fn a_sharing_hex_pools_goods_but_never_men() {
        let hex_region = region(vec![sharing(with_item(unit("1"), 1, "horse", "HORS"))]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();

        let sharing = Sharing::read(&hex);

        assert_eq!(sharing.reading("HORS", Some(&rules)), Reading::Pooled);
        assert_eq!(
            sharing.reading("ORC", Some(&rules)),
            Reading::PerUnit,
            "men are the engine's one exception"
        );
        assert_eq!(
            sharing.reading("ORC", None),
            Reading::Pooled,
            "without a catalogue there is nothing to tell men from anything else"
        );
    }

    /// The verdicts one hex reaches, for a test that wants the reading rather than the message.
    fn verdicts(hex_region: ReportRegion, orders: &str) -> Vec<Verdict> {
        let ordered = OrderedUnits::read(orders);
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let ledger = ledger_for(&hex, Some(&rules));
        let sharing = Sharing::read(&hex);
        judge_shortfalls(&hex, &ledger, &sharing, Some(&rules))
    }

    #[test]
    fn a_hex_that_shares_nothing_names_the_unit_itself() {
        let found = verdicts(
            region(vec![unit("5"), with_item(unit("7"), 20, "swords", "SWOR")]),
            "unit 5\nGIVE 9 30 swords\n",
        );

        assert_eq!(
            found,
            vec![Verdict::UnitShort {
                unit_id: "5".to_string(),
                tag: "SWOR".to_string(),
                short: 30,
            }]
        );
    }

    #[test]
    fn a_hex_that_shares_defers_a_shortfall_to_its_pool() {
        let found = verdicts(
            region(vec![
                unit("5"),
                sharing(with_item(unit("7"), 20, "swords", "SWOR")),
            ]),
            "unit 5\nGIVE 9 30 swords\n",
        );

        assert_eq!(
            found,
            vec![Verdict::DeferredToPool {
                unit_id: "5".to_string(),
                tag: "SWOR".to_string(),
                short: 30,
                claims_pool: true,
            }]
        );
    }

    /// A sharer's own overdraft is already inside the pool's sum, so counting it as a claim as
    /// well would double it - and the `short` in the rendered message would be too large. Pinned
    /// on both sides, the verdict and the sentence.
    #[test]
    fn an_overdrawn_sharer_puts_its_tag_up_for_judgement_and_claims_nothing() {
        let units = || {
            vec![
                sharing(unit("5")),
                sharing(with_item(unit("7"), 20, "swords", "SWOR")),
            ]
        };

        assert_eq!(
            verdicts(region(units()), "unit 5\nGIVE 9 30 swords\n"),
            vec![Verdict::DeferredToPool {
                unit_id: "5".to_string(),
                tag: "SWOR".to_string(),
                short: 30,
                claims_pool: false,
            }]
        );

        let finding = only(check_ignoring_transfer_targets(
            vec![region(units())],
            "unit 5\nGIVE 9 30 swords\n",
        ));
        assert_eq!(
            finding.message,
            "the units in this hex are short 10 swords between them: they can have 20 \
             and their orders spend 30"
        );
    }

    /// One doubted sharer makes the pool's sum untrustworthy, so the whole pooled pass falls
    /// silent - the per-unit pass still runs, so a non-pooled (men) finding survives.
    #[test]
    fn a_doubted_sharer_silences_every_pooled_tag() {
        let hex_region = region(vec![
            unit("5"),
            sharing(with_item(unit("7"), 20, "swords", "SWOR")),
        ]);
        let ordered = OrderedUnits::read("unit 5\nGIVE 9 30 swords\n");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let mut ledger = ledger_for(&hex, Some(&rules));
        let sharing = Sharing::read(&hex);
        let verdicts = judge_shortfalls(&hex, &ledger, &sharing, Some(&rules));

        assert!(
            !pool_shortfalls(&hex, &ledger, &sharing, &verdicts).is_empty(),
            "the hex is genuinely short before anything is doubted"
        );

        ledger.doubted.insert("7".to_string());

        assert_eq!(
            pool_shortfalls(&hex, &ledger, &sharing, &verdicts),
            vec![],
            "one doubted sharer silences the pool"
        );
    }

    /// The third reading: silver, in an unflagged hex, whose whole overdraft is maintenance
    /// nothing in the hex could pay. It is a named verdict rather than a `continue`, and the unit
    /// is deliberately not blamed for it (`ah-e66j`).
    #[test]
    fn an_unflagged_hexs_unpayable_upkeep_is_deferred_to_maintenance() {
        let hex_region = region(vec![with_silver(unit("5"), 0)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let mut ledger = ledger_for(&hex, Some(&rules));

        // What `charge_upkeep` and the sharing pass leave behind for a hex that could not feed
        // itself: a fee nothing paid, drawn straight off the balance, and no `SHARE` flag.
        ledger
            .balance
            .insert(("5".to_string(), SILVER.to_string()), -80);
        ledger.upkeep.insert("5".to_string(), 80);
        ledger.upkeep_drawn.insert("5".to_string(), 80);
        ledger.maintenance_pooled = true;

        let sharing = Sharing::read(&hex);

        assert_eq!(
            judge_shortfalls(&hex, &ledger, &sharing, Some(&rules)),
            vec![Verdict::DeferredToMaintenance {
                unit_id: "5".to_string(),
                short: 80,
            }]
        );
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

    /// The bead's headline (`ah-gjq4`): a unit with no month-long order is set to work, and the
    /// wages it will earn pay its maintenance. Warning that it is short of a fee its own defaulted
    /// month covers is the false alarm this bead exists to stop.
    #[test]
    fn an_idle_units_wages_pay_its_upkeep() {
        let regions = vec![ReportRegion {
            wages: Some("$12.0".to_string()),
            max_wages: Some(1200),
            ..region(vec![with_men(with_silver(starving(unit("5")), 0), 6)])
        }];

        // $60 of upkeep, $72 of wages: nothing to warn about.
        assert!(
            check(regions, "unit 5\n").is_empty(),
            "an idle unit whose wages cover its upkeep is not short"
        );
    }

    /// The message must not name an upkeep the unit's own wages paid, the same way `ah-fjty` stopped
    /// it naming one the unclaimed fund paid: a reader told "its orders and upkeep spend" goes
    /// looking for a charge that is not on the balance. Since `ah-gjq4` an idle unit earns wages, so
    /// this is now the common case rather than a corner of `WORK` (`ah-1wcw.4`).
    #[test]
    fn a_shortfall_does_not_name_an_upkeep_the_wages_paid() {
        let regions = vec![ReportRegion {
            wages: Some("$12.0".to_string()),
            max_wages: Some(1200),
            ..region(vec![with_men(with_silver(starving(unit("5")), 0), 6)])
        }];

        // $60 of upkeep against $72 of defaulted wages, and orders that spend $100 the unit has not
        // got: the shortfall is real and it is the orders' doing alone.
        let finding = only(check(regions, "unit 5\nGIVE 0 100 SILV\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert!(
            !finding.message.contains("upkeep"),
            "the wages paid the fee, so only the orders spend: {}",
            finding.message
        );
    }

    /// A unit whose only order is a line the parser could not read is credited the wages anyway.
    /// `check_idle_units` stays silent about such a unit - an unreadable line may well be a
    /// month's work - and the navigator chose the common case here rather than matching it
    /// (`ah-gjq4`). The accepted cost, recorded deliberately: a unit that is really assassinating
    /// somebody shows income it will not earn.
    #[test]
    fn an_unread_order_line_does_not_stop_the_default() {
        let regions = vec![ReportRegion {
            wages: Some("$12.0".to_string()),
            max_wages: Some(1200),
            ..region(vec![with_men(with_silver(unit("5"), 0), 6)])
        }];
        let report = ParsedReport {
            regions,
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 5\nFLIBBERTIGIBBET\n",
            None,
            CheckOptions::default(),
        );

        let forecast = &review.silver[0];
        assert_eq!(forecast.income, Some(72));
        assert!(forecast.works_by_default);
    }

    /// The other half of the same rule: wages that fall short still leave a real shortfall, and it
    /// is counted net of them rather than ignored.
    #[test]
    fn an_idle_unit_whose_wages_fall_short_is_still_warned() {
        let regions = vec![ReportRegion {
            wages: Some("$1.0".to_string()),
            max_wages: Some(1200),
            ..region(vec![with_men(with_silver(starving(unit("5")), 0), 6)])
        }];

        let finding = only(check(regions, "unit 5\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert!(
            finding.message.contains("$54"),
            "the shortfall is net of the $6 the unit earns: {}",
            finding.message
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
                "unit 5\nSTUDY combat\nunit 7\nSTUDY basketweaving\n"
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

    // --- what a production costs (`ah-19l2.2`) ------------------------------------------------

    /// The forecast for one unit, with the committed ruleset behind it.
    fn forecast_with_ruleset(regions: Vec<ReportRegion>, orders: &str) -> UnitSilver {
        let review = review_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            CheckOptions::default(),
        );
        review
            .silver
            .into_iter()
            .next()
            .expect("one own unit was forecast")
    }

    /// Unit 12881 `Carpenters` in miniature: ten carpenters with materials for two catapults and
    /// silver for one.
    fn carpenters(silver: i64, wood: i64) -> ReportUnit {
        let unit = with_men(
            with_item(
                with_item(
                    with_item(with_silver(unit("12881"), silver), wood, "wood", "WOOD"),
                    999,
                    "ironwood",
                    "IRWD",
                ),
                999,
                "furs",
                "FUR",
            ),
            10,
        );
        with_skill(unit, "CARP", 5)
    }

    #[test]
    fn a_producing_unit_spends_what_its_run_costs() {
        let forecast = forecast_with_ruleset(
            vec![region(vec![carpenters(3000, 9999)])],
            "unit 12881\nPRODUCE catapult\n",
        );

        assert_eq!(
            forecast.expense,
            Some(3000),
            "silver caps it at one catapult"
        );
        assert_eq!(forecast.produced, 1);
        assert_eq!(forecast.produced_name.as_deref(), Some("catapult"));
        assert_eq!(forecast.production_wanted, 2);
        assert_eq!(
            forecast.production_capped_by,
            Some(crate::orders::silver::ProductionCap::Silver)
        );
    }

    #[test]
    fn a_production_at_full_rate_names_no_cap() {
        let forecast = forecast_with_ruleset(
            vec![region(vec![carpenters(100_000, 9999)])],
            "unit 12881\nPRODUCE catapult\n",
        );

        assert_eq!(forecast.expense, Some(6000));
        assert_eq!(forecast.produced, 2);
        assert_eq!(forecast.production_wanted, 2);
        assert_eq!(forecast.production_capped_by, None);
    }

    /// The committed turn's own case: `Carpenters` holds no silver of its own, so it makes none of
    /// the two its men could - and the hover must still be able to say so, which is why the name
    /// survives a cap of zero.
    #[test]
    fn a_unit_capped_to_none_still_names_what_it_would_have_made() {
        let forecast = forecast_with_ruleset(
            vec![region(vec![carpenters(0, 9999)])],
            "unit 12881\nPRODUCE catapult\n",
        );

        assert_eq!(forecast.expense, Some(0));
        assert_eq!(forecast.produced, 0);
        assert_eq!(forecast.production_wanted, 2);
        assert_eq!(forecast.produced_name.as_deref(), Some("catapult"));
        assert_eq!(
            forecast.production_capped_by,
            Some(crate::orders::silver::ProductionCap::Silver)
        );
    }

    #[test]
    fn a_production_the_ruleset_cannot_price_is_doubted() {
        let forecast = forecast_with_ruleset(
            vec![region(vec![carpenters(100_000, 9999)])],
            "unit 12881\nPRODUCE quicksilver\n",
        );

        assert_eq!(forecast.doubt, Some(SilverDoubt::UnpricedProduction));
        assert_eq!(forecast.doubt_subject.as_deref(), Some("quicksilver"));
        assert_eq!(forecast.expense, None);
    }

    /// Cooking states "any of grain, livestock and fish"; which the engine takes cannot be told,
    /// so nothing is priced rather than all three being charged.
    #[test]
    fn a_recipe_of_alternatives_is_doubted_rather_than_guessed() {
        let forecast = forecast_with_ruleset(
            vec![region(vec![carpenters(100_000, 9999)])],
            "unit 12881\nPRODUCE meals\n",
        );

        assert_eq!(forecast.doubt, Some(SilverDoubt::UnpricedProduction));
        assert_eq!(forecast.expense, None);
    }

    /// The run is planned against what the unit *holds*, so a production on its own can never
    /// overdraw - the cap has already seen to that. It bites when something else spends the same
    /// silver first, which is exactly the imprecision the holdings cap accepts: the figure is the
    /// one a player can read off the report, and the ledger's running balance catches the rest.
    #[test]
    fn a_unit_that_cannot_afford_its_production_is_warned() {
        let findings = check_ignoring_transfer_targets(
            vec![region(vec![carpenters(3000, 9999)])],
            "unit 12881\nGIVE 7 3000 SILV\nPRODUCE catapult\n",
        );

        assert_eq!(codes(&findings), ["not-enough-silver"]);
        assert!(
            findings[0].message.contains("3000"),
            "the catapult's own 3000: {}",
            findings[0].message
        );
    }

    /// The same, for the materials: 250 wood given away leaves the catapult short of the wood the
    /// unit's inventory said it had.
    #[test]
    fn a_unit_without_the_materials_is_warned() {
        let findings = check_ignoring_transfer_targets(
            vec![region(vec![carpenters(100_000, 250)])],
            "unit 12881\nGIVE 7 250 WOOD\nPRODUCE catapult\n",
        );

        assert_eq!(codes(&findings), ["not-enough-items"]);
        assert!(
            findings[0].message.contains("wood"),
            "the wood is what ran out: {}",
            findings[0].message
        );
    }

    /// Production resolves in the month's last phase, so what it makes cannot be given away in the
    /// same month - which is the one place `produce` differs from `buy`.
    #[test]
    fn produced_goods_do_not_arrive_in_time_to_be_given_away() {
        let findings = check_ignoring_transfer_targets(
            vec![region(vec![carpenters(100_000, 9999)])],
            "unit 12881\nPRODUCE catapult\nGIVE 1 1 CATP\n",
        );

        assert_eq!(codes(&findings), ["not-enough-items"]);
        assert!(
            findings[0].message.contains("catapult"),
            "{}",
            findings[0].message
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

    /// `check`, with a stated `Unclaimed silver:` figure - the fund step 7 of the payment order
    /// settles the starving units against (`ah-fjty`).
    fn check_with_purse(
        purse: Option<i64>,
        regions: Vec<ReportRegion>,
        orders: &str,
    ) -> Vec<Finding> {
        check_turn(
            &report_with_purse(purse, regions),
            orders,
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
        )
    }

    /// Step 7 of the payment order: "If you have silver in your unclaimed fund, then that silver
    /// will be automatically claimed by units that would otherwise starve." A young faction still
    /// holding its starting silver is the commonest case there is, and warning it that its units
    /// starve is the false alarm `ah-fjty` was filed about.
    #[test]
    fn a_unit_the_unclaimed_fund_can_feed_is_not_warned() {
        let regions = vec![region(vec![with_men(
            with_silver(starving(unit("5")), 0),
            6,
        )])];

        assert_eq!(
            codes(&check_with_purse(Some(8450), regions, "")),
            Vec::<&str>::new()
        );
    }

    /// The fund pays maintenance and nothing else, so a unit that overspends on its orders is
    /// still told so - and told that its *orders* spend it, since its upkeep was paid.
    #[test]
    fn the_fund_pays_the_upkeep_and_the_shopping_is_still_unaffordable() {
        let mut hex = region(vec![with_men(with_silver(starving(unit("5")), 10), 4)]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 70,
        });

        let finding = only(check_with_purse(
            Some(8450),
            vec![hex],
            "unit 5\nBUY 5 horses\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.message,
            "short $340: this unit can have $10 and its orders spend $350"
        );
    }

    /// The fund is faction-wide, so when it cannot reach everybody no unit is more at fault than
    /// the others: every claimant is named and each message states the faction-wide total, exactly
    /// as `claims-exceed-unclaimed` does (`ah-fjty`).
    #[test]
    fn every_unit_is_named_when_the_fund_cannot_feed_them_all() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 0), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
        ])];

        let findings: Vec<Finding> = check_with_purse(Some(100), regions, "")
            .into_iter()
            .filter(|finding| finding.code == codes::UPKEEP_EXCEEDS_UNCLAIMED)
            .collect();

        assert_eq!(findings.len(), 3, "{findings:?}");
        for finding in &findings {
            assert_eq!(
                finding.message,
                "your units owe $160 of upkeep they cannot pay and the faction has $100 unclaimed"
            );
            assert_eq!(
                finding.line, None,
                "maintenance belongs to no order, so there is no line to point at"
            );
        }
        assert_eq!(
            findings
                .iter()
                .filter_map(|finding| finding.unit_id.as_deref())
                .collect::<Vec<_>>(),
            ["5", "7", "9"]
        );
    }

    #[test]
    fn a_fund_that_covers_everybody_names_nobody() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 0), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
        ])];

        assert_eq!(
            codes(&check_with_purse(Some(8450), regions, "")),
            Vec::<&str>::new()
        );
    }

    /// A report whose header states no purse is not evidence of an empty one, so nothing about it
    /// changes - the same reasoning `claims-exceed-unclaimed` gives for declining to fire.
    #[test]
    fn a_report_with_no_unclaimed_line_warns_exactly_as_before() {
        let regions = vec![region(vec![with_men(
            with_silver(starving(unit("5")), 30),
            10,
        )])];

        let finding = only(check_with_purse(None, regions, "unit 5\nWORK\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.message,
            "short $70: this unit can have $30 and its orders and upkeep spend $100"
        );
    }

    /// A stated `$0` is not arbitrary against a stated `$1`: with nothing in the fund every unit's
    /// shortfall is exactly its own, so today's per-unit message is the right one and a broke
    /// faction keeps its line-level marks (`ah-fjty`, round 1 question 3).
    #[test]
    fn an_empty_fund_warns_exactly_as_before() {
        let regions = vec![region(vec![with_men(
            with_silver(starving(unit("5")), 30),
            10,
        )])];

        let finding = only(check_with_purse(Some(0), regions, "unit 5\nWORK\n"));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.message,
            "short $70: this unit can have $30 and its orders and upkeep spend $100"
        );
    }

    /// `CLAIM` resolves during the month and maintenance is settled at its end, so a claim of the
    /// whole fund leaves step 7 nothing - and an emptied fund is inactive, exactly as an unstated
    /// one is (`ah-fjty`, round 2 question 2).
    #[test]
    fn a_claim_of_the_whole_fund_leaves_nothing_for_upkeep() {
        // The claimer stands in a hex of its own: claimed silver is in its possession, so a
        // faction-mate beside it would simply be paid at step 4 and the fund never asked
        // (`ah-e66j`). Separating them keeps this test about the fund.
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unfed(unit("5"))]),
            region_at(
                "1:8,54",
                8,
                54,
                vec![with_men(with_silver(starving(unit("7")), 0), 6)],
            ),
        ];

        let findings = check_with_purse(Some(8450), regions, "unit 5\nCLAIM 8450\n");
        assert_eq!(codes(&findings), ["not-enough-silver"], "{findings:?}");
        assert_eq!(
            findings[0].message,
            "short $60: this unit can have $0 and its orders and upkeep spend $60"
        );
    }

    #[test]
    fn a_partial_claim_leaves_the_rest_for_upkeep() {
        // Separate hexes, for the reason the test above gives.
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unfed(unit("5"))]),
            region_at(
                "1:8,54",
                8,
                54,
                vec![with_men(with_silver(starving(unit("7")), 0), 6)],
            ),
        ];

        let findings: Vec<Finding> = check_with_purse(Some(8450), regions, "unit 5\nCLAIM 8400\n")
            .into_iter()
            .filter(|finding| finding.code == codes::UPKEEP_EXCEEDS_UNCLAIMED)
            .collect();

        let finding = only(findings);
        assert_eq!(
            finding.message,
            "your units owe $60 of upkeep they cannot pay and the faction has $50 unclaimed"
        );
    }

    /// A withdrawal spends the same fund a claim does, so it must leave less of it for step 7 -
    /// without this the settlement would see the whole $8450 and rescue the unit silently
    /// (`ah-tdsi`).
    #[test]
    fn a_withdrawal_leaves_less_of_the_fund_for_upkeep() {
        // Separate hexes: since `ah-e66j` a faction-mate in the same hex lends its silver for
        // maintenance, SHARE flag or not, and would pay this unit's fee before the fund was asked.
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unfed(unit("5"))]),
            region_at(
                "1:8,54",
                8,
                54,
                vec![with_men(with_silver(starving(unit("7")), 0), 6)],
            ),
        ];

        let findings: Vec<Finding> =
            check_with_purse(Some(14850), regions, "unit 5\nWITHDRAW 400 grain\n")
                .into_iter()
                .filter(|finding| finding.code == codes::UPKEEP_EXCEEDS_UNCLAIMED)
                .collect();

        let finding = only(findings);
        assert_eq!(
            finding.message,
            "your units owe $60 of upkeep they cannot pay and the faction has $50 unclaimed"
        );
    }

    /// The other half of `ah-tdsi`'s decline-over-guess rule, and the half a zero-fallback would
    /// pass: a fund whose withdrawals nothing can price cannot be sized, so it is not spent on
    /// upkeep at all and the unit it would have rescued is warned as it was before `ah-fjty`.
    /// Treating the unknown total as zero would leave the whole $8450 in play and silence this.
    #[test]
    fn an_unpriceable_withdrawal_leaves_the_upkeep_settlement_inactive() {
        // Separate hexes, for the reason `a_withdrawal_leaves_less_of_the_fund_for_upkeep` gives.
        let starving_hex = || {
            vec![
                region_at("1:7,53", 7, 53, vec![unfed(unit("5"))]),
                region_at(
                    "1:8,54",
                    8,
                    54,
                    vec![with_men(with_silver(starving(unit("7")), 0), 6)],
                ),
            ]
        };

        assert_eq!(
            codes(&check_with_purse(
                Some(8450),
                starving_hex(),
                "unit 5\nWITHDRAW 1 longship\n"
            )),
            ["not-enough-silver"],
            "the fund cannot be sized, so it cannot be spent"
        );

        // The control: the same fund, a withdrawal the ruleset *can* price, and the unit is
        // rescued exactly as `ah-fjty` shipped it.
        assert_eq!(
            codes(&check_with_purse(
                Some(8450),
                starving_hex(),
                "unit 5\nWITHDRAW 1 grain\n"
            )),
            [] as [&str; 0],
            "a fund that can be sized still pays the upkeep"
        );
    }

    /// The fund pays maintenance and only maintenance: a unit with no fee at all that overspends
    /// on its orders is warned exactly as it was before this bead.
    #[test]
    fn the_fund_never_pays_for_orders() {
        let mut hex = region(vec![with_silver(unit("5"), 100)]);
        hex.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 70,
        });

        let finding = only(check_with_purse(
            Some(8450),
            vec![hex],
            "unit 5\nBUY 2 horses\n",
        ));
        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.message,
            "short $40: this unit can have $100 and its orders spend $140"
        );
    }

    /// A guessed headcount is charged nothing by `charge_upkeep`, so it has no shortfall to claim -
    /// and a fund too small for the rest is still judged without it.
    #[test]
    fn a_guessed_headcount_does_not_claim_from_the_fund() {
        let mut guessed = with_men(with_silver(starving(unit("5")), 0), 6);
        guessed.men_estimated = true;
        let regions = vec![region(vec![
            guessed,
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
        ])];

        let findings: Vec<Finding> = check_with_purse(Some(60), regions, "")
            .into_iter()
            .filter(|finding| finding.code == codes::UPKEEP_EXCEEDS_UNCLAIMED)
            .collect();

        assert_eq!(
            findings
                .iter()
                .filter_map(|finding| finding.unit_id.as_deref())
                .collect::<Vec<_>>(),
            ["7", "9"],
            "the guessed unit takes no part: {findings:?}"
        );
        assert_eq!(
            findings[0].message,
            "your units owe $100 of upkeep they cannot pay and the faction has $60 unclaimed",
            "the guessed unit's own $60 is no part of the total either"
        );
    }

    /// `ah-fjty`, round 1 question 1: the column and the warning both move. A unit the fund feeds
    /// shows an `Upkeep` of 0, and says separately what paid it - a zero with nothing to explain it
    /// reads as a defect.
    #[test]
    fn a_unit_the_fund_feeds_shows_no_upkeep() {
        let report = report_with_purse(
            Some(8450),
            vec![region(vec![with_men(
                with_silver(starving(unit("5")), 0),
                6,
            )])],
        );

        let review = review_turn(&report, "", Some(&ruleset()), CheckOptions::default());

        let forecast = &review.silver[0];
        assert_eq!(forecast.upkeep, Some(0));
        assert_eq!(forecast.unclaimed_covered, 60);
        assert!(!forecast.unclaimed_contended);
    }

    /// Round 2 question 1: when the fund cannot reach everybody the figure stays where it is, in
    /// red, and only the hover's note changes. The pessimistic answer, and the navigator's - a `?`
    /// in every short unit's column at once is less useful than a number.
    #[test]
    fn a_contended_fund_leaves_the_upkeep_where_it_is() {
        let report = report_with_purse(
            Some(100),
            vec![region(vec![
                with_men(with_silver(starving(unit("5")), 0), 6),
                with_men(with_silver(starving(unit("7")), 0), 6),
            ])],
        );

        let review = review_turn(&report, "", Some(&ruleset()), CheckOptions::default());

        for forecast in &review.silver {
            assert_eq!(forecast.upkeep, Some(60), "{}", forecast.unit_id);
            assert_eq!(forecast.unclaimed_covered, 0);
            assert!(forecast.unclaimed_contended);
            assert!(
                forecast.doubt.is_none(),
                "no new doubt: the figure on show is exact, merely pessimistic"
            );
        }
    }

    /// The relief is applied to every hex, not merely the first: a fund that reaches two starving
    /// units in two different regions silences both.
    #[test]
    fn the_relief_reaches_every_hex_the_claimants_stand_in() {
        let regions = vec![
            region_at(
                "1:7,53",
                7,
                53,
                vec![with_men(with_silver(starving(unit("5")), 0), 6)],
            ),
            region_at(
                "1:8,54",
                8,
                54,
                vec![with_men(with_silver(starving(unit("7")), 0), 4)],
            ),
        ];

        let report = report_with_purse(Some(8450), regions);
        let review = review_turn(
            &report,
            "",
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
        );

        assert_eq!(codes(&review.findings), Vec::<&str>::new());
        assert_eq!(
            review
                .silver
                .iter()
                .map(|unit| unit.unclaimed_covered)
                .collect::<Vec<_>>(),
            [60, 40],
            "both regions, not just the first"
        );
    }

    /// The claim is the smaller of what maintenance drew and what the unit is actually overdrawn
    /// by, and this is the case where the *overdraft* is the smaller of the two: the unit pays
    /// half its own fee out of what it holds, so only the remainder is the fund's to pay.
    #[test]
    fn a_unit_that_part_pays_its_own_fee_claims_only_the_rest() {
        let regions = vec![region(vec![with_men(
            with_silver(starving(unit("5")), 30),
            6,
        )])];

        let report = report_with_purse(Some(8450), regions);
        let review = review_turn(
            &report,
            "",
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
        );

        assert_eq!(codes(&review.findings), Vec::<&str>::new());
        assert_eq!(
            review.silver[0].unclaimed_covered, 30,
            "$30 of the $60 fee, because the unit's own $30 pays the other half"
        );
        assert_eq!(review.silver[0].upkeep, Some(30));
    }

    /// A unit whose faction-mates' *silver* already pays its maintenance is no claimant on the
    /// fund, exactly as one its faction-mates' grain feeds is not (`ah-7cdt`). `report_shortfalls`
    /// judges a hex holding a sharing unit as one purse and says nothing about the penniless unit
    /// beside the rich one; a fund pass reading each unit's own balance would invent a claimant
    /// there, and - worse - its phantom claim would exhaust the fund and deny a real claimant
    /// elsewhere the rescue this bead exists to give.
    #[test]
    fn a_unit_the_hexs_shared_silver_pays_for_claims_nothing_from_the_fund() {
        let regions = vec![
            region_at(
                "1:7,53",
                7,
                53,
                vec![
                    sharing(unfed(unit("5"))),
                    with_men(with_silver(starving(unit("7")), 0), 6),
                ],
            ),
            region_at(
                "1:8,54",
                8,
                54,
                vec![with_men(with_silver(starving(unit("9")), 0), 4)],
            ),
        ];

        let findings = check_with_purse(Some(50), regions, "");

        assert_eq!(
            codes(&findings),
            Vec::<&str>::new(),
            "unit 7 is paid for by unit 5's shared silver, so the fund's $50 reaches unit 9's \
             $40 whole: {findings:?}"
        );
    }

    /// The fund is one pool for the whole report, so it is counted once across every hex. A
    /// per-hex settlement passes every other test here and fails this one.
    #[test]
    fn the_fund_is_counted_once_across_several_hexes() {
        let regions = vec![
            region_at(
                "1:7,53",
                7,
                53,
                vec![with_men(with_silver(starving(unit("5")), 0), 6)],
            ),
            region_at(
                "1:8,54",
                8,
                54,
                vec![with_men(with_silver(starving(unit("7")), 0), 6)],
            ),
            region_at(
                "1:9,55",
                9,
                55,
                vec![with_men(with_silver(starving(unit("9")), 0), 6)],
            ),
        ];

        let findings: Vec<Finding> = check_with_purse(Some(100), regions, "")
            .into_iter()
            .filter(|finding| finding.code == codes::UPKEEP_EXCEEDS_UNCLAIMED)
            .collect();

        assert_eq!(findings.len(), 3, "{findings:?}");
        assert_eq!(
            findings[0].message,
            "your units owe $180 of upkeep they cannot pay and the faction has $100 unclaimed",
            "one fund for the whole report, not $100 per hex"
        );
    }

    /// `ah-fjty`: the fee and the overdraft it can be blamed for are different numbers for any
    /// unit that works or entertains, and the unclaimed fund settles the second, never the first.
    #[test]
    fn the_ledger_separates_the_fee_from_what_it_drew_off_the_balance() {
        let mut hex = region(vec![with_men(with_silver(starving(unit("5")), 0), 6)]);
        hex.wages = Some("$12.0".to_string());
        hex.max_wages = Some(40);

        let ordered = OrderedUnits::read("unit 5\nWORK\n");
        let read = Hex::read(&hex, &ordered);
        let rules = ruleset();
        let ledger = ledger_for(&read, Some(&rules));

        assert_eq!(ledger.upkeep.get("5"), Some(&60), "the whole fee");
        assert_eq!(
            ledger.upkeep_drawn.get("5"),
            Some(&20),
            "only what the wages could not cover reached the balance"
        );
    }

    // --- step 4: a faction-mate's silver pays the upkeep, SHARE or not (`ah-e66j`) --------------

    /// The lender's own balance has to fall by what it lent, or the same silver pays a
    /// neighbour's fee here and is still counted into `report_shortfalls`'s `SHARE` pool for
    /// somebody's orders. `silver_balance` is the single place that reconciles it (`ah-e66j`).
    #[test]
    fn silver_lent_for_upkeep_leaves_the_lender_that_much_poorer() {
        let hex_region = region(vec![with_silver(unit("5"), 100)]);
        let ordered = OrderedUnits::read("");
        let hex = Hex::read(&hex_region, &ordered);
        let rules = ruleset();
        let mut ledger = ledger_for(&hex, Some(&rules));

        let before = silver_balance(&ledger, "5");
        ledger.upkeep_lent.insert("5".to_string(), 40);

        assert_eq!(silver_balance(&ledger, "5"), before - 40);
    }

    /// The bead's own acceptance criterion. The rules share maintenance money "automatically
    /// between your units in the same region", so a penniless unit beside a rich faction-mate is
    /// not starving - **and nothing in this hex carries the `SHARE` flag** (`ah-e66j`).
    #[test]
    fn a_broke_unit_is_not_warned_when_a_faction_mate_holds_enough() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 0), 6),
            with_silver(starving(unit("7")), 1000),
        ])];

        let findings = check(regions, "");

        assert_eq!(
            codes(&findings),
            Vec::<&str>::new(),
            "unit 7's silver pays unit 5's upkeep with no SHARE flag anywhere: {findings:?}"
        );
    }

    /// A lender's silver is spent exactly once. Without `upkeep_lent`, the same silver pays a
    /// neighbour's fee at step 4 *and* is still counted into `report_shortfalls`'s `SHARE` pool
    /// for somebody's orders (`ah-e66j`).
    ///
    /// Unit 5 holds $1000, owes $10 of its own and lends $70 at step 4 - $60 to unit 7 and $10 to
    /// unit 9 - leaving a `SHARE` pool of $920 against unit 9's $1010 of horse and fee. The hex is
    /// therefore short $80; counting the loan twice would make it $10.
    #[test]
    fn a_lender_cannot_spend_the_same_silver_twice() {
        let mut hex_region = region(vec![
            sharing(with_silver(starving(unit("5")), 1000)),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_silver(starving(unit("9")), 0),
        ]);
        hex_region.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 1000,
        });

        let findings: Vec<Finding> = check(vec![hex_region], "unit 9\nBUY 1 horse\n")
            .into_iter()
            .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
            .collect();

        let finding = only(findings);
        assert_eq!(
            finding.message,
            "the units in this hex are short $80 between them: they can have $1000 and their \
             orders and upkeep spend $1080"
        );
    }

    /// A hex that genuinely cannot pay its maintenance is marked **once**, at hex level, with no
    /// unit named: which of several claimants the engine feeds cannot be told, and four marks for
    /// one problem - each naming a unit that may well be the one that gets fed - is four wrong
    /// answers (`ah-e66j`, round 1 question 3).
    #[test]
    fn a_hex_that_cannot_pay_its_maintenance_is_marked_once() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 120), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
            with_men(with_silver(starving(unit("11")), 0), 4),
        ])];

        let finding = only(check(regions, ""));

        assert_eq!(finding.code.as_str(), "not-enough-silver");
        assert_eq!(
            finding.unit_id, None,
            "the hex is short, not any unit in it"
        );
        assert_eq!(finding.line, None, "maintenance belongs to no order");
    }

    /// And every figure in such a hex stays where step 4 found it: which unit the pool fed cannot
    /// be told, so no unit's `Upkeep` drops. The same posture `food_contended` and
    /// `unclaimed_contended` already take (`ah-e66j`).
    #[test]
    fn a_short_hex_keeps_its_pessimistic_figures() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 120), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
            with_men(with_silver(starving(unit("11")), 0), 4),
        ])];

        let review = review_turn(
            &report(regions),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        for (id, owed) in [("7", 60), ("9", 40), ("11", 40)] {
            let forecast = forecast(&review, id);
            assert_eq!(forecast.shared_silver_covered, 0, "{id}");
            assert_eq!(forecast.upkeep, Some(owed), "{id}");
        }
    }

    /// Step 4 hands what it could not pay on to steps 5 and 6, exactly as its own silver does: a
    /// short hex with grain in it still eats the grain (`ah-e66j`).
    #[test]
    fn a_short_hex_still_reaches_food() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 120), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
            with_item(
                with_men(with_silver(starving(unit("11")), 0), 4),
                1,
                "grain",
                "GRAI",
            ),
        ])];

        let review = review_turn(
            &report(regions),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        // Unit 5's own $60 fee leaves $60 of its $120 to lend, and unit 7 takes all of it, so
        // units 9 and 11 are the ones step 4 cannot reach - and
        // its own grain is eaten at step 5 exactly as it would be in a hex with nobody to lend.
        assert_eq!(
            forecast(&review, "11").own_food_covered,
            40,
            "{:?}",
            forecast(&review, "11")
        );
    }

    /// The half of the rule that must not regress. Automatic sharing is confined to maintenance -
    /// "this sharing of money applies only for maintenance costs, and does not occur for other
    /// purposes" - so a study nobody can afford is still reported in a hex with no `SHARE` flag,
    /// however rich the unit beside it (`ah-e66j`).
    #[test]
    fn orders_are_not_shared_without_the_flag() {
        let regions = vec![region(vec![
            with_silver(unit("5"), 0),
            with_silver(unit("7"), 5000),
        ])];

        let findings = check(regions, "unit 5\nSTUDY combat\n");

        assert_eq!(
            codes(&findings),
            ["not-enough-silver"],
            "unit 7 lends for upkeep and for nothing else: {findings:?}"
        );
        assert_eq!(findings[0].unit_id.as_deref(), Some("5"));
    }

    /// A hex with no `SHARE` flag pools for maintenance and for nothing else, so its shortfall
    /// message must not name orders that were never pooled (`ah-e66j`, round 2 question 2).
    #[test]
    fn a_short_maintenance_pool_says_upkeep() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 120), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
            with_men(with_silver(starving(unit("11")), 0), 4),
        ])];

        assert_eq!(
            only(check(regions, "")).message,
            "the units in this hex are short $80 of upkeep between them: they can have $120 and \
             their upkeep costs $200"
        );
    }

    /// A `SHARE` hex pools orders too, so it keeps the sentence it has always had.
    #[test]
    fn a_share_hex_keeps_its_orders_and_upkeep_wording() {
        let mut hex_region = region(vec![
            sharing(with_men(with_silver(starving(unit("5")), 120), 6)),
            with_men(with_silver(starving(unit("7")), 0), 6),
        ]);
        hex_region.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 140,
        });

        let findings: Vec<Finding> = check(vec![hex_region], "unit 7\nBUY 1 horse\n")
            .into_iter()
            .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
            .collect();

        assert!(
            only(findings)
                .message
                .contains("their orders and upkeep spend"),
            "a SHARE hex pools orders as well, so the wording stands"
        );
    }

    /// `upkeep_relieved` has three writers now - step 4, steps 5 and 6, then step 7 - and every one
    /// of them must add. Step 7 overwrote, which was survivable while a unit rarely reached it with
    /// relief already recorded; step 4 makes that routine, because a pool that covers *part* of a
    /// claim hands the rest straight to the fund (`ah-e66j`).
    ///
    /// Unit 5's spare $40 pays $40 of unit 7's $60 fee and the fund pays the last $20. Overwriting
    /// leaves unit 7 recorded as relieved of $20 rather than $60 and invents a shortfall in a hex
    /// that paid for itself.
    #[test]
    fn step_seven_adds_its_relief_to_step_fours_rather_than_replacing_it() {
        let regions = vec![region(vec![
            with_men(with_silver(starving(unit("5")), 100), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
        ])];

        let findings = check_with_purse(Some(20), regions, "");

        assert_eq!(
            codes(&findings),
            Vec::<&str>::new(),
            "$120 of silver against $120 of upkeep is not short of anything: {findings:?}"
        );
    }

    /// A hex short of maintenance still names the unit that overspends on its *orders*. Pooling the
    /// hex's whole silver would lose that unit's name and its line, and would tell the player a
    /// faction-mate's $120 was available to its purchase - which without `SHARE` it is not
    /// (`ah-e66j`, out of scope: "sharing for anything but maintenance").
    #[test]
    fn a_short_maintenance_hex_still_names_a_unit_that_overspends() {
        let mut hex_region = region(vec![
            with_men(with_silver(starving(unit("5")), 120), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
            with_silver(starving(unit("11")), 0),
        ]);
        hex_region.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 300,
        });

        let findings: Vec<Finding> = check(vec![hex_region], "unit 11\nBUY 1 horse\n")
            .into_iter()
            .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
            .collect();

        let named: Vec<&Finding> = findings
            .iter()
            .filter(|finding| finding.unit_id.is_some())
            .collect();
        assert_eq!(named.len(), 1, "{findings:?}");
        assert_eq!(named[0].unit_id.as_deref(), Some("11"));
        assert!(
            named[0].line.is_some(),
            "and it still points at the order that spent it"
        );
    }

    /// The hex sentence's arithmetic is about maintenance and nothing else, so an order spending
    /// silver in the same hex must not turn up inside the quoted fee (`ah-e66j`).
    #[test]
    fn an_order_in_the_hex_is_no_part_of_what_upkeep_costs() {
        let mut hex_region = region(vec![
            with_men(with_silver(starving(unit("5")), 120), 6),
            with_men(with_silver(starving(unit("7")), 0), 6),
            with_men(with_silver(starving(unit("9")), 0), 4),
            with_men(with_silver(starving(unit("11")), 0), 4),
        ]);
        hex_region.for_sale.push(MarketItem {
            amount: 10,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 20,
        });

        let findings: Vec<Finding> = check(vec![hex_region], "unit 5\nBUY 1 horse\n")
            .into_iter()
            .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
            .collect();

        // The four fees are $200 between them; the $20 horse is not one of them.
        assert_eq!(
            only(findings).message,
            "the units in this hex are short $100 of upkeep between them: they can have $100 and \
             their upkeep costs $200"
        );
    }

    // --- steps 5 and 6: food pays what silver could not (`ah-eacd`) -----------------------------

    /// A unit holding food, with no `CONSUME` flag and no silver. Steps 5 and 6 apply to every
    /// unit, so its grain pays the fee and the column must say so.
    #[test]
    fn a_unit_holding_food_and_no_silver_is_not_left_owing() {
        let hex = region(vec![with_item(
            with_men(with_silver(starving(unit("5")), 0), 6),
            2,
            "grain",
            "GRAI",
        )]);

        let review = review_turn(
            &report(vec![hex]),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let forecast = &review.silver[0];
        assert_eq!(forecast.upkeep, Some(0));
        assert_eq!(forecast.own_food_covered, 60);
        assert_eq!(forecast.forced_own_food, 2);
        assert_eq!(forecast.forced_own_food_tag.as_deref(), Some("GRAI"));
    }

    /// The flag's ordering effect, which must not regress: a unit that can pay in silver pays in
    /// silver and keeps its food.
    #[test]
    fn a_unit_that_can_pay_in_silver_keeps_its_food() {
        let hex = region(vec![with_item(
            with_men(with_silver(starving(unit("5")), 500), 6),
            2,
            "grain",
            "GRAI",
        )]);

        let review = review_turn(
            &report(vec![hex]),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let forecast = &review.silver[0];
        assert_eq!(forecast.upkeep, Some(60));
        assert_eq!(forecast.forced_own_food, 0);
        assert_eq!(forecast.own_food_covered, 0);
    }

    /// Round 2: which items a mixed larder gives up is not knowable, so they are counted and not
    /// named.
    #[test]
    fn a_mixed_larder_is_counted_and_not_named() {
        let hex = region(vec![with_item(
            with_item(
                with_men(with_silver(starving(unit("5")), 0), 12),
                1,
                "grain",
                "GRAI",
            ),
            3,
            "livestock",
            "LIVE",
        )]);

        let review = review_turn(
            &report(vec![hex]),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let forecast = &review.silver[0];
        assert_eq!(forecast.forced_own_food, 3);
        assert_eq!(forecast.forced_own_food_tag, None);
    }

    /// Round 3: step 6 is flag-blind. A `CONSUME UNIT` unit that ate its own food at step 1 and
    /// then ran out of silver still reaches a neighbour's larder, just later than a
    /// `CONSUME FACTION` one would.
    #[test]
    fn a_consume_unit_unit_reaches_faction_food_at_step_six() {
        let mut eater = with_men(with_silver(starving(unit("5")), 0), 6);
        eater.flags.push("consuming unit's food".to_string());
        // The neighbour's grain is the point; it holds only what its own fee costs, because a
        // neighbour with spare silver now pays unit 5 at step 4 and no grain is ever eaten
        // (`ah-e66j`).
        let neighbour = with_item(
            with_men(with_silver(starving(unit("7")), 20), 2),
            2,
            "grain",
            "GRAI",
        );

        let review = review_turn(
            &report(vec![region(vec![eater, neighbour])]),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let forecast = &review.silver[0];
        assert_eq!(forecast.unit_id, "5");
        assert_eq!(forecast.upkeep, Some(0));
        assert_eq!(forecast.forced_faction_food, 2);
        assert_eq!(forecast.faction_food_covered, 60);
    }

    /// The warning must go with the figure: a unit its own food will feed is not short of silver.
    #[test]
    fn a_unit_its_own_food_will_feed_is_not_warned() {
        let hex = region(vec![with_item(
            with_men(with_silver(starving(unit("5")), 0), 6),
            2,
            "grain",
            "GRAI",
        )]);

        assert_eq!(codes(&check(vec![hex], "")), [] as [&str; 0]);
    }

    /// Round 3: a short remaining pool warns nobody, and leaves every figure where step 5 left it.
    #[test]
    fn a_unit_a_short_pool_might_feed_is_not_warned_either() {
        let hex = region(vec![
            // Only what its own fee costs: spare silver is lent at step 4 and the pool is never
            // reached (`ah-e66j`).
            with_item(
                with_men(with_silver(starving(unit("2")), 20), 2),
                1,
                "grain",
                "GRAI",
            ),
            with_men(with_silver(starving(unit("5")), 0), 6),
            with_men(with_silver(starving(unit("7")), 0), 8),
        ]);

        let review = review_turn(
            &report(vec![hex.clone()]),
            "",
            Some(&ruleset()),
            CheckOptions::default(),
        );

        for id in ["5", "7"] {
            let unit = forecast(&review, id);
            assert!(unit.food_contended, "{id}: {unit:?}");
            assert_eq!(unit.faction_food_covered, 0, "{id}");
        }
        assert_eq!(forecast(&review, "5").upkeep, Some(60), "the figure stands");
        assert_eq!(codes(&check(vec![hex], "")), [] as [&str; 0]);
    }

    /// The relief is maintenance's alone: a unit whose food pays its whole fee and whose orders
    /// still overspend is warned about its orders.
    #[test]
    fn a_unit_whose_orders_overspend_is_still_warned() {
        let hex = region(vec![with_item(
            with_men(with_silver(starving(unit("5")), 10), 6),
            2,
            "grain",
            "GRAI",
        )]);

        let findings = check(vec![hex], "unit 5\nSTUDY combat\n");
        let short: Vec<&Finding> = findings
            .iter()
            .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
            .collect();

        assert_eq!(short.len(), 1, "{findings:?}");
        assert!(
            !short[0].message.contains("upkeep"),
            "maintenance its grain paid is no part of the blame: {}",
            short[0].message
        );
    }

    /// A unit made of leaders, which owe $50 each rather than $10, for the maintenance rules.
    fn with_leaders(mut unit: ReportUnit, count: i64) -> ReportUnit {
        unit.men = count;
        unit.men_by_race = vec![ItemAmount {
            amount: count,
            name: "leader".to_string(),
            tag: "LEAD".to_string(),
        }];
        unit
    }

    /// `ah-uwa3`: wages arrive in the turn's last phase, which is late for everything the orders
    /// spend but in time for maintenance. A leader whose $50 fee its wages cover is not short.
    #[test]
    fn wages_pay_this_units_maintenance() {
        let mut hex = region(vec![with_leaders(starving(unit("5")), 1)]);
        hex.wages = Some("$120.0".to_string());
        hex.max_wages = Some(300);

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nWORK\n")),
            [] as [&str; 0],
            "$120 of wages covers the $50 fee"
        );
    }

    /// The other side of the same rule: wages that fall short of the fee still warn.
    #[test]
    fn wages_that_do_not_cover_maintenance_still_warn() {
        let mut hex = region(vec![with_leaders(starving(unit("5")), 4)]);
        hex.wages = Some("$30.0".to_string());
        hex.max_wages = Some(300);

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nWORK\n")),
            ["not-enough-silver"],
            "$120 of wages against a $200 fee leaves $80 owing"
        );
    }

    /// And the fix must not leak: wages still pay for nothing the orders spend.
    #[test]
    fn wages_still_cannot_pay_for_an_order() {
        let mut hex = region(vec![with_men(with_silver(unit("5"), 0), 10)]);
        hex.wages = Some("$12.0".to_string());
        hex.max_wages = Some(300);

        assert_eq!(
            codes(&check(vec![hex], "unit 5\nWORK\nSTUDY combat\n")),
            ["not-enough-silver"]
        );
    }

    /// `ah-uwa3`: the column and the check, on one fixture, about the same unit.
    ///
    /// The two systems drifted apart for a whole epic because each had a test pinning its own
    /// answer and nothing compared them. A unit buying on wages it cannot spend yet must be
    /// *both* short in the column and warned about by the check.
    #[test]
    fn the_column_and_the_check_agree_about_a_purchase_funded_by_wages() {
        let mut hex = region(vec![with_men(with_silver(unit("5"), 0), 10)]);
        hex.wages = Some("$12.0".to_string());
        hex.max_wages = Some(300);
        hex.for_sale.push(MarketItem {
            amount: 40,
            name: "horse".to_string(),
            tag: "HORS".to_string(),
            price: 12,
        });

        let review = review_turn(
            &report(vec![hex]),
            "unit 5\nWORK\nBUY 5 horses\n",
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
        );

        let unit = review
            .silver
            .iter()
            .find(|entry| entry.unit_id == "5")
            .expect("the unit is forecast");
        assert_eq!(unit.income, Some(120), "wages, all of them late");
        assert_eq!(unit.late_income, Some(120));
        assert_eq!(
            unit.at_month_end,
            Some(60),
            "the month still ends in credit"
        );
        assert_eq!(
            unit.short_for_orders,
            Some(60),
            "and none of it can reach the purchase"
        );
        assert_eq!(
            codes(&review.findings),
            ["not-enough-silver"],
            "so the check must say so too"
        );
    }

    /// `ah-tdsi`: the faction's unclaimed fund pays for a withdrawal, so the withdrawing unit's own
    /// silver is untouched and a unit holding nothing at all is not warned.
    #[test]
    fn a_withdrawing_unit_is_charged_nothing() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nWITHDRAW 10 grain\n"
            )),
            [] as [&str; 0],
            "the fund pays for the grain, so this unit spends nothing"
        );
    }

    /// The bead's headline: a unit one silver short of what the withdrawal used to cost it is not
    /// short of anything at all, because the withdrawal was never its to pay for (`ah-tdsi`).
    #[test]
    fn a_withdrawing_unit_that_could_not_pay_is_no_longer_warned() {
        assert_eq!(
            codes(&check(
                vec![region(vec![with_silver(unit("5"), 369)])],
                "unit 5\nWITHDRAW 10 grain\n"
            )),
            [] as [&str; 0],
            "$369 is not short of a bill this unit never gets"
        );
    }

    /// A withdrawal the ruleset cannot price used to mark the unit `doubted`, which silenced every
    /// finding about it - including ones with nothing to do with withdrawing (`ah-tdsi`).
    #[test]
    fn an_unpriceable_withdrawal_no_longer_silences_the_units_other_findings() {
        assert_eq!(
            check_ignoring_transfer_targets(
                vec![region(vec![with_silver(unit("5"), 0)])],
                "unit 5\nWITHDRAW 1 longship\nGIVE 7 100 SILV\n"
            )
            .into_iter()
            .map(|finding| finding.code)
            .collect::<Vec<_>>(),
            vec![codes::NOT_ENOUGH_SILVER],
            "the gift is still $100 more than this unit holds"
        );
    }

    /// A withdrawal beside a purchase the unit genuinely cannot afford: the warning must still fire,
    /// and name only the purchase's figures (`ah-tdsi`).
    #[test]
    fn a_unit_that_withdraws_and_overspends_is_still_warned_for_the_overspend() {
        let findings = check(
            vec![region(vec![with_silver(unit("5"), 0)])],
            "unit 5\nWITHDRAW 10 grain\nGIVE 7 100 SILV\n",
        );
        let messages: Vec<&str> = findings
            .iter()
            .filter(|finding| finding.code == codes::NOT_ENOUGH_SILVER)
            .map(|finding| finding.message.as_str())
            .collect();
        assert_eq!(messages.len(), 1, "{findings:?}");
        assert!(
            messages[0].contains("100"),
            "the gift is what it is short of: {}",
            messages[0]
        );
        assert!(
            !messages[0].contains("370") && !messages[0].contains("470"),
            "and the withdrawal is no part of the sum: {}",
            messages[0]
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
                "unit 5\nGIVE 9 30 swords\nunit 7\nSTUDY basketweaving\n"
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

    // --- claims against the faction's purse ----------------------------------------------------

    /// `report`, with a stated (or deliberately absent) `Unclaimed silver:` figure - the one thing
    /// `claims-exceed-unclaimed` reads besides the orders themselves.
    fn report_with_purse(purse: Option<i64>, regions: Vec<ReportRegion>) -> ParsedReport {
        ParsedReport {
            header: crate::report::header::ReportHeader {
                unclaimed_silver: purse,
                ..Default::default()
            },
            regions,
            ..Default::default()
        }
    }

    /// The claim check on its own, with the unrelated defaults out of the way.
    fn check_claims_of(
        purse: Option<i64>,
        regions: Vec<ReportRegion>,
        orders: &str,
    ) -> Vec<Finding> {
        check_turn(
            &report_with_purse(purse, regions),
            orders,
            Some(&ruleset()),
            disabling(codes::UNIT_DOES_NOTHING),
        )
        .into_iter()
        .filter(|finding| finding.code == codes::CLAIMS_EXCEED_UNCLAIMED)
        .collect()
    }

    #[test]
    fn a_faction_claiming_more_than_it_holds_is_warned() {
        let findings = check_claims_of(
            Some(4935),
            vec![region(vec![unit("500"), unit("700")])],
            "unit 500\nCLAIM 3000\nunit 700\nCLAIM 2000\n",
        );

        assert_eq!(findings.len(), 2, "both claiming units: {findings:?}");
        assert_eq!(
            findings
                .iter()
                .map(|finding| finding.unit_id.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("500"), Some("700")]
        );
        for finding in &findings {
            assert_eq!(
                finding.message,
                "your units claim and withdraw $5000 between them and the faction has $4935"
            );
        }
        assert_eq!(findings[0].line, Some(2));
        assert_eq!(findings[1].line, Some(4));
    }

    #[test]
    fn claims_within_the_purse_are_not_warned_about() {
        assert!(check_claims_of(
            Some(4935),
            vec![region(vec![unit("500"), unit("700")])],
            "unit 500\nCLAIM 3000\nunit 700\nCLAIM 1000\n",
        )
        .is_empty());
    }

    #[test]
    fn claims_exactly_matching_the_purse_are_not_warned_about() {
        assert!(check_claims_of(
            Some(4000),
            vec![region(vec![unit("500"), unit("700")])],
            "unit 500\nCLAIM 3000\nunit 700\nCLAIM 1000\n",
        )
        .is_empty());
    }

    /// A report that states no purse is not evidence of an empty one, so the check does not fire.
    /// The decision, not a guard - `ah-bumi` counts a claim as written in the same case.
    #[test]
    fn a_report_with_no_stated_purse_is_not_warned_about() {
        assert!(check_claims_of(
            None,
            vec![region(vec![unit("500"), unit("700")])],
            "unit 500\nCLAIM 3000\nunit 700\nCLAIM 9000\n",
        )
        .is_empty());
    }

    #[test]
    fn a_foreign_units_claim_does_not_count() {
        let mut theirs = unit("700");
        theirs.own = false;
        theirs.faction_id = Some("12".to_string());
        assert!(check_claims_of(
            Some(4935),
            vec![region(vec![unit("500"), theirs])],
            "unit 500\nCLAIM 3000\nunit 700\nCLAIM 9000\n",
        )
        .is_empty());
    }

    #[test]
    fn a_unit_claiming_twice_is_warned_on_each_line() {
        let findings = check_claims_of(
            Some(4935),
            vec![region(vec![unit("500")])],
            "unit 500\nCLAIM 3000\nCLAIM 3000\n",
        );

        assert_eq!(findings.len(), 2, "one per claim line: {findings:?}");
        for finding in &findings {
            assert_eq!(
                finding.message,
                "your units claim and withdraw $6000 between them and the faction has $4935"
            );
        }
        assert_eq!(findings[0].line, Some(2));
        assert_eq!(findings[1].line, Some(3));
    }

    /// `ah-tdsi`: one fund, drawn on by two orders, so the check counts them together and names
    /// every unit that draws on it.
    #[test]
    fn claims_and_withdrawals_together_can_overdraw_the_fund() {
        let findings = check_claims_of(
            Some(500),
            vec![region(vec![unit("101"), unit("102")])],
            "unit 101\nCLAIM 300\nunit 102\nWITHDRAW 10 grain\n",
        );

        assert_eq!(findings.len(), 2, "both drawing units: {findings:?}");
        assert_eq!(
            findings
                .iter()
                .map(|finding| finding.unit_id.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("101"), Some("102")]
        );
        for finding in &findings {
            assert_eq!(
                finding.message,
                "your units claim and withdraw $670 between them and the faction has $500"
            );
        }
        assert_eq!(findings[0].line, Some(2));
        assert_eq!(findings[1].line, Some(4));
    }

    /// One shape of sentence for both cases: a faction that only claims reads exactly the same way.
    #[test]
    fn a_claim_alone_still_reads_the_same_way() {
        let findings = check_claims_of(
            Some(500),
            vec![region(vec![unit("101")])],
            "unit 101\nCLAIM 600\n",
        );

        assert_eq!(findings.len(), 1, "{findings:?}");
        assert_eq!(
            findings[0].message,
            "your units claim and withdraw $600 between them and the faction has $500"
        );
    }

    /// A control rather than a discriminating test, and deliberately so: any fund that covers the
    /// claim and the withdrawal together also covers the claim alone, so no fixture of this shape
    /// can fail when withdrawals go uncounted. What proves they are counted is the pair of overdraw
    /// tests above; this one guards the other direction, that counting them does not invent a
    /// warning.
    #[test]
    fn a_fund_that_covers_both_warns_about_neither() {
        assert!(check_claims_of(
            Some(700),
            vec![region(vec![unit("101"), unit("102")])],
            "unit 101\nCLAIM 300\nunit 102\nWITHDRAW 10 grain\n",
        )
        .is_empty());
    }

    /// A withdrawal nothing can price makes the faction's total genuinely unknown, and an unknown
    /// total is not zero: the check declines rather than guessing, exactly as it already declines a
    /// report that states no fund (`ah-tdsi`). The claim alone overruns, so a naive zero-fallback
    /// would still fire here.
    #[test]
    fn an_unpriceable_withdrawal_declines_the_fund_check() {
        assert!(check_claims_of(
            Some(500),
            vec![region(vec![unit("101"), unit("102")])],
            "unit 101\nCLAIM 600\nunit 102\nWITHDRAW 1 longship\n",
        )
        .is_empty());
    }

    /// A unit with two `WITHDRAW` lines contributes both to the total and is named on each, the
    /// same way `a_unit_claiming_twice_is_warned_on_each_line` pins it for claims.
    #[test]
    fn two_withdrawals_by_one_unit_both_count() {
        let findings = check_claims_of(
            Some(500),
            vec![region(vec![unit("101")])],
            "unit 101\nWITHDRAW 10 grain\nWITHDRAW 10 grain\n",
        );

        assert_eq!(findings.len(), 2, "one per withdraw line: {findings:?}");
        for finding in &findings {
            assert_eq!(
                finding.message,
                "your units claim and withdraw $740 between them and the faction has $500"
            );
        }
        assert_eq!(findings[0].line, Some(2));
        assert_eq!(findings[1].line, Some(3));
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
            /// The `Unclaimed silver:` figure the case's report should state - `None` for every
            /// check that does not read the purse, and what `claims-exceed-unclaimed` needs.
            unclaimed: Option<i64>,
        }
        let cases: Vec<Case> = vec![
            Case {
                code: codes::NOT_ENOUGH_SILVER,
                regions: vec![region(vec![with_silver(unit("5"), 40)])],
                orders: "unit 5\nGIVE 7 100 SILV\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::NOT_ENOUGH_ITEMS,
                regions: vec![region(vec![with_item(unit("5"), 3, "sword", "SWOR")])],
                orders: "unit 5\nGIVE 7 10 swords\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::GUARD_DROPPED,
                regions: vec![region(vec![guard_dropping])],
                orders: "unit 5\nMOVE N\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::HEX_UNGUARDED,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nWORK\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::TAUGHT_NOT_HERE,
                regions: vec![region(teaching_hex())],
                orders: "unit 500\nTEACH 999\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::TAUGHT_NOT_STUDYING,
                regions: vec![region(teaching_hex())],
                orders: "unit 500\nTEACH 700\nunit 700\nWORK\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::TEACHER_CANNOT_TEACH,
                regions: vec![region(teacher_below_student)],
                orders: "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::TEACHING_OVERSUBSCRIBED,
                regions: vec![region(oversubscribed)],
                orders: "unit 500\nTEACH 700\nunit 700\nSTUDY combat\n",
                allowance: None,
                unclaimed: None,
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
                unclaimed: None,
            },
            Case {
                code: codes::FORM_ALIAS_REUSED,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nFORM 1\nEND\nFORM 1\nEND\n",
                allowance: None,
                unclaimed: None,
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
                unclaimed: None,
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
                unclaimed: None,
            },
            Case {
                code: codes::GIVE_TARGET_NOT_HERE,
                regions: vec![region(vec![with_silver(unit("5"), 1000)])],
                orders: "unit 5\nGIVE 16585 500 SILV\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::NOT_TRADED_HERE,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nBUY 5 silk\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::TOO_MANY_QUARTERMASTERS,
                regions: vec![region(vec![unit("5")])],
                orders: "unit 5\nSTUDY QUAM\n",
                allowance: Some(("Quartermasters", 2, 2)),
                unclaimed: None,
            },
            Case {
                code: codes::UNIT_OVERLOADED,
                regions: vec![region(vec![carrying("5", 1800, 150)])],
                orders: "unit 5\nMOVE S\n",
                allowance: None,
                unclaimed: None,
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
                unclaimed: None,
            },
            Case {
                code: codes::ALREADY_BUILT,
                regions: vec![ReportRegion {
                    structures: vec![finished_mill("1")],
                    ..region(vec![in_structure(unit("4021"), "1")])
                }],
                orders: "unit 4021\nBUILD\n",
                allowance: None,
                unclaimed: None,
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
                unclaimed: None,
            },
            Case {
                code: codes::MAGIC_STUDY_OUTSIDE_BUILDING,
                regions: vec![region(vec![mage(2)])],
                orders: "unit 5\nSTUDY FORC\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::BUILD_OUTSIDE_STRUCTURE,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\nBUILD\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::BUILD_HELP_NOT_BUILDING,
                regions: vec![ReportRegion {
                    structures: vec![unfinished_building("1")],
                    ..region(vec![in_structure(unit("4021"), "1"), unit("4117")])
                }],
                orders: "unit 4021\nWORK\nunit 4117\nBUILD HELP 4021\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::UNIT_DOES_NOTHING,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::BUILD_WITHOUT_SKILL,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\nBUILD Mine\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::CLAIMS_EXCEED_UNCLAIMED,
                regions: vec![region(vec![unit("500"), unit("700")])],
                orders: "unit 500\nCLAIM 3000\nunit 700\nCLAIM 2000\n",
                allowance: None,
                unclaimed: Some(4935),
            },
            Case {
                code: codes::UPKEEP_EXCEEDS_UNCLAIMED,
                regions: vec![region(vec![
                    with_men(with_silver(starving(unit("500")), 0), 6),
                    with_men(with_silver(starving(unit("700")), 0), 6),
                ])],
                orders: "",
                allowance: None,
                unclaimed: Some(100),
            },
            Case {
                code: codes::TAXED_A_PILLAGED_HEX,
                regions: vec![ReportRegion {
                    tax_base: Some(2500),
                    ..region(vec![with_silver(unit("5"), 0), with_silver(unit("7"), 0)])
                }],
                orders: "unit 5\nPILLAGE\n\nunit 7\nTAX\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::PRODUCE_WITHOUT_SKILL,
                regions: vec![region(vec![unit("4021")])],
                orders: "unit 4021\nPRODUCE catapult\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                // A fixture region names no products at all, which is the `produces nothing` case.
                code: codes::PRODUCE_NOT_HERE,
                regions: vec![region(vec![with_skill(unit("4021"), "MINI", 1)])],
                orders: "unit 4021\nPRODUCE iron\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::REGION_POOL_OVERSUBSCRIBED,
                regions: vec![ReportRegion {
                    tax_base: Some(2500),
                    ..region(vec![with_men(unit("500"), 10), with_men(unit("700"), 50)])
                }],
                orders: "unit 500\nTAX\nunit 700\nTAX\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::TAXED_A_GUARDED_HEX,
                regions: vec![ReportRegion {
                    tax_base: Some(8963),
                    ..region(vec![with_silver(unit("683"), 0), foreign_guard("14")])
                }],
                orders: "unit 683\nTAX\n",
                allowance: None,
                unclaimed: None,
            },
            Case {
                code: codes::PILLAGE_WITHOUT_MEN,
                regions: vec![ReportRegion {
                    tax_base: Some(8963),
                    ..region(vec![unit("683")])
                }],
                orders: "unit 683\nPILLAGE\n",
                allowance: None,
                unclaimed: None,
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
            unclaimed,
        } in &cases
        {
            let mut built = match allowance {
                Some((label, used, maximum)) => {
                    report_with_status(label, *used, *maximum, regions.clone())
                }
                None => report(regions.clone()),
            };
            built.header.unclaimed_silver = *unclaimed;

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

    // --- PRODUCE: what the unit cannot make, and what the region has not ------------------------

    /// A region whose `Products` line names grain, wood and furs.
    fn produces(units: Vec<ReportUnit>) -> ReportRegion {
        ReportRegion {
            products: vec![
                ItemAmount {
                    amount: 40,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                },
                ItemAmount {
                    amount: 20,
                    name: "wood".to_string(),
                    tag: "WOOD".to_string(),
                },
                ItemAmount {
                    amount: 10,
                    name: "furs".to_string(),
                    tag: "FUR".to_string(),
                },
            ],
            ..region(units)
        }
    }

    /// Only the two production codes, so an unrelated advisory cannot make one of these read as a
    /// failure of the check under test.
    fn produce_codes(findings: &[Finding]) -> Vec<&str> {
        codes(findings)
            .into_iter()
            .filter(|code| code.starts_with("produce-"))
            .collect()
    }

    #[test]
    fn a_unit_without_the_skill_cannot_produce() {
        let findings = check(
            vec![region(vec![with_skill(unit("4021"), "CARP", 2)])],
            "unit 4021\nPRODUCE catapult\n",
        );

        assert_eq!(produce_codes(&findings), ["produce-without-skill"]);
        assert_eq!(
            findings[0].message,
            "cannot produce catapult: needs carpenter 4, has carpenter 2"
        );
    }

    #[test]
    fn a_unit_with_no_such_skill_at_all_is_told_so() {
        let findings = check(
            vec![region(vec![unit("4021")])],
            "unit 4021\nPRODUCE catapult\n",
        );

        assert_eq!(produce_codes(&findings), ["produce-without-skill"]);
        assert_eq!(
            findings[0].message,
            "cannot produce catapult: needs carpenter 4, has no carpenter"
        );
    }

    #[test]
    fn a_unit_with_the_skill_is_not_marked() {
        let findings = check(
            vec![region(vec![with_skill(unit("4021"), "CARP", 5)])],
            "unit 4021\nPRODUCE catapult\n",
        );

        assert_eq!(produce_codes(&findings), Vec::<&str>::new(), "{findings:?}");
    }

    #[test]
    fn an_item_nothing_produces_is_marked_too() {
        let findings = check(
            vec![region(vec![unit("4021")])],
            "unit 4021\nPRODUCE quicksilver\n",
        );

        assert_eq!(produce_codes(&findings), ["produce-without-skill"]);
        assert!(
            findings.iter().any(
                |finding| finding.message == "cannot produce quicksilver: no skill produces it"
            ),
            "{findings:?}"
        );
    }

    #[test]
    fn a_resource_the_region_has_not_is_marked() {
        let findings = check(
            vec![produces(vec![with_skill(unit("4021"), "MINI", 1)])],
            "unit 4021\nPRODUCE iron\n",
        );

        assert_eq!(produce_codes(&findings), ["produce-not-here"]);
        assert_eq!(
            findings[0].message,
            "cannot produce iron here: this region produces grain, wood and furs"
        );
    }

    #[test]
    fn a_region_that_produces_nothing_says_so() {
        let findings = check(
            vec![region(vec![with_skill(unit("4021"), "MINI", 1)])],
            "unit 4021\nPRODUCE iron\n",
        );

        assert_eq!(produce_codes(&findings), ["produce-not-here"]);
        assert_eq!(
            findings[0].message,
            "cannot produce iron here: this region produces nothing"
        );
    }

    #[test]
    fn a_resource_the_region_has_is_not_marked() {
        let findings = check(
            vec![produces(vec![with_skill(unit("4021"), "FARM", 1)])],
            "unit 4021\nPRODUCE grain\n",
        );

        assert_eq!(produce_codes(&findings), Vec::<&str>::new(), "{findings:?}");
    }

    /// A sword is made *from* iron rather than from the hex, so its region is not the question -
    /// a unit short of the iron is `not-enough-items`. This pins the `inputs.is_empty()` seam.
    #[test]
    fn a_recipe_with_inputs_is_not_a_region_question() {
        let findings = check(
            vec![produces(vec![with_skill(unit("4021"), "WEAP", 1)])],
            "unit 4021\nPRODUCE sword\n",
        );

        assert_eq!(produce_codes(&findings), Vec::<&str>::new(), "{findings:?}");
    }

    #[test]
    fn a_unit_failing_both_checks_gets_both_marks() {
        let findings = check(
            vec![produces(vec![unit("4021")])],
            "unit 4021\nPRODUCE iron\n",
        );

        assert_eq!(
            produce_codes(&findings),
            ["produce-without-skill", "produce-not-here"]
        );
    }

    #[test]
    fn disabling_one_does_not_hide_the_other() {
        let regions = vec![produces(vec![unit("4021")])];
        let orders = "unit 4021\nPRODUCE iron\n";

        let without_skill_off = check_turn(
            &report(regions.clone()),
            orders,
            Some(&ruleset()),
            disabling_all(&[codes::UNIT_DOES_NOTHING, codes::PRODUCE_WITHOUT_SKILL]),
        );
        assert_eq!(produce_codes(&without_skill_off), ["produce-not-here"]);

        let not_here_off = check_turn(
            &report(regions),
            orders,
            Some(&ruleset()),
            disabling_all(&[codes::UNIT_DOES_NOTHING, codes::PRODUCE_NOT_HERE]),
        );
        assert_eq!(produce_codes(&not_here_off), ["produce-without-skill"]);
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
            // `build-outside-structure` is right about and these tests are not about. So are the
            // two production warnings: these fixture units have no farming and their regions name
            // no products, both of which are true and neither of which is the allowance.
            disabling_all(&[
                codes::BUILD_OUTSIDE_STRUCTURE,
                codes::UNIT_DOES_NOTHING,
                codes::PRODUCE_WITHOUT_SKILL,
                codes::PRODUCE_NOT_HERE,
            ]),
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

    /// A unit taxing by its flag taxes its region as surely as one with a `TAX` line, so the
    /// region counts against the allowance (`ah-fvzu`).
    #[test]
    fn a_flagged_taxer_counts_toward_the_taxed_regions() {
        let regions = vec![
            region_at("1:7,53", 7, 53, vec![unit("5")]),
            region_at("1:8,53", 8, 53, vec![unit("6")]),
            region_at("1:9,53", 9, 53, vec![taxing_by_flag(unit("7"))]),
        ];
        let orders = "unit 5\nPRODUCE grain\nunit 6\nPRODUCE grain\n";
        let findings = check_trade(regions, orders, "Regions", 2);

        assert_eq!(codes(&findings), ["too-many-trade-regions"]);
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

        // The two production warnings are true of these fixtures - no farming, no products line -
        // and orthogonal to whether a missing status block is judged.
        assert_eq!(
            codes(&check_turn(
                &report(regions),
                orders,
                Some(&ruleset()),
                disabling_all(&[
                    codes::UNIT_DOES_NOTHING,
                    codes::PRODUCE_WITHOUT_SKILL,
                    codes::PRODUCE_NOT_HERE,
                ]),
            )),
            Vec::<&str>::new()
        );
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
        // The quartermaster ate its own grain first, and the hover explains its zero from that
        // (`ah-p9z5`).
        assert_eq!(forecast(&review, "2000").own_food_covered, 0);
        assert_eq!(forecast(&review, "2001").own_food_covered, 0);
    }

    /// A unit holding *some* food and drawing the rest from the hex records each separately, so
    /// the hover can name the step that actually fed it (`ah-p9z5`).
    #[test]
    fn a_unit_fed_by_both_records_each_separately() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        let mut eater = with_item(starving(unit("2001")), 1, "grain", "GRAI");
        eater.flags = vec!["consuming faction's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        assert_eq!(forecast(&review, "2001").upkeep, Some(0));
        assert_eq!(forecast(&review, "2001").own_food_covered, 50);
        assert_eq!(forecast(&review, "2001").faction_food_covered, 10);
    }

    /// The case the navigator reported: the unit that supplied the grain is fed by its own food
    /// and must have something to say about its zero too (`ah-p9z5`).
    #[test]
    fn the_unit_holding_the_grain_records_its_own_food() {
        let mut granary = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        granary.flags = vec!["consuming faction's food".to_string()];
        granary.men = 6;
        let mut eater = starving(unit("2001"));
        eater.flags = vec!["consuming faction's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![granary, eater]);

        assert_eq!(forecast(&review, "2000").upkeep, Some(0));
        assert_eq!(forecast(&review, "2000").own_food_covered, 60);
        assert_eq!(forecast(&review, "2000").faction_food_covered, 0);
        assert_eq!(forecast(&review, "2001").faction_food_covered, 60);
        assert_eq!(forecast(&review, "2001").own_food_covered, 0);
    }

    /// A hex with one eater and not enough grain: it eats what there is, and the hover says how
    /// much that was rather than claiming the whole fee was met.
    #[test]
    fn a_lone_eater_in_a_short_hex_is_fed_what_there_is() {
        // Exactly its own fee and no more: spare silver would pay the eater at step 4 and the
        // grain would never be reached (`ah-e66j`).
        let quartermaster = with_item(with_silver(starving(unit("2000")), 10), 1, "grain", "GRAI");
        let mut eater = starving(unit("2001"));
        eater.flags = vec!["consuming faction's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        assert_eq!(forecast(&review, "2001").upkeep, Some(10));
        assert_eq!(forecast(&review, "2001").faction_food_covered, 50);
        assert_eq!(forecast(&review, "2001").doubt, None);
    }

    /// The `CONSUME UNIT` flag reaches the unit's own food and never its faction's, so a unit
    /// carrying it pays in silver beside a neighbour's full larder. Its silver is what keeps steps
    /// 5 and 6 out of this: a unit with none reaches the pool at step 6 whatever its flags say,
    /// which `feed_after_silver` settles and `a_consume_unit_unit_reaches_faction_food_at_step_six`
    /// pins (`ah-eacd`).
    #[test]
    fn a_unit_consuming_only_its_own_food_does_not_draw_on_the_pool() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        let mut eater = with_silver(starving(unit("2001")), 500);
        eater.flags = vec!["consuming unit's food".to_string()];
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        let eaten = forecast(&review, "2001");
        assert_eq!(eaten.upkeep, Some(60));
        assert_eq!(eaten.faction_food_covered, 0);
        assert_eq!(eaten.forced_faction_food, 0);
    }

    /// Same rule for a unit with no flag at all: steps 1 and 2 leave a neighbour's grain alone
    /// while the unit's own silver can pay. Steps 5 and 6 are settled elsewhere (`ah-eacd`).
    #[test]
    fn a_unit_consuming_nothing_pays_silver_beside_a_full_pool() {
        let quartermaster = with_item(with_silver(starving(unit("2000")), 500), 6, "grain", "GRAI");
        let mut eater = with_silver(starving(unit("2001")), 500);
        eater.men = 6;

        let review = forecast_of(vec![quartermaster, eater]);

        let eaten = forecast(&review, "2001");
        assert_eq!(eaten.upkeep, Some(60));
        assert_eq!(eaten.faction_food_covered, 0);
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

    /// The plumbing test: the purse lives on the report header, and only `review_turn` can carry
    /// it to `forecast_unit`. A claim larger than the purse is what proves it arrived - built but
    /// never passed, the unit would read the whole 9000.
    #[test]
    fn a_review_passes_the_factions_unclaimed_silver() {
        let report = ParsedReport {
            regions: vec![region(vec![unit("2000")])],
            header: crate::report::header::ReportHeader {
                unclaimed_silver: Some(4935),
                ..Default::default()
            },
            ..Default::default()
        };

        let review = review_turn(
            &report,
            "unit 2000\nCLAIM 9000\n",
            None,
            CheckOptions::default(),
        );

        assert_eq!(forecast(&review, "2000").income, Some(4935));
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
