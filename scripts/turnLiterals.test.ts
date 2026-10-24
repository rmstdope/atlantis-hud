import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { turnLiterals, turnLiteralsIn } from "./turnLiterals";

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = join(HERE, "..", "tests");

/**
 * The walks about turn numbering itself, which say the numbers out loud on purpose: a renumbering
 * is meant to edit these.
 */
const TURN_LABEL_WALKS = ["engine-turns.spec.ts"];

describe("a turn literal", () => {
  it("is found in an assertion, a test id and a header pattern", () => {
    const text = [
      'await expect(status).toContainText("restored turn 72");',
      'await page.getByTestId("turn-row-71").click();',
      "await expect(header).toContainText(/Turn\\s*72\\b/);",
      "  turn_number: 72,",
      "  rows[0].turn_number === 72",
      'await expect(page.getByTestId("app-header")).toContainText("72");',
      'await expect(header).toContainText("⇄ 71");',
      'expect(name).toBe("map-turn-72-level-1.txt");',
      'expect(download.suggestedFilename()).toMatch(/^mages-.+-turn-72\\.txt$/u);',
      '  { defaultPath: "orders-turn-72.txt", filters: [] }',
      '  ["write", "/fake/orders-turn-72.txt", expect.any(Number)]',
      "const cell = page.getByTestId(`study-schedule-cell-${MAGE}-73`);",
      'await page.getByTestId("study-schedule-remove-74").click();',
      'await expect($(\'[data-testid="app-header"]\')).toHaveText(expect.stringContaining("72"));'
    ].join("\n");

    expect(turnLiterals("a.spec.ts", text).map((found) => found.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("is not found in a comment, a file name or an interpolated turn", () => {
    const text = [
      "// the turn 71 fixture",
      " * turn 71 again",
      "  /*",
      "    turn 71, in a block comment with no leading stars",
      "  */",
      'await importReport(page, "turn-71.rep", report);',
      'await choose(page, "orders-turn-71.txt", ORDERS);',
      "await expect(status).toContainText(`restored turn ${STANDARD_TURN}`);",
      "await page.getByTestId(`study-schedule-cell-12878-${STANDARD_TURN + 1}`).hover();"
    ].join("\n");

    expect(turnLiterals("a.spec.ts", text)).toEqual([]);
  });

  it("is let through when marked, on its line or the line above", () => {
    const text = [
      'await expect(prompt).toContainText("exported on turn 16"); // turn-literal: the export\'s stamp',
      "// turn-literal: the mocked server's id",
      'await expect(status).toContainText("turn 73");'
    ].join("\n");

    expect(turnLiterals("a.spec.ts", text)).toEqual([]);
  });
});

describe("the smoke and native walks", () => {
  it("take every HUD turn from the fixtures, outside the walks about turn labels", () => {
    expect(turnLiteralsIn(join(TESTS, "smoke"), TURN_LABEL_WALKS)).toEqual([]);
    expect(turnLiteralsIn(join(TESTS, "native"), [])).toEqual([]);
  });
});
