import { describe, expect, it } from "vitest";

import { midSentence, unitInSentence } from "./formedUnitName";
import { andList } from "./refusedCast";

describe("how a sentence names a unit (ah-uxaw)", () => {
  it("names a unit the report shows by name and number", () => {
    expect(unitInSentence({ unitId: "683", name: "Ivanhoe" })).toBe("Ivanhoe (683)");
  });

  it("names a unit this month's FORM creates once, by its alias and the unit that formed it", () => {
    expect(unitInSentence({ unitId: "new-1", name: "Unit (new 1)", formedBy: "Ivanhoe (683)" })).toBe(
      "new 1, formed by Ivanhoe (683)"
    );
    expect(unitInSentence({ unitId: "new-2", name: "Unit (new 2)", formedBy: "new 1" })).toBe(
      "new 2, formed by new 1"
    );
  });

  it("never doubles a formed unit whose former is not known", () => {
    expect(unitInSentence({ unitId: "new-1", name: "Unit (new 1)", formedBy: null })).toBe("new 1");
    expect(unitInSentence({ unitId: "new-1", name: "Unit (new 1)" })).toBe("new 1");
  });

  it("names a unit with no known name by its number", () => {
    expect(unitInSentence({ unitId: "1502", name: null })).toBe("unit 1502");
  });

  it("closes a formed phrase with a comma when the sentence goes on, and nothing else", () => {
    expect(midSentence("new 1, formed by Ivanhoe (683)")).toBe("new 1, formed by Ivanhoe (683),");
    expect(midSentence("Ivanhoe (683)")).toBe("Ivanhoe (683)");
    expect(midSentence("new 1")).toBe("new 1");
  });

  it("sets a formed phrase off with commas inside a list too", () => {
    expect(andList(["new 1, formed by Ivanhoe (683)", "Drones (2404)"])).toBe(
      "new 1, formed by Ivanhoe (683), and Drones (2404)"
    );
    expect(andList(["new 1, formed by Ivanhoe (683)", "Drones (2404)", "Scouts (1502)"])).toBe(
      "new 1, formed by Ivanhoe (683), Drones (2404) and Scouts (1502)"
    );
    expect(andList(["Drones (2404)", "new 1, formed by Ivanhoe (683)"])).toBe(
      "Drones (2404) and new 1, formed by Ivanhoe (683)"
    );
  });
});
