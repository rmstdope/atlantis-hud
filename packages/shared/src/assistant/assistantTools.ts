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
  OrderDiagnostic,
  OrdersPreviewResponse,
  OrderValidationResult,
  ParsedReport,
  ReportRegion,
  ReportUnit,
  UnitPreview,
  UnitSilver
} from "@atlantis/core-client";
import type { OrderProcessing } from "../orderProcessing";
import { editsSinceSeen, noteSeen, type AssistantSeen } from "./assistantSeen";
import { silverShown } from "../unitTable";

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
   * Applies `update`, which rewrites `unitId`'s block, to the document as it stands when the write
   * lands - which may hold something typed since the tool read it - and saves the result.
   */
  writeOrders(update: (document: string) => string, unitId: string): void;
  /** What the assistant last read or wrote of each unit's orders, kept between calls. */
  readonly seen: AssistantSeen;
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
      "One region in full: products, market (wanted and for sale), exits, structures, gate, and every unit in it. Name it by regionId or by x, y and z coordinates.",
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
      "What the HUD forecasts this month's orders leave a unit, or every own unit in a hex, with: status (present, departing, arriving, or unchanged when its orders change nothing), men, items and skills at month end, the item changes in the month's order, what is produced, built and created, casts the game refuses, transports sent and received, where its study lands, and its silver - held, in, out, upkeep, at month end before and after upkeep, how much its orders are short and on what, and orders refused for want of silver. The same figures the HUD's preview shows. Name a unit by unitId, or a hex by regionId or x, y and z.",
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

function regionLabel(region: ReportRegion): string {
  const { x, y, z } = region.coordinate;
  return `${region.terrain} (${x},${y},${z}) in ${region.province}`;
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
    itemsAtMonthEnd: itemsLine(unit),
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

    case "get_region":
      return ok(findRegion(parsed, args));

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

    case "get_silver_shortfalls": {
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
              name: region.units.find((unit) => unit.unitId === silver.unitId)?.name ?? null,
              // The ledger behind each figure is get_forecast's to give; a summary stays a summary.
              ...silverForecast(silver, false)
            }))
        }))
        .filter((region) => region.units.length > 0);
      return ok({ regions, unclaimedSilver: validation.unclaimed_silver ?? null });
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
