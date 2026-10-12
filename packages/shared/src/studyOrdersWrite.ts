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

import { lexOrderLine } from "./orderLine";
import {
  ensureUnitBlock,
  findUnitBlocks,
  firstOwnOrder,
  longOrderOf,
  readUnitOrders,
  stripLongOrderLines,
  stripOwnOrders,
  writeUnitOrders
} from "./ordersDocument";
import type { OrderCommentSyntax } from "./rulesets";
import type { OrdersCast, OrdersEntry } from "./studyOrders";

/** One line of the confirmation: a change about to be made, or a mage this write leaves alone. */
export type WriteRow = {
  unitId: string;
  /** `Ereb (1234)`. */
  who: string;
  /** `STUDY FORC 4 replaces @work`, `TEACH 1234`, `nothing planned — left alone`. */
  detail: string;
  /** False for a mage this write leaves alone. */
  writes: boolean;
  /**
   * The cast row drawn under the study row (ah-9qdz.4): `CAST FARS`,
   * `COMBAT FIRE replaces COMBAT "Clear Skies"`, `CAST FARS — already there, kept`, or the
   * not-known sentence. `writes` is false for a kept or left-out cast, which the prompt draws dim.
   * Null when no cast is planned or the box is unticked.
   */
  cast: { detail: string; writes: boolean } | null;
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
  /** How many mages' planned casts stand in their orders after the write: written, or kept as already there. */
  casts: number;
  /** The targets warning, shown only when at least one cast line is written. */
  warning: string | null;
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

/** Shown in the confirmation whenever the write puts at least one cast line into the orders. */
export const CAST_TARGET_WARNING =
  "Casts are written without a target. Add one by hand where the spell needs it.";

/** A spell as a player may spell it in an order: case-insensitive, `_` read as a space. */
function spellKey(spell: string): string {
  return spell.replace(/_/gu, " ").trim().toLowerCase();
}

/** Whether an existing CAST or COMBAT line casts this same spell, by its tag or its name. */
function castsSameSpell(line: string, cast: OrdersCast, syntax: OrderCommentSyntax): boolean {
  const argument = lexOrderLine(line, syntax).tokens[1];
  if (argument === undefined) {
    return false;
  }
  const key = spellKey(argument);
  return key === spellKey(cast.spell) || key === spellKey(cast.name);
}

/** What the cast step does to a block's own orders, and the row it says it with. */
function withCast(
  orders: string,
  cast: Extract<OrdersCast, { kind: "write" }>,
  syntax: OrderCommentSyntax
): { orders: string; detail: string; writes: boolean } {
  const existing = firstOwnOrder(orders, [cast.verb], syntax);
  if (existing !== null && castsSameSpell(existing, cast, syntax)) {
    return { orders, detail: `${cast.order} — already there, kept`, writes: false };
  }
  const kept = stripOwnOrders(orders, [cast.verb], syntax);
  const line = annotatedLine(cast.order, cast.annotation);
  return {
    orders: kept.trim() === "" ? line : `${kept}\n${line}`,
    detail: existing === null ? cast.order : `${cast.order} replaces ${shortened(existing)}`,
    writes: true
  };
}

/** A previous order as a row names it: trimmed, and cut with an ellipsis when it would wrap. */
function shortened(order: string): string {
  const trimmed = order.trim();
  return trimmed.length > PREVIOUS_ORDER_LIMIT
    ? `${trimmed.slice(0, PREVIOUS_ORDER_LIMIT - 1)}…`
    : trimmed;
}

/** The line written into the block: the order, and the tab's own annotation in its column. */
function annotatedLine(order: string, annotation: string | null): string {
  if (annotation === null) {
    return order;
  }
  const gap =
    order.length >= WRITE_COMMENT_COLUMN ? " " : " ".repeat(WRITE_COMMENT_COLUMN - order.length);
  return `${order}${gap}; ${annotation}`;
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
  /** How the game played reads an unquoted semicolon. */
  syntax: OrderCommentSyntax;
}): StudyWritePlan {
  const syntax = input.syntax;
  const rows: WriteRow[] = [];
  let next = input.document;
  let changed = 0;
  let replaced = 0;

  let casts = 0;
  let castsWritten = 0;

  for (const entry of input.entries) {
    const who = `${entry.name} (${entry.unitId})`;
    const cast = entry.cast;
    const castWrites = cast !== null && cast.kind === "write" ? cast : null;
    const skipDetail = `${entry.skipReason ?? "nothing planned"} — left alone`;
    const leftOut =
      cast === null ? null : { detail: cast.kind === "write" ? `${cast.order} — left alone` : cast.text, writes: false };

    if (entry.order === null && castWrites === null) {
      rows.push({ unitId: entry.unitId, who, detail: skipDetail, writes: false, cast: leftOut });
      continue;
    }

    const hadBlock = findUnitBlocks(next, syntax).some((block) => block.unitId === entry.unitId);
    const banner = hadBlock ? null : input.banner(entry.regionId);
    if (!hadBlock && banner === null) {
      // `writeUnitOrders` silently does nothing for a unit with no block, and inventing a banner
      // would put the block under a region heading naming the wrong hex.
      rows.push({
        unitId: entry.unitId,
        who,
        detail: "no block in your orders, and his hex is not in this turn's report — left alone",
        writes: false,
        cast: leftOut
      });
      continue;
    }

    const base = hadBlock ? next : ensureUnitBlock(next, entry.unitId, banner ?? "", syntax);
    const existing = readUnitOrders(base, entry.unitId, undefined, syntax) ?? "";
    let orders = existing;
    let detail = skipDetail;
    let studyWrites = false;

    if (entry.order !== null) {
      const previous = longOrderOf(existing, syntax);
      const kept = stripLongOrderLines(existing, syntax);
      const line = annotatedLine(entry.order, entry.annotation);
      // `kept.trim()`, not `kept === ""`: a block that held nothing but a blank line and a long
      // order leaves a blank line behind, and `writeUnitOrders` drops only *trailing* blanks - so
      // the written line would land under one.
      orders = kept.trim() === "" ? line : `${kept}\n${line}`;
      studyWrites = true;
      if (previous !== null && !OWN_KIND.test(previous)) {
        replaced += 1;
      }
      detail = !hadBlock
        ? `${entry.order} — a new block, in ${input.label(entry.regionId)}`
        : previous !== null
          ? `${entry.order} replaces ${shortened(previous)}`
          : entry.order;
    }

    let castRow: WriteRow["cast"] = leftOut;
    if (castWrites !== null) {
      const step = withCast(orders, castWrites, syntax);
      orders = step.orders;
      castRow = { detail: step.detail, writes: step.writes };
      casts += 1;
      if (step.writes) {
        castsWritten += 1;
      }
    }

    // A cast kept as already there, with no study to write, changes nothing: the block stays as it
    // was, and so does the document, even when it had no block yet.
    if (studyWrites || castRow?.writes === true) {
      next = writeUnitOrders(base, entry.unitId, orders, undefined, syntax);
      changed += 1;
    }
    rows.push({ unitId: entry.unitId, who, detail, writes: studyWrites, cast: castRow });
  }

  const lead =
    changed === 0
      ? "None of these mages can be written into your orders."
      : `${changed} unit${changed === 1 ? " changes" : "s change"}. Nothing else in the document is touched, and you can undo it afterwards.`;

  const castWords = casts === 0 ? "" : ` and ${casts} cast${casts === 1 ? "" : "s"}`;
  const mages = `Wrote study orders${castWords} for ${changed} mage${changed === 1 ? "" : "s"}`;
  const resultText =
    replaced === 0
      ? `${mages}.`
      : `${mages}; ${replaced} other order${replaced === 1 ? "" : "s"} replaced.`;

  const warning = castsWritten === 0 ? null : CAST_TARGET_WARNING;

  return { rows, next, changed, replaced, casts, warning, lead, resultText };
}
