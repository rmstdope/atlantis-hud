import { describe, expect, it } from "vitest";
import { mageSheetFileName, safeFileNamePart } from "./mageSheet";

/** The name a shared mage sheet is saved under (`ah-lyg6.1.1`). */
describe("naming a mage sheet", () => {
  it("names the file after the faction and the turn", () => {
    expect(mageSheetFileName("Borg", "21", 23)).toBe("mages-Borg-turn-23.txt");
  });

  it("collapses spaces and unsafe characters", () => {
    expect(mageSheetFileName("The Disinherited Knights", "21", 23)).toBe(
      "mages-The-Disinherited-Knights-turn-23.txt"
    );
    expect(mageSheetFileName("A/B:C", "21", 23)).toBe("mages-A-B-C-turn-23.txt");
  });

  it("falls back to the faction id when the name is missing", () => {
    expect(mageSheetFileName(null, "21", 23)).toBe("mages-21-turn-23.txt");
  });

  it("falls back to unknown when neither is known", () => {
    expect(mageSheetFileName(null, null, null)).toBe("mages-unknown-turn-unknown.txt");
  });
});

describe("safeFileNamePart", () => {
  it("a_faction_name_with_a_slash_becomes_one_dash_in_a_file_name_part", () => {
    expect(safeFileNamePart("Borg/TNG")).toBe("Borg-TNG");
    expect(safeFileNamePart(" Borg  TNG ")).toBe("Borg-TNG");
    expect(safeFileNamePart("   ")).toBeNull();
    expect(safeFileNamePart(null)).toBeNull();
  });
});
