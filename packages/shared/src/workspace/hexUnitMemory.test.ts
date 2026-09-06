import { describe, expect, it } from "vitest";

import { NO_HEX_UNITS, unitForHex, withUnitRemembered } from "./hexUnitMemory";

const units = (...ids: string[]) => ids.map((unitId) => ({ unitId }));

describe("hex unit memory", () => {
  it("selects the remembered unit when it is still in the hex", () => {
    const memory = withUnitRemembered(NO_HEX_UNITS, "1:7,53", "5812");
    expect(unitForHex(memory, "1:7,53", units("18642", "5812"))).toBe("5812");
  });

  it("falls back to the first unit when the remembered one has left the hex", () => {
    const memory = withUnitRemembered(NO_HEX_UNITS, "1:7,53", "5812");
    expect(unitForHex(memory, "1:7,53", units("18642", "1605"))).toBe("18642");
  });

  it("falls back to the first unit for a hex nothing has been chosen in", () => {
    expect(unitForHex(NO_HEX_UNITS, "1:9,53", units("1605", "18642"))).toBe("1605");
  });

  it("answers null for a hex with no units, and for no hex at all", () => {
    const memory = withUnitRemembered(NO_HEX_UNITS, "1:7,53", "5812");
    expect(unitForHex(memory, "1:7,53", [])).toBeNull();
    expect(unitForHex(memory, null, units("18642"))).toBeNull();
  });

  it("remembers each hex separately", () => {
    const memory = withUnitRemembered(
      withUnitRemembered(NO_HEX_UNITS, "1:7,53", "5812"),
      "1:9,53",
      "1605"
    );
    expect(unitForHex(memory, "1:7,53", units("18642", "5812"))).toBe("5812");
    expect(unitForHex(memory, "1:9,53", units("42", "1605"))).toBe("1605");
  });

  it("returns the identical memory when the unit recorded is already the one remembered", () => {
    const memory = withUnitRemembered(NO_HEX_UNITS, "1:7,53", "5812");
    expect(withUnitRemembered(memory, "1:7,53", "5812")).toBe(memory);
  });
});
