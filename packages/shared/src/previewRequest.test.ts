import { describe, expect, it } from "vitest";
import { previewOrdersRequest } from "./previewRequest";
import { DEFAULT_ADVISORY_CHECKS, disabledAdvisoryCodes } from "./settingsStore";

describe("previewOrdersRequest", () => {
  it("builds the preview request the HUD sends", () => {
    const advisoryChecks = { ...DEFAULT_ADVISORY_CHECKS };

    expect(
      previewOrdersRequest({
        rulesetText: "{}",
        rawReport: "report",
        rememberedJson: "[]",
        ordersDocument: "#atlantis 3",
        mapJson: "map",
        passagesJson: "passages",
        advisoryChecks
      })
    ).toEqual({
      rulesetJson: "{}",
      rawReport: "report",
      rememberedJson: "[]",
      ordersDocument: "#atlantis 3",
      mapJson: "map",
      passagesJson: "passages",
      disabledCodes: disabledAdvisoryCodes(advisoryChecks)
    });
  });
});
