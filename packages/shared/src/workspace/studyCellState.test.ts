import { describe, expect, it } from "vitest";
import {
  cellAddress,
  gridStep,
  keyToAction,
  parseCellAddress,
  pressDismisses,
  reduce,
  type CellMode,
  type GridAddress
} from "./studyCellState";

const idle: CellMode = { kind: "idle" };
const choosing: CellMode = { kind: "choosing", rowKey: "21/2431", turnIndex: 2 };

describe("reduce", () => {
  it("opening a cell puts the mode in choosing", () => {
    expect(reduce(idle, { kind: "cell-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(choosing);
  });

  it("teach-opened carries the ticks the cell already had", () => {
    expect(reduce(choosing, { kind: "teach-opened", students: ["2517"], live: false })).toEqual({
      kind: "teaching",
      rowKey: "21/2431",
      turnIndex: 2,
      students: ["2517"],
      live: false
    });
  });

  it("teach-toggled ticks and unticks in order", () => {
    const teaching = reduce(choosing, { kind: "teach-opened", students: [], live: false });
    const one = reduce(teaching, { kind: "teach-toggled", unitId: "2517" });
    const two = reduce(one, { kind: "teach-toggled", unitId: "2688" });

    expect(two).toMatchObject({ students: ["2517", "2688"] });
    expect(reduce(two, { kind: "teach-toggled", unitId: "2517" })).toMatchObject({
      students: ["2688"]
    });
  });

  it("cancelled from teaching returns to choosing on the same cell", () => {
    const teaching = reduce(choosing, { kind: "teach-opened", students: ["2517"], live: false });

    expect(reduce(teaching, { kind: "cancelled" })).toEqual(choosing);
  });

  it("cancelled from choosing goes idle", () => {
    expect(reduce(choosing, { kind: "cancelled" })).toEqual(idle);
  });

  it("closed goes idle", () => {
    expect(reduce(choosing, { kind: "closed" })).toEqual(idle);
  });

  it("ignores every event but cell-opened while idle", () => {
    expect(reduce(idle, { kind: "teach-opened", students: ["2517"], live: false })).toEqual(idle);
    expect(reduce(idle, { kind: "teach-toggled", unitId: "2517" })).toEqual(idle);
    expect(reduce(idle, { kind: "cancelled" })).toEqual(idle);
    expect(reduce(idle, { kind: "closed" })).toEqual(idle);
  });

  it("opening the open cell again closes it, with nothing chosen", () => {
    expect(reduce(choosing, { kind: "cell-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(idle);
    const teaching = reduce(choosing, { kind: "teach-opened", students: ["2517"], live: false });
    expect(reduce(teaching, { kind: "cell-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(idle);
  });

  it("opening another cell moves the dropdown there", () => {
    expect(reduce(choosing, { kind: "cell-opened", rowKey: "21/2431", turnIndex: 3 })).toEqual({
      ...choosing,
      turnIndex: 3
    });
    expect(reduce(choosing, { kind: "cell-opened", rowKey: "21/2517", turnIndex: 2 })).toEqual({
      ...choosing,
      rowKey: "21/2517"
    });
  });

  it("dismissed closes from any step, the teach step included", () => {
    const teaching = reduce(choosing, { kind: "teach-opened", students: ["2517"], live: false });
    expect(reduce(choosing, { kind: "dismissed" })).toEqual(idle);
    expect(reduce(teaching, { kind: "dismissed" })).toEqual(idle);
    expect(reduce(idle, { kind: "dismissed" })).toEqual(idle);
  });
});

describe("pressDismisses", () => {
  /** A pressed element that sits inside whatever `within` names, and nothing else. */
  const at = (...within: string[]) => ({
    closest: (selector: string) => (within.includes(selector) ? {} : null)
  });

  it("dismisses a press anywhere off the dropdown and off the grid cells", () => {
    expect(pressDismisses(at())).toBe(true);
  });

  it("leaves a press inside the dropdown to the dropdown", () => {
    expect(pressDismisses(at("[data-cell-popover]"))).toBe(false);
  });

  it("leaves a press on a grid cell to the cell's own click", () => {
    expect(pressDismisses(at("[data-cell]"))).toBe(false);
  });

  it("ignores a press with no element behind it", () => {
    expect(pressDismisses(null)).toBe(false);
  });
});

describe("keyToAction", () => {
  it("is set on Cmd or Ctrl and Enter, and cancel on Escape", () => {
    expect(keyToAction({ key: "Enter", metaKey: true, ctrlKey: false })).toBe("set");
    expect(keyToAction({ key: "Enter", metaKey: false, ctrlKey: true })).toBe("set");
    expect(keyToAction({ key: "Escape", metaKey: false, ctrlKey: false })).toBe("cancel");
    expect(keyToAction({ key: "Enter", metaKey: false, ctrlKey: false })).toBeNull();
    expect(keyToAction({ key: "a", metaKey: false, ctrlKey: false })).toBeNull();
  });
});

describe("a live teach step", () => {
  const choosing = { kind: "choosing" as const, rowKey: "r", turnIndex: 1 };

  it("freezes on the first untick", () => {
    const teaching = reduce(choosing, {
      kind: "teach-opened",
      students: ["a", "b", "c"],
      live: true
    });
    expect(teaching).toEqual({ ...choosing, kind: "teaching", students: ["a", "b", "c"], live: true });

    const frozen = reduce(teaching, { kind: "teach-toggled", unitId: "b" });

    expect(frozen).toEqual({ ...choosing, kind: "teaching", students: ["a", "c"], live: false });
  });

  it("a frozen teach step stays frozen", () => {
    const teaching = reduce(choosing, { kind: "teach-opened", students: ["a"], live: false });

    const after = reduce(teaching, { kind: "teach-toggled", unitId: "b" });

    expect(after).toEqual({ ...choosing, kind: "teaching", students: ["a", "b"], live: false });
  });
});

// ah-9qdz.2: the cast half is a dropdown of its own on the same turn.
describe("the cast half's mode", () => {
  const casting: CellMode = { kind: "casting", rowKey: "21/2431", turnIndex: 2 };

  it("opening a cast half puts the mode in casting", () => {
    expect(reduce(idle, { kind: "cast-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(casting);
  });

  it("the open half pressed again closes it; the study half of the same turn opens instead", () => {
    expect(reduce(casting, { kind: "cast-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(idle);
    expect(reduce(casting, { kind: "cell-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(
      choosing
    );
    expect(reduce(choosing, { kind: "cast-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(
      casting
    );
  });

  it("Escape closes it with nothing changed", () => {
    expect(reduce(casting, { kind: "cancelled" })).toEqual(idle);
  });
});

describe("cell addresses", () => {
  it("writes a study half as `r:c` and a cast half as `r:c:cast`, and reads both back", () => {
    const study: GridAddress = { row: 1, turn: 3, half: "study" };
    const cast: GridAddress = { row: 1, turn: 3, half: "cast" };

    expect([cellAddress(study), cellAddress(cast)]).toEqual(["1:3", "1:3:cast"]);
    expect([parseCellAddress("1:3"), parseCellAddress("1:3:cast")]).toEqual([study, cast]);
    expect(parseCellAddress("nonsense")).toBeNull();
  });
});

describe("gridStep", () => {
  // Three rows, four turns; row 0 has halves on turns 1-3, row 1 on none, row 2 on turn 0 only.
  const halves = new Set(["0:1", "0:2", "0:3", "2:0"]);
  const step = (from: GridAddress, key: string) =>
    gridStep(from, key, { rows: 3, turns: 4 }, (row, turn) => halves.has(`${row}:${turn}`));
  const study = (row: number, turn: number): GridAddress => ({ row, turn, half: "study" });
  const cast = (row: number, turn: number): GridAddress => ({ row, turn, half: "cast" });

  it("↓ goes from a study to its cast half when it has one, else to the next mage's study", () => {
    expect(step(study(0, 1), "ArrowDown")).toEqual(cast(0, 1));
    expect(step(study(0, 0), "ArrowDown")).toEqual(study(1, 0));
    expect(step(cast(0, 1), "ArrowDown")).toEqual(study(1, 1));
  });

  it("↑ is the reverse", () => {
    expect(step(cast(0, 1), "ArrowUp")).toEqual(study(0, 1));
    expect(step(study(1, 1), "ArrowUp")).toEqual(cast(0, 1));
    expect(step(study(1, 0), "ArrowUp")).toEqual(study(0, 0));
  });

  it("← → keep to the cast half, and land on the study where the next turn has none", () => {
    expect(step(cast(0, 1), "ArrowRight")).toEqual(cast(0, 2));
    expect(step(cast(0, 1), "ArrowLeft")).toEqual(study(0, 0));
    expect(step(study(0, 1), "ArrowRight")).toEqual(study(0, 2));
  });

  it("stops at the grid's edges and ignores other keys", () => {
    expect(step(cast(0, 3), "ArrowRight")).toBeNull();
    expect(step(study(0, 0), "ArrowUp")).toBeNull();
    expect(step(study(2, 1), "ArrowDown")).toBeNull();
    expect(step(cast(2, 0), "ArrowDown")).toBeNull();
    expect(step(study(0, 0), "Enter")).toBeNull();
  });
});
