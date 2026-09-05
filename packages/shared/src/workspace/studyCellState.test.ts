import { describe, expect, it } from "vitest";
import { keyToAction, reduce, type CellMode } from "./studyCellState";

const idle: CellMode = { kind: "idle" };
const choosing: CellMode = { kind: "choosing", rowKey: "21/2431", turnIndex: 2 };

describe("reduce", () => {
  it("opening a cell puts the mode in choosing", () => {
    expect(reduce(idle, { kind: "cell-opened", rowKey: "21/2431", turnIndex: 2 })).toEqual(choosing);
  });

  it("teach-opened carries the ticks the cell already had", () => {
    expect(reduce(choosing, { kind: "teach-opened", students: ["2517"] })).toEqual({
      kind: "teaching",
      rowKey: "21/2431",
      turnIndex: 2,
      students: ["2517"]
    });
  });

  it("teach-toggled ticks and unticks in order", () => {
    const teaching = reduce(choosing, { kind: "teach-opened", students: [] });
    const one = reduce(teaching, { kind: "teach-toggled", unitId: "2517" });
    const two = reduce(one, { kind: "teach-toggled", unitId: "2688" });

    expect(two).toMatchObject({ students: ["2517", "2688"] });
    expect(reduce(two, { kind: "teach-toggled", unitId: "2517" })).toMatchObject({
      students: ["2688"]
    });
  });

  it("cancelled from teaching returns to choosing on the same cell", () => {
    const teaching = reduce(choosing, { kind: "teach-opened", students: ["2517"] });

    expect(reduce(teaching, { kind: "cancelled" })).toEqual(choosing);
  });

  it("cancelled from choosing goes idle", () => {
    expect(reduce(choosing, { kind: "cancelled" })).toEqual(idle);
  });

  it("closed goes idle", () => {
    expect(reduce(choosing, { kind: "closed" })).toEqual(idle);
  });

  it("ignores every event but cell-opened while idle", () => {
    expect(reduce(idle, { kind: "teach-opened", students: ["2517"] })).toEqual(idle);
    expect(reduce(idle, { kind: "teach-toggled", unitId: "2517" })).toEqual(idle);
    expect(reduce(idle, { kind: "cancelled" })).toEqual(idle);
    expect(reduce(idle, { kind: "closed" })).toEqual(idle);
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
