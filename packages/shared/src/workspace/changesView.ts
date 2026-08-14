/**
 * The pure view-model for the diff dialog (ah-jg6.4): turns `TurnDiff`/`OrdersDiff` - already
 * preformatted by `turnDiff.ts` - into rows and tab descriptors a dialog can render without any
 * arithmetic of its own.
 *
 * Region and unit names are read from the two `ParsedReport`s the diff was computed from, via
 * `hexLabelOf` - never hand-formatted here, and never recomputed differently from how the map
 * itself labels a hex.
 */
import type { ParsedReport, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { hexLabelOf } from "../hexMapModel";
import type { OrdersDiff, RegionsDiff, TurnDiff, UnitsDiff } from "../turnDiff";

export type ChangesTabKey = "units" | "regions" | "orders";
export type ChangesTab = { key: ChangesTabKey; label: string; count: number };

/** One glyph per kind of change: arrival, departure, an in-place change, or a move. */
export type ChangeGlyph = "+" | "-" | "±" | "→";

export type UnitRow = {
  unitId: string;
  name: string;
  glyph: ChangeGlyph;
  /** The region to select on click - the unit's current region, or its last known one. */
  regionId: string;
  detail: string;
};

export type RegionRow = {
  regionId: string;
  glyph: "+" | "-" | "±";
  label: string;
  detail: string;
};

export type OrderRow = {
  unitId: string;
  name: string;
  glyph: "+" | "-" | "±";
  detail: string;
};

function regionMap(report: ParsedReport): Map<string, ReportRegion> {
  return new Map(report.regions.map((region) => [region.regionId, region]));
}

function unitMap(report: ParsedReport): Map<string, ReportUnit> {
  return new Map(report.regions.flatMap((region) => region.units.map((unit) => [unit.unitId, unit] as const)));
}

/** A region's label, falling back to its bare id when neither side ever saw it - which should not
 * happen for a regionId a diff actually named, but keeps this total rather than throwing. */
function regionLabel(regions: Map<string, ReportRegion>, regionId: string): string {
  const region = regions.get(regionId);
  return region ? hexLabelOf(region) : regionId;
}

/** The three tabs, each carrying the count that both labels it and decides whether it is empty. */
export function changesTabs(diff: TurnDiff, orders: OrdersDiff | null): ChangesTab[] {
  const unitsCount = diff.units.added.length + diff.units.removed.length + diff.units.changed.length;
  const regionsCount =
    diff.regions.onlyInNewer.length + diff.regions.onlyInOlder.length + diff.regions.changed.length;
  const ordersCount = orders ? orders.changed.length + orders.onlyInNewer.length + orders.onlyInOlder.length : 0;
  return [
    { key: "units", label: `Units · ${unitsCount}`, count: unitsCount },
    { key: "regions", label: `Regions · ${regionsCount}`, count: regionsCount },
    { key: "orders", label: `Orders · ${ordersCount}`, count: ordersCount }
  ];
}

/**
 * Where an arrow key moves the active tab, wrapping at the ends, or `null` for any other key -
 * the same rule `settingsTabs.ts`'s `nextTab` applies to the settings dialog, generalised over
 * `ChangesTab`'s own ordering rather than a fixed list, since that order is data here (it comes
 * from `changesTabs`), not a constant.
 */
export function nextChangesTab(
  current: ChangesTabKey,
  key: string,
  order: ChangesTabKey[]
): ChangesTabKey | null {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (step === 0) {
    return null;
  }
  return order[(order.indexOf(current) + step + order.length) % order.length];
}

export function unitsEmptyText(): string {
  return "No unit changed between these turns.";
}

export function regionsEmptyText(): string {
  return "No region changed between these turns.";
}

/**
 * A null diff means neither a stored draft nor a template text was found for the compared turn -
 * there is nothing to have compared, which reads differently from having compared and found no
 * changes.
 */
export function ordersEmptyText(orders: OrdersDiff | null, comparedTurn: number): string {
  return orders === null
    ? `No orders known for turn ${comparedTurn}.`
    : "No orders changed between these turns.";
}

function fieldChangesDetail(changes: { field: string; before: string; after: string }[]): string {
  return changes.map((change) => `${change.field}: ${change.before} → ${change.after}`).join(", ");
}

/** Rows for units added, removed, moved, or changed in place - added first, then removed, then
 * changed, the order the diff itself groups them in. */
export function unitRows(units: UnitsDiff, older: ParsedReport, newer: ParsedReport): UnitRow[] {
  const olderRegions = regionMap(older);
  const newerRegions = regionMap(newer);
  const newerUnits = unitMap(newer);

  const rows: UnitRow[] = [];

  for (const unit of units.added) {
    rows.push({
      unitId: unit.unitId,
      name: unit.name,
      glyph: "+",
      regionId: unit.regionId,
      detail: `arrived in ${regionLabel(newerRegions, unit.regionId)}`
    });
  }

  for (const unit of units.removed) {
    rows.push({
      unitId: unit.unitId,
      name: unit.name,
      glyph: "-",
      regionId: unit.regionId,
      detail: `left ${regionLabel(olderRegions, unit.regionId)}`
    });
  }

  for (const change of units.changed) {
    const moved = change.movedFrom !== null && change.movedTo !== null;
    const fieldDetail = fieldChangesDetail(change.changes);
    const detail = moved
      ? [
          `moved: ${regionLabel(olderRegions, change.movedFrom as string)} → ${regionLabel(newerRegions, change.movedTo as string)}`,
          fieldDetail
        ]
          .filter((part) => part.length > 0)
          .join("; ")
      : fieldDetail;
    // The unit's current region: the newer side always carries one for a "changed" entry, since
    // the unit exists on both sides by construction of `diffUnitSet`.
    const regionId = newerUnits.get(change.unitId)?.regionId ?? (change.movedTo as string);
    rows.push({ unitId: change.unitId, name: change.name, glyph: moved ? "→" : "±", regionId, detail });
  }

  return rows;
}

/** Rows for regions newly seen, no longer seen, or changed while seen on both sides. */
export function regionRows(regions: RegionsDiff, older: ParsedReport, newer: ParsedReport): RegionRow[] {
  const olderRegions = regionMap(older);
  const newerRegions = regionMap(newer);

  const rows: RegionRow[] = [];

  for (const regionId of regions.onlyInNewer) {
    rows.push({ regionId, glyph: "+", label: regionLabel(newerRegions, regionId), detail: "newly seen" });
  }

  for (const regionId of regions.onlyInOlder) {
    rows.push({ regionId, glyph: "-", label: regionLabel(olderRegions, regionId), detail: "not seen this turn" });
  }

  for (const change of regions.changed) {
    rows.push({
      regionId: change.regionId,
      glyph: "±",
      label: regionLabel(newerRegions, change.regionId),
      detail: fieldChangesDetail(change.changes)
    });
  }

  return rows;
}

/** Rows for orders added, removed, or changed - named by the unit's current or last-known name. */
export function orderRows(orders: OrdersDiff, older: ParsedReport, newer: ParsedReport): OrderRow[] {
  const olderUnits = unitMap(older);
  const newerUnits = unitMap(newer);
  const nameOf = (unitId: string) => newerUnits.get(unitId)?.name ?? olderUnits.get(unitId)?.name ?? unitId;

  const rows: OrderRow[] = [];

  for (const unitId of orders.onlyInNewer) {
    rows.push({ unitId, name: nameOf(unitId), glyph: "+", detail: "new orders" });
  }

  for (const unitId of orders.onlyInOlder) {
    rows.push({ unitId, name: nameOf(unitId), glyph: "-", detail: "orders removed" });
  }

  for (const change of orders.changed) {
    const before = change.before.join("; ") || "(no orders)";
    const after = change.after.join("; ") || "(no orders)";
    rows.push({ unitId: change.unitId, name: nameOf(change.unitId), glyph: "±", detail: `${before} → ${after}` });
  }

  return rows;
}
