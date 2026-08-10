import { describe, expect, it } from "vitest";
import { decideReportLoad, shouldConfirmOlderTurnLoad } from "./reportLoadDecision";

const borgTng = { factionId: "95", turnNumber: 71 };
const borg = (turnNumber: number | null) => ({ factionId: "73", turnNumber });

describe("shouldConfirmOlderTurnLoad", () => {
  it("requires confirmation when loading an older turn", () => {
    expect(shouldConfirmOlderTurnLoad(71, 2)).toBe(true);
  });

  it("does not require confirmation when loading the same or newer turn", () => {
    expect(shouldConfirmOlderTurnLoad(71, 71)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(71, 72)).toBe(false);
  });

  it("does not require confirmation when either turn number is unknown", () => {
    expect(shouldConfirmOlderTurnLoad(null, 2)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(71, null)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(undefined, 2)).toBe(false);
    expect(shouldConfirmOlderTurnLoad(71, undefined)).toBe(false);
  });
});

describe("deciding what to do with a chosen report", () => {
  it("just loads the first report of all, whatever it is", () => {
    expect(decideReportLoad(null, borg(2))).toEqual({ kind: "load" });
  });

  it("just loads a newer turn of the faction on screen", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: 72 })).toEqual({
      kind: "load"
    });
  });

  it("just loads the turn on screen again", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: 71 })).toEqual({
      kind: "load"
    });
  });

  it("warns before an older turn of the faction on screen replaces it", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: 70 })).toEqual({
      kind: "confirmOlder",
      currentTurn: 71,
      incomingTurn: 70
    });
  });

  it("asks what to do with another faction's report for the same turn", () => {
    expect(decideReportLoad(borgTng, borg(71))).toEqual({ kind: "ask", canMerge: true });
  });

  /**
   * The question is still asked, because the faction is still about to change. Only the offer to
   * merge is withdrawn: a report from another turn describes another moment.
   */
  it("asks about another faction's older report, but will not merge it", () => {
    expect(decideReportLoad(borgTng, borg(2))).toEqual({ kind: "ask", canMerge: false });
  });

  it("asks about another faction's newer report, and will not merge that either", () => {
    expect(decideReportLoad(borgTng, borg(72))).toEqual({ kind: "ask", canMerge: false });
  });

  it("will not merge into a turn it cannot number", () => {
    expect(decideReportLoad({ factionId: "95", turnNumber: null }, borg(71))).toEqual({
      kind: "ask",
      canMerge: false
    });
    expect(decideReportLoad(borgTng, borg(null))).toEqual({ kind: "ask", canMerge: false });
  });

  /**
   * A report that does not name its faction is not evidence of another faction. It falls through to
   * the older-turn rule, which is the behaviour it had before there was a question to ask.
   */
  it("does not raise the question over a faction it cannot read", () => {
    expect(decideReportLoad({ factionId: null, turnNumber: 71 }, borg(71))).toEqual({
      kind: "load"
    });
    expect(decideReportLoad(borgTng, { factionId: null, turnNumber: 71 })).toEqual({
      kind: "load"
    });
    expect(decideReportLoad(borgTng, { factionId: null, turnNumber: 2 })).toEqual({
      kind: "confirmOlder",
      currentTurn: 71,
      incomingTurn: 2
    });
  });
});
