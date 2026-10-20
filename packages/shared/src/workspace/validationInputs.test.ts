import { describe, expect, it } from "vitest";
import { validationMarker, type ValidationInputs } from "./validationInputs";
import { DEFAULT_ADVISORY_CHECKS } from "../settingsStore";

const inputs: ValidationInputs = {
  ordersDocument: "UNIT 1\nTAX",
  rulesetText: "{}",
  rawReport: "report",
  advisoryChecks: DEFAULT_ADVISORY_CHECKS,
  mapJson: "{\"map\":1}",
  passagesJson: "[]",
  rememberedJson: "{}"
};

describe("validationMarker (ah-119b)", () => {
  it("is pending before any answer has landed", () => {
    expect(validationMarker(null, inputs)).toBe("pending");
  });

  it("is current when the answer was for exactly these inputs", () => {
    expect(validationMarker({ ...inputs }, inputs)).toBe("current");
  });

  const changes: { readonly [K in keyof ValidationInputs]: ValidationInputs[K] } = {
    ordersDocument: "UNIT 1\nWORK",
    rulesetText: null,
    rawReport: "another report",
    advisoryChecks: { ...DEFAULT_ADVISORY_CHECKS },
    mapJson: "{\"map\":2}",
    passagesJson: "[1]",
    rememberedJson: "{\"a\":1}"
  };
  for (const field of Object.keys(changes) as (keyof ValidationInputs)[]) {
    it(`is pending when only ${field} has moved since the answer`, () => {
      expect(validationMarker(inputs, { ...inputs, [field]: changes[field] })).toBe("pending");
    });
  }
});
