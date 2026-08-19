import type { ReportUnit, StructureInfo } from "@atlantis/core-client";

import { unitStructureLabel } from "./structureLabel";

/**
 * How the units table is ordered, filtered and windowed.
 *
 * The maths lives here rather than in the component because none of it needs a DOM, and the
 * repository has no jsdom: keeping it pure is what makes it testable at all.
 */

/**
 * Height of one rendered row, in pixels, at the default Interface size (100%).
 *
 * 24, not 22 (ah-v09e): a `<tr>`'s `height` is a minimum, so when the pane type scale went up a
 * step the row's own content grew to 22.875px and every row silently rendered taller than the
 * number the windowing arithmetic divides by - a pixel a row, which over three hundred rows puts
 * the bottom of the list out of reach. This is the type scale's headroom, not a spacing choice.
 */
export const ROW_HEIGHT = 24;

/**
 * How tall a row is at a given interface size, in whole pixels.
 *
 * Rounded, because the windowing arithmetic divides scroll offsets by this and a fractional height
 * makes the first visible row drift from the one the scroller is actually showing. The row's own
 * inline height and every offset computed from it must use this same number.
 */
export function rowHeightAt(interfaceSize: number): number {
  return Math.round((ROW_HEIGHT * interfaceSize) / 100);
}

/** Which column the table is ordered by. Skills and Items are summaries, so they do not sort. */
export type SortColumn = "unitId" | "name" | "faction" | "men" | "structure" | "longOrder";

/**
 * The table's columns, in the order they are drawn.
 *
 * Kept as one list so the header, the rows and the spacer rows' colSpan all read the same thing
 * and no positional literal has to be counted by hand.
 */
export const UNIT_COLUMNS = [
  "own",
  "unitId",
  "name",
  "faction",
  "men",
  "skills",
  "items",
  "structure",
  "longOrder"
] as const;

export type UnitColumn = (typeof UNIT_COLUMNS)[number];

export type SortState = {
  column: SortColumn;
  direction: "asc" | "desc";
  /** Own units held in a block above foreign ones, whatever the column says. */
  groupOwnFirst: boolean;
};

export const DEFAULT_SORT: SortState = {
  column: "name",
  direction: "asc",
  groupOwnFirst: true
};

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Which slice of rows to build for a given scroll position, end exclusive.
 *
 * Every argument can arrive wrong: the browser reports a negative scrollTop while rubber-banding,
 * and it clamps scrollTop for a shorter list before the component's state hears about it.
 *
 * The viewport height is zero for exactly one render — the first one happens before the layout
 * effect that measures it — so it is floored at a single row. Without that floor the table's first
 * paint is empty and the rows appear a frame later, which reads as a flicker on every hex change.
 */
export function windowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan: number
): { start: number; end: number } {
  const covered = Math.max(viewportHeight, rowHeight);
  const first = Math.floor(scrollTop / rowHeight) - overscan;
  const last = Math.ceil((scrollTop + covered) / rowHeight) + overscan;

  const start = clamp(first, 0, count);
  return { start, end: clamp(last, start, count) };
}

/**
 * Case-insensitive substring match over the fields a player would search by.
 *
 * The structure is matched by its whole label - name, number and type - rather than by its id
 * alone: the table shows the name now, and a column showing text the filter cannot find reads as
 * a bug (ah-kdgc).
 */
export function filterUnits(
  units: ReportUnit[],
  needle: string,
  structures: readonly StructureInfo[] = []
): ReportUnit[] {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) {
    return units;
  }
  const byId = indexById(structures);
  return units.filter((unit) =>
    [
      unit.name,
      unit.unitId,
      unit.factionName ?? "",
      unit.structureId ?? "",
      unitStructureLabel(unit.structureId, byId) ?? ""
    ]
      .join(" ")
      .toLowerCase()
      .includes(wanted)
  );
}

const indexById = (structures: readonly StructureInfo[]) =>
  new Map(structures.map((structure) => [structure.structureId, structure]));

/**
 * Compares two values of a column, with absent ones always last.
 *
 * Absent is not "smallest": a unit standing in the open has no structure to compare, and it
 * should not leap to the top merely because the direction was flipped. So the null test happens
 * before the direction is applied, and the caller does not negate its answer.
 */
function compareValues(
  left: number | string | null,
  right: number | string | null
): { settled: number } | { compare: number } {
  if (left === null || right === null) {
    if (left === right) {
      return { settled: 0 };
    }
    return { settled: left === null ? 1 : -1 };
  }
  if (typeof left === "number" && typeof right === "number") {
    return { compare: left - right };
  }
  return { compare: String(left).localeCompare(String(right)) };
}

/** The sortable value of a column, or null where the report never said. */
function valueOf(
  unit: ReportUnit,
  column: SortColumn,
  structures: ReadonlyMap<string, StructureInfo>,
  longOrders: ReadonlyMap<string, string | null>
): number | string | null {
  switch (column) {
    case "unitId":
      return numberOrNull(unit.unitId);
    case "name":
      return unit.name;
    case "faction":
      return unit.factionName;
    case "men":
      return unit.men;
    case "structure":
      return structureKey(unit.structureId, structures);
    case "longOrder":
      return longOrderKey(longOrders.get(unit.unitId) ?? null);
  }
}

/**
 * What a long order compares as: lower-cased, with a leading `@` and the space after it dropped.
 *
 * Only the comparison is normalised - the cell still shows the line exactly as it was typed.
 * Without this `@tax` and `TAX` would sort a hundred rows apart on a character the reader is not
 * thinking about.
 */
function longOrderKey(order: string | null): string | null {
  if (order === null) {
    return null;
  }
  return order.replace(/^@\s*/u, "").toLowerCase();
}

/**
 * Structures order by name, with the number breaking a tie between two of the same name.
 *
 * The key is the lower-cased name followed by the id padded to a fixed width, so one plain string
 * comparison gives name-then-number and "9" still comes before "10". Sorting on the rendered label
 * would not: "[20]" precedes "[3]" lexically, and the column has ordered ids numerically since it
 * existed.
 *
 * A structure the region never described has no name to sort by, and it renders as a bare `[id]`.
 * Those sort after every named structure rather than before them: an empty name would put the one
 * row with least to say at the very top of the column.
 */
/** Sorts after every real name, so an undescribed structure lands beneath the named ones. */
const UNNAMED = "\uffff";

function structureKey(
  structureId: string | null,
  structures: ReadonlyMap<string, StructureInfo>
): string | null {
  if (structureId === null) {
    return null;
  }
  const name = structures.get(structureId)?.name.toLowerCase() ?? UNNAMED;
  const numeric = numberOrNull(structureId);
  const tieBreak = numeric === null ? structureId : String(numeric).padStart(12, "0");
  return `${name}\u0000${tieBreak}`;
}

/** Ids are numbers the report hands over as strings, so "9" must not beat "10". */
function numberOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Orders the table.
 *
 * With the default state this is exactly what unitsForHex produces, which is the contract that
 * lets AppShell keep using that function to choose a hex's default unit while the table is sorted
 * some other way.
 *
 * Ownership is compared before the column and never reversed, so flipping a column to descending
 * cannot bury the player's own units under a bigger foreign stack. Array.sort is stable, so units
 * a column cannot separate keep the order they arrived in.
 */
export function sortUnits(
  units: ReportUnit[],
  sort: SortState,
  structures: readonly StructureInfo[] = [],
  /** Each own unit's month-long order, for the column that sorts on it. */
  longOrders: ReadonlyMap<string, string | null> = new Map()
): ReportUnit[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  const byId = indexById(structures);

  return [...units].sort((left, right) => {
    if (sort.groupOwnFirst && left.own !== right.own) {
      return left.own ? -1 : 1;
    }

    const outcome = compareValues(
      valueOf(left, sort.column, byId, longOrders),
      valueOf(right, sort.column, byId, longOrders)
    );
    return "settled" in outcome ? outcome.settled : outcome.compare * direction;
  });
}
