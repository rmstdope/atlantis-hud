/**
 * Which list of units the dock is showing, and every rule that depends on it.
 *
 * `UnitTableDock` stopped meaning "the units in the selected hex" in `ah-1mpx.2`: it gained a
 * source rail down its left edge - *This hex*, *All my units*, then each Army - and an Army became
 * one more source in the table that already existed. This module is the whole vocabulary of that,
 * kept pure so it can be tested: `packages/shared` has no jsdom, so a rule that lives in the
 * component is a rule nothing here can pin (see `testing/README.md`).
 */

import type { ExtraColumn, SortState } from "../unitTable";

/** Which list of units the dock is showing. */
export type UnitSource =
  | { kind: "hex" }
  | { kind: "own" }
  | { kind: "army"; armyId: string };

export const HEX_SOURCE: UnitSource = { kind: "hex" };
export const OWN_SOURCE: UnitSource = { kind: "own" };

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
}): { title: string; hint: string | undefined } {
  if (args.source.kind === "hex") {
    return { title: "Units in hex", hint: args.hexHint };
  }
  const what = args.source.kind === "own" ? "all my units" : (args.armyName ?? "");
  const units = `${args.unitCount} unit${args.unitCount === 1 ? "" : "s"}`;
  // The same `, N shown` suffix the hex hint appends when a filter is narrowing the list, in the
  // same words and the same place.
  const shown = args.shownCount === args.unitCount ? "" : `, ${args.shownCount} shown`;
  return { title: "Units", hint: `— ${what}, ${units}${shown}` };
}

/**
 * Whether a sort column still has a column to sort. Changing the source must not leave the table
 * sorted on a column that is no longer drawn - an order nothing on screen explains.
 */
export function sortSurvives(sort: SortState, source: UnitSource): boolean {
  return sort.column !== "seen" || extraColumnsFor(source).includes("seen");
}
