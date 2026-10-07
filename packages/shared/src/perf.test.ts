import { afterEach, describe, expect, it } from "vitest";
import { clearTimings, recordTiming, stepSummaries, summariseFrames, timed, timedAsync } from "./perf";

afterEach(() => clearTimings());

describe("the timings the performance panel shows", () => {
  it("keeps the last, median and worst of each step that has run, in pipeline order", () => {
    for (const ms of [30, 10, 20]) recordTiming("render map", ms);
    recordTiming("parse report", 5);

    expect(stepSummaries()).toEqual([
      { step: "parse report", count: 1, last: 5, median: 5, worst: 5 },
      { step: "render map", count: 3, last: 20, median: 20, worst: 30 }
    ]);
  });

  it("keeps only the latest twenty timings of a step, so the figures stay current", () => {
    for (let ms = 1; ms <= 25; ms += 1) recordTiming("build hex views", ms);
    const [summary] = stepSummaries();

    expect(summary.count).toBe(20);
    expect(summary.worst).toBe(25);
  });

  it("times synchronous and asynchronous work, and still records a step that throws", async () => {
    expect(timed("build map model", () => 42)).toBe(42);
    await expect(timedAsync("parse report", async () => "done")).resolves.toBe("done");
    expect(() =>
      timed("render map", () => {
        throw new Error("boom");
      })
    ).toThrow("boom");

    expect(stepSummaries().map((summary) => summary.step)).toEqual([
      "parse report",
      "build map model",
      "render map"
    ]);
  });
});

describe("frame timing", () => {
  it("turns frame timestamps into a rate, typical and slow frame times, and a count of stutters", () => {
    // Nine frames 10 ms apart, then one that took 100 ms.
    const stamps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 190];
    const summary = summariseFrames(stamps)!;

    expect(summary.fps).toBeCloseTo((10 * 1000) / 190);
    expect(summary.median).toBe(10);
    expect(summary.worst).toBe(100);
    expect(summary.slow).toBe(1);
  });

  it("says nothing until there are two frames to compare", () => {
    expect(summariseFrames([5])).toBeNull();
  });
});
