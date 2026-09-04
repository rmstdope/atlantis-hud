/**
 * What the header says about the mage sheets allies have shared, and what the popover behind it
 * lists.
 *
 * Every rule and every string of `ah-lyg6.1.3` is here, as plain functions of data: a
 * `packages/shared` component test cannot see inside a `PopoverFrame` (it takes focus on mount, so
 * it uses a hook), so the panel's own test asserts markup only and this is where the wording and
 * the arithmetic are pinned.
 */

import type { AlliedMageKey, AlliedMageRecord } from "@atlantis/core-client";

/** One faction's held sheet, as the popover shows it. */
export type MageSheetRow = {
  factionId: string;
  /** "Creeping Death (17)", or "Faction 17" when the sheet's header carried no name. */
  factionLabel: string;
  /** How many of that faction's mages are held, kept-stale ones included. */
  mageCount: number;
  /** The newest sheet turn held from that faction. */
  sheetTurn: number;
  /** How many turns behind the viewed turn that sheet is; 0 when level or ahead. */
  turnsOld: number;
  /** "3 mages" / "1 mage". */
  countText: string;
  /** "turn 21 · 2 turns old" / "turn 23" / "turn 23 · ahead of this turn". */
  turnText: string;
};

/** What the chip says, and whether it says it in the danger colour. */
export type MageSheetChip = { text: string; stale: boolean };

/**
 * The popover's rows: one per faction, oldest sheet first, then by faction number.
 *
 * Deliberately not `sortAlliedMages`' text collation, which puts "10" before "9": that order
 * exists to make storage stable, this one is read by a person looking at faction numbers.
 */
export function mageSheetRows(
  held: readonly AlliedMageRecord[],
  viewedTurn: number | null
): MageSheetRow[] {
  const byFaction = new Map<string, AlliedMageRecord[]>();
  for (const record of held) {
    const rows = byFaction.get(record.factionId);
    if (rows) {
      rows.push(record);
    } else {
      byFaction.set(record.factionId, [record]);
    }
  }

  const rows: MageSheetRow[] = [];
  for (const [factionId, records] of byFaction) {
    const factionName = records.find((record) => record.factionName !== null)?.factionName ?? null;
    const sheetTurn = Math.max(...records.map((record) => record.sheetTurn));
    const turnsOld = viewedTurn === null ? 0 : Math.max(0, viewedTurn - sheetTurn);
    const mageCount = records.length;
    rows.push({
      factionId,
      factionLabel: factionName === null ? `Faction ${factionId}` : `${factionName} (${factionId})`,
      mageCount,
      sheetTurn,
      turnsOld,
      countText: `${mageCount} mage${mageCount === 1 ? "" : "s"}`,
      turnText: turnText(sheetTurn, turnsOld, viewedTurn)
    });
  }

  return rows.sort((a, b) => a.sheetTurn - b.sheetTurn || compareFactionId(a.factionId, b.factionId));
}

function turnText(sheetTurn: number, turnsOld: number, viewedTurn: number | null): string {
  if (turnsOld > 0) {
    return `turn ${sheetTurn} · ${turnsOld} turn${turnsOld === 1 ? "" : "s"} old`;
  }
  if (viewedTurn !== null && sheetTurn > viewedTurn) {
    return `turn ${sheetTurn} · ahead of this turn`;
  }
  return `turn ${sheetTurn}`;
}

/** Numerically, so "9" comes before "10"; by text when either id is not a finite number. */
function compareFactionId(left: string, right: string): number {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return a - b;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The chip, or null when nothing is held - no sheets, no chip. */
export function mageSheetChip(rows: readonly MageSheetRow[]): MageSheetChip | null {
  if (rows.length === 0) {
    return null;
  }
  const old = rows.filter((row) => row.turnsOld > 0).length;
  const text = `${rows.length} mage sheet${rows.length === 1 ? "" : "s"}`;
  return { text: old > 0 ? `${text} · ${old} old` : text, stale: old > 0 };
}

/** Every stored key belonging to one faction: what Forget deletes. */
export function keysForFaction(
  held: readonly AlliedMageRecord[],
  factionId: string
): AlliedMageKey[] {
  return held
    .filter((record) => record.factionId === factionId)
    .map((record) => ({ factionId: record.factionId, unitId: record.unit.unitId }));
}

/** The question the popover's foot asks before a sheet is thrown away. */
export function forgetConfirmText(row: MageSheetRow): string {
  return `Forget ${row.factionLabel}'s ${row.countText}? A newer sheet from them brings them back.`;
}

/** The notice line once it is gone. */
export function forgottenStatusText(row: MageSheetRow): string {
  return `${row.countText} from ${row.factionLabel} forgotten`;
}

/** The failure line when the write did not happen. */
export function forgetFailedText(row: MageSheetRow): string {
  return `could not forget ${row.factionLabel}'s mage sheet`;
}
