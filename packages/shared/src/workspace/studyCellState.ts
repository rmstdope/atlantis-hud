/**
 * The cell dropdown's open/closed state, pulled into a pure module so it can be pinned by tests:
 * `renderToStaticMarkup` cannot click, exactly as `regionNotesState.ts` says.
 *
 * Two steps, not one form. Choosing a skill or `— nothing` commits immediately and closes - one
 * choice is one click, which is the whole point of the round-four redesign - and only the teach
 * step, where several students are ticked, keeps `Set` and `Cancel`.
 */

/**
 * What a cell will hold. `null` at the call site is `— nothing`.
 *
 * One answer, not two: a cell holds one goal, so the two kinds are exclusive by construction rather
 * than by a rule somebody has to remember.
 */
export type CellPick =
  | { kind: "study"; skill: string }
  | { kind: "teach"; students: string[] };

export type CellMode =
  | { kind: "idle" }
  /** The dropdown is open on this cell. */
  | { kind: "choosing"; rowKey: string; turnIndex: number }
  /** `Teaches…` was chosen, and the student list is open on the same cell. */
  | { kind: "teaching"; rowKey: string; turnIndex: number; students: string[] };

export type CellEvent =
  | { kind: "cell-opened"; rowKey: string; turnIndex: number }
  /** `students` seeds the ticks from whatever the cell already holds. */
  | { kind: "teach-opened"; students: readonly string[] }
  | { kind: "teach-toggled"; unitId: string }
  /** Escape or Cancel: `teaching` goes back to `choosing`, `choosing` goes idle. */
  | { kind: "cancelled" }
  /** A choice was committed; the dropdown closes. */
  | { kind: "closed" };

/** The dropdown's state machine. */
export function reduce(mode: CellMode, event: CellEvent): CellMode {
  switch (event.kind) {
    case "cell-opened":
      return { kind: "choosing", rowKey: event.rowKey, turnIndex: event.turnIndex };
    case "teach-opened":
      return mode.kind === "choosing"
        ? { ...mode, kind: "teaching", students: [...event.students] }
        : mode;
    case "teach-toggled": {
      if (mode.kind !== "teaching") {
        return mode;
      }
      // Tick order is kept: it is the order the export will write the unit ids in.
      return {
        ...mode,
        students: mode.students.includes(event.unitId)
          ? mode.students.filter((unitId) => unitId !== event.unitId)
          : [...mode.students, event.unitId]
      };
    }
    case "cancelled":
      // The teach step was entered from the dropdown, so cancelling it lands there; a second
      // Escape closes.
      return mode.kind === "teaching"
        ? { kind: "choosing", rowKey: mode.rowKey, turnIndex: mode.turnIndex }
        : { kind: "idle" };
    case "closed":
      return { kind: "idle" };
  }
}

/** `"set" | "cancel" | null`, as `regionNotesState.keyToAction` answers it. Used by the teach step. */
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
