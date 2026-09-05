import { describe, expect, it } from "vitest";
import type { NewAgeResult } from "./newAgeApi";
import { runHistoryFetch } from "./newAgeHistoryRun";

function effects(
  over: Partial<Parameters<typeof runHistoryFetch>[1]> = {},
  replies: Record<number, NewAgeResult<string>> = {}
) {
  const asked: number[] = [];
  const stored: [number, string][] = [];
  const progress: [number, number][] = [];
  return {
    asked,
    stored,
    progress,
    effects: {
      fetch: async (turnNumber: number) => {
        asked.push(turnNumber);
        return replies[turnNumber] ?? { kind: "ok" as const, value: `report ${turnNumber}` };
      },
      store: async (turnNumber: number, reportText: string) => {
        stored.push([turnNumber, reportText]);
        return true;
      },
      onProgress: (turnNumber: number, done: number) => progress.push([turnNumber, done]),
      abandoned: () => false,
      ...over
    }
  };
}

describe("runHistoryFetch", () => {
  it("fetches each turn in order and reports progress before each", async () => {
    const { effects: fx, asked, stored, progress } = effects();

    const outcome = await runHistoryFetch([70, 71, 72], fx);

    expect(asked).toEqual([70, 71, 72]);
    expect(stored).toEqual([
      [70, "report 70"],
      [71, "report 71"],
      [72, "report 72"]
    ]);
    expect(progress).toEqual([
      [70, 0],
      [71, 1],
      [72, 2]
    ]);
    expect(outcome).toEqual({ stored: [70, 71, 72], failed: new Map(), remaining: null });
  });

  it("carries on past a turn the world will not give, and names it", async () => {
    const { effects: fx } = effects({}, { 71: { kind: "unreadable" } });

    const outcome = await runHistoryFetch([70, 71, 72], fx);

    expect(outcome.stored).toEqual([70, 72]);
    expect(outcome.failed).toEqual(new Map([["71", "no report"]]));
    expect(outcome.remaining).toBeNull();
  });

  it("stops at a 401 and hands back the turns still owed, this one first", async () => {
    const { effects: fx, asked } = effects({}, { 71: { kind: "unauthorized" } });

    const outcome = await runHistoryFetch([70, 71, 72], fx);

    expect(asked).toEqual([70, 71]);
    expect(outcome.stored).toEqual([70]);
    expect(outcome.failed).toEqual(new Map());
    expect(outcome.remaining).toEqual([71, 72]);
  });

  it("stops at the next turn once it is abandoned", async () => {
    let done = 0;
    const { effects: fx, asked } = effects({
      onProgress: () => {
        done += 1;
      },
      abandoned: () => done >= 2
    });

    const outcome = await runHistoryFetch([70, 71, 72], fx);

    expect(asked).toEqual([70, 71]);
    expect(outcome.stored).toEqual([70, 71]);
    expect(outcome.remaining).toBeNull();
  });

  it("counts a turn the game would not store as failed, without throwing", async () => {
    const { effects: fx } = effects({ store: async (turnNumber: number) => turnNumber !== 71 });

    const outcome = await runHistoryFetch([70, 71], fx);

    expect(outcome.stored).toEqual([70]);
    expect(outcome.failed).toEqual(new Map([["71", "not stored"]]));
  });
});
