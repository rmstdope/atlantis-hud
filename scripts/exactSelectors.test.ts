import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EXEMPTION_MARKER, complain, looseSelectors, unexplainedSelectors } from "./exactSelectors";

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

describe("unexplainedSelectors", () => {
  it("passes over a loose selector whose reason is on the line above it", () => {
    const source = `// ${EXEMPTION_MARKER} the name legitimately varies\npage.getByRole("button", { name: "Men" })`;
    expect(unexplainedSelectors("a.spec.ts", source)).toEqual([]);
  });

  it("accepts a reason anywhere in the comment block above, not only the last line", () => {
    // A reason worth writing rarely fits on one line, and a formatter may reflow it.
    const source = [
      `// ${EXEMPTION_MARKER} a columnheader's name is built from everything inside it,`,
      "// so it can never be exactly this.",
      'page.getByRole("columnheader", { name: "Men" })'
    ].join("\n");
    expect(unexplainedSelectors("a.spec.ts", source)).toEqual([]);
  });

  it("does not let a reason carry across a blank line to a later selector", () => {
    const source = [`// ${EXEMPTION_MARKER} for the one below`, "", 'page.getByRole("button", { name: "Men" })'].join(
      "\n"
    );
    expect(unexplainedSelectors("a.spec.ts", source).map((s) => s.name)).toEqual(["Men"]);
  });

  it("still reports a loose selector with an ordinary comment above it", () => {
    const source = '// click the sort control\npage.getByRole("button", { name: "Men" })';
    expect(unexplainedSelectors("a.spec.ts", source).map((s) => s.name)).toEqual(["Men"]);
  });
});

describe("complain", () => {
  it("names the file, the line, the selector and both ways out", () => {
    const message = complain({ file: "tests/smoke/units.spec.ts", line: 214, name: "Men" });

    expect(message).toContain("tests/smoke/units.spec.ts:214");
    expect(message).toContain('{ name: "Men" }');
    expect(message).toContain("exact: true");
    expect(message).toContain(EXEMPTION_MARKER);
    // The person reading this is adding an unrelated feature and has never heard of the rule.
    expect(message).toContain("substring");
  });
});

/** Every `.ts` file under a directory, recursively. */
function testSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return testSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * The ratchet: a selector written after this bead is exact, or says in a comment why it is not.
 *
 * A count-based baseline was considered and rejected. A number says nothing about *which* selectors
 * are intentional, and it drifts upward one grudging increment at a time; a reason on the line above
 * costs one line, is greppable, and puts it where the next reader already is.
 */
describe("the browser suites' role-and-name selectors", () => {
  it("all match exactly, or carry a reason for not doing so", () => {
    // Anchored to this file rather than to the working directory: the guard is about the suite in
    // this repository, and a cwd-relative path would throw ENOENT - or quietly scan somebody else's
    // tree - the first time vitest is launched from anywhere but the root.
    const suite = join(dirname(fileURLToPath(import.meta.url)), "..", "tests");
    const offenders = testSources(suite).flatMap((file) =>
      // Named relative to the repository, because an absolute path in the failure message is one
      // more thing to read past before the reader reaches what is actually wrong.
      unexplainedSelectors(relative(join(suite, ".."), file), readFileSync(file, "utf8")).map(complain)
    );

    expect(offenders).toEqual([]);
  });
});
