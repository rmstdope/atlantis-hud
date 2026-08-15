import { describe, expect, it } from "vitest";
import { isRecentreGesture } from "./mapRecentre";

const MAC = true;
const NOT_MAC = false;

describe("isRecentreGesture", () => {
  it("a contextmenu event centres on every platform", () => {
    // The contextmenu event has no meaningful button/ctrlKey reading of its own on some
    // browsers, but the call site always passes button 2 for it; either way it must answer true.
    expect(isRecentreGesture({ button: 2, ctrlKey: false }, MAC)).toBe(true);
    expect(isRecentreGesture({ button: 2, ctrlKey: false }, NOT_MAC)).toBe(true);
  });

  it("Ctrl+click is the gesture on macOS", () => {
    expect(isRecentreGesture({ button: 0, ctrlKey: true }, MAC)).toBe(true);
  });

  it("Ctrl+click is not the gesture elsewhere", () => {
    expect(isRecentreGesture({ button: 0, ctrlKey: true }, NOT_MAC)).toBe(false);
  });

  it("a plain left click never is", () => {
    expect(isRecentreGesture({ button: 0, ctrlKey: false }, MAC)).toBe(false);
    expect(isRecentreGesture({ button: 0, ctrlKey: false }, NOT_MAC)).toBe(false);
  });
});
