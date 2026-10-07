/**
 * How long the app's heavy steps took, kept for the performance panel.
 *
 * A step is timed where it runs - parsing a report, building the map model, rendering the map - and
 * the latest few timings of each are kept here, in a plain module rather than a store: recording one
 * must never cause a render, because the thing being measured is often a render. The panel reads
 * this on its own clock while it is open, and nothing reads it otherwise.
 */

export type PerfStep =
  | "parse report"
  | "import reports"
  | "build map model"
  | "build hex views"
  | "render map";

/** The steps in the order the panel lists them: the pipeline from a file to pixels. */
export const PERF_STEPS: readonly PerfStep[] = [
  "import reports",
  "parse report",
  "build map model",
  "build hex views",
  "render map"
];

/** How many timings of each step are kept: enough for a median, few enough to stay current. */
const KEEP = 20;

const timings = new Map<PerfStep, number[]>();

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

/** Records one timing of a step, in milliseconds. */
export function recordTiming(step: PerfStep, ms: number): void {
  const list = timings.get(step) ?? [];
  list.push(ms);
  if (list.length > KEEP) {
    list.shift();
  }
  timings.set(step, list);
}

/** Runs `work`, records how long it took under `step`, and returns what it returned. */
export function timed<T>(step: PerfStep, work: () => T): T {
  const started = now();
  try {
    return work();
  } finally {
    recordTiming(step, now() - started);
  }
}

/** The same for asynchronous work: the time is until the promise settles. */
export async function timedAsync<T>(step: PerfStep, work: () => Promise<T>): Promise<T> {
  const started = now();
  try {
    return await work();
  } finally {
    recordTiming(step, now() - started);
  }
}

export type StepSummary = { step: PerfStep; count: number; last: number; median: number; worst: number };

/** What the panel shows for each step that has run at least once. */
export function stepSummaries(): StepSummary[] {
  return PERF_STEPS.flatMap((step) => {
    const list = timings.get(step);
    if (!list || list.length === 0) {
      return [];
    }
    const sorted = [...list].sort((a, b) => a - b);
    return [
      {
        step,
        count: list.length,
        last: list[list.length - 1],
        median: sorted[Math.floor(sorted.length / 2)],
        worst: sorted[sorted.length - 1]
      }
    ];
  });
}

/** Forgets every timing; for tests, and for the panel's reset. */
export function clearTimings(): void {
  timings.clear();
}

export type FrameSummary = {
  /** Frames drawn per second over the window. */
  fps: number;
  /** The typical and the slow (95th percentile) time between frames, in milliseconds. */
  median: number;
  p95: number;
  worst: number;
  /** Frames that took longer than 50 ms - the ones a player feels as a stutter. */
  slow: number;
};

/** A summary of the gaps between consecutive frame timestamps, in milliseconds. */
export function summariseFrames(stamps: readonly number[]): FrameSummary | null {
  if (stamps.length < 2) {
    return null;
  }
  const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const span = stamps[stamps.length - 1] - stamps[0];
  return {
    fps: span > 0 ? (gaps.length * 1000) / span : 0,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    worst: sorted[sorted.length - 1],
    slow: gaps.filter((gap) => gap > 50).length
  };
}
