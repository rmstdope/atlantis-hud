import { describe, expect, it } from "vitest";

import { FLAG_SETTINGS, flagLetters, flagState, flagWords, unsettledFlags } from "./unitFlags";

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

describe("FLAG_SETTINGS", () => {
  const setting = (key: string) => {
    const found = FLAG_SETTINGS.find((entry) => entry.key === key);
    if (!found) {
      throw new Error(`no setting ${key}`);
    }
    return found;
  };

  it("every setting names the state a flag list puts it in", () => {
    const flags = ["behind", "on guard", "riding battle spoils"];
    expect(flagState(setting("behind"), flags)).toBe("on");
    expect(flagState(setting("guarding"), flags)).toBe("on");
    expect(flagState(setting("spoils"), flags)).toBe("riding");
    expect(flagState(setting("avoiding"), flags)).toBe("off");
    expect(flagState(setting("consuming"), flags)).toBe("silver first");
  });

  it("the two spellings of one flag are one setting", () => {
    expect(flagState(setting("guarding"), ["guarding"])).toBe("on");
    expect(flagState(setting("guarding"), ["on guard"])).toBe("on");
    expect(flagState(setting("taxing"), ["taxing"])).toBe("on");
    expect(flagState(setting("taxing"), ["autotax"])).toBe("on");
    expect(flagState(setting("noAid"), ["no aid"])).toBe("on");
    expect(flagState(setting("noAid"), ["receiving no aid"])).toBe("on");
  });

  it("a setting with no flag printed falls to its last state", () => {
    expect(flagState(setting("spoils"), [])).toBe("not shown");
    expect(flagState(setting("consuming"), [])).toBe("silver first");
  });

  it("a flag no setting accounts for is returned on its own", () => {
    expect(unsettledFlags(["behind", "under strength"])).toEqual(["under strength"]);
    expect(unsettledFlags(["riding battle spoils"])).toEqual([]);
  });
});
