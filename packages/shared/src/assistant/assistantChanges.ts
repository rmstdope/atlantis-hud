/**
 * What the assistant has changed in this turn's orders, and what the panel says about it (ah-bcdri).
 *
 * Plain functions, so every rule is testable without a window: `packages/shared` has no jsdom by
 * decision (ah-nass). Only the writes are recorded. Whether a unit was edited since, and what is
 * wrong with its orders, is worked out from the document each time, so an entry always follows the
 * orders as they really stand, whoever or whatever moved them.
 *
 * An empty string is a unit with no orders, whether its block is empty or it has no block at all.
 */

import type { OrderDiagnostic, ParsedReport, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { SURFACE } from "../hexMapModel";
import type { OrderProcessing } from "../orderProcessing";

/** One unit the assistant has changed. */
export type AssistantChange = {
  unitId: string;
  /** What the first write replaced, or the player's edit if the assistant has since written over one. */
  before: string;
  /** What the assistant last wrote. */
  after: string;
};

export type AssistantChangesState = {
  /** Whether the panel is showing. Closing only hides it; the list stays. */
  open: boolean;
  changes: AssistantChange[];
};

export const NO_ASSISTANT_CHANGES: AssistantChangesState = { open: true, changes: [] };

/**
 * One write folded in. `replaced` is what the unit's orders were at that moment.
 *
 * If `replaced` is not what the assistant last wrote, the player edited the unit in between, and
 * Before becomes that edit: Revert then returns it rather than losing it for good.
 */
export function recordAssistantWrite(
  state: AssistantChangesState,
  write: { unitId: string; replaced: string; wrote: string }
): AssistantChangesState {
  const { unitId, replaced, wrote } = write;
  const existing = state.changes.find((change) => change.unitId === unitId);
  const before = existing === undefined || replaced !== existing.after ? replaced : existing.before;
  const others = state.changes.filter((change) => change.unitId !== unitId);
  const changes = before === wrote ? others : [...others, { unitId, before, after: wrote }];
  return { open: state.changes.length === 0 ? true : state.open, changes };
}

/**
 * One unit's change accepted (ah-hwkak.2): it leaves the list and its orders stay as they stand.
 * The same state if the unit is not listed. A later write lists it afresh, Before being what was kept.
 */
export function keepAssistantChange(state: AssistantChangesState, unitId: string): AssistantChangesState {
  const changes = state.changes.filter((change) => change.unitId !== unitId);
  return changes.length === state.changes.length ? state : { ...state, changes };
}

/** Takes off the list every unit whose orders are back to Before; the same state if there are none. */
export function settleAssistantChanges(
  state: AssistantChangesState,
  current: ReadonlyMap<string, string>
): AssistantChangesState {
  const changes = state.changes.filter((change) => current.get(change.unitId) !== change.before);
  return changes.length === state.changes.length ? state : { ...state, changes };
}

/**
 * What each of `unitIds` has in `document`, a unit with no block reading as no orders.
 *
 * One walk of the document for all of them, because this runs on every keystroke while anything is
 * listed.
 */
export function currentOrdersOf(
  document: string,
  unitIds: readonly string[],
  orders: OrderProcessing
): Map<string, string> {
  const lines = document.split("\n");
  const blocks = new Map<string, string>();
  for (const block of orders.findUnitBlocks(document)) {
    if (!blocks.has(block.unitId)) {
      blocks.set(block.unitId, lines.slice(block.firstLine, block.lastLine + 1).join("\n"));
    }
  }
  return new Map(unitIds.map((unitId) => [unitId, blocks.get(unitId) ?? ""]));
}

/** Puts Before back for those of `unitIds` still holding what the assistant wrote, and no others. */
export function revertAssistantChanges(
  document: string,
  state: AssistantChangesState,
  unitIds: readonly string[],
  orders: OrderProcessing
): { document: string; state: AssistantChangesState; reverted: string[] } {
  const current = currentOrdersOf(document, unitIds, orders);
  const taken = state.changes.filter(
    (change) => unitIds.includes(change.unitId) && current.get(change.unitId) === change.after
  );
  return {
    document: taken.reduce(
      (text, change) => orders.writeUnitOrders(text, change.unitId, change.before, undefined),
      document
    ),
    state: { ...state, changes: state.changes.filter((change) => !taken.includes(change)) },
    reverted: taken.map((change) => change.unitId)
  };
}

/** One level row of the comparison. `null` is a side with nothing on this row. */
export type AlignedOrderLine = { before: string | null; after: string | null; changed: boolean };

function linesOf(orders: string): string[] {
  return orders === "" ? [] : orders.split("\n");
}

/** Lines common to both sides stay level; a removed line and an added one share a row. */
export function alignOrderLines(before: string, after: string): AlignedOrderLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  const best = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  const longest = (i: number, j: number): number => best[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      (best[i] as number[])[j] =
        a[i] === b[j] ? longest(i + 1, j + 1) + 1 : Math.max(longest(i + 1, j), longest(i, j + 1));
    }
  }
  const rows: AlignedOrderLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ before: a[i] as string, after: b[j] as string, changed: false });
      i += 1;
      j += 1;
      continue;
    }
    const gone = i < a.length && (j === b.length || longest(i + 1, j) >= longest(i, j + 1));
    const added = j < b.length && (i === a.length || longest(i, j + 1) >= longest(i + 1, j));
    rows.push({ before: gone ? (a[i] as string) : null, after: added ? (b[j] as string) : null, changed: true });
    if (gone) {
      i += 1;
    }
    if (added) {
      j += 1;
    }
  }
  return rows;
}

/** One entry as the panel draws it. */
export type AssistantChangeView = {
  unitId: string;
  /** Where selecting the unit goes; empty when the report no longer shows it. */
  regionId: string;
  name: string;
  where: string;
  /** True when the unit's orders are no longer what the assistant wrote. */
  edited: boolean;
  /** Each problem's own sentence. Empty for a unit edited by hand, which explains that instead. */
  problems: string[];
  rows: AlignedOrderLine[];
  beforeEmpty: boolean;
  afterEmpty: boolean;
};

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function whereOf(region: ReportRegion): string {
  const { x, y, z } = region.coordinate;
  return `${capitalised(region.terrain)} (${x},${y}${z === SURFACE ? "" : `,${z}`})`;
}

/** The surface first, then each level below it in turn, and the nexus (level 0) after those. */
function levelRank(z: number): number {
  if (z === SURFACE) {
    return 0;
  }
  return z === 0 ? Number.POSITIVE_INFINITY : z;
}

type Located = { unit: ReportUnit; region: ReportRegion };

function locatedUnits(parsed: ParsedReport | null): Map<string, Located> {
  const located = new Map<string, Located>();
  for (const region of parsed?.regions ?? []) {
    for (const unit of region.units) {
      located.set(unit.unitId, { unit, region });
    }
  }
  return located;
}

function compareLocated(a: Located | undefined, b: Located | undefined): number {
  if (a === undefined || b === undefined) {
    return Number(a === undefined) - Number(b === undefined);
  }
  const one = a.region.coordinate;
  const two = b.region.coordinate;
  const levels = levelRank(one.z) - levelRank(two.z);
  // Two infinities subtract to NaN, and only the nexus has that rank.
  return (Number.isNaN(levels) ? 0 : levels) || one.y - two.y || one.x - two.x;
}

/**
 * Each listed unit's problems, as the check last answered.
 *
 * Apart from `assistantChangeViews` because it walks the checked text once per unit, and the
 * answer moves only when the check does: the views are redrawn on every keystroke.
 */
export function assistantChangeProblems(input: {
  state: AssistantChangesState;
  parsed: ParsedReport | null;
  validated: { text: string; diagnostics: OrderDiagnostic[] };
  orders: OrderProcessing;
}): Map<string, string[]> {
  const { state, parsed, validated, orders } = input;
  const located = locatedUnits(parsed);
  return new Map(
    state.changes.map((change) => {
      const place = located.get(change.unitId);
      const regionUnitIds = place === undefined ? undefined : new Set(place.region.units.map((unit) => unit.unitId));
      const found = orders.diagnosticsForUnit(validated.text, change.unitId, validated.diagnostics, regionUnitIds);
      return [change.unitId, found.map((diagnostic) => diagnostic.message)];
    })
  );
}

/**
 * The list as it should be drawn, sorted by hex and then unit number.
 *
 * A unit's place comes from where it stands, which a write cannot change, so it slots in when it
 * first appears and stays there. A unit already back to Before is left out even before
 * `settleAssistantChanges` has taken it off the list.
 */
export function assistantChangeViews(input: {
  state: AssistantChangesState;
  document: string;
  parsed: ParsedReport | null;
  problems: ReadonlyMap<string, readonly string[]>;
  orders: OrderProcessing;
}): AssistantChangeView[] {
  const { state, document, parsed, problems, orders } = input;
  const current = currentOrdersOf(document, state.changes.map((change) => change.unitId), orders);
  const located = locatedUnits(parsed);
  return state.changes
    .filter((change) => current.get(change.unitId) !== change.before)
    .sort(
      (a, b) =>
        compareLocated(located.get(a.unitId), located.get(b.unitId)) || Number(a.unitId) - Number(b.unitId)
    )
    .map((change) => {
      const place = located.get(change.unitId);
      const edited = current.get(change.unitId) !== change.after;
      return {
        unitId: change.unitId,
        regionId: place?.region.regionId ?? "",
        name: place?.unit.name ?? "",
        where: place === undefined ? "" : whereOf(place.region),
        edited,
        problems: edited ? [] : [...(problems.get(change.unitId) ?? [])],
        rows: alignOrderLines(change.before, change.after),
        beforeEmpty: change.before === "",
        afterEmpty: change.after === ""
      };
    });
}

export function countLabel(count: number): string {
  return `${count} unit${count === 1 ? "" : "s"}`;
}

export function problemMark(count: number): string {
  return `⚠ ${count} problem${count === 1 ? "" : "s"}`;
}

/** The header chip's words. The number after the mark is units with problems, not hand-edited ones. */
export function assistantChipLabel(views: ReadonlyArray<Pick<AssistantChangeView, "edited" | "problems">>): string {
  const withProblems = views.filter((view) => !view.edited && view.problems.length > 0).length;
  return `Assistant: ${views.length}${withProblems > 0 ? ` · ⚠ ${withProblems}` : ""}`;
}

/** The Revert all strip's question and its button, for this many units going back. */
export function revertAllPrompt(count: number): { question: string; confirm: string } {
  const units = countLabel(count);
  const pronoun = count === 1 ? "it" : "them";
  return {
    question: `Revert ${units}? The assistant's orders for ${pronoun} will be gone.`,
    confirm: `Revert ${units}`
  };
}
