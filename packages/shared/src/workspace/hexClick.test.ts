import { describe, expect, it } from "vitest";
import { hexClickOf } from "./hexClick";

const base = { dragged: false, button: 0, ctrlKey: false, isMac: false, hexRegionId: "1:7,53" as string | null };

describe("what a click on a hex position does", () => {
  it("ignores a click that ended a drag", () => {
    expect(hexClickOf({ ...base, dragged: true })).toEqual({ kind: "ignore" });
    expect(hexClickOf({ ...base, dragged: true, button: 2 })).toEqual({ kind: "ignore" });
  });

  it("recentres on the secondary button, on any platform", () => {
    expect(hexClickOf({ ...base, button: 2 })).toEqual({ kind: "recentre" });
  });

  it("recentres on Ctrl+click on macOS, and selects on Ctrl+click elsewhere", () => {
    expect(hexClickOf({ ...base, ctrlKey: true, isMac: true })).toEqual({ kind: "recentre" });
    expect(hexClickOf({ ...base, ctrlKey: true, isMac: false })).toEqual({
      kind: "select-hex",
      regionId: "1:7,53"
    });
  });

  it("selects the hex the map holds", () => {
    expect(hexClickOf(base)).toEqual({ kind: "select-hex", regionId: "1:7,53" });
  });

  it("selects by position where the map holds no hex", () => {
    expect(hexClickOf({ ...base, hexRegionId: null })).toEqual({ kind: "select-ground" });
  });
});
