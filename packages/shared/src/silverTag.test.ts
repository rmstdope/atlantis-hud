import { describe, expect, it } from "vitest";

import { isSilver, withoutSilver } from "./silverTag";

describe("the silver tag", () => {
  it("drops silver and keeps the order of the rest", () => {
    expect(
      withoutSilver([
        { tag: "LEAD", amount: 2 },
        { tag: "SILV", amount: 1000 },
        { tag: "GRAI", amount: 12 }
      ])
    ).toEqual([
      { tag: "LEAD", amount: 2 },
      { tag: "GRAI", amount: 12 }
    ]);
  });

  it("recognises the tag however it was cased", () => {
    expect(isSilver("silv")).toBe(true);
    expect(isSilver("SILVER")).toBe(false);
  });
});
