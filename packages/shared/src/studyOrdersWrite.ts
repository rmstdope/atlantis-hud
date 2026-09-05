/**
 * What "Put into my orders" would do to the orders document, and every word it says about it
 * (`ah-lyg6.4.2`).
 *
 * Pure, and computed on every render of the Orders tab: it is what the confirmation draws, what
 * the button's presence is decided from, and what confirming actually commits. `packages/shared`
 * has no jsdom by decision (ah-nass), so every string this bead words lives here rather than in a
 * component, and the components draw what this returned.
 *
 * A unit spends its month on exactly one of the eleven month-long orders
 * (`rules/sequenceofevents`), so a written `STUDY` or `TEACH` replaces whichever one the block
 * already carried rather than standing beside it - which is `stripLongOrderLines`' whole job.
 */

import {
  ensureUnitBlock,
  findUnitBlocks,
  longOrderOf,
  readUnitOrders,
  stripLongOrderLines,
  writeUnitOrders
} from "./ordersDocument";
import type { OrdersEntry } from "./studyOrders";

/** One line of the confirmation: a change about to be made, or a mage this write leaves alone. */
export type WriteRow = {
  unitId: string;
  /** `Ereb (1234)`. */
  who: string;
  /** `STUDY FORC 4 replaces @work`, `TEACH 1234`, `nothing planned — left alone`. */
  detail: string;
  /** False for a mage this write leaves alone. */
  writes: boolean;
};

/** What "Put into my orders" would do to the document, and every word it says about it. */
export type StudyWritePlan = {
  /** One per entry, in the section's own order. */
  rows: WriteRow[];
  /** The document this write would produce. Identical to the one given when `changed` is 0. */
  next: string;
  /** How many units' blocks change. */
  changed: number;
  /** Of those, how many carried a month-long order that was neither STUDY nor TEACH. */
  replaced: number;
  /** The prompt's lead paragraph. */
  lead: string;
  /** The line shown after the write. */
  resultText: string;
};

/** The column the `;` of a written annotation starts in, when the order is short enough. */
export const WRITE_COMMENT_COLUMN = 18;

/** How long a previous order may read in a row before it is cut. A row is one line about one mage. */
const PREVIOUS_ORDER_LIMIT = 48;

/** A month-long order that this button is simply rewriting rather than displacing. */
const OWN_KIND = /^\s*@?\s*(STUDY|TEACH)\b/iu;

/** A previous order as a row names it: trimmed, and cut with an ellipsis when it would wrap. */
function shortened(order: string): string {
  const trimmed = order.trim();
  return trimmed.length > PREVIOUS_ORDER_LIMIT
    ? `${trimmed.slice(0, PREVIOUS_ORDER_LIMIT - 1)}…`
    : trimmed;
}

/** The line written into the block: the order, and the tab's own annotation in its column. */
function lineFor(entry: OrdersEntry & { order: string }): string {
  if (entry.annotation === null) {
    return entry.order;
  }
  const gap =
    entry.order.length >= WRITE_COMMENT_COLUMN
      ? " "
      : " ".repeat(WRITE_COMMENT_COLUMN - entry.order.length);
  return `${entry.order}${gap}; ${entry.annotation}`;
}

/**
 * What writing this section into the document would do.
 *
 * Each mage is decided against the document the mages before him produced, so two mages sharing a
 * region cannot both be told they are the first block under its banner.
 */
export function studyWritePlan(input: {
  /** `AppShell`'s `ordersDocument`, as it stands. */
  document: string;
  /** The own faction's `OrdersSection.entries`. */
  entries: readonly OrdersEntry[];
  /** The `;***` banner a new block for a mage in this region goes under, or null when the map cannot say. */
  banner: (regionId: string) => string | null;
  /** How a region id reads to a player: `AppShell`'s `hexLabel`. */
  label: (regionId: string) => string;
}): StudyWritePlan {
  const rows: WriteRow[] = [];
  let next = input.document;
  let changed = 0;
  let replaced = 0;

  for (const entry of input.entries) {
    const who = `${entry.name} (${entry.unitId})`;
    if (entry.order === null) {
      rows.push({
        unitId: entry.unitId,
        who,
        detail: `${entry.skipReason ?? "nothing planned"} — left alone`,
        writes: false
      });
      continue;
    }

    const hadBlock = findUnitBlocks(next).some((block) => block.unitId === entry.unitId);
    const banner = hadBlock ? null : input.banner(entry.regionId);
    if (!hadBlock && banner === null) {
      // `writeUnitOrders` silently does nothing for a unit with no block, and inventing a banner
      // would put the block under a region heading naming the wrong hex.
      rows.push({
        unitId: entry.unitId,
        who,
        detail: "no block in your orders, and his hex is not in this turn's report — left alone",
        writes: false
      });
      continue;
    }

    const base = hadBlock ? next : ensureUnitBlock(next, entry.unitId, banner ?? "");
    const existing = readUnitOrders(base, entry.unitId) ?? "";
    const previous = longOrderOf(existing);
    const kept = stripLongOrderLines(existing);
    const line = lineFor({ ...entry, order: entry.order });

    next = writeUnitOrders(base, entry.unitId, kept === "" ? line : `${kept}\n${line}`);
    changed += 1;
    if (previous !== null && !OWN_KIND.test(previous)) {
      replaced += 1;
    }

    const detail = !hadBlock
      ? `${entry.order} — a new block, in ${input.label(entry.regionId)}`
      : previous !== null
        ? `${entry.order} replaces ${shortened(previous)}`
        : entry.order;
    rows.push({ unitId: entry.unitId, who, detail, writes: true });
  }

  const lead =
    changed === 0
      ? "None of these mages can be written into your orders."
      : `${changed} unit${changed === 1 ? " changes" : "s change"}. Nothing else in the document is touched, and you can undo it afterwards.`;

  const mages = `Wrote study orders for ${changed} mage${changed === 1 ? "" : "s"}`;
  const resultText =
    replaced === 0
      ? `${mages}.`
      : `${mages}; ${replaced} other order${replaced === 1 ? "" : "s"} replaced.`;

  return { rows, next, changed, replaced, lead, resultText };
}
