/**
 * Getting the orders document onto disk, and back off it.
 *
 * The whole path has existed since issue #4 - a table, an UPSERT, an IndexedDB store, both adapters
 * and `CoreClient.saveOrderDraft` - and nothing ever called it. The orders panel showed a "saved"
 * time made out of `new Date()`, which was true about the clock and false about everything else.
 *
 * A plain module rather than logic inside a component, in the same spirit as `gameMemory`: the
 * parts that can go wrong - a database that will not open, a report that does not name its faction
 * or its turn - are testable without rendering anything.
 */

import type { CoreClient, OpenedGame, ParsedReport } from "@atlantis/core-client";
import { stripUnitComments } from "./ordersDocument";

/**
 * Which draft a document is.
 *
 * A draft belongs to a faction and a turn, not to a game alone: one game holds as many factions as
 * its reports name, and next month's orders are a different document from this month's. Both come
 * from the loaded report, which is why there is no draft at all until one is.
 */
export type DraftKey = { factionId: string; turnNumber: number };

/**
 * The draft a report belongs to, or `null` when it belongs to none.
 *
 * A report missing either half cannot be filed. That is the same refusal `rememberTurn` already
 * makes about a report that does not name its faction, and for the same reason: a key invented
 * here would put this turn's orders somewhere the next launch will not look.
 *
 * The missing-faction half of that is unreachable from either import door since ah-brd:
 * `judgeReportUsable` (`reportLoadDecision.ts`) refuses such a report, and both `routeReport` and
 * `prepareBatch` run it first. A missing turn number is a separate case and is not covered by it.
 * Kept as defence for any future caller, and pinned by "the import doors refuse a report that
 * names no faction" in this module's test file.
 */
export function draftKeyFor(parsed: ParsedReport | null): DraftKey | null {
  const factionId = parsed?.header.factionId;
  const turnNumber = parsed?.header.turnNumber;
  if (!factionId || turnNumber === null || turnNumber === undefined) {
    return null;
  }
  return { factionId, turnNumber };
}

/** What a save did, or why it did not. Never thrown: the player is mid-sentence. */
export type SaveOutcome =
  | { savedAt: string; warning: null }
  | { savedAt: null; warning: string };

/**
 * Writes one faction's orders for one turn.
 *
 * Failure comes back as a warning rather than an exception so the editor can say so and carry on.
 * Throwing here would take the workspace down over a write that can simply be retried on the next
 * keystroke - and the text the player typed is still in front of them either way.
 */
export async function saveDraft(
  client: CoreClient,
  game: OpenedGame,
  key: DraftKey,
  orderText: string,
  now: string
): Promise<SaveOutcome> {
  try {
    await client.saveOrderDraft(
      game.databasePath,
      game.manifest.metadata.gameId,
      key.factionId,
      key.turnNumber,
      orderText,
      now
    );
    return { savedAt: now, warning: null };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { savedAt: null, warning: detail };
  }
}

/** Which document the workspace should show, and where it came from. */
export type DocumentChoice = {
  text: string;
  /** True when the text is the player's saved work rather than the report's own template. */
  restored: boolean;
  /**
   * When the restored draft was written, as stored, or `null` for a template.
   *
   * Carried back so the editor can say "saved" and mean it. A restored draft is on disk already,
   * and showing "not saved yet" over the player's own recovered work would be the same lie the
   * fake timestamp used to tell, only in the other direction.
   */
  savedAt: string | null;
  warning: string | null;
};

/**
 * The saved draft if there is one, and the report's template if there is not.
 *
 * The draft wins even when the player has just opened the same report file again. There is no undo
 * anywhere in this application, so a stray file-open must not silently erase an evening of orders;
 * a new turn's report brings its own template along with it, which is the way back to a clean one.
 *
 * A draft that cannot be read leaves the template standing and says so. Refusing to show a report
 * that parsed perfectly well would trade something that works for something that does not.
 *
 * This is also where the server's unit descriptions are dropped, because it is the one place a
 * template becomes a document. They are the server's writing, not the player's, and the panel that
 * would otherwise show them is the panel for writing orders. A restored draft goes through
 * untouched: a `;` line in one is a note the player left themselves.
 */
export async function documentFor(
  client: CoreClient,
  game: OpenedGame,
  key: DraftKey | null,
  template: string
): Promise<DocumentChoice> {
  const clean = stripUnitComments(template);

  if (key === null) {
    return { text: clean, restored: false, savedAt: null, warning: null };
  }

  try {
    const draft = await client.loadOrderDraft(
      game.databasePath,
      game.manifest.metadata.gameId,
      key.factionId,
      key.turnNumber
    );
    if (draft === null) {
      return { text: clean, restored: false, savedAt: null, warning: null };
    }
    return {
      text: draft.orderText,
      restored: true,
      savedAt: draft.updatedAt,
      warning: null
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      text: clean,
      restored: false,
      savedAt: null,
      warning: `saved orders could not be read: ${detail}`
    };
  }
}

/**
 * Where the document stands with storage.
 *
 * Four states rather than a timestamp, because the orders panel used to show one made out of
 * `new Date()` that meant nothing. "failed" carries its reason: orders are the player's own typed
 * work, and a write that fails silently is the one failure that loses it.
 */
export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  /** `at` is an ISO-8601 instant, as stored. Turning it into a time to read is the panel's job. */
  | { kind: "saved"; at: string }
  | { kind: "failed"; reason: string };

/** The stored instant, in the player's own reading of the clock. Left alone if it will not parse. */
export function readableTime(isoInstant: string): string {
  const at = new Date(isoInstant);
  return Number.isNaN(at.getTime()) ? isoInstant : at.toLocaleTimeString();
}

/**
 * How a freshly loaded document stands with storage.
 *
 * A restored draft is on disk already and says so, with the time it was written. A template has
 * never been saved and says that instead.
 */
export function savedStateFor(savedAt: string | null): SaveState {
  return savedAt === null ? { kind: "clean" } : { kind: "saved", at: savedAt };
}

/** One document waiting to be written, with everything needed to write it in the right place. */
type Waiting = { game: OpenedGame; key: DraftKey; text: string };

export type DraftWriter = {
  /** Records an edit. Scheduling is the caller's - this only remembers what is owed. */
  markDirty: (game: OpenedGame | null, key: DraftKey | null, text: string) => void;
  /** Writes whatever is waiting, if anything is. Safe to call at any time, from anywhere. */
  flush: () => Promise<void>;
  /** When the document first went unwritten, for a caller measuring a ceiling against it. */
  dirtySince: () => number | null;
  /** Forgets what is owed without writing it. For a game being deleted out from under it. */
  discard: () => void;
};

/**
 * The bookkeeping behind autosave: what is owed, and one write at a time.
 *
 * Deliberately a plain closure rather than refs inside a component. Every interesting case here is
 * a race - a keystroke landing mid-write, a forced flush arriving while a timed one is in flight, a
 * failure with newer text already queued behind it - and none of them can be tested at all while
 * this lives inside a React component, which is how the first version shipped with two of them
 * wrong.
 *
 * `onState` reports every transition; `now` and `clock` are injected so a test can state the time
 * rather than mock one.
 */
export function createDraftWriter(
  client: CoreClient,
  onState: (state: SaveState) => void,
  now: () => string = () => new Date().toISOString(),
  clock: () => number = () => Date.now()
): DraftWriter {
  let pending: Waiting | null = null;
  let writing: Promise<void> | null = null;
  let dirtySince: number | null = null;

  return {
    markDirty(game, key, text) {
      // No game or no report means no key, and a key invented here would file this turn's orders
      // somewhere the next launch will not look.
      if (!game || !key) {
        return;
      }
      pending = { game, key, text };
      dirtySince ??= clock();
      onState({ kind: "dirty" });
    },

    dirtySince: () => dirtySince,

    discard() {
      pending = null;
      dirtySince = null;
    },

    async flush() {
      // Serialised: a quit and the idle timer can arrive together, and two writes of the same
      // document racing each other decide the winner by which finishes last.
      if (writing) {
        await writing;
      }
      const waiting = pending;
      if (!waiting) {
        return;
      }
      // Cleared before the write rather than after, so a second caller does not write it again.
      pending = null;
      dirtySince = null;
      onState({ kind: "saving" });

      const write = (async () => {
        const outcome = await saveDraft(client, waiting.game, waiting.key, waiting.text, now());

        if (outcome.warning !== null) {
          // Put it back so the next attempt retries it - unless a keystroke landed while this
          // write was in flight, in which case what is waiting is newer and must not be
          // overwritten by the text that failed.
          pending ??= waiting;
          dirtySince ??= clock();
          onState({ kind: "failed", reason: outcome.warning });
          return;
        }

        // Only say "saved" if nothing arrived behind it. Announcing it unconditionally would be
        // true of the text that was written and false of the text on screen - and worse, callers
        // schedule autosave off this state, so the transition would cancel the timers that
        // mid-write keystroke had just armed and put nothing in their place. The newest work would
        // then sit unwritten under a panel reading "saved", which is the loss this exists to stop.
        if (pending === null) {
          onState({ kind: "saved", at: outcome.savedAt });
        }
      })();

      writing = write;
      await write;
      writing = null;
    }
  };
}

/**
 * How long after the last keystroke a draft is written.
 *
 * Long enough that a sentence is not written a character at a time, short enough that a player who
 * pauses to think has already been saved by the time they look up.
 */
export const AUTOSAVE_IDLE_MS = 5_000;

/**
 * The longest a draft may go unsaved however continuously it is being typed.
 *
 * The idle rule alone has a hole in it: someone writing steadily for ten minutes never pauses, so
 * nothing is ever written, and that is exactly the session worth protecting. A write is a few kB
 * and one UPSERT, so the ceiling costs nothing to keep.
 */
export const AUTOSAVE_CEILING_MS = 30_000;
