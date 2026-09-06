import type { UnitSilver } from "@atlantis/core-client";
import { battleSkillGroups, battleSkillSource } from "./battleSkillPresentation";
import type { DerivedSkill } from "./battleSkills";
import { flagWords } from "./unitFlags";
import { describeMenBriefly, whyEstimated } from "./unitComposition";
import { presentUnitMovement } from "./unitMovement";
import {
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

/** How a figure moved this month. `amount` is always positive; the direction carries the sign. */
export type PopupChange = { direction: "up" | "down"; amount: number };

/** One line of a column popup. */
export type PopupLine = {
  /** What it is, on the left. Lower case, as the report writes item and skill names. */
  label: string;
  /** What it stands at, on the right, already formatted. */
  value: string;
  /** Absent where nothing changed. */
  change?: PopupChange;
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
 * A change the popup can mark with an arrow, or one it can only quote.
 *
 * Only a figure both sides of which are whole numbers can be subtracted; `~8` is the report's own
 * mark for a count it guessed at, and an arrow drawn from it would claim an arithmetic nobody did.
 */
function markOrQuote(change: ReturnType<typeof changeFor>, now: number): Partial<PopupLine> {
  if (!change) {
    return {};
  }
  const before = Number(change.original);
  if (!Number.isInteger(before)) {
    return { why: originalTooltip(change) };
  }
  if (before === now) {
    return {};
  }
  return {
    change: { direction: now > before ? "up" : "down", amount: Math.abs(now - before) }
  };
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
    return {
      lines: [],
      notes: [
        unit.own ? "No skills." : "A report never shows another faction's skills."
      ]
    };
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

  return {
    lines: summariseUnit(unit).items,
    // `itemsTooltip` opens with the report's own list, so this column never needs the shared
    // sentence - not even when the unit ends the month holding nothing.
    quoted: told !== undefined,
    notes: [...(told ? told.split("\n") : []), ...(unit.items.length === 0 ? ["No items."] : [])],
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
    if (line.change) {
      parts.push(`${line.change.direction === "up" ? "up" : "down"} ${line.change.amount}`);
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
