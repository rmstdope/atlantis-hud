/**
 * Manual hex notes: player-written text pinned to a hex.
 *
 * Storage-only, first of three passes for ah-o1t (issue #261). This is the pure module the region
 * panel (ah-o1t.2) and the map layer (ah-o1t.3) will call; it holds the rules for a note's shape.
 * Ordering is `@atlantis/core-client`'s (`sortHexNotes`, re-exported below as `sortNotes`), and
 * reaches storage only through `CoreClient`, the way `orderDraft.ts` does.
 */

import { sortHexNotes, type CoreClient, type HexNoteRecord, type OpenedGame } from "@atlantis/core-client";

export type { HexNoteRecord };

/** The interview's limit: multi-line, 500 characters, counted by code point. */
export const HEX_NOTE_MAX_CHARS = 500;

/** Trimmed text, or `null` when it is empty or over the limit — the caller decides what to say. */
export function normalizeNoteText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if ([...trimmed].length > HEX_NOTE_MAX_CHARS) {
    return null;
  }
  return trimmed;
}

/** A new note: fresh id, `onMap: true` (the interview's default), turn and timestamps from the args. */
export function newHexNote(args: {
  gameId: string;
  regionId: string;
  text: string;
  turn: number;
  now: string;
}): HexNoteRecord {
  const text = normalizeNoteText(args.text);
  if (text === null) {
    throw new Error("hex note text is empty or exceeds the character limit");
  }

  return {
    id: crypto.randomUUID(),
    gameId: args.gameId,
    regionId: args.regionId,
    text,
    onMap: true,
    turn: args.turn,
    createdAt: args.now,
    updatedAt: args.now
  };
}

/** Same note with new text and/or on-map flag; `id`, `createdAt` and `turn` are untouched. */
export function editHexNote(
  note: HexNoteRecord,
  change: { text?: string; onMap?: boolean },
  now: string
): HexNoteRecord {
  const text = change.text === undefined ? note.text : normalizeNoteText(change.text);
  if (text === null) {
    throw new Error("hex note text is empty or exceeds the character limit");
  }

  return {
    ...note,
    text,
    onMap: change.onMap ?? note.onMap,
    updatedAt: now
  };
}

/** Newest first: the client's order (`sortHexNotes`), which every list and local mutation shares. */
export const sortNotes = sortHexNotes;

/** `regionId` to its sorted notes, the shape a map layer or region panel wants to look up by hex. */
export function notesByRegion(notes: readonly HexNoteRecord[]): Map<string, HexNoteRecord[]> {
  const byRegion = new Map<string, HexNoteRecord[]>();
  for (const note of sortNotes(notes)) {
    const forRegion = byRegion.get(note.regionId);
    if (forRegion) {
      forRegion.push(note);
    } else {
      byRegion.set(note.regionId, [note]);
    }
  }
  return byRegion;
}

/** A game's hex notes, sorted newest first. */
export async function loadHexNotes(client: CoreClient, game: OpenedGame): Promise<HexNoteRecord[]> {
  const notes = await client.listHexNotes(game.databasePath, game.manifest.metadata.gameId);
  return sortNotes(notes);
}

/** Inserts or updates one hex note. */
export async function saveHexNote(
  client: CoreClient,
  game: OpenedGame,
  note: HexNoteRecord
): Promise<HexNoteRecord> {
  return client.saveHexNote(game.databasePath, note);
}

/** Deletes one hex note. */
export async function deleteHexNote(
  client: CoreClient,
  game: OpenedGame,
  noteId: string
): Promise<void> {
  await client.deleteHexNote(game.databasePath, game.manifest.metadata.gameId, noteId);
}
