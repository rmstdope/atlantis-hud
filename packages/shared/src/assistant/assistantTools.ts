/**
 * The tools an assistant such as Claude Code is given over the turn on screen.
 *
 * The desktop shell serves these over MCP (`crates/assistant-mcp`) and hands every call here: this
 * module is where the answers are made, from the same report, orders document and validator the
 * player sees. Plain functions of an {@link AssistantHost}, so every tool is testable without a
 * window, a server or a running core.
 *
 * Answers are compact JSON, or plain numbered lines for report text. They are read by a model, not
 * a person, so they say exactly what the HUD knows and nothing it would have to guess.
 */

import type {
  ArmyMemberRecord,
  ArmyRecord,
  Coordinate,
  KnownMap,
  KnownMapHex,
  OrderDiagnostic,
  OrdersPreviewResponse,
  OrderValidationResult,
  ParsedReport,
  ProductionOverview,
  ReportRegion,
  ReportUnit,
  RoutePlanResponse,
  UnitPreview,
  UnitSilver,
  WorkedRegion
} from "@atlantis/core-client";
import { regionIdOf } from "../hexMapModel";
import type { ArmiesState } from "../armiesStore";
import { memberIsStale } from "../armies";
import { battleFileOf, battleFileText, exportReadiness } from "../armyExport";
import type { DerivedSkills } from "../battleSkills";
import type { OrderProcessing } from "../orderProcessing";
import { editsSinceSeen, noteSeen, type AssistantSeen } from "./assistantSeen";
import { silverShown } from "../unitTable";
import { describeEstimate, describeLoadCheck, describeProblem } from "../workspace/PlannerPanel";

/** The turn on screen, as the tools read it. */
export interface AssistantTurn {
  readonly gameId: string;
  readonly gameName: string;
  readonly rulesetId: string | null;
  /** The game data as served, or `null` while it is still loading. */
  readonly rulesetText: string | null;
  readonly parsed: ParsedReport;
  readonly rawReport: string;
  readonly ordersDocument: string;
  /**
   * Everything the HUD knows about the map, as the screen draws it: this report's regions and those
   * remembered from earlier ones. `null` while it is not resolved, or could not be.
   */
  readonly knownMap: KnownMap | null;
}

/** What the shell lends the tools: the turn, and the two things only the shell can do with it. */
export interface AssistantHost {
  /** The turn on screen, or `null` while no game or no report is open. Read afresh on each call. */
  turn(): AssistantTurn | null;
  readonly orders: OrderProcessing;
  /** The banner a new block for a unit in this region goes under, or `null` when it cannot say. */
  bannerFor(regionId: string): string | null;
  /** The HUD's own validation of `document`, against everything else on screen. */
  validate(document: string): Promise<OrderValidationResult>;
  /**
   * The HUD's own preview of `document` - what the map and the unit table show for the coming
   * month - against everything else on screen. Rejects while the game data has not loaded.
   */
  preview(document: string): Promise<OrdersPreviewResponse>;
  /**
   * The HUD's own route planner - the one the Movement panel asks - for `unitId` to `destination`
   * (`z:x,y`), over the map the HUD remembers. `carryingJson` is empty, or a JSON object of item
   * tag to how many the unit will hold when it moves. Rejects while the game data has not loaded.
   */
  planRoute(unitId: string, destination: string, carryingJson: string): Promise<RoutePlanResponse>;
  /**
   * Applies `update`, which rewrites `unitId`'s block, to the document as it stands when the write
   * lands - which may hold something typed since the tool read it - and saves the result.
   */
  writeOrders(update: (document: string) => string, unitId: string): void;
  /** What the assistant last read or wrote of each unit's orders, kept between calls. */
  readonly seen: AssistantSeen;
  /** The open game's Armies; `loading` until they are read, `failed` when they could not be. */
  armies(): readonly ArmyRecord[] | "loading" | "failed";
  /** What the battle-roster scan has recovered so far, as the Army export dialog reads it. */
  battleSkills(): { readonly skills: DerivedSkills; readonly scanning: boolean; readonly unreadTurns: number };
  /**
   * Writes `text` to `path`, replacing a battle file already there but no other file; rejects with
   * a sentence saying why it could not.
   */
  writeFile(path: string, text: string): Promise<void>;
}

/**
 * The Armies the tools may answer from: the store's list once it has loaded for the open game.
 * A list still loading, or one left over from another game, is `loading` - the open game's load is
 * on its way - and only a failed load of the open game's own is `failed`, since retrying will not help.
 */
export function readyArmies(
  state: Pick<ArmiesState, "gameId" | "status" | "armies">,
  gameId: string
): readonly ArmyRecord[] | "loading" | "failed" {
  if (state.gameId !== gameId) {
    return "loading";
  }
  if (state.status === "error") {
    return "failed";
  }
  return state.status === "ready" ? state.armies : "loading";
}

/** One tool as MCP lists it. */
export interface AssistantToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly properties: Record<string, unknown>; readonly required?: readonly string[] };
}

/** An answer as the relay hands it back: text for the model, and whether it is a refusal. */
export interface AssistantAnswer {
  readonly text: string;
  readonly isError: boolean;
}

const UNIT_ID = { type: "string", description: "The unit's number, e.g. \"1234\"." };

export const ASSISTANT_TOOLS: readonly AssistantToolDefinition[] = [
  {
    name: "get_turn_overview",
    description:
      "Start here. The open game, the faction, the turn number and month, the faction's status (points used per category), declared attitudes, unclaimed silver, and how many units, regions, events and problems there are.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_units",
    description:
      "The faction's own units this turn, one line each: id, name, region, men, items, skills (tag level (days)) and the orders currently written for it. Pass regionId to see one region only, includeForeign to include other factions' units.",
    inputSchema: {
      type: "object",
      properties: {
        regionId: { type: "string", description: "Only units in this region, as list_regions names it, e.g. \"1:12,4\"." },
        includeForeign: { type: "boolean", description: "Include units of other factions." }
      }
    }
  },
  {
    name: "get_unit",
    description:
      "One unit in full as the report shows it (flags, items, skills, movement, capacity, structure, description), with the orders currently written for it and every problem the HUD's validator finds in them.",
    inputSchema: { type: "object", properties: { unitId: UNIT_ID }, required: ["unitId"] }
  },
  {
    name: "list_regions",
    description:
      "Every region in this turn's report, one line each: id, terrain, coordinates, province, settlement, population, tax base, wages, which own units stand there and how many foreign ones.",
    inputSchema: {
      type: "object",
      properties: { onlyWithOwnUnits: { type: "boolean", description: "Only regions where the faction has units." } }
    }
  },
  {
    name: "get_region",
    description:
      "One region in full: products, market (wanted and for sale), exits, structures, gate, and every unit in it. Name it by regionId or by x, y and z coordinates. A region this report does not show is answered from the HUD's map of earlier reports, marked remembered: true (false only for a hex seen this turn by someone else, e.g. an ally), with how it is known (knowledge), the turn it was last seen (lastSeenTurn), what it held then, and the units last seen there - who may since have moved.",
    inputSchema: {
      type: "object",
      properties: {
        regionId: { type: "string", description: "As list_regions names it, e.g. \"1:12,4\"." },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number", description: "The level. Needed when x and y exist on more than one." }
      }
    }
  },
  {
    name: "get_forecast",
    description:
      "What the HUD forecasts this month's orders leave a unit, or every own unit in a hex, with: status (present, departing, arriving, or unchanged when its orders change nothing), men, items and skills at month end, the item changes in the month's order, what is produced, built and created, casts the game refuses, transports sent and received, where its study lands, and its silver - held, in, out, upkeep, at month end before and after upkeep, how much its orders are short and on what, and orders refused for want of silver. The same figures the HUD's preview shows; silver is in the silver figures, never in the items. A unit that moves this month is listed twice, departing where it stands and arriving where it ends, both rows carrying the same month - count it once. Name a unit by unitId, or a hex by regionId or x, y and z.",
    inputSchema: {
      type: "object",
      properties: {
        unitId: UNIT_ID,
        regionId: { type: "string", description: "As list_regions names it, e.g. \"1:12,4\"." },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number", description: "The level. Needed when x and y exist on more than one." }
      }
    }
  },
  {
    name: "list_known_regions",
    description:
      "Every region the HUD's map knows - this report's and those remembered from earlier reports - one line each: id, terrain, coordinates, province, how it is known (current: this turn; stale: an earlier report; named: only an exit has named it), the turn it was last seen, settlement, structures and how many units were seen there. Narrow it to an area with z and xMin/xMax/yMin/yMax, or to one terrain. At most 500 lines; leftOut says how many more matched, so narrow the area. get_region gives one in full.",
    inputSchema: {
      type: "object",
      properties: {
        z: { type: "number", description: "Only this level." },
        xMin: { type: "number" },
        xMax: { type: "number" },
        yMin: { type: "number" },
        yMax: { type: "number" },
        terrain: { type: "string", description: "Only this terrain, e.g. \"plain\"." }
      }
    }
  },
  {
    name: "plan_route",
    description:
      "The route the HUD's route planner - the one its Movement panel uses - finds for an own unit to a hex, over the map the HUD remembers: the order it becomes (MOVE ..., or SAIL ... for a fleet), exactly as the panel would write it; whether it walks, rides, flies or sails; movementPoints, the total cost; months, how many months it takes, with where each month ends; each step's terrain and cost, a road, an unexplored (estimated) hex; and the risk along it. When there is no route, problem and reason say why - not an error, a fact to plan around. Name the destination by regionId or x, y and z (z left out is the unit's own level). Pass carrying to plan for the unit as it will be loaded when it moves, after this month's GIVE and TAKE: item tag to how many it will hold, e.g. {\"HORS\": 4, \"LIVE\": 2}; each tag named replaces what the report shows, 0 drops it, the rest stay as reported. Writes nothing: give the order with set_unit_orders.",
    inputSchema: {
      type: "object",
      properties: {
        unitId: UNIT_ID,
        regionId: { type: "string", description: "The destination, as list_known_regions names it, e.g. \"1:12,4\"." },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number", description: "The level. The unit's own when left out." },
        carrying: {
          type: "object",
          description: "Item tag to how many the unit will hold when it moves, e.g. {\"HORS\": 4}.",
          additionalProperties: { type: "number" }
        }
      },
      required: ["unitId"]
    }
  },
  {
    name: "get_production",
    description:
      "What this month's orders produce against what each region offers, as the HUD's production overview forecasts it. For each product a region's Products line lists (advanced resources included when the region shows them): available (the region's amount), produced (the forecast output), spare (available - produced: idle capacity), beyondCap (what producers could have made but the region's amount stopped: wasted effort), and each own unit producing it with what it makes, couldMake (what its men alone would make), asked (a numbered PRODUCE's count) and cappedBy. Name one region by regionId or x, y and z; with none, every region worked this month (worked: true) plus every region with own units where nothing is produced, taxed or pillaged (worked: false), with totals per product, the region limits and how many regions the orders use.",
    inputSchema: {
      type: "object",
      properties: {
        regionId: { type: "string", description: "As list_regions names it, e.g. \"1:12,4\"." },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number", description: "The level. Needed when x and y exist on more than one." }
      }
    }
  },
  {
    name: "get_silver_shortfalls",
    description:
      "Where the faction's silver runs short this month, hex by hex, as the HUD forecasts it: every own unit whose orders are short of silver, that ends the month below zero once upkeep is paid, that has an order the game refuses for want of silver, or whose month could not be priced at all. Empty regions mean nobody is short. Also how much of the unclaimed fund the orders use.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_turn_events",
    description:
      "What happened last month: the faction's events and errors as the report lists them, the battles fought, and moves the report says were blocked.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_orders",
    description:
      "The orders document as it stands in the player's editor, or with unitId just that unit's block (the lines below its 'unit' line).",
    inputSchema: { type: "object", properties: { unitId: UNIT_ID } }
  },
  {
    name: "set_unit_orders",
    description:
      "Replace one own unit's orders with the given lines (everything below its 'unit' line; FORM ... END blocks for new units go here too). The player sees the change in their editor at once and it is saved. Answers with the problems the HUD's validator finds in that unit's orders afterwards - fix them before moving on.",
    inputSchema: {
      type: "object",
      properties: {
        turnKey: {
          type: "string",
          description: "The turnKey from get_turn_overview. A write for any other turn is refused."
        },
        unitId: UNIT_ID,
        orders: {
          type: "string",
          description: "The unit's complete orders, one order per line, without its 'unit' line."
        }
      },
      required: ["turnKey", "unitId", "orders"]
    }
  },
  {
    name: "list_order_edits",
    description:
      "The own units whose orders changed since you last read them (get_orders, get_unit, list_units) or wrote them (set_unit_orders) - usually the player editing them - each with the orders as you last saw them (before) and as they stand now. Call it before advising on or writing orders you read earlier. Units you have not read this turn are not listed. This answer counts as reading the units it lists.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "validate_orders",
    description:
      "Every problem the HUD's validator finds in the whole orders document - errors the game would reject, and warnings about orders that will not do what they look like - each with its unit and line.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_game_data",
    description:
      "Look an item, skill or building up in this game's data by tag (e.g. \"SWOR\", \"COMB\") or by name: what it needs, what it costs, what it gives.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "A tag or a name." } },
      required: ["query"]
    }
  },
  {
    name: "list_armies",
    description:
      "The Armies the player has saved in the HUD, each with its members as last seen: unit, faction, men, items, skills, whether it fights from behind, its combat spell, and whether it was missing from this turn's report. An Army is what export_battle_file writes out for a battle simulator.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "export_battle_file",
    description:
      "Write the battle file the HUD's Export button writes for an Army - one JSON file that both the atlantis.pekle.lv and the New Age battle simulators load - to a path you choose. Name the attacking and the defending Army by id or by name (from list_armies); one side may be left out. Answers with the path written, the number of units, and the caveats the Export dialog would show (units not seen this turn, foreign units without known skills, an empty side).",
    inputSchema: {
      type: "object",
      properties: {
        attackers: { type: "string", description: "The attacking Army's id or name." },
        defenders: { type: "string", description: "The defending Army's id or name." },
        path: {
          type: "string",
          description: "Where to write the file: an absolute path ending in .json, in a folder that exists. A battle file already there is replaced; any other file there is kept and the write refused."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "search_report",
    description:
      "Search the report's own text, case-insensitively, for anything the other tools do not cover. Answers with matching lines, numbered for read_report.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "read_report",
    description: "Read a stretch of the report's own text, with line numbers. At most 1000 lines per call.",
    inputSchema: {
      type: "object",
      properties: {
        fromLine: { type: "number", description: "The first line, counted from 1." },
        lineCount: { type: "number", description: "How many lines; 200 when left out." }
      }
    }
  }
];

const MAX_SEARCH_HITS = 200;
const MAX_READ_LINES = 1000;
const MAX_KNOWN_REGIONS = 500;

class Refusal extends Error {}

function refuse(message: string): never {
  throw new Refusal(message);
}

function ok(value: unknown): AssistantAnswer {
  return { text: typeof value === "string" ? value : JSON.stringify(value), isError: false };
}

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" ? value : String(value);
}

function requiredString(args: Record<string, unknown>, name: string): string {
  return stringArg(args, name) ?? refuse(`"${name}" is required.`);
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function regionLabel(region: { terrain: string; coordinate: Coordinate; province: string }): string {
  const { x, y, z } = region.coordinate;
  return `${region.terrain} (${x},${y},${z}) in ${region.province}`;
}

function hexIdOf(hex: KnownMapHex): string {
  return hex.region?.regionId ?? regionIdOf(hex.coordinate);
}

/** A hex the report does not describe, as the map remembers it. */
function rememberedRegion(hex: KnownMapHex, currentTurn: number | null) {
  const known = {
    remembered: hex.knowledge !== "current",
    knowledge: hex.knowledge,
    lastSeenTurn: hex.lastSeenTurn,
    currentTurn,
    regionId: hexIdOf(hex),
    region: regionLabel(hex),
    terrain: hex.terrain,
    province: hex.province,
    settlement: hex.settlement
  };
  const { region } = hex;
  if (region === null) {
    return { ...known, note: "No report has described this hex; only an exit of a neighbouring region has named it." };
  }
  return {
    ...known,
    exits: region.exits,
    structures: region.structures,
    gate: region.gate,
    population: region.population,
    race: region.race,
    taxBase: region.taxBase,
    wages: region.wages,
    products: region.products,
    wanted: region.wanted,
    forSale: region.forSale,
    unitsLastSeen: [
      ...region.units.map((unit) => ({ unit, lastSeenTurn: hex.lastSeenTurn })),
      ...hex.rememberedUnits
    ].map(({ unit, lastSeenTurn }) => ({
      unitId: unit.unitId,
      name: unit.name,
      faction: unit.factionName ?? unit.factionId ?? "unknown",
      men: unit.men,
      lastSeenTurn
    }))
  };
}

function skillsLine(unit: ReportUnit): string {
  return unit.skills.map((skill) => `${skill.tag} ${skill.level} (${skill.points})`).join(", ");
}

function itemsLine(unit: ReportUnit): string {
  return unit.items.map((item) => `${item.amount} ${item.tag}`).join(", ");
}

/**
 * One problem as a line of text. `scope` is whose lines the number counts: the whole document's,
 * or - for a problem `diagnosticsForUnit` picked out - the unit's own block's, from 1.
 */
function problemLine(diagnostic: OrderDiagnostic, scope: "document" | "unit"): string {
  const unit = scope === "document" && diagnostic.unitId ? `unit ${diagnostic.unitId} ` : "";
  const where = scope === "unit" ? "its line" : "line";
  const line = diagnostic.lineStart === null ? "" : `${where} ${diagnostic.lineStart} `;
  return `${unit}${line}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

function findUnit(parsed: ParsedReport, unitId: string): { unit: ReportUnit; region: ReportRegion } | null {
  for (const region of parsed.regions) {
    const unit = region.units.find((candidate) => candidate.unitId === unitId);
    if (unit) {
      return { unit, region };
    }
  }
  return null;
}

function unitIdsOf(region: ReportRegion): ReadonlySet<string> {
  return new Set(region.units.map((unit) => unit.unitId));
}

function unitOrders(host: AssistantHost, turn: AssistantTurn, unitId: string, region: ReportRegion): string | null {
  return host.orders.readUnitOrders(turn.ordersDocument, unitId, unitIdsOf(region));
}

function lookupGameData(rulesetText: string, query: string): { kind: string; tag: string; data: unknown }[] {
  const data = JSON.parse(rulesetText) as Record<string, unknown>;
  const entries: { kind: string; tag: string; data: unknown }[] = [];
  for (const kind of ["items", "skills", "buildings"]) {
    const section = data[kind];
    if (section && typeof section === "object") {
      for (const [tag, entry] of Object.entries(section as Record<string, unknown>)) {
        entries.push({ kind, tag, data: entry });
      }
    }
  }
  const wanted = query.trim().toLowerCase();
  const nameOf = (entry: { data: unknown }): string => {
    const name = (entry.data as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name.toLowerCase() : "";
  };
  const exact = entries.filter((entry) => entry.tag.toLowerCase() === wanted || nameOf(entry) === wanted);
  if (exact.length > 0) {
    return exact;
  }
  return entries.filter((entry) => entry.tag.toLowerCase().includes(wanted) || nameOf(entry).includes(wanted));
}

function numberedLines(lines: readonly string[], from: number): string {
  return lines.map((line, index) => `${from + index}: ${line}`).join("\n");
}

/**
 * The region `args` names by `regionId` or by `x`, `y` and `z`, or a refusal saying why there is
 * none. `get_region` and `get_forecast` read regions the same way.
 */
function findRegion(parsed: ParsedReport, args: Record<string, unknown>): ReportRegion {
  const regionId = stringArg(args, "regionId");
  const x = numberArg(args, "x");
  const y = numberArg(args, "y");
  const z = numberArg(args, "z");
  if (regionId === undefined && z === undefined) {
    const levels = parsed.regions.filter((candidate) => candidate.coordinate.x === x && candidate.coordinate.y === y);
    if (levels.length > 1) {
      refuse(`(${x},${y}) is on several levels; say which with z: ${levels.map((level) => level.coordinate.z).join(", ")}.`);
    }
  }
  const region = parsed.regions.find((candidate) =>
    regionId !== undefined
      ? candidate.regionId === regionId
      : candidate.coordinate.x === x &&
        candidate.coordinate.y === y &&
        (z === undefined || candidate.coordinate.z === z)
  );
  return region ?? refuse("This turn's report shows no such region. list_regions names every one it does.");
}

/**
 * A unit's silver as the HUD forecasts it: the Silver column's figures and, unless `ledger` is
 * false, the working behind them.
 */
function silverForecast(silver: UnitSilver, ledger = true) {
  return {
    held: silver.held,
    income: silver.income,
    lateIncome: silver.lateIncome,
    expense: silver.expense,
    upkeep: silver.upkeep,
    atMonthEnd: silver.atMonthEnd,
    atMonthEndAfterUpkeep: silverShown(silver, true),
    shortForOrders: silver.shortForOrders,
    shortOn: silver.shortOn,
    doubt: silver.doubt,
    doubtSubject: silver.doubtSubject,
    refused: silver.refused,
    ...(ledger ? { changes: silver.changes } : {})
  };
}

/** Whether a value says anything: an empty list, `false` and `null` are left out of an answer. */
function says(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== false && value !== null && value !== undefined;
}

/** Only the entries of `fields` that say something, so the model is not handed a page of empties. */
function present(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => says(value)));
}

/** One unit's forecast: its preview row, or the report's unit where the orders change nothing. */
function unitForecast(
  regionId: string,
  row: UnitPreview | { status: "unchanged"; unit: ReportUnit },
  silver: UnitSilver | undefined
) {
  const { unit } = row;
  const preview = row.status === "unchanged" ? null : (row as UnitPreview);
  return {
    unitId: unit.unitId,
    name: unit.name,
    regionId,
    status: row.status,
    ...present({
      arrivingFrom: preview?.arrivingFrom,
      departingTo: preview?.departingTo,
      aboard: preview?.aboard
    }),
    men: unit.men,
    // Silver is the `silver` figures' to say: the preview's SILV item is settled by a different pass
    // and is not the Silver column's figure, so a model handed both would be handed two answers.
    itemsAtMonthEnd: itemsLine({ ...unit, items: unit.items.filter((item) => item.tag !== "SILV") }),
    skillsAtMonthEnd: skillsLine(unit),
    ...(preview
      ? present({
          formed: preview.formed,
          dissolving: preview.dissolving,
          dissolvesInto: preview.dissolvesInto,
          itemChanges: preview.itemChanges,
          produced: preview.produced,
          built: preview.built,
          created: preview.created,
          refusedCasts: preview.refusedCasts,
          transportSent: preview.transportSent,
          transportReceived: preview.transportReceived,
          transportTargetIssues: preview.transportTargetIssues,
          shipmentUnmeasured: preview.shipmentUnmeasured,
          uncounted: preview.uncounted,
          recruitsUnmerged: preview.recruitsUnmerged,
          study: preview.study,
          newShip: preview.newShip
        })
      : {}),
    ...(silver ? { silver: silverForecast(silver) } : {})
  };
}

/** One product's figures, shared by a region's line and the faction-wide totals. */
function productFigures(tag: string, name: string, available: number | null, produced: number, beyondCap: number) {
  return { tag, name, available, produced, spare: available === null ? null : available - produced, beyondCap };
}

/**
 * `get_production`'s answer: `region` alone, or faction-wide every region the overview lists plus
 * every own region it does not (worked: false), with totals per product.
 */
function productionAnswer(
  parsed: ParsedReport,
  overview: ProductionOverview,
  silver: readonly UnitSilver[],
  region: ReportRegion | null
) {
  const worked = new Map(overview.regions.map((row) => [row.regionId, row] as const));
  const silverOf = (regionId: string, unitId: string) =>
    silver.find((row) => row.regionId === regionId && row.unitId === unitId);
  const nameOf = (regionId: string, unitId: string) =>
    parsed.regions.find((candidate) => candidate.regionId === regionId)?.units.find((unit) => unit.unitId === unitId)?.name ??
    silverOf(regionId, unitId)?.formed?.alias ??
    null;
  const regionAnswer = (report: ReportRegion, row: WorkedRegion | undefined) => ({
    regionId: report.regionId,
    region: regionLabel(report),
    worked: row !== undefined,
    orders: (row?.orders ?? []).map((order) => (order.crafted === null ? order.kind : `${order.kind} ${order.crafted}`)),
    resources: row
      ? row.resources.map((resource) => {
          const producers = resource.producers.map(({ regionId, unitId }) => {
            const unit = silverOf(regionId, unitId);
            return {
              unitId,
              name: nameOf(regionId, unitId),
              produced: unit?.produced ?? null,
              couldMake: unit?.productionWanted ?? null,
              asked: unit?.productionRequested ?? null,
              cappedBy: unit?.productionCappedBy ?? null,
              sharedWithForeign: unit?.productionForeignSharer ?? false
            };
          });
          const beyondCap = producers
            .filter((producer) => producer.cappedBy === "region")
            .reduce((sum, producer) => sum + Math.max(0, (producer.couldMake ?? 0) - (producer.produced ?? 0)), 0);
          return { ...productFigures(resource.tag, resource.name, resource.available, resource.produced, beyondCap), producers };
        })
      : report.products.map((product) => ({ ...productFigures(product.tag, product.name, product.amount, 0, 0), producers: [] }))
  });

  if (region !== null) {
    return { regions: [regionAnswer(region, worked.get(region.regionId))] };
  }
  const regions = parsed.regions
    .filter((report) => worked.has(report.regionId) || report.units.some((unit) => unit.own))
    .map((report) => regionAnswer(report, worked.get(report.regionId)));
  const totals = new Map<string, ReturnType<typeof productFigures>>();
  for (const resource of regions.flatMap((row) => row.resources)) {
    const before = totals.get(resource.tag);
    const available =
      before === undefined ? resource.available : before.available === null || resource.available === null ? null : before.available + resource.available;
    totals.set(
      resource.tag,
      productFigures(
        resource.tag,
        before?.name ?? resource.name,
        available,
        (before?.produced ?? 0) + resource.produced,
        (before?.beyondCap ?? 0) + resource.beyondCap
      )
    );
  }
  return { limits: overview.limits, regionsUsed: overview.used, regions, totals: [...totals.values()] };
}

/** Whether the HUD's forecast says this unit's silver runs short, or cannot say it does not. */
function runsShort(silver: UnitSilver): boolean {
  const afterUpkeep = silverShown(silver, true);
  return (
    (silver.shortForOrders ?? 0) > 0 ||
    (afterUpkeep !== null && afterUpkeep < 0) ||
    silver.refused.length > 0 ||
    silver.doubt !== null
  );
}

/** Whose a member is, as a model reads it: `own`, `Name (id)`, or `unknown` for a hidden faction. */
function factionOf(member: ArmyMemberRecord): string {
  if (member.own) {
    return "own";
  }
  if (member.factionName !== null && member.factionId !== null) {
    return `${member.factionName} (${member.factionId})`;
  }
  return member.factionName ?? member.factionId ?? "unknown";
}

function armyMemberRow(member: ArmyMemberRecord, currentTurn: number | null) {
  return {
    unitId: member.unitId,
    name: member.name,
    faction: factionOf(member),
    men: member.men,
    regionId: member.regionId,
    seenTurn: member.seenTurn,
    notInThisTurn: currentTurn !== null && memberIsStale(member, currentTurn),
    items: member.items.map((item) => `${item.amount} ${item.tag}`).join(", "),
    skills: member.skills.map((skill) => `${skill.tag} ${skill.level}`).join(", "),
    behind: member.flags.includes("behind"),
    combatSpell: member.combatSpell?.tag ?? null
  };
}

function savedArmies(host: AssistantHost): readonly ArmyRecord[] {
  const armies = host.armies();
  if (armies === "loading") {
    refuse("The HUD is still loading this game's Armies; try again in a moment.");
  }
  if (armies === "failed") {
    refuse("The HUD could not read this game's Armies. Ask the player to open the game again.");
  }
  return armies;
}

/** The Army an argument names, by id or else by name ignoring case; `null` when it names none. */
function namedArmy(armies: readonly ArmyRecord[], args: Record<string, unknown>, side: string): ArmyRecord | null {
  const wanted = stringArg(args, side)?.trim();
  if (wanted === undefined || wanted === "") {
    return null;
  }
  const byId = armies.find((army) => army.id === wanted);
  if (byId) {
    return byId;
  }
  const byName = armies.filter((army) => army.name.toLowerCase() === wanted.toLowerCase());
  if (byName.length > 1) {
    refuse(`Several Armies are called "${wanted}"; name one by id: ${byName.map((army) => army.id).join(", ")}.`);
  }
  return byName[0] ?? refuse(`No Army is called "${wanted}". list_armies names every one the player has saved.`);
}

/**
 * The hex `args` names as a route's destination, `z:x,y` as the planner reads it: a region this
 * report shows or the map remembers by `regionId`, an identifier already in that form, or `x`, `y`
 * and `z` - `z` the unit's own level when left out.
 */
function routeDestination(turn: AssistantTurn, args: Record<string, unknown>, unitRegion: ReportRegion): string {
  const regionId = stringArg(args, "regionId");
  if (regionId !== undefined) {
    const shown = turn.parsed.regions.find((region) => region.regionId === regionId);
    const remembered = turn.knownMap?.hexes.find((hex) => hexIdOf(hex) === regionId);
    const coordinate = shown?.coordinate ?? remembered?.coordinate;
    if (coordinate) {
      return regionIdOf(coordinate);
    }
    if (/^-?\d+:-?\d+,-?\d+$/u.test(regionId.trim())) {
      return regionId.trim();
    }
    refuse(`No region ${regionId} is known to this turn's report or the HUD's map. list_known_regions names every one the map knows.`);
  }
  const x = numberArg(args, "x");
  const y = numberArg(args, "y");
  if (x === undefined || y === undefined) {
    refuse("Name the destination by regionId, or by x and y (and z).");
  }
  return regionIdOf({ x, y, z: numberArg(args, "z") ?? unitRegion.coordinate.z });
}

/** `carrying` as the planner reads it, every tag checked against the game data, or a refusal. */
function carryingJsonOf(rulesetText: string, carrying: unknown): string {
  if (carrying === undefined || carrying === null) {
    return "";
  }
  if (typeof carrying !== "object" || Array.isArray(carrying)) {
    refuse('"carrying" must be an object of item tag to amount, e.g. {"HORS": 4}.');
  }
  const items = (JSON.parse(rulesetText) as { items?: Record<string, unknown> }).items ?? {};
  const known = new Set(Object.keys(items).map((tag) => tag.toUpperCase()));
  const held: Record<string, number> = {};
  for (const [tag, amount] of Object.entries(carrying as Record<string, unknown>)) {
    const upper = tag.trim().toUpperCase();
    if (!known.has(upper)) {
      refuse(`The game data has no item tagged ${tag}; get_game_data looks one up by name.`);
    }
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
      refuse(`How many ${upper} the unit will hold must be a whole number, 0 or more.`);
    }
    held[upper] = amount;
  }
  return JSON.stringify(held);
}

/** A planner's answer for the model: the route, or why there is none. */
function routeAnswer(unitId: string, destination: string, response: RoutePlanResponse, carried: boolean) {
  const { plan } = response;
  if (plan === null) {
    return {
      unitId,
      to: destination,
      problem: response.problem,
      reason: response.problem ? describeProblem(response.problem) : "The planner found no route and gave no reason."
    };
  }
  const notes = [
    describeEstimate(plan.steps),
    describeLoadCheck(plan),
    response.fullyModelled ? null : "Not everything about movement is modelled (weather, today), so the cost is a lower bound.",
    carried && plan.mode === "sail"
      ? "A fleet is weighed as the report shows the units aboard; what this unit was given to carry does not change it."
      : null
  ].filter((note): note is string => note !== null);
  return {
    unitId,
    from: regionIdOf(plan.from),
    to: regionIdOf(plan.to),
    mode: plan.mode,
    order: plan.order,
    movementPoints: plan.totalCost,
    months: plan.months.length,
    monthLegs: plan.months.map((leg) => ({ month: leg.month, steps: leg.steps, endsAt: regionIdOf(leg.endsAt) })),
    steps: plan.steps.map((step) => ({
      direction: step.direction,
      regionId: regionIdOf(step.to),
      terrain: step.terrain,
      cost: step.cost,
      ...present({ road: step.road, canal: step.canal ?? null, estimated: step.estimated, overWater: step.overWater })
    })),
    ...(response.risk ? { risk: { level: response.risk.level, worst: response.risk.worst } } : {}),
    ...(notes.length > 0 ? { notes } : {})
  };
}

/** Names the turn on screen, so a write can say which turn it was worked out for. */
function turnKeyOf(turn: AssistantTurn): string {
  return `${turn.gameId}/${turn.parsed.header.factionId}/${turn.parsed.header.turnNumber}`;
}

/** Remembers that the assistant has been shown, or has written, these units' orders. */
function noteShown(host: AssistantHost, turn: AssistantTurn, orders: Iterable<readonly [string, string]>): void {
  noteSeen(host.seen, turnKeyOf(turn), orders);
}

/** Every own unit's orders as they stand, in report order. */
function ownUnitOrders(host: AssistantHost, turn: AssistantTurn): Map<string, string> {
  return new Map(
    turn.parsed.regions.flatMap((region) =>
      region.units
        .filter((unit) => unit.own)
        .map((unit) => [unit.unitId, unitOrders(host, turn, unit.unitId, region) ?? ""] as const)
    )
  );
}

async function answer(host: AssistantHost, turn: AssistantTurn, name: string, args: Record<string, unknown>) {
  const { parsed } = turn;
  const ownUnits = parsed.regions.flatMap((region) => region.units.filter((unit) => unit.own));

  switch (name) {
    case "get_turn_overview": {
      const validation = await host.validate(turn.ordersDocument);
      const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
      return ok({
        turnKey: turnKeyOf(turn),
        game: turn.gameName,
        ruleset: turn.rulesetId,
        faction: { id: parsed.header.factionId, name: parsed.header.factionName, types: parsed.header.factionTypes },
        turn: parsed.header.turnNumber,
        month: parsed.header.month,
        year: parsed.header.year,
        unclaimedSilver: parsed.header.unclaimedSilver,
        factionStatus: parsed.header.factionStatus,
        attitudes: parsed.header.attitudes,
        ownUnits: ownUnits.length,
        regionsInReport: parsed.regions.length,
        regionsWithOwnUnits: parsed.regions.filter((region) => region.units.some((unit) => unit.own)).length,
        events: parsed.header.events.length,
        reportErrors: parsed.header.errors.length,
        battles: parsed.battles.length,
        orderProblems: { errors, warnings: validation.diagnostics.length - errors }
      });
    }

    case "list_units": {
      const regionId = stringArg(args, "regionId");
      const includeForeign = args.includeForeign === true;
      if (regionId !== undefined && !parsed.regions.some((region) => region.regionId === regionId)) {
        refuse(`This turn's report shows no region ${regionId}. list_regions names every one it does.`);
      }
      const rows = parsed.regions
        .filter((region) => regionId === undefined || region.regionId === regionId)
        .flatMap((region) =>
          region.units
            .filter((unit) => includeForeign || unit.own)
            .map((unit) => ({
              unitId: unit.unitId,
              name: unit.name,
              ...(unit.own ? {} : { faction: unit.factionName ?? unit.factionId ?? "unknown" }),
              regionId: region.regionId,
              region: regionLabel(region),
              men: unit.men,
              items: itemsLine(unit),
              skills: skillsLine(unit),
              ...(unit.own ? { orders: unitOrders(host, turn, unit.unitId, region) ?? "" } : {})
            }))
        );
      noteShown(host, turn, rows.flatMap((row) => (row.orders === undefined ? [] : [[row.unitId, row.orders] as const])));
      return ok(rows);
    }

    case "get_unit": {
      const unitId = requiredString(args, "unitId");
      const found = findUnit(parsed, unitId) ?? refuse(`This turn's report shows no unit ${unitId}.`);
      const orders = found.unit.own ? unitOrders(host, turn, unitId, found.region) : null;
      const validation = found.unit.own ? await host.validate(turn.ordersDocument) : null;
      const problems = validation
        ? host.orders
            .diagnosticsForUnit(turn.ordersDocument, unitId, validation.diagnostics, unitIdsOf(found.region))
            .map((diagnostic) => problemLine(diagnostic, "unit"))
        : [];
      if (found.unit.own) {
        noteShown(host, turn, [[unitId, orders ?? ""]]);
      }
      return ok({ unit: found.unit, region: regionLabel(found.region), orders, problems });
    }

    case "list_regions": {
      const onlyOwn = args.onlyWithOwnUnits === true;
      return ok(
        parsed.regions
          .filter((region) => !onlyOwn || region.units.some((unit) => unit.own))
          .map((region) => ({
            regionId: region.regionId,
            region: regionLabel(region),
            settlement: region.settlement,
            population: region.population,
            race: region.race,
            taxBase: region.taxBase,
            wages: region.wages,
            ownUnits: region.units.filter((unit) => unit.own).map((unit) => unit.unitId),
            foreignUnits: region.units.filter((unit) => !unit.own).length
          }))
      );
    }

    case "get_forecast": {
      const unitId = stringArg(args, "unitId");
      if (unitId === undefined && stringArg(args, "regionId") === undefined && numberArg(args, "x") === undefined) {
        refuse("Name a unit by unitId, or a hex by regionId or by x and y.");
      }
      if (turn.rulesetText === null) {
        refuse("The game data has not loaded yet; try again in a moment.");
      }
      const region = unitId === undefined ? findRegion(parsed, args) : null;
      const found = unitId === undefined ? null : findUnit(parsed, unitId);
      if (found !== null && !found.unit.own) {
        refuse(`Unit ${unitId} is not the faction's own; only own units are forecast.`);
      }
      const [preview, validation] = await Promise.all([
        host.preview(turn.ordersDocument),
        host.validate(turn.ordersDocument)
      ]);
      const silverOf = (id: string) => validation.silver.find((silver) => silver.unitId === id);
      if (unitId !== undefined) {
        const rows = preview.regions.flatMap((previewed) =>
          previewed.units
            .filter((row) => row.unit.unitId === unitId)
            .map((row) => unitForecast(previewed.regionId, row, silverOf(unitId)))
        );
        if (rows.length > 0) {
          return ok({ units: rows });
        }
        const standing = found ?? refuse(`This turn's report shows no unit ${unitId}, and this month's orders form none.`);
        return ok({
          units: [unitForecast(standing.region.regionId, { status: "unchanged", unit: standing.unit }, silverOf(unitId))]
        });
      }
      const hex = region as ReportRegion;
      const rows = preview.regions.find((previewed) => previewed.regionId === hex.regionId)?.units ?? [];
      const previewed = new Set(rows.map((row) => row.unit.unitId));
      const unchanged = hex.units.filter((unit) => unit.own && !previewed.has(unit.unitId));
      return ok({
        region: regionLabel(hex),
        units: [
          ...rows.map((row) => unitForecast(hex.regionId, row, silverOf(row.unit.unitId))),
          ...unchanged.map((unit) => unitForecast(hex.regionId, { status: "unchanged", unit }, silverOf(unit.unitId)))
        ]
      });
    }

    case "plan_route": {
      const unitId = requiredString(args, "unitId");
      const found = findUnit(parsed, unitId) ?? refuse(`This turn's report shows no unit ${unitId}.`);
      if (!found.unit.own) {
        refuse(`Unit ${unitId} is not the faction's own; only own units can be given orders, so only they are planned for.`);
      }
      const rulesetText = turn.rulesetText ?? refuse("The game data has not loaded yet; try again in a moment.");
      const destination = routeDestination(turn, args, found.region);
      const carryingJson = carryingJsonOf(rulesetText, args.carrying);
      const response = await host.planRoute(unitId, destination, carryingJson);
      return ok(routeAnswer(unitId, destination, response, carryingJson !== ""));
    }

    case "get_production": {
      const named = stringArg(args, "regionId") !== undefined || numberArg(args, "x") !== undefined;
      const region = named ? findRegion(parsed, args) : null;
      if (turn.rulesetText === null) {
        // Without the game data nothing is priced, and every product would read as idle.
        refuse("The game data has not loaded yet; try again in a moment.");
      }
      const validation = await host.validate(turn.ordersDocument);
      return ok(productionAnswer(parsed, validation.production, validation.silver, region));
    }

    case "get_silver_shortfalls": {
      if (turn.rulesetText === null) {
        // Without the game data nothing can be priced, and an empty answer would read as nobody short.
        refuse("The game data has not loaded yet; try again in a moment.");
      }
      const validation = await host.validate(turn.ordersDocument);
      const short = validation.silver.filter(runsShort);
      const regions = parsed.regions
        .map((region) => ({
          regionId: region.regionId,
          region: regionLabel(region),
          units: short
            .filter((silver) => silver.regionId === region.regionId)
            .map((silver) => ({
              unitId: silver.unitId,
              name: region.units.find((unit) => unit.unitId === silver.unitId)?.name ?? silver.formed?.alias ?? null,
              // The ledger behind each figure is get_forecast's to give; a summary stays a summary.
              ...silverForecast(silver, false)
            }))
        }))
        .filter((region) => region.units.length > 0);
      return ok({ regions, unclaimedSilver: validation.unclaimed_silver ?? null });
    }

    case "get_region": {
      const regionId = stringArg(args, "regionId");
      const x = numberArg(args, "x");
      const y = numberArg(args, "y");
      const z = numberArg(args, "z");
      const hexes = turn.knownMap?.hexes ?? [];
      const at = (coordinate: Coordinate) =>
        coordinate.x === x && coordinate.y === y && (z === undefined || coordinate.z === z);
      if (regionId === undefined && z === undefined) {
        const levels = new Set([
          ...parsed.regions.filter((candidate) => at(candidate.coordinate)).map((candidate) => candidate.coordinate.z),
          ...hexes.filter((hex) => at(hex.coordinate)).map((hex) => hex.coordinate.z)
        ]);
        if (levels.size > 1) {
          refuse(`(${x},${y}) is on several levels; say which with z: ${[...levels].sort((a, b) => a - b).join(", ")}.`);
        }
      }
      const region = parsed.regions.find((candidate) =>
        regionId !== undefined ? candidate.regionId === regionId : at(candidate.coordinate)
      );
      if (region) {
        return ok(region);
      }
      const hex = hexes.find((candidate) => (regionId !== undefined ? hexIdOf(candidate) === regionId : at(candidate.coordinate)));
      if (hex) {
        return ok(rememberedRegion(hex, turn.knownMap?.currentTurn ?? null));
      }
      return turn.knownMap === null
        ? refuse("This turn's report shows no such region, and the HUD has no map of this game yet to remember it from; try again in a moment.")
        : refuse("Neither this turn's report nor the HUD's map knows such a region. list_known_regions names every one the map knows.");
    }

    case "list_known_regions": {
      const map = turn.knownMap ?? refuse("The HUD has no map of this game yet; try again in a moment.");
      const z = numberArg(args, "z");
      const xMin = numberArg(args, "xMin") ?? -Infinity;
      const xMax = numberArg(args, "xMax") ?? Infinity;
      const yMin = numberArg(args, "yMin") ?? -Infinity;
      const yMax = numberArg(args, "yMax") ?? Infinity;
      const terrain = stringArg(args, "terrain")?.trim().toLowerCase();
      const rows = map.hexes
        .filter(
          ({ coordinate, terrain: hexTerrain }) =>
            (z === undefined || coordinate.z === z) &&
            coordinate.x >= xMin &&
            coordinate.x <= xMax &&
            coordinate.y >= yMin &&
            coordinate.y <= yMax &&
            (terrain === undefined || hexTerrain.toLowerCase() === terrain)
        )
        .map((hex) => ({
          regionId: hexIdOf(hex),
          region: regionLabel(hex),
          knowledge: hex.knowledge,
          lastSeenTurn: hex.lastSeenTurn,
          settlement: hex.settlement ? `${hex.settlement.name} (${hex.settlement.size})` : null,
          structures: (hex.region?.structures ?? []).map((structure) => `${structure.name}: ${structure.kind}`),
          unitsLastSeen: (hex.region?.units.filter((unit) => !unit.own).length ?? 0) + hex.rememberedUnits.length
        }));
      return ok({
        currentTurn: map.currentTurn,
        regions: rows.slice(0, MAX_KNOWN_REGIONS),
        ...(rows.length > MAX_KNOWN_REGIONS ? { leftOut: rows.length - MAX_KNOWN_REGIONS } : {})
      });
    }

    case "get_turn_events":
      return ok({
        events: parsed.header.events,
        errors: parsed.header.errors,
        battles: parsed.battles,
        blockedMoves: parsed.blockedMoves
      });

    case "get_orders": {
      const unitId = stringArg(args, "unitId");
      if (unitId === undefined) {
        noteShown(host, turn, ownUnitOrders(host, turn));
        return ok(turn.ordersDocument);
      }
      const found = findUnit(parsed, unitId) ?? refuse(`This turn's report shows no unit ${unitId}.`);
      const orders = unitOrders(host, turn, unitId, found.region) ?? "";
      if (found.unit.own) {
        noteShown(host, turn, [[unitId, orders]]);
      }
      return ok(orders);
    }

    case "set_unit_orders": {
      if (requiredString(args, "turnKey") !== turnKeyOf(turn)) {
        refuse("The open turn has changed since this was worked out. Call get_turn_overview and read the turn again.");
      }
      const unitId = requiredString(args, "unitId");
      const orders = typeof args.orders === "string" ? args.orders : refuse('"orders" must be text, one order per line.');
      if (orders.split(/\r?\n/u).some((line) => host.orders.isDocumentStructure(line))) {
        refuse("Send only the unit's own orders: no 'unit' line, region banner, #atlantis or #end.");
      }
      const found = findUnit(parsed, unitId) ?? refuse(`This turn's report shows no unit ${unitId}.`);
      if (!found.unit.own) {
        refuse(`Unit ${unitId} is not the faction's own; only own units can be given orders.`);
      }
      const ids = unitIdsOf(found.region);
      const banner = host.bannerFor(found.region.regionId);
      const apply = (document: string) => host.orders.applyUnitOrders(document, unitId, orders, banner, ids);
      const next = apply(turn.ordersDocument);
      if (next === turn.ordersDocument && host.orders.readUnitOrders(next, unitId, ids) === null) {
        refuse(`Unit ${unitId} has no block in the orders document and none could be made for it.`);
      }
      host.writeOrders(apply, unitId);
      noteShown(host, turn, [[unitId, host.orders.readUnitOrders(next, unitId, ids) ?? ""]]);
      const validation = await host.validate(next);
      const problems = host.orders
        .diagnosticsForUnit(next, unitId, validation.diagnostics, ids)
        .map((diagnostic) => problemLine(diagnostic, "unit"));
      return ok({ written: true, problems });
    }

    case "list_order_edits": {
      const edits = editsSinceSeen(host.seen, turnKeyOf(turn), ownUnitOrders(host, turn));
      noteShown(host, turn, edits.map((edit) => [edit.unitId, edit.now] as const));
      return ok({
        edits: edits.map((edit) => {
          const found = findUnit(parsed, edit.unitId);
          return {
            unitId: edit.unitId,
            name: found?.unit.name ?? "",
            regionId: found?.region.regionId ?? "",
            before: edit.before,
            now: edit.now
          };
        })
      });
    }

    case "validate_orders": {
      const validation = await host.validate(turn.ordersDocument);
      const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
      return ok({
        errors,
        warnings: validation.diagnostics.length - errors,
        problems: validation.diagnostics.map((diagnostic) => problemLine(diagnostic, "document"))
      });
    }

    case "get_game_data": {
      const query = requiredString(args, "query");
      const rulesetText = turn.rulesetText ?? refuse("The game data has not loaded yet; try again in a moment.");
      const found = lookupGameData(rulesetText, query);
      return ok(found.length > 0 ? found : refuse(`Nothing in the game data is called "${query}".`));
    }

    case "list_armies": {
      const currentTurn = parsed.header.turnNumber;
      return ok(
        savedArmies(host).map((army) => ({
          armyId: army.id,
          name: army.name,
          members: army.members.map((member) => armyMemberRow(member, currentTurn))
        }))
      );
    }

    case "export_battle_file": {
      const path = requiredString(args, "path");
      const armies = savedArmies(host);
      // With nothing saved, the dialog's own refusal says so better than "no Army is called ...".
      const attackers = armies.length === 0 ? null : namedArmy(armies, args, "attackers");
      const defenders = armies.length === 0 ? null : namedArmy(armies, args, "defenders");
      const currentTurn =
        parsed.header.turnNumber ?? refuse("This turn's report has no turn number, so its Armies cannot be exported.");
      const { skills, scanning, unreadTurns } = host.battleSkills();
      // The Export dialog's own decision, so the assistant is refused exactly when the player would be.
      const readiness = exportReadiness({ armies, attackers, defenders, currentTurn, derived: skills, scanning, unreadTurns });
      if (readiness.refusal !== null) {
        refuse(readiness.refusal);
      }
      if (readiness.waiting) {
        const scan = readiness.notices.find((notice) => notice.kind === "scanning");
        refuse(`${scan?.text ?? "Still reading this game's battle reports."} Try again in a moment.`);
      }
      try {
        await host.writeFile(path, battleFileText(battleFileOf(attackers, defenders, skills)));
      } catch (error: unknown) {
        refuse(`The file was not written: ${error instanceof Error ? error.message : String(error)}`);
      }
      return ok({ written: path, units: readiness.count, notices: readiness.notices.map((notice) => notice.text) });
    }

    case "search_report": {
      const query = requiredString(args, "query").toLowerCase();
      const hits: string[] = [];
      turn.rawReport.split("\n").forEach((line, index) => {
        if (hits.length < MAX_SEARCH_HITS && line.toLowerCase().includes(query)) {
          hits.push(`${index + 1}: ${line}`);
        }
      });
      return ok(hits.length > 0 ? hits.join("\n") : `No line of the report contains "${query}".`);
    }

    case "read_report": {
      const lines = turn.rawReport.split("\n");
      const from = Math.max(1, Math.floor(numberArg(args, "fromLine") ?? 1));
      const count = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(numberArg(args, "lineCount") ?? 200)));
      return ok(numberedLines(lines.slice(from - 1, from - 1 + count), from));
    }

    default:
      return null;
  }
}

/** Answers one call. Never throws: a refusal is an answer the model reads and acts on. */
export async function answerToolCall(
  host: AssistantHost,
  name: string,
  args: Record<string, unknown>
): Promise<AssistantAnswer> {
  if (!ASSISTANT_TOOLS.some((tool) => tool.name === name)) {
    return { text: `Atlantis HUD has no tool called "${name}".`, isError: true };
  }
  const turn = host.turn();
  if (turn === null) {
    return { text: "No turn is open in Atlantis HUD. Ask the player to open a game and load a report.", isError: true };
  }
  try {
    const answered = await answer(host, turn, name, args);
    return answered ?? { text: `Atlantis HUD has no tool called "${name}".`, isError: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: error instanceof Refusal ? message : `The HUD failed to answer: ${message}`, isError: true };
  }
}
