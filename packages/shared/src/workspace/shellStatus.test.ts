import { describe, expect, it } from "vitest";
import { countsStatus, failedStatus, noticeStatus, routineStatus, warningStatus } from "./shellStatus";

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
