import { describe, expect, it } from "vitest";
import { keyToAction, reduce, type CellMode } from "./studyCellState";

const idle: CellMode = { kind: "idle" };
const editing: CellMode = {
  kind: "editing",
  rowKey: "21/2431",
  turnIndex: 2,
  skill: "FORC",
  targetLevel: 4
};

describe("reduce", () => {
  it("opens a cell with whatever that cell already plans", () => {
    expect(
      reduce(idle, {
        kind: "cell-clicked",
        rowKey: "21/2431",
        turnIndex: 2,
        skill: "FORC",
        targetLevel: 4
      })
    ).toEqual(editing);
  });

  it("moves straight to another cell without closing first", () => {
    expect(
      reduce(editing, {
        kind: "cell-clicked",
        rowKey: "21/2432",
        turnIndex: 0,
        skill: null,
        targetLevel: null
      })
    ).toEqual({
      kind: "editing",
      rowKey: "21/2432",
      turnIndex: 0,
      skill: null,
      targetLevel: null
    });
  });

  it("drops the level when a different skill is chosen", () => {
    expect(reduce(editing, { kind: "skill-chosen", skill: "PATT" })).toEqual({
      ...editing,
      skill: "PATT",
      targetLevel: null
    });
  });

  it("takes a level, and takes the one-month form as null", () => {
    expect(reduce(editing, { kind: "level-chosen", targetLevel: 5 })).toMatchObject({
      targetLevel: 5
    });
    expect(reduce(editing, { kind: "level-chosen", targetLevel: null })).toMatchObject({
      targetLevel: null
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
