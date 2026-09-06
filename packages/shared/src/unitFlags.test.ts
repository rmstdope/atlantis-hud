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

describe("flagLetters, both forms of REVEAL", () => {
  it("gives both forms of REVEAL the same letter", () => {
    expect(flagLetters(["revealing unit"])).toBe("R");
    expect(flagLetters(["revealing faction"])).toBe("R");
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
    expect(flagState(setting("spoils"), [])).toBe("all");
    expect(flagState(setting("consuming"), [])).toBe("silver first");
  });

  it("battle spoils rests nowhere, and a report that prints none of them reads all", () => {
    expect(setting("spoils").resting).toBeNull();
    expect(flagState(setting("spoils"), [])).toBe("all");
  });

  it("the two spellings of the weightless spoils setting are one state", () => {
    expect(flagState(setting("spoils"), ["weightless battle spoils"])).toBe("weightless");
    expect(flagState(setting("spoils"), ["no battle spoils"])).toBe("weightless");
  });

  it("a setting rests at the default the game names it", () => {
    expect(setting("consuming").resting).toBe("silver first");
    expect(setting("revealing").resting).toBe("off");
    expect(setting("behind").resting).toBe("off");
  });

  it("revealing is one setting with three states", () => {
    expect(setting("revealing").label).toBe("revealing");
    expect(flagState(setting("revealing"), ["revealing unit"])).toBe("unit");
    expect(flagState(setting("revealing"), ["revealing faction"])).toBe("faction");
    expect(flagState(setting("revealing"), [])).toBe("off");
    expect(unsettledFlags(["revealing unit"])).toEqual([]);
  });

  it("a flag no setting accounts for is returned on its own", () => {
    expect(unsettledFlags(["behind", "under strength"])).toEqual(["under strength"]);
    expect(unsettledFlags(["riding battle spoils"])).toEqual([]);
  });
});
