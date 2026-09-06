import type {
  ItemChange,
  ItemChangeParty,
  SkillInfo,
  SkillMerge,
  StudyForecast,
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
import { summariseUnit } from "./unitTooltip";
import { COLUMN_LABELS, type ExtraColumn, type UnitColumn } from "./unitTable";

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
  /** One clause saying why it moved, e.g. `4 bought at 60 silver each`. Absent where unknown. */
  why?: string;
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
  const changeName = new Map<string, string>();
  for (const change of changes) {
    if (!changeName.has(change.tag)) {
      changeName.set(change.tag, change.name);
    }
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
  const monthOrder = new Map<string, number>();
  for (const [index, change] of changes.entries()) {
    if (!monthOrder.has(change.tag)) {
      monthOrder.set(change.tag, index);
    }
  }

  return tags.map((tag) => {
    const item = held.get(tag);
    const name = item?.name ?? changeName.get(tag);
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
  unit: PreviewedUnit
): string | undefined {
  const clauses = changes.map((change) => itemCauseClause(change, unit));
  return clauses.length === 0 ? undefined : `${label}: ${clauses.join(", ")}.`;
}

/** The other unit of a movement, as `ah-rgkk.2.3` settled it: `Scouts (1502)`, or `unit 1502`. */
function party(other: ItemChangeParty): string {
  return other.name === null ? `unit ${other.unitId}` : `${other.name} (${other.unitId})`;
}

/** One movement, as a fragment. The clauses are joined with `, ` and closed with one full stop. */
function itemCauseClause(change: ItemChange, unit: PreviewedUnit): string {
  const n = Math.abs(change.delta);
  const each = change.unitPrice === null ? "" : ` at ${change.unitPrice} silver each`;
  switch (change.cause) {
    case "bought":
      return `bought ${n}${each}`;
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
  const created = (unit.created ?? []).find((entry) => entry.tag === change.tag);
  const figure = created && created.fewest !== created.most
    ? `${created.fewest}-${created.most}`
    : `${n}`;
  return created?.summoned ? `summoned ${figure}` : `created ${figure} by casting`;
}

/** How many lines a popup shows before it stops and counts the rest (decision **G-d**). */
export const MAX_LINES = 12;

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
  if (field && !change) {
    notes.push(`Nothing this month changes ${LISTS.has(column) ? "these" : "this"}.`);
  }
  // A column with nothing left to show - moved out of its structure, its last flag dropped, its
  // movement no longer disclosed - has no line for the report's own figure to hang off, and
  // dropping it would lose what the cell's `title` used to say. It becomes a sentence instead.
  //
  // On the emptiness of the body, and deliberately not on "no line carries the change": a line
  // that carries none may be saying there was none - `markOrQuote` returns nothing at all for an
  // original equal to the figure beside it, and the wider test said `Was: 12.` of a figure that
  // did not move. `quoted` is the other half of the same care: an empty body is not the same as a
  // silent one, and a column that has already said it says it once.
  if (change && body.lines.length === 0 && !body.quoted) {
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
   * Set by a column that has already said what the report had there, wherever it says it.
   *
   * `itemsBody` is the one: `itemsTooltip` opens with `was: …` and is reached whether or not the
   * unit still holds anything, so a unit that gave everything away has an empty body *and* the
   * quote already in its notes.
   */
  quoted?: boolean;
};

/** What one column has to say, before the shared capping and change sentence are applied. */
function bodyFor(column: PopupColumn, unit: PreviewedUnit, facts: PopupFacts): Body {
  switch (column) {
    case "men":
      return menBody(unit);
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

function menBody(unit: PreviewedUnit): Body {
  const why = whyEstimated(unit);
  return {
    lines: [
      {
        label: "men",
        value: describeMenBriefly(unit),
        ...markOrQuote(changeFor(unit, CHANGE_FIELD.men!), unit.men)
      }
    ],
    notes: why ? [sentence(why)] : []
  };
}

function movementBody(unit: PreviewedUnit): Body {
  if (unit.movement == null) {
    return { lines: [], notes: ["Movement not disclosed."] };
  }
  const change = changeFor(unit, CHANGE_FIELD.movement!);
  return {
    lines: [
      {
        label: "move",
        value: presentUnitMovement(unit.movement).label,
        ...(change ? { why: originalTooltip(change) } : {})
      }
    ],
    notes: []
  };
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
    .filter((entry) => entry.moved)
    .map((entry) =>
      itemCauseSentence(
        itemLabel(entry, unit),
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

/** The item's display name alone, which is what leads its cause sentence. */
function itemLabel(entry: ItemLine, unit: PreviewedUnit): string {
  return (
    unit.items.find((item) => item.tag === entry.tag)?.name ??
    (unit.itemChanges ?? []).find((change) => change.tag === entry.tag)?.name ??
    entry.tag
  );
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
 * The same working the whole-unit summary shows, drawn from the same call, so the two can never
 * disagree about what the month does to this unit's silver (`ah-1wcw.1`).
 */
function silverBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  if (facts.dissolving) {
    return {
      lines: [],
      notes: ["The game dissolves this unit before the month ends, so it has no month end."]
    };
  }
  const summary = summariseUnit(
    unit,
    facts.silver,
    facts.silverWarned,
    facts.countUpkeep,
    null
  ).silver;

  if (summary === null) {
    return { lines: [], notes: ["Only your own units have a silver forecast."] };
  }
  return { lines: summary.rows, notes: summary.note ? summary.note.split("\n") : [] };
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
    if (line.why) {
      parts.push(line.why);
    }
    return `${parts.join(", ")}.`;
  });

  return [...lines, ...popup.notes, ...(popup.warning ? [popup.warning] : [])]
    .join(" ")
    .trim();
}
