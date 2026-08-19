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

/**
 * What each column's header says; `own` has a button rather than a label.
 *
 * Here rather than in `UnitTableDock` because the resize handles name their column too - a screen
 * reader must hear "Resize the Long order column", not "Resize the longOrder column" - and two
 * lists of labels for one set of columns is exactly the drift `UNIT_COLUMNS` exists to prevent.
 */
export const COLUMN_LABELS: Partial<Record<UnitColumn, string>> = {
  unitId: "Id",
  name: "Unit",
  faction: "Faction",
  men: "Men",
  skills: "Skills",
  items: "Items",
  structure: "Structure",
  longOrder: "Long order"
};

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
 * This normalisation is for the comparison alone and is never rendered - what the cell shows is
 * the caller's business, and `UnitTableDock` shows the line `longOrderOf` returned. Without this
 * `@tax` and `TAX` would sort a hundred rows apart on a character the reader is not thinking
 * about.
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

/**
 * The units table's column widths, as **shares of the table** rather than pixels.
 *
 * The pixel model this replaces (PR #421) was arithmetically sound per drag - a boundary drag
 * conserved the pair's sum - and still lost columns: the widths were absolute, the table is
 * `w-full table-fixed` inside a scroller carrying `overflow-x-hidden`, and both rails are
 * independently draggable. Widen a rail past the point where the pixel total no longer fits and
 * `table-fixed` lays the rightmost columns out past the right edge, where nothing scrolls them
 * back (ah-1owr.2).
 *
 * Shares make that impossible rather than merely bounded: the values always sum to 1, every
 * `<col>` is styled as a percentage, so whatever the table's width the columns exactly fill it.
 * The accepted cost is that a very narrow window makes every column narrow - nothing can be kept
 * legible by choice - and `COLUMN_MIN_PX` can only be honoured approximately, since a share is
 * not a pixel.
 */
export type ColumnShares = Partial<Record<UnitColumn, number>>;

/**
 * The shipped shape, as shares: exactly the widths the table renders today, taken at a nominal
 * 1344px table - own 24, unitId 64, name 208, faction 192, men 64, skills 220, items 220,
 * structure 208, longOrder 144. A player who never drags must see no difference at all, so these
 * are a restatement of the Tailwind width classes they replace rather than a new choice.
 */
const NOMINAL_TABLE_PX = 1344;

export const DEFAULT_COLUMN_SHARES: Record<UnitColumn, number> = {
  own: 24 / NOMINAL_TABLE_PX,
  unitId: 64 / NOMINAL_TABLE_PX,
  name: 208 / NOMINAL_TABLE_PX,
  faction: 192 / NOMINAL_TABLE_PX,
  men: 64 / NOMINAL_TABLE_PX,
  skills: 220 / NOMINAL_TABLE_PX,
  items: 220 / NOMINAL_TABLE_PX,
  structure: 208 / NOMINAL_TABLE_PX,
  longOrder: 144 / NOMINAL_TABLE_PX
};

/**
 * No column may be dragged narrower than this on screen, whatever the table's width - enough for
 * a truncated word and its ellipsis. Kept in pixels because that is the unit a reader sees; the
 * splitter converts it against the table's measured width once, at the start of each gesture.
 */
export const COLUMN_MIN_PX = 36;

/** A column's share: the stored preference if there is one, otherwise the shipped default. */
export function shareOf(column: UnitColumn, shares: ColumnShares | null): number {
  return shares?.[column] ?? DEFAULT_COLUMN_SHARES[column];
}

/**
 * A stored share record, reconciled against the columns this build knows - the same posture
 * `reconcile` in `workspaceStore.ts` takes with booleans, plus the renormalisation that makes the
 * "cannot overflow" claim hold *across versions* and not merely within one session.
 *
 * A column this build no longer has is dropped; a value that is not a finite number, is `<= 0` or
 * is `>= 1` is dropped too. Whatever survives is completed from the defaults and scaled to sum to
 * exactly 1, because a record that has lost a column no longer covers the table. Nothing usable
 * at all returns `{}`, and `shareOf` then falls back to the defaults.
 */
export function columnSharesFromStorage(stored: unknown): ColumnShares {
  if (typeof stored !== "object" || stored === null) {
    return {};
  }
  const kept: ColumnShares = {};
  for (const column of UNIT_COLUMNS) {
    const value = (stored as Record<string, unknown>)[column];
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1) {
      kept[column] = value;
    }
  }
  if (Object.keys(kept).length === 0) {
    return {};
  }
  const whole = UNIT_COLUMNS.map(
    (column) => [column, kept[column] ?? DEFAULT_COLUMN_SHARES[column]] as const
  );
  const total = whole.reduce((sum, [, share]) => sum + share, 0);
  return Object.fromEntries(whole.map(([column, share]) => [column, share / total]));
}

export type ColumnDragResult = { left: number; right: number; atLimit: boolean };

/**
 * Resolves a boundary drag (or one keyboard step) between two adjacent columns, in shares.
 *
 * `deltaShare` is positive when the pointer moves right, growing the left column and shrinking the
 * right one by the same amount - `leftStart + rightStart` is therefore invariant, so the whole
 * table still sums to 1 however many drags are applied, in any order.
 *
 * `minShare` is the caller's `COLUMN_MIN_PX` expressed against the table's measured width, so the
 * floor is a real pixel floor even though the arithmetic is in shares. Both floors are enforced
 * together: growing the left column can only take what the right one has above its own floor, and
 * `Math.min(minShare, total / 2)` covers the case where two columns together cannot honour it.
 */
export function dragColumnShare(
  leftStart: number,
  rightStart: number,
  deltaShare: number,
  minShare: number
): ColumnDragResult {
  const total = leftStart + rightStart;
  const lowest = Math.min(minShare, total / 2);
  const highest = total - lowest;
  const raw = leftStart + deltaShare;
  const left = clamp(raw, lowest, highest);
  return { left, right: total - left, atLimit: left !== raw };
}

/**
 * The style for one `<col>`: a percentage, never a pixel. Mixing the two is exactly what let the
 * pixel model overflow a `table-fixed` box, so this is the only way a column width is ever
 * written - by the render and by the splitter's mid-drag writes alike.
 */
export function columnWidthStyle(
  column: UnitColumn,
  shares: ColumnShares | null
): { width: string } {
  return { width: `${shareOf(column, shares) * 100}%` };
}

/** The order the table draws its columns in - always a permutation of `UNIT_COLUMNS`. */
export type ColumnOrder = UnitColumn[];

/**
 * The order to draw columns in: the stored preference if there is one, otherwise the shipped
 * default - the order equivalent of `shareOf`.
 *
 * It validates rather than trusting, using the same all-or-nothing test storage does. `merge`
 * already rejects a bad stored value on load, so this only ever matters for one held in memory -
 * but the cost is a walk over nine strings, memoised by the one caller, and the alternative is a
 * table drawn from an order that is missing a column.
 */
export function orderOf(order: ColumnOrder | null): ColumnOrder {
  return columnOrderFromStorage(order) ?? [...UNIT_COLUMNS];
}

/**
 * A stored order, rejected whole if anything about it is wrong.
 *
 * All-or-nothing rather than repaired: a partial reorder is not obviously better than the shipped
 * order, and guessing where a missing column belongs is worse than just starting over. A stored
 * order missing a column that a later build added is exactly the case that tempts a patch.
 */
export function columnOrderFromStorage(stored: unknown): ColumnOrder | null {
  if (!Array.isArray(stored) || stored.length !== UNIT_COLUMNS.length) {
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

/**
 * `own` never moves: a 24px marker column has no room for a grip, and the leftmost spot is the
 * natural place for a marker anyway.
 */
export const REORDERABLE_COLUMNS = UNIT_COLUMNS.filter(
  (column) => column !== "own"
) as readonly UnitColumn[];

/**
 * Resolves a drag-to-reorder: the order after every adjacent swap the pointer has travelled far
 * enough to cross. The threshold for swapping with a neighbour is that neighbour's own width, so a
 * column trades places once dragged past the whole of it. `own` is never swapped with.
 *
 * Widths arrive as a lookup rather than a record because they are stored as shares (`ColumnShares`)
 * and the caller resolves them to pixels once, at `pointerdown`, against the measured table.
 */
export function dragColumnOrder(
  order: ColumnOrder,
  dragged: UnitColumn,
  deltaPx: number,
  widthPxOf: (column: UnitColumn) => number
): ColumnOrder {
  const next = [...order];
  let index = next.indexOf(dragged);
  if (index === -1 || dragged === "own") {
    return next;
  }
  let remaining = deltaPx;

  while (remaining > 0 && index < next.length - 1 && next[index + 1] !== "own") {
    const threshold = widthPxOf(next[index + 1]);
    if (remaining < threshold) {
      break;
    }
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    remaining -= threshold;
    index += 1;
  }

  while (remaining < 0 && index > 0 && next[index - 1] !== "own") {
    const threshold = widthPxOf(next[index - 1]);
    if (-remaining < threshold) {
      break;
    }
    [next[index], next[index - 1]] = [next[index - 1], next[index]];
    remaining += threshold;
    index -= 1;
  }

  return next;
}

/**
 * The x offset, from the table's left edge, of the boundary the dragged column will land on.
 *
 * The sum of the widths of every column that precedes it in the prospective order, itself excluded.
 * Stated that way it is correct in both directions without an off-by-one: dragging left or right,
 * the line marks the left edge of where the column comes to rest.
 */
export function dropBoundaryX(
  prospective: ColumnOrder,
  dragged: UnitColumn,
  widthPxOf: (column: UnitColumn) => number
): number {
  let x = 0;
  for (const column of prospective) {
    if (column === dragged) {
      break;
    }
    x += widthPxOf(column);
  }
  return x;
}
