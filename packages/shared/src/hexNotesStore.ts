/**
 * Manual hex notes, held in memory for the open game.
 *
 * Storage (`hexNotes.ts`) is the truth; this store is a cache the region panel (ah-o1t.2) and the
 * map layer (ah-o1t.3) read, kept in step optimistically by the mutations below and repaired on
 * failure. Deliberately **not persisted** — `useWorkspaceStore` is, but a persisted notes cache
 * would show one game's notes in another game's workspace after a reload.
 */

import { create } from "zustand";
import type { CoreClient, HexNoteRecord, OpenedGame } from "@atlantis/core-client";
import { deleteHexNote, editHexNote, loadHexNotes, newHexNote, saveHexNote, sortNotes } from "./hexNotes";

export type HexNotesStatus = "idle" | "loading" | "ready" | "error";

export type HexNotesState = {
  /** The game the list belongs to; a list for another game is stale and is not shown. */
  gameId: string | null;
  status: HexNotesStatus;
  /** Every note of the game, newest first (`sortNotes`' order). */
  notes: HexNoteRecord[];
  /** Replaces the list with the game's notes. Failure → status "error", notes []. */
  load: (client: CoreClient, game: OpenedGame) => Promise<void>;
  /** Adds optimistically, then saves; on failure removes it again and rethrows. */
  add: (
    client: CoreClient,
    game: OpenedGame,
    args: { regionId: string; text: string; turn: number; now: string }
  ) => Promise<HexNoteRecord>;
  /** Edits optimistically (text and/or onMap), then saves; on failure restores the old note and rethrows. */
  edit: (
    client: CoreClient,
    game: OpenedGame,
    noteId: string,
    change: { text?: string; onMap?: boolean },
    now: string
  ) => Promise<void>;
  /** Removes optimistically, then deletes; on failure puts it back and rethrows. */
  remove: (client: CoreClient, game: OpenedGame, noteId: string) => Promise<void>;
  clear: () => void;
  /**
   * A pending "open the editor for this hex" request, made by the palette action. `RegionNotes`
   * watches this and, when it names its own region, enters `adding` mode and clears it - a tiny
   * module-level event rather than a ref threaded across `AppShell`.
   */
  requestAdd: { regionId: string } | null;
  requestAddFor: (regionId: string) => void;
  clearRequestAdd: () => void;
};

export const useHexNotesStore = create<HexNotesState>()((set, get) => ({
  gameId: null,
  status: "idle",
  notes: [],

  load: async (client, game) => {
    const gameId = game.manifest.metadata.gameId;
    set({ gameId, status: "loading" });
    try {
      const notes = await loadHexNotes(client, game);
      // A game switch mid-load leaves a late result for a game that is no longer open; showing it
      // would put the wrong game's notes on screen.
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "ready", notes });
    } catch {
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "error", notes: [] });
    }
  },

  add: async (client, game, args) => {
    const note = newHexNote({ gameId: game.manifest.metadata.gameId, ...args });
    set((state) => ({ notes: sortNotes([note, ...state.notes]) }));
    try {
      const saved = await saveHexNote(client, game, note);
      set((state) => ({ notes: sortNotes(state.notes.map((n) => (n.id === note.id ? saved : n))) }));
      return saved;
    } catch (error) {
      set((state) => ({ notes: state.notes.filter((n) => n.id !== note.id) }));
      throw error;
    }
  },

  edit: async (client, game, noteId, change, now) => {
    const before = get().notes.find((n) => n.id === noteId);
    if (!before) {
      return;
    }
    const after = editHexNote(before, change, now);
    set((state) => ({ notes: sortNotes(state.notes.map((n) => (n.id === noteId ? after : n))) }));
    try {
      await saveHexNote(client, game, after);
    } catch (error) {
      set((state) => ({ notes: sortNotes(state.notes.map((n) => (n.id === noteId ? before : n))) }));
      throw error;
    }
  },

  remove: async (client, game, noteId) => {
    const before = get().notes.find((n) => n.id === noteId);
    set((state) => ({ notes: state.notes.filter((n) => n.id !== noteId) }));
    try {
      await deleteHexNote(client, game, noteId);
    } catch (error) {
      if (before) {
        set((state) => ({ notes: sortNotes([...state.notes, before]) }));
      }
      throw error;
    }
  },

  // `requestAdd` too: a closed game leaves no live editor to open, and a stale request could
  // otherwise pop open unasked in a later game whose regionId happens to collide (region ids are
  // not unique across games).
  clear: () => set({ gameId: null, status: "idle", notes: [], requestAdd: null }),

  requestAdd: null,
  requestAddFor: (regionId) => set({ requestAdd: { regionId } }),
  clearRequestAdd: () => set({ requestAdd: null })
}));

const DEFAULT_TEST_STATE = { gameId: null, status: "idle" as const, notes: [], requestAdd: null };

/** Test helper, like `resetWorkspaceStore` (workspaceStore.ts). */
export function resetHexNotesStore(): void {
  setHexNotesStateForTest(DEFAULT_TEST_STATE);
}

/**
 * Sets store state for a test, visible to both `getState()` and a `renderToStaticMarkup` render.
 *
 * `useSyncExternalStore` always reads through `getServerSnapshot` (zustand's `getInitialState()`,
 * frozen at module load) when rendered via `react-dom/server` - `renderToStaticMarkup` never takes
 * the `getSnapshot` branch a browser does, so a plain `useHexNotesStore.setState(...)` before a
 * static render is invisible to it. Mutating the very object `getInitialState()` returns is what
 * makes the two agree; it has no effect on the real app, which always renders client-side.
 */
export function setHexNotesStateForTest(
  patch: Partial<Pick<HexNotesState, "gameId" | "status" | "notes" | "requestAdd">>
): void {
  useHexNotesStore.setState(patch);
  Object.assign(useHexNotesStore.getInitialState(), patch);
}

/**
 * Selector helper: the notes of one hex, in store order. Pure, for the panel and the map.
 *
 * `hexNotes.ts` already has `notesByRegion`, grouping the whole list into a `Map` at once - better
 * suited to a map layer walking every hex than to a single panel re-filtering on every render. Two
 * entry points doing adjacent things; worth folding into one if the map layer (ah-o1t.3) finds it
 * wants both shapes.
 */
export function notesForRegion(notes: readonly HexNoteRecord[], regionId: string): HexNoteRecord[] {
  return notes.filter((note) => note.regionId === regionId);
}
