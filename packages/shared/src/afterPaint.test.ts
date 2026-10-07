import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterPaint } from "./afterPaint";

// No DOM here: a frame is a 16 ms timer, which is all the helper asks of one.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", (frame: ReturnType<typeof setTimeout>) => clearTimeout(frame));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("work held until the screen has been painted", () => {
  it("waits for the next frame, and then for the task after it", () => {
    const work = vi.fn();
    afterPaint(work);

    vi.advanceTimersByTime(15);
    expect(work).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(work).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("never runs once cancelled, before the frame or after it", () => {
    const early = vi.fn();
    afterPaint(early)();
    const late = vi.fn();
    const cancel = afterPaint(late);
    vi.advanceTimersByTime(16);
    cancel();

    vi.runAllTimers();
    expect(early).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});
