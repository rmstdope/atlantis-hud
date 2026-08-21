import { describe, expect, it } from "vitest";
import { buildVocabulary, type CaseChange } from "./orderCase";
import {
  indentBlock,
  indentChanges,
  lineDepths,
  contentChanges,
  tidyInsertion,
  trailingNewlineChange,
  withSingleTrailingNewline
} from "./orderIndent";

describe("lineDepths", () => {
  const cases: ReadonlyArray<readonly [string, string, number[]]> = [
    ["flat orders", "WORK\nSTUDY COMBAT", [0, 0]],
    ["a TURN block", "TURN\nWORK\nENDTURN", [0, 1, 0]],
    [
      "nesting, with each closer outside its own block",
      "TURN\nFORM 1\nWORK\nEND\nMOVE N\nENDTURN\nWORK",
      [0, 1, 2, 1, 1, 0, 0]
    ],
    ["case and a leading @", "@turn\nWORK\nEndturn", [0, 1, 0]],
    ["a block that is never closed", "FORM 1\nWORK", [0, 1]],
    ["a stray closer of the wrong kind", "FORM 1\nWORK\nENDTURN\nMOVE N", [0, 1, 1, 1]],
    ["a stray closer with nothing open", "WORK\nEND\nSTUDY COMBAT", [0, 0, 0]],
    ["a unit line abandons everything open", "TURN\nunit 42\nWORK", [0, 0, 0]],
    ["a directive abandons everything open", "TURN\n#end\nWORK", [0, 0, 0]],
    ["comments and blank lines sit at the running depth", "TURN\n; a note\n\nWORK\nENDTURN", [0, 1, 1, 1, 0]],
    ["quoted text is not grammar", 'TURN\nNAME UNIT "END of the line"\nENDTURN', [0, 1, 0]],
    ["text after a semicolon is not grammar", "TURN\nWORK ; END\nENDTURN", [0, 1, 0]]
  ];

  for (const [name, text, depths] of cases) {
    it(name, () => {
      expect(lineDepths(text)).toEqual(depths);
    });
  }
});

describe("indentChanges and indentBlock", () => {
  it("indents each level of a nested block by one space", () => {
    expect(
      indentBlock('TURN\nNAME UNIT "Scout"\nFORM 1\nNAME UNIT "New"\nSTUDY COMBAT\nEND\nMOVE N\nENDTURN\nWORK')
    ).toBe(
      'TURN\n NAME UNIT "Scout"\n FORM 1\n  NAME UNIT "New"\n  STUDY COMBAT\n END\n MOVE N\nENDTURN\nWORK'
    );
  });

  it("replaces whatever leading whitespace was there", () => {
    expect(indentBlock("TURN\n    WORK\n\tMOVE N\nENDTURN")).toBe("TURN\n WORK\n MOVE N\nENDTURN");
  });

  it("has nothing to do for an already-correct block", () => {
    const text = "TURN\n WORK\nENDTURN";
    expect(indentChanges(text)).toEqual([]);
    expect(indentBlock(text)).toBe(text);
  });

  it("leaves a blank line truly empty", () => {
    expect(indentBlock("TURN\nWORK\n\nMOVE N\nENDTURN")).toBe("TURN\n WORK\n\n MOVE N\nENDTURN");
  });

  it("indents a comment line like any other", () => {
    expect(indentBlock("TURN\n; note\n@; sent\nWORK\nENDTURN")).toBe(
      "TURN\n ; note\n @; sent\n WORK\nENDTURN"
    );
  });

  it("indents everything below an unclosed FORM by the running depth", () => {
    expect(indentBlock("TURN\nFORM 1\nWORK\nMOVE N")).toBe("TURN\n FORM 1\n  WORK\n  MOVE N");
  });
});

describe("withSingleTrailingNewline and trailingNewlineChange", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["", ""],
    ["WORK", "WORK\n"],
    ["WORK\n", "WORK\n"],
    ["WORK\n\n\n", "WORK\n"],
    ["WORK\n   \n\t\n", "WORK\n"],
    ["\n\n", ""]
  ];

  for (const [input, output] of cases) {
    it(`${JSON.stringify(input)} ends as ${JSON.stringify(output)}`, () => {
      expect(withSingleTrailingNewline(input)).toBe(output);
    });
  }

  it("has no edit to make when the text already ends in exactly one newline", () => {
    expect(trailingNewlineChange("WORK\n")).toBeNull();
    expect(trailingNewlineChange("")).toBeNull();
  });

  it("describes the fix as one splice over the trailing blank run", () => {
    expect(trailingNewlineChange("WORK\n\n\n")).toEqual({ from: 4, to: 7, insert: "\n" });
  });
});

describe("contentChanges", () => {
  const vocabulary = buildVocabulary(["turn", "endturn", "form", "work", "move"]);

  it("merges case and indent edits into one ordered, non-overlapping list", () => {
    const text = "turn\nwork";
    const changes = contentChanges(text, vocabulary, null);

    expect(changes.length).toBe(3);
    for (let i = 1; i < changes.length; i += 1) {
      const previous = changes[i - 1] as CaseChange;
      const current = changes[i] as CaseChange;
      expect(current.from).toBeGreaterThanOrEqual(previous.to);
    }

    let result = text;
    for (let i = changes.length - 1; i >= 0; i -= 1) {
      const change = changes[i] as CaseChange;
      result = result.slice(0, change.from) + change.insert + result.slice(change.to);
    }
    expect(result).toBe("TURN\n WORK");
  });

  it("leaves the word the caret is inside as typed", () => {
    expect(contentChanges("turn\nwork", vocabulary, 9).some((change) => change.insert === "WORK")).toBe(
      false
    );
  });
});

describe("tidyInsertion", () => {
  const vocabulary = buildVocabulary(["form", "end", "study", "combat", "work", "move", "n"]);

  it("indents every line after the first, relative to where the caret already is", () => {
    expect(tidyInsertion("work\nmove n", 1, vocabulary)).toBe("WORK\n MOVE N");
  });

  it("re-indents a pasted block by its own structure", () => {
    expect(tidyInsertion("form 1\nstudy combat\nend", 0, vocabulary)).toBe(
      "FORM 1\n STUDY COMBAT\nEND"
    );
  });

  it("leaves a single-line paste alone but for its keywords", () => {
    expect(tidyInsertion("  study combat", 2, vocabulary)).toBe("  STUDY COMBAT");
  });

  it("leaves a blank line inside a paste truly empty", () => {
    expect(tidyInsertion("form 1\n\nend", 1, vocabulary)).toBe("FORM 1\n\n END");
  });
});
