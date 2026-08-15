import { describe, expect, it } from "vitest";
import { failedStatus, warningStatus } from "./shellStatus";

describe("failedStatus", () => {
  it("builds a red, zero-count status with the given message", () => {
    expect(failedStatus("x")).toEqual({
      regionCount: 0,
      unitCount: 0,
      message: "x",
      failed: true,
      warning: false
    });
  });
});

describe("warningStatus", () => {
  it("builds an amber, zero-count status with the given message", () => {
    expect(warningStatus("x")).toEqual({
      regionCount: 0,
      unitCount: 0,
      message: "x",
      failed: false,
      warning: true
    });
  });
});
