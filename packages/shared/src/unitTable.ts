import type { ReportUnit, StructureInfo, UnitSilver } from "@atlantis/core-client";

import { unitStructureLabel } from "./structureLabel";
import { compareUnitIds, idNumber } from "./unitOrder";

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
export type SortColumn =
  | "unitId"
  | "name"
  | "faction"
  | "men"
  | "structure"
  | "longOrder"
  | "silver"
  /** Only ever drawn for an Army source, where each member carries the turn it was last seen. */
  | "seen";

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
  "movement",
  "flags",
  "skills",
  "items",
  "structure",
  "longOrder",
  "silver"
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
  movement: "Move",
  flags: "Flags",
  skills: "Skills",
  items: "Items",
  structure: "Structure",
  longOrder: "Long order",
  silver: "Silver"
};

export type SortState = {
  column: SortColumn;
  direction: "asc" | "desc";
  /** Own units held in a block above foreign ones, whatever the column says. */
  groupOwnFirst: boolean;
};

export const DEFAULT_SORT: SortState = {
  column: "unitId",
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
 *
 * `skillsText` is what the Skills cell drew, so the filter can find `RIDI 5` or `turn 71` on a row
 * that is showing battle-derived skills rather than its own (`ah-1mpx.6.3`). It defaults to the
 * unit's own report-native skill text, so a unit whose caller passes nothing is still searchable by
 * its skills exactly as it always was.
 */
export function filterUnits(
  units: ReportUnit[],
  needle: string,
  structures: readonly StructureInfo[] = [],
  skillsText: (unit: ReportUnit) => string = defaultSkillsText
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
      unitStructureLabel(unit.structureId, byId) ?? "",
      skillsText(unit)
    ]
      .join(" ")
      .toLowerCase()
      .includes(wanted)
  );
}

const indexById = (structures: readonly StructureInfo[]) =>
  new Map(structures.map((structure) => [structure.structureId, structure]));

/** `filterUnits`' default `skillsText`: exactly the report-native text the Skills cell has always shown. */
const defaultSkillsText = (unit: ReportUnit): string =>
  unit.skills.map((skill) => `${skill.tag} ${skill.level} (${skill.points})`).join(", ");

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
  longOrders: ReadonlyMap<string, string | null>,
  silver: ReadonlyMap<string, number | null>,
  seen: ReadonlyMap<string, number>
): number | string | null {
  switch (column) {
    case "unitId":
      return idNumber(unit.unitId);
    case "name":
      return unit.name;
    case "faction":
      return unit.factionName;
    case "men":
      return unit.men;
    case "structure":
      return structureKey(unit.structureId, structures);
    // Both of these are keyed by hex and unit, because a unit number is unique to a hex and not to
    // a turn: two hexes can each hold a `new-1` (`ah-9o0c.2`), and a lookup on the id alone hands
    // one hex's row the other's answer.
    case "longOrder":
      return longOrderKey(longOrders.get(unitRowKey(unit.regionId, unit.unitId)) ?? null);
    // A forecast that could not be priced, and a foreign unit that has none at all, are both null
    // - which `compareValues` already sorts last in either direction, so neither needs a sentinel.
    case "silver":
      return silver.get(unitRowKey(unit.regionId, unit.unitId)) ?? null;
    // A row with no entry - every row of a source that is not an Army - is null, which
    // `compareValues` already sorts last in either direction.
    case "seen":
      return seen.get(unit.unitId) ?? null;
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
  const numeric = idNumber(structureId);
  const tieBreak = numeric === null ? structureId : String(numeric).padStart(12, "0");
  return `${name}\u0000${tieBreak}`;
}

/**
 * Orders the table.
 *
 * With the default state this is exactly what unitsForHex produces, which is the contract that
 * lets AppShell keep using that function to choose a hex's default unit while the table is sorted
 * some other way.
 *
 * Ownership is compared before the column and never reversed, so flipping a column to descending
 * cannot bury the player's own units under a bigger foreign stack. Units a column cannot separate
 * are broken apart by unit id, ascending whichever way the column runs, so the same hex reads the
 * same way every turn rather than in whatever order the report listed them.
 */
export function sortUnits(
  units: ReportUnit[],
  sort: SortState,
  structures: readonly StructureInfo[] = [],
  /** Each own unit's month-long order, for the column that sorts on it. */
  longOrders: ReadonlyMap<string, string | null> = new Map(),
  /** Each own unit's forecast silver at month end, for the column that sorts on it. `ah-1wcw.1`. */
  silver: ReadonlyMap<string, number | null> = new Map(),
  /** Each Army member's `seenTurn`, for the column that sorts on it. `ah-1mpx.2`. */
  seen: ReadonlyMap<string, number> = new Map()
): ReportUnit[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  const byId = indexById(structures);

  return [...units].sort((left, right) => {
    if (sort.groupOwnFirst && left.own !== right.own) {
      return left.own ? -1 : 1;
    }

    const outcome = compareValues(
      valueOf(left, sort.column, byId, longOrders, silver, seen),
      valueOf(right, sort.column, byId, longOrders, silver, seen)
    );
    const decided = "settled" in outcome ? outcome.settled : outcome.compare * direction;
    return decided !== 0 ? decided : compareUnitIds(left.unitId, right.unitId);
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
 * 1440px table - own 24, unitId 64, name 208, faction 192, men 64, skills 220, items 220,
 * structure 208, longOrder 144, silver 96. A player who never drags must see no difference at all,
 * so these are a restatement of the Tailwind width classes they replace rather than a new choice -
 * and `silver` (ah-1wcw.1) widened the nominal table by its own 96 rather than taking width from
 * any of the ten that were here before it.
 */
const NOMINAL_TABLE_PX = 1504;

/**
 * The silver figure the column shows: the forecast, less upkeep when the setting says so.
 *
 * `null` propagates - a forecast that could not be priced, or an upkeep that could not be, is not
 * a number - which is what puts the row's `?` in the column and sorts it last. With the setting
 * off the upkeep is not consulted at all, so a unit nobody could price a fee for still shows the
 * figure `ah-1wcw.1` shipped.
 */
export function silverShown(silver: UnitSilver | null, countUpkeep: boolean): number | null {
  if (silver === null || silver.atMonthEnd === null) {
    return null;
  }
  if (!countUpkeep) {
    return silver.atMonthEnd;
  }
  return silver.upkeep === null ? null : silver.atMonthEnd - silver.upkeep;
}

/**
 * A unit's identity across a list that spans hexes: the hex it stands in, then its number.
 *
 * A unit *number* is not unique report-wide. The core mints a unit a `FORM` created this month as
 * `new-{alias}`, and `rules/form` scopes an alias to its region - so two hexes may each write
 * `FORM 1` and both units are called `new-1`. Anything that keys a row, a React child, a pick or
 * a lookup while spanning hexes keys on this pair (`ah-jw85`, `ah-9o0c.2`).
 *
 * The separator is a NUL, which no region id or unit id can contain, so no pair of inputs can
 * produce the same key as a different pair.
 */
export function unitRowKey(regionId: string, unitId: string): string {
  return `${regionId}\0${unitId}`;
}

/**
 * The DOM selector for one row of the units table: the number and the hex, because two hexes may
 * each hold a `new-1` and `data-testid` alone matches both (`ah-9o0c.2`, `ah-bubf`).
 *
 * The values are quoted CSS strings rather than `CSS.escape`d: `CSS.escape` produces an
 * *identifier* escape, so a region id such as `1:6,52` would come back as `1\:6\,52` and match
 * nothing inside quotes. Only `\` and `"` need escaping in a CSS string, and no id contains either.
 */
export function unitRowSelector(regionId: string, unitId: string): string {
  const quote = (value: string): string => value.replace(/[\\"]/g, "\\$&");
  return `[data-testid="unit-row-${quote(unitId)}"][data-region-id="${quote(regionId)}"]`;
}

/**
 * A silver forecast is found by hex and unit, because `new-1` is unique to a hex, not to a turn:
 * two hexes can each hold a unit a `FORM 1` created this month (`ah-jw85`), and a lookup keyed on
 * the unit id alone would hand one hex's figure to the other's row.
 */
export function silverKey(regionId: string, unitId: string): string {
  return unitRowKey(regionId, unitId);
}

export const DEFAULT_COLUMN_SHARES: Record<UnitColumn, number> = {
  own: 24 / NOMINAL_TABLE_PX,
  unitId: 64 / NOMINAL_TABLE_PX,
  name: 208 / NOMINAL_TABLE_PX,
  faction: 192 / NOMINAL_TABLE_PX,
  men: 64 / NOMINAL_TABLE_PX,
  movement: 64 / NOMINAL_TABLE_PX,
  flags: 80 / NOMINAL_TABLE_PX,
  skills: 180 / NOMINAL_TABLE_PX,
  items: 180 / NOMINAL_TABLE_PX,
  structure: 208 / NOMINAL_TABLE_PX,
  longOrder: 144 / NOMINAL_TABLE_PX,
  silver: 96 / NOMINAL_TABLE_PX
};

/**
 * The source-dependent columns, drawn to the right of `name` in this order and deliberately NOT
 * members of `UNIT_COLUMNS` - see `sharesFor` for why.
 *
 * `hex` for any source that spans hexes, `seen` and `remove` only for an Army. They are fixed
 * width and take no part in dragging, reordering or the stored preferences (`ah-1mpx.2`).
 */
export type ExtraColumn = "hex" | "seen" | "remove";

/** Their shares, against the same nominal 1440px table `DEFAULT_COLUMN_SHARES` is measured on. */
export const EXTRA_COLUMN_SHARES: Record<ExtraColumn, number> = {
  hex: 79 / NOMINAL_TABLE_PX, // `(11,55)` and its ellipsis
  seen: 75 / NOMINAL_TABLE_PX, // `turn 68`
  remove: 86 / NOMINAL_TABLE_PX // the Remove button
};

/**
 * The visible columns' shares, renormalised so they and the extra columns exactly fill the table.
 *
 * `table-fixed` will not stretch to cover a gap, and the whole argument for shares over pixels
 * (see `ColumnShares`) is that the values always sum to 1. Hiding a column for one source, or
 * giving a fixed slice to a column that is not in `UNIT_COLUMNS` at all, breaks that unless the
 * remainder is scaled back up - so this is the one place a width is computed when the drawn set
 * is not the whole set.
 *
 * `extra` is the total share taken by columns outside `UNIT_COLUMNS`, between 0 and 1.
 */
export function sharesFor(
  visible: readonly UnitColumn[],
  shares: ColumnShares | null,
  extra: number
): ColumnShares {
  const own = visible.map((column) => [column, shareOf(column, shares)] as const);
  // The whole set with nothing beside it already sums to 1 - `columnSharesFromStorage` guarantees
  // it, and the defaults are measured to it - so there is nothing to redistribute. Handed back
  // untouched rather than divided by its own total and multiplied by one: that round trip is
  // exact in arithmetic and not in floating point, and it would put a few ulps of drift into
  // every `<col>` of the default view for no gain at all.
  if (extra <= 0 && visible.length === UNIT_COLUMNS.length) {
    return Object.fromEntries(own);
  }
  const total = own.reduce((sum, [, share]) => sum + share, 0);
  // Nothing visible, or an `extra` that already fills the table, leaves nothing to scale: hand
  // back what was asked for rather than dividing by zero and writing `NaN%` into every `<col>`.
  const room = 1 - extra;
  if (total <= 0 || room <= 0) {
    return Object.fromEntries(own);
  }
  return Object.fromEntries(own.map(([column, share]) => [column, (share / total) * room]));
}

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
 * A stored order, repaired where a later build added a column and rejected whole where anything
 * about it is actually wrong.
 *
 * The policy used to be all-or-nothing with one hard-coded migration for `movement`. That cannot
 * survive a second added column: every stored order would be rejected — and every player's column
 * order silently reset — on each release that adds one. So a column this build knows and the stored
 * order lacks is inserted immediately after the column that precedes it in `UNIT_COLUMNS`, which
 * reproduces the old `movement` behaviour exactly and generalises to whatever comes next. An
 * unknown column, a duplicate, a non-string entry or an over-long order is still rejected outright.
 */
export function columnOrderFromStorage(stored: unknown): ColumnOrder | null {
  if (!Array.isArray(stored) || stored.length > UNIT_COLUMNS.length) {
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
  if (seen.size === UNIT_COLUMNS.length) {
    return stored as ColumnOrder;
  }
  const order = [...stored] as UnitColumn[];
  UNIT_COLUMNS.forEach((column, index) => {
    if (seen.has(column)) {
      return;
    }
    const predecessor = index === 0 ? undefined : UNIT_COLUMNS[index - 1];
    // -1 for the first column, whose predecessor is `undefined`; every later column's predecessor
    // has already been spliced in by the time it is considered, because this walk is in
    // `UNIT_COLUMNS` order. So `at + 1` is the front in that one case and the right place in all
    // the others.
    const at = predecessor === undefined ? -1 : order.indexOf(predecessor);
    order.splice(at + 1, 0, column);
  });
  return order as ColumnOrder;
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
 * The x offset, from the table's left edge, of the boundary the dragged column will land on -
 * measured in the layout the player is actually looking at.
 *
 * That distinction is the whole of this function. The table deliberately does not reorder until the
 * drop (see `reorderFeedback.ts`, where reordering under the pointer was the rejected option), so a
 * boundary computed in the prospective order is drawn over a table laid out in the starting one.
 * Dragging left the two coincide; dragging right they differ by exactly the dragged column's own
 * width, and the line lands mid-column.
 *
 * So: find the last column that will precede the dragged one, and measure to its right edge in the
 * *current* order - which is where the gap the player is aiming at actually is. If nothing precedes
 * it, the answer is 0.
 */
export function dropBoundaryX(
  current: ColumnOrder,
  prospective: ColumnOrder,
  dragged: UnitColumn,
  widthPxOf: (column: UnitColumn) => number
): number {
  const before = new Set<UnitColumn>();
  for (const column of prospective) {
    if (column === dragged) {
      break;
    }
    before.add(column);
  }
  if (before.size === 0) {
    return 0;
  }

  // Walk the *current* order, accumulating every width up to and including the last column that
  // will end up before the dragged one. The dragged column's own width counts when it still sits
  // within that span on screen - which is precisely the rightward case.
  let x = 0;
  let boundary = 0;
  for (const column of current) {
    x += widthPxOf(column);
    if (before.has(column)) {
      boundary = x;
    }
  }
  return boundary;
}

/**
 * The columns a player may hide (ah-20di). `own` is a 24px marker with no header to read, and
 * `unitId` and `name` are what identifies a row, so all three are always drawn - which is also
 * why "every column hidden" is unreachable and needs no empty state.
 */
export const HIDEABLE_COLUMNS = [
  "faction",
  "men",
  "movement",
  "flags",
  "skills",
  "items",
  "structure",
  "longOrder",
  "silver"
] as const;

export type HideableColumn = (typeof HIDEABLE_COLUMNS)[number];

/** Which hideable columns are drawn. Every other column is drawn always. */
export type ColumnVisibility = Record<HideableColumn, boolean>;

const HIDEABLE_SET = new Set<string>(HIDEABLE_COLUMNS);

/**
 * The shipped answer: everything shown. A fresh record each call, never a shared object - the
 * store hands it to `reconcile`, which spreads it, and a shared mutable default is one accidental
 * write away from changing everybody's.
 */
export function allColumnsShown(): ColumnVisibility {
  return Object.fromEntries(HIDEABLE_COLUMNS.map((column) => [column, true])) as ColumnVisibility;
}

export function isHideable(column: UnitColumn): column is HideableColumn {
  return HIDEABLE_SET.has(column);
}

/** `order` with the hidden columns taken out, in the same relative order. */
export function shownColumns(order: ColumnOrder, shown: ColumnVisibility): ColumnOrder {
  return order.filter((column) => !isHideable(column) || shown[column]);
}

/**
 * What one stored share is worth on screen - the exact factor `sharesFor` applies, so a resize or
 * a reorder measures against the table the columns are actually drawn in. Arguments and meaning
 * match `sharesFor`, branch for branch: a scale that disagreed with the render would make every
 * drag overshoot, and smoothly enough to read as a feel problem rather than a bug.
 */
export function shareScaleFor(
  visible: readonly UnitColumn[],
  shares: ColumnShares | null,
  extra: number
): number {
  if (extra <= 0 && visible.length === UNIT_COLUMNS.length) {
    return 1;
  }
  const total = visible.reduce((sum, column) => sum + shareOf(column, shares), 0);
  const room = 1 - extra;
  if (total <= 0 || room <= 0) {
    return 1;
  }
  return room / total;
}

/**
 * A reorder performed on the shown columns, folded back into the full stored order: a hidden
 * column keeps the array index it had, and the shown columns fill the remaining slots in their
 * new relative order.
 */
export function mergeShownOrder(full: ColumnOrder, shownAfter: ColumnOrder): ColumnOrder {
  const moving = new Set<string>(shownAfter);
  const queue = [...shownAfter];
  return full.map((column) => (moving.has(column) ? (queue.shift() as UnitColumn) : column));
}

/**
 * The sort to actually apply: a sort on a hidden column falls back to `DEFAULT_SORT.column`,
 * which is never hideable, keeping the direction and the own-first grouping. Derived per render
 * rather than written back, so showing the column again restores its sort.
 */
export function sortAfterHiding(sort: SortState, shown: ColumnVisibility): SortState {
  const column = sort.column as UnitColumn;
  if (!isHideable(column) || shown[column]) {
    return sort;
  }
  return { ...sort, column: DEFAULT_SORT.column };
}

/**
 * The sort a click on one column's header means, given the sort **currently on screen**.
 *
 * `current` is the effective sort - what `sortAfterHiding` derived - and not the raw state, which
 * is the whole point of extracting this. With a sort on a hidden column the header shows the
 * default column ascending; a click on that header read against the raw state takes the
 * "different column" branch and writes exactly what is already drawn, so the header looks dead
 * until it is clicked twice.
 */
export function nextSort(current: SortState, column: SortColumn): SortState {
  return current.column === column
    ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" }
    : { ...current, column, direction: "asc" };
}
