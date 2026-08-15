import { describe, expect, it } from "vitest";
import { describeError, runReported } from "./shellAction";

describe("describeError", () => {
  it("reads an Error's message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("uses a non-empty string as-is", () => {
    expect(describeError("locked")).toBe("locked");
  });

  it("falls back to JSON for a blank string, pinning today's behaviour", () => {
    expect(describeError("   ")).toBe('"   "');
  });

  it("stringifies a plain object", () => {
    expect(describeError({ code: 5 })).toBe('{"code":5}');
  });

  it("reads 'unknown error' for undefined", () => {
    expect(describeError(undefined)).toBe("unknown error");
  });

  it("reads 'unknown error' for a value JSON.stringify cannot handle", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe("unknown error");
  });
});

describe("runReported", () => {
  it("resolves the work's value and never calls report", async () => {
    const reported: string[] = [];
    const result = await runReported(
      async () => 42,
      (message) => reported.push(message)
    );
    expect(result).toBe(42);
    expect(reported).toEqual([]);
  });

  it("resolves undefined and reports once when the work throws", async () => {
    const reported: string[] = [];
    const result = await runReported(
      async () => {
        throw new Error("boom");
      },
      (message) => reported.push(message)
    );
    expect(result).toBeUndefined();
    expect(reported).toEqual(["boom"]);
  });

  it("prefixes the reported message when a prefix is given", async () => {
    const reported: string[] = [];
    await runReported(
      async () => {
        throw new Error("boom");
      },
      (message) => reported.push(message),
      { prefix: "could not x" }
    );
    expect(reported).toEqual(["could not x: boom"]);
  });

  it("toggles busy true then false around a success", async () => {
    const calls: boolean[] = [];
    await runReported(async () => "ok", () => {}, { busy: (busy) => calls.push(busy) });
    expect(calls).toEqual([true, false]);
  });

  it("toggles busy true then false around a throw", async () => {
    const calls: boolean[] = [];
    await runReported(
      async () => {
        throw new Error("boom");
      },
      () => {},
      { busy: (busy) => calls.push(busy) }
    );
    expect(calls).toEqual([true, false]);
  });
});
