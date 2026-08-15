/**
 * The Notes section's editing state, pulled into a pure module so it can be pinned by tests:
 * `renderToStaticMarkup` cannot click (see `BadgeMenu.test.tsx`), so this is what carries the
 * red bar for the editor's behaviour instead of the smoke suite alone.
 */

import { HEX_NOTE_MAX_CHARS, normalizeNoteText } from "../hexNotes";

export type NotesMode =
  | { kind: "idle" }
  | { kind: "adding"; draft: string }
  | { kind: "editing"; noteId: string; draft: string }
  | { kind: "removing"; noteId: string };

export type NotesEvent =
  | { type: "add-note-clicked" }
  | { type: "edit-note-clicked"; noteId: string; text: string }
  | { type: "draft-changed"; draft: string }
  | { type: "cancelled" }
  | { type: "saved" }
  | { type: "remove-clicked"; noteId: string }
  | { type: "kept" }
  | { type: "removed" };

/** Whether the current draft can be saved: not empty/whitespace, and within the character limit. */
export function canSave(draft: string): boolean {
  return normalizeNoteText(draft) !== null && [...draft.trim()].length <= HEX_NOTE_MAX_CHARS;
}

export type KeyAction = "save" | "cancel" | null;

/**
 * What a keydown on the editor's textarea means. Plain Enter is a newline, not an action.
 *
 * Either modifier saves regardless of platform - Cmd or Ctrl+Enter, whichever the player reaches
 * for - so this takes no platform flag; `RegionNotes` only needs one to choose which spelling the
 * hint line under the editor shows.
 */
export function keyToAction(event: { key: string; metaKey: boolean; ctrlKey: boolean }): KeyAction {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    return "save";
  }
  if (event.key === "Escape") {
    return "cancel";
  }
  return null;
}

/** The section's editing state machine. */
export function reduce(mode: NotesMode, event: NotesEvent): NotesMode {
  switch (event.type) {
    case "add-note-clicked":
      return { kind: "adding", draft: "" };
    case "edit-note-clicked":
      return { kind: "editing", noteId: event.noteId, draft: event.text };
    case "draft-changed":
      return mode.kind === "adding"
        ? { kind: "adding", draft: event.draft }
        : mode.kind === "editing"
          ? { kind: "editing", noteId: mode.noteId, draft: event.draft }
          : mode;
    case "cancelled":
    case "saved":
    case "kept":
    case "removed":
      return { kind: "idle" };
    case "remove-clicked":
      return { kind: "removing", noteId: event.noteId };
    default:
      return mode;
  }
}
