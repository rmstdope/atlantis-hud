import type { OrderDiagnostic } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { problemToFlash } from "./problemsFlash";

function finding(overrides: Partial<OrderDiagnostic>): OrderDiagnostic {
  return {
    code: "not-enough-silver",
    message: "the units in this hex are short $650 between them: they can have $0 and their orders spend $650",
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    regionId: "1:38,44",
    unitId: null,
    formed: null,
    severity: "warning",
    ...overrides
  };
}

const SHORT = "the units in this hex are short $650 between them: they can have $0 and their orders spend $650";

/**
 * Which line of the landing hex's Problems the `Show problems in <hex>` button flashes (`ah-zjcj`):
 * the hex's own silver shortfall carrying the clause ah-1uja adds for passengers studying there.
 */
describe("problemToFlash", () => {
  it.each([
    `${SHORT}, $50 of it on the STUDY of Drones (10594), arriving by sea`,
    `${SHORT}, $100 of it on the studies of Drones (10594) and Bees (10595), arriving by sea`,
    `${SHORT}, $200 of it on the studies of 4 units arriving by sea`
  ])("finds the silver shortfall naming the arriving STUDY: %s", (message) => {
    const problems = [
      finding({ code: "unit-does-nothing", unitId: "9579", message: "does nothing" }),
      finding({ message })
    ];
    expect(problemToFlash(problems)).toBe(1);
  });

  it("finds nothing when the hex's silver shortfall names no arriving STUDY", () => {
    expect(problemToFlash([finding({})])).toBeNull();
  });

  it("finds nothing in a hex with no problems", () => {
    expect(problemToFlash([])).toBeNull();
  });

  it("passes over a unit's own silver finding and an item shortfall", () => {
    const clause = ", $50 of it on the STUDY of Drones (10594), arriving by sea";
    expect(
      problemToFlash([
        finding({ unitId: "9579", message: `${SHORT}${clause}` }),
        finding({ code: "not-enough-items", message: `${SHORT}${clause}` })
      ])
    ).toBeNull();
  });
});
