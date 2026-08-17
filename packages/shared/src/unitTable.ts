import type { ReportUnit } from "@atlantis/core-client";

/**
 * How the units table is ordered, filtered and windowed.
 *
 * The maths lives here rather than in the component because none of it needs a DOM, and the
 * repository has no jsdom: keeping it pure is what makes it testable at all.
 */

/** Height of one rendered row, in pixels, at the default Interface size (100%). */
export const ROW_HEIGHT = 22;

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
export type SortColumn = "unitId" | "name" | "faction" | "men" | "structure";

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

/** Case-insensitive substring match over the four fields a player would search by. */
export function filterUnits(units: ReportUnit[], needle: string): ReportUnit[] {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) {
    return units;
  }
  return units.filter((unit) =>
    [unit.name, unit.unitId, unit.factionName ?? "", unit.structureId ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(wanted)
  );
}

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
function valueOf(unit: ReportUnit, column: SortColumn): number | string | null {
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
      return numberOrNull(unit.structureId);
  }
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
export function sortUnits(units: ReportUnit[], sort: SortState): ReportUnit[] {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...units].sort((left, right) => {
    if (sort.groupOwnFirst && left.own !== right.own) {
      return left.own ? -1 : 1;
    }

    const outcome = compareValues(valueOf(left, sort.column), valueOf(right, sort.column));
    return "settled" in outcome ? outcome.settled : outcome.compare * direction;
  });
}

/**
 * Column widths, in pixels.
 *
 * A Windows-Explorer-style table: every column has an explicit width, and a splitter at each
 * internal boundary moves pixels from one side to the other without changing the table's own
 * width. That invariant (`sum(widths)` never moves on a drag, only what each column owns) is what
 * keeps the table from ever overflowing or leaving a gap - see `dragColumnBoundary`.
 *
 * Skills and Items used to be the two columns `table-fixed` auto-sized from whatever the other six
 * left over. They still are, by default - `DEFAULT_COLUMN_WIDTH_PX` just writes down what that
 * auto-sizing produced at a typical rail width, so the first drag has something concrete to move
 * from rather than measuring a live layout before touching it.
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

/** No column may be dragged narrower than this - enough for a truncated word and its ellipsis. */
export const COLUMN_MIN_PX = 36;

export const DEFAULT_COLUMN_WIDTH_PX: Record<UnitColumn, number> = {
  own: 24,
  unitId: 56,
  name: 176,
  faction: 168,
  men: 56,
  skills: 220,
  items: 220,
  structure: 72,
  longOrder: 140
};

export type ColumnWidths = Partial<Record<UnitColumn, number>>;

/** A column's width: the stored preference if there is one, otherwise the shipped default. */
export function widthOf(column: UnitColumn, widths: ColumnWidths | null): number {
  return widths?.[column] ?? DEFAULT_COLUMN_WIDTH_PX[column];
}

/**
 * A stored width record, reconciled against the columns this build knows - the same posture
 * `reconcile` in `workspaceStore.ts` takes with booleans. A column that no longer exists is
 * dropped; one that does but is missing, negative, non-finite or below the floor falls back to
 * its default rather than being carried through broken.
 */
export function columnWidthsFromStorage(stored: unknown): ColumnWidths {
  if (typeof stored !== "object" || stored === null) {
    return {};
  }
  const kept: ColumnWidths = {};
  for (const column of UNIT_COLUMNS) {
    const value = (stored as Record<string, unknown>)[column];
    if (typeof value === "number" && Number.isFinite(value) && value >= COLUMN_MIN_PX) {
      kept[column] = value;
    }
  }
  return kept;
}

export type ColumnDragResult = { left: number; right: number; atLimit: boolean };

/**
 * Resolves a boundary drag (or one keyboard step) between two adjacent columns.
 *
 * `deltaPx` is positive when the pointer moves right, growing the left column and shrinking the
 * right one by the same amount - their sum, `leftStart + rightStart`, is therefore invariant: the
 * table's own width never changes, only where the boundary between these two columns sits.
 *
 * Both floors are enforced together, the way `dragOrdersHeight`'s ceiling accounts for the unit
 * panel's own floor: growing the left column can only take from what the right column has above
 * its own `COLUMN_MIN_PX`, and the reverse for shrinking it, so one drag can never starve both
 * sides at once.
 */
export function dragColumnBoundary(
  leftStart: number,
  rightStart: number,
  deltaPx: number
): ColumnDragResult {
  const total = leftStart + rightStart;
  const lowest = Math.min(COLUMN_MIN_PX, total / 2);
  const highest = total - lowest;
  const raw = leftStart + deltaPx;
  const left = clamp(raw, lowest, highest);
  return { left, right: total - left, atLimit: left !== raw };
}

/**
 * The order columns are drawn in, left to right - a separate preference from `ColumnWidths`, so a
 * player who has only resized never has an order stored, and one who has only reordered never has
 * widths stored. `null` means "the shipped order", `UNIT_COLUMNS` itself.
 */
export type ColumnOrder = UnitColumn[];

/** The order to draw columns in: the stored preference if there is one, otherwise the shipped
 *  default - the order equivalent of `widthOf`. */
export function orderOf(order: ColumnOrder | null): ColumnOrder {
  return order ?? [...UNIT_COLUMNS];
}

/**
 * A stored order, reconciled against the columns this build knows - `columnWidthsFromStorage`'s
 * counterpart for order rather than width. Anything wrong with it - a column missing, one this
 * build no longer has, a duplicate, the wrong length - and the whole thing is rejected rather than
 * patched: a partial reorder is not obviously better than the shipped order, and guessing where a
 * missing column belongs is worse than just starting over from the default.
 */
export function columnOrderFromStorage(stored: unknown): ColumnOrder | null {
  if (!Array.isArray(stored)) {
    return null;
  }
  if (stored.length !== UNIT_COLUMNS.length) {
    return null;
  }
  const known = new Set<string>(UNIT_COLUMNS);
  const seen = new Set<string>();
  for (const entry of stored) {
    if (typeof entry !== "string" || !known.has(entry) || seen.has(entry)) {
      return null;
    }
    seen.add(entry);
  }
  return stored as ColumnOrder;
}

/** `own` never moves - too narrow to carry a grip, and the natural leftmost spot for a marker
 *  column anyway. Every other column can trade places with any other. */
export const REORDERABLE_COLUMNS = UNIT_COLUMNS.filter((column) => column !== "own");

/**
 * Resolves a drag-to-reorder gesture: given the current order, the column being dragged, and how
 * far the pointer has moved (in pixels, positive rightward) since the drag started, returns the
 * order after every adjacent swap that distance was enough to cross.
 *
 * Threshold to swap with a neighbour is that neighbour's own width - drag the column being moved
 * past the whole of the next one over, in either direction, and the two trade places, the same way
 * dragging a card past its neighbour in a sortable list swaps them. `own` is never a neighbour to
 * swap with, since it never moves; a drag that reaches it simply stops one short.
 */
export function dragColumnOrder(
  order: ColumnOrder,
  dragged: UnitColumn,
  deltaPx: number,
  widths: ColumnWidths | null
): ColumnOrder {
  const next = [...order];
  let index = next.indexOf(dragged);
  if (index === -1 || dragged === "own") {
    return next;
  }
  let remaining = deltaPx;

  while (remaining > 0 && index < next.length - 1 && next[index + 1] !== "own") {
    const neighbour = next[index + 1];
    const threshold = widthOf(neighbour, widths);
    if (remaining < threshold) {
      break;
    }
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    remaining -= threshold;
    index += 1;
  }

  while (remaining < 0 && index > 0 && next[index - 1] !== "own") {
    const neighbour = next[index - 1];
    const threshold = widthOf(neighbour, widths);
    if (-remaining < threshold) {
      break;
    }
    [next[index], next[index - 1]] = [next[index - 1], next[index]];
    remaining += threshold;
    index -= 1;
  }

  return next;
}
