/**
 * The cell popover's open/closed/draft state, pulled into a pure module so it can be pinned by
 * tests: `renderToStaticMarkup` cannot click, exactly as `regionNotesState.ts` says.
 *
 * Nothing is written until `Set` is pressed; `Cancel` and `Escape` close the menu and change
 * nothing.
 */

export type CellMode =
  | { kind: "idle" }
  | {
      kind: "editing";
      rowKey: string;
      turnIndex: number;
      skill: string | null;
      targetLevel: number | null;
    };

export type CellEvent =
  | {
      kind: "cell-clicked";
      rowKey: string;
      turnIndex: number;
      skill: string | null;
      targetLevel: number | null;
    }
  | { kind: "skill-chosen"; skill: string }
  | { kind: "level-chosen"; targetLevel: number | null }
  | { kind: "cancelled" }
  | { kind: "set" };

/** The popover's state machine. */
export function reduce(mode: CellMode, event: CellEvent): CellMode {
  switch (event.kind) {
    case "cell-clicked":
      return {
        kind: "editing",
        rowKey: event.rowKey,
        turnIndex: event.turnIndex,
        skill: event.skill,
        targetLevel: event.targetLevel
      };
    case "skill-chosen":
      // A different skill drops the level with it: a target that belonged to another skill would
      // be a number the player never chose for this one.
      return mode.kind === "editing"
        ? { ...mode, skill: event.skill, targetLevel: null }
        : mode;
    case "level-chosen":
      return mode.kind === "editing" ? { ...mode, targetLevel: event.targetLevel } : mode;
    case "cancelled":
    case "set":
      return { kind: "idle" };
  }
}

/** `"set" | "cancel" | null`, as `regionNotesState.keyToAction` answers it. */
export function keyToAction(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): "set" | "cancel" | null {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    return "set";
  }
  if (event.key === "Escape") {
    return "cancel";
  }
  return null;
}
