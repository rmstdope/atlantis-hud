import { describe, expect, it } from "vitest";

import {
  bareWords,
  buildVocabulary,
  isKeyword,
  keywordCaseChanges,
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

  it("looks past trailing punctuation the player typed", () => {
    expect(keywordJustFinished("move n,", 7, vocabulary)).toEqual({ from: 5, to: 6, upper: "N" });
  });

  it("finds nothing when another word stands between the caret and the keyword", () => {
    expect(keywordJustFinished("move frobnicate", 15, vocabulary)).toBeNull();
  });

  it("finds nothing when the caret is mid-word", () => {
    expect(keywordJustFinished("move n", 2, vocabulary)).toBeNull();
  });
});

describe("keywordCaseChanges", () => {
  const vocabulary = buildVocabulary(["MOVE", "N", "STUDY", "COMBAT"]);

  it("returns a span per keyword that is not already upper case", () => {
    expect(keywordCaseChanges("move n\nstudy combat", vocabulary, null)).toEqual([
      { from: 0, to: 4, insert: "MOVE" },
      { from: 5, to: 6, insert: "N" },
      { from: 7, to: 12, insert: "STUDY" },
      { from: 13, to: 19, insert: "COMBAT" }
    ]);
  });

  it("returns nothing when the block is already upper case", () => {
    expect(keywordCaseChanges("MOVE N", vocabulary, null)).toEqual([]);
  });

  it("leaves the word the caret is inside alone", () => {
    expect(keywordCaseChanges("study combat\nmove", vocabulary, 17)).toEqual([
      { from: 0, to: 5, insert: "STUDY" },
      { from: 6, to: 12, insert: "COMBAT" }
    ]);
  });

  it("protects a caret at the head of a word", () => {
    expect(keywordCaseChanges("move n", vocabulary, 0)).toEqual([{ from: 5, to: 6, insert: "N" }]);
  });
});

describe("the selected world's comment boundary", () => {
  const vocabulary = buildVocabulary(["WORK", "GUARD", "MOVE"]);

  it("shouts a Trident keyword that a comment is attached to", () => {
    // Trident `rules/orders`: the semicolon ends the word, so `work` is the keyword.
    expect(uppercaseLine("work;paying the guard", vocabulary, "trident")).toBe(
      "WORK;paying the guard"
    );
    expect(bareWords("work;note", "trident").map((word) => word.text)).toEqual(["work"]);
  });

  it("leaves a New Origins word with a semicolon in the middle of it alone", () => {
    // New Origins `rules/orders`: a comment only starts where the semicolon is not in the middle
    // of a word - so `work;note` is one word, and not the keyword WORK.
    // No comment ever starts, so what follows is order text rather than prose - which is why
    // `guard` is still shouted and `work;paying` is not.
    expect(uppercaseLine("work;paying the guard", vocabulary, "origins")).toBe(
      "work;paying the GUARD"
    );
    expect(bareWords("work;note", "origins").map((word) => word.text)).toEqual([]);
    // One at the end of a word still comments, in both worlds.
    expect(uppercaseLine("work ;note", vocabulary, "origins")).toBe("WORK ;note");
  });

  it("stops at a semicolon that opens the line, in both worlds", () => {
    // The regression this pins: a comment line's prose is not order text, so nothing in it is a
    // keyword to shout at - and the `;***` region banner is a comment line too.
    for (const syntax of ["origins", "trident"] as const) {
      expect(bareWords(";Scout heading north, work later", syntax)).toEqual([]);
      expect(uppercaseLine(";Scout heading north, work later", vocabulary, syntax)).toBe(
        ";Scout heading north, work later"
      );
      expect(uppercaseLine(";*** plain (1,1) move ***", vocabulary, syntax)).toBe(
        ";*** plain (1,1) move ***"
      );
      // And one that opens a token mid-line, after a word that is already finished.
      expect(uppercaseLine("work ;and move later", vocabulary, syntax)).toBe(
        "WORK ;and move later"
      );
    }
  });

  it("comments after a closed quote, in both worlds", () => {
    // A semicolon following a finished quoted name is not in the middle of a word, so it starts a
    // comment under both rules - `NAME UNIT "Scouts";north` carries a comment, not an argument.
    for (const syntax of ["origins", "trident"] as const) {
      expect(uppercaseLine('NAME UNIT "Scouts";work later', vocabulary, syntax)).toBe(
        'NAME UNIT "Scouts";work later'
      );
    }
  });

  it("defaults to New Origins when no world is named", () => {
    expect(uppercaseLine("work;note", vocabulary)).toBe("work;note");
  });
});
