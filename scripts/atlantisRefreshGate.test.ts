import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { declaredPermissions, hasSchedule, hasWorkflowDispatch, REFRESH_WORKFLOW } from "./atlantisRefreshGate";

const yaml = readFileSync(fileURLToPath(new URL(`../${REFRESH_WORKFLOW}`, import.meta.url)), "utf8");

describe("atlantis-rules-refresh.yml", () => {
  it("is still scheduled", () => {
    expect(hasSchedule(yaml)).toBe(true);
  });

  it("can still be run by hand", () => {
    expect(hasWorkflowDispatch(yaml)).toBe(true);
  });

  it("grants exactly the three permissions it needs, no more", () => {
    expect(declaredPermissions(yaml)).toEqual({
      contents: "write",
      "pull-requests": "write",
      issues: "write"
    });
  });
});
