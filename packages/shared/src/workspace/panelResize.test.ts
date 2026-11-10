import { describe, expect, it } from "vitest";
import {
  RESIZE_CURSOR,
  RESIZE_EDGES,
  committedSize,
  floatingSizeStyle,
  resizePanelFrame,
  resizeSheetHeight,
  sheetSizeStyle,
  type PanelFrame
} from "./panelResize";

const START: PanelFrame = { left: 100, top: 200, width: 500, height: 300 };
const LIMITS = { minWidth: 320, minHeight: 80, bounds: { left: 0, top: 0, right: 1280, bottom: 720 } };

describe("resizePanelFrame", () => {
  it("moves the right and bottom sides for e, s and se", () => {
    expect(resizePanelFrame(START, "e", 40, 30, LIMITS)).toEqual({ ...START, width: 540 });
    expect(resizePanelFrame(START, "s", 40, 30, LIMITS)).toEqual({ ...START, height: 330 });
    expect(resizePanelFrame(START, "se", 40, 30, LIMITS)).toEqual({ ...START, width: 540, height: 330 });
  });

  it("keeps the opposite side where it is for a w or n edge", () => {
    expect(resizePanelFrame(START, "w", -40, 0, LIMITS)).toEqual({ ...START, left: 60, width: 540 });
    expect(resizePanelFrame(START, "n", 0, -50, LIMITS)).toEqual({ ...START, top: 150, height: 350 });
    expect(resizePanelFrame(START, "nw", 20, 20, LIMITS)).toEqual({ left: 120, top: 220, width: 480, height: 280 });
    expect(resizePanelFrame(START, "ne", 20, 20, LIMITS)).toEqual({ left: 100, top: 220, width: 520, height: 280 });
    expect(resizePanelFrame(START, "sw", 20, 20, LIMITS)).toEqual({ left: 120, top: 200, width: 480, height: 320 });
  });

  it("stops at the smallest size with the opposite side still held", () => {
    expect(resizePanelFrame(START, "e", -400, 0, LIMITS)).toEqual({ ...START, width: 320 });
    expect(resizePanelFrame(START, "w", 400, 0, LIMITS)).toEqual({ ...START, left: 280, width: 320 });
    expect(resizePanelFrame(START, "n", 0, 400, LIMITS)).toEqual({ ...START, top: 420, height: 80 });
    expect(resizePanelFrame(START, "s", 0, -400, LIMITS)).toEqual({ ...START, height: 80 });
  });

  it("never leaves the window", () => {
    expect(resizePanelFrame(START, "w", -500, 0, LIMITS)).toEqual({ ...START, left: 0, width: 600 });
    expect(resizePanelFrame(START, "n", 0, -500, LIMITS)).toEqual({ ...START, top: 0, height: 500 });
    expect(resizePanelFrame(START, "e", 2000, 0, LIMITS)).toEqual({ ...START, width: 1180 });
    expect(resizePanelFrame(START, "s", 0, 2000, LIMITS)).toEqual({ ...START, height: 520 });
  });

  it("keeps the margins it is given rather than the bare window", () => {
    const bounds = { left: 0, top: 46, right: 1266, bottom: 706 };
    expect(resizePanelFrame(START, "n", 0, -500, { ...LIMITS, bounds })).toEqual({ ...START, top: 46, height: 454 });
    expect(resizePanelFrame(START, "e", 2000, 0, { ...LIMITS, bounds })).toEqual({ ...START, width: 1166 });
    expect(resizePanelFrame(START, "s", 0, 2000, { ...LIMITS, bounds })).toEqual({ ...START, height: 506 });
  });

  it("names a resize cursor for every edge and corner", () => {
    expect(RESIZE_EDGES).toHaveLength(8);
    expect(RESIZE_CURSOR.n).toBe("ns-resize");
    expect(RESIZE_CURSOR.e).toBe("ew-resize");
    expect(RESIZE_CURSOR.ne).toBe("nesw-resize");
    expect(RESIZE_CURSOR.nw).toBe("nwse-resize");
  });
});

describe("committedSize", () => {
  const dragged: PanelFrame = { left: 100, top: 200, width: 600, height: 120 };

  it("takes the width and height of a drag that moved a top or bottom side", () => {
    expect(committedSize("n", dragged, null)).toEqual({ width: 600, height: 120 });
    expect(committedSize("se", dragged, { width: 500, height: 400 })).toEqual({ width: 600, height: 120 });
  });

  it("leaves the height limit as it was when only a left or right side moved", () => {
    expect(committedSize("e", dragged, null)).toEqual({ width: 600, height: null });
    expect(committedSize("w", dragged, { width: 500, height: 400 })).toEqual({ width: 600, height: 400 });
  });
});

describe("resizeSheetHeight", () => {
  it("grows when the top edge goes up, within the smallest and largest heights", () => {
    expect(resizeSheetHeight(300, -50, 80, 600)).toBe(350);
    expect(resizeSheetHeight(300, 400, 80, 600)).toBe(80);
    expect(resizeSheetHeight(300, -900, 80, 600)).toBe(600);
  });
});

describe("the size styles", () => {
  it("leave the floating panel at today's default while no size is set", () => {
    expect(floatingSizeStyle(null, null)).toEqual({});
  });

  it("cap a set size by the window, so a smaller window shrinks it and a larger one gives it back", () => {
    expect(floatingSizeStyle({ width: 500, height: 300 }, null)).toEqual({
      width: "min(500px, calc(100vw - 28px))",
      maxHeight: "min(300px, calc(100dvh - 60px))"
    });
    expect(floatingSizeStyle({ width: 500, height: 300 }, 120)).toEqual({
      width: "min(500px, calc(100vw - 28px))",
      maxHeight: "min(300px, calc(100dvh - 120px - 14px))"
    });
  });

  it("keep the width cap the window's alone, so moving the panel by its title bar never changes its width", () => {
    expect(floatingSizeStyle({ width: 500, height: 300 }, 120).width).toBe(floatingSizeStyle({ width: 500, height: 300 }, 600).width);
  });

  it("set only the width when no height limit was set", () => {
    expect(floatingSizeStyle({ width: 500, height: null }, 40)).toEqual({ width: "min(500px, calc(100vw - 28px))" });
  });

  it("give the sheet its height limit, or today's half window", () => {
    expect(sheetSizeStyle(null)).toEqual({ maxHeight: "50vh" });
    expect(sheetSizeStyle(250)).toEqual({ maxHeight: "min(250px, calc(100dvh - 60px))" });
  });
});
