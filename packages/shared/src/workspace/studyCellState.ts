/**
 * The cell popover's open/closed/draft state, pulled into a pure module so it can be pinned by
 * tests: `renderToStaticMarkup` cannot click, exactly as `regionNotesState.ts` says.
 *
 * Nothing is written until `Set` is pressed; `Cancel` and `Escape` close the menu and change
 * nothing.
 */

/**
 * What the open popover would write if Set were pressed now.
 *
 * One answer, not two: a popover writes one goal, so the two kinds are exclusive by construction
 * rather than by a rule somebody has to remember.
 */
export type CellPick =
  | { kind: "study"; skill: string; targetLevel: number | null }
  | { kind: "teach"; students: string[] };

export type CellMode =
  | { kind: "idle" }
  | { kind: "editing"; rowKey: string; turnIndex: number; pick: CellPick | null };

export type CellEvent =
  | { kind: "cell-clicked"; rowKey: string; turnIndex: number; pick: CellPick | null }
  | { kind: "skill-chosen"; skill: string }
  | { kind: "level-chosen"; targetLevel: number | null }
  | { kind: "teach-toggled"; unitId: string }
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
        pick: event.pick
      };
    case "skill-chosen":
      // A different skill drops the level with it - a target that belonged to another skill would
      // be a number the player never chose for this one - and drops any ticked students, because
      // the popover has one answer.
      return mode.kind === "editing"
        ? { ...mode, pick: { kind: "study", skill: event.skill, targetLevel: null } }
        : mode;
    case "level-chosen":
      return mode.kind === "editing" && mode.pick?.kind === "study"
        ? { ...mode, pick: { ...mode.pick, targetLevel: event.targetLevel } }
        : mode;
    case "teach-toggled": {
      if (mode.kind !== "editing") {
        return mode;
      }
      // Ticking a student discards a chosen skill for the same reason, and tick order is kept:
      // it is the order the export will write the unit ids in.
      const students = mode.pick?.kind === "teach" ? mode.pick.students : [];
      return {
        ...mode,
        pick: {
          kind: "teach",
          students: students.includes(event.unitId)
            ? students.filter((unitId) => unitId !== event.unitId)
            : [...students, event.unitId]
        }
      };
    }
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
