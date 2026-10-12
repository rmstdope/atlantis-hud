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
  | { kind: "teach"; students: string[]; live: boolean };

export type CellMode =
  | { kind: "idle" }
  /** The dropdown is open on this cell. */
  | { kind: "choosing"; rowKey: string; turnIndex: number }
  /** `Teaches…` was chosen, and the student list is open on the same cell. */
  | { kind: "teaching"; rowKey: string; turnIndex: number; students: string[]; live: boolean }
  /** The cast half's dropdown is open on this turn (ah-9qdz.2). */
  | { kind: "casting"; rowKey: string; turnIndex: number };

export type CellEvent =
  | { kind: "cell-opened"; rowKey: string; turnIndex: number }
  /** The cast half under a turn was pressed (ah-9qdz.2). */
  | { kind: "cast-opened"; rowKey: string; turnIndex: number }
  /**
   * `students` seeds the ticks; `live` says whether they are a standing instruction - "teach
   * whoever is eligible this turn" - or the fixed list the cell already holds.
   */
  | { kind: "teach-opened"; students: readonly string[]; live: boolean }
  | { kind: "teach-toggled"; unitId: string }
  /** Escape or Cancel: `teaching` goes back to `choosing`, `choosing` goes idle. */
  | { kind: "cancelled" }
  /** A choice was committed; the dropdown closes. */
  | { kind: "closed" }
  /**
   * A press outside the dropdown (ah-9wzn): the whole dropdown closes, the teach step included,
   * and nothing is written - unlike `cancelled`, which only steps back out of the teach step.
   */
  | { kind: "dismissed" };

/** The dropdown's state machine. */
export function reduce(mode: CellMode, event: CellEvent): CellMode {
  switch (event.kind) {
    case "cell-opened":
      // The open cell clicked again closes its dropdown with nothing chosen (ah-9wzn); any other
      // cell moves it there - the cast half of the same turn included, which is another button.
      return (mode.kind === "choosing" || mode.kind === "teaching") &&
        mode.rowKey === event.rowKey &&
        mode.turnIndex === event.turnIndex
        ? { kind: "idle" }
        : { kind: "choosing", rowKey: event.rowKey, turnIndex: event.turnIndex };
    case "cast-opened":
      return mode.kind === "casting" &&
        mode.rowKey === event.rowKey &&
        mode.turnIndex === event.turnIndex
        ? { kind: "idle" }
        : { kind: "casting", rowKey: event.rowKey, turnIndex: event.turnIndex };
    case "teach-opened":
      return mode.kind === "choosing"
        ? { ...mode, kind: "teaching", students: [...event.students], live: event.live }
        : mode;
    case "teach-toggled": {
      if (mode.kind !== "teaching") {
        return mode;
      }
      // Tick order is kept: it is the order the export will write the unit ids in.
      return {
        ...mode,
        // The first tick or untick freezes a live cell into the list it is showing: from here on
        // the ticks are the whole answer and nothing is recomputed (ah-af7i).
        live: false,
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
    case "dismissed":
      return { kind: "idle" };
  }
}

/**
 * Whether a press on `target` closes the open dropdown (ah-9wzn): it does anywhere but inside the
 * dropdown card (`data-cell-popover`) and on a grid cell (`data-cell`). A grid cell is left to its
 * own click, which already answers - the open cell toggles shut, another cell moves the dropdown -
 * and dismissing on its press would have that same-cell click open the dropdown straight back.
 *
 * Takes anything with `closest` so it can be pinned without a DOM (ah-nass).
 */
export function pressDismisses(target: { closest(selector: string): unknown } | null): boolean {
  if (target === null) {
    return false;
  }
  return target.closest("[data-cell-popover]") === null && target.closest("[data-cell]") === null;
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

/**
 * Where a grid button sits: its row, its turn, and which half of the cell (ah-9qdz.2). The study
 * half is the cell as it always was; the cast half hangs under it on turns that have one.
 */
export type GridAddress = { row: number; turn: number; half: "study" | "cast" };

/**
 * The `data-cell` text of a grid button: `r:c` for the study half, exactly as before casts, and
 * `r:c:cast` for the cast half. One spelling, so the walk, the anchoring and the focus return
 * cannot disagree.
 */
export function cellAddress(address: GridAddress): string {
  return address.half === "cast"
    ? `${address.row}:${address.turn}:cast`
    : `${address.row}:${address.turn}`;
}

/** `cellAddress` read back, or null for anything it did not write. */
export function parseCellAddress(text: string): GridAddress | null {
  const match = /^(\d+):(\d+)(:cast)?$/.exec(text);
  if (match === null) {
    return null;
  }
  return {
    row: Number(match[1]),
    turn: Number(match[2]),
    half: match[3] === undefined ? "study" : "cast"
  };
}

/**
 * Where an arrow key goes from `from`, or null at an edge or for any other key - the agreed walk:
 * ↓ from a study goes to its cast half when it has one, else to the next mage's study; ↑ is the
 * reverse; ← → keep to the same half, landing on the study where the neighbouring turn has none.
 */
export function gridStep(
  from: GridAddress,
  key: string,
  bounds: { rows: number; turns: number },
  hasCast: (row: number, turn: number) => boolean
): GridAddress | null {
  const inside = (row: number, turn: number) =>
    row >= 0 && row < bounds.rows && turn >= 0 && turn < bounds.turns;
  switch (key) {
    case "ArrowDown": {
      if (from.half === "study" && hasCast(from.row, from.turn)) {
        return { ...from, half: "cast" };
      }
      const row = from.row + 1;
      return inside(row, from.turn) ? { row, turn: from.turn, half: "study" } : null;
    }
    case "ArrowUp": {
      if (from.half === "cast") {
        return { ...from, half: "study" };
      }
      const row = from.row - 1;
      if (!inside(row, from.turn)) {
        return null;
      }
      return { row, turn: from.turn, half: hasCast(row, from.turn) ? "cast" : "study" };
    }
    case "ArrowLeft":
    case "ArrowRight": {
      const turn = from.turn + (key === "ArrowRight" ? 1 : -1);
      if (!inside(from.row, turn)) {
        return null;
      }
      return {
        row: from.row,
        turn,
        half: from.half === "cast" && hasCast(from.row, turn) ? "cast" : "study"
      };
    }
    default:
      return null;
  }
}
