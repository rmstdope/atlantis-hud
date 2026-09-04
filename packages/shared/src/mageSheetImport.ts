/**
 * Recognising an ally's mage sheet on the way in, and saying what becomes of it.
 *
 * The twin of `mapExportImport.ts`, and for the same reason: a mage sheet is written in the game's
 * own syntax, so it parses as a report and would otherwise take the report path - which would put
 * an ally's mages on the map as phantom hexes and their turn on screen as the player's own. The
 * marker on its first line is the whole test.
 *
 * Imports nothing from `reportLoad.ts`: that module routes through this one.
 */

import type { AlliedMageKey, AlliedMageRecord, ReportUnit } from "@atlantis/core-client";
import { factionLabelOf } from "./factionLabel";
import { firstLineOf, type ReportImportSource } from "./mapExportImport";

/**
 * The first line every mage sheet carries.
 *
 * Must equal `MAGE_SHEET_MARKER` in `crates/core/src/report/export.rs` byte for byte. Nothing
 * compiles a check between the two languages; the smoke suite's export-then-import round trip is
 * what catches a divergence, because a marker the shell does not recognise sends the file down the
 * report path and merges an ally's mages into the map as phantom hexes.
 */
export const MAGE_SHEET_MARKER = "; Mage sheet from Atlantis HUD";

/** Whether this file is one of our own mage sheets, judged on its first non-blank line. */
export function isMageSheet(text: string): boolean {
  return firstLineOf(text) === MAGE_SHEET_MARKER;
}

/** The narrowed arm of {@link ReportImportSource} that only a mage sheet can be. */
export type MageSheetImportSource = Extract<ReportImportSource, { kind: "mageSheet" }>;

export const MAGE_SHEET_NEEDS_A_GAME =
  "a mage sheet is filed under a game — load a turn report first";
export const MAGE_SHEET_IS_YOUR_OWN =
  "that is your own faction's mage sheet — your own mages are already in your report";
export const MAGE_SHEET_NAMES_NO_FACTION = "the mage sheet does not say which faction wrote it";
export const MAGE_SHEET_NAMES_NO_TURN = "the mage sheet does not say which turn it was written on";

/** `you already hold Borg (21)'s mages from turn 23, which is newer` */
export function mageSheetIsOlder(factionLabel: string, heldTurn: number): string {
  return `you already hold ${factionLabel}'s mages from turn ${heldTurn}, which is newer`;
}

/** What deciding a sheet's fate needs from outside the file itself. */
export type MageSheetContext = {
  /** The faction whose workspace this is; null when no turn is on screen. */
  viewerFactionId: string | null;
  /** False when there is no open game to file a sheet under. */
  hasGame: boolean;
  /** The newest sheet turn already held, per faction id; absent for a faction none is held from. */
  heldTurnByFaction: ReadonlyMap<string, number>;
};

/** A mage sheet that will be taken in, and everything taking it in needs. */
export type UsableMageSheet = {
  source: MageSheetImportSource;
  factionId: string;
  /** `Borg (21)`, from `factionLabelOf` — never "an unnamed faction": a nameless sheet is refused. */
  factionLabel: string;
  turnNumber: number;
  /** The newest sheet already held from this faction, or null when none is. */
  heldTurn: number | null;
  /** The mages the sheet carries, in the order it carried them. Empty is legal. */
  mages: ReportUnit[];
};

export type MageSheetUsability =
  | { ok: true; value: UsableMageSheet }
  | { ok: false; reason: string };

/**
 * Whether this sheet may be taken in, in the order a player reads a refusal in.
 *
 * `hasGame`/`viewerFactionId` first: without a game and a faction on screen there is nothing to
 * compare a sheet against and nowhere to put it, so the other four questions cannot be asked.
 */
export function judgeMageSheetUsable(
  source: MageSheetImportSource,
  context: MageSheetContext
): MageSheetUsability {
  const { report } = source;
  if (!context.hasGame || context.viewerFactionId === null) {
    return { ok: false, reason: MAGE_SHEET_NEEDS_A_GAME };
  }
  const factionId = report.header.factionId;
  if (factionId === null) {
    return { ok: false, reason: MAGE_SHEET_NAMES_NO_FACTION };
  }
  const turnNumber = report.header.turnNumber;
  if (turnNumber === null) {
    return { ok: false, reason: MAGE_SHEET_NAMES_NO_TURN };
  }
  if (factionId === context.viewerFactionId) {
    return { ok: false, reason: MAGE_SHEET_IS_YOUR_OWN };
  }
  // `factionLabelOf` cannot answer null here: the header names a faction id.
  const factionLabel = factionLabelOf(report) as string;
  const held = context.heldTurnByFaction.get(factionId);
  // Strictly greater: a sheet for a turn already held is taken in and replaces it, which is what a
  // corrected re-send needs and is what makes taking one in twice a no-op.
  if (held !== undefined && held > turnNumber) {
    return { ok: false, reason: mageSheetIsOlder(factionLabel, held) };
  }
  return {
    ok: true,
    value: {
      source,
      factionId,
      factionLabel,
      turnNumber,
      heldTurn: held ?? null,
      mages: report.regions.flatMap((region) => region.units)
    }
  };
}

/** The rows one sheet contributes, ready for `saveAlliedMages`. */
export function mageSheetRows(usable: UsableMageSheet, receivedAt: string): AlliedMageRecord[] {
  // The sender's identity is the sheet's *header*: `write_mage_region` writes every unit with `own`
  // cleared, so a unit line's faction is not the sender's.
  return usable.mages.map((unit) => ({
    factionId: usable.factionId,
    factionName: usable.source.report.header.factionName,
    unit,
    sheetTurn: usable.turnNumber,
    receivedAt
  }));
}

/** The newest sheet turn held from each faction, keyed by faction id. */
export function heldTurnsByFaction(held: readonly AlliedMageRecord[]): Map<string, number> {
  const turns = new Map<string, number>();
  for (const row of held) {
    const seen = turns.get(row.factionId);
    if (seen === undefined || row.sheetTurn > seen) {
      turns.set(row.factionId, row.sheetTurn);
    }
  }
  return turns;
}

/** Which stored mages of this faction the new sheet leaves out, in stored order. */
export function missingFromSheet(
  held: readonly AlliedMageRecord[],
  factionId: string,
  sheet: readonly ReportUnit[]
): AlliedMageRecord[] {
  const carried = new Set(sheet.map((unit) => unit.unitId));
  return held.filter((row) => row.factionId === factionId && !carried.has(row.unit.unitId));
}

/** One stored mage's identity, for `saveAlliedMages`' `removed`. */
export function keyOf(row: AlliedMageRecord): AlliedMageKey {
  return { factionId: row.factionId, unitId: row.unit.unitId };
}

/** The mages a sheet left out, held while the player decides what becomes of them. */
export type PendingMissingMages = {
  factionLabel: string;
  /** The turn of the sheet that has just been taken in. */
  sheetTurn: number;
  /** How many mages that sheet carried and stored. */
  taken: number;
  /** The stored rows it leaves out, in stored order. Never empty — no question is raised for none. */
  missing: AlliedMageRecord[];
};
