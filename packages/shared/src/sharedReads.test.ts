import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sharedReads } from "./sharedReads";

function fakeClient() {
  let stored = "turn 1";
  return {
    loadImportedTurn: vi.fn(async (_db: string, _game: string, _faction: string, turn: number) => ({
      turn,
      rawReport: stored
    })),
    parseReportFull: vi.fn(async (raw: string) => ({ parsed: raw })),
    validateOrders: vi.fn(async (text: string) => text.length),
    commitReportImport: vi.fn(async (raw: string) => {
      stored = raw;
    }),
    version: "1"
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("reads shared between the stores that open a game together", () => {
  it("makes one call for the same stored turn, asked for twice at once or in a row", async () => {
    const raw = fakeClient();
    const client = sharedReads(raw);

    const [a, b] = await Promise.all([
      client.loadImportedTurn("db", "g", "1", 5),
      client.loadImportedTurn("db", "g", "1", 5)
    ]);
    const c = await client.loadImportedTurn("db", "g", "1", 5);

    expect(raw.loadImportedTurn).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("asks again for different arguments", async () => {
    const raw = fakeClient();
    const client = sharedReads(raw);

    await client.loadImportedTurn("db", "g", "1", 5);
    await client.loadImportedTurn("db", "g", "1", 6);

    expect(raw.loadImportedTurn).toHaveBeenCalledTimes(2);
  });

  it("forgets everything it read once anything is written, so a re-import is seen", async () => {
    const raw = fakeClient();
    const client = sharedReads(raw);

    await client.loadImportedTurn("db", "g", "1", 5);
    await client.commitReportImport("turn 1, again");
    const after = await client.loadImportedTurn("db", "g", "1", 5);

    expect(raw.loadImportedTurn).toHaveBeenCalledTimes(2);
    expect(after.rawReport).toBe("turn 1, again");
  });

  it("forgets what it read after a few seconds, so a long session does not hold every report", async () => {
    const raw = fakeClient();
    const client = sharedReads(raw);

    await client.parseReportFull("report");
    vi.advanceTimersByTime(10_001);
    await client.parseReportFull("report");

    expect(raw.parseReportFull).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure, so the next caller tries again", async () => {
    const raw = fakeClient();
    raw.parseReportFull.mockRejectedValueOnce(new Error("busy"));
    const client = sharedReads(raw);

    await expect(client.parseReportFull("report")).rejects.toThrow("busy");
    await expect(client.parseReportFull("report")).resolves.toEqual({ parsed: "report" });
  });

  it("passes everything else straight through, every time", async () => {
    const raw = fakeClient();
    const client = sharedReads(raw);

    await client.validateOrders("abc");
    await client.validateOrders("abc");

    expect(raw.validateOrders).toHaveBeenCalledTimes(2);
    expect(client.version).toBe("1");
  });
});
