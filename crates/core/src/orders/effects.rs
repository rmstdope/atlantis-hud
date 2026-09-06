//! What this month's orders make of the units the report described.
//!
//! The report says where every unit stands today; the orders document says what each one has been
//! told to do. This module applies the orders that change how a unit *reads* - its name, its
//! flags, what it carries, where it sits and where it is going - so the interface can show the
//! coming month instead of the past one. Orders whose outcome depends on the game's own dice or on
//! other factions (taxing, studying, production, combat) are left alone: showing a guess as fact
//! is worse than showing the report.
//!
//! The governing policy is the validator's own **accept on doubt**: an order that cannot be read,
//! or whose target cannot be found, changes nothing rather than changing something wrong.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::cache::ReportCache;
use crate::movement::rules::Ruleset;
use crate::orders::items::{is_unfinished_ship, item_named, unfinished_ship_named};
use crate::orders::standing::{standing_after, BoardingOrder};
use crate::report::composition;
use crate::report::model::{level_for_points, ReportUnit, Skill, UnitMovementStatus};

/// Where a previewed unit stands relative to the hex its row sits in.
///
/// Only that: whether this month's `FORM` creates the unit, and whether `rules/form` dissolves it,
/// are two further facts a row can carry alongside any of these - see [`UnitPreview::formed`] and
/// [`UnitPreview::dissolving`]. They used to be arms of this enum, which made a formed unit that
/// also walks away inexpressible (`ah-4hux`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UnitPreviewStatus {
    /// Still in this hex next month.
    Present,
    /// Ordered out of this hex.
    Departing,
    /// Ordered into this hex from somewhere else.
    Arriving,
}

/// One field the orders change, with what the report said before.
///
/// The original travels with the change so the interface can show "was: ..." without diffing
/// anything itself. It is a display string rather than a typed value because that is all a tooltip
/// needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    /// The `ReportUnit` field, in its wire spelling: `name`, `onGuard`, `flags`, `items`, `skills`,
    /// `men`, `structureId`, `movement`.
    pub field: String,
    pub original: String,
}

/// One unit as the orders leave it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitPreview {
    /// The full predicted state, so the row renders exactly like a reported one.
    pub unit: ReportUnit,
    pub status: UnitPreviewStatus,
    pub changes: Vec<FieldChange>,
    /// Where an arriving unit set out from.
    pub arriving_from: Option<String>,
    /// Where a departing unit ends the month, when the trace can say.
    pub departing_to: Option<String>,
    /// The fleet carrying this unit away, as `<name> [<id>]`, when it is departing because the ship
    /// it stands in is. Never set on an arriving row: an arrival says only where it came from.
    pub aboard: Option<String>,
    /// This unit's orders whose effect on its items could not be counted, verbatim, in document
    /// order (`ah-agbm`).
    pub uncounted: Vec<String>,
    /// Silver or goods taken from a unit the report does not show in this hex (`ah-agbm`).
    pub taken_unshown: Vec<TakenUnshown>,
    /// What this unit's `PRODUCE` orders make this month, so the hover can say the goods arrive in
    /// the month's last phase. Empty for a unit not producing, and for one whose run comes to
    /// nothing (`ah-ofpb.1`).
    pub produced: Vec<ProducedItem>,
    /// What this unit's `BUILD` orders spend this month, so the hover can say where the material
    /// went and what cut the work short. Empty for a unit not building, and for one whose build
    /// comes to nothing (`ah-ofpb.2`).
    pub built: Vec<BuildSpend>,
    /// What this unit's `CAST` orders create this month, so the hover can say what is arriving and
    /// the column can show a chance creation as a range. Empty for a unit not casting, and for one
    /// whose cast creates nothing an item catalogue can carry (`ah-ofpb.5`).
    pub created: Vec<CreatedItem>,
    /// One line of what this unit's `TRANSPORT`/`DISTRIBUTE` orders send this month, in document
    /// order. Empty for a unit that sent nothing (`ah-bxgs`).
    pub transport_sent: Vec<TransportSent>,
    /// One item arriving by another unit's `TRANSPORT`/`DISTRIBUTE` this month. Empty for a unit
    /// receiving nothing (`ah-bxgs`).
    pub transport_received: Vec<TransportReceived>,
    /// One `TRANSPORT`/`DISTRIBUTE` whose target the report cannot show as able to receive, in
    /// document order. Empty for a unit whose every transport reached an eligible target
    /// (`ah-64wm`).
    pub transport_target_issues: Vec<TransportTargetIssue>,
    /// Every item this month's orders move into or out of this unit, each with its cause, **in the
    /// month's order** (`ah-rgkk.3.1`). Empty for a unit whose month moves nothing.
    ///
    /// Overlaps [`produced`](Self::produced), [`built`](Self::built), [`created`](Self::created)
    /// and the two transport lists on purpose: those say what one kind of order did, and this says
    /// what happened to the items, which is what the Items popup reads.
    pub item_changes: Vec<ItemChange>,
    /// The unit a dissolving row's goods revert to, as `<name> (<id>)` - `rules/form`'s "the first
    /// unit you have in that region", named from the preview so a recipient this month's `NAME`
    /// renames reads as the orders leave it.
    ///
    /// `None` on every row whose [`dissolving`](Self::dissolving) is `false`, and on a dissolving
    /// row in a region whose report shows no own unit of ours: there the goods revert to nobody,
    /// which the core already models by taking nothing from the dissolving row.
    pub dissolves_into: Option<String>,
    /// This month's `FORM` creates this unit: it did not exist when the report was written, and
    /// its `unit_id` is the synthetic `new-<alias>` rather than a number the game has issued.
    ///
    /// Carried on **every** row of such a unit - the row in the hex it was formed in, whether that
    /// row is `Present` or `Departing`, and the `Arriving` row in the hex it walks to (`ah-4hux`).
    pub formed: bool,
    /// `rules/form` dissolves this unit before the month ends: it is one this month's `FORM`
    /// creates that gains nobody, so it never exists and its goods revert.
    ///
    /// Always accompanied by [`formed`](Self::formed) - only a formed unit dissolves - and drawn
    /// rather than skipped since `ah-ty3s.3` (decision **K2**), so the row does not vanish from
    /// under a player editing its orders.
    pub dissolving: bool,
    /// Why this unit's skills moved this month: one record per merge of arriving men, in the order
    /// the merges ran. Empty for a unit no men joined (`ah-rgkk.2.1`).
    pub skill_merges: Vec<SkillMerge>,
    /// This unit's skills exactly as the report printed them, typed - so a reader can compare
    /// `level (points)` against `level (points)` instead of parsing the `skills` [`FieldChange`]'s
    /// display string. Empty for a unit this month's `FORM` creates, which the report never showed.
    pub reported_skills: Vec<Skill>,
    /// The report could only estimate this unit's headcount (`men_estimated`), so `settle_headcounts`
    /// skipped it and its recruits were **not** merged into its skills: the Skills figures are the
    /// reported ones, not diluted ones. `false` when nothing was recruited.
    pub recruits_unmerged: bool,
    /// Men credited from a unit the report does not show, whose own skills are therefore unknown -
    /// so they are deliberately left out of every merge (`ah-agbm`). The unit's headcount rose and
    /// its skills did not.
    pub men_of_unknown_skill: Vec<TakenUnshown>,
    /// Where this month's `STUDY` lands next turn, teaching included. `None` for a unit not
    /// studying, for one whose skills this month cannot be said at all, for a skill the catalogue
    /// does not know, and for a dissolving unit, which never exists to study (`ah-rgkk.2.2`).
    pub study: Option<StudyForecast>,
}

/// One line of what a unit's `TRANSPORT`/`DISTRIBUTE` orders send this month, in document order
/// (`ah-bxgs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportSent {
    /// How much leaves. `0` on a refused line, which moves nothing.
    pub amount: i64,
    pub tag: String,
    /// The unit number the order named. Empty on a refused line, whose sentence names no target.
    pub to: String,
    /// The order named a unit number that appears nowhere in the report - an ally's
    /// quartermaster, or a mistake. `false` for a unit the report shows but we cannot project.
    ///
    /// Nothing is sent to such a unit any more: since `ah-64wm` the target gate stops an order
    /// whose target the report cannot show receiving, and records a [`TransportTargetIssue`]
    /// instead. The field stays part of this wire type, which is the item-class contract.
    pub to_unshown: bool,
    /// The game will not transport this item (`rules/economy_transport`), so it stays put.
    pub refused: bool,
    /// Which of this unit's `TRANSPORT`/`DISTRIBUTE` orders wrote this line: its place among the
    /// readable ones in its block, counting from `0` in document order.
    ///
    /// A line here and a [`TransportTargetIssue`] are two halves of one document, and neither
    /// list can say on its own where its lines sat among the other's - so both carry the same
    /// counter and the interface reads them back interleaved. One order selecting several tags
    /// writes several lines under one index (`ah-64wm`).
    pub order_index: i64,
}

/// One item arriving by another unit's `TRANSPORT`/`DISTRIBUTE` (`ah-bxgs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportReceived {
    pub amount: i64,
    pub tag: String,
    /// The sending unit's number.
    pub from: String,
}

/// Why the report cannot show a `TRANSPORT`/`DISTRIBUTE` target receiving what was sent
/// (`ah-64wm`).
///
/// `rules/transport` requires the target to have the quartermaster skill and to own a transport
/// structure; `rules/economy_transport` names that structure the Caravanserai and requires the
/// target to be at least FRIENDLY to the issuing unit. The first two the report can settle for a
/// unit it shows; the third it cannot, because `rules/com_attitudes` prints our attitudes toward
/// other factions rather than theirs toward us.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportTargetReason {
    /// One of ours, and the report - which prints our own units' skills in full - shows no
    /// quartermaster skill on it.
    NotQuartermaster,
    /// The report shows the target, and it is not the first unit listed inside a Caravanserai in
    /// its hex, so it owns none (`rules/world_structures`). Certain even for a foreign unit,
    /// whose structure the report still draws.
    NotCaravanseraiOwner,
    /// The report does not show the target at all, or shows a foreign Caravanserai owner whose
    /// skills it never discloses: no evidence either way.
    EligibilityUnknown,
    /// A foreign unit the report shows as a quartermaster owning a Caravanserai. Whether its
    /// faction is FRIENDLY toward ours is not in our report (`rules/com_attitudes`).
    AcceptanceUnknown,
}

/// One `TRANSPORT`/`DISTRIBUTE` the target gate stopped, in document order (`ah-64wm`).
///
/// Separate from [`TransportSent`], which stays the item-class contract: this one is about who
/// was sent to, moves nothing, and is recorded once for the order rather than once per tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportTargetIssue {
    /// The unit number the order named.
    pub to: String,
    /// What the order would have moved out of the sender's stock. `0` when the sentence names no
    /// amount - see `tag`.
    pub amount: i64,
    /// The item the order named. Empty when the goods are ones the game would not transport
    /// anyway, or when one order selected several tags: there is no per-tag claim to make, so the
    /// sentence explains the target and says the order moves nothing.
    pub tag: String,
    pub reason: TransportTargetReason,
    /// Which of this unit's `TRANSPORT`/`DISTRIBUTE` orders this issue belongs to, on the same
    /// counter [`TransportSent::order_index`] carries - so a refused order and a successful one
    /// read back in the order they were written (`ah-64wm`).
    pub order_index: i64,
}

/// Why men joined a unit this month, in `rules/sequenceofevents` order (`ah-rgkk.2.1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillMergeCause {
    /// Men bought this month. `rules/economy_recruiting`: "New recruits will not have any skills
    /// or items", so they merge in at zero and dilute what the unit knows (`rules/buy`).
    Recruited,
    /// Men another unit's `GIVE` handed over, bringing their own skills.
    Given,
    /// Men this unit's own `TAKE` brought in, bringing their own skills.
    Taken,
}

/// One merge of arriving men into a unit's skills, as `merge_skills` ran it (`ah-rgkk.2.1`).
///
/// One record per call, in the order the calls ran - which is `rules/sequenceofevents` order,
/// because the Give phase runs before the market's recruits. A merge that left the figures
/// identical is recorded like any other: that men joined and nothing moved is a fact about the
/// month, and leaving it out would make "nothing happened" and "we did not look" the same answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMerge {
    pub cause: SkillMergeCause,
    /// The unit number the men came from. Empty for `Recruited`, who come from the market.
    pub from: String,
    /// How many men the merge weighted in - the `moved` argument `merge_skills` was called with.
    pub men: i64,
    /// The receiver's headcount the merge weighted against, before the men were added - the
    /// `into_men` argument. Never the headcount afterwards, which is the trap `move_between`'s own
    /// comment warns about.
    pub men_before: i64,
    /// Which man items arrived, one entry per race. Empty when [`count_inferred`](Self::count_inferred)
    /// is set: a `BUY ALL` leaves no exact list to report.
    pub men_arriving: Vec<crate::report::model::ItemAmount>,
    /// `men` was inferred from the net change in the item list rather than read from the settled
    /// recruits, because a `BUY ALL` makes the exact figure unknowable. Only ever set on a
    /// `Recruited` record.
    pub count_inferred: bool,
    /// The arriving men's own skills, as the source held them at that moment. Empty for
    /// `Recruited`, who have none.
    pub arriving_skills: Vec<Skill>,
    /// The receiving unit's skills once this merge had run.
    pub skills: Vec<Skill>,
}

/// Where this month's `STUDY` lands next turn, teaching included (`ah-rgkk.2.2`).
///
/// `rules/sequenceofevents` runs `STUDY` in the month-long phase, after the market, so nothing here
/// moves this month's figures: this is next turn's report, computed from the diluted ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyForecast {
    /// The catalogue's tag for the skill being studied, upper case.
    pub tag: String,
    /// The catalogue's name for it, as a sentence would say it - `combat`.
    pub name: String,
    /// The unit's standing in the skill as the month-long phase opens: what the market left, which
    /// is the last step of this month's chain and the step the projection is added to.
    pub level_before: u32,
    pub points_before: u32,
    /// What the month is worth, in months, as an exact ratio in lowest terms: `1/1` untaught, `3/2`
    /// for `rules/skills_teaching`'s own "1 1/2 months" example, `3/4` for that month halved
    /// outside a building that houses mages. Never a float - the rules state a fraction.
    pub months_numerator: i64,
    pub months_denominator: i64,
    /// Every unit in the hex whose `TEACH` reaches this one, in report order. Empty when nobody
    /// teaches it.
    pub teachers: Vec<StudyTeacher>,
    /// `rules/magic_skills` halves the month: a magic skill above level 2, studied outside a
    /// building that houses mages. Already applied to the ratio above; carried so the popup can
    /// say why the month is worth half.
    pub halved_outside_a_building: bool,
    /// Where the study leaves the unit next turn. `points_after` is what the ratio buys on top of
    /// `points_before`; `level_after` is what those points reach, held down to `ceiling_level`.
    pub points_after: u32,
    pub level_after: u32,
    /// The highest level this unit may take the skill to (`rules/skills_limitations`).
    pub ceiling_level: u32,
    /// The races that impose `ceiling_level`, in the unit's own `men_by_race` order. Empty when the
    /// ceiling is the skill's own maximum and no race took anything away.
    pub limiting_races: Vec<LimitingRace>,
    /// The points reach a level the ceiling refuses, so the figure rises and the level holds.
    pub held_back_by_ceiling: bool,
    /// What the projection rests on that this report cannot settle. Empty for a projection nothing
    /// is doubted about (decision **U2**).
    pub doubts: Vec<StudyDoubt>,
}

/// One unit teaching a studying unit this month (`rules/skills_teaching`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyTeacher {
    pub unit_id: String,
    pub name: String,
    /// Student-months this teacher has: ten per **person**, so a two-leader unit has twenty.
    pub slots: i64,
    /// How many men it teaches in total this month, this unit's included - what dilutes the month.
    pub students: i64,
}

/// A race that holds a study down, named so a sentence can say `hill dwarves`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitingRace {
    pub tag: String,
    /// The catalogue's own name, singular - `hill dwarf`. Pluralising is the interface's business.
    pub name: String,
}

/// Why a projection rests on something the report cannot settle (`ah-rgkk.2`, decision **U2**).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudyDoubtReason {
    /// The unit holds less silver when the month-long phase opens than the fee asks for.
    FeeShort,
    /// The catalogue prices this skill nowhere, so the fee cannot be said at all.
    FeeUnpriced,
    /// The report could only estimate the headcount, so the fee, the dilution and the diluted
    /// starting figures all rest on a guess.
    HeadcountEstimated,
    /// A unit in the hex teaches this one, and whether it may teach at all cannot be settled from
    /// this report - so its month is not counted toward the projection.
    TeacherUnsettled,
    /// A teacher of this unit also teaches a unit of another faction, whose headcount the report
    /// does not print - so how far its teaching dilutes cannot be said.
    TeacherStudentsUnknown,
    /// Whether `rules/magic_skills` halves this month cannot be said: the unit ends the month in a
    /// structure this region's report does not list, or the catalogue carries no buildings table
    /// to seat a mage against. The month is not halved.
    ShelterUnknown,
}

/// One doubt, with whatever the sentence explaining it needs (`ah-rgkk.2.2`).
///
/// Shaped like [`TransportTargetIssue`]: a reason enum with the fields beside it, rather than a
/// data-carrying enum, so the wire stays one flat object per entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyDoubt {
    pub reason: StudyDoubtReason,
    /// The whole fee for `FeeShort`, in silver. `0` for every other reason.
    pub fee: i64,
    /// How much of that fee the unit's own silver does not cover, for `FeeShort`. `0` otherwise.
    pub short_by: i64,
    /// `<name> (<id>)` of the teacher, for the two teacher reasons. Empty otherwise.
    pub teacher: String,
}

/// Goods taken from a unit the report does not show in this hex (`ah-agbm`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenUnshown {
    pub amount: i64,
    pub tag: String,
    pub from: String,
}

/// One item a `PRODUCE` order makes this month (`ah-ofpb.1`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProducedItem {
    pub amount: i64,
    pub tag: String,
}

/// Which limit decided how much work a `BUILD` does, when it was not the unit's men.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BuildCap {
    /// The unit holds less of the material than its men could work.
    Materials,
    /// The structure wants less work than its men could do - the last month of every build.
    Needs,
}

/// What one `BUILD` order spends this month (`ah-ofpb.2`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSpend {
    /// Material consumed, which is also the units of work done.
    pub amount: i64,
    /// The material's tag, as the item list keys it - `WOOD`.
    pub tag: String,
    /// The material's display name, as the cap sentence says it - `wood`.
    pub name: String,
    /// What is being worked on: `structure_label` for one that exists, or the kind the player
    /// wrote when `founding`.
    pub place: String,
    /// Set when `place` names a kind being founded rather than a structure that is already there.
    pub founding: bool,
    /// The unit being helped, for a `BUILD HELP`. `None` for a unit building on its own account.
    pub helping: Option<String>,
    /// What this unit's men alone could have done.
    pub could_do: i64,
    pub capped_by: Option<BuildCap>,
}

/// Why one item moved into or out of a unit this month (`ah-rgkk.3.1`).
///
/// One cause per movement. `ah-rgkk.3.2` adds the GIVE/TAKE cases to this enum; a reader must
/// treat an unknown cause as "moved, reason not stated" rather than failing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ItemChangeCause {
    Bought,
    Sold,
    Withdrawn,
    Produced,
    /// Consumed as the material of a `PRODUCE`.
    ProductionSpent,
    /// Consumed as the material of a `BUILD`.
    BuildSpent,
    /// Created or summoned by a `CAST`; the [`CreatedItem`] beside it says which and by how much.
    CastCreated,
    /// Consumed as the material of a `CAST`.
    CastSpent,
    /// Sent by this unit's `TRANSPORT`/`DISTRIBUTE`.
    TransportedOut,
    /// Arrived by another unit's `TRANSPORT`/`DISTRIBUTE`.
    TransportedIn,
    /// An unfinished ship left behind because the unit leaves the hex.
    Abandoned,
    /// Handed to another unit by this unit's `GIVE`.
    GivenAway,
    /// Handed to this unit by another unit's `GIVE`.
    WasGiven,
    /// Collected by this unit's `TAKE FROM`.
    Took,
    /// Collected from this unit by another unit's `TAKE FROM`.
    WasTakenFrom,
    /// `GIVE 0`: `rules/give` discards the goods rather than moving them to a unit, so there is no
    /// other party at all. Its own cause, because `GivenAway` with no party already means "given
    /// to somebody this core cannot number" - a `FACTION n NEW m` target, which moves silver.
    Discarded,
    /// `rules/form` dissolves a formed unit that gains nobody and reverts what it was given to the
    /// first own unit in the region. Recorded on the row the goods revert **to**; the dissolving
    /// row's own changes are dropped with the rest of its preview.
    GiftReverted,
}

/// The other unit an item change is between (`ah-rgkk.3.1`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemChangeParty {
    /// The other unit's number, exactly as the report or the order writes it.
    pub unit_id: String,
    /// The other unit's name as the preview leaves it, when this hex's own rows show it. `None`
    /// where only a number is known - a transport target the report does not show, for one.
    pub name: Option<String>,
}

/// One item this month's orders move into or out of a unit, with its cause (`ah-rgkk.3.1`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemChange {
    /// The item's tag, as the item list keys it - `HORS`.
    pub tag: String,
    /// The catalogue's display name, so a consumer needs no catalogue of its own.
    pub name: String,
    /// Signed: positive into the unit, negative out of it. Never zero - a movement of nothing is
    /// not recorded.
    pub delta: i64,
    pub cause: ItemChangeCause,
    /// The 1-based document line of the order responsible, when one order is.
    pub line: Option<i64>,
    /// What the market settled one of these at, in silver. `None` on every cause but
    /// [`ItemChangeCause::Bought`] and [`ItemChangeCause::Sold`].
    pub unit_price: Option<i64>,
    pub other: Option<ItemChangeParty>,
    /// Whether this tag names people rather than equipment, as `Ruleset::is_man` settles it
    /// (`crates/core/src/movement/rules.rs`). A centaur counts, being both a race and a mount;
    /// the catalogue takes that view when it is scraped and nothing here re-decides it
    /// (`ah-rgkk.4.1`).
    ///
    /// A plain `bool` rather than an `Option<bool>`: `Ruleset::validate` refuses a catalogue that
    /// names no races at all, so "this build cannot say" is not a state a loaded ruleset can be
    /// in. `false` on a tag the catalogue does not carry, which is the same answer it gives for a
    /// sword.
    pub is_man: bool,
}

/// One item a `CAST` order creates this month (`ah-ofpb.5`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedItem {
    /// The fewest the cast may bring.
    pub fewest: i64,
    /// The most it may bring, which is the figure already folded into the unit's item list.
    pub most: i64,
    pub tag: String,
    /// Whether the skill calls this a summoning, which decides the hover's verb.
    pub summoned: bool,
}

/// Every previewed unit standing in (or bound for) one region.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPreview {
    pub region_id: String,
    pub units: Vec<UnitPreview>,
}

/// What the orders document changes, region by region.
///
/// Regions and units the orders leave alone are simply absent, so an empty response means the
/// report already shows the coming month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdersPreviewResponse {
    pub regions: Vec<RegionPreview>,
}

/// Applies an orders document to the units of the faction that wrote it.
///
/// `remembered_json` is the same accumulated map memory the movement trace reads; it is what lets
/// a MOVE order's destination be named even when the current report never describes it.
///
/// # Errors
///
/// As the movement calls: only an unusable ruleset or unreadable memory is an error. An order
/// that cannot be applied is a successful answer that leaves the unit alone.
pub fn preview_orders_for_remembered_report(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    orders_document: &str,
) -> Result<OrdersPreviewResponse, String> {
    preview_orders_on_map(
        cache,
        ruleset_json,
        raw_report,
        remembered_json,
        orders_document,
        "",
    )
}

/// The same, over a map whose shape the game knows.
///
/// `map_json` as [`crate::movement::request::plan_on_map`]: the game's own dimensions, or empty
/// for a game that never recorded any, which leaves every preview exactly as it was.
///
/// # Errors
///
/// As [`preview_orders_for_remembered_report`], plus an error when the map shape cannot be read.
pub fn preview_orders_on_map(
    cache: &mut ReportCache,
    ruleset_json: &str,
    raw_report: &str,
    remembered_json: &str,
    orders_document: &str,
    map_json: &str,
) -> Result<OrdersPreviewResponse, String> {
    use crate::movement::graph::MapKnowledge;
    use crate::movement::trace::trace_move;

    let ruleset = cache
        .ruleset(ruleset_json)
        .map_err(|error| error.to_string())?;
    let remembered: Vec<crate::movement::graph::RememberedRegion> =
        serde_json::from_str(remembered_json)
            .map_err(|error| format!("remembered regions could not be read: {error}"))?;

    let report = cache.classified(raw_report, ruleset_json);

    let (units, dissolved) = settle(&report, &ruleset, orders_document);

    // Movement is resolved after everything else, so a renamed or re-equipped unit departs and
    // arrives as the orders leave it, not as the report found it.
    let map = MapKnowledge::from_remembered(&report, &remembered)
        .with_geometry(crate::movement::graph::geometry_from_json(map_json)?);
    // Where each unit stands once its own ENTER/LEAVE have run: `entry.unit` is already corrected
    // (see `Working::visit`), but the map and the aboard set it is compared against are the
    // report's, so the correction was thrown away one call later. `Working` applies the same
    // ENTER/LEAVE rule to the unit row, so the two halves of one preview cannot disagree.
    let ordered = crate::movement::fleet::OrderedUnits::from_document(orders_document);

    // Two passes, because a passenger's status depends on another unit's trace: the first decides
    // every unit on its own orders and notes which fleets leave, the second carries the units
    // standing in those fleets.
    let mut decided: Vec<Decided> = Vec::new();
    let mut sailing: BTreeMap<(String, String), SailingFleet> = BTreeMap::new();

    for (index, entry) in units.into_iter().enumerate() {
        let mut arrival = None;
        let mut mode = None;

        let dissolving = dissolved.contains_key(&index);
        let mut status = UnitPreviewStatus::Present;

        // The trace runs for a formed unit exactly as for any other: `rules/form` creates it in
        // its parent's hex and `rules/sequenceofevents` does so before movement, so it can walk
        // the same month it is formed (`ah-4hux`). It runs for a dissolving one too - the order
        // the player wrote is still drawn (decision **Q3b'**) - and that row can never name a
        // destination, because a unit that gained nobody has no men and so no stated speed, which
        // is what `trace_move` needs to say where the month ends.
        if let Some(steps) = &entry.move_steps {
            match trace_move(&map, &ruleset, &entry.unit, steps, Some(&ordered)) {
                // The first month's end is where the unit stands when the next report is written;
                // the rest of a longer journey is later months' business.
                Some(path) => {
                    mode = path.mode;
                    match path.months.first() {
                        Some(month) if month.ends_at.id() != entry.unit.region_id => {
                            arrival = Some(month.ends_at.id());
                            status = UnitPreviewStatus::Departing;
                        }
                        // A round trip is not a departure, so only the other changes count.
                        Some(_) => {}
                        // The report never said how the unit travels, so the trace cannot say
                        // where the month ends: a departure to nowhere nameable.
                        None => status = UnitPreviewStatus::Departing,
                    }
                }
                None => status = UnitPreviewStatus::Departing,
            }
        }

        // A dissolving row is not standing anywhere next month, so it gets no arrival row however
        // the trace read - it keeps its `departing_to`, which is what draws the arrow. Today the
        // trace can never name a destination for one anyway; this says the intent rather than
        // relying on that.
        if dissolving {
            arrival = None;
        }

        // `TracedPath::mode` is the sail test rather than the order word: it is Sail exactly when
        // the unit is aboard a priceable fleet, which is what the map already draws.
        if status == UnitPreviewStatus::Departing
            && mode == Some(crate::movement::rules::MovementMode::Sail)
        {
            if let Some(structure_id) = entry.unit.structure_id.clone() {
                if let Some(label) = aboard_label(&report, &entry.unit.region_id, &structure_id) {
                    sailing.insert(
                        (entry.unit.region_id.clone(), structure_id),
                        SailingFleet {
                            // `None` is a value here, not a miss: a fleet whose destination cannot
                            // be named carries its passengers to nowhere nameable.
                            destination: arrival.clone(),
                            label,
                        },
                    );
                }
            }
        }

        decided.push(Decided {
            formed: entry.formed,
            dissolving,
            entry,
            status,
            arrival,
            aboard: None,
            dissolves_into: dissolved.get(&index).cloned().flatten(),
        });
    }

    for decided in &mut decided {
        // A unit with its own movement order keeps its own destination and gets no marker. A row
        // already departing or arriving has been decided by its own orders; a dissolving one is
        // never carried anywhere, because it never exists. A `Present` row that is *formed* is
        // carried like any other passenger: `rules/form` puts the new unit in its parent's
        // structure, so if that structure sails, it sails (`ah-4hux`, decision **Q4b**).
        if decided.entry.move_steps.is_some()
            || decided.status != UnitPreviewStatus::Present
            || decided.dissolving
        {
            continue;
        }
        let Some(structure_id) = decided.entry.unit.structure_id.clone() else {
            continue;
        };
        let Some(fleet) = sailing.get(&(decided.entry.unit.region_id.clone(), structure_id)) else {
            continue;
        };

        decided.status = UnitPreviewStatus::Departing;
        decided.arrival = fleet.destination.clone();
        decided.aboard = Some(fleet.label.clone());
    }

    let mut regions: BTreeMap<String, Vec<UnitPreview>> = BTreeMap::new();
    for Decided {
        entry,
        status,
        arrival,
        aboard,
        dissolves_into,
        formed,
        dissolving,
    } in decided
    {
        let changes = entry.changes();
        // Captured before `entry.unit` is moved below - the same data on both rows of a unit
        // that is arriving and departing at once, since items are not a property of where the
        // unit stands (`ah-agbm`).
        let uncounted = entry.uncounted.clone();
        let taken_unshown = entry.taken_unshown.clone();
        let skill_merges = entry.skill_merges.clone();
        let men_of_unknown_skill = entry.men_of_unknown_skill.clone();
        let recruits_unmerged = entry.recruits_unmerged;
        // The report's own list, typed. `None` for a formed unit, which the report never showed.
        let reported_skills = entry
            .original
            .as_ref()
            .map(|original| original.skills.clone())
            .unwrap_or_default();
        // `rules/sequenceofevents` runs the market - where a formed unit's own BUY of peasants
        // decides whether it gained anybody - before PRODUCE, BUILD and the month-long orders, so
        // a unit the market dissolved makes nothing (`ah-ty3s.3`). `uncounted` is kept: it names
        // orders the forecast could not read, which is a fact about the document rather than
        // about the month.
        let produced = if dissolving {
            Vec::new()
        } else {
            entry.produced.clone()
        };
        let built = if dissolving {
            Vec::new()
        } else {
            entry.built.clone()
        };
        let created = if dissolving {
            Vec::new()
        } else {
            entry.created.clone()
        };
        let study = if dissolving {
            None
        } else {
            entry.study.clone()
        };
        // `rules/form` dissolves a unit that gains nobody before the month ends, so it never held
        // anything to move (`ah-rgkk.3.1`), exactly as `produced`, `built` and `created` above.
        let item_changes = if dissolving {
            Vec::new()
        } else {
            entry.item_changes.clone()
        };
        let items_moved = !dissolving && entry.items_moved;
        let transport_sent = entry.transport_sent.clone();
        let transport_received = entry.transport_received.clone();
        let transport_target_issues = entry.transport_target_issues.clone();

        let departed = status == UnitPreviewStatus::Departing;
        if changes.is_empty()
            && !departed
            && !formed
            && uncounted.is_empty()
            && transport_sent.is_empty()
            && transport_received.is_empty()
            && transport_target_issues.is_empty()
            && study.is_none()
            // A unit that buys five of a tag and sells five of the same tag ends the month holding
            // what it started with, so `changes()` records nothing - and the row would be dropped
            // along with the explanation of why nothing changed (`ah-rgkk.3.1`).
            //
            // `items_moved` rather than `!item_changes.is_empty()`: a cast charged for materials
            // the mage does not hold records a change that takes nothing away (`ah-ofpb.5`), and a
            // row whose every change is one of those has nothing to show - admitting it would put
            // rows on the units table for orders with no effect at all, which is the leak
            // `tests/orders_preview.rs` guards against.
            && !items_moved
        {
            continue;
        }

        if let Some(destination) = arrival {
            let mut arrived = entry.unit.clone();
            arrived.region_id.clone_from(&destination);
            // A walker cannot take a building with it. A ship can, and does: the hull is what is
            // moving, so the unit is still standing in it when it gets there - the one that wrote
            // the SAIL and every passenger alike (ah-l2i.3). Keyed off the origin region, because
            // `arrived.region_id` is already the destination by now.
            let sails_along = entry.unit.structure_id.as_deref().is_some_and(|id| {
                sailing.contains_key(&(entry.unit.region_id.clone(), id.to_string()))
            });
            if !sails_along {
                arrived.structure_id = None;
            }
            regions
                .entry(destination.clone())
                .or_default()
                .push(UnitPreview {
                    unit: arrived,
                    status: UnitPreviewStatus::Arriving,
                    changes: changes.clone(),
                    arriving_from: Some(entry.unit.region_id.clone()),
                    departing_to: None,
                    // An arrival says only where the unit came from.
                    aboard: None,
                    uncounted: uncounted.clone(),
                    taken_unshown: taken_unshown.clone(),
                    produced: produced.clone(),
                    built: built.clone(),
                    created: created.clone(),
                    item_changes: item_changes.clone(),
                    transport_sent: transport_sent.clone(),
                    transport_received: transport_received.clone(),
                    transport_target_issues: transport_target_issues.clone(),
                    study: study.clone(),
                    // An arriving row is never dissolving, but the field is set from the same
                    // source on all three pushes rather than relying on that.
                    dissolves_into: dissolves_into.clone(),
                    formed,
                    dissolving,
                    skill_merges: skill_merges.clone(),
                    reported_skills: reported_skills.clone(),
                    recruits_unmerged,
                    men_of_unknown_skill: men_of_unknown_skill.clone(),
                });
            regions
                .entry(entry.unit.region_id.clone())
                .or_default()
                .push(UnitPreview {
                    departing_to: Some(destination),
                    unit: entry.unit,
                    status,
                    changes,
                    arriving_from: None,
                    aboard,
                    uncounted,
                    taken_unshown,
                    produced,
                    built,
                    created,
                    item_changes,
                    transport_sent,
                    transport_received,
                    transport_target_issues,
                    study,
                    dissolves_into: dissolves_into.clone(),
                    formed,
                    dissolving,
                    skill_merges,
                    reported_skills,
                    recruits_unmerged,
                    men_of_unknown_skill,
                });
        } else {
            regions
                .entry(entry.unit.region_id.clone())
                .or_default()
                .push(UnitPreview {
                    unit: entry.unit,
                    status,
                    changes,
                    arriving_from: None,
                    departing_to: None,
                    aboard,
                    uncounted,
                    taken_unshown,
                    produced,
                    built,
                    created,
                    item_changes,
                    transport_sent,
                    transport_received,
                    transport_target_issues,
                    study,
                    dissolves_into,
                    formed,
                    dissolving,
                    skill_merges,
                    reported_skills,
                    recruits_unmerged,
                    men_of_unknown_skill,
                });
        }
    }

    Ok(OrdersPreviewResponse {
        regions: regions
            .into_iter()
            .map(|(region_id, units)| RegionPreview { region_id, units })
            .collect(),
    })
}

/// Every own unit as this month's orders leave it, before movement is resolved, with the rows
/// `rules/form` dissolves and what each one's goods revert to.
///
/// Extracted from [`preview_orders_on_map`] rather than duplicated because the map's own trace
/// needs the same answer for a `FORM`ed unit: its speed comes from the men and goods its block is
/// given, so a caller that rebuilt the row from [`formed_unit`] alone would trace a unit of
/// unstated speed (`ah-4hux`). The order of the steps inside is load-bearing and each one's reason
/// is on the line that runs it.
fn settle(
    report: &crate::report::ParsedReport,
    ruleset: &std::sync::Arc<crate::movement::rules::Ruleset>,
    orders_document: &str,
) -> (Vec<WorkingUnit>, BTreeMap<usize, Option<String>>) {
    let mut working = Working::over_own_units(report, ruleset.clone());
    super::walk::walk(orders_document, |event| working.visit(event));
    // `rules/sequenceofevents` settles GIVE and TAKE in one Give phase, before the market - and
    // processes units in report order, which is why nothing moved while the document was being
    // read (`ah-3mwm`).
    working.apply_transfers();

    // What `BUY`, `SELL`, `WITHDRAW` and `TAKE` do to each unit's item list, read from the same
    // ledger the Silver column and the shortfall warnings settle an oversubscribed market line
    // from - so the ITEMS and SILVER cells on one row cannot disagree (`ah-agbm`). `GIVE` is not
    // read here: the walk above already applied every gift through `Working::give`.
    let item_effects =
        super::semantics::item_effects(report, orders_document, Some(ruleset.as_ref()));
    working.apply_item_effects(&item_effects);
    settle_headcounts(&mut working.units, ruleset);
    // `rules/form`, and only once the market has settled: a formed unit's own BUY is what decides
    // whether it gained anybody, so nothing can be dissolved before `item_effects` has been
    // applied and the headcounts derived from it (`ah-dhga`).
    let dissolved = working.dissolve_empty_forms();
    // Last of all, because `rules/sequenceofevents` runs TRANSPORT in the month's final phases -
    // after the market, after movement, after production. A sale takes its goods first, and
    // whatever a PRODUCE made this month is there to be sent.
    working.apply_transports(&dissolved);
    // A dissolving row is drawn now (`ah-ty3s.3`), so its weight, capacity and movement are
    // settled exactly like any other formed row's rather than left at `formed_unit`'s defaults.
    for working_unit in working.units.iter_mut() {
        working_unit.refresh_movement(ruleset);
    }

    (working.units, dissolved)
}

/// One unit this month's `FORM` creates, as the whole month's orders leave it.
///
/// `None` for an id no `FORM` in this document creates, which includes every real unit number and
/// a `new-<alias>` whose block is not in this document. A dissolving unit **is** returned: the
/// order it was written is still drawn (decision **Q3b'** of `ah-4hux`).
pub(crate) fn formed_unit_as_ordered(
    report: &crate::report::ParsedReport,
    ruleset: &std::sync::Arc<crate::movement::rules::Ruleset>,
    orders_document: &str,
    unit_id: &str,
) -> Option<ReportUnit> {
    // Not an optimisation to skip: without it every trace of an id the report does not carry would
    // run the whole settling pipeline to find nothing.
    if !unit_id.starts_with(FORMED_ID_PREFIX) {
        return None;
    }
    let (units, _) = settle(report, ruleset, orders_document);
    units
        .into_iter()
        .find(|entry| entry.formed && entry.unit.unit_id == unit_id)
        .map(|entry| entry.unit)
}

/// One unit's verdict, held between the two passes of the preview.
struct Decided {
    entry: WorkingUnit,
    status: UnitPreviewStatus,
    /// Where the unit ends the month, when the trace could say.
    arrival: Option<String>,
    /// Set on the departing row of a unit carried by a fleet: `<name> [<id>]`.
    aboard: Option<String>,
    /// Set on a dissolving row alone: the unit its goods revert to (`ah-ty3s.3`).
    dissolves_into: Option<String>,
    /// This month's `FORM` creates this unit (`ah-4hux`).
    formed: bool,
    /// `rules/form` dissolves this unit before the month ends (`ah-4hux`).
    dissolving: bool,
}

/// A fleet leaving its hex this month, as its passengers need to read it.
struct SailingFleet {
    /// Where the fleet ends the month, or nothing when the trace could not say.
    destination: Option<String>,
    /// `<name> [<id>]`, for the carried unit's row.
    label: String,
}

/// How a carrying fleet is named to the player: `Wavecrest [329]`.
///
/// The player renames a ship precisely so they can tell two apart, so the name is the half worth
/// showing - `movement::mode::fleet_label`'s kind would read `Longship [329]` for every hull of that
/// kind in the hex. Nothing is said about a hull the report does not list; in practice the trace
/// found the fleet in this same list, so that is a guard rather than a case.
fn aboard_label(
    report: &crate::report::ParsedReport,
    region_id: &str,
    structure_id: &str,
) -> Option<String> {
    let structure = report
        .regions
        .iter()
        .find(|region| region.region_id == region_id)?
        .structures
        .iter()
        .find(|structure| structure.structure_id == structure_id)?;
    Some(format!("{} [{}]", structure.name, structure.structure_id))
}

/// The flags a `FORM`ed unit inherits from the unit that formed it.
///
/// `rules/form`: the new unit inherits its parent's flags "with the exception of the guard and
/// autotax flags". Both spellings of each are dropped, matched case-insensitively the way every
/// other flag reader in this crate matches. `under strength` goes too: it is a state the engine
/// prints about a unit rather than a flag a player sets, and a unit created this month has no such
/// history.
pub(crate) fn inherited_flags(parent_flags: &[String]) -> Vec<String> {
    parent_flags
        .iter()
        .filter(|flag| {
            !crate::report::unit::GUARD_FLAGS
                .iter()
                .chain(crate::orders::silver::TAXING_FLAGS.iter())
                .chain(std::iter::once(&"under strength"))
                .any(|excluded| excluded.eq_ignore_ascii_case(flag))
        })
        .cloned()
        .collect()
}

/// The id a `FORM`ed unit is known by until the game issues a real one: `new-1` for `FORM 1`.
///
/// Declared here because [`formed_unit`] writes it and both [`formed_unit_as_ordered`] and
/// `movement::fleet::OrderedUnits` read it back (`ah-4hux`).
pub(crate) const FORMED_ID_PREFIX: &str = "new-";

/// The unit a `FORM n` creates, as it stands at the start of the turn.
///
/// No items, no skills, no men - flags are the one thing it does carry over, because `rules/form`
/// says the new unit inherits its parent's, less the guard and autotax pair. Everything else it
/// comes to hold arrives through this month's orders,
/// exactly as it does for a unit the report shows. That is the whole of what makes it an ordinary
/// unit to the checks, and it is why `semantics` builds it with this function rather than with one
/// of its own - two readings of which units a document forms, and of what they are called, is how
/// the table's rows and the column's figures come to disagree about one turn.
pub(crate) fn formed_unit(
    parent: &ReportUnit,
    alias: &str,
    reported_flags: &[String],
) -> ReportUnit {
    ReportUnit {
        unit_id: format!("{FORMED_ID_PREFIX}{alias}"),
        name: format!("Unit (new {alias})"),
        region_id: parent.region_id.clone(),
        faction_id: parent.faction_id.clone(),
        faction_name: parent.faction_name.clone(),
        own: true,
        on_guard: false,
        flags: inherited_flags(reported_flags),
        items: Vec::new(),
        skills: Vec::new(),
        // A newly formed unit has cast nothing and been set to cast nothing.
        combat_spell: None,
        men: 0,
        // Nothing has been given yet, and what is given is counted exactly.
        men_estimated: false,
        men_by_race: Vec::new(),
        weight: None,
        capacity: None,
        movement: None,
        // The game creates the new unit in the same object as the unit forming it.
        structure_id: parent.structure_id.clone(),
    }
}

/// One unit as the walker holds it: the state being changed, and the report's word for diffing.
struct WorkingUnit {
    unit: ReportUnit,
    original: Option<ReportUnit>,
    formed: bool,
    move_steps: Option<Vec<crate::movement::orders::MoveStep>>,
    /// Where this unit stood before any of its boarding orders ran: the report's answer, or for a
    /// formed unit the structure its parent stood in when the FORM was read.
    reported: Option<String>,
    /// The unit's flags as the report showed them at the start of the turn - what a `FORM` in this
    /// unit's block inherits.
    ///
    /// Kept rather than read from `unit.flags`, because the walk mutates those as it reads
    /// `GUARD`/`AVOID`/`BEHIND`, and `rules/sequenceofevents` processes every `FORM` before any of
    /// those orders. A formed unit's own entry holds the set it inherited, so a nested `FORM`
    /// inherits the same thing whatever its block wrote above it.
    reported_flags: Vec<String>,
    /// The unit's ENTER and LEAVE orders so far, in the order they were written.
    ///
    /// Kept rather than applied as they are read, because what they mean together is
    /// [`super::standing`]'s to say and only its. The answer is recomputed from the whole list
    /// after each one, so a FORM later in the block still inherits the structure the unit is
    /// standing in by then - `visit` is a mutating walk and other arms read `structure_id`.
    boardings: Vec<BoardingOrder>,
    /// What this row was handed by `GIVE` this month, in the order the gifts were read.
    ///
    /// Only a formed unit's is read, and only to dissolve it: `rules/form` reverts "the silver and
    /// any other items it **was given**", which is exactly this list and not whatever the row's
    /// own month bought or took (`ah-dhga`).
    given: Vec<crate::report::model::ItemAmount>,
    /// This unit's orders whose effect on its items could not be counted, verbatim, in document
    /// order. Written once by `apply_item_effects`, after the walk that builds every unit here has
    /// finished (`ah-agbm`).
    uncounted: Vec<String>,
    /// Silver or goods taken from a unit the report does not show in this hex. Written once by
    /// `apply_item_effects` (`ah-agbm`).
    taken_unshown: Vec<TakenUnshown>,
    /// What this unit's `PRODUCE` orders make this month. Written once by `apply_item_effects`
    /// (`ah-ofpb.1`).
    produced: Vec<ProducedItem>,
    /// What this unit's `BUILD` orders spend this month. Written once by `apply_item_effects`
    /// (`ah-ofpb.2`).
    built: Vec<BuildSpend>,
    /// What this unit's `CAST` orders create this month. Written once by `apply_item_effects`
    /// (`ah-ofpb.5`).
    created: Vec<CreatedItem>,
    /// Every item this month's orders move into or out of this unit, in the month's order.
    ///
    /// **Appended to, never assigned**: each phase's writer adds its own, and the writers run in
    /// the month's order - `apply_transfers` first (`ah-rgkk.3.2`'s seam), then
    /// `apply_item_effects` with the ledger's already-sorted movements, then `apply_transports`
    /// last (`ah-rgkk.3.1`).
    item_changes: Vec<ItemChange>,
    /// Whether any of those changes actually moved stock on this row.
    ///
    /// Never on the wire, and not the same question as "is `item_changes` non-empty": a `CAST` is
    /// charged its materials at the ceiling whether or not the mage holds them (`ah-ofpb.5`), so a
    /// mage with none of the material records a change that takes nothing away. A row whose every
    /// change is one of those has nothing to show, and `preview_orders_on_map` skips it - the
    /// buy-then-sell month that nets to zero is the case the row is kept for (`ah-rgkk.3.1`).
    items_moved: bool,
    /// What this unit's `TRANSPORT`/`DISTRIBUTE` orders send this month. Written once by
    /// `apply_transports`, after everything else has run (`ah-bxgs`).
    transport_sent: Vec<TransportSent>,
    /// What arrives at this unit by another unit's `TRANSPORT`/`DISTRIBUTE` this month. Written
    /// once by `apply_transports` (`ah-bxgs`).
    transport_received: Vec<TransportReceived>,
    /// This unit's settled recruits this month, copied from `UnitItemEffects::recruited` by
    /// `apply_item_effects`. Empty when nothing was recruited and when a `BUY ALL` makes the exact
    /// figure unknowable; `settle_headcounts` reads this to dilute skills by the exact settled
    /// count rather than infer one from the item list's net change (`ah-4a13`).
    recruited: Vec<crate::report::model::ItemAmount>,
    /// This unit's `TRANSPORT`/`DISTRIBUTE` orders whose target the report cannot show as able to
    /// receive. Written once by `apply_transports` (`ah-64wm`).
    transport_target_issues: Vec<TransportTargetIssue>,
    /// Why this unit's skills moved this month, one record per merge of arriving men, in the order
    /// the merges ran. Written by `move_between` and by `settle_headcounts` (`ah-rgkk.2.1`).
    skill_merges: Vec<SkillMerge>,
    /// Men credited from a unit the report does not show, whose own skills are unknown and who are
    /// therefore left out of every merge. Written once by `settle_headcounts` (`ah-rgkk.2.1`).
    men_of_unknown_skill: Vec<TakenUnshown>,
    /// `settle_headcounts` skipped this unit because the report could only estimate its headcount,
    /// and it had settled recruits that were therefore never merged in (`ah-rgkk.2.1`).
    recruits_unmerged: bool,
    /// Where this unit's `STUDY` lands next turn, copied from `UnitItemEffects::study` by
    /// `apply_item_effects` (`ah-rgkk.2.2`).
    study: Option<StudyForecast>,
}

/// One settled transfer as `move_between` needs it: everything about the order itself, once
/// `give` and `take` have each resolved which rows it is between.
///
/// A struct rather than six more parameters - `move_between` already takes the two row indices,
/// and clippy's argument limit is a fair reading of how easily two `usize`s and a `bool` are
/// swapped by mistake.
#[derive(Clone, Copy)]
struct Transfer<'a> {
    what: &'a super::forms::Selector,
    amount: &'a super::forms::Amount,
    reach: super::targets::GiveReach,
    /// `rules/magic` forbids a mage to GIVE men and says nothing about TAKE, so the one rule this
    /// half applies differently for its two callers needs telling which it is serving (`ah-t8ei`).
    is_give: bool,
    /// The 1-based document line of the order responsible.
    line: usize,
    /// The transfer's other end as the order wrote it, for the change on the source's side:
    /// `move_between` is reached with a `receiver` only when a row of ours gains the goods.
    party: &'a super::forms::Party,
}

impl WorkingUnit {
    /// The fields the orders changed, each with what the report said.
    ///
    /// Formatted for a tooltip rather than typed, because "was: ..." is all the interface does
    /// with an original. A formed unit has no original and so never any changes.
    fn changes(&self) -> Vec<FieldChange> {
        let Some(original) = &self.original else {
            return Vec::new();
        };
        let mut changes = Vec::new();
        let mut change = |field: &str, changed: bool, original: String| {
            if changed {
                changes.push(FieldChange {
                    field: field.to_string(),
                    original,
                });
            }
        };

        change(
            "name",
            self.unit.name != original.name,
            original.name.clone(),
        );
        change(
            "onGuard",
            self.unit.on_guard != original.on_guard,
            if original.on_guard { "yes" } else { "no" }.to_string(),
        );
        change(
            "flags",
            self.unit.flags != original.flags,
            original.flags.join(", "),
        );
        change(
            "items",
            self.unit.items != original.items,
            original
                .items
                .iter()
                .map(|item| format!("{} {}", item.amount, item.tag))
                .collect::<Vec<_>>()
                .join(", "),
        );
        change(
            "skills",
            self.unit.skills != original.skills,
            original
                .skills
                .iter()
                .map(|skill| format!("{} {} ({})", skill.tag, skill.level, skill.points))
                .collect::<Vec<_>>()
                .join(", "),
        );
        change(
            "men",
            self.unit.men != original.men,
            original.men.to_string(),
        );
        change(
            "structureId",
            self.unit.structure_id != original.structure_id,
            original.structure_id.clone().unwrap_or_default(),
        );
        let original_status = original.movement.map(|movement| movement.status);
        let current_status = self.unit.movement.map(|movement| movement.status);
        if original_status != current_status {
            if let Some(status) = original_status {
                changes.push(FieldChange {
                    field: "movement".to_string(),
                    original: movement_status_label(status).to_string(),
                });
            }
        }
        changes
    }

    /// Whether this row had already begun magic **when the report was printed** (`ah-ndp9`).
    ///
    /// The report's own list, not `self.unit.skills`: this table is mutated as the walk runs -
    /// `move_between` merges arriving men's skills into a receiver - and a unit that takes a
    /// mage's leader mid-document would otherwise read as a mage here while `apply_transfers`,
    /// which asks the report, says it is not. One policy on every surface is exactly what
    /// `orders::magic` exists for. A formed unit has no original and no skills, so it is never a
    /// mage either way.
    fn is_mage_as_reported(&self, ruleset: &Ruleset) -> bool {
        let skills = self
            .original
            .as_ref()
            .map_or(&[][..], |original| original.skills.as_slice());
        super::magic::is_mage(ruleset, skills)
    }

    fn refresh_movement(&mut self, ruleset: &Ruleset) {
        if !self.formed
            && self
                .original
                .as_ref()
                .is_some_and(|original| self.unit.items == original.items)
        {
            return;
        }
        if !self.uncounted.is_empty()
            || self
                .created
                .iter()
                .any(|created| created.fewest != created.most)
        {
            self.unit.movement = self.original.as_ref().and_then(|unit| unit.movement);
            return;
        }
        self.unit.movement = crate::movement::mode::unit_movement_from_items(&self.unit, ruleset)
            .or_else(|| self.original.as_ref().and_then(|unit| unit.movement));
    }
}

fn movement_status_label(status: UnitMovementStatus) -> &'static str {
    match status {
        UnitMovementStatus::Overloaded => "Overloaded",
        UnitMovementStatus::Fly => "Flying",
        UnitMovementStatus::Ride => "Riding",
        UnitMovementStatus::Walk => "Walking",
    }
}

/// The walker's state across the document.
struct Working {
    units: Vec<WorkingUnit>,
    /// Index by unit id, for `unit` lines and GIVE targets.
    by_id: BTreeMap<String, usize>,
    /// Index by `(region id, alias)`, because `NEW n` names are per-hex: any own unit in the same
    /// hex may give to a sibling's formed unit.
    by_alias: BTreeMap<(String, String), usize>,
    /// The unit whose block the walker is inside.
    current: Option<usize>,
    /// Formed units being described, innermost last. `None` marks a FORM that could not be read,
    /// so its orders are swallowed rather than applied to whoever came before.
    forming: Vec<Option<usize>>,
    /// Consulted only to tell people from equipment when a GIVE moves a race.
    ruleset: std::sync::Arc<crate::movement::rules::Ruleset>,
    /// Every `TRANSPORT`/`DISTRIBUTE` this document writes, in document order, to be applied once
    /// everything else has been. `rules/sequenceofevents` runs transport in the month's last
    /// phases, after the market and after production, so a sale written below a transport still
    /// takes its goods first (`ah-bxgs`).
    transports: Vec<PendingTransport>,
    /// Every unit id the report names, ours and everyone else's. A target in here but not in
    /// `by_id` is a unit we can see and cannot project; one in neither is what the hover calls
    /// "which your report does not show" (`ah-bxgs`).
    known_units: std::collections::BTreeSet<String>,
    /// Every unit id the report shows in each region, ours and everyone else's, keyed by region id.
    ///
    /// `known_units` above is report-wide and answers `ah-bxgs`'s TRANSPORT question, which reaches
    /// across hexes. A `GIVE` is settled in one hex - `rules/sequenceofevents` runs it in phase 4,
    /// before anything moves in phase 9 - so the test a target needs is per-region, and the two
    /// must not be confused (`ah-vcp8.2`).
    shown_in_region: BTreeMap<String, std::collections::BTreeSet<String>>,
    /// Every unit id the report shows that is not ours. A `TAKE` naming one of these is refused
    /// outright - `rules/take` confines a TAKE to "another unit in the same faction" - and must
    /// not be mistaken for the bounded optimism a take from a unit the report never shows gets.
    foreign_units: std::collections::BTreeSet<String>,
    /// Every `GIVE` and `TAKE` this document writes, applied only once the whole document has
    /// been read. `rules/sequenceofevents` settles both in one Give phase and processes units
    /// "in the order they appear on the report", which is not the order their blocks were
    /// written in (`ah-3mwm`).
    transfers: Vec<PendingTransfer>,
    /// Every unit id the report shows holding the quartermaster skill, resolved through the
    /// catalogue rather than by tag spelling - `QUAM` is quartermaster and `QUAR` is quarrying
    /// (`ah-d0ku`).
    quartermasters: std::collections::BTreeSet<String>,
    /// What the report can say about each unit it shows as a `TRANSPORT`/`DISTRIBUTE` target,
    /// keyed by unit id. A target missing from here is one the report never described
    /// (`ah-64wm`).
    transport_targets: BTreeMap<String, TransportTargetFacts>,
}

/// One `GIVE` or `TAKE`, held until the whole document has been read so the Give phase can be
/// settled in report order (`ah-3mwm`).
struct PendingTransfer {
    /// The unit whose block the order is in - its position in `Working::units`, which is report
    /// order for reported units and, after them, the order the `FORM` blocks created them in.
    actor: usize,
    /// The document line, the secondary key: report order chooses between actors, and this still
    /// chooses between several transfers one actor wrote.
    line: usize,
    /// The other end. For a `GIVE` this is the receiver; for a `TAKE`, `rules/take` reverses the
    /// direction and it is the source.
    party: super::forms::Party,
    what: super::forms::Selector,
    amount: super::forms::Amount,
    is_give: bool,
}

/// What the report shows about one unit that a `TRANSPORT` could name (`ah-64wm`).
///
/// Read from the report alone, before any order runs: `rules/transport` asks about the target's
/// skill and its structure, and neither is something this month's orders are being previewed to
/// change here.
struct TransportTargetFacts {
    /// Ours, whose skills the report prints in full - so an absent skill is an absent skill,
    /// rather than an undisclosed one.
    own: bool,
    /// Whether the absence of the skill can be read as absence at all. It cannot when the
    /// catalogue names no quartermaster skill to resolve: nothing about the unit is then known,
    /// and saying "is not a quartermaster" would state a catalogue fault as a fact about the
    /// player's report (`ah-64wm`, `ah-d0ku`).
    quartermaster_disclosed: bool,
    /// The report shows the quartermaster skill on this unit, resolved through the catalogue
    /// rather than by tag spelling (`ah-d0ku`).
    quartermaster: bool,
    /// The unit is the first one listed inside a Caravanserai in its hex, which is what
    /// `rules/world_structures` makes the owner of the structure.
    caravanserai_owner: bool,
}

/// Whether a structure is the one `rules/economy_transport` allows transport into: "The structures
/// which allow this are: Caravanserai."
///
/// `base_kind` is the kind with its qualifiers stripped, and is what a bare-word match wants. It is
/// empty on a hex remembered before that field existed, whose JSON defaulted it; the kind before
/// its first comma is the same answer the parser would have derived (`ah-64wm`).
fn is_caravanserai(structure: &crate::report::model::Structure) -> bool {
    let base = if structure.base_kind.is_empty() {
        structure.kind.split(',').next().unwrap_or_default().trim()
    } else {
        structure.base_kind.as_str()
    };
    base.eq_ignore_ascii_case("Caravanserai")
}

/// What the report says about every unit it shows, as a `TRANSPORT` target (`ah-64wm`).
fn transport_target_facts(
    report: &crate::report::ParsedReport,
    quartermasters: &std::collections::BTreeSet<String>,
    quartermaster_known: bool,
) -> BTreeMap<String, TransportTargetFacts> {
    let mut facts = BTreeMap::new();
    for region in &report.regions {
        // The first unit listed inside each Caravanserai owns it (`rules/world_structures`), so
        // the owners are read off the region's unit list in the order the report wrote them.
        let mut owners: BTreeMap<&str, &str> = BTreeMap::new();
        for structure in region.structures.iter().filter(|one| is_caravanserai(one)) {
            if let Some(owner) = region
                .units
                .iter()
                .find(|unit| unit.structure_id.as_deref() == Some(&structure.structure_id))
            {
                owners.insert(structure.structure_id.as_str(), owner.unit_id.as_str());
            }
        }
        for unit in &region.units {
            let caravanserai_owner = unit.structure_id.as_deref().is_some_and(|structure_id| {
                owners.get(structure_id) == Some(&unit.unit_id.as_str())
            });
            facts.insert(
                unit.unit_id.clone(),
                TransportTargetFacts {
                    own: unit.own,
                    quartermaster_disclosed: quartermaster_known,
                    quartermaster: quartermasters.contains(&unit.unit_id),
                    caravanserai_owner,
                },
            );
        }
    }
    facts
}

/// What the report can say about a named `TRANSPORT`/`DISTRIBUTE` target (`ah-64wm`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportTargetOutcome {
    /// One of ours, with the quartermaster skill, owning a Caravanserai: the goods go.
    Eligible,
    Refused(TransportTargetReason),
}

/// One `TRANSPORT`/`DISTRIBUTE` order, held until the month's other orders have been worked out
/// (`ah-bxgs`).
struct PendingTransport {
    sender: usize,
    /// The receiving row, when the target is one of ours. `None` for an ally's quartermaster or a
    /// unit number the report does not carry, which `Working::transport_target` settles before
    /// anything moves (`ah-64wm`).
    receiver: Option<usize>,
    /// The unit number as the order wrote it, for the hover.
    to: String,
    /// `true` when `to` appears nowhere in the report at all.
    to_unshown: bool,
    what: super::forms::Selector,
    amount: super::forms::Amount,
    /// Where the line stood in the document, kept privately so phase execution can restore
    /// document order on `transport_sent`/`transport_received` afterwards (`ah-d0ku`).
    sequence: usize,
}

/// The three phases `rules/sequenceofevents` runs TRANSPORT in, in rule order: "Items are sent
/// from non-quartermaster units to quartermaster units", then "from one quartermaster unit to
/// another quartermaster units", then "a quartermaster unit to non-quartermaster units"
/// (`ah-d0ku`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum TransportPhase {
    ToQuartermaster,
    BetweenQuartermasters,
    FromQuartermaster,
}

impl Working {
    fn over_own_units(
        report: &crate::report::ParsedReport,
        ruleset: std::sync::Arc<crate::movement::rules::Ruleset>,
    ) -> Self {
        let mut units = Vec::new();
        let mut by_id = BTreeMap::new();
        for unit in report.own_units() {
            by_id.insert(unit.unit_id.clone(), units.len());
            units.push(WorkingUnit {
                unit: unit.clone(),
                original: Some(unit.clone()),
                formed: false,
                move_steps: None,
                reported: unit.structure_id.clone(),
                reported_flags: unit.flags.clone(),
                boardings: Vec::new(),
                given: Vec::new(),
                uncounted: Vec::new(),
                taken_unshown: Vec::new(),
                produced: Vec::new(),
                built: Vec::new(),
                created: Vec::new(),
                item_changes: Vec::new(),
                items_moved: false,
                transport_sent: Vec::new(),
                transport_received: Vec::new(),
                recruited: Vec::new(),
                transport_target_issues: Vec::new(),
                skill_merges: Vec::new(),
                men_of_unknown_skill: Vec::new(),
                recruits_unmerged: false,
                study: None,
            });
        }
        let known_units: std::collections::BTreeSet<String> =
            report.units().map(|unit| unit.unit_id.clone()).collect();
        // `rules/sequenceofevents` phases TRANSPORT by whether each end is a quartermaster, so the
        // skill has to be resolved by name through the catalogue: `QUAM` is quartermaster and
        // `QUAR` is quarrying, and matching the spelling alone confuses the two (`ah-d0ku`).
        let quartermaster_tag = ruleset
            .find_skill("quartermaster")
            .map(|skill| skill.tag.to_string());
        let quartermasters = match &quartermaster_tag {
            Some(tag) => report
                .units()
                .filter(|unit| {
                    unit.skills
                        .iter()
                        .any(|skill| skill.tag.eq_ignore_ascii_case(tag))
                })
                .map(|unit| unit.unit_id.clone())
                .collect(),
            // No catalogue entry for the skill: nothing can be classified, every sender falls to
            // the first phase, and transport settles in one pass as it did before `ah-d0ku`. No
            // target can be classified either, so `transport_target` reports every one of them as
            // eligibility the report cannot establish rather than stating a catalogue fault as a
            // missing skill (`ah-64wm`). The shipped ruleset states `quartermaster [QUAM]`, so
            // this is a catalogue fault rather than a report one (`ah-d0ku`).
            None => std::collections::BTreeSet::new(),
        };
        let transport_targets =
            transport_target_facts(report, &quartermasters, quartermaster_tag.is_some());
        let mut shown_in_region: BTreeMap<String, std::collections::BTreeSet<String>> =
            BTreeMap::new();
        for region in &report.regions {
            let shown = shown_in_region.entry(region.region_id.clone()).or_default();
            for unit in &region.units {
                shown.insert(unit.unit_id.clone());
            }
        }
        Self {
            units,
            by_id,
            by_alias: BTreeMap::new(),
            current: None,
            forming: Vec::new(),
            ruleset,
            transports: Vec::new(),
            quartermasters,
            known_units,
            shown_in_region,
            foreign_units: report
                .units()
                .filter(|unit| !unit.own)
                .map(|unit| unit.unit_id.clone())
                .collect(),
            transfers: Vec::new(),
            transport_targets,
        }
    }

    /// Folds one event from [`super::walk`] into the units being built.
    ///
    /// The walk settles the block bookkeeping - nesting, which closer belongs to which opener, an
    /// unclosed block abandoned at the next `unit` line or `#` directive - so only the semantics
    /// specific to a preview are left here: a `FORM` at top level starts describing a new unit, an
    /// order at top level is applied to whichever unit (formed or not) is currently active, and
    /// anything at `depth.turn > 0` is next month's and changes nothing.
    fn visit(&mut self, event: super::walk::Event<'_>) {
        use super::walk::{BlockKind, Event};

        match event {
            Event::Broken { .. } => {}
            Event::Directive(_) => {
                // `#atlantis` and `#end` bound the document; neither leaves a unit's block open.
                self.current = None;
                self.forming.clear();
            }
            Event::Unit(line) => {
                self.forming.clear();
                self.current = line
                    .arguments
                    .first()
                    .and_then(|id| self.by_id.get(&id.text))
                    .copied();
            }
            Event::Open {
                line,
                kind: BlockKind::Form,
                depth,
            } if depth.turn == 0 => {
                self.open_form(line.arguments);
            }
            Event::Open { .. } => {}
            Event::Close {
                kind: BlockKind::Form,
                depth,
                ..
            } if depth.turn == 0 => {
                self.forming.pop();
            }
            Event::Close { .. } | Event::Stray { .. } | Event::Abandoned(_) => {}
            Event::Order { line, depth } if depth.turn == 0 => {
                self.read_order(line.command, line.arguments, line.number);
            }
            Event::Order { .. } => {}
        }
    }

    /// The unit the next order belongs to: the formed unit being described, or the block's own.
    fn active(&self) -> Option<usize> {
        match self.forming.last() {
            Some(formed) => *formed,
            None => self.current,
        }
    }

    /// Dissolves every formed unit that gained nobody, returning its goods to the first own unit
    /// the report shows in that region (`rules/form`: "If no recruits are gained at all, the empty
    /// unit will be dissolved, and the silver and any other items it was given will revert to the
    /// first unit you have in that region").
    ///
    /// Returns the indices of the dissolved rows rather than removing them: `by_id`, `by_alias`
    /// and every queued `PendingTransport` store indices into `self.units`, so the entries stay
    /// put and the caller filters them out while rendering. What the row was not given stays on
    /// it, unrendered - so `apply_transports` is given the same set and drops what a dissolved row
    /// had queued.
    /// Each index carries its recipient's label, as `<name> (<id>)`, or `None` where the region
    /// shows no own unit for the goods to revert to (`ah-ty3s.3`).
    fn dissolve_empty_forms(&mut self) -> BTreeMap<usize, Option<String>> {
        let mut dissolved = BTreeMap::new();
        for index in 0..self.units.len() {
            if !self.units[index].formed || self.units[index].unit.men != 0 {
                continue;
            }
            let region_id = self.units[index].unit.region_id.clone();
            // `over_own_units` preserves report order, so `position` finds the first unit the
            // report shows in that region - not the unit that formed this one. A region with no
            // own report unit has nobody to revert to, and then nothing is taken from the
            // dissolving row either: taking first and discarding what could not be handed over
            // would destroy the goods.
            let Some(recipient) = self
                .units
                .iter()
                .position(|unit| unit.unit.region_id == region_id && unit.original.is_some())
            else {
                dissolved.insert(index, None);
                continue;
            };
            // Exactly what it was *given*, which is what `rules/form` reverts - not what its own
            // month bought, produced or took. A `BUY` the game would never have executed must not
            // become a windfall for the unit the goods revert to.
            //
            // Clamped to what the row still holds, by the same case-insensitive tag match the
            // rest of this file uses: a gift the unit then sold or gave on is not there to
            // revert. The clamp is a bound, not a ledger - it cannot tell gifted stock from stock
            // the row acquired itself, so a row given 100 silver, giving it on and then earning
            // 50 reverts that 50. At this layer that is the cheaper wrong answer of the two.
            for gift in std::mem::take(&mut self.units[index].given) {
                let Some(at) = self.units[index]
                    .unit
                    .items
                    .iter()
                    .position(|item| item.tag.eq_ignore_ascii_case(&gift.tag))
                else {
                    continue;
                };
                let moved = gift.amount.min(self.units[index].unit.items[at].amount);
                if moved <= 0 {
                    continue;
                }
                take_item(&mut self.units[index].unit.items, at, moved);
                add_item(
                    &mut self.units[recipient].unit.items,
                    &gift.name,
                    &gift.tag,
                    moved,
                );
                // Both read before the push: `self.units` is indexed mutably for `recipient`
                // while `index` is still being read.
                //
                // `is_man` is asked with the tag exactly as the report wrote it - `given` is
                // written from `tags_moved`, which clones the held item's own tag - the same as
                // every other `is_man` call in this file. If the catalogue lookup ever needs
                // canonicalising it needs it in `Ruleset::is_man`, not here.
                let is_man = self.ruleset.is_man(&gift.tag);
                let dissolving = ItemChangeParty {
                    unit_id: self.units[index].unit.unit_id.clone(),
                    name: Some(self.units[index].unit.name.clone()),
                };
                // `moved`, not `gift.amount`: the clamp above is what actually changed hands.
                self.units[recipient].item_changes.push(ItemChange {
                    tag: gift.tag.clone(),
                    name: gift.name.clone(),
                    delta: moved,
                    cause: ItemChangeCause::GiftReverted,
                    // The gift's own line is not kept on `given`, and the revert is not an order
                    // the player wrote: `rules/form` does it because the unit gained nobody.
                    line: None,
                    unit_price: None,
                    other: Some(dissolving),
                    is_man,
                });
            }
            dissolved.insert(
                index,
                Some(format!(
                    "{} ({})",
                    self.units[recipient].unit.name, self.units[recipient].unit.unit_id
                )),
            );
        }
        dissolved
    }

    /// Applies what `BUY`, `SELL` and `WITHDRAW` move into or out of each unit's item
    /// list, and records what could not be counted at all - `super::semantics::item_effects`'s
    /// seam onto the ledger the same settlement already prices (`ah-agbm`).
    ///
    /// `GIVE` and `TAKE` are not read here: `Working::apply_transfers` has already settled the
    /// whole Give phase in report order, and the ledger records no movement for either for
    /// exactly that reason - applying one again here would move it twice (`ah-3mwm`).
    fn apply_item_effects(
        &mut self,
        effects: &BTreeMap<super::semantics::UnitKey, super::semantics::UnitItemEffects>,
    ) {
        // Cloned before the loop: `self.units` is borrowed mutably by it.
        let ruleset = std::sync::Arc::clone(&self.ruleset);
        for unit in &mut self.units {
            let Some(effect) = effects.get(&super::semantics::unit_key(
                &unit.unit.region_id,
                &unit.unit.unit_id,
            )) else {
                continue;
            };
            for movement in &effect.moved {
                match movement.delta.cmp(&0) {
                    std::cmp::Ordering::Greater => {
                        add_item(
                            &mut unit.unit.items,
                            &movement.name,
                            &movement.tag,
                            movement.delta,
                        );
                        unit.items_moved = true;
                    }
                    std::cmp::Ordering::Less => {
                        // A stock can go negative here - the ledger clamps against a running
                        // balance while `give` above clamped against the report's holding, so an
                        // overdrawn unit can reach one. `take_item` already drops a stock at or
                        // below zero, which is the clamp this column needs; an item already
                        // absent (emptied by an earlier movement) has nothing left to remove.
                        if let Some(index) = unit
                            .unit
                            .items
                            .iter()
                            .position(|item| item.tag.eq_ignore_ascii_case(&movement.tag))
                        {
                            take_item(&mut unit.unit.items, index, -movement.delta);
                            unit.items_moved = true;
                        }
                    }
                    std::cmp::Ordering::Equal => {}
                }
            }
            unit.uncounted = effect.uncounted.clone();
            unit.recruited = effect.recruited.clone();
            unit.study = effect.study.clone();
            unit.produced = effect
                .moved
                .iter()
                .filter(|movement| movement.cause == ItemChangeCause::Produced)
                .map(|movement| ProducedItem {
                    amount: movement.delta,
                    tag: movement.tag.clone(),
                })
                .collect();
            unit.built = effect.built.clone();
            // `extend`, never assign: `apply_transfers` has already written this month's GIVE and
            // TAKE here in the Give phase, and `apply_transports` appends after us (`ah-rgkk.3.1`).
            unit.item_changes
                .extend(effect.moved.iter().map(|movement| ItemChange {
                    tag: movement.tag.clone(),
                    name: movement.name.clone(),
                    delta: movement.delta,
                    cause: movement.cause,
                    line: movement.line,
                    unit_price: movement.unit_price,
                    other: movement.other.clone(),
                    is_man: ruleset.is_man(&movement.tag),
                }));
            unit.created = effect
                .moved
                .iter()
                .filter_map(|movement| {
                    movement.created.as_ref().map(|created| CreatedItem {
                        fewest: created.fewest,
                        most: movement.delta,
                        tag: movement.tag.clone(),
                        summoned: created.summoned,
                    })
                })
                .collect();
        }
    }

    fn open_form(&mut self, arguments: &[super::lexer::Token]) {
        // The alias has to be a number of at least 1 (`rules/form`): `GIVE NEW n` is the only way
        // to reach the formed unit, and the grammar's `Arg::Unit` accepts `NEW 1` and never
        // `NEW a` or `NEW 0`.
        let alias = arguments
            .first()
            .and_then(|token| super::forms::read_alias(token));
        let (Some(alias), Some(parent)) = (alias, self.active()) else {
            // A FORM that cannot be read still opens a block, or its orders would fall through
            // to the unit outside it.
            self.forming.push(None);
            return;
        };

        // The parent's start-of-turn flags, cloned out before the row is borrowed: what a `FORM`
        // in this block inherits (`rules/form`), read from the report rather than the walked copy
        // because `rules/sequenceofevents` runs every FORM before this month's flag orders.
        let parent_flags = self.units[parent].reported_flags.clone();
        let parent = &self.units[parent].unit;
        let key = (parent.region_id.clone(), alias.to_string());
        if self.by_alias.contains_key(&key) {
            // The alias is taken, so the server would refuse this FORM; its block is swallowed
            // rather than applied to the unit the alias already names.
            self.forming.push(None);
            return;
        }

        let unit = formed_unit(parent, alias, &parent_flags);

        let reported = unit.structure_id.clone();
        let reported_flags = unit.flags.clone();
        let index = self.units.len();
        self.by_alias.insert(key, index);
        self.units.push(WorkingUnit {
            unit,
            original: None,
            formed: true,
            move_steps: None,
            reported,
            reported_flags,
            boardings: Vec::new(),
            given: Vec::new(),
            uncounted: Vec::new(),
            taken_unshown: Vec::new(),
            produced: Vec::new(),
            built: Vec::new(),
            created: Vec::new(),
            item_changes: Vec::new(),
            items_moved: false,
            transport_sent: Vec::new(),
            transport_received: Vec::new(),
            recruited: Vec::new(),
            transport_target_issues: Vec::new(),
            skill_merges: Vec::new(),
            men_of_unknown_skill: Vec::new(),
            recruits_unmerged: false,
            study: None,
        });
        self.forming.push(Some(index));
    }

    /// Applied through the grammar's own consumed prefix (`ah-86vk`), like [`super::intents`]:
    /// trailing text a valid order ignores is trimmed away before any reader below sees it, so an
    /// accepted line previews the same thing validation and `intents` agree it means, and a
    /// malformed required argument previews nothing at all - the same answer `check_shape` gives.
    fn read_order(
        &mut self,
        command: &super::lexer::Token,
        arguments: &[super::lexer::Token],
        line: usize,
    ) {
        let Some(active) = self.active() else {
            return;
        };
        let Some(arguments) = super::grammar::consumed_arguments(command, arguments) else {
            return;
        };

        if crate::movement::orders::is_movement_command(&command.text) {
            if let Some(steps) = super::forms::read_move_line(command, arguments) {
                // The last movement order wins, because a later order replaces an earlier one
                // when the game executes them.
                self.units[active].move_steps = Some(steps);
            }
        } else if command.is("name") {
            self.rename(active, arguments);
        } else if command.is("guard") {
            if let Some(set) = super::forms::read_flag(arguments) {
                let unit = &mut self.units[active].unit;
                unit.on_guard = set;
                set_flag(&mut unit.flags, "guarding", set);
                // "The Guard and Avoid Combat flags are mutually exclusive; setting one
                // automatically cancels the other."
                if set {
                    set_flag(&mut unit.flags, "avoiding", false);
                }
            }
        } else if command.is("avoid") {
            if let Some(set) = super::forms::read_flag(arguments) {
                let unit = &mut self.units[active].unit;
                set_flag(&mut unit.flags, "avoiding", set);
                if set {
                    unit.on_guard = false;
                    set_flag(&mut unit.flags, "guarding", false);
                }
            }
        } else if command.is("behind") {
            if let Some(set) = super::forms::read_flag(arguments) {
                set_flag(&mut self.units[active].unit.flags, "behind", set);
            }
        } else if command.is("share") {
            if let Some(set) = super::forms::read_flag(arguments) {
                set_flag(&mut self.units[active].unit.flags, "sharing", set);
            }
        } else if command.is("enter") {
            if let Some(structure) = super::forms::read_only_number(arguments) {
                self.board(active, BoardingOrder::Enter(structure.to_string()));
            }
        } else if command.is("leave") && arguments.is_empty() {
            self.board(active, BoardingOrder::Leave);
        } else if command.is("give") {
            self.queue_give(active, arguments, line);
        } else if command.is("take") {
            self.queue_take(active, arguments, line);
        } else if command.is("transport") || command.is("distribute") {
            // `rules/transport`: "the order DISTRIBUTE can be used in place of TRANSPORT and has
            // the same meaning and syntax", which is why one arm serves both and why the grammar
            // gives them one shared `TRANSPORT_FORMS` (`ah-bxgs`).
            self.transport(active, arguments);
        }
    }

    /// Records one boarding order and puts the unit where the whole block leaves it so far.
    ///
    /// Recomputed from every boarding seen rather than applied in isolation, because a LEAVE after
    /// an ENTER does not put the unit ashore: every LEAVE runs before any ENTER whatever order the
    /// lines were typed in. That rule is [`super::standing::standing_after`]'s, stated only there.
    fn board(&mut self, active: usize, boarding: BoardingOrder) {
        self.units[active].boardings.push(boarding);
        let working = &self.units[active];
        let standing = standing_after(
            working.reported.as_deref(),
            working.boardings.iter().map(BoardingOrder::as_boarding),
        )
        .map(str::to_string);
        self.units[active].unit.structure_id = standing;
    }

    /// `NAME UNIT "..."` renames the active unit; naming the faction or an object changes no row.
    fn rename(&mut self, active: usize, arguments: &[super::lexer::Token]) {
        let Some((what, name)) = arguments.split_first() else {
            return;
        };
        if !what.is("unit") || name.is_empty() {
            return;
        }
        // The game prints an underscored name with spaces, so the preview shows what the next
        // report will say rather than what the player typed.
        self.units[active].unit.name = name
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .replace('_', " ");
    }

    /// Our own row for a unit id standing in one region - a reported unit by number, or one this
    /// month's `FORM` orders create, whose id `formed_unit` mints as `new-{alias}` (`:520`).
    /// `by_alias` is keyed `(region, alias)`, so the prefix is stripped back off to reach it.
    fn index_in(&self, region: &str, id: &str) -> Option<usize> {
        match id.strip_prefix("new-") {
            Some(alias) => self
                .by_alias
                .get(&(region.to_string(), alias.to_string()))
                .copied(),
            None => self
                .by_id
                .get(id)
                .copied()
                .filter(|&index| self.units[index].unit.region_id == region),
        }
    }

    /// `GIVE target amount item`, where the target is a unit, `NEW n`, another faction's new unit,
    /// or `0` to discard.
    ///
    /// The shapes are read by [`super::forms`], the same reader the validator and the intent pass
    /// use, so an order this previews is an order the validator accepts. Nothing moves here: the
    /// order is queued and settled by [`Working::apply_transfers`] once the whole document has
    /// been read, because `rules/sequenceofevents` settles the Give phase in report order rather
    /// than in the order the blocks were written (`ah-3mwm`).
    fn queue_give(&mut self, giver: usize, arguments: &[super::lexer::Token], line: usize) {
        let Some((target, rest)) = super::forms::read_party(arguments) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };
        self.transfers.push(PendingTransfer {
            actor: giver,
            line,
            party: target,
            what,
            amount,
            is_give: true,
        });
    }

    /// `TAKE FROM source amount item`, which `rules/take` defines as a GIVE with the direction
    /// reversed. Queued exactly as a `GIVE` is, and for the same reason.
    fn queue_take(&mut self, taker: usize, arguments: &[super::lexer::Token], line: usize) {
        let Some((_, rest)) = arguments.split_first().filter(|(kw, _)| kw.is("FROM")) else {
            return;
        };
        let Some((source, rest)) = super::forms::read_party(rest) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };
        self.transfers.push(PendingTransfer {
            actor: taker,
            line,
            party: source,
            what,
            amount,
            is_give: false,
        });
    }

    /// Settles this month's Give phase.
    ///
    /// `rules/sequenceofevents` processes GIVE and TAKE together and, where nothing else orders
    /// units within a phase, "units will be processed in the order they appear on the report" -
    /// which is `Working::units`' own order, reported units first and this month's formed units
    /// after them. The line is the secondary key alone, so one actor's own transfers still settle
    /// in the order it wrote them. `sort_by_key` is stable, so equal keys - which cannot occur,
    /// one order per line - would keep document order anyway.
    fn apply_transfers(&mut self) {
        let mut pending = std::mem::take(&mut self.transfers);
        pending.sort_by_key(|transfer| (transfer.actor, transfer.line));
        for transfer in pending {
            if transfer.is_give {
                self.give(
                    transfer.actor,
                    &transfer.party,
                    &transfer.what,
                    &transfer.amount,
                    transfer.line,
                );
            } else {
                self.take(
                    transfer.actor,
                    &transfer.party,
                    &transfer.what,
                    &transfer.amount,
                    transfer.line,
                );
            }
        }
    }

    /// One settled `GIVE`.
    ///
    /// What is left here is resolution: which unit the target names, whether the giver holds what
    /// it is giving, and how much actually moves.
    ///
    /// A target the walker cannot find - another hex, another faction, an alias never formed -
    /// makes the whole order a no-op: the validator flags what the server would refuse, and
    /// half-applying it here would show a transfer that will not happen.
    fn give(
        &mut self,
        giver: usize,
        target: &super::forms::Party,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        // The 1-based document line of the order, so the change it records can name it.
        line: usize,
    ) {
        use super::targets::{give_reach, party_unit_id, GiveReach};

        let region = self.units[giver].unit.region_id.clone();
        let giver_id = self.units[giver].unit.unit_id.clone();
        let reach = give_reach(
            target,
            &giver_id,
            |id| self.index_in(&region, id).is_some(),
            |id| {
                self.shown_in_region
                    .get(&region)
                    .is_some_and(|shown| shown.contains(id))
            },
            // Report-wide, and it is what separates a unit we know is in another hex from a number
            // the report never prints, which may be a hidden Friendly target (`ah-66yi`).
            |id| self.known_units.contains(id),
        );
        let receiver = match reach {
            // Nothing at all: not even the giver loses what it named (`ah-vcp8.2`).
            GiveReach::Nowhere => return,
            // The goods leave and no row of ours gains them. `Unshown` reaches here too and moves
            // nothing at all, because `tags_moved` returns no tag for it - `rules/give` may or may
            // not let the gift through and this column says so with `+ ?` rather than a figure
            // (`ah-66yi`).
            GiveReach::Discard | GiveReach::Foreign | GiveReach::Unshown => None,
            // Decided by this same lookup a line ago, so it answers again.
            GiveReach::Ours => party_unit_id(target).and_then(|id| self.index_in(&region, &id)),
        };

        self.move_between(
            giver,
            receiver,
            &Transfer {
                what,
                amount,
                reach,
                is_give: true,
                line,
                party: target,
            },
        );
    }

    /// One settled `TAKE`, which `rules/take` defines as a GIVE with the direction reversed and
    /// confines to "another unit in the same faction" - so the source is always one of ours, found
    /// the same way `give` finds its receiver.
    ///
    /// Moves the goods as well as the people, unlike the pass this replaced: the Give phase is
    /// settled here in report order now, so leaving the items to the later ledger-driven pass
    /// would settle the two halves of one order in two different orders (`ah-3mwm`).
    fn take(
        &mut self,
        taker: usize,
        source: &super::forms::Party,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        // The 1-based document line of the order, so the change it records can name it.
        line: usize,
    ) {
        use super::forms::{Amount, Party, Selector};

        let source_index = match source {
            Party::New(alias) => {
                let key = (self.units[taker].unit.region_id.clone(), alias.clone());
                match self.by_alias.get(&key) {
                    Some(&index) => index,
                    None => return,
                }
            }
            // Nobody to take from: `rules/take` confines a TAKE to a faction-mate, so another
            // faction's unit and the discard target both leave the taker unchanged.
            Party::Discard | Party::Foreign { .. } => return,
            Party::Unit(id) => match self.by_id.get(id) {
                Some(&index)
                    if self.units[index].unit.region_id == self.units[taker].unit.region_id =>
                {
                    index
                }
                // A unit the report does not show here holds what no catalogue can say, so an
                // `ALL` is left alone - but a stated quantity of a named item the catalogue knows
                // is granted, and marked unverifiable, exactly as `ah-agbm` had the ledger grant
                // it. A unit the report shows and we do not own is refused outright instead.
                _ => {
                    if self.foreign_units.contains(id) {
                        return;
                    }
                    let (Selector::Item(text), Amount::Exact(count)) = (what, amount) else {
                        return;
                    };
                    if *count <= 0 {
                        return;
                    }
                    let Some(entry) = self.ruleset.find_item(text) else {
                        return;
                    };
                    let (name, tag) = (entry.name.clone(), entry.tag.to_ascii_uppercase());
                    // A mage may take no men from anyone, an unshown source included (`ah-ndp9`).
                    // Refused before anything is credited or recorded.
                    if self.ruleset.is_man(&tag)
                        && self.units[taker].is_mage_as_reported(&self.ruleset)
                    {
                        return;
                    }
                    add_item(&mut self.units[taker].unit.items, &name, &tag, *count);
                    // Below the mage refusal and the catalogue and quantity guards, so nothing
                    // refused is recorded. `taken_unshown` stays exactly as it is - `ah-64wm`'s
                    // and `ah-agbm`'s sentences read it - and the change is written alongside.
                    self.units[taker].item_changes.push(ItemChange {
                        tag: tag.clone(),
                        name: name.clone(),
                        delta: *count,
                        cause: ItemChangeCause::Took,
                        line: i64::try_from(line).ok(),
                        unit_price: None,
                        other: Some(ItemChangeParty {
                            unit_id: id.clone(),
                            name: None,
                        }),
                        // The refusal above already asked the same question of the same tag.
                        is_man: self.ruleset.is_man(&tag),
                    });
                    self.units[taker].taken_unshown.push(TakenUnshown {
                        amount: *count,
                        tag,
                        from: id.clone(),
                    });
                    return;
                }
            },
        };

        if source_index == taker {
            return;
        }

        self.move_between(
            source_index,
            Some(taker),
            &Transfer {
                what,
                amount,
                reach: super::targets::GiveReach::Ours,
                is_give: false,
                line,
                party: source,
            },
        );
    }

    /// The half a `GIVE` and a `TAKE` share once each has decided which row holds the goods and
    /// which - if any - receives them: what leaves the source, what arrives, and the skills the
    /// arriving men bring.
    fn move_between(&mut self, source: usize, receiver: Option<usize>, transfer: &Transfer<'_>) {
        use super::targets::GiveReach;

        let &Transfer {
            what,
            amount,
            reach,
            is_give,
            line,
            party,
        } = transfer;
        let line = i64::try_from(line).ok();
        // What the source's change points at: the receiving row where there is one, otherwise
        // whatever unit id the order named. `party_unit_id` answers `None` for `Party::Discard`
        // and `Party::Foreign`, which is the whole of the "no unit to name" case.
        let far_end: Option<ItemChangeParty> = match receiver {
            Some(index) => Some(ItemChangeParty {
                unit_id: self.units[index].unit.unit_id.clone(),
                name: Some(self.units[index].unit.name.clone()),
            }),
            None => super::targets::party_unit_id(party).map(|unit_id| ItemChangeParty {
                unit_id,
                // A target no row of ours holds: a foreign unit the region shows, or a number the
                // report never prints. `ah-rgkk.2.3` writes that as `unit <id>`, which needs no
                // name.
                name: None,
            }),
        };
        // What the receiver's change points at - always a real row, since a receiver is an index.
        let near_end = ItemChangeParty {
            unit_id: self.units[source].unit.unit_id.clone(),
            name: Some(self.units[source].unit.name.clone()),
        };
        // `receiver_cause` is unread on the `Discard` arm - `give` resolves `GiveReach::Discard`
        // to `receiver: None` - and is written out anyway so the match stays exhaustive over the
        // pair without an `unreachable!()`.
        let (source_cause, receiver_cause) = match (is_give, reach) {
            (true, GiveReach::Discard) => (ItemChangeCause::Discarded, ItemChangeCause::WasGiven),
            (true, _) => (ItemChangeCause::GivenAway, ItemChangeCause::WasGiven),
            (false, _) => (ItemChangeCause::WasTakenFrom, ItemChangeCause::Took),
        };

        for (name, tag, moved) in self.tags_moved(source, what, amount, reach) {
            // `rules/magic`: "mages may not GIVE men at all", whatever the target - a discard
            // included, since `GIVE 0`'s exception is about *transfer* restrictions and this is
            // not one. Asked here rather than inside `tags_moved`, which `apply_transports` also
            // calls: the rule is about GIVE alone, which is why a TAKE passes `false` above
            // (`ah-t8ei`). Per tag, so `ALL ITEMS` still hands over the equipment the mage may
            // give.
            if is_give
                && super::targets::mage_give_refused(
                    &self.units[source].unit.skills,
                    &tag,
                    Some(&self.ruleset),
                )
            {
                continue;
            }
            // `rules/magic` fixes a mage's unit number, and the navigator's New Origins ruling
            // says no man may join one - by GIVE, by TAKE or by BUY (`ah-ndp9`). Per tag, so a
            // mixed `ALL ITEMS` still hands over the equipment; and `continue` before anything is
            // debited, so the source keeps the men it could not hand over.
            if let Some(receiver) = receiver {
                if self.ruleset.is_man(&tag)
                    && self.units[receiver].is_mage_as_reported(&self.ruleset)
                {
                    continue;
                }
            }
            // Re-resolved by tag rather than kept from the snapshot: an earlier tag in this same
            // loop may have removed an item ahead of this one and shifted every index after it.
            let Some(held) = self.units[source]
                .unit
                .items
                .iter()
                .position(|item| item.tag == tag)
            else {
                continue;
            };
            take_item(&mut self.units[source].unit.items, held, moved);
            // Read before the pushes: `self.units` is borrowed mutably below.
            let is_man = self.ruleset.is_man(&tag);
            // Below all three `continue`s above: a change recorded higher would be a movement that
            // did not happen. `moved` is what `take_item` subtracts and `tags_moved` has already
            // clamped to the stock, so the change and the item list cannot disagree.
            self.units[source].item_changes.push(ItemChange {
                tag: tag.clone(),
                name: name.clone(),
                delta: -moved,
                cause: source_cause,
                line,
                // No transfer is priced: `rules/give` names no payment, and the market is a
                // different phase of `rules/sequenceofevents`.
                unit_price: None,
                other: far_end.clone(),
                is_man,
            });
            if let Some(receiver) = receiver {
                add_item(&mut self.units[receiver].unit.items, &name, &tag, moved);
                self.units[receiver].item_changes.push(ItemChange {
                    tag: tag.clone(),
                    name: name.clone(),
                    delta: moved,
                    cause: receiver_cause,
                    line,
                    unit_price: None,
                    other: Some(near_end.clone()),
                    is_man,
                });
                // `rules/form` reverts what a dissolving formed unit "was given", so only a GIVE
                // is recorded here: what the row TAKES is its own doing, not a gift, and must not
                // revert with the rest (`ah-dhga`, `ah-3mwm`).
                if is_give {
                    add_item(&mut self.units[receiver].given, &name, &tag, moved);
                }
            }

            // A race is people, so moving one moves men as well as stock.
            if self.ruleset.is_man(&tag) {
                let unit = &mut self.units[source].unit;
                unit.men -= moved;
                if let Some(race) = unit.men_by_race.iter().position(|race| race.tag == tag) {
                    take_item(&mut unit.men_by_race, race, moved);
                }
                if let Some(receiver) = receiver {
                    let arriving = self.units[source].unit.skills.clone();
                    let from = self.units[source].unit.unit_id.clone();
                    // Read and cloned inside the block, because the `&mut ...unit` binding below
                    // blocks a push to `skill_merges` on the same `WorkingUnit` while it lives.
                    let (men_before, merged) = {
                        let unit = &mut self.units[receiver].unit;
                        // The merge runs before the men are added: weighting by the headcount
                        // after the arrivals is silently wrong.
                        let men_before = unit.men;
                        unit.skills = merge_skills(&unit.skills, unit.men, &arriving, moved);
                        unit.men += moved;
                        add_item(&mut unit.men_by_race, &name, &tag, moved);
                        (men_before, unit.skills.clone())
                    };
                    self.units[receiver].skill_merges.push(SkillMerge {
                        cause: if is_give {
                            SkillMergeCause::Given
                        } else {
                            SkillMergeCause::Taken
                        },
                        from,
                        men: moved,
                        men_before,
                        men_arriving: vec![crate::report::model::ItemAmount {
                            name: name.clone(),
                            tag: tag.clone(),
                            amount: moved,
                        }],
                        count_inferred: false,
                        arriving_skills: arriving,
                        skills: merged,
                    });
                }
            }
        }
    }

    /// `TRANSPORT`/`DISTRIBUTE target amount item`, whose target need only be FRIENDLY
    /// (`rules/economy_transport`) - so sending to another faction's quartermaster is the
    /// ordinary case and not a mistake. Parses and queues; nothing moves until
    /// `apply_transports` runs, last of all (`ah-bxgs`).
    ///
    /// Returns without queueing in five cases, each a decision: the line cannot be read at all;
    /// the selector is a whole class or a whole unit, which `TRANSPORT_FORMS` has no grammar for
    /// even though `read_transfer` (shared with `GIVE`) will still hand one back; the target is an
    /// alias for a unit formed this month, ours or another faction's, which the report cannot show
    /// owning anything - it did not exist when the report was written; the target is `0`
    /// (`TRANSPORT` is not `GIVE`, and no rule makes
    /// transport-to-zero destroy goods); or the target resolves to the sender itself, which the
    /// server refuses.
    fn transport(&mut self, sender: usize, arguments: &[super::lexer::Token]) {
        use super::forms::{Party, Selector};

        let Some((target, rest)) = super::forms::read_party(arguments) else {
            return;
        };
        let Some((what, amount)) = super::forms::read_transfer(rest) else {
            return;
        };
        if matches!(what, Selector::Class(_) | Selector::WholeUnit) {
            return;
        }

        let id = match target {
            Party::Unit(id) => id,
            Party::New(_) | Party::Foreign { .. } | Party::Discard => return,
        };
        if id == self.units[sender].unit.unit_id {
            return;
        }

        let receiver = self.by_id.get(&id).copied();
        let to_unshown = !self.known_units.contains(&id);

        let sequence = self.transports.len();
        self.transports.push(PendingTransport {
            sender,
            receiver,
            to: id,
            to_unshown,
            what,
            amount,
            sequence,
        });
    }

    /// What the report can say about the unit a `TRANSPORT`/`DISTRIBUTE` names (`ah-64wm`).
    ///
    /// `rules/transport`: "The target of the transport unit must be a unit with the quartermaster
    /// skill and must be the owner of a transport structure", which `rules/economy_transport`
    /// names the Caravanserai and which must also "be at least FRIENDLY to the unit which issues
    /// the order".
    ///
    /// Only the first two are ours to settle. `rules/com_attitudes` prints the attitudes *we*
    /// declare toward other factions, never theirs toward us, so a foreign target that passes both
    /// structural tests is still unknown - accept on doubt, and say so.
    fn transport_target(&self, id: &str) -> TransportTargetOutcome {
        use TransportTargetReason::{
            AcceptanceUnknown, EligibilityUnknown, NotCaravanseraiOwner, NotQuartermaster,
        };

        let Some(facts) = self.transport_targets.get(id) else {
            // A unit number the report never described: an ally's quartermaster, or a mistake.
            return TransportTargetOutcome::Refused(EligibilityUnknown);
        };
        if facts.own {
            // Our own report prints our own units' skills in full, so a missing quartermaster is
            // a fact rather than a gap - and it is the reason worth naming when the unit fails
            // both tests.
            if !facts.quartermaster {
                if !facts.quartermaster_disclosed {
                    // The catalogue names no quartermaster skill, so the report was never asked
                    // the question: missing evidence, not a missing skill.
                    return TransportTargetOutcome::Refused(EligibilityUnknown);
                }
                return TransportTargetOutcome::Refused(NotQuartermaster);
            }
            if !facts.caravanserai_owner {
                return TransportTargetOutcome::Refused(NotCaravanseraiOwner);
            }
            return TransportTargetOutcome::Eligible;
        }
        // A foreign unit's structure is drawn in our report even though its skills are not, so
        // ownership is certain either way and is asked first.
        if !facts.caravanserai_owner {
            return TransportTargetOutcome::Refused(NotCaravanseraiOwner);
        }
        if !facts.quartermaster {
            // A foreign unit's skills are undisclosed (`rules/reportformat`), so an empty list is
            // missing evidence rather than proof.
            return TransportTargetOutcome::Refused(EligibilityUnknown);
        }
        TransportTargetOutcome::Refused(AcceptanceUnknown)
    }

    /// Applies every queued `TRANSPORT`/`DISTRIBUTE`, last of all: `rules/sequenceofevents` runs
    /// transport in the month's final phases, after the market, after movement, after production
    /// (`ah-bxgs`).
    fn apply_transports(&mut self, dissolved: &BTreeMap<usize, Option<String>>) {
        let pending = std::mem::take(&mut self.transports);
        let mut sent: Vec<Vec<(usize, TransportSent)>> = vec![Vec::new(); self.units.len()];
        let mut received: Vec<Vec<(usize, TransportReceived)>> = vec![Vec::new(); self.units.len()];
        let mut issues: Vec<Vec<(usize, TransportTargetIssue)>> =
            vec![Vec::new(); self.units.len()];
        // How many of its own transports each sender has written before this one, so every line
        // one order produces - sent, refused or target-refused - is stamped with that order's
        // place in the unit's block. The queue is document-ordered, and the phases below are not,
        // so the counting has to happen here (`ah-64wm`, `ah-d0ku`).
        let mut written: BTreeMap<usize, i64> = BTreeMap::new();
        let mut order_index: BTreeMap<usize, i64> = BTreeMap::new();
        for pending in &pending {
            let next = written.entry(pending.sender).or_insert(0);
            order_index.insert(pending.sequence, *next);
            *next += 1;
        }

        for phase in [
            TransportPhase::ToQuartermaster,
            TransportPhase::BetweenQuartermasters,
            TransportPhase::FromQuartermaster,
        ] {
            let mut of_this_phase: Vec<&PendingTransport> = pending
                .iter()
                .filter(|pending| !dissolved.contains_key(&pending.sender))
                .filter(|pending| self.transport_phase(pending) == phase)
                .collect();
            // `rules/sequenceofevents`: "units that appear higher on the report get precedence",
            // which is `Working::units`' own order. The sequence is the secondary key alone, so
            // one sender's own lines still settle in the order it wrote them.
            of_this_phase.sort_by_key(|pending| (pending.sender, pending.sequence));
            if of_this_phase.is_empty() {
                continue;
            }
            self.apply_transport_phase(
                &of_this_phase,
                &order_index,
                &mut sent,
                &mut received,
                &mut issues,
            );
        }

        for (index, working) in self.units.iter_mut().enumerate() {
            let mut theirs = std::mem::take(&mut sent[index]);
            theirs.sort_by_key(|(sequence, _)| *sequence);
            working.transport_sent = theirs.into_iter().map(|(_, value)| value).collect();
            let mut theirs = std::mem::take(&mut received[index]);
            theirs.sort_by_key(|(sequence, _)| *sequence);
            working.transport_received = theirs.into_iter().map(|(_, value)| value).collect();
            let mut theirs = std::mem::take(&mut issues[index]);
            theirs.sort_by_key(|(sequence, _)| *sequence);
            working.transport_target_issues = theirs.into_iter().map(|(_, value)| value).collect();
        }
    }

    /// Which of `rules/sequenceofevents`' three phases one queued line belongs to.
    ///
    /// A sender that is not a quartermaster is always the first phase. A quartermaster sending to
    /// a unit the report shows holding the skill is the second. Everything else - including a
    /// target the report does not show, or one whose skills are hidden - is the third: the
    /// navigator chose that deterministic fallback over inventing a skill the report never states
    /// (`ah-d0ku`).
    ///
    /// Since `ah-64wm` an eligible target is a quartermaster by construction, so the third phase
    /// carries only orders the target gate refuses. It still has to run - the refusals are what
    /// the interface explains - and it becomes live again the moment the target rule changes.
    fn transport_phase(&self, pending: &PendingTransport) -> TransportPhase {
        let sender = &self.units[pending.sender].unit.unit_id;
        if !self.quartermasters.contains(sender) {
            return TransportPhase::ToQuartermaster;
        }
        if self.quartermasters.contains(&pending.to) {
            TransportPhase::BetweenQuartermasters
        } else {
            TransportPhase::FromQuartermaster
        }
    }

    /// One phase of transport, over every queued line that belongs to it.
    ///
    /// Each unit's holdings as the phase opened are the allowance every send in this phase is
    /// resolved against, while the movement itself is applied to the live item list. That is
    /// `rules/sequenceofevents`' "items may move in each of the phases but only once in each
    /// phase": goods that arrived in an earlier phase are available, and goods arriving during
    /// this one are not (`ah-d0ku`).
    ///
    /// The target is settled before any item is: an order whose target cannot receive moves
    /// nothing at all, whatever it named, so the target explanation is recorded once for the order
    /// and no per-item refusal is reported beside it (`ah-64wm`).
    fn apply_transport_phase(
        &mut self,
        pending: &[&PendingTransport],
        order_index: &BTreeMap<usize, i64>,
        sent: &mut [Vec<(usize, TransportSent)>],
        received: &mut [Vec<(usize, TransportReceived)>],
        issues: &mut [Vec<(usize, TransportTargetIssue)>],
    ) {
        let mut allowance: BTreeMap<usize, Vec<crate::report::model::ItemAmount>> = BTreeMap::new();
        for pending in pending {
            allowance
                .entry(pending.sender)
                .or_insert_with(|| self.units[pending.sender].unit.items.clone());
        }

        for pending in pending {
            let index = order_index.get(&pending.sequence).copied().unwrap_or(0);
            let held = allowance
                .get(&pending.sender)
                .cloned()
                .unwrap_or_else(Vec::new);
            // `GiveReach::Discard` bypasses target-specific refusal: `TRANSPORT` has
            // its own permission gate, `can_be_transported`, checked below - the two lists are
            // not the same (`IENT` may not be given but may be transported).
            let moving = self.tags_moved_from(
                &held,
                &pending.what,
                &pending.amount,
                super::targets::GiveReach::Discard,
            );
            // An order over goods the sender does not hold has nothing to retain and nothing to
            // explain, whoever it was aimed at.
            if moving.is_empty() {
                continue;
            }
            if let TransportTargetOutcome::Refused(reason) = self.transport_target(&pending.to) {
                // One record for the order. A single tag the game would carry has a claim to make
                // about those goods; anything else - an item transport refuses anyway, or several
                // tags at once - leaves the sentence to speak of the order alone.
                let (amount, tag) = match moving.as_slice() {
                    [(_, tag, moved)] if self.ruleset.can_be_transported(tag) => {
                        (*moved, tag.clone())
                    }
                    _ => (0, String::new()),
                };
                issues[pending.sender].push((
                    pending.sequence,
                    TransportTargetIssue {
                        to: pending.to.clone(),
                        amount,
                        tag,
                        reason,
                        order_index: index,
                    },
                ));
                continue;
            }
            for (name, tag, moved) in moving {
                if !self.ruleset.can_be_transported(&tag) {
                    sent[pending.sender].push((
                        pending.sequence,
                        TransportSent {
                            amount: 0,
                            tag,
                            to: String::new(),
                            to_unshown: false,
                            refused: true,
                            order_index: index,
                        },
                    ));
                    continue;
                }
                // Re-resolved by tag rather than kept from the snapshot, exactly as `give` does:
                // an earlier transport in this same document may have emptied a stock ahead of
                // this one and shifted every index after it.
                let Some(live) =
                    find_item(&self.ruleset, &self.units[pending.sender].unit.items, &tag)
                else {
                    continue;
                };
                take_item(&mut self.units[pending.sender].unit.items, live, moved);
                // Resolved the same way the live list above is, rather than by exact tag
                // equality: an allowance that failed to find its row would silently stay
                // undecremented, and the item could then move a second time in this phase -
                // exactly the rule this phase pass exists to enforce (`ah-d0ku`).
                if let Some(allowed) = allowance.get_mut(&pending.sender) {
                    if let Some(index) = find_item(&self.ruleset, allowed, &tag) {
                        take_item(allowed, index, moved);
                    }
                }
                sent[pending.sender].push((
                    pending.sequence,
                    TransportSent {
                        amount: moved,
                        tag: tag.clone(),
                        to: pending.to.clone(),
                        to_unshown: pending.to_unshown,
                        refused: false,
                        order_index: index,
                    },
                ));
                // One lookup for both sides of the transport: it is the same tag either way.
                // `false` for every transport today - `can_be_transported` refuses men - and it
                // is asked rather than assumed so that the answer follows the catalogue.
                let is_man = self.ruleset.is_man(&tag);
                if moved != 0 {
                    // Read before the push: `self.units` is borrowed mutably below. The receiver's
                    // name only where this hex's rows show it - a target the report does not show
                    // is a number and nothing more (`TransportSent::to_unshown`).
                    let receiver_name = pending
                        .receiver
                        .map(|receiver| self.units[receiver].unit.name.clone());
                    // `line` is `None`: what a transport carries is the order's `order_index`,
                    // which `TransportSent` already holds, not a document line (`ah-rgkk.3.1`).
                    self.units[pending.sender].item_changes.push(ItemChange {
                        tag: tag.clone(),
                        name: name.clone(),
                        delta: -moved,
                        cause: ItemChangeCause::TransportedOut,
                        line: None,
                        unit_price: None,
                        other: Some(ItemChangeParty {
                            unit_id: pending.to.clone(),
                            name: receiver_name,
                        }),
                        is_man,
                    });
                }
                if let Some(receiver) = pending.receiver {
                    add_item(&mut self.units[receiver].unit.items, &name, &tag, moved);
                    let from = self.units[pending.sender].unit.unit_id.clone();
                    let from_name = self.units[pending.sender].unit.name.clone();
                    if moved != 0 {
                        self.units[receiver].item_changes.push(ItemChange {
                            tag: tag.clone(),
                            name: name.clone(),
                            delta: moved,
                            cause: ItemChangeCause::TransportedIn,
                            line: None,
                            unit_price: None,
                            other: Some(ItemChangeParty {
                                unit_id: from.clone(),
                                name: Some(from_name),
                            }),
                            is_man,
                        });
                    }
                    received[receiver].push((
                        pending.sequence,
                        TransportReceived {
                            amount: moved,
                            tag,
                            from,
                        },
                    ));
                }
            }
        }
    }

    /// What one transfer actually moves out of `holder`: the tag, the name the holder writes it
    /// by, and how many.
    ///
    /// Snapshotted before anything moves, because the caller mutates the list this was read
    /// from.
    ///
    /// `rules/give` lists the classes and defines `ITEM`/`ITEMS` as "the combination of all of
    /// the previous categories", so it needs no classifying: it is everything. `MAN`/`MEN` is
    /// `composition::men_in`'s filter, the same one that derived the headcount to begin with.
    /// Every other class asks the catalogue (`Ruleset::class_members`, `ah-3sp7.1`); `ADVANCED`,
    /// `MAGIC` and `SPECIAL` stay unresolvable because the data page never states their members,
    /// and so does a word that is not a class at all.
    ///
    /// `GIVE target UNIT` hands over the whole unit rather than anything it holds - ownership is
    /// a different question from what a row shows, and is left to a later issue.
    ///
    /// `give_outcome` preserves the discard exception, rejects men aimed at another faction, and
    /// holds back a tag whose permission the report cannot establish (`rules/give`, `ah-66yi`).
    fn tags_moved(
        &self,
        holder: usize,
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        reach: super::targets::GiveReach,
    ) -> Vec<(String, String, i64)> {
        self.tags_moved_from(&self.units[holder].unit.items, what, amount, reach)
    }

    /// The same question asked of an explicit item list rather than of a row's live holdings, so
    /// that a transport phase can resolve against the allowance it opened with while the movement
    /// itself is applied to the live list (`ah-d0ku`).
    fn tags_moved_from(
        &self,
        held_items: &[crate::report::model::ItemAmount],
        what: &super::forms::Selector,
        amount: &super::forms::Amount,
        reach: super::targets::GiveReach,
    ) -> Vec<(String, String, i64)> {
        use super::forms::{Amount, Selector};

        let moving: Vec<(String, String, i64)> = match what {
            Selector::Item(item) => {
                let Some(held) = find_item(&self.ruleset, held_items, item) else {
                    return Vec::new();
                };
                let (name, tag, held_amount) = {
                    let held = &held_items[held];
                    if is_unfinished_ship(held, Some(&self.ruleset)) {
                        return Vec::new();
                    }
                    (held.name.clone(), held.tag.clone(), held.amount)
                };
                let requested = match amount {
                    Amount::All { except } => held_amount.saturating_sub(*except),
                    Amount::Exact(count) => *count,
                };
                let moved = requested.clamp(0, held_amount);
                if moved == 0 {
                    Vec::new()
                } else {
                    vec![(name, tag, moved)]
                }
            }
            Selector::UnfinishedShip(text) => {
                let Some(tag) =
                    unfinished_ship_named(Some(&self.ruleset), text, || held_items.iter())
                else {
                    return Vec::new();
                };
                let Some(held) = held_items
                    .iter()
                    .find(|item| item.tag.eq_ignore_ascii_case(&tag))
                else {
                    return Vec::new();
                };
                let requested = match amount {
                    Amount::All { except } => held.amount.saturating_sub(*except),
                    Amount::Exact(count) => *count,
                };
                let moved = requested.clamp(0, held.amount);
                if moved > 0 {
                    vec![(held.name.clone(), held.tag.clone(), moved)]
                } else {
                    Vec::new()
                }
            }
            // `rules/give` gives `EXCEPT` and a stated amount to the named-item forms alone; the
            // class form is `GIVE [unit] ALL [item class]` and nothing else. A class arriving
            // with either is a shape the rules do not define, so it is left exactly as today.
            Selector::Class(_) if *amount != (Amount::All { except: 0 }) => Vec::new(),
            Selector::Class(name)
                if name.eq_ignore_ascii_case("MAN") || name.eq_ignore_ascii_case("MEN") =>
            {
                held_items
                    .iter()
                    .filter(|item| {
                        !is_unfinished_ship(item, Some(&self.ruleset))
                            && self.ruleset.is_man(&item.tag)
                    })
                    .filter(|item| !is_unfinished_ship(item, Some(&self.ruleset)))
                    .map(|item| (item.name.clone(), item.tag.clone(), item.amount))
                    .collect()
            }
            Selector::Class(name)
                if name.eq_ignore_ascii_case("ITEM") || name.eq_ignore_ascii_case("ITEMS") =>
            {
                held_items
                    .iter()
                    .filter(|item| !is_unfinished_ship(item, Some(&self.ruleset)))
                    .map(|item| (item.name.clone(), item.tag.clone(), item.amount))
                    .collect()
            }
            Selector::Class(name) => match self.ruleset.class_members(name) {
                Some(tags) => held_items
                    .iter()
                    .filter(|item| {
                        !is_unfinished_ship(item, Some(&self.ruleset))
                            && tags.iter().any(|tag| tag == &item.tag)
                    })
                    .map(|item| (item.name.clone(), item.tag.clone(), item.amount))
                    .collect(),
                None => Vec::new(),
            },
            Selector::WholeUnit => Vec::new(),
        };

        moving
            .into_iter()
            .filter(|(_, tag, _)| {
                // Only what definitely moves. A tag the rules refuse and a tag whose permission the
                // report cannot establish both stay with the giver - the second is admitted through
                // the ledger's `uncounted`, which the preview renders as `+ ?` (`ah-66yi`).
                matches!(
                    super::targets::give_outcome(reach, tag, Some(&self.ruleset)),
                    super::targets::GiveOutcome::Moves
                )
            })
            .collect()
    }
}

/// Puts every unit's headcount back in step with the items it will actually hold.
///
/// `men` is derived from the item list (`composition::men_in`), so any pass that moves items has to
/// re-derive it or the two drift apart - which is what `TAKE FROM 1234 10 HUMN` did before this
/// function existed, leaving a row reading `20 HUMN` in ITEMS and `10` in MEN.
///
/// Men that arrived by a route the walk did not see were bought. `rules/economy_recruiting`: "New
/// recruits will not have any skills or items" - so they merge in at zero and dilute the unit's
/// skills exactly as gifted men do, by the same rule in `rules/give`.
fn settle_headcounts(units: &mut [WorkingUnit], ruleset: &crate::movement::rules::Ruleset) {
    for working in units {
        // Named before the early return below, so an estimated unit reports them too: men whose
        // own skills are unknown are left out of every merge, not merged in at zero
        // (`ah-agbm`, `ah-rgkk.2.1`).
        working.men_of_unknown_skill = working
            .taken_unshown
            .iter()
            .filter(|taken| ruleset.is_man(&taken.tag))
            .cloned()
            .collect();
        // A headcount the report itself could only estimate stays exactly as the parser left it:
        // re-deriving from a list the catalogue cannot fully read is the guess `classify_unit`
        // refuses to make (`composition.rs:56-63`), under another name.
        if working.unit.men_estimated {
            // The recruits the ledger did settle were therefore never merged in: the unit's
            // Skills figures are the reported ones, not diluted ones. When the ledger could not
            // settle them either, nothing is claimed - inferring the count from the item list is
            // the very derivation this early return refuses to make (`ah-rgkk.2.1`).
            working.recruits_unmerged = !working.recruited.is_empty();
            continue;
        }
        let before = working.unit.men;
        let (by_race, total) = composition::men_in(&working.unit.items, ruleset);
        let recruited = if working.recruited.is_empty() {
            // No exact settled recruit to read - either nothing was recruited, or a `BUY ALL`
            // makes the exact figure unknowable and this falls back to the net change in the item
            // list exactly as it did before `UnitItemEffects::recruited` existed.
            if total > before {
                // A man tag credited from a unit this hex does not show (`ah-agbm`'s
                // `taken_unshown`) is not a recruit: its true skills are unknown, not zero,
                // exactly as `apply_gifts_of_men` already marks that unit `Unknowable` rather than
                // guessing. Left out of the merge here, or the checks and the units table would
                // disagree about the same arrival.
                let taken_unknown: i64 = working
                    .taken_unshown
                    .iter()
                    .filter(|taken| ruleset.is_man(&taken.tag))
                    .map(|taken| taken.amount)
                    .sum();
                total - before - taken_unknown
            } else {
                0
            }
        } else {
            // A same-race gift out and recruit back in can leave `total` unchanged even though a
            // recruit arrived (`ah-4a13`) - the exact settled list still dilutes the unit's
            // skills even when the net headcount does not move.
            working.recruited.iter().map(|item| item.amount).sum()
        };
        if recruited > 0 {
            working.unit.skills = merge_skills(&working.unit.skills, before, &[], recruited);
            working.skill_merges.push(SkillMerge {
                cause: SkillMergeCause::Recruited,
                // Recruits come from the market, not from a unit.
                from: String::new(),
                men: recruited,
                men_before: before,
                // A `BUY ALL` leaves no exact settled list, so there is no race breakdown to
                // report and the count above came from the item list's net change instead.
                men_arriving: working.recruited.clone(),
                count_inferred: working.recruited.is_empty(),
                // `rules/economy_recruiting`: "New recruits will not have any skills or items".
                arriving_skills: Vec::new(),
                skills: working.unit.skills.clone(),
            });
        }
        working.unit.men_by_race = by_race;
        working.unit.men = total;
    }
}

/// The receiving unit's skills once `moved` men arrive from a unit whose own skills are `arriving`.
///
/// Points are per man (`level_for_points`), so the merged figure is the headcount-weighted average:
/// a skill either side lacks contributes zero for its men, which is why arriving men can LOWER a
/// level. Integer division truncates, and the remainder is dropped rather than tracked: the report
/// itself prints only a truncated per-man figure, so there is no exact total to preserve.
///
/// The giver is deliberately absent: dividing evenly among people leaves its points per man
/// unchanged, so a GIVE never alters the giver's own skills.
pub(crate) fn merge_skills(
    into: &[Skill],
    into_men: i64,
    arriving: &[Skill],
    moved: i64,
) -> Vec<Skill> {
    if into_men + moved == 0 {
        return into.to_vec();
    }

    let mut tags: Vec<&str> = into
        .iter()
        .chain(arriving.iter())
        .map(|skill| skill.tag.as_str())
        .collect();
    tags.sort_unstable();
    tags.dedup();

    let mut merged: Vec<Skill> = tags
        .into_iter()
        .filter_map(|tag| {
            let held = into.iter().find(|skill| skill.tag == tag);
            let coming = arriving.iter().find(|skill| skill.tag == tag);
            let held_points = held.map_or(0, |skill| i64::from(skill.points));
            let coming_points = coming.map_or(0, |skill| i64::from(skill.points));
            let points = (into_men * held_points + moved * coming_points) / (into_men + moved);
            if points <= 0 {
                return None;
            }
            let points = points as u32;
            let name = held
                .or(coming)
                .map(|skill| skill.name.clone())
                .unwrap_or_default();
            Some(Skill {
                name,
                tag: tag.to_string(),
                level: level_for_points(points),
                points,
            })
        })
        .collect();

    merged.sort_by(|left, right| left.tag.cmp(&right.tag));
    merged
}

/// Adds or removes a flag, in the report's own vocabulary, without disturbing the others' order.
fn set_flag(flags: &mut Vec<String>, flag: &str, set: bool) {
    let present = flags.iter().any(|existing| existing == flag);
    if set && !present {
        flags.push(flag.to_string());
    } else if !set && present {
        flags.retain(|existing| existing != flag);
    }
}

/// The index of the item this text names, accepting the same spellings the game does.
///
/// The catalogue as well as the holding, through the one resolver every surface uses
/// ([`item_named`]): a player may write `LEADER`, which the catalogue knows and a unit's own
/// `8 leaders [LEAD]` matches neither way round (`ah-vcp8.1`). A tag the catalogue knows but this
/// unit does not hold still answers `None`, exactly as it did before.
fn find_item(
    ruleset: &Ruleset,
    items: &[crate::report::model::ItemAmount],
    text: &str,
) -> Option<usize> {
    let tag = item_named(Some(ruleset), text, || items.iter())?;
    items
        .iter()
        .position(|item| item.tag.eq_ignore_ascii_case(&tag))
}

fn take_item(items: &mut Vec<crate::report::model::ItemAmount>, index: usize, amount: i64) {
    items[index].amount -= amount;
    if items[index].amount <= 0 {
        // The report never lists an empty stock, so neither does the preview.
        items.remove(index);
    }
}

fn add_item(items: &mut Vec<crate::report::model::ItemAmount>, name: &str, tag: &str, amount: i64) {
    if let Some(existing) = items.iter_mut().find(|item| item.tag == tag) {
        existing.amount += amount;
    } else {
        items.push(crate::report::model::ItemAmount {
            amount,
            name: name.to_string(),
            tag: tag.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    /// A one-region report with two own units, the second there to prove untouched units stay
    /// out of the answer.
    fn report() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    #[test]
    fn a_name_synonym_previews_exactly_as_its_canonical_spelling_does() {
        for (synonym, canonical) in [
            ("SHIP", "OBJECT"),
            ("BUILDING", "OBJECT"),
            ("STRUCTURE", "OBJECT"),
            ("TOWN", "CITY"),
            ("VILLAGE", "CITY"),
        ] {
            assert_eq!(
                preview(&format!("unit 900\nNAME {synonym} \"Dawn Treader\"\n")),
                preview(&format!("unit 900\nNAME {canonical} \"Dawn Treader\"\n")),
                "NAME {synonym} must preview as NAME {canonical}"
            );
        }
    }

    fn preview(orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report(),
            "[]",
            orders,
        )
        .expect("the ruleset loads")
    }

    /// Like `report()`, but with a market line on each side and the giver holding fur, for the
    /// `BUY`/`SELL`/`WITHDRAW`/`TAKE` increments (`ah-agbm`).
    fn report_with_market() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 12 horses [HORS] at $10.",
            "  Wanted: 100 fur [FUR] at $10.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            // A unit's silver is an item, not a `$` figure: without this line the unit has none,
            // and since `ah-omn7` a `BUY` it cannot pay for takes nothing.
            "* Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR], 10 fur [FUR], 100 silver [SILV]. Weight: 20. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    /// Like `report_with_market()`, but the market sells people and the unit already has men, a
    /// skill and the silver to spend - for `settle_headcounts`' recruiting cases.
    fn report_with_market_selling_people() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 humans [HUMN] at $38.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 400 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "",
        ]
        .join("\n")
    }

    /// A hex with one own unit of eight men holding iron, for the `PRODUCE` cases.
    /// `report_with_market`'s own unit is a one-man leader, which makes at most one of anything.
    ///
    /// The men must be the *first* item on the line: `count_men` (`report/unit.rs:217`) reads the
    /// headcount off `items.first()`, which is the report's own convention.
    fn report_with_a_smith() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
            "",
        ]
        .join("\n")
    }

    /// [`report_with_a_smith`], with a quartermaster owning a Caravanserai to transport to - so
    /// what a `PRODUCE` makes has a target `rules/transport` accepts (`ah-64wm`).
    fn report_with_a_smith_and_a_quartermaster() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
            "+ Waystation [1] : Caravanserai.",
            "  * Broker (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
             Skills: quartermaster [QUAM] 1 (30).",
            "",
        ]
        .join("\n")
    }

    /// [`report_with_a_smith`], with a neighbour to give to - for the cases where a transfer and a
    /// `PRODUCE` are written in the same month (`ah-qct4`).
    ///
    /// A second helper rather than a second unit on the shipped one, because `only_unit` asserts
    /// exactly one unit changed for three tests that already read it. The men stay the *first*
    /// item on each own unit's line, as `count_men` (`report/unit.rs:221`) requires.
    fn report_with_a_smith_and_a_neighbour() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    /// Two own units, the giver holding men whose tag, report name and catalogue name are three
    /// different words - `LEAD`, `leaders`, `leader` - which is what makes the spellings diverge.
    ///
    /// The men must be the *first* item on each own unit's line (`count_men`,
    /// `report/unit.rs:221`).
    fn report_with_leaders() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Guards (900), Foo (1), behind, 8 leaders [LEAD], 20 iron [IRON]. Weight: 180. \
             Capacity: 0/0/120/0.",
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    /// Two regions joined by an exit, own units in both, and foreign units - for the
    /// `TRANSPORT`/`DISTRIBUTE` cases (`ah-bxgs`, `ah-64wm`). `5530` sends and is an ordinary unit,
    /// so a transport aimed back at it has an ineligible own target to name.
    ///
    /// Every eligible target is rules-valid: `rules/transport` wants the quartermaster skill,
    /// `rules/economy_transport` wants ownership of a Caravanserai, and
    /// `rules/world_structures` makes the owner "the first unit listed under the object" - so
    /// `5531` and `6857` each open a Caravanserai, while `6858` is listed second inside `6857`'s
    /// and owns nothing. `5532` is a quartermaster standing in no structure at all.
    ///
    /// The foreign side covers what our report cannot say: `7001` owns no Caravanserai, which is
    /// certain; `7003` is a disclosed quartermaster owning one, whose faction's attitude toward
    /// ours is not in our report (`rules/com_attitudes`); `7004` owns one with its skills
    /// undisclosed.
    ///
    /// The men must be the *first* item on each own unit's line (`count_men`,
    /// `report/unit.rs:217`).
    fn report_across_two_hexes() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  Wanted: 100 stone [STON] at $10.",
            "",
            "Exits:",
            "  Southeast : mountain (2,2) in Nowhere.",
            "",
            "* Sender (5530), Foo (1), 6 orcs [ORC], 40 stone [STON], 2 horses [HORS], \
             5 fur [FUR]. Weight: 300. Capacity: 0/0/90/0.",
            "* Loader (5532), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
             Skills: quartermaster [QUAM] 1 (30).",
            "+ Waystation [1] : Caravanserai.",
            "  * Broker (5531), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
             Skills: quartermaster [QUAM] 3 (180).",
            "",
            "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
            "",
            "Exits:",
            "  Northwest : plain (1,1) in Nowhere.",
            "",
            "+ Trade Post [1] : Caravanserai.",
            "  * Quartermaster (6857), Foo (1), leader [LEAD], 15 stone [STON]. Weight: 10. \
             Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 5 (450).",
            "  * Hauler (6858), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
             Skills: quartermaster [QUAM] 1 (30).",
            "+ Ent Trade Emporium [2] : Caravanserai.",
            "  - Trader (7003), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
             Skills: quartermaster [QUAM] 3 (180).",
            "+ Camel Yard [3] : Caravanserai.",
            "  - Camel Master (7004), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    fn two_hex_preview(orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report_across_two_hexes(),
            "[]",
            orders,
        )
        .expect("the ruleset loads")
    }

    /// A mage holding swords to enchant, for the `CAST` cases (`ah-ofpb.5`).
    fn report_with_a_mage() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Enchanter (900), Foo (1), behind, leader [LEAD], 20 swords [SWOR]. Weight: 220. \
             Capacity: 0/0/15/0. Skills: enchant swords [ESWO] 3 (270).",
            "",
        ]
        .join("\n")
    }

    fn preview_over(report: &str, orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(&mut ReportCache::new(), RULESET, report, "[]", orders)
            .expect("the ruleset loads")
    }

    fn only_unit(response: &OrdersPreviewResponse) -> &UnitPreview {
        assert_eq!(response.regions.len(), 1, "one region changed");
        assert_eq!(response.regions[0].units.len(), 1, "one unit changed");
        &response.regions[0].units[0]
    }

    fn change<'a>(unit: &'a UnitPreview, field: &str) -> &'a FieldChange {
        unit.changes
            .iter()
            .find(|change| change.field == field)
            .unwrap_or_else(|| panic!("no change recorded for {field}: {:?}", unit.changes))
    }

    #[test]
    fn name_unit_renames_and_leaves_untouched_units_out_of_the_answer() {
        let response = preview("unit 900\nNAME UNIT \"Renamed\"\n");

        let unit = only_unit(&response);
        assert_eq!(response.regions[0].region_id, "1:1,1");
        assert_eq!(unit.unit.name, "Renamed");
        assert_eq!(unit.status, UnitPreviewStatus::Present);
        assert_eq!(change(unit, "name").original, "Walker");
        assert!(
            !response.regions[0]
                .units
                .iter()
                .any(|unit| unit.unit.unit_id == "901"),
            "the bystander got no orders and must not appear"
        );
    }

    /// This test previously encoded a defect: it asserted a unit could preview as guarding and
    /// avoiding at once, which "The Guard and Avoid Combat flags are mutually exclusive; setting
    /// one automatically cancels the other" says the server never produces.
    #[test]
    fn guard_and_avoid_cancel_each_other_as_the_rules_say() {
        let guarded = preview("unit 900\nAVOID 1\nGUARD 1\n");
        let unit = only_unit(&guarded);
        assert!(unit.unit.on_guard);
        assert!(unit.unit.flags.iter().any(|flag| flag == "guarding"));
        assert!(!unit.unit.flags.iter().any(|flag| flag == "avoiding"));
        assert_eq!(change(unit, "onGuard").original, "no");
        // The walker starts with only "behind", so that is the original flag list.
        assert_eq!(change(unit, "flags").original, "behind");

        let avoided = preview("unit 900\nGUARD 1\nAVOID 1\n");
        let unit = only_unit(&avoided);
        assert!(!unit.unit.on_guard, "avoiding cancels the guard");
        assert!(unit.unit.flags.iter().any(|flag| flag == "avoiding"));
        assert!(!unit.unit.flags.iter().any(|flag| flag == "guarding"));
    }

    /// `rules/sequenceofevents` settles SHARE in the turn's first batch, so a unit ordering it
    /// this turn previews as sharing - and the Flags cell agrees with the SILVER column.
    #[test]
    fn a_share_order_this_turn_shows_in_the_previewed_flags() {
        let response = preview("unit 900\nSHARE 1\n");

        let unit = only_unit(&response);
        assert!(unit.unit.flags.iter().any(|flag| flag == "sharing"));
        assert_eq!(change(unit, "flags").original, "behind");
    }

    #[test]
    fn a_share_0_this_turn_clears_the_previewed_sharing_flag() {
        let response = preview_over(&report_with_a_flagged_former(), "unit 900\nSHARE 0\n");

        let unit = only_unit(&response);
        assert!(
            !unit.unit.flags.iter().any(|flag| flag == "sharing"),
            "SHARE 0 takes the reported flag away: {:?}",
            unit.unit.flags
        );
    }

    #[test]
    fn a_move_with_a_trailing_comment_still_departs() {
        let response = preview("unit 900\nMOVE SE ;to the coast\n");

        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        assert_eq!(origin.units[0].departing_to.as_deref(), Some("1:2,2"));
    }

    #[test]
    fn a_formed_unit_starts_inside_the_parents_structure() {
        // The game creates the new unit in the same object as the unit forming it.
        let response = preview("unit 900\nENTER 4\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.formed)
            .expect("a formed unit");
        assert_eq!(formed.unit.structure_id.as_deref(), Some("4"));
    }

    #[test]
    fn giving_to_yourself_changes_nothing() {
        // The server refuses it, and even a net-zero application would reorder the item list
        // into a phantom "items changed" row: the whole leader stock removed from the front of
        // the list and re-appended at its back.
        let response = preview("unit 900\nGIVE 900 1 LEAD\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    /// `rules/form` restricts an alias to "at least 1", so a FORM the server would refuse must
    /// form nothing here either - and the empty response is the stronger claim, because it also
    /// says the swallowed block's orders did not fall through to unit 900.
    #[test]
    fn a_zero_form_alias_forms_nothing() {
        let response = preview("unit 900\nFORM 0\nNAME UNIT \"Ghost\"\nEND\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn a_gift_to_a_zero_alias_moves_nothing() {
        let response = preview("unit 900\nFORM 0\nEND\nGIVE NEW 0 1 LEAD\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn give_all_moves_the_stock_and_except_keeps_some_back() {
        let all = preview("unit 900\nGIVE 901 ALL SWOR\n");
        let receiver = all.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            3
        );

        let kept = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT 1\n");
        let giver = kept.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            1
        );

        // An EXCEPT that cannot be read makes the whole order unreadable, and an unreadable
        // order changes nothing - it must not fall back to giving everything away.
        let unreadable = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT x\n");
        assert!(unreadable.regions.is_empty(), "{:?}", unreadable.regions);
    }

    // --- trailing text after a completed order is ignored, matching the engine (ah-86vk) ------
    //
    // The validator used to invent an "extra-arguments" error once a form's own arguments were
    // consumed, and this walker mirrored that by treating the whole order as unreadable. Neither
    // matches the engine, which simply stops reading once a form is satisfied - so both now read
    // through `grammar::consumed_arguments`, and an order the validator accepts previews the same
    // thing it did without the trailing text. The malformed-argument controls beside them are
    // unaffected: a form the grammar cannot complete at all still previews nothing.

    #[test]
    fn a_give_with_a_trailing_token_still_moves_the_stock() {
        // `[unit] [amount] [item]` is complete after three tokens; `junk` is trailing text the
        // engine never reads.
        let response = preview("unit 900\nGIVE 901 1 SWOR junk\n");
        let giver = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            2
        );
    }

    #[test]
    fn an_except_without_all_is_ignored_as_trailing_text() {
        // EXCEPT belongs to the ALL form alone, so `[unit] [amount] [item]` is still the form
        // that matches here; `EXCEPT 1` is trailing text the engine drops, not a reserve.
        let response = preview("unit 900\nGIVE 901 2 SWOR EXCEPT 1\n");
        let receiver = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            2
        );
    }

    /// The lexer calls a token a number only when it is all digits, so `-1` is a word. `ALL SWOR
    /// EXCEPT` reaches one token farther than the plain `[unit] [amount] [item]` form before
    /// finding no reserve there, so that farther failure still wins over the shorter form's
    /// trailing-text reading - the order stays unreadable rather than giving everything away.
    #[test]
    fn a_negative_reserve_is_unreadable_rather_than_giving_everything() {
        let response = preview("unit 900\nGIVE 901 ALL SWOR EXCEPT -1\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    #[test]
    fn a_flag_order_with_a_trailing_token_still_sets_the_flag() {
        let response = preview("unit 900\nGUARD 1 junk\n");
        assert!(only_unit(&response).unit.on_guard);
    }

    /// A flag is the literal `0` or `1`. `01` parses to one but is not an order the game has, and
    /// the validator says so - so the preview must not quietly set the flag anyway.
    #[test]
    fn a_flag_written_with_a_leading_zero_is_unreadable() {
        let response = preview("unit 900\nGUARD 01\n");
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    /// `GIVE 0` destroys what is given, and the game writes zero however it likes. Matching the
    /// literal `"0"` sent `000` down the unit-lookup path, where it found nothing and did nothing.
    #[test]
    fn any_way_of_writing_zero_discards() {
        let response = preview("unit 900\n@give 000 1 SWOR\n");

        let giver = only_unit(&response);
        assert_eq!(giver.unit.unit_id, "900");
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            2,
            "one of the three swords is destroyed"
        );
    }

    /// The grammar requires a numeric alias (`Arg::Unit` accepts `NEW 1`, never `NEW a`), so a
    /// FORM the server would refuse must form nothing here either.
    #[test]
    fn a_form_alias_that_is_not_a_number_forms_nothing() {
        let response = preview("unit 900\nFORM a\nNAME UNIT \"Ghost\"\nEND\n");

        // Nothing at all, which is the stronger claim: a FORM that cannot be read still has to
        // open a block, or the orders inside it fall through and rename unit 900 instead. Asking
        // only that no row is `Formed` would not notice that.
        assert!(response.regions.is_empty(), "{:?}", response.regions);
    }

    /// NewOrigins has no ENDFORM - `grammar.rs` deliberately dropped it from the vocabulary, and
    /// the validator calls it an unknown command. A block it appears to close is not closed, so
    /// the orders after it still belong to the unit being formed.
    #[test]
    fn endform_closes_nothing_because_the_rules_have_no_such_order() {
        let response = preview(
            "unit 900\nFORM 1\nENDFORM\nNAME UNIT \"Formed\"\nunit 900\nGIVE NEW 1 1 LEAD\n",
        );

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.formed)
            .expect("a formed unit");
        assert_eq!(
            formed.unit.name, "Formed",
            "the NAME belongs to the formed unit, because ENDFORM closed nothing"
        );
    }

    /// Handing over a whole unit is ownership, not a row's contents, so it moves none of the
    /// giver's items - but `ah-agbm` still marks it uncounted, exactly as a whole class of items
    /// is below: `transfer`'s selector guard cannot tell "ownership, deliberately out of scope"
    /// from "a class this bead has not modelled" apart, and the navigator's Round 1 Q2 chose to
    /// admit the gap rather than hide it (see the design's *Where each recording goes* table).
    /// Renamed from `giving_the_unit_itself_previews_nothing`, whose old name and assertion
    /// predate that decision - recorded as a deviation from the plan's regression net in the PR.
    #[test]
    fn giving_the_unit_itself_moves_no_items_but_is_marked_uncounted() {
        let response = preview("unit 900\nGIVE 901 UNIT\n");
        let unit = only_unit(&response);
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "handing over the unit itself must move none of its items: {:?}",
            unit.changes
        );
        assert_eq!(unit.uncounted, vec!["GIVE 901 UNIT".to_string()]);

        // The control: the same giver and receiver, with a transfer the preview does model and
        // count, so the row above is not just every GIVE reading as uncounted. Both units change
        // here (the giver loses a sword, the receiver gains one), so the giver is found by id
        // rather than assumed to be the only row.
        let moved = preview("unit 900\nGIVE 901 1 SWOR\n");
        let giver = moved.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert!(giver.uncounted.is_empty());
    }

    /// Likewise a whole class of items: the shared reader recognises `ALL ITEMS` where the old
    /// inline parse merely failed to find an item called "ITEMS". `ah-agbm`'s Round 1 Q2 named
    /// exactly this order as the example of one the ITEMS column cannot count, so it is now
    /// admitted rather than silently dropped. Renamed from
    /// `giving_a_class_of_items_previews_nothing`; see the sibling test above for why.
    ///
    /// `ITEM`/`ITEMS` and `MAN`/`MEN` are resolved by `ah-dxfd.1` and no longer land here - see
    /// `a_gift_of_all_men_moves_every_race` and `a_gift_of_all_items_moves_the_swords_too` below.
    /// A class the catalogue still cannot classify, `MAGIC` - the data page never states its
    /// members, and neither `ADVANCED` nor `SPECIAL` fare any better - still turns away exactly as
    /// every class once did, which is what proves the change is narrow.
    #[test]
    fn giving_a_class_this_walk_cannot_resolve_still_moves_nothing() {
        let response = preview("unit 900\nGIVE 901 ALL MAGIC\n");
        let unit = only_unit(&response);
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "a class the preview cannot classify must move nothing: {:?}",
            unit.changes
        );
        assert_eq!(unit.uncounted, vec!["GIVE 901 ALL MAGIC".to_string()]);

        // The control: `ALL` of one named item is modelled and counted, so the row above is the
        // class being turned away rather than `ALL` failing to read. Both units change here, so
        // the giver is found by id rather than assumed to be the only row.
        let named = preview("unit 900\nGIVE 901 ALL SWOR\n");
        let giver = named.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert!(giver.uncounted.is_empty());
    }

    /// `classify_unit`'s own filter, run over a GIVE: every race the giver holds moves, and its
    /// equipment stays behind.
    #[test]
    fn a_gift_of_all_men_moves_every_race() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mixed (900), Foo (1), 10 orcs [ORC], 1 leader [LEAD], 3 swords [SWOR]. \
             Weight: 100. Capacity: 0/0/150/0.",
            "* Empty (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL MEN\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert_eq!(giver.unit.men, 0, "every race it holds moved away");
        assert!(
            giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "the giver keeps its three swords: {:?}",
            giver.unit.items
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "ORC")
                .map(|item| item.amount),
            Some(10)
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(2),
            "the receiver's own leader plus the one given"
        );
        assert!(!receiver.unit.items.iter().any(|item| item.tag == "SWOR"));
    }

    /// A mage holding one leader and one sword, with an own unit to give to.
    ///
    /// The men must be the *first* item on each own unit's line (`count_men`,
    /// `report/unit.rs:221`).
    fn report_with_a_mage_and_a_neighbour(skill: &str) -> String {
        [
            "Foo (1) Report".to_string(),
            String::new(),
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
            String::new(),
            format!(
                "* Mage (900), Foo (1), leader [LEAD], sword [SWOR]. Weight: 11. \
                 Capacity: 0/0/15/0. Skills: {skill} 1 (30)."
            ),
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
            String::new(),
        ]
        .join("\n")
    }

    /// A mage with nothing to hand over, and a neighbour holding both men and equipment, so a
    /// `GIVE 900 ALL ITEMS` still has something to move once the men are refused (`ah-ndp9`).
    ///
    /// Its own literal rather than a widening of `report_with_a_mage_and_a_neighbour`: six tests
    /// read that one and two assert exact sword counts against it.
    fn report_with_a_mage_receiving() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mage (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
             Skills: force [FORC] 1 (30).",
            "* Hands (901), Foo (1), 5 orcs [ORC], 3 swords [SWOR]. Weight: 65. \
             Capacity: 0/0/75/0.",
            "",
        ]
        .join("\n")
    }

    fn preview_for_receiving_mage(orders: &str) -> OrdersPreviewResponse {
        preview_over(&report_with_a_mage_receiving(), orders)
    }

    fn previewed<'a>(response: &'a OrdersPreviewResponse, id: &str) -> &'a UnitPreview {
        response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == id)
            .unwrap_or_else(|| panic!("unit {id} is previewed: {:?}", response.regions))
    }

    /// The question is asked of the report's skills, not of the walk's mutated ones - the one
    /// policy `orders::magic` exists to keep across surfaces (`ah-ndp9`, review finding 1).
    ///
    /// `ah-t8ei` refuses a mage's `GIVE` of men but not another unit's `TAKE` *from* a mage, so a
    /// mundane unit can be holding a magic skill by the end of the document. Asking the mutated
    /// list would refuse men into it here while `apply_transfers`, which asks the report, projects
    /// and warns about nothing - the two halves of the screen disagreeing about one unit.
    #[test]
    fn a_unit_that_becomes_a_mage_mid_document_still_receives_men() {
        let response =
            preview_for_receiving_mage("unit 901\nTAKE FROM 900 1 LEAD\nTAKE FROM 1234 2 ORC\n");
        let taker = previewed(&response, "901");
        assert_eq!(
            taker.unit.men, 8,
            "5 orcs, the mage's leader, and the 2 orcs it then took: {:?}",
            taker.unit.items
        );
    }

    /// `rules/magic` fixes a mage's unit number, and the navigator's New Origins ruling says no man
    /// may join one - so the men stay with the giver and the mage's row does not move.
    #[test]
    fn a_mage_given_men_keeps_its_people_and_its_skills() {
        let response = preview_for_receiving_mage("unit 901\nGIVE 900 2 ORC\n");
        assert!(
            response.regions.is_empty(),
            "nothing moves at all: {:?}",
            response.regions
        );

        // The control: the same gift into a mundane unit does move rows.
        let mundane = preview_over(
            &report_with_a_mage_and_a_neighbour("lumberjack [LUMB]"),
            "unit 901\nGIVE 900 1 ORC\n",
        );
        assert!(!mundane.regions.is_empty(), "the control moves the orc");
    }

    #[test]
    fn a_mage_taking_men_takes_none_of_them() {
        let response = preview_for_receiving_mage("unit 900\nTAKE FROM 901 2 ORC\n");
        assert!(
            response.regions.is_empty(),
            "a mage takes on no men either: {:?}",
            response.regions
        );
    }

    /// X2: the equipment still arrives; only the man tags are refused.
    #[test]
    fn a_mage_given_all_items_keeps_its_men_and_gains_the_equipment() {
        let response = preview_for_receiving_mage("unit 901\nGIVE 900 ALL ITEMS\n");

        let mage = previewed(&response, "900");
        assert_eq!(mage.unit.men, 1, "the mage gains nobody");
        assert!(
            !mage.unit.items.iter().any(|item| item.tag == "ORC"),
            "no orc arrives: {:?}",
            mage.unit.items
        );
        assert_eq!(
            mage.unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(3),
            "the swords do: {:?}",
            mage.unit.items
        );
        assert!(
            mage.unit.skills.iter().any(|skill| skill.tag == "FORC"),
            "and its skills are untouched"
        );

        let giver = previewed(&response, "901");
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "ORC")
                .map(|item| item.amount),
            Some(5),
            "the giver keeps the men it could not hand over: {:?}",
            giver.unit.items
        );
        assert_eq!(giver.unit.men, 5);
    }

    /// `take`'s unshown-source branch bypasses `move_between` and credits the item directly, so it
    /// carries the refusal of its own.
    #[test]
    fn a_mage_taking_men_from_an_unshown_unit_takes_none_of_them() {
        let response = preview_for_receiving_mage("unit 900\nTAKE FROM 1234 2 ORC\n");
        assert!(
            response.regions.is_empty(),
            "nothing is credited from an unshown source either: {:?}",
            response.regions
        );

        // The control: a mundane taker does get the orcs from an unshown source.
        let mundane = preview_over(
            &report_with_a_mage_receiving(),
            "unit 901\nTAKE FROM 1234 2 ORC\n",
        );
        assert!(
            !mundane.regions.is_empty(),
            "the control credits the unshown take"
        );
    }

    fn preview_for_mage(skill: &str, orders: &str) -> OrdersPreviewResponse {
        preview_over(&report_with_a_mage_and_a_neighbour(skill), orders)
    }

    /// `rules/magic`: "mages may not GIVE men at all". Neither naming the race nor asking for the
    /// whole class moves a Foundation mage's leader, so no row changes at all.
    #[test]
    fn foundation_mages_keep_men_given_by_name_or_class() {
        for orders in [
            "unit 900\nGIVE 901 1 LEAD\n",
            "unit 900\nGIVE 901 ALL MEN\n",
        ] {
            for skill in ["force [FORC]", "pattern [PATT]", "spirit [SPIR]"] {
                let response = preview_for_mage(skill, orders);
                assert!(
                    response.regions.is_empty(),
                    "{skill} / {orders} must move nothing: {:?}",
                    response.regions
                );
            }
            // The control: the same order from the same helper report under a mundane skill does
            // change rows, so an empty `regions` above cannot pass for the wrong reason if the
            // fixture's skill line or the order form should ever stop parsing.
            let mundane = preview_for_mage("lumberjack [LUMB]", orders);
            assert!(
                !mundane.regions.is_empty(),
                "the control: a mundane unit's {orders} does move its leader"
            );
        }
    }

    /// The other side of `ah-t8ei`'s rule, and the position this application takes: a mage's men
    /// may be **taken** from it, even though the mage may not give them.
    ///
    /// `rules/magic` says "mages may not GIVE men at all", and `ah-t8ei` (#877) read that as
    /// binding `GIVE` alone — its own summary says "GIVE UNIT, TAKE, TRANSPORT and DISTRIBUTE are
    /// untouched" — so all three surfaces gate the refusal on the order being a GIVE. Nothing
    /// asserted it until this test: the delta round on `ah-3mwm` found that removing the `is_give`
    /// gate left the whole suite green, so the position was carried only by the code.
    ///
    /// It is worth knowing that `rules/take` says the TAKE order "works just like the GIVE order,
    /// except that the direction of transfer is reversed", which is an argument the other way.
    /// Whether that should extend the prohibition is not `ah-3mwm`'s question — this test pins
    /// what the application does today, so that changing it has to be deliberate.
    #[test]
    fn a_mages_men_may_still_be_taken_from_it() {
        let response = preview_for_mage("force [FORC]", "unit 901\nTAKE FROM 900 1 LEAD\n");

        let of = |id: &str| {
            response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == id)
                .unwrap_or_else(|| panic!("unit {id} is previewed"))
        };

        let taker = of("901");
        assert_eq!(
            taker
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(1),
            "the leader reaches the taker"
        );
        assert_eq!(taker.unit.men, 2, "its own orc, and the leader it took");

        let mage = of("900");
        assert!(
            !mage.unit.items.iter().any(|item| item.tag == "LEAD"),
            "and leaves the mage: {:?}",
            mage.unit.items
        );
        assert_eq!(mage.unit.men, 0);
    }

    /// `GIVE 0` bypasses the catalogue's own un-giveable restrictions, because a discard is not a
    /// transfer to another unit - but `rules/magic` refuses the mage's men whatever the target.
    #[test]
    fn a_mage_cannot_discard_men() {
        let orders = "unit 900\nGIVE 0 1 LEAD\n";
        let response = preview_for_mage("force [FORC]", orders);
        assert!(
            response.regions.is_empty(),
            "a mage may not discard its men either: {:?}",
            response.regions
        );

        // The control, for the same reason as the test above: the discard itself works.
        let mundane = preview_for_mage("lumberjack [LUMB]", orders);
        assert!(
            !mundane.regions.is_empty(),
            "a mundane unit does discard its leader"
        );
    }

    /// The refusal is per tag, not per order: `ALL ITEMS` still hands over the equipment the mage
    /// may give while its men stay behind.
    #[test]
    fn a_mage_giving_all_items_keeps_men_and_moves_equipment() {
        let response = preview_for_mage("force [FORC]", "unit 900\nGIVE 901 ALL ITEMS\n");
        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(1),
            "the mage keeps its leader: {:?}",
            giver.unit.items
        );
        assert_eq!(giver.unit.men, 1, "and keeps the headcount that leader is");
        assert!(
            !giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "the sword is equipment and still moves: {:?}",
            giver.unit.items
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(1)
        );
        assert!(
            !receiver.unit.items.iter().any(|item| item.tag == "LEAD"),
            "and no leader arrives: {:?}",
            receiver.unit.items
        );
    }

    /// `rules/magic`'s own exception: "The mage may be given to another faction using the GIVE UNIT
    /// order." That is ownership rather than item movement, and the preview leaves it unmodelled
    /// exactly as it does for any other unit (`effects.rs:1294`) - the new refusal must not turn it
    /// into a refused man-item transfer.
    #[test]
    fn give_unit_remains_a_whole_unit_order_for_a_mage() {
        let response = preview_for_mage("force [FORC]", "unit 900\nGIVE 901 UNIT\n");
        let region = &response.regions[0];
        assert_eq!(region.units.len(), 1, "only the giver's row is annotated");
        let unit = &region.units[0];
        assert!(
            !unit.changes.iter().any(|change| change.field == "items"),
            "handing over the unit itself moves no items: {:?}",
            unit.changes
        );
        assert_eq!(unit.unit.men, 1, "and no headcount changes");
        assert_eq!(unit.uncounted, vec!["GIVE 901 UNIT".to_string()]);
    }

    /// `ah-3sp7.1` taught the catalogue `MOUNT`'s five tags, so `tags_moved` can now resolve a
    /// class beyond `MAN`/`MEN` and `ITEM`/`ITEMS`: the horses move, the swords - not a mount -
    /// stay behind, and nothing about the gift is left unresolved.
    #[test]
    fn a_gift_of_all_mounts_moves_the_horses() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 4 horses [HORS], 3 swords [SWOR]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL MOUNTS\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert!(!giver.unit.items.iter().any(|item| item.tag == "HORS"));
        assert!(
            giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "the giver keeps its swords: {:?}",
            giver.unit.items
        );
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HORS")
                .map(|item| item.amount),
            Some(4)
        );
        assert!(giver.uncounted.is_empty());
    }

    /// 51 monsters and the imprisoned entity carry `This item cannot be given to other units.`, so
    /// `ALL MONSTERS` selects sixty items and moves the one that may change hands.
    #[test]
    fn a_gift_of_all_monsters_leaves_the_lions_behind() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 20 lions [LION], 1 skeleton [SKEL]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL MONSTERS\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert!(
            giver.unit.items.iter().any(|item| item.tag == "LION"),
            "the lions cannot be given away and stay put: {:?}",
            giver.unit.items
        );
        assert!(!giver.unit.items.iter().any(|item| item.tag == "SKEL"));
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SKEL")
                .map(|item| item.amount),
            Some(1)
        );
        assert!(!receiver.unit.items.iter().any(|item| item.tag == "LION"));
    }

    /// The same refusal applies to a named-item gift, not only the class form: `GIVE 901 20 LION`
    /// moves nothing.
    #[test]
    fn a_named_gift_of_lions_moves_nothing() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 20 lions [LION]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 20 LION\n",
        )
        .expect("the ruleset loads");

        assert!(
            response.regions.is_empty(),
            "nothing moves, so no row changes: {:?}",
            response.regions
        );
    }

    /// `GIVE 0` discards rather than gives, and unit 0 is not "another unit" - the refusal that
    /// keeps the lions with a live receiver does not apply to a discard (epic decision 9).
    #[test]
    fn a_discard_of_all_monsters_takes_the_lions_too() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD], 20 lions [LION], 1 skeleton [SKEL]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 0 ALL MONSTERS\n",
        )
        .expect("the ruleset loads");

        let giver = only_unit(&response);
        assert!(
            !giver.unit.items.iter().any(|item| item.tag == "LION"),
            "a discard destroys the lions too: {:?}",
            giver.unit.items
        );
        assert!(!giver.unit.items.iter().any(|item| item.tag == "SKEL"));
    }

    /// `rules/give`: `ITEM`/`ITEMS` is "the combination of all of the previous categories" -
    /// everything the unit holds, silver included, so the giver ends up with nothing.
    #[test]
    fn a_gift_of_all_items_moves_the_swords_too() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mixed (900), Foo (1), 10 orcs [ORC], 1 leader [LEAD], 3 swords [SWOR]. \
             Weight: 100. Capacity: 0/0/150/0.",
            "* Empty (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 ALL ITEMS\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert!(
            giver.unit.items.is_empty(),
            "the giver ends up holding nothing: {:?}",
            giver.unit.items
        );
        assert_eq!(giver.unit.men, 0);
        assert!(receiver.unit.items.iter().any(|item| item.tag == "SWOR"));
        assert!(receiver.unit.items.iter().any(|item| item.tag == "ORC"));
    }

    /// A gift to another faction's new unit is decided without any closure: the game really
    /// creates that unit in this hex, so it is not "named nowhere" however little the report can
    /// say about it - and it is another faction's, so `rules/give` wants a declaration no report
    /// carries. The swords' count stands and the order is admitted (`ah-66yi`).
    #[test]
    fn giving_to_another_factions_new_unit_leaves_the_goods_uncertain() {
        let response = preview("unit 900\nGIVE FACTION 14 NEW 2 1 SWOR\n");
        let giver = only_unit(&response);
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(3),
            "the report's own count stands"
        );
        assert_eq!(
            giver.uncounted,
            vec!["GIVE FACTION 14 NEW 2 1 SWOR".to_string()]
        );

        // The control: our own new unit, same order shape. Without it this test would pass just as
        // well against a reader that had stopped understanding `NEW` at all - and the arm it
        // guards is the dangerous one, since a foreign target read as a zero would destroy the
        // swords rather than merely fail to move them.
        let ours = preview("unit 900\nFORM 2\nEND\nGIVE NEW 2 1 SWOR\nGIVE NEW 2 1 LEAD\n");
        assert!(
            ours.regions[0]
                .units
                .iter()
                .any(|unit| unit.formed && unit.unit.items.iter().any(|item| item.tag == "SWOR")),
            "the control must hand the sword to our own formed unit: {:?}",
            ours.regions
        );
    }

    #[test]
    fn a_second_form_with_a_taken_alias_is_swallowed() {
        let response = preview(
            "unit 900\nFORM 1\nNAME UNIT \"First\"\nEND\nFORM 1\nNAME UNIT \"Second\"\nEND\nGIVE NEW 1 1 LEAD\n",
        );

        let formed: Vec<_> = response.regions[0]
            .units
            .iter()
            .filter(|unit| unit.formed)
            .collect();
        assert_eq!(formed.len(), 1, "one alias, one unit");
        assert_eq!(
            formed[0].unit.name, "First",
            "the block that could not form anything is swallowed, not applied to the first"
        );
    }

    /// `rules/sequenceofevents` settles FORM in the instant-order phase, several phases before the
    /// Give phase, so a gift written *above* the sibling block that forms its target still arrives:
    /// the game never reads the document top to bottom (`ah-6f48`).
    #[test]
    fn a_gift_written_above_the_sibling_block_that_forms_its_target_still_arrives() {
        let response = preview("unit 901\nGIVE NEW 1 1 LEAD\nunit 900\nFORM 1\nEND\n");

        let formed: Vec<_> = response.regions[0]
            .units
            .iter()
            .filter(|unit| unit.formed)
            .collect();
        assert_eq!(formed.len(), 1, "one alias, one formed unit: {:?}", formed);
        assert_eq!(
            formed[0]
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(1),
            "the leader reaches new-1 although the FORM block is written below the gift: {:?}",
            formed[0].unit.items
        );
    }

    /// The control for the test above: the same orders the other way up must give the same answer,
    /// so a green result there is not a reader that has stopped resolving `NEW` at all (`ah-6f48`).
    #[test]
    fn the_same_gift_below_the_sibling_form_gives_the_same_result() {
        let response = preview("unit 900\nFORM 1\nEND\nunit 901\nGIVE NEW 1 1 LEAD\n");

        let formed: Vec<_> = response.regions[0]
            .units
            .iter()
            .filter(|unit| unit.formed)
            .collect();
        assert_eq!(formed.len(), 1, "one alias, one formed unit: {:?}", formed);
        assert_eq!(
            formed[0]
                .unit
                .items
                .iter()
                .find(|item| item.tag == "LEAD")
                .map(|item| item.amount),
            Some(1),
            "{:?}",
            formed[0].unit.items
        );
    }

    #[test]
    fn a_new_alias_belongs_to_its_own_hex() {
        // Two own units in two hexes: the alias formed in one must be invisible to the other.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
            "plain (3,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Trader (902), Foo (1), leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\nunit 902\nGIVE NEW 1 2 SWOR\n",
        )
        .expect("the ruleset loads");

        let formed = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.formed)
            .expect("the formed unit");
        assert!(
            !formed.unit.items.iter().any(|item| item.tag == "SWOR"),
            "a GIVE from another hex must not reach it: {:?}",
            formed.unit.items
        );
    }

    /// `rules/form` scopes an alias to its region, so two hexes may each write `FORM 1`. Each
    /// formed unit buys for itself: the two are different units and only share a name.
    #[test]
    fn two_hexes_forming_the_same_alias_each_buy_for_themselves() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 5 humans [HUMN] at $38.",
            "",
            "* Alpha (900), Foo (1), 10 humans [HUMN], 4000 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0.",
            "",
            "plain (3,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 5 humans [HUMN] at $38.",
            "",
            "* Beta (902), Foo (1), 10 humans [HUMN], 4000 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 900\nFORM 1\nBUY 1 HUMN\nEND\nGIVE NEW 1 500 SILV\n\
             unit 902\nFORM 1\nBUY 4 HUMN\nEND\nGIVE NEW 1 500 SILV\n",
        );

        for (region_id, expected) in [("1:1,1", 1), ("1:3,1", 4)] {
            let region = response
                .regions
                .iter()
                .find(|region| region.region_id == region_id)
                .unwrap_or_else(|| panic!("no preview for {region_id}"));
            let formed: Vec<_> = region.units.iter().filter(|unit| unit.formed).collect();
            assert_eq!(formed.len(), 1, "one formed unit in {region_id}");
            let bought = formed[0]
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HUMN")
                .map_or(0, |item| item.amount);
            assert_eq!(
                bought, expected,
                "the formed unit in {region_id} buys only its own hex's HUMN: {:?}",
                formed[0].unit.items
            );
        }
    }

    #[test]
    fn an_underscored_name_reads_with_spaces() {
        // The server prints Nine_of_Eight as "Nine of Eight", so the preview must too.
        let response = preview("unit 900\nNAME UNIT Nine_of_Eight\n");
        assert_eq!(only_unit(&response).unit.name, "Nine of Eight");
    }

    #[test]
    fn behind_zero_removes_the_reported_flag() {
        let response = preview("unit 900\nBEHIND 0\n");

        let unit = only_unit(&response);
        assert!(
            !unit.unit.flags.iter().any(|flag| flag == "behind"),
            "flags were: {:?}",
            unit.unit.flags
        );
        assert_eq!(change(unit, "flags").original, "behind");
    }

    #[test]
    fn enter_and_leave_change_the_structure() {
        let entered = preview("unit 900\nENTER 4\n");
        assert_eq!(only_unit(&entered).unit.structure_id.as_deref(), Some("4"));

        // Every LEAVE runs before any ENTER, so a block holding both ends *inside* - the rule
        // `semantics::structure_after_orders` states, settled by the navigator on 2026-08-18
        // (ah-mjy). This assertion previously read the two in document order and so encoded the
        // defect: it expected the unit ashore and no row at all.
        let both = preview("unit 900\nENTER 4\nLEAVE\n");
        assert_eq!(only_unit(&both).unit.structure_id.as_deref(), Some("4"));

        // A LEAVE on its own does put it ashore, and the report already had it there: nothing to
        // say.
        let left = preview("unit 900\nLEAVE\n");
        assert!(left.regions.is_empty(), "{:?}", left.regions);
    }

    /// Trailing text the grammar now ignores (`ah-86vk`) still applies ENTER and LEAVE; a
    /// genuinely malformed target still moves nobody, exactly as `read_only_number` already
    /// read it for `orders::intents`.
    #[test]
    fn accepted_trailing_text_still_boards_and_leaves() {
        let entered = preview("unit 900\nENTER 4 note\n");
        assert_eq!(only_unit(&entered).unit.structure_id.as_deref(), Some("4"));

        // A unit already inside a structure, so a LEAVE has something to undo - unlike the
        // control above, where the unit starts ashore and a no-op LEAVE previews nothing.
        let boarded_report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "+ Tower [4] : Tower.",
            "  * Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let left = preview_over(&boarded_report, "unit 900\nLEAVE note\n");
        assert_eq!(only_unit(&left).unit.structure_id, None);
    }

    #[test]
    fn a_malformed_enter_target_moves_nobody() {
        assert!(preview("unit 900\nENTER shed\n").regions.is_empty());
    }

    /// The walker abandons an unclosed TURN at the next `unit` line, as the parser and the intents
    /// reader always did - so an unclosed block no longer swallows the units written after it.
    #[test]
    fn an_unclosed_turn_block_ends_at_the_next_unit() {
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &[
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "",
            ]
            .join("\n"),
            "[]",
            "unit 900\nTURN\nWORK\nunit 901\nGUARD 1\n",
        )
        .expect("the ruleset loads");

        let bystander = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == "901")
            .expect("unit 901's GUARD is applied even though unit 900 left a TURN block open");
        assert!(bystander.unit.on_guard);
    }

    #[test]
    fn turn_blocks_are_next_month_and_repeat_orders_are_this_month() {
        let response = preview(
            "unit 900\n@NAME UNIT \"Repeated\"\nTURN\nNAME UNIT \"Later\"\nGUARD 1\nENDTURN\n",
        );

        let unit = only_unit(&response);
        assert_eq!(unit.unit.name, "Repeated", "@ applies, TURN does not");
        assert!(!unit.unit.on_guard, "the GUARD belongs to next month");
    }

    #[test]
    fn inherited_flags_drops_guard_and_autotax_and_keeps_the_rest() {
        let parent: Vec<String> = [
            "behind",
            "avoiding",
            "revealing faction",
            "sharing",
            "on guard",
            "guarding",
            "taxing",
            "autotax",
            "under strength",
            "holding",
            "no aid",
            "consuming unit's food",
            "riding battle spoils",
        ]
        .iter()
        .map(|flag| flag.to_string())
        .collect();

        assert_eq!(
            inherited_flags(&parent),
            vec![
                "behind",
                "avoiding",
                "revealing faction",
                "sharing",
                "holding",
                "no aid",
                "consuming unit's food",
                "riding battle spoils",
            ],
            "rules/form: everything but the guard and autotax flags, in the report's order"
        );

        let shouted: Vec<String> = ["ON GUARD", "Autotax"]
            .iter()
            .map(|flag| flag.to_string())
            .collect();
        assert!(
            inherited_flags(&shouted).is_empty(),
            "the exclusion matches however the flag is cased"
        );
    }

    /// A report whose forming unit carries an inheritable flag pair and an excluded one each.
    fn report_with_a_flagged_former() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Warden (900), Foo (1), behind, sharing, on guard, taxing, 2 leaders [LEAD], 100 silver [SILV]. Weight: 20. Capacity: 0/0/30/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n")
    }

    #[test]
    fn a_formed_unit_inherits_its_parents_flags_but_not_guard_or_autotax() {
        // The leader is transferred so the formed unit survives dissolution (`rules/form`: a unit
        // that gains nobody is removed), which is the only reason this block has a GIVE at all.
        let response = preview_over(
            &report_with_a_flagged_former(),
            "unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n",
        );

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.formed)
            .expect("a formed unit");
        assert_eq!(
            formed.unit.flags,
            vec!["behind", "sharing"],
            "rules/form: inherited, less the guard and autotax flags"
        );
        assert!(!formed.unit.on_guard, "guard is never inherited");
    }

    /// `rules/sequenceofevents` processes "FORM orders" before "ADDRESS, ARMOR, AUTOTAX, AVOID,
    /// BEHIND, ..." - so what a `FORM` inherits is the report's flags, never this month's own flag
    /// orders, whichever side of the `FORM` they are written on.
    #[test]
    fn a_form_inherits_the_flags_the_report_showed_not_this_months_flag_orders() {
        let response = preview_over(
            &report_with_a_flagged_former(),
            "unit 900\nBEHIND 0\nAVOID 1\nFORM 1\nBEHIND 1\nFORM 2\nEND\nEND\nGIVE NEW 1 1 LEAD\nGIVE NEW 2 1 LEAD\n",
        );

        let flags = |id: &str| {
            response.regions[0]
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .unwrap_or_else(|| panic!("{id} is previewed"))
                .unit
                .flags
                .clone()
        };
        assert_eq!(
            flags("new-1"),
            vec!["behind", "sharing"],
            "the parent's BEHIND 0 and AVOID 1 are a later phase than the FORM"
        );
        assert_eq!(
            flags("new-2"),
            vec!["behind", "sharing"],
            "and so is the outer formed unit's own BEHIND 1"
        );
    }

    #[test]
    fn form_creates_a_provisional_unit_that_its_block_names() {
        let response =
            preview("unit 900\nFORM 1\nNAME UNIT \"Recruits\"\nBEHIND 1\nEND\nGIVE NEW 1 1 LEAD\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.formed)
            .expect("a formed unit");
        assert_eq!(formed.unit.unit_id, "new-1");
        assert_eq!(formed.unit.name, "Recruits");
        assert!(formed.unit.own);
        // Since `ah-8cjs` the parent's own `behind` is inherited too, so this no longer
        // discriminates the block's `BEHIND 1`; `a_formed_unit_inherits_its_parents_flags_but_not_
        // guard_or_autotax` is what pins the inheritance now.
        assert!(formed.unit.flags.iter().any(|flag| flag == "behind"));
        assert_eq!(
            formed.unit.men, 1,
            "the leader transferred to it, which is what keeps it from dissolving"
        );
    }

    /// A formed unit's own `BUY` has to reach the preview before dissolution can be decided, or
    /// every unit created through the documented `rules/form` recruitment idiom would be removed
    /// (`rules/form`: "If a new unit gains at least one recruit, the unit will form possessing any
    /// unused silver and all the other items it was given").
    #[test]
    fn formed_market_purchases_are_projected_before_dissolution() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 100 silver\n",
        );

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the formed unit survives its successful recruitment");
        assert!(formed.formed);
        assert_eq!(formed.status, UnitPreviewStatus::Present);
        assert_eq!(formed.unit.men, 1, "the recruit was bought");
        assert_eq!(
            formed
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HUMN")
                .map_or(0, |item| item.amount),
            1
        );
        assert_eq!(
            formed
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SILV")
                .map_or(0, |item| item.amount),
            100,
            "the silver it was given stays with it, as the ITEMS column shows silver for every \
             other unit that BUYs - the spend belongs to the SILVER column"
        );
    }

    /// `rules/form` dissolves a formed unit that gains nobody, and since `ah-ty3s.3` the row is
    /// drawn rather than skipped (decision **K2**), so it does not vanish from under a player
    /// editing its orders. It holds nothing: the goods have already reverted.
    #[test]
    fn a_formed_unit_that_gains_nobody_is_previewed_as_dissolving() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 10 silver [SILV]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 1 10 SILV\n",
        );

        let dissolving = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the row a player is editing stays on the table");
        assert_eq!(dissolving.status, UnitPreviewStatus::Present);
        assert!(dissolving.formed);
        assert!(dissolving.dissolving);
        assert!(
            !dissolving
                .unit
                .items
                .iter()
                .any(|item| item.tag == "SWOR" && item.amount > 0),
            "the swords have reverted: {:?}",
            dissolving.unit.items
        );
        assert!(
            !dissolving
                .unit
                .items
                .iter()
                .any(|item| item.tag == "SILV" && item.amount > 0),
            "and the silver with them: {:?}",
            dissolving.unit.items
        );
    }

    /// `rules/form`: the goods a dissolving formed unit "was given" revert to the first own unit
    /// in the region - so that row gains goods, and the Items popup must be able to say why.
    #[test]
    fn a_reverted_gift_is_recorded_on_the_row_the_goods_revert_to() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 10 silver [SILV]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 1 10 SILV\n",
        );

        let receiver = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the row the goods revert to is previewed");
        assert_eq!(
            receiver
                .item_changes
                .iter()
                .map(|change| (
                    change.tag.as_str(),
                    change.delta,
                    change.cause,
                    change.line,
                    change.other.as_ref().map(|other| other.unit_id.as_str()),
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    "SWOR",
                    3,
                    ItemChangeCause::GiftReverted,
                    None,
                    Some("new-1"),
                ),
                (
                    "SILV",
                    10,
                    ItemChangeCause::GiftReverted,
                    None,
                    Some("new-1"),
                ),
            ],
            "{:?}",
            receiver.item_changes,
        );

        let dissolving = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the dissolving row is drawn");
        assert!(
            dissolving.item_changes.is_empty(),
            "the dissolving row states nothing: {:?}",
            dissolving.item_changes,
        );
    }

    /// The row names where its goods went, so the hover can say so without a second implementation
    /// of `rules/form`'s "the first unit you have in that region" in the client.
    #[test]
    fn a_dissolving_row_names_the_unit_its_goods_revert_to() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 3 SWOR\n",
        );

        let dissolving = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the dissolving row is drawn");
        assert_eq!(
            dissolving.dissolves_into,
            Some("Receiver (900)".to_string())
        );
    }

    /// `rules/sequenceofevents` runs the market before `PRODUCE`, `BUILD` and the month-long
    /// orders, so a unit the market dissolved makes nothing - and the row must not say it does.
    #[test]
    fn a_dissolving_row_reports_nothing_it_would_have_made() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nPRODUCE WOOD\nTRANSPORT 900 1 SILV\nEND\n\
             GIVE NEW 1 100 SILV\n",
        );

        let dissolving = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the dissolving row is drawn");
        assert!(dissolving.produced.is_empty(), "{:?}", dissolving.produced);
        assert!(dissolving.built.is_empty(), "{:?}", dissolving.built);
        assert!(dissolving.created.is_empty(), "{:?}", dissolving.created);
        assert!(
            dissolving.item_changes.is_empty(),
            "{:?}",
            dissolving.item_changes
        );
        assert!(
            dissolving.transport_sent.is_empty(),
            "{:?}",
            dissolving.transport_sent
        );
    }

    /// `rules/form`: "If the demand for recruits in that region that month is much higher than
    /// the supply, ... it may not gain any recruits at all. ... If no recruits are gained at all,
    /// the empty unit will be dissolved, and the silver and any other items it was given will
    /// revert to the first unit you have in that region." The first unit is the first the *report*
    /// shows, not the one that formed it - so the market here has nobody left to sell.
    #[test]
    fn an_empty_formed_unit_returns_its_goods_to_the_first_own_unit() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 10 silver [SILV]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 1 10 SILV\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        let dissolving = units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the row is drawn rather than skipped since `ah-ty3s.3`");
        assert!(dissolving.dissolving, "and says the game will dissolve it");
        assert!(dissolving.formed);
        assert!(
            dissolving.unit.items.iter().all(|item| item.amount == 0),
            "holding nothing: the goods have reverted: {:?}",
            dissolving.unit.items
        );

        let amount = |id: &str, tag: &str| {
            units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == tag))
                .map_or(0, |item| item.amount)
        };
        assert_eq!(amount("900", "SWOR"), 3, "the first own unit receives them");
        assert_eq!(amount("900", "SILV"), 10);
        assert_eq!(amount("901", "SWOR"), 0, "the bystander receives nothing");
        assert_eq!(amount("901", "SILV"), 0);
        assert_eq!(amount("902", "SWOR"), 0, "the former gave them away");
        assert_eq!(amount("902", "SILV"), 0);
    }

    /// `rules/form` reverts "the silver and any other items it **was given**". A unit that
    /// dissolves never existed to trade, so what its own `BUY` bought is not a windfall for the
    /// unit it reverts to.
    #[test]
    fn a_dissolved_units_purchases_are_not_handed_on() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 grain [GRAI] at $10.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 5 grain\nEND\nGIVE NEW 1 100 SILV\n",
        );

        let receiver = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the first own unit receives what was given");
        assert_eq!(
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SILV")
                .map_or(0, |item| item.amount),
            100,
            "the silver it was given reverts in full"
        );
        assert!(
            !receiver.unit.items.iter().any(|item| item.tag == "GRAI"),
            "nobody ordered grain for this unit: {:?}",
            receiver.unit.items
        );
    }

    /// A dissolved unit's queued `TRANSPORT` is dropped: what its own month bought must not reach
    /// a recipient by the one path the revert itself does not cover.
    #[test]
    fn a_dissolved_unit_sends_no_transport() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 grain [GRAI] at $10.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 5 grain\nTRANSPORT 900 5 GRAI\nEND\nGIVE NEW 1 100 SILV\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        let dissolving = units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the row is drawn rather than skipped since `ah-ty3s.3`");
        assert!(dissolving.dissolving);
        assert!(dissolving.formed);
        assert!(
            dissolving.transport_sent.is_empty(),
            "and sends nothing: {:?}",
            dissolving.transport_sent
        );
        let receiver = units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the first own unit is previewed, having received the silver");
        assert!(
            receiver.transport_received.is_empty(),
            "nothing arrives from a unit that never existed: {:?}",
            receiver.transport_received
        );
        assert!(
            !receiver.unit.items.iter().any(|item| item.tag == "GRAI"),
            "and no grain with it: {:?}",
            receiver.unit.items
        );
    }

    /// A formed unit's `BUY` competes for the same limited stock as the report's own units
    /// (`rules/buy`), which is what wiring `formed_units` into `item_effects` puts back.
    #[test]
    fn a_formed_units_buy_competes_for_a_scarce_market() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 2 humans [HUMN] at $38.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 400 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0.",
            "",
        ]
        .join("\n");
        let alone = preview_over(&report, "unit 900\nBUY 2 HUMN\n");
        let bought_alone = alone.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == "HUMN"))
            .map_or(0, |item| item.amount);
        assert_eq!(bought_alone, 12, "the whole offer, with nobody to share it");

        let shared = preview_over(
            &report,
            "unit 900\nBUY 2 HUMN\nFORM 1\nBUY 2 HUMN\nEND\nGIVE NEW 1 100 SILV\n",
        );
        let bought_shared = shared.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == "HUMN"))
            .map_or(0, |item| item.amount);
        assert_eq!(
            bought_shared, 11,
            "one of the two on offer goes to the formed unit"
        );
    }

    /// What a dissolving unit `TAKE`s from a unit the report shows is not handed on either - only
    /// what it was given is. The source keeps the shortfall its own projected `TAKE` left it,
    /// which is the pre-existing behaviour of that row and not dissolution's to unwind.
    #[test]
    fn a_dissolved_units_take_is_not_handed_on() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 5 stone [STON], 2 swords [SWOR]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nTAKE FROM 902 4 STON\nEND\nGIVE NEW 1 2 SWOR\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        let dissolving = units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the row is drawn rather than skipped since `ah-ty3s.3`");
        assert!(dissolving.dissolving);
        assert!(dissolving.formed);
        let held = |id: &str, tag: &str| {
            units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == tag))
                .map_or(0, |item| item.amount)
        };
        assert_eq!(held("900", "SWOR"), 2, "the gift reverts");
        assert_eq!(
            held("900", "STON"),
            0,
            "what the dissolving unit took is not a windfall for the recipient"
        );
    }

    /// Two empty formed units in one region: both dissolve, and both revert to the same first own
    /// unit - a dissolving row can never be another's recipient, because a recipient is always a
    /// unit the report shows.
    #[test]
    fn two_empty_forms_in_one_region_both_revert_to_the_first_unit() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 3 swords [SWOR], 4 stone [STON]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nEND\nFORM 2\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 2 4 STON\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            units
                .iter()
                .filter(|unit| unit.unit.unit_id.starts_with("new-"))
                .all(|unit| unit.dissolving),
            "both rows are drawn, both dissolving: {:?}",
            units
                .iter()
                .map(|unit| (&unit.unit.unit_id, unit.status))
                .collect::<Vec<_>>()
        );
        let receiver = units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the first own unit receives both lots");
        let held = |tag: &str| {
            receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map_or(0, |item| item.amount)
        };
        assert_eq!(held("SWOR"), 3);
        assert_eq!(held("STON"), 4);
    }

    /// The recipient search is region-scoped: two regions, each forming an empty unit, must revert
    /// to their own first unit and not to the other region's.
    #[test]
    fn each_region_reverts_to_its_own_first_unit() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* North (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* NorthFormer (901), Foo (1), leader [LEAD], 3 swords [SWOR]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
            "plain (3,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* South (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* SouthFormer (903), Foo (1), leader [LEAD], 4 stone [STON]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 901\nFORM 1\nEND\nGIVE NEW 1 3 SWOR\nunit 903\nFORM 1\nEND\nGIVE NEW 1 4 STON\n",
        );

        let units: Vec<&UnitPreview> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .collect();
        assert!(
            units
                .iter()
                .filter(|unit| unit.unit.unit_id.starts_with("new-"))
                .all(|unit| unit.dissolving),
            "both rows are drawn, both dissolving: {:?}",
            units
                .iter()
                .map(|unit| (&unit.unit.unit_id, unit.status))
                .collect::<Vec<_>>()
        );
        let held = |id: &str, tag: &str| {
            units
                .iter()
                .find(|unit| unit.unit.unit_id == id)
                .and_then(|unit| unit.unit.items.iter().find(|item| item.tag == tag))
                .map_or(0, |item| item.amount)
        };
        assert_eq!(held("900", "SWOR"), 3, "its own region's goods come back");
        assert_eq!(held("900", "STON"), 0, "and the other region's do not");
        assert_eq!(held("902", "STON"), 4);
        assert_eq!(held("902", "SWOR"), 0);
    }

    /// The rule's condition is the resulting headcount, not whether a `BUY` was written: people
    /// handed over by `GIVE` keep the provisional unit alive.
    #[test]
    fn people_given_to_a_formed_unit_keep_it_alive() {
        let response = preview("unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n");

        let formed = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("a formed unit holding people survives");
        assert!(formed.formed);
        assert_eq!(formed.status, UnitPreviewStatus::Present);
        assert_eq!(formed.unit.men, 1);
    }

    #[test]
    fn give_moves_items_between_both_units() {
        let response = preview("unit 900\nGIVE 901 2 SWOR\n");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        let swords = |unit: &UnitPreview| {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount)
        };
        assert_eq!(swords(giver), 1);
        assert_eq!(swords(receiver), 2);
        assert_eq!(change(giver, "items").original, "1 LEAD, 3 SWOR");
    }

    #[test]
    fn give_of_a_race_moves_men_too() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Crowd (900), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0.",
            "* Empty (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nGIVE 901 4 ORC\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "901")
            .expect("the receiver changed");

        assert_eq!(giver.unit.men, 6);
        assert_eq!(receiver.unit.men, 5, "the leader plus four orcs");
        assert_eq!(change(giver, "men").original, "10");
    }

    #[test]
    fn given_men_bring_their_skills_and_the_giver_is_untouched() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "* Students (2200), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 1 (30).",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 1234\nGIVE 2200 5 HUMN\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let giver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "1234")
            .expect("the giver changed (men and items moved)");
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "2200")
            .expect("the receiver changed");

        // Receiver: 10 men at (30) merge with 5 arriving at (180) -> (80), level 2.
        assert_eq!(
            receiver.unit.skills,
            vec![lumberjack(80)],
            "{:?}",
            receiver.unit.skills
        );
        assert_eq!(change(receiver, "skills").original, "LUMB 1 (30)");

        // The giver's own skills are untouched by giving men away.
        assert_eq!(giver.unit.skills, vec![lumberjack(180)]);
        assert!(
            giver.changes.iter().all(|change| change.field != "skills"),
            "the giver's skills must not be marked changed: {:?}",
            giver.changes
        );
    }

    /// `rules/take`: "works just like the GIVE order, except that the direction of transfer is
    /// reversed" - so a TAKE has to move the headcount and merge skills exactly as a GIVE does,
    /// even though the item movement itself belongs to the ledger (`ah-agbm`) rather than here.
    #[test]
    fn a_take_of_men_moves_the_headcount_and_merges_their_skills() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: lumberjack [LUMB] 3 (180).",
            "* Students (2200), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: lumberjack [LUMB] 1 (30).",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 2200\nTAKE FROM 1234 5 ORC\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let source = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "1234")
            .expect("the source changed");
        let taker = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "2200")
            .expect("the taker changed");

        assert_eq!(taker.unit.men, 15, "10 already there plus 5 taken");
        assert_eq!(source.unit.men, 5, "10 less the 5 taken");
        // Taker: 10 men at (30) merge with 5 arriving at (180) -> (80), level 1.
        assert_eq!(
            taker.unit.skills,
            vec![lumberjack(80)],
            "{:?}",
            taker.unit.skills
        );
        // The source's own skills are untouched by losing men.
        assert_eq!(source.unit.skills, vec![lumberjack(180)]);
    }

    /// A `TAKE FROM` a unit this hex does not show still credits the item optimistically
    /// (`ah-agbm`'s `taken_unshown` path), but the arriving men's true skills are unknown, not
    /// zero - the checks side (`apply_gifts_of_men`) already marks a unit taking from an unshown
    /// source `Unknowable` rather than guessing, and `settle_headcounts` must not quietly guess
    /// zero either by treating the arrival as a bought recruit.
    #[test]
    fn men_taken_from_an_unshown_source_do_not_dilute_the_takers_skills() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0. \
             Skills: lumberjack [LUMB] 3 (180).",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 1234\nTAKE FROM 999 5 HUMN\n",
        )
        .expect("the ruleset loads");

        let unit = only_unit(&response);
        assert_eq!(
            unit.unit.men, 15,
            "the item still arrives optimistically, per `ah-agbm`"
        );
        assert_eq!(
            unit.unit.skills,
            vec![lumberjack(180)],
            "arriving from an unshown source must not be assumed skill-less: {:?}",
            unit.unit.skills
        );
    }

    /// `rules/economy_recruiting`: "New recruits will not have any skills or items" - so a `BUY`
    /// of people has to reach the headcount and dilute the unit's skills exactly as a gift of men
    /// does, even though `BUY` never touches `Working::give` at all.
    #[test]
    fn bought_men_join_the_unit_and_bring_no_skills() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nBUY 5 HUMN\n",
        );
        let unit = only_unit(&response);

        assert_eq!(unit.unit.men, 15, "10 already there plus 5 bought");
        // (10 * 180 + 5 * 0) / 15 = 120, level 2.
        assert_eq!(
            unit.unit.skills,
            vec![lumberjack(120)],
            "{:?}",
            unit.unit.skills
        );
        assert_eq!(change(unit, "men").original, "10");
    }

    #[test]
    fn the_skills_merge_weighs_by_the_receivers_headcount_before_the_men_arrive() {
        // Giver: 3 men at (30). Receiver: 7 men with no skill at all.
        // Correct: (7 * 0 + 3 * 30) / (7 + 3) = 9. Weighing by the receiver's headcount AFTER the
        // 3 men already arrived - the bug this test guards against - gives
        // (10 * 0 + 3 * 30) / (10 + 3) = 6 instead: a different, wrong, number.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Teachers (1234), Foo (1), 3 humans [HUMN]. Weight: 30. Capacity: 0/0/45/0. Skills: lumberjack [LUMB] 1 (30).",
            "* Students (2200), Foo (1), 7 humans [HUMN]. Weight: 70. Capacity: 0/0/105/0.",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 1234\nGIVE 2200 3 HUMN\n",
        )
        .expect("the ruleset loads");

        let region = &response.regions[0];
        let receiver = region
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "2200")
            .expect("the receiver changed");

        assert_eq!(receiver.unit.skills, vec![lumberjack(9)]);
    }

    fn skill(tag: &str, points: u32) -> Skill {
        Skill {
            name: tag.to_lowercase(),
            tag: tag.to_string(),
            level: level_for_points(points),
            points,
        }
    }

    /// `lumberjack [LUMB] n (points)`, as a real report line parses it - `name` is the spelled-out
    /// word, not the tag lower-cased, which matters when a test's expected `Skill` is compared
    /// against one actually read from report text.
    fn lumberjack(points: u32) -> Skill {
        Skill {
            name: "lumberjack".to_string(),
            tag: "LUMB".to_string(),
            level: level_for_points(points),
            points,
        }
    }

    #[test]
    fn men_arriving_at_an_empty_unit_keep_their_level() {
        let merged = merge_skills(&[], 0, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 30)]);
    }

    /// `semantics.rs`'s checks read this through its full crate path, so it must be `pub(crate)`
    /// rather than private to this module — ah-z73s.2.
    #[test]
    fn merge_skills_is_reachable_from_the_checks() {
        let merged = crate::orders::effects::merge_skills(&[], 0, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 30)]);
        assert_eq!(merged[0].level, 1);
    }

    #[test]
    fn arriving_men_who_know_less_lower_the_level() {
        let merged = merge_skills(&[skill("LUMB", 180)], 5, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 105)]);
        assert_eq!(merged[0].level, 2);
    }

    #[test]
    fn a_skill_only_the_arrivals_have_is_diluted_across_everyone() {
        let merged = merge_skills(&[], 25, &[skill("LUMB", 30)], 5);

        assert_eq!(merged, vec![skill("LUMB", 5)]);
        assert_eq!(merged[0].level, 0);
    }

    #[test]
    fn a_skill_worth_no_points_after_the_merge_is_dropped() {
        let merged = merge_skills(&[], 999, &[skill("LUMB", 30)], 1);

        assert!(merged.is_empty(), "{:?}", merged);
    }

    #[test]
    fn the_result_is_ordered_by_tag() {
        let merged = merge_skills(
            &[skill("STEA", 30), skill("LUMB", 30)],
            5,
            &[skill("FORC", 30)],
            5,
        );

        assert_eq!(
            merged
                .iter()
                .map(|skill| skill.tag.clone())
                .collect::<Vec<_>>(),
            vec!["FORC", "LUMB", "STEA"]
        );
    }

    #[test]
    fn give_to_nobody_discards_and_give_new_reaches_the_formed_unit() {
        let discarded = preview("unit 900\nGIVE 0 1 SWOR\n");
        let giver = only_unit(&discarded);
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            2
        );

        let formed = preview("unit 900\nFORM 1\nEND\nGIVE NEW 1 3 SWOR\nGIVE NEW 1 1 LEAD\n");
        let recruit = formed.regions[0]
            .units
            .iter()
            .find(|unit| unit.formed)
            .expect("a formed unit");
        assert_eq!(
            recruit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount),
            3
        );
    }

    /// `7001` is another faction's unit standing in `6857`'s own hex. `rules/give` allows the gift
    /// once *their* faction has declared us Friendly, and the report carries only our declarations
    /// toward them - so the stone neither definitely leaves nor definitely stays, and the column
    /// keeps the report's count and admits the order instead (`ah-66yi`, which reversed
    /// `ah-vcp8.2`'s answer here).
    #[test]
    fn a_gift_to_a_visible_foreign_unit_leaves_the_goods_uncertain() {
        let response = two_hex_preview("unit 6857\nGIVE 7001 10 STON\n");
        let giver = row(&response, "1:2,2", "6857").expect("the giver's row is previewed");

        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount),
            Some(15),
            "the report's own count stands: nothing is known to have left"
        );
        assert_eq!(giver.uncounted, vec!["GIVE 7001 10 STON".to_string()]);
        assert!(
            row(&response, "1:2,2", "7001").is_none(),
            "no row of ours gains them either"
        );
    }

    /// The same target, and silver: `rules/give` exempts silver from the factional rule outright
    /// ("silver may be given to any unit, regardless of factional affiliation"), so a target we can
    /// see takes it definitely and nothing is admitted (`ah-66yi`).
    #[test]
    fn visible_foreign_silver_still_leaves_definitely() {
        let report = [
            "Foo (1) Report",
            "",
            "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
            "",
            "* Quartermaster (6857), Foo (1), leader [LEAD], 15 stone [STON], 20 silver [SILV], \
             unfinished Cog [COG] (needs 15), \
             Weight: 10. Capacity: 0/0/15/0.",
            "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(&report, "unit 6857\nGIVE 7001 20 SILV\n");
        let giver = only_unit(&response);

        assert!(
            !giver
                .unit
                .items
                .iter()
                .any(|item| item.tag == "SILV" && item.amount > 0),
            "the five silver left: {:?}",
            giver.unit.items
        );
        assert!(giver.uncounted.is_empty(), "{:?}", giver.uncounted);
    }

    /// A unit number the *whole report* never prints. `rules/give` lets a unit we cannot see
    /// receive a gift once its faction has declared us Friendly, so this may be a perfectly good
    /// order - the count stands and the order is admitted rather than silently doing nothing
    /// (`ah-66yi`).
    #[test]
    fn an_unshown_number_is_not_a_definite_missing_target() {
        let response = two_hex_preview("unit 6857\nGIVE 9999 10 STON\n");
        let giver = row(&response, "1:2,2", "6857").expect("the giver's row is previewed");

        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount),
            Some(15)
        );
        assert_eq!(giver.uncounted, vec!["GIVE 9999 10 STON".to_string()]);
    }

    /// The control that keeps the case above narrow: `5530` is a unit our own report shows, in the
    /// *other* hex. Gifts settle in phase 4 and nothing moves until phase 9
    /// (`rules/sequenceofevents`), so that target really is not here - today's definite no-op, and
    /// an unchanged row is dropped from the response entirely.
    #[test]
    fn a_gift_to_a_unit_the_report_shows_elsewhere_moves_nothing() {
        let response = two_hex_preview("unit 6857\nGIVE 5530 10 STON\n");

        assert!(row(&response, "1:2,2", "6857").is_none());
    }

    /// `ALL ITEMS` across the same visible foreign target: `rules/give` settles the silver and
    /// cannot settle the stone, so the known half moves and the rest keeps its count with the
    /// order admitted once (`ah-66yi`).
    #[test]
    fn a_mixed_gift_moves_the_silver_and_leaves_the_rest_uncertain() {
        let report = [
            "Foo (1) Report",
            "",
            "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
            "",
            "* Quartermaster (6857), Foo (1), leader [LEAD], 15 stone [STON], 20 silver [SILV]. \
             Weight: 10. Capacity: 0/0/15/0.",
            "- Stranger (7001), Bar (2), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(&report, "unit 6857\nGIVE 7001 ALL ITEMS\n");
        let giver = only_unit(&response);

        assert!(
            !giver
                .unit
                .items
                .iter()
                .any(|item| item.tag == "SILV" && item.amount > 0),
            "the silver is definite and goes: {:?}",
            giver.unit.items
        );
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount),
            Some(15),
            "the stone's permission is unresolved, so its count stands"
        );
        assert_eq!(
            giver.uncounted,
            vec!["GIVE 7001 ALL ITEMS".to_string()],
            "one order, one line in the hover, however many tags it named"
        );
    }

    #[test]
    fn give_beyond_the_hex_or_the_stock_changes_nothing_wrong() {
        // Unit 555 is nowhere in the report at all, so `rules/give` may or may not let the sword
        // through - the count stands and the order is admitted rather than vanishing (`ah-66yi`).
        let missing = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report(),
            "[]",
            "unit 900\nGIVE 555 1 SWOR\n",
        )
        .expect("the ruleset loads");
        let giver = only_unit(&missing);
        assert_eq!(
            giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map(|item| item.amount),
            Some(3)
        );
        assert_eq!(giver.uncounted, vec!["GIVE 555 1 SWOR".to_string()]);

        // Giving more than the unit holds empties the stock rather than going negative.
        let drained = preview("unit 900\nGIVE 901 99 SWOR\n");
        let giver = drained.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "900")
            .expect("the giver changed");
        assert!(
            !giver.unit.items.iter().any(|item| item.tag == "SWOR"),
            "an emptied stock disappears from the list"
        );
    }

    #[test]
    fn a_move_order_departs_here_and_arrives_there() {
        let response = preview("unit 900\nMOVE SE\n");

        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        let destination = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:2,2")
            .expect("the destination changed");

        let departing = &origin.units[0];
        assert_eq!(departing.status, UnitPreviewStatus::Departing);
        assert_eq!(departing.departing_to.as_deref(), Some("1:2,2"));

        let arriving = &destination.units[0];
        assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
        assert_eq!(arriving.arriving_from.as_deref(), Some("1:1,1"));
        assert_eq!(arriving.unit.unit_id, "900");
        assert_eq!(arriving.unit.region_id, "1:2,2");
    }

    #[test]
    fn a_sail_order_departs_here_and_arrives_there() {
        // SAIL is a movement word like MOVE and ADVANCE; the preview reads it from the one list
        // rather than spelling the words itself, so it cannot fall out of step with the trace
        // again (ah-p1p).
        let response = preview("unit 900\nSAIL SE\n");

        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        let destination = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:2,2")
            .expect("the destination changed");

        let departing = &origin.units[0];
        assert_eq!(departing.status, UnitPreviewStatus::Departing);
        assert_eq!(departing.departing_to.as_deref(), Some("1:2,2"));

        let arriving = &destination.units[0];
        assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
        assert_eq!(arriving.arriving_from.as_deref(), Some("1:1,1"));
        assert_eq!(arriving.unit.unit_id, "900");
        assert_eq!(arriving.unit.region_id, "1:2,2");
    }

    #[test]
    fn an_advance_order_still_departs() {
        // The word that already worked, kept working: the list replaced two hand-spelt words,
        // not one.
        let response = preview("unit 900\nADVANCE SE\n");
        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        assert_eq!(origin.units[0].status, UnitPreviewStatus::Departing);
    }

    #[test]
    fn a_sail_order_with_no_direction_changes_nothing() {
        // "SAIL" alone is a form of its own and parse_move refuses it - "an order that goes
        // nowhere is not one". So move_steps stays unset, the unit is Present with no changes,
        // and no region is entered into the response at all.
        let response = preview("unit 900\nSAIL\n");
        assert!(
            response.regions.is_empty(),
            "regions were: {:?}",
            response.regions
        );
    }

    #[test]
    fn the_arriving_row_carries_the_other_changes_but_not_the_structure() {
        let response = preview("unit 900\nNAME UNIT \"Wanderer\"\nENTER 4\nMOVE SE\n");

        let arriving = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:2,2")
            .expect("the destination changed")
            .units
            .first()
            .expect("an arriving unit");
        assert_eq!(arriving.unit.name, "Wanderer");
        assert_eq!(
            arriving.unit.structure_id, None,
            "structures do not travel with a walker"
        );
    }

    #[test]
    fn a_unit_whose_speed_is_unknown_departs_to_nowhere_nameable() {
        // No Capacity section, so the report never said how it travels: the trace cannot split
        // months and the destination cannot be named.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Mystery (900), Foo (1), leader [LEAD].",
            "",
        ]
        .join("\n");
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &report,
            "[]",
            "unit 900\nMOVE SE\n",
        )
        .expect("the ruleset loads");

        let unit = only_unit(&response);
        assert_eq!(unit.status, UnitPreviewStatus::Departing);
        assert_eq!(unit.departing_to, None);
        assert!(
            !response
                .regions
                .iter()
                .any(|region| region.region_id == "1:2,2"),
            "an unknowable arrival is not drawn"
        );
    }

    #[test]
    fn a_round_trip_is_not_a_departure() {
        let response = preview("unit 900\nMOVE SE NW\n");
        assert!(
            response.regions.is_empty(),
            "back where it started, nothing to say: {:?}",
            response.regions
        );
    }

    #[test]
    fn the_last_movement_order_wins() {
        // The game executes the later MOVE, exactly as the map trace draws it.
        let response = preview("unit 900\nMOVE N\nMOVE SE\n");
        let origin = response
            .regions
            .iter()
            .find(|region| region.region_id == "1:1,1")
            .expect("the origin changed");
        assert_eq!(origin.units[0].departing_to.as_deref(), Some("1:2,2"));
    }

    /// Two sea hexes, and in the first a named, priceable hull with two own units aboard, a
    /// second hull with a third, and a fourth unit standing outside any structure. Everything a
    /// sail trace needs is stated - `Load`, `Sailors` and `MaxSpeed` - because an unpriceable
    /// fleet is traced as a walker instead, which is a different test.
    fn fleet_report(first_hull: &str) -> String {
        let mut text = String::from("Foo (1) Report\n\n");
        text.push_str("ocean (1,1) in Sea.\n\n");
        text.push_str("Exits:\n  Southeast : ocean (2,2) in Sea.\n\n");
        text.push_str("* Ashore (903), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n");
        text.push_str(&format!("+ {first_hull}\n"));
        text.push_str(
            "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
        );
        text.push_str(
            "  * Passengers (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
             Capacity: 0/70/70/0.\n",
        );
        text.push_str("+ Seagull [330] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
        text.push_str(
            "  * Idlers (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n",
        );
        text.push_str("\nocean (2,2) in Sea.\n\n");
        text.push_str("Exits:\n  Northwest : ocean (1,1) in Sea.\n");
        text
    }

    /// The hull the passengers ride in: named, so the marker can name it, and priceable, so the
    /// trace calls the mode Sail.
    const WAVECREST: &str = "Wavecrest [329] : Longship; Load: 110/150; Sailors: 4/4; MaxSpeed: 4.";

    fn fleet_preview(hull: &str, orders: &str) -> OrdersPreviewResponse {
        preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            &fleet_report(hull),
            "[]",
            orders,
        )
        .expect("the ruleset loads")
    }

    fn region_of<'a>(
        response: &'a OrdersPreviewResponse,
        region_id: &str,
    ) -> Option<&'a RegionPreview> {
        response
            .regions
            .iter()
            .find(|region| region.region_id == region_id)
    }

    fn row<'a>(
        response: &'a OrdersPreviewResponse,
        region_id: &str,
        unit_id: &str,
    ) -> Option<&'a UnitPreview> {
        region_of(response, region_id).and_then(|region| {
            region
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == unit_id)
        })
    }

    #[test]
    fn units_aboard_a_sailing_fleet_depart_with_it() {
        // The passenger wrote no order of its own; it goes where the ship goes, so the origin hex
        // must not keep men the fleet is taking away.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        for unit_id in ["900", "901"] {
            let departing =
                row(&response, "1:1,1", unit_id).unwrap_or_else(|| panic!("{unit_id} departs"));
            assert_eq!(departing.status, UnitPreviewStatus::Departing);
            assert_eq!(departing.departing_to.as_deref(), Some("1:2,2"));

            let arriving =
                row(&response, "1:2,2", unit_id).unwrap_or_else(|| panic!("{unit_id} arrives"));
            assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
            assert_eq!(arriving.arriving_from.as_deref(), Some("1:1,1"));
        }
    }

    #[test]
    fn a_carried_unit_names_the_fleet_that_takes_it() {
        // Name plus id, from the report's own structure: two hulls of one kind read alike, so the
        // name the player gave is the half worth showing.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let carried = row(&response, "1:1,1", "901").expect("the passenger departs");
        assert_eq!(carried.aboard.as_deref(), Some("Wavecrest [329]"));
    }

    #[test]
    fn the_unit_that_wrote_the_order_carries_no_aboard_marker() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let sailor = row(&response, "1:1,1", "900").expect("the sailing unit departs");
        assert_eq!(sailor.aboard, None, "it wrote the order; it is not cargo");
    }

    #[test]
    fn an_arriving_row_carries_no_aboard_marker() {
        // An arrival says only where the unit came from.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let arrived = row(&response, "1:2,2", "901").expect("the passenger arrives");
        assert_eq!(arrived.aboard, None);
    }

    #[test]
    fn a_passengers_own_move_order_wins() {
        // Overwriting what the player deliberately typed was the rejected alternative.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\nunit 901\nMOVE NW\n");

        let passenger = row(&response, "1:1,1", "901").expect("the passenger departs");
        assert_eq!(passenger.status, UnitPreviewStatus::Departing);
        assert_eq!(passenger.aboard, None, "it goes under its own order");
        assert_ne!(
            passenger.departing_to.as_deref(),
            Some("1:2,2"),
            "its own destination, not the ship's"
        );
    }

    #[test]
    fn passengers_follow_an_untraceable_ship() {
        // `SAIL OUT` names no hex to enter, so the trace can price the fleet but cannot say where
        // the month ends: the passengers depart to nowhere nameable, and appear in no destination.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL OUT\n");

        let carried = row(&response, "1:1,1", "901").expect("the passenger departs");
        assert_eq!(carried.status, UnitPreviewStatus::Departing);
        assert_eq!(carried.departing_to, None);
        assert_eq!(carried.aboard.as_deref(), Some("Wavecrest [329]"));
        assert!(
            region_of(&response, "1:2,2").is_none(),
            "an unknowable arrival is not drawn"
        );
    }

    #[test]
    fn a_unit_ashore_is_not_carried() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        assert!(
            row(&response, "1:1,1", "903").is_none() && row(&response, "1:2,2", "903").is_none(),
            "a unit outside the hull is untouched, so it is not in the answer at all"
        );
    }

    #[test]
    fn a_unit_in_a_different_structure_is_not_carried() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        assert!(
            row(&response, "1:1,1", "902").is_none() && row(&response, "1:2,2", "902").is_none(),
            "the other hull is not sailing"
        );
    }

    #[test]
    fn a_unit_aboard_a_fleet_that_walks_is_not_carried() {
        // An unknown hull cannot be priced, so the trace falls back to the ordering unit's own
        // land mobility: no Sail, nobody carried.
        let response = fleet_preview("Dinghy [329] : Skiff.", "unit 900\nSAIL SE\n");

        let passenger = row(&response, "1:1,1", "901");
        assert!(
            passenger.is_none(),
            "the passenger is untouched: {passenger:?}"
        );
    }

    #[test]
    fn a_sailing_fleet_arrives_with_its_hull() {
        // The hull is what is moving, so the unit that wrote the order is still standing in it
        // when it gets there: the destination's `in` column reads the ship, not a dash.
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let arrived = row(&response, "1:2,2", "900").expect("the sailing unit arrives");
        assert_eq!(arrived.unit.structure_id.as_deref(), Some("329"));
    }

    #[test]
    fn everyone_aboard_arrives_still_aboard() {
        let response = fleet_preview(WAVECREST, "unit 900\nSAIL SE\n");

        let arrived = row(&response, "1:2,2", "901").expect("the passenger arrives");
        assert_eq!(arrived.unit.structure_id.as_deref(), Some("329"));
    }

    #[test]
    fn a_walker_leaving_a_fort_arrives_outside_it() {
        // A building never travels, so a unit standing in one arrives ashore.
        let response = preview("unit 901\nENTER 5\nMOVE SE\n");

        let arrived = row(&response, "1:2,2", "901").expect("the walker arrives");
        assert_eq!(arrived.unit.structure_id, None);
    }

    #[test]
    fn a_unit_that_left_the_ship_before_moving_arrives_outside() {
        // `LEAVE` runs before movement is resolved, so there is no hull to carry.
        let response = fleet_preview(WAVECREST, "unit 900\nLEAVE\nSAIL SE\n");

        for region_id in ["1:1,1", "1:2,2"] {
            if let Some(unit) = row(&response, region_id, "900") {
                assert_eq!(
                    unit.unit.structure_id, None,
                    "it left the hull before moving ({region_id})"
                );
            }
        }
    }

    /// Every order this module applies must be one the grammar recognises, so the two cannot
    /// drift apart: an order the validator rejects must never silently change the preview.
    #[test]
    fn every_effect_order_is_in_the_grammar() {
        // The movement words are derived from the one list, so a fourth one can never be
        // forgotten here.
        for keyword in [
            "name",
            "guard",
            "avoid",
            "behind",
            "enter",
            "leave",
            "form",
            "give",
            "turn",
            "endturn",
            "transport",
            "distribute",
        ]
        .iter()
        .copied()
        .chain(
            crate::movement::orders::MOVEMENT_ORDER_COMMANDS
                .iter()
                .copied(),
        ) {
            assert!(
                crate::orders::grammar::find_order(keyword).is_some(),
                "{keyword} is not in the grammar"
            );
        }
    }

    /// `ah-agbm`. The seam onto `semantics::item_effects`, and what the preview does with it:
    /// `BUY`, `SELL`, `WITHDRAW` and `TAKE` reach `unit.items` exactly as `GIVE` already does, and
    /// the two new fields cross the boundary.
    mod item_effects {
        use super::*;

        #[test]
        fn a_bought_item_reaches_the_previewed_unit() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY 5 horse\n");
            let unit = only_unit(&response);

            let bought = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HORS")
                .expect("the bought horses are in the previewed list");
            assert_eq!(bought.amount, 5);
            change(unit, "items");
        }

        /// `ah-rgkk.3.1`, increment 4. The preview says *why* each item moved, not merely what the
        /// unit ends up holding.
        #[test]
        fn a_bought_item_reaches_the_preview_with_its_cause() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY 5 horse\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.item_changes,
                vec![ItemChange {
                    tag: "HORS".to_string(),
                    name: "horse".to_string(),
                    delta: 5,
                    cause: ItemChangeCause::Bought,
                    line: Some(2),
                    unit_price: Some(10),
                    other: None,
                    is_man: false,
                }]
            );
        }

        /// `ah-rgkk.4.1`, increment 1. A race is people, and the ledger site must ask the ruleset
        /// rather than guess: `rules/give` lists `MAN or MEN` among the item classes a GIVE
        /// accepts, and `data/HUMN` is an item entry like any other.
        #[test]
        fn a_bought_race_reaches_the_preview_marked_as_people() {
            let response = preview_over(
                &report_with_market_selling_people(),
                "unit 900\nBUY 5 HUMN\n",
            );
            let unit = only_unit(&response);

            let change = unit
                .item_changes
                .iter()
                .find(|change| change.tag == "HUMN")
                .expect("the bought race reaches the preview");
            assert!(change.is_man, "{change:?}");
        }

        /// `ah-rgkk.4.1`, increment 1. The pair is the discriminator: a mount is not people, so an
        /// implementation that hardcodes the field fails one of the two. `data/horse` is a mount.
        #[test]
        fn a_bought_mount_is_not_marked_as_people() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY 5 horse\n");
            let unit = only_unit(&response);

            let change = unit
                .item_changes
                .iter()
                .find(|change| change.tag == "HORS")
                .expect("the bought mount reaches the preview");
            assert!(!change.is_man, "{change:?}");
        }

        /// `ah-rgkk.4.1`, increment 2. `Working::apply_transfers` is a different method from the
        /// ledger's, so men *leaving* a unit need their own test. `GIVE 0` discards, which needs
        /// no second unit and no visibility rule (`rules/give`: "If 0 is specified as the unit
        /// number, then the items are discarded").
        #[test]
        fn a_race_given_away_is_marked_as_people() {
            let response = preview_over(
                &report_with_market_selling_people(),
                "unit 900\nGIVE 0 5 HUMN\n",
            );
            let unit = only_unit(&response);

            let change = unit
                .item_changes
                .iter()
                .find(|change| change.tag == "HUMN")
                .expect("the discarded race reaches the preview");
            assert_eq!(change.delta, -5, "{change:?}");
            assert!(change.is_man, "{change:?}");
        }

        /// `ah-rgkk.3.1`, increment 4. A month that nets to nothing still has something to say:
        /// the row must survive so the popup can explain why the stock is unchanged.
        #[test]
        fn a_unit_that_buys_and_sells_the_same_goods_keeps_its_row() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nSELL 5 fur\nWITHDRAW 5 FUR\n",
            );
            let unit = only_unit(&response);

            assert_eq!(
                unit.item_changes
                    .iter()
                    .map(|change| change.cause)
                    .collect::<Vec<_>>(),
                vec![ItemChangeCause::Sold, ItemChangeCause::Withdrawn],
                "{:?}",
                unit.item_changes
            );
        }

        /// `ah-rgkk.3.1`. A cast is charged its materials at the ceiling whether or not the mage
        /// holds them (`ah-ofpb.5`), so a mage holding none records a change that takes nothing
        /// away. A row whose every change is one of those has nothing to show.
        #[test]
        fn a_cast_charged_for_materials_the_mage_has_not_got_earns_no_row() {
            let empty_handed = [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "* Enchanter (900), Foo (1), behind, leader [LEAD]. Weight: 10. \
                 Capacity: 0/0/15/0. Skills: enchant swords [ESWO] 3 (270).",
                "",
            ]
            .join("\n");
            let response = preview_over(&empty_handed, "unit 900\nCAST Enchant_Swords\n");

            assert!(
                !response
                    .regions
                    .iter()
                    .flat_map(|region| region.units.iter())
                    .any(|unit| unit.unit.unit_id == "900"),
                "nothing moved, so nothing is previewed: {:?}",
                response.regions
            );

            // The control: the same cast by a mage who does hold the swords is previewed, and its
            // materials are among the changes.
            let response = preview_over(&report_with_a_mage(), "unit 900\nCAST Enchant_Swords\n");
            let unit = only_unit(&response);
            assert!(
                unit.item_changes.iter().any(
                    |change| change.cause == ItemChangeCause::CastSpent && change.tag == "SWOR"
                ),
                "{:?}",
                unit.item_changes
            );
        }

        /// Q4's rule, via the existing `take_item`.
        #[test]
        fn a_sold_out_stock_disappears_from_the_previewed_list() {
            let response = preview_over(&report_with_market(), "unit 900\nSELL ALL FUR\n");
            let unit = only_unit(&response);

            assert!(
                !unit.unit.items.iter().any(|item| item.tag == "FUR"),
                "an emptied stock must not be shown, even as zero: {:?}",
                unit.unit.items
            );
            change(unit, "items");
        }

        /// A unit ordered `sell 8 FUR` and then `give 901 5 FUR` out of a stock of 10 is
        /// overdrawn: the ledger's `SELL` movement is computed against the report's original 10,
        /// but the `GIVE` has already taken 5 off the previewed list by the time it applies. The
        /// column must not render `-3 FUR`.
        #[test]
        fn an_overdrawn_stock_is_never_negative() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nSELL 8 FUR\nGIVE 901 5 FUR\n",
            );
            let giver = response.regions[0]
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == "900")
                .expect("the giver changed");

            assert!(
                !giver.unit.items.iter().any(|item| item.tag == "FUR"),
                "an overdrawn stock must be dropped, not shown negative: {:?}",
                giver.unit.items
            );
        }

        /// The guard on double-application: `GIVE` records no movement in the ledger, so a unit
        /// ordered to give 2 swords loses exactly 2, not 4.
        #[test]
        fn a_gift_is_still_applied_exactly_once() {
            let response = preview("unit 900\nGIVE 901 2 SWOR\n");
            let giver = response.regions[0]
                .units
                .iter()
                .find(|unit| unit.unit.unit_id == "900")
                .expect("the giver changed");

            let swords = giver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .map_or(0, |item| item.amount);
            assert_eq!(swords, 1, "3 swords less 2 given, not less 4");
        }

        // `report_with_market()`'s hex sells horses, so a `BUY ALL` of them is settled rather
        // than uncounted since `ah-jown` - these two now name a good the market does not carry
        // (`SWOR`, not on its `For Sale` line) to stay examples of an order that really cannot
        // be counted at all.
        #[test]
        fn an_uncounted_order_reaches_the_preview_verbatim() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nbuy all SWOR ; testing\nSELL 1 FUR\n",
            );
            let unit = only_unit(&response);

            assert_eq!(unit.uncounted, vec!["buy all SWOR".to_string()]);
        }

        /// The navigator's S1 state: a unit whose only order cannot be counted still reaches the
        /// response, with `changes` empty and `uncounted` naming the order - the filter at the
        /// bottom of `preview_orders_on_map` gains `&& uncounted.is_empty()` for exactly this.
        #[test]
        fn a_unit_whose_only_order_cannot_be_counted_is_still_sent() {
            let response = preview_over(&report_with_market(), "unit 900\nBUY ALL SWOR\n");
            let unit = only_unit(&response);

            assert!(unit.changes.is_empty(), "{:?}", unit.changes);
            assert_eq!(unit.uncounted, vec!["BUY ALL SWOR".to_string()]);
        }

        #[test]
        fn a_take_from_a_unit_not_shown_here_names_its_source() {
            let response = preview_over(&report_with_market(), "unit 901\nTAKE FROM 999 5 GRAI\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.taken_unshown,
                vec![TakenUnshown {
                    amount: 5,
                    tag: "GRAI".to_string(),
                    from: "999".to_string(),
                }]
            );
        }

        #[test]
        fn a_take_from_a_visible_foreign_unit_changes_no_previewed_items() {
            let response = two_hex_preview("unit 6857\nTAKE FROM 7001 1 LEAD\n");
            assert!(
                response.regions.is_empty(),
                "a refused TAKE must not create an item preview: {response:?}"
            );
        }

        #[test]
        fn a_produced_item_reaches_the_previewed_unit() {
            let response = preview_over(&report_with_a_smith(), "unit 900\nPRODUCE sword\n");
            let unit = only_unit(&response);

            let swords = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "SWOR")
                .expect("the produced swords are in the previewed list");
            assert_eq!(swords.amount, 8);
            let iron = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "IRON")
                .expect("the remaining iron is in the previewed list");
            assert_eq!(iron.amount, 12);
            change(unit, "items");
        }

        /// `ah-agbm`'s Q4 rule, through the existing `take_item`: a stock a `PRODUCE` consumes
        /// entirely disappears rather than showing zero.
        #[test]
        fn a_consumed_stock_that_empties_disappears_from_the_previewed_list() {
            let hex_region = [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 8 iron [IRON]. Weight: 180. \
                 Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
                "",
            ]
            .join("\n");
            let response = preview_over(&hex_region, "unit 900\nPRODUCE sword\n");
            let unit = only_unit(&response);

            assert!(
                !unit.unit.items.iter().any(|item| item.tag == "IRON"),
                "an emptied stock must not be shown, even as zero: {:?}",
                unit.unit.items
            );
        }

        #[test]
        fn a_produced_item_is_named_on_the_preview() {
            let response = preview_over(&report_with_a_smith(), "unit 900\nPRODUCE sword\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.produced,
                vec![ProducedItem {
                    amount: 8,
                    tag: "SWOR".to_string(),
                }]
            );
        }

        /// A hex whose one own unit stands in an unfinished Stockade, for the `BUILD` cases
        /// (`ah-ofpb.2`).
        ///
        /// The men must be the *first* item on the line: `count_men` reads the headcount off
        /// `items.first()`, which is the report's own convention.
        fn report_with_a_builder() -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "+ Building [4] : Stockade, needs 45.",
                "  * Builders (900), Foo (1), behind, 10 humans [HUMN], 120 wood [WOOD]. Weight: \
                 1300. Capacity: 0/0/120/0. Skills: building [BUIL] 3 (250).",
                "",
            ]
            .join("\n")
        }

        #[test]
        fn a_built_material_leaves_the_previewed_unit() {
            let response = preview_over(&report_with_a_builder(), "unit 900\nBUILD\n");
            let unit = only_unit(&response);

            let wood = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "WOOD")
                .expect("the remaining wood is in the previewed list");
            assert_eq!(wood.amount, 90);
            change(unit, "items");
        }

        /// A hex that `SHARE`s settles a BUILD's material as one pool, and the goods leave the
        /// rows that actually held them - so no projected inventory still shows stock the month
        /// has already consumed (`ah-728m.2.2`, `docs/ui/ah-728m.2.2-attribution.html`).
        fn a_sharing_hex_with_a_builder(first: i64, second: i64) -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "+ Building [4] : Stockade, needs 45.",
                "  * Builders (900), Foo (1), behind, 10 humans [HUMN], 5 wood [WOOD]. \
                 Weight: 1050. Capacity: 0/0/120/0. Skills: building [BUIL] 3 (250).",
                "",
                &format!(
                    "* Stores (901), Foo (1), sharing, 1 humans [HUMN], {first} wood [WOOD]. \
                     Weight: 10. Capacity: 0/0/15/0. Skills: none."
                ),
                &format!(
                    "* Reserve (902), Foo (1), sharing, 1 humans [HUMN], {second} wood [WOOD]. \
                     Weight: 10. Capacity: 0/0/15/0. Skills: none."
                ),
                "",
            ]
            .join("\n")
        }

        fn wood_of(response: &OrdersPreviewResponse, unit_id: &str) -> i64 {
            response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == unit_id)
                .map_or(0, |unit| {
                    unit.unit
                        .items
                        .iter()
                        .find(|item| item.tag == "WOOD")
                        .map_or(0, |item| item.amount)
                })
        }

        #[test]
        fn shared_build_material_leaves_the_supplying_rows() {
            let response = preview_over(&a_sharing_hex_with_a_builder(20, 25), "unit 900\nBUILD\n");

            assert_eq!(
                wood_of(&response, "900"),
                0,
                "the builder spends its own five before borrowing anything"
            );
            assert_eq!(
                wood_of(&response, "901"),
                0,
                "the higher supplying row is emptied next"
            );
            assert_eq!(
                wood_of(&response, "902"),
                20,
                "the last row gives only the exact remainder of the thirty"
            );
            let builder = response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == "900")
                .expect("the builder is previewed");
            assert_eq!(
                builder.built.iter().map(|spend| spend.amount).sum::<i64>(),
                30,
                "the work itself stays on the unit that ordered it"
            );
            assert_eq!(
                wood_of(&response, "900")
                    + wood_of(&response, "901")
                    + wood_of(&response, "902")
                    + 30,
                50,
                "nothing is created or lost: what is left plus what was spent is what was held"
            );
        }

        #[test]
        fn shared_production_material_leaves_the_supplying_rows() {
            let report = [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "* Carpenters (900), Foo (1), 15 humans [HUMN], 3 wood [WOOD]. Weight: 1530. \
                 Capacity: 0/0/225/0. Skills: carpenter [CARP] 1 (30).",
                "* Stores (901), Foo (1), sharing, 1 humans [HUMN], 10 wood [WOOD]. Weight: 110. \
                 Capacity: 0/0/15/0. Skills: none.",
                "* Reserve (902), Foo (1), sharing, 1 humans [HUMN], 10 wood [WOOD]. Weight: 110. \
                 Capacity: 0/0/15/0. Skills: none.",
                "",
            ]
            .join("\n");
            let response = preview_over(&report, "unit 900\nPRODUCE wagon\n");

            assert_eq!(wood_of(&response, "900"), 0, "its own three go first");
            assert_eq!(wood_of(&response, "901"), 0, "then the higher sharing row");
            assert_eq!(
                wood_of(&response, "902"),
                8,
                "the last row gives only the two the run still needed"
            );
            let maker = response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == "900")
                .expect("the producer is previewed");
            assert_eq!(
                maker
                    .unit
                    .items
                    .iter()
                    .find(|item| item.tag == "WAGO")
                    .map(|item| item.amount),
                Some(15),
                "what was made stays on the unit that made it"
            );
        }

        #[test]
        fn a_material_spent_to_nothing_disappears_from_the_previewed_list() {
            let hex_region = [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "+ Building [4] : Stockade, needs 45.",
                "  * Builders (900), Foo (1), behind, 10 humans [HUMN], 30 wood [WOOD]. Weight: \
                 1300. Capacity: 0/0/120/0. Skills: building [BUIL] 3 (250).",
                "",
            ]
            .join("\n");
            let response = preview_over(&hex_region, "unit 900\nBUILD\n");
            let unit = only_unit(&response);

            assert!(
                !unit.unit.items.iter().any(|item| item.tag == "WOOD"),
                "an emptied stock must not be shown, even as zero: {:?}",
                unit.unit.items
            );
        }

        #[test]
        fn a_build_is_named_on_the_preview() {
            let response = preview_over(&report_with_a_builder(), "unit 900\nBUILD\n");
            let unit = only_unit(&response);

            assert_eq!(
                unit.built,
                vec![BuildSpend {
                    amount: 30,
                    tag: "WOOD".to_string(),
                    name: "wood".to_string(),
                    place: "Building 4".to_string(),
                    founding: false,
                    helping: None,
                    could_do: 30,
                    capped_by: None,
                }]
            );
        }

        #[test]
        fn a_cast_creation_reaches_the_previewed_unit() {
            let response = preview_over(&report_with_a_mage(), "unit 900\nCAST Enchant_Swords\n");
            let unit = only_unit(&response);

            let swords = unit
                .unit
                .items
                .iter()
                .find(|item| item.tag == "MSWO")
                .expect("the enchanted mithril swords are in the previewed list");
            assert_eq!(
                swords.amount, 15,
                "unit.items carries the most, which is what the ledger charged for"
            );
            assert_eq!(
                unit.created,
                vec![CreatedItem {
                    fewest: 15,
                    most: 15,
                    tag: "MSWO".to_string(),
                    summoned: false,
                }]
            );
            change(unit, "items");
        }
    }

    /// The catalogue calls a leader "leader"; the report calls eight of them "leaders" and tags
    /// them `LEAD`. All three are legal spellings and only this one moved nothing (`ah-vcp8.1`).
    #[test]
    fn a_gift_written_with_the_catalogues_own_name_empties_the_unit() {
        let response = preview_over(&report_with_leaders(), "unit 900\nGIVE 901 ALL LEADER\n");
        let giver = row(&response, "1:1,1", "900").expect("the giver's row is previewed");

        assert_eq!(giver.unit.men, 0, "every leader left this unit");
    }

    /// `ah-qct4`. `rules/sequenceofevents` settles "Give orders. GIVE and TAKE orders are
    /// processed." nine phases before "Primary PRODUCE orders ... are processed", so the men who
    /// work this month and the materials they work with are the ones the month's gifts leave
    /// behind - not the ones the report printed.
    mod production_after_a_gift {
        use super::*;

        fn preview_gift(orders: &str) -> OrdersPreviewResponse {
            preview_over(
                &report_with_a_smith_and_a_neighbour(),
                &format!("unit 900\n{orders}\n"),
            )
        }

        fn giver(response: &OrdersPreviewResponse) -> &UnitPreview {
            row(response, "1:1,1", "900").expect("the giver's row is previewed")
        }

        fn held(unit: &UnitPreview, tag: &str) -> i64 {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map_or(0, |item| item.amount)
        }

        /// The report prints `8 orcs [ORC]`, so `ALL ORCS` is the first thing anyone would type -
        /// and until `item_spellings` folded case it resolved to nothing at all.
        #[test]
        fn an_upper_case_plural_gift_of_men_empties_the_unit() {
            let response = preview_gift("GIVE 901 ALL ORCS");
            let giver = giver(&response);

            assert_eq!(giver.unit.men, 0, "every orc left this unit");
            assert_eq!(held(giver, "ORC"), 0, "no orcs remain in the item list");
        }

        /// `rules/tableiteminfo` pays production in man-months - "The higher the skill of the unit,
        /// the more productive each man-month of work will be" - so a unit with no men left at
        /// PRODUCE time makes nothing, and its materials stay where they are.
        #[test]
        fn a_unit_that_gives_its_men_away_produces_nothing() {
            let response = preview_gift("GIVE 901 ALL MEN\nPRODUCE sword");
            let giver = giver(&response);

            assert!(
                giver.produced.is_empty(),
                "no men, no production: {:?}",
                giver.produced
            );
            assert_eq!(held(giver, "SWOR"), 0, "no phantom swords in the item list");
            assert_eq!(held(giver, "IRON"), 20, "the iron was never spent");
        }

        /// Half the men leave, so half the month's work does.
        #[test]
        fn a_unit_that_gives_half_its_men_away_produces_half() {
            let response = preview_gift("GIVE 901 4 ORC\nPRODUCE sword");

            assert_eq!(
                giver(&response).produced,
                vec![ProducedItem {
                    amount: 4,
                    tag: "SWOR".to_string(),
                }]
            );
        }

        /// `rules/tableiteminfo`: "Producing items will always produce as many items as during a
        /// month up to the limit of the supplies carried by the producing unit" - and a unit that
        /// gave its supplies away in the Give phase carries none.
        #[test]
        fn a_unit_that_gives_its_materials_away_produces_nothing() {
            let response = preview_gift("GIVE 901 ALL IRON\nPRODUCE sword");
            let giver = giver(&response);

            assert!(
                giver.produced.is_empty(),
                "no iron, no swords: {:?}",
                giver.produced
            );
            assert_eq!(giver.unit.men, 8, "the men are all still here");
        }

        /// Fifteen of the twenty iron leave, so five swords are all the month can make.
        #[test]
        fn a_unit_that_gives_some_materials_away_produces_what_is_left() {
            let response = preview_gift("GIVE 901 15 IRON\nPRODUCE sword");

            assert_eq!(
                giver(&response).produced,
                vec![ProducedItem {
                    amount: 5,
                    tag: "SWOR".to_string(),
                }]
            );
        }

        /// The regression that must not move: giving away the *goods* changes nothing about the
        /// month's run, because the swords leave in the Give phase and the new ones are made in
        /// the last one.
        #[test]
        fn a_gift_of_the_goods_it_makes_leaves_this_months_production_behind() {
            let report = report_with_a_smith_and_a_neighbour().replace(
                "8 orcs [ORC], 20 iron [IRON]",
                "8 orcs [ORC], 20 iron [IRON], 5 swords [SWOR]",
            );
            let response = preview_over(&report, "unit 900\nGIVE 901 ALL SWOR\nPRODUCE sword\n");

            assert_eq!(
                held(giver(&response), "SWOR"),
                8,
                "the month's eight swords stay with the giver"
            );
            assert_eq!(
                held(
                    row(&response, "1:1,1", "901").expect("the receiver's row is previewed"),
                    "SWOR"
                ),
                5,
                "the five it already had are what the receiver gets"
            );
        }
    }

    /// `ah-bxgs`. `TRANSPORT`/`DISTRIBUTE` moves goods between units that need not share a hex,
    /// routed through quartermasters, resolved after everything else `rules/sequenceofevents`
    /// runs first.
    mod transport {
        use super::*;

        fn sender_row(response: &OrdersPreviewResponse) -> &UnitPreview {
            row(response, "1:1,1", "5530").expect("the sender's row is previewed")
        }

        fn receiver_row(response: &OrdersPreviewResponse) -> Option<&UnitPreview> {
            row(response, "1:2,2", "6857")
        }

        #[test]
        fn a_transport_moves_goods_across_hexes() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\n");

            let sender = sender_row(&response);
            let sent_stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(sent_stone, Some(10), "40 held, 30 sent, 10 left");
            assert!(sender.changes.iter().any(|change| change.field == "items"));

            let receiver = receiver_row(&response).expect("the receiver is previewed");
            let held_stone = receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(held_stone, Some(45), "15 held, 30 arrived");
            assert!(receiver
                .changes
                .iter()
                .any(|change| change.field == "items"));
        }

        /// `ah-rgkk.3.1`, increment 5. A transport is an item change on both ends, and it is the
        /// month's last item phase (`rules/sequenceofevents`), so it comes last.
        #[test]
        fn a_transport_reaches_both_units_as_an_item_change() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\n");

            let sender = sender_row(&response);
            let sent = sender
                .item_changes
                .iter()
                .find(|change| change.tag == "STON")
                .expect("the sender records what left");
            assert_eq!(sent.cause, ItemChangeCause::TransportedOut);
            assert_eq!(sent.delta, -30);
            assert_eq!(
                sent.other.as_ref().map(|other| other.unit_id.as_str()),
                Some("6857")
            );

            let receiver = receiver_row(&response).expect("the receiver is previewed");
            let arrived = receiver
                .item_changes
                .iter()
                .find(|change| change.tag == "STON")
                .expect("the receiver records what arrived");
            assert_eq!(arrived.cause, ItemChangeCause::TransportedIn);
            assert_eq!(arrived.delta, 30);
            assert_eq!(
                arrived.other.as_ref().map(|other| other.unit_id.as_str()),
                Some("5530")
            );
        }

        /// `ah-rgkk.3.1`, increment 5. A refused line moves nothing, so it explains nothing here -
        /// `transport_sent` already speaks for it (`ah-64wm`).
        #[test]
        fn a_refused_transport_records_no_item_change() {
            let response = two_hex_preview("unit 6857\nTRANSPORT 5531 1 LEAD\n");

            let unit = row(&response, "1:2,2", "6857").expect("the refusal is still reported");
            assert!(unit.item_changes.is_empty(), "{:?}", unit.item_changes);
        }

        #[test]
        fn a_transport_within_one_hex_moves_goods_too() {
            // `5531` opens the Caravanserai in the sender's own hex, so this is a full transport
            // that never crosses an exit.
            let response = two_hex_preview("unit 5530\nTRANSPORT 5531 5 FUR\n");

            let sender = only_unit_by_id(&response, "5530");
            let fur = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "FUR")
                .map(|item| item.amount);
            assert_eq!(fur, None, "5 held, 5 sent");

            let receiver = only_unit_by_id(&response, "5531");
            let fur = receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "FUR")
                .map(|item| item.amount);
            assert_eq!(fur, Some(5), "0 held, 5 arrived, within the same hex");
        }

        #[test]
        fn distribute_is_transport_under_another_name() {
            let response = two_hex_preview("unit 5530\nDISTRIBUTE 6857 30 STON\n");

            let sender = sender_row(&response);
            let sent_stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(sent_stone, Some(10));

            let receiver = receiver_row(&response).expect("the receiver is previewed");
            let held_stone = receiver
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(held_stone, Some(45));
        }

        #[test]
        fn the_game_will_not_transport_a_mount_so_it_stays_put() {
            let response =
                two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\nTRANSPORT 6857 2 HORS\n");

            let sender = sender_row(&response);
            let horses = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "HORS")
                .map(|item| item.amount);
            assert_eq!(
                horses,
                Some(2),
                "the horses stay: the game will not carry them"
            );

            assert_eq!(
                sender.transport_sent,
                vec![
                    TransportSent {
                        amount: 30,
                        tag: "STON".to_string(),
                        to: "6857".to_string(),
                        to_unshown: false,
                        refused: false,
                        order_index: 0,
                    },
                    TransportSent {
                        amount: 0,
                        tag: "HORS".to_string(),
                        to: String::new(),
                        to_unshown: false,
                        refused: true,
                        order_index: 1,
                    },
                ]
            );
        }

        #[test]
        fn a_transport_of_men_moves_nothing_and_leaves_the_headcount_alone() {
            // `5531` is an eligible target, so nothing but the item class can refuse this.
            let response = two_hex_preview("unit 6857\nTRANSPORT 5531 1 LEAD\n");

            // The row is still previewed (the refusal itself is news), but nothing about the
            // unit's items or headcount changed - `can_be_transported` refuses every `MAN` tag,
            // so `apply_transports` never touches `unit.men`, `men_by_race` or `skills`.
            let unit = row(&response, "1:2,2", "6857").expect("the refusal is still reported");
            assert_eq!(unit.unit.men, 1);
            assert!(unit.changes.iter().all(|change| change.field != "items"));
            assert!(unit.changes.iter().all(|change| change.field != "men"));
            assert_eq!(
                unit.transport_sent,
                vec![TransportSent {
                    amount: 0,
                    tag: "LEAD".to_string(),
                    to: String::new(),
                    to_unshown: false,
                    refused: true,
                    order_index: 0,
                }]
            );
        }

        #[test]
        fn a_refusal_is_silent_when_the_unit_holds_none_of_it() {
            let response = two_hex_preview("unit 6857\nTRANSPORT 5530 2 HORS\n");

            // `6857` holds no horses: nothing to refuse, nothing to report, no row at all.
            assert!(row(&response, "1:2,2", "6857").is_none());
        }

        #[test]
        fn a_sale_takes_its_goods_before_a_transport_can() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\nSELL 40 STON\n");

            let sender = sender_row(&response);
            let stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(
                stone, None,
                "the sale took all 40 before transport could run"
            );
            assert!(
                sender.transport_sent.is_empty(),
                "transport had nothing left to send"
            );

            assert!(
                receiver_row(&response).is_none(),
                "the receiver gets nothing: the sale emptied the stock first"
            );
        }

        #[test]
        fn what_a_produce_makes_can_be_transported() {
            let response = preview_orders_for_remembered_report(
                &mut ReportCache::new(),
                RULESET,
                &report_with_a_smith_and_a_quartermaster(),
                "[]",
                "unit 900\nPRODUCE SWOR\nTRANSPORT 901 ALL SWOR\n",
            )
            .expect("the ruleset loads");

            let sender = only_unit_by_id(&response, "900");
            assert!(
                sender
                    .transport_sent
                    .iter()
                    .any(|sent| sent.tag == "SWOR" && sent.amount > 0),
                "what PRODUCE made this month is there to be sent"
            );
        }

        #[test]
        fn more_ordered_away_than_the_unit_holds_sends_what_is_there() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 90 STON\n");

            let sender = sender_row(&response);
            let stone = sender
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map(|item| item.amount);
            assert_eq!(stone, None, "all 40 emptied");
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 40,
                    tag: "STON".to_string(),
                    to: "6857".to_string(),
                    to_unshown: false,
                    refused: false,
                    order_index: 0,
                }]
            );
        }

        /// What the sender still holds of one tag, or `None` once its stock is gone.
        fn held(unit: &UnitPreview, tag: &str) -> Option<i64> {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map(|item| item.amount)
        }

        /// The sender's row after one order, asserted to have moved nothing at all.
        fn kept_everything(orders: &str) -> UnitPreview {
            let response = two_hex_preview(orders);
            let sender = sender_row(&response).clone();
            assert_eq!(held(&sender, "STON"), Some(40), "the stone stayed put");
            assert!(
                sender.transport_sent.is_empty(),
                "a refused target sends nothing"
            );
            sender
        }

        /// One target issue, for the tests whose order writes exactly one.
        fn only_issue(unit: &UnitPreview) -> &TransportTargetIssue {
            assert_eq!(
                unit.transport_target_issues.len(),
                1,
                "one target issue: {:?}",
                unit.transport_target_issues
            );
            &unit.transport_target_issues[0]
        }

        // `rules/transport`: "The target of the transport unit must be a unit with the
        // quartermaster skill". Our own report prints our own skills in full, so this is certain.
        #[test]
        fn an_own_target_without_the_quartermaster_skill_keeps_the_goods_here() {
            let response = two_hex_preview("unit 6857\nTRANSPORT 5530 5 STON\n");

            let sender = row(&response, "1:2,2", "6857").expect("the refusal is reported");
            assert_eq!(held(sender, "STON"), Some(15), "nothing left 6857");
            assert!(sender.transport_sent.is_empty());
            assert_eq!(
                only_issue(sender),
                &TransportTargetIssue {
                    to: "5530".to_string(),
                    amount: 5,
                    tag: "STON".to_string(),
                    reason: TransportTargetReason::NotQuartermaster,
                    order_index: 0,
                }
            );
            // The sender keeps them, so no row of ours gains them either.
            assert!(row(&response, "1:1,1", "5530").is_none());
        }

        // `rules/economy_transport`: "a quartermaster must be the owner of a structure which allows
        // transportation of items. The structures which allow this are: Caravanserai."
        #[test]
        fn an_own_quartermaster_owning_no_caravanserai_keeps_the_goods_here() {
            let sender = kept_everything("unit 5530\nTRANSPORT 5532 5 STON\n");

            assert_eq!(
                only_issue(&sender),
                &TransportTargetIssue {
                    to: "5532".to_string(),
                    amount: 5,
                    tag: "STON".to_string(),
                    reason: TransportTargetReason::NotCaravanseraiOwner,
                    order_index: 0,
                }
            );
        }

        // `rules/world_structures`: the owner "is the first unit listed under the object". `6858`
        // is a quartermaster standing in the Caravanserai `6857` opened, and owns nothing.
        #[test]
        fn a_quartermaster_listed_after_the_owner_owns_no_caravanserai() {
            let sender = kept_everything("unit 5530\nTRANSPORT 6858 5 STON\n");

            assert_eq!(
                only_issue(&sender).reason,
                TransportTargetReason::NotCaravanseraiOwner
            );
        }

        #[test]
        fn a_transport_to_a_unit_the_report_does_not_show_keeps_the_goods_here() {
            let sender = kept_everything("unit 5530\nTRANSPORT 99999 5 STON\n");

            assert_eq!(
                only_issue(&sender),
                &TransportTargetIssue {
                    to: "99999".to_string(),
                    amount: 5,
                    tag: "STON".to_string(),
                    reason: TransportTargetReason::EligibilityUnknown,
                    order_index: 0,
                }
            );
        }

        // `rules/com_attitudes` prints the attitudes we declare toward other factions, never
        // theirs toward us - and `rules/economy_transport` needs the target "at least FRIENDLY to
        // the unit which issues the order". Structurally eligible, and still unknowable.
        #[test]
        fn a_foreign_quartermaster_owning_a_caravanserai_is_unknowable() {
            let sender = kept_everything("unit 5530\nTRANSPORT 7003 5 STON\n");

            assert_eq!(
                only_issue(&sender),
                &TransportTargetIssue {
                    to: "7003".to_string(),
                    amount: 5,
                    tag: "STON".to_string(),
                    reason: TransportTargetReason::AcceptanceUnknown,
                    order_index: 0,
                }
            );
        }

        // A foreign unit's skills are never disclosed, so an empty list is missing evidence rather
        // than proof that the owner is no quartermaster.
        #[test]
        fn a_foreign_caravanserai_owner_with_undisclosed_skills_is_unknowable() {
            let sender = kept_everything("unit 5530\nTRANSPORT 7004 5 STON\n");

            assert_eq!(
                only_issue(&sender).reason,
                TransportTargetReason::EligibilityUnknown
            );
        }

        // The structure the report draws is evidence, though: a foreign unit standing in no
        // Caravanserai owns none, whatever its skills turn out to be.
        #[test]
        fn a_foreign_unit_owning_no_caravanserai_is_refused_outright() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 7001 5 STON\n");

            let sender = sender_row(&response);
            assert_eq!(held(sender, "STON"), Some(40));
            assert!(sender.transport_sent.is_empty());
            assert_eq!(
                only_issue(sender),
                &TransportTargetIssue {
                    to: "7001".to_string(),
                    amount: 5,
                    tag: "STON".to_string(),
                    reason: TransportTargetReason::NotCaravanseraiOwner,
                    order_index: 0,
                }
            );
            // No row of ours gains anything: 7001 is not our unit.
            assert!(row(&response, "1:2,2", "7001").is_none());
        }

        #[test]
        fn distribute_is_refused_by_a_target_exactly_as_transport_is() {
            let sender = kept_everything("unit 5530\nDISTRIBUTE 7001 5 STON\n");

            assert_eq!(
                only_issue(&sender),
                &TransportTargetIssue {
                    to: "7001".to_string(),
                    amount: 5,
                    tag: "STON".to_string(),
                    reason: TransportTargetReason::NotCaravanseraiOwner,
                    order_index: 0,
                }
            );
        }

        // The target gate is an order-level one and runs first, so an order that fails both tests
        // is explained by its target alone - and, having no claim to make about goods the game
        // would not have carried anyway, names none.
        #[test]
        fn a_refused_target_explains_an_order_that_also_names_an_untransportable_item() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 7001 2 HORS\n");

            let sender = sender_row(&response);
            assert_eq!(held(sender, "HORS"), Some(2));
            assert!(
                sender.transport_sent.is_empty(),
                "the target reason replaces the item refusal rather than joining it"
            );
            assert_eq!(
                only_issue(sender),
                &TransportTargetIssue {
                    to: "7001".to_string(),
                    amount: 0,
                    tag: String::new(),
                    reason: TransportTargetReason::NotCaravanseraiOwner,
                    order_index: 0,
                }
            );
        }

        #[test]
        fn a_refused_target_is_silent_when_the_sender_holds_none_of_it() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 99999 5 SWOR\n");

            // Nothing to retain and nothing to explain: 5530 holds no swords.
            assert!(row(&response, "1:1,1", "5530").is_none());
        }

        #[test]
        fn a_sent_order_and_a_refused_one_are_kept_in_document_order() {
            let response =
                two_hex_preview("unit 5530\nTRANSPORT 6857 30 STON\nTRANSPORT 7001 5 FUR\n");

            let sender = sender_row(&response);
            assert_eq!(held(sender, "STON"), Some(10), "30 of the 40 left");
            assert_eq!(held(sender, "FUR"), Some(5), "the fur stayed");
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 30,
                    tag: "STON".to_string(),
                    to: "6857".to_string(),
                    to_unshown: false,
                    refused: false,
                    order_index: 0,
                }]
            );
            assert_eq!(
                sender.transport_target_issues,
                vec![TransportTargetIssue {
                    to: "7001".to_string(),
                    amount: 5,
                    tag: "FUR".to_string(),
                    reason: TransportTargetReason::NotCaravanseraiOwner,
                    order_index: 1,
                }]
            );
        }

        // The two lists are halves of one document, so the counter has to survive a block whose
        // refused order comes *first* - the case a list-after-list hover would put backwards.
        #[test]
        fn a_refused_order_written_before_a_sent_one_keeps_its_place() {
            let response =
                two_hex_preview("unit 5530\nTRANSPORT 7001 5 FUR\nTRANSPORT 6857 30 STON\n");

            let sender = sender_row(&response);
            assert_eq!(
                sender.transport_target_issues,
                vec![TransportTargetIssue {
                    to: "7001".to_string(),
                    amount: 5,
                    tag: "FUR".to_string(),
                    reason: TransportTargetReason::NotCaravanseraiOwner,
                    order_index: 0,
                }]
            );
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 30,
                    tag: "STON".to_string(),
                    to: "6857".to_string(),
                    to_unshown: false,
                    refused: false,
                    order_index: 1,
                }]
            );
        }

        // One order selecting several tags writes several lines, all under its own index - so an
        // order after it still sorts after every one of them.
        #[test]
        fn every_line_one_order_writes_shares_that_order_s_place() {
            let response = two_hex_preview(
                "unit 5530\nTRANSPORT 6857 30 STON\nTRANSPORT 6857 2 HORS\nTRANSPORT 6857 5 FUR\n",
            );

            let sender = sender_row(&response);
            let places: Vec<(&str, i64)> = sender
                .transport_sent
                .iter()
                .map(|sent| (sent.tag.as_str(), sent.order_index))
                .collect();
            assert_eq!(
                places,
                vec![("STON", 0), ("HORS", 1), ("FUR", 2)],
                "each line carries the place of the order that wrote it"
            );
        }

        // A quartermaster sender splits its own orders across two phases - the eligible target is
        // a quartermaster (phase 2), the ineligible one is not (phase 3) - and the places still
        // read as the document wrote them. A counter kept per phase would call both the first
        // (`ah-64wm`, `ah-d0ku`).
        #[test]
        fn one_sender_s_places_survive_being_split_across_phases() {
            let response =
                two_hex_preview("unit 6857\nTRANSPORT 7001 5 STON\nTRANSPORT 5531 10 STON\n");

            let sender = only_unit_by_id(&response, "6857");
            assert_eq!(
                sender
                    .transport_target_issues
                    .iter()
                    .map(|issue| (issue.to.as_str(), issue.order_index))
                    .collect::<Vec<_>>(),
                vec![("7001", 0)],
                "the refused order keeps the place it was written in"
            );
            assert_eq!(
                sender
                    .transport_sent
                    .iter()
                    .map(|sent| (sent.to.as_str(), sent.order_index))
                    .collect::<Vec<_>>(),
                vec![("5531", 1)],
                "the order written after it sorts after it, though it settles a phase earlier"
            );
        }

        // A catalogue that names no quartermaster skill leaves nothing to resolve, so the report
        // was never asked whether the target holds it. That is missing evidence, not a missing
        // skill, and the interface must not state a catalogue fault as a fact about the player's
        // own units (`ah-64wm`, `ah-d0ku`).
        #[test]
        fn an_unresolvable_quartermaster_skill_is_missing_evidence() {
            let renamed = RULESET.replace("\"quartermaster\"", "\"quartermistress\"");
            let response = preview_orders_for_remembered_report(
                &mut ReportCache::new(),
                &renamed,
                &report_across_two_hexes(),
                "[]",
                "unit 6857\nTRANSPORT 5531 5 STON\n",
            )
            .expect("the ruleset loads");

            let sender = only_unit_by_id(&response, "6857");
            assert_eq!(
                sender
                    .transport_target_issues
                    .iter()
                    .map(|issue| issue.reason)
                    .collect::<Vec<_>>(),
                vec![TransportTargetReason::EligibilityUnknown],
                "a target eligible under a working catalogue is not called a non-quartermaster"
            );
        }

        // A hex remembered before `Structure.base_kind` existed reads it back empty, and the kind
        // before its first comma is the same answer the parser would have derived (`ah-64wm`).
        #[test]
        fn a_caravanserai_is_recognised_without_a_base_kind() {
            use crate::report::model::Structure;

            let remembered = Structure {
                kind: "Caravanserai, needs 40".to_string(),
                ..Structure::default()
            };
            assert!(is_caravanserai(&remembered));

            let parsed = Structure {
                kind: "caravanserai".to_string(),
                base_kind: "caravanserai".to_string(),
                ..Structure::default()
            };
            assert!(is_caravanserai(&parsed), "the kind is matched by word");

            let other = Structure {
                kind: "Magical Citadel".to_string(),
                base_kind: "Magical Citadel".to_string(),
                ..Structure::default()
            };
            assert!(!is_caravanserai(&other));
        }

        #[test]
        fn a_transport_to_nobody_in_particular_moves_nothing() {
            for orders in [
                "unit 5530\nTRANSPORT 0 30 STON\n",
                "unit 5530\nTRANSPORT NEW 1 30 STON\n",
                "unit 5530\nTRANSPORT FACTION 15 NEW 1 30 STON\n",
                "unit 5530\nTRANSPORT 5530 30 STON\n",
                "unit 5530\nTRANSPORT 6857 ALL WEAPONS\n",
            ] {
                let response = two_hex_preview(orders);
                let sender = row(&response, "1:1,1", "5530");
                let stone_untouched = sender.is_none_or(|unit| {
                    let stone = unit
                        .unit
                        .items
                        .iter()
                        .find(|item| item.tag == "STON")
                        .map(|item| item.amount);
                    stone == Some(40)
                        && unit.transport_sent.is_empty()
                        && unit.transport_target_issues.is_empty()
                });
                assert!(stone_untouched, "orders {orders:?} moved nothing");
            }
        }

        #[test]
        fn a_unit_whose_transports_net_to_nothing_is_still_sent() {
            // 6857 starts holding 15 stone, receives 30 more, then forwards the same 30 on -
            // ending exactly where the report found it.
            let response = two_hex_preview(
                "unit 5530\nTRANSPORT 6857 30 STON\nunit 6857\nTRANSPORT 5531 30 STON\n",
            );
            let receiver = receiver_row(&response).expect("6857 is still sent");
            assert!(
                receiver
                    .changes
                    .iter()
                    .all(|change| change.field != "items"),
                "30 arrived and 30 left again, netting to the reported 15 - no items change"
            );
            assert!(!receiver.transport_received.is_empty());
            assert!(!receiver.transport_sent.is_empty());
        }

        #[test]
        fn a_unit_whose_only_transport_was_refused_is_still_sent() {
            let response = two_hex_preview("unit 5530\nTRANSPORT 6857 1 HORS\n");
            let sender = sender_row(&response);
            assert!(sender.changes.iter().all(|change| change.field != "items"));
            assert_eq!(
                sender.transport_sent,
                vec![TransportSent {
                    amount: 0,
                    tag: "HORS".to_string(),
                    to: String::new(),
                    to_unshown: false,
                    refused: true,
                    order_index: 0,
                }]
            );
        }

        /// Four own units in one hex, so the chain is about the phases and not about range: an
        /// ordinary source and three quartermasters, each owning a Caravanserai. Every target has
        /// to be a quartermaster owning a transport structure for the goods to move at all
        /// (`rules/transport`, `ah-64wm`), so the phases are exercised with eligible targets
        /// throughout (`ah-d0ku`).
        fn quartermaster_chain_report() -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "* Source (900), Foo (1), leader [LEAD], 10 stone [STON]. Weight: 510. \
                 Capacity: 0/0/15/0.",
                "+ Post One [1] : Caravanserai.",
                "  * Quarterone (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
                 Skills: quartermaster [QUAM] 1 (30).",
                "+ Post Two [2] : Caravanserai.",
                "  * Quartertwo (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0. \
                 Skills: quartermaster [QUAM] 1 (30).",
                "+ Post Three [3] : Caravanserai.",
                "  * Destination (903), Foo (1), leader [LEAD]. Weight: 10. \
                 Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 1 (30).",
                "",
            ]
            .join("\n")
        }

        fn chain_preview(orders: &str) -> OrdersPreviewResponse {
            preview_orders_for_remembered_report(
                &mut ReportCache::new(),
                RULESET,
                &quartermaster_chain_report(),
                "[]",
                orders,
            )
            .expect("the ruleset loads")
        }

        fn stone_of(response: &OrdersPreviewResponse, unit_id: &str) -> i64 {
            only_unit_by_id(response, unit_id)
                .unit
                .items
                .iter()
                .find(|item| item.tag == "STON")
                .map_or(0, |item| item.amount)
        }

        #[test]
        fn transports_settle_by_phase_rather_than_by_document_order() {
            // `rules/sequenceofevents`: non-quartermaster to quartermaster first, then
            // quartermaster to quartermaster - each phase run over every unit before the next
            // begins. The document is written in the opposite order on purpose: document order
            // must not decide where the goods end up (`ah-d0ku`).
            //
            // Every target here is a quartermaster owning a Caravanserai, because `rules/transport`
            // moves nothing to a target that is not (`ah-64wm`). The third phase of the sequence -
            // quartermaster to non-quartermaster - can therefore carry only refused orders, and is
            // covered by the target-eligibility tests rather than here.
            let response = chain_preview(
                "unit 902\nTRANSPORT 903 10 STON\n\
                 unit 901\nTRANSPORT 902 10 STON\n\
                 unit 900\nTRANSPORT 901 10 STON\n",
            );

            assert_eq!(stone_of(&response, "900"), 0, "the source sent everything");
            assert_eq!(
                stone_of(&response, "901"),
                0,
                "what arrived in the first phase left again in the second"
            );
            assert_eq!(
                stone_of(&response, "902"),
                10,
                "the second hop received in the phase its own line had already been resolved in"
            );
            assert!(
                response
                    .regions
                    .iter()
                    .flat_map(|region| region.units.iter())
                    .all(|unit| unit.unit.unit_id != "903"),
                "902 held nothing when the phase it sends in opened, so nothing reached 903"
            );
        }

        #[test]
        fn an_item_moves_only_once_in_a_transport_phase() {
            // "Items may move in each of the phases but only once in each phase". 901 receives in
            // phase 1 and forwards in phase 2, which is allowed; 902 receives in phase 2 and its
            // own phase-2 line therefore has nothing it may move (`ah-d0ku`).
            let response = chain_preview(
                "unit 900\nTRANSPORT 901 10 STON\n\
                 unit 901\nTRANSPORT 902 10 STON\n\
                 unit 902\nTRANSPORT 901 10 STON\n",
            );

            assert_eq!(
                stone_of(&response, "902"),
                10,
                "what arrived in this phase cannot leave again in the same phase"
            );
            assert_eq!(stone_of(&response, "900"), 0, "the source sent its stone");
        }

        #[test]
        fn transport_annotations_remain_in_document_order() {
            // The quartermaster-to-quartermaster line settles a phase before the line written
            // above it, and the annotations still read in the order the player wrote them: the
            // navigator chose document order for this column (`ah-d0ku`).
            let response = chain_preview(
                "unit 900\nTRANSPORT 901 10 STON\n\
                 unit 901\nTRANSPORT 903 4 STON\nTRANSPORT 902 6 STON\n",
            );

            let hop = only_unit_by_id(&response, "901");
            let targets: Vec<&str> = hop
                .transport_sent
                .iter()
                .map(|sent| sent.to.as_str())
                .collect();
            assert_eq!(targets, vec!["903", "902"], "document order is kept");
        }

        fn only_unit_by_id<'a>(
            response: &'a OrdersPreviewResponse,
            unit_id: &str,
        ) -> &'a UnitPreview {
            response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == unit_id)
                .unwrap_or_else(|| panic!("unit {unit_id} is previewed"))
        }
    }

    /// `rules/sequenceofevents` runs GIVE and TAKE in one Give phase and processes units "in the
    /// order they appear on the report", so the preview settles them that way too - the same
    /// answer `semantics::apply_transfers` gives the Problems and SILVER columns beside it
    /// (`ah-3mwm`).
    mod report_ordered_transfers {
        use super::*;

        /// Three own units in report order - the source first, then the taker, then the unit the
        /// source gives to. The source holds exactly what the other two compete for.
        fn report_with_three() -> String {
            [
                "Foo (1) Report",
                "",
                "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
                "",
                "Exits:",
                "  Southeast : plain (2,2) in Nowhere.",
                "",
                "* Source (900), Foo (1), 10 humans [HUMN], 10 swords [SWOR]. Weight: 150. \
                 Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
                "* Taker (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "* Recipient (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
                "",
            ]
            .join("\n")
        }

        /// The previewed row for `id`, wherever it sits in the response.
        fn row_of<'a>(response: &'a OrdersPreviewResponse, id: &str) -> &'a UnitPreview {
            response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == id)
                .unwrap_or_else(|| panic!("unit {id} is previewed"))
        }

        /// A gift is one movement seen from two sides, so both rows carry it - `rules/give`.
        #[test]
        fn a_gift_reaches_both_units_as_an_item_change() {
            let response = preview_over(&report_with_three(), "unit 900\nGIVE 902 4 SWOR\n");

            let giver = row_of(&response, "900");
            assert_eq!(
                giver.item_changes,
                vec![ItemChange {
                    tag: "SWOR".to_string(),
                    name: "swords".to_string(),
                    delta: -4,
                    cause: ItemChangeCause::GivenAway,
                    line: Some(2),
                    unit_price: None,
                    other: Some(ItemChangeParty {
                        unit_id: "902".to_string(),
                        name: Some("Recipient".to_string()),
                    }),
                    is_man: false,
                }],
            );

            let recipient = row_of(&response, "902");
            assert_eq!(
                recipient.item_changes,
                vec![ItemChange {
                    tag: "SWOR".to_string(),
                    name: "swords".to_string(),
                    delta: 4,
                    cause: ItemChangeCause::WasGiven,
                    line: Some(2),
                    unit_price: None,
                    other: Some(ItemChangeParty {
                        unit_id: "900".to_string(),
                        name: Some("Source".to_string()),
                    }),
                    is_man: false,
                }],
            );
        }

        /// No transfer is priced: `rules/give` names no payment, and the market is a different
        /// phase of `rules/sequenceofevents`. The one invariant a reader cannot see from any
        /// single push site.
        #[test]
        fn no_transfer_change_carries_a_unit_price() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nBUY 2 HORS\nGIVE 901 3 SWOR\nunit 901\nTAKE FROM 900 2 FUR\n",
            );

            let transfer_causes = [
                ItemChangeCause::GivenAway,
                ItemChangeCause::WasGiven,
                ItemChangeCause::Took,
                ItemChangeCause::WasTakenFrom,
                ItemChangeCause::Discarded,
                ItemChangeCause::GiftReverted,
            ];
            let changes: Vec<_> = ["900", "901"]
                .iter()
                .flat_map(|id| row_of(&response, id).item_changes.clone())
                .collect();
            let seen: Vec<_> = transfer_causes
                .iter()
                .copied()
                .filter(|cause| changes.iter().any(|change| change.cause == *cause))
                .collect();
            assert_eq!(
                seen,
                vec![
                    ItemChangeCause::GivenAway,
                    ItemChangeCause::WasGiven,
                    ItemChangeCause::Took,
                    ItemChangeCause::WasTakenFrom,
                ],
                "exactly the four this fixture reaches, so one going missing is noticed: \
                 {changes:?}",
            );
            for change in &changes {
                if transfer_causes.contains(&change.cause) {
                    assert!(change.unit_price.is_none(), "{change:?}");
                } else if change.cause == ItemChangeCause::Bought {
                    assert!(change.unit_price.is_some(), "{change:?}");
                }
            }
        }

        /// `rules/give`: "If 0 is specified as the unit number, then the items are discarded."
        /// Nothing receives them, so this is not a gift to somebody unnamed.
        #[test]
        fn giving_to_unit_zero_records_a_discard_with_no_other_unit() {
            let response = preview_over(&report_with_three(), "unit 900\nGIVE 0 4 SWOR\n");

            let giver = row_of(&response, "900");
            assert_eq!(
                giver.item_changes,
                vec![ItemChange {
                    tag: "SWOR".to_string(),
                    name: "swords".to_string(),
                    delta: -4,
                    cause: ItemChangeCause::Discarded,
                    line: Some(2),
                    unit_price: None,
                    other: None,
                    is_man: false,
                }],
            );
        }

        /// Silver is the one item `rules/give` exempts from the factional rule, so this is the
        /// foreign gift that moves - and `GivenAway` with no other unit is what says so, which is
        /// why a discard is a cause of its own.
        #[test]
        fn giving_silver_to_another_factions_new_unit_names_no_other_unit() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nGIVE FACTION 14 NEW 2 3 SILV\n",
            );

            let giver = row_of(&response, "900");
            assert_eq!(
                giver.item_changes,
                vec![ItemChange {
                    tag: "SILV".to_string(),
                    name: "silver".to_string(),
                    delta: -3,
                    cause: ItemChangeCause::GivenAway,
                    line: Some(2),
                    unit_price: None,
                    other: None,
                    is_man: false,
                }],
            );
        }

        /// The change records what moved, not what was asked for: `tags_moved` clamps a gift to
        /// the stock the giver holds.
        #[test]
        fn a_gift_clamped_by_what_the_giver_holds_records_what_actually_moved() {
            let response = preview_over(&report_with_three(), "unit 900\nGIVE 902 99 SWOR\n");

            let giver = row_of(&response, "900");
            assert_eq!(
                giver
                    .item_changes
                    .iter()
                    .map(|change| (change.tag.as_str(), change.delta))
                    .collect::<Vec<_>>(),
                vec![("SWOR", -10)],
            );
        }

        /// `rules/give`'s `ALL [item class]` form is one order, so every tag it moves carries the
        /// one document line that ordered it.
        #[test]
        fn giving_a_whole_class_records_one_change_per_tag_on_one_line() {
            let response = preview_over(&report_with_three(), "unit 900\nGIVE 902 ALL ITEMS\n");

            let giver = row_of(&response, "900");
            assert_eq!(
                giver
                    .item_changes
                    .iter()
                    .map(|change| (change.tag.as_str(), change.delta, change.line))
                    .collect::<Vec<_>>(),
                vec![("HUMN", -10, Some(2)), ("SWOR", -10, Some(2))],
                "`rules/give`: ITEMS is the combination of every class, men included",
            );

            // The receiver's side of the same order, men included: moving a race tag also merges
            // skills and headcounts, and that branch must record the arrival like any other.
            let recipient = row_of(&response, "902");
            assert_eq!(
                recipient
                    .item_changes
                    .iter()
                    .map(|change| (change.tag.as_str(), change.delta, change.cause, change.line))
                    .collect::<Vec<_>>(),
                vec![
                    ("HUMN", 10, ItemChangeCause::WasGiven, Some(2)),
                    ("SWOR", 10, ItemChangeCause::WasGiven, Some(2)),
                ],
            );
        }

        /// `GIVE [unit] UNIT` moves no items at all (`rules/give` hands over the whole unit), and
        /// `uncounted` already tells the player so - this pins that it is not reported twice.
        #[test]
        fn giving_the_unit_itself_records_no_item_change() {
            let response = preview_over(&report_with_three(), "unit 900\nGIVE 901 UNIT\n");

            // 901 is not previewed at all: nothing about it changed, which is the same answer.
            let giver = row_of(&response, "900");
            assert!(giver.item_changes.is_empty(), "{:?}", giver.item_changes);
            assert!(
                !giver.uncounted.is_empty(),
                "and the order still reaches the player through `uncounted`",
            );
        }

        /// `give_outcome` answers `Uncertain` for a unit the report never prints, so nothing moves
        /// and the ` + ?` mark speaks for it (`ah-66yi`). A change here would state a movement the
        /// report cannot support.
        #[test]
        fn a_gift_to_an_unshown_unit_records_no_item_change() {
            let response = preview_over(&report_with_three(), "unit 900\nGIVE 7777 4 SWOR\n");

            let giver = row_of(&response, "900");
            assert!(giver.item_changes.is_empty(), "{:?}", giver.item_changes);
        }

        /// `rules/take`: a TAKE is a GIVE with the direction reversed, so the same movement is
        /// seen from two sides - the taker took, the source was taken from.
        #[test]
        fn a_take_reaches_both_units_as_an_item_change() {
            let response = preview_over(&report_with_three(), "unit 901\nTAKE FROM 900 4 SWOR\n");

            let taker = row_of(&response, "901");
            assert_eq!(
                taker.item_changes,
                vec![ItemChange {
                    tag: "SWOR".to_string(),
                    name: "swords".to_string(),
                    delta: 4,
                    cause: ItemChangeCause::Took,
                    line: Some(2),
                    unit_price: None,
                    other: Some(ItemChangeParty {
                        unit_id: "900".to_string(),
                        name: Some("Source".to_string()),
                    }),
                    is_man: false,
                }],
            );

            let source = row_of(&response, "900");
            assert_eq!(
                source.item_changes,
                vec![ItemChange {
                    tag: "SWOR".to_string(),
                    name: "swords".to_string(),
                    delta: -4,
                    cause: ItemChangeCause::WasTakenFrom,
                    line: Some(2),
                    unit_price: None,
                    other: Some(ItemChangeParty {
                        unit_id: "901".to_string(),
                        name: Some("Taker".to_string()),
                    }),
                    is_man: false,
                }],
            );
        }

        /// `ah-agbm`'s bounded optimism has its own exit from `take`, which never reaches
        /// `move_between` - so the change is pushed there too, and `taken_unshown` is left alone
        /// for the sentences that already read it.
        #[test]
        fn taking_from_a_unit_the_report_does_not_show_records_the_change_on_the_taker() {
            let response = preview_over(&report_with_three(), "unit 901\nTAKE FROM 7777 3 SWOR\n");

            let taker = row_of(&response, "901");
            assert_eq!(
                taker.item_changes,
                vec![ItemChange {
                    tag: "SWOR".to_string(),
                    // The catalogue's own spelling, which is what this path adds to the item
                    // list as well - no report row was there to supply the plural.
                    name: "sword".to_string(),
                    delta: 3,
                    cause: ItemChangeCause::Took,
                    line: Some(2),
                    unit_price: None,
                    other: Some(ItemChangeParty {
                        unit_id: "7777".to_string(),
                        name: None,
                    }),
                    is_man: false,
                }],
            );
            assert_eq!(
                taker
                    .taken_unshown
                    .iter()
                    .map(|taken| (taken.tag.as_str(), taken.amount, taken.from.as_str()))
                    .collect::<Vec<_>>(),
                vec![("SWOR", 3, "7777")],
                "the list `ah-64wm`'s and `ah-agbm`'s sentences read is untouched",
            );
        }

        /// `rules/sequenceofevents` settles the Give phase before the market, and nothing sorts
        /// this list: the phases append to it in the order the month runs them.
        #[test]
        fn a_gift_is_listed_before_the_months_market_changes() {
            let response = preview_over(
                &report_with_market(),
                "unit 900\nSELL 5 FUR\nGIVE 901 3 SWOR\n",
            );

            let walker = row_of(&response, "900");
            assert_eq!(
                walker.item_changes.first().map(|change| change.cause),
                Some(ItemChangeCause::GivenAway),
                "the gift leads, though the sale is written first: {:?}",
                walker.item_changes,
            );
        }

        fn amount_of(unit: &UnitPreview, tag: &str) -> i64 {
            unit.unit
                .items
                .iter()
                .find(|item| item.tag == tag)
                .map_or(0, |item| item.amount)
        }

        #[test]
        fn competing_give_and_take_transfers_follow_report_order_in_preview() {
            let taker_block = "unit 901\nTAKE FROM 900 10 SWOR\nTAKE FROM 900 10 HUMN\n";
            let giver_block = "unit 900\nGIVE 902 10 SWOR\nGIVE 902 10 HUMN\n";

            for (label, orders) in [
                (
                    "the take written first",
                    format!("{taker_block}{giver_block}"),
                ),
                (
                    "the give written first",
                    format!("{giver_block}{taker_block}"),
                ),
            ] {
                let response = preview_over(&report_with_three(), &orders);
                let of = |id: &str| {
                    response
                        .regions
                        .iter()
                        .flat_map(|region| region.units.iter())
                        .find(|unit| unit.unit.unit_id == id)
                        .unwrap_or_else(|| panic!("{label}: unit {id} is previewed"))
                };

                let recipient = of("902");
                assert_eq!(amount_of(recipient, "SWOR"), 10, "{label}");
                assert_eq!(amount_of(recipient, "HUMN"), 10, "{label}");
                assert_eq!(
                    recipient.unit.men, 11,
                    "{label}: its own leader and the ten arrivals"
                );
                assert_eq!(
                    recipient
                        .unit
                        .skills
                        .iter()
                        .find(|skill| skill.tag == "LUMB")
                        .map(|skill| skill.level),
                    Some(2),
                    "{label}: ten lumberjack-3 men diluted across the leader they join"
                );

                let taker = response
                    .regions
                    .iter()
                    .flat_map(|region| region.units.iter())
                    .find(|unit| unit.unit.unit_id == "901");
                assert!(
                    taker.is_none_or(
                        |taker| amount_of(taker, "SWOR") == 0 && amount_of(taker, "HUMN") == 0
                    ),
                    "{label}: the losing TAKE moved nothing"
                );
            }
        }

        /// `ah-agbm`'s bounded optimism, kept where the preview now owns TAKE outright: an exact
        /// take of a named item from a unit the report does not show still reaches the taker, and
        /// still says where it came from.
        #[test]
        fn an_unseen_exact_take_still_reaches_the_preview_after_report_ordering() {
            let response = preview_over(&report_with_three(), "unit 901\nTAKE FROM 999 5 GRAI\n");
            let unit = only_unit(&response);

            assert_eq!(amount_of(unit, "GRAI"), 5);
            assert_eq!(
                unit.taken_unshown,
                vec![TakenUnshown {
                    amount: 5,
                    tag: "GRAI".to_string(),
                    from: "999".to_string(),
                }]
            );
        }
    }

    /// Two own crews of men, the first with a skill, so a gift of men re-averages the second's.
    fn report_with_two_crews() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 400 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "* Hands (901), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0.",
            "",
        ]
        .join("\n")
    }

    fn unit_by_id<'a>(response: &'a OrdersPreviewResponse, id: &str) -> &'a UnitPreview {
        response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .find(|unit| unit.unit.unit_id == id)
            .unwrap_or_else(|| panic!("no previewed unit {id}"))
    }

    #[test]
    fn a_gift_of_men_records_the_merge_that_diluted_the_receiver() {
        let response = preview_over(&report_with_two_crews(), "unit 900\nGIVE 901 5 HUMN\n");

        let receiver = unit_by_id(&response, "901");
        assert_eq!(
            receiver.skill_merges.len(),
            1,
            "{:?}",
            receiver.skill_merges
        );
        let merge = &receiver.skill_merges[0];
        assert_eq!(merge.cause, SkillMergeCause::Given);
        assert_eq!(merge.from, "900");
        assert_eq!(merge.men, 5);
        assert_eq!(merge.men_before, 10);
        assert!(!merge.count_inferred);
        assert_eq!(merge.men_arriving.len(), 1, "{:?}", merge.men_arriving);
        assert_eq!(merge.men_arriving[0].amount, 5);
        assert_eq!(merge.men_arriving[0].tag, "HUMN");
        assert_eq!(merge.arriving_skills, vec![lumberjack(180)]);
        // (10 * 0 + 5 * 180) / 15 = 60, level 1.
        assert_eq!(merge.skills, vec![lumberjack(60)]);
        assert_eq!(receiver.unit.skills, vec![lumberjack(60)]);

        // `rules/give`: dividing evenly among people leaves the giver's points per man alone.
        let giver = unit_by_id(&response, "900");
        assert!(giver.skill_merges.is_empty(), "{:?}", giver.skill_merges);
    }

    #[test]
    fn a_take_of_men_records_the_merge_as_taken() {
        let response = preview_over(&report_with_two_crews(), "unit 901\nTAKE FROM 900 5 HUMN\n");

        let receiver = unit_by_id(&response, "901");
        assert_eq!(
            receiver.skill_merges.len(),
            1,
            "{:?}",
            receiver.skill_merges
        );
        let merge = &receiver.skill_merges[0];
        assert_eq!(merge.cause, SkillMergeCause::Taken);
        assert_eq!(merge.from, "900");
        assert_eq!(merge.men, 5);
        assert_eq!(merge.men_before, 10);
        assert_eq!(merge.skills, vec![lumberjack(60)]);
    }

    #[test]
    fn recruits_record_the_merge_that_diluted_the_unit() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nBUY 5 HUMN\n",
        );

        let unit = only_unit(&response);
        assert_eq!(unit.skill_merges.len(), 1, "{:?}", unit.skill_merges);
        let merge = &unit.skill_merges[0];
        assert_eq!(merge.cause, SkillMergeCause::Recruited);
        assert_eq!(merge.from, "");
        assert_eq!(merge.men, 5);
        assert_eq!(merge.men_before, 10);
        assert!(!merge.count_inferred);
        assert_eq!(merge.men_arriving.len(), 1, "{:?}", merge.men_arriving);
        assert_eq!(merge.men_arriving[0].amount, 5);
        assert_eq!(merge.men_arriving[0].tag, "HUMN");
        assert!(merge.arriving_skills.is_empty());
        // (10 * 180 + 5 * 0) / 15 = 120, level 2.
        assert_eq!(merge.skills, vec![lumberjack(120)]);
    }

    #[test]
    fn a_buy_all_records_an_inferred_recruit_count() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nBUY ALL HUMN\n",
        );

        let unit = only_unit(&response);
        assert_eq!(unit.skill_merges.len(), 1, "{:?}", unit.skill_merges);
        let merge = &unit.skill_merges[0];
        assert_eq!(merge.cause, SkillMergeCause::Recruited);
        assert!(merge.count_inferred);
        assert!(merge.men_arriving.is_empty(), "{:?}", merge.men_arriving);
        // Stated against the settled headcount rather than a literal, so the assertion does not
        // restate the market arithmetic.
        assert_eq!(merge.men, unit.unit.men - 10);
        assert_eq!(merge.men_before, 10);
    }

    /// [`report_with_market_selling_people`], plus an item no catalogue knows - which is what
    /// leaves `men_estimated` set and makes `settle_headcounts` skip the unit.
    fn report_with_an_unreadable_item() -> String {
        [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 humans [HUMN] at $38.",
            "",
            "Exits:",
            "  Southeast : plain (2,2) in Nowhere.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 3 widgets [WDGT], 400 silver [SILV]. \
             Weight: 100. Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "",
        ]
        .join("\n")
    }

    #[test]
    fn recruits_are_not_merged_into_a_unit_whose_headcount_was_estimated() {
        let response = preview_over(&report_with_an_unreadable_item(), "unit 900\nBUY 5 HUMN\n");

        let unit = only_unit(&response);
        // Asserted so a fixture that stops being estimated fails loudly rather than quietly
        // asserting nothing.
        assert!(unit.unit.men_estimated, "the fixture must stay estimated");
        assert!(unit.recruits_unmerged);
        assert!(unit.skill_merges.is_empty(), "{:?}", unit.skill_merges);
        assert_eq!(unit.unit.skills, vec![lumberjack(180)]);
    }

    #[test]
    fn men_taken_from_a_unit_the_report_does_not_show_are_left_out_of_the_merge() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nTAKE FROM 1234 5 HUMN\n",
        );

        let unit = only_unit(&response);
        assert_eq!(
            unit.men_of_unknown_skill,
            vec![TakenUnshown {
                amount: 5,
                tag: "HUMN".to_string(),
                from: "1234".to_string(),
            }]
        );
        assert!(unit.skill_merges.is_empty(), "{:?}", unit.skill_merges);
        assert_eq!(unit.unit.skills, vec![lumberjack(180)]);
    }

    #[test]
    fn the_preview_carries_the_reports_own_skill_list_typed() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nBUY 5 HUMN\n",
        );

        let unit = only_unit(&response);
        assert_eq!(unit.reported_skills, vec![lumberjack(180)]);
        assert_eq!(unit.unit.skills, vec![lumberjack(120)]);
    }

    #[test]
    fn a_formed_unit_has_no_reported_skills() {
        // The report never showed a unit this month's FORM creates, so it printed no skills for
        // it - which `original: None` is exactly what says.
        let response = preview("unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n");

        let formed = unit_by_id(&response, "new-1");
        assert!(formed.formed);
        assert!(
            formed.reported_skills.is_empty(),
            "{:?}",
            formed.reported_skills
        );
    }

    #[test]
    fn the_new_preview_fields_cross_the_wire_in_their_camel_case_spelling() {
        // The `UnitPreview` mirrors in `packages/core-client/src/index.ts` are hand-written and
        // nothing compares them to this struct. This pins only the Rust half - the spelling the
        // wire actually carries - so a mirror written against it has a fixed target. A typo on the
        // TypeScript side still fails nothing here: that gap is real and uncovered.
        let response = preview_over(&report_with_two_crews(), "unit 900\nGIVE 901 5 HUMN\n");
        let receiver = unit_by_id(&response, "901");
        let json = serde_json::to_value(receiver).expect("a preview serializes");

        let object = json.as_object().expect("an object");
        for field in [
            "skillMerges",
            "reportedSkills",
            "recruitsUnmerged",
            "menOfUnknownSkill",
        ] {
            assert!(object.contains_key(field), "no {field} on the wire: {json}");
        }

        let merge = json["skillMerges"][0]
            .as_object()
            .expect("one merge on the wire");
        assert_eq!(merge["cause"], "given");
        for field in [
            "from",
            "men",
            "menBefore",
            "menArriving",
            "countInferred",
            "arrivingSkills",
            "skills",
        ] {
            assert!(merge.contains_key(field), "no {field} on a merge: {json}");
        }
    }

    #[test]
    fn a_unit_given_men_and_recruiting_records_both_merges_in_the_order_they_ran() {
        // `rules/sequenceofevents` runs the Give phase before the market, and the popup's chain
        // (`ah-rgkk.2`, decision N2) reads the records in that order without re-deriving any of
        // it - so the order, and the join between one record and the next, are the properties
        // this feature actually rests on.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 20 humans [HUMN] at $38.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN], 400 silver [SILV]. Weight: 100. \
             Capacity: 0/0/150/0. Skills: lumberjack [LUMB] 3 (180).",
            "* Hands (901), Foo (1), 6 humans [HUMN]. Weight: 60. Capacity: 0/0/90/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(&report, "unit 901\nGIVE 900 6 HUMN\nunit 900\nBUY 4 HUMN\n");

        let unit = unit_by_id(&response, "900");
        assert_eq!(unit.skill_merges.len(), 2, "{:?}", unit.skill_merges);
        assert_eq!(unit.skill_merges[0].cause, SkillMergeCause::Given);
        assert_eq!(unit.skill_merges[1].cause, SkillMergeCause::Recruited);
        // The chain joins up: the recruits weigh against the headcount the gift left behind.
        assert_eq!(unit.skill_merges[0].men_before, 10);
        assert_eq!(
            unit.skill_merges[1].men_before,
            unit.skill_merges[0].men_before + unit.skill_merges[0].men
        );
        // ... and the last record's list is the unit's own, so the popup reads rather than merges.
        assert_eq!(unit.skill_merges[1].skills, unit.unit.skills);
    }

    #[test]
    fn a_merge_that_moved_no_figure_is_recorded_like_any_other() {
        // Men joining and nothing moving is a fact about the month. Leaving the record out would
        // make it indistinguishable from no arrival at all.
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "",
            "* Crew (900), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0.",
            "* Hands (901), Foo (1), 10 humans [HUMN]. Weight: 100. Capacity: 0/0/150/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(&report, "unit 900\nGIVE 901 5 HUMN\n");

        let receiver = unit_by_id(&response, "901");
        assert!(
            receiver.unit.skills.is_empty(),
            "neither side has a skill, so no figure can move"
        );
        assert_eq!(
            receiver.skill_merges.len(),
            1,
            "{:?}",
            receiver.skill_merges
        );
        assert_eq!(receiver.skill_merges[0].men, 5);
        assert!(receiver.skill_merges[0].skills.is_empty());
    }

    #[test]
    fn an_estimated_unit_whose_recruits_never_settled_claims_nothing() {
        // The other half of `recruits_unmerged`: a `BUY ALL` leaves the ledger no exact list, and
        // an estimated headcount is exactly the unit `settle_headcounts` refuses to infer one for.
        // So nothing is claimed - saying "your recruits were not merged in" would be asserting a
        // recruit the core never established.
        let response = preview_over(
            &report_with_an_unreadable_item(),
            "unit 900\nBUY ALL HUMN\n",
        );

        let unit = only_unit(&response);
        assert!(unit.unit.men_estimated, "the fixture must stay estimated");
        assert!(!unit.recruits_unmerged);
        assert!(unit.skill_merges.is_empty(), "{:?}", unit.skill_merges);
    }

    /// A unit whose only order is `STUDY` changes nothing this month - `rules/sequenceofevents`
    /// runs `STUDY` after the market - so its row exists only because the forecast does
    /// (`ah-rgkk.2.2`).
    #[test]
    fn a_studying_unit_gets_a_preview_row_even_though_nothing_changed_this_month() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nSTUDY lumberjack\n",
        );

        let unit = only_unit(&response);
        assert!(unit.changes.is_empty(), "{:?}", unit.changes);
        assert_eq!(unit.status, UnitPreviewStatus::Present);
        assert!(unit.study.is_some(), "{:?}", unit.study);
    }

    /// A unit that moves and studies is one unit with one month, so both of its rows carry the
    /// same forecast - the reading `produced` and `built` already take of a mover (`ah-rgkk.2.2`).
    #[test]
    fn a_mover_carries_its_forecast_onto_both_of_its_rows() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nMOVE SE\nSTUDY lumberjack\n",
        );

        let rows: Vec<_> = response
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .filter(|unit| unit.unit.unit_id == "900")
            .collect();
        assert_eq!(rows.len(), 2, "a departure and its arrival");
        for row in rows {
            assert!(
                row.study.is_some(),
                "the {:?} row carries the forecast",
                row.status
            );
        }
    }

    /// A unit `rules/form` dissolves never exists, so it studies nothing.
    #[test]
    fn a_dissolving_unit_forecasts_no_study() {
        let report = [
            "Foo (1) Report",
            "",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
            "  For Sale: 0 humans [HUMN] at $38.",
            "",
            "* Receiver (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
            "* Former (902), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
            "",
        ]
        .join("\n");
        let response = preview_over(
            &report,
            "unit 902\nFORM 1\nBUY 1 humans\nSTUDY combat\nEND\n",
        );

        let dissolving = response.regions[0]
            .units
            .iter()
            .find(|unit| unit.unit.unit_id == "new-1")
            .expect("the dissolving row is drawn");
        assert!(dissolving.study.is_none(), "{:?}", dissolving.study);
    }

    /// The two mirrors of these types are hand-written, and nothing else compares them: this is
    /// what stands between a misspelled field and a runtime `undefined` (`ah-rgkk.2.2`).
    #[test]
    fn the_study_forecast_crosses_the_wire_in_its_camel_case_spelling() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nSTUDY lumberjack\n",
        );
        let value = serde_json::to_value(only_unit(&response)).expect("the row serialises");
        let study = value
            .get("study")
            .and_then(serde_json::Value::as_object)
            .expect("the forecast is on the wire under `study`");

        for field in [
            "tag",
            "name",
            "levelBefore",
            "pointsBefore",
            "monthsNumerator",
            "monthsDenominator",
            "teachers",
            "halvedOutsideABuilding",
            "pointsAfter",
            "levelAfter",
            "ceilingLevel",
            "limitingRaces",
            "heldBackByCeiling",
            "doubts",
        ] {
            assert!(study.contains_key(field), "{field} is missing: {study:?}");
        }

        let doubt = serde_json::to_value(StudyDoubt {
            reason: StudyDoubtReason::FeeShort,
            fee: 200,
            short_by: 160,
            teacher: String::new(),
        })
        .expect("a doubt serialises");
        assert_eq!(
            doubt.get("reason").and_then(serde_json::Value::as_str),
            Some("feeShort")
        );
        assert_eq!(
            doubt.get("shortBy").and_then(serde_json::Value::as_i64),
            Some(160)
        );
    }

    /// The forecast's starting figures come from `semantics`'s own skill merge and the popup's
    /// last this-month step from the preview's; two models, one answer required (`ah-rgkk.2.2`).
    #[test]
    fn the_forecast_starts_from_the_same_figures_the_preview_shows() {
        let response = preview_over(
            &report_with_market_selling_people(),
            "unit 900\nBUY 5 HUMN\nSTUDY lumberjack\n",
        );

        let unit = only_unit(&response);
        let study = unit.study.as_ref().expect("the study is forecast");
        // `(10 * 180 + 5 * 0) / 15`, which `merge_skills` truncates.
        assert_eq!(study.points_before, 120);
        let shown = unit
            .unit
            .skills
            .iter()
            .find(|skill| skill.tag.eq_ignore_ascii_case("LUMB"))
            .expect("the row shows the skill");
        assert_eq!(study.points_before, shown.points);
    }
}
