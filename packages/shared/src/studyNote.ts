/**
 * A mage's free-text note on his study plan: what the player wants to remember about him.
 *
 * Modelled line for line on `hexNotes.ts`' note rules, and deliberately their twin - the same
 * limit, counted the same way. One difference: a blank note normalises to the empty string rather
 * than to null, because `StudyPlanRecord.comment` is never null and an emptied note is a
 * legitimate edit rather than a refusal.
 */

/** The interview's limit: multi-line, 500 characters, counted by code point - `HEX_NOTE_MAX_CHARS`' twin. */
export const STUDY_NOTE_MAX_CHARS = 500;

/** Trimmed text; the empty string when it is blank, since `StudyPlanRecord.comment` is never null. */
export function normalizeStudyNote(text: string): string {
  return text.trim();
}

/** `78 / 500`. */
export function noteCountText(text: string): string {
  return `${[...text].length} / ${STUDY_NOTE_MAX_CHARS}`;
}
