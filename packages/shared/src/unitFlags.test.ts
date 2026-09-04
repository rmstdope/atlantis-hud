import { describe, expect, it } from "vitest";

import { flagLetters, flagWords } from "./unitFlags";

describe("flagLetters", () => {
  it("draws one letter per flag, in the fixed order, whatever order the report printed them", () => {
    expect(flagLetters(["sharing", "behind", "avoiding", "revealing faction", "holding"])).toBe(
      "ABHRS"
    );
  });

  it("gives battle spoils no letter, whichever setting is in force", () => {
    for (const spoils of [
      "sailing battle spoils",
      "swimming battle spoils",
      "walking battle spoils",
      "riding battle spoils",
      "flying battle spoils",
      "weightless battle spoils",
      "no battle spoils"
    ]) {
      expect(flagLetters([spoils])).toBe("");
    }
  });

  it("gives one letter when the game has two spellings for one flag", () => {
    expect(flagLetters(["on guard", "guarding"])).toBe("G");
    expect(flagLetters(["taxing", "autotax"])).toBe("T");
  });

  it("tells the two forms of CONSUME apart", () => {
    expect(flagLetters(["consuming unit's food"])).toBe("C");
    expect(flagLetters(["consuming faction's food"])).toBe("F");
  });

  it("has no letter for a flag this build does not know", () => {
    expect(flagLetters(["something new"])).toBe("");
  });

  it("has a letter for the two flags the parser used to drop", () => {
    expect(flagLetters(["receiving no aid", "won't cross water"])).toBe("NX");
  });
});

describe("flagWords", () => {
  it("puts every flag in the hover text, including the ones with no letter", () => {
    expect(flagWords(["avoiding", "riding battle spoils"])).toBe("avoiding · riding battle spoils");
    expect(flagWords([])).toBeUndefined();
  });
});
