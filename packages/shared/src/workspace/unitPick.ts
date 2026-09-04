/**
 * Which rows the units table has picked, and what each gesture does to that (`ah-1mpx.4`).
 *
 * The whole selection model lives here rather than in `UnitTableDock`, for the reason
 * `testing/README.md` states: `packages/shared` has no jsdom, so a rule reachable only through a
 * render is a rule with no unit test. Every gesture below is arithmetic over a list of row
 * keys; the dock's job is to say which gesture happened.
 *
 * **The pick is not the cursor.** `selectedUnitId` stays exactly what it was - one row, driving
 * the Unit panel and the map. This sits beside it.
 */

import type { ReportUnit } from "@atlantis/core-client";
import { unitRowKey } from "../unitTable";

/**
 * Which rows are picked, and where a Shift range extends from.
 *
 * Keyed on the row's own `unitRowKey(regionId, unitId)` - a unit number is unique inside a hex
 * only, so a list spanning hexes can draw two rows both called `new-1` (`ah-9o0c.2`) - and
 * deliberately NOT on the dock's
 * `rowTarget`, which is `silver?.formed?.formedBy ?? unit.unitId` (`UnitTableDock.tsx`) and so can
 * name a different unit than the row it is drawn on. The cursor keeps using `rowTarget`; the pick
 * never does, or a picked row would add a different unit to the Army.
 */
export type UnitPick = {
  readonly ids: ReadonlySet<string>;
  /** The row a Shift range extends from, or null when there is none to extend from. */
  readonly anchor: string | null;
};

export const NO_PICK: UnitPick = { ids: new Set(), anchor: null };

export type PickGesture =
  /** Click, Escape, and a press that resolved without a drag: this row alone. */
  | { kind: "plain"; rowKey: string }
  /** Ctrl/Cmd+click: add or remove one row. */
  | { kind: "toggle"; rowKey: string }
  /** Shift+click and Shift+Arrow: replace the pick with the run from the anchor to here. */
  | { kind: "extend"; rowKey: string }
  /** Ctrl/Cmd+A: every row the filter is currently showing. */
  | { kind: "all" };

const alone = (rowKey: string): UnitPick => ({ ids: new Set([rowKey]), anchor: rowKey });

/**
 * The pick after one gesture, over `rows` - the row keys the table is drawing right now, in
 * the order it is drawing them.
 *
 * The order matters: `extend` takes the slice between the anchor and the target, which is a run on
 * screen and not a run of row keys.
 *
 * `extend` with no anchor, or with an anchor `rows` no longer holds, falls back to `plain`.
 * `all` keeps the anchor when `rows` still holds it and takes `rows[0]` otherwise.
 * `toggle` always sets the anchor to the row toggled, including the toggle that empties the pick -
 * so a Shift+click straight afterwards extends from where the pointer last was.
 */
export function afterGesture(
  pick: UnitPick,
  gesture: PickGesture,
  rows: readonly string[]
): UnitPick {
  if (gesture.kind === "all") {
    const anchor = pick.anchor !== null && rows.includes(pick.anchor) ? pick.anchor : (rows[0] ?? null);
    return { ids: new Set(rows), anchor };
  }
  if (gesture.kind === "plain") {
    return alone(gesture.rowKey);
  }
  if (gesture.kind === "toggle") {
    const ids = new Set(pick.ids);
    if (!ids.delete(gesture.rowKey)) {
      ids.add(gesture.rowKey);
    }
    return { ids, anchor: gesture.rowKey };
  }

  const from = pick.anchor === null ? -1 : rows.indexOf(pick.anchor);
  const to = rows.indexOf(gesture.rowKey);
  if (from === -1 || to === -1) {
    return alone(gesture.rowKey);
  }
  const run = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { ids: new Set(run), anchor: pick.anchor };
}

/**
 * The pick with everything `rows` no longer holds dropped, and the anchor cleared when it went too.
 *
 * This is the rule that the filter narrows the pick (`ah-1mpx.4` E1): a row that leaves the view
 * leaves the pick, so the count and the wash always agree and nothing off screen can be acted on.
 *
 * Returns the **identical object** when nothing was dropped, so the effect that calls it does not
 * churn state on every render - the same contract `withoutMember` keeps (`armies.ts`).
 */
export function narrowedTo(pick: UnitPick, rows: readonly string[]): UnitPick {
  const drawn = new Set(rows);
  const kept = [...pick.ids].filter((rowKey) => drawn.has(rowKey));
  const anchorHeld = pick.anchor !== null && drawn.has(pick.anchor);
  if (kept.length === pick.ids.size && (pick.anchor === null || anchorHeld)) {
    return pick;
  }
  return { ids: new Set(kept), anchor: anchorHeld ? pick.anchor : null };
}

/** The picked rows, in the order the table is drawing them. */
export function pickedIn(pick: UnitPick, rows: readonly ReportUnit[]): ReportUnit[] {
  return rows.filter((unit) => pick.ids.has(unitRowKey(unit.regionId, unit.unitId)));
}

/** What one press means, before anything is known about whether it becomes a drag. */
export type PressOutcome = {
  /** Apply this now, on pointerdown. Null means the press has not decided yet. */
  readonly now: UnitPick | null;
  /** Apply this if the press ends without a drag. Null when `now` already settled it. */
  readonly onRelease: UnitPick | null;
  /** Whether this press may begin a drag once the pointer has moved far enough. */
  readonly draggable: boolean;
};

/**
 * What a press on a row does to the pick.
 *
 * The one case that is not obvious, and is the whole reason this returns two picks rather than
 * one: **a plain press on a row that is already in a pick of two or more changes nothing yet.**
 * Collapsing it on pointerdown would make it impossible to drag a pick you had just built - you
 * would grab it and it would fall to one row under your finger. So the collapse is deferred to a
 * release that never became a drag, which is how every file manager behaves.
 *
 * Every other press decides on pointerdown, so the wash moves the instant the button goes down.
 *
 * `mod` is the platform's own command modifier and only that one - `metaKey` on a mac, `ctrlKey`
 * elsewhere - resolved by the caller exactly as `matchShortcut` does it (`shortcuts.ts`). It is
 * passed in rather than computed here so this module stays free of platform detection.
 */
export function onPress(
  pick: UnitPick,
  rowKey: string,
  modifiers: { readonly shift: boolean; readonly mod: boolean },
  rows: readonly string[]
): PressOutcome {
  if (modifiers.shift) {
    return {
      now: afterGesture(pick, { kind: "extend", rowKey }, rows),
      onRelease: null,
      draggable: false
    };
  }
  if (modifiers.mod) {
    return {
      now: afterGesture(pick, { kind: "toggle", rowKey }, rows),
      onRelease: null,
      draggable: false
    };
  }
  if (pick.ids.has(rowKey) && pick.ids.size >= 2) {
    return { now: null, onRelease: alone(rowKey), draggable: true };
  }
  return { now: alone(rowKey), onRelease: null, draggable: true };
}
