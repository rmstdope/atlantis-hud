import { describe, expect, it } from "vitest";

import {
  bareWords,
  buildVocabulary,
  isKeyword,
  keywordJustFinished,
  uppercaseKeywords,
  uppercaseLine,
} from "./orderCase";

const vocabulary = buildVocabulary([
  "MOVE",
  "N",
  "NW",
  "NAME",
  "UNIT",
  "STUDY",
  "COMBAT",
  "GIVE",
  "ALL",
  "SILV",
  "LONGBOW",
]);

const texts = (line: string): string[] => bareWords(line).map((word) => word.text);

describe("bareWords", () => {
  it("finds the words of a plain order line", () => {
    expect(texts("move n nw")).toEqual(["move", "n", "nw"]);
  });

  it("never looks inside a quoted name", () => {
    expect(texts('name unit "seven of eight"')).toEqual(["name", "unit"]);
  });

  it("stops at a comment", () => {
    expect(texts("study combat ; cheaper here")).toEqual(["study", "combat"]);
  });

  it("treats an unterminated quote as swallowing the rest of the line", () => {
    expect(texts('name unit "seven of')).toEqual(["name", "unit"]);
  });

  it("ignores a token that is not all letters", () => {
    expect(texts("give 2042 all silv")).toEqual(["give", "all", "silv"]);
  });

  it("looks past a repeat prefix", () => {
    expect(texts("@move n")).toEqual(["move", "n"]);
  });

  it("reports the span of each word", () => {
    expect(bareWords("move n")).toEqual([
      { from: 0, to: 4, text: "move" },
      { from: 5, to: 6, text: "n" },
    ]);
  });

  it("looks past trailing punctuation", () => {
    expect(texts("give all silv,")).toEqual(["give", "all", "silv"]);
  });
});

describe("isKeyword", () => {
  it("matches a word the rules know", () => {
    expect(isKeyword("move", vocabulary)).toBe(true);
  });

  it("matches a plural by stripping a trailing s", () => {
    expect(isKeyword("longbows", vocabulary)).toBe(true);
  });

  it("does not match a word the rules do not know", () => {
    expect(isKeyword("frobnicate", vocabulary)).toBe(false);
  });
});

describe("uppercaseLine", () => {
  it("uppercases the keywords and leaves the names alone", () => {
    expect(uppercaseLine('name unit "seven of eight"', vocabulary)).toBe(
      'NAME UNIT "seven of eight"'
    );
  });

  it("uppercases a plural item", () => {
    expect(uppercaseLine("give 2 longbows", buildVocabulary(["GIVE", "LONGBOW"]))).toBe(
      "GIVE 2 LONGBOWS"
    );
  });

  it("leaves a word the rules do not know", () => {
    expect(uppercaseLine("move frobnicate", vocabulary)).toBe("MOVE frobnicate");
  });

  it("returns the line unchanged when nothing matches", () => {
    expect(uppercaseLine("; just a comment", vocabulary)).toBe("; just a comment");
  });
});

describe("uppercaseKeywords", () => {
  it("uppercases every line of a block", () => {
    expect(uppercaseKeywords("move n\nstudy combat", vocabulary)).toBe("MOVE N\nSTUDY COMBAT");
  });

  it("returns the text unchanged when nothing matches", () => {
    expect(uppercaseKeywords("; nothing\n; here", vocabulary)).toBe("; nothing\n; here");
  });
});

describe("keywordJustFinished", () => {
  it("finds the word just finished", () => {
    expect(keywordJustFinished("move", 4, vocabulary)).toEqual({ from: 0, to: 4, upper: "MOVE" });
  });

  it("finds nothing inside a quote", () => {
    expect(keywordJustFinished('name "move', 10, vocabulary)).toBeNull();
  });

  it("finds nothing in a comment", () => {
    expect(keywordJustFinished("; move", 6, vocabulary)).toBeNull();
  });

  it("finds nothing when the word is not a keyword", () => {
    expect(keywordJustFinished("frobnicate", 10, vocabulary)).toBeNull();
  });

  it("finds nothing when the caret is mid-word", () => {
    expect(keywordJustFinished("move n", 2, vocabulary)).toBeNull();
  });
});
