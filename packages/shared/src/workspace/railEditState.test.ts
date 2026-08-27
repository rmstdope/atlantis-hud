import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { canCommit, keyToAction, reduce, type RailMode } from "./railEditState";

const idle: RailMode = { kind: "idle" };

describe("naming a new Army", () => {
  it("a new Army started from the rail carries no unit", () => {
    expect(reduce(idle, { type: "new-clicked", withUnit: null })).toEqual({
      kind: "creating",
      draft: "",
      withUnit: null
    });
  });

  it("a new Army started from the popover remembers the unit that started it", () => {
    const unit = aReportUnit({ unitId: "9977", name: "Outriders" });

    const mode = reduce(idle, { type: "new-clicked", withUnit: unit });

    expect(mode).toEqual({ kind: "creating", draft: "", withUnit: unit });
  });

  it("typing keeps the unit that started it", () => {
    const unit = aReportUnit({ unitId: "9977" });
    const creating = reduce(idle, { type: "new-clicked", withUnit: unit });

    expect(reduce(creating, { type: "draft-changed", draft: "North" })).toEqual({
      kind: "creating",
      draft: "North",
      withUnit: unit
    });
  });

  it("committing and cancelling both leave the rail idle", () => {
    const creating = reduce(idle, { type: "new-clicked", withUnit: null });

    expect(reduce(creating, { type: "committed" })).toEqual(idle);
    expect(reduce(creating, { type: "cancelled" })).toEqual(idle);
  });
});

describe("renaming", () => {
  it("a rename starts from the name it is changing", () => {
    expect(reduce(idle, { type: "rename-clicked", armyId: "a", name: "Northern Host" })).toEqual({
      kind: "renaming",
      armyId: "a",
      draft: "Northern Host"
    });
  });

  it("typing into a rename keeps the Army it is renaming", () => {
    const renaming = reduce(idle, { type: "rename-clicked", armyId: "a", name: "Old" });

    expect(reduce(renaming, { type: "draft-changed", draft: "New" })).toEqual({
      kind: "renaming",
      armyId: "a",
      draft: "New"
    });
  });

  it("cancelling a rename leaves the mode idle and changes no name", () => {
    const renaming = reduce(idle, { type: "rename-clicked", armyId: "a", name: "Northern Host" });
    const typed = reduce(renaming, { type: "draft-changed", draft: "Something else" });

    // The reducer holds a draft and nothing else, so abandoning it is the whole of reverting.
    expect(reduce(typed, { type: "cancelled" })).toEqual(idle);
  });

  it("a draft typed while idle changes nothing", () => {
    expect(reduce(idle, { type: "draft-changed", draft: "stray" })).toEqual(idle);
  });
});

describe("deleting", () => {
  it("asks first, and both answers end in idle", () => {
    const deleting = reduce(idle, { type: "delete-clicked", armyId: "a" });

    expect(deleting).toEqual({ kind: "deleting", armyId: "a" });
    expect(reduce(deleting, { type: "delete-cancelled" })).toEqual(idle);
    expect(reduce(deleting, { type: "deleted" })).toEqual(idle);
  });
});

describe("what a name has to be, and what the keyboard means", () => {
  it("canCommit refuses a name that is only spaces", () => {
    expect(canCommit("")).toBe(false);
    expect(canCommit("   ")).toBe(false);
    expect(canCommit("\t \n")).toBe(false);
    expect(canCommit("Northern Host")).toBe(true);
    // Duplicates are allowed: the application never identifies an Army by its name.
    expect(canCommit(" x ")).toBe(true);
  });

  it("Enter commits and Escape cancels", () => {
    expect(keyToAction({ key: "Enter" })).toBe("commit");
    expect(keyToAction({ key: "Escape" })).toBe("cancel");
    expect(keyToAction({ key: "a" })).toBeNull();
    expect(keyToAction({ key: "Tab" })).toBeNull();
  });
});
