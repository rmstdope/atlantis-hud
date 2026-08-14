/**
 * What changed between two turns' reports, and between two orders drafts.
 *
 * Pure functions from two {@link ParsedReport} values (or two orders texts) to a statement of what
 * changed - no rendering, no storage, no enumeration of which turns to compare.
 *
 * Three decisions run through every function here:
 *
 * - A unit that moved is moved, not removed-here-and-added-there. `unitId` is stable within a game,
 *   so the same id on both sides is the same unit even when its `regionId` differs.
 * - A region unseen in one turn is "not seen", never "changed" - the report describes what the
 *   faction saw, so absence is missing knowledge rather than a change in the world. Foreign units
 *   follow the same rule: one is only compared inside a region seen in both turns, because a foreign
 *   unit "missing" from a region the faction never visited that turn is not gone, it is unobserved.
 *   Own units are always visible (the report always describes the hex they stand in), so their
 *   added/removed is global and real.
 * - A reflowed draft is not a change - `diffOrders` normalizes with {@link commandsOnly} before
 *   comparing, the same way the editor already does.
 *
 * Both report arguments must come from the same parse path. `men`/`menEstimated`/`menByRace` differ
 * between `parseReportFull` and `parseReportClassified` output for the same report, so diffing one
 * of each would produce phantom men changes; this module does not compare those fields at all, but
 * every other field assumes both sides were parsed the same way.
 */

import type {
  ItemAmount,
  MarketItem,
  ParsedReport,
  ReportRegion,
  ReportUnit,
  SettlementInfo,
  SkillInfo,
  StructureInfo
} from "@atlantis/core-client";
import { commandsOnly, findUnitBlocks, readUnitOrders } from "./ordersDocument";

/** One field that differs, preformatted on both sides so a view can render it without knowing the
 * arithmetic behind it (item multisets, skill lists, and so on). */
export type ValueChange = { field: string; before: string; after: string };

/** One unit that exists on both sides, whatever changed about it. */
export type UnitChange = {
  unitId: string;
  /** The unit's name as of the newer turn. */
  name: string;
  changes: ValueChange[];
  /** The regionId the unit stood in on the older side, or null when it did not move. */
  movedFrom: string | null;
  /** The regionId the unit stands in on the newer side, or null when it did not move. */
  movedTo: string | null;
};

export type UnitsDiff = { added: ReportUnit[]; removed: ReportUnit[]; changed: UnitChange[] };

/** One region that exists on both sides and has at least one changed field. */
export type RegionChange = { regionId: string; changes: ValueChange[] };

/**
 * Which regions came and went, and which changed. `onlyInNewer`/`onlyInOlder` are regionIds, not
 * changes: a region seen on only one side has no "before" or "after" to compare, only presence.
 */
export type RegionsDiff = { onlyInNewer: string[]; onlyInOlder: string[]; changed: RegionChange[] };

export type TurnDiff = { units: UnitsDiff; regions: RegionsDiff };

const MISSING = "—";

function formatScalar(value: string | number | boolean | null): string {
  return value === null ? MISSING : String(value);
}

function formatItems(items: ItemAmount[]): string {
  if (items.length === 0) {
    return MISSING;
  }
  return [...items]
    .sort((a, b) => a.tag.localeCompare(b.tag))
    .map((item) => `${item.amount} ${item.name}`)
    .join(", ");
}

function formatMarketItems(items: MarketItem[]): string {
  if (items.length === 0) {
    return MISSING;
  }
  return [...items]
    .sort((a, b) => a.tag.localeCompare(b.tag))
    .map((item) => `${item.amount} ${item.name} @ ${item.price}`)
    .join(", ");
}

function formatSkills(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return MISSING;
  }
  return [...skills]
    .sort((a, b) => a.tag.localeCompare(b.tag))
    .map((skill) => `${skill.name} ${skill.level} (${skill.points})`)
    .join(", ");
}

function formatFlags(flags: string[]): string {
  if (flags.length === 0) {
    return MISSING;
  }
  return [...flags].sort().join(", ");
}

function formatStructures(structures: StructureInfo[]): string {
  if (structures.length === 0) {
    return MISSING;
  }
  return [...structures]
    .sort((a, b) => a.structureId.localeCompare(b.structureId))
    .map((structure) => `${structure.name} (${structure.structureId})`)
    .join(", ");
}

function formatSettlement(settlement: SettlementInfo | null): string {
  return settlement === null ? MISSING : `${settlement.name} (${settlement.size})`;
}

/** Compares one field's formatted before/after and returns a `ValueChange` when they differ. */
function fieldChange(field: string, before: string, after: string): ValueChange | null {
  return before === after ? null : { field, before, after };
}

/**
 * The `ReportUnit` fields compared: `name`, `factionId`, `own`, `onGuard`, `flags`, `items`,
 * `skills`, `men`, `structureId`. `regionId` is handled separately as a move, never as a field
 * change. `weight`/`capacity` are derived from `items` and would duplicate every cargo change, so
 * they are not compared; `menEstimated`/`menByRace` are not compared for the reason in the module
 * doc comment.
 */
function compareUnitFields(older: ReportUnit, newer: ReportUnit): ValueChange[] {
  const candidates = [
    fieldChange("name", formatScalar(older.name), formatScalar(newer.name)),
    fieldChange("factionId", formatScalar(older.factionId), formatScalar(newer.factionId)),
    fieldChange("own", formatScalar(older.own), formatScalar(newer.own)),
    fieldChange("onGuard", formatScalar(older.onGuard), formatScalar(newer.onGuard)),
    fieldChange("flags", formatFlags(older.flags), formatFlags(newer.flags)),
    fieldChange("items", formatItems(older.items), formatItems(newer.items)),
    fieldChange("skills", formatSkills(older.skills), formatSkills(newer.skills)),
    fieldChange("men", formatScalar(older.men), formatScalar(newer.men)),
    fieldChange("structureId", formatScalar(older.structureId), formatScalar(newer.structureId))
  ];
  return candidates.filter((change): change is ValueChange => change !== null);
}

/**
 * The `ReportRegion` fields compared: `terrain`, `province`, `settlement`, `population`, `race`,
 * `taxBase`, `wages`, `maxWages`, `entertainment`, `products`, `wanted`, `forSale`, `structures`.
 * `exits` are not compared (geography does not change, and partial sightings would produce phantom
 * diffs); the unit-bearing changes fall out of the units diff, not here.
 */
function compareRegionFields(older: ReportRegion, newer: ReportRegion): ValueChange[] {
  const candidates = [
    fieldChange("terrain", formatScalar(older.terrain), formatScalar(newer.terrain)),
    fieldChange("province", formatScalar(older.province), formatScalar(newer.province)),
    fieldChange("settlement", formatSettlement(older.settlement), formatSettlement(newer.settlement)),
    fieldChange("population", formatScalar(older.population), formatScalar(newer.population)),
    fieldChange("race", formatScalar(older.race), formatScalar(newer.race)),
    fieldChange("taxBase", formatScalar(older.taxBase), formatScalar(newer.taxBase)),
    fieldChange("wages", formatScalar(older.wages), formatScalar(newer.wages)),
    fieldChange("maxWages", formatScalar(older.maxWages), formatScalar(newer.maxWages)),
    fieldChange("entertainment", formatScalar(older.entertainment), formatScalar(newer.entertainment)),
    fieldChange("products", formatItems(older.products), formatItems(newer.products)),
    fieldChange("wanted", formatMarketItems(older.wanted), formatMarketItems(newer.wanted)),
    fieldChange("forSale", formatMarketItems(older.forSale), formatMarketItems(newer.forSale)),
    fieldChange("structures", formatStructures(older.structures), formatStructures(newer.structures))
  ];
  return candidates.filter((change): change is ValueChange => change !== null);
}

/**
 * Diffs one set of units already narrowed to the ones eligible for comparison - all own units, or
 * the foreign units standing in a region seen on both sides.
 */
function diffUnitSet(older: ReportUnit[], newer: ReportUnit[]): UnitsDiff {
  const olderById = new Map(older.map((unit) => [unit.unitId, unit]));
  const newerById = new Map(newer.map((unit) => [unit.unitId, unit]));

  const added = newer.filter((unit) => !olderById.has(unit.unitId));
  const removed = older.filter((unit) => !newerById.has(unit.unitId));

  const changed: UnitChange[] = [];
  for (const [unitId, oldUnit] of olderById) {
    const newUnit = newerById.get(unitId);
    if (!newUnit) {
      continue;
    }
    const changes = compareUnitFields(oldUnit, newUnit);
    const moved = oldUnit.regionId !== newUnit.regionId;
    if (changes.length > 0 || moved) {
      changed.push({
        unitId,
        name: newUnit.name,
        changes,
        movedFrom: moved ? oldUnit.regionId : null,
        movedTo: moved ? newUnit.regionId : null
      });
    }
  }

  return { added, removed, changed };
}

/**
 * Splits every unit on both sides into two disjoint sets by unitId: the ones eligible for the
 * always-visible ("own") comparison, and the rest, eligible only inside a region seen on both
 * sides ("foreign").
 *
 * A unit that is own on one side and foreign on the other - captured, or given away - must land
 * in exactly one set on *both* sides, or it is diffed once per pass and reported as both removed
 * and added. So membership is decided globally, by unitId, from whichever side(s) call it own,
 * not independently per side.
 */
function splitByOwnership(
  older: ReportUnit[],
  newer: ReportUnit[]
): { olderOwn: ReportUnit[]; newerOwn: ReportUnit[]; olderForeign: ReportUnit[]; newerForeign: ReportUnit[] } {
  const ownIds = new Set(
    [...older, ...newer].filter((unit) => unit.own).map((unit) => unit.unitId)
  );

  return {
    olderOwn: older.filter((unit) => ownIds.has(unit.unitId)),
    newerOwn: newer.filter((unit) => ownIds.has(unit.unitId)),
    olderForeign: older.filter((unit) => !ownIds.has(unit.unitId)),
    newerForeign: newer.filter((unit) => !ownIds.has(unit.unitId))
  };
}

function diffUnits(older: ParsedReport, newer: ParsedReport): UnitsDiff {
  const olderUnits = older.regions.flatMap((region) => region.units);
  const newerUnits = newer.regions.flatMap((region) => region.units);

  const olderRegionIds = new Set(older.regions.map((region) => region.regionId));
  const newerRegionIds = new Set(newer.regions.map((region) => region.regionId));
  const seenInBoth = new Set([...olderRegionIds].filter((regionId) => newerRegionIds.has(regionId)));

  const { olderOwn, newerOwn, olderForeign, newerForeign } = splitByOwnership(olderUnits, newerUnits);

  const own = diffUnitSet(olderOwn, newerOwn);
  const foreign = diffUnitSet(
    olderForeign.filter((unit) => seenInBoth.has(unit.regionId)),
    newerForeign.filter((unit) => seenInBoth.has(unit.regionId))
  );

  return {
    added: [...own.added, ...foreign.added],
    removed: [...own.removed, ...foreign.removed],
    changed: [...own.changed, ...foreign.changed]
  };
}

function diffRegions(older: ParsedReport, newer: ParsedReport): RegionsDiff {
  const olderById = new Map(older.regions.map((region) => [region.regionId, region]));
  const newerById = new Map(newer.regions.map((region) => [region.regionId, region]));

  const onlyInOlder = older.regions
    .filter((region) => !newerById.has(region.regionId))
    .map((region) => region.regionId);
  const onlyInNewer = newer.regions
    .filter((region) => !olderById.has(region.regionId))
    .map((region) => region.regionId);

  const changed: RegionChange[] = [];
  for (const [regionId, oldRegion] of olderById) {
    const newRegion = newerById.get(regionId);
    if (!newRegion) {
      continue;
    }
    const changes = compareRegionFields(oldRegion, newRegion);
    if (changes.length > 0) {
      changed.push({ regionId, changes });
    }
  }

  return { onlyInNewer, onlyInOlder, changed };
}

/** What changed between two turns' reports. Both must come from the same parse path - see above. */
export function diffTurns(older: ParsedReport, newer: ParsedReport): TurnDiff {
  return { units: diffUnits(older, newer), regions: diffRegions(older, newer) };
}

export type UnitOrdersChange = { unitId: string; before: string[]; after: string[] };

/** Which units' orders came, went, or changed, reflow-blind. */
export type OrdersDiff = {
  changed: UnitOrdersChange[];
  /** unitIds present only in the newer draft. */
  onlyInNewer: string[];
  /** unitIds present only in the older draft. */
  onlyInOlder: string[];
};

function commandsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * What changed between two orders drafts, text in and text out on purpose: a draft comes from
 * `loadOrderDraft` as a plain string, and the template lives in `OrdersTemplate.text` - which of
 * those a caller feeds in is its own decision, not this module's.
 *
 * Compares with {@link commandsOnly}, so a draft reflowed with blank lines or extra comments is not
 * a change.
 *
 * A unit formed this turn has no id until the next report - it appears in a draft as a `FORM` block
 * rather than a `unit <id>` block, so it falls outside this function entirely, on both sides.
 */
export function diffOrders(olderText: string, newerText: string): OrdersDiff {
  const olderIds = findUnitBlocks(olderText).map((block) => block.unitId);
  const newerIds = findUnitBlocks(newerText).map((block) => block.unitId);
  const olderIdSet = new Set(olderIds);
  const newerIdSet = new Set(newerIds);

  const onlyInOlder = olderIds.filter((unitId) => !newerIdSet.has(unitId));
  const onlyInNewer = newerIds.filter((unitId) => !olderIdSet.has(unitId));

  const changed: UnitOrdersChange[] = [];
  for (const unitId of olderIds) {
    if (!newerIdSet.has(unitId)) {
      continue;
    }
    const before = commandsOnly(readUnitOrders(olderText, unitId) ?? "");
    const after = commandsOnly(readUnitOrders(newerText, unitId) ?? "");
    if (!commandsEqual(before, after)) {
      changed.push({ unitId, before, after });
    }
  }

  return { changed, onlyInNewer, onlyInOlder };
}
