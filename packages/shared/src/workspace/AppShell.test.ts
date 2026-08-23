import { aParsedReport } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { isOlderTurn, parserWaitingForRuleset, RULESET_WAIT_MS } from "./AppShell";

describe("isOlderTurn", () => {
  it("is older when the incoming turn is behind what is on screen", () => {
    expect(isOlderTurn(71, 2)).toBe(true);
  });

  it("is not older when the incoming turn is the same or ahead", () => {
    expect(isOlderTurn(71, 71)).toBe(false);
    expect(isOlderTurn(71, 72)).toBe(false);
  });

  it("is not older when either turn number is unknown", () => {
    expect(isOlderTurn(null, 2)).toBe(false);
    expect(isOlderTurn(71, null)).toBe(false);
    expect(isOlderTurn(undefined, 2)).toBe(false);
    expect(isOlderTurn(71, undefined)).toBe(false);
  });
});


describe("parserWaitingForRuleset", () => {
  function client() {
    return {
      parseReportClassified: vi.fn(async () => aParsedReport()),
      parseReportFull: vi.fn(async () => aParsedReport())
    };
  }

  it("waits for the ruleset before parsing", async () => {
    const core = client();
    let settle: (state: { status: string; text?: string }) => void = () => undefined;
    const settled = new Promise<{ status: string; text?: string }>((resolve) => {
      settle = resolve;
    });

    const parse = parserWaitingForRuleset(
      core,
      () => settled as never,
      // Deliberately stale, and left so: the shell's own copy is one render behind the fetch, which
      // is why the settled state has to travel with the promise.
      () => ({ status: "loading" }) as never
    );
    const parsing = parse("raw text");

    // The load started while the ruleset was still arriving - the window this bead is about.
    expect(core.parseReportFull).not.toHaveBeenCalled();

    settle({ status: "ready", text: "RULES" });
    await parsing;

    expect(core.parseReportClassified).toHaveBeenCalledWith("raw text", "RULES");
    expect(core.parseReportFull).not.toHaveBeenCalled();
  });

  it("parses without the ruleset when it never arrives", async () => {
    vi.useFakeTimers();
    try {
      const core = client();
      const parse = parserWaitingForRuleset(
        core,
        () => new Promise<never>(() => undefined),
        () => ({ status: "loading" }) as never
      );

      const parsing = parse("raw text");
      await vi.advanceTimersByTimeAsync(RULESET_WAIT_MS + 1);
      await parsing;

      expect(core.parseReportFull).toHaveBeenCalledWith("raw text");
      expect(core.parseReportClassified).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
