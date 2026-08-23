import { describe, expect, it } from "vitest";
import {
  countsStatus,
  failedStatus,
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
