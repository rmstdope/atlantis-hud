import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAssistantPanelSize,
  resetAssistantPanelSizeForTests,
  resetFloatingPanelSize,
  resetSheetPanelHeight,
  setFloatingPanelSize,
  setSheetPanelHeight,
  subscribeAssistantPanelSize
} from "./assistantPanelSize";

describe("the Assistant changes panel's size for this run", () => {
  beforeEach(() => resetAssistantPanelSizeForTests());

  it("starts at the original size", () => {
    expect(getAssistantPanelSize()).toEqual({ floating: null, sheet: null });
  });

  it("keeps the floating size and the sheet height apart", () => {
    setFloatingPanelSize({ width: 500, height: 300 });
    setSheetPanelHeight(240);
    expect(getAssistantPanelSize()).toEqual({ floating: { width: 500, height: 300 }, sheet: 240 });
    resetFloatingPanelSize();
    expect(getAssistantPanelSize()).toEqual({ floating: null, sheet: 240 });
    setFloatingPanelSize({ width: 400, height: 200 });
    resetSheetPanelHeight();
    expect(getAssistantPanelSize()).toEqual({ floating: { width: 400, height: 200 }, sheet: null });
  });

  it("tells its readers when the size changes", () => {
    const notify = vi.fn();
    const stop = subscribeAssistantPanelSize(notify);
    setSheetPanelHeight(200);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
    setSheetPanelHeight(210);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
