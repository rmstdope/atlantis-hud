import { describe, expect, it } from "vitest";
import {
  DIALOG_BAR_KEEP_PX,
  clampDialogPosition,
  pastDragThreshold
} from "./dialogDrag";

const viewport = { width: 1000, height: 800 };
const box = { width: 400, barBottom: 40 };

describe("clampDialogPosition", () => {
  it("leaves a position well inside the window alone", () => {
    expect(clampDialogPosition({ left: 300, top: 200 }, box, viewport)).toEqual({ left: 300, top: 200 });
  });

  it("lets most of the dialog off the left edge, keeping a grabbable slice of the bar", () => {
    expect(clampDialogPosition({ left: -900, top: 200 }, box, viewport).left).toBe(DIALOG_BAR_KEEP_PX - 400);
  });

  it("lets most of the dialog off the right edge, keeping a grabbable slice of the bar", () => {
    expect(clampDialogPosition({ left: 5000, top: 200 }, box, viewport).left).toBe(1000 - DIALOG_BAR_KEEP_PX);
  });

  it("never lets the top bar above the top edge", () => {
    expect(clampDialogPosition({ left: 300, top: -50 }, box, viewport).top).toBe(0);
  });

  it("keeps the whole top bar inside at the bottom edge", () => {
    expect(clampDialogPosition({ left: 300, top: 5000 }, box, viewport).top).toBe(800 - 40);
  });

  it("still moves a dialog wider than the window sideways and down", () => {
    const wide = { width: 1200, barBottom: 40 };
    const small = { width: 360, height: 640 };
    expect(clampDialogPosition({ left: -300, top: 400 }, wide, small)).toEqual({ left: -300, top: 400 });
    expect(clampDialogPosition({ left: 200, top: 400 }, wide, small)).toEqual({ left: 200, top: 400 });
  });

  it("pins the top to 0 in a window shorter than the bar", () => {
    expect(clampDialogPosition({ left: 300, top: 10 }, box, { width: 1000, height: 30 }).top).toBe(0);
  });
});

describe("pastDragThreshold", () => {
  it("ignores a jitter of two pixels", () => {
    expect(pastDragThreshold(2, 0)).toBe(false);
    expect(pastDragThreshold(1, -1)).toBe(false);
  });

  it("counts three pixels in any direction as a move", () => {
    expect(pastDragThreshold(3, 0)).toBe(true);
    expect(pastDragThreshold(0, -3)).toBe(true);
  });
});
