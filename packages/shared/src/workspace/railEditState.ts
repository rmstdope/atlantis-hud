/**
 * The source rail's editing state, pulled into a pure module so it can be pinned by tests:
 * `renderToStaticMarkup` cannot click, so this is what carries the red bar for naming, renaming
 * and confirming a delete. Modelled exactly on `regionNotesState.ts`, which exists for the same
 * reason.
 *
 * Three surfaces in `ah-1mpx.2` can change an Army - the rail (`+ New Army`, inline naming), the
 * strip above the table (`Rename`, `Delete`) and the `Add to army` popover (`New Army…`) - and
 * they share one state, held by `UnitTableDock`, or `Rename` in the strip could not put the rail's
 * row into edit.
 */

import type { ReportUnit } from "@atlantis/core-client";

export type RailMode =
  | { kind: "idle" }
  /**
   * A new Army being named. `withUnits` are the rows that join it on Enter - the popover's
   * "New Army…" carries the pick, and a drop on `+ New Army` carries what was dragged
   * (`ah-1mpx.4` D1). Empty for the rail's own `+ New Army`.
   */
  | { kind: "creating"; draft: string; withUnits: readonly ReportUnit[] }
  | { kind: "renaming"; armyId: string; draft: string }
  | { kind: "deleting"; armyId: string };

export type RailEvent =
  | { type: "new-clicked"; withUnits: readonly ReportUnit[] }
  | { type: "rename-clicked"; armyId: string; name: string }
  | { type: "draft-changed"; draft: string }
  | { type: "cancelled" }
  | { type: "committed" }
  | { type: "delete-clicked"; armyId: string }
  | { type: "delete-cancelled" }
  | { type: "deleted" };

/** The rail's editing state machine. */
export function reduce(mode: RailMode, event: RailEvent): RailMode {
  switch (event.type) {
    case "new-clicked":
      return { kind: "creating", draft: "", withUnits: event.withUnits };
    case "rename-clicked":
      return { kind: "renaming", armyId: event.armyId, draft: event.name };
    case "draft-changed":
      return mode.kind === "creating"
        ? { kind: "creating", draft: event.draft, withUnits: mode.withUnits }
        : mode.kind === "renaming"
          ? { kind: "renaming", armyId: mode.armyId, draft: event.draft }
          : mode;
    case "delete-clicked":
      return { kind: "deleting", armyId: event.armyId };
    // Escape abandons a new Army and reverts a rename, and both are the same thing here: the
    // reducer holds a draft and nothing else, so dropping it is the whole of reverting.
    case "cancelled":
    case "committed":
    case "delete-cancelled":
    case "deleted":
      return { kind: "idle" };
    default:
      return mode;
  }
}

/** A name is committable when it has something in it once trimmed. Duplicates are allowed. */
export function canCommit(draft: string): boolean {
  return draft.trim().length > 0;
}

export type RailKeyAction = "commit" | "cancel" | null;

/**
 * Enter commits, Escape cancels.
 *
 * Deliberately different from `regionNotesState.ts:39`, where plain Enter is a newline and
 * Cmd/Ctrl+Enter saves: a note is a paragraph and an Army's name is one line, so there is no
 * newline for Enter to be. That difference is a decision, not an oversight.
 */
export function keyToAction(event: { key: string }): RailKeyAction {
  if (event.key === "Enter") {
    return "commit";
  }
  if (event.key === "Escape") {
    return "cancel";
  }
  return null;
}
