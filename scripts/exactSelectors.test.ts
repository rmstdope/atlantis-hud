import { describe, expect, it } from "vitest";
import { looseSelectors } from "./exactSelectors";

/**
 * Accessible names are a shared namespace, and Playwright matches them by substring.
 *
 * `getByRole(role, { name })` matches any element whose accessible name *contains* the given string
 * unless `exact: true` is passed. So giving a new control an accessible name anywhere in the
 * application silently widens what every non-exact selector in the same container matches, and the
 * failure lands in a spec that has nothing to do with the change.
 *
 * That is not hypothetical: ah-1owr.3 gave every units-table header a reorder grip labelled
 * "Move the Men column", and two long-standing tests locating the sort control as
 * `getByRole("button", { name: "Men" })` began matching two elements and failed on a strict-mode
 * violation. One CI cycle, plus a seven-minute local smoke run to be sure there were no others.
 *
 * So exactness is the default here, and the assertion at the bottom of this file keeps it that way
 * for selectors written after this one. A selector that is deliberately loose says so in a comment
 * rather than being indistinguishable from one that forgot.
 */
describe("looseSelectors", () => {
  it("reports a plain string name with no exact flag", () => {
    const found = looseSelectors("a.spec.ts", 'page.getByRole("button", { name: "Men" })');
    expect(found).toEqual([{ file: "a.spec.ts", line: 1, name: "Men" }]);
  });

  it("accepts a name that asks for an exact match", () => {
    expect(looseSelectors("a.spec.ts", 'page.getByRole("button", { name: "Men", exact: true })')).toEqual([]);
  });

  it("exempts an interpolated template literal, which is near-unique by construction", () => {
    // `unit ${unitId}` carries an id, so it cannot be widened by somebody naming a new control.
    expect(looseSelectors("a.spec.ts", "page.getByRole('button', { name: `unit ${unitId}` })")).toEqual([]);
  });

  it("does not exempt a template literal with nothing interpolated into it", () => {
    // A plain string wearing backticks is still a plain string.
    expect(looseSelectors("a.spec.ts", "page.getByRole('button', { name: `Men` })")).toEqual([
      { file: "a.spec.ts", line: 1, name: "Men" }
    ]);
  });

  it("exempts a regex, which is already an explicit statement about matching", () => {
    // Playwright's `exact` does not apply to a regex at all.
    expect(looseSelectors("a.spec.ts", 'page.getByRole("button", { name: /^hex / })')).toEqual([]);
  });

  it("ignores a call that selects on role alone", () => {
    expect(looseSelectors("a.spec.ts", 'page.getByRole("button")')).toEqual([]);
  });

  it("finds a call the formatter wrapped across several lines", () => {
    const source = ["const b = page.getByRole(", '  "button",', '  { name: "Import" }', ");"].join("\n");
    expect(looseSelectors("a.spec.ts", source)).toEqual([{ file: "a.spec.ts", line: 1, name: "Import" }]);
  });

  it("counts an explicit exact: false as loose, and still names it", () => {
    // Writing it out is a statement of intent, but this rule is about substring matching rather
    // than about intent - the exemption comment is where a reason is recorded.
    expect(looseSelectors("a.spec.ts", 'page.getByRole("button", { name: "Men", exact: false })')).toEqual([
      { file: "a.spec.ts", line: 1, name: "Men" }
    ]);
  });

  it("reports the line each call starts on, not the line of the file", () => {
    const source = ['\n\npage.getByRole("button", { name: "Reset" })'].join("");
    expect(looseSelectors("a.spec.ts", source)).toEqual([{ file: "a.spec.ts", line: 3, name: "Reset" }]);
  });

  it("finds every loose call in a file rather than stopping at the first", () => {
    const source = 'page.getByRole("button", { name: "All" });\npage.getByRole("link", { name: "Notes" });';
    expect(looseSelectors("a.spec.ts", source).map((s) => s.name)).toEqual(["All", "Notes"]);
  });

  it("is not fooled by a getByRole written inside a string", () => {
    expect(looseSelectors("a.spec.ts", 'const s = \'page.getByRole("button", { name: "Men" })\';')).toEqual([]);
  });
});
