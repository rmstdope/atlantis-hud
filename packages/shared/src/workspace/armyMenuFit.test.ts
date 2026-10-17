import { describe, expect, it } from "vitest";
import { edgeFades, fitArmyMenu, MENU_ANCHOR_GAP, MENU_EDGE_MARGIN } from "./armyMenuFit";

/** A naming line and a footer of 60px, rows of 24px, a button 24px tall. */
const fit = (anchorTop: number, viewportHeight: number, naturalHeight: number) =>
  fitArmyMenu({
    anchorTop,
    anchorBottom: anchorTop + 24,
    viewportHeight,
    naturalHeight,
    chromeHeight: 60,
    rowHeight: 24
  });

const SPARE = MENU_ANCHOR_GAP + MENU_EDGE_MARGIN;

describe("where the Add to army list opens and how tall it may grow", () => {
  it("opens below at its full height when it fits there", () => {
    expect(fit(100, 800, 200)).toEqual({
      side: "below",
      maxHeight: 800 - 124 - SPARE
    });
  });

  it("stays below and is capped at the window when the room below holds five rows", () => {
    // 60 of chrome + 5 rows of 24 = 180 of room below.
    const top = 800 - 24 - SPARE - 180;
    expect(fit(top, 800, 600)).toEqual({ side: "below", maxHeight: 180 });
  });

  it("opens above when the room below holds fewer than five rows and above has more", () => {
    const top = 800 - 24 - SPARE - 179;
    expect(fit(top, 800, 600)).toEqual({
      side: "above",
      maxHeight: top - SPARE
    });
  });

  it("caps an upward list at the window top", () => {
    expect(fit(700, 800, 2000)).toEqual({
      side: "above",
      maxHeight: 700 - SPARE
    });
  });

  it("uses whichever side has more room when both are cramped", () => {
    // Below: 300 - 124 - 12 = 164; above: 100 - 12 = 88.
    expect(fit(100, 300, 600)).toEqual({ side: "below", maxHeight: 164 });
    // Below: 300 - 224 - 12 = 64; above: 200 - 12 = 188.
    expect(fit(200, 300, 600)).toEqual({ side: "above", maxHeight: 188 });
  });

  it("never shrinks below the naming line, one row and New Army", () => {
    expect(fit(40, 120, 600)).toEqual({ side: "below", maxHeight: 84 });
  });

  it("lets a list with no armies keep its whole height as its floor", () => {
    expect(fit(40, 100, 60).maxHeight).toBe(60);
  });
});

describe("which edges of the army rows fade", () => {
  it("fades nothing when every row is in view", () => {
    expect(edgeFades({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toEqual({
      top: false,
      bottom: false
    });
  });

  it("fades the bottom at the top of the list", () => {
    expect(edgeFades({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 })).toEqual({
      top: false,
      bottom: true
    });
  });

  it("fades both edges part-way down", () => {
    expect(edgeFades({ scrollTop: 50, scrollHeight: 300, clientHeight: 100 })).toEqual({
      top: true,
      bottom: true
    });
  });

  it("fades the top only at the end, allowing for a fractional scroll position", () => {
    expect(edgeFades({ scrollTop: 199.5, scrollHeight: 300, clientHeight: 100 })).toEqual({
      top: true,
      bottom: false
    });
  });
});
