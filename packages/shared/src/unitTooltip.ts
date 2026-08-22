import type { ReportUnit, UnitSilver } from "@atlantis/core-client";

/**
 * What resting the pointer on a unit says, and where that is put.
 *
 * The table has room for a truncated line of skills and a truncated line of items, so the summary
 * exists to say the rest of it without making the user select the unit and read the panel. Both
 * halves are pure: the wording so it cannot drift from the panel's, and the placement because
 * arithmetic against the edges of a window is exactly the part that is worth testing and the part
 * a browser will not tell you about until it is wrong.
 */

/**
 * How long the pointer must rest on a row before its summary appears.
 *
 * Long enough that crossing the table on the way to the map leaves no trail of tooltips behind,
 * short enough that it reads as an answer to stopping rather than as a delay.
 */
export const HOVER_DELAY_MS = 300;

/** How far from the pointer the tooltip sits, so the cursor does not cover its first line. */
const GAP = 12;

/** One line of the summary: what it is on the left, how much or how good on the right. */
export type TooltipEntry = { label: string; value: string };

/** The silver section of the panel: the working, and one line explaining it where it needs one. */
export type SilverSummary = { rows: TooltipEntry[]; note: string | null };

export type UnitSummary = {
  /** The unit's name and id, as the report writes it. */
  title: string;
  skills: TooltipEntry[];
  items: TooltipEntry[];
  /** What this unit's month does to its silver, or null for a unit that has no forecast. */
  silver: SilverSummary | null;
};

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Placement = { left: number; top: number };

/**
 * Everything the summary says about a unit.
 *
 * Skills carry their study points as well as their level (ah-ded4), because the table's skills
 * cell truncates into this tooltip by design and the level alone cannot tell two units apart.
 * They keep the report's order, which is the order they were learned in and the order the table
 * shows. Items are ordered by holding, largest first, matching the unit panel: a tooltip that
 * ranked them differently from the panel would be read as a different list.
 */
export function summariseUnit(
  unit: ReportUnit,
  silver: UnitSilver | null = null,
  /** Whether this unit carries the `not-enough-silver` finding, which the note explains. */
  warned = false,
  /** Whether the Silver column is counting upkeep, which adds the fifth row (`ah-1wcw.4`). */
  countUpkeep = false
): UnitSummary {
  return {
    silver: silver === null ? null : summariseSilver(silver, warned, countUpkeep),
    title: `${unit.name} (${unit.unitId})`,
    skills: unit.skills.map((skill) => ({
      label: `${skill.name} ${skill.tag}`,
      value: `${skill.level} (${skill.points})`
    })),
    items: [...unit.items]
      .sort((left, right) => right.amount - left.amount)
      .map((item) => ({
        label: `${item.name} ${item.tag}`,
        value: item.amount.toLocaleString()
      }))
  };
}

/**
 * Where to put the tooltip, in viewport coordinates.
 *
 * It hangs below and to the right of the pointer, and flips to the other side of it rather than
 * cross an edge — flipping keeps the pointer outside the tooltip, which sliding along the edge
 * would not: a tooltip under the cursor takes the hover it was asked for and flickers.
 *
 * The clamp afterwards is for what neither side can hold. A tooltip taller or wider than the
 * window has nowhere to flip to, and pinning it to the top-left at least shows its beginning.
 */
export function placeTooltip(pointer: Point, size: Size, viewport: Size): Placement {
  const along = (start: number, extent: number, limit: number) => {
    const after = start + GAP;
    const placed = after + extent <= limit ? after : start - GAP - extent;
    return Math.max(0, Math.min(placed, limit - extent));
  };

  return {
    left: along(pointer.x, size.width, viewport.width),
    top: along(pointer.y, size.height, viewport.height)
  };
}

/** A figure the forecast is sure of, or `?` for a term that could not be priced. */
function figure(amount: number | null): string {
  return amount === null ? "?" : String(amount);
}

/**
 * The Silver section's four rows and its one explaining line (`ah-1wcw.1`) - five while the Silver
 * column is counting upkeep (`ah-1wcw.4`).
 *
 * At most one note, and the first that applies: a panel that stacks three explanations under one
 * small number explains nothing. The order is the order of how much the reader needs it.
 */
function summariseSilver(
  silver: UnitSilver,
  warned: boolean,
  countUpkeep: boolean
): SilverSummary {
  const end = countUpkeep ? shownEnd(silver) : silver.atMonthEnd;
  const rows: TooltipEntry[] = [
    { label: "Held now", value: String(silver.held) },
    { label: "In", value: figure(silver.income) },
    { label: "Out", value: figure(silver.expense) },
    ...(countUpkeep ? [{ label: "Upkeep", value: figure(silver.upkeep) }] : []),
    { label: "At month end", value: figure(end) }
  ];

  return { rows, note: silverNote(silver, warned) };
}

/** The month-end figure with upkeep taken off, or `null` where either term is unpriceable. */
function shownEnd(silver: UnitSilver): number | null {
  if (silver.atMonthEnd === null || silver.upkeep === null) {
    return null;
  }
  return silver.atMonthEnd - silver.upkeep;
}

/** `"a"`, `"a and b"`, `"a, b and c"` - the way the Problems panel already lists a market. */
function namesInAList(names: string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function silverNote(silver: UnitSilver, warned: boolean): string | null {
  const end = silver.atMonthEnd;

  // Counted alone this unit runs out, yet no finding names it - which in this hex means the units
  // that share have it covered, exactly as the engine's own borrowing rule would.
  if (end !== null && end < 0 && !warned) {
    return "Shared silver in this hex covers the shortfall.";
  }
  if (silver.doubt === "unknown-tax-base") {
    return "The report never said what this region's tax base is.";
  }
  if (silver.doubt === "unpriced-skill") {
    return "The ruleset does not say what studying this skill costs.";
  }
  if (silver.doubt === "unknown-goods") {
    // The goods as the order wrote them: nothing resolved them to a catalogue name, so there is no
    // other way to say which ones are meant.
    return `The report does not say what ${silver.doubtSubject ?? "these goods"} are, so what this sale earns cannot be said.`;
  }
  if (silver.doubt === "unpriced-spell") {
    return "The ruleset does not say what this spell earns.";
  }
  if (silver.doubt === "estimated-men") {
    return "This unit's headcount is an estimate, so its month cannot be priced.";
  }
  if (silver.doubt === "market-does-not-sell") {
    // The market's own name for the goods where anything knew one, and the order's own text
    // otherwise - the same posture `unknown-goods` above takes.
    return `This region is not selling ${silver.doubtSubject ?? "these goods"}, so what the purchase costs cannot be said.`;
  }
  if (silver.doubt === "unpriced-withdrawal") {
    return "The ruleset does not say what withdrawing costs.";
  }
  if (silver.doubt === "gives-a-whole-class") {
    return "This unit is giving away a whole class of goods, which cannot be counted.";
  }
  // The column counts what WORK earns; `not-enough-silver` deliberately does not, because wages
  // are paid in the turn's last phase. Both are true about different moments.
  if (warned && end !== null && end >= 0) {
    return "Wages arrive at the end of the month, too late to pay for this month's orders.";
  }
  // A gift is the one part of the figure that comes from somebody else's orders, so it is the one
  // part a reader cannot find by looking at this unit's own block.
  if (silver.received > 0 && silver.givers.length > 0) {
    return `Includes ${silver.received} given by ${namesInAList(silver.givers)} in this hex.`;
  }
  // Silver a unit is ordered to destroy is spending like any other, and the one kind a reader
  // would otherwise look for a recipient of and find none.
  if (silver.givenToNobody > 0) {
    return `Includes ${silver.givenToNobody} given away to nobody.`;
  }
  if (silver.income === 0 && silver.expense === 0) {
    return "Nothing this unit is ordered to do moves silver.";
  }
  return null;
}
