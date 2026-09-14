import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { withoutSilver } from "./silverTag";
import { SILVER_NOTES, type SilverFacts } from "./silverVocabulary";
import {
  atMost,
  monthLostToAnUnreadLine,
  NOT_KNOWN,
  shareBoundedByAnUnreadUnit,
  silverWasNeverRead
} from "./unitRead";

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
  /**
   * One sentence about a row `rules/form` dissolves, and where its goods go (`ah-ty3s.3`).
   * Absent on every other unit.
   */
  note?: string;
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
  countUpkeep = false,
  /**
   * Set on a row `rules/form` dissolves, with the unit its goods revert to as `<name> (<id>)` -
   * or `into: null` where the hex shows no own unit for them to revert to (`ah-ty3s.3`).
   *
   * Structural rather than the row type on purpose: `unitPreview` already imports from this
   * module, so taking a `PreviewedUnit` here would make a cycle.
   */
  dissolving: { into: string | null } | null = null
): UnitSummary {
  return {
    silver: silver === null ? null : summariseSilver(unit, silver, warned, countUpkeep),
    note: dissolving
      ? dissolving.into === null
        ? "Gains no recruits, so the game dissolves it. No unit of yours is shown in this hex for its goods to revert to."
        : `Gains no recruits, so the game dissolves it and its goods revert to ${dissolving.into}.`
      : undefined,
    title: `${unit.name} (${unit.unitId})`,
    skills: unit.skills.map((skill) => ({
      label: `${skill.name} ${skill.tag}`,
      value: `${skill.level} (${skill.points})`
    })),
    items: withoutSilver(unit.items)
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

/** A box something hangs off, in viewport coordinates. */
export type AnchorBox = { left: number; top: number; width: number; height: number };

/**
 * How close a menu sits to the cell it belongs to. Smaller than `GAP`, which exists to keep a
 * tooltip out from under the pointer: a menu has no pointer to clear and reads as the cell's own
 * only while it touches it.
 */
const ANCHOR_GAP = 4;

/**
 * Where to put a menu that hangs off a box rather than off a pointer, in viewport coordinates.
 *
 * It sits under the box and lined up with its left edge, and flips to sit *above* it rather than
 * cross the bottom edge — a menu half off the screen cannot be chosen from. Sideways it slides
 * instead of flipping: the box is what the menu belongs to, and one thrown to the far side of a
 * cell near the right edge would point at the wrong column.
 *
 * The clamp afterwards is for what neither side can hold, and pins the beginning of the menu to
 * the top-left the way `placeTooltip` does.
 */
export function placeUnderAnchor(anchor: AnchorBox, size: Size, viewport: Size): Placement {
  const below = anchor.top + anchor.height + ANCHOR_GAP;
  const top = below + size.height <= viewport.height ? below : anchor.top - ANCHOR_GAP - size.height;

  return {
    left: Math.max(0, Math.min(anchor.left, viewport.width - size.width)),
    top: Math.max(0, Math.min(top, viewport.height - size.height))
  };
}

/**
 * A figure the forecast is sure of, or the mark an unknown term reads.
 *
 * `?` everywhere but a broken line: it means "I know what this unit holds, I could not price the
 * month", which is a different and lesser thing than a figure the report never reached at all
 * (`ah-l09a.4`).
 */
function figure(amount: number | null, unknown = "?"): string {
  return amount === null ? unknown : String(amount);
}

/**
 * The Silver section's five rows and its one explaining line (`ah-1wcw.1`) - six while the Silver
 * column is counting upkeep (`ah-1wcw.4`). `In` splits in two because silver that arrives in the
 * turn's last phase cannot pay for anything this month's orders spend (`ah-uwa3`).
 *
 * **Every** note that applies, one per line, in `SILVER_NOTES` order: a note that only ever fired
 * when nothing else did was a note two agreed plans could not use, and both failed verification
 * (`ah-x36v`). The order is the order of how much the reader needs it.
 */
function summariseSilver(
  unit: ReportUnit,
  silver: UnitSilver,
  warned: boolean,
  countUpkeep: boolean
): SilverSummary {
  const end = countUpkeep ? shownEnd(silver) : silver.atMonthEnd;
  // A term this unit's own broken line lost reads the agreed words; every other doubt keeps the
  // `?` it has always shown, which means "I could not price it", a different sentence.
  const unknown = monthLostToAnUnreadLine(silver) ? NOT_KNOWN : "?";
  // Only where the figure is a number: `? at most` and `not known at most` are both nonsense, and
  // `end` can be null while `income` is not, when the setting counts an upkeep nobody could price.
  const atMostIf = (text: string, amount: number | null, bounded: boolean): string =>
    amount !== null && bounded ? atMost(text) : text;
  const rows: TooltipEntry[] = [
    {
      label: "Held now",
      value: silverWasNeverRead(silver) ? NOT_KNOWN : String(silver.held)
    },
    {
      label: "In, in time",
      value: atMostIf(figure(inTime(silver), unknown), inTime(silver), silver.incomeInTimeAtMost)
    },
    {
      label: "In, too late",
      value: atMostIf(figure(silver.lateIncome, unknown), silver.lateIncome, silver.lateIncomeAtMost)
    },
    { label: "Out", value: figure(silver.expense, unknown) },
    ...(countUpkeep ? [{ label: "Upkeep", value: figure(silver.upkeep, unknown) }] : []),
    {
      label: "At month end",
      value: atMostIf(figure(end, unknown), end, shareBoundedByAnUnreadUnit(silver))
    }
  ];

  return { rows, note: silverNote(unit, silver, warned, countUpkeep) };
}

/**
 * The part of income that arrives in time to pay for what the orders spend - everything but wages,
 * entertaining and Phantasmal Entertainment (`ah-uwa3`). `null` where income itself is unknown.
 */
function inTime(silver: UnitSilver): number | null {
  if (silver.income === null || silver.lateIncome === null) {
    return null;
  }
  return silver.income - silver.lateIncome;
}

/** The month-end figure with upkeep taken off, or `null` where either term is unpriceable. */
function shownEnd(silver: UnitSilver): number | null {
  if (silver.atMonthEnd === null || silver.upkeep === null) {
    return null;
  }
  return silver.atMonthEnd - silver.upkeep;
}


/**
 * Every explanation that applies, one per line, in `SILVER_NOTES` order.
 *
 * **Not the first that applies.** Two plans were agreed against that contract in one day and both
 * failed verification: a planner reasons about which sentence is "more specific" when the real
 * question was that only one was ever shown (`ah-x36v`). A note can no longer be shadowed by
 * another, by construction - which is also why the guard in `unitTooltip.test.ts` changed shape.
 */
function silverNote(
  unit: ReportUnit,
  silver: UnitSilver,
  warned: boolean,
  countUpkeep: boolean
): string | null {
  const facts: SilverFacts = { unit, silver, warned, countUpkeep };
  const said = SILVER_NOTES.filter((note) => note.when(facts)).map((note) => note.say(facts));
  return said.length > 0 ? said.join("\n") : null;
}
