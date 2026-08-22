import type { ReportUnit } from "@atlantis/core-client";

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

export type UnitSummary = {
  /** The unit's name and id, as the report writes it. */
  title: string;
  skills: TooltipEntry[];
  items: TooltipEntry[];
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
export function summariseUnit(unit: ReportUnit): UnitSummary {
  return {
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
