import type { OrderDiagnostic } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { diagnosticTargets } from "./diagnosticNav";
import { formBlockTags, formTagHover, formTagLabel, type FormBlockTag } from "./formBlockTags";

/**
 * The tag a FORM line carries in the editor that wrote it (`ah-j10j`): what is wrong inside the
 * block, which is underlined and counted only in the formed unit's own editor (`ah-ty3s.1`, F1).
 */

function finding(lineStart: number, overrides: Partial<OrderDiagnostic> = {}): OrderDiagnostic {
  return {
    code: "parse",
    message: `problem on ${lineStart}`,
    lineStart,
    lineEnd: lineStart,
    columnStart: 0,
    columnEnd: 4,
    regionId: null,
    unitId: null,
    formed: null,
    severity: "warning",
    ...overrides
  };
}

const REGION = "1:36,4";

function tagsFor(
  text: string,
  unitId: string,
  diagnostics: OrderDiagnostic[],
  regions: Map<string, Set<string>> = new Map([[REGION, new Set(["13303"])]]),
  hex: string = REGION
): FormBlockTag[] {
  const targets = diagnosticTargets(text, diagnostics, regions, "origins");
  return formBlockTags(text, unitId, regions.get(hex), targets, "origins");
}

/**
 *   1 `unit 13303`  2 `share 0`  3 `form 1`  4 `buy 1 lead`  5 `buy 5 orc`  6 `end`  7 `give new 1 100 silv`
 */
const GUARDS = "unit 13303\nshare 0\nform 1\nbuy 1 lead\nbuy 5 orc\nend\ngive new 1 100 silv";

describe("formBlockTags", () => {
  it("a warning inside a FORM block tags its FORM line in the creator's editor", () => {
    const diagnostics = [finding(4, { unitId: "new-1", regionId: REGION })];
    const targets = diagnosticTargets(GUARDS, diagnostics, new Map([[REGION, new Set(["13303"])]]), "origins");
    const tags = formBlockTags(GUARDS, "13303", new Set(["13303"]), targets, "origins");

    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ alias: "1", line: 2, errorCount: 0, warningCount: 1 });
    // The walk's own stop objects, so a click can land on exactly the stop F8 would.
    expect(tags[0].stops).toEqual([targets[0]]);
    expect(tags[0].stops[0].problem.lineStart).toBe(1);
  });

  it("a block with nothing wrong inside has no tag", () => {
    expect(tagsFor(GUARDS, "13303", [])).toEqual([]);
  });

  it("errors and warnings are counted apart", () => {
    const tags = tagsFor(GUARDS, "13303", [
      finding(4),
      finding(5, { severity: "error" }),
      finding(5, { columnStart: 4, columnEnd: 5 })
    ]);
    expect(tags.map((tag) => [tag.errorCount, tag.warningCount])).toEqual([[1, 2]]);
  });

  it("a finding on the FORM line itself is the creator's and not in the tag", () => {
    expect(tagsFor(GUARDS, "13303", [finding(3)])).toEqual([]);
  });

  it("a finding about the formed unit as a whole is in the tag, and names no line", () => {
    // The core hangs a finding about a whole block on its FORM line (`finding_at_block`), naming
    // the formed unit; its own editor lists it with no line (`ah-6c76`), and so does the hover.
    const tags = tagsFor(GUARDS, "13303", [
      finding(3, { unitId: "new-1", regionId: REGION, message: "has no order that spends the month" })
    ]);
    expect(tags.map((tag) => tag.warningCount)).toEqual([1]);
    expect(formTagHover(tags[0]).rows).toEqual(["has no order that spends the month"]);
  });

  it("each FORM block gets its own tag", () => {
    //   1 unit 13303  2 form 1  3 WROK  4 end  5 form 2  6 STUFY  7 STUFY  8 end
    const text = "unit 13303\nform 1\nWROK\nend\nform 2\nSTUFY\nSTUFY\nend";
    const tags = tagsFor(text, "13303", [finding(3), finding(6), finding(7, { severity: "error" })]);
    expect(tags.map((tag) => [tag.alias, tag.line, tag.errorCount, tag.warningCount])).toEqual([
      ["1", 1, 0, 1],
      ["2", 4, 1, 1]
    ]);
  });

  it("a FORM nested in a formed unit tags the formed unit's editor and not the reported unit's", () => {
    //   1 unit 13303  2 form 1  3 buy 1 lead  4 form 2  5 WROK  6 end  7 end
    const text = "unit 13303\nform 1\nbuy 1 lead\nform 2\nWROK\nend\nend";
    expect(tagsFor(text, "13303", [finding(5)])).toEqual([]);
    const inner = tagsFor(text, "new-1", [finding(5)]);
    expect(inner.map((tag) => [tag.alias, tag.line, tag.warningCount])).toEqual([["2", 2, 1]]);
  });

  it("a new 1 formed in another hex is not counted", () => {
    //   1 unit 13303  2 form 1  3 WROK  4 end  5 unit 3000  6 form 1  7 STUFY  8 end
    const text = "unit 13303\nform 1\nWROK\nend\nunit 3000\nform 1\nSTUFY\nend";
    const regions = new Map([
      [REGION, new Set(["13303"])],
      ["1:8,54", new Set(["3000"])]
    ]);
    expect(tagsFor(text, "13303", [finding(7)], regions)).toEqual([]);
    expect(tagsFor(text, "3000", [finding(7)], regions, "1:8,54").map((tag) => tag.line)).toEqual([1]);
  });

  it("knows no tags without the hex's units, since a NEW alias means nothing without them", () => {
    const targets = diagnosticTargets(GUARDS, [finding(4)], new Map([[REGION, new Set(["13303"])]]), "origins");
    expect(formBlockTags(GUARDS, "13303", undefined, targets, "origins")).toEqual([]);
  });
});

function tag(errorCount: number, warningCount: number, messages: string[] = []): FormBlockTag {
  return {
    alias: "1",
    line: 3,
    errorCount,
    warningCount,
    stops: messages.map((message, index) => ({
      unitId: "new-1",
      regionId: REGION,
      blockFirstLine: 3,
      aboveBlock: false,
      problem: finding(index + 1, { message })
    }))
  };
}

describe("formTagLabel", () => {
  it("names the formed unit first and follows the count's number", () => {
    expect(formTagLabel(tag(0, 1))).toBe("new 1: 1 warning");
    expect(formTagLabel(tag(0, 3))).toBe("new 1: 3 warnings");
  });

  it("lists errors first, and leaves the warning part out when there are none", () => {
    expect(formTagLabel(tag(1, 2))).toBe("new 1: 1 error, 2 warnings");
    expect(formTagLabel(tag(2, 0))).toBe("new 1: 2 errors");
  });
});

describe("formTagHover", () => {
  it("lists each problem by its line in the formed unit's own orders", () => {
    const shortfall =
      "This hex is short of silver between its units, so this order buys none of the 1 leader. See Problems for the hex.";
    expect(formTagHover(tag(0, 1, [shortfall]))).toEqual({
      heading: "new 1",
      rows: [`line 1 · ${shortfall}`],
      footer: "Click to open new 1's orders"
    });
  });

  it("shows three rows and counts the rest beside the click hint", () => {
    const hover = formTagHover(tag(0, 5, ["a", "b", "c", "d", "e"]));
    expect(hover.rows).toEqual(["line 1 · a", "line 2 · b", "line 3 · c"]);
    expect(hover.footer).toBe("and 2 more · Click to open new 1's orders");
  });
});
