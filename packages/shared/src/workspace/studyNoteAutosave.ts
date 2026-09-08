import { normalizeStudyNote } from "../studyNote";

/**
 * How long a note sits on screen unwritten while the player is still typing. Short enough that the
 * window in which text is visible and not stored is not a window a person can act inside, and every
 * way out of the note (a mage switched, the window closed) flushes rather than waiting for it.
 */
export const STUDY_NOTE_AUTOSAVE_MS = 400;

export type NoteAutosave = {
  /** Records what is now on screen and schedules a write. Safe to call on every keystroke. */
  typed: (text: string) => void;
  /** Writes what is owed now, if anything is owed. For the editor going away. */
  flush: () => void;
  /**
   * Forgets what is owed without writing it, and drops any pending timer. Exported for
   * completeness; the note editor never calls it, since every way out of the note is a flush.
   */
  cancel: () => void;
  /** True while text the player typed has not been written yet. Empty text counts as owed. */
  owes: () => boolean;
  /**
   * Storage now holds `stored` and nothing is owed against it. For an editor adopting a note that
   * changed underneath it; never call this while `owes()` is true.
   */
  adopted: (stored: string) => void;
};

/**
 * The note's write rule, kept out of React: `packages/shared` has no jsdom (ah-nass), so its
 * component tests run no effects and fire no timers, and logic left inside the component would be
 * reachable only from the browser suite. Shaped after `createDraftWriter` in `orderDraft.ts`.
 *
 * `write` is handed the note already normalised. `stored` is the note as storage holds it, so a
 * note nobody changed is never written back.
 */
export function createNoteAutosave(
  write: (comment: string) => void,
  stored: string,
  delayMs: number = STUDY_NOTE_AUTOSAVE_MS
): NoteAutosave {
  let lastWritten = normalizeStudyNote(stored);
  let owed: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (owed === null || owed === lastWritten) {
      owed = null;
      return;
    }
    const comment = owed;
    owed = null;
    lastWritten = comment;
    write(comment);
  };

  return {
    typed(text) {
      clearTimer();
      const comment = normalizeStudyNote(text);
      // A note nobody changed is never written back: opening a mage and leaving must not stamp a
      // new `updatedAt` on his plan.
      if (comment === lastWritten) {
        owed = null;
        return;
      }
      owed = comment;
      timer = setTimeout(flush, delayMs);
    },

    flush,

    cancel() {
      clearTimer();
      owed = null;
    },

    owes() {
      return owed !== null;
    },

    adopted(stored) {
      lastWritten = normalizeStudyNote(stored);
    }
  };
}
