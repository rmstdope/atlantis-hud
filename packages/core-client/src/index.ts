import type { AdvisoryCheckCode } from "./coreVocabulary.generated";
// Both are re-exported below; `ArmyMemberRecord` also names them, which a re-export alone does not
// bring into this file's scope.
import type { ItemAmount } from "./generated/ItemAmount";
import type { SkillInfo } from "./generated/SkillInfo";
import type { CombatSpell } from "./generated/CombatSpell";

// The report model and the parse family are generated from the Rust core by ts-rs
// (crates/core, `cargo test`); see docs/implementation-plan.md §Generated bindings.
export type { EngineInfo } from "./generated/EngineInfo";
export type { TurnRef } from "./generated/TurnRef";
export type { WarningSeverity } from "./generated/WarningSeverity";
export type { ParseWarning } from "./generated/ParseWarning";
export type { TurnHeader } from "./generated/TurnHeader";
export type { FactionInfo } from "./generated/FactionInfo";
export type { RegionSummary } from "./generated/RegionSummary";
export type { UnitSummary } from "./generated/UnitSummary";
export type { InventoryItem } from "./generated/InventoryItem";
export type { MessageSummary } from "./generated/MessageSummary";
export type { ReportParseResult } from "./generated/ReportParseResult";
export type { Coordinate } from "./generated/Coordinate";
export type { ItemAmount } from "./generated/ItemAmount";
export type { MarketItem } from "./generated/MarketItem";
export type { SettlementInfo } from "./generated/SettlementInfo";
export type { RegionExit } from "./generated/RegionExit";
export type { StructureInfo } from "./generated/StructureInfo";
export type { VesselEntry } from "./generated/VesselEntry";
export type { SkillInfo } from "./generated/SkillInfo";
export type { CombatSpell } from "./generated/CombatSpell";
export type { ReportUnit } from "./generated/ReportUnit";
export type { UnitMovement } from "./generated/UnitMovement";
export type { UnitMovementMode } from "./generated/UnitMovementMode";
export type { UnitMovementStatus } from "./generated/UnitMovementStatus";
export type { ReportRegion } from "./generated/ReportRegion";
export type { ReportHeaderInfo } from "./generated/ReportHeaderInfo";
export type { FactionStatus } from "./generated/FactionStatus";
export type { FactionStatusEntry } from "./generated/FactionStatusEntry";
export type { DeclaredAttitudes } from "./generated/DeclaredAttitudes";
export type { AttitudeLevel } from "./generated/AttitudeLevel";
export type { FactionRef } from "./generated/FactionRef";
export type { UnitOrders } from "./generated/UnitOrders";
export type { OrdersTemplate } from "./generated/OrdersTemplate";
export type { Combatant } from "./generated/Combatant";
export type { BattleUnit } from "./generated/BattleUnit";
export type { BattleSkill } from "./generated/BattleSkill";
export type { RosterSkills } from "./generated/RosterSkills";
export type { Casualty } from "./generated/Casualty";
export type { BattleRound } from "./generated/BattleRound";
export type { Battle } from "./generated/Battle";
export type { UnreadableKind } from "./generated/UnreadableKind";
export type { LostBlock } from "./generated/LostBlock";
export type { UnreadableLine } from "./generated/UnreadableLine";
export type { ParsedReport } from "./generated/ParsedReport";
export type { OrderDiagnosticSeverity } from "./generated/OrderDiagnosticSeverity";
export type { OrderDiagnostic } from "./generated/OrderDiagnostic";
export type { OrderValidationResult } from "./generated/OrderValidationResult";
export type { FormedSubject } from "./generated/FormedSubject";
export type { UnitSilver } from "./generated/UnitSilver";
export type { SilverDoubt } from "./generated/SilverDoubt";
export type { ProductionCap } from "./generated/ProductionCap";
export type { MapShape } from "./generated/MapShape";
export type { GameMetadata } from "./generated/GameMetadata";
export type { ReportSourceRef } from "./generated/ReportSourceRef";
export type { GameManifest } from "./generated/GameManifest";
export type { ManifestEdit } from "./generated/ManifestEdit";

export {
  aBattle,
  aBattleUnit,
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit,
  aStructure,
  aTradeRoute,
  aTradedGood,
  aUnitSilver
} from "./builders";

import type { Coordinate } from "./generated/Coordinate";
import type { ReportRegion } from "./generated/ReportRegion";
import type { ReportUnit } from "./generated/ReportUnit";
import type { SettlementInfo } from "./generated/SettlementInfo";
import type { ReportParseResult } from "./generated/ReportParseResult";
import type { OrderValidationResult } from "./generated/OrderValidationResult";
import type { GameManifest } from "./generated/GameManifest";
import type { EngineInfo } from "./generated/EngineInfo";
import type { ParsedReport } from "./generated/ParsedReport";
import type { RosterSkills } from "./generated/RosterSkills";

export type OpenedGame = {
  gameFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: GameManifest;
};



/** One of the six ways out of a hex, as the core names them. */
export type Direction =
  | "north"
  | "northeast"
  | "southeast"
  | "south"
  | "southwest"
  | "northwest";

/** One hex entered along a route. */
export type RouteStep = {
  direction: Direction;
  to: Coordinate;
  terrain: string;
  cost: number;
  /** Whether a road connected both sides and halved the cost. */
  road: boolean;
  /**
   * Whether the terrain and the cost are guesses rather than anything a report stated.
   *
   * True for a step into unexplored country, which the core costs as the terrain of the hex behind
   * it. Nothing about such a step is knowledge, and the interface has to say so.
   */
  estimated: boolean;
};

/** Where the unit stands when a month runs out. */
export type MonthLeg = { month: number; steps: number; endsAt: Coordinate };

export type RoutePlan = {
  from: Coordinate;
  to: Coordinate;
  mode: "fly" | "ride" | "sail" | "walk";
  steps: RouteStep[];
  totalCost: number;
  months: MonthLeg[];
  /** The order this route becomes, as core writes it - `SAIL …` for a fleet, `MOVE …` for everyone else. */
  order: string;
};

/**
 * Why a route could not be planned.
 *
 * Always a named reason rather than a bare failure: "the sea is in the way at (8,52)" is something
 * a player can act on, where "no route" is not.
 */
export type RouteProblem =
  | { kind: "notYourUnit" }
  | { kind: "overloaded" }
  | { kind: "mobilityUnstated" }
  | { kind: "alreadyThere" }
  | { kind: "noKnownRoute" }
  | { kind: "originUnknown" }
  | { kind: "oceanNeedsShip"; coordinate: Coordinate }
  | { kind: "flightWouldEndOverOcean"; coordinate: Coordinate }
  | { kind: "crewCannotSail"; required: number; available: number };

export type RiskLevel = "low" | "medium" | "high";

export type HexRisk = {
  coordinate: Coordinate;
  level: RiskLevel;
  hostileStrength: number;
  ownStrength: number;
  foreignUnits: number;
  monsters: number;
  guards: number;
  /** Whether the hex could be assessed at all. An unassessable hex is never reported as safe. */
  unknown: boolean;
  lastSeenTurn: number | null;
  reason: string;
};

/** A route is as dangerous as its worst hex, never an average of them. */
export type RouteRisk = { level: RiskLevel; worst: HexRisk | null; hexes: HexRisk[] };

/** One good worth carrying from one hex to another. */
export type TradedGood = {
  /** The item's tag, as both markets name it. */
  tag: string;
  /** The seller's own spelling, which is what the region panel shows. */
  name: string;
  buyPrice: number;
  sellPrice: number;
  /** The smaller of what the seller has and what the buyer will take. */
  quantity: number;
  /** `sellPrice - buyPrice`, per unit. */
  margin: number;
  /** The turn each half was last seen in, so a rumour can say so. `null` only when the report
   * carries no turn number at all. */
  buySeenTurn: number | null;
  sellSeenTurn: number | null;
};

/**
 * How long the journey takes, in months, for each way of travelling. `null` where the known map
 * offers that mode no route at all - water for a walker, or a gap in what has been seen.
 */
export type TravelTurns = { walk: number | null; ride: number | null; fly: number | null };

/** A pair of hexes worth trading between, and everything worth carrying either way. */
export type TradeRoute = {
  /** Where the journey starts: the hex whose outbound leg is worth at least as much as the
   * other way (a tie keeps the lower-indexed hex, for a stable answer). */
  from: Coordinate;
  to: Coordinate;
  /** Goods bought at `from` and sold at `to`. Never empty. */
  outbound: TradedGood[];
  /** Goods bought at `to` and sold at `from`. Empty unless the way back also pays, which is what
   * makes this a circuit rather than a one-way trip. */
  inbound: TradedGood[];
  /** Silver earned running the whole thing once: every good on both legs, quantity times margin. */
  worth: number;
  turns: TravelTurns;
};

/**
 * One region the faction saw in an earlier turn.
 *
 * `region` is a `ReportRegion` with its exits intact, which is what lets an accumulated map join up
 * into a graph a route can cross. A single report describes its neighbours but not theirs.
 */
export type RememberedRegion = { region: ReportRegion; lastSeenTurn: number };

/**
 * What a map export puts in the file, beyond the region economy every export carries.
 *
 * Three levers rather than a detail level, because the reasons for holding something back differ:
 * units say where your army is, structures say what you have built, and advanced resources say
 * where the mithril is. A player trading a map usually wants to give away only some of that.
 */
export type MapExportContent = {
  structures: boolean;
  units: boolean;
  advancedResources: boolean;
};

/**
 * One rectangle of one level, and what to write about it.
 *
 * The corners are inclusive and may arrive in either order: they come from a drag on the map,
 * which says nothing about which corner the player started from.
 */
export type MapExportRequest = {
  level: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  content: MapExportContent;
};

/**
 * How much can be trusted about a hex on the accumulated map - the same three words the core's
 * resolver uses.
 */
export type HexKnowledge = "current" | "stale" | "named";

/** One hex, resolved by the core: what is known about it, and since when. */
export type KnownMapHex = {
  coordinate: Coordinate;
  terrain: string;
  province: string;
  knowledge: HexKnowledge;
  lastSeenTurn: number | null;
  /** `null` for a hex merely named by an exit, never visited. */
  region: ReportRegion | null;
  /** The settlement the hex's description names, if any. */
  settlement: SettlementInfo | null;
};

/** One level the known map has hexes on, with the word the level control shows for it. */
export type MapLevel = {
  z: number;
  name: string;
};

/** Everything the faction knows about the map, resolved once by the core. */
export type KnownMap = {
  /** Sorted by level, then row, then column. */
  hexes: KnownMapHex[];
  /** The distinct levels `hexes` holds, ascending by z, each named by the core. */
  levels: MapLevel[];
  currentTurn: number | null;
};

/**
 * One allied report folded into a faction's map for one turn.
 *
 * Merging writes the ally's regions under the viewer's own faction id and stores no turn of the
 * ally's, so afterwards nothing else in the game says where the extra hexes came from. `factionId`
 * is the map that grew; `mergedFactionId` is whose report grew it.
 */
export type MergedReportRecord = {
  gameId: string;
  factionId: string;
  turnNumber: number;
  mergedFactionId: string;
  mergedFactionName: string;
  mergedAt: string;
};

/** What merging one allied report did to a faction's map. */
export type ReportMergeResult = {
  turnNumber: number;
  mergedFactionId: string;
  mergedFactionName: string;
  /** Regions the allied report contributed. */
  mergedRegionCount: number;
  /** Of those, the hexes that were new to the map. */
  newRegionCount: number;
};

/**
 * Where a unit's written MOVE order takes it, hex by hex and month by month.
 *
 * Terrain is a guess wherever the map could not say, and the trace never refuses: an order into
 * unexplored country is extrapolated to its end, because it is still the player's stated intent.
 */
export type TracedPath = {
  from: Coordinate;
  steps: RouteStep[];
  /** Empty when `mode` is null - the timing cannot be split without knowing the unit's speed. */
  months: MonthLeg[];
  /** How the unit travels, or null when it is overloaded or the report never said. */
  mode: "fly" | "ride" | "sail" | "walk" | null;
  /**
   * Index of the first step the game would refuse - a walker entering the sea - or null when the
   * whole path is passable or there is no mode to rule with. Everything from this step onward is
   * doubt rather than plan, whatever month it falls in.
   */
  blockedFrom: number | null;
};

/** The traced order, or nothing when the unit has no readable movement order to draw. */
export type MoveOrderTraceResponse = {
  path: TracedPath | null;
};

/** How a previewed unit relates to the hex its row sits in. */
export type UnitPreviewStatus = "present" | "departing" | "arriving" | "formed";

/** One field the orders change, with what the report said before, formatted for a tooltip. */
export type FieldChange = {
  /** The `ReportUnit` field: `name`, `onGuard`, `flags`, `items`, `men` or `structureId`. */
  field: string;
  original: string;
};

/** Goods taken from a unit the report does not show in this hex (`ah-agbm`). */
export type TakenUnshown = {
  amount: number;
  tag: string;
  from: string;
};

/** One item a PRODUCE order makes this month. */
export type ProducedItem = { amount: number; tag: string };

/** Which limit decided how much work a BUILD does, when it was not the unit's men. */
export type BuildCap = "materials" | "needs";

/** What one BUILD order spends this month (`ah-ofpb.2`). */
export type BuildSpend = {
  amount: number;
  tag: string;
  /** The material's display name, as the cap sentence says it - "wood". */
  name: string;
  /** The structure worked on: its label, or the kind being founded. */
  place: string;
  founding: boolean;
  helping: string | null;
  couldDo: number;
  cappedBy: BuildCap | null;
};

/** One item a CAST order creates this month. `fewest` and `most` are equal when it is certain. */
export type CreatedItem = { fewest: number; most: number; tag: string; summoned: boolean };

/** One line of what a unit's TRANSPORT/DISTRIBUTE orders send this month, in document order. */
export type TransportSent = {
  amount: number;
  tag: string;
  to: string;
  toUnshown: boolean;
  refused: boolean;
  /**
   * Which of this unit's TRANSPORT/DISTRIBUTE orders wrote this line: its place among the readable
   * ones in its block, counting from `0` in document order. Shared with
   * `TransportTargetIssue.orderIndex`, so the two lists read back interleaved as written; one
   * order selecting several tags writes several lines under one index (`ah-64wm`).
   */
  orderIndex: number;
};

/** One item arriving by another unit's TRANSPORT/DISTRIBUTE this month. */
export type TransportReceived = { amount: number; tag: string; from: string };

/**
 * Why the report cannot show a TRANSPORT/DISTRIBUTE target receiving what was sent (`ah-64wm`).
 *
 * The first two are certain: `rules/transport` wants the quartermaster skill, which our report
 * prints in full for our own units, and `rules/economy_transport` wants ownership of a
 * Caravanserai, whose owner `rules/world_structures` makes the first unit listed inside it. The
 * last two are gaps in the report - a unit it never described, foreign skills it never discloses,
 * and a foreign faction's attitude toward ours, which is not in our report at all
 * (`rules/com_attitudes`).
 */
export type TransportTargetReason =
  | "notQuartermaster"
  | "notCaravanseraiOwner"
  | "eligibilityUnknown"
  | "acceptanceUnknown";

/**
 * One TRANSPORT/DISTRIBUTE the target gate stopped, once for the order rather than once per tag
 * (`ah-64wm`).
 */
export type TransportTargetIssue = {
  /** The unit number the order named. */
  to: string;
  /** What the order would have moved. `0` when the sentence names no amount - see `tag`. */
  amount: number;
  /** Empty when the order has no per-tag claim to make and speaks of the order alone. */
  tag: string;
  reason: TransportTargetReason;
  /**
   * Which of this unit's TRANSPORT/DISTRIBUTE orders this issue belongs to, on the same counter
   * `TransportSent.orderIndex` carries (`ah-64wm`).
   */
  orderIndex: number;
};

/** One unit as the orders leave it: the full predicted state, so the row renders like any other. */
export type UnitPreview = {
  unit: ReportUnit;
  status: UnitPreviewStatus;
  changes: FieldChange[];
  /** Where an arriving unit set out from. */
  arrivingFrom: string | null;
  /** Where a departing unit ends the month, when the trace can say. */
  departingTo: string | null;
  /**
   * The fleet carrying this unit away, as `<name> [<id>]`, when it is departing because the ship it
   * stands in is. Never set on an arriving row: an arrival says only where it came from.
   */
  aboard: string | null;
  /**
   * This unit's orders whose effect on its items could not be counted, verbatim, in document
   * order (`ah-agbm`).
   */
  uncounted: string[];
  /** Silver or goods taken from a unit the report does not show in this hex (`ah-agbm`). */
  takenUnshown: TakenUnshown[];
  /** What this unit's PRODUCE orders make this month (`ah-ofpb.1`). */
  produced: ProducedItem[];
  /** What this unit's BUILD orders spend this month (`ah-ofpb.2`). */
  built: BuildSpend[];
  /** What this unit's CAST orders create this month (`ah-ofpb.5`). */
  created: CreatedItem[];
  /** What this unit's TRANSPORT/DISTRIBUTE orders send this month, in document order (`ah-bxgs`). */
  transportSent: TransportSent[];
  /** What arrives at this unit by another unit's TRANSPORT/DISTRIBUTE this month (`ah-bxgs`). */
  transportReceived: TransportReceived[];
  /**
   * This unit's TRANSPORT/DISTRIBUTE orders whose target the report cannot show as able to
   * receive, in document order. Those orders move nothing (`ah-64wm`).
   */
  transportTargetIssues: TransportTargetIssue[];
};

/** Every previewed unit standing in (or bound for) one region. */
export type RegionPreview = {
  regionId: string;
  units: UnitPreview[];
};

/**
 * What the orders document changes, region by region. Regions and units the orders leave alone
 * are absent, so an empty answer means the report already shows the coming month.
 */
export type OrdersPreviewResponse = {
  regions: RegionPreview[];
};

/** Everything the planner has to say about one proposed move. */
export type RoutePlanResponse = {
  /** The route, when one was found. */
  plan: RoutePlan | null;
  /** Why there is none, when there is not. Exactly one of these two is present. */
  problem: RouteProblem | null;
  /** What stands along it. Present only alongside a route. */
  risk: RouteRisk | null;
  /** False while the ruleset has an open gap, which makes the cost a lower bound. */
  fullyModelled: boolean;
};

/** One entry in the orders editor's completion popup, mirroring the core's `OrderCompletion`. */
export type OrderCompletion = {
  /** What is written into the line when the entry is accepted, and the first thing the typed word
   * is matched against. Always the canonical spelling: a keyword, or an item or skill tag. */
  value: string;
  /** The other thing the typed word may match: an item's or skill's name. Empty for a keyword. */
  name: string;
  /** What the entry shows beside its value. Empty for a keyword, which is its own explanation. */
  detail: string;
};

/** Which position the caret is in. Mirrors the core's `CaretPosition`. */
export type CaretPosition = "command" | "argument" | "nowhere";

/**
 * Where the caret is in one order line, what word is being typed there, and what may stand there.
 *
 * Mirrors the core's `CaretCompletions`. One call, because the three answers come from one lexing
 * of the line and the editor's three completion sources all need them on the same keystroke.
 */
export type CaretCompletions = {
  position: CaretPosition;
  /** Where the word being typed starts, in UTF-16 code units from the start of the line - the unit
   * CodeMirror's own document offsets are in, so a shell adds it to `line.from` directly. */
  wordStart: number;
  /** The word being typed, verbatim. Empty when none is. */
  word: string;
  /** What may stand here. Empty unless `position` is `"argument"`. */
  options: OrderCompletion[];
};

export type ImportedTurnPreview = {
  exists: boolean;
  rawChanged: boolean;
  parsedChanged: boolean;
  warningsChanged: boolean;
};

export type ReportImportPreview = {
  parseResult: ReportParseResult;
  duplicatePreview: ImportedTurnPreview;
  turnNumber: number | null;
};

export {
  ADVISORY_CHECK_CODES,
  MOVEMENT_ORDER_COMMANDS,
  SILVER_TROUBLE_CODES,
  type AdvisoryCheckCode,
  type MovementOrderCommand
} from "./coreVocabulary.generated";

/** Which of the checks that read the report to run. */
export type OrderCheckOptions = {
  /**
   * Advisory codes not to produce. Omitted = the core's own default
   * (`OrderCheckOptions::default()` in Rust), which leaves out one code that would otherwise
   * speak about nearly every hex.
   *
   * Most hexes are deliberately unguarded, so warning about every one of them speaks about hex
   * after hex; dropping a guard you had is reported either way, because that is a change you may
   * not have meant.
   */
  disabledCodes?: readonly AdvisoryCheckCode[];
};

export type OrderDraftKey = {
  gameId: string;
  factionId: string;
  turnNumber: number;
};

export type OrderDraftRecord = {
  key: OrderDraftKey;
  orderText: string;
  updatedAt: string;
};

/** One player-written note on a hex. Keyed by id; `regionId` is `hexMapModel`'s `"z:x,y"`. */
export type HexNoteRecord = {
  id: string;
  gameId: string;
  regionId: string;
  text: string;
  onMap: boolean;
  turn: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * One unit as an Army remembers it: the last report that showed it, whichever turn that was.
 *
 * A member the current report does not mention is kept and still exported - it may be another
 * faction's unit that is simply not visible this turn - so a membership is a snapshot rather than a
 * unit number, and carries everything an export needs.
 */
export type ArmyMemberRecord = {
  /** The report's unit number. The key: stable across turns, and never withheld. */
  unitId: string;
  name: string;
  /** Null when the unit was concealing its faction when last seen (`ReportUnit.factionId`). */
  factionId: string | null;
  factionName: string | null;
  own: boolean;
  /** Where it was when last seen; `hexMapModel`'s `"z:x,y"`. */
  regionId: string;
  flags: string[];
  items: ItemAmount[];
  skills: SkillInfo[];
  /** The spell it was set to cast when last seen; null for a unit that has none. */
  combatSpell: CombatSpell | null;
  men: number;
  /** The turn of the report this snapshot came from. */
  seenTurn: number;
  /** When the snapshot was taken, ISO 8601, from the caller's clock. */
  seenAt: string;
};

/** A named group of units, scoped to the game and outliving any one turn. */
export type ArmyRecord = {
  id: string;
  gameId: string;
  name: string;
  members: ArmyMemberRecord[];
  createdAt: string;
  updatedAt: string;
};

/**
 * One mage an ally shared, as the sheet that carried him described him.
 *
 * The unit is kept whole because the study planner reads an allied mage through `standingOf`,
 * which takes a `ReportUnit` - a narrower row would need a conversion back and a second
 * definition of what a mage is. There is no `gameId`: every call that reads or writes these rows
 * is scoped to one game and takes it as a parameter.
 */
export type AlliedMageRecord = {
  /** The sending faction, from the sheet's own header - never from a unit line. */
  factionId: string;
  /** The sender's name from that header; null when the header carried an id and no name. */
  factionName: string | null;
  /** The parsed unit. `unit.unitId` is the row's key half; there is no second copy of it. */
  unit: ReportUnit;
  /** The turn of the sheet this row came from. Staleness is this against the faction's newest. */
  sheetTurn: number;
  /** When the sheet was taken in, ISO 8601, from the caller's clock. */
  receivedAt: string;
};

/** One stored mage's identity: which ally, and which unit of his. */
export type AlliedMageKey = {
  factionId: string;
  unitId: string;
};

export type ImportedTurnRecord = {
  key: OrderDraftKey;
  rawReport: string;
  parseResult: ReportParseResult;
};

/** Enough to label an imported turn without loading its full report. */
export type ImportedTurnSummary = {
  key: OrderDraftKey;
  season: string | null;
  importedAt: string;
  updatedAt: string;
};
/**
 * The core, as one platform transport implements it — the desktop over Tauri IPC
 * (`createTauriAdapter`), the browser over WebAssembly and IndexedDB (`createWebCoreAdapter` in
 * `@atlantis/browser-core`). One method per Rust command, positional arguments in the command's
 * order and wire form (JSON strings stay strings here; `createCoreClient` is where an object is
 * accepted instead). Returns are the types the core serializes; nothing re-validates them.
 */
export interface CoreAdapter {
  getEngineInfo(): Promise<EngineInfo>;
  listGames(): Promise<GameManifest[]>;
  createGame(manifest: GameManifest): Promise<OpenedGame>;
  openGame(gameId: string, openedAt: string): Promise<OpenedGame>;
  deleteGame(gameId: string): Promise<void>;
  /** Empties a game and keeps it: same id, name and ruleset, nothing else. Resolves the fresh game. */
  resetGame(gameId: string, now: string): Promise<OpenedGame>;
  exportGame(gameId: string, exportedAt: string): Promise<string>;
  importGame(backupJson: string, openedAt: string): Promise<OpenedGame>;
  setGameRuleset(gameId: string, rulesetId: string): Promise<GameManifest>;
  /**
   * Records the map a game is played on, or clears it with `""`.
   *
   * Clearing puts the game back to *assuming* its ruleset's declared default, which is the state
   * every game created before the app asked is already in; stating a value is what turns that
   * assumption into the player's own word.
   */
  setGameMap(gameId: string, mapJson: string): Promise<GameManifest>;
  setGameName(gameId: string, gameName: string): Promise<GameManifest>;
  setActiveFaction(gameId: string, factionId: string): Promise<GameManifest>;
  parseReport(rawReport: string): Promise<ReportParseResult>;
  parseReportFull(rawReport: string): Promise<ParsedReport>;
  parseReportClassified(rawReport: string, rulesetJson: string): Promise<ParsedReport>;
  /** Every combat skill the report's battle rosters disclosed, in report order. */
  rosterSkills(rawReport: string): Promise<RosterSkills[]>;
  previewReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<ReportImportPreview>;
  commitReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string,
    rulesetJson: string | null,
    allowOverwrite: boolean,
    importedAt: string
  ): Promise<ImportedTurnPreview>;
  validateOrders(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport: string | null,
    disabledCodes: readonly string[] | null
  ): Promise<OrderValidationResult>;
  orderCommands(): Promise<string[]>;
  /**
   * Every word the rules know, uppercase and sorted: the order names, the grammar's own fixed
   * words, and - when a ruleset is passed - the item and skill tags and the words of their names.
   * What Order OCD uppercases as the player types.
   */
  orderVocabulary(rulesetJson: string | null): Promise<string[]>;
  /**
   * What may stand where the caret is, for the orders editor's completion popup: one order line
   * from its first character to the caret, answered with what the ruleset, the catalogue and the
   * hex allow there. Empty wherever the rules leave the position open, which is most of them.
   *
   * `rulesetJson` and `rawReport` are the served ruleset and the imported turn, when there are
   * any - only their presence widens the answer, since an item or a skill position is otherwise
   * closed. `unitId` is whose block is being typed, which is what makes `BUY`, `SELL` and
   * `PRODUCE` narrow to this unit's own hex.
   */
  orderArgumentCompletions(
    linePrefix: string,
    rulesetJson: string | null,
    rawReport: string | null,
    unitId: string | null
  ): Promise<OrderCompletion[]>;
  /**
   * Where the caret is in one order line, and what may stand there: the one reader of the caret's
   * position, so no shell keeps a rule of its own (ah-vfq). Same four arguments, and the same
   * widening from `rulesetJson`, `rawReport` and `unitId`, as `orderArgumentCompletions`.
   */
  completionsAtCaret(
    linePrefix: string,
    rulesetJson: string | null,
    rawReport: string | null,
    unitId: string | null
  ): Promise<CaretCompletions>;
  /**
   * `mapJson` is the game's own map shape - `{"width":..,"height":..,"wrapX":..,"wrapY":..}` - or
   * the empty string for a game that never recorded one. It is what lets a route into unexplored
   * country cross the wrap seam correctly rather than walking off the map; empty leaves the
   * arithmetic exactly as it was, because a guessed width would put a seam where there is none.
   */
  planRoute(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string,
    mapJson: string
  ): Promise<RoutePlanResponse>;
  /**
   * Where a unit's written movement order takes it, for the map's route overlay.
   *
   * `ordersDocument` is the **whole** document, not one unit's block: a unit standing aboard a
   * ship writes no order of its own and goes where the hull goes, so the order `unitId` travels by
   * may be another unit's (ah-048). The core settles which, once, for this reader and the
   * units-in-hex preview alike.
   */
  traceMoveOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    ordersDocument: string,
    mapJson: string
  ): Promise<MoveOrderTraceResponse>;
  exportMap(rawReport: string, rememberedJson: string, requestJson: string): Promise<string>;
  /**
   * Every named unit written out as a report fragment an ally can read back. `unitIdsJson` is a
   * JSON array of unit ids; the caller decides who is a mage, so the core never asks the ruleset.
   */
  exportMageSheet(rawReport: string, unitIdsJson: string): Promise<string>;
  knownMap(rawReport: string, rulesetJson: string | null, rememberedJson: string): Promise<KnownMap>;
  previewOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    ordersDocument: string,
    mapJson: string
  ): Promise<OrdersPreviewResponse>;
  /** Every trade worth making in the map the faction has seen, best first. */
  tradeRoutes(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    mapJson: string
  ): Promise<TradeRoute[]>;
  loadRegionSightings(
    databasePath: string,
    gameId: string,
    factionId: string
  ): Promise<RememberedRegion[]>;
  mergeReport(
    databasePath: string,
    gameId: string,
    viewerFactionId: string,
    viewerTurnNumber: number,
    rawReport: string,
    rulesetJson: string | null,
    mergedAt: string
  ): Promise<ReportMergeResult>;
  loadMergedReports(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<MergedReportRecord[]>;
  loadImportedTurn(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<ImportedTurnRecord | null>;
  loadLatestImportedTurn(
    databasePath: string,
    gameId: string,
    activeFactionId: string | null
  ): Promise<ImportedTurnRecord | null>;
  listImportedTurns(databasePath: string, gameId: string): Promise<ImportedTurnSummary[]>;
  loadOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<OrderDraftRecord | null>;
  saveOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): Promise<OrderDraftRecord>;
  listHexNotes(databasePath: string, gameId: string): Promise<HexNoteRecord[]>;
  saveHexNote(databasePath: string, note: HexNoteRecord): Promise<HexNoteRecord>;
  deleteHexNote(databasePath: string, gameId: string, noteId: string): Promise<void>;
  listArmies(databasePath: string, gameId: string): Promise<ArmyRecord[]>;
  saveArmy(databasePath: string, army: ArmyRecord): Promise<ArmyRecord>;
  deleteArmy(databasePath: string, gameId: string, armyId: string): Promise<void>;
  listAlliedMages(databasePath: string, gameId: string): Promise<AlliedMageRecord[]>;
  saveAlliedMages(
    databasePath: string,
    gameId: string,
    mages: readonly AlliedMageRecord[],
    removed: readonly AlliedMageKey[]
  ): Promise<void>;
}

/**
 * A game's imported turns in the order every list shows them: turn ascending, then faction id
 * ascending as text ("10" before "9" - the collation both stores always used). The one place this
 * order is written; both adapters return their rows in no particular order.
 */
export function sortImportedTurnSummaries(
  summaries: readonly ImportedTurnSummary[]
): ImportedTurnSummary[] {
  return [...summaries].sort((a, b) =>
    a.key.turnNumber !== b.key.turnNumber
      ? a.key.turnNumber - b.key.turnNumber
      : a.key.factionId < b.key.factionId
        ? -1
        : a.key.factionId > b.key.factionId
          ? 1
          : 0
  );
}

/** A game's hex notes, newest first (`createdAt` desc), `id` asc for stability. The one place this order is written. */
export function sortHexNotes(notes: readonly HexNoteRecord[]): HexNoteRecord[] {
  return [...notes].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * A game's Armies by name, then `id` for stability. The one place this order is written.
 *
 * Name first because the source rail lists them by name; `id` second because duplicate names are
 * allowed - an Army is never identified by its name - so name alone is not a total order and two
 * Armies called "Escort" would otherwise swap places between renders. Both comparisons are on code
 * points, as every other sort in this file is.
 */
export function sortArmies(armies: readonly ArmyRecord[]): ArmyRecord[] {
  return [...armies].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * A game's allied mages by faction id, then unit number, both as text. The one place this order
 * is written; both adapters return their rows in no particular order.
 *
 * As text rather than as numbers, which is the collation every other sort in this file uses -
 * so "10" comes before "9", consistently with `sortImportedTurnSummaries`.
 */
export function sortAlliedMages(mages: readonly AlliedMageRecord[]): AlliedMageRecord[] {
  return [...mages].sort((a, b) => {
    if (a.factionId !== b.factionId) {
      return a.factionId < b.factionId ? -1 : 1;
    }
    const left = a.unit.unitId;
    const right = b.unit.unitId;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * `CoreAdapter` with three ergonomic signatures: an object where the wire takes JSON text, and
 * options where the wire takes a list of disabled codes. Everything else is the adapter as it is —
 * `createCoreClient` is the whole of the difference.
 */
export type CoreClient = Omit<CoreAdapter, "validateOrders" | "exportMap" | "knownMap"> & {
  /**
   * Checks one orders document, and the turn it was written for.
   *
   * `rulesetJson` is the served ruleset when the shell has it. Without it the shape of every order
   * is still checked; only item names go unexamined, and an unrecognised one is a warning anyway.
   *
   * `rawReport` is the imported turn. With it the answer also covers what no amount of reading the
   * text could settle - whether the silver goes round the hex, whether anyone is left guarding it,
   * whether a teacher's students are studying. Without it the answer is the syntax check alone,
   * which is what the pane needs before any report has been imported.
   */
  validateOrders(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport?: string | null,
    options?: OrderCheckOptions
  ): Promise<OrderValidationResult>;
  /**
   * The known map inside one rectangle, written as report-shaped text for an ally to read.
   *
   * `rememberedJson` is the accumulated map exactly as the planner takes it; the current report
   * wins wherever the two describe the same hex. What comes back is the file's whole content -
   * saving it is the shell's business, because the core touches no filesystem.
   *
   * Rejects when the request or the remembered regions cannot be read. A rectangle covering
   * nothing known resolves with a header and no regions.
   */
  exportMap(rawReport: string, rememberedJson: string, request: MapExportRequest): Promise<string>;
  /**
   * Everything the faction knows about the map, resolved once by the core - the same rules the
   * planner and the risk heuristic already use, so a caller building a display over this cannot
   * disagree with either of them about who is in a hex.
   *
   * `rulesetJson` is optional: pass it when it is to hand so units carry exact men counts (a
   * classified parse), and `null` to fall back to the unclassified parse.
   *
   * Rejects only when the remembered regions cannot be read.
   */
  knownMap(
    rawReport: string,
    rulesetJson: string | null,
    remembered: RememberedRegion[]
  ): Promise<KnownMap>;
};

/**
 * The adapter's methods, spread through unchanged, plus the three ergonomic conversions
 * `CoreClient` adds over `CoreAdapter`. Nothing here re-validates what the adapter returns — the
 * Tauri wire is Rust's own serde output and the web adapter is our own code, so both are typed at
 * compile time instead of re-checked per call (ah-wxk.2).
 */
export function createCoreClient(adapter: CoreAdapter): CoreClient {
  return {
    ...adapter,
    validateOrders(rawOrders, rulesetJson, rawReport = null, options = {}) {
      // `null` is "use the core's own default" (`OrderCheckOptions::default()`), so the default
      // lives in Rust once instead of being copied here as a literal.
      return adapter.validateOrders(rawOrders, rulesetJson, rawReport, options.disabledCodes ?? null);
    },
    exportMap(rawReport, rememberedJson, request) {
      return adapter.exportMap(rawReport, rememberedJson, JSON.stringify(request));
    },
    knownMap(rawReport, rulesetJson, remembered) {
      return adapter.knownMap(rawReport, rulesetJson, JSON.stringify(remembered));
    },
    async listImportedTurns(databasePath, gameId) {
      return sortImportedTurnSummaries(await adapter.listImportedTurns(databasePath, gameId));
    },
    async listHexNotes(databasePath, gameId) {
      return sortHexNotes(await adapter.listHexNotes(databasePath, gameId));
    },
    async listArmies(databasePath, gameId) {
      return sortArmies(await adapter.listArmies(databasePath, gameId));
    },
    async listAlliedMages(databasePath, gameId) {
      return sortAlliedMages(await adapter.listAlliedMages(databasePath, gameId));
    }
  };
}

export { createTauriAdapter, TAURI_COMMANDS, type TauriInvoke } from "./tauriCommands";
