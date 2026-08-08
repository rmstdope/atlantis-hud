import { describe, expect, it } from "vitest";
import type { OrderValidationResult } from "@atlantis/core-client";
import {
  canExportOrders,
  ORDER_COMMAND_VOCABULARY,
  shouldSaveOnBlur,
  shouldTriggerAutosave,
  suggestOrderCommands,
  summarizeOrderValidation
} from "./orderEditor";

describe("orderEditor policy", () => {
  it("suggests known commands by prefix", () => {
    expect(ORDER_COMMAND_VOCABULARY).toContain("MOVE");
    expect(ORDER_COMMAND_VOCABULARY).toContain("STUDY");
    expect(ORDER_COMMAND_VOCABULARY).toContain("SAIL");
    expect(suggestOrderCommands("MO")).toEqual(["MOVE"]);
    expect(suggestOrderCommands("HO")).toEqual(["HOLD"]);
  });

  it("summarizes validation and blocks export when errors are present", () => {
    const result: OrderValidationResult = {
      diagnostics: [
        {
          code: "unknown-command",
          message: "unknown order command",
          lineStart: 1,
          lineEnd: 1,
          severity: "error"
        },
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 2,
          lineEnd: 2,
          severity: "warning"
        }
      ]
    };

    expect(summarizeOrderValidation(result)).toEqual({
      errorCount: 1,
      warningCount: 1,
      blocking: true,
      diagnostics: result.diagnostics
    });
    expect(canExportOrders(result)).toBe(false);
  });

  it("allows export for warnings only and triggers autosave after the interval", () => {
    const result: OrderValidationResult = {
      diagnostics: [
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 1,
          lineEnd: 1,
          severity: "warning"
        }
      ]
    };

    expect(canExportOrders(result)).toBe(true);
    expect(shouldTriggerAutosave(1_000, 5_999)).toBe(false);
    expect(shouldTriggerAutosave(1_000, 6_000)).toBe(true);
    expect(shouldSaveOnBlur(true)).toBe(true);
    expect(shouldSaveOnBlur(false)).toBe(false);
  });
});
