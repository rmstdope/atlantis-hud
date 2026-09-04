import { describe, expect, it } from "vitest";
import { keyToAction, reduce, type CellMode } from "./studyCellState";

const idle: CellMode = { kind: "idle" };
const editing: CellMode = {
  kind: "editing",
  rowKey: "21/2431",
  turnIndex: 2,
  pick: { kind: "study", skill: "FORC", targetLevel: 4 }
};

describe("reduce", () => {
  it("opens a cell with whatever that cell already plans", () => {
    expect(
      reduce(idle, {
        kind: "cell-clicked",
        rowKey: "21/2431",
        turnIndex: 2,
        pick: { kind: "study", skill: "FORC", targetLevel: 4 }
      })
    ).toEqual(editing);
  });

  it("moves straight to another cell without closing first", () => {
    expect(
      reduce(editing, {
        kind: "cell-clicked",
        rowKey: "21/2432",
        turnIndex: 0,
        pick: null
      })
    ).toEqual({
      kind: "editing",
      rowKey: "21/2432",
      turnIndex: 0,
      pick: null
    });
  });

  it("drops the level when a different skill is chosen", () => {
    expect(reduce(editing, { kind: "skill-chosen", skill: "PATT" })).toEqual({
      ...editing,
      pick: { kind: "study", skill: "PATT", targetLevel: null }
    });
  });

  it("takes a level, and takes the one-month form as null", () => {
    expect(reduce(editing, { kind: "level-chosen", targetLevel: 5 })).toMatchObject({
      pick: { targetLevel: 5 }
    });
    expect(reduce(editing, { kind: "level-chosen", targetLevel: null })).toMatchObject({
      pick: { targetLevel: null }
    });
  });

  it("closes on Set and on Cancel alike", () => {
    expect(reduce(editing, { kind: "set" })).toEqual(idle);
    expect(reduce(editing, { kind: "cancelled" })).toEqual(idle);
  });

  it("ignores a choice made while nothing is open", () => {
    expect(reduce(idle, { kind: "skill-chosen", skill: "PATT" })).toEqual(idle);
    expect(reduce(idle, { kind: "level-chosen", targetLevel: 3 })).toEqual(idle);
  });
});

describe("keyToAction", () => {
  it("sets on either modifier and Enter", () => {
    expect(keyToAction({ key: "Enter", metaKey: true, ctrlKey: false })).toBe("set");
    expect(keyToAction({ key: "Enter", metaKey: false, ctrlKey: true })).toBe("set");
  });

  it("cancels on Escape", () => {
    expect(keyToAction({ key: "Escape", metaKey: false, ctrlKey: false })).toBe("cancel");
  });

  it("means nothing for a plain Enter or any other key", () => {
    expect(keyToAction({ key: "Enter", metaKey: false, ctrlKey: false })).toBeNull();
    expect(keyToAction({ key: "a", metaKey: false, ctrlKey: false })).toBeNull();
  });
});

describe("one popover, one answer", () => {
  const open = reduce({ kind: "idle" }, {
    kind: "cell-clicked",
    rowKey: "21/2431",
    turnIndex: 0,
    pick: null
  });

  it("discards a chosen skill when a student is ticked", () => {
    const chosen = reduce(open, { kind: "skill-chosen", skill: "FORC" });

    const ticked = reduce(chosen, { kind: "teach-toggled", unitId: "2517" });

    expect(ticked.kind === "editing" && ticked.pick).toEqual({
      kind: "teach",
      students: ["2517"]
    });
  });

  it("discards ticked students when a skill is chosen", () => {
    const ticked = reduce(open, { kind: "teach-toggled", unitId: "2517" });

    const chosen = reduce(ticked, { kind: "skill-chosen", skill: "FORC" });

    expect(chosen.kind === "editing" && chosen.pick).toEqual({
      kind: "study",
      skill: "FORC",
      targetLevel: null
    });
  });

  it("unticks a student ticked twice, and keeps tick order otherwise", () => {
    const two = reduce(
      reduce(open, { kind: "teach-toggled", unitId: "2517" }),
      { kind: "teach-toggled", unitId: "2688" }
    );

    const back = reduce(two, { kind: "teach-toggled", unitId: "2517" });

    expect(two.kind === "editing" && two.pick).toEqual({
      kind: "teach",
      students: ["2517", "2688"]
    });
    expect(back.kind === "editing" && back.pick).toEqual({ kind: "teach", students: ["2688"] });
  });
});
