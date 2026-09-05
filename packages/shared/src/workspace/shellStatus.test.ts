import { describe, expect, it } from "vitest";
import {
  countsStatus,
  failedStatus,
  formedBlockRepairStatus,
  noticeStatus,
  routineStatus,
  statusForLoadedTurn,
  warningStatus
} from "./shellStatus";

describe("status line constructors", () => {
  it("routineStatus builds a routine-toned status", () => {
    expect(routineStatus("x")).toEqual({ text: "x", tone: "routine" });
  });

  it("noticeStatus builds a notice-toned status", () => {
    expect(noticeStatus("x")).toEqual({ text: "x", tone: "notice" });
  });

  it("warningStatus builds a warning-toned status", () => {
    expect(warningStatus("x")).toEqual({ text: "x", tone: "warning" });
  });

  it("failedStatus builds a failure-toned status", () => {
    expect(failedStatus("x")).toEqual({ text: "x", tone: "failure" });
  });

  it("countsStatus builds the plural routine counts line", () => {
    expect(countsStatus(11, 42)).toEqual({ text: "11 regions · 42 units", tone: "routine" });
  });

  it("countsStatus singularises a count of exactly one", () => {
    expect(countsStatus(1, 1)).toEqual({ text: "1 region · 1 unit", tone: "routine" });
  });
});

describe("statusForLoadedTurn", () => {
  it("says so when the rules could not be loaded", () => {
    expect(statusForLoadedTurn(countsStatus(11, 42), "unavailable")).toEqual({
      text: "The rules could not be loaded — unit numbers are estimates.",
      tone: "warning"
    });
    // A wait that expired leaves the ruleset "loading", and the player is no better off for it.
    expect(statusForLoadedTurn(countsStatus(11, 42), "loading").tone).toBe("warning");
  });

  it("says nothing when the rules loaded", () => {
    expect(statusForLoadedTurn(countsStatus(11, 42), "ready")).toEqual(countsStatus(11, 42));
    expect(statusForLoadedTurn(warningStatus("a draft could not be read"), "ready")).toEqual(
      warningStatus("a draft could not be read")
    );
  });
});

describe("formedBlockRepairStatus", () => {
  const nothing = { document: "", moved: [], emptied: [], orphaned: [] };

  it("a repair that changed nothing says nothing", () => {
    expect(formedBlockRepairStatus(nothing)).toBeNull();
  });

  it("one orphan warns, naming the block", () => {
    expect(formedBlockRepairStatus({ ...nothing, orphaned: ["new-1"] })).toEqual({
      text: "unit new-1 has orders but nothing forms it — the server will refuse this block",
      tone: "warning"
    });
  });

  it("several orphans warn once, counting them", () => {
    expect(
      formedBlockRepairStatus({ ...nothing, orphaned: ["new-1", "new-2", "new-7"] })
    ).toEqual({
      text: "3 stale unit new-n blocks have orders but nothing forms them — the server will refuse them",
      tone: "warning"
    });
  });

  it("the orphan warning wins over a move", () => {
    expect(
      formedBlockRepairStatus({
        ...nothing,
        moved: [{ alias: "1", orderCount: 2 }],
        orphaned: ["new-7"]
      })?.tone
    ).toBe("warning");
  });

  it("one move names the alias, and pluralises the orders", () => {
    expect(formedBlockRepairStatus({ ...nothing, moved: [{ alias: "1", orderCount: 2 }] })).toEqual({
      text: "Moved 2 orders into FORM 1 for new 1",
      tone: "notice"
    });
    expect(formedBlockRepairStatus({ ...nothing, moved: [{ alias: "3", orderCount: 1 }] })?.text).toBe(
      "Moved 1 order into FORM 3 for new 3"
    );
  });

  it("several moves count the orders and the blocks", () => {
    expect(
      formedBlockRepairStatus({
        ...nothing,
        moved: [
          { alias: "1", orderCount: 2 },
          { alias: "2", orderCount: 3 }
        ]
      })
    ).toEqual({ text: "Moved 5 orders into 2 FORM blocks", tone: "notice" });
  });

  it("removals alone say so, pluralised", () => {
    expect(formedBlockRepairStatus({ ...nothing, emptied: ["new-1"] })).toEqual({
      text: "Removed 1 empty unit new-n block",
      tone: "notice"
    });
    expect(formedBlockRepairStatus({ ...nothing, emptied: ["new-1", "new-2", "new-3"] })?.text).toBe(
      "Removed 3 empty unit new-n blocks"
    );
  });
});
