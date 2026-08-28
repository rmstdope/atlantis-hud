/**
 * Which list of units the dock is showing, and every rule that depends on it.
 *
 * `UnitTableDock` stopped meaning "the units in the selected hex" in `ah-1mpx.2`: it gained a
 * source rail down its left edge - *This hex*, *All my units*, then each Army - and an Army became
 * one more source in the table that already existed. This module is the whole vocabulary of that,
 * kept pure so it can be tested: `packages/shared` has no jsdom, so a rule that lives in the
 * component is a rule nothing here can pin (see `testing/README.md`).
 */

import type { ColumnOrder, ExtraColumn, SortState, UnitColumn } from "../unitTable";

/** Which list of units the dock is showing. */
export type UnitSource =
  | { kind: "hex" }
  | { kind: "own" }
  | { kind: "army"; armyId: string }
  | { kind: "foreign" };

export const HEX_SOURCE: UnitSource = { kind: "hex" };
export const OWN_SOURCE: UnitSource = { kind: "own" };
export const FOREIGN_SOURCE: UnitSource = { kind: "foreign" };

/**
 * What the `Other factions` list is narrowed to, when it is narrowed at all.
 *
 * `factionName` is carried rather than looked up because the faction may have no units in the
 * report the pin is applied to - a pin survives a turn load - and the empty line names it.
 *
 * It is declared here rather than in `foreignUnits.ts` for the reason `ExtraColumn` is declared in
 * `unitTable.ts`: `foreignUnits.ts` imports `UnitSource`, so importing back would be a cycle, and
 * `headerFor` below needs the pin.
 */
export type FactionPin =
  | { kind: "faction"; factionId: string; factionName: string }
  | { kind: "hidden" };

export function sameSource(left: UnitSource, right: UnitSource): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return left.kind === "army" && right.kind === "army" ? left.armyId === right.armyId : true;
}

/**
 * The source to fall back to when the current one has gone - an Army that was deleted, or any
 * source at all once the game closes. Returns `HEX_SOURCE` unless `source` is still available.
 *
 * The two built-in sources are always available: a hex is always selectable and "all my units" is
 * a slice of whatever report is loaded, so neither can be taken away underneath the table.
 */
export function sourceStillThere(source: UnitSource, armyIds: readonly string[]): UnitSource {
  if (source.kind !== "army") {
    return source;
  }
  return armyIds.includes(source.armyId) ? source : HEX_SOURCE;
}

/**
 * Which extra columns this source warrants, in render order.
 *
 * `hex` for any source that spans hexes, because for `This hex` it would repeat itself on every
 * row. `seen` and `remove` only for an Army: they are meaningless for a list read straight out of
 * the report, where every unit is in it and none can be removed from anything.
 */
export function extraColumnsFor(source: UnitSource): ExtraColumn[] {
  switch (source.kind) {
    case "hex":
      return [];
    case "own":
      return ["hex"];
    case "foreign":
      // The same as `own`, and for the same reason: both span hexes. No `seen`, because everything
      // here is this turn's report, and no `remove`, because there is nothing to be removed from.
      return ["hex"];
    case "army":
      return ["hex", "seen", "remove"];
  }
}

/**
 * The pane's header for a source: the fixed title, and the grey hint beside it.
 *
 * The pane keeps one identity across sources and only the hint moves (`ah-1mpx.2` U1). `This hex`
 * is byte-identical to what `UnitTableDock` builds today - the hint arrives already built and is
 * handed straight back - so the default view's header does not change at all.
 */
export function headerFor(args: {
  source: UnitSource;
  armyName: string | null;
  unitCount: number;
  shownCount: number;
  /** Today's `— plain (7,53), 6 units`, already built by the dock. */
  hexHint: string | undefined;
  /** The `Other factions` pin, and the count before it narrowed anything. */
  pin?: FactionPin | null;
  foreignTotal?: number;
}): { title: string; hint: string | undefined } {
  if (args.source.kind === "hex") {
    return { title: "Units in hex", hint: args.hexHint };
  }
  const pin = args.source.kind === "foreign" ? (args.pin ?? null) : null;
  const what =
    args.source.kind === "own"
      ? "all my units"
      : args.source.kind === "foreign"
        ? (pin === null ? "other factions" : pinHintLabel(pin))
        : (args.armyName ?? "");
  // `unitCount` is what the pin left; `foreignTotal` what there was before it. The `X of Y` form
  // appears only when a pin is set - unpinned reads exactly like `All my units` does.
  const of = pin === null ? "" : ` of ${args.foreignTotal ?? args.unitCount}`;
  const units = `${args.unitCount}${of} unit${args.unitCount === 1 && of === "" ? "" : "s"}`;
  // The same `, N shown` suffix the hex hint appends when a filter is narrowing the list, in the
  // same words and the same place.
  const shown = args.shownCount === args.unitCount ? "" : `, ${args.shownCount} shown`;
  return { title: "Units", hint: `— ${what}, ${units}${shown}` };
}

/** How a pin reads in the pane hint: `Thane's Ring (10)`, or `faction not shown`. */
export function pinHintLabel(pin: FactionPin): string {
  return pin.kind === "hidden" ? "faction not shown" : `${pin.factionName} (${pin.factionId})`;
}

/**
 * Whether a sort column still has a column to sort. Changing the source must not leave the table
 * sorted on a column that is no longer drawn - an order nothing on screen explains.
 */
export function sortSurvives(sort: SortState, source: UnitSource): boolean {
  return sort.column !== "seen" || extraColumnsFor(source).includes("seen");
}

/** One column as the table draws it: one of its own, or one this source added. */
export type DrawnColumn =
  | { kind: "unit"; column: UnitColumn }
  | { kind: "extra"; column: ExtraColumn };

/**
 * The columns in the order they are drawn, the table's own and the source's together.
 *
 * `hex` and `seen` go immediately after `name` **wherever `name` has been dragged to**, so the
 * where-it-is and the when-it-was-seen sit beside the unit they are about; `remove` is always last,
 * after every `UNIT_COLUMNS` entry, because a trailing action column is where an action goes and
 * nothing may reflow as the selection moves it between rows.
 *
 * `extras` is `extraColumnsFor`'s answer, and its own order is not trusted: `hex` before `seen` is
 * a fact about the drawing, not about the caller.
 */
export function drawnColumnsFor(
  order: ColumnOrder,
  extras: readonly ExtraColumn[]
): DrawnColumn[] {
  const has = (column: ExtraColumn) => extras.includes(column);
  const afterName = (["hex", "seen"] as const).filter(has);

  const drawn: DrawnColumn[] = [];
  for (const column of order) {
    drawn.push({ kind: "unit", column });
    if (column === "name") {
      for (const extra of afterName) {
        drawn.push({ kind: "extra", column: extra });
      }
    }
  }
  if (has("remove")) {
    drawn.push({ kind: "extra", column: "remove" });
  }
  return drawn;
}
