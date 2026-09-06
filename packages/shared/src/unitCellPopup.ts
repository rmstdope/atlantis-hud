import type {
  ItemChange,
  ItemChangeParty,
  SilverChange,
  SkillInfo,
  SkillMerge,
  StudyForecast,
  UnitMovementMode,
  UnitSilver
} from "@atlantis/core-client";
import { count } from "./plural";
import { battleSkillGroups, battleSkillSource } from "./battleSkillPresentation";
import type { DerivedSkill } from "./battleSkills";
import { flagWords } from "./unitFlags";
import { describeMenBriefly, whyEstimated } from "./unitComposition";
import { presentUnitMovement } from "./unitMovement";
import {
  buildSpendTarget,
  changeFor,
  hasUncertainTransportTarget,
  itemsTooltip,
  originalTooltip,
  type PreviewedUnit
} from "./unitPreview";
import { SILVER_NOTES, summariseUnit, type SilverFacts } from "./unitTooltip";
import {
  COLUMN_LABELS,
  silverIsRed,
  silverShown,
  type ExtraColumn,
  type UnitColumn
} from "./unitTable";

/**
 * What resting the pointer on one cell of the units table says.
 *
 * One place decides it, for every column, so the cell's hidden sentence for a screen reader and
 * the popup the eye sees can never disagree: both are this module's answer, drawn twice. It is
 * pure and holds no React, because `packages/shared` has no jsdom and a rule that lives in a
 * component there cannot be tested at all (`.cerebro/traps.md`).
 *
 * It sits at a leaf of the import graph. `unitPreview` already imports from `unitTooltip`, so this
 * module may import from both and neither may import it back.
 */

/** A column of the table as the resolver sees it: one of its own, or one a source added. */
export type PopupColumn = UnitColumn | ExtraColumn;

/**
 * How a figure moved this month (decision **R1**, `ah-rgkk.6`).
 *
 * `from` is what the report said, grouped as the line's own `value` is; `value` is where it stands
 * now. The two together are the pair the popup draws, and `direction` is what colours the second
 * of them.
 */
export type PopupChange = { direction: "up" | "down"; from: string };

/**
 * One figure in a Skills line's chain (`ah-rgkk.2.3`).
 *
 * `mark` is how this figure stands against the one before it, which is what colours it. `reported`
 * is always the first step and is never coloured; `projected` is next turn's and is drawn in the
 * selection blue whichever way it moved, because what marks it out is that it has not happened.
 */
export type PopupStep = {
  /** `2 (90)`, or the words `none` and `gone` for a skill the unit did not or does not hold. */
  value: string;
  mark: "reported" | "up" | "down" | "flat" | "projected";
  /** A trailing `?`: the projection rests on something this report cannot settle (decision **U2**). */
  uncertain?: boolean;
};

/** One line of a column popup. */
export type PopupLine = {
  /** What it is, on the left. Lower case, as the report writes item and skill names. */
  label: string;
  /** What it stands at, on the right, already formatted. */
  value: string;
  /** Absent where nothing changed. */
  change?: PopupChange;
  /**
   * The figures this line moved through, when there is more than one to show (`ah-rgkk.2.3`).
   *
   * Present only with **two or more** entries, and only on the Skills column. The first entry is
   * always `reported`; `value` above is the figure the line stands at **now**, which is the last
   * entry that is not `projected` - a projection is not what the unit stands at. `steps` and
   * `change` are never both set.
   */
  steps?: readonly PopupStep[];
  /**
   * How this line stands against its neighbours (`ah-rgkk.5.1`).
   *
   * `deciding` is the carrying capacity the unit's mode rests on - the one its load has to beat;
   * `aside` is one that does not apply. Absent on every other line and every other column, which
   * are drawn exactly as they are today.
   */
  stress?: "deciding" | "aside";
  /** One clause saying why it moved, e.g. `4 bought at 60 silver each`. Absent where unknown. */
  why?: string;
  /**
   * How to ink a value that is not a pair - a signed amount on a ledger line (`ah-rgkk.4.3`).
   *
   * The same two inks decision **R1** puts on the after of a pair, for the same reason: the sign
   * already says the direction, so this is decoration, and `popupAsText` says nothing about it.
   */
  tone?: "up" | "down";
};

/** What one column's popup shows. */
export type ColumnPopup = {
  /** `Braves (1487) — items`. */
  title: string;
  /** At most `MAX_LINES`; `popupForCell` caps them and adds the "and N more" note. */
  lines: PopupLine[];
  /** Dim sentences under the lines, in order, each ending with a full stop. */
  notes: string[];
  /** One amber sentence, or null. */
  warning: string | null;
};

/** What resting on a cell of this column opens. */
export type PopupSpec =
  | { kind: "silent" }
  | { kind: "unit" }
  | { kind: "column"; popup: ColumnPopup };

/**
 * What the row has already worked out, so the resolver derives nothing the table has not already
 * decided and the two can never disagree.
 */
export type PopupFacts = {
  /** `unitStructureLabel(unit.structureId, structuresById)`, or null in the open. */
  structureLabel: string | null;
  /** `getLongOrder(...)` for one of ours; null for a foreign unit and for none written. */
  longOrder: string | null;
  /** `getSilver(...)`, or null for a unit with no forecast. */
  silver: UnitSilver | null;
  /** Whether a `not-enough-silver` or `upkeep-exceeds-unclaimed` finding names this unit. */
  silverWarned: boolean;
  /** The Silver column's upkeep setting (`ah-1wcw.4`). */
  countUpkeep: boolean;
  /** Battle-recovered skills for this unit, or `[]` (`ah-1mpx.6.3`). */
  derivedSkills: readonly DerivedSkill[];
  /**
   * Whether `rules/form` dissolves this row before the month ends (`ah-ty3s.3`).
   *
   * The Silver cell already draws `no month end` for one of these, so the popup must not read out
   * a working the cell itself refuses to show.
   */
  dissolving: boolean;
  /**
   * Every unit the table is drawing, by unit number, for naming a giver or a taker
   * (`ah-rgkk.2.3`). A `GIVE` and a `TAKE FROM` are both within one hex, so the source is almost
   * always a row the table already holds; one it does not is named `unit 1502`.
   */
  unitNames: ReadonlyMap<string, string>;
};

/** Columns that say nothing when the pointer rests on them (decision **E2**). */
const SILENT: ReadonlySet<PopupColumn> = new Set<PopupColumn>([
  "own",
  "faction",
  "hex",
  "seen",
  "remove"
]);

/** Columns whose popup is the whole-unit summary the table has shown all along (decision **D1**). */
const WHOLE_UNIT: ReadonlySet<PopupColumn> = new Set<PopupColumn>(["name", "unitId"]);

/** Whether resting on this column opens anything at all. Column-only; no unit is needed. */
export function columnHasPopup(column: PopupColumn): boolean {
  return !SILENT.has(column);
}

/**
 * Whether this column's popup is one of its own rather than the whole-unit summary — which is the
 * same question as whether its cell has a sentence to carry for a screen reader.
 *
 * Column-only, so the table can build that list rather than keep one by hand: a column added to
 * the table and forgotten here would silently lose its explanation instead of failing.
 */
export function columnHasOwnPopup(column: PopupColumn): boolean {
  return columnHasPopup(column) && !WHOLE_UNIT.has(column);
}

/** The report's own figure for one item, keyed by tag, as the `items` change recorded it. */
export type ReportedItems = Map<string, number>;

/** One token of the `items` change's original: a whole amount and a bare tag, and nothing else. */
const REPORTED_ITEM = /^(-?\d+) (\S+)$/;

/**
 * The report's per-item figures, parsed out of the `items` change's display string.
 *
 * `changes()` builds that string as `format!("{} {}", item.amount, item.tag)` joined with `", "`
 * (`crates/core/src/orders/effects.rs`), so it is `20 SILV, 3 GRAI` and nothing else - no name, no
 * thousands grouping, no cast range. `undefined` when any token fails to parse, which is the
 * signal to quote the string instead of drawing pairs from it.
 *
 * An empty original is an **empty map, not `undefined`**: a formed unit has no original and so
 * never any change at all (`changes()` returns early on `self.original == None`), so an empty
 * `items` original can only mean the report showed this unit holding nothing - a figure, not a
 * gap. That is the one place this column parts company with `markOrQuote`'s empty-original guard,
 * which is about `men`, where `""` means the report never recorded it.
 */
export function reportedItems(original: string): ReportedItems | undefined {
  if (original === "") {
    return new Map();
  }
  const items: ReportedItems = new Map();
  for (const token of original.split(", ")) {
    const match = REPORTED_ITEM.exec(token);
    if (!match) {
      return undefined;
    }
    const amount = Number.parseInt(match[1]!, 10);
    if (Number.isNaN(amount)) {
      return undefined;
    }
    items.set(match[2]!, amount);
  }
  return items;
}

/**
 * The item's display name alone - `grain`, not `grain GRAI` - which both its line's label and its
 * cause sentence are built from, so the two can never disagree.
 *
 * A gone item is the case that needs the fallbacks: `unit.items` no longer holds it, so the name
 * comes from its first movement, and the bare tag is all that is left when there is none. The
 * `items` change's original carries no names at all (`crates/core/src/orders/effects.rs`).
 */
function itemName(tag: string, unit: PreviewedUnit): string | undefined {
  return (
    unit.items.find((item) => item.tag === tag)?.name ??
    (unit.itemChanges ?? []).find((change) => change.tag === tag)?.name
  );
}

/** The same name, falling back to the bare tag - which is what a cause sentence is led by. */
function itemLabel(tag: string, unit: PreviewedUnit): string {
  return itemName(tag, unit) ?? tag;
}

/** One item's line, before the cap: what it is, what it stands at, and where it came from. */
export type ItemLine = { tag: string; line: PopupLine; moved: boolean };

/**
 * The `items` popup's lines, in the order they are drawn.
 *
 * The tags are the union of what the unit holds now and what the report listed, so an item given
 * away in full still has a line ending at `gone` and one that arrived this month starts at
 * `none`.
 */
export function itemLines(unit: PreviewedUnit, reported: ReportedItems | undefined): ItemLine[] {
  const changes = unit.itemChanges ?? [];
  const held = new Map(unit.items.map((item) => [item.tag, item]));
  // The same arithmetic `formatItems` does (`unitPreview.ts`), because the cell under the pointer
  // is drawn from it: it says `2-5 SWOR`, so the popup must not answer `5`.
  const shortfall = new Map<string, number>();
  for (const item of unit.created ?? []) {
    shortfall.set(item.tag, (shortfall.get(item.tag) ?? 0) + (item.most - item.fewest));
  }
  const tags: string[] = [];
  for (const tag of [...held.keys(), ...(reported?.keys() ?? [])]) {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  // Decision **B**: everything the month moved first, in the month's own order, so no movement is
  // ever lost to the cap - then a moved tag the core recorded no change for, then the rest. Inside
  // the last two, the cell's own amount-descending order.
  // Keyed on the order tags *first* appear, not on the raw index of each change: one tag bought at
  // four prices writes four entries, and ranking on the raw index would run a later tag's rank
  // past the two fallback bands below and sort an unmoved item ahead of a moved one.
  const monthOrder = new Map<string, number>();
  for (const change of changes) {
    if (!monthOrder.has(change.tag)) {
      monthOrder.set(change.tag, monthOrder.size);
    }
  }

  return tags.map((tag) => {
    const item = held.get(tag);
    const name = itemName(tag, unit);
    const before = reported?.get(tag);
    const amount = item?.amount;
    const moved =
      changes.some((change) => change.tag === tag) ||
      (before !== undefined && before !== (amount ?? 0)) ||
      (before === undefined && reported !== undefined);
    const line: PopupLine = {
      label: name === undefined ? tag : `${name} ${tag}`,
      value: amount === undefined ? "gone" : rangedValue(amount, shortfall.get(tag) ?? 0)
    };
    const change = changeOf(before, amount, reported);
    return { tag, line: change ? { ...line, change } : line, moved, amount: amount ?? 0 };
  })
    .sort((a, b) => rank(a, monthOrder) - rank(b, monthOrder) || b.amount - a.amount)
    .map(({ tag, line, moved }) => ({ tag, line, moved }));
}

/**
 * Which block a line sorts into: its place in the month for a recorded movement, then a movement
 * the core did not record, then everything the month left alone.
 */
function rank(
  entry: { tag: string; moved: boolean },
  monthOrder: ReadonlyMap<string, number>
): number {
  const inMonth = monthOrder.get(entry.tag);
  if (inMonth !== undefined) {
    return inMonth;
  }
  return entry.moved ? monthOrder.size : monthOrder.size + 1;
}

/**
 * One item's figure as the cell writes it: the amount, or the range a pending cast leaves it
 * between. Grouped, as every other popup figure is.
 */
function rangedValue(amount: number, gap: number): string {
  return gap > 0
    ? `${(amount - gap).toLocaleString()}-${amount.toLocaleString()}`
    : amount.toLocaleString();
}

/**
 * The pair one item's line draws, or nothing at all.
 *
 * A tag held now but absent from the report pairs from `none`; a tag the report listed and the
 * unit no longer holds ends at `gone` and moves `down`.
 */
function changeOf(
  before: number | undefined,
  amount: number | undefined,
  reported: ReportedItems | undefined
): PopupChange | undefined {
  if (reported === undefined) {
    return undefined;
  }
  const now = amount ?? 0;
  if (before === now) {
    return undefined;
  }
  return {
    direction: now > (before ?? 0) ? "up" : "down",
    from: before === undefined ? "none" : before.toLocaleString()
  };
}

/**
 * One changed item's movements as a single sentence, e.g.
 * `grain: sold 12 at 12 silver each, sent 20 to Ferry (4102).` (decision **S2**).
 *
 * `label` is the item's display name alone - `grain`, not `grain GRAI` - and is left lower case,
 * because it is the same word that leads the line above. `sentence()` is deliberately not applied.
 *
 * Movements are neither merged nor capped: one clause each, in the month's order, so a unit that
 * bought one tag at four prices gets four clauses in one wrapping sentence - the cost the
 * navigator accepted with **S2**. `undefined` when there is nothing to say.
 */
export function itemCauseSentence(
  label: string,
  changes: readonly ItemChange[],
  unit: PreviewedUnit,
  /**
   * These are people. A market purchase of men is a recruitment rather than a purchase of goods
   * (`rules/buy`, `rules/economy_recruiting`, New Origins v8.0.0), so the `bought` clause says so.
   */
  people?: boolean
): string | undefined {
  const clauses = changes.map((change) => itemCauseClause(change, unit, people === true));
  return clauses.length === 0 ? undefined : `${label}: ${clauses.join(", ")}.`;
}

/** The other unit of a movement, as `ah-rgkk.2.3` settled it: `Scouts (1502)`, or `unit 1502`. */
function party(other: ItemChangeParty): string {
  return other.name === null ? `unit ${other.unitId}` : `${other.name} (${other.unitId})`;
}

/** One movement, as a fragment. The clauses are joined with `, ` and closed with one full stop. */
function itemCauseClause(change: ItemChange, unit: PreviewedUnit, people: boolean): string {
  const n = Math.abs(change.delta);
  const each = change.unitPrice === null ? "" : ` at ${change.unitPrice} silver each`;
  switch (change.cause) {
    case "bought":
      return `${people ? "recruited" : "bought"} ${n}${each}`;
    case "sold":
      return `sold ${n}${each}`;
    case "withdrawn":
      return `withdrew ${n} from the faction's stores`;
    case "produced":
      return `produced ${n}`;
    case "production-spent":
      return change.other ? `used ${n} for ${party(change.other)} to produce` : `used ${n} as material`;
    case "build-spent":
      return `spent ${n} ${buildSpendPlace(change, unit)}`;
    case "cast-created":
      return castCreatedClause(change, unit, n);
    case "cast-spent":
      return `consumed ${n} by a spell`;
    case "transported-out":
      return change.other && change.other.name === null
        ? `sent ${n} to unit ${change.other.unitId}, which your report does not show`
        : `sent ${n}${change.other ? ` to ${party(change.other)}` : ""}`;
    case "transported-in":
      return `received ${n}${change.other ? ` from ${party(change.other)}` : ""}`;
    case "abandoned":
      return "left behind, unfinished, when the unit leaves the hex";
    case "given-away":
      // `ah-rgkk.3.2` reserves a null party for a GIVE to a foreign faction that names no unit.
      return change.other ? `gave ${n} to ${party(change.other)}` : `gave ${n} to another faction`;
    case "was-given":
      return `given ${n}${change.other ? ` by ${party(change.other)}` : ""}`;
    case "took":
      return `took ${n}${change.other ? ` from ${party(change.other)}` : ""}`;
    case "was-taken-from":
      return `${n} taken${change.other ? ` by ${party(change.other)}` : ""}`;
    case "discarded":
      return `discarded ${n}`;
    case "gift-reverted":
      return `${n} reverted from a unit that formed with nobody`;
    // Required rather than defensive: `ItemChangeCause` is a string union, so a cause from a newer
    // core is compile-time impossible and runtime real, and `ah-rgkk.3.1` asks a reader to treat
    // one as "moved, reason not stated". Deliberately not an exhaustiveness `never`.
    default:
      return change.delta > 0 ? `gained ${n}` : `lost ${n}`;
  }
}

/** What a BUILD spend went into, named from the unit's own `built` list where one matches. */
function buildSpendPlace(change: ItemChange, unit: PreviewedUnit): string {
  if (change.other) {
    return `for ${party(change.other)} to build`;
  }
  const spend = (unit.built ?? []).find((entry) => entry.tag === change.tag);
  return spend ? buildSpendTarget(spend) : "on a build";
}

/** A cast's own words, and its range where the spell's yield is not yet settled. */
function castCreatedClause(change: ItemChange, unit: PreviewedUnit, n: number): string {
  // Summed across every cast of the tag, because one unit may cast the same item twice and a
  // single entry would report one spell's range as the month's.
  const casts = (unit.created ?? []).filter((entry) => entry.tag === change.tag);
  const fewest = casts.reduce((total, entry) => total + entry.fewest, 0);
  const most = casts.reduce((total, entry) => total + entry.most, 0);
  const figure = casts.length > 0 && fewest !== most ? `${fewest}-${most}` : `${n}`;
  return casts.some((entry) => entry.summoned)
    ? `summoned ${figure}`
    : `created ${figure} by casting`;
}

/** How many lines a popup shows before it stops and counts the rest (decision **G-d**). */
export const MAX_LINES = 12;

/**
 * The four words `movement_status_label` writes (`crates/core/src/orders/effects.rs`), ranked as
 * the game picks a mode: it tries fly, then ride, then walk, and refuses a MOVE order when none of
 * them will carry the load (`rules/movement_normal`).
 */
const MOVEMENT_RANK: Record<string, number> = {
  Overloaded: 0,
  Walking: 1,
  Riding: 2,
  Flying: 3
};

/** The three capacities, in the order the report prints them, and what the popup calls them. */
const CAPACITY_LINES: readonly { mode: UnitMovementMode; label: string }[] = [
  { mode: "fly", label: "can carry flying" },
  { mode: "ride", label: "can carry riding" },
  { mode: "walk", label: "can carry walking" }
];

/**
 * The field of `previewChanges` each column's cell is drawn from, for the columns the orders can
 * change. The two columns with no field - `longOrder` and `silver` - say nothing about a change.
 */
const CHANGE_FIELD: Partial<Record<PopupColumn, string>> = {
  men: "men",
  movement: "movement",
  flags: "flags",
  skills: "skills",
  items: "items",
  // The report's own field name, which is not the column's: a structure change is recorded
  // against `structureId` (`UnitTableDock.tsx`, `structureChange`).
  structure: "structureId"
};

/** The columns whose popup lists several things, so the no-change sentence reads as a plural. */
const LISTS: ReadonlySet<PopupColumn> = new Set<PopupColumn>(["skills", "items"]);

export function popupForCell(
  column: PopupColumn,
  unit: PreviewedUnit,
  facts: PopupFacts
): PopupSpec {
  if (SILENT.has(column)) {
    return { kind: "silent" };
  }
  if (WHOLE_UNIT.has(column)) {
    return { kind: "unit" };
  }

  const body = bodyFor(column, unit, facts);
  const field = CHANGE_FIELD[column];
  const change = field ? changeFor(unit, field) : undefined;
  const notes = [...body.notes];
  if (field && !change && !body.changed) {
    notes.push(`Nothing this month changes ${LISTS.has(column) ? "these" : "this"}.`);
  }
  // A column with nothing left to show - moved out of its structure, its last flag dropped, its
  // movement no longer disclosed - has no line for the report's own figure to hang off, and
  // dropping it would lose what the cell's `title` used to say. It becomes a sentence instead.
  //
  // On the emptiness of the body, and deliberately not on "no line carries the change": a line
  // that carries none may be saying there was none - `markOrQuote` returns nothing at all for an
  // original equal to the figure beside it, and the wider test said `Was: 12.` of a figure that
  // did not move.
  if (change && body.lines.length === 0) {
    notes.push(sentence(originalTooltip(change)!));
  }

  // Capped rather than scrolled: the popup is transparent to the pointer, so a wheel over it
  // reaches the table underneath and scrolls the rows out from under the hover that opened it.
  const dropped = Math.max(0, body.lines.length - MAX_LINES);
  if (dropped > 0) {
    notes.unshift(`… and ${dropped} more; select the unit to see them all.`);
  }

  return {
    kind: "column",
    popup: {
      title: `${unit.name} (${unit.unitId}) — ${COLUMN_LABELS[column as UnitColumn]?.toLowerCase() ?? column}`,
      lines: body.lines.slice(0, MAX_LINES),
      notes,
      warning: body.warning ?? null
    }
  };
}

type Body = {
  lines: PopupLine[];
  notes: string[];
  warning?: string | null;
  /**
   * Set by a column that knows the month touched it even though `previewChanges` has no entry for
   * its field - which the `men` column can be: a unit that gives three orcs away and recruits three
   * humans ends the month with the same headcount, so the core records no `men` change while two
   * races moved (`ah-rgkk.4.2`).
   */
  changed?: boolean;
};

/** What one column has to say, before the shared capping and change sentence are applied. */
function bodyFor(column: PopupColumn, unit: PreviewedUnit, facts: PopupFacts): Body {
  switch (column) {
    case "men":
      return menBody(unit, facts);
    case "movement":
      return movementBody(unit);
    case "flags":
      return flagsBody(unit);
    case "skills":
      return skillsBody(unit, facts);
    case "items":
      return itemsBody(unit, facts);
    case "structure":
      return structureBody(unit, facts);
    case "longOrder":
      return longOrderBody(unit, facts);
    case "silver":
      return silverBody(unit, facts);
    default:
      return { lines: [], notes: [] };
  }
}

/**
 * A change the popup can draw as a pair, or one it can only quote.
 *
 * Only a whole number can stand on the left of the arrow beside the figure that holds now. `~8` is
 * the report's own mark for a count it guessed at and `""` is a figure it never recorded; neither
 * is something the pair can be drawn from, so both are quoted in the report's own words instead.
 */
function markOrQuote(change: ReturnType<typeof changeFor>, now: number): Partial<PopupLine> {
  if (!change) {
    return {};
  }
  const before = Number(change.original);
  // `Number("")` is 0 and `Number.isInteger(0)` is true, so an original the report left empty
  // would otherwise read as a real figure of zero and draw a pair with nothing before the arrow.
  if (change.original.trim() === "" || !Number.isInteger(before)) {
    return { why: originalTooltip(change) };
  }
  if (before === now) {
    return {};
  }
  // Grouped the same way the figure beside it is (`describeMenBriefly`), so a four-figure pair
  // reads `4,210 → 4,255` rather than mixing two notations. Safe to re-format because the
  // guard above has already proved `before` a whole number.
  return { change: { direction: now > before ? "up" : "down", from: before.toLocaleString() } };
}

/** A sentence the app already ships as a fragment, ended the way every popup sentence ends. */
function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capitalised.endsWith(".") ? capitalised : `${capitalised}.`;
}

/** One race's line, before the total is put above it (`ah-rgkk.4.2`). */
type RaceLine = { tag: string; line: PopupLine; moved: boolean };

/**
 * Every `ItemChange` of this unit that moved people, in the month's order.
 *
 * `isMan` is the core's answer (`ah-rgkk.4.1`) and the only one this package has: `packages/shared`
 * carries no item catalogue, by decision (`gameData.ts`).
 */
function manChanges(unit: PreviewedUnit): ItemChange[] {
  return (unit.itemChanges ?? []).filter((change) => change.isMan);
}

/**
 * The report's own per-tag figures for the Men popup, off the `items` change - not the `men` one:
 * the per-race before-figures are in the item list, and the `men` change carries only the total.
 */
function reportedFor(unit: PreviewedUnit): ReportedItems | undefined {
  const change = changeFor(unit, CHANGE_FIELD.items!);
  return change ? reportedItems(change.original) : undefined;
}

/**
 * What to call one race: its `menByRace` entry's own name - the report's own word, and so often a
 * plural - failing that the name of its first movement, failing both the bare tag.
 *
 * A race given away in full needs the second: `menByRace` no longer carries it.
 */
function raceName(unit: PreviewedUnit, tag: string): string {
  return (
    unit.menByRace.find((race) => race.tag === tag)?.name ??
    manChanges(unit).find((change) => change.tag === tag)?.name ??
    tag
  );
}

/**
 * The Men popup's per-race lines, in the order they are drawn: `menByRace`'s own order - which is
 * the item list filtered by `is_man` (`crates/core/src/report/composition.rs`), so the report's -
 * then any race the unit no longer holds, in the month's order.
 *
 * `reported` is the report's per-tag figures (`reportedFor`), or `undefined` when there is no items
 * change or its string could not be parsed - in which case no line carries a pair.
 */
function raceLines(unit: PreviewedUnit, reported: ReportedItems | undefined): RaceLine[] {
  const held = new Map(unit.menByRace.map((race) => [race.tag, race.amount]));
  const changes = manChanges(unit);
  const tags = [...held.keys()];
  for (const change of changes) {
    if (!tags.includes(change.tag)) {
      tags.push(change.tag);
    }
  }

  return tags.map((tag) => {
    const amount = held.get(tag);
    const before = reported?.get(tag);
    const line: PopupLine = {
      label: `${raceName(unit, tag)} ${tag}`,
      value: amount === undefined ? "gone" : amount.toLocaleString()
    };
    const change = changeOf(before, amount, reported);
    // Deliberately two clauses where `itemLines` has three: it also counts a tag the report never
    // listed as moved, which earns an item its place ahead of the twelve-line cap. Nothing here is
    // capped or sorted, and `moved` decides only whether a race is offered a sentence - which a
    // race with no `ItemChange` never gets anyway (`itemCauseSentence` returns nothing for an empty
    // list). Do not "fix" this into the third clause.
    const moved =
      changes.some((entry) => entry.tag === tag) ||
      (before !== undefined && before !== (amount ?? 0));
    return { tag, line: change ? { ...line, change } : line, moved };
  });
}

function menBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const total: PopupLine = {
    label: "men",
    value: describeMenBriefly(unit),
    ...markOrQuote(changeFor(unit, CHANGE_FIELD.men!), unit.men)
  };
  const moved = manChanges(unit);
  const unknown = unit.menOfUnknownSkill ?? [];
  const touched = moved.length > 0 || unknown.length > 0;
  const why = whyEstimated(unit);

  // An estimated headcount was never settled against the catalogue, so `men_by_race` is still the
  // report's own list while the item ledger has moved underneath it (`settle_headcounts` returns
  // early on `men_estimated`, `crates/core/src/orders/effects.rs`). Drawing race lines from it
  // would pair the report against itself.
  const entries = unit.menEstimated ? [] : raceLines(unit, reportedFor(unit));

  // The tags to explain, and the order the sentences come in: the drawn races that moved, in the
  // order their lines are drawn, then any tag that moved but has no line - which is every one of
  // them for an estimated unit, whose movements are exact even though its base figure is not.
  const explain: string[] = [];
  for (const entry of entries) {
    if (entry.moved) {
      explain.push(entry.tag);
    }
  }
  for (const change of moved) {
    if (!explain.includes(change.tag)) {
      explain.push(change.tag);
    }
  }

  const notes: string[] = [];
  for (const tag of explain) {
    const said = itemCauseSentence(
      raceName(unit, tag),
      moved.filter((change) => change.tag === tag),
      unit,
      true
    );
    if (said !== undefined) {
      notes.push(said);
    }
  }
  for (const taken of unknown) {
    notes.push(
      `${count(taken.amount, "man", "men")} taken from ${unitReference(taken.from, facts)}, which your report does not show.`
    );
  }
  if (why) {
    notes.push(sentence(why));
  }

  return {
    lines: [total, ...entries.map((entry) => entry.line)],
    notes,
    changed: touched,
    warning:
      unit.menEstimated && (touched || unit.recruitsUnmerged === true)
        ? "This unit's headcount is a guess, so what this month does to it cannot be worked out."
        : null
  };
}

function movementBody(unit: PreviewedUnit): Body {
  const movement = unit.movement;
  if (movement == null) {
    return { lines: [], notes: ["Movement not disclosed."] };
  }
  const present = presentUnitMovement(movement);
  const change = changeFor(unit, CHANGE_FIELD.movement!);
  const lines: PopupLine[] = [
    { label: "move", value: present.label, ...movementPair(change, present.label) },
    { label: "weight", value: movement.load.toLocaleString() },
    ...CAPACITY_LINES.map(({ mode, label }) => ({
      label,
      value: movement[mode].toLocaleString(),
      stress: mode === present.active ? ("deciding" as const) : ("aside" as const)
    }))
  ];
  const causes = movementCauses(unit);
  const notes: string[] = [];
  if (!change && causes.length > 0) {
    notes.push("Its load changed this month, but not the mode it travels in.");
  }
  notes.push(...causes);
  return {
    lines,
    notes,
    changed: causes.length > 0,
    warning: movementIsStillTheReport(unit)
      ? "An order this month could not be counted, so these are the report\u2019s own figures, not this month\u2019s."
      : null
  };
}

/**
 * The `move` line's pair, or the report's own words where the pair cannot be drawn.
 *
 * The core records a `movement` change only when the status word moves, and writes it as one of
 * four words rather than as a status, so the direction is a comparison of those words. A word this
 * app does not know can only have come from a newer core; it is quoted rather than ranked, the
 * same fallback `markOrQuote` uses for a figure it cannot pair.
 */
function movementPair(change: ReturnType<typeof changeFor>, now: string): Partial<PopupLine> {
  if (!change) {
    return {};
  }
  const before = MOVEMENT_RANK[change.original];
  const after = MOVEMENT_RANK[now];
  if (before === undefined || after === undefined) {
    return { why: originalTooltip(change) };
  }
  return { change: { direction: after > before ? "up" : "down", from: change.original } };
}

/**
 * One sentence per item this month moved, in the month's order, capped and counted.
 *
 * The same call the Items popup makes, so the two can never disagree about what moved or why.
 * `sentence()` is applied here and deliberately not there: in the Items popup the word repeats the
 * line drawn directly above it, and here nothing does, so it starts a sentence.
 */
function movementCauses(unit: PreviewedUnit): string[] {
  const changes = unit.itemChanges ?? [];
  const tags: string[] = [];
  for (const change of changes) {
    if (!tags.includes(change.tag)) {
      tags.push(change.tag);
    }
  }
  const said: string[] = [];
  for (const tag of tags.slice(0, MAX_LINES)) {
    const forTag = changes.filter((change) => change.tag === tag);
    const text = itemCauseSentence(itemLabel(tag, unit), forTag, unit, forTag[0]!.isMan);
    if (text !== undefined) {
      said.push(sentence(text));
    }
  }
  if (tags.length > MAX_LINES) {
    said.push(`\u2026 and ${tags.length - MAX_LINES} more; the Items column has them all.`);
  }
  return said;
}

/**
 * Whether the figures above are last month's rather than this month's.
 *
 * `refresh_movement` (`crates/core/src/orders/effects.rs`) gives up on the whole recomputation and
 * hands back the report's own `movement` when any order could not be counted, or when a CAST's
 * yield is still a range. Both are visible here; a third case - an item tag the shipped ruleset
 * does not carry - is not, and is named in the bead's plan rather than guessed at.
 */
function movementIsStillTheReport(unit: PreviewedUnit): boolean {
  return (
    (unit.uncounted?.length ?? 0) > 0 ||
    (unit.created ?? []).some((entry) => entry.fewest !== entry.most)
  );
}

function flagsBody(unit: PreviewedUnit): Body {
  const words = flagWords(unit.flags);
  const change = changeFor(unit, CHANGE_FIELD.flags!);
  if (words === undefined) {
    return { lines: [], notes: ["No flags set."] };
  }
  return {
    lines: [{ label: "flags", value: words, ...(change ? { why: originalTooltip(change) } : {}) }],
    notes: []
  };
}

/**
 * A unit's own skills, or - for a foreign one, whose skills a report never prints
 * (`rules/reportformat`) - whatever the battle rosters recovered, named with the battle it came
 * from exactly as the whole-unit summary names it (`ah-1mpx.6.3`).
 */
function skillsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  return unit.own ? ownSkillsBody(unit, facts) : foreignSkillsBody(unit, facts);
}

/**
 * A foreign unit's Skills popup: what a battle let us read, and the sentence that a report never
 * shows another faction's skills (decision **B1**, `ah-rgkk.1`).
 *
 * Lifted out of `skillsBody` unchanged by `ah-rgkk.2.3`, which rewrote only the own-unit half.
 */
function foreignSkillsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const change = changeFor(unit, CHANGE_FIELD.skills!);
  const quoted = change ? { why: originalTooltip(change) } : {};

  if (unit.skills.length > 0) {
    return {
      lines: summariseUnit(unit).skills.map((entry, index) => ({
        ...entry,
        ...(index === 0 ? quoted : {})
      })),
      notes: []
    };
  }

  const groups = battleSkillGroups(facts.derivedSkills);
  if (groups.length === 0) {
    return { lines: [], notes: ["A report never shows another faction's skills."] };
  }

  const recovered = groups.flatMap((group) =>
    group.skills.map((skill) => ({
      label: `${skill.name} ${skill.tag}`,
      value: String(skill.level)
    }))
  );

  return {
    // The quote goes on the first recovered line, since this body has lines and so is not reached
    // by `popupForCell`'s empty-column sentence - and the cell's `title` carried it before.
    lines: recovered.map((line, index) => (index === 0 ? { ...line, ...quoted } : line)),
    notes: [
      ...groups.map((group) => battleSkillSource(group, "read")),
      "A report never shows another faction's skills."
    ]
  };
}

/** `level (points)`, the shape `summariseUnit` already writes a skill in. */
const figure = (skill: SkillInfo): string => `${skill.level} (${skill.points})`;

/**
 * The figures one skill moved through: what the report said, what the market left, and - when this
 * month's STUDY reaches it - next turn's (decision **N2**, as `docs/ui/ah-rgkk.2.3-chain.html`
 * draws it).
 *
 * At most three, whatever happened. The individual arrivals of men are named in the sentences
 * under the lines rather than drawn as steps of their own, which is what keeps a line the same
 * length for a unit that took one gift and for one that took five.
 *
 * `[]` when there is nothing to show but the figure the line already carries.
 */
function chainFor(
  /** The tag's entry in `unit.reportedSkills`, or undefined for one the report did not list. */
  reported: SkillInfo | undefined,
  /** The tag's entry in `unit.skills`, or undefined for one the unit no longer holds. */
  now: SkillInfo | undefined,
  /**
   * `unit.reportedSkills !== undefined` - whether the row carries a preview at all. Without one
   * there is no report figure to compare against, so no chain is drawn. A unit this month's `FORM`
   * creates carries `[]`, which is a report figure of `none` for every tag rather than no figure.
   */
  hasReport: boolean,
  /** This month's forecast, when it is for this tag. */
  study: StudyForecast | undefined
): PopupStep[] {
  if (!hasReport) {
    return [];
  }
  const before = reported ? figure(reported) : "none";
  // A tag the report did not list and the unit does not hold is one only the study reaches: it
  // stands at nothing, and `gone` would claim it lost something it never had.
  const after = now ? figure(now) : reported ? "gone" : "none";
  const steps: PopupStep[] = [{ value: before, mark: "reported" }];
  if (before !== after) {
    const mark: PopupStep["mark"] = !now
      ? "down"
      : !reported
        ? "up"
        : now.points > reported.points
          ? "up"
          : now.points < reported.points
            ? "down"
            : "flat";
    steps.push({ value: after, mark });
  }
  if (study) {
    steps.push({
      value: `${study.levelAfter} (${study.pointsAfter})`,
      mark: "projected",
      ...(study.doubts.length > 0 ? { uncertain: true } : {})
    });
  }
  return steps.length > 1 ? steps : [];
}

/** `a`, `a and b`, `a, b and c` - for a clause naming several things. */
function andList(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The ratios `rules/studying` states in words; anything else is said as a figure. */
const MONTHS_IN_WORDS: Record<string, string> = {
  "1/4": "a quarter of a month",
  "1/2": "half a month",
  "3/4": "three quarters of a month",
  "1/1": "one month",
  "5/4": "one and a quarter months",
  "3/2": "one and a half months",
  "7/4": "one and three quarters months",
  "2/1": "two months"
};

/**
 * What a month of study is worth, in words where the ratio is one the rules state and as a figure
 * otherwise - a teacher's contribution is `min(1, slots / students)`, so it can be any ratio at
 * all and a table alone would be a bug waiting for a thirteen-student teacher.
 */
function monthsInWords(numerator: number, denominator: number): string {
  const exact = MONTHS_IN_WORDS[`${numerator}/${denominator}`];
  if (exact) {
    return exact;
  }
  const quotient = denominator === 0 ? 0 : numerator / denominator;
  return `${Number(quotient.toFixed(2))} months`;
}

/** `Scouts (1502)` for a row the table holds, and `unit 1502` for one it does not. */
function unitReference(from: string, facts: PopupFacts): string {
  const name = facts.unitNames.get(from);
  return name ? `${name} (${from})` : `unit ${from}`;
}

/** Why one merge of arriving men moved - or did not move - this unit's figures. */
function mergeSentence(merge: SkillMerge, facts: PopupFacts): string {
  if (merge.cause === "recruited") {
    const who =
      merge.menArriving.length > 0
        ? andList(merge.menArriving.map((item) => count(item.amount, item.name)))
        : count(merge.men, "man", "men");
    return `${who} recruited, and recruits bring no skills.`;
  }
  const brought =
    merge.arrivingSkills.length > 0
      ? `, bringing ${andList(merge.arrivingSkills.map((skill) => `${skill.name} ${skill.level}`))}`
      : "";
  const verb = merge.cause === "given" ? "joined from" : "taken from";
  return `${count(merge.men, "man", "men")} ${verb} ${unitReference(merge.from, facts)}${brought}.`;
}

/** The one note the study writes, every clause of it in order. */
function studySentence(study: StudyForecast, projectionDrawn: boolean): string {
  const taught =
    study.teachers.length > 0
      ? `, taught by ${andList(study.teachers.map((teacher) => `${teacher.name} (${teacher.unitId})`))}`
      : "";
  const clauses = [
    `Studying ${study.name}${taught}: worth ${monthsInWords(study.monthsNumerator, study.monthsDenominator)}.`
  ];
  if (study.halvedOutsideABuilding) {
    clauses.push(
      "Studying a magic skill past level 2 outside a building that houses mages, so half the month is lost."
    );
  }
  if (study.heldBackByCeiling) {
    // An empty `limitingRaces` is `StudyCeiling::Global` (`crates/core/src/orders/study.rs`): the
    // skill's own maximum, or races the catalogue cannot judge. Naming a race there would blame
    // one for a limit it did not impose, which is the distinction the core's own warning draws.
    //
    // The catalogue's names are singular by `ah-rgkk.2.2`'s own decision, and `hill dwarf` does
    // not pluralise by appending `s` - so the race construction is one that needs no plural.
    clauses.push(
      study.limitingRaces.length > 0
        ? `No ${andList(study.limitingRaces.map((race) => race.name))} may take ${study.name} past level ${study.ceilingLevel}, so the points rise and the level holds.`
        : sentence(
            `${study.name} stops at level ${study.ceilingLevel}, so the points rise and the level holds`
          )
    );
  }
  if (projectionDrawn) {
    clauses.push("The blue figure is next turn's report; everything before it is this month.");
  }
  return clauses.join(" ");
}

/** One amber sentence per doubt the projection rests on (decision **U2**). */
function doubtSentence(doubt: StudyForecast["doubts"][number], study: StudyForecast): string {
  switch (doubt.reason) {
    case "feeShort":
      return `Studying ${study.name} costs ${doubt.fee.toLocaleString()} silver and this unit is ${doubt.shortBy.toLocaleString()} short, so the study may not happen at all.`;
    case "feeUnpriced":
      return `The data page prices ${study.name} nowhere, so what studying it costs cannot be said.`;
    case "headcountEstimated":
      return "This unit's headcount is a guess, so recruiting may pull these back below what is shown.";
    case "teacherUnsettled":
      return `Whether ${doubt.teacher} may teach cannot be settled from this report, so its month is not counted here.`;
    case "teacherStudentsUnknown":
      return `${doubt.teacher} also teaches a unit of another faction whose headcount the report does not show, so how far its teaching spreads cannot be said.`;
    case "shelterUnknown":
      return "This unit ends the month in a structure this region's report does not list, so whether it shelters a mage cannot be said.";
  }
}

/**
 * One of our own units' Skills popup: every skill as a chain of figures, and a sentence under the
 * lines for every reason one of them moved (`ah-rgkk.2.3`).
 *
 * It derives no arithmetic of its own - every figure and every reason comes off the wire from
 * `ah-rgkk.2.1` and `ah-rgkk.2.2`.
 */
function ownSkillsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const reported = unit.reportedSkills ?? [];
  const hasReport = unit.reportedSkills !== undefined;
  const study = unit.study ?? null;
  const reportedByTag = new Map(reported.map((skill) => [skill.tag, skill]));
  const nowByTag = new Map(unit.skills.map((skill) => [skill.tag, skill]));

  // The report's order, then whatever the month added. `merge_skills` sorts its output by tag
  // (`crates/core/src/orders/effects.rs`), so `unit.skills` is only ever a source of newcomers.
  const tags: string[] = [];
  for (const skill of [...reported, ...unit.skills]) {
    if (!tags.includes(skill.tag)) {
      tags.push(skill.tag);
    }
  }
  if (study && !tags.includes(study.tag)) {
    tags.push(study.tag);
  }

  let projectionDrawn = false;
  const lines: PopupLine[] = tags.map((tag, index) => {
    const before = reportedByTag.get(tag);
    const now = nowByTag.get(tag);
    const forTag = study?.tag === tag ? study : undefined;
    const name = before?.name ?? now?.name ?? forTag?.name ?? tag;
    const steps = chainFor(before, now, hasReport, forTag);
    // Only where the eye will actually find it: `popupForCell` caps the lines at `MAX_LINES`
    // (`ah-rgkk.1`, decision **G-d**), and a studied skill the unit has never held is appended
    // last - so on a twelve-skill unit the note would promise a blue figure that was cut off.
    if (forTag && steps.length > 0 && index < MAX_LINES) {
      projectionDrawn = true;
    }
    return {
      label: `${name} ${tag}`,
      // What the cell under the pointer is drawn from, so the two cannot disagree.
      value: now ? figure(now) : before ? "gone" : "none",
      ...(steps.length > 0 ? { steps } : {})
    };
  });

  const notes: string[] = [];
  for (const merge of unit.skillMerges ?? []) {
    notes.push(mergeSentence(merge, facts));
  }
  for (const taken of unit.menOfUnknownSkill ?? []) {
    notes.push(
      `${count(taken.amount, "man", "men")} came from ${unitReference(taken.from, facts)}, whose skills the report does not show, so these figures do not count them.`
    );
  }
  for (const skill of reported) {
    if (!nowByTag.has(skill.tag)) {
      notes.push(sentence(`${skill.name} drops below one point per man, so the unit loses it`));
    }
  }
  if (study) {
    notes.push(studySentence(study, projectionDrawn));
  }
  if (lines.length === 0) {
    notes.unshift("No skills.");
  }

  const warnings: string[] = [];
  if (unit.recruitsUnmerged) {
    warnings.push(
      "This unit's headcount is a guess, so what recruiting does to these cannot be worked out."
    );
  }
  for (const doubt of study?.doubts ?? []) {
    // The same cause said twice, and the sentence above is the more specific of the two.
    if (doubt.reason === "headcountEstimated" && unit.recruitsUnmerged) {
      continue;
    }
    warnings.push(doubtSentence(doubt, study!));
  }

  return { lines, notes, warning: warnings.length > 0 ? warnings.join(" ") : null };
}

/**
 * What the unit holds, and everything today's ITEMS hover says about how the figure was reached.
 *
 * The amber sentence explains the cell's `+ ?` in general terms, because both of its causes - an
 * order that could not be read, and a TRANSPORT whose target the report cannot settle (`ah-64wm`)
 * - leave the month partly counted; which one it was is in the notes, where `itemsTooltip` already
 * words it.
 */
function itemsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const told = itemsTooltip(unit, facts.silver);
  const partlyCounted =
    (unit.uncounted?.length ?? 0) > 0 || hasUncertainTransportTarget(unit);

  const change = changeFor(unit, CHANGE_FIELD.items!);
  const reported = change ? reportedItems(change.original) : undefined;
  const entries = itemLines(unit, reported);
  // The unparseable-original fallback, the same shape `foreignSkillsBody` uses: no line carries a
  // pair, and the report's own words go on the first line as `why`.
  const quoteFirst = change !== undefined && reported === undefined && entries.length > 0;
  const lines = entries.map((entry, index) =>
    quoteFirst && index === 0 ? { ...entry.line, why: originalTooltip(change) } : entry.line
  );

  // The sentences follow the changed lines, in the same order, so each is under the figure it
  // explains (decision **S2**).
  const changes = unit.itemChanges ?? [];
  const causes = entries
    // Only the entries the cap will draw: **S2** promises the prose block can never be longer
    // than the list above it, and a sentence for a figure the reader cannot see breaks that.
    .slice(0, MAX_LINES)
    .filter((entry) => entry.moved)
    .map((entry) =>
      itemCauseSentence(
        itemLabel(entry.tag, unit),
        changes.filter((c) => c.tag === entry.tag),
        unit
      )
    )
    .filter((note): note is string => note !== undefined);

  return {
    // Off the drawn list rather than off current stock: a unit that gave everything away still
    // has lines, its items ending at `gone`.
    notes: [...causes, ...(told ? told.split("\n") : []), ...(lines.length === 0 ? ["No items."] : [])],
    lines,
    warning: partlyCounted
      ? "“+ ?” in the cell: this month is only partly counted, so this list may be short."
      : null
  };
}

function structureBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const change = changeFor(unit, CHANGE_FIELD.structure!);
  if (facts.structureLabel === null) {
    return { lines: [], notes: ["In no structure."] };
  }
  return {
    lines: [
      {
        label: "structure",
        value: facts.structureLabel,
        ...(change ? { why: originalTooltip(change) } : {})
      }
    ],
    notes: []
  };
}

function longOrderBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  if (!unit.own) {
    return { lines: [], notes: ["Another faction's orders are not in your report."] };
  }
  if (facts.longOrder === null) {
    return { lines: [], notes: ["No long order this month."] };
  }
  return { lines: [{ label: "long order", value: facts.longOrder }], notes: [] };
}

/**
 * The `SILVER_NOTES` this popup does not draw, **because a line it drew says the whole of what the
 * note says** (`ah-rgkk.4.3`, decision **N2** - the Items popup's answer, `ah-rgkk.3.3`'s **T2**).
 *
 * Keyed by note id, each value asking the lines that were actually drawn whether they restated it.
 * The condition is not the note's own: a doubted month draws no cause lines at all
 * (`UnitSilver.changes` is empty there) while `givers`, `takenFrom`, `givenToNobody` and both flags
 * are still populated, so dropping a note on its own `when` would take the sentence away and put
 * nothing in its place. Same for a unit set to tax that taxes nothing this month.
 *
 * Nothing is removed from `SILVER_NOTES` itself: the whole-unit tooltip, which has no cause lines,
 * keeps every one of them word for word.
 */
const SILVER_NOTES_RESTATED: Record<string, (groups: readonly CauseGroup[]) => boolean> = {
  "includes-gift": (groups) => groups.some((group) => group.cause === "was-given"),
  "includes-take": (groups) =>
    groups.some((group) => group.entries.some((entry) => entry.cause === "took")),
  "includes-take-unshown": (groups) =>
    groups.some((group) => group.entries.some((entry) => entry.cause === "took-unshown")),
  "given-to-nobody": (groups) => groups.some((group) => group.cause === "discarded"),
  // Only where the clause fired, which is the same test `silverCauseWhy` makes.
  "taxes-by-flag": (groups) => hasOrderlessGroup(groups, "taxed"),
  "works-by-default": (groups) => hasOrderlessGroup(groups, "worked")
};

/** Whether one cause was drawn with no order of this unit's behind any of it. */
function hasOrderlessGroup(groups: readonly CauseGroup[], cause: string): boolean {
  const group = groups.find((candidate) => candidate.cause === cause);
  return group !== undefined && group.entries.every((entry) => entry.line === null);
}

/** One cause's line: every `SilverChange` with that cause, merged (decision **V2**). */
type CauseGroup = {
  cause: string;
  /** Summed, signed. */
  amount: number;
  /** The `SilverChange` entries behind it, in the order `UnitSilver.changes` carried them. */
  entries: SilverChange[];
};

/** What one cause's line is called. An unknown cause falls back to the cause itself, unhyphenated. */
const SILVER_CAUSE_LABELS: Record<string, string> = {
  taxed: "taxed",
  pillaged: "pillaged",
  claimed: "claimed",
  sold: "sold",
  "cast-earned": "earned by casting",
  worked: "worked",
  entertained: "entertained",
  "was-given": "was given",
  took: "took",
  bought: "bought",
  studied: "studied",
  "cast-spent": "paid to cast",
  "production-spent": "spent producing",
  "gave-away": "gave away",
  discarded: "given to nobody"
};

/**
 * What one cause's line is called.
 *
 * `SilverChangeCause` is generated, so the core may ship a cause this package has not been taught:
 * the fallback is what keeps it a readable line rather than nothing at all.
 */
function silverCauseLabel(cause: string): string {
  return SILVER_CAUSE_LABELS[cause] ?? cause.replaceAll("-", " ");
}

/**
 * The causes that moved this unit's silver, one group per cause, each in the position of its first
 * entry - which is the turn's own order, because `UnitSilver.changes` is in it.
 *
 * `took` and `took-unshown` merge into one group, keyed `took`: they are one event to a reader, and
 * which sources the report does not show is said in the clause instead.
 */
function silverCauseGroups(changes: readonly SilverChange[]): CauseGroup[] {
  const groups: CauseGroup[] = [];
  const byCause = new Map<string, CauseGroup>();
  for (const change of changes) {
    const key = change.cause === "took-unshown" ? "took" : change.cause;
    const existing = byCause.get(key);
    if (existing) {
      existing.amount += change.amount;
      existing.entries.push(change);
      continue;
    }
    const group: CauseGroup = { cause: key, amount: change.amount, entries: [change] };
    byCause.set(key, group);
    groups.push(group);
  }
  // A cause whose entries cancel moved nothing a reader can act on, and `signed(0)` would draw a
  // `-0` in the down ink.
  return groups.filter((group) => group.amount !== 0);
}

/** `+200`, `-90`. An ASCII hyphen-minus, which is what `String(-90)` gives. */
function signed(amount: number): string {
  return `${amount > 0 ? "+" : "-"}${Math.abs(amount)}`;
}

/**
 * What the market settled, on a `bought` or `sold` line: the one `ItemChange` of the same cause on
 * the same document line, when there is exactly one and it carries a price.
 *
 * `line` is the only thing joining the two ledgers, and both are `null` for a movement no order of
 * this unit's caused - so a `null` line matches nothing rather than matching every other `null`.
 */
function marketClause(group: CauseGroup, itemChanges: readonly ItemChange[]): string | undefined {
  const priced: string[] = [];
  for (const entry of group.entries) {
    if (entry.line === null) {
      continue;
    }
    const matches = itemChanges.filter(
      (change) => change.cause === group.cause && change.line === entry.line
    );
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only === undefined || only.unitPrice === null) {
      continue;
    }
    priced.push(`${count(Math.abs(only.delta), only.name)} at ${only.unitPrice} each`);
  }
  return priced.length > 0 ? andList(priced) : undefined;
}

/**
 * The dim clause beside one cause's amount: the other unit, what the market settled, why there was
 * no order, and whether the money arrives too late - joined with `", "`, no full stop.
 *
 * `undefined` when the cause has nothing to add, which is most of them. Every `other` is used
 * verbatim: the core builds it as `<name> (<id>)` or `unit <id>`, the form `ah-rgkk.2.3` settled.
 */
function silverCauseWhy(
  group: CauseGroup,
  silver: UnitSilver,
  itemChanges: readonly ItemChange[]
): string | undefined {
  const parts: string[] = [];
  const others = (entries: readonly SilverChange[]): string[] =>
    entries.map((entry) => entry.other).filter((other): other is string => other !== null);

  if (group.cause === "was-given") {
    const from = others(group.entries);
    if (from.length > 0) {
      parts.push(`from ${andList(from)}`);
    }
  } else if (group.cause === "took") {
    const shown = others(group.entries.filter((entry) => entry.cause === "took"));
    const unshown = others(group.entries.filter((entry) => entry.cause === "took-unshown"));
    if (shown.length > 0) {
      parts.push(`from ${andList(shown)}`);
    }
    if (unshown.length > 0) {
      parts.push(`from ${andList(unshown)}, which your report does not show`);
    }
  } else if (group.cause === "gave-away") {
    const to = others(group.entries);
    if (to.length > 0) {
      parts.push(`to ${andList(to)}`);
    }
  }

  if (group.cause === "bought" || group.cause === "sold") {
    const settled = marketClause(group, itemChanges);
    if (settled !== undefined) {
      parts.push(settled);
    }
  }

  const noOrder = group.entries.every((entry) => entry.line === null);
  if (group.cause === "taxed" && silver.taxesByFlag && noOrder) {
    parts.push("set to tax every turn");
  }
  if (group.cause === "worked" && silver.worksByDefault && noOrder) {
    parts.push("no month-long order");
  }

  // `rules/sequenceofevents`: ENTERTAIN and WORK are processed after STUDY, after BUY and after
  // BUILD, so a wage can never pay for any of them.
  if (group.cause === "worked" || group.cause === "entertained") {
    parts.push("arrives too late");
  }

  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * The headline: `silver`, the cell's own figure, and the pair from the report's `held` when the
 * figure is a number and has moved. Never a pair on a `?`.
 */
function silverTotalLine(silver: UnitSilver, shown: number | null): PopupLine {
  if (shown === null || shown === silver.held) {
    return { label: "silver", value: shown === null ? "?" : String(shown) };
  }
  return {
    label: "silver",
    value: String(shown),
    change: { direction: shown > silver.held ? "up" : "down", from: String(silver.held) }
  };
}

/**
 * The amber sentence(s) explaining the cell's marks (decision **W1**), or `null`.
 *
 * Red first, because it is the figure itself; the two are joined into one paragraph for a unit that
 * carries both.
 */
function silverMarkWarning(
  silver: UnitSilver,
  shown: number | null,
  warned: boolean
): string | null {
  const parts: string[] = [];
  if (silverIsRed(shown, silver)) {
    parts.push(
      shown !== null && shown < 0
        ? `A red figure in the cell: this unit ends the month ${-shown} short.`
        : "A red figure in the cell: this unit cannot pay for its own orders out of silver that reaches it in time."
    );
  }
  if (warned) {
    parts.push(
      "⚠ in the cell: a check warns about this unit's money. Select the unit to read it in the Problems panel."
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * What moved this unit's silver this month: the cell's own figure against the report's, then one
 * line per cause in the turn's own order (`ah-rgkk.4.3`, decision **V2**).
 *
 * This parts company with the whole-unit tooltip, which keeps `summariseSilver`'s four sums and
 * every note: one composer cannot serve both, the tooltip being a summary where the sums are the
 * right density and this being about one cell, which must name causes.
 */
function silverBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  if (facts.dissolving) {
    return {
      lines: [],
      notes: ["The game dissolves this unit before the month ends, so it has no month end."]
    };
  }
  const silver = facts.silver;
  if (silver === null) {
    return { lines: [], notes: ["Only your own units have a silver forecast."] };
  }

  const shown = silverShown(silver, facts.countUpkeep);
  const groups = silverCauseGroups(silver.changes);
  const lines: PopupLine[] = [silverTotalLine(silver, shown)];
  for (const group of groups) {
    const why = silverCauseWhy(group, silver, unit.itemChanges ?? []);
    lines.push({
      label: silverCauseLabel(group.cause),
      value: signed(group.amount),
      tone: group.amount > 0 ? "up" : "down",
      ...(why === undefined ? {} : { why })
    });
  }
  // Last, where `rules/sequenceofevents` puts maintenance - and only while the column counts it,
  // since with the setting off the cell's figure excludes it (`ah-1wcw.4`).
  if (facts.countUpkeep && silver.upkeep !== null && silver.upkeep !== 0) {
    lines.push({ label: "upkeep", value: signed(-silver.upkeep), tone: "down" });
  }

  const noteFacts: SilverFacts = {
    unit,
    silver,
    warned: facts.silverWarned,
    countUpkeep: facts.countUpkeep
  };
  const notes = SILVER_NOTES.filter((note) => !(SILVER_NOTES_RESTATED[note.id]?.(groups) ?? false))
    .filter((note) => note.when(noteFacts))
    .flatMap((note) => note.say(noteFacts).split("\n"));
  if (silver.doubt !== null) {
    // Above the doubt's own sentence, which says *why* it could not be added up.
    notes.unshift("This month cannot be added up, so what moved this unit's silver is not listed.");
  }

  return { lines, notes, warning: silverMarkWarning(silver, shown, facts.silverWarned) };
}

/**
 * The popup's body as sentences, for the `sr-only` span that replaces the cell's `title`
 * (decision **F1**).
 *
 * The title is deliberately left out: the table header already announces the column, and a reader
 * moving through the row would otherwise hear the unit's name and the column word again in every
 * cell. A change is spelled out in words rather than drawn as an arrow, so the direction survives
 * a reader that says nothing about a glyph.
 */
/**
 * The ink one line's label is drawn in (`ah-rgkk.5.1`).
 *
 * Exported because `UnitCellPopup` renders a portal, which `packages/shared` cannot render at all
 * (`packages/shared/src/testing/README.md`); this is the part of that component that has a rule in
 * it, so this is the part that lives here and is tested.
 */
export function popupLabelInk(line: PopupLine): string {
  return line.stress === "deciding" ? "text-brass" : line.stress === "aside" ? "text-ink-dim" : "";
}

export function popupAsText(popup: ColumnPopup): string {
  const lines = popup.lines.map((line) => {
    const parts = [`${line.label} ${line.value}`];
    if (line.steps) {
      // The label carries the first figure; every later one is a clause of its own, so the
      // direction is a word rather than a colour and the projection says that it has not happened.
      parts[0] = `${line.label} ${line.steps[0]!.value}`;
      for (const step of line.steps.slice(1)) {
        parts.push(
          step.mark === "projected"
            ? `${step.value} next turn${step.uncertain ? " if it happens" : ""}`
            : `${step.mark === "up" ? "up to" : step.mark === "down" ? "down to" : "still"} ${step.value}`
        );
      }
    } else if (line.change) {
      parts.push(`${line.change.direction} from ${line.change.from}`);
    }
    if (line.stress === "deciding") {
      parts.push("which is the one that decides");
    }
    if (line.why) {
      parts.push(line.why);
    }
    return `${parts.join(", ")}.`;
  });

  return [...lines, ...popup.notes, ...(popup.warning ? [popup.warning] : [])]
    .join(" ")
    .trim();
}
